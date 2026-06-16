// WhatsApp — follow-up automático de ASSINATURA pendente (assinatura direta,
// criada fora do fluxo de kit). Dispara X tempo APÓS o cliente abrir e fechar a
// página pública de assinatura sem assinar, e repete em cadência.
//
// O follow-up de kit (whatsapp-template-fill-followup) só cobre template_fill_links;
// assinaturas diretas (sem link de preenchimento) ficavam sem nenhum lembrete.
// Esta função cobre exatamente esse caso, ancorando o tempo no momento em que o
// signatário deixou a página (last_seen_at), e pula quem já é coberto por um kit.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const TOKEN = Deno.env.get('WA_FOLLOWUP_TOKEN') || 'wa-followup-2026';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLIC_APP_ORIGIN = Deno.env.get('PUBLIC_APP_ORIGIN') || 'https://jurius.com.br';

const TZ = 'America/Cuiaba';
const BIZ_START = 8;
const BIZ_END = 18;
// TESTE: horário comercial DESLIGADO para podermos testar fora do expediente.
// Trocar para true antes do uso real com clientes.
const BUSINESS_HOURS_ENABLED = false;

// TESTE: lembrete a cada 10 minutos após o cliente sair da página sem assinar.
const STEP_INTERVAL_MIN = 10;
// Não pinga enquanto o cliente está AGORA na página (heartbeat recente).
const LIVE_WINDOW_MS = 30_000;
// Só lembra assinaturas criadas nos últimos N dias (evita ressuscitar antigas).
const MAX_AGE_DAYS = 30;
// A partir de qual lembrete passa a oferecer o opt-out ("digite NÃO").
const OPTOUT_FROM_REMINDER = 2;

const DECLINE_RE = /(n[ãa]o\s+(tenho|h[aá])\s+(mais\s+)?interesse|sem\s+interesse|n[ãa]o\s+quero(\s+mais)?|n[ãa]o\s+preciso(\s+mais)?|desist|pode\s+cancelar|cancela(r)?|parar?\s+de\s+(enviar|mandar)|n[ãa]o\s+vou\s+(enviar|mandar))/i;
const BARE_NO_RE = /^(n[ãa]o|nao)[\s.!,]*$/i;

