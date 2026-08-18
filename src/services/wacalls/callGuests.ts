// O SEGUNDO ATENDENTE NA LIGAÇÃO — as regras, sem rede nem áudio em volta.
//
// Duas coisas diferentes moram aqui, e elas se parecem de propósito:
//
//  · CHAMAR ALGUÉM para a ligação ("me ajuda com este cliente"): os dois falam
//    com o cliente ao mesmo tempo, e quem atendeu continua dono do atendimento.
//  · TRANSFERIR a ligação ("isto é com você"): o outro entra do mesmo jeito,
//    mas o atendimento passa a ser dele — e quem atendeu fica mudo, de ponte.
//
// A diferença NÃO é técnica (o áudio é o mesmo caminho nos dois casos), é de
// atendimento. Por isso ela é uma regra, e não um detalhe da tela.
//
// A trava que justifica este arquivo existir: só se convida quem PODE ATENDER
// AGORA. Convidar quem está com o CRM fechado é a ligação esperando por uma
// mesa vazia com o cliente na linha — o mesmo defeito que a hierarquia de
// toque veio corrigir, agora no meio da conversa.
//
// PURO DE PROPÓSITO: nenhum import de runtime. Testável com `node --test`.

/** O que se quer do convidado. */
export type CallInviteMode = 'assist' | 'transfer';

/** Um atendente como a lista de convite precisa dele. */
export interface InvitableOperator {
  userId: string;
  name: string | null;
  /** Está em ligação neste instante? */
  busy: boolean;
}

export interface InvitableInput {
  /** Quem está online agora (a presença — ver `operatorPresence`). */
  operators: readonly InvitableOperator[];
  /** Eu, que estou na ligação. Nunca me convido. */
  me: string | null;
  /** Quem já está nesta ligação (convidado antes, ou já dentro). */
  alreadyIn?: readonly string[];
}

/**
 * Quem aparece na lista de "chamar para a ligação".
 *
 * Fora: eu mesmo, quem já está nesta chamada e quem está em OUTRA chamada —
 * este último não é uma questão de etiqueta: atender aqui derrubaria a
 * conversa que essa pessoa está tendo agora.
 *
 * Ordem: quem tem nome primeiro (a pessoa reconhece o colega pelo nome, não
 * por um id), e em ordem alfabética dentro disso — uma lista que muda de ordem
 * a cada sincronização de presença é uma lista em que se clica errado.
 */
export function invitableOperators(input: InvitableInput): InvitableOperator[] {
  const dentro = new Set(input.alreadyIn ?? []);
  return input.operators
    .filter(op => op.userId !== input.me && !dentro.has(op.userId) && !op.busy)
    .sort((a, b) => {
      if (!!a.name !== !!b.name) return a.name ? -1 : 1;
      return (a.name ?? a.userId).localeCompare(b.name ?? b.userId, 'pt-BR');
    });
}

/** Por que a lista está vazia — a tela precisa dizer, não pode só ficar branca. */
export function emptyInviteReason(input: InvitableInput): string {
  const outros = input.operators.filter(op => op.userId !== input.me);
  if (outros.length === 0) return 'Ninguém mais está com o CRM aberto agora.';
  if (outros.every(op => op.busy)) return 'Todos os atendentes online estão em ligação.';
  return 'Todos os atendentes online já estão nesta ligação.';
}

/** O nome de quem convidou, do jeito que o convite se apresenta. */
export function inviteHeadline(mode: CallInviteMode, fromName: string | null): string {
  const quem = fromName?.trim() || 'Um atendente';
  return mode === 'transfer'
    ? `${quem} quer transferir uma ligação para você`
    : `${quem} está chamando você para uma ligação`;
}

/** A frase que explica o que acontece ao aceitar. */
export function inviteExplanation(mode: CallInviteMode): string {
  return mode === 'transfer'
    ? 'Você assume o atendimento e entra na conversa com o cliente.'
    : 'Você entra na conversa com o cliente junto com quem já está na linha.';
}

/** Como a âncora se lê depois de transferir: ela continua segurando o áudio. */
export const ANCHOR_WARNING =
  'Esta janela é a ponte de áudio desta ligação: fechá-la encerra a chamada para todos.';

/** Estados possíveis do convidado, do envio até a saída. */
export type GuestStatus = 'inviting' | 'joining' | 'live' | 'declined' | 'gone' | 'failed';

export function guestStatusLabel(status: GuestStatus, name: string | null): string {
  const quem = name?.trim() || 'O atendente';
  switch (status) {
    case 'inviting': return `Chamando ${quem}…`;
    case 'joining': return `${quem} está entrando…`;
    case 'live': return `${quem} está na ligação`;
    case 'declined': return `${quem} não pôde entrar`;
    case 'failed': return `Não foi possível ligar o áudio com ${quem}`;
    default: return `${quem} saiu da ligação`;
  }
}

/** Convite velho não vale: o cliente já desligou faz tempo. */
export const INVITE_TTL_MS = 45_000;

export function inviteExpired(sentAt: number, now: number): boolean {
  return now - sentAt > INVITE_TTL_MS;
}
