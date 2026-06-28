// WhatsApp — dispatcher de mensagens agendadas (Fase 8.1).
// Chamada por pg_cron a cada minuto (token na query). Pega as mensagens
// `pending` vencidas e dispara via evolution-send (service role). Marca
// sent/failed e trata conversa bloqueada com regra clara.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const TOKEN = Deno.env.get('WA_SCHEDULER_TOKEN') || 'wa-scheduler-2026';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Detecção robusta de "canal fora": prioriza a flag estruturada que o
// evolution-send devolve (reconnect_pending) e cai no texto só por compatibilidade.
function isReconnectPending(flag: unknown, message: string): boolean {
  if (flag === true) return true;
  const lower = (message || '').toLowerCase();
  return lower.includes('canal desconectado')
    || lower.includes('reconectando automaticamente')
    || lower.includes('aguarde alguns segundos')
    || lower.includes('não reconectou sozinho');
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get('token') !== TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const nowIso = new Date().toISOString();

  // Mensagens vencidas, com o estado de bloqueio da conversa-pai.
  const { data: due, error } = await admin
    .from('whatsapp_scheduled_messages')
    .select('id, conversation_id, type, body, storage_path, mime_type, file_name, created_by, whatsapp_conversations(is_blocked, status)')
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(25);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let sent = 0, failed = 0, skipped = 0;
  for (const m of (due || []) as any[]) {
    const conv = m.whatsapp_conversations || {};
    // Conversa bloqueada → não envia; marca falha com motivo claro.
    if (conv.is_blocked) {
      await admin.from('whatsapp_scheduled_messages')
        .update({ status: 'failed', error: 'Conversa bloqueada no momento do disparo.' })
        .eq('id', m.id);
      failed++; continue;
    }

    const payload: Record<string, unknown> = { conversation_id: m.conversation_id, sender_user_id: m.created_by ?? null };
    if (m.type && m.type !== 'text') {
      payload.type = m.type;
      payload.storage_path = m.storage_path;
      payload.mime_type = m.mime_type;
      payload.file_name = m.file_name;
      if (m.body) payload.text = m.body;
    } else {
      payload.text = m.body || '';
    }

    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/evolution-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify(payload),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || j?.error) {
        const err = new Error(j?.error || `HTTP ${resp.status}`) as Error & { reconnectPending?: boolean };
        if (j?.reconnect_pending === true) err.reconnectPending = true;
        throw err;
      }
      await admin.from('whatsapp_scheduled_messages')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
        .eq('id', m.id);
      sent++;
    } catch (e) {
      const message = String((e as Error).message || e);
      if (isReconnectPending((e as { reconnectPending?: boolean })?.reconnectPending, message)) {
        // Mantém retida e re-tenta em ~1min; marca a origem para a UI distinguir.
        await admin.from('whatsapp_scheduled_messages')
          .update({
            status: 'pending',
            hold_reason: 'reconnect',
            error: 'Aguardando reconexão automática do canal.',
            scheduled_at: new Date(Date.now() + 60_000).toISOString(),
          })
          .eq('id', m.id);
        skipped++;
        continue;
      }
      await admin.from('whatsapp_scheduled_messages')
        .update({ status: 'failed', error: message.slice(0, 500) })
        .eq('id', m.id);
      failed++;
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: (due || []).length, sent, failed, skipped }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
