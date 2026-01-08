import { supabase } from '../config/supabase';
import type { ChatMessage, ChatRoom } from '../types/chat.types';

class ChatService {
  private roomsTable = 'chat_rooms';
  private membersTable = 'chat_room_members';
  private messagesTable = 'chat_messages';

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

  async listMessages(params: { roomId: string; limit?: number }): Promise<ChatMessage[]> {
    const limit = params.limit ?? 50;

    const { data, error } = await supabase
      .from(this.messagesTable)
      .select('*')
      .eq('room_id', params.roomId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('Erro ao listar mensagens:', error);
      throw new Error(error.message);
    }

    return (data ?? []) as ChatMessage[];
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
}

export const chatService = new ChatService();
