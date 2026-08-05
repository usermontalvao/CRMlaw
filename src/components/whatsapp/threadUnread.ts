// Quantas mensagens chegaram "lá embaixo" enquanto se lê o histórico.
//
// É o número do balãozinho no botão de voltar ao fim da conversa. Parece uma
// contagem trivial, e não é: a mesma lista que recebe mensagens NOVAS no fim
// também recebe mensagens ANTIGAS no começo, quando o atendente rola para cima e
// o "carregar mais" traz outras 60. Contar toda mensagem recebida que ainda não
// foi vista faz essas 60 entrarem na conta — o botão anunciava "60 novas" logo
// depois de o próprio atendente pedir para ver o passado, e a seta apontava para
// baixo, onde não havia nada.
//
// Por isso a marca de "já vi" tem duas partes: os ids vistos e um PISO de
// tempo. O piso é o instante da conversa quando o atendente ainda estava no fim;
// tudo anterior a ele é passado, por mais que nunca tenha passado por esta tela.
//
// SEM IMPORTS de propósito: mantém o módulo testável direto pelo `node --test`.

/** O mínimo que a contagem precisa saber de uma mensagem. */
export interface CountableMessage {
  id: string;
  direction: string;
  wa_timestamp: string;
}

/** O que já foi visto: ids concretos e o instante até onde a leitura chegou. */
export interface SeenMark {
  ids: Set<string>;
  /** Timestamp da mensagem mais recente conhecida enquanto se estava no fim. */
  floorTs: string | null;
}

/** Marca inicial: nada visto ainda. */
export function emptySeenMark(): SeenMark {
  return { ids: new Set(), floorTs: null };
}

/**
 * Registra a lista inteira como vista e avança o piso para a mensagem mais
 * recente dela. Chamado sempre que a conversa está no fim — que é a definição
 * operacional de "o atendente está vendo o que chega".
 */
export function markAllSeen(mark: SeenMark, messages: readonly CountableMessage[]): SeenMark {
  const ids = new Set(mark.ids);
  let floorTs = mark.floorTs;
  for (const m of messages) {
    ids.add(m.id);
    // Compara como string: os timestamps são ISO/UTC, onde a ordem lexicográfica
    // é a ordem cronológica — o mesmo critério já usado para ordenar a thread.
    if (floorTs === null || m.wa_timestamp > floorTs) floorTs = m.wa_timestamp;
  }
  return { ids, floorTs };
}

/**
 * Conta o que chegou depois da marca. Só mensagens RECEBIDAS: o que o próprio
 * atendente envia já leva a tela até o fim junto com ele, e avisar "1 nova"
 * sobre a própria mensagem seria ruído.
 */
export function countNewBelow(messages: readonly CountableMessage[], mark: SeenMark): number {
  let total = 0;
  for (const m of messages) {
    if (m.direction !== 'in') continue;
    if (mark.ids.has(m.id)) continue;
    // Anterior ao piso = histórico paginado, não novidade.
    if (mark.floorTs !== null && m.wa_timestamp <= mark.floorTs) continue;
    total += 1;
  }
  return total;
}
