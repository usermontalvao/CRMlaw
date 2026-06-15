/**
 * whatsapp-ai-flow v2 — processa mensagens inbound de conversas em modo IA (Fase J + O).
 *
 * Auth: Bearer WA_AI_TOKEN (env). Chamado internamente pelo evolution-webhook
 * via EdgeRuntime.waitUntil. Pode também ser chamado manualmente p/ testes.
 *
 * Fase O: quando `require_human_approval=true` no canal, a edge NÃO envia
 * mensagens diretamente — salva o texto em `pending_ai_reply` e seta
 * session.status = 'pending_approval'. O agente humano revisa/aprova via
 * whatsapp-ai-approve (nova edge), que envia e avança o step.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const aiToken = Deno.env.get('WA_AI_TOKEN');
  if (aiToken) {
    const authHeader = req.headers.get('authorization') || '';
    const urlToken = new URL(req.url).searchParams.get('token');
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (bearer !== aiToken && urlToken !== aiToken) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body: { conversation_id?: string; message_text?: string };
  try { body = await req.json(); }
  catch { return new Response('Bad JSON', { status: 400 }); }

  const { conversation_id, message_text } = body;
  if (!conversation_id) {
    return new Response(JSON.stringify({ error: 'conversation_id required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const { data: conv } = await admin.from('whatsapp_conversations')
      .select('id, instance_id, remote_jid, contact_name, assigned_user_id, status, is_blocked')
      .eq('id', conversation_id)
      .maybeSingle();

    if (!conv) return ok({ skip: 'conversation not found' });
    if (conv.is_blocked) return ok({ skip: 'blocked' });
    if (conv.status === 'closed') return ok({ skip: 'closed' });
    if (conv.assigned_user_id) return ok({ skip: 'has human agent' });

    const { data: aiConfig } = await admin.from('whatsapp_ai_channel_config')
      .select('ai_enabled, max_ai_turns, playbook_id, require_human_approval')
      .eq('channel_id', conv.instance_id)
      .maybeSingle();

    if (!aiConfig?.ai_enabled) return ok({ skip: 'ai disabled for channel' });

    const requireApproval: boolean = aiConfig.require_human_approval === true;

    let { data: session } = await admin.from('whatsapp_ai_sessions')
      .select('*')
      .eq('conversation_id', conversation_id)
      .maybeSingle();

    if (!session) {
      const { data: ns, error: nsErr } = await admin.from('whatsapp_ai_sessions').insert({
        conversation_id,
        playbook_id: aiConfig.playbook_id || null,
        status: 'active',
        current_step: 0,
        collected_data: {},
        turn_count: 0,
      }).select('*').single();
      if (nsErr) throw new Error('session create: ' + nsErr.message);
      session = ns;
    }

    // Se estava pending_approval e nova msg chegou → cliente respondeu antes da aprovação.
    // Descarta o pendente e trata como active para não perder a resposta do cliente.
    if (session.status === 'pending_approval') {
      await admin.from('whatsapp_ai_sessions').update({
        status: 'active',
        pending_ai_reply: null,
        pending_ai_next_step: null,
      }).eq('id', session.id);
      session = { ...session, status: 'active', pending_ai_reply: null, pending_ai_next_step: null };
    }

    if (session.status !== 'active') return ok({ skip: 'session ' + session.status });

    const maxTurns = aiConfig.max_ai_turns || 5;
    if (session.turn_count >= maxTurns) {
      await doHandoff(admin, conv, session, null, requireApproval);
      return ok({ action: requireApproval ? 'pending_approval_handoff' : 'handoff_max_turns' });
    }

    let playbook: Record<string, any> | null = null;
    if (session.playbook_id) {
      const { data: pb } = await admin.from('whatsapp_ai_playbooks')
        .select('*').eq('id', session.playbook_id).maybeSingle();
      playbook = pb;
    }

    const questions: Array<{ key: string; label: string; required: boolean; type: string }> =
      playbook?.questions || [];
    const currentStep: number = session.current_step;
    const collectedData: Record<string, string> = { ...(session.collected_data || {}) };

    if (currentStep > 0 && message_text?.trim()) {
      const prevQ = questions[currentStep - 1];
      if (prevQ?.key) collectedData[prevQ.key] = message_text.trim();
    }

    const evoConfig = await getEvoConfig(admin);
    const { data: instRow } = await admin.from('whatsapp_instances')
      .select('instance_name').eq('id', conv.instance_id).maybeSingle();
    const instanceName: string = instRow?.instance_name || '';

    if (!playbook || questions.length === 0) {
      const fallbackText = 'Obrigado pelo contato! Em breve um membro da nossa equipe dará continuidade ao seu atendimento.';
      if (requireApproval) {
        await admin.from('whatsapp_ai_sessions').update({
          status: 'pending_approval',
          pending_ai_reply: fallbackText,
          pending_ai_next_step: -1, // -1 = handoff após aprovação
          collected_data: collectedData,
          turn_count: session.turn_count + 1,
        }).eq('id', session.id);
        return ok({ action: 'pending_approval', text: fallbackText });
      }
      await sendText(evoConfig, instanceName, conv.remote_jid, fallbackText);
      await admin.from('whatsapp_ai_sessions').update({
        collected_data: collectedData,
        turn_count: session.turn_count + 1,
      }).eq('id', session.id);
      await doHandoff(admin, conv, { ...session, collected_data: collectedData }, null, false);
      return ok({ action: 'handoff_no_playbook' });
    }

    if (currentStep === 0) {
      const firstQ = questions[0];
      const welcomeText = [playbook.welcome_message, firstQ?.label].filter(Boolean).join('\n\n');
      if (requireApproval) {
        await admin.from('whatsapp_ai_sessions').update({
          status: 'pending_approval',
          pending_ai_reply: welcomeText,
          pending_ai_next_step: 1,
          collected_data: collectedData,
          turn_count: session.turn_count + 1,
        }).eq('id', session.id);
        return ok({ action: 'pending_approval', text: welcomeText });
      }
      await sendText(evoConfig, instanceName, conv.remote_jid, welcomeText);
      await admin.from('whatsapp_ai_sessions').update({
        current_step: 1,
        turn_count: session.turn_count + 1,
        collected_data: collectedData,
      }).eq('id', session.id);
    } else if (currentStep < questions.length) {
      const nextQ = questions[currentStep];
      if (requireApproval) {
        await admin.from('whatsapp_ai_sessions').update({
          status: 'pending_approval',
          pending_ai_reply: nextQ.label,
          pending_ai_next_step: currentStep + 1,
          collected_data: collectedData,
          turn_count: session.turn_count + 1,
        }).eq('id', session.id);
        return ok({ action: 'pending_approval', text: nextQ.label });
      }
      await sendText(evoConfig, instanceName, conv.remote_jid, nextQ.label);
      await admin.from('whatsapp_ai_sessions').update({
        current_step: currentStep + 1,
        turn_count: session.turn_count + 1,
        collected_data: collectedData,
      }).eq('id', session.id);
    } else {
      const lastQ = questions[currentStep - 1];
      if (lastQ?.key && message_text?.trim()) collectedData[lastQ.key] = message_text.trim();
      await admin.from('whatsapp_ai_sessions').update({ collected_data: collectedData }).eq('id', session.id);
      await doHandoff(admin, conv, { ...session, collected_data: collectedData }, playbook, requireApproval);
      if (requireApproval) return ok({ action: 'pending_approval_handoff' });
    }

    return ok({ action: 'processed', step: session.current_step });
  } catch (err) {
    console.error('whatsapp-ai-flow error', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});

function ok(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getEvoConfig(admin: any): Promise<{ base_url: string; api_key: string } | null> {
  const { data } = await admin.from('system_settings')
    .select('value').eq('key', 'whatsapp_evolution_config').maybeSingle();
  const s = data?.value as { base_url?: string; api_key?: string } | null;
  if (!s?.base_url || !s?.api_key) return null;
  return { base_url: s.base_url.replace(/\/+$/, ''), api_key: s.api_key };
}

async function sendText(
  config: { base_url: string; api_key: string } | null,
  instanceName: string,
  remoteJid: string,
  text: string,
): Promise<void> {
  if (!config || !instanceName || !text.trim()) return;
  const res = await fetch(
    `${config.base_url}/message/sendText/${encodeURIComponent(instanceName)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.api_key },
      body: JSON.stringify({ number: remoteJid, text: text.trim() }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`sendText failed ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function doHandoff(
  admin: any,
  conv: Record<string, unknown>,
  session: Record<string, unknown>,
  playbook: Record<string, unknown> | null,
  requireApproval: boolean,
): Promise<void> {
  const handoffMsg: string = (playbook?.handoff_message as string)
    || 'Obrigado! Seu atendimento foi encaminhado para um dos nossos advogados. Em breve você será atendido.';

  const collectedData: Record<string, string> = (session.collected_data as Record<string, string>) || {};
  const questions: Array<{ key: string; label: string }> = (playbook?.questions as any[]) || [];

  const summaryLines = questions
    .filter(q => collectedData[q.key])
    .map(q => `• ${q.label.replace(/\?$/, '').trim()}: ${collectedData[q.key]}`);

  const summary = summaryLines.length > 0
    ? `🤖 **Dados coletados pelo assistente IA:**\n${summaryLines.join('\n')}`
    : '🤖 **Atendimento via assistente IA encerrado** — nenhum dado estruturado coletado.';

  if (requireApproval) {
    // Coloca handoff como mensagem pendente de aprovação
    await admin.from('whatsapp_ai_sessions').update({
      status: 'pending_approval',
      pending_ai_reply: handoffMsg,
      pending_ai_next_step: -1, // -1 = finalizar após aprovação
      collected_data: collectedData,
      handoff_summary: summary,
    }).eq('id', session.id as string);
    return;
  }

  const evoConfig = await getEvoConfig(admin);
  const { data: instRow } = await admin.from('whatsapp_instances')
    .select('instance_name').eq('id', conv.instance_id).maybeSingle();
  const instanceName: string = (instRow?.instance_name as string) || '';

  await sendText(evoConfig, instanceName, conv.remote_jid as string, handoffMsg);

  await admin.from('whatsapp_internal_notes').insert({
    conversation_id: conv.id,
    author_id: null,
    body: summary,
  }).catch((e: Error) => console.error('note insert error', e.message));

  await admin.from('whatsapp_ai_sessions').update({
    status: 'handed_off',
    ended_at: new Date().toISOString(),
    handoff_summary: summary,
    collected_data: collectedData,
    pending_ai_reply: null,
    pending_ai_next_step: null,
  }).eq('id', session.id as string);
}
