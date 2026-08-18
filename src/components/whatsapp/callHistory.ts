// O HISTÓRICO DE LIGAÇÕES — as regras, sem tela nenhuma em volta.
//
// O que o escritório não tinha: um lugar para responder "quem ligou?". A ficha
// do cliente sabe das ligações daquele cliente e a thread sabe das daquela
// conversa; a ligação de quem ninguém abriu depois não estava em lugar algum. O
// resultado prático era o pior possível — uma chamada perdida às 9h só era
// descoberta quando a pessoa insistia à tarde, ou nunca.
//
// Duas perguntas moram aqui, e as duas são de regra, não de desenho:
//
//  1. QUEM É ESTA LIGAÇÃO? O nome do contato, o telefone, ou a admissão de que
//     não dá para saber. A terceira resposta é a que exige cuidado: uma chamada
//     endereçada por LID (o apelido interno do WhatsApp) NÃO tem telefone, e
//     escrever os dígitos do apelido com um "+" na frente foi exatamente o
//     defeito que fez o CRM mostrar "+252677908865131" no lugar de uma cliente
//     de Cuiabá. Ver `services/wacalls/phone.ts`.
//
//  2. O QUE AINDA ESTÁ EM ABERTO? Uma chamada perdida deixa de ser pendência
//     quando alguém liga de volta. Ninguém marca isso a mão — e não deveria: o
//     próprio histórico já sabe. Ver `unreturnedMissedIds`.
//
// PURO DE PROPÓSITO: nenhum import de runtime (ver o cabeçalho de
// `attendanceRouting.ts`). É o que permite testar com `node --test`.

export interface CallHistoryInput {
  id: string;
  direction: 'inbound' | 'outbound';
  outcome: 'answered' | 'missed' | 'declined' | 'failed';
  /** Telefone em dígitos. Vazio quando a chamada chegou só com o apelido. */
  phone: string;
  /** O apelido interno do WhatsApp. NUNCA é telefone. */
  peerLid?: string | null;
  /** Nome vindo da conversa, quando o CRM reconheceu o contato. */
  contactName?: string | null;
  startedAt: string;
  conversationId?: string | null;
}

/** Como o nome do contato é escrito na linha do histórico. */
export interface CallHistoryIdentity {
  /** O que aparece em destaque: o nome, o número formatado, ou a admissão. */
  title: string;
  /** `true` quando não foi possível saber de quem é — a tela mostra em itálico. */
  unknown: boolean;
  /** Dá para ligar de novo? Só com telefone de verdade em mãos. */
  callable: boolean;
}

/** O recado honesto de uma chamada que chegou só com o apelido interno. */
export const CALL_HISTORY_UNKNOWN = 'Número não identificado';

/**
 * "(65) 99612-8787" — o número como se escreve no Brasil.
 *
 * Só formata o que RECONHECE (55 + DDD + 8 ou 9 dígitos). Qualquer outra coisa
 * volta como veio: um número estrangeiro escrito com DDD brasileiro seria uma
 * mentira mais difícil de perceber do que os dígitos crus.
 */
export function formatCallPhone(phone: string | null | undefined): string {
  const d = (phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 13 && d.startsWith('55')) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith('55')) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return d;
}

/**
 * De quem é esta ligação — e dá para retornar?
 *
 * A ordem é a da confiança: o nome do contato ganha do número, e o número ganha
 * do nada. O apelido interno NÃO entra na disputa em momento nenhum: ele não
 * identifica ninguém para quem lê a tela e não pode ser discado.
 */
export function callHistoryIdentity(call: CallHistoryInput): CallHistoryIdentity {
  const digits = (call.phone || '').replace(/\D/g, '');
  // O mesmo tamanho que `toWaCallsPhone` aceita: 55 + DDD + 8/9 dígitos.
  const callable = digits.length >= 12 && digits.length <= 13;
  const nome = (call.contactName || '').trim();
  if (nome) return { title: nome, unknown: false, callable };
  if (digits) return { title: formatCallPhone(digits), unknown: false, callable };
  return { title: CALL_HISTORY_UNKNOWN, unknown: true, callable: false };
}

/**
 * Quais chamadas perdidas ainda estão em aberto.
 *
 * Uma perdida deixa de ser pendência quando alguém liga de volta — e "ligar de
 * volta" é um fato que já está no próprio histórico: uma chamada de SAÍDA para
 * o mesmo número, DEPOIS dela. Ninguém precisa marcar nada.
 *
 * Três decisões que valem a explicação:
 *
 *  · SÓ AS RECEBIDAS contam. "Sem resposta" de uma ligação nossa é uma
 *    tentativa registrada, não uma dívida — se fosse pendência, cada número que
 *    não atendeu ficaria pendurado no distintivo para sempre.
 *  · A SAÍDA VALE MESMO SE NÃO ATENDERAM. O retorno é o ato de tentar; o
 *    escritório fez a parte dele. Exigir que a pessoa atendesse deixaria a
 *    pendência de pé por algo que não está na nossa mão.
 *  · SEM TELEFONE, CONTINUA EM ABERTO. Uma chamada que chegou só com o apelido
 *    não pode ser casada com retorno nenhum — e é justamente a que mais precisa
 *    de olho, porque ninguém consegue nem discar de volta.
 */
export function unreturnedMissedIds(calls: readonly CallHistoryInput[]): Set<string> {
  const naoAtendida = (c: CallHistoryInput) => c.outcome !== 'answered';
  // Para cada número, quando saiu a última ligação NOSSA.
  const ultimoRetorno = new Map<string, number>();
  for (const c of calls) {
    if (c.direction !== 'outbound') continue;
    const d = (c.phone || '').replace(/\D/g, '');
    if (!d) continue;
    const t = Date.parse(c.startedAt);
    if (!Number.isFinite(t)) continue;
    const atual = ultimoRetorno.get(d);
    if (atual == null || t > atual) ultimoRetorno.set(d, t);
  }

  const abertas = new Set<string>();
  for (const c of calls) {
    if (c.direction !== 'inbound' || !naoAtendida(c)) continue;
    const d = (c.phone || '').replace(/\D/g, '');
    if (!d) { abertas.add(c.id); continue; }
    const t = Date.parse(c.startedAt);
    const retorno = ultimoRetorno.get(d);
    if (retorno == null || !Number.isFinite(t) || retorno < t) abertas.add(c.id);
  }
  return abertas;
}
