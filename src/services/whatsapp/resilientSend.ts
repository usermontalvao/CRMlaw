// Envio resiliente do WhatsApp: concentra, num único lugar, a inteligência de
// "auto-fila por reconexão". Quando o canal está desconectado/reconectando, o
// edge function evolution-send responde 503 sinalizando isso; em vez de perder a
// mensagem, ela é RETIDA na fila de agendadas (hold_reason='reconnect') e o
// whatsapp-scheduler reenvia automaticamente quando o canal voltar.
//
// Antes essa lógica estava duplicada (e frágil, por casar texto de erro) só no
// composer; modais e ações operacionais enviavam direto e podiam falhar sem
// entrar na fila. Aqui ela vira contrato compartilhado:
//   - isReconnectPendingError: detecção robusta (flag estruturada do backend +
//     fallback por texto, para retrocompatibilidade enquanto o edge não é
//     redeployado).
//   - enqueueReconnectHold: retém uma mensagem aguardando reconexão.
//   - sendTextResilient: envia texto e, se o canal estiver fora, retém em vez de
//     falhar — usado pelos fluxos best-effort (transferência, aceite, documentos).
import { whatsappService } from '../whatsapp.service';
import type { WhatsAppScheduledMessage } from '../../types/whatsapp.types';

// A detecção pura vive em reconnectDetection.ts (sem imports → testável); aqui só
// reexportamos para os consumidores manterem um único ponto de entrada.
export { isReconnectPendingError } from './reconnectDetection';
import { isReconnectPendingError } from './reconnectDetection';

export interface ReconnectHoldInput {
  conversationId: string;
  channelId?: string | null;
  text?: string;
  type?: WhatsAppScheduledMessage['type'];
  storagePath?: string;
  mimeType?: string;
  fileName?: string;
}

/**
 * Retém uma mensagem na fila para reenvio automático após a reconexão do canal.
 * `scheduledAt = agora` → o scheduler a pega no próximo ciclo; `hold_reason`
 * marca que é retenção automática (a UI mostra "aguardando reconexão").
 */
export function enqueueReconnectHold(input: ReconnectHoldInput): Promise<WhatsAppScheduledMessage> {
  return whatsappService.scheduleMessage({
    conversationId: input.conversationId,
    channelId: input.channelId ?? null,
    scheduledAt: new Date().toISOString(),
    text: input.text,
    type: input.type || 'text',
    storagePath: input.storagePath,
    mimeType: input.mimeType,
    fileName: input.fileName,
    holdReason: 'reconnect',
  });
}

export interface ResilientSendResult {
  /** true → o canal estava fora e a mensagem foi retida para reenvio automático. */
  queued: boolean;
  conversation_id?: string;
  message_id?: string;
  evolution_message_id?: string | null;
}

/**
 * Envia um texto de forma resiliente: se o canal estiver desconectado/reconectando,
 * retém na fila (reenvio automático) em vez de falhar. Qualquer outro erro é
 * propagado para o chamador tratar (toast/best-effort). Use nos fluxos que hoje
 * faziam `whatsappService.sendText` direto fora do composer.
 */
export async function sendTextResilient(input: {
  conversationId: string;
  channelId?: string | null;
  text: string;
  replyToId?: string;
}): Promise<ResilientSendResult> {
  try {
    const r = await whatsappService.sendText({
      conversationId: input.conversationId,
      channelId: input.channelId ?? undefined,
      text: input.text,
      replyToId: input.replyToId,
    });
    return { queued: false, ...r };
  } catch (err) {
    if (isReconnectPendingError(err)) {
      await enqueueReconnectHold({
        conversationId: input.conversationId,
        channelId: input.channelId,
        text: input.text,
        type: 'text',
      });
      return { queued: true };
    }
    throw err;
  }
}
