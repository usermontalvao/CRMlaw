import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SMTP_HOST = 'smtp.hostinger.com'
const SMTP_PORT = 465
const SMTP_USER = 'assinatura@advcuiaba.com'
const SMTP_PASS = 'f3a8b2c9d1e0f4a5B6c7d6e7F8a9b0c1d2e3f4a5b6c7d8e9E@'
const SMTP_FROM = 'assinatura@advcuiaba.com'
const SMTP_FROM_NAME = 'Jurius - Assinatura Digital'

const O1 = '#ea580c'   // brand orange
const O2 = '#f97316'   // brand orange light
const S9 = '#0f172a'   // slate-900
const S7 = '#334155'   // slate-700
const S6 = '#475569'   // slate-600
const S4 = '#94a3b8'   // slate-400
const S2 = '#e2e8f0'   // slate-200
const S1 = '#f1f5f9'   // slate-100
const S0 = '#f8fafc'   // slate-50

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Manaus',
  })
}

function buildEmail(params: {
  documentName: string
  clientName: string
  signerName: string
  signedAt: string
  publicLink: string
  verifyLink: string
  verificationCode: string
  origin: string
}): string {
  const { documentName, clientName, signerName, signedAt, publicLink, verifyLink, verificationCode, origin } = params

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Assinatura concluída – Jurius</title>
  <style>
    @media only screen and (max-width:600px){
      .wrap{width:100%!important;max-width:100%!important;}
      .pad{padding:24px 20px!important;}
      .pad-sm{padding:0 20px 20px!important;}
      .doc-title{font-size:14px!important;}
      .btn-primary,.btn-secondary{display:block!important;text-align:center!important;width:100%!important;box-sizing:border-box!important;}
      .btn-cell{display:block!important;width:100%!important;padding:0 0 10px 0!important;}
      .meta-cell{display:block!important;width:100%!important;padding:0 0 10px 0!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef2f7;">
<tr><td align="center" style="padding:40px 12px 60px;">

  <table role="presentation" class="wrap" cellpadding="0" cellspacing="0" border="0" width="600"
    style="width:100%;max-width:600px;">

    <!-- ── BRAND ROW ── -->
    <tr>
      <td align="center" style="padding-bottom:28px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td valign="middle">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                style="width:32px;height:32px;background:linear-gradient(135deg,${O2} 0%,${O1} 100%);border-radius:9px;">
                <tr><td align="center" valign="middle"
                  style="font-size:16px;font-weight:900;color:#fff;font-family:Arial,sans-serif;line-height:32px;">J</td></tr>
              </table>
            </td>
            <td valign="middle" style="padding-left:10px;">
              <span style="font-size:17px;font-weight:900;color:#0f172a;letter-spacing:-0.03em;font-family:Arial,sans-serif;">JURIUS</span>
              <span style="font-size:11px;color:#94a3b8;font-weight:500;margin-left:7px;letter-spacing:0.03em;">Assinatura Digital</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── MAIN CARD ── -->
    <tr>
      <td style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 2px 4px rgba(15,23,42,0.06),0 12px 40px rgba(15,23,42,0.08);">

        <!-- TOP ACCENT -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="height:4px;background:linear-gradient(90deg,${O2} 0%,${O1} 60%,#c2410c 100%);font-size:0;line-height:0;"> </td></tr>
        </table>

        <!-- HERO -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td class="pad" style="padding:44px 40px 36px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 22px;">
                <tr>
                  <td align="center" valign="middle"
                    style="width:66px;height:66px;background:#f0fdf4;border-radius:50%;border:2px solid #86efac;font-size:30px;line-height:66px;">
                    ✓
                  </td>
                </tr>
              </table>
              <div style="font-size:28px;font-weight:800;color:#0f172a;line-height:1.2;letter-spacing:-0.025em;margin-bottom:12px;font-family:Arial,sans-serif;">
                Assinatura concluída
              </div>
              <div style="font-size:15px;color:#64748b;line-height:1.7;max-width:400px;margin:0 auto;">
                Olá, <strong style="color:#1e293b;font-weight:700;">${signerName}</strong> — seu documento foi assinado digitalmente e possui plena validade jurídica.
              </div>
            </td>
          </tr>
        </table>

        <!-- DIVIDER -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:0 40px;"><div style="height:1px;background:#f1f5f9;font-size:0;"> </div></td></tr>
        </table>

        <!-- DOCUMENT SECTION -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td class="pad" style="padding:32px 40px 24px;">
              <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:14px;font-family:Arial,sans-serif;">Documento</div>

              <!-- Doc card -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:13px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td valign="middle" width="44">
                          <div style="width:40px;height:50px;background:#fff7ed;border:1.5px solid #fed7aa;border-radius:9px;text-align:center;line-height:50px;font-size:20px;">📄</div>
                        </td>
                        <td valign="middle" style="padding-left:14px;">
                          <div class="doc-title" style="font-size:14.5px;font-weight:700;color:#0f172a;line-height:1.35;margin-bottom:5px;font-family:Arial,sans-serif;">${documentName}</div>
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="width:7px;height:7px;background:#16a34a;border-radius:50%;vertical-align:middle;"> </td>
                              <td style="padding-left:6px;font-size:11.5px;font-weight:600;color:#16a34a;vertical-align:middle;">Assinado digitalmente · certificado</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Meta grid -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px;">
                <tr>
                  <td class="meta-cell" width="50%" style="padding-right:6px;vertical-align:top;">
                    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:11px;padding:14px 16px;">
                      <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:5px;font-family:Arial,sans-serif;">Signatário</div>
                      <div style="font-size:13.5px;font-weight:600;color:#1e293b;font-family:Arial,sans-serif;">${signerName}</div>
                    </div>
                  </td>
                  <td class="meta-cell" width="50%" style="padding-left:6px;vertical-align:top;">
                    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:11px;padding:14px 16px;">
                      <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:5px;font-family:Arial,sans-serif;">Data e hora</div>
                      <div style="font-size:13px;font-weight:600;color:#1e293b;font-family:Arial,sans-serif;">${fmtDate(signedAt)}</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- DIVIDER -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:0 40px;"><div style="height:1px;background:#f1f5f9;font-size:0;"> </div></td></tr>
        </table>

        <!-- CTA BUTTONS -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td class="pad" style="padding:28px 40px;">
              <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:16px;font-family:Arial,sans-serif;">Acessar documento</div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td class="btn-cell" width="58%" style="padding-right:10px;vertical-align:top;">
                    <a href="${publicLink}" class="btn-primary"
                      style="display:block;padding:14px 18px;background:linear-gradient(135deg,${O2} 0%,${O1} 100%);color:#ffffff;font-size:13.5px;font-weight:700;text-decoration:none;border-radius:11px;text-align:center;letter-spacing:-0.01em;font-family:Arial,sans-serif;">
                      Ver documento completo
                    </a>
                  </td>
                  <td class="btn-cell" width="42%" style="vertical-align:top;">
                    <a href="${verifyLink}" class="btn-secondary"
                      style="display:block;padding:14px 18px;background:#ffffff;color:${O1};font-size:13px;font-weight:700;text-decoration:none;border-radius:11px;text-align:center;border:1.5px solid #fed7aa;font-family:Arial,sans-serif;">
                      Verificar autenticidade
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- DIVIDER -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:0 40px;"><div style="height:1px;background:#f1f5f9;font-size:0;"> </div></td></tr>
        </table>

        <!-- VERIFICATION CODE -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td class="pad" style="padding:28px 40px;">
              <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:14px;font-family:Arial,sans-serif;">Código de autenticidade</div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                style="background:#fff7ed;border:1px solid #fed7aa;border-radius:13px;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="font-family:'Courier New',Courier,monospace;font-size:21px;font-weight:900;color:#0f172a;letter-spacing:0.18em;margin-bottom:12px;">${verificationCode}</div>
                    <div style="font-size:12px;color:#78716c;line-height:1.65;font-family:Arial,sans-serif;">
                      Acesse <a href="${origin}/#/verificar" style="color:${O1};font-weight:700;text-decoration:none;">${origin}/#/verificar</a> e insira este código para confirmar a autenticidade do documento a qualquer momento.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- LEGAL NOTE -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td class="pad-sm" style="padding:0 40px 36px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:11px;">
                <tr>
                  <td style="padding:14px 18px;">
                    <div style="font-size:11.5px;color:#64748b;line-height:1.7;font-family:Arial,sans-serif;">
                      <strong style="color:#475569;">Validade jurídica —</strong> Esta assinatura é reconhecida pela <strong>MP 2.200-2/2001</strong> e pela <strong>Lei 14.063/2020</strong>, possuindo plena eficácia legal no território nacional.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

      </td>
    </tr>

    <!-- ── FOOTER ── -->
    <tr>
      <td align="center" style="padding:28px 0 0;">
        <div style="font-size:12.5px;color:#64748b;font-family:Arial,sans-serif;margin-bottom:4px;">
          <strong style="color:#334155;">JURIUS</strong> &nbsp;·&nbsp; Assinatura Digital Certificada
        </div>
        <div style="font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;margin-bottom:10px;">
          Este e-mail foi gerado automaticamente — não responda a esta mensagem.
        </div>
        <a href="${origin}" style="font-size:11px;color:#cbd5e1;text-decoration:none;font-family:Arial,sans-serif;">${origin}</a>
      </td>
    </tr>

  </table>
</td></tr>
</table>
</body>
</html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl      = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: 'Supabase env não configurado' })

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const payload   = await req.json().catch(() => null)
    const requestId = String(payload?.request_id ?? '').trim()
    const signerId  = String(payload?.signer_id  ?? '').trim()   // optional: send to specific signer only
    const origin    = String(payload?.origin ?? 'https://jurius.com.br').trim().replace(/\/$/, '')

    if (!requestId) return json({ success: false, error: 'request_id obrigatório' })

    // Fetch signature request with signers
    const { data: req_, error: reqErr } = await supabase
      .from('signature_requests')
      .select('*, signature_signers(*)')
      .eq('id', requestId)
      .single()

    if (reqErr || !req_) return json({ success: false, error: 'Solicitação de assinatura não encontrada' })
    if (!req_.public_token)   return json({ success: false, error: 'Documento sem link público configurado' })

    const publicLink = `${origin}/#/documento/${req_.public_token}`
    const signers    = (req_.signature_signers ?? []) as any[]

    // If specific signer requested, send only to them; otherwise send to all signed
    let signedOnes = signers.filter((s: any) => s.status === 'signed')
    if (signerId) signedOnes = signedOnes.filter((s: any) => s.id === signerId)

    if (signedOnes.length === 0) return json({ success: false, error: 'Nenhum signatário assinou ainda' })

    const sent: string[] = []
    const failed: { email: string; error: string }[] = []

    for (const signer of signedOnes) {
      // Resolve email contact
      const email = (
        signer.auth_email ||
        (signer.auth_provider === 'phone' ? null : signer.email) ||
        signer.email
      )?.trim()?.toLowerCase()

      const isPlaceholder = email?.startsWith('public+') && email?.endsWith('@crm.local')
      if (!email || isPlaceholder || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        failed.push({ email: email ?? '(sem email)', error: 'Email inválido ou placeholder' })
        continue
      }

      const verificationCode = signer.verification_hash ?? ''
      const verifyLink = verificationCode
        ? `${origin}/#/verificar/${verificationCode}`
        : `${origin}/#/verificar`

      const html = buildEmail({
        documentName:     req_.document_name ?? 'Documento',
        clientName:       req_.client_name   ?? signer.name ?? 'Cliente',
        signerName:       signer.name        ?? 'Signatário',
        signedAt:         signer.signed_at   ?? new Date().toISOString(),
        publicLink,
        verifyLink,
        verificationCode,
        origin,
      })

      const textContent = `Olá, ${signer.name}.\n\nSeu documento "${req_.document_name}" foi assinado digitalmente.\n\nAcesse o documento: ${publicLink}\nVerifique a autenticidade: ${verifyLink}\nCódigo de verificação: ${verificationCode}\n\n---\nJURIUS · Assinatura Digital Certificada`

      const client = new SMTPClient({
        connection: {
          hostname: SMTP_HOST,
          port: SMTP_PORT,
          tls: true,
          auth: { username: SMTP_USER, password: SMTP_PASS },
        },
      })

      try {
        await client.send({
          from: `${SMTP_FROM_NAME} <${SMTP_FROM}>`,
          to: email,
          subject: `✅ ${req_.document_name} – documento assinado`,
          content: textContent,
          html,
          replyTo: SMTP_FROM,
          headers: { 'X-Mailer': 'Jurius Signature System' },
        })
        sent.push(email)
      } catch (err: any) {
        console.error('Erro ao enviar para', email, err)
        failed.push({ email, error: err?.message ?? 'Erro desconhecido' })
      } finally {
        await client.close().catch(() => {})
      }
    }

    return json({ success: sent.length > 0, sent, failed })
  } catch (err: any) {
    return json({ success: false, error: err?.message ?? 'Erro interno' })
  }
})