// Copys variadas (rotacionam por etapa). Última etapa = encerramento educado.
const SIGN_COPIES: ((name: string, url: string, optout: boolean) => string)[] = [
  (n, url) => `Olá${n ? `, ${n}` : ''}! Vi que você abriu o documento para assinatura mas saiu sem concluir. Quando puder, é rapidinho finalizar por aqui:\n\n${url}`,
  (n, url, optout) => `Oi${n ? `, ${n}` : ''} 👋 Sua assinatura ainda está pendente — leva menos de 1 minuto pra concluir:\n\n${url}` + (optout ? `\n\nSe não tiver mais interesse, *digite NÃO* que eu encerro os lembretes.` : ''),
  (n, url, optout) => `${n || 'Olá'}, passando de novo sobre o documento que aguarda a sua assinatura. É só acessar e assinar:\n\n${url}` + (optout ? `\n\nCaso prefira não receber mais lembretes, *digite NÃO*.` : ''),
  (n, url, optout) => `Olá${n ? `, ${n}` : ''}! Ainda dá tempo de assinar o seu documento. Deixo o link novamente:\n\n${url}` + (optout ? `\n\nSe não for mais necessário, *digite NÃO*.` : ''),
  (n, url, optout) => `${n || 'Olá'}, este é o último lembrete por aqui sobre a assinatura pendente do seu documento:\n\n${url}` + (optout ? `\n\nSe preferir encerrar, *digite NÃO*.` : ''),
];
const MAX_STEPS = SIGN_COPIES.length;

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

  const force = url.searchParams.get('force') === '1';
  if (BUSINESS_HOURS_ENABLED && !force && !inBusinessHours()) {
    return json({ ok: true, skipped: 'fora do horário comercial' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = Date.now();
  const minCreated = new Date(now - MAX_AGE_DAYS * 86_400_000).toISOString();

  // Assinaturas pendentes candidatas a lembrete.
  const { data: reqs, error } = await admin
    .from('signature_requests')
    .select('id, client_id, client_name, document_name, public_token, status, signed_at, archived_at, deleted_at, blocked_at, wa_tracking_stopped, wa_followup_count, wa_followup_last_at, created_at')
    .eq('status', 'pending')
    .eq('wa_tracking_stopped', false)
    .is('archived_at', null)
    .is('deleted_at', null)
    .is('blocked_at', null)
    .not('client_id', 'is', null)
    .gte('created_at', minCreated)
    .limit(200);
  if (error) return json({ error: error.message }, 500);
  if (!reqs || reqs.length === 0) return json({ ok: true, processed: 0, sent: 0 });

  const reqIds = reqs.map((r: any) => r.id);

  // Signers (presença + estado) e links de kit (para não duplicar com o follow-up de kit).
  const [{ data: signers }, { data: links }] = await Promise.all([
    admin.from('signature_signers')
      .select('signature_request_id, status, public_token, viewed_at, opened_at, last_seen_at, signed_at, refused_at')
      .in('signature_request_id', reqIds),
    admin.from('template_fill_links')
      .select('signature_request_id, followup_stopped, status')
      .in('signature_request_id', reqIds),
  ]);

  const signersByReq = new Map<string, any[]>();
  for (const s of (signers || []) as any[]) {
    const b = signersByReq.get(s.signature_request_id) || [];
    b.push(s); signersByReq.set(s.signature_request_id, b);
  }
  // Requests ainda no PREENCHIMENTO do kit (link 'pending') → o follow-up de kit
  // cuida. Quando o link já está 'submitted', o cliente saiu do preenchimento e
  // está na ASSINATURA: o follow-up de kit ignora ('pending' only), então quem
  // assume daqui pra frente é ESTA função. Antes 'submitted' era tratado como
  // coberto e ninguém enviava (vão entre as duas funções).
  const coveredByKit = new Set<string>();
  for (const l of (links || []) as any[]) {
    if (l.signature_request_id && l.followup_stopped === false && l.status === 'pending') {
      coveredByKit.add(l.signature_request_id);
    }
  }

  let sent = 0, stopped = 0, skipped = 0;
  const details: any[] = [];

  for (const r of reqs as any[]) {
    try {
      if (coveredByKit.has(r.id)) { skipped++; continue; }

      const sgs = signersByReq.get(r.id) || [];
      // Concluída/recusada por algum signatário → encerra acompanhamento.
      if (sgs.some((s) => !!s.signed_at) || sgs.some((s) => !!s.refused_at) || r.signed_at) {
        await admin.from('signature_requests').update({ wa_tracking_stopped: true }).eq('id', r.id);
        stopped++; details.push({ id: r.id, result: 'completed_stopped' }); continue;
      }

      const pending = sgs.find((s) => s.status !== 'signed' && !s.refused_at) || sgs[0] || null;
      if (!pending) { skipped++; continue; }

      // Cliente AGORA na página → não interrompe; espera ele sair.
      const liveNow = !!pending.last_seen_at && (now - new Date(pending.last_seen_at).getTime() <= LIVE_WINDOW_MS);
      if (liveNow) { skipped++; details.push({ id: r.id, result: 'live_skip' }); continue; }

      const step = Number(r.wa_followup_count || 0);
      if (step >= MAX_STEPS) { skipped++; continue; }

      // Âncora do tempo: após o ÚLTIMO lembrete; senão, o momento em que saiu da
      // página (last_seen_at). Se nunca abriu, a criação do pedido.
      const anchorIso = r.wa_followup_last_at || pending.last_seen_at || pending.opened_at || r.created_at;
      const dueAt = new Date(anchorIso).getTime() + STEP_INTERVAL_MIN * 60_000;
      if (now < dueAt) { skipped++; continue; }

      // Conversa de WhatsApp do cliente (aberta e não bloqueada).
      const { data: conv } = await admin
        .from('whatsapp_conversations')
        .select('id, is_blocked, status, contact_name')
        .eq('client_id', r.client_id)
        .neq('status', 'closed')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (!conv || conv.is_blocked) { skipped++; details.push({ id: r.id, result: 'no_conversation' }); continue; }

      // Cliente sinalizou desinteresse desde o último lembrete → encerra.
      const since = r.wa_followup_last_at || r.created_at;
      const { data: ins } = await admin.from('whatsapp_messages')
        .select('content, transcription_text')
        .eq('conversation_id', conv.id).eq('direction', 'in')
        .gt('wa_timestamp', since).limit(30);
      const optOutShown = step >= OPTOUT_FROM_REMINDER;
      const declined = (ins || []).some((m: any) => {
        const t = `${m.content || ''} ${m.transcription_text || ''}`;
        return DECLINE_RE.test(t) || (optOutShown && BARE_NO_RE.test((m.content || '').trim()));
      });
      if (declined) {
        await admin.from('signature_requests').update({ wa_tracking_stopped: true }).eq('id', r.id);
        await admin.from('whatsapp_internal_notes').insert({
          conversation_id: conv.id, author_id: null,
          body: `🛑 Acompanhamento da assinatura cancelado: o cliente sinalizou que não quer mais assinar "${r.document_name || 'documento'}".`,
        });
        stopped++; details.push({ id: r.id, result: 'declined_stopped' }); continue;
      }

      const first = (conv.contact_name || r.client_name || '').split(' ')[0];
      const signUrl = pending.public_token
        ? `${PUBLIC_APP_ORIGIN}/#/assinar/${pending.public_token}`
        : `${PUBLIC_APP_ORIGIN}/#/assinar/${r.public_token}`;
      const text = SIGN_COPIES[step](first, signUrl, step + 1 >= OPTOUT_FROM_REMINDER);

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/evolution-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ conversation_id: conv.id, sender_user_id: null, text }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || j?.error) throw new Error(j?.error || `HTTP ${resp.status}`);

      await admin.from('signature_requests')
        .update({ wa_followup_count: step + 1, wa_followup_last_at: new Date().toISOString() })
        .eq('id', r.id);
      await admin.from('whatsapp_internal_notes').insert({
        conversation_id: conv.id, author_id: null,
        body: `🔔 Lembrete de assinatura pendente enviado (lembrete ${step + 1}/${MAX_STEPS}) para "${r.document_name || 'documento'}".`,
      });
      sent++; details.push({ id: r.id, result: 'sent', reminder: step + 1 });
    } catch (e) {
      details.push({ id: r.id, result: 'error', error: String((e as Error).message || e).slice(0, 300) });
    }
  }

  return json({ ok: true, processed: reqs.length, sent, stopped, skipped, details });
});
