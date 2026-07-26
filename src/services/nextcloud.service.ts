import { supabase } from '../config/supabase';
import { toEntityTag } from '../utils/entityTag';

/**
 * nextcloud.service
 * -----------------------------------------------------------------------------
 * Camada fina do front que conversa com a Edge Function `nextcloud-proxy`.
 * Nunca fala direto com o Nextcloud (CORS + credencial). Todo acesso passa aqui.
 *
 * `path` é sempre relativo à raiz do usuário configurado no Nextcloud.
 */

export interface NextcloudEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mime: string;
  mtime: string | null;
}

/** Evento de mudança de arquivo no Nextcloud, entregue via Realtime. */
export interface NextcloudChangeEvent {
  id: string;
  eventClass: string;
  actorUid: string | null;
  actorName: string | null;
  nodePath: string | null;
  sourcePath: string | null;
  targetPath: string | null;
  affectedDirectory: string | null;
  nodeId: number | null;
  createdAt: string;
}

type NextcloudErrorPayload = {
  error?: string;
  detail?: string;
  code?: string;
};

export class NextcloudServiceError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'NextcloudServiceError';
  }
}

/** Lançado quando o servidor rejeita um PUT com If-Match (412): a versão
 *  remota mudou desde que o cliente leu o ETag. A UI oferece recarregar,
 *  salvar cópia ou cancelar. */
export class NextcloudConflictError extends NextcloudServiceError {
  constructor(message = 'A versão no servidor mudou desde que você abriu o arquivo.') {
    super(message, 412, 'version_conflict');
    this.name = 'NextcloudConflictError';
  }
}

const upstreamStatusFrom = (message: string): number | undefined => {
  const match = message.match(/\((\d{3})\)/);
  return match ? Number(match[1]) : undefined;
};

function friendlyNextcloudMessage(
  status: number | undefined,
  serverMessage = '',
  operation = 'concluir a operação',
): string {
  const upstreamStatus = upstreamStatusFrom(serverMessage);
  const effectiveStatus = upstreamStatus ?? status;

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'Você está sem conexão com a internet. Verifique a rede e tente novamente.';
  }

  switch (effectiveStatus) {
    case 400:
      return `Não foi possível ${operation} porque os dados enviados são inválidos. Atualize a página e tente novamente.`;
    case 401:
      return 'Sua sessão expirou ou a conexão com o Nextcloud precisa ser autenticada novamente. Entre novamente e repita a operação.';
    case 403:
      return `Você não tem permissão para ${operation} neste local do Nextcloud.`;
    case 404:
      return 'A pasta ou o arquivo solicitado não existe mais. Atualize a lista e tente novamente.';
    case 405:
    case 501:
      return 'Este servidor Nextcloud não oferece suporte a esse tipo de pesquisa.';
    case 408:
    case 504:
      return 'O Nextcloud demorou demais para responder. Tente novamente em alguns instantes ou pesquise em uma pasta mais específica.';
    case 413:
      return 'A solicitação é grande demais para ser processada pelo servidor.';
    case 429:
      return 'Foram feitas muitas solicitações ao Nextcloud. Aguarde alguns segundos e tente novamente.';
    case 500:
      return `O serviço encontrou um erro interno ao tentar ${operation}. Tente novamente em alguns instantes.`;
    case 502:
    case 503:
      return 'O Nextcloud está temporariamente indisponível. Verifique a conexão com o servidor e tente novamente.';
    default:
      break;
  }

  const normalized = serverMessage.toLocaleLowerCase('pt-BR');
  if (
    normalized.includes('failed to fetch')
    || normalized.includes('networkerror')
    || normalized.includes('fetch failed')
  ) {
    return 'Não foi possível conectar ao Nextcloud. Verifique sua internet e a disponibilidade do servidor.';
  }

  if (
    !serverMessage
    || normalized.includes('edge function returned')
    || normalized.includes('non-2xx')
  ) {
    return `Não foi possível ${operation} no Nextcloud. Tente novamente em alguns instantes.`;
  }

  return serverMessage;
}

async function normalizeInvokeError(error: unknown, operation?: string): Promise<NextcloudServiceError> {
  const functionError = error as {
    message?: string;
    context?: Response;
  };
  const response = functionError?.context;
  let payload: NextcloudErrorPayload | null = null;

  if (response && typeof response.clone === 'function') {
    try {
      payload = await response.clone().json() as NextcloudErrorPayload;
    } catch {
      // A Edge Function pode devolver texto ou uma resposta vazia.
    }
  }

  const rawMessage = payload?.error || functionError?.message || '';
  return new NextcloudServiceError(
    friendlyNextcloudMessage(response?.status, rawMessage, operation),
    response?.status,
    payload?.code,
  );
}

