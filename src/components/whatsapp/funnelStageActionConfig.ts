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
 * `destination_type` só é aceito nos dois valores que a execução sabe tratar.
 * Lixo vindo do JSONB vira `null` e a leitura cai no `type` da ação — a mesma
 * regra de `leDestino` em `funnelTransferTargets.ts`.
 *
 * Este módulo continua SEM import de runtime de propósito: é o que permite ao
 * `node --test` carregá-lo direto (ver a nota em `waPermissions.ts`).
 */
const cleanDestinationType = (value: unknown): 'department' | 'user' | null =>
  value === 'department' || value === 'user' ? value : null;

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

    // Destino: `destination_id` manda; `target` é o espelho que os leitores
    // antigos continuam consultando. Uma etapa salva antes desta separação só
    // tem `target`, e é dele que os dois passam a sair — sem inventar um
    // `destination_type`, porque o uuid sozinho não diz de qual tabela veio
    // (quem resolve isso é `leDestino`, pelo `type` da ação).
    const source = candidate as WhatsAppFunnelStageAction;
    const destinationId = cleanOptional(source.destination_id) ?? cleanOptional(source.target);
    const destinationType = cleanDestinationType(source.destination_type);
    const destinationName = cleanOptional(source.destination_name);
    const isTransfer = actionType === 'transfer_to_department' || actionType === 'transfer_to_user';

    normalized.push({
      type: actionType,
      target: destinationId,
      message: cleanOptional(source.message),
      ...(isTransfer ? {
        destination_type: destinationType,
        destination_id: destinationId,
        destination_name: destinationName,
      } : {}),
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
  // Tipo e destino discordando é o estado que o campo novo veio impedir: um
  // uuid de setor guardado como `transfer_to_user` transferiria para "ninguém"
  // e a etapa morreria em silêncio na hora H.
  if (transfer?.destination_type
    && transfer.destination_type !== (transfer.type === 'transfer_to_department' ? 'department' : 'user')) {
    errors.push('O tipo e o destino da transferência não combinam. Escolha o destino de novo.');
  }
  if (transfer && close) errors.push('A mesma etapa não pode transferir e encerrar o atendimento.');
  return errors;
}
