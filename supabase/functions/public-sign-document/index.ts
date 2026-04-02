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
        document: {
          id: input.request.id,
          name: input.request.document_name,
          client_name: input.request.client_name,
          process_number: input.request.process_number,
          signed_at: input.request.signed_at,
        },
        signers: await getAllSignersWithLinks(input.request.id as string),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      throw new Error(`Webhook respondeu ${response.status}: ${responseText || response.statusText}`);
    }

    console.log('✅ Signature completion webhook enviado com sucesso');
  } finally {
    clearTimeout(timeout);
  }
}

async function getAllSignersWithLinks(requestId: string): Promise<Array<{
  name: string;
  email: string;
  cpf: string | null;
  phone: string | null;
  client_name: string | null;
  client_id: string | null;
  signed_at: string;
  document_link?: string;
}>> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Buscar signatários com dados do request para ter client_id/client_name
  const { data: signers } = await supabase
    .from('signature_signers')
    .select(`
      name,
      email,
      cpf,
      phone,
      signed_at,
      signed_document_path,
      signature_request_id
    `)
    .eq('signature_request_id', requestId)
    .eq('status', 'signed')
    .order('signed_at', { ascending: true });

  if (!signers || signers.length === 0) return [];

  // Buscar dados do request para obter client_id/client_name
  const { data: request } = await supabase
    .from('signature_requests')
    .select('client_id, client_name')
    .eq('id', requestId)
    .single();

  return await Promise.all(signers.map(async (signer: any) => {
    let documentLink: string | undefined;

    if (signer.signed_document_path) {
      try {
        const buckets = ['assinados', 'generated-documents', 'document-templates'];
        for (const bucket of buckets) {
          try {
            const { data } = await supabase.storage
              .from(bucket)
              .createSignedUrl(signer.signed_document_path, 3600);
            if (data?.signedUrl) {
              documentLink = data.signedUrl;
              break;
            }
          } catch {
            // Tentar próximo bucket
          }
        }
      } catch {
        // Ignorar erro de link
      }
    }

    return {
      name: signer.name,
      email: signer.email,
      cpf: signer.cpf,
      phone: signer.phone,
      client_name: request?.client_name || null,
      client_id: request?.client_id || null,
      signed_at: signer.signed_at,
      document_link: documentLink,
    };
  }));
}

