// Store de silenciamento de conversas (notificações), por usuário. Fonte única
// consumida tanto pelo notificador global (leitura síncrona) quanto pela UI do
// módulo (via useSyncExternalStore). Carrega do banco e mantém-se vivo por
// realtime — sem localStorage, para não virar "módulo mentiroso".
import { supabase } from '../../config/supabase';

const MUTE_TABLE = 'whatsapp_conversation_mutes';

type Until = string | null; // null = para sempre; string ISO = até o instante
const map = new Map<string, Until>(); // conversation_id → muted_until
const listeners = new Set<() => void>();
let initialized = false;
let version = 0; // muda a cada emit → snapshot estável para useSyncExternalStore
let channel: ReturnType<typeof supabase.channel> | null = null;

function emit() { version++; listeners.forEach((l) => l()); }

export const muteStore = {
  /** true se a conversa está silenciada AGORA (considera expiração). */
  isMuted(conversationId: string): boolean {
    if (!map.has(conversationId)) return false;
    const until = map.get(conversationId)!;
    if (until === null) return true;                 // para sempre
    return new Date(until).getTime() > Date.now();   // até um instante futuro
  },

  /** Instante até o qual está silenciada (null = sempre; undefined = não silenciada). */
  mutedUntil(conversationId: string): Until | undefined {
    if (!this.isMuted(conversationId)) return undefined;
    return map.get(conversationId);
  },

  /** Assina mudanças do store (para re-render da UI). Devolve a função de desinscrição. */
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },

  /** Carrega do banco e liga o realtime uma única vez por sessão. */
  async init(): Promise<void> {
    if (initialized) return;
    initialized = true;
    await this.reload();
    channel = supabase
      .channel('wa-conversation-mutes')
      .on('postgres_changes', { event: '*', schema: 'public', table: MUTE_TABLE }, () => { void this.reload(); })
      .subscribe();
  },

  /** Recarrega o mapa do banco (RLS já limita às linhas do usuário atual). */
  async reload(): Promise<void> {
    const { data, error } = await supabase.from(MUTE_TABLE).select('conversation_id, muted_until');
    if (error) return; // silencioso: a UI continua com o último estado conhecido
    map.clear();
    for (const r of data || []) map.set(r.conversation_id as string, (r.muted_until as Until) ?? null);
    emit();
  },

  /** Atualização otimista local (antes do realtime ecoar). undefined = remover. */
  setLocal(conversationId: string, until: Until | undefined): void {
    if (until === undefined) map.delete(conversationId);
    else map.set(conversationId, until);
    emit();
  },

  /** Snapshot para useSyncExternalStore: muda a cada emit. */
  getSnapshot(): number { return version; },

  teardown(): void {
    if (channel) { void supabase.removeChannel(channel); channel = null; }
    initialized = false;
    map.clear();
  },
};
