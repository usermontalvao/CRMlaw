// Camada de automação: mensagens agendadas (Fase 8.1) e sessões de IA (Fase J).
import { supabase } from '../../config/supabase';
import type { WhatsAppScheduledMessage, WhatsAppAiSession } from '../../types/whatsapp.types';
import { SCHEDULED_TABLE } from './shared';

const AI_SESSIONS_TABLE = 'whatsapp_ai_sessions';

export const automationApi = {
  async listScheduled(conversationId: string): Promise<WhatsAppScheduledMessage[]> {
    const { data, error } = await supabase
      .from(SCHEDULED_TABLE)
      .select('*')
      .eq('conversation_id', conversationId)
      .order('scheduled_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppScheduledMessage[];
  },

  async scheduleMessage(input: {
    conversationId: string; channelId?: string | null; scheduledAt: string;
    text?: string; type?: WhatsAppScheduledMessage['type'];
    storagePath?: string; mimeType?: string; fileName?: string;
  }): Promise<WhatsAppScheduledMessage> {
    if (new Date(input.scheduledAt).getTime() < Date.now() - 30000) throw new Error('Escolha uma data/hora no futuro.');
    const type = input.type || 'text';
    if (type === 'text' && !input.text?.trim()) throw new Error('Escreva a mensagem a agendar.');
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase.from(SCHEDULED_TABLE).insert({
      conversation_id: input.conversationId,
      channel_id: input.channelId || null,
      type,
      body: input.text?.trim() || null,
      storage_path: input.storagePath || null,
      mime_type: input.mimeType || null,
      file_name: input.fileName || null,
      scheduled_at: input.scheduledAt,
      created_by: auth?.user?.id ?? null,
    }).select('*').single();
    if (error) throw new Error(error.message);
    return data as WhatsAppScheduledMessage;
  },

  /** Edita uma mensagem ainda pendente (texto e/ou horário). */
  async updateScheduled(id: string, patch: { text?: string; scheduledAt?: string }): Promise<void> {
    const upd: Record<string, unknown> = {};
    if (patch.text !== undefined) upd.body = patch.text.trim() || null;
    if (patch.scheduledAt !== undefined) {
      if (new Date(patch.scheduledAt).getTime() < Date.now() - 30000) throw new Error('Escolha uma data/hora no futuro.');
      upd.scheduled_at = patch.scheduledAt;
    }
    const { error } = await supabase.from(SCHEDULED_TABLE).update(upd).eq('id', id).eq('status', 'pending');
    if (error) throw new Error(error.message);
  },

  async cancelScheduled(id: string): Promise<void> {
    const { error } = await supabase.from(SCHEDULED_TABLE)
      .update({ status: 'canceled' }).eq('id', id).eq('status', 'pending');
    if (error) throw new Error(error.message);
  },

  /** Exclui em definitivo uma mensagem agendada (qualquer status). */
  async deleteScheduled(id: string): Promise<void> {
    const { error } = await supabase.from(SCHEDULED_TABLE).delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  /**
   * Reagenda/retenta uma mensagem que falhou ou foi cancelada: volta para
   * 'pending' (limpa o erro). Sem novo horário → dispara no próximo ciclo do cron.
   */
  async retryScheduled(id: string, patch?: { text?: string; scheduledAt?: string }): Promise<void> {
    const upd: Record<string, unknown> = { status: 'pending', error: null, sent_at: null };
    if (patch?.text !== undefined) upd.body = patch.text.trim() || null;
    if (patch?.scheduledAt) {
      if (new Date(patch.scheduledAt).getTime() < Date.now() - 30000) throw new Error('Escolha uma data/hora no futuro.');
      upd.scheduled_at = patch.scheduledAt;
    } else {
      upd.scheduled_at = new Date().toISOString();
    }
    const { error } = await supabase.from(SCHEDULED_TABLE)
      .update(upd).eq('id', id).in('status', ['failed', 'canceled']);
    if (error) throw new Error(error.message);
  },

  /** Realtime das mensagens agendadas de uma conversa (para o painel reagir). */
  subscribeScheduled(conversationId: string, onChange: () => void): () => void {
    const ch = supabase
      .channel(`wa-sched-${conversationId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: SCHEDULED_TABLE, filter: `conversation_id=eq.${conversationId}` },
        () => onChange())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  },

  // ── Sessões de IA (Fase J) ────────────────────────────────────

  /** Carrega sessão de IA de uma conversa (null se não existe). */
  async getAiSession(conversationId: string): Promise<WhatsAppAiSession | null> {
    const { data } = await supabase
      .from(AI_SESSIONS_TABLE)
      .select('*')
      .eq('conversation_id', conversationId)
      .maybeSingle();
    return (data as WhatsAppAiSession) || null;
  },

  /** Aborta a sessão de IA da conversa (agente humano assume). */
  async abortAiSession(conversationId: string): Promise<void> {
    const { error } = await supabase
      .from(AI_SESSIONS_TABLE)
      .update({ status: 'aborted', ended_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('status', 'active');
    if (error) throw new Error(error.message);
  },

  /** Realtime de sessão de IA de uma conversa (banner na UI reage). */
  subscribeAiSession(conversationId: string, onChange: (session: WhatsAppAiSession | null) => void): () => void {
    const ch = supabase
      .channel(`wa-ai-${conversationId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: AI_SESSIONS_TABLE, filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') onChange(null);
          else onChange((payload.new as WhatsAppAiSession) || null);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  },
};
