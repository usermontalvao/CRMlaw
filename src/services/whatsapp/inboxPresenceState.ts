// Quem está com qual conversa aberta — a parte pensante da presença da inbox.
//
// O problema que isto resolve é caro e silencioso: numa inbox compartilhada,
// dois atendentes abrem a mesma conversa e nenhum dos dois sabe do outro. Os
// dois leem, os dois pensam em como responder, e o cliente recebe duas
// respostas — às vezes divergentes, na frente dele. Ou o oposto, mais comum e
// pior: cada um supõe que o outro pegou, e ninguém responde.
//
// A correção é só informação: dizer, antes de digitar, que já tem gente ali.
//
// SEM IMPORTS: o formato que o Supabase Presence devolve é um mapa de chaves de
// sessão para listas de "metas", e transformar isso em "quem mais está nesta
// conversa" tem regras que valem a pena travar em teste — descartar a si mesmo,
// juntar as abas de uma mesma pessoa, ignorar entradas malformadas.

/** Um atendente presente, já normalizado. */
export interface Viewer {
  /** Chave da sessão (aba). Duas abas da mesma pessoa dão duas chaves. */
  key: string;
  userId: string;
  userName: string;
  /** Conversa aberta agora; `null` = está na inbox sem abrir nenhuma. */
  conversationId: string | null;
  /** Desde quando está nesta conversa (epoch ms) — usado para desempate. */
  since: number;
}

/** Formato cru do `presenceState()` do Supabase. */
export type RawPresenceState = Record<string, Array<Record<string, unknown>>>;

/**
 * Normaliza o estado cru em uma lista de presentes.
 *
 * Entradas sem `userId` são descartadas em silêncio: presença é dado que vem de
 * outros clientes, e um deles numa versão antiga (ou adulterado) não pode
 * derrubar o indicador de todo mundo.
 */
export function readViewers(state: RawPresenceState): Viewer[] {
  const out: Viewer[] = [];
  for (const [key, metas] of Object.entries(state ?? {})) {
    if (!Array.isArray(metas)) continue;
    for (const meta of metas) {
      if (!meta || typeof meta !== 'object') continue;
      const userId = typeof meta.userId === 'string' ? meta.userId : '';
      if (!userId) continue;
      const conversationId = typeof meta.conversationId === 'string' && meta.conversationId
        ? meta.conversationId
        : null;
      out.push({
        key,
        userId,
        userName: (typeof meta.userName === 'string' && meta.userName.trim()) || 'Outro atendente',
        conversationId,
        since: typeof meta.since === 'number' && Number.isFinite(meta.since) ? meta.since : 0,
      });
    }
  }
  return out;
}

/**
 * Agrupa por conversa, deixando de fora quem está perguntando.
 *
 * Duas regras que parecem detalhe e não são:
 *
 *  · A PRÓPRIA pessoa nunca aparece. Abrir a mesma conversa em duas abas é
 *    rotina (uma para ler o histórico, outra para responder) e avisar "você
 *    também está aqui" seria um alarme sobre nada — que ensina a ignorar o
 *    alarme quando ele for real.
 *  · Uma pessoa conta UMA vez, por mais abas que tenha. O indicador responde
 *    "quem está aqui", não "quantas janelas existem".
 *
 * Fica com a entrada mais antiga de cada pessoa: quem chegou primeiro na
 * conversa é a informação útil ("a Ana já estava aqui"), não a aba mais recente.
 */
export function viewersByConversation(
  viewers: readonly Viewer[],
  myUserId: string | null,
): Map<string, Viewer[]> {
  const porConversa = new Map<string, Map<string, Viewer>>();
  for (const v of viewers) {
    if (!v.conversationId) continue;
    if (myUserId && v.userId === myUserId) continue;
    let pessoas = porConversa.get(v.conversationId);
    if (!pessoas) { pessoas = new Map(); porConversa.set(v.conversationId, pessoas); }
    const anterior = pessoas.get(v.userId);
    if (!anterior || v.since < anterior.since) pessoas.set(v.userId, v);
  }
  const saida = new Map<string, Viewer[]>();
  for (const [convId, pessoas] of porConversa) {
    saida.set(convId, [...pessoas.values()].sort((a, b) => a.since - b.since));
  }
  return saida;
}

/** Frase do indicador. Curta de propósito: ela divide espaço com o cabeçalho. */
export function viewersLabel(viewers: readonly Viewer[]): string {
  if (viewers.length === 0) return '';
  if (viewers.length === 1) return `${viewers[0].userName} também está aqui`;
  if (viewers.length === 2) return `${viewers[0].userName} e ${viewers[1].userName} também estão aqui`;
  return `${viewers[0].userName} e mais ${viewers.length - 1} estão aqui`;
}
