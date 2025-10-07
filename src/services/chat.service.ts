// Chat Service
// Para remover: delete este arquivo

import { supabase } from '../config/supabase';
import type {
  Conversation,
  ConversationWithParticipants,
  Message,
  MessageWithSender,
  CreateConversationDTO,
  CreateMessageDTO,
  UpdateMessageDTO,
  ConversationParticipant,
  CreateCallSessionDTO,
  UpdateCallSessionDTO,
  CallSession,
} from '../types/chat.types';

class ChatService {
  // ==================== CONVERSATIONS ====================
  
  async listConversations(userId: string): Promise<ConversationWithParticipants[]> {
    // Primeiro buscar IDs das conversas do usuário
    const { data: participantData } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', userId);

    if (!participantData || participantData.length === 0) {
      return [];
    }

    const conversationIds = participantData.map(p => p.conversation_id);

    // Buscar conversas com participantes
    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        participants:conversation_participants(*)
      `)
      .in('id', conversationIds)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Erro ao listar conversas:', error);
      throw new Error(error.message);
    }

    return data || [];
  }

  async getConversation(conversationId: string): Promise<ConversationWithParticipants | null> {
    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        participants:conversation_participants(*)
      `)
      .eq('id', conversationId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.error('Erro ao buscar conversa:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async createConversation(dto: CreateConversationDTO, currentUserId: string): Promise<Conversation> {
    // Criar conversa
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        name: dto.name,
        is_group: dto.is_group || false,
        created_by: currentUserId,
      })
      .select()
      .single();

    if (convError) {
      console.error('Erro ao criar conversa:', convError);
      throw new Error(convError.message);
    }

    // Adicionar participantes
    const participants = [
      ...dto.participant_ids.map(userId => ({
        conversation_id: conversation.id,
        user_id: userId,
      })),
      // Adicionar o criador também
      {
        conversation_id: conversation.id,
        user_id: currentUserId,
      }
    ];

    const { error: partError } = await supabase
      .from('conversation_participants')
      .insert(participants);

    if (partError) {
      console.error('Erro ao adicionar participantes:', partError);
      // Tentar remover a conversa criada
      await supabase.from('conversations').delete().eq('id', conversation.id);
      throw new Error(partError.message);
    }

    return conversation;
  }

  async findOrCreateDirectConversation(userId1: string, userId2: string): Promise<Conversation> {
    // Buscar conversa existente entre os dois usuários
    const { data: existingConversations } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .in('user_id', [userId1, userId2]);

    if (existingConversations && existingConversations.length > 0) {
      // Agrupar por conversation_id e contar participantes
      const conversationCounts = existingConversations.reduce((acc, item) => {
        acc[item.conversation_id] = (acc[item.conversation_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Encontrar conversa com exatamente 2 participantes (conversa direta)
      const directConvId = Object.keys(conversationCounts).find(
        id => conversationCounts[id] === 2
      );

      if (directConvId) {
        const { data: conversation } = await supabase
          .from('conversations')
          .select('*')
          .eq('id', directConvId)
          .eq('is_group', false)
          .single();

        if (conversation) {
          return conversation;
        }
      }
    }

    // Criar nova conversa
    return this.createConversation(
      {
        is_group: false,
        participant_ids: [userId2],
      },
      userId1
    );
  }

  async updateConversation(conversationId: string, name: string): Promise<Conversation> {
    const { data, error } = await supabase
      .from('conversations')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar conversa:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId);

    if (error) {
      console.error('Erro ao deletar conversa:', error);
      throw new Error(error.message);
    }
  }

  // ==================== MESSAGES ====================

  async listMessages(conversationId: string, limit: number = 50): Promise<MessageWithSender[]> {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Erro ao listar mensagens:', error);
      throw new Error(error.message);
    }

    return (data || []).reverse();
  }

  async sendMessage(dto: CreateMessageDTO, senderId: string): Promise<Message> {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        ...dto,
        sender_id: senderId,
        message_type: dto.message_type || 'text',
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao enviar mensagem:', error);
      throw new Error(error.message);
    }

    // Atualizar updated_at da conversa
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', dto.conversation_id);

    return data;
  }

  async updateMessage(messageId: string, dto: UpdateMessageDTO): Promise<Message> {
    const { data, error } = await supabase
      .from('messages')
      .update({
        ...dto,
        is_edited: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', messageId)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar mensagem:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async deleteMessage(messageId: string): Promise<void> {
    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId);

    if (error) {
      console.error('Erro ao deletar mensagem:', error);
      throw new Error(error.message);
    }
  }

  async markMessageAsRead(messageId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('message_reads')
      .upsert({
        message_id: messageId,
        user_id: userId,
        read_at: new Date().toISOString(),
      });

    if (error) {
      console.error('Erro ao marcar mensagem como lida:', error);
      throw new Error(error.message);
    }
  }

  async markConversationAsRead(conversationId: string, userId: string): Promise<void> {
    // Atualizar last_read_at do participante
    const { error } = await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);

    if (error) {
      console.error('Erro ao marcar conversa como lida:', error);
      throw new Error(error.message);
    }
  }

  // ==================== CALL SESSIONS ====================

  async createCallSession(dto: CreateCallSessionDTO, callerId: string): Promise<CallSession> {
    const { data, error } = await supabase
      .from('call_sessions')
      .insert({
        ...dto,
        caller_id: callerId,
        status: 'initiated',
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar sessão de chamada:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async updateCallSession(sessionId: string, dto: UpdateCallSessionDTO): Promise<CallSession> {
    const { data, error } = await supabase
      .from('call_sessions')
      .update(dto)
      .eq('id', sessionId)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar sessão de chamada:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async getCallHistory(conversationId: string): Promise<CallSession[]> {
    const { data, error } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('started_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar histórico de chamadas:', error);
      throw new Error(error.message);
    }

    return data || [];
  }

  // ==================== REALTIME SUBSCRIPTIONS ====================

  subscribeToConversation(conversationId: string, onMessage: (message: Message) => void) {
    return supabase
      .channel(`conversation:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          onMessage(payload.new as Message);
        }
      )
      .subscribe();
  }

  subscribeToConversations(userId: string, onUpdate: () => void) {
    return supabase
      .channel(`user:${userId}:conversations`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
        },
        () => {
          onUpdate();
        }
      )
      .subscribe();
  }

  unsubscribe(channel: any) {
    if (channel) {
      supabase.removeChannel(channel);
    }
  }
}

export const chatService = new ChatService();
