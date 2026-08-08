/**
 * whatsapp-agent — o motor do atendente de IA.
 *
 * Um ciclo por mensagem recebida: agrupa mensagens picadas, monta o contexto,
 * pergunta ao modelo, passa cada gatilho proposto pela cerca e registra tudo.
 *
 * Em modo SOMBRA nada é executado e nada é enviado: só escreve em
 * whatsapp_ai_runs o que teria feito. É esse log que decide se o atendente
 * merece permissão de falar.
 *
 * Chamado pelo evolution-webhook via EdgeRuntime.waitUntil, dentro de try/catch.
 * Se esta função inteira cair, a mensagem já está gravada e visível na inbox —
 * o atendimento humano não depende dela em momento nenhum.
 *
 * Ver docs/WHATSAPP_ATENDENTE_IA.md.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkToolCall, toolGate, toolsForAgent } from '../_shared/wa-agent-tools.ts';
import { executeTool, sendText, type ExecCtx } from '../_shared/wa-agent-executor.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const AI_TOKEN = Deno.env.get('WA_AI_TOKEN') ?? '';

const LOCK_SECONDS = 90;
const HISTORY_LIMIT = 24;

type Verdict =
  | 'executado'  // rodou e teve efeito
  | 'reservado'  // rodou, mas só criou pendência esperando autorização humana
  | 'barrado'    // a cerca recusou, ou a execução falhou
  | 'simulado'   // modo sombra: teria feito, não fez
  | 'aprovacao'; // segurado na fila, esperando alguém decidir

interface ToolLog {
  name: string;
  args: Record<string, unknown>;
  verdict: Verdict;
  detail?: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Falha FECHADA: a função sobe com verify_jwt=false (o webhook chama com token
  // interno, não com JWT de usuário), então a porta é esta. Sem WA_AI_TOKEN
  // configurado ela ainda aceita a service key — nunca fica aberta.
  {
    const auth = req.headers.get('authorization') || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const qs = new URL(req.url).searchParams.get('token') || '';
    const aceitos = [AI_TOKEN, SERVICE_KEY].filter(Boolean);
    if (!aceitos.includes(bearer) && !aceitos.includes(qs)) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body: { conversation_id?: string; message_text?: string; event_id?: string };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const convId = body.conversation_id;
  if (!convId) return json({ error: 'conversation_id required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const started = Date.now();

  try {
    // ── Guardas: quando o atendente não tem nada que fazer ────────────────
    const { data: conv } = await admin.from('whatsapp_conversations')
      .select('id, instance_id, client_id, contact_name, status, is_blocked, assigned_user_id')
      .eq('id', convId).maybeSingle();

    if (!conv) return json({ skip: 'conversa não encontrada' });
    if (conv.is_blocked) return json({ skip: 'contato bloqueado' });
    if (conv.status === 'closed') return json({ skip: 'conversa encerrada' });
    // Humano assumiu: a IA sai de cena e não volta sozinha.
    if (conv.assigned_user_id) return json({ skip: 'já tem atendente humano' });

    // ── Estado da conversa ────────────────────────────────────────────────
    let { data: state } = await admin.from('whatsapp_ai_agent_state')
      .select('*').eq('conversation_id', convId).maybeSingle();

    if (!state) {
      const { data: novo, error } = await admin.from('whatsapp_ai_agent_state')
        .insert({ conversation_id: convId }).select('*').single();
      if (error) throw new Error(`criar estado: ${error.message}`);
      state = novo;
    }

    if (['pausado', 'transferido', 'encerrado'].includes(state.status)) {
      return json({ skip: `estado ${state.status}` });
    }

    // Retry do webhook não vira segunda resposta.
    if (body.event_id && state.last_event_id === body.event_id) {
      return json({ skip: 'evento já processado' });
    }

    // ── Qual agente atende ────────────────────────────────────────────────
    const agent = await resolveAgent(admin, conv.instance_id, state.current_agent_id);
    if (!agent) return json({ skip: 'nenhum agente ativo para este canal' });

    if (state.turn_count >= agent.max_turns) {
      return json({ skip: 'limite de turnos atingido' });
    }

    // ── Agrupamento: esperar o cliente terminar de digitar ────────────────
    // Ele manda cinco mensagens picadas; responder à primeira atropela as
    // outras quatro. Cada invocação marca sua janela; se outra mensagem chegar,
    // a marca muda e esta invocação desiste — quem chegou depois responde.
    const debounceMs = Math.max(0, agent.debounce_seconds) * 1000;
    if (debounceMs > 0) {
      const marca = new Date(Date.now() + debounceMs).toISOString();
      await admin.from('whatsapp_ai_agent_state')
        .update({ debounce_until: marca }).eq('conversation_id', convId);

      await sleep(debounceMs);

      const { data: agora } = await admin.from('whatsapp_ai_agent_state')
        .select('debounce_until').eq('conversation_id', convId).maybeSingle();
      if (agora?.debounce_until !== marca) {
        return json({ skip: 'mensagem mais nova chegou; ela responde' });
      }
    }

    // ── Lock: um executor por conversa ────────────────────────────────────
    const agoraIso = new Date().toISOString();
    const ate = new Date(Date.now() + LOCK_SECONDS * 1000).toISOString();
    const { data: travou } = await admin.from('whatsapp_ai_agent_state')
      .update({ locked_until: ate })
      .eq('conversation_id', convId)
      .or(`locked_until.is.null,locked_until.lt.${agoraIso}`)
      .select('conversation_id');

    if (!travou || travou.length === 0) return json({ skip: 'outro ciclo em andamento' });

    try {
      // ── Contexto ────────────────────────────────────────────────────────
      const historico = await loadHistory(admin, convId);
      const inbound = (body.message_text || '').trim() || ultimaEntrada(historico);
      const sistema = await buildSystemPrompt(admin, agent, conv, state);

      const ferramentas = toolsForAgent(agent.allowed_tools || []);

      // ── Modelo ──────────────────────────────────────────────────────────
      const saida = await askModel(agent.model, sistema, historico, ferramentas);
      if (saida.error) throw new Error(saida.error);

      // ── Cerca: cada gatilho proposto passa por aqui ─────────────────────
      const modo: string = agent.mode;
      const exigeAprovacaoNoCanal = modo === 'aprovacao';
      const logs: ToolLog[] = [];

      const ctx: ExecCtx = {
        admin,
        conversationId: convId,
        channelId: conv.instance_id,
        clientId: conv.client_id,
        agentId: agent.id,
        supabaseUrl: SUPABASE_URL,
        serviceKey: SERVICE_KEY,
      };
      // Destino padrão do @TransferirHumano deste agente.
      (state as any).__handoff_user_id = agent.handoff_user_id;
      (state as any).__handoff_department_id = agent.handoff_department_id;

      // Ações que a barreira segurou. Viram linha em whatsapp_ai_tool_approvals
      // logo abaixo, já com a resposta que as acompanharia — mas só depois que
      // `resposta` existir, para que quem decide leia a ação junto da frase.
      const aSegurar: Array<{ name: string; args: Record<string, unknown>; risk: string }> = [];

      for (const call of saida.toolCalls) {
        const check = checkToolCall(call.name, agent.allowed_tools || []);
        if (!check.ok) {
          logs.push({ name: call.name, args: call.args, verdict: 'barrado', detail: check.reason });
          continue;
        }
        if (modo === 'sombra') {
          logs.push({ name: call.name, args: call.args, verdict: 'simulado' });
          continue;
        }

        const porta = toolGate(check.tool, exigeAprovacaoNoCanal);

        // `bloqueia`: não executa e ENFILEIRA. Antes daqui o veredito 'aprovacao'
        // era só uma palavra no log — a ação sumia sem que ninguém fosse chamado
        // para decidir. Enfileirar é o que transforma a barreira em aprovação.
        if (porta === 'bloqueia') {
          aSegurar.push({ name: call.name, args: call.args, risk: check.tool.risk });
          logs.push({
            name: call.name, args: call.args, verdict: 'aprovacao',
            detail: 'na fila de aprovação; nada foi feito ainda',
          });
          continue;
        }

        // `executa` e `reserva` rodam. A diferença é o que o gatilho consegue
        // produzir: o de reserva só sabe criar estado pendente e reversível.
        const r = await executeTool(ctx, call.name, call.args, state);
        logs.push({
          name: call.name, args: call.args,
          verdict: r.ok ? (porta === 'reserva' ? 'reservado' : 'executado') : 'barrado',
          detail: r.detail,
        });
      }

      // ── A resposta ──────────────────────────────────────────────────────
      const resposta = (saida.reply || '').trim();
      let enviou = false;
      let erroEnvio: string | null = null;

      if (aSegurar.length) {
        const { error: ae } = await admin.from('whatsapp_ai_tool_approvals').insert(
          aSegurar.map(p => ({
            conversation_id: convId,
            agent_id: agent.id,
            tool_name: p.name,
            args: p.args,
            risk: p.risk,
            reply_text: resposta || null,
          })),
        );
        // Falhar aqui é grave: significa ação de risco alto sem ninguém para
        // aprovar. Some no log em vez de passar batido.
        if (ae) {
          for (const l of logs) {
            if (l.verdict === 'aprovacao') l.detail = `NÃO ENFILEIRADO: ${ae.message}`;
          }
          console.error('whatsapp-agent: fila de aprovação falhou', ae.message);
        }
      }

      if (resposta) {
        if (modo === 'automatico' && state.status === 'ativo') {
          erroEnvio = await sendText(ctx, resposta);
          enviou = !erroEnvio;
        } else if (modo === 'aprovacao') {
          await admin.from('whatsapp_ai_agent_state').update({
            status: 'aguardando_aprovacao',
            pending_reply: resposta,
            pending_tools: logs.filter(l => l.verdict === 'aprovacao'),
          }).eq('conversation_id', convId);
        }
        // sombra: não envia, não guarda pendência — só o log abaixo.
      }

      await admin.from('whatsapp_ai_agent_state').update({
        turn_count: (state.turn_count ?? 0) + 1,
        last_event_id: body.event_id ?? null,
        locked_until: null,
      }).eq('conversation_id', convId);

      await admin.from('whatsapp_ai_runs').insert({
        conversation_id: convId,
        agent_id: agent.id,
        mode: modo,
        trigger_event_id: body.event_id ?? null,
        inbound_text: inbound,
        reply_text: resposta || null,
        tool_calls: logs,
        // 'reservado' conta como executado: gravou compromisso na agenda. Só
        // 'aprovacao' e 'simulado' são de fato "não aconteceu nada".
        executed: enviou || logs.some(l => l.verdict === 'executado' || l.verdict === 'reservado'),
        model: agent.model,
        tokens_in: saida.tokensIn,
        tokens_out: saida.tokensOut,
        latency_ms: Date.now() - started,
        error: erroEnvio,
      });

      return json({ ok: true, mode: modo, tools: logs.length, sent: enviou });

    } finally {
      await admin.from('whatsapp_ai_agent_state')
        .update({ locked_until: null }).eq('conversation_id', convId);
    }

  } catch (err) {
    const motivo = String(err instanceof Error ? err.message : err).slice(0, 500);
    console.error('whatsapp-agent', motivo);
    // Falha fechada: marca exceção e não tenta adivinhar. A inbox segue normal.
    await admin.from('whatsapp_ai_agent_state')
      .update({ status: 'excecao', exception_reason: motivo, locked_until: null })
      .eq('conversation_id', convId);
    await admin.from('whatsapp_ai_runs').insert({
      conversation_id: convId, mode: 'sombra', error: motivo,
      latency_ms: Date.now() - started,
    });
    return json({ error: motivo }, 500);
  }
});

// ── Peças ───────────────────────────────────────────────────────────────────

/** Agente da vez: o que já conduzia a conversa, senão o primário do canal. */
async function resolveAgent(admin: any, channelId: string | null, currentId: string | null) {
  if (currentId) {
    const { data } = await admin.from('whatsapp_ai_agents')
      .select('*').eq('id', currentId).eq('is_active', true).maybeSingle();
    if (data) return data;
  }
  if (!channelId) return null;
  const { data } = await admin.from('whatsapp_ai_agents')
    .select('*')
    .eq('channel_id', channelId).eq('is_active', true).eq('is_primary', true)
    .maybeSingle();
  return data;
}

