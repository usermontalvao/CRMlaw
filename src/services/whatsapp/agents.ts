// Atendente de IA: leitura e configuração dos agentes e do log de decisões.
//
// O log é SOMENTE LEITURA por RLS — adulterar o histórico destruiria a prova
// que o modo sombra existe para produzir. Aqui nem existe função de escrita nele.
//
// Nada disto assina Realtime de propósito: o custo de Realtime deste projeto é
// dirigido pelo catálogo replicado, e estas tabelas ficaram fora da publicação.
import { supabase } from '../../config/supabase';

export const AGENTS_TABLE = 'whatsapp_ai_agents';
export const AGENT_VERSIONS_TABLE = 'whatsapp_ai_agent_versions';
export const AGENT_STATE_TABLE = 'whatsapp_ai_agent_state';
export const AGENT_RUNS_TABLE = 'whatsapp_ai_runs';

export type WaAgentMode = 'sombra' | 'aprovacao' | 'automatico';
export type WaAgentRole =
  | 'triagem' | 'qualificacao' | 'documentos' | 'proposta' | 'fechamento' | 'atendimento';

export interface WaAgent {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: WaAgentRole;
  prompt: string;
  channel_id: string | null;
  is_primary: boolean;
  keyword: string | null;
  allowed_tools: string[];
  model: string;
  debounce_seconds: number;
  max_turns: number;
  mode: WaAgentMode;
  handoff_user_id: string | null;
  handoff_department_id: string | null;
  is_active: boolean;
  version: number;
  updated_at: string;
}

export type WaRunVerdict = 'executado' | 'barrado' | 'simulado' | 'aprovacao';

export interface WaRunToolCall {
  name: string;
  args: Record<string, unknown>;
  verdict: WaRunVerdict;
  detail?: string;
}

export interface WaAgentRun {
  id: string;
  conversation_id: string;
  agent_id: string | null;
  mode: WaAgentMode;
  inbound_text: string | null;
  reply_text: string | null;
  tool_calls: WaRunToolCall[];
  executed: boolean;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  error: string | null;
  created_at: string;
}

/** Uma decisão já cruzada com quem é o contato e quem é o agente. */
export interface WaRunEnriched extends WaAgentRun {
  contact_name: string | null;
  agent_name: string | null;
}

export interface WaShadowSummary {
  runs: number;
  conversations: number;
  /** Mensagens que realmente saíram. Em sombra tem de ser 0. */
  sent: number;
  /** Gatilhos que a cerca barrou. */
  blocked: number;
  /** Vezes que o agente decidiu chamar gente. */
  handoffs: number;
  errors: number;
}

