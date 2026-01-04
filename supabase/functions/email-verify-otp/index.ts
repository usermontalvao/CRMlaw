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

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
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

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const payload = await req.json().catch(() => null)
    const token = String(payload?.token ?? '').trim()
    const code = String(payload?.code ?? '').replace(/\D/g, '').trim()

    if (!token) {
      return jsonResponse({ success: false, error: 'Token inválido' })
    }

    if (code.length < 4 || code.length > 8) {
      return jsonResponse({ success: false, error: 'Código inválido' })
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

    const { data: otpRows, error: otpError } = await supabase
      .from('signature_email_otps')
      .select('id,otp_hash,expires_at,attempts,email')
      .eq('signer_id', signer.id)
      .is('verified_at', null)
      .order('created_at', { ascending: false })
      .limit(1)

    if (otpError || !otpRows || otpRows.length === 0) {
      return jsonResponse({ success: false, error: 'Nenhum código encontrado. Solicite um novo.' })
    }

    const otp = otpRows[0]

    if (otp.attempts >= 5) {
      return jsonResponse({ success: false, error: 'Muitas tentativas. Solicite um novo código.' })
    }

    const exp = new Date(otp.expires_at)
    if (Date.now() > exp.getTime()) {
      return jsonResponse({ success: false, error: 'Código expirado. Solicite um novo.' })
    }

    const expected = await sha256Hex(`${code}|${signer.id}|${otp.email}`)
    if (expected !== otp.otp_hash) {
      await supabase
        .from('signature_email_otps')
        .update({ attempts: otp.attempts + 1 })
        .eq('id', otp.id)

      return jsonResponse({ success: false, error: 'Código incorreto' })
    }

    const { error: updError } = await supabase
      .from('signature_email_otps')
      .update({ verified_at: new Date().toISOString() })
      .eq('id', otp.id)

    if (updError) {
      return jsonResponse({ success: false, error: updError.message || 'Não foi possível validar o código' })
    }

    return jsonResponse({ success: true, email: otp.email })
  } catch (error: any) {
    return jsonResponse({ success: false, error: error?.message || 'Erro desconhecido' })
  }
})
