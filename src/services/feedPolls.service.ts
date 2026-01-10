import { supabase } from '../config/supabase';
import { userNotificationService } from './userNotification.service';

export interface PollOption {
  text: string;
  votes: number;
}

export interface FeedPoll {
  id: string;
  post_id: string;
  question: string;
  options: PollOption[];
  expires_at: string | null;
  allow_multiple: boolean;
  participants: string[];
  created_at: string;
  updated_at: string;
  user_votes?: number[];
  is_expired?: boolean;
  total_votes?: number;
}

export interface CreatePollDTO {
  post_id: string;
  question: string;
  options: string[];
  expires_at?: string | null;
  allow_multiple?: boolean;
  participants?: string[];
}

class FeedPollsService {
  async createPoll(dto: CreatePollDTO): Promise<FeedPoll> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const options: PollOption[] = dto.options.map(text => ({ text, votes: 0 }));

    const { data, error } = await supabase
      .from('feed_polls')
      .insert({
        post_id: dto.post_id,
        question: dto.question,
        options,
        expires_at: dto.expires_at || null,
        allow_multiple: dto.allow_multiple || false,
        participants: dto.participants || [],
      })
      .select('*')
      .single();

    if (error) {
      console.error('Erro ao criar enquete:', error);
      throw error;
    }

    // Notificar participantes selecionados
    if (dto.participants && dto.participants.length > 0) {
      for (const participantId of dto.participants) {
        if (participantId !== user.id) {
          try {
            await userNotificationService.createNotification({
              user_id: participantId,
              type: 'mention',
              title: 'Nova enquete para você',
              message: dto.question.length > 80 ? dto.question.substring(0, 80) + '...' : dto.question,
              metadata: {
                poll_id: data.id,
                post_id: dto.post_id,
              }
            });
          } catch (e) {
            console.warn('Erro ao notificar participante:', e);
          }
        }
      }
    }

    return this.hydratePoll(data);
  }

  async getPollByPostId(postId: string): Promise<FeedPoll | null> {
    const { data, error } = await supabase
      .from('feed_polls')
      .select('*')
      .eq('post_id', postId)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar enquete:', error);
      return null;
    }

    if (!data) return null;
    return this.hydratePoll(data);
  }

  async vote(pollId: string, optionIndex: number): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    // Verificar se enquete existe e não expirou
    const { data: poll } = await supabase
      .from('feed_polls')
      .select('*')
      .eq('id', pollId)
      .single();

    if (!poll) throw new Error('Enquete não encontrada');
    if (poll.expires_at && new Date(poll.expires_at) < new Date()) {
      throw new Error('Enquete expirada');
    }

    // Se não permite múltiplos votos, remover voto anterior
    if (!poll.allow_multiple) {
      await supabase
        .from('feed_poll_votes')
        .delete()
        .eq('poll_id', pollId)
        .eq('user_id', user.id);
    }

    // Inserir voto
    const { error } = await supabase
      .from('feed_poll_votes')
      .insert({
        poll_id: pollId,
        user_id: user.id,
        option_index: optionIndex,
      });

    if (error && error.code !== '23505') {
      console.error('Erro ao votar:', error);
      throw error;
    }

    // Atualizar contagem de votos na enquete
    await this.updateVoteCounts(pollId);
  }

  async removeVote(pollId: string, optionIndex: number): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const { error } = await supabase
      .from('feed_poll_votes')
      .delete()
      .eq('poll_id', pollId)
      .eq('user_id', user.id)
      .eq('option_index', optionIndex);

    if (error) {
      console.error('Erro ao remover voto:', error);
      throw error;
    }

    await this.updateVoteCounts(pollId);
  }

  private async updateVoteCounts(pollId: string): Promise<void> {
    // Buscar todos os votos
    const { data: votes } = await supabase
      .from('feed_poll_votes')
      .select('option_index')
      .eq('poll_id', pollId);

    // Buscar enquete atual
    const { data: poll } = await supabase
      .from('feed_polls')
      .select('options')
      .eq('id', pollId)
      .single();

    if (!poll) return;

    const options = poll.options as PollOption[];
    
    // Resetar contagens
    options.forEach(opt => opt.votes = 0);
    
    // Contar votos
    votes?.forEach(vote => {
      if (options[vote.option_index]) {
        options[vote.option_index].votes++;
      }
    });

    // Atualizar enquete
    await supabase
      .from('feed_polls')
      .update({ options, updated_at: new Date().toISOString() })
      .eq('id', pollId);
  }

  private async hydratePoll(poll: any): Promise<FeedPoll> {
    const { data: { user } } = await supabase.auth.getUser();
    
    // Buscar votos do usuário atual
    let userVotes: number[] = [];
    if (user) {
      const { data: votes } = await supabase
        .from('feed_poll_votes')
        .select('option_index')
        .eq('poll_id', poll.id)
        .eq('user_id', user.id);
      
      userVotes = votes?.map(v => v.option_index) || [];
    }

    const options = poll.options as PollOption[];
    const totalVotes = options.reduce((sum, opt) => sum + opt.votes, 0);
    const isExpired = poll.expires_at ? new Date(poll.expires_at) < new Date() : false;

    return {
      ...poll,
      user_votes: userVotes,
      is_expired: isExpired,
      total_votes: totalVotes,
    };
  }
}

export const feedPollsService = new FeedPollsService();
