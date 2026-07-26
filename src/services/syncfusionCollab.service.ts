import { HubConnectionBuilder, HttpTransportType, type HubConnection } from '@microsoft/signalr';
import { supabase } from '../config/supabase';

/**
 * syncfusionCollab.service
 * -----------------------------------------------------------------------------
 * Co-edição de verdade: duas pessoas digitando no MESMO documento, cada uma vendo
 * o texto da outra aparecer.
 *
 * Quem faz o trabalho pesado é o próprio Document Editor: com
 * `enableCollaborativeEditing` ligado, ele transforma cada edição em operações,
 * manda para o servidor (`UpdateAction`) e aplica as operações que chegam de
 * volta. Este arquivo é só o encanamento: descobre a sala, abre o documento pelo
 * servidor de co-edição e mantém a conexão SignalR viva.
 *
 * Sem `VITE_SYNCFUSION_COLLAB_URL` configurada, `isCollabEnabled()` é falso e o
 * editor segue o caminho antigo (abre o arquivo direto do Nextcloud).
 * Servidor: `server/collab-editing/`.
 */

const RAW_COLLAB_URL = (import.meta.env.VITE_SYNCFUSION_COLLAB_URL as string | undefined) || '';

/** Base do serviço, sempre com barra no fim (o Syncfusion concatena direto). */
export const COLLAB_SERVICE_URL = RAW_COLLAB_URL ? `${RAW_COLLAB_URL.replace(/\/+$/, '')}/` : '';

export const isCollabEnabled = (): boolean => Boolean(COLLAB_SERVICE_URL);

/** URL base que o CollaborativeEditingHandler usa para UpdateAction/GetActionsFromServer. */
export const collabApiUrl = (): string => `${COLLAB_SERVICE_URL}api/CollaborativeEditing/`;

/**
 * Nome da sala a partir do caminho no Nextcloud. Precisa ser estável (todo mundo
 * que abre o mesmo arquivo cai na mesma sala) e curto o bastante para virar chave
 * de Redis e nome de grupo do SignalR.
 */
export async function roomNameForPath(path: string): Promise<string> {
  const normalized = path.replace(/^\/+/, '');
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `nc_${hex.slice(0, 32)}`;
}

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

export interface CollabDocument {
  version: number;
  sfdt: string;
}

/**
 * Abre o documento pelo servidor de co-edição: ele baixa o .docx do Nextcloud,
 * aplica as edições que ainda não foram gravadas no arquivo e devolve o conteúdo
 * junto da versão correspondente.
 */
export async function importCollabDocument(input: {
  roomName: string;
  filePath: string;
  fileName: string;
}): Promise<CollabDocument> {
  const token = await getAccessToken();
  const response = await fetch(`${collabApiUrl()}ImportFile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      roomName: input.roomName,
      filePath: input.filePath,
      fileName: input.fileName,
    }),
  });

  if (!response.ok) {
    throw new Error(`O serviço de co-edição respondeu ${response.status} ao abrir o documento.`);
  }

  const data = (await response.json()) as CollabDocument;
  if (!data || typeof data.sfdt !== 'string') {
    throw new Error('Resposta inválida do serviço de co-edição.');
  }
  return { version: Number(data.version) || 0, sfdt: data.sfdt };
}

export interface CollabPeer {
  connectionId: string;
  userName: string;
}

export interface CollabConnectionCallbacks {
  /** Toda mensagem do servidor: repassar direto ao applyRemoteAction do editor. */
  onData: (action: string, data: unknown) => void;
  /** Lista de quem está na sala mudou. */
  onPeersChange?: (peers: CollabPeer[]) => void;
  /** Conexão caiu de vez (não vai mais reconectar sozinha). */
  onDisconnected?: () => void;
}

export interface CollabConnection {
  /** Id desta conexão — o editor usa para ignorar as próprias operações. */
  connectionId: () => string;
  stop: () => Promise<void>;
}

/**
 * Conecta ao hub e entra na sala do documento. Reconecta sozinho e reentra na
 * sala depois de uma queda de rede.
 */
export async function connectToCollabRoom(input: {
  roomName: string;
  currentUser: string;
  callbacks: CollabConnectionCallbacks;
}): Promise<CollabConnection> {
  const { roomName, currentUser, callbacks } = input;

  const connection: HubConnection = new HubConnectionBuilder()
    .withUrl(`${COLLAB_SERVICE_URL}documenteditorhub`, {
      // O WebSocket não manda cabeçalho: o token vai por accessTokenFactory, que
      // o SignalR converte em `?access_token=` — é o que o servidor lê.
      accessTokenFactory: () => getAccessToken(),
      skipNegotiation: true,
      transport: HttpTransportType.WebSockets,
    })
    .withAutomaticReconnect()
    .build();

  let connectionId = '';
  const peers = new Map<string, string>();

  const emitPeers = () => {
    callbacks.onPeersChange?.(
      Array.from(peers.entries()).map(([id, userName]) => ({ connectionId: id, userName })),
    );
  };

  const rememberPeer = (entry: unknown) => {
    const item = entry as { connectionId?: string; currentUser?: string } | null;
    if (!item?.connectionId || item.connectionId === connectionId) return;
    peers.set(item.connectionId, item.currentUser || 'Alguém');
  };

  connection.on('dataReceived', (action: string, data: unknown) => {
    if (action === 'connectionId') {
      connectionId = String(data ?? '');
    } else if (action === 'addUser') {
      if (Array.isArray(data)) data.forEach(rememberPeer);
      else rememberPeer(data);
      emitPeers();
    } else if (action === 'removeUser') {
      peers.delete(String(data ?? ''));
      emitPeers();
    } else if (action === 'action') {
      rememberPeer(data);
      emitPeers();
    }

    // O editor precisa ver TODAS as mensagens, inclusive connectionId.
    callbacks.onData(action, data);
  });

  connection.onreconnected(() => {
    void connection.send('JoinGroup', { roomName, currentUser });
  });

  connection.onclose(() => {
    callbacks.onDisconnected?.();
  });

  await connection.start();
  await connection.send('JoinGroup', { roomName, currentUser });

  return {
    connectionId: () => connectionId,
    stop: async () => {
      peers.clear();
      try {
        await connection.stop();
      } catch {
        /* já estava caindo */
      }
    },
  };
}
