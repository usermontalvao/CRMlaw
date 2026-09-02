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
import { dispatchWaAiLifecycle } from '../_shared/wa-ai-lifecycle-hook.ts';

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

// ── Espelho puro de `src/utils/integridadeAssinatura.ts` ────────────────────
// O Deno não importa de `src/`, então estas duas regras vivem em cópia dupla.
// `src/utils/integridadeAssinatura.test.ts` vigia que as cópias não divirjam.
//
// ARMADILHA REAL que estas funções existem para desarmar: o cliente grava o
// SHA-256 em MAIÚSCULAS (`pdfSignature.service.ts` faz `.toUpperCase()`) e aqui
// ele nasce em minúsculas. Comparar cru com `!==` acusaria adulteração em 100%
// dos envelopes.
function normalizarSha256(valor: string | null | undefined): string {
  return String(valor ?? '').trim().toLowerCase();
}

function mesmoHash(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizarSha256(a);
  const y = normalizarSha256(b);
  if (!x || !y) return false;
  return x === y;
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

/**
 * Conta ao WhatsApp que o envelope foi assinado.
 *
 * Idempotente por construção: `runLifecycleTurn` marca `wa_tracking_stopped` e
 * `followup_stopped` logo no começo, então a segunda chamada não repete nada.
 * É por isso que ela também pode ser feita do caminho "já estava assinado".
 */
async function avisarWhatsApp(
  supabase: Supa, supabaseUrl: string, serviceRoleKey: string, requestId: string,
): Promise<void> {
  const { data: fillLink } = await supabase.from('template_fill_links')
    .select('conversation_id').eq('signature_request_id', requestId)
    .not('conversation_id', 'is', null).limit(1).maybeSingle();
  if (!fillLink?.conversation_id) return;
  await dispatchWaAiLifecycle({
    supabaseUrl,
    serviceRole: serviceRoleKey,
    conversationId: String(fillLink.conversation_id),
    trigger: 'signature_completed',
    resourceId: requestId,
  }).catch(error => console.error('wa-ai signature lifecycle:', error));
}

/**
 * SELAGEM: pendura a assinatura criptográfica dentro de cada PDF do envelope.
 *
 * Chama a `pades-sign`, que é quem tem a chave. Roda ANTES do recálculo de
 * hash, e essa ordem não pode inverter: selar muda os bytes, então um hash
 * calculado antes viraria "divergente" no arquivo que nós mesmos acabamos de
 * selar — e o orquestrador abortaria a finalização acusando adulteração.
 *
 * FALHA MACIA, de propósito. Envelope que finaliza sem selo é muito melhor que
 * envelope preso: a assinatura eletrônica, o dossiê e o SHA-256 continuam
 * valendo sem isto. Nenhum erro daqui derruba a finalização.
 *
 * INTERRUPTOR: sem o secret `PADES_SIGN_TOKEN` nada acontece e o fluxo segue
 * exatamente como antes. Tirar o secret desliga a selagem sem deploy.
 */
async function selarDocumentos(
  supabase: Supa, supabaseUrl: string, serviceRoleKey: string,
  requestId: string, signerId: string | null, ip: string | null, ua: string | null,
): Promise<{ alvos: number; selados: number; ignorados: number; falhas: number; desligado?: boolean }> {
  const token = (Deno.env.get('PADES_SIGN_TOKEN') ?? '').trim();
  if (!token) return { alvos: 0, selados: 0, ignorados: 0, falhas: 0, desligado: true };

  // OS DOIS MODELOS, e é por isto que esta busca tem duas pernas.
  //
  // No `per_document` o artefato é do DOCUMENTO e tem código próprio. No
  // `consolidated` (legado, 231 dos 246 envelopes assinados) não existe linha
  // em `signature_request_documents` — o PDF pendura no SIGNATÁRIO. A primeira
  // versão só olhava a tabela de documentos, e num envelope consolidado ela
  // devolvia `selados: 0, falhas: 0`: passava batido, sem selo e sem reclamar.
  // Fecho silencioso é o pior defeito possível numa etapa de prova.
  const { data: docs } = await supabase.from('signature_request_documents')
    .select('document_key, verification_code, signed_file_path')
    .eq('signature_request_id', requestId)
    .not('signed_file_path', 'is', null)
    .not('verification_code', 'is', null);

  let alvos: Array<{ rotulo: string; code: string }> = (docs ?? [])
    .map((d: any) => ({ rotulo: String(d.document_key), code: String(d.verification_code) }));

  if (alvos.length === 0) {
    const { data: signers } = await supabase.from('signature_signers')
      .select('id, name, verification_hash, signed_document_path')
      .eq('signature_request_id', requestId)
      .not('signed_document_path', 'is', null)
      .not('verification_hash', 'is', null);
    alvos = (signers ?? []).map((s: any) => ({
      rotulo: `assinatura de ${s.name ?? s.id}`, code: String(s.verification_hash),
    }));
  }

  let selados = 0, ignorados = 0, falhas = 0;
  for (const alvo of alvos) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/pades-sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'x-pades-token': token,
        },
        body: JSON.stringify({ code: alvo.code }),
      });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) { falhas += 1; console.error('[pades] falhou', alvo.rotulo, corpo); continue; }
      if (corpo?.status === 'ja_assinado') { ignorados += 1; continue; }
      if (corpo?.status === 'assinado') {
        selados += 1;
        await audit(supabase, requestId, signerId, 'pades_signed',
          `Documento ${alvo.rotulo} selado criptograficamente. SHA-256 do arquivo selado: ${corpo.sha256_depois}.`, ip, ua);
        continue;
      }
      falhas += 1;
    } catch (e) {
      falhas += 1;
      console.error('[pades] erro ao selar', alvo.rotulo, e);
    }
  }

  // `alvos` na resposta para que "não havia o que selar" NUNCA mais se
  // confunda com "selou tudo": os dois casos davam `selados: 0` antes.
  return { alvos: alvos.length, selados, ignorados, falhas };
}

