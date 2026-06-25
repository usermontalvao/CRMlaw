import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeEmail(value: string): string {
  return String(value || '').trim().toLowerCase()
}

function isValidEmail(email: string): boolean {
  if (!email) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function generateOtp6(): string {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  const n = arr[0] % 1_000_000
  return String(n).padStart(6, '0')
}

async function loadEmailTemplate(
  supabase: any,
  trigger: string,
): Promise<{ subject: string; bodyHtml: string } | null> {
  try {
    const { data } = await supabase
      .from('system_settings').select('value').eq('key', 'email_templates').single()
    if (!Array.isArray(data?.value)) return null
    const tpl = data.value.find((t: any) => t.trigger === trigger && t.is_custom === true)
    if (!tpl?.body_html) return null
    return { subject: tpl.subject ?? '', bodyHtml: tpl.body_html }
  } catch { return null }
}

function applyTemplateVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}

async function loadOfficeName(supabase: any): Promise<string> {
  try {
    const { data } = await supabase
      .from('system_settings').select('value').eq('key', 'office_identity').single()
    return data?.value?.name ?? 'Escritório'
  } catch { return 'Escritório' }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ success: false, error: 'Supabase env não configurado' })
    }

    // E-mail via Resend (chave em secret RESEND_API_KEY). Remetente no domínio
    // verificado jurius.com.br; nenhuma credencial fica no código.
    const fromEmail = 'noreply@jurius.com.br'
    const fromName = 'Jurius - Assinatura Eletrônica'
    const replyTo = 'assinatura@advcuiaba.com'

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const payload = await req.json().catch(() => null)
    const token = String(payload?.token ?? '').trim()
    const emailRaw = String(payload?.email ?? '').trim()
    const email = normalizeEmail(emailRaw)

    if (!token) {
      return jsonResponse({ success: false, error: 'Token inválido' })
    }

    if (!isValidEmail(email)) {
      return jsonResponse({ success: false, error: 'E-mail inválido' })
    }

    const { data: signer, error: signerError } = await supabase
      .from('signature_signers')
      .select('id,status')
      .eq('public_token', token)
      .maybeSingle()

    if (signerError || !signer) {
      return jsonResponse({ success: false, error: 'Signatário não encontrado' })
    }

    if (signer.status !== 'pending') {
      return jsonResponse({ success: false, error: 'Este documento já foi assinado ou não está disponível' })
    }

    const { data: lastOtp } = await supabase
      .from('signature_email_otps')
      .select('created_at')
      .eq('signer_id', signer.id)
      .order('created_at', { ascending: false })
      .limit(1)

    if (lastOtp && lastOtp.length > 0) {
      const lastAt = new Date(lastOtp[0].created_at)
      const diffMs = Date.now() - lastAt.getTime()
      if (diffMs < 60_000) {
        return jsonResponse({ success: false, error: 'Aguarde um minuto antes de solicitar outro código.' })
      }
    }

    const code = generateOtp6()
    const expiresAt = new Date(Date.now() + 5 * 60_000) // 5 minutos

    // DEBUG: Log para depurar envio
    console.log('DEBUG EMAIL SEND:', {
      to: email,
      code,
      expiresAt: expiresAt.toISOString(),
      timestamp: new Date().toISOString()
    })

    const customTpl = await loadEmailTemplate(supabase, 'signature_otp')
    const officeName = customTpl ? await loadOfficeName(supabase) : ''

    let subjectLine: string
    let emailHtml: string

    if (customTpl) {
      const vars: Record<string, string> = {
        codigo: code,
        validade: '5 minutos',
        escritorio_nome: officeName,
      }
      emailHtml = applyTemplateVars(customTpl.bodyHtml, vars)
      subjectLine = customTpl.subject
        ? applyTemplateVars(customTpl.subject, vars)
        : 'Código de verificação - Jurius'
    } else {
      subjectLine = 'Código de verificação - Jurius'

    const brandOrange = '#f97316'
    const brandOrangeDark = '#ea580c'
    const slate900 = '#0f172a'
    const slate600 = '#475569'
    const slate200 = '#e2e8f0'
    const slate50 = '#f8fafc'

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Spectral:wght@400;700&family=Space+Grotesk:wght@600&display=swap');
    @media only screen and (max-width:600px){
      .container{width:100%!important;border-radius:0!important;}
      .card-pad{padding:24px 20px!important;}
      .code-text{font-size:28px!important;letter-spacing:4px!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#EEF0F4;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EEF0F4;">
    <tr><td align="center" style="padding:32px 16px 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container" style="width:100%;max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 20px 50px -20px rgba(20,28,52,0.22),0 4px 14px -6px rgba(20,28,52,0.10);">

        <tr><td style="height:5px;background:linear-gradient(90deg,#F5762B 0%,#E14E14 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

        <tr><td class="card-pad" style="padding:28px 36px;border-bottom:1px solid #F0F1F4;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td valign="middle" width="52">
                <img src="https://uajwkqipbyxzvwjpitxl.supabase.co/storage/v1/object/public/profile-banners/logo.png" width="52" height="52" alt="Jurius" style="display:block;border:0;border-radius:14px;">
              </td>
              <td width="28" style="padding:0 14px;"><div style="width:1px;height:36px;background:#E7E9EE;"></div></td>
              <td valign="middle">
                <div style="font-family:'Spectral',Georgia,'Times New Roman',serif;font-size:26px;line-height:1;letter-spacing:-.012em;"><span style="color:#211C18;font-weight:700;">jurius</span><span style="color:#E45C12;font-weight:700;">.</span><span style="font-weight:400;color:#A0958C;">com.br</span></div>
                <div style="margin-top:6px;font-family:'Space Grotesk',Arial,Helvetica,sans-serif;font-size:8px;font-weight:600;letter-spacing:0.28em;color:#A0958C;text-transform:uppercase;">GESTÃO JURÍDICA INTELIGENTE</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td class="card-pad" style="padding:32px 36px 12px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.16em;color:#EC5A1E;text-transform:uppercase;margin-bottom:12px;">Assinatura Eletrônica</div>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#16213A;letter-spacing:-0.015em;">Código de verificação</div>
          <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#54607A;">Use o código abaixo para confirmar sua identidade e concluir a assinatura do documento.</p>
        </td></tr>

        <tr><td style="padding:20px 36px 4px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFF6EE;border:1px solid #FAD9C0;border-radius:16px;overflow:hidden;">
            <tr><td style="height:4px;background:linear-gradient(90deg,#F5762B,#E14E14);font-size:0;">&nbsp;</td></tr>
            <tr><td align="center" style="padding:28px 24px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.12em;color:#B0834F;text-transform:uppercase;margin-bottom:16px;">Seu código</div>
              <div class="code-text" style="font-family:'Courier New',Courier,monospace;font-size:38px;font-weight:900;letter-spacing:8px;color:#16213A;line-height:1;">${code}</div>
              <div style="margin-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#54607A;">Válido por <strong style="color:#16213A;">5 minutos</strong>.</div>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:16px 36px 4px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F8F9FB;border:1px solid #E8EAF0;border-radius:12px;">
            <tr><td style="padding:14px 18px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;color:#303A52;margin-bottom:4px;">Segurança</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#54607A;">Se você não solicitou este código, ignore este e-mail. Nunca compartilhe códigos de verificação com terceiros.</div>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:28px 36px 32px;text-align:center;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#97A0B2;">Este código expira em 5 minutos. Caso precise de um novo código, acesse a página de assinatura novamente.</p>
        </td></tr>

        <tr><td style="padding:18px 24px 16px;border-top:1px solid #F0F1F4;text-align:center;background:#F8F9FB;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5C667C;font-weight:600;">Jurius &bull; Gestão Jurídica Inteligente</div>
          <div style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.6;color:#9AA2B2;">Este e-mail foi enviado automaticamente. Não responda esta mensagem.<br/>© 2026 Jurius. Todos os direitos reservados.</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
      emailHtml = html
    }

    const content = `Jurius - Assinatura Eletrônica\n\nSeu código de verificação é: ${code}\n\nValidade: 5 minutos.\nSe você não solicitou este código, ignore este e-mail.`

    // Remetente: usa o e-mail de Configurações só se for do domínio verificado
    const { data: emailCfgRow } = await supabase.from('system_settings').select('value').eq('key', 'email_integration_config').maybeSingle()
    const cfgFromName: string = emailCfgRow?.value?.from_name ?? ''
    const cfgFromEmail: string = emailCfgRow?.value?.from_email ?? ''
    const fromSender = (cfgFromName && cfgFromEmail && cfgFromEmail.endsWith('@jurius.com.br'))
      ? `${cfgFromName} <${cfgFromEmail}>`
      : `${fromName} <${fromEmail}>`

    // Chave do Resend: secret ou fallback em system_settings (igual weekly-digest)
    let resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
    if (!resendKey) {
      const { data: s } = await supabase.from('system_settings').select('value').eq('key', 'notification_config').single()
      resendKey = s?.value?.weekly_digest_resend_key ?? ''
    }
    if (!resendKey) {
      return jsonResponse({ success: false, error: 'Resend API key não configurada' })
    }

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromSender,
        to: [email],
        reply_to: replyTo,
        subject: subjectLine,
        html: emailHtml,
        text: content,
      }),
    })
    if (!sendRes.ok) {
      const errText = await sendRes.text().catch(() => '')
      console.error('Resend OTP error:', sendRes.status, errText)
      return jsonResponse({ success: false, error: `Resend ${sendRes.status}` })
    }
    console.log('OTP enviado via Resend para', email)

    const otpHash = await sha256Hex(`${code}|${signer.id}|${email}`)

    const { error: insError } = await supabase
      .from('signature_email_otps')
      .insert({
        signer_id: signer.id,
        email,
        otp_hash: otpHash,
        expires_at: expiresAt.toISOString(),
      })

    if (insError) {
      return jsonResponse({ success: false, error: insError.message || 'Não foi possível registrar o OTP' })
    }

    return jsonResponse({
      success: true,
      expires_at: expiresAt.toISOString(),
    })
  } catch (error: any) {
    return jsonResponse({ success: false, error: error?.message || 'Erro desconhecido' })
  }
})
