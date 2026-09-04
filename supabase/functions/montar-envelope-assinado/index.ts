import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type Job = {
  id: string;
  signature_request_id: string;
  signer_id: string;
  attempts: number;
  max_attempts: number;
  expected_document_count: number;
};

type Supabase = ReturnType<typeof createClient>;

/** O gateway já validou a assinatura do JWT (`verify_jwt=true`). Aqui só
 * restringimos o chamador aos dois papéis de máquina usados pelo cron e pelas
 * chamadas internas; sessão de usuário (`authenticated`) não entra. */
function papelDoJwt(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalizado = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(normalizado.padEnd(Math.ceil(normalizado.length / 4) * 4, '='));
    return String(JSON.parse(json)?.role ?? '') || null;
  } catch { return null; }
}

async function respostaJson(response: Response): Promise<any> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 500) }; }
}

async function atualizarJob(supabase: Supabase, jobId: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('signature_assembly_jobs').update(patch).eq('id', jobId);
  if (error) throw new Error(`Não foi possível atualizar o job: ${error.message}`);
}

async function reagendar(supabase: Supabase, job: Job, error: string, permanente = false) {
  const esgotou = Number(job.attempts) >= Number(job.max_attempts);
  if (permanente || esgotou) {
    await atualizarJob(supabase, job.id, {
      status: 'failed',
      stage: permanente ? 'intervenção necessária' : 'tentativas esgotadas',
      lock_expires_at: null,
      last_error: error.slice(0, 1500),
    });
    try {
      await supabase.from('signature_audit_log').insert({
        signature_request_id: job.signature_request_id,
        signer_id: job.signer_id,
        action: 'finalization_failed',
        description: `Montagem server-side falhou: ${error}`.slice(0, 1000),
      });
    } catch { /* falha da trilha não impede a fila de parar com erro explícito */ }
    return;
  }

  // 1, 2, 4, 8, 16 e no máximo 30 minutos entre tentativas.
  const atrasoMinutos = Math.min(30, 2 ** Math.max(0, Number(job.attempts) - 1));
  await atualizarJob(supabase, job.id, {
    status: 'retry_wait',
    stage: 'aguardando nova tentativa',
    lock_expires_at: null,
    next_attempt_at: new Date(Date.now() + atrasoMinutos * 60_000).toISOString(),
    last_error: error.slice(0, 1500),
  });
}

