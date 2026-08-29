/**
 * CÓDIGO DE VERIFICAÇÃO POR TELEFONE — SMS ou WhatsApp.
 *
 * O nome da função é herança do primeiro transporte (smsdev) e ficou: renomear
 * quebraria os links já emitidos que o navegador chama. O que mudou é que o
 * canal agora é PARÂMETRO — `channel: 'sms' | 'whatsapp'` —, porque o código em
 * si é o mesmo objeto nos dois casos: mesma tabela, mesmo hash, mesma validade,
 * mesma verificação. Só o caminho até o telefone é outro.
 *
 * WhatsApp sai pelo `evolution-send`, com service role, exatamente como o
 * `whatsapp-signature-followup` já fazia para os lembretes de assinatura. Quando
 * o cliente já tem conversa aberta, o código chega NELA — fica no histórico do
 * atendimento, com id de mensagem que o dossiê consegue apontar. Sem conversa,
 * o canal vem do padrão de notificações e a conversa nasce no envio.
 *
 * O QUE ESTA FUNÇÃO NÃO FAZ: liberar a assinatura. Ela só entrega e guarda o
 * hash. Quem exige a prova é o `public-sign-document`, e ele consulta a tabela
 * — nunca o que o navegador afirma.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { enforceSecurityRateLimit } from '../_shared/security-rate-limit.ts'
import {
  JANELA_DA_ESCADA_MS,
  esperaEntrePedidos,
  segundosParaOProximoPedido,
  textoDaEspera,
} from '../_shared/otp-cooldown.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function normalizePhone(value: string): string {
  return (value || '').replace(/\D/g, '')
}

/**
 * O WhatsApp precisa do país; o SMS nacional, não. Um número de 10 ou 11
 * dígitos é DDD + linha e ganha o 55 na frente. O 9º dígito quem resolve é a
 * Evolution, no `resolveSendJid` do `evolution-send`.
 */
function toWhatsappPhone(digits: string): string {
  if (digits.length >= 12) return digits
  return `55${digits}`
}

