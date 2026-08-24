// PIN administrativo — derivação e escada de bloqueio.
//
// O PIN é camada de AUTORIZAÇÃO, não chave de criptografia: ele não entra em
// lugar nenhum do envelope. Se o PIN vazar, nada é decifrado; ele só abre a
// porta de um fluxo que já exige sessão de administrador ativo, step-up
// recente, motivo escrito e auditoria.
//
// DERIVAÇÃO — desvio consciente do "Argon2id de preferência": o runtime das
// Edge Functions só oferece WebCrypto, e não há Argon2 nele sem carregar um
// wasm de terceiros dentro do caminho de autenticação. Usa-se então
//
//     PBKDF2-SHA512(600 000 iterações, salt de 16 bytes por administrador)
//     sobre HMAC-SHA256(pepper de ambiente, PIN)
//
// O pepper é o que realmente derruba o ataque offline: quem levar um dump do
// banco sem a variável de ambiente não consegue testar nem um candidato. O
// campo `kdf` guarda o nome do esquema, então trocar para Argon2id depois é
// subir a versão e reescrever no primeiro uso — não uma migração de emergência.

export const PIN_KDF = 'pbkdf2-sha512-600k+hmac-pepper.v1';
const PBKDF2_ITERATIONS = 600_000;
const DERIVED_BITS = 256;

const BLOCKED_PINS = new Set([
  '000000', '111111', '222222', '333333', '444444', '555555',
  '666666', '777777', '888888', '999999', '123456', '654321',
  '012345', '098765', '111222', '112233', '123123', '121212',
]);

export function validatePinFormat(pin: string): string | null {
  if (!/^\d{6,8}$/.test(String(pin ?? ''))) {
    return 'O PIN precisa ter de 6 a 8 dígitos numéricos.';
  }
  if (BLOCKED_PINS.has(pin)) {
    return 'PIN muito simples. Escolha uma combinação menos previsível.';
  }
  if (/^(\d)\1+$/.test(pin)) {
    return 'PIN muito simples. Escolha uma combinação menos previsível.';
  }
  return null;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const clean = String(hex ?? '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function pepperPin(pepper: Uint8Array, pin: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, toArrayBuffer(new TextEncoder().encode(pin)));
  return new Uint8Array(mac);
}

export async function derivePin(
  pepper: Uint8Array,
  pin: string,
  saltHex?: string,
): Promise<{ hash: string; salt: string; kdf: string }> {
  if (pepper.length < 32) {
    throw new Error('O pepper do PIN precisa ter ao menos 32 bytes');
  }

  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const peppered = await pepperPin(pepper, pin);

  const base = await crypto.subtle.importKey('raw', toArrayBuffer(peppered), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-512', salt: toArrayBuffer(salt), iterations: PBKDF2_ITERATIONS },
    base,
    DERIVED_BITS,
  );

  peppered.fill(0);
  return { hash: toHex(new Uint8Array(bits)), salt: toHex(salt), kdf: PIN_KDF };
}

/** Comparação em tempo constante — o servidor não vazia quanto do PIN bateu. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const left = String(a ?? '');
  const right = String(b ?? '');
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function verifyPin(
  pepper: Uint8Array,
  pin: string,
  stored: { hash: string; salt: string; kdf: string },
): Promise<boolean> {
  if (stored.kdf !== PIN_KDF) {
    throw new Error(`Esquema de derivação desconhecido: ${stored.kdf}`);
  }
  const derived = await derivePin(pepper, pin, stored.salt);
  return timingSafeEqualHex(derived.hash, stored.hash);
}

// ── escada de bloqueio ──────────────────────────────────────────────────────
//
// Função pura: recebe o estado guardado e devolve o próximo. Assim o teste
// consegue percorrer a escada inteira sem banco e sem relógio real.

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_BLOCK_LADDER_SECONDS = [300, 900, 1800, 3600, 10800, 21600, 43200, 86400];

export type PinLockState = {
  failedAttempts: number;
  lockRound: number;
  lockedUntilMs: number | null;
};

export type PinLockDecision = {
  blocked: boolean;
  retryAfterSeconds: number;
  attemptsRemaining: number;
  next: PinLockState;
};

export function pinLockOnCheck(state: PinLockState, nowMs: number): PinLockDecision {
  if (state.lockedUntilMs && state.lockedUntilMs > nowMs) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((state.lockedUntilMs - nowMs) / 1000),
      attemptsRemaining: 0,
      next: state,
    };
  }

  // Bloqueio vencido: zera as tentativas mas MANTÉM a rodada, para a próxima
  // sequência de erros cair num bloqueio mais longo que o anterior.
  const next: PinLockState = state.lockedUntilMs
    ? { failedAttempts: 0, lockRound: state.lockRound, lockedUntilMs: null }
    : state;

  return {
    blocked: false,
    retryAfterSeconds: 0,
    attemptsRemaining: Math.max(0, PIN_MAX_ATTEMPTS - next.failedAttempts),
    next,
  };
}

export function pinLockOnFailure(state: PinLockState, nowMs: number): PinLockDecision {
  const failedAttempts = state.failedAttempts + 1;

  if (failedAttempts < PIN_MAX_ATTEMPTS) {
    return {
      blocked: false,
      retryAfterSeconds: 0,
      attemptsRemaining: PIN_MAX_ATTEMPTS - failedAttempts,
      next: { failedAttempts, lockRound: state.lockRound, lockedUntilMs: null },
    };
  }

  const round = Math.min(state.lockRound, PIN_BLOCK_LADDER_SECONDS.length - 1);
  const seconds = PIN_BLOCK_LADDER_SECONDS[round];

  return {
    blocked: true,
    retryAfterSeconds: seconds,
    attemptsRemaining: 0,
    next: {
      failedAttempts: 0,
      lockRound: state.lockRound + 1,
      lockedUntilMs: nowMs + seconds * 1000,
    },
  };
}

export function pinLockOnSuccess(state: PinLockState): PinLockState {
  return { failedAttempts: 0, lockRound: 0, lockedUntilMs: null };
}
