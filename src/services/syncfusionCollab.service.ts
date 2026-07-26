import { HubConnectionBuilder, HttpTransportType, type HubConnection } from '@microsoft/signalr';
import { supabase } from '../config/supabase';
import {
  CollabPeerRegistry,
  TypingBroadcastGate,
  shouldBroadcastTyping,
  type CollabPeer,
  type CollabStatus,
} from './collabPresence';

/**
 * syncfusionCollab.service
 * -----------------------------------------------------------------------------
 * Co-edição de verdade: duas pessoas digitando no MESMO documento, cada uma vendo
 * o texto da outra aparecer.
 *
 * Quem faz o trabalho pesado é o próprio Document Editor: com
 * `enableCollaborativeEditing` ligado, ele transforma cada edição em operações,
 * manda para o servidor (`UpdateAction`) e aplica as operações que chegam de
 * volta. Este arquivo é o encanamento: descobre a sala, abre o documento pelo
 * servidor de co-edição, mantém a conexão SignalR viva e — o ponto que faltava —
 * garante que as chamadas do Document Editor levem o TOKEN do CRM.
 *
 * ATENÇÃO ao ponto acima: o `CollaborativeEditingHandler` monta um XMLHttpRequest
 * na mão para `UpdateAction`/`GetActionsFromServer` e só acrescenta os cabeçalhos
 * que estiverem em `documentEditor.headers`. O serviço de co-edição exige token do
 * Supabase em `/api/CollaborativeEditing/*`. Sem esse cabeçalho, TODA operação
 * voltava 401: o WebSocket ficava conectado (o token dele vai pela query string),
 * o painel mostrava gente na sala, e nenhuma letra atravessava. Era esta a causa
 * de "aparece que a pessoa está digitando, mas o texto não chega".
 *
 * Sem `VITE_SYNCFUSION_COLLAB_URL` configurada, `isCollabEnabled()` é falso e o
 * editor segue o caminho antigo (abre o arquivo direto do Nextcloud) — que NÃO é
 * co-edição: cada navegador fica com a sua cópia.
 */

const RAW_COLLAB_URL = (import.meta.env.VITE_SYNCFUSION_COLLAB_URL as string | undefined) || '';

/** Base do serviço, sempre com barra no fim (o Syncfusion concatena direto). */
export const COLLAB_SERVICE_URL = RAW_COLLAB_URL ? `${RAW_COLLAB_URL.replace(/\/+$/, '')}/` : '';

export const isCollabEnabled = (): boolean => Boolean(COLLAB_SERVICE_URL);

/** URL base que o CollaborativeEditingHandler usa para UpdateAction/GetActionsFromServer. */
export const collabApiUrl = (): string => `${COLLAB_SERVICE_URL}api/CollaborativeEditing/`;

export type { CollabPeer, CollabStatus };

/** Ligue com `localStorage.setItem('collab-debug', '1')` para acompanhar no console. */
const debugEnabled = (): boolean => {
  try {
    return window.localStorage.getItem('collab-debug') === '1';
  } catch {
    return false;
  }
};

/**
 * Registro do que está acontecendo na co-edição. NUNCA passe caminho de arquivo,
 * conteúdo do documento ou token por aqui: a sala já é um hash e é o suficiente
 * para acompanhar o fluxo.
 */
export function collabLog(message: string, detail?: Record<string, unknown>): void {
  if (!debugEnabled()) return;
  // eslint-disable-next-line no-console
  console.info(`[coedição] ${message}`, detail ?? '');
}

// -------------------------------------------------------------------- token

/**
 * O XMLHttpRequest do Syncfusion é SÍNCRONO na hora de montar os cabeçalhos: não
 * dá para esperar um `await supabase.auth.getSession()` ali dentro. Por isso o
 * token fica em cache e é renovado pelos eventos do Supabase.
 */
let cachedAccessToken = '';
let tokenWatcherStarted = false;

async function refreshAccessToken(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    cachedAccessToken = data.session?.access_token || '';
  } catch {
    // Mantém o token anterior: derrubar o cache por uma falha de rede tiraria a
    // co-edição do ar sem necessidade.
  }
  return cachedAccessToken;
}

function ensureTokenWatcher(): void {
  if (tokenWatcherStarted) return;
  tokenWatcherStarted = true;
  void refreshAccessToken();
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedAccessToken = session?.access_token || '';
  });
}

/** Token do CRM disponível AGORA (sem await). Pode ser vazio antes do primeiro login. */
export function currentAccessToken(): string {
  ensureTokenWatcher();
  return cachedAccessToken;
}

