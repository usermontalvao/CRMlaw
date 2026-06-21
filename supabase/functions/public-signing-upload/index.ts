import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Recebe, de forma token-scoped, o PDF assinado / relatório gerado no fluxo
// PÚBLICO de assinatura e o grava no bucket `assinados` via service role.
// Substitui o INSERT anon direto no Storage: o servidor valida que o token
// pertence a um signatário e que o path destino está dentro da pasta do
// request (e carrega o id do próprio signatário) antes de gravar — permitindo
// remover o INSERT anon de `assinados` (migration 4) sem quebrar a assinatura.

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

const TARGET_BUCKET = 'assinados';
const MAX_BYTES = 25 * 1024 * 1024; // 25MB — PDF assinado com imagens embutidas

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });

  try {
    const { token, path, contentBase64, contentType } = await req.json().catch(() => ({}));
    if (!token || !path || typeof path !== 'string' || !contentBase64 || typeof contentBase64 !== 'string') {
      return jsonResponse({ error: 'token, path e contentBase64 são obrigatórios' }, 400);
    }
    if (path.includes('..')) {
      return jsonResponse({ error: 'path inválido' }, 400);
    }

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } },
    });

    // 1) valida o token → signatário → solicitação
    const { data: signer } = await supabase
      .from('signature_signers')
      .select('id, signature_request_id')
      .eq('public_token', token)
      .maybeSingle();
    if (!signer) return jsonResponse({ error: 'Token inválido' }, 403);

    const requestId = signer.signature_request_id as string;
    const signerId = signer.id as string;

    // 2) o path destino tem que estar na pasta do request E referenciar o
    // próprio signatário (impede sobrescrever o artefato de um co-signatário).
    const belongs = path.startsWith(`${requestId}/`) && path.includes(signerId);
    if (!belongs) {
      return jsonResponse({ error: 'Acesso negado a este destino' }, 403);
    }

    // 3) decodifica o conteúdo base64
    let bytes: Uint8Array;
    try {
      const bin = atob(contentBase64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return jsonResponse({ error: 'Conteúdo base64 inválido' }, 400);
    }
    if (bytes.length === 0) return jsonResponse({ error: 'Conteúdo vazio' }, 400);
    if (bytes.length > MAX_BYTES) return jsonResponse({ error: 'Arquivo excede o limite' }, 413);

    // 4) grava via service role
    const { error } = await supabase.storage
      .from(TARGET_BUCKET)
      .upload(path, bytes, {
        contentType: typeof contentType === 'string' && contentType ? contentType : 'application/pdf',
        upsert: true,
      });
    if (error) {
      console.error('[public-signing-upload] erro no upload:', error);
      return jsonResponse({ error: 'Falha ao gravar o arquivo' }, 500);
    }

    return jsonResponse({ success: true, path });
  } catch (err) {
    console.error('[public-signing-upload] erro:', err);
    return jsonResponse({ error: 'Erro interno' }, 500);
  }
});
