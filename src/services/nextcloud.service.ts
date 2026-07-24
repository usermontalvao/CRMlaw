import { supabase } from '../config/supabase';

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

async function invoke<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('nextcloud-proxy', { body: payload });
  if (error) throw new Error(error.message);
  if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
    throw new Error(String((data as { error: string }).error));
  }
  return data as T;
}

// --- base64 <-> Blob (o proxy trafega binário como base64 em JSON) -----------

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.split(',')[1] || ''); // remove o prefixo data:...;base64,
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

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
    const { entries } = await invoke<{ entries: NextcloudEntry[] }>({ action: 'search', query, path });
    return entries;
  },

  /** Baixa um arquivo como Blob (para abrir num editor do CRM). */
  async readFile(path: string): Promise<Blob> {
    const { base64, mime } = await invoke<{ base64: string; mime: string }>({ action: 'read', path });
    return base64ToBlob(base64, mime);
  },

  /** Grava/sobrescreve um arquivo no Nextcloud (salvar a versão editada). */
  async writeFile(path: string, blob: Blob): Promise<void> {
    const base64 = await blobToBase64(blob);
    await invoke({ action: 'write', path, base64, mime: blob.type || 'application/octet-stream' });
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

  // --- Presença de edição ("quem está editando") ----------------------------

  /** Registra/renova que o usuário atual está editando `path`. Chame ao abrir
   *  o documento no editor e periodicamente (heartbeat). */
  async heartbeatLock(path: string, userName: string): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return;
    await supabase
      .from('nextcloud_file_locks')
      .upsert({ path, user_id: userId, user_name: userName, updated_at: new Date().toISOString() }, { onConflict: 'path,user_id' });
  },

  /** Libera o lock do usuário atual sobre `path` (ao fechar/salvar/sair). */
  async releaseLock(path: string): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return;
    await supabase.from('nextcloud_file_locks').delete().eq('path', path).eq('user_id', userId);
  },

  /** Lista todos os locks ativos (não expirados). `staleMs` descarta locks
   *  cujo heartbeat parou (ex.: aba fechada sem liberar). */
  async listLocks(staleMs = 120_000): Promise<Array<{ path: string; user_id: string; user_name: string | null }>> {
    const { data, error } = await supabase
      .from('nextcloud_file_locks')
      .select('path, user_id, user_name, updated_at');
    if (error) throw new Error(error.message);
    const cutoff = Date.now() - staleMs;
    return (data || [])
      .filter((r) => new Date((r as { updated_at: string }).updated_at).getTime() >= cutoff)
      .map((r) => ({
        path: (r as { path: string }).path,
        user_id: (r as { user_id: string }).user_id,
        user_name: (r as { user_name: string | null }).user_name,
      }));
  },

  /** Assina mudanças na tabela de locks (realtime). Retorna uma função para
   *  cancelar a inscrição. */
  subscribeLocks(onChange: () => void): () => void {
    const channel = supabase
      .channel('nextcloud-file-locks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nextcloud_file_locks' }, onChange)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  },
};

export default nextcloudService;
