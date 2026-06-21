import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Serve, de forma token-scoped, uma URL assinada de um arquivo do fluxo de
// assinatura. Substitui o acesso direto do papel `anon` ao storage: aqui o
// servidor (service role) valida que o token pertence a um signatário cujo
// processo é dono do arquivo solicitado antes de gerar a URL — fechando a
// leitura/listagem ampla dos buckets pela chave pública.

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

// Buckets onde os arquivos do fluxo de assinatura podem residir.
const CANDIDATE_BUCKETS = ['document-templates', 'assinados', 'generated-documents', 'cloud-files', 'signatures'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });

  try {
    const { token, path, expiresIn } = await req.json().catch(() => ({}));
    if (!token || !path || typeof path !== 'string') {
      return jsonResponse({ error: 'token e path são obrigatórios' }, 400);
    }

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    // Headers globais explícitos: necessário para a chave no formato novo
    // (sb_secret_*) ser aplicada como service role (bypass de RLS).
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } },
    });

    // 1) valida o token → signatário → solicitação
    const { data: signer } = await supabase
      .from('signature_signers')
      .select('signature_request_id')
      .eq('public_token', token)
      .maybeSingle();
    if (!signer) return jsonResponse({ error: 'Token inválido' }, 403);
    const requestId = signer.signature_request_id as string;

    const { data: request } = await supabase
      .from('signature_requests')
      .select('document_path, attachment_paths')
      .eq('id', requestId)
      .maybeSingle();
    if (!request) return jsonResponse({ error: 'Solicitação não encontrada' }, 403);

    const { data: allSigners } = await supabase
      .from('signature_signers')
      .select('signed_document_path')
      .eq('signature_request_id', requestId);

    // 2) conjunto de arquivos que pertencem a esta solicitação
    const allowed = new Set<string>();
    if (request.document_path) allowed.add(request.document_path);
    for (const p of (request.attachment_paths ?? []) as string[]) if (p) allowed.add(p);
    for (const s of allSigners ?? []) if (s.signed_document_path) allowed.add(s.signed_document_path);

    const belongsToRequest =
      allowed.has(path) || path.includes(`signature-requests/${requestId}/`);
    if (!belongsToRequest) {
      return jsonResponse({ error: 'Acesso negado a este arquivo' }, 403);
    }

    // 3) gera a URL assinada (createSignedUrl "tem sucesso" mesmo p/ inexistente,
    // então confirmamos com HEAD antes de retornar)
    const ttl = Math.min(Math.max(Number(expiresIn) || 3600, 60), 3600);
    for (const bucket of CANDIDATE_BUCKETS) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl);
      if (error || !data?.signedUrl) continue;
      try {
        const head = await fetch(data.signedUrl, { method: 'HEAD' });
        if (head.ok) return jsonResponse({ url: data.signedUrl, bucket });
      } catch { /* tenta o próximo bucket */ }
    }

    return jsonResponse({ error: 'Arquivo não encontrado' }, 404);
  } catch (err) {
    console.error('[public-signing-file] erro:', err);
    return jsonResponse({ error: 'Erro interno' }, 500);
  }
});