/** Converte falhas técnicas do proxy em texto seguro e compreensível para a interface. */
export function getNextcloudErrorMessage(
  error: unknown,
  operation = 'concluir a operação',
): string {
  if (error instanceof NextcloudServiceError) return error.message;
  const message = error instanceof Error ? error.message : '';
  return friendlyNextcloudMessage(undefined, message, operation);
}

async function invoke<T>(payload: Record<string, unknown>, operation?: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke('nextcloud-proxy', { body: payload });
  if (error) throw await normalizeInvokeError(error, operation);
  if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
    throw new NextcloudServiceError(
      friendlyNextcloudMessage(undefined, String((data as { error: string }).error), operation),
    );
  }
  return data as T;
}

// --- base64 -> Blob (leitura: o proxy devolve binário como base64 em JSON) ---
// O UPLOAD não usa mais base64: `writeFile` envia o blob cru (octet-stream).

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export const nextcloudService = {
  /** Testa a conexão com o servidor. Retorna a raiz DAV resolvida. */
  async ping(): Promise<{ ok: boolean; root?: string }> {
    return invoke({ action: 'ping' });
  },

  /** Lista pastas e arquivos de um diretório (não recursivo). */
  async list(path = ''): Promise<NextcloudEntry[]> {
    const { entries } = await invoke<{ entries: NextcloudEntry[] }>({ action: 'list', path });
    return entries;
  },

  /** Busca recursiva por nome a partir de `path` (raiz = tudo). Windows-like:
   *  encontra pastas e arquivos em qualquer subpasta. */
  async search(query: string, path = ''): Promise<NextcloudEntry[]> {
    const { entries } = await invoke<{ entries: NextcloudEntry[] }>(
      { action: 'search', query, path },
      'pesquisar arquivos e pastas',
    );
    return entries;
  },

  /** Baixa um arquivo como Blob (para abrir num editor do CRM). O proxy já
   *  envia headers no-cache; uma reabertura logo após um PUT lê a versão nova. */
  async readFile(path: string): Promise<Blob> {
    const { base64, mime } = await invoke<{ base64: string; mime: string }>({ action: 'read', path });
    return base64ToBlob(base64, mime);
  },

  /** Metadados de um arquivo (existe? tamanho, etag, mtime). `exists:false`
   *  quando o arquivo não está no servidor. */
  async stat(path: string): Promise<{ exists: boolean; size?: number; etag?: string | null; mtime?: string | null }> {
    return invoke({ action: 'stat', path });
  },

  /** Grava/sobrescreve um arquivo no Nextcloud (salvar a versão editada).
   *  Retorna o que o servidor confirmou (bytes recebidos + etag do PUT). */
  async writeFile(
    path: string,
    blob: Blob,
    opts: { ifMatch?: string | null } = {},
  ): Promise<{ ok: boolean; sentBytes?: number; etag?: string | null }> {
    // Envia o arquivo CRU (binário) via função dedicada `nextcloud-upload` —
    // sem base64. supabase-js manda o Blob como application/octet-stream; a
    // função faz o PUT direto. O caminho vai percent-encoded no header (headers
    // só aceitam ASCII; pastas podem ter acento).
    //
    // `ifMatch`: quando informado, o servidor recusa com 412 se a versão remota
    // mudou (controle de concorrência otimista). Traduzimos para NextcloudConflictError.
    const headers: Record<string, string> = {
      'x-nc-path': encodeURIComponent(path),
      'x-nc-mime': blob.type || 'application/octet-stream',
    };
    // O ETag guardado vem SEM aspas do proxy; o If-Match exige uma entity-tag
    // (`"abc"`). Mandar o valor cru fazia o servidor responder 412 sempre.
    const ifMatchHeader = toEntityTag(opts.ifMatch);
    if (ifMatchHeader) headers['If-Match'] = ifMatchHeader;

    const { data, error } = await supabase.functions.invoke('nextcloud-upload', {
      body: blob,
      headers,
    });
    if (error) {
      const status = (error as { context?: Response }).context?.status;
      if (status === 412) throw new NextcloudConflictError();
      throw await normalizeInvokeError(error, 'salvar o arquivo');
    }
    if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
      const code = String((data as { error: string }).error);
      if (code === 'version_conflict') throw new NextcloudConflictError();
      throw new NextcloudServiceError(friendlyNextcloudMessage(undefined, code, 'salvar o arquivo'));
    }
    return data as { ok: boolean; sentBytes?: number; etag?: string | null };
  },

  /** Upload com PROGRESSO REAL e CANCELAMENTO. Usa XMLHttpRequest direto na
   *  Edge Function (o `functions.invoke` não expõe progresso nem aborto).
   *  `onProgress(loaded, total)` reporta bytes enviados; `signal` cancela.
   *  Lança NextcloudConflictError em 412 e AbortError quando cancelado. */
  async writeFileWithProgress(
    path: string,
    blob: Blob,
    opts: {
      ifMatch?: string | null;
      onProgress?: (loaded: number, total: number) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<{ ok: boolean; sentBytes?: number; etag?: string | null }> {
    const baseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!baseUrl || !anon) throw new NextcloudServiceError('Supabase não configurado no cliente.', 500);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new NextcloudServiceError('Sua sessão expirou. Entre novamente para enviar arquivos.', 401);

    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${baseUrl.replace(/\/+$/, '')}/functions/v1/nextcloud-upload`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', anon);
      xhr.setRequestHeader('x-nc-path', encodeURIComponent(path));
      xhr.setRequestHeader('x-nc-mime', blob.type || 'application/octet-stream');
      const ifMatchHeader = toEntityTag(opts.ifMatch);
      if (ifMatchHeader) xhr.setRequestHeader('If-Match', ifMatchHeader);

      const onAbort = () => xhr.abort();
      if (opts.signal) opts.signal.addEventListener('abort', onAbort);
      const cleanup = () => { if (opts.signal) opts.signal.removeEventListener('abort', onAbort); };

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) opts.onProgress?.(event.loaded, event.total);
      };
      xhr.onabort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
      xhr.onerror = () => { cleanup(); reject(new NextcloudServiceError('Falha de rede ao enviar o arquivo.')); };
      xhr.onload = () => {
        cleanup();
        if (xhr.status === 412) { reject(new NextcloudConflictError()); return; }
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ ok: true }); }
          return;
        }
        let serverMsg = '';
        try { serverMsg = String(JSON.parse(xhr.responseText).error ?? ''); } catch { /* corpo não-JSON */ }
        reject(new NextcloudServiceError(
          friendlyNextcloudMessage(xhr.status, serverMsg, 'enviar o arquivo'),
          xhr.status,
        ));
      };
      xhr.send(blob);
    });
  },

  /** Grava e CONFIRMA a persistência relendo os metadados do servidor. Só
   *  resolve se o Nextcloud reporta o arquivo com o tamanho exato que foi
   *  enviado — caso contrário lança (nunca devolve um "salvo" falso). Retorna
   *  o etag/tamanho remotos confirmados. */
  async writeFileVerified(
    path: string,
    blob: Blob,
    opts: { ifMatch?: string | null } = {},
  ): Promise<{ size: number; etag: string | null }> {
    const expectedSize = blob.size;
    if (!expectedSize) {
      throw new Error('Documento exportado está vazio (0 bytes) — nada foi enviado ao Nextcloud.');
    }

    const put = await this.writeFile(path, blob, opts);
    if (put && typeof put.sentBytes === 'number' && put.sentBytes !== expectedSize) {
      throw new Error(
        `O proxy recebeu ${put.sentBytes} bytes, mas o documento exportado tem ${expectedSize}. Envio corrompido.`,
      );
    }

    // Verificação real: relê o arquivo no servidor e compara o tamanho.
    const remote = await this.stat(path);
    if (!remote.exists) {
      throw new Error('Após o PUT o arquivo não foi encontrado no Nextcloud (gravação não persistiu).');
    }
    if (typeof remote.size === 'number' && remote.size !== expectedSize) {
      throw new Error(
        `Versão remota tem ${remote.size} bytes, mas o documento salvo tem ${expectedSize}. A gravação não foi confirmada.`,
      );
    }

    return { size: remote.size ?? expectedSize, etag: remote.etag ?? put?.etag ?? null };
  },

  /** Cria uma pasta (idempotente). */
  async makeFolder(path: string): Promise<void> {
    await invoke({ action: 'mkcol', path });
  },

  /** Apaga um arquivo ou pasta. */
  async remove(path: string): Promise<void> {
    await invoke({ action: 'delete', path });
  },

  /** Move ou renomeia (path -> destination, ambos relativos à raiz). */
  async move(path: string, destination: string): Promise<void> {
    await invoke({ action: 'move', path, destination });
  },

  /** Copia um arquivo ou pasta (path -> destination, ambos relativos à raiz). */
  async copy(path: string, destination: string): Promise<void> {
    await invoke({ action: 'copy', path, destination });
  },

  // --- Versões (Nextcloud Versions app) --------------------------------------

  /** Lista as versões de um arquivo (mais recentes primeiro). Vazio se o app
   *  de versões não guardou nenhuma ainda. */
  async listVersions(path: string): Promise<Array<{ id: string; label: string; size: number; mtime: string | null }>> {
    const { versions } = await invoke<{ versions: Array<{ id: string; size: number; mtime: string | null }> }>({
      action: 'versions', path,
    });
    return (versions || []).map((v) => ({
      id: v.id,
      size: v.size,
      mtime: v.mtime,
      // O id é o timestamp unix (segundos) em que a versão foi criada.
      label: v.mtime || (Number(v.id) ? new Date(Number(v.id) * 1000).toLocaleString('pt-BR') : v.id),
    }));
  },

  /** Restaura uma versão anterior (a atual passa a ser mais uma versão). */
  async restoreVersion(path: string, versionId: string): Promise<void> {
    await invoke({ action: 'restoreVersion', path, versionId });
  },

  /** Baixa o conteúdo de uma versão específica (para preview/download). */
  async readVersion(path: string, versionId: string): Promise<Blob> {
    const { base64, mime } = await invoke<{ base64: string; mime: string }>({ action: 'readVersion', path, versionId });
    return base64ToBlob(base64, mime);
  },

  // --- Vínculo pasta -> cliente (metadado no Supabase) -----------------------

  /** Retorna um mapa { path -> client_id } de todos os vínculos. */
  async getFolderLinks(): Promise<Record<string, string>> {
    const { data, error } = await supabase
      .from('nextcloud_folder_links')
      .select('path, client_id');
    if (error) throw new Error(error.message);
    const map: Record<string, string> = {};
    for (const row of data || []) map[(row as { path: string }).path] = (row as { client_id: string }).client_id;
    return map;
  },

  /** Vincula (ou atualiza) uma pasta a um cliente. */
  async linkFolder(path: string, clientId: string): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('nextcloud_folder_links')
      .upsert({ path, client_id: clientId, created_by: userData?.user?.id ?? null }, { onConflict: 'path' });
    if (error) throw new Error(error.message);
  },

  /** Remove o vínculo de uma pasta. */
  async unlinkFolder(path: string): Promise<void> {
    const { error } = await supabase.from('nextcloud_folder_links').delete().eq('path', path);
    if (error) throw new Error(error.message);
  },

  // A presença de edição ("quem está editando agora") saiu daqui: virou
  // `nextcloudPresence.service`, sobre o Presence do Supabase Realtime. A
  // tabela `nextcloud_file_locks` (heartbeat) não é mais usada — ela mantinha
  // o aviso na tela depois de o documento já ter sido fechado.

  /** Assina eventos de mudança de arquivos vindos do Nextcloud (via webhook ->
   *  Edge Function nextcloud-webhook -> nextcloud_change_events -> Realtime).
   *  Independente de `subscribeLocks`. Retorna uma função de unsubscribe. */
  subscribeFileChanges(onChange: (evt: NextcloudChangeEvent) => void): () => void {
    const channel = supabase
      .channel('nextcloud-change-events')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'nextcloud_change_events' },
        (payload) => {
          const row = (payload.new ?? {}) as Record<string, unknown>;
          onChange({
            id: String(row.id ?? ''),
            eventClass: String(row.event_class ?? ''),
            actorUid: (row.actor_uid as string | null) ?? null,
            actorName: (row.actor_name as string | null) ?? null,
            nodePath: (row.node_path as string | null) ?? null,
            sourcePath: (row.source_path as string | null) ?? null,
            targetPath: (row.target_path as string | null) ?? null,
            affectedDirectory: (row.affected_directory as string | null) ?? null,
            nodeId: typeof row.node_id === 'number' ? row.node_id : null,
            createdAt: String(row.created_at ?? ''),
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  },
};

export default nextcloudService;