export const agentsApi = {
  async list(): Promise<WaAgent[]> {
    const { data, error } = await supabase
      .from(AGENTS_TABLE)
      .select('*')
      .order('is_primary', { ascending: false })
      .order('name');
    if (error) throw error;
    return (data || []) as WaAgent[];
  },

  async save(id: string, patch: Partial<WaAgent>): Promise<void> {
    const { error } = await supabase.from(AGENTS_TABLE).update(patch).eq('id', id);
    if (error) throw error;
  },

  /**
   * Guarda o prompt anterior antes de sobrescrever. Calibrar prompt é tentativa
   * e erro; sem poder voltar, cada piora vira retrabalho.
   */
  async savePrompt(agent: WaAgent, prompt: string, authorId: string | null, note?: string): Promise<void> {
    if (prompt === agent.prompt) return;

    const { error: ve } = await supabase.from(AGENT_VERSIONS_TABLE).insert({
      agent_id: agent.id,
      version: agent.version,
      prompt: agent.prompt,
      allowed_tools: agent.allowed_tools,
      author_id: authorId,
      note: note || null,
    });
    if (ve) throw ve;

    const { error } = await supabase.from(AGENTS_TABLE)
      .update({ prompt, version: agent.version + 1 })
      .eq('id', agent.id);
    if (error) throw error;
  },

  async versions(agentId: string): Promise<Array<{ version: number; prompt: string; created_at: string }>> {
    const { data, error } = await supabase
      .from(AGENT_VERSIONS_TABLE)
      .select('version, prompt, created_at')
      .eq('agent_id', agentId)
      .order('version', { ascending: false })
      .limit(20);
    if (error) throw error;
    return data || [];
  },

  /** Log de decisões, do mais recente para o mais antigo. */
  async runs(limit = 60): Promise<WaRunEnriched[]> {
    const { data, error } = await supabase
      .from(AGENT_RUNS_TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    const runs = (data || []) as WaAgentRun[];
    if (!runs.length) return [];

    const convIds = [...new Set(runs.map(r => r.conversation_id))];
    const agentIds = [...new Set(runs.map(r => r.agent_id).filter(Boolean))] as string[];

    const [convs, agents] = await Promise.all([
      supabase.from('whatsapp_conversations').select('id, contact_name').in('id', convIds),
      agentIds.length
        ? supabase.from(AGENTS_TABLE).select('id, name').in('id', agentIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    ]);

    const nomeConv = new Map((convs.data || []).map((c: any) => [c.id, c.contact_name]));
    const nomeAgente = new Map((agents.data || []).map((a: any) => [a.id, a.name]));

    return runs.map(r => ({
      ...r,
      tool_calls: Array.isArray(r.tool_calls) ? r.tool_calls : [],
      contact_name: nomeConv.get(r.conversation_id) ?? null,
      agent_name: r.agent_id ? nomeAgente.get(r.agent_id) ?? null : null,
    }));
  },

  /**
   * A última decisão desta conversa, com o estado atual. É o que o painel da
   * conversa mostra: "o que ele faria agora". Devolve null quando o agente
   * ainda não passou por aqui — a conversa segue como qualquer outra.
   */
  async latestForConversation(conversationId: string): Promise<{
    run: WaAgentRun | null;
    agentName: string | null;
    collected: Record<string, string>;
    qualification: string | null;
    status: string | null;
  } | null> {
    const [runRes, stateRes] = await Promise.all([
      supabase.from(AGENT_RUNS_TABLE).select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from(AGENT_STATE_TABLE)
        .select('collected_data, qualification, status, current_agent_id')
        .eq('conversation_id', conversationId).maybeSingle(),
    ]);

    if (!runRes.data && !stateRes.data) return null;

    const run = runRes.data
      ? { ...(runRes.data as WaAgentRun), tool_calls: Array.isArray(runRes.data.tool_calls) ? runRes.data.tool_calls : [] }
      : null;

    const agentId = run?.agent_id ?? stateRes.data?.current_agent_id ?? null;
    let agentName: string | null = null;
    if (agentId) {
      const { data } = await supabase.from(AGENTS_TABLE).select('name').eq('id', agentId).maybeSingle();
      agentName = data?.name ?? null;
    }

    return {
      run,
      agentName,
      collected: (stateRes.data?.collected_data as Record<string, string>) || {},
      qualification: stateRes.data?.qualification ?? null,
      status: stateRes.data?.status ?? null,
    };
  },

  /** Números do topo da tela. Em sombra, `sent` precisa ser 0 — é a prova. */
  summarize(runs: WaRunEnriched[]): WaShadowSummary {
    const resumo: WaShadowSummary = {
      runs: runs.length,
      conversations: new Set(runs.map(r => r.conversation_id)).size,
      sent: 0, blocked: 0, handoffs: 0, errors: 0,
    };
    for (const r of runs) {
      if (r.executed) resumo.sent += 1;
      if (r.error) resumo.errors += 1;
      for (const t of r.tool_calls) {
        if (t.verdict === 'barrado') resumo.blocked += 1;
        if (t.name === 'transferir_humano') resumo.handoffs += 1;
      }
    }
    return resumo;
  },
};
