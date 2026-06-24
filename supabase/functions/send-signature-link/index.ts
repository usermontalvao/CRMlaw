import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FROM_EMAIL  = 'noreply@jurius.com.br'
const FROM_NAME   = 'Jurius - Assinatura Digital'

const O1='#ea580c';const O2='#f97316';const S9='#0f172a';
const S7='#334155';const S6='#475569';const S4='#94a3b8';
const S2='#e2e8f0';const S1='#f1f5f9';const S0='#f8fafc';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Manaus' })
}

function buildHtml(p: { documentName:string; signerName:string; signedAt:string; publicLink:string; verifyLink:string; verificationCode:string; origin:string; hasPdf:boolean }): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/>
<title>Documento assinado</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Spectral:wght@400;700&family=Space+Grotesk:wght@600&display=swap');
  @media only screen and (max-width:600px){
    .container{width:100%!important;border-radius:0!important;}
    .card-pad{padding:24px 20px!important;}
    .two-col td{display:block!important;width:100%!important;padding-right:0!important;padding-left:0!important;}
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
          <img src="https://jurius.com.br/logo.png" width="52" height="52" alt="Jurius" style="display:block;border:0;border-radius:14px;">
        </td>
        <td width="28" style="padding:0 14px;"><div style="width:1px;height:36px;background:#E7E9EE;"></div></td>
        <td valign="middle">
          <div style="font-family:'Spectral',Georgia,'Times New Roman',serif;font-size:26px;line-height:1;letter-spacing:-.012em;"><span style="color:#211C18;font-weight:700;">jurius</span><span style="color:#E45C12;font-weight:700;">.</span><span style="font-weight:400;color:#A0958C;">com.br</span></div>
          <div style="margin-top:6px;font-family:'Space Grotesk',Arial,Helvetica,sans-serif;font-size:8px;font-weight:600;letter-spacing:0.28em;color:#A0958C;text-transform:uppercase;">GESTÃO JURÍDICA INTELIGENTE</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Status banner -->
  <tr><td style="background:#F0FDF4;border-bottom:2px solid #BBF7D0;padding:12px 36px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="24" valign="middle">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="22" height="22" style="background:#16a34a;border-radius:50%;text-align:center;">
          <tr><td align="center" valign="middle" height="22"><span style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#fff;line-height:22px;">&#10003;</span></td></tr>
        </table>
      </td>
      <td valign="middle" style="padding-left:10px;"><span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#15803d;">Documento assinado &mdash; ${fmtDate(p.signedAt)}</span></td>
    </tr></table>
  </td></tr>

  <tr><td class="card-pad" style="padding:32px 36px 12px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.16em;color:#EC5A1E;text-transform:uppercase;margin-bottom:12px;">Assinatura Digital</div>
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#16213A;letter-spacing:-0.015em;">Seu documento está pronto</div>
    <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#54607A;">Olá, <strong style="color:#16213A;">${p.signerName}</strong>. Seu documento foi assinado digitalmente e está disponível para acesso e verificação de autenticidade.</p>
  </td></tr>

  <!-- Document card -->
  <tr><td style="padding:20px 36px 4px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFF6EE;border:1px solid #FAD9C0;border-radius:16px;overflow:hidden;">
      <tr><td style="height:4px;background:linear-gradient(90deg,#F5762B,#E14E14);font-size:0;">&nbsp;</td></tr>
      <tr><td style="padding:22px 24px 24px;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#16213A;font-weight:bold;margin-bottom:20px;">&#128196; ${p.documentName}${p.hasPdf ? ' <span style="font-family:Arial,sans-serif;font-size:12px;color:#16a34a;font-weight:600;">&middot; em anexo</span>' : ''}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="two-col">
          <tr>
            <td width="50%" valign="top" style="padding-right:12px;padding-bottom:16px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.12em;color:#B0834F;text-transform:uppercase;margin-bottom:7px;">Signatário</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:500;color:#303A52;">${p.signerName}</div>
            </td>
            <td width="50%" valign="top" style="padding-left:12px;padding-bottom:16px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.12em;color:#B0834F;text-transform:uppercase;margin-bottom:7px;">Assinado em</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:500;color:#303A52;">${fmtDate(p.signedAt)}</div>
            </td>
          </tr>
          <tr><td colspan="2" style="height:1px;background:#F4DCC7;padding:0;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td colspan="2" style="padding-top:16px;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.12em;color:#B0834F;text-transform:uppercase;margin-bottom:7px;">Código de verificação</div>
            <div style="font-family:'Courier New',Courier,monospace;font-size:18px;font-weight:900;color:#16213A;letter-spacing:0.1em;">${p.verificationCode}</div>
            <div style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#54607A;">Acesse <a href="${p.origin}/#/verificar" style="color:#EC5A1E;font-weight:600;">${p.origin}/#/verificar</a> para verificar a autenticidade.</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <!-- Legal note -->
  <tr><td style="padding:12px 36px 4px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F8F9FB;border:1px solid #E8EAF0;border-radius:12px;">
      <tr><td style="padding:12px 16px;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#54607A;line-height:1.6;">&#9989; Validade jurídica conforme a <strong>MP 2.200-2/2001</strong> e a <strong>Lei 14.063/2020</strong>.</div></td></tr>
    </table>
  </td></tr>

  <!-- CTAs -->
  <tr><td style="padding:24px 36px 32px;text-align:center;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td align="center" style="padding-bottom:10px;">
        <a href="${p.publicLink}" style="display:inline-block;text-decoration:none;background:linear-gradient(150deg,#F5762B 0%,#E14E14 100%);color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:14px 36px;border-radius:12px;">Ver documento completo &rarr;</a>
      </td></tr>
      <tr><td align="center">
        <a href="${p.verifyLink}" style="display:inline-block;text-decoration:none;background:#ffffff;color:#EC5A1E;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;padding:10px 24px;border-radius:10px;border:1.5px solid #FAD9C0;">Verificar autenticidade</a>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:18px 24px 16px;border-top:1px solid #F0F1F4;text-align:center;background:#F8F9FB;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5C667C;font-weight:600;">Jurius &bull; Gestão Jurídica Inteligente</div>
    <div style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.6;color:#9AA2B2;">Este e-mail foi enviado automaticamente. Não responda esta mensagem.<br/>© 2026 Jurius. Todos os direitos reservados.</div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: 'Supabase env nao configurado' })
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Resend key from env or system_settings (same as weekly-digest)
    let resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
    if (!resendKey) {
      const { data: s } = await supabase.from('system_settings').select('value').eq('key','notification_config').single()
      resendKey = s?.value?.weekly_digest_resend_key ?? ''
    }
    if (!resendKey) return json({ success: false, error: 'Resend API key nao configurada' })

    const payload   = await req.json().catch(() => null)
    const requestId = String(payload?.request_id ?? '').trim()
    const signerId  = String(payload?.signer_id  ?? '').trim()
    const origin    = String(payload?.origin ?? 'https://jurius.com.br').trim().replace(/\/$/, '')

    if (!requestId) return json({ success: false, error: 'request_id obrigatorio' })

    const { data: req_, error: reqErr } = await supabase.from('signature_requests').select('*, signature_signers(*)').eq('id', requestId).single()
    if (reqErr || !req_) return json({ success: false, error: 'Solicitacao nao encontrada' })
    if (!req_.public_token) return json({ success: false, error: 'Sem link publico' })

    const publicLink = `${origin}/#/documento/${req_.public_token}`
    const signers    = (req_.signature_signers ?? []) as any[]
    let signedOnes   = signers.filter((s: any) => s.status === 'signed')
    if (signerId) signedOnes = signedOnes.filter((s: any) => s.id === signerId)
    if (!signedOnes.length) return json({ success: false, error: 'Nenhum signatario assinou' })

    const sent: string[] = []
    const failed: { email: string; error: string }[] = []

    for (const signer of signedOnes) {
      const email = (signer.auth_email || (signer.auth_provider==='phone'?null:signer.email) || signer.email)?.trim()?.toLowerCase()
      const isPlaceholder = email?.startsWith('public+') && email?.endsWith('@crm.local')
      if (!email || isPlaceholder || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { failed.push({ email: email??'(sem email)', error: 'Email invalido' }); continue }

      const verificationCode = signer.verification_hash ?? ''
      const verifyLink = verificationCode ? `${origin}/#/verificar/${verificationCode}` : `${origin}/#/verificar`

      // Fetch signed PDF as base64 attachment
      let pdfBase64: string|null = null
      let pdfFilename = 'documento_assinado.pdf'
      if (signer.signed_document_path) {
        try {
          for (const bucket of ['assinados','generated-documents','document-templates']) {
            try {
              const { data: urlData } = await supabase.storage.from(bucket).createSignedUrl(signer.signed_document_path, 300)
              if (!urlData?.signedUrl) continue
              const pdfRes = await fetch(urlData.signedUrl)
              if (!pdfRes.ok) continue
              const buf = await pdfRes.arrayBuffer()
              const bytes = new Uint8Array(buf)
              let b64 = ''
              for (let i = 0; i < bytes.length; i += 8192) b64 += btoa(String.fromCharCode(...bytes.subarray(i, Math.min(i+8192,bytes.length))))
              pdfBase64  = b64
              pdfFilename = (req_.document_name??'documento').replace(/[^\w\s\-]/g,'').trim().replace(/\s+/g,'_').slice(0,60)+'_assinado.pdf'
              break
            } catch {}
          }
        } catch (e) { console.error('PDF fetch error:', e) }
      }

      const html = buildHtml({ documentName: req_.document_name??'Documento', signerName: signer.name??'Signatario', signedAt: signer.signed_at??new Date().toISOString(), publicLink, verifyLink, verificationCode, origin, hasPdf: !!pdfBase64 })

      const emailBody: any = {
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [email],
        subject: `Documento assinado: ${req_.document_name}`,
        html,
        text: `Ola, ${signer.name}.\n\nSeu documento "${req_.document_name}" foi assinado.\n\nAcesse: ${publicLink}\nVerifique: ${verifyLink}\nCodigo: ${verificationCode}\n\nJURIUS - Assinatura Digital`,
      }
      if (pdfBase64) emailBody.attachments = [{ filename: pdfFilename, content: pdfBase64 }]

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(emailBody),
        })
        const rj = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(rj?.message ?? `Resend error ${res.status}`)
        sent.push(email)
        console.log('Resend OK ->', email, pdfBase64?'+PDF':'sem PDF')
      } catch (err: any) {
        console.error('Resend FAIL ->', email, err)
        failed.push({ email, error: err?.message??'Erro' })
      }
    }

    return json({ success: sent.length > 0, sent, failed })
  } catch (err: any) {
    return json({ success: false, error: err?.message??'Erro interno' })
  }
})
