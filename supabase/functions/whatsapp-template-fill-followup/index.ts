// WhatsApp — follow-up automático de links de preenchimento/assinatura.
//
// Replica a lógica do follow-up de documentos, mas focado no link público
// /#/preencher/:token enquanto o cliente ainda não concluiu o preenchimento.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { jobTokenOk, naoAutorizado } from '../_shared/job-token.ts';
import { criarPortaoDeExpediente } from '../_shared/wa-channel-hours.ts';


const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Origem pública do app para montar o link /#/preencher/:token. Em produção,
// defina o secret PUBLIC_APP_ORIGIN; o fallback aponta para o domínio real
// (não localhost) para nunca enviar um link quebrado ao cliente.
const PUBLIC_APP_ORIGIN = Deno.env.get('PUBLIC_APP_ORIGIN') || 'https://jurius.com.br';

// Produção: 4h, 1d, 3d, 7d e 14d desde o envio do KIT. A função só envia
// dentro do expediente DO CANAL da conversa (antes, um 08–18/Cuiabá cravado
// aqui, igual nos outros dois arquivos de cobrança); a janela de 72h atravessa fins de semana sem perder a
// tentativa e evita ressuscitar links antigos com vários avisos de uma vez.
const STEP_OFFSETS_MIN = [4 * 60, 24 * 60, 3 * 1440, 7 * 1440, 14 * 1440];
const GRACE_MIN = 72 * 60;
const OPTOUT_FROM_REMINDER = 3;

const DECLINE_RE = /(n[ãa]o\s+(tenho|h[aá])\s+(mais\s+)?interesse|sem\s+interesse|n[ãa]o\s+quero(\s+mais)?|n[ãa]o\s+preciso(\s+mais)?|desist|pode\s+cancelar|cancela(r)?|parar?\s+de\s+(enviar|mandar)|n[ãa]o\s+vou\s+(enviar|mandar))/i;
const BARE_NO_RE = /^(n[ãa]o|nao)[\s.!,]*$/i;

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (!await jobTokenOk('wa_followup_token', req)) return naoAutorizado();

  const force = url.searchParams.get('force') === '1';

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  // O expediente é decidido por conversa, depois de saber o canal dela — por
  // isso a varredura não para mais na porta. O passo perdido volta na rodada
  // seguinte: `GRACE_MIN` são 72h, folga que já existia para o fim de semana.
  const canalPodeFalarAgora = criarPortaoDeExpediente(admin);
  const now = Date.now();

  const { data: rows, error } = await admin
    .from('template_fill_links')
    .select('id, public_token, client_id, conversation_id, created_at, opened_at, followup_count, followup_last_at, followup_stopped, status, signature_request_id, document_templates(name)')
    .eq('status', 'pending')
    .eq('followup_stopped', false)
    .not('conversation_id', 'is', null)
    .limit(200);

  if (error) return json({ error: error.message }, 500);

  let sent = 0, stopped = 0, skipped = 0, advanced = 0;
  const details: any[] = [];

  for (const r of (rows || []) as any[]) {
    try {
      const step = Number(r.followup_count || 0);
      if (step >= STEP_OFFSETS_MIN.length) { skipped++; continue; }

      const created = new Date(r.created_at).getTime();
      const stepTime = created + STEP_OFFSETS_MIN[step] * 60_000;
      if (now < stepTime) { skipped++; continue; }

      if (now - stepTime > GRACE_MIN * 60_000) {
        await admin.from('template_fill_links').update({ followup_count: step + 1 }).eq('id', r.id);
        advanced++; continue;
      }

      const { data: conv } = await admin
        .from('whatsapp_conversations')
        .select('id, is_blocked, contact_name, instance_id')
        .eq('id', r.conversation_id)
        .maybeSingle();
      if (!conv || conv.is_blocked) { skipped++; continue; }
      if (!force && !await canalPodeFalarAgora(conv.instance_id)) { skipped++; continue; }

      if (r.signature_request_id) {
        const [{ data: req }, { data: signers }] = await Promise.all([
          admin
            .from('signature_requests')
            .select('id, status, signed_at')
            .eq('id', r.signature_request_id)
            .maybeSingle(),
          admin
            .from('signature_signers')
            .select('status, signed_at, refused_at')
            .eq('signature_request_id', r.signature_request_id),
        ]);
        const done = req?.status === 'signed'
          || req?.status === 'refused'
          || !!req?.signed_at
          || (signers || []).some((signer: any) => !!signer.signed_at || !!signer.refused_at);
        if (done) {
          await admin.from('template_fill_links').update({ followup_stopped: true }).eq('id', r.id);
          stopped++; details.push({ id: r.id, result: 'completed_stopped' });
          continue;
        }
      }

      const since = r.followup_last_at || r.created_at;
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
        await admin.from('template_fill_links').update({ followup_stopped: true }).eq('id', r.id);
        await admin.from('whatsapp_internal_notes').insert({
          conversation_id: conv.id,
          author_id: null,
          body: `🛑 Acompanhamento do kit cancelado: o cliente sinalizou que não quer mais seguir com o link "${r.document_templates?.name || 'Kit'}".`,
        });
        stopped++; details.push({ id: r.id, result: 'declined_stopped' });
        continue;
      }

      const first = (conv.contact_name || '').split(' ')[0];
      const fillUrl = `${PUBLIC_APP_ORIGIN}/#/preencher/${r.public_token}`;
      const opened = !!r.opened_at;
      const text = opened
        ? `Olá${first ? `, ${first}` : ''}! Vi que você já abriu o link do seu kit, mas ele ainda não foi concluído. Se precisar, segue novamente para continuar o preenchimento e assinatura:\n\n${fillUrl}`
        : `Olá${first ? `, ${first}` : ''}! Estou passando para lembrar do link de preenchimento e assinatura do seu kit. Você pode concluir por aqui:\n\n${fillUrl}`
          + (step + 1 >= OPTOUT_FROM_REMINDER ? `\n\nCaso não tenha mais interesse, *digite NÃO* para não receber mais lembretes.` : '');

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/evolution-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ conversation_id: conv.id, sender_user_id: null, text }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || j?.error) throw new Error(j?.error || `HTTP ${resp.status}`);

      await admin.from('template_fill_links')
        .update({ followup_count: step + 1, followup_last_at: new Date().toISOString() })
        .eq('id', r.id);
      await admin.from('whatsapp_internal_notes').insert({
        conversation_id: conv.id,
        author_id: null,
        body: `🔔 Follow-up automático do kit enviado (lembrete ${step + 1}) para "${r.document_templates?.name || 'Kit'}".`,
      });
      sent++; details.push({ id: r.id, result: 'sent', reminder: step + 1 });
    } catch (e) {
      details.push({ id: r.id, result: 'error', error: String((e as Error).message || e).slice(0, 300) });
    }
  }

  return json({ ok: true, processed: (rows || []).length, sent, stopped, advanced, skipped, details });
});
