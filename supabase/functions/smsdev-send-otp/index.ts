import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function normalizePhone(value: string): string {
  return (value || '').replace(/\D/g, '')
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
    const smsdevKey = Deno.env.get('SMSDEV')
    if (!smsdevKey) {
      return new Response(JSON.stringify({ success: false, error: 'SMSDEV não configurado' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

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
    const phoneRaw = String(payload?.phone ?? '').trim()
    const phone = normalizePhone(phoneRaw)

    if (!token) {
      return new Response(JSON.stringify({ success: false, error: 'Token inválido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (phone.length < 10 || phone.length > 13) {
      return new Response(JSON.stringify({ success: false, error: 'Telefone inválido' }), {
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

    const { data: lastOtp } = await supabase
      .from('signature_phone_otps')
      .select('created_at')
      .eq('signer_id', signer.id)
      .order('created_at', { ascending: false })
      .limit(1)

    if (lastOtp && lastOtp.length > 0) {
      const lastAt = new Date(lastOtp[0].created_at)
      const diffMs = Date.now() - lastAt.getTime()
      if (diffMs < 60_000) {
        return new Response(JSON.stringify({ success: false, error: 'Aguarde um minuto antes de solicitar outro código.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const code = generateOtp6()
    const expiresAt = new Date(Date.now() + 10 * 60_000)

    const msg = `Jurius: Seu codigo para assinatura e ${code}. Valido por 10 minutos.`

    const url = new URL('https://api.smsdev.com.br/v1/send')
    url.searchParams.set('key', smsdevKey)
    url.searchParams.set('type', '9')
    url.searchParams.set('number', phone)
    url.searchParams.set('msg', msg)

    const smsRes = await fetch(url.toString(), { method: 'GET' })
    const smsBodyText = await smsRes.text()
    if (!smsRes.ok) {
      return new Response(JSON.stringify({ success: false, error: `Erro ao enviar SMS (${smsRes.status})`, details: smsBodyText }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let smsJson: any = null
    try {
      smsJson = JSON.parse(smsBodyText)
    } catch {
      smsJson = null
    }

    const messageId = Array.isArray(smsJson) ? String(smsJson?.[0]?.id ?? '') : ''

    const otpHash = await sha256Hex(`${code}|${signer.id}|${phone}`)

    const { error: insError } = await supabase
      .from('signature_phone_otps')
      .insert({
        signer_id: signer.id,
        phone,
        otp_hash: otpHash,
        smsdev_message_id: messageId || null,
        expires_at: expiresAt.toISOString(),
      })

    if (insError) {
      return new Response(JSON.stringify({ success: false, error: 'Não foi possível registrar o OTP' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(
      JSON.stringify({
        success: true,
        expires_at: expiresAt.toISOString(),
        smsdev: smsJson,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error?.message || 'Erro desconhecido' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
