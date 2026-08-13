export type WaAiLifecycleTrigger = 'documents_completed' | 'signature_completed';

/**
 * Notifica o agente sobre uma mudança externa já confirmada. Best-effort: a
 * operação principal (aprovar documento/assinar) nunca é desfeita por falha do
 * WhatsApp; o erro fica explícito no log da Edge Function chamadora.
 */
export async function dispatchWaAiLifecycle(input: {
  supabaseUrl: string;
  serviceRole: string;
  conversationId: string;
  trigger: WaAiLifecycleTrigger;
  resourceId: string;
}): Promise<void> {
  if (!input.supabaseUrl || !input.serviceRole || !input.conversationId || !input.resourceId) return;
  const response = await fetch(`${input.supabaseUrl}/functions/v1/whatsapp-ai-agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.serviceRole}`,
    },
    body: JSON.stringify({
      conversation_id: input.conversationId,
      lifecycle_trigger: input.trigger,
      resource_id: input.resourceId,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`whatsapp-ai-agent lifecycle ${response.status}: ${body.slice(0, 300)}`);
  }
}
