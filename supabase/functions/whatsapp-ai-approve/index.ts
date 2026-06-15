/**
 * whatsapp-ai-approve — processa aprovação/rejeição humana de respostas IA (Fase O).
 *
 * Auth: JWT Supabase (authenticated). Chamado pelo CRM quando o agente revisa
 * uma resposta pendente de aprovação (`session.status = 'pending_approval'`).
 *
 * Body:
 *   session_id  string   — ID da whatsapp_ai_sessions
 *   action      'approve' | 'edit' | 'reject'
 *   edited_text string?  — apenas para action='edit'
 *
 * Aprovação/edição: envia o texto (original ou editado) via Evolution e avança
 *   o step. Se pending_ai_next_step = -1, executa handoff completo.
 * Rejeição: descarta o texto pendente, devolve sessão para 'active'.
 *   O agente humano assume a conversa manualmente.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface ApproveBody {
  session_id: string;
  action: 'approve' | 'edit' | 'reject';
  edited_text?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // JWT auth via Supabase
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { authorization: authHeader } } },
  );
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return new Response('Unauthorized', { status: 401 });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: ApproveBody;
  try { body = await req.json(); }
  catch { return new Response('Bad JSON', { status: 400 }); }

  const { session_id, action, edited_text } = body;
  if (!session_id || !action) {
    return new Response(JSON.stringify({ error: 'session_id and action required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: session } = await admin.from('whatsapp_ai_sessions')
    .select('*, whatsapp_conversations(id, instance_id, remote_jid, status)')
    .eq('id', session_id)
    .maybeSingle();

  if (!session) {
    return new Response(JSON.stringify({ error: 'session not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (session.status !== 'pending_approval') {
    return new Response(JSON.stringify({ error: 'session not pending approval', status: session.status }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
    });
  }

  const conv = session.whatsapp_conversations;
  if (!conv) {
    return new Response(JSON.stringify({ error: 'conversation not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Rejeição ─────────────────────────────────────────────────────────────
  if (action === 'reject') {
    await admin.from('whatsapp_ai_sessions').update({
      status: 'active',
      pending_ai_reply: null,
      pending_ai_next_step: null,
    }).eq('id', session_id);
    return ok({ action: 'rejected', note: 'Agent will handle manually' });
  }

  // ── Aprovação ou edição ───────────────────────────────────────────────────
  const textToSend = action === 'edit' && edited_text?.trim()
    ? edited_text.trim()
    : session.pending_ai_reply;

  if (!textToSend) {
    return new Response(JSON.stringify({ error: 'no pending reply to send' }), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    });
  }

  const nextStep: number = session.pending_ai_next_step ?? -1;

  // Enviar via Evolution
  const evoConfig = await getEvoConfig(admin);
  const { data: instRow } = await admin.from('whatsapp_instances')
    .select('instance_name').eq('id', conv.instance_id).maybeSingle();
  const instanceName: string = instRow?.instance_name || '';

  await sendText(evoConfig, instanceName, conv.remote_jid, textToSend);

  if (nextStep === -1) {
    // Handoff: criar nota e finalizar sessão
    const collectedData: Record<string, string> = session.collected_data || {};
    const summary: string = session.handoff_summary
      || '🤖 **Atendimento via assistente IA encerrado** (com aprovação humana).';

    await admin.from('whatsapp_internal_notes').insert({
      conversation_id: conv.id,
      author_id: user.id,
      body: summary,
    }).catch((e: Error) => console.error('note insert error', e.message));

    await admin.from('whatsapp_ai_sessions').update({
      status: 'handed_off',
      ended_at: new Date().toISOString(),
      handoff_summary: summary,
      collected_data: collectedData,
      pending_ai_reply: null,
      pending_ai_next_step: null,
    }).eq('id', session_id);

    return ok({ action: 'approved_handoff', sent: textToSend });
  }

  // Avançar step
  await admin.from('whatsapp_ai_sessions').update({
    status: 'active',
    current_step: nextStep,
    pending_ai_reply: null,
    pending_ai_next_step: null,
  }).eq('id', session_id);

  return ok({ action: 'approved', sent: textToSend, next_step: nextStep });
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
