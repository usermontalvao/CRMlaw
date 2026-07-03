// Lockout PROGRESSIVO por IP para o login do escritório (staff), que usa o GoTrue
// diretamente no navegador (supabase.auth.signInWithPassword).
//
// Após 6 falhas o IP é bloqueado por um tempo que escala a cada reincidência:
// 5min, 15min, 30min, 1h, 3h, 4h, 6h, 8h, 12h e máximo 24h. Um login bem-sucedido
// zera o contador/nível. Camada de defesa em profundidade — como o GoTrue é chamado
// no cliente, isto bloqueia o abuso pela interface e dá feedback (contador regressivo).
//
// O cliente deve:
//   1) chamar { action: 'check' } ANTES do signIn — se blocked, não tentar;
//   2) chamar { action: 'fail' } após um login que FALHOU (registra a tentativa);
//   3) chamar { action: 'reset' } após um login BEM-SUCEDIDO.
//
// Sempre responde HTTP 200 com { blocked, retry_after_seconds, attempts_remaining }
// (exceto erro interno) para o supabase.functions.invoke ler o corpo sem tratar como erro.
//
// Autossuficiente (sem imports relativos). Deploy: verify_jwt = false (pré-autenticação).
// Usa SERVICE_ROLE internamente. Depende da migration
// 20260703233000_staff_login_ip_progressive_block.sql.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SCOPE = 'staff-login'
const MAX_ATTEMPTS = 6
// Escada de bloqueio em segundos: 5min, 15min, 30min, 1h, 3h, 4h, 6h, 8h, 12h, 24h.
const BLOCK_LADDER = [300, 900, 1800, 3600, 10800, 14400, 21600, 28800, 43200, 86400]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function pickClientIp(req: Request): string | null {
  const names = ['cf-connecting-ip', 'x-real-ip', 'x-client-ip', 'fly-client-ip', 'x-forwarded-for']
  for (const name of names) {
    const value = req.headers.get(name)
    if (value) {
      const first = value.split(',').map((p) => p.trim()).find(Boolean)
      if (first) return first
    }
  }
  return null
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ blocked: false, error: 'Método não suportado' }, 405)
    }

    const body = await req.json().catch(() => ({})) as { action?: string }
    const action = String(body.action || '').trim()
    if (!action) {
      return jsonResponse({ blocked: false, error: 'Ação obrigatória' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
      // Fail-open: sem credenciais de serviço não travamos o login.
      return jsonResponse({ blocked: false, error: 'Serviço indisponível' }, 200)
    }

    const ip = pickClientIp(req)
    if (!ip) {
      // Sem IP identificável não há como bloquear por IP — fail-open.
      return jsonResponse({ blocked: false, retry_after_seconds: 0 }, 200)
    }
    const ipHash = await sha256Hex(`${SCOPE}:ip:${ip}`)
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    if (action === 'check') {
      const { data, error } = await supabase.rpc('staff_login_ip_status', { p_ip_hash: ipHash })
      if (error) throw error
      const r = (data || {}) as { blocked?: boolean; retry_after_seconds?: number }
      return jsonResponse({ blocked: r.blocked === true, retry_after_seconds: r.retry_after_seconds ?? 0 })
    }

    if (action === 'fail') {
      const { data, error } = await supabase.rpc('staff_login_ip_register_failure', {
        p_ip_hash: ipHash,
        p_max_attempts: MAX_ATTEMPTS,
        p_ladder: BLOCK_LADDER,
      })
      if (error) throw error
      const r = (data || {}) as { blocked?: boolean; retry_after_seconds?: number; attempts_remaining?: number }
      return jsonResponse({
        blocked: r.blocked === true,
        retry_after_seconds: r.retry_after_seconds ?? 0,
        attempts_remaining: r.attempts_remaining ?? 0,
      })
    }

    if (action === 'reset') {
      const { error } = await supabase.rpc('staff_login_ip_reset', { p_ip_hash: ipHash })
      if (error) throw error
      return jsonResponse({ blocked: false, ok: true })
    }

    return jsonResponse({ blocked: false, error: 'Ação inválida' }, 400)
  } catch (err) {
    // Fail-open: nunca bloquear o login por falha interna do guard.
    console.error('[staff-login-guard] erro:', err)
    return jsonResponse({ blocked: false, error: 'Falha ao avaliar limite de tentativas' }, 200)
  }
})
