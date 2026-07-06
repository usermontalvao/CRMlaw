// ============================================================================
// FASE 1 — Orquestrador de finalização server-side da assinatura.
// ----------------------------------------------------------------------------
// Responsabilidade (tira o controle do cliente):
//   1. Reler cada PDF assinado do Storage e RECALCULAR o SHA-256 no servidor (A1).
//   2. Detectar sobrescrita indevida de artefato já finalizado (A4).
//   3. Verificar que todos assinaram e que todos os documentos estão persistidos.
//   4. Só então flipar o envelope para 'signed', registrar 'finalized' no log
//      tamper-evident e disparar e-mail/webhook UMA única vez.
//   5. Refletir progresso por etapas na tabela signature_finalization_jobs.
//
// Idempotente e retomável: pode ser chamada quantas vezes for; nunca duplica
// e-mail nem documento. Chamável pelo fluxo público (anon + token) e interno.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const SIGNED_BUCKET = 'assinados';
const LOCK_TTL_MS = 120_000; // 2 min: além disso o lock é considerado órfão

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function generateVerificationHash(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

type Supa = ReturnType<typeof createClient>;

async function audit(supabase: Supa, requestId: string, signerId: string | null, action: string, description: string, ip?: string | null, ua?: string | null) {
  try {
    await supabase.from('signature_audit_log').insert({
      signature_request_id: requestId, signer_id: signerId, action,
      description: description.slice(0, 1000), ip_address: ip ?? null, user_agent: ua ?? null,
    });
  } catch (e) { console.error('audit insert failed', e); }
}

async function setJob(supabase: Supa, jobId: string, patch: Record<string, unknown>) {
  await supabase.from('signature_finalization_jobs').update(patch).eq('id', jobId);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ success: false, error: 'Supabase env not configured' }, 500);
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let payload: any = null;
    try { payload = JSON.parse((await req.text()) || '{}'); }
    catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

    const token = payload?.token as string | undefined;
    const origin = String(payload?.origin ?? 'https://jurius.com.br').trim().replace(/\/$/, '') || 'https://jurius.com.br';
    const ip = payload?.ip_address ?? null;
    const ua = payload?.user_agent ?? null;

    // Resolver envelope: por token (público) ou request_id direto (interno).
    let requestId: string | null = payload?.request_id ?? null;
    let signerId: string | null = null;
    if (!requestId && token) {
      const { data: signer } = await supabase.from('signature_signers')
        .select('id, signature_request_id').eq('public_token', token).maybeSingle();
      if (!signer) return jsonResponse({ success: false, error: 'Signer not found' }, 404);
      requestId = signer.signature_request_id; signerId = signer.id;
    }
    if (!requestId) return jsonResponse({ success: false, error: 'token or request_id required' }, 400);

    // Lifecycle guard (mesmas regras do public-sign-document).
    const { data: request0 } = await supabase.from('signature_requests')
      .select('id, status, deleted_at, archived_at, blocked_at, attachment_paths, document_name, created_by, envelope_verification_code, signature_model')
      .eq('id', requestId).maybeSingle();
    if (!request0) return jsonResponse({ success: false, error: 'Request not found' }, 404);
    if (request0.deleted_at || request0.archived_at || request0.blocked_at) {
      return jsonResponse({ success: false, error: 'Envelope indisponível' }, 403);
    }

    // Já finalizado? Resposta idempotente imediata — ANTES de enfileirar, para
    // não criar job órfão em envelopes que já estão 'signed'.
    if (request0.status === 'signed') {
      return jsonResponse({ success: true, finalized: true, request_status: 'signed' });
    }

    const expectedCount = Math.max(1, 1 + (Array.isArray(request0.attachment_paths) ? request0.attachment_paths.length : 0));

    // Enfileira (idempotente) e reivindica o lock do job.
    const { data: jobIdData } = await supabase.rpc('enqueue_signature_finalization', {
      p_request_id: requestId, p_expected_document_count: expectedCount,
    });
    const jobId = jobIdData as string;
    if (!jobId) return jsonResponse({ success: false, error: 'Could not enqueue job' }, 500);

    const nowIso = new Date().toISOString();
    const lockExpiry = new Date(Date.now() + LOCK_TTL_MS).toISOString();
    const { data: claimed } = await supabase.from('signature_finalization_jobs')
      .update({ status: 'running', stage: 'verificando documentos', locked_at: nowIso, lock_expires_at: lockExpiry, locked_by: 'edge' })
      .eq('id', jobId)
      .in('status', ['queued', 'running'])
      .or(`lock_expires_at.is.null,lock_expires_at.lt.${nowIso}`)
      .select().maybeSingle();
    if (!claimed) {
      // Outro worker está processando: devolve status corrente para o polling.
      const { data: cur } = await supabase.from('signature_finalization_jobs').select('status, stage, progress').eq('id', jobId).maybeSingle();
      return jsonResponse({ success: true, finalized: false, job_id: jobId, in_progress: true, ...cur });
    }

    try {
      // 1) Carregar documentos persistidos e signatários.
      const [{ data: docs }, { data: signers }] = await Promise.all([
        supabase.from('signature_request_documents')
          .select('id, document_key, signed_file_path, signed_pdf_sha256, hash_source')
          .eq('signature_request_id', requestId).not('signed_file_path', 'is', null),
        supabase.from('signature_signers').select('id, status').eq('signature_request_id', requestId),
      ]);

      const allSigned = !!signers?.length && signers.every((s: any) => s.status === 'signed');

      // 2) Re-hash server-side (A1) + detecção de sobrescrita (A4).
      await setJob(supabase, jobId, { status: 'hashing', stage: 'recalculando hashes', progress: 20 });
      let persisted = 0;
      for (const d of (docs ?? [])) {
        const { data: blob, error: dlErr } = await supabase.storage.from(SIGNED_BUCKET).download(d.signed_file_path);
        if (dlErr || !blob) {
          throw new Error(`Falha ao ler artefato ${d.signed_file_path}: ${dlErr?.message ?? 'download vazio'}`);
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const serverHash = await sha256Hex(bytes);

        // A4: se já havia um hash SERVIDOR gravado e ele diverge → artefato foi
        // sobrescrito por bytes diferentes. Isso é uma violação de integridade.
        if (d.hash_source === 'server' && d.signed_pdf_sha256 && d.signed_pdf_sha256 !== serverHash) {
          await audit(supabase, requestId, signerId, 'finalization_failed',
            `INTEGRIDADE: artefato ${d.document_key} foi sobrescrito (hash servidor ${d.signed_pdf_sha256} → ${serverHash}).`, ip, ua);
          throw new Error(`Violação de integridade no documento ${d.document_key}.`);
        }

        await supabase.from('signature_request_documents')
          .update({ signed_pdf_sha256: serverHash, hash_source: 'server' })
          .eq('id', d.id);
        persisted += 1;
      }

      await setJob(supabase, jobId, { persisted_document_count: persisted, progress: 55 });

      // 3) Gates de finalização.
      if (!allSigned) {
        await setJob(supabase, jobId, { status: 'queued', stage: 'aguardando signatários', progress: 55, locked_at: null, lock_expires_at: null });
        return jsonResponse({ success: true, finalized: false, reason: 'awaiting_signers', job_id: jobId, persisted, expected: expectedCount });
      }
      if (persisted < expectedCount) {
        await audit(supabase, requestId, signerId, 'finalization_failed',
          `Finalização bloqueada: esperados ${expectedCount}, persistidos ${persisted}.`, ip, ua);
        await setJob(supabase, jobId, { status: 'queued', stage: 'aguardando documentos', progress: 55, last_error: `persistidos ${persisted}/${expectedCount}`, locked_at: null, lock_expires_at: null });
        return jsonResponse({ success: false, code: 'PERSISTENCE_INCOMPLETE', job_id: jobId, persisted, expected: expectedCount }, 409);
      }

      // 4) Transição atômica para 'signed' — guarda contra corrida/duplicação.
      await setJob(supabase, jobId, { status: 'persisting', stage: 'finalizando envelope', progress: 80 });
      const { data: flipped } = await supabase.from('signature_requests')
        .update({ status: 'signed', signed_at: nowIso, envelope_verification_code: request0.envelope_verification_code || generateVerificationHash() })
        .eq('id', requestId).neq('status', 'signed')
        .select('id, created_by, document_name, client_id, client_name, process_number').maybeSingle();

      const weFinalized = !!flipped;
      if (weFinalized) {
        await audit(supabase, requestId, signerId, 'finalized',
          `Envelope finalizado no servidor com ${persisted} documento(s); hashes recalculados server-side.`, ip, ua);

        // Notificação interna (best-effort).
        if (flipped.created_by) {
          try {
            await supabase.from('user_notifications').insert({
              user_id: flipped.created_by, title: '✅ Documento Totalmente Assinado!',
              message: `"${flipped.document_name}" foi finalizado no servidor (${signers.length}/${signers.length})`,
              type: 'process_updated', read: false, created_at: nowIso,
              metadata: { signature_type: 'completed', request_id: requestId, total_signers: signers.length },
            });
          } catch (e) { console.error('notif error', e); }
        }

        // E-mail de conclusão — só aqui, após persistência integral. send-signature-link
        // tem dedupe próprio (migration signature_email_dispatch_dedupe), reforçando "sem duplo e-mail".
        try {
          const firstSigner = signers[0]?.id ?? signerId;
          await fetch(`${supabaseUrl}/functions/v1/send-signature-link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') ?? ''}` },
            body: JSON.stringify({ request_id: requestId, signer_id: firstSigner, origin }),
          });
        } catch (e) { console.error('email dispatch error', e); }

        // Webhook opcional.
        const webhookUrl = (Deno.env.get('WEBHOOK_SIGNATURE_SIGNED_URL') ?? '').trim();
        if (webhookUrl) {
          try {
            await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Webhook-Event': 'signature.completed',
                ...(Deno.env.get('WEBHOOK_SIGNATURE_SIGNED_SECRET') ? { 'X-Webhook-Secret': Deno.env.get('WEBHOOK_SIGNATURE_SIGNED_SECRET')! } : {}) },
              body: JSON.stringify({ event: 'signature.completed', sent_at: nowIso, document: { id: requestId, name: flipped.document_name, client_name: flipped.client_name, process_number: flipped.process_number } }),
            });
          } catch (e) { console.error('webhook error', e); }
        }
      }

      await setJob(supabase, jobId, { status: 'finalized', stage: 'concluído', progress: 100, persisted_document_count: persisted, finalized_at: nowIso, locked_at: null, lock_expires_at: null, last_error: null });
      return jsonResponse({ success: true, finalized: true, job_id: jobId, persisted, expected: expectedCount, was_new_finalization: weFinalized });
    } catch (err) {
      const msg = (err as Error)?.message ?? 'erro desconhecido';
      // Falha: incrementa attempts; se estourar, marca failed; senão, volta pra queued (retry).
      const { data: jrow } = await supabase.from('signature_finalization_jobs').select('attempts, max_attempts').eq('id', jobId).maybeSingle();
      const attempts = (jrow?.attempts ?? 0) + 1;
      const failed = attempts >= (jrow?.max_attempts ?? 5);
      await setJob(supabase, jobId, {
        status: failed ? 'failed' : 'queued', stage: failed ? 'falhou' : 'aguardando retry',
        attempts, last_error: msg.slice(0, 500), locked_at: null, lock_expires_at: null,
      });
      await audit(supabase, requestId, signerId, 'finalization_failed', `Orquestrador falhou (tentativa ${attempts}): ${msg}`, ip, ua);
      return jsonResponse({ success: false, error: msg, job_id: jobId, will_retry: !failed }, 500);
    }
  } catch (err) {
    console.error('Unexpected error:', err);
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
});
