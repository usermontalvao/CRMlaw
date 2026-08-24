// Sanitização central de log.
//
// A regra do cofre é simples: se um valor pode ser segredo, código, PIN, senha
// ou token, ele não entra em log nenhum — nem no console, nem em
// `metadata_safe`, nem numa mensagem de erro devolvida ao cliente.
//
// Módulo puro (sem `import`) para o teste carregá-lo sozinho.

const SENSITIVE_KEYS = [
  'password',
  'senha',
  'secret',
  'segredo',
  'pin',
  'token',
  'access_token',
  'refresh_token',
  'step_up_token',
  'authorization',
  'apikey',
  'api_key',
  'otp',
  'totp',
  'code',
  'codigo',
  'data',            // o `data=` do QR de migração é o payload inteiro
  'uri',
  'payload',
  'qr',
  'dek',
  'ciphertext',
  'key',
];

export const REDACTED = '[redigido]';

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z_]/g, '');
  return SENSITIVE_KEYS.some((needle) => normalized === needle || normalized.endsWith(needle));
}

/** Some com `otpauth://...` e `otpauth-migration://...` dentro de texto solto. */
export function scrubText(value: string): string {
  return String(value ?? '')
    .replace(/otpauth-migration:\/\/\S+/gi, 'otpauth-migration://[redigido]')
    .replace(/otpauth:\/\/\S+/gi, 'otpauth://[redigido]')
    .replace(/\b[A-Z2-7]{16,}\b/g, REDACTED)      // parece segredo base32
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redigido]');
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1);
    }
    return out;
  }

  return REDACTED;
}

/**
 * O ÚNICO jeito de escrever no console dentro do cofre. Nunca use `console.log`
 * direto: `req.body` inteiro já foi motivo de vazamento em produto sério.
 */
export function safeLog(scope: string, message: string, context?: Record<string, unknown>): void {
  const payload = context ? JSON.stringify(redact(context)) : '';
  console.log(`[${scope}] ${scrubText(message)}${payload ? ` ${payload}` : ''}`);
}

export function safeError(scope: string, message: string, error?: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
  console.error(`[${scope}] ${scrubText(message)} ${scrubText(detail)}`.trim());
}