/** As variações com que o mesmo número pode estar gravado numa conversa. */
function phoneCandidates(digits: string): string[] {
  const full = toWhatsappPhone(digits)
  const semPais = full.startsWith('55') ? full.slice(2) : full
  const set = new Set<string>([digits, full, semPais])
  // 9º dígito: com e sem, para achar a conversa antiga gravada do outro jeito.
  if (semPais.length === 11 && semPais[2] === '9') {
    const sem9 = semPais.slice(0, 2) + semPais.slice(3)
    set.add(sem9)
    set.add(`55${sem9}`)
  } else if (semPais.length === 10) {
    const com9 = `${semPais.slice(0, 2)}9${semPais.slice(2)}`
    set.add(com9)
    set.add(`55${com9}`)
  }
  return [...set]
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

/**
 * Entrega pelo WhatsApp.
 *
 * Devolve o id da mensagem no CRM — é ele que o dossiê guarda. Erro aqui é
 * erro de envio de verdade (canal fora, número sem WhatsApp) e precisa subir:
 * gravar o OTP de um código que não chegou deixaria a pessoa esperando.
 */
async function enviarPorWhatsapp(
  supabase: any,
  supabaseUrl: string,
  serviceRoleKey: string,
  phoneDigits: string,
  text: string,
): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string; status: number }> {
  const candidatos = phoneCandidates(phoneDigits)

  // 1) O CANAL — o número do escritório de onde o código sai.
  //
  // Quem escolhe é o escritório, em Configurações → Assinaturas. O código de
  // assinatura não tem por que sair do mesmo número dos avisos internos, e
  // "primeiro canal conectado" é sorteio: o cliente veria o código chegar de um
  // número diferente a cada reconexão. Os dois degraus abaixo são só rede de
  // segurança para quem ainda não escolheu.
  const { data: escolhido } = await supabase
    .from('system_settings').select('value').eq('key', 'signature_whatsapp_channel_id').maybeSingle()
  let channelId: string | null = (typeof escolhido?.value === 'string' ? escolhido.value : null) || null
  if (!channelId) {
    const { data: cfgRow } = await supabase
      .from('system_settings').select('value').eq('key', 'notification_whatsapp_config').maybeSingle()
    channelId = (cfgRow?.value?.default_channel_id ?? null) as string | null
  }
  if (!channelId) {
    const { data: canal } = await supabase
      .from('whatsapp_instances').select('id').eq('status', 'connected').limit(1).maybeSingle()
    channelId = (canal?.id ?? null) as string | null
  }

  // 2) Conversa que já existe NESSE canal: o código chega junto do resto do
  //    atendimento, e fica no histórico. Conversa INTERNA (avisos para a
  //    equipe) não serve — o destinatário aqui é o cliente.
  const { data: conv } = channelId
    ? await supabase
        .from('whatsapp_conversations')
        .select('id, is_blocked')
        .in('contact_phone', candidatos)
        .eq('instance_id', channelId)
        .or('is_internal.is.false,is_internal.is.null')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
    : { data: null }

  let body: Record<string, unknown>

  if (!channelId) {
    return { ok: false, error: 'Nenhum canal de WhatsApp disponível para enviar o código. Escolha um em Configurações → Assinaturas.', status: 503 }
  }

  if (conv?.id && !conv.is_blocked) {
    body = { conversation_id: conv.id, type: 'text', text, sender_user_id: null }
  } else {
    body = { phone: toWhatsappPhone(phoneDigits), channel_id: channelId, type: 'text', text, sender_user_id: null }
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/evolution-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` },
    body: JSON.stringify(body),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out?.error) {
    return { ok: false, error: String(out?.error || `Falha ao enviar pelo WhatsApp (${res.status})`), status: 502 }
  }
  return { ok: true, messageId: (out?.message_id ?? null) as string | null }
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
    const phoneRaw = String(payload?.phone ?? '').trim()
    const phone = normalizePhone(phoneRaw)
    const channel = String(payload?.channel ?? 'sms').trim() === 'whatsapp' ? 'whatsapp' : 'sms'

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

    // O método precisa estar LIGADO nas configurações. Sem esta conferência,
    // desligar o botão na tela não desligaria o envio: bastaria chamar a função
    // direto para receber código por um canal que o escritório desativou.
    const settingKey = channel === 'whatsapp' ? 'public_signature_auth_whatsapp' : 'public_signature_auth_phone'
    const { data: methodRow } = await supabase
      .from('system_settings').select('value').eq('key', settingKey).maybeSingle()
    const methodEnabled = methodRow?.value === true || methodRow?.value === 'true'
    if (!methodEnabled) {
      return new Response(JSON.stringify({ success: false, error: 'Este método de verificação não está disponível.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const smsdevKey = Deno.env.get('SMSDEV')
    if (channel === 'sms' && !smsdevKey) {
      return new Response(JSON.stringify({ success: false, error: 'SMSDEV não configurado' }), {
        status: 500,
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

    const rateLimited = await enforceSecurityRateLimit(
      supabase,
      req,
      'signature-phone-otp-send',
      [
        { bucketType: 'ip', limit: 6, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
        { bucketType: 'token', value: token, limit: 3, windowSeconds: 10 * 60, blockSeconds: 10 * 60 },
        { bucketType: 'phone', value: phone, limit: 3, windowSeconds: 10 * 60, blockSeconds: 10 * 60 },
      ],
      'Muitas solicitações de código em sequência. Aguarde alguns minutos antes de solicitar novamente.',
      corsHeaders,
    )
    if (rateLimited) return rateLimited

    // A espera entre um código e o próximo CRESCE — ver `_shared/otp-cooldown`.
    const { data: recentes } = await supabase
      .from('signature_phone_otps')
      .select('created_at')
      .eq('signer_id', signer.id)
      .gte('created_at', new Date(Date.now() - JANELA_DA_ESCADA_MS).toISOString())
      .order('created_at', { ascending: false })

    const enviadosNaJanela = recentes?.length ?? 0
    const faltam = segundosParaOProximoPedido({
      ultimoEnvioIso: recentes?.[0]?.created_at ?? null,
      enviadosNaJanela,
      agoraMs: Date.now(),
    })
    if (faltam > 0) {
      return new Response(
        JSON.stringify({ success: false, error: textoDaEspera(faltam), retry_after_seconds: faltam }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const code = generateOtp6()
    const expiresAt = new Date(Date.now() + 5 * 60_000) // 5 minutos

    let smsJson: any = null
    let messageId = ''
    let waMessageId: string | null = null

    if (channel === 'whatsapp') {
      const texto =
        `*Assinatura eletrônica*\n\n` +
        `Seu código de verificação é *${code}*.\n` +
        `Ele vale por 5 minutos e serve para uma assinatura apenas.\n\n` +
        `Se não foi você que pediu, ignore esta mensagem e não repasse o código a ninguém.`

      const envio = await enviarPorWhatsapp(supabase, supabaseUrl, serviceRoleKey, phone, texto)
      if (!envio.ok) {
        return new Response(JSON.stringify({ success: false, error: envio.error }), {
          status: envio.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      waMessageId = envio.messageId
    } else {
      const msg = `Jurius: Seu codigo para assinatura e ${code}. Valido por 5 minutos.`

      const url = new URL('https://api.smsdev.com.br/v1/send')
      url.searchParams.set('key', smsdevKey!)
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

      try {
        smsJson = JSON.parse(smsBodyText)
      } catch {
        smsJson = null
      }

      messageId = Array.isArray(smsJson) ? String(smsJson?.[0]?.id ?? '') : ''
    }

    const otpHash = await sha256Hex(`${code}|${signer.id}|${phone}`)

    const { error: insError } = await supabase
      .from('signature_phone_otps')
      .insert({
        signer_id: signer.id,
        phone,
        otp_hash: otpHash,
        channel,
        smsdev_message_id: messageId || null,
        wa_message_id: waMessageId,
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
        channel,
        expires_at: expiresAt.toISOString(),
        // Quanto o PRÓXIMO pedido vai custar de espera: a tela desliga o botão
        // "Reenviar" por esse tempo em vez de deixar a pessoa descobrir no erro.
        resend_in_seconds: esperaEntrePedidos(enviadosNaJanela + 1),
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
