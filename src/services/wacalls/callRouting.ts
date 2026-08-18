/**
 * Para quem o telefone toca.
 *
 * O WaCalls avisa TODOS os navegadores conectados quando uma chamada chega —
 * ele não sabe nada de responsável, de canal nem de escritório. Sem regra, o
 * resultado é o pior dos dois mundos: a recepção inteira toca ao mesmo tempo,
 * três pessoas correm para atender e o cliente conta a história de novo para
 * quem chegou por último.
 *
 * A regra segue a mesma hierarquia que a inbox já usa para as mensagens:
 *
 *   1. RESPONSÁVEL DA CONVERSA. Se a conversa foi assumida ou transferida, o
 *      dono dela é quem atende — mesmo que o canal tenha outro padrão. É a
 *      regra mais específica e por isso vem primeiro: quem transferiu a
 *      conversa esperava exatamente isso.
 *   2. PADRÃO DO CANAL (`whatsapp_instances.default_assignee_id`). O canal
 *      "Pedro" tem dono; a ligação que entra por ele toca para ele.
 *   3. NINGUÉM DEFINIDO → TOCA PARA TODOS. Uma ligação sem dono não pode ficar
 *      sem tocar em lugar nenhum.
 *
 * E três regras que existem para a ligação NÃO se perder por causa da regra:
 *
 *   4. ESCALADA. Passados alguns segundos sem ninguém atender, o convite deixa
 *      de ser exclusivo e toca para todo mundo. O dono estar escalado não
 *      significa que ele está na mesa.
 *   5. QUEM ESTÁ FALANDO NÃO É INTERROMPIDO. Já em outra chamada, o cartão
 *      aparece mas o som não toca — atender a segunda derrubaria a primeira.
 *   6. QUEM NÃO É O DONO VÊ EM SILÊNCIO. O cartão aparece para todos desde o
 *      primeiro toque, dizendo para quem está tocando; quem sabe que o dono
 *      saiu para o fórum pode atender no lugar dele sem esperar a escalada.
 *
 * PURO DE PROPÓSITO: nenhum import de runtime, como em `attendanceRouting`.
 * É o que permite testar a regra com `node --test`.
 */

/** De onde saiu o dono da chamada. */
export type CallRouteSource = 'assigned' | 'channel' | 'everyone';

export interface CallRingInput {
  /** Usuário logado NESTE navegador. */
  me: string | null;
  /** Quem deveria atender, já resolvido pela hierarquia (nulo = ninguém). */
  targetUserId: string | null;
  source: CallRouteSource;
  /** Nome de quem deveria atender, para o cartão explicar o silêncio. */
  targetName?: string | null;
  /** Contato bloqueado pelo escritório. */
  contactBlocked: boolean;
  /** Este operador já está em outra chamada. */
  imBusy: boolean;
  /** A carência já passou sem ninguém atender. */
  escalated: boolean;
}

export interface CallRoute {
  /** Toca o som neste navegador? */
  ring: boolean;
  /** Mostra o cartão neste navegador? */
  show: boolean;
  /** Frase curta que explica a decisão, mostrada no cartão. */
  label: string;
}

/** Quanto tempo a chamada fica exclusiva do dono antes de tocar para todos. */
export const CALL_ESCALATION_MS = 15_000;

export function decideCallRing(input: CallRingInput): CallRoute {
  // Contato bloqueado não toca e não aparece: o bloqueio existe justamente
  // para essa pessoa não alcançar o escritório.
  if (input.contactBlocked) {
    return { ring: false, show: false, label: 'Contato bloqueado' };
  }

  const nome = input.targetName?.trim() || 'o responsável';
  const semDono = !input.targetUserId || input.source === 'everyone';

  if (semDono) {
    return {
      ring: !input.imBusy,
      show: true,
      label: input.imBusy
        ? 'Sem responsável — você está em outra chamada'
        : 'Sem responsável definido — tocando para todos',
    };
  }

  if (input.targetUserId === input.me) {
    return {
      ring: !input.imBusy,
      show: true,
      label: input.imBusy
        ? 'É a sua chamada — você está em outra agora'
        : input.source === 'assigned'
          ? 'Você é o responsável por esta conversa'
          : 'Você é o responsável por este canal',
    };
  }

  if (!input.escalated) {
    return {
      ring: false,
      show: true,
      label: input.source === 'assigned'
        ? `Tocando para ${nome} (responsável pela conversa)`
        : `Tocando para ${nome} (responsável pelo canal)`,
    };
  }

  return {
    ring: !input.imBusy,
    show: true,
    label: input.imBusy
      ? `${nome} não atendeu — você está em outra chamada`
      : `${nome} não atendeu: a chamada foi liberada para todos`,
  };
}
