// Lockout progressivo por conta para o login do escritorio (staff).
//
// A cada 6 falhas, a conta recebe bloqueio temporario progressivo:
// 5min, 15min, 30min, 1h, 3h, 4h, 6h, 8h, 12h e maximo 24h.
// Depois de 3 rodadas completas de bloqueio temporario, a proxima rodada
// suspende a conta ate um administrador liberar.
//
// O cliente deve:
//   1) chamar { action: 'check' } antes do signIn;
//   2) chamar { action: 'fail' } apos um login que falhou;
//   3) chamar { action: 'reset' } apos um login bem-sucedido.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SCOPE = 'staff-login-account'
const ADMIN_UNLOCK_SCOPE = 'staff-login-admin-unlock'
const MAX_ATTEMPTS = 6
const SUSPEND_AFTER_ROUNDS = 3
const BLOCK_LADDER = [300, 900, 1800, 3600, 10800, 14400, 21600, 28800, 43200, 86400]
const ADMIN_UNLOCK_MAX_ATTEMPTS = 5
const ADMIN_UNLOCK_BLOCK_LADDER = [60, 300, 900, 1800, 3600]

type GuardResponse = {
  blocked: boolean
  suspended?: boolean
  retry_after_seconds?: number
  attempts_remaining?: number
  ok?: boolean
  error?: string
  message?: string
  locked_until?: string
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function formatRetryWait(seconds?: number): string {
  const safe = Math.max(1, Math.ceil(seconds ?? 60))
  if (safe >= 3600) {
    const h = Math.floor(safe / 3600)
    const m = Math.ceil((safe % 3600) / 60)
    return m > 0 ? `${h}h${m > 0 ? ` ${m}min` : ''}` : `${h}h`
  }
  if (safe >= 60) {
    const m = Math.ceil(safe / 60)
    return `${m} minuto${m > 1 ? 's' : ''}`
  }
  return `${safe} segundo${safe > 1 ? 's' : ''}`
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

async function suspendAccount(supabase: ReturnType<typeof createClient>, email: string): Promise<void> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id, is_active')
    .ilike('email', email)
    .maybeSingle()

  if (profileError || !profile?.user_id) {
    throw profileError ?? new Error('Conta nao encontrada para suspensao.')
  }

  if (profile.is_active !== false) {
    const { error: updateProfileError } = await supabase
      .from('profiles')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', profile.user_id)
    if (updateProfileError) throw updateProfileError
  }

  const { error: authError } = await supabase.auth.admin.updateUserById(profile.user_id, {
    ban_duration: '876000h',
  })
  if (authError) throw authError
}

async function activateAccount(supabase: ReturnType<typeof createClient>, email: string): Promise<void> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id')
    .ilike('email', email)
    .maybeSingle()

  if (profileError || !profile?.user_id) {
    throw profileError ?? new Error('Conta nao encontrada para reativacao.')
  }

  const { error: updateProfileError } = await supabase
    .from('profiles')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq('user_id', profile.user_id)
  if (updateProfileError) throw updateProfileError

  const { error: authError } = await supabase.auth.admin.updateUserById(profile.user_id, {
    ban_duration: 'none',
  })
  if (authError) throw authError
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ blocked: false, error: 'Metodo nao suportado' }, 405)
    }

    const body = await req.json().catch(() => ({})) as { action?: string; email?: string; pin?: string }
    const action = String(body.action || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const pin = String(body.pin || '').trim()
    if (!action) {
      return jsonResponse({ blocked: false, error: 'Acao obrigatoria' }, 400)
    }
    if (!email) {
      return jsonResponse({ blocked: false, error: 'Email obrigatorio' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ blocked: false, error: 'Servico indisponivel' }, 200)
    }

    const accountHash = await sha256Hex(`${SCOPE}:account:${email}`)
    const adminUnlockHash = await sha256Hex(`${ADMIN_UNLOCK_SCOPE}:account:${email}`)
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

    if (action === 'check') {
      const { data, error } = await supabase.rpc('staff_login_account_status', { p_account_hash: accountHash })
      if (error) throw error
      const r = (data || {}) as GuardResponse
      return jsonResponse({
        blocked: r.blocked === true,
        suspended: r.suspended === true,
        retry_after_seconds: r.retry_after_seconds ?? 0,
      })
    }

    if (action === 'fail') {
      const { data, error } = await supabase.rpc('staff_login_account_register_failure', {
        p_account_hash: accountHash,
        p_max_attempts: MAX_ATTEMPTS,
        p_ladder: BLOCK_LADDER,
        p_suspend_after_rounds: SUSPEND_AFTER_ROUNDS,
      })
      if (error) throw error
      const r = (data || {}) as GuardResponse
      if (r.suspended === true) {
        await suspendAccount(supabase, email)
      }
      return jsonResponse({
        blocked: r.blocked === true,
        suspended: r.suspended === true,
        retry_after_seconds: r.retry_after_seconds ?? 0,
        attempts_remaining: r.attempts_remaining ?? 0,
      })
    }

    if (action === 'reset') {
      const { error } = await supabase.rpc('staff_login_account_reset', { p_account_hash: accountHash })
      if (error) throw error
      return jsonResponse({ blocked: false, suspended: false, ok: true })
    }

    if (action === 'unlock_with_pin') {
      const { data: unlockStatus, error: unlockStatusError } = await supabase.rpc('staff_login_account_status', {
        p_account_hash: adminUnlockHash,
      })
      if (unlockStatusError) throw unlockStatusError

      const unlockGuard = (unlockStatus || {}) as GuardResponse
      if (unlockGuard.blocked === true && (unlockGuard.retry_after_seconds ?? 0) > 0) {
        return jsonResponse({
          ok: false,
          blocked: false,
          suspended: true,
          error: 'unlock_rate_limited',
          retry_after_seconds: unlockGuard.retry_after_seconds ?? 0,
          message: `Muitas tentativas de desbloqueio por PIN. Aguarde ${formatRetryWait(unlockGuard.retry_after_seconds)} para tentar novamente.`,
        })
      }

      const { data, error } = await supabase.rpc('staff_login_admin_unlock_with_pin', {
        p_email: email,
        p_pin: pin,
      })
      if (error) throw error
      const r = (data || {}) as GuardResponse & { user_id?: string }
      if (r.ok === true) {
        const { error: unlockResetError } = await supabase.rpc('staff_login_account_reset', { p_account_hash: adminUnlockHash })
        if (unlockResetError) throw unlockResetError
        await activateAccount(supabase, email)
        const { error: resetError } = await supabase.rpc('staff_login_account_reset', { p_account_hash: accountHash })
        if (resetError) throw resetError
        return jsonResponse({ ok: true, blocked: false, suspended: false })
      }

      if (r.error === 'wrong_pin') {
        const { data: unlockFail, error: unlockFailError } = await supabase.rpc('staff_login_account_register_failure', {
          p_account_hash: adminUnlockHash,
          p_max_attempts: ADMIN_UNLOCK_MAX_ATTEMPTS,
          p_ladder: ADMIN_UNLOCK_BLOCK_LADDER,
          p_suspend_after_rounds: 999,
        })
        if (unlockFailError) throw unlockFailError

        const unlockFailResult = (unlockFail || {}) as GuardResponse
        if (unlockFailResult.blocked === true && (unlockFailResult.retry_after_seconds ?? 0) > 0) {
          return jsonResponse({
            ok: false,
            blocked: false,
            suspended: true,
            error: 'unlock_rate_limited',
            retry_after_seconds: unlockFailResult.retry_after_seconds ?? 0,
            message: `Muitas tentativas de desbloqueio por PIN. Aguarde ${formatRetryWait(unlockFailResult.retry_after_seconds)} para tentar novamente.`,
          })
        }
      }

      return jsonResponse({
        ok: false,
        blocked: false,
        suspended: true,
        error: r.error ?? 'unlock_failed',
        message: r.message ?? 'Nao foi possivel validar o PIN.',
        locked_until: r.locked_until ?? null,
        retry_after_seconds: r.retry_after_seconds ?? null,
        attempts_remaining: r.attempts_remaining ?? null,
      })
    }

    return jsonResponse({ blocked: false, error: 'Acao invalida' }, 400)
  } catch (err) {
    console.error('[staff-login-guard] erro:', err)
    return jsonResponse({ blocked: false, error: 'Falha ao avaliar limite de tentativas' }, 200)
  }
})
