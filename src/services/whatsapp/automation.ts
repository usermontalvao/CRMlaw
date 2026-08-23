// Camada de automação: mensagens agendadas (Fase 8.1) e sessões de IA (Fase J).
import { supabase } from '../../config/supabase';
import type {
  WhatsAppScheduledMessage,
  WhatsAppScheduledWithContact,
  WhatsAppAiSession,
} from '../../types/whatsapp.types';
import { SCHEDULED_TABLE, openResilientChannel, attachAvatarUrls } from './shared';
import { criarRegistroCompartilhado } from '../realtime/sharedResource';

const AI_SESSIONS_TABLE = 'whatsapp_ai_sessions';

/**
 * Até quando o histórico de agendadas ("Concluídas") olha para trás.
 *
 * Não é limpeza: nada é apagado, e a linha continua no banco para auditoria. É
 * recorte de leitura. A pergunta que essa metade responde — "aquilo que eu
 * agendei chegou a sair?" — tem prazo de validade curto; passados uns dias,
 * cada enviada vira ruído, e num escritório movimentado a lista passaria de mil
 * linhas em poucos meses, enterrando as recentes.
 */
export const HISTORICO_AGENDADAS_DIAS = 15;

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

/** Recarrega a lista pessoal de um atendente. Preenchido no `abrir` abaixo. */
const recarregadoresPessoais = new Map<string, () => void>();

/**
 * Lista pessoal de agendadas: um canal e uma consulta por atendente.
 *
 * O filtro é por `created_by`, mas o Postgres Changes não o aplica (DELETE não
 * aceita filtro), então ouvimos a tabela inteira — volume baixo — e deixamos o
 * recorte pessoal para a consulta, sob RLS.
 */
