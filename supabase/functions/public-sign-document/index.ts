import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { dispatchWaAiLifecycle } from '../_shared/wa-ai-lifecycle-hook.ts';

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

async function sendCompletionEmail(input: {
  requestId: string;
  signerId: string;
  origin: string;
  skip?: boolean;
}): Promise<void> {
  if (input.skip) return;
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return;
  const res = await fetch(`${supabaseUrl}/functions/v1/send-signature-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature-internal-key': serviceRoleKey,
    },
    body: JSON.stringify({
      request_id: input.requestId,
      signer_id: input.signerId,
      origin: input.origin,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`send-signature-link falhou (${res.status}): ${body || 'sem corpo'}`);
  }
}

async function createCompletionNotification(input: {
  supabase: ReturnType<typeof createClient>;
  request: any;
  signer: any;
  totalSigners: number;
}): Promise<void> {
  if (!input.request?.created_by) return;
  await input.supabase.from('user_notifications').insert({
    user_id: input.request.created_by,
    title: '✅ Documento Totalmente Assinado!',
    message: `"${input.request.document_name}" foi assinado por todos (${input.totalSigners}/${input.totalSigners})`,
    type: 'process_updated',
    read: false,
    created_at: new Date().toISOString(),
    metadata: {
      signature_type: 'completed',
      signer_name: input.signer?.name,
      signer_email: input.signer?.email,
      document_name: input.request.document_name,
      signed_count: input.totalSigners,
      total_signers: input.totalSigners,
      request_id: input.request.id,
    },
  });
}

// ── PROVA DE IDENTIDADE ──────────────────────────────────────────────────────
//
// Até aqui quem afirmava que a identidade do signatário havia sido verificada
// era o NAVEGADOR: `auth_provider`, `auth_email` e `phone` vinham no corpo da
// requisição e eram gravados como fato. As tabelas de OTP existiam, o código
// era mesmo enviado e conferido — mas nada disso era consultado na hora de
// assinar. Uma chamada direta a este endpoint podia produzir uma assinatura
// dizendo "autenticado por telefone, número X" sem que código nenhum tivesse
// existido, e o dossiê imprimia a frase como prova.
//
// Daqui em diante a prova é LIDA do banco, e o que o navegador manda serve no
// máximo para escolher ONDE procurar. O que o relatório mostra sai da linha
// encontrada, nunca do payload.
//
// Um código verificado vale para UMA assinatura: ele é consumido (`consumed_at`)
// ANTES da assinatura ser gravada. Se a gravação falhar depois, o cliente pede
// outro código — o contrário (consumir só no sucesso) deixaria a janela aberta
// para reusar a mesma verificação em duas assinaturas.

const GOOGLE_CLIENT_ID = (Deno.env.get('GOOGLE_SIGNING_CLIENT_ID') ?? '').trim()
  || '249483607462-bgh9hg63orddsjdai5tuicl5gd9p1jj0.apps.googleusercontent.com';

type ProvaDeIdentidade = {
  channel: 'whatsapp' | 'sms' | 'email' | 'google';
  identifier: string;
  /** Sub do Google, quando for o caso — o resto vem da linha de OTP. */
  googleSub?: string | null;
};

/**
 * Confere o token do Google no servidor.
 *
 * A página tem dois caminhos de login (botão do Google Identity, que devolve um
 * `id_token`, e o popup OAuth, que devolve um `access_token`), então os dois são
 * aceitos. Em ambos o que decide é o `aud`: token emitido para OUTRO aplicativo
 * não vale aqui, mesmo sendo um token legítimo do Google.
 */
async function conferirGoogle(
  idToken: string | null,
  accessToken: string | null,
): Promise<{ email: string; sub: string } | null> {
  try {
    if (idToken) {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const info: any = await res.json();
      if (info?.aud !== GOOGLE_CLIENT_ID) return null;
      if (Number(info?.exp ?? 0) * 1000 < Date.now()) return null;
      const email = String(info?.email ?? '').trim().toLowerCase();
      if (!email || (info?.email_verified !== true && info?.email_verified !== 'true')) return null;
      return { email, sub: String(info?.sub ?? '') };
    }
    if (accessToken) {
      // Dois passos de propósito: o `userinfo` diz QUEM é, e o `tokeninfo` diz
      // PARA QUEM o token foi emitido. Sem o segundo, um access token tirado de
      // qualquer outro site passaria.
      const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!infoRes.ok) return null;
      const info: any = await infoRes.json();
      if (info?.aud !== GOOGLE_CLIENT_ID) return null;

      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!userRes.ok) return null;
      const user: any = await userRes.json();
      const email = String(user?.email ?? '').trim().toLowerCase();
      if (!email) return null;
      return { email, sub: String(user?.sub ?? info?.sub ?? '') };
    }
  } catch (e) {
    console.error('conferirGoogle falhou', e);
  }
  return null;
}

/**
 * Exige (e consome) a prova de identidade deste signatário.
 *
 * Devolve `null` quando o escritório não exige autenticação nenhuma — todos os
 * métodos desligados nas Configurações. Devolve `Response` quando a prova falta
 * ou não confere: a assinatura para aqui.
 */
async function exigirProvaDeIdentidade(
  supabase: any,
  signerId: string,
  entrada: {
    authProvider: string | null;
    authEmail: string | null;
    googleIdToken: string | null;
    googleAccessToken: string | null;
  },
): Promise<ProvaDeIdentidade | null | Response> {
  const { data: settingRows } = await supabase
    .from('system_settings')
    .select('key,value')
    .in('key', [
      'public_signature_auth_google',
      'public_signature_auth_email',
      'public_signature_auth_phone',
      'public_signature_auth_whatsapp',
    ]);

  const ligado = (key: string, padrao: boolean): boolean => {
    const row = (settingRows ?? []).find((r: any) => r.key === key);
    if (!row) return padrao;
    return row.value === true || row.value === 'true';
  };

  const googleOn = ligado('public_signature_auth_google', true);
  const emailOn = ligado('public_signature_auth_email', true);
  const phoneOn = ligado('public_signature_auth_phone', true);
  const whatsappOn = ligado('public_signature_auth_whatsapp', false);

  // Nenhum método ligado = a página não pede autenticação. Exigir prova aqui
  // travaria toda assinatura do escritório que decidiu não usar nenhum.
  if (!googleOn && !emailOn && !phoneOn && !whatsappOn) return null;

  const provider = String(entrada.authProvider ?? '').trim();

  if (provider === 'google') {
    if (!googleOn) {
      return jsonResponse({ success: false, error: 'A autenticação pelo Google não está habilitada para esta assinatura.' }, 403);
    }
    const google = await conferirGoogle(entrada.googleIdToken, entrada.googleAccessToken);
    if (!google) {
      return jsonResponse({
        success: false,
        code: 'AUTH_PROOF_REQUIRED',
        error: 'Não foi possível confirmar a sua autenticação com o Google. Recarregue a página e entre novamente antes de assinar.',
      }, 403);
    }
    return { channel: 'google', identifier: google.email, googleSub: google.sub };
  }

  if (provider === 'email_link') {
    if (!emailOn) {
      return jsonResponse({ success: false, error: 'A verificação por e-mail não está habilitada para esta assinatura.' }, 403);
    }
    const { data: rows } = await supabase
      .from('signature_email_otps')
      .select('id,email,verified_at')
      .eq('signer_id', signerId)
      .not('verified_at', 'is', null)
      .is('consumed_at', null)
      .order('verified_at', { ascending: false })
      .limit(1);
    const otp = rows?.[0];
    if (!otp) {
      return jsonResponse({
        success: false,
        code: 'AUTH_PROOF_REQUIRED',
        error: 'A verificação por e-mail não foi concluída. Recarregue a página e valide o código antes de assinar.',
      }, 403);
    }
    // O e-mail que o navegador diz ter usado precisa ser o que RECEBEU o código.
    const declarado = String(entrada.authEmail ?? '').trim().toLowerCase();
    if (declarado && declarado !== String(otp.email ?? '').trim().toLowerCase()) {
      return jsonResponse({ success: false, error: 'O e-mail autenticado não confere com o e-mail que recebeu o código.' }, 403);
    }
    const { data: consumido } = await supabase
      .from('signature_email_otps')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', otp.id)
      .is('consumed_at', null)
      .select('id');
    if (!consumido || consumido.length === 0) {
      return jsonResponse({ success: false, error: 'Esta verificação já foi usada. Solicite um novo código.' }, 409);
    }
    return { channel: 'email', identifier: String(otp.email) };
  }

  // Provedor que não é nenhum dos conhecidos: cliente antigo em cache, ou
  // chamada montada à mão. Não há onde procurar prova, e inventar uma seria o
  // erro que este bloco existe para corrigir.
  if (provider !== 'phone') {
    return jsonResponse({
      success: false,
      code: 'AUTH_PROOF_REQUIRED',
      error: 'É necessário confirmar sua identidade antes de assinar. Recarregue a página e refaça a autenticação.',
    }, 403);
  }

  // Telefone — SMS ou WhatsApp. O canal sai da linha, não do que foi enviado.
  if (!phoneOn && !whatsappOn) {
    return jsonResponse({ success: false, error: 'A verificação por telefone não está habilitada para esta assinatura.' }, 403);
  }
  const { data: rows } = await supabase
    .from('signature_phone_otps')
    .select('id,phone,channel,verified_at')
    .eq('signer_id', signerId)
    .not('verified_at', 'is', null)
    .is('consumed_at', null)
    .order('verified_at', { ascending: false })
    .limit(1);
  const otp = rows?.[0];
  if (!otp) {
    return jsonResponse({
      success: false,
      code: 'AUTH_PROOF_REQUIRED',
      error: 'A verificação do seu telefone não foi concluída. Recarregue a página e valide o código antes de assinar.',
    }, 403);
  }
  const canal = otp.channel === 'whatsapp' ? 'whatsapp' : 'sms';
  if (canal === 'whatsapp' && !whatsappOn) {
    return jsonResponse({ success: false, error: 'A verificação por WhatsApp não está habilitada para esta assinatura.' }, 403);
  }
  if (canal === 'sms' && !phoneOn) {
    return jsonResponse({ success: false, error: 'A verificação por SMS não está habilitada para esta assinatura.' }, 403);
  }
  const { data: consumido } = await supabase
    .from('signature_phone_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', otp.id)
    .is('consumed_at', null)
    .select('id');
  if (!consumido || consumido.length === 0) {
    return jsonResponse({ success: false, error: 'Esta verificação já foi usada. Solicite um novo código.' }, 409);
  }
  return { channel: canal, identifier: String(otp.phone) };
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

    const action = String(payload?.action ?? 'sign').trim();
    const { token, signature_image, facial_image, geolocation, signer_name, signer_cpf, signer_phone, auth_provider, auth_email, auth_google_sub, auth_google_picture, ip_address, user_agent, terms_accepted, terms_version, terms_accepted_at, allow_signature_selfie_for_profile, selfie_profile_consent_version, auth_at, facial_captured_at, geolocation_captured_at } = payload;

    if (!token) return jsonResponse({ success: false, error: 'Token is required' }, 400);
    const { data: signer, error: signerError } = await supabase.from('signature_signers').select('*').eq('public_token', token).maybeSingle();
    if (signerError || !signer) return jsonResponse({ success: false, error: 'Signer not found' }, 404);

    // P0: validar estado de ciclo de vida da solicitacao antes de permitir assinatura
    const { data: request0, error: request0Error } = await supabase
      .from('signature_requests')
      .select('id, status, deleted_at, archived_at, blocked_at, expires_at, require_cpf, signing_order, auth_method, signature_model, attachment_paths, document_name, client_name, process_number, signed_at, created_by, updated_at, envelope_verification_code')
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

    if (action === 'finalize_per_document') {
      if (request0.signature_model !== 'per_document') {
        return jsonResponse({ success: false, error: 'Solicitacao nao usa o modelo per_document.' }, 400);
      }
      if (signer.status !== 'signed') {
        return jsonResponse({ success: false, error: 'O signatario ainda nao concluiu a assinatura.' }, 409);
      }

      const origin = String(payload?.origin ?? 'https://jurius.com.br').trim().replace(/\/$/, '') || 'https://jurius.com.br';
      const expectedDocumentCount = Math.max(
        1,
        Number(payload?.expected_document_count ?? 1 + (Array.isArray(request0.attachment_paths) ? request0.attachment_paths.length : 0)),
      );

      const [{ data: docs }, { data: allSigners }] = await Promise.all([
        supabase
          .from('signature_request_documents')
          .select('id, signed_file_path')
          .eq('signature_request_id', signer.signature_request_id)
          .not('signed_file_path', 'is', null),
        supabase
          .from('signature_signers')
          .select('id, status')
          .eq('signature_request_id', signer.signature_request_id),
      ]);

      const persistedCount = docs?.length ?? 0;
      const allSigned = !!allSigners?.length && allSigners.every((item: any) => item.status === 'signed');

      if (!allSigned) {
        return jsonResponse({ success: true, finalized: false, reason: 'awaiting_signers', persisted_count: persistedCount, expected_document_count: expectedDocumentCount }, 200);
      }

      if (persistedCount < expectedDocumentCount) {
        await supabase.from('signature_audit_log').insert({
          signature_request_id: signer.signature_request_id,
          signer_id: signer.id,
          action: 'finalization_failed',
          description: `Finalizacao per_document bloqueada: esperados ${expectedDocumentCount} documento(s), persistidos ${persistedCount}.`,
          ip_address: ip_address || null,
          user_agent: user_agent || null,
        });
        return jsonResponse({
          success: false,
          error: `Finalizacao incompleta: esperados ${expectedDocumentCount} documento(s), persistidos ${persistedCount}.`,
          code: 'PER_DOCUMENT_PERSISTENCE_INCOMPLETE',
          persisted_count: persistedCount,
          expected_document_count: expectedDocumentCount,
        }, 409);
      }

      const wasAlreadySigned = request0.status === 'signed';
      if (!wasAlreadySigned) {
        await supabase
          .from('signature_requests')
          .update({
            status: 'signed',
            signed_at: new Date().toISOString(),
            envelope_verification_code: request0.envelope_verification_code || generateVerificationHash(),
          })
          .eq('id', signer.signature_request_id);

        await supabase.from('signature_audit_log').insert({
          signature_request_id: signer.signature_request_id,
          signer_id: signer.id,
          action: 'finalized',
          description: `Envelope finalizado com ${persistedCount} documento(s) persistido(s).`,
          ip_address: ip_address || null,
          user_agent: user_agent || null,
        });

        const { data: request } = await supabase
          .from('signature_requests')
          .select('id,created_by,document_name,client_id,client_name,process_id,process_number,requirement_id,requirement_number,status,signed_at,created_at,updated_at,envelope_verification_code')
          .eq('id', signer.signature_request_id)
          .single();

        if (request) {
          await createCompletionNotification({
            supabase,
            request,
            signer,
            totalSigners: allSigners.length,
          });
          await dispatchSignatureCompletedWebhook({
            request,
            signer: {
              id: signer.id,
              signature_request_id: signer.signature_request_id,
              name: signer.name,
              email: signer.email,
              cpf: signer.cpf,
              phone: signer.phone,
              status: signer.status,
              signed_at: signer.signed_at,
              verification_hash: signer.verification_hash,
              auth_provider: signer.auth_provider,
            },
            totalSigners: allSigners.length,
          });
        }

        await sendCompletionEmail({
          requestId: signer.signature_request_id,
          signerId: signer.id,
          origin,
        });
      }

      return jsonResponse({
        success: true,
        finalized: true,
        persisted_count: persistedCount,
        expected_document_count: expectedDocumentCount,
      });
    }

    if (action === 'report_per_document_failure') {
      const stage = String(payload?.stage ?? 'unknown').trim() || 'unknown';
      const errorMessage = String(payload?.error ?? 'Falha desconhecida').trim();
      const expectedDocumentCount = Number(payload?.expected_document_count ?? 0);
      const persistedCount = Number(payload?.persisted_count ?? 0);
      await supabase.from('signature_audit_log').insert({
        signature_request_id: signer.signature_request_id,
        signer_id: signer.id,
        action: 'finalization_failed',
        description: `Falha na conclusao per_document (${stage}). Persistidos ${persistedCount}/${expectedDocumentCount}. Erro: ${errorMessage}`.slice(0, 1000),
        ip_address: ip_address || null,
        user_agent: user_agent || null,
      });
      return jsonResponse({ success: true, logged: true });
    }

    if (!signature_image) return jsonResponse({ success: false, error: 'Signature image is required' }, 400);
    if (signer.status !== 'pending') return jsonResponse({ success: false, error: 'Document already signed or cancelled' }, 400);
    // Aceite dos Termos de Uso (LGPD) e obrigatorio para assinar. Backstop do servidor.
    if (terms_accepted !== true) return jsonResponse({ success: false, error: 'E necessario aceitar os Termos de Uso para assinar.' }, 400);

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

    // Verificacao facial (selfie): quando o metodo de autenticacao configurado
    // exige biometria, a selfie passa a ser OBRIGATORIA no servidor. Antes a
    // coleta era garantida apenas no front-end, permitindo assinaturas sem foto
    // quando o cliente nao concluia a etapa (camera negada / bundle em cache /
    // chamada direta ao endpoint publico). Backstop de seguranca do servidor.
    const facialRequired = request0.auth_method === 'signature_facial' || request0.auth_method === 'signature_facial_document';
    if (facialRequired && !facial_image) {
      return jsonResponse({ success: false, error: 'A verificacao facial (selfie) e obrigatoria para assinar este documento.' }, 400);
    }

    // Prova de identidade conferida NO SERVIDOR (ver o bloco no topo do
    // arquivo). Vem depois das demais travas de propósito: ela CONSOME o
    // código verificado, e consumir um código para uma assinatura que ia ser
    // recusada por CPF ou por ordem obrigaria a pessoa a pedir outro à toa.
    const prova = await exigirProvaDeIdentidade(supabase, signer.id, {
      authProvider: auth_provider ?? null,
      authEmail: auth_email ?? null,
      googleIdToken: payload?.auth_google_credential ?? null,
      googleAccessToken: payload?.auth_google_access_token ?? null,
    });
    if (prova instanceof Response) return prova;

    const STORAGE_BUCKET = 'document-templates';

    // Instantes REAIS das etapas probatórias, reportados pelo cliente no ato de
    // cada uma (autenticação, selfie, localização) e CLAMPADOS pelo servidor à
    // janela [viewed_at, now()] — o cliente não consegue alegar um instante
    // anterior à abertura do documento nem no futuro. Sem isso o dossiê exibia
    // todos esses eventos com o MESMO segundo (reutilizava viewed_at).
    const stepWindowStartMs = (() => {
      const t = new Date(signer.viewed_at || signer.opened_at || signer.created_at || 0).getTime();
      return Number.isNaN(t) ? 0 : t;
    })();
    const clampStepTs = (v: unknown): string | null => {
      if (typeof v !== 'string' || !v.trim()) return null;
      const t = new Date(v).getTime();
      if (Number.isNaN(t)) return null;
      return new Date(Math.min(Math.max(t, stepWindowStartMs), Date.now())).toISOString();
    };

    const updates: Record<string, unknown> = {
      status: 'signed', signed_at: new Date().toISOString(),
      signer_ip: ip_address||null, signer_user_agent: user_agent||null, signer_geolocation: geolocation||null,
      verification_hash: generateVerificationHash(),
      name: signer_name??signer.name, cpf: signer_cpf??signer.cpf, phone: signer_phone??signer.phone,
      auth_provider: auth_provider||null,
      // O e-mail e o sub do Google param de vir do navegador quando existe
      // prova: o que fica gravado é o que o servidor conferiu. O `phone` acima
      // continua sendo o DECLARADO no formulário — quem diz qual telefone foi
      // confirmado é `auth_verified_identifier`, e são coisas diferentes.
      auth_email: (prova?.channel === 'google' || prova?.channel === 'email') ? prova.identifier : (auth_email||null),
      auth_google_sub: prova?.channel === 'google' ? (prova.googleSub || null) : (prova ? null : (auth_google_sub||null)),
      auth_google_picture: auth_google_picture||null,
      auth_verified_at: prova ? new Date().toISOString() : null,
      auth_verified_channel: prova?.channel ?? null,
      auth_verified_identifier: prova?.identifier ?? null,
      auth_at: clampStepTs(auth_at),
      geolocation_captured_at: geolocation ? clampStepTs(geolocation_captured_at) : null,
      // Instante REAL do aceite, reportado pelo cliente e clampado à janela
      // [viewed_at, now()] como as demais etapas. Gravar `new Date()` aqui fazia
      // `terms_accepted_at` sair com o MESMO milissegundo de `signed_at` em
      // 100% das assinaturas — e dois instantes idênticos leem como se o
      // consentimento não tivesse precedido o ato, mas sido carimbado junto.
      // Sem valor do cliente (versões antigas do front), cai no comportamento
      // anterior para não gravar nulo.
      terms_accepted_at: clampStepTs(terms_accepted_at) ?? new Date().toISOString(),
      terms_version: terms_version||'v1',
      // Consentimento SEPARADO e opcional p/ usar a selfie como foto cadastral.
      // Default false: a assinatura nunca depende deste consentimento.
      allow_signature_selfie_for_profile: allow_signature_selfie_for_profile === true,
      selfie_profile_consent_at: allow_signature_selfie_for_profile === true ? new Date().toISOString() : null,
      selfie_profile_consent_version: allow_signature_selfie_for_profile === true ? (selfie_profile_consent_version||'v1') : null,
    };

    try {
      updates.signature_image_path = await uploadBase64Image(supabase, signature_image, `signature_${signer.id}`, STORAGE_BUCKET);
    } catch (e) { return jsonResponse({ success: false, error: 'Failed to upload signature' }, 500); }

    if (facial_image) {
      try { updates.facial_image_path = await uploadBase64Image(supabase, facial_image, `facial_${signer.id}`, STORAGE_BUCKET); } catch {}
      updates.facial_captured_at = clampStepTs(facial_captured_at);
    }

    const { data: updatedSigner, error: updateError } = await supabase.from('signature_signers').update(updates).eq('id', signer.id).select().single();
    if (updateError) return jsonResponse({ success: false, error: 'Failed to update signer' }, 500);
    console.log('✅ Signer updated:', signer.id);

    try {
      // A identidade confirmada entra na MESMA linha do 'signed' — a lista de
      // ações do log tem CHECK e cadeia de hash, e um tipo novo pediria
      // migration na trilha à prova de adulteração para dizer o que cabe aqui.
      const selo = prova
        ? ` · identidade confirmada por ${({ whatsapp: 'WhatsApp', sms: 'SMS', email: 'e-mail', google: 'conta Google' } as Record<string, string>)[prova.channel]} (${prova.identifier})`
        : '';
      await supabase.from('signature_audit_log').insert({ signature_request_id: signer.signature_request_id, signer_id: signer.id, action: 'signed', description: `Documento assinado por ${signer_name||signer.name}${selo}`, ip_address: ip_address||null, user_agent: user_agent||null });
    } catch {}

    // No modelo per_document, o e-mail precisa esperar a persistência dos PDFs
    // finais do envelope. O disparo fica no cliente após essa etapa.
    try {
      if (request0.signature_model !== 'per_document') {
        await sendCompletionEmail({
          requestId: updatedSigner.signature_request_id,
          signerId: updatedSigner.id,
          origin: 'https://jurius.com.br',
        });
        console.log('📧 Email disparado para', updatedSigner.id);
      }
    } catch (e) {
      console.error('Email error:', e);
    }

    // Check all signed
    try {
      const { data: allSigners } = await supabase.from('signature_signers').select('status').eq('signature_request_id', signer.signature_request_id);
      if (request0.signature_model !== 'per_document' && allSigners?.length && allSigners.every((s: any) => s.status === 'signed')) {
        await supabase.from('signature_requests').update({ status: 'signed', signed_at: new Date().toISOString() }).eq('id', signer.signature_request_id);
        const { data: request } = await supabase.from('signature_requests').select('id,created_by,document_name,client_id,client_name,process_id,process_number,requirement_id,requirement_number,status,signed_at,created_at,updated_at').eq('id', signer.signature_request_id).single();
        if (request) await createCompletionNotification({ supabase, request, signer, totalSigners: allSigners.length });
        if (request) await dispatchSignatureCompletedWebhook({ request, signer: { id: updatedSigner.id, signature_request_id: updatedSigner.signature_request_id, name: updatedSigner.name, email: updatedSigner.email, cpf: updatedSigner.cpf, phone: updatedSigner.phone, status: updatedSigner.status, signed_at: updatedSigner.signed_at, verification_hash: updatedSigner.verification_hash, auth_provider: updatedSigner.auth_provider }, totalSigners: allSigners.length });
        const { data: fillLink } = await supabase.from('template_fill_links')
          .select('conversation_id').eq('signature_request_id', signer.signature_request_id)
          .not('conversation_id', 'is', null).limit(1).maybeSingle();
        if (fillLink?.conversation_id) {
          await dispatchWaAiLifecycle({
            supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
            serviceRole: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
            conversationId: fillLink.conversation_id,
            trigger: 'signature_completed',
            resourceId: signer.signature_request_id,
          }).catch(error => console.error('wa-ai signature lifecycle:', error));
        }
      }
    } catch (e) { console.error('Status update error:', e); }

    return jsonResponse({ success: true, signer: updatedSigner });
  } catch (err) {
    console.error('Unexpected error:', err);
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
});