async function chamarFuncao(
  supabaseUrl: string,
  serviceKey: string,
  nome: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: any }> {
  const response = await fetch(`${supabaseUrl}/functions/v1/${nome}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { ok: response.ok, status: response.status, body: await respostaJson(response) };
}

async function processarJob(
  supabase: Supabase,
  supabaseUrl: string,
  serviceKey: string,
  job: Job,
): Promise<Record<string, unknown>> {
  try {
    const [{ data: signer, error: signerError }, { data: request0, error: requestError }] = await Promise.all([
      supabase.from('signature_signers')
        .select('id, public_token, status')
        .eq('id', job.signer_id).maybeSingle(),
      supabase.from('signature_requests')
        .select('id, signature_model, document_path, attachment_paths, deleted_at, archived_at, blocked_at')
        .eq('id', job.signature_request_id).maybeSingle(),
    ]);

    if (signerError || !signer || signer.status !== 'signed' || !signer.public_token) {
      await reagendar(supabase, job, 'O signatário do job não está assinado ou não possui token.', true);
      return { job_id: job.id, status: 'failed', error: 'signatário inválido' };
    }
    if (requestError || !request0 || request0.signature_model !== 'per_document') {
      await reagendar(supabase, job, 'O envelope não existe ou não usa o modelo per_document.', true);
      return { job_id: job.id, status: 'failed', error: 'envelope inválido' };
    }
    if (request0.deleted_at || request0.archived_at || request0.blocked_at) {
      await reagendar(supabase, job, 'O envelope foi removido, arquivado ou bloqueado.', true);
      return { job_id: job.id, status: 'failed', error: 'envelope indisponível' };
    }

    const caminhos = [
      String(request0.document_path ?? '').trim(),
      ...(Array.isArray(request0.attachment_paths)
        ? request0.attachment_paths.map((p: unknown) => String(p ?? '').trim())
        : []),
    ].filter(Boolean);
    const documentKeys = caminhos.map((_, i) => i === 0 ? 'main' : `attachment-${i - 1}`);
    if (documentKeys.length === 0) {
      await reagendar(supabase, job, 'O envelope não possui documentos.', true);
      return { job_id: job.id, status: 'failed', error: 'envelope sem documentos' };
    }

    await atualizarJob(supabase, job.id, {
      stage: 'conferindo originais congelados',
      expected_document_count: documentKeys.length,
    });

    let { data: sources } = await supabase.from('signature_source_files')
      .select('document_key, is_pdf').eq('signature_request_id', job.signature_request_id);
    let sourceKeys = new Set((sources ?? []).map((row: any) => String(row.document_key)));

    let parecerDoCongelamento: any = null;
    if (documentKeys.some((key) => !sourceKeys.has(key))) {
      await atualizarJob(supabase, job.id, { stage: 'congelando originais no servidor' });
      const freeze = await chamarFuncao(
        supabaseUrl, serviceKey, 'congelar-docx-no-servidor',
        { request_id: job.signature_request_id }, 90_000,
      );
      parecerDoCongelamento = freeze.body;
      if (!freeze.ok) {
        throw new Error(`congelamento respondeu ${freeze.status}: ${freeze.body?.error ?? 'sem detalhe'}`);
      }
      const refreshed = await supabase.from('signature_source_files')
        .select('document_key, is_pdf').eq('signature_request_id', job.signature_request_id);
      sources = refreshed.data ?? [];
      sourceKeys = new Set((sources ?? []).map((row: any) => String(row.document_key)));
    }

    const missing = documentKeys.filter((key) => !sourceKeys.has(key));
    if (missing.length > 0) {
      const resultados = Array.isArray(parecerDoCongelamento?.resultados)
        ? parecerDoCongelamento.resultados : [];
      const manualDocx = resultados
        .filter((r: any) => missing.includes(String(r?.document_key)) && r?.resultado === 'pulado_tem_campo_marcado')
        .map((r: any) => String(r.document_key));
      const detalhe = `Originais ainda não congelados: ${missing.join(', ')}.`;
      await reagendar(
        supabase,
        job,
        manualDocx.length > 0
          ? `${detalhe} DOCX com campo manual exige conversão na criação do envelope: ${manualDocx.join(', ')}.`
          : detalhe,
        manualDocx.length > 0,
      );
      return { job_id: job.id, status: manualDocx.length ? 'failed' : 'retry_wait', missing };
    }

    const notPdf = (sources ?? [])
      .filter((row: any) => documentKeys.includes(String(row.document_key)) && row.is_pdf === false)
      .map((row: any) => String(row.document_key));
    if (notPdf.length > 0) {
      await reagendar(supabase, job, `Originais congelados não são PDF: ${notPdf.join(', ')}.`, true);
      return { job_id: job.id, status: 'failed', not_pdf: notPdf };
    }

    await atualizarJob(supabase, job.id, { stage: 'montando documentos assinados' });

    // Cada documento é independente. Rodar em paralelo tira o custo linear do
    // aparelho do signatário sem misturar arquivos nem estados no worker.
    const montagens = await Promise.all(documentKeys.map(async (documentKey) => {
      try {
        const result = await chamarFuncao(
          supabaseUrl, serviceKey, 'montar-documento-assinado',
          { token: signer.public_token, document_key: documentKey }, 90_000,
        );
        return { document_key: documentKey, ...result };
      } catch (error) {
        return {
          document_key: documentKey,
          ok: false,
          status: 0,
          body: { error: error instanceof Error ? error.message : String(error) },
        };
      }
    }));

    const falhas = montagens.filter((m) => !m.ok || m.body?.success !== true);
    const { count: completedCount } = await supabase.from('signature_request_documents')
      .select('id', { count: 'exact', head: true })
      .eq('signature_request_id', job.signature_request_id)
      .not('signed_file_path', 'is', null);

    await atualizarJob(supabase, job.id, {
      completed_document_count: completedCount ?? 0,
      result: montagens.map((m) => ({
        document_key: m.document_key,
        ok: m.ok && m.body?.success === true,
        status: m.status,
        ja_montado: !!m.body?.ja_montado,
        codigo: m.body?.codigo ?? null,
        error: m.body?.error ?? null,
      })),
    });

    if (falhas.length > 0) {
      const resumo = falhas.map((m) =>
        `${m.document_key}: ${m.body?.codigo ?? m.body?.error ?? `HTTP ${m.status}`}`
      ).join('; ');
      await reagendar(supabase, job, `Falha na montagem: ${resumo}`);
      return { job_id: job.id, status: 'retry_wait', error: resumo };
    }

    await atualizarJob(supabase, job.id, { stage: 'finalizando envelope' });
    const finalizacao = await chamarFuncao(
      supabaseUrl, serviceKey, 'finalize-signature-envelope',
      { token: signer.public_token, origin: 'https://jurius.com.br' }, 90_000,
    );
    if (!finalizacao.ok || finalizacao.body?.success === false) {
      throw new Error(
        `finalização respondeu ${finalizacao.status}: ${finalizacao.body?.error ?? 'sem detalhe'}`,
      );
    }

    await atualizarJob(supabase, job.id, {
      status: 'completed',
      stage: finalizacao.body?.finalized === false ? 'montado; aguardando outros signatários' : 'concluído',
      completed_document_count: documentKeys.length,
      lock_expires_at: null,
      last_error: null,
      completed_at: new Date().toISOString(),
    });

    return {
      job_id: job.id,
      status: 'completed',
      documents: documentKeys.length,
      envelope_finalized: finalizacao.body?.finalized === true,
      reason: finalizacao.body?.reason ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[montar-envelope-assinado] job falhou', job.id, message);
    await reagendar(supabase, job, message).catch((e) =>
      console.error('[montar-envelope-assinado] reagendamento falhou', e)
    );
    return { job_id: job.id, status: 'retry_wait', error: message };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: 'Supabase env not configured' }, 500);

  // O cron usa a anon key pública; chamadas diretas entre funções usam a
  // service role. JWT de usuário não é aceito, mesmo sendo válido no gateway.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const role = papelDoJwt(bearer);
  if (bearer !== serviceKey && role !== 'service_role' && role !== 'anon') {
    return jsonResponse({ error: 'Não autorizado' }, 401);
  }

  let body: any = {};
  try { body = JSON.parse((await req.text()) || '{}'); }
  catch { return jsonResponse({ error: 'JSON inválido' }, 400); }

  const explicitJobId = String(body?.job_id ?? '').trim() || null;
  if (explicitJobId && bearer !== serviceKey) {
    return jsonResponse({ error: 'job_id exige chamada interna' }, 403);
  }
  if (!explicitJobId && body?.process_due !== true) {
    return jsonResponse({ error: 'process_due é obrigatório' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const results: Array<Record<string, unknown>> = [];
  const limit = explicitJobId ? 1 : 2;

  for (let i = 0; i < limit; i++) {
    const { data, error } = await supabase.rpc('claim_signature_assembly_job', {
      p_job_id: explicitJobId,
      p_lease_seconds: 180,
    });
    if (error) {
      console.error('[montar-envelope-assinado] claim falhou', error);
      return jsonResponse({ error: 'Falha ao reservar trabalho' }, 500);
    }
    const job = data as Job | null;
    if (!job?.id) break;
    results.push(await processarJob(supabase, supabaseUrl, serviceKey, job));
    if (explicitJobId) break;
  }

  return jsonResponse({ success: true, processed: results.length, results });
});
