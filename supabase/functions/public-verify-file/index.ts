import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Serve, de forma HASH-scoped, a URL assinada do PDF assinado de um documento,
// para a tela pública de VERIFICAÇÃO (que usa verification_hash, não public_token).
// O servidor (service role) valida o hash → signatário → documento assinado e
// só então gera a URL — substituindo o acesso direto do papel `anon` ao bucket
// `assinados`. Documentos bloqueados/revogados (blocked_at) não são servidos.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Buckets onde o PDF assinado pode residir.
const CANDIDATE_BUCKETS = ['assinados', 'generated-documents'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });

  try {
    const { hash, expiresIn } = await req.json().catch(() => ({}));
    if (!hash || typeof hash !== 'string') {
      return jsonResponse({ error: 'hash é obrigatório' }, 400);
    }
    const code = hash.trim().toUpperCase();

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } },
    });

    // 1) hash → signatário (e a solicitação, para checar bloqueio)
    const { data: signer } = await supabase
      .from('signature_signers')
      .select('signature_request_id, signed_document_path')
      .filter('verification_hash', 'ilike', code)
      .maybeSingle();

    let signedPath: string | null = signer?.signed_document_path ?? null;
    let requestId: string | null = signer?.signature_request_id ?? null;

    // Fallback: assinatura única no nível da solicitação
    if (!signedPath) {
      const { data: reqRow } = await supabase
        .from('signature_requests')
        .select('id, signed_document_path')
        .filter('verification_hash', 'ilike', code)
        .maybeSingle();
      signedPath = (reqRow as any)?.signed_document_path ?? null;
      requestId = (reqRow as any)?.id ?? requestId;
    }

    // Fallback (modelo per_document): código de verificação de um documento individual
    // do envelope → arquivo assinado próprio. Aditivo; não afeta os hashes legados.
    if (!signedPath) {
      const { data: docRow } = await supabase
        .from('signature_request_documents')
        .select('signature_request_id, signed_file_path')
        .filter('verification_code', 'ilike', code)
        .maybeSingle();
      signedPath = (docRow as any)?.signed_file_path ?? null;
      requestId = (docRow as any)?.signature_request_id ?? requestId;
    }

    if (!signedPath || !requestId) return jsonResponse({ error: 'Documento não encontrado' }, 404);

    // 2) recusa documentos bloqueados/revogados
    const { data: request } = await supabase
      .from('signature_requests')
      .select('blocked_at')
      .eq('id', requestId)
      .maybeSingle();
    if (request?.blocked_at) return jsonResponse({ error: 'Validação pública desativada' }, 403);

    // 3) gera URL assinada (confirma existência com HEAD)
    const ttl = Math.min(Math.max(Number(expiresIn) || 3600, 60), 3600);
    for (const bucket of CANDIDATE_BUCKETS) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(signedPath, ttl);
      if (error || !data?.signedUrl) continue;
      try {
        const head = await fetch(data.signedUrl, { method: 'HEAD' });
        if (head.ok) return jsonResponse({ url: data.signedUrl, bucket });
      } catch { /* tenta o próximo bucket */ }
    }

    return jsonResponse({ error: 'Arquivo não encontrado' }, 404);
  } catch (err) {
    console.error('[public-verify-file] erro:', err);
    return jsonResponse({ error: 'Erro interno' }, 500);
  }
});
