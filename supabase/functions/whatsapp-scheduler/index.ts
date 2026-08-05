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

// ── Política da retenção por reconexão ──────────────────────────────────────
// A retida volta sozinha quando o canal reconecta, mas um canal pode estar morto
// (sessão caída há semanas, esperando QR). Sem teto, cada mensagem presa ficava
// batendo na Evolution de minuto em minuto para sempre — e o atendente nunca
// descobria que aquilo não ia sair.
const MAX_HOLD_MS = 12 * 60 * 60_000;

/** Espaça as tentativas conforme a espera cresce: 1min → 5min → 15min → 30min. */
function proximaTentativaMs(esperaMs: number): number {
  if (esperaMs < 5 * 60_000) return 60_000;
  if (esperaMs < 30 * 60_000) return 5 * 60_000;
  if (esperaMs < 2 * 60 * 60_000) return 15 * 60_000;
  return 30 * 60_000;
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
    .select('id, conversation_id, type, body, storage_path, mime_type, file_name, created_by, hold_since, whatsapp_conversations(is_blocked, status)')
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(25);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let sent = 0, failed = 0, skipped = 0;
  for (const candidate of (due || []) as any[]) {
    // Revalida imediatamente antes de enviar. A inbox pode ter movido esta
    // retenção para outro canal depois que a consulta do lote rodou; sem este
    // segundo olhar, o cron ainda usaria o retrato velho e poderia entregar a
    // mesma mensagem pelo número antigo enquanto a troca já a envia pelo novo.
    const { data: latest, error: latestError } = await admin
      .from('whatsapp_scheduled_messages')
      .select('id, conversation_id, type, body, storage_path, mime_type, file_name, created_by, hold_since, whatsapp_conversations(is_blocked, status)')
      .eq('id', candidate.id)
      .eq('status', 'pending')
      .lte('scheduled_at', nowIso)
      .maybeSingle();
    if (latestError || !latest) { skipped++; continue; }
    const m = latest as any;
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
        .update({ status: 'sent', sent_at: new Date().toISOString(), error: null, hold_reason: null, hold_since: null })
        .eq('id', m.id);
      sent++;
    } catch (e) {
      const message = String((e as Error).message || e);
      if (isReconnectPending((e as { reconnectPending?: boolean })?.reconnectPending, message)) {
        // Retida: volta sozinha quando o canal reconectar. `hold_since` guarda o
        // início da espera (na primeira retenção) para espaçar as tentativas e
        // desistir quando passa do teto — canal que não volta em 12h precisa de
        // gente (revalidar o QR), não de mais uma tentativa por minuto.
        const desde = m.hold_since ? new Date(m.hold_since).getTime() : Date.now();
        const espera = Date.now() - desde;
        if (espera >= MAX_HOLD_MS) {
          await admin.from('whatsapp_scheduled_messages')
            .update({
              status: 'failed',
              // Mantém a origem para a sirene do autor continuar acesa. Limpar
              // aqui faria o alerta sumir justamente quando a mensagem desistiu
              // de vez e mais precisa de ação humana.
              hold_reason: 'reconnect',
              error: 'O canal ficou fora do ar por mais de 12h e a mensagem não foi enviada. Revalide o número em Configurações → Integrações → WhatsApp, ou envie por outro canal.',
            })
            .eq('id', m.id);
          failed++;
          continue;
        }
        await admin.from('whatsapp_scheduled_messages')
          .update({
            status: 'pending',
            hold_reason: 'reconnect',
            hold_since: new Date(desde).toISOString(),
            error: 'Aguardando reconexão automática do canal.',
            scheduled_at: new Date(Date.now() + proximaTentativaMs(espera)).toISOString(),
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
