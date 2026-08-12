/**
 * Reinício operacional do Assistente de IA do WhatsApp.
 *
 * O estado que decide se a IA pode responder fica em DUAS tabelas:
 *   - whatsapp_conversations: dono humano, transferência, status;
 *   - whatsapp_ai_sessions: memória e atividade da IA.
 *
 * As duas precisam mudar, nesta ordem. Liberar a conversa depois de reativar a
 * sessão deixaria uma janela em que a portaria ainda recusaria o próximo turno.
 */

export const WA_AI_RESET_COMMANDS = ['/clear', '/limpar', '/reiniciar', '/reset'] as const;

export const WA_AI_RESET_CONVERSATION_PATCH = {
  assigned_user_id: null,
  awaiting_accept: false,
  transfer_pending_since: null,
  status: 'open',
} as const;

export function buildWaAiResetSessionPatch(historyFrom: string) {
  return {
    summary: null,
    known_facts: {},
    pending_items: [],
    last_action: null,
    // O veredito do roteiro sai junto: um corte guardado faria a conversa
    // recomeçar já encerrada, com o agente proibido de perguntar qualquer coisa.
    triage_stage: null,
    triage_cut: null,
    triage_cut_reason: null,
    last_processed_message_id: null,
    last_customer_message_at: null,
    followup_attempts: 0,
    next_followup_at: null,
    // Reiniciar a conversa devolve o cliente ao estado de quem nunca disse
    // nada: se ele tinha pedido para parar, a recusa sai junto com o resto.
    followup_opt_out: false,
    followup_opt_out_reason: null,
    interest_checked_at: null,
    handoff_reason: null,
    handoff_summary: null,
    ended_at: null,
    ai_active: true,
    status: 'active',
    history_from: historyFrom,
    lock_token: null,
    locked_until: null,
  } as const;
}

/** Libera a conversa humana e, só então, reinicia a sessão da IA. */
export async function resetWaAiConversationState(
  admin: any,
  conversationId: string,
  historyFrom: string,
): Promise<void> {
  const { error: conversationError } = await admin.from('whatsapp_conversations')
    .update(WA_AI_RESET_CONVERSATION_PATCH)
    .eq('id', conversationId);
  if (conversationError) {
    throw new Error(`Falha ao liberar a conversa para a IA: ${conversationError.message}`);
  }

  const { error: sessionError } = await admin.from('whatsapp_ai_sessions')
    .update(buildWaAiResetSessionPatch(historyFrom))
    .eq('conversation_id', conversationId);
  if (sessionError) {
    throw new Error(`Falha ao reiniciar a memória da IA: ${sessionError.message}`);
  }
}
