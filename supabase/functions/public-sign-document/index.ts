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

function generateVerificationHash(): string {
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function dispatchSignatureCompletedWebhook(input: {
  request: Record<string, unknown>;
  signer: Record<string, unknown>;
  totalSigners: number;
}): Promise<void> {
  const webhookUrl = (Deno.env.get('WEBHOOK_SIGNATURE_SIGNED_URL') ?? '').trim();
  if (!webhookUrl) return;
  const webhookSecret = (Deno.env.get('WEBHOOK_SIGNATURE_SIGNED_SECRET') ?? '').trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Event': 'signature.completed',
        ...(webhookSecret ? { 'X-Webhook-Secret': webhookSecret } : {}),
      },
      body: JSON.stringify({
        event: 'signature.completed',
        sent_at: new Date().toISOString(),
        document: { id: input.request.id, name: input.request.document_name, client_name: input.request.client_name, process_number: input.request.process_number, signed_at: input.request.signed_at },
        signers: await getAllSignersWithLinks(input.request.id as string),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Webhook ${response.status}`);
    console.log('✅ Webhook enviado');
  } finally { clearTimeout(timeout); }
}

async function getAllSignersWithLinks(requestId: string) {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: signers } = await supabase.from('signature_signers')
    .select('name,email,cpf,phone,signed_at,signed_document_path,signature_request_id')
    .eq('signature_request_id', requestId).eq('status', 'signed').order('signed_at', { ascending: true });
  if (!signers?.length) return [];
  const { data: request } = await supabase.from('signature_requests').select('client_id,client_name').eq('id', requestId).single();
  return Promise.all(signers.map(async (s: any) => {
    let documentLink: string | undefined;
    if (s.signed_document_path) {
      for (const b of ['assinados','generated-documents','document-templates']) {
        try { const { data } = await supabase.storage.from(b).createSignedUrl(s.signed_document_path, 3600); if (data?.signedUrl) { documentLink = data.signedUrl; break; } } catch {}
      }
    }
    return { name: s.name, email: s.email, cpf: s.cpf, phone: s.phone, client_name: request?.client_name||null, client_id: request?.client_id||null, signed_at: s.signed_at, document_link: documentLink };
  }));
}

async function uploadBase64Image(supabase: ReturnType<typeof createClient>, base64: string, prefix: string, bucket: string): Promise<string> {
  const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  let extension = 'png';
  if (base64.includes('data:image/jpeg')) extension = 'jpg';
  else if (base64.includes('data:image/webp')) extension = 'webp';
  const filePath = `${prefix}_${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from(bucket).upload(filePath, bytes, { contentType: `image/${extension==='jpg'?'jpeg':extension}`, upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return filePath;
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

    const { token, signature_image, facial_image, geolocation, signer_name, signer_cpf, signer_phone, auth_provider, auth_email, auth_google_sub, auth_google_picture, ip_address, user_agent, terms_accepted, terms_version } = payload;

    if (!token) return jsonResponse({ success: false, error: 'Token is required' }, 400);
    if (!signature_image) return jsonResponse({ success: false, error: 'Signature image is required' }, 400);
    // Aceite dos Termos de Uso (LGPD) e obrigatorio para assinar. Backstop do servidor.
    if (terms_accepted !== true) return jsonResponse({ success: false, error: 'E necessario aceitar os Termos de Uso para assinar.' }, 400);

    const { data: signer, error: signerError } = await supabase.from('signature_signers').select('*').eq('public_token', token).maybeSingle();
    if (signerError || !signer) return jsonResponse({ success: false, error: 'Signer not found' }, 404);
    if (signer.status !== 'pending') return jsonResponse({ success: false, error: 'Document already signed or cancelled' }, 400);

    // P0: validar estado de ciclo de vida da solicitacao antes de permitir assinatura
    const { data: request0, error: request0Error } = await supabase
      .from('signature_requests')
      .select('id, status, deleted_at, archived_at, blocked_at, expires_at, require_cpf, signing_order')
      .eq('id', signer.signature_request_id)
      .maybeSingle();
    if (request0Error || !request0) return jsonResponse({ success: false, error: 'Solicitacao nao encontrada' }, 404);
    if (request0.deleted_at || request0.archived_at || request0.blocked_at) {
      return jsonResponse({ success: false, error: 'Este documento nao esta mais disponivel para assinatura.' }, 403);
    }
    if (request0.status === 'cancelled' || request0.status === 'expired') {
      return jsonResponse({ success: false, error: 'Esta solicitacao foi cancelada ou expirou.' }, 403);
    }
    if (request0.expires_at && new Date(request0.expires_at).getTime() < Date.now()) {
      return jsonResponse({ success: false, error: 'O prazo para assinatura deste documento expirou.' }, 403);
    }

    // Ordem sequencial: o signatario so pode assinar quando todos os de "order"
    // menor ja tiverem assinado. Backstop de seguranca do servidor — a pagina
    // publica tambem bloqueia/avisa, mas a regra real e garantida aqui.
    if (request0.signing_order === 'sequential') {
      const myOrder = typeof signer.order === 'number' ? signer.order : 1;
      const { data: priorSigners } = await supabase
        .from('signature_signers')
        .select('name, order, status')
        .eq('signature_request_id', signer.signature_request_id)
        .lt('order', myOrder)
        .neq('status', 'signed');
      if (priorSigners && priorSigners.length > 0) {
        const next = [...priorSigners].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))[0];
        const nextName = (next?.name || '').trim() || 'o signatario anterior';
        return jsonResponse({
          success: false,
          code: 'OUT_OF_ORDER',
          error: `Ainda nao e a sua vez de assinar. Aguardando a assinatura de ${nextName}. Voce sera avisado quando for a sua vez.`,
        }, 409);
      }
    }

    // Exigencia de CPF (declaracao do cliente): o CPF informado deve conferir com o
    // CPF cadastrado do signatario. Backstop de seguranca do servidor.
    if (request0.require_cpf) {
      const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
      const submittedCpf = onlyDigits(signer_cpf);
      const expectedCpf = onlyDigits(signer.cpf);
      if (submittedCpf.length !== 11) {
        return jsonResponse({ success: false, error: 'CPF e obrigatorio para assinar este documento.' }, 400);
      }
      if (expectedCpf.length === 11 && submittedCpf !== expectedCpf) {
        return jsonResponse({ success: false, error: 'O CPF informado nao confere com o CPF do cliente cadastrado para esta assinatura.' }, 403);
      }
    }

    const STORAGE_BUCKET = 'document-templates';
    const updates: Record<string, unknown> = {
      status: 'signed', signed_at: new Date().toISOString(),
      signer_ip: ip_address||null, signer_user_agent: user_agent||null, signer_geolocation: geolocation||null,
      verification_hash: generateVerificationHash(),
      name: signer_name??signer.name, cpf: signer_cpf??signer.cpf, phone: signer_phone??signer.phone,
      auth_provider: auth_provider||null, auth_email: auth_email||null, auth_google_sub: auth_google_sub||null, auth_google_picture: auth_google_picture||null,
      terms_accepted_at: new Date().toISOString(), terms_version: terms_version||'v1',
    };

    try {
      updates.signature_image_path = await uploadBase64Image(supabase, signature_image, `signature_${signer.id}`, STORAGE_BUCKET);
    } catch (e) { return jsonResponse({ success: false, error: 'Failed to upload signature' }, 500); }

    if (facial_image) {
      try { updates.facial_image_path = await uploadBase64Image(supabase, facial_image, `facial_${signer.id}`, STORAGE_BUCKET); } catch {}
    }

    const { data: updatedSigner, error: updateError } = await supabase.from('signature_signers').update(updates).eq('id', signer.id).select().single();
    if (updateError) return jsonResponse({ success: false, error: 'Failed to update signer' }, 500);
    console.log('✅ Signer updated:', signer.id);

    try {
      await supabase.from('signature_audit_log').insert({ signature_request_id: signer.signature_request_id, signer_id: signer.id, action: 'signed', description: `Documento assinado por ${signer_name||signer.name}`, ip_address: ip_address||null, user_agent: user_agent||null });
    } catch {}

    // Send confirmation email (non-blocking)
    try {
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
      if (supabaseUrl && anonKey) {
        fetch(`${supabaseUrl}/functions/v1/send-signature-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
          body: JSON.stringify({ request_id: updatedSigner.signature_request_id, signer_id: updatedSigner.id, origin: 'https://jurius.com.br' }),
        }).catch((e: unknown) => console.error('Email error:', e))
        console.log('📧 Email disparado para', updatedSigner.id)
      }
    } catch {}

    // Check all signed
    try {
      const { data: allSigners } = await supabase.from('signature_signers').select('status').eq('signature_request_id', signer.signature_request_id);
      if (allSigners?.length && allSigners.every((s: any) => s.status === 'signed')) {
        await supabase.from('signature_requests').update({ status: 'signed', signed_at: new Date().toISOString() }).eq('id', signer.signature_request_id);
        const { data: request } = await supabase.from('signature_requests').select('id,created_by,document_name,client_id,client_name,process_id,process_number,requirement_id,requirement_number,status,signed_at,created_at,updated_at').eq('id', signer.signature_request_id).single();
        if (request?.created_by) {
          await supabase.from('user_notifications').insert({ user_id: request.created_by, title: '✅ Documento Totalmente Assinado!', message: `"${request.document_name}" foi assinado por todos (${allSigners.length}/${allSigners.length})`, type: 'process_updated', read: false, created_at: new Date().toISOString(), metadata: { signature_type: 'completed', signer_name: signer_name||signer.name, signer_email: signer.email, document_name: request.document_name, signed_count: allSigners.length, total_signers: allSigners.length, request_id: signer.signature_request_id } });
        }
        if (request) await dispatchSignatureCompletedWebhook({ request, signer: { id: updatedSigner.id, signature_request_id: updatedSigner.signature_request_id, name: updatedSigner.name, email: updatedSigner.email, cpf: updatedSigner.cpf, phone: updatedSigner.phone, status: updatedSigner.status, signed_at: updatedSigner.signed_at, verification_hash: updatedSigner.verification_hash, auth_provider: updatedSigner.auth_provider }, totalSigners: allSigners.length });
      }
    } catch (e) { console.error('Status update error:', e); }

    return jsonResponse({ success: true, signer: updatedSigner });
  } catch (err) {
    console.error('Unexpected error:', err);
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
});
