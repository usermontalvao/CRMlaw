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

export interface ReroutedReconnectResult {
  total: number;
  sent: number;
  failed: number;
}

/**
 * Reenvia, em ordem, as mensagens que o próprio atendente deixou presas na
 * conversa antiga quando ele escolhe outro canal.
 *
 * Primeiro todas são movidas no banco para a conversa nova e afastadas do cron;
 * só depois começam os envios. Assim, se o navegador fechar no meio, o que não
 * chegou a ser processado continua persistido e o scheduler assume pelo canal
 * novo. Cada sucesso encerra a retenção; cada falha mantém a sirene acesa.
 */
export async function sendReconnectHoldsThroughChannel(input: {
  sourceConversationId: string;
  targetConversationId: string;
  targetChannelId: string;
}): Promise<ReroutedReconnectResult> {
  const holds = await whatsappService.rerouteMyReconnectHolds(input);
  let sent = 0;
  let failed = 0;

  for (const hold of holds) {
    try {
      if (hold.type === 'text') {
        const text = hold.body?.trim();
        if (!text) throw new Error('A mensagem retida está sem texto.');
        await whatsappService.sendText({
          conversationId: input.targetConversationId,
          channelId: input.targetChannelId,
          text,
        });
      } else {
        if (!hold.storage_path) throw new Error('O arquivo da mensagem retida não está mais disponível.');
        await whatsappService.sendMedia({
          conversationId: input.targetConversationId,
          channelId: input.targetChannelId,
          type: hold.type,
          text: hold.body || undefined,
          storagePath: hold.storage_path,
          mimeType: hold.mime_type || 'application/octet-stream',
          fileName: hold.file_name || undefined,
        });
      }
      await whatsappService.completeReroutedReconnectHold(hold.id);
      sent += 1;
    } catch (error) {
      const message = String((error as Error)?.message || error || 'Falha ao reenviar pelo canal escolhido.');
      const reconnectPending = isReconnectPendingError(error);
      // Mesmo que este UPDATE encontre uma oscilação, a linha já foi movida para
      // o canal novo e ficou `pending`: o cron a recupera no prazo de segurança.
      await whatsappService
        .failReroutedReconnectHold(hold.id, message, reconnectPending)
        .catch(() => {});
      failed += 1;
    }
  }

  return { total: holds.length, sent, failed };
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
  /** Disparo de regra do CRM, não atendimento — não reabre conversa encerrada. */
  automated?: boolean;
}): Promise<ResilientSendResult> {
  try {
    const r = await whatsappService.sendText({
      conversationId: input.conversationId,
      channelId: input.channelId ?? undefined,
      text: input.text,
      replyToId: input.replyToId,
      automated: input.automated,
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
