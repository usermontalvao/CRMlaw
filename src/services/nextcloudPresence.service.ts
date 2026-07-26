import { supabase } from '../config/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * nextcloudPresence.service
 * -----------------------------------------------------------------------------
 * "Quem está com este arquivo aberto agora" — presença REAL, em tempo real.
 *
 * Por que não uma tabela de locks com heartbeat: um lock gravado no banco só
 * some quando alguém o apaga. Se a janela do editor for fechada (ou o navegador
 * cair), o DELETE não chega e o arquivo fica marcado como "em edição" por
 * minutos — foi exatamente o problema relatado. Aqui usamos o Presence do
 * Supabase Realtime: o estado vive no websocket, então quando a aba fecha o
 * servidor emite `leave` sozinho, na hora. Fechou o documento, o aviso some.
 *
 * Um único canal por aba atende todo mundo (explorador do Nextcloud, editor,
 * widgets), com contagem de assinantes para abrir/fechar o websocket na hora
 * certa.
 */

export interface NextcloudPresenceUser {
  /** Chave única da sessão (mesmo usuário em duas abas = duas chaves). */
  key: string;
  userId: string;
  userName: string;
  /** Caminho do arquivo aberto no Nextcloud. */
  path: string;
  /** `true` enquanto a pessoa está realmente digitando no documento. */
  typing: boolean;
  /** Momento (epoch ms) em que abriu o documento. */
  since: number;
}

interface TrackedState {
  userId: string;
  userName: string;
  path: string;
  typing: boolean;
  since: number;
}

type Listener = (users: NextcloudPresenceUser[]) => void;

const CHANNEL_NAME = 'nextcloud-editing-presence';

/** Chave desta aba: identifica a SESSÃO, não o usuário (duas abas = duas). */
const sessionKey = `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

let channel: RealtimeChannel | null = null;
let tracked: TrackedState | null = null;
let users: NextcloudPresenceUser[] = [];
const listeners = new Set<Listener>();

function readPresence(): NextcloudPresenceUser[] {
  if (!channel) return [];
  const state = channel.presenceState<Record<string, unknown>>();
  const out: NextcloudPresenceUser[] = [];
  for (const [key, metas] of Object.entries(state)) {
    for (const meta of metas as Array<Record<string, unknown>>) {
      const path = typeof meta.path === 'string' ? meta.path : '';
      const userId = typeof meta.userId === 'string' ? meta.userId : '';
      if (!path || !userId) continue;
      out.push({
        key,
        userId,
        userName: (typeof meta.userName === 'string' && meta.userName) || 'Alguém',
        path,
        typing: meta.typing === true,
        since: typeof meta.since === 'number' ? meta.since : Date.now(),
      });
    }
  }
  return out;
}

function emit(): void {
  users = readPresence();
  for (const listener of listeners) {
    try { listener(users); } catch { /* um assinante quebrado não derruba os outros */ }
  }
}

function ensureChannel(): RealtimeChannel {
  if (channel) return channel;
  const created = supabase.channel(CHANNEL_NAME, { config: { presence: { key: sessionKey } } });
  channel = created;
  created
    .on('presence', { event: 'sync' }, emit)
    .on('presence', { event: 'join' }, emit)
    .on('presence', { event: 'leave' }, emit)
    .subscribe((status) => {
      // Também roda depois de cada reconexão: reenvia o estado local para não
      // "sumir" da lista dos outros quando a rede oscila.
      if (status === 'SUBSCRIBED') {
        if (tracked) void created.track({ ...tracked });
        emit();
      }
    });
  return created;
}

function teardownIfIdle(): void {
  if (listeners.size > 0 || tracked) return;
  if (!channel) return;
  const closing = channel;
  channel = null;
  users = [];
  void supabase.removeChannel(closing);
}

/**
 * Observa a presença de todos os arquivos. Chama `listener` a cada entrada,
 * saída ou mudança de estado (inclusive "digitando").
 */
export function subscribeNextcloudPresence(listener: Listener): () => void {
  listeners.add(listener);
  ensureChannel();
  // Entrega imediata do que já se sabe (evita piscar vazio na montagem).
  listener(users);
  return () => {
    listeners.delete(listener);
    teardownIfIdle();
  };
}

export interface EditingPresenceHandle {
  /** Marca/desmarca "digitando agora" (throttle interno). */
  setTyping: (typing: boolean) => void;
  /** Sai da presença deste arquivo. */
  stop: () => void;
}

let typingResetTimer: number | null = null;
let lastTypingPush = 0;

/**
 * Anuncia que o usuário atual está com `path` aberto no editor. Devolve um
 * handle para sinalizar digitação e para sair.
 */
export function startEditingPresence(input: {
  path: string;
  userId: string;
  userName: string;
}): EditingPresenceHandle {
  const state: TrackedState = {
    userId: input.userId,
    userName: input.userName,
    path: input.path,
    typing: false,
    since: Date.now(),
  };
  tracked = state;
  const active = ensureChannel();
  void active.track({ ...state });

  const push = () => {
    if (tracked !== state || !channel) return;
    void channel.track({ ...state });
  };

  const clearResetTimer = () => {
    if (typingResetTimer !== null) {
      window.clearTimeout(typingResetTimer);
      typingResetTimer = null;
    }
  };

  const setTyping = (typing: boolean) => {
    if (tracked !== state) return;
    clearResetTimer();
    if (typing) {
      // Sem digitar por 2,5s = parou de digitar (a presença continua).
      typingResetTimer = window.setTimeout(() => { setTyping(false); }, 2500);
      const now = Date.now();
      if (state.typing && now - lastTypingPush < 1500) return; // já anunciado
      lastTypingPush = now;
    }
    if (state.typing === typing) return;
    state.typing = typing;
    push();
  };

  const stop = () => {
    clearResetTimer();
    if (tracked === state) {
      tracked = null;
      if (channel) void channel.untrack();
    }
    teardownIfIdle();
  };

  return { setTyping, stop };
}
