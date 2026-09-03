/**
 * Regras de transição entre uma thread de AVISO INTERNO e um atendimento real.
 *
 * Um aviso automático pode precisar de uma conversa para guardar a mensagem,
 * mas nunca pode esconder uma thread que já era usada por gente. E a marca
 * interna não é permanente: a primeira mensagem nova, vinda do contato ou do
 * aparelho do escritório, transforma aquela thread em conversa normal.
 *
 * Módulo puro de propósito — as duas Edge Functions usam a mesma decisão e os
 * testes rodam sem carregar Deno, Supabase ou Evolution.
 */

export interface CandidatoAConversaInterna {
  internalRequested: boolean;
  existedBeforeSend: boolean;
  clientId: string | null;
  assignedUserId: string | null;
  lastCustomerMessageAt: string | null;
}

/**
 * Só uma thread realmente NOVA e sem qualquer sinal de atendimento nasce fora
 * da inbox. `client_id` sozinho não basta: colaborador não é cliente e ainda
 * assim pode ter uma conversa humana antiga, como aconteceu com a Robiane.
 */
export function deveMarcarComoConversaInterna(i: CandidatoAConversaInterna): boolean {
  return i.internalRequested
    && !i.existedBeforeSend
    && !i.clientId
    && !i.assignedUserId
    && !i.lastCustomerMessageAt;
}

/** Uma mensagem NOVA do contato prova que há atendimento naquela thread. */
export function mensagemNovaRevelaConversa(
  isInternal: boolean,
  fromMe: boolean,
  alreadyPersisted: boolean,
): boolean {
  return isInternal && !fromMe && !alreadyPersisted;
}

/** Envio feito por uma pessoa no CRM também transforma aviso em atendimento. */
export function envioHumanoRevelaConversa(
  isInternal: boolean,
  isSystem: boolean,
  hasAuthenticatedUser: boolean,
  automated: boolean,
): boolean {
  return isInternal && !isSystem && hasAuthenticatedUser && !automated;
}
