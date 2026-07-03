// Lockout anti-força-bruta para o login do escritório (staff), que usa o GoTrue
// diretamente no navegador (supabase.auth.signInWithPassword).
//
// Camada de defesa em profundidade: como o GoTrue é chamado no cliente, esta função
// NÃO substitui os limites nativos do Auth — ela bloqueia o abuso feito pela interface
// e dá feedback ao usuário. O cliente deve:
//   1) chamar { action: 'check' } ANTES do signIn — se blocked, não tentar;
//   2) chamar { action: 'fail' } após um login que FALHOU (registra a tentativa);
//   3) chamar { action: 'reset' } após um login BEM-SUCEDIDO (zera o contador do e-mail).
//
// Sempre responde HTTP 200 com { blocked, retry_after_seconds } (exceto erro interno),
// para o supabase.functions.invoke conseguir ler o corpo sem tratar como erro.
//
// Deploy: verify_jwt = false (é pré-autenticação). Usa SERVICE_ROLE internamente.
// Depende da migration 20260702230000_global_security_rate_limits.sql.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  hitSecurityRateLimit,
  peekSecurityRateLimit,
  resetSecurityRateLimit,
  type SecurityRateLimitBucket,
  type SecurityRateLimitRule,
} from '../_shared/security-rate-limit.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SCOPE = 'staff-login'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ blocked: false, error: 'Método não suportado' }, 405)
    }

    const body = await req.json().catch(() => ({})) as { action?: string; email?: string }
    const action = String(body.action || '').trim()
    const email = String(body.email || '').trim().toLowerCase()

    if (!action) {
      return jsonResponse({ blocked: false, error: 'Ação obrigatória' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
      // Fail-open: sem credenciais de serviço não conseguimos avaliar; não travar o login.
      return jsonResponse({ blocked: false, error: 'Serviço indisponível' }, 200)
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Buckets: e-mail (por conta) + IP (por origem).
    const emailBucket: SecurityRateLimitBucket = { bucketType: 'email', value: email || null }
    const ipBucket: SecurityRateLimitBucket = { bucketType: 'ip' }
    const peekBuckets: SecurityRateLimitBucket[] = [emailBucket, ipBucket]

    // Regras aplicadas apenas em falhas de login.
    const failRules: SecurityRateLimitRule[] = [
      { bucketType: 'email', value: email || null, limit: 8, windowSeconds: 15 * 60, blockSeconds: 30 * 60 },
      { bucketType: 'ip', limit: 25, windowSeconds: 15 * 60, blockSeconds: 30 * 60 },
    ]

    if (action === 'check') {
      const outcome = await peekSecurityRateLimit(supabase, req, SCOPE, peekBuckets)
      return jsonResponse({ blocked: outcome.blocked, retry_after_seconds: outcome.retryAfterSeconds })
    }

    if (action === 'fail') {
      const outcome = await hitSecurityRateLimit(supabase, req, SCOPE, failRules)
      return jsonResponse({ blocked: outcome.blocked, retry_after_seconds: outcome.retryAfterSeconds })
    }

    if (action === 'reset') {
      // Zera só o contador do e-mail (login legítimo). O contador de IP é preservado,
      // pois pode estar protegendo contra tentativas contra outras contas na mesma origem.
      if (email) {
        await resetSecurityRateLimit(supabase, req, SCOPE, [emailBucket])
      }
      return jsonResponse({ blocked: false, ok: true })
    }

    return jsonResponse({ blocked: false, error: 'Ação inválida' }, 400)
  } catch (err) {
    // Fail-open: nunca bloquear o login por falha interna do guard.
    console.error('[staff-login-guard] erro:', err)
    return jsonResponse({ blocked: false, error: 'Falha ao avaliar limite de tentativas' }, 200)
  }
})