const minhasAgendadas = criarRegistroCompartilhado<WhatsAppScheduledWithContact[]>({
  marca: '[Jurius Realtime][MyScheduled]',
  abrir: (userId, publicar) => {
    let vivo = true;
    const carregar = () => {
      automationApi
        .listMyScheduled()
        .then((items) => { if (vivo) publicar(items); })
        .catch(() => { if (vivo) publicar([]); });
    };
    recarregadoresPessoais.set(userId, carregar);
    carregar();

    const fecharCanal = openResilientChannel({
      name: `wa-my-scheduled-${userId}`,
      bind: ch => ch.on('postgres_changes',
        { event: '*', schema: 'public', table: SCHEDULED_TABLE },
        () => carregar()),
    });

    return () => {
      vivo = false;
      recarregadoresPessoais.delete(userId);
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

  /**
   * Confirma que uma retenção acabou sendo entregue pelo canal alternativo.
   *
   * `sentMessageId` é a mensagem que ela virou na thread — o mesmo elo que o
   * cron grava. Sem ele, a agendada reenviada por aqui viraria a única
   * "concluída" que não sabe levar de volta ao ponto da conversa.
   */
  async completeReroutedReconnectHold(id: string, sentMessageId?: string | null): Promise<void> {
    const { error } = await supabase
      .from(SCHEDULED_TABLE)
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        sent_message_id: sentMessageId ?? null,
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
    const { data: updated, error } = await supabase.from(SCHEDULED_TABLE)
      .update(upd).eq('id', id).eq('status', 'pending').select('id');
    if (error) throw new Error(error.message);
    if (!updated || updated.length === 0) throw new Error('Agendamento não encontrado ou você não tem permissão para editá-lo.');
  },

  async cancelScheduled(id: string): Promise<void> {
    const { data: updated, error } = await supabase.from(SCHEDULED_TABLE)
      .update({ status: 'canceled' }).eq('id', id).eq('status', 'pending').select('id');
    if (error) throw new Error(error.message);
    if (!updated || updated.length === 0) throw new Error('Agendamento não encontrado ou você não tem permissão para cancelá-lo.');
  },

  /** Exclui em definitivo uma mensagem agendada (qualquer status). */
  async deleteScheduled(id: string): Promise<void> {
    const { data: deleted, error } = await supabase.from(SCHEDULED_TABLE).delete().eq('id', id).select('id');
    if (error) throw new Error(error.message);
    if (!deleted || deleted.length === 0) throw new Error('Agendamento não encontrado ou você não tem permissão para excluí-lo.');
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
    const { data: updated, error } = await supabase.from(SCHEDULED_TABLE)
      .update(upd).eq('id', id).in('status', ['failed', 'canceled']).select('id');
    if (error) throw new Error(error.message);
    if (!updated || updated.length === 0) throw new Error('Agendamento não encontrado ou você não tem permissão para reenviá-lo.');
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

  /**
   * Tudo que o atendente logado tem agendado, em qualquer conversa.
   *
   * Existe porque `listScheduled` exige um `conversation_id`: até aqui não havia
   * como responder "o que EU tenho agendado?" sem abrir conversa por conversa.
   * O recorte por `created_by` é o mesmo de `listMyReconnectAlerts` — quem
   * agendou é quem precisa acompanhar.
   *
   * Traz TODOS os estados, porque a aba tem duas metades: o que ainda vai
   * acontecer (`pending`/`failed`) e o histórico do que já aconteceu
   * (`sent`/`canceled`). Antes só vinham as duas primeiras, e quem perguntava
   * "aquela mensagem de ontem chegou a sair?" não tinha onde olhar — a agendada
   * enviada simplesmente sumia da lista no instante em que saía.
   *
   * O histórico tem PRAZO (HISTORICO_AGENDADAS_DIAS); a fila não tem. O que já
   * aconteceu perde utilidade rápido e só faria volume; o que ainda vai
   * acontecer — sobretudo uma falha — não pode sumir por idade.
   *
   * SÃO DUAS CONSULTAS, e não uma com teto. A fila e o histórico competem pelo
   * mesmo limite, mas só o histórico pode ser cortado: uma falha de três meses
   * atrás continua sendo uma falha, e num teto único ela seria empurrada para
   * fora pelas enviadas mais recentes — a sirene da aba emudeceria justamente no
   * caso em que ela existe para gritar. Fila sem teto (é pequena por natureza),
   * histórico com teto.
   *
   * As falhas vêm primeiro de propósito: são as que exigem ação e as que ficavam
   * invisíveis antes desta lista existir.
   *
   * O nome do cadastro vem junto (`clients(full_name)`) porque `contact_name` é
   * o apelido que o próprio contato escolheu no WhatsApp — a inbox já prefere o
   * cadastro, e esta lista tem de mostrar a MESMA pessoa com o MESMO nome.
   */
  async listMyScheduled(): Promise<WhatsAppScheduledWithContact[]> {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) return [];
    const daPessoa = () => supabase
      .from(SCHEDULED_TABLE)
      .select('*, whatsapp_conversations(contact_name, contact_phone, contact_avatar_path, clients(full_name))')
      .eq('created_by', auth.user!.id);

    // O histórico olha só os últimos dias (ver HISTORICO_AGENDADAS_DIAS): o teto
    // sozinho não bastava — com 100 linhas de folga, um dia movimentado ainda
    // empurrava a lista para meses atrás e a aba virava arquivo morto.
    const desde = new Date(Date.now() - HISTORICO_AGENDADAS_DIAS * 24 * 60 * 60_000).toISOString();
    const [fila, historico] = await Promise.all([
      daPessoa().in('status', ['pending', 'failed']).order('scheduled_at', { ascending: true }).limit(200),
      daPessoa().in('status', ['sent', 'canceled']).gte('scheduled_at', desde).order('scheduled_at', { ascending: false }).limit(100),
    ]);
    if (fila.error) throw new Error(fila.error.message);
    if (historico.error) throw new Error(historico.error.message);

    const items = ([...(fila.data || []), ...(historico.data || [])])
      .map((row: any) => {
        const { whatsapp_conversations: conv, ...rest } = row;
        return {
          ...rest,
          contact_name: conv?.contact_name ?? null,
          contact_phone: conv?.contact_phone ?? '',
          client_name: conv?.clients?.full_name ?? null,
          contact_avatar_path: conv?.contact_avatar_path ?? null,
          contact_avatar_url: null,
        } as WhatsAppScheduledWithContact;
      })
      // Em aberto primeiro (falha na frente de tudo, do mais próximo ao mais
      // distante), histórico depois, do mais recente para o mais antigo — cada
      // metade na leitura que a sua pergunta pede.
      .sort((a, b) => {
        const abertaA = a.status === 'pending' || a.status === 'failed';
        const abertaB = b.status === 'pending' || b.status === 'failed';
        if (abertaA !== abertaB) return abertaA ? -1 : 1;
        if (abertaA) {
          if ((a.status === 'failed') !== (b.status === 'failed')) return a.status === 'failed' ? -1 : 1;
          return a.scheduled_at.localeCompare(b.scheduled_at);
        }
        return b.scheduled_at.localeCompare(a.scheduled_at);
      });
    // Mesmas URLs assinadas (e mesmo cache) que a inbox usa para as fotos.
    await attachAvatarUrls(items);
    return items;
  },

  /**
   * Lista pessoal de agendadas, ao vivo — pronta, sem o ouvinte buscar nada.
   *
   * Compartilhada porque os dois consumidores aparecem JUNTOS na tela: o cartão
   * do painel e a aba do módulo (que abre em janela flutuante sobre ele). Sem
   * isto seriam dois canais e duas consultas para o mesmo dado — o mesmo
   * desperdício que `subscribeScheduled` já evita por conversa.
   */
  subscribeMyScheduled(
    userId: string,
    onList: (items: WhatsAppScheduledWithContact[]) => void,
  ): () => void {
    return minhasAgendadas.assinar(userId, onList);
  },

  /** Força a releitura da lista pessoal (após cancelar/reenviar aqui mesmo). */
  refreshMyScheduled(userId: string): void {
    recarregadoresPessoais.get(userId)?.();
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
