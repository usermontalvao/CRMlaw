// TOTP — RFC 6238 sobre HOTP (RFC 4226).
//
// Módulo puro (sem `import`) para o `node --test` exercitar os vetores oficiais
// do RFC. Usa só `crypto.subtle`, que existe tanto no Deno da Edge Function
// quanto no Node 18+.

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export type TotpParams = {
  secret: Uint8Array;
  algorithm?: TotpAlgorithm;
  digits?: number;
  period?: number;
  /** Milissegundos desde a época. Injetável para o teste não depender do relógio. */
  timestampMs?: number;
  /** Deslocamento em janelas — usado só na validação, nunca na geração. */
  window?: number;
};

const SUBTLE_NAME: Record<TotpAlgorithm, string> = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
};

export function normalizeAlgorithm(raw: unknown): TotpAlgorithm {
  const value = String(raw ?? 'SHA1').toUpperCase().replace(/[-_]/g, '');
  if (value === 'SHA256') return 'SHA256';
  if (value === 'SHA512') return 'SHA512';
  if (value === 'SHA1' || value === '') return 'SHA1';
  throw new Error(`Algoritmo TOTP não suportado: ${String(raw)}`);
}

export function normalizeDigits(raw: unknown, fallback = 6): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (value !== 6 && value !== 8) {
    throw new Error('Número de dígitos não suportado (use 6 ou 8)');
  }
  return value;
}

export function normalizePeriod(raw: unknown, fallback = 30): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 10 || value > 300) {
    throw new Error('Período inválido (use de 10 a 300 segundos)');
  }
  return value;
}

/** Contador de 8 bytes big-endian, como manda o RFC 4226. */
function counterToBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let remaining = Math.floor(counter);
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

export function counterFor(timestampMs: number, period: number): number {
  return Math.floor(timestampMs / 1000 / period);
}

export async function hotp(
  secret: Uint8Array,
  counter: number,
  algorithm: TotpAlgorithm = 'SHA1',
  digits = 6,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    // `secret.buffer` pode ser maior que o array quando ele é uma view; copiar
    // evita levar bytes de vizinho para dentro do HMAC.
    secret.slice().buffer as ArrayBuffer,
    { name: 'HMAC', hash: { name: SUBTLE_NAME[algorithm] } },
    false,
    ['sign'],
  );

  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, counterToBytes(counter).buffer as ArrayBuffer),
  );

  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

export type TotpResult = {
  code: string;
  digits: number;
  period: number;
  /** Segundos até o código virar. Nunca 0 — quando vira, já é o período cheio. */
  expiresIn: number;
  /** Início da janela atual, em ms. */
  validFrom: number;
};

export async function generateTotp(params: TotpParams): Promise<TotpResult> {
  const algorithm = normalizeAlgorithm(params.algorithm);
  const digits = normalizeDigits(params.digits);
  const period = normalizePeriod(params.period);
  const timestampMs = params.timestampMs ?? Date.now();

  const counter = counterFor(timestampMs, period) + (params.window ?? 0);
  const code = await hotp(params.secret, counter, algorithm, digits);

  const validFrom = counter * period * 1000;
  const elapsed = Math.floor((timestampMs - validFrom) / 1000);
  const expiresIn = period - elapsed;

  return { code, digits, period, expiresIn, validFrom };
}

/**
 * Confere um código aceitando `tolerance` janelas para trás e para frente.
 * Comparação em tempo constante — o servidor não deve vazar quanto do código
 * bateu antes de errar.
 */
export async function verifyTotp(
  candidate: string,
  params: TotpParams & { tolerance?: number },
): Promise<boolean> {
  const tolerance = params.tolerance ?? 1;
  const trimmed = String(candidate ?? '').replace(/\s/g, '');
  let matched = false;

  for (let offset = -tolerance; offset <= tolerance; offset += 1) {
    const { code } = await generateTotp({ ...params, window: (params.window ?? 0) + offset });
    if (constantTimeEquals(code, trimmed)) matched = true;
  }

  return matched;
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = String(a ?? '');
  const right = String(b ?? '');
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}
