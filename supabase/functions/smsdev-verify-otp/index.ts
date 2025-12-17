import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
      return new Response(JSON.stringify({ success: false, error: 'Supabase env não configurado' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const payload = await req.json().catch(() => null)
    const token = String(payload?.token ?? '').trim()
    const code = String(payload?.code ?? '').replace(/\D/g, '').trim()

    if (!token) {
      return new Response(JSON.stringify({ success: false, error: 'Token inválido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (code.length < 4 || code.length > 8) {
      return new Response(JSON.stringify({ success: false, error: 'Código inválido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: signer, error: signerError } = await supabase
      .from('signature_signers')
      .select('id,status')
      .eq('public_token', token)
      .maybeSingle()

    if (signerError || !signer) {
      return new Response(JSON.stringify({ success: false, error: 'Signatário não encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (signer.status !== 'pending') {
      return new Response(JSON.stringify({ success: false, error: 'Este documento já foi assinado ou não está disponível' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: otpRows, error: otpError } = await supabase
      .from('signature_phone_otps')
      .select('id,otp_hash,expires_at,attempts,phone')
      .eq('signer_id', signer.id)
      .is('verified_at', null)
      .order('created_at', { ascending: false })
      .limit(1)

    if (otpError || !otpRows || otpRows.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Nenhum código encontrado. Solicite um novo.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const otp = otpRows[0]

    if (otp.attempts >= 5) {
      return new Response(JSON.stringify({ success: false, error: 'Muitas tentativas. Solicite um novo código.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const exp = new Date(otp.expires_at)
    if (Date.now() > exp.getTime()) {
      return new Response(JSON.stringify({ success: false, error: 'Código expirado. Solicite um novo.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const expected = await sha256Hex(`${code}|${signer.id}|${otp.phone}`)
    if (expected !== otp.otp_hash) {
      await supabase
        .from('signature_phone_otps')
        .update({ attempts: otp.attempts + 1 })
        .eq('id', otp.id)

      return new Response(JSON.stringify({ success: false, error: 'Código incorreto' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: updError } = await supabase
      .from('signature_phone_otps')
      .update({ verified_at: new Date().toISOString() })
      .eq('id', otp.id)

    if (updError) {
      return new Response(JSON.stringify({ success: false, error: 'Não foi possível validar o código' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, phone: otp.phone }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error?.message || 'Erro desconhecido' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