async function loadHistory(admin: any, convId: string) {
  const { data } = await admin.from('whatsapp_messages')
    .select('direction, content, transcription_text, created_at')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  return (data || []).reverse().map((m: any) => ({
    // 'in'/'inbound' = cliente falando. Defensivo de propósito: o valor exato
    // do enum não deve derrubar o motor.
    role: String(m.direction || '').startsWith('in') ? 'user' : 'assistant',
    content: (m.content || m.transcription_text || '').trim(),
  })).filter((m: any) => m.content);
}

function ultimaEntrada(hist: Array<{ role: string; content: string }>): string {
  for (let i = hist.length - 1; i >= 0; i--) if (hist[i].role === 'user') return hist[i].content;
  return '';
}

/**
 * O prompt do agente é do escritório, em português. Aqui só se acrescenta o
 * que ele não teria como saber: etapas reais do funil, templates existentes,
 * e o que já foi coletado nesta conversa.
 */
async function buildSystemPrompt(admin: any, agent: any, conv: any, state: any): Promise<string> {
  const partes = [agent.prompt?.trim() || 'Você atende clientes de um escritório de advocacia no WhatsApp.'];

  if (conv.instance_id) {
    const { data: stages } = await admin.from('whatsapp_channel_funnel_stages')
      .select('label, position, is_active').eq('channel_id', conv.instance_id)
      .order('position');
    const ativas = (stages || []).filter((s: any) => s.is_active).map((s: any) => s.label);
    if (ativas.length) partes.push(`Etapas do funil deste canal, em ordem: ${ativas.join(' → ')}.`);
  }

  // Sem esta lista o @PassarPara é inútil: o modelo não teria como saber para
  // quem passar, e o executor barraria todo nome que ele inventasse. Os destinos
  // válidos vêm do banco, não do prompt escrito à mão — assim ligar ou desligar
  // um agente reconfigura o roteamento sozinho.
  if (conv.instance_id) {
    const { data: agentes } = await admin.from('whatsapp_ai_agents')
      .select('name, description, role')
      .eq('channel_id', conv.instance_id).eq('is_active', true).neq('id', agent.id);
    const lista = (agentes || [])
      .map((a: any) => `${a.name} (${a.description || a.role})`).join('; ');
    if (lista) partes.push(`Outros agentes deste canal, para quem você pode passar a conversa: ${lista}.`);
  }

  const { data: tpls } = await admin.from('whatsapp_templates')
    .select('name').eq('is_active', true);
  const nomes = (tpls || []).map((t: any) => t.name);
  if (nomes.length) partes.push(`Templates prontos disponíveis: ${nomes.join(', ')}.`);

  const coletado = state.collected_data || {};
  const chaves = Object.keys(coletado);
  if (chaves.length) {
    partes.push(`Já coletado nesta conversa: ${chaves.map(k => `${k}: ${coletado[k]}`).join('; ')}. Não pergunte de novo.`);
  }

  if (conv.contact_name) partes.push(`O contato está salvo como "${conv.contact_name}".`);

  partes.push(
    'Escreva como pessoa no WhatsApp: frases curtas, sem juridiquês, sem listas numeradas. ' +
    'Uma pergunta por vez. Nunca invente valor de honorários, prazo processual ou promessa de resultado.',
  );

  return partes.join('\n\n');
}

interface ModelOut {
  reply: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  tokensIn?: number;
  tokensOut?: number;
  error?: string;
}

async function askModel(
  model: string,
  system: string,
  history: Array<{ role: string; content: string }>,
  tools: unknown[],
): Promise<ModelOut> {
  if (!OPENAI_KEY) return { reply: '', toolCalls: [], error: 'OPENAI_API_KEY ausente' };

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [{ role: 'system', content: system }, ...history],
        ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { reply: '', toolCalls: [], error: `OpenAI ${res.status}: ${txt.slice(0, 200)}` };
    }

    const out = await res.json();
    const msg = out?.choices?.[0]?.message ?? {};
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

    return {
      reply: typeof msg.content === 'string' ? msg.content : '',
      toolCalls: calls.map((c: any) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(c?.function?.arguments || '{}'); } catch { /* argumento quebrado vira {} */ }
        return { name: c?.function?.name || '', args };
      }).filter((c: any) => c.name),
      tokensIn: out?.usage?.prompt_tokens,
      tokensOut: out?.usage?.completion_tokens,
    };
  } catch (err) {
    return { reply: '', toolCalls: [], error: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
}
