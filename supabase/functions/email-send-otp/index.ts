import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

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

    const smtpHost = 'smtp.hostinger.com'
    const smtpPort = 465
    const smtpUser = 'assinatura@advcuiaba.com'
    const smtpPass = 'f3a8b2c9d1e0f4a5B6c7d6e7F8a9b0c1d2e3f4a5b6c7d8e9E@'
    const smtpFrom = 'assinatura@advcuiaba.com'
    const smtpFromName = 'Jurius - Assinatura Eletrônica'

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !smtpFrom) {
      return jsonResponse({ success: false, error: 'SMTP Hostinger não configurado' })
    }

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

    const subject = 'Código de verificação - Jurius'
    const content = `Jurius - Assinatura Eletrônica

Seu código de verificação é: ${code}

Validade: 5 minutos.
Se você não solicitou este código, ignore este e-mail.

---
[Template v2 Orange]` // Assinatura visual para depurar

    const brandOrange = '#f97316'
    const brandOrangeDark = '#ea580c'
    const slate900 = '#0f172a'
    const slate600 = '#475569'
    const slate200 = '#e2e8f0'
    const slate50 = '#f8fafc'

    const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Jurius - Código de Verificação</title>
    <style>
      @media only screen and (max-width: 600px) {
        .container { width: 100% !important; max-width: 100% !important; }
        .padding { padding: 16px !important; }
        .padding-sm { padding: 12px !important; }
        .logo-text { font-size: 18px !important; }
        .logo-subtext { font-size: 11px !important; }
        .code { font-size: 28px !important; letter-spacing: 4px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${slate50};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${slate50};">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${slate200};border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="background:${brandOrange};background:linear-gradient(135deg, ${brandOrange} 0%, ${brandOrangeDark} 100%);padding:28px 28px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                        <tr>
                          <td valign="middle" style="width:52px;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="44" height="44" style="width:44px;height:44px;background:#ffffff;border-radius:12px;">
                              <tr>
                                <td align="center" valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;color:${brandOrangeDark};">J</td>
                              </tr>
                            </table>
                          </td>
                          <td valign="middle" style="padding-left:12px;">
                            <div class="logo-text" style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.2;font-weight:800;color:#ffffff;">Jurius</div>
                            <div class="logo-subtext" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.2;font-weight:600;color:#fff7ed;">Assinatura Eletrônica</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="padding" style="padding:28px 28px 8px 28px;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:800;color:${slate900};">Código de verificação</div>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${slate600};padding-top:6px;">Use o código abaixo para confirmar sua identidade na assinatura.</div>
              </td>
            </tr>

            <tr>
              <td class="padding" style="padding:16px 28px 20px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff7ed;border:1px dashed #fdba74;border-radius:14px;">
                  <tr>
                    <td align="center" class="padding-sm" style="padding:18px 12px;">
                      <div class="code" style="font-family:'Courier New',Courier,monospace;font-size:34px;line-height:1.1;font-weight:800;letter-spacing:6px;color:${slate900};">${code}</div>
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:${slate600};padding-top:10px;">Válido por <b>5 minutos</b>.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="padding" style="padding:0 28px 24px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${slate50};border:1px solid ${slate200};border-radius:12px;">
                  <tr>
                    <td class="padding-sm" style="padding:14px 16px;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${slate900};font-weight:700;">Segurança</div>
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${slate600};padding-top:4px;">Se você não solicitou este código, ignore este e-mail. Nunca compartilhe códigos de verificação com terceiros.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="padding" style="padding:18px 28px;border-top:1px solid ${slate200};background:${slate50};">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:${slate600};text-align:center;">
                  <b style="color:${slate900};">Jurius</b> • Assinatura Eletrônica
                </div>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:#94a3b8;text-align:center;padding-top:4px;">
                  Este e-mail foi enviado automaticamente.
                  <br/>
                  <span style="color:#f97316;font-weight:bold;">[Template v3 Responsivo]</span>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

    const client = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port: smtpPort,
        tls: true,
        auth: {
          username: smtpUser,
          password: smtpPass,
        },
      },
    })

    try {
      await client.send({
        from: `${smtpFromName} <${smtpFrom}>`,
        to: email,
        subject,
        content,
        html,
        replyTo: smtpFrom,
        headers: {
          'X-Mailer': 'Jurius Signature System',
          'X-Priority': '1',
          'Importance': 'high',
        },
      })
      console.log('DEBUG EMAIL SEND SUCCESS: email enviado para', email)
    } catch (err) {
      console.error('DEBUG EMAIL SEND ERROR:', err)
      throw err
    } finally {
      try {
        await client.close()
      } catch {
        // ignore
      }
    }

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
