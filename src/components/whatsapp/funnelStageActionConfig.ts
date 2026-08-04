import type {
  WhatsAppFunnelStageAction, WhatsAppFunnelStageActionType,
} from '../../types/whatsapp.types';

const SUPPORTED = new Set<WhatsAppFunnelStageActionType>([
  'send_message', 'transfer_to_department', 'transfer_to_user', 'close_conversation',
]);

const ACTION_ORDER: Record<WhatsAppFunnelStageActionType, number> = {
  send_message: 10,
  transfer_to_department: 20,
  transfer_to_user: 20,
  close_conversation: 30,
};

const cleanOptional = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
};

/**
 * Sanitiza a configuração vinda do JSONB e fixa uma ordem operacional segura:
 * mensagem → transferência → encerramento. Mantém no máximo uma
 * transferência, pois dois destinos para a mesma entrada seriam ambíguos.
 */
export function normalizeFunnelStageActions(raw: unknown): WhatsAppFunnelStageAction[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const normalized: WhatsAppFunnelStageAction[] = [];

  for (const candidate of raw) {
    if (!candidate || typeof candidate !== 'object') continue;
    const type = (candidate as { type?: unknown }).type;
    if (typeof type !== 'string' || !SUPPORTED.has(type as WhatsAppFunnelStageActionType)) continue;
    const actionType = type as WhatsAppFunnelStageActionType;
    const uniquenessKey = actionType.startsWith('transfer_to_') ? 'transfer' : actionType;
    if (seen.has(uniquenessKey)) continue;
    seen.add(uniquenessKey);

    const payloadRaw = (candidate as WhatsAppFunnelStageAction).payload;
    const reason = cleanOptional(payloadRaw?.reason);
    const note = cleanOptional(payloadRaw?.note);
    const payload = reason || note ? { ...(reason ? { reason } : {}), ...(note ? { note } : {}) } : undefined;

    normalized.push({
      type: actionType,
      target: cleanOptional((candidate as WhatsAppFunnelStageAction).target),
      message: cleanOptional((candidate as WhatsAppFunnelStageAction).message),
      ...(payload ? { payload } : {}),
    });
  }

  return normalized.sort((left, right) => ACTION_ORDER[left.type] - ACTION_ORDER[right.type]);
}

/** Retorna mensagens prontas para a UI; array vazio significa configuração válida. */
export function validateFunnelStageActions(raw: unknown): string[] {
  const actions = normalizeFunnelStageActions(raw);
  const errors: string[] = [];
  const send = actions.find(action => action.type === 'send_message');
  const transfer = actions.find(action => action.type === 'transfer_to_department' || action.type === 'transfer_to_user');
  const close = actions.find(action => action.type === 'close_conversation');

  if (send && !send.message) errors.push('Escreva a mensagem automática da etapa.');
  if (transfer && !transfer.target) errors.push('Escolha o destino da transferência automática.');
  if (transfer && close) errors.push('A mesma etapa não pode transferir e encerrar o atendimento.');
  return errors;
}
