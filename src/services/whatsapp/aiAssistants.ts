// Camada dos Agentes de IA: CRUD, vínculo com canal, destinos do autocomplete
// `ação=` e o estado que o painel "Memória da IA" mostra na conversa.
//
// A validação do prompt e a allowlist de ações vivem em `src/utils/waAiActionCatalog`
// — regra pura, com teste, espelhada na Edge Function. Aqui só há ida ao banco.
import { supabase } from '../../config/supabase';
import { invokeFn } from './shared';
import type {
  WhatsAppAiAssistant,
  WhatsAppAiAssistantInput,
  WhatsAppAiConversationState,
  WhatsAppAiExecution,
  WhatsAppAiSimulationResult,
  WhatsAppAiFollowup,
  WhatsAppAiTargetOption,
  WhatsAppAiActionRef,
} from '../../types/whatsapp.types';
import {
  actionsUsedInPrompt,
  isWaAiModelAllowed,
  normalizeWaAiAllowedActions,
  pruneWaAiActionRefs,
  validateWaAiPrompt,
} from '../../utils/waAiActionCatalog';
import { normalizeWaAiPlaybook, waAiPlaybookInstructions } from '../../utils/waAiPlaybook';

const ASSISTANTS_TABLE = 'whatsapp_ai_assistants';
const EXECUTIONS_TABLE = 'whatsapp_ai_executions';
const FOLLOWUPS_TABLE = 'whatsapp_ai_followups';
const SESSIONS_TABLE = 'whatsapp_ai_sessions';

/** O mínimo que a LINHA da inbox precisa saber sobre a IA de cada conversa. */
export interface WhatsAppAiListState {
  aiActive: boolean;
  nextFollowupAt: string | null;
  attemptsDone: number;
  maxAttempts: number;
  /** 'appointment' quando o pendente é hora marcada pelo cliente. */
  kind: string | null;
}
const CONFIG_TABLE = 'whatsapp_ai_channel_config';

/** Erro de validação do agente. A tela mostra a mensagem junto do trecho ruim. */
export class WaAiValidationError extends Error {
  readonly issues: { level: 'erro' | 'aviso'; message: string; raw: string; field: 'do' | 'dont' }[];
  constructor(message: string, issues: WaAiValidationError['issues'] = []) {
    super(message);
    this.name = 'WaAiValidationError';
    this.issues = issues;
  }
}

/**
 * Os quatro controles operacionais da IA passam por aqui.
 *
 * ── POR QUE RPC, E NÃO ESCRITA DIRETA ──────────────────────────────────────
 *
 * Pausar, retomar, limpar a memória e cancelar a retomada mudam o que o cliente
 * recebe a seguir. Como escrita direta do navegador, três coisas faltavam:
 *
 *   · o porteiro certo — a RLS pedia só "poder VER a conversa", que é a régua
 *     da inbox e inclui canal aberto, colaborador emprestado e supervisor de
 *     outro canal;
 *   · a atomicidade — "retomar" eram três escritas soltas, e entre elas a
 *     conversa ficava sem dono e sem IA;
 *   · o rastro — nenhuma das quatro deixava evento de auditoria.
 *
 * As RPCs resolvem as três de uma vez, e a decisão passa a morar num lugar só.
 *
 * ── A QUEDA PARA O CAMINHO ANTIGO ──────────────────────────────────────────
 *
 * A migration e o front-end sobem em momentos diferentes. Chamar uma função que
 * o banco ainda não tem devolve `42883` (ou `PGRST202`, quando o PostgREST nem
 * a encontra no cache do schema) — e um erro aqui deixaria "Interromper IA" sem
 * fazer nada até o deploy do banco. Nesse caso, e SÓ nesse, o caminho antigo
 * roda. Qualquer outro erro sobe: `42501` é a recusa de permissão, e ela tem de
 * chegar à tela como recusa, não como silêncio.
 *
 * Mesmo desenho da leitura de `role` em `scope.ts`. Quando a migration estiver
 * em produção, os quatro `legado` abaixo podem sair.
 */
