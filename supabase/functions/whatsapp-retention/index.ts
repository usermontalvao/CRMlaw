// WhatsApp — rotina de retencao/limpeza (Fase 11).
// Descarta CONTEUDO e MIDIA de mensagens com mais de N meses (default 6),
// preservando os METADADOS operacionais (tipo, direcao, horarios, status,
// autoria). Pula conversas com guarda juridica (`legal_hold`). Remove os
// blobs do bucket `whatsapp-media` e registra tudo em whatsapp_retention_log.
//
// Seguranca: token na query + service role. Idempotente: so toca mensagens
// ainda nao purgadas (`retention_purged_at is null`). Processa em lote para
// nao estourar limites; chame de novo (ou deixe o cron) ate zerar o backlog.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const TOKEN = Deno.env.get('WA_RETENTION_TOKEN') || 'wa-retention-2026';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'whatsapp-media';
const BATCH = 500;

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get('token') !== TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const months = Math.max(1, Math.min(120, Number(url.searchParams.get('months')) || 6));
  const dryRun = url.searchParams.get('dry_run') === '1';
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffIso = cutoff.toISOString();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Candidatas: antigas, com midia ainda no storage, nao purgadas, e cuja
  // conversa NAO esteja sob guarda juridica.
  const { data: msgs, error } = await admin
    .from('whatsapp_messages')
    .select('id, storage_path, whatsapp_conversations!inner(legal_hold)')
    .lt('wa_timestamp', cutoffIso)
    .is('retention_purged_at', null)
    .not('storage_path', 'is', null)
    .eq('whatsapp_conversations.legal_hold', false)
    .order('wa_timestamp', { ascending: true })
    .limit(BATCH);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const rows = (msgs || []) as Array<{ id: string; storage_path: string }>;
  const errors: string[] = [];

  if (dryRun) {
    return new Response(JSON.stringify({ ok: true, dry_run: true, cutoff: cutoffIso, months, candidates: rows.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1) Remove os blobs do bucket (em lote).
  let mediaPurged = 0;
  const paths = rows.map(r => r.storage_path).filter(Boolean);
  if (paths.length) {
    const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths);
    if (rmErr) errors.push(`storage.remove: ${rmErr.message}`);
    else mediaPurged = paths.length;
  }

  // 2) Limpa o conteudo no banco preservando metadados; marca como purgada.
  let messagesPurged = 0;
  if (rows.length) {
    const ids = rows.map(r => r.id);
    const { error: upErr, count } = await admin
      .from('whatsapp_messages')
      .update({ content: null, transcription_text: null, storage_path: null, retention_purged_at: new Date().toISOString() }, { count: 'exact' })
      .in('id', ids);
    if (upErr) errors.push(`messages.update: ${upErr.message}`);
    else messagesPurged = count ?? ids.length;
  }

  // 3) Auditoria da rodada.
  await admin.from('whatsapp_retention_log').insert({
    cutoff: cutoffIso,
    months,
    messages_purged: messagesPurged,
    media_purged: mediaPurged,
    held_skipped: 0,
    details: errors.length ? { errors } : null,
  });

  return new Response(JSON.stringify({
    ok: errors.length === 0, cutoff: cutoffIso, months,
    messages_purged: messagesPurged, media_purged: mediaPurged,
    more: rows.length === BATCH, errors,
  }), { headers: { 'Content-Type': 'application/json' } });
});
