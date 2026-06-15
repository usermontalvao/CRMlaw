// Camada de mensagens: leitura da thread, envio de texto/mídia, upload e edição.
import { supabase } from '../../config/supabase';
import type { WhatsAppMessage, SendMediaInput, UploadedMedia } from '../../types/whatsapp.types';
import { MSG_TABLE, MEDIA_BUCKET, attachSignedUrls, invokeFn, extOf } from './shared';

export const messagesApi = {
  async listMessages(
    conversationId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<WhatsAppMessage[]> {
    let q = supabase.from(MSG_TABLE).select('*').eq('conversation_id', conversationId);
    if (opts?.before) q = q.lt('wa_timestamp', opts.before);
    const limit = opts?.limit ?? 0;
    if (limit > 0) {
      // Busca os N mais recentes em ordem DESC, depois inverte para exibição ASC.
      q = q.order('wa_timestamp', { ascending: false }).limit(limit);
    } else {
      q = q.order('wa_timestamp', { ascending: true });
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const msgs = (data || []) as WhatsAppMessage[];
    if (limit > 0) msgs.reverse();
    await attachSignedUrls(msgs);
    return msgs;
  },

  async sendText(params: { conversationId?: string; phone?: string; text: string; channelId?: string; replyToId?: string }): Promise<{ conversation_id: string; message_id: string; evolution_message_id: string | null }> {
    const data = await invokeFn('evolution-send', {
      conversation_id: params.conversationId,
      phone: params.phone,
      text: params.text,
      channel_id: params.channelId,
      reply_to_id: params.replyToId,
    });
    return {
      conversation_id: data.conversation_id,
      message_id: data.message_id,
      evolution_message_id: data.evolution_message_id ?? null,
    };
  },

  /** Faz upload do arquivo para o bucket privado e devolve os metadados. */
  async uploadMedia(file: File | Blob, opts: { conversationId?: string; fileName?: string }): Promise<UploadedMedia> {
    const name = opts.fileName || (file as File).name || 'arquivo';
    const mime = file.type || 'application/octet-stream';
    const ext = extOf(name, mime);
    const id = (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const path = `out/${opts.conversationId || 'new'}/${id}.${ext}`;
    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
      contentType: mime, upsert: true,
    });
    if (error) throw new Error(error.message);
    return { storagePath: path, mimeType: mime, fileName: name, size: (file as File).size ?? (file as Blob).size ?? 0 };
  },

  async sendMedia(params: SendMediaInput): Promise<{ conversation_id: string; message_id: string; evolution_message_id: string | null }> {
    const data = await invokeFn('evolution-send', {
      conversation_id: params.conversationId,
      phone: params.phone,
      channel_id: params.channelId,
      type: params.type,
      text: params.text,
      storage_path: params.storagePath,
      mime_type: params.mimeType,
      file_name: params.fileName,
      reply_to_id: params.replyToId,
    });
    return {
      conversation_id: data.conversation_id,
      message_id: data.message_id,
      evolution_message_id: data.evolution_message_id ?? null,
    };
  },

  sendImage(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'image' }); },
  sendAudio(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'audio' }); },
  sendDocument(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'document' }); },
  sendVideo(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'video' }); },

  async editMessage(messageId: string, text: string): Promise<void> {
    await invokeFn('evolution-send', { action: 'edit', message_id: messageId, text });
  },
};