async function getAccessToken(): Promise<string> {
  ensureTokenWatcher();
  if (cachedAccessToken) return cachedAccessToken;
  return refreshAccessToken();
}

/** Recarrega o token do CRM (usado quando o servidor devolve 401). */
export async function renewAccessToken(): Promise<string> {
  return refreshAccessToken();
}

async function authorizedFetch(path: string, body: unknown): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${collabApiUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// --------------------------------------------------------------------- sala

/**
 * Nome da sala a partir do caminho no Nextcloud. Precisa ser estável (todo mundo
 * que abre o mesmo arquivo cai na mesma sala) e curto o bastante para virar chave
 * de Redis e nome de grupo do SignalR. O servidor nunca vê o caminho legível.
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
  const response = await authorizedFetch('ImportFile', {
    roomName: input.roomName,
    filePath: input.filePath,
    fileName: input.fileName,
  });

  if (!response.ok) {
    throw new Error(`O serviço de co-edição respondeu ${response.status} ao abrir o documento.`);
  }

  const data = (await response.json()) as CollabDocument;
  if (!data || typeof data.sfdt !== 'string') {
    throw new Error('Resposta inválida do serviço de co-edição.');
  }
  collabLog('documento aberto', { room: input.roomName, version: data.version });
  return { version: Number(data.version) || 0, sfdt: data.sfdt };
}

export interface CollabSaveOutcome {
  /** Quantas operações foram aplicadas ao .docx nesta gravação. */
  operations: number;
  /** Versão da sala no momento da gravação. */
  version: number;
  /** `true` quando o arquivo foi realmente enviado ao Nextcloud. */
  uploaded: boolean;
  /** Operações que chegaram durante a gravação e continuam pendentes. */
  stillPending: number;
  savedAt: string | null;
}

/**
 * GRAVAÇÃO SOB DEMANDA — é o que o botão Salvar espera.
 *
 * O serviço aplica agora tudo o que está pendente da sala no .docx do Nextcloud e
 * só responde depois que o Nextcloud confirmou. Enquanto isso não voltar, a tela
 * NÃO pode dizer "Salvo": antes ela dizia "tudo sincronizado" sem ter pedido
 * gravação nenhuma — o arquivo só era escrito quando a última pessoa saía.
 */
export async function flushCollabRoom(input: {
  roomName: string;
  filePath?: string;
}): Promise<CollabSaveOutcome> {
  const response = await authorizedFetch('SaveToSource', {
    roomName: input.roomName,
    filePath: input.filePath,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      detail?.trim() || `O serviço de co-edição respondeu ${response.status} ao gravar o documento.`,
    );
  }

  const data = (await response.json()) as Partial<CollabSaveOutcome>;
  const outcome: CollabSaveOutcome = {
    operations: Number(data?.operations) || 0,
    version: Number(data?.version) || 0,
    uploaded: data?.uploaded === true,
    stillPending: Number(data?.stillPending) || 0,
    savedAt: typeof data?.savedAt === 'string' ? data.savedAt : null,
  };
  collabLog('gravação confirmada', {
    room: input.roomName,
    operations: outcome.operations,
    uploaded: outcome.uploaded,
    stillPending: outcome.stillPending,
  });
  return outcome;
}

/**
 * Operações que este cliente perdeu enquanto estava desconectado. Usado na
 * reconexão: sem isto o editor volta com um documento defasado e a próxima
 * edição vai para o lugar errado.
 */
