// WhatsApp — follow-up automático de documentos faltantes.
//
// Para cada solicitação de documento ABERTA (pending/partial) com follow-up ativo,
// envia um lembrete pelo WhatsApp listando só os itens que ainda faltam, numa
// cadência ESCALÁVEL (1d, 3d, 7d, 14d, 30d). Respeita horário comercial
// (08–18, seg–sex, America/Cuiaba). Se o cliente sinalizar que não tem mais
// interesse, cancela o follow-up. Chamado por pg_cron (token na query).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const TOKEN = Deno.env.get('WA_FOLLOWUP_TOKEN') || 'wa-followup-2026';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TZ = 'America/Cuiaba';
const BIZ_START = 8, BIZ_END = 18; // 08:00–18:00, seg–sex

// Quando enviar cada lembrete: minutos desde a criação da solicitação. Escalável.
// PRODUÇÃO: 1d, 3d, 7d, 14d, 30d.
const STEP_OFFSETS_MIN = [1, 3, 7, 14, 30].map(d => d * 1440);
// TESTE (rápido, minutos): const STEP_OFFSETS_MIN = [5, 20, 45, 80, 155];

// Janela para enviar um passo. Evita disparar lembretes muito atrasados em
// solicitações antigas recém-incluídas (elas avançam o contador sem enviar).
// PRODUÇÃO: 72h (cobre fim de semana sem perder um lembrete). Teste: 180.
const GRACE_MIN = 72 * 60;

// A partir deste lembrete, a mensagem passa a oferecer o opt-out ("digite NÃO")
// — só quando o cliente já está "saturado" de avisos, não nos primeiros.
const OPTOUT_FROM_REMINDER = 3;

// Sinais de desinteresse do cliente → cancela o follow-up.
const DECLINE_RE = /(n[ãa]o\s+(tenho|h[áa])\s+(mais\s+)?interesse|sem\s+interesse|n[ãa]o\s+quero(\s+mais)?|n[ãa]o\s+preciso(\s+mais)?|desist|pode\s+cancelar|cancela(r)?|parar?\s+de\s+(enviar|mandar)|n[ãa]o\s+vou\s+(enviar|mandar))/i;
// "não" seco — só vale como opt-out depois que a instrução "digite NÃO" foi enviada.
const BARE_NO_RE = /^(n[ãa]o|nao)[\s.!,]*$/i;

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
}

function inBusinessHours(d = new Date()): boolean {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const wd = p.find(x => x.type === 'weekday')?.value || '';
  const hour = parseInt(p.find(x => x.type === 'hour')?.value || '0', 10);
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(wd);
  return weekday && hour >= BIZ_START && hour < BIZ_END;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get('token') !== TOKEN) return json({ error: 'unauthorized' }, 401);

  const force = url.searchParams.get('force') === '1'; // teste: ignora horário comercial
  if (!force && !inBusinessHours()) return json({ ok: true, skipped: 'fora do horário comercial' });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = Date.now();

  const { data: reqs, error } = await admin.from('document_requests')
    .select('id, client_id, title, created_at, followup_count, followup_last_at, followup_stopped, status')
    .in('status', ['pending', 'partial'])
    .eq('followup_stopped', false)
    .limit(200);
  if (error) return json({ error: error.message }, 500);

  let sent = 0, stopped = 0, skipped = 0, advanced = 0;
  const details: any[] = [];

  for (const r of (reqs || []) as any[]) {
    try {
      const step = r.followup_count as number;
      if (step >= STEP_OFFSETS_MIN.length) { skipped++; continue; } // esgotou (máx ~30d)

      const created = new Date(r.created_at).getTime();
      const stepTime = created + STEP_OFFSETS_MIN[step] * 60_000;
      if (now < stepTime) { skipped++; continue; } // ainda não chegou a hora deste lembrete

      // Passo muito atrasado (ex.: solicitação antiga) → avança sem enviar (anti-spam).
      if (now - stepTime > GRACE_MIN * 60_000) {
        await admin.from('document_requests').update({ followup_count: step + 1 }).eq('id', r.id);
        advanced++; continue;
      }

      // Itens que ainda dependem do cliente (não recebidos / recusados).
      const { data: items } = await admin.from('document_request_items')
        .select('label, status').eq('request_id', r.id);
      const missing = (items || []).filter((i: any) => i.status === 'pending' || i.status === 'rejected');
      if (missing.length === 0) { skipped++; continue; }

      // Conversa do cliente (mais recente).
      const { data: convs } = await admin.from('whatsapp_conversations')
        .select('id, is_blocked, contact_name, last_message_at')
        .eq('client_id', r.client_id)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1);
      const conv = (convs || [])[0];
      if (!conv) { skipped++; details.push({ id: r.id, result: 'sem_conversa' }); continue; }
      if (conv.is_blocked) { skipped++; continue; }

      // Cliente sinalizou desinteresse desde o último contato? → cancela follow-up.
      const since = r.followup_last_at || r.created_at;
      const { data: ins } = await admin.from('whatsapp_messages')
        .select('content, transcription_text')
        .eq('conversation_id', conv.id).eq('direction', 'in')
        .gt('wa_timestamp', since).limit(30);
      const optOutShown = step >= OPTOUT_FROM_REMINDER; // já enviamos a instrução "digite NÃO"?
      const declined = (ins || []).some((m: any) => {
        const t = `${m.content || ''} ${m.transcription_text || ''}`;
        return DECLINE_RE.test(t) || (optOutShown && BARE_NO_RE.test((m.content || '').trim()));
      });
      if (declined) {
        await admin.from('document_requests').update({ followup_stopped: true }).eq('id', r.id);
        await admin.from('whatsapp_internal_notes').insert({ conversation_id: conv.id, author_id: null,
          body: `🛑 Follow-up de documentos cancelado: o cliente sinalizou que não tem mais interesse. Revise a solicitação "${r.title}".` });
        stopped++; details.push({ id: r.id, result: 'declined_stopped' });
        continue;
      }

      // Monta e envia o lembrete (só os itens que faltam).
      const first = (conv.contact_name || '').split(' ')[0];
      const list = missing.map((i: any) => `• ${i.label}`).join('\n');
      const optOut = (step + 1) >= OPTOUT_FROM_REMINDER; // este lembrete já é "saturado"?
      const text = `Olá${first ? `, ${first}` : ''}! Ainda estamos no aguardo do(s) seguinte(s) documento(s) para dar andamento ao seu atendimento:\n\n${list}\n\nPode nos enviar por aqui mesmo?` +
        (optOut ? `\n\nCaso não tenha mais interesse, *digite NÃO* para não receber mais lembretes.` : '');

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/evolution-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ conversation_id: conv.id, sender_user_id: null, text }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || j?.error) throw new Error(j?.error || `HTTP ${resp.status}`);

      await admin.from('document_requests')
        .update({ followup_count: step + 1, followup_last_at: new Date().toISOString() })
        .eq('id', r.id);
      await admin.from('whatsapp_internal_notes').insert({ conversation_id: conv.id, author_id: null,
        body: `🔔 Follow-up automático de documentos enviado (lembrete ${step + 1}): ${missing.map((i: any) => i.label).join(', ')}.` });
      sent++; details.push({ id: r.id, result: 'sent', reminder: step + 1, items: missing.length });
    } catch (e) {
      details.push({ id: r.id, result: 'error', error: String((e as Error).message || e).slice(0, 300) });
    }
  }

  return json({ ok: true, processed: (reqs || []).length, sent, stopped, advanced, skipped, details });
});
