import { supabase } from '../config/supabase';
import type { ChatMessage, ChatRoom, ChatReaction } from '../types/chat.types';
import { userNotificationService } from './userNotification.service';

const ATTACHMENT_PREFIX = '__anexo__:';

const toTitleCase = (value: string) =>
  value.toLowerCase().replace(/\b\w/g, (letter: string) => letter.toUpperCase());

export function buildPortalFarewellMessage(clientName?: string | null): string {
  const firstName = toTitleCase(clientName || 'Cliente').split(' ')[0];
  return `Sr.(a) ${firstName}, agradecemos seu contato. Este atendimento foi encerrado. Caso precise de mais informações, utilize o botão "Iniciar nova conversa". Estamos à disposição.`;
}

class ChatService {
  private roomsTable = 'chat_rooms';
  private membersTable = 'chat_room_members';
  private messagesTable = 'chat_messages';

  /** Cria notificações in-app para destinatários: DM sempre, sala só em @menção. */
  private async notifyRecipients(message: ChatMessage): Promise<void> {
    try {
      const [{ data: room }, memberIds] = await Promise.all([
        supabase.from(this.roomsTable).select('id, name, type').eq('id', message.room_id).single(),
        this.getRoomMembers(message.room_id),
      ]);
      if (!room) return;

      const recipients = memberIds.filter((uid) => uid && uid !== message.user_id);
      if (recipients.length === 0) return;

      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, name')
        .in('user_id', [...recipients, message.user_id]);
      const nameByUser = new Map((profiles ?? []).map((p: any) => [p.user_id, p.name as string]));
      const senderName = nameByUser.get(message.user_id) || 'Alguém';

      // Preview do conteúdo
      let preview: string;
      if (message.content.startsWith(ATTACHMENT_PREFIX)) {
        try {
          const meta = JSON.parse(message.content.slice(ATTACHMENT_PREFIX.length));
          const mime = String(meta?.mimeType || '');
          preview = mime.startsWith('image/') ? '📷 Enviou uma imagem'
            : mime.startsWith('audio/') ? '🎤 Enviou um áudio'
            : '📎 Enviou um anexo';
        } catch { preview = '📎 Enviou um anexo'; }
      } else {
        preview = message.content.length > 120 ? message.content.slice(0, 120) + '…' : message.content;
      }

      // @menções: casa nome (ou primeiro nome) dos membros
      const mentioned = new Set<string>();
      const mentionRegex = /@([A-Za-zÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ]+)*)/g;
      const tokens: string[] = [];
      let mm: RegExpExecArray | null;
      while ((mm = mentionRegex.exec(message.content)) !== null) tokens.push(mm[1].toLowerCase().trim());
      if (tokens.length > 0) {
        for (const uid of recipients) {
          const nm = (nameByUser.get(uid) || '').toLowerCase().trim();
          if (!nm) continue;
          const first = nm.split(/\s+/)[0];
          if (tokens.some((t) => nm === t || nm.includes(t) || t.includes(first))) mentioned.add(uid);
        }
      }

      const isDM = room.type === 'dm';
      for (const uid of recipients) {
        const isMention = mentioned.has(uid);
        // Sala (team): só notifica no sino se houve @menção. DM: sempre.
        if (!isDM && !isMention) continue;
        const type = isMention ? 'mention' : 'chat_message';
        const title = isMention
          ? `${senderName} mencionou você no chat`
          : `${senderName} te enviou uma mensagem`;
        userNotificationService.createNotification({
          user_id: uid,
          type: type as any,
          title,
          message: preview,
          metadata: {
            chat_room_id: message.room_id,
            room_name: room.name,
            sender_id: message.user_id,
            sender_name: senderName,
          },
        }).catch((e) => console.error('Erro notificação de chat:', e));
      }
    } catch (e) {
      console.error('notifyRecipients falhou:', e);
    }
  }

  async createRoom(params: {
    name: string;
    type: 'team' | 'dm';
    isPublic: boolean;
    createdBy: string;
    memberIds?: string[];
  }): Promise<ChatRoom> {
    // Criar a sala
    const { data: room, error: roomError } = await supabase
      .from(this.roomsTable)
      .insert({
        name: params.name,
        type: params.type,
        is_public: params.isPublic,
        created_by: params.createdBy,
      })
      .select()
      .single();

    if (roomError) {
      console.error('Erro ao criar sala:', roomError);
      throw new Error(roomError.message);
    }

    // Adicionar membros (incluindo o criador)
    const members = params.memberIds || [];
    if (!members.includes(params.createdBy)) {
      members.push(params.createdBy);
    }

    if (members.length > 0) {
      const { error: membersError } = await supabase
        .from(this.membersTable)
        .insert(
          members.map(userId => ({
            room_id: room.id,
            user_id: userId,
            role: userId === params.createdBy ? 'admin' : 'member',
          }))
        );

      if (membersError) {
        console.error('Erro ao adicionar membros:', membersError);
        // Não falhar completamente, apenas logar
      }
    }

    return room as ChatRoom;
  }

  async findDirectMessage(userId1: string, userId2: string): Promise<ChatRoom | null> {
    // Primeiro, buscar todos os IDs de salas DM do userId1
    const { data: userRooms, error: userRoomsError } = await supabase
      .from(this.membersTable)
      .select('room_id')
      .eq('user_id', userId1);

    if (userRoomsError) {
      console.error('Erro ao buscar salas do usuário:', userRoomsError);
      return null;
    }

    if (!userRooms || userRooms.length === 0) {
      return null;
    }

    // Depois, verificar quais dessas salas são do tipo DM e contêm userId2
    const roomIds = userRooms.map(row => row.room_id);
    const { data: dmRooms, error: dmError } = await supabase
      .from(this.roomsTable)
      .select('id, type')
      .in('id', roomIds)
      .eq('type', 'dm');

    if (dmError) {
      console.error('Erro ao buscar salas DM:', dmError);
      return null;
    }

    if (!dmRooms || dmRooms.length === 0) {
      return null;
    }

    // Finalmente, verificar se alguma sala DM contém userId2
    for (const dmRoom of dmRooms) {
      const { data: otherMember } = await supabase
        .from(this.membersTable)
        .select('user_id')
        .eq('room_id', dmRoom.id)
        .eq('user_id', userId2)
        .single();

      if (otherMember) {
        // Buscar a sala completa
        const { data: fullRoom } = await supabase
          .from(this.roomsTable)
          .select('*')
          .eq('id', dmRoom.id)
          .single();

        return fullRoom as ChatRoom;
      }
    }

    return null;
  }

  async createDirectMessage(params: {
    userId1: string;
    userId2: string;
  }): Promise<ChatRoom> {
    // Verificar se já existe uma sala DM entre estes usuários
    const existingRoom = await this.findDirectMessage(params.userId1, params.userId2);
    if (existingRoom) {
      return existingRoom;
    }

    // Buscar nomes dos usuários para criar nome da sala
    const { data: profile1 } = await supabase
      .from('profiles')
      .select('name')
      .eq('user_id', params.userId1)
      .single();

    const { data: profile2 } = await supabase
      .from('profiles')
      .select('name')
      .eq('user_id', params.userId2)
      .single();

    const name1 = profile1?.name || 'Usuário';
    const name2 = profile2?.name || 'Usuário';
    const roomName = `${name1} e ${name2}`;

    // Criar nova sala DM
    const { data: room, error } = await supabase
      .from(this.roomsTable)
      .insert({
        name: roomName,
        type: 'dm',
        is_public: false,
        created_by: params.userId1,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar DM:', error);
      throw new Error(error.message);
    }

    const { error: membersError } = await supabase
      .from(this.membersTable)
      .insert([
        { room_id: room.id, user_id: params.userId1, role: 'member' },
        { room_id: room.id, user_id: params.userId2, role: 'member' },
      ]);

    if (membersError) {
      console.error('Erro ao adicionar membros ao DM:', membersError);
      throw new Error(membersError.message);
    }

    return room as ChatRoom;
  }

  async broadcastToAll(params: {
    content: string;
    userId: string;
    roomName?: string;
  }): Promise<ChatMessage> {
    // Criar ou pegar sala geral
    const room = await this.getOrCreatePublicRoomByName({
      name: params.roomName || 'Geral',
      createdBy: params.userId,
    });

    // Enviar mensagem
    return this.sendMessage({
      roomId: room.id,
      userId: params.userId,
      content: params.content,
    });
  }

  async markAsRead(params: { roomId: string; userId: string }): Promise<void> {
    const { error } = await supabase
      .from(this.membersTable)
      .update({
        unread_count: 0,
        last_read_at: new Date().toISOString(),
      })
      .eq('room_id', params.roomId)
      .eq('user_id', params.userId);

    if (error) {
      console.error('Erro ao marcar como lido:', error);
    }
  }

  async getRoomReadStates(roomId: string): Promise<Map<string, string>> {
    const { data, error } = await supabase
      .from(this.membersTable)
      .select('user_id, last_read_at')
      .eq('room_id', roomId);
    if (error) {
      console.error('Erro ao buscar leitura da sala:', error);
      return new Map();
    }
    return new Map((data ?? []).filter((r: any) => r.last_read_at).map((r: any) => [r.user_id, r.last_read_at]));
  }

  /** Envia "chamar atenção" (nudge MSN) para um usuário via broadcast. */
  async sendNudge(params: { toUserId: string; fromUserId: string; fromName: string; roomId: string }): Promise<void> {
    const channel = supabase.channel(`chat_nudge_${params.toUserId}`);
    await channel.subscribe();
    await channel.send({
      type: 'broadcast',
      event: 'nudge',
      payload: { fromUserId: params.fromUserId, fromName: params.fromName, roomId: params.roomId },
    });
    setTimeout(() => supabase.removeChannel(channel), 1500);
  }

  subscribeToNudges(params: {
    userId: string;
    onNudge: (data: { fromUserId: string; fromName: string; roomId: string }) => void;
  }): () => void {
    const channel = supabase.channel(`chat_nudge_${params.userId}`);
    channel.on('broadcast', { event: 'nudge' }, (msg) => {
      params.onNudge(msg.payload as { fromUserId: string; fromName: string; roomId: string });
    });
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }

  async getUnreadCount(userId: string): Promise<number> {
    const { data, error } = await supabase
      .from(this.membersTable)
      .select('unread_count')
      .eq('user_id', userId);

    if (error) {
      console.error('Erro ao contar não lidas:', error);
      return 0;
    }

    return (data || []).reduce((total, item: any) => total + (item.unread_count || 0), 0);
  }

  async getOrCreatePublicRoomByName(params: { name: string; createdBy: string }): Promise<ChatRoom> {
    const { data: existing, error: existingError } = await supabase
      .from(this.roomsTable)
      .select('*')
      .eq('is_public', true)
      .eq('type', 'team')
      .eq('name', params.name)
      .order('created_at', { ascending: true })
      .limit(1);

    if (!existingError && existing && existing.length > 0) {
      return existing[0] as ChatRoom;
    }

    const { data, error } = await supabase
      .from(this.roomsTable)
      .insert({
        name: params.name,
        type: 'team',
        is_public: true,
        created_by: params.createdBy,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar sala de chat:', error);
      throw new Error(error.message);
    }

    return data as ChatRoom;
  }

  async listRooms(userId: string): Promise<ChatRoom[]> {
    const publicRoomsReq = supabase
      .from(this.roomsTable)
      .select('*')
      .eq('is_public', true)
      .order('last_message_at', { ascending: false })
      .order('created_at', { ascending: false });

    const memberRoomsReq = supabase
      .from(this.membersTable)
      .select(`room:${this.roomsTable}(*)`)
      .eq('user_id', userId);

    // Salas portal_client: inclui foto do cliente via join
    const portalRoomsReq = supabase
      .from(this.roomsTable)
      .select(`*, portal_user:client_portal_users!portal_client_id(client:clients!client_id(photo_path))`)
      .eq('type', 'portal_client')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    const [
      { data: publicRooms, error: publicErr },
      { data: memberRows, error: memberErr },
      { data: portalRooms },
    ] = await Promise.all([publicRoomsReq, memberRoomsReq, portalRoomsReq]);

    if (publicErr) {
      console.error('Erro ao listar salas públicas:', publicErr);
      throw new Error(publicErr.message);
    }

    if (memberErr) {
      console.error('Erro ao listar salas do usuário:', memberErr);
      throw new Error(memberErr.message);
    }

    const merged = new Map<string, ChatRoom>();

    (publicRooms ?? []).forEach((room: any) => {
      merged.set(room.id, room as ChatRoom);
    });

    (memberRows ?? []).forEach((row: any) => {
      const room = row.room as ChatRoom | null;
      if (room) merged.set(room.id, room);
    });

    (portalRooms ?? [])
      // Fila: mostra apenas (a) sem dono ainda ou (b) atribuída a este atendente
      .filter((room: any) => room.accepted_by == null || room.accepted_by === userId)
      .forEach((room: any) => {
        // Extrai foto do cliente do join — bucket 'perfil' é público
        const photoPath = room.portal_user?.client?.photo_path;
        const enriched: any = { ...room, portal_user: undefined };
        if (photoPath) {
          try {
            const { data } = supabase.storage.from('perfil').getPublicUrl(photoPath);
            if (data?.publicUrl) enriched.portal_client_avatar = data.publicUrl;
          } catch { /* sem foto, usa iniciais */ }
        }
        merged.set(room.id, enriched as ChatRoom);
      });

    return Array.from(merged.values()).sort((a, b) => {
      const aTime = a.last_message_at ?? a.created_at;
      const bTime = b.last_message_at ?? b.created_at;
      return bTime.localeCompare(aTime);
    });
  }

  async getRoomMembers(roomId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from(this.membersTable)
      .select('user_id')
      .eq('room_id', roomId);

    if (error) {
      console.error('Erro ao buscar membros da sala:', error);
      return [];
    }

    return (data ?? []).map((row: any) => row.user_id);
  }

  async getLastMessage(params: { roomId: string }): Promise<ChatMessage | null> {
    const { data, error } = await supabase
      .from(this.messagesTable)
      .select('*')
      .eq('room_id', params.roomId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Erro ao buscar última mensagem:', error);
      return null;
    }

    return (data?.[0] as ChatMessage) ?? null;
  }

  async listMessages(params: { roomId: string; limit?: number }): Promise<ChatMessage[]> {
    const limit = params.limit ?? 50;

    const { data, error } = await supabase
      .from(this.messagesTable)
      .select('*')
      .eq('room_id', params.roomId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Erro ao listar mensagens:', error);
      throw new Error(error.message);
    }

    const rows = (data ?? []) as ChatMessage[];
    return rows.slice().reverse();
  }

  async sendMessage(params: { roomId: string; userId: string; content: string; replyTo?: string | null }): Promise<ChatMessage> {
    const trimmed = params.content.trim();
    if (!trimmed) {
      throw new Error('Mensagem vazia');
    }

    const { data, error } = await supabase
      .from(this.messagesTable)
      .insert({
        room_id: params.roomId,
        user_id: params.userId,
        content: trimmed,
        reply_to: params.replyTo ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao enviar mensagem:', error);
      throw new Error(error.message);
    }

    const message = data as ChatMessage;
    // Notificação de chat fica SOMENTE no widget (toast + som + badge).
    // Sino global desativado a pedido — não cria user_notifications para chat.
    void message;
    return message;
  }

  /** Insere uma mensagem de sistema (nudge, eventos) e retorna o registro inserido. */
  async sendSystemMessage(params: { roomId: string; userId: string; content: string }): Promise<ChatMessage | null> {
    const { data, error } = await supabase
      .from(this.messagesTable)
      .insert({
        room_id: params.roomId,
        user_id: params.userId,
        content: params.content,
        is_system: true,
      })
      .select()
      .single();
    if (error) {
      console.error('Erro ao inserir mensagem de sistema:', error.message);
      return null;
    }
    return data as ChatMessage;
  }

  async editMessage(params: { messageId: string; content: string }): Promise<ChatMessage> {
    const trimmed = params.content.trim();
    if (!trimmed) throw new Error('Mensagem vazia');
    const { data, error } = await supabase
      .from(this.messagesTable)
      .update({ content: trimmed, edited_at: new Date().toISOString() })
      .eq('id', params.messageId)
      .select()
      .single();
    if (error) {
      console.error('Erro ao editar mensagem:', error);
      throw new Error(error.message);
    }
    return data as ChatMessage;
  }

  async deleteMessage(params: { messageId: string }): Promise<void> {
    const { error } = await supabase
      .from(this.messagesTable)
      .update({ deleted_at: new Date().toISOString(), content: '' })
      .eq('id', params.messageId);
    if (error) {
      console.error('Erro ao excluir mensagem:', error);
      throw new Error(error.message);
    }
  }

  async listReactions(roomId: string): Promise<ChatReaction[]> {
    const { data: msgs } = await supabase
      .from(this.messagesTable)
      .select('id')
      .eq('room_id', roomId);
    const ids = (msgs ?? []).map((m: any) => m.id);
    if (ids.length === 0) return [];
    const { data, error } = await supabase
      .from('chat_message_reactions')
      .select('*')
      .in('message_id', ids);
    if (error) {
      console.error('Erro ao listar reações:', error);
      return [];
    }
    return (data ?? []) as ChatReaction[];
  }

  async toggleReaction(params: { messageId: string; userId: string; emoji: string }): Promise<void> {
    const { data: existing } = await supabase
      .from('chat_message_reactions')
      .select('id')
      .eq('message_id', params.messageId)
      .eq('user_id', params.userId)
      .eq('emoji', params.emoji)
      .maybeSingle();
    if (existing?.id) {
      await supabase.from('chat_message_reactions').delete().eq('id', existing.id);
    } else {
      await supabase.from('chat_message_reactions').insert({
        message_id: params.messageId,
        user_id: params.userId,
        emoji: params.emoji,
      });
    }
  }

  subscribeToRoomReactions(params: { roomId: string; onChange: () => void }): () => void {
    const channel = supabase.channel(`chat_reactions_${params.roomId}`);
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'chat_message_reactions' },
      () => params.onChange(),
    );
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }

  subscribeToRoomMessageUpdates(params: {
    roomId: string;
    onUpdate: (message: ChatMessage) => void;
  }): () => void {
    const channel = supabase.channel(`chat_room_upd_${params.roomId}`);
    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: this.messagesTable, filter: `room_id=eq.${params.roomId}` },
      (payload) => params.onUpdate(payload.new as ChatMessage),
    );
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }

  subscribeToRoomMessages(params: {
    roomId: string;
    onInsert: (message: ChatMessage) => void;
  }): () => void {
    const channel = supabase.channel(`chat_room_${params.roomId}`);

    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: this.messagesTable,
        filter: `room_id=eq.${params.roomId}`,
      },
      (payload) => {
        const msg = payload.new as ChatMessage;
        params.onInsert(msg);
      }
    );

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  subscribeToNewTicketRooms(params: { onNewRoom: (room: ChatRoom) => void }): () => void {
    const channel = supabase.channel('chat_rooms_portal_insert');
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: this.roomsTable, filter: 'type=eq.portal_client' },
      (payload) => params.onNewRoom(payload.new as ChatRoom),
    );
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }

  /**
   * Escuta UPDATE em salas portal_client.
   * Quando accepted_by é preenchido por outro atendente, o frontend pode
   * remover a sala da lista de quem não a aceitou.
   */
  subscribeToTicketRoomUpdates(params: { onUpdate: (room: ChatRoom) => void }): () => void {
    const channel = supabase.channel('chat_rooms_portal_update');
    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: this.roomsTable, filter: 'type=eq.portal_client' },
      (payload) => params.onUpdate(payload.new as ChatRoom),
    );
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }

  subscribeToAllMessages(params: {
    onInsert: (message: ChatMessage) => void;
    /** UPDATE em mensagens (edição e soft-delete via edited_at/deleted_at). Opcional. */
    onUpdate?: (message: ChatMessage) => void;
  }): () => void {
    const channel = supabase.channel('chat_messages_all');

    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: this.messagesTable,
      },
      (payload) => {
        const msg = payload.new as ChatMessage;
        params.onInsert(msg);
      }
    );

    if (params.onUpdate) {
      channel.on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: this.messagesTable,
        },
        (payload) => {
          params.onUpdate!(payload.new as ChatMessage);
        }
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }
}

export const chatService = new ChatService();
