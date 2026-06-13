import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ success: false, error: 'Supabase env not configured' }, 500);
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let payload: any = null;
    try {
      const text = await req.text();
      if (!text.trim()) return jsonResponse({ success: false, error: 'Empty request body' }, 400);
      payload = JSON.parse(text);
    } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

    if (!payload || typeof payload !== 'object') return jsonResponse({ success: false, error: 'Invalid payload' }, 400);

    const { token, reason, ip_address, user_agent } = payload;
    if (!token) return jsonResponse({ success: false, error: 'Token is required' }, 400);

    const refusalReason = String(reason ?? '').trim();
    if (refusalReason.length < 3) {
      return jsonResponse({ success: false, error: 'Informe o motivo da recusa.' }, 400);
    }

    const { data: signer, error: signerError } = await supabase
      .from('signature_signers').select('*').eq('public_token', token).maybeSingle();
    if (signerError || !signer) return jsonResponse({ success: false, error: 'Signer not found' }, 404);
    if (signer.status !== 'pending') {
      return jsonResponse({ success: false, error: 'Este documento já foi assinado, recusado ou cancelado.' }, 400);
    }

    // Validar estado de ciclo de vida e se a recusa é permitida
    const { data: request0, error: request0Error } = await supabase
      .from('signature_requests')
      .select('id, created_by, document_name, status, deleted_at, archived_at, blocked_at, expires_at, allow_refusal')
      .eq('id', signer.signature_request_id)
      .maybeSingle();
    if (request0Error || !request0) return jsonResponse({ success: false, error: 'Solicitacao nao encontrada' }, 404);
    if (request0.deleted_at || request0.archived_at || request0.blocked_at) {
      return jsonResponse({ success: false, error: 'Este documento nao esta mais disponivel.' }, 403);
    }
    if (request0.status === 'cancelled' || request0.status === 'expired') {
      return jsonResponse({ success: false, error: 'Esta solicitacao foi cancelada ou expirou.' }, 403);
    }
    if (request0.expires_at && new Date(request0.expires_at).getTime() < Date.now()) {
      return jsonResponse({ success: false, error: 'O prazo para assinatura deste documento expirou.' }, 403);
    }
    if (!request0.allow_refusal) {
      return jsonResponse({ success: false, error: 'A recusa não está habilitada para este documento.' }, 403);
    }

    const { data: updatedSigner, error: updateError } = await supabase
      .from('signature_signers')
      .update({ status: 'refused', refused_at: new Date().toISOString(), refusal_reason: refusalReason })
      .eq('id', signer.id)
      .select()
      .single();
    if (updateError) return jsonResponse({ success: false, error: 'Failed to update signer' }, 500);

    try {
      await supabase.from('signature_audit_log').insert({
        signature_request_id: signer.signature_request_id,
        signer_id: signer.id,
        action: 'refused',
        description: `Assinatura recusada por ${signer.name}: ${refusalReason}`,
        ip_address: ip_address || null,
        user_agent: user_agent || null,
      });
    } catch (e) { console.error('Audit log error (non-blocking):', e); }

    // Notificar o criador do documento
    try {
      if (request0.created_by) {
        await supabase.from('user_notifications').insert({
          user_id: request0.created_by,
          title: '⚠️ Assinatura recusada',
          message: `${signer.name} recusou "${request0.document_name}": ${refusalReason}`,
          type: 'process_updated',
          read: false,
          created_at: new Date().toISOString(),
          metadata: {
            signature_type: 'refused',
            signer_name: signer.name,
            signer_email: signer.email,
            document_name: request0.document_name,
            refusal_reason: refusalReason,
            request_id: signer.signature_request_id,
          },
        });
      }
    } catch (e) { console.error('Notification error (non-blocking):', e); }

    return jsonResponse({ success: true, signer: updatedSigner });
  } catch (err) {
    console.error('Unexpected error:', err);
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
});
