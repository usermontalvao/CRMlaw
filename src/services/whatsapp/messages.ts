// Camada de mensagens: leitura da thread, envio de texto/mídia, upload e edição.
import { supabase } from '../../config/supabase';
import type { WhatsAppMessage, SendMediaInput, UploadedMedia, WhatsAppDeleteScope, WaReacao } from '../../types/whatsapp.types';
import { MSG_TABLE, MEDIA_BUCKET, attachSignedUrls, invokeFn, extOf } from './shared';

/**
 * Retorno de um envio. `reopened` avisa que a conversa estava encerrada e voltou
 * a ficar aberta por causa deste envio — quem chama usa para corrigir a tela sem
 * esperar o realtime.
 */
export type SendResult = {
  conversation_id: string;
  message_id: string;
  evolution_message_id: string | null;
  reopened: boolean;
};

/**
 * Colunas da mensagem que a tela usa — explícitas de propósito, no lugar de `*`.
 *
 * Fora daqui fica `raw`, o payload cru da Evolution: nada na UI lê esse campo, e
 * ele é de longe a parte mais pesada da linha. Com `*`, abrir uma conversa
 * baixava esse peso todo por mensagem só para jogá-lo fora.
 *
 * Literal numa linha só de propósito: o supabase-js tipa o retorno a partir do
 * texto da consulta, e uma string montada em tempo de execução vira `unknown`.
 */
const MSG_COLUMNS = 'id, conversation_id, evolution_message_id, direction, type, content, media_url, media_mime, storage_path, media_size, media_sha256, file_name, media_duration_seconds, transcription_text, transcription_status, is_animated, reply_to_id, edited_at, reactions, status, sender_user_id, wa_timestamp, created_at, deleted_at, deleted_by, deleted_scope';

export const messagesApi = {
  /**
   * Mensagens de uma conversa — ou de várias, quando o mesmo contato tem thread em
   * mais de um canal do escritório.
   *
   * O WhatsApp entrega uma conversa por número nosso, então quem escreve para dois
   * dos nossos números vira duas linhas em `whatsapp_conversations` (a chave única
   * é `instance_id + remote_jid`). Para o escritório, porém, é uma pessoa só: o
   * atendimento continua o mesmo, mude o número por onde ele chegou. Recebendo a
   * lista de ids irmãos, a thread vira um histórico único ordenado no tempo.
   */
  async listMessages(
    conversationId: string | string[],
    opts?: { limit?: number; before?: string },
  ): Promise<WhatsAppMessage[]> {
    const ids = Array.isArray(conversationId) ? conversationId : [conversationId];
    if (ids.length === 0) return [];
    let q = supabase.from(MSG_TABLE).select(MSG_COLUMNS);
    q = ids.length === 1 ? q.eq('conversation_id', ids[0]) : q.in('conversation_id', ids);
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

  async sendText(params: { conversationId?: string; phone?: string; text: string; channelId?: string; replyToId?: string; automated?: boolean }): Promise<SendResult> {
    const data = await invokeFn('evolution-send', {
      conversation_id: params.conversationId,
      phone: params.phone,
      text: params.text,
      channel_id: params.channelId,
      reply_to_id: params.replyToId,
      automated: params.automated === true,
    });
    return {
      conversation_id: data.conversation_id,
      message_id: data.message_id,
      evolution_message_id: data.evolution_message_id ?? null,
      reopened: data.reopened === true,
    };
  },

  /**
   * Envia um CARTÃO DE CONTATO (vCard), não um texto com o número dentro.
   *
   * A diferença aparece do lado de lá: o cartão chega salvável na agenda com um
   * toque, com botão de ligar e de abrir conversa. O texto "o telefone do
   * perito é 65 9xxxx-xxxx" obriga a pessoa a copiar dígito por dígito — e é
   * exatamente aí que o número chega trocado e a ligação vai para outro lugar.
   *
   * O endpoint da Evolution (`/message/sendContact`) já existia e não estava
   * sendo usado por ninguém; ver `evolution-send`.
   */
  async sendContact(params: {
    conversationId?: string;
    phone?: string;
    channelId?: string;
    replyToId?: string;
    /** Um ou mais contatos. `phone` em dígitos ou com máscara — o servidor limpa. */
    contacts: Array<{ name: string; phone: string; organization?: string; email?: string }>;
  }): Promise<SendResult> {
    const data = await invokeFn('evolution-send', {
      conversation_id: params.conversationId,
      phone: params.phone,
      channel_id: params.channelId,
      type: 'contact',
      reply_to_id: params.replyToId,
      contacts: params.contacts,
    });
    return {
      conversation_id: data.conversation_id,
      message_id: data.message_id,
      evolution_message_id: data.evolution_message_id ?? null,
      reopened: data.reopened === true,
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

  async sendMedia(params: SendMediaInput): Promise<SendResult> {
    const data = await invokeFn('evolution-send', {
      conversation_id: params.conversationId,
      phone: params.phone,
      channel_id: params.channelId,
      type: params.type,
      text: params.text,
      storage_path: params.storagePath,
      mime_type: params.mimeType,
      file_name: params.fileName,
      media_size: params.mediaSize,
      reply_to_id: params.replyToId,
      as_gif: params.asGif === true,
    });
    return {
      conversation_id: data.conversation_id,
      message_id: data.message_id,
      evolution_message_id: data.evolution_message_id ?? null,
      reopened: data.reopened === true,
    };
  },

  sendImage(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'image' }); },
  sendAudio(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'audio' }); },
  sendDocument(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'document' }); },
  sendVideo(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'video' }); },
  /** GIF do seletor: sai como figurinha animada (ver `SendMediaInput.asGif`). */
  sendSticker(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'sticker' }); },

  async editMessage(messageId: string, text: string): Promise<void> {
    await invokeFn('evolution-send', { action: 'edit', message_id: messageId, text });
  },

  /**
   * Apaga a mensagem. `scope` decide o alcance:
   *  - 'me'       — some só aqui (soft delete). Serve para qualquer mensagem.
   *  - 'everyone' — revoga também no aparelho do contato. Se a Evolution recusar
   *                 (mensagem velha demais, instância fora do ar), a função NÃO
   *                 marca nada e o erro chega aqui — a tela nunca mostra
   *                 "apagada" numa mensagem que continua no celular do cliente.
   */
  async deleteMessage(messageId: string, scope: WhatsAppDeleteScope): Promise<void> {
    await invokeFn('evolution-send', { action: 'delete', message_id: messageId, scope });
  },

  /**
   * Reage (ou desfaz a reação) a uma mensagem — a reação SAI para o aparelho do
   * contato, como no aplicativo.
   *
   * `emoji` vazio remove a reação, que é exatamente o que o WhatsApp entende.
   * Quem grava a lista é a Edge Function: a reação da equipe e a que chega do
   * contato pelo webhook passam pela mesma regra, e assim as duas não podem
   * divergir. Devolve a lista já atualizada, para a bolha não precisar esperar
   * o realtime.
   */
  async reactToMessage(messageId: string, emoji: string): Promise<WaReacao[]> {
    const data = await invokeFn('evolution-send', {
      action: 'react', message_id: messageId, emoji,
    });
    return Array.isArray(data?.reactions) ? (data.reactions as WaReacao[]) : [];
  },
};
