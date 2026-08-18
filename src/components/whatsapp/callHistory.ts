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
//  2. O QUE EU AINDA NÃO VI? Não "o que falta fazer" — essa pergunta o CRM não
//     tem como responder sem chutar, e chutar aqui custa caro. Ver o comentário
//     de `unseenMissedCount`, que conta o erro que essa distinção corrigiu.
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
 * Quantas perdidas o operador ainda NÃO viu.
 *
 * É o distintivo da aba, e ele funciona como o do WhatsApp — nem poderia ser
 * diferente, porque quem trabalha na inbox tem o aplicativo aberto no celular
 * ao lado e lê os dois com o mesmo reflexo.
 *
 * A PRIMEIRA VERSÃO DISTO ESTAVA ERRADA e vale registrar o erro. Ela contava
 * "perdidas que ninguém retornou", inferindo o retorno de uma ligação nossa
 * posterior para o mesmo número. Duas consequências, as duas ruins:
 *
 *  · O NÚMERO NUNCA ZERAVA. Olhar não mudava nada, e um vermelho permanente no
 *    menu é um vermelho que se aprende a ignorar — aí a perdida de verdade
 *    passa batido, que é exatamente o contrário do que o aviso existe para
 *    fazer.
 *  · ELE MENTIA. A recepção retorna a chamada perdida por MENSAGEM na maioria
 *    das vezes, não ligando de volta. O CRM não via aquilo como retorno e
 *    marcava como pendente um atendimento que já tinha acontecido.
 *
 * O conserto não foi melhorar o palpite: foi parar de dar palpite. Uma chamada
 * perdida é um FATO do histórico, não uma tarefa com dono e prazo — ela fica
 * vermelha na lista para sempre, como no celular. O que o distintivo conta é
 * outra coisa, e é a única que o CRM sabe de verdade: quantas chegaram depois
 * da última vez que alguém abriu a aba.
 *
 * ATENDIDA NUNCA CONTA. Alguém falou com a pessoa; não há o que avisar.
 *
 * RECUSADA TAMBÉM NÃO. Recusar é um ato: quem recusou viu a chamada. Ela
 * continua vermelha no histórico (o contato não foi atendido), mas não é
 * novidade para ninguém.
 */
export function unseenMissedCount(
  calls: readonly CallHistoryInput[],
  seenUntil: string | null | undefined,
): number {
  const marca = seenUntil ? Date.parse(seenUntil) : NaN;
  let total = 0;
  for (const c of calls) {
    if (c.direction !== 'inbound') continue;
    if (c.outcome === 'answered' || c.outcome === 'declined') continue;
    // Sem marca (primeira vez que a inbox abre neste navegador), tudo que está
    // na lista é novidade — é o comportamento do celular recém-instalado.
    if (!Number.isFinite(marca)) { total += 1; continue; }
    const t = Date.parse(c.startedAt);
    if (Number.isFinite(t) && t > marca) total += 1;
  }
  return total;
}

/**
 * A marca de "já vi até aqui" — o instante da chamada mais recente da lista.
 *
 * É esse valor que o `unseenMissedCount` compara, e ele vem da LISTA, não do
 * relógio. Usar `Date.now()` no clique perderia uma chamada que chegou ao
 * servidor enquanto a consulta voltava: ela nasceria com horário anterior à
 * marca e nunca seria contada.
 */
export function newestCallAt(calls: readonly CallHistoryInput[]): string | null {
  let melhor: number = NaN;
  let iso: string | null = null;
  for (const c of calls) {
    const t = Date.parse(c.startedAt);
    if (!Number.isFinite(t)) continue;
    if (!Number.isFinite(melhor) || t > melhor) { melhor = t; iso = c.startedAt; }
  }
  return iso;
}
