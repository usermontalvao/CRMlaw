// Presença da inbox: quem está com qual conversa aberta, ao vivo.
//
// UM canal só para a inbox inteira, e não um por conversa. Um por conversa
// pareceria mais natural, mas trocaria de canal a cada clique na lista — e quem
// atende troca de conversa dezenas de vezes por hora. Seria abrir e fechar
// socket o tempo todo para transmitir um dado minúsculo. Aqui a conversa aberta
// é só um campo do estado publicado: trocar de conversa é um `track`, não uma
// reconexão.
//
// As regras de leitura (quem sou eu, abas repetidas, entrada malformada) vivem
// em `inboxPresenceState`, sem imports e testadas à parte.
import { supabase } from '../../config/supabase';
import { readViewers, viewersByConversation, type Viewer } from './inboxPresenceState';

const CHANNEL_NAME = 'whatsapp-inbox-presence';

/** Chave desta ABA. Duas abas da mesma pessoa são duas sessões — e o agrupamento
 *  por usuário em `viewersByConversation` é que as junta de novo na hora de exibir. */
const sessionKey = `wa_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

type Listener = (byConversation: Map<string, Viewer[]>) => void;

interface Tracked {
  userId: string;
  userName: string;
  conversationId: string | null;
  since: number;
}

let channel: ReturnType<typeof supabase.channel> | null = null;
let tracked: Tracked | null = null;
let ultimo = new Map<string, Viewer[]>();
const listeners = new Set<Listener>();

function emit(): void {
  const bruto = channel ? channel.presenceState<Record<string, unknown>>() : {};
  ultimo = viewersByConversation(
    readViewers(bruto as never),
    tracked?.userId ?? null,
  );
  for (const l of listeners) {
    try { l(ultimo); } catch { /* um assinante quebrado não derruba os outros */ }
  }
}

function ensureChannel(): ReturnType<typeof supabase.channel> {
  if (channel) return channel;
  const criado = supabase.channel(CHANNEL_NAME, { config: { presence: { key: sessionKey } } });
  channel = criado;
  criado
    .on('presence', { event: 'sync' }, emit)
    .on('presence', { event: 'join' }, emit)
    .on('presence', { event: 'leave' }, emit)
    .subscribe(status => {
      // Roda também depois de cada reconexão: sem reenviar o estado local, a
      // pessoa sumiria da tela dos colegas assim que a rede oscilasse — e some
      // sem avisar é pior que nunca ter aparecido, porque o colega conclui que
      // a conversa está livre.
      if (status === 'SUBSCRIBED') {
        if (tracked) void criado.track({ ...tracked });
        emit();
      }
    });
  return criado;
}

export const inboxPresence = {
  /** Assina as mudanças. Devolve como desinscrever. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(ultimo);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.teardown();
    };
  },

  /**
   * Anuncia em que conversa este atendente está. `conversationId` nulo = está na
   * inbox sem nenhuma aberta.
   *
   * `since` só é renovado quando a CONVERSA muda: assim "há quanto tempo a Ana
   * está aqui" mede a permanência na conversa, e não o último re-render.
   */
  setViewing(conversationId: string | null, me: { id: string; name: string } | null): void {
    if (!me) { this.teardown(); return; }
    const mudouDeConversa = tracked?.conversationId !== conversationId;
    tracked = {
      userId: me.id,
      userName: me.name,
      conversationId,
      since: mudouDeConversa || !tracked ? Date.now() : tracked.since,
    };
    const ch = ensureChannel();
    void ch.track({ ...tracked });
  },

  teardown(): void {
    if (channel) { void supabase.removeChannel(channel); channel = null; }
    tracked = null;
    ultimo = new Map();
  },
};

export type { Viewer };
