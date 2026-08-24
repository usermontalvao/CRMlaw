// Base32 (RFC 4648, alfabeto A-Z2-7) — o formato em que todo mundo escreve
// segredo TOTP.
//
// Módulo puro de propósito: sem `import`, para o `node --test` conseguir
// carregá-lo com ts-node sem arrastar a cadeia inteira da Edge Function.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Aceita minúsculas, espaços e o padding `=` que alguns emissores mandam. */
export function normalizeBase32(input: string): string {
  return String(input ?? '')
    .replace(/[\s-]/g, '')
    .replace(/=+$/, '')
    .toUpperCase();
}

export function isValidBase32(input: string): boolean {
  const normalized = normalizeBase32(input);
  if (normalized.length === 0) return false;
  if (!/^[A-Z2-7]+$/.test(normalized)) return false;
  // Comprimentos que sobram bits soltos não formam byte nenhum: 1, 3 e 6
  // caracteres decodificam para 0 bytes.
  const leftover = normalized.length % 8;
  return leftover === 0 || leftover === 2 || leftover === 4 || leftover === 5 || leftover === 7;
}

export function base32Decode(input: string): Uint8Array {
  const normalized = normalizeBase32(input);
  if (!isValidBase32(normalized)) {
    throw new Error('Segredo base32 inválido');
  }

  const out: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of normalized) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error('Segredo base32 inválido');
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 31];
    }
  }

  if (bits > 0) {
    out += ALPHABET[(buffer << (5 - bits)) & 31];
  }

  return out;
}
