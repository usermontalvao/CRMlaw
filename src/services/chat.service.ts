import { supabase } from '../config/supabase';
import type { ChatMessage, ChatRoom } from '../types/chat.types';

class ChatService {
  private roomsTable = 'chat_rooms';
  private membersTable = 'chat_room_members';
  private messagesTable = 'chat_messages';

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

  async createDirectMessage(params: {
    userId1: string;
    userId2: string;
  }): Promise<ChatRoom> {
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

    const [{ data: publicRooms, error: publicErr }, { data: memberRows, error: memberErr }] = await Promise.all([
      publicRoomsReq,
      memberRoomsReq,
    ]);

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
      if (room) {
        merged.set(room.id, room);
      }
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

  async sendMessage(params: { roomId: string; userId: string; content: string }): Promise<ChatMessage> {
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
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao enviar mensagem:', error);
      throw new Error(error.message);
    }

    return data as ChatMessage;
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

  subscribeToAllMessages(params: { onInsert: (message: ChatMessage) => void }): () => void {
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

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }
}

export const chatService = new ChatService();
