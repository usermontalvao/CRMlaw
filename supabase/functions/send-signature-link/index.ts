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
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Documento assinado</title>
<style>
body{margin:0;padding:0;background:${S0};font-family:Arial,Helvetica,sans-serif;}
@media only screen and (max-width:600px){.wrap{width:100%!important;border-radius:0!important;}.pad{padding:20px 16px!important;}.cta{display:block!important;text-align:center!important;margin-bottom:10px!important;}}
</style>
</head>
<body style="margin:0;padding:0;background:${S0};">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${S0};">
<tr><td align="center" style="padding:28px 12px 48px;">
<table class="wrap" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:#fff;border:1px solid ${S2};border-radius:16px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,${O2} 0%,${O1} 100%);padding:24px 28px;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
    <td width="44" valign="middle"><table cellpadding="0" cellspacing="0" border="0" style="width:42px;height:42px;background:#fff;border-radius:10px;"><tr><td align="center" valign="middle" style="font-size:19px;font-weight:900;color:${O1};">J</td></tr></table></td>
    <td valign="middle" style="padding-left:12px;"><div style="font-size:19px;font-weight:900;color:#fff;letter-spacing:-0.02em;">JURIUS</div><div style="font-size:10px;font-weight:600;color:#fff7ed;text-transform:uppercase;letter-spacing:0.08em;">Assinatura Digital</div></td>
  </tr></table>
</td></tr>
<tr><td style="background:#f0fdf4;border-bottom:2px solid #bbf7d0;padding:12px 28px;">
  <table cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="24" valign="middle"><div style="width:22px;height:22px;background:#16a34a;border-radius:50%;text-align:center;line-height:22px;color:#fff;font-size:14px;font-weight:700;">&#10003;</div></td>
    <td valign="middle" style="padding-left:10px;"><span style="font-size:13px;font-weight:700;color:#15803d;">Documento assinado &mdash; ${fmtDate(p.signedAt)}</span></td>
  </tr></table>
</td></tr>
<tr><td class="pad" style="padding:28px 28px 0;">
  <div style="font-size:21px;font-weight:800;color:${S9};letter-spacing:-0.01em;">Seu documento est&aacute; pronto</div>
  <div style="font-size:14px;color:${S6};line-height:1.65;padding-top:8px;">Ol&aacute;, <strong style="color:${S7};">${p.signerName}</strong>. Seu documento foi assinado digitalmente e est&aacute; dispon&iacute;vel para acesso e verifica&ccedil;&atilde;o.</div>
</td></tr>
<tr><td class="pad" style="padding:18px 28px;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${S0};border:1px solid ${S2};border-radius:12px;overflow:hidden;">
    <tr><td style="background:${S1};border-bottom:1px solid ${S2};padding:10px 14px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td width="32" valign="middle"><div style="width:30px;height:38px;background:#fff7ed;border:1.5px solid #fed7aa;border-radius:6px;text-align:center;line-height:38px;font-size:16px;">&#128196;</div></td>
        <td valign="middle" style="padding-left:10px;"><div style="font-size:13px;font-weight:800;color:${S9};">${p.documentName}</div><div style="font-size:11px;color:#16a34a;font-weight:600;margin-top:2px;">PDF assinado &middot; certificado${p.hasPdf?' &middot; em anexo':''}</div></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:10px 14px;"><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td width="50%" style="padding-right:8px;"><div style="font-size:10px;font-weight:700;color:${S4};text-transform:uppercase;letter-spacing:0.08em;">Signat&aacute;rio</div><div style="font-size:12px;font-weight:600;color:${S7};margin-top:2px;">${p.signerName}</div></td>
      <td width="50%"><div style="font-size:10px;font-weight:700;color:${S4};text-transform:uppercase;letter-spacing:0.08em;">Assinado em</div><div style="font-size:12px;font-weight:600;color:${S7};margin-top:2px;">${fmtDate(p.signedAt)}</div></td>
    </tr></table></td></tr>
  </table>
</td></tr>
<tr><td class="pad" style="padding:4px 28px 24px;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td align="center" style="padding-bottom:10px;"><a href="${p.publicLink}" class="cta" style="display:inline-block;padding:13px 30px;background:linear-gradient(135deg,${O2},${O1});color:#fff;font-size:14px;font-weight:800;text-decoration:none;border-radius:10px;">Ver documento completo &rarr;</a></td></tr>
    <tr><td align="center"><a href="${p.verifyLink}" style="display:inline-block;padding:9px 22px;background:#fff;color:${O1};font-size:13px;font-weight:700;text-decoration:none;border-radius:8px;border:1.5px solid #fed7aa;">Verificar autenticidade</a></td></tr>
  </table>
</td></tr>
<tr><td class="pad" style="padding:0 28px 24px;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff7ed;border:1px dashed #fdba74;border-radius:10px;">
    <tr><td style="padding:14px 18px;">
      <div style="font-size:10px;font-weight:700;color:${O1};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px;">C&oacute;digo de verifica&ccedil;&atilde;o</div>
      <div style="font-family:'Courier New',Courier,monospace;font-size:20px;font-weight:900;color:${S9};letter-spacing:0.1em;">${p.verificationCode}</div>
      <div style="font-size:11px;color:${S6};margin-top:5px;">Acesse <a href="${p.origin}/#/verificar" style="color:${O1};font-weight:700;">${p.origin}/#/verificar</a> e insira este c&oacute;digo.</div>
    </td></tr>
  </table>
</td></tr>
<tr><td class="pad" style="padding:0 28px 22px;"><table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${S0};border:1px solid ${S2};border-radius:8px;"><tr><td style="padding:10px 14px;"><div style="font-size:11px;color:${S6};line-height:1.6;">&#9989; Validade jur&iacute;dica conforme a <strong>Medida Provis&oacute;ria 2.200-2/2001</strong> e a <strong>Lei 14.063/2020</strong>.</div></td></tr></table></td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid ${S2};background:${S0};"><div style="font-size:11px;color:${S6};text-align:center;"><strong style="color:${S9};">JURIUS</strong> &middot; Assinatura Digital Certificada</div><div style="font-size:10px;color:${S4};text-align:center;margin-top:3px;">E-mail autom&aacute;tico. N&atilde;o responda.</div></td></tr>
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
