import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export type SecurityRateLimitBucketType = 'ip' | 'identity' | 'token' | 'email' | 'phone' | 'cpf'

export type SecurityRateLimitBucket = {
  bucketType: SecurityRateLimitBucketType
  value?: string | null
}

export type SecurityRateLimitRule = SecurityRateLimitBucket & {
  limit: number
  windowSeconds: number
  blockSeconds?: number
}

export type SecurityRateLimitOutcome = {
  blocked: boolean
  retryAfterSeconds: number
}

type SecurityRateLimitResult = {
  allowed?: boolean
  retry_after_seconds?: number
}

const rateLimitHeaders = {
  'Content-Type': 'application/json',
}

function getFirstHeader(req: Request, names: string[]): string | null {
  for (const name of names) {
    const value = req.headers.get(name)
    if (value) return value
  }
  return null
}

function pickClientIp(req: Request): string | null {
  const forwarded = getFirstHeader(req, [
    'cf-connecting-ip',
    'x-real-ip',
    'x-client-ip',
    'fly-client-ip',
    'x-forwarded-for',
  ])

  if (!forwarded) return null
  return forwarded
    .split(',')
    .map((part) => part.trim())
    .find(Boolean) ?? null
}

function normalizeBucketValue(bucketType: SecurityRateLimitBucketType, value: string): string {
  const raw = String(value || '').trim()
  switch (bucketType) {
    case 'email':
    case 'identity':
      return raw.toLowerCase()
    case 'phone':
    case 'cpf':
      return raw.replace(/\D/g, '')
    default:
      return raw
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// Resolve o par (bucket_type, bucket_hash) usado como chave estável no rate-limit.
// O hash NÃO inclui a janela — assim `peek`/`reset` casam com as linhas escritas por `hit`.
async function resolveBucket(
  req: Request,
  scope: string,
  bucket: SecurityRateLimitBucket,
): Promise<{ bucketType: SecurityRateLimitBucketType; bucketHash: string } | null> {
  const rawValue = bucket.bucketType === 'ip' ? pickClientIp(req) : bucket.value
  if (!rawValue) return null

  const normalizedValue = normalizeBucketValue(bucket.bucketType, rawValue)
  if (!normalizedValue) return null

  const bucketHash = await sha256Hex(`${scope}:${bucket.bucketType}:${normalizedValue}`)
  return { bucketType: bucket.bucketType, bucketHash }
}

export function buildRateLimitResponse(
  message: string,
  retryAfterSeconds = 60,
  status = 429,
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: message,
      retry_after_seconds: retryAfterSeconds,
    }),
    {
      status,
      headers: {
        ...rateLimitHeaders,
        'Retry-After': String(Math.max(1, retryAfterSeconds)),
      },
    },
  )
}

// Registra uma tentativa (incrementa o contador) e devolve se a chave está bloqueada.
export async function hitSecurityRateLimit(
  supabase: SupabaseClient,
  req: Request,
  scope: string,
  rules: SecurityRateLimitRule[],
): Promise<SecurityRateLimitOutcome> {
  for (const rule of rules) {
    const bucket = await resolveBucket(req, scope, rule)
    if (!bucket) continue

    const { data, error } = await supabase.rpc('security_rate_limit_hit', {
      p_scope: scope,
      p_bucket_type: bucket.bucketType,
      p_bucket_hash: bucket.bucketHash,
      p_window_seconds: rule.windowSeconds,
      p_limit: rule.limit,
      p_block_seconds: rule.blockSeconds ?? null,
    })

    if (error) {
      throw new Error(`Rate limit indisponível (${scope}/${rule.bucketType}): ${error.message}`)
    }

    const result = (data || {}) as SecurityRateLimitResult
    if (result.allowed === false) {
      return { blocked: true, retryAfterSeconds: result.retry_after_seconds ?? rule.windowSeconds }
    }
  }

  return { blocked: false, retryAfterSeconds: 0 }
}

export async function enforceSecurityRateLimit(
  supabase: SupabaseClient,
  req: Request,
  scope: string,
  rules: SecurityRateLimitRule[],
  message = 'Muitas tentativas em sequência. Aguarde antes de tentar novamente.',
): Promise<Response | null> {
  const outcome = await hitSecurityRateLimit(supabase, req, scope, rules)
  if (outcome.blocked) {
    return buildRateLimitResponse(message, outcome.retryAfterSeconds)
  }
  return null
}

// Verifica se alguma das chaves está bloqueada AGORA, sem incrementar o contador.
// Útil para bloquear a tentativa antes de encaminhá-la a um provedor externo (ex.: GoTrue).
export async function peekSecurityRateLimit(
  supabase: SupabaseClient,
  req: Request,
  scope: string,
  buckets: SecurityRateLimitBucket[],
): Promise<SecurityRateLimitOutcome> {
  const nowIso = new Date().toISOString()

  for (const bucket of buckets) {
    const resolved = await resolveBucket(req, scope, bucket)
    if (!resolved) continue

    const { data, error } = await supabase
      .from('security_rate_limits')
      .select('blocked_until')
      .eq('scope', scope)
      .eq('bucket_type', resolved.bucketType)
      .eq('bucket_hash', resolved.bucketHash)
      .gt('blocked_until', nowIso)
      .order('blocked_until', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      throw new Error(`Rate limit indisponível (${scope}/${bucket.bucketType}): ${error.message}`)
    }

    if (data?.blocked_until) {
      const retryAfter = Math.max(
        1,
        Math.ceil((new Date(data.blocked_until).getTime() - Date.now()) / 1000),
      )
      return { blocked: true, retryAfterSeconds: retryAfter }
    }
  }

  return { blocked: false, retryAfterSeconds: 0 }
}

// Zera os contadores das chaves informadas (ex.: após um login bem-sucedido).
export async function resetSecurityRateLimit(
  supabase: SupabaseClient,
  req: Request,
  scope: string,
  buckets: SecurityRateLimitBucket[],
): Promise<void> {
  for (const bucket of buckets) {
    const resolved = await resolveBucket(req, scope, bucket)
    if (!resolved) continue

    await supabase
      .from('security_rate_limits')
      .delete()
      .eq('scope', scope)
      .eq('bucket_type', resolved.bucketType)
      .eq('bucket_hash', resolved.bucketHash)
  }
}