/**
 * RECONFERÊNCIA: relê cada PDF do Storage e recalcula o SHA-256 no servidor.
 *
 * Só toca em documento que ainda não foi conferido (`hash_source <> 'server'`),
 * então chamar isto de novo num envelope já conferido não baixa nada.
 *
 * Nunca sobrescreve hash divergente: preserva os dois valores e registra a
 * violação. Não escreve no PDF.
 */
async function reconferirDocumentos(
  supabase: Supa, requestId: string, signerId: string | null,
  ip: string | null, ua: string | null,
): Promise<{ parecer: string; documentos: Array<Record<string, unknown>> }> {
  const { data: docs } = await supabase.from('signature_request_documents')
    .select('id, document_key, signed_file_path, signed_pdf_sha256, hash_source')
    .eq('signature_request_id', requestId)
    .not('signed_file_path', 'is', null)
    // `neq('hash_source','server')` NÃO pega as linhas com hash_source NULL —
    // em SQL, `NULL <> 'server'` é NULL, não TRUE, e o PostgREST descarta.
    // Seriam justamente os documentos que nunca foram conferidos, ou seja, o
    // filtro excluía exatamente o que ele precisava encontrar. É a mesma
    // armadilha de três valores que deixou o dossiê aberto ao anônimo.
    .or('hash_source.is.null,hash_source.neq.server');

  const resultados: Array<Record<string, unknown>> = [];
  for (const d of (docs ?? [])) {
    const { data: blob, error: dlErr } = await supabase.storage.from(SIGNED_BUCKET).download(d.signed_file_path);
    if (dlErr || !blob) {
      resultados.push({ document_key: d.document_key, resultado: 'inconclusivo',
        motivo: `arquivo indisponível: ${dlErr?.message ?? 'download vazio'}` });
      continue;
    }
    const serverHash = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
    const registrado = d.signed_pdf_sha256;

    if (!registrado) {
      await supabase.from('signature_request_documents')
        .update({ signed_pdf_sha256: serverHash, hash_source: 'server' }).eq('id', d.id);
      await audit(supabase, requestId, signerId, 'integrity_verified',
        `Documento ${d.document_key} sem hash registrado; SHA-256 calculado no servidor: ${serverHash}.`, ip, ua);
      resultados.push({ document_key: d.document_key, resultado: 'integro', hash: serverHash });
      continue;
    }
    if (!mesmoHash(registrado, serverHash)) {
      await audit(supabase, requestId, signerId, 'integrity_violation',
        `INTEGRIDADE: documento ${d.document_key} DIVERGE. Registrado ${registrado}; recalculado ${serverHash}. Valor registrado preservado.`, ip, ua);
      resultados.push({ document_key: d.document_key, resultado: 'divergente',
        hash_registrado: registrado, hash_recalculado: serverHash });
      continue;
    }
    await supabase.from('signature_request_documents')
      .update({ hash_source: 'server' }).eq('id', d.id);
    await audit(supabase, requestId, signerId, 'integrity_verified',
      `Documento ${d.document_key} conferido no servidor: SHA-256 ${registrado} recalculado a partir do arquivo no Storage.`, ip, ua);
    resultados.push({ document_key: d.document_key, resultado: 'integro', hash: registrado });
  }

  const divergentes = resultados.filter((r) => r.resultado === 'divergente').length;
  const inconclusivos = resultados.filter((r) => r.resultado === 'inconclusivo').length;
  return {
    parecer: divergentes > 0 ? 'NAO_INTEGRO' : inconclusivos > 0 ? 'INCONCLUSIVO' : 'INTEGRO',
    documentos: resultados,
  };
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
      .select('id, status, deleted_at, archived_at, blocked_at, attachment_paths, document_name, created_by, envelope_verification_code, signature_model, wa_tracking_stopped')
      .eq('id', requestId).maybeSingle();
    if (!request0) return jsonResponse({ success: false, error: 'Request not found' }, 404);
    if (request0.deleted_at || request0.archived_at || request0.blocked_at) {
      return jsonResponse({ success: false, error: 'Envelope indisponível' }, 403);
    }

    // Reconferência sob demanda: registros antigos e auditoria manual.
    // (O caminho automático é o bloco `status === 'signed'`, logo abaixo.)
    if (payload?.action === 'reconfer') {
      const r = await reconferirDocumentos(supabase, requestId, signerId, ip, ua);
      return jsonResponse({ success: true, action: 'reconfer', ...r });
    }

    // Já finalizado? Resposta idempotente imediata — ANTES de enfileirar, para
    // não criar job órfão em envelopes que já estão 'signed'.
    if (request0.status === 'signed') {
      // ── A BRECHA QUE ISTO FECHA ──────────────────────────────────────────
      // `public_attach_signed_document` (RPC do banco) AUTO-FINALIZA o envelope
      // assim que o último documento é anexado. Quando o cliente chama este
      // orquestrador logo depois, ele encontra `status === 'signed'` e caía
      // direto nesta resposta idempotente — pulando o recálculo de hash.
      //
      // Resultado observado em produção: envelope assinado às 21:31 com os três
      // documentos em `hash_source = null`, ou seja, o hash que o laudo exibia
      // tinha sido calculado pelo navegador de quem assinou e NUNCA conferido
      // por ninguém. O desenho previa o servidor como autoridade do hash e, na
      // prática, ele jamais era consultado.
      //
      // Conferir aqui resolve sem tocar na auto-finalização (que, se removida,
      // deixaria envelopes presos caso o orquestrador falhasse). Só processa
      // documento ainda não conferido, então a segunda chamada não baixa nada.
      // Selar ANTES de reconferir: a reconferência é quem carimba
      // `hash_source = 'server'`, e ela precisa ver os bytes finais.
      const selagem = await selarDocumentos(supabase, supabaseUrl, serviceRoleKey, requestId, signerId, ip, ua);
      const conferencia = await reconferirDocumentos(supabase, requestId, signerId, ip, ua);

      // ── Recuperação ──
      // Envelope já assinado, mas o WhatsApp nunca soube: é o estado de todo
      // envelope finalizado enquanto esta função rodava sem o aviso (a v12, de
      // 06/07/2026, não tinha o `dispatchWaAiLifecycle` — o código existia no
      // repositório e nunca foi implantado). Sem esta porta, esses casos ficam
      // presos para sempre: o cliente assinou, ninguém respondeu, a etiqueta
      // parou em "Aguardando Documentos" e nada mais dispara.
      // `wa_tracking_stopped` é a marca que o próprio gancho grava, então isto
      // roda no máximo uma vez por envelope.
      if (request0.wa_tracking_stopped !== true) {
        await avisarWhatsApp(supabase, supabaseUrl, serviceRoleKey, requestId);
        return jsonResponse({ success: true, finalized: true, request_status: 'signed', wa_recovered: true, integridade: conferencia, selagem });
      }
      return jsonResponse({ success: true, finalized: true, request_status: 'signed', integridade: conferencia, selagem });
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
      // 1) Carregar signatários e, só depois, os documentos.
      //
      // A ordem mudou por causa da selagem. Ela reescreve o artefato e regrava
      // o `signed_pdf_sha256`; se os documentos fossem lidos ANTES, o laço de
      // recálculo compararia o hash velho com os bytes novos, veria divergência
      // e abortaria a finalização acusando adulteração do arquivo que nós
      // mesmos acabamos de selar.
      const { data: signers } = await supabase.from('signature_signers')
        .select('id, status').eq('signature_request_id', requestId);

      const allSigned = !!signers?.length && signers.every((s: any) => s.status === 'signed');

      // Selar só quando todo mundo já assinou: antes disso o artefato ainda
      // pode ser substituído pelo próximo signatário, e selar seria trabalho
      // jogado fora a cada passagem.
      const selagem = allSigned
        ? await selarDocumentos(supabase, supabaseUrl, serviceRoleKey, requestId, signerId, ip, ua)
        : { alvos: 0, selados: 0, ignorados: 0, falhas: 0 };

      const { data: docs } = await supabase.from('signature_request_documents')
        .select('id, document_key, signed_file_path, signed_pdf_sha256, hash_source')
        .eq('signature_request_id', requestId).not('signed_file_path', 'is', null);

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
        const registrado = d.signed_pdf_sha256;

        // ── A CONFERÊNCIA ──
        // O servidor NUNCA substitui em silêncio o hash já registrado. Um hash
        // gravado no ato da assinatura e um hash recalculado agora que não
        // batem só têm uma leitura possível: os bytes no Storage não são mais
        // os que foram assinados. Sobrescrever o registro apagaria justamente a
        // prova disso — e o `hash_source = 'server'` transformaria o arquivo
        // adulterado em "conferido pelo servidor".
        //
        // O bug que isto conserta: a checagem antiga só valia quando
        // `hash_source` JÁ era 'server'. Na primeira finalização — quando
        // `hash_source` é NULL, que é o caso de todo envelope novo — o UPDATE
        // caía direto e carimbava 'server' em qualquer coisa que estivesse lá.
        if (registrado && !mesmoHash(registrado, serverHash)) {
          await audit(supabase, requestId, signerId, 'integrity_violation',
            `INTEGRIDADE: documento ${d.document_key} diverge. Registrado ${registrado}; recalculado no servidor ${serverHash}. `
            + `Origem do registro: ${d.hash_source ?? 'cliente/legado'}. O valor registrado foi PRESERVADO para investigação.`, ip, ua);
          throw new Error(`Violação de integridade no documento ${d.document_key}: o arquivo no Storage não corresponde ao hash registrado.`);
        }

        if (registrado) {
          // Confere: promove a conferência a 'server' SEM reescrever o valor —
          // manter os bytes originais do registro (inclusive a caixa das letras)
          // deixa o histórico auditável.
          if (d.hash_source !== 'server') {
            await supabase.from('signature_request_documents')
              .update({ hash_source: 'server' })
              .eq('id', d.id);
            await audit(supabase, requestId, signerId, 'integrity_verified',
              `Documento ${d.document_key} reconferido no servidor: SHA-256 do arquivo no Storage confere com o registrado (${registrado}).`, ip, ua);
          }
        } else {
          // Nunca houve hash registrado: o servidor é quem estabelece o valor.
          await supabase.from('signature_request_documents')
            .update({ signed_pdf_sha256: serverHash, hash_source: 'server' })
            .eq('id', d.id);
          await audit(supabase, requestId, signerId, 'integrity_verified',
            `Documento ${d.document_key} sem hash registrado; SHA-256 calculado no servidor: ${serverHash}.`, ip, ua);
        }
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
          const emailRes = await fetch(`${supabaseUrl}/functions/v1/send-signature-link`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-signature-internal-key': serviceRoleKey,
            },
            body: JSON.stringify({ request_id: requestId, signer_id: firstSigner, origin }),
          });
          if (!emailRes.ok) {
            const emailBody = await emailRes.text().catch(() => '');
            throw new Error(`send-signature-link falhou (${emailRes.status}): ${emailBody || 'sem corpo'}`);
          }
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

        await avisarWhatsApp(supabase, supabaseUrl, serviceRoleKey, requestId);
      }

      await setJob(supabase, jobId, { status: 'finalized', stage: 'concluído', progress: 100, persisted_document_count: persisted, finalized_at: nowIso, locked_at: null, lock_expires_at: null, last_error: null });
      return jsonResponse({ success: true, finalized: true, job_id: jobId, persisted, expected: expectedCount, was_new_finalization: weFinalized, selagem });
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
