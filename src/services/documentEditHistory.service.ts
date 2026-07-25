import { supabase } from '../config/supabase';

export type DocumentEditSource = 'petition' | 'nextcloud';
export type DocumentEditAction = 'opened' | 'saved';

export interface DocumentEditHistoryEntry {
  id: string;
  user_id: string;
  source: DocumentEditSource;
  source_key: string;
  title: string;
  client_id: string | null;
  client_name: string | null;
  nextcloud_path: string | null;
  last_action: DocumentEditAction;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export interface TouchDocumentEditHistoryInput {
  source: DocumentEditSource;
  sourceKey: string;
  title: string;
  clientId?: string | null;
  clientName?: string | null;
  nextcloudPath?: string | null;
  action: DocumentEditAction;
  activityAt?: string;
}

const HISTORY_TABLE = 'document_edit_history';
const LOCAL_STORAGE_PREFIX = 'jurius:document-edit-history:';
const LOCAL_HISTORY_LIMIT = 50;

const isHistoryTableUnavailable = (error: unknown): boolean => {
  const candidate = error as { code?: string; message?: string; details?: string };
  const code = String(candidate?.code || '').toUpperCase();
  const message = `${candidate?.message || ''} ${candidate?.details || ''}`.toLowerCase();
  return (
    code === '42P01'
    || code === 'PGRST204'
    || code === 'PGRST205'
    || message.includes(HISTORY_TABLE)
    || message.includes('schema cache')
  );
};

const safeTimestamp = (value?: string): string => {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const localKey = (userId: string) => `${LOCAL_STORAGE_PREFIX}${userId}`;

const readLocalHistory = (userId: string): DocumentEditHistoryEntry[] => {
  try {
    const raw = window.localStorage.getItem(localKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is DocumentEditHistoryEntry => (
        Boolean(entry)
        && (entry.source === 'petition' || entry.source === 'nextcloud')
        && typeof entry.source_key === 'string'
        && typeof entry.last_activity_at === 'string'
      ))
      .slice(0, LOCAL_HISTORY_LIMIT);
  } catch {
    return [];
  }
};

const writeLocalHistory = (userId: string, entries: DocumentEditHistoryEntry[]) => {
  try {
    window.localStorage.setItem(
      localKey(userId),
      JSON.stringify(entries.slice(0, LOCAL_HISTORY_LIMIT)),
    );
  } catch {
    // O histórico remoto continua sendo a fonte principal.
  }
};

const mergeHistory = (
  remote: DocumentEditHistoryEntry[],
  local: DocumentEditHistoryEntry[],
): DocumentEditHistoryEntry[] => {
  const byDocument = new Map<string, DocumentEditHistoryEntry>();
  for (const entry of [...remote, ...local]) {
    const key = `${entry.source}:${entry.source_key}`;
    const current = byDocument.get(key);
    if (
      !current
      || new Date(entry.last_activity_at).getTime() > new Date(current.last_activity_at).getTime()
    ) {
      byDocument.set(key, entry);
    }
  }
  return Array.from(byDocument.values())
    .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())
    .slice(0, LOCAL_HISTORY_LIMIT);
};

const requireUserId = async (): Promise<string> => {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error('Usuário não autenticado');
  return data.user.id;
};

export const documentEditHistoryService = {
  async list(limit = 30): Promise<DocumentEditHistoryEntry[]> {
    const userId = await requireUserId();
    const local = readLocalHistory(userId);
    const { data, error } = await supabase
      .from(HISTORY_TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('last_activity_at', { ascending: false })
      .limit(Math.max(1, Math.min(limit, LOCAL_HISTORY_LIMIT)));

    if (error) {
      if (isHistoryTableUnavailable(error)) return local.slice(0, limit);
      console.warn('Não foi possível carregar o histórico remoto de documentos:', error);
      return local.slice(0, limit);
    }

    const merged = mergeHistory((data || []) as DocumentEditHistoryEntry[], local);
    writeLocalHistory(userId, merged);
    return merged.slice(0, limit);
  },

  async touch(input: TouchDocumentEditHistoryInput): Promise<DocumentEditHistoryEntry | null> {
    const userId = await requireUserId();
    const now = safeTimestamp(input.activityAt);
    const sourceKey = String(input.sourceKey || '').trim();
    if (!sourceKey) return null;

    const localEntry: DocumentEditHistoryEntry = {
      id: `local:${input.source}:${sourceKey}`,
      user_id: userId,
      source: input.source,
      source_key: sourceKey,
      title: String(input.title || 'Documento sem título').trim() || 'Documento sem título',
      client_id: input.clientId || null,
      client_name: input.clientName?.trim() || null,
      nextcloud_path: input.nextcloudPath?.trim() || null,
      last_action: input.action,
      last_activity_at: now,
      created_at: now,
      updated_at: now,
    };

    const local = mergeHistory([localEntry], readLocalHistory(userId));
    writeLocalHistory(userId, local);

    const payload = {
      user_id: userId,
      source: input.source,
      source_key: sourceKey,
      title: localEntry.title,
      client_id: localEntry.client_id,
      client_name: localEntry.client_name,
      nextcloud_path: localEntry.nextcloud_path,
      last_action: input.action,
      last_activity_at: now,
      updated_at: now,
    };

    const { data, error } = await supabase
      .from(HISTORY_TABLE)
      .upsert(payload, { onConflict: 'user_id,source,source_key' })
      .select('*')
      .maybeSingle();

    if (error) {
      if (!isHistoryTableUnavailable(error)) {
        console.warn('Não foi possível atualizar o histórico remoto de documentos:', error);
      }
      return localEntry;
    }

    const saved = data as DocumentEditHistoryEntry | null;
    if (saved) writeLocalHistory(userId, mergeHistory([saved], local));
    return saved || localEntry;
  },

  async remove(source: DocumentEditSource, sourceKey: string): Promise<void> {
    const userId = await requireUserId();
    const nextLocal = readLocalHistory(userId).filter(
      (entry) => !(entry.source === source && entry.source_key === sourceKey),
    );
    writeLocalHistory(userId, nextLocal);

    const { error } = await supabase
      .from(HISTORY_TABLE)
      .delete()
      .eq('user_id', userId)
      .eq('source', source)
      .eq('source_key', sourceKey);

    if (error && !isHistoryTableUnavailable(error)) {
      console.warn('Não foi possível remover o item do histórico remoto:', error);
    }
  },
};

export default documentEditHistoryService;