export async function fetchMissedActions(input: {
  roomName: string;
  version: number;
}): Promise<unknown[]> {
  const response = await authorizedFetch('GetActionsFromServer', {
    roomName: input.roomName,
    version: input.version,
  });

  if (!response.ok) {
    throw new Error(`O serviço de co-edição respondeu ${response.status} ao recuperar as edições.`);
  }

  const text = await response.text();
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------- conexão

export interface CollabMember {
  userName: string;
  userId?: string | null;
  avatarUrl?: string | null;
}

export interface CollabConnectionCallbacks {
  /** Toda mensagem do servidor: repassar direto ao applyRemoteAction do editor. */
  onData: (action: string, data: unknown) => void;
  /** Lista de quem está na sala mudou (fonte ÚNICA de "quem edita junto"). */
  onPeersChange?: (peers: CollabPeer[]) => void;
  /** Estado da co-edição mudou. É o único sinal que autoriza dizer "sincronizado". */
  onStatusChange?: (status: CollabStatus) => void;
  /** Voltou depois de uma queda: hora de buscar o que foi perdido. */
  onReconnected?: () => void;
}

export interface CollabConnection {
  /** Id desta conexão — o editor usa para ignorar as próprias operações. */
  connectionId: () => string;
  /** Quantas OUTRAS pessoas estão na sala. */
  peerCount: () => number;
  peers: () => CollabPeer[];
  /** Avisa que este usuário está digitando (não sai com a sala vazia). */
  notifyTyping: () => void;
  stop: () => Promise<void>;
}

/**
 * Conecta ao hub e entra na sala do documento. Reconecta sozinho e reentra na
 * sala depois de uma queda de rede.
 */
export async function connectToCollabRoom(input: {
  roomName: string;
  member: CollabMember;
  callbacks: CollabConnectionCallbacks;
}): Promise<CollabConnection> {
  const { roomName, member, callbacks } = input;

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

  const registry = new CollabPeerRegistry();
  const typingGate = new TypingBroadcastGate();
  let connectionId = '';
  let stopped = false;

  const emitPeers = () => callbacks.onPeersChange?.(registry.list());

  const joinPayload = () => ({
    roomName,
    currentUser: member.userName,
    userId: member.userId ?? null,
    avatarUrl: member.avatarUrl ?? null,
  });

  connection.on('dataReceived', (action: string, data: unknown) => {
    if (action === 'connectionId') {
      connectionId = String(data ?? '');
      registry.setSelfConnectionId(connectionId);
      collabLog('conexão identificada', { room: roomName });
      emitPeers();
    } else if (action === 'addUser') {
      if (registry.add(data)) emitPeers();
    } else if (action === 'removeUser') {
      if (registry.remove(data)) emitPeers();
    } else if (action === 'typing') {
      const payload = data as { connectionId?: string; typing?: boolean } | null;
      if (registry.setTyping(payload?.connectionId, payload?.typing === true, emitPeers)) {
        emitPeers();
      }
      // O aviso de digitação NÃO é operação: nunca vai para o editor.
      return;
    } else if (action === 'action') {
      // A operação prova que a pessoa está no documento — e o aviso de digitação
      // dela pode ter se perdido. Aproveita para manter a lista viva.
      if (registry.add(data)) emitPeers();
      const remote = data as { connectionId?: string } | null;
      if (remote?.connectionId && remote.connectionId !== connectionId) {
        if (registry.setTyping(remote.connectionId, true, emitPeers)) emitPeers();
      }
      collabLog('operação recebida', {
        room: roomName,
        version: (data as { version?: number } | null)?.version,
      });
    }

    // O editor precisa ver as mensagens que ele entende, inclusive connectionId.
    callbacks.onData(action, data);
  });

  connection.onreconnecting(() => {
    if (stopped) return;
    collabLog('conexão caiu, tentando voltar', { room: roomName });
    callbacks.onStatusChange?.('reconnecting');
  });

  connection.onreconnected(async () => {
    if (stopped) return;
    registry.clear();
    emitPeers();
    try {
      await connection.send('JoinGroup', joinPayload());
      collabLog('reentrou na sala', { room: roomName });
      callbacks.onStatusChange?.('connected');
      callbacks.onReconnected?.();
    } catch {
      callbacks.onStatusChange?.('disconnected');
    }
  });

  connection.onclose(() => {
    if (stopped) return;
    collabLog('conexão encerrada pelo servidor', { room: roomName });
    registry.clear();
    emitPeers();
    callbacks.onStatusChange?.('disconnected');
  });

  callbacks.onStatusChange?.('connecting');
  await connection.start();
  await connection.send('JoinGroup', joinPayload());
  collabLog('entrou na sala', { room: roomName });
  callbacks.onStatusChange?.('connected');

  return {
    connectionId: () => connectionId,
    peerCount: () => registry.count(),
    peers: () => registry.list(),
    notifyTyping: () => {
      // Sozinho na sala: nada é transmitido. Ver `shouldBroadcastTyping`.
      if (!shouldBroadcastTyping(registry.count())) return;
      if (!typingGate.shouldSend(registry.count())) return;
      void connection.send('Typing', roomName, true).catch(() => {
        /* aviso de digitação não vale uma exceção na tela */
      });
    },
    stop: async () => {
      stopped = true;
      registry.clear();
      typingGate.reset();
      callbacks.onPeersChange?.([]);
      callbacks.onStatusChange?.('off');
      try {
        await connection.stop();
      } catch {
        /* já estava caindo */
      }
    },
  };
}