async function chamarControleIa(
  fn: 'wa_ai_pause' | 'wa_ai_resume' | 'wa_ai_clear_memory' | 'wa_ai_cancel_followup',
  args: Record<string, unknown>,
  legado: () => Promise<void>,
): Promise<void> {
  const { error } = await supabase.rpc(fn, args);
  if (!error) return;

  const ausente = error.code === '42883'
    || error.code === 'PGRST202'
    || /could not find the function|does not exist/i.test(error.message ?? '');
  if (ausente) {
    await legado();
    return;
  }
  throw new Error(error.message);
}

function rowToAssistant(row: any): WhatsAppAiAssistant {
  return {
    ...row,
    allowed_actions: normalizeWaAiAllowedActions(row.allowed_actions),
    action_refs: Array.isArray(row.action_refs) ? row.action_refs : [],
    followup_custom_hours: (row.followup_custom_hours || []).map(Number),
    followup_days: row.followup_days || [],
    followup_interval_hours: Number(row.followup_interval_hours),
  } as WhatsAppAiAssistant;
}

export const aiAssistantsApi = {
  // ── Agentes ───────────────────────────────────────────────────

  async listAiAssistants(activeOnly = false): Promise<WhatsAppAiAssistant[]> {
    let q = supabase.from(ASSISTANTS_TABLE).select('*').order('name');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(rowToAssistant);
  },

  async getAiAssistant(id: string): Promise<WhatsAppAiAssistant | null> {
    const { data } = await supabase.from(ASSISTANTS_TABLE).select('*').eq('id', id).maybeSingle();
    return data ? rowToAssistant(data) : null;
  },

  /**
   * Prepara e confere o agente antes de gravar.
   *
   * Três coisas acontecem aqui e em nenhum outro lugar:
   *   1. toda ação citada no texto entra na allowlist (regra do editor: escolher
   *      no menu é habilitar);
   *   2. referência de destino que não aparece mais em nenhum dos dois textos é
   *      descartada — senão o destino compilado continuaria valendo em silêncio;
   *   3. o prompt é validado; um `erro` impede o salvamento.
   *
   * Nada é executado. Editar o prompt nunca dispara ação.
   */
  prepareAiAssistantPayload(input: WhatsAppAiAssistantInput): Record<string, unknown> {
    const name = String(input.name || '').trim();
    if (!name) throw new WaAiValidationError('Dê um nome ao agente.');

    const provider = String(input.provider || 'openai');
    const model = String(input.model || 'gpt-4o-mini');
    if (!isWaAiModelAllowed(provider, model)) {
      throw new WaAiValidationError(`O modelo ${provider}/${model} não está disponível.`);
    }

    const legacyInstructionsDo = String(input.instructions_do ?? '');
    const instructionsDont = String(input.instructions_dont ?? '');

    // O roteiro também é prompt: desde que ele passou a trazer abertura, estilo
    // e fechamento, uma expressão `ação=` pode estar escrita LÁ. Sem contá-la
    // aqui, a referência de destino seria podada por não aparecer em nenhum dos
    // dois textos — e o agente perderia, em silêncio, para quem transferir.
    const playbook = normalizeWaAiPlaybook(input.playbook);
    const playbookText = playbook ? waAiPlaybookInstructions(playbook) : '';
    // O contexto estruturado substitui a prosa antiga. Manter as duas fontes
    // ativas recriaria exatamente a ambiguidade que o editor novo elimina.
    // Ao salvar, o campo legado é limpo; agentes sem contexto continuam iguais.
    const instructionsDo = playbook?.context ? '' : legacyInstructionsDo;

    const refs = pruneWaAiActionRefs(
      (input.action_refs || []) as WhatsAppAiActionRef[],
      instructionsDo, instructionsDont, playbookText);
    // Mesma regra do editor — citar uma ação é habilitá-la —, agora valendo
    // também para o que foi escrito no roteiro.
    const allowed = normalizeWaAiAllowedActions([
      ...normalizeWaAiAllowedActions(input.allowed_actions),
      ...actionsUsedInPrompt(playbookText),
    ]);

    const issues = [
      ...validateWaAiPrompt(instructionsDo, refs, allowed).map(i => ({ ...i, field: 'do' as const })),
      ...validateWaAiPrompt(instructionsDont, refs, allowed).map(i => ({ ...i, field: 'dont' as const })),
      ...validateWaAiPrompt(playbookText, refs, allowed).map(i => ({ ...i, field: 'do' as const })),
    ];
    const erros = issues.filter(i => i.level === 'erro');
    if (erros.length > 0) {
      throw new WaAiValidationError(erros[0].message, issues.map(i =>
        ({ level: i.level, message: i.message, raw: i.raw, field: i.field })));
    }

    return {
      name,
      description: input.description?.trim() || null,
      provider,
      model,
      is_active: input.is_active !== false,
      mode: input.mode === 'auto' ? 'auto' : 'test',
      instructions_do: instructionsDo,
      instructions_dont: instructionsDont,
      allowed_actions: allowed,
      action_refs: refs,
      followup_enabled: input.followup_enabled === true,
      followup_instructions: String(input.followup_instructions ?? ''),
      followup_max_attempts: Math.min(10, Math.max(1, Number(input.followup_max_attempts) || 3)),
      followup_strategy: input.followup_strategy || 'fixed',
      followup_interval_hours: Number(input.followup_interval_hours) || 24,
      followup_custom_hours: (input.followup_custom_hours || []).filter(h => Number(h) > 0),
      followup_days: input.followup_days?.length ? input.followup_days : [1, 2, 3, 4, 5],
      followup_start_minute: Number(input.followup_start_minute ?? 480),
      followup_end_minute: Number(input.followup_end_minute ?? 1080),
      timezone: input.timezone || 'America/Cuiaba',
      debounce_seconds: Math.min(60, Math.max(0, Number(input.debounce_seconds ?? 8))),
      history_limit: Math.min(40, Math.max(2, Number(input.history_limit ?? 12))),
      // O roteiro é gravado já pela MESMA leitura que o backend faz. O que não
      // presta sai aqui, na hora de salvar, e não no meio de um atendimento —
      // e o que fica é exatamente o que vai virar o formato de resposta
      // obrigatório do modelo.
      playbook: playbook || {},
    };
  },

  async createAiAssistant(input: WhatsAppAiAssistantInput): Promise<WhatsAppAiAssistant> {
    const payload = aiAssistantsApi.prepareAiAssistantPayload(input);
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase.from(ASSISTANTS_TABLE)
      .insert({ ...payload, created_by: auth?.user?.id ?? null })
      .select('*').single();
    if (error) throw new Error(error.message);
    return rowToAssistant(data);
  },

  async updateAiAssistant(id: string, input: WhatsAppAiAssistantInput): Promise<WhatsAppAiAssistant> {
    const payload = aiAssistantsApi.prepareAiAssistantPayload(input);
    const { data, error } = await supabase.from(ASSISTANTS_TABLE)
      .update(payload).eq('id', id).select('*').single();
    if (error) throw new Error(error.message);
    return rowToAssistant(data);
  },

  /**
   * Exclusão só quando o agente não está em canal nenhum: apagar um agente em
   * uso deixaria o canal com a IA ligada e sem quem responder.
   */
  async deleteAiAssistant(id: string): Promise<void> {
    const { data: emUso } = await supabase.from(CONFIG_TABLE)
      .select('channel_id').eq('assistant_id', id);
    if ((emUso || []).length > 0) {
      throw new WaAiValidationError('Este agente está vinculado a um canal. Desvincule antes de excluir.');
    }
    const { data: deleted, error } = await supabase.from(ASSISTANTS_TABLE).delete().eq('id', id).select('id');
    if (error) throw new Error(error.message);
    if (!deleted || deleted.length === 0) {
      throw new Error('Agente não encontrado ou você não tem permissão para excluí-lo.');
    }
  },

  // ── Vínculo com o canal ───────────────────────────────────────

  async setChannelAiAssistant(
    channelId: string,
    patch: { assistant_id?: string | null; ai_enabled?: boolean },
  ): Promise<void> {
    const { error } = await supabase.from(CONFIG_TABLE).upsert(
      { channel_id: channelId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'channel_id' },
    );
    if (error) throw new Error(error.message);
  },

  // ── Destinos do autocomplete ──────────────────────────────────

  /**
   * Registros REAIS que o menu `ação=transferir(...)` oferece.
   *
   * A dica ao lado do nome não é enfeite: com dois "Pedro" no escritório, o
   * cargo ou o setor é o que permite escolher o certo — e é o id escolhido,
   * não o nome, que o backend usa depois.
   */
  async listAiTransferTargets(channelId?: string | null): Promise<WhatsAppAiTargetOption[]> {
    const [usersRes, deptsRes] = await Promise.all([
      supabase.from('profiles')
        .select('user_id, name, role, email')
        .eq('is_active', true)
        .order('name'),
      supabase.from('whatsapp_departments')
        .select('id, name, is_active')
        .eq('is_active', true)
        .order('name'),
    ]);

    const options: WhatsAppAiTargetOption[] = [];

    for (const u of (usersRes.data || []) as any[]) {
      if (!u.user_id || !u.name) continue;
      options.push({
        type: 'user',
        id: u.user_id,
        label: u.name,
        hint: u.role || u.email || null,
      });
    }

    // O setor precisa atender ESTE canal — o backend recusa a transferência para
    // um setor que não está ligado ao canal, e oferecer aqui só geraria um erro
    // na hora do atendimento.
    let allowedDeptIds: Set<string> | null = null;
    if (channelId) {
      const { data: links } = await supabase.from('whatsapp_channel_departments')
        .select('department_id').eq('channel_id', channelId);
      allowedDeptIds = new Set((links || []).map((l: any) => l.department_id));
    }

    for (const d of (deptsRes.data || []) as any[]) {
      if (allowedDeptIds && !allowedDeptIds.has(d.id)) continue;
      options.push({ type: 'department', id: d.id, label: d.name, hint: 'Setor' });
    }

    return options;
  },

  /**
   * Templates que já possuem permalink ativo e, portanto, podem gerar um link
   * exclusivo e rastreável para cada conversa. O id compilado é o do template;
   * o backend resolve novamente o permalink ativo no instante do envio.
   */
  async listAiDocumentTargets(): Promise<WhatsAppAiTargetOption[]> {
    const { data, error } = await supabase.from('template_fill_permalinks')
      .select('template_id, slug, created_at, document_templates(id, name)')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const seen = new Set<string>();
    const options: WhatsAppAiTargetOption[] = [];
    for (const row of (data || []) as any[]) {
      const template = Array.isArray(row.document_templates)
        ? row.document_templates[0]
        : row.document_templates;
      const templateId = String(row.template_id || template?.id || '');
      const name = String(template?.name || '').trim();
      if (!templateId || !name || seen.has(templateId)) continue;
      seen.add(templateId);
      options.push({
        type: 'document_template',
        id: templateId,
        label: name,
        hint: `Link ativo · /p/${row.slug}`,
      });
    }

    return options.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  },

  // ── Estado da IA numa conversa ────────────────────────────────

  /** O que o painel "Memória da IA" mostra. Uma consulta por fonte, sem realtime. */
  async getAiConversationState(conversationId: string): Promise<WhatsAppAiConversationState | null> {
    const { data: conv } = await supabase.from('whatsapp_conversations')
      .select('id, instance_id').eq('id', conversationId).maybeSingle();
    if (!conv) return null;

    const [configRes, sessionRes, execRes, followupRes] = await Promise.all([
      supabase.from(CONFIG_TABLE).select('ai_enabled, assistant_id')
        .eq('channel_id', conv.instance_id).maybeSingle(),
      supabase.from(SESSIONS_TABLE).select('*').eq('conversation_id', conversationId).maybeSingle(),
      supabase.from(EXECUTIONS_TABLE).select('*').eq('conversation_id', conversationId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from(FOLLOWUPS_TABLE).select('*').eq('conversation_id', conversationId)
        .eq('status', 'pending').order('scheduled_at').limit(1).maybeSingle(),
    ]);

    const assistantId = configRes.data?.assistant_id ?? sessionRes.data?.assistant_id ?? null;
    let assistantName: string | null = null;
    let mode: WhatsAppAiConversationState['mode'] = null;
    let followupPolicy: WhatsAppAiConversationState['followupPolicy'] = null;
    if (assistantId) {
      const { data: assistant } = await supabase.from(ASSISTANTS_TABLE)
        .select('name, mode, followup_enabled, followup_strategy, followup_interval_hours, followup_custom_hours, followup_max_attempts, followup_days, followup_start_minute, followup_end_minute, followup_inactivity_minutes, timezone')
        .eq('id', assistantId).maybeSingle();
      assistantName = assistant?.name ?? null;
      mode = (assistant?.mode as WhatsAppAiConversationState['mode']) ?? null;
      if (assistant) {
        followupPolicy = {
          enabled: assistant.followup_enabled === true,
          strategy: assistant.followup_strategy === 'progressive' || assistant.followup_strategy === 'custom'
            ? assistant.followup_strategy
            : 'fixed',
          intervalHours: Number(assistant.followup_interval_hours) || 24,
          customHours: Array.isArray(assistant.followup_custom_hours)
            ? assistant.followup_custom_hours.map(Number).filter(Number.isFinite)
            : [],
          maxAttempts: Number(assistant.followup_max_attempts) || 3,
          days: Array.isArray(assistant.followup_days) ? assistant.followup_days.map(Number) : [1, 2, 3, 4, 5],
          startMinute: Number(assistant.followup_start_minute ?? 480),
          endMinute: Number(assistant.followup_end_minute ?? 1080),
          timezone: String(assistant.timezone || 'America/Cuiaba'),
          inactivityMinutes: Number(assistant.followup_inactivity_minutes ?? 10),
        };
      }
    }

    const session = sessionRes.data as any;
    return {
      aiActive: session ? session.ai_active !== false : false,
      assistantId,
      assistantName,
      mode,
      followupPolicy,
      channelAiEnabled: configRes.data?.ai_enabled === true,
      status: session?.status ?? null,
      summary: session?.summary ?? null,
      knownFacts: (session?.known_facts && typeof session.known_facts === 'object') ? session.known_facts : {},
      pendingItems: Array.isArray(session?.pending_items) ? session.pending_items : [],
      lastAction: session?.last_action ?? null,
      triageStage: session?.triage_stage ?? null,
      triageCut: session?.triage_cut ?? null,
      triageCutReason: session?.triage_cut_reason ?? null,
      handoffReason: session?.handoff_reason ?? null,
      handoffSummary: session?.handoff_summary ?? null,
      nextFollowupAt: session?.next_followup_at ?? null,
      followupAttempts: Number(session?.followup_attempts || 0),
      lastExecution: (execRes.data as WhatsAppAiExecution) ?? null,
      pendingFollowup: (followupRes.data as WhatsAppAiFollowup) ?? null,
    };
  },

  /**
   * Interrompe a IA nesta conversa. É o botão de pânico do operador: a IA para
   * na hora e NÃO volta sozinha — só a reativação manual a religa.
   *
   * Vai pela RPC `wa_ai_pause`: é ela que confere a permissão (mesma régua de
   * assumir e encerrar), cancela as retomadas agendadas e registra o ato no
   * histórico do atendimento. Ver `chamarControleIa`.
   */
  async stopAiForConversation(conversationId: string, reason?: string): Promise<void> {
    await chamarControleIa(
      'wa_ai_pause',
      { p_conversation_id: conversationId, p_reason: reason?.trim() || null },
      async () => {
        const { error } = await supabase.from(SESSIONS_TABLE).upsert({
          conversation_id: conversationId,
          ai_active: false,
          status: 'handed_off',
          handoff_reason: reason?.trim() || 'Interrompida pelo atendente.',
          ended_at: new Date().toISOString(),
        }, { onConflict: 'conversation_id' });
        if (error) throw new Error(error.message);

        await supabase.from(FOLLOWUPS_TABLE)
          .update({ status: 'cancelled', cancel_reason: 'IA interrompida pelo atendente.' })
          .eq('conversation_id', conversationId).eq('status', 'pending');
      },
    );
  },

  /**
   * Religa a IA nesta conversa, mantendo a memória.
   *
   * Devolve a conversa à fila junto: a IA não atende conversa que tem dono (a
   * portaria da Edge Function recusa o turno), então religar sem soltar a
   * atribuição seria um botão que não faz nada. Reabrir faz parte pelo mesmo
   * motivo — a portaria também recusa conversa encerrada.
   *
   * As três coisas passaram a acontecer DENTRO da RPC `wa_ai_resume`. Aqui elas
   * eram três escritas soltas do navegador, e a do meio — soltar o responsável
   * com um UPDATE cru em `whatsapp_conversations` — era um caminho para
   * desatribuir e reabrir atendimento sem passar por nenhuma das RPCs de
   * atendimento, sem porteiro de comando e sem rastro.
   */
  async resumeAiForConversation(conversationId: string): Promise<void> {
    await chamarControleIa(
      'wa_ai_resume',
      { p_conversation_id: conversationId },
      async () => {
        const { error: relErr } = await supabase.from('whatsapp_conversations')
          .update({
            assigned_user_id: null,
            awaiting_accept: false,
            transfer_pending_since: null,
            status: 'open',
          })
          .eq('id', conversationId);
        if (relErr) throw new Error(relErr.message);

        const { error } = await supabase.from(SESSIONS_TABLE).upsert({
          conversation_id: conversationId,
          ai_active: true,
          status: 'active',
          handoff_reason: null,
          ended_at: null,
        }, { onConflict: 'conversation_id' });
        if (error) throw new Error(error.message);
      },
    );
  },

  /**
   * Esquece o caso e recomeça do zero, sem desligar a IA.
   *
   * `last_processed_message_id` também é zerado: sem isso a próxima mensagem
   * poderia ser tratada como já processada e a IA ficaria muda depois da limpeza.
   *
   * `history_from` é o que faz "do zero" ser verdade: sem ele o caderno é
   * apagado mas as mensagens antigas continuam entrando no prompt, e o agente
   * segue sabendo o nome, o assunto e o que já perguntou. Mesmo marco zero do
   * comando `/clear` digitado na conversa.
   */
  async clearAiMemory(conversationId: string): Promise<void> {
    await chamarControleIa(
      'wa_ai_clear_memory',
      { p_conversation_id: conversationId },
      async () => {
        const { error: followupError } = await supabase.from(FOLLOWUPS_TABLE)
          .update({ status: 'cancelled', cancel_reason: 'Memória da IA reiniciada pelo atendente.' })
          .eq('conversation_id', conversationId)
          .eq('status', 'pending');
        if (followupError) throw new Error(followupError.message);

        const { error } = await supabase.from(SESSIONS_TABLE).upsert({
          conversation_id: conversationId,
          summary: null,
          known_facts: {},
          pending_items: [],
          last_action: null,
          // O veredito do roteiro é leitura da conversa, não configuração: deixar
          // um corte antigo de pé faria a triagem recomeçar já encerrada.
          triage_stage: null,
          triage_cut: null,
          triage_cut_reason: null,
          last_processed_message_id: null,
          followup_attempts: 0,
          next_followup_at: null,
          // Os sinais de interesse são leitura de conversa, não configuração:
          // limpar a memória tem de apagá-los junto, senão a conversa recomeça com
          // o agente proibido de retomar por causa de uma frase antiga.
          followup_opt_out: false,
          followup_opt_out_reason: null,
          interest_checked_at: null,
          history_from: new Date().toISOString(),
        }, { onConflict: 'conversation_id' });
        if (error) throw new Error(error.message);
      },
    );
  },

  /**
   * O estado da IA das conversas VISÍVEIS na inbox, numa consulta só.
   *
   * A lista precisa disto para trocar quatro etiquetas operacionais por uma:
   * enquanto o agente responde, "Aguardando setor" e "na fila há 2h07" são
   * falsos. Só duas colunas por conversa, e a invariante do backend garante que
   * `next_followup_at` preenchido significa que existe pendente de verdade.
   */
  async listAiConversationStates(
    conversationIds: string[],
  ): Promise<Map<string, WhatsAppAiListState>> {
    const out = new Map<string, WhatsAppAiListState>();
    const ids = [...new Set(conversationIds.filter(Boolean))];
    if (ids.length === 0) return out;

    // Lotes: uma inbox grande estoura o tamanho do `in.()` na URL do PostgREST.
    for (let i = 0; i < ids.length; i += 200) {
      const bloco = ids.slice(i, i + 200);
      const [sessoes, pendentes] = await Promise.all([
        supabase.from(SESSIONS_TABLE)
          .select('conversation_id, ai_active, next_followup_at, followup_attempts, assistant_id')
          .in('conversation_id', bloco),
        // O tipo do pendente decide o texto da etiqueta: compromisso marcado
        // pelo cliente não é "2ª tentativa de 8".
        supabase.from(FOLLOWUPS_TABLE)
          .select('conversation_id, kind')
          .eq('status', 'pending')
          .in('conversation_id', bloco),
      ]);
      if (sessoes.error) throw new Error(sessoes.error.message);

      const tipoPorConversa = new Map<string, string>();
      for (const row of (pendentes.data || []) as any[]) {
        tipoPorConversa.set(String(row.conversation_id), String(row.kind || 'followup'));
      }

      for (const row of (sessoes.data || []) as any[]) {
        const id = String(row.conversation_id);
        out.set(id, {
          aiActive: row.ai_active !== false,
          nextFollowupAt: row.next_followup_at ?? null,
          attemptsDone: Number(row.followup_attempts || 0),
          maxAttempts: 8,
          kind: tipoPorConversa.get(id) ?? null,
        });
      }
    }
    return out;
  },

  async cancelAiFollowup(followupId: string): Promise<void> {
    await chamarControleIa(
      'wa_ai_cancel_followup',
      { p_followup_id: followupId },
      async () => {
        const { data: updated, error } = await supabase.from(FOLLOWUPS_TABLE)
          .update({ status: 'cancelled', cancel_reason: 'Cancelado pelo atendente.' })
          .eq('id', followupId).eq('status', 'pending').select('id');
        if (error) throw new Error(error.message);
        if (!updated || updated.length === 0) {
          throw new Error('Acompanhamento não encontrado ou você não tem permissão para cancelá-lo.');
        }
      },
    );
  },

  // ── Prévia do agente ──────────────────────────────────────────

  /**
   * Conversa de mentira com o agente, para testar antes de soltar no canal.
   *
   * Roda no motor de verdade (`whatsapp-ai-agent`, modo `simulate`): mesmo
   * prompt, mesmas ferramentas, mesmo modelo. O que ele NÃO faz é gravar,
   * executar ação ou enviar mensagem — as ações voltam como "simulada".
   *
   * O agente vai como rascunho, então dá para testar sem salvar. A memória
   * devolvida precisa voltar na chamada seguinte: é ela que dá continuidade
   * à conversa, já que não existe sessão no banco.
   */
  async simulateAiAssistant(input: {
    assistant: WhatsAppAiAssistantInput;
    messages: { role: 'cliente' | 'agente'; text: string }[];
    memory?: WhatsAppAiSimulationResult['memory'] | null;
    contactName?: string;
    trigger?: 'mensagem' | 'followup';
    followupAttempt?: number;
  }): Promise<WhatsAppAiSimulationResult> {
    return await invokeFn<WhatsAppAiSimulationResult>('whatsapp-ai-agent', {
      simulate: true,
      assistant: input.assistant,
      messages: input.messages,
      memory: input.memory ?? null,
      contact_name: input.contactName || '',
      trigger: input.trigger === 'followup' ? 'followup' : 'mensagem',
      followup_attempt: input.followupAttempt ?? 1,
    });
  },

  /** Últimas execuções de uma conversa, para diagnóstico. Sem dashboard. */
  async listAiExecutions(conversationId: string, limit = 10): Promise<WhatsAppAiExecution[]> {
    const { data, error } = await supabase.from(EXECUTIONS_TABLE)
      .select('*').eq('conversation_id', conversationId)
      .order('created_at', { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppAiExecution[];
  },
};
