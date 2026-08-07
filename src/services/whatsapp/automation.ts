// Camada de automação: mensagens agendadas (Fase 8.1) e sessões de IA (Fase J).
import { supabase } from '../../config/supabase';
import type { WhatsAppScheduledMessage, WhatsAppAiSession } from '../../types/whatsapp.types';
import { SCHEDULED_TABLE, openResilientChannel } from './shared';
import { criarRegistroCompartilhado } from '../realtime/sharedResource';

const AI_SESSIONS_TABLE = 'whatsapp_ai_sessions';

/** Recarrega a lista de uma conversa aberta. Preenchido no `abrir` abaixo. */
const recarregadores = new Map<string, () => void>();

function recarregarAgendadas(conversationId: string): void {
  recarregadores.get(conversationId)?.();
}

/**
 * Lista de agendadas por conversa: um canal e uma consulta, muitos consumidores.
 * Ver `criarRegistroCompartilhado` para o porquê.
 */
const agendadasPorConversa = criarRegistroCompartilhado<WhatsAppScheduledMessage[]>({
  marca: '[Jurius Realtime][Scheduled]',
  abrir: (conversationId, publicar) => {
    let vivo = true;
    const carregar = () => {
      automationApi
        .listScheduled(conversationId)
        .then((items) => { if (vivo) publicar(items); })
        .catch(() => { if (vivo) publicar([]); });
    };
    recarregadores.set(conversationId, carregar);
    carregar();

    const fecharCanal = openResilientChannel({
      name: `wa-sched-${conversationId}`,
      bind: ch => ch.on('postgres_changes',
        { event: '*', schema: 'public', table: SCHEDULED_TABLE, filter: `conversation_id=eq.${conversationId}` },
        () => carregar()),
    });

    return () => {
      vivo = false;
      recarregadores.delete(conversationId);
      fecharCanal();
    };
  },
});

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

  /**
   * Pendências por reconexão do atendente logado, em qualquer conversa.
   *
   * É a fonte da "sirene" do módulo. O filtro por `created_by` é deliberado:
   * toda a equipe pode enxergar agendamentos de conversas permitidas, mas quem
   * apertou Enviar é quem precisa receber o alerta persistente de que o cliente
   * ainda não recebeu. Falhas após o teto de espera continuam aqui até uma ação
   * humana; pendências enviadas/canceladas somem sozinhas.
   */
  async listMyReconnectAlerts(): Promise<WhatsAppScheduledMessage[]> {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) return [];
    const { data, error } = await supabase
      .from(SCHEDULED_TABLE)
      .select('*')
      .eq('created_by', auth.user.id)
      .eq('hold_reason', 'reconnect')
      .in('status', ['pending', 'failed'])
      .order('hold_since', { ascending: true, nullsFirst: true })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppScheduledMessage[];
  },

  /**
   * Move para a conversa do canal escolhido todas as retenções do próprio autor.
   *
   * O horário é empurrado por cinco minutos ANTES do envio imediato. Isso tira
   * as linhas do alcance do cron enquanto o navegador as envia, sem apagar a
   * sirene nem criar um estado intermediário irrecuperável. Se a aba morrer no
   * meio, o scheduler retoma sozinho já pelo canal novo quando o prazo vencer.
   */
  async rerouteMyReconnectHolds(input: {
    sourceConversationId: string;
    targetConversationId: string;
    targetChannelId: string;
  }): Promise<WhatsAppScheduledMessage[]> {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) throw new Error('Não autenticado.');
    const retryAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const { data, error } = await supabase
      .from(SCHEDULED_TABLE)
      .update({
        conversation_id: input.targetConversationId,
        channel_id: input.targetChannelId,
        status: 'pending',
        scheduled_at: retryAt,
        sent_at: null,
        error: 'Reenviando automaticamente pelo canal escolhido.',
      })
      .eq('conversation_id', input.sourceConversationId)
      .eq('created_by', auth.user.id)
      .eq('hold_reason', 'reconnect')
      .in('status', ['pending', 'failed'])
      .select('*');
    if (error) throw new Error(error.message);
    return ((data || []) as WhatsAppScheduledMessage[])
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  },

  /** Confirma que uma retenção acabou sendo entregue pelo canal alternativo. */
  async completeReroutedReconnectHold(id: string): Promise<void> {
    const { error } = await supabase
      .from(SCHEDULED_TABLE)
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        error: null,
        hold_reason: null,
        hold_since: null,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .eq('hold_reason', 'reconnect');
    if (error) throw new Error(error.message);
  },

  /**
   * Mantém a retenção visível quando o canal alternativo também não entregar.
   * Queda/reconexão volta ao cron; qualquer outra falha exige ação humana.
   */
  async failReroutedReconnectHold(
    id: string,
    message: string,
    retryAutomatically: boolean,
  ): Promise<void> {
    const { error } = await supabase
      .from(SCHEDULED_TABLE)
      .update({
        status: retryAutomatically ? 'pending' : 'failed',
        scheduled_at: new Date(Date.now() + 60_000).toISOString(),
        error: message.slice(0, 500),
        hold_reason: 'reconnect',
      })
      .eq('id', id)
      .eq('status', 'pending')
      .eq('hold_reason', 'reconnect');
    if (error) throw new Error(error.message);
  },

  async scheduleMessage(input: {
    conversationId: string; channelId?: string | null; scheduledAt: string;
    text?: string; type?: WhatsAppScheduledMessage['type'];
    storagePath?: string; mimeType?: string; fileName?: string;
    /** 'reconnect' → retida aguardando reconexão automática (não é agendamento do usuário). */
    holdReason?: 'reconnect';
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
      hold_reason: input.holdReason ?? null,
      // Retenção começa a contar aqui: é esse relógio que o scheduler usa para
      // espaçar as tentativas e desistir quando o canal não volta.
      hold_since: input.holdReason ? new Date().toISOString() : null,
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
    // Retentar à mão zera a retenção: a espera do canal recomeça do zero em vez
    // de herdar as horas que já tinham estourado o teto.
    const upd: Record<string, unknown> = {
      status: 'pending', error: null, sent_at: null, hold_reason: null, hold_since: null,
    };
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

  /**
   * Lista das mensagens agendadas de uma conversa, ao vivo.
   *
   * UM canal e UMA consulta por conversa, com fan-out local. As bolhas-fantasma
   * da thread e o painel lateral mostram exatamente a mesma lista: antes cada um
   * abria o seu `wa-sched-<conversa>` e disparava o seu `listScheduled`, lado a
   * lado, para o mesmo dado na mesma tela.
   *
   * O ouvinte recebe a lista pronta — não precisa buscar nada.
   */
  subscribeScheduled(
    conversationId: string,
    onList: (items: WhatsAppScheduledMessage[]) => void,
  ): () => void {
    return agendadasPorConversa.assinar(conversationId, onList);
  },

  /** Força a releitura da lista compartilhada (após cancelar/editar aqui mesmo). */
  refreshScheduled(conversationId: string): void {
    recarregarAgendadas(conversationId);
  },

  /** Reage às retenções do próprio atendente em todas as conversas. */
  subscribeMyReconnectAlerts(userId: string, onChange: () => void): () => void {
    return openResilientChannel({
      name: `wa-reconnect-alerts-${userId}`,
      bind: ch => ch.on('postgres_changes',
        // DELETE não aceita filtro no Postgres Changes. A assinatura ouve a
        // tabela (baixo volume) e a consulta `listMyReconnectAlerts` aplica o
        // recorte pessoal com RLS; assim excluir/cancelar também apaga a sirene
        // imediatamente, sem expor a pendência de outro atendente.
        { event: '*', schema: 'public', table: SCHEDULED_TABLE },
        () => onChange()),
    });
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
    return openResilientChannel({
      name: `wa-ai-${conversationId}`,
      bind: ch => ch.on('postgres_changes',
        { event: '*', schema: 'public', table: AI_SESSIONS_TABLE, filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') onChange(null);
          else onChange((payload.new as WhatsAppAiSession) || null);
        }),
    });
  },
};