async function uploadBase64Image(
  supabase: ReturnType<typeof createClient>,
  base64: string,
  prefix: string,
  bucket: string
): Promise<string> {
  const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  let extension = 'png';
  if (base64.includes('data:image/jpeg')) extension = 'jpg';
  else if (base64.includes('data:image/webp')) extension = 'webp';

  const filePath = `${prefix}_${Date.now()}.${extension}`;
  const contentType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;

  console.log('[UPLOAD] Uploading:', filePath, 'size:', bytes.length, 'bytes');

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, bytes, {
      contentType,
      upsert: true,
    });

  if (error) {
    console.error('[UPLOAD] Error:', error);
    throw new Error(`Upload failed: ${error.message}`);
  }

  console.log('[UPLOAD] Success:', filePath);
  return filePath;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ success: false, error: 'Supabase env not configured' }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let payload: any = null;
    try {
      const text = await req.text();
      if (!text.trim()) {
        return jsonResponse({ success: false, error: 'Empty request body' }, 400);
      }
      payload = JSON.parse(text);
    } catch (err) {
      console.error('Failed to parse JSON:', err);
      return jsonResponse({ success: false, error: 'Invalid JSON format' }, 400);
    }

    if (!payload || typeof payload !== 'object') {
      return jsonResponse({ success: false, error: 'Invalid payload: expected JSON object' }, 400);
    }

    const {
      token,
      signature_image,
      facial_image,
      geolocation,
      signer_name,
      signer_cpf,
      signer_phone,
      auth_provider,
      auth_email,
      auth_google_sub,
      auth_google_picture,
      ip_address,
      user_agent,
    } = payload;

    console.log('📦 Payload recebido:', Object.keys(payload));

    if (!token) {
      return jsonResponse({ success: false, error: 'Token is required' }, 400);
    }

    if (!signature_image) {
      return jsonResponse({ success: false, error: 'Signature image is required' }, 400);
    }

    // Find signer by public token
    const { data: signer, error: signerError } = await supabase
      .from('signature_signers')
      .select('*')
      .eq('public_token', token)
      .maybeSingle();

    if (signerError || !signer) {
      console.error('Signer not found:', signerError);
      return jsonResponse({ success: false, error: 'Signer not found' }, 404);
    }

    if (signer.status !== 'pending') {
      return jsonResponse({ success: false, error: 'Document already signed or cancelled' }, 400);
    }

    const STORAGE_BUCKET = 'document-templates';

    // Prepare updates
    const updates: Record<string, unknown> = {
      status: 'signed',
      signed_at: new Date().toISOString(),
      signer_ip: ip_address || null,
      signer_user_agent: user_agent || null,
      signer_geolocation: geolocation || null,
      verification_hash: generateVerificationHash(),
      name: signer_name ?? signer.name,
      cpf: signer_cpf ?? signer.cpf,
      phone: signer_phone ?? signer.phone,
      auth_provider: auth_provider || null,
      auth_email: auth_email || null,
      auth_google_sub: auth_google_sub || null,
      auth_google_picture: auth_google_picture || null,
    };

    // Upload signature image
    try {
      const signaturePath = await uploadBase64Image(
        supabase,
        signature_image,
        `signature_${signer.id}`,
        STORAGE_BUCKET
      );
      updates.signature_image_path = signaturePath;
    } catch (uploadErr) {
      console.error('Signature upload failed:', uploadErr);
      return jsonResponse({ success: false, error: 'Failed to upload signature' }, 500);
    }

    // Upload facial image if provided
    if (facial_image) {
      try {
        const facialPath = await uploadBase64Image(
          supabase,
          facial_image,
          `facial_${signer.id}`,
          STORAGE_BUCKET
        );
        updates.facial_image_path = facialPath;
      } catch (uploadErr) {
        console.error('Facial upload failed:', uploadErr);
        // Don't fail the whole operation for facial photo
      }
    }

    // Update signer
    const { data: updatedSigner, error: updateError } = await supabase
      .from('signature_signers')
      .update(updates)
      .eq('id', signer.id)
      .select()
      .single();

    if (updateError) {
      console.error('Update signer failed:', updateError);
      return jsonResponse({ success: false, error: 'Failed to update signer' }, 500);
    }

    console.log('✅ Signer updated successfully:', signer.id);

    // Add audit log
    try {
      await supabase.from('signature_audit_log').insert({
        signature_request_id: signer.signature_request_id,
        signer_id: signer.id,
        action: 'signed',
        description: `Documento assinado por ${signer_name || signer.name}`,
        ip_address: ip_address || null,
        user_agent: user_agent || null,
      });
      console.log('✅ Audit log created');
    } catch (auditErr) {
      console.error('Audit log failed (non-blocking):', auditErr);
    }

    // Check if all signers have signed and update request status
    try {
      const { data: allSigners } = await supabase
        .from('signature_signers')
        .select('status')
        .eq('signature_request_id', signer.signature_request_id);

      if (allSigners && allSigners.length > 0) {
        const allSigned = allSigners.every((s: { status: string }) => s.status === 'signed');
        if (allSigned) {
          await supabase
            .from('signature_requests')
            .update({
              status: 'signed',
              signed_at: new Date().toISOString(),
            })
            .eq('id', signer.signature_request_id);
          console.log('✅ All signers signed, request marked as complete');

          // Create notification for document creator
          const { data: request } = await supabase
            .from('signature_requests')
            .select('id, created_by, document_name, client_id, client_name, process_id, process_number, requirement_id, requirement_number, status, signed_at, created_at, updated_at')
            .eq('id', signer.signature_request_id)
            .single();

          if (request?.created_by) {
            await supabase.from('user_notifications').insert({
              user_id: request.created_by,
              title: '✅ Documento Totalmente Assinado!',
              message: `"${request.document_name}" foi assinado por todos (${allSigners.length}/${allSigners.length})`,
              type: 'process_updated',
              read: false,
              created_at: new Date().toISOString(),
              metadata: {
                signature_type: 'completed',
                signer_name: signer_name || signer.name,
                signer_email: signer.email,
                document_name: request.document_name,
                signed_count: allSigners.length,
                total_signers: allSigners.length,
                request_id: signer.signature_request_id,
              },
            });
            console.log('✅ Notification created for document creator');
          }

          if (request) {
            await dispatchSignatureCompletedWebhook({
              request,
              signer: {
                id: updatedSigner.id,
                signature_request_id: updatedSigner.signature_request_id,
                name: updatedSigner.name,
                email: updatedSigner.email,
                cpf: updatedSigner.cpf,
                phone: updatedSigner.phone,
                status: updatedSigner.status,
                signed_at: updatedSigner.signed_at,
                verification_hash: updatedSigner.verification_hash,
                auth_provider: updatedSigner.auth_provider,
              },
              totalSigners: allSigners.length,
            });
          }
        }
      }
    } catch (statusErr) {
      console.error('Status update failed (non-blocking):', statusErr);
    }

    return jsonResponse({
      success: true,
      signer: updatedSigner,
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
});
