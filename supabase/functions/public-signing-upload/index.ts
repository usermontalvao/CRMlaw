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
      .select('id, signature_request_id, signed_document_path')
      .eq('public_token', token)
      .maybeSingle();
    if (!signer) return jsonResponse({ error: 'Token inválido' }, 403);

    const requestId = signer.signature_request_id as string;
    const signerId = signer.id as string;

    // 1b) one-shot: depois que o PDF assinado foi finalizado (ponteiro gravado),
    // o artefato legal não pode mais ser regravado por este token. Bloqueia a
    // adulteração pós-assinatura via chamada direta ao backend.
    if (signer.signed_document_path) {
      return jsonResponse({ error: 'Documento já finalizado' }, 409);
    }

    // 1c) ciclo de vida da solicitação: não aceitar gravação se a solicitação
    // foi removida/arquivada/bloqueada/cancelada/expirada (mesmas regras do
    // public-sign-document). Defesa em profundidade contra gravação tardia.
    const { data: request0 } = await supabase
      .from('signature_requests')
      .select('status, deleted_at, archived_at, blocked_at, expires_at')
      .eq('id', requestId)
      .maybeSingle();
    if (!request0) return jsonResponse({ error: 'Solicitação não encontrada' }, 404);
    if (request0.deleted_at || request0.archived_at || request0.blocked_at) {
      return jsonResponse({ error: 'Este documento não está mais disponível.' }, 403);
    }
    if (request0.status === 'cancelled' || request0.status === 'expired') {
      return jsonResponse({ error: 'Esta solicitação foi cancelada ou expirou.' }, 403);
    }
    if (request0.expires_at && new Date(request0.expires_at).getTime() < Date.now()) {
      return jsonResponse({ error: 'O prazo para assinatura deste documento expirou.' }, 403);
    }

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
        // upsert:false — o bucket `assinados` nunca sobrescreve um objeto
        // existente. Defesa em profundidade junto do gate one-shot acima.
        upsert: false,
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
