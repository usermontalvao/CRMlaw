// Leitura e escrita de URIs `otpauth://totp/...` (padrão de fato do Key Uri
// Format do Google) e do QR de transferência do Google Authenticator
// (`otpauth-migration://offline?data=...`, protobuf em base64).
//
// Nada aqui toca em rede, disco ou log: recebe texto, devolve estrutura.

import { base32Encode, isValidBase32, normalizeBase32 } from './base32.ts';
import { normalizeAlgorithm, normalizeDigits, normalizePeriod, type TotpAlgorithm } from './totp.ts';

export type ParsedTotpEntry = {
  /** Nome de exibição já resolvido (issuer + conta, sem duplicar o issuer). */
  name: string;
  issuer: string | null;
  accountLabel: string | null;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
};

export class OtpauthParseError extends Error {}

// ── otpauth://totp/... ──────────────────────────────────────────────────────

/**
 * O label é `Issuer:conta` ou só `conta`. Os dois pontos podem vir escapados
 * como `%3A`, e alguns emissores põem um espaço depois deles.
 */
function splitLabel(rawLabel: string): { issuer: string | null; account: string | null } {
  const label = decodeURIComponent(rawLabel.replace(/^\/+/, ''));
  if (!label) return { issuer: null, account: null };

  const separator = label.indexOf(':');
  if (separator < 0) return { issuer: null, account: label.trim() || null };

  return {
    issuer: label.slice(0, separator).trim() || null,
    account: label.slice(separator + 1).trim() || null,
  };
}

export function buildDisplayName(issuer: string | null, account: string | null): string {
  const cleanIssuer = (issuer ?? '').trim();
  const cleanAccount = (account ?? '').trim();
  if (cleanIssuer && cleanAccount) {
    // `Google:pedro@x` não precisa virar "Google (Google)".
    if (cleanAccount.toLowerCase() === cleanIssuer.toLowerCase()) return cleanIssuer;
    return `${cleanIssuer} (${cleanAccount})`;
  }
  return cleanIssuer || cleanAccount || 'Sem nome';
}

export function parseOtpauthUri(uri: string): ParsedTotpEntry {
  const raw = String(uri ?? '').trim();
  if (!/^otpauth:\/\//i.test(raw)) {
    throw new OtpauthParseError('Não é uma URI otpauth://');
  }

  // `new URL` não separa host de path de forma útil aqui porque o tipo vira o
  // host. Fatiar na mão é mais previsível.
  const withoutScheme = raw.slice('otpauth://'.length);
  const queryStart = withoutScheme.indexOf('?');
  const beforeQuery = queryStart >= 0 ? withoutScheme.slice(0, queryStart) : withoutScheme;
  const query = queryStart >= 0 ? withoutScheme.slice(queryStart + 1) : '';

  const slash = beforeQuery.indexOf('/');
  const type = (slash >= 0 ? beforeQuery.slice(0, slash) : beforeQuery).toLowerCase();
  const rawLabel = slash >= 0 ? beforeQuery.slice(slash + 1) : '';

  if (type !== 'totp') {
    throw new OtpauthParseError(
      type === 'hotp'
        ? 'Contas HOTP (por contador) não são suportadas — só TOTP por tempo.'
        : `Tipo otpauth não suportado: ${type || '(vazio)'}`,
    );
  }

  const params = new URLSearchParams(query);
  const label = splitLabel(rawLabel);
  const issuer = (params.get('issuer') || label.issuer || '').trim() || null;

  const secretParam = params.get('secret') || '';
  const secret = normalizeBase32(secretParam);
  if (!isValidBase32(secret)) {
    throw new OtpauthParseError('A URI não traz um segredo base32 válido.');
  }

  return {
    name: buildDisplayName(issuer, label.account),
    issuer,
    accountLabel: label.account,
    secret,
    algorithm: normalizeAlgorithm(params.get('algorithm') ?? undefined),
    digits: normalizeDigits(params.get('digits') ?? undefined),
    period: normalizePeriod(params.get('period') ?? undefined),
  };
}

export function buildOtpauthUri(entry: ParsedTotpEntry): string {
  const account = entry.accountLabel || entry.name;
  const label = entry.issuer
    ? `${encodeURIComponent(entry.issuer)}:${encodeURIComponent(account)}`
    : encodeURIComponent(account);

  const params = new URLSearchParams();
  params.set('secret', normalizeBase32(entry.secret));
  if (entry.issuer) params.set('issuer', entry.issuer);
  params.set('algorithm', entry.algorithm);
  params.set('digits', String(entry.digits));
  params.set('period', String(entry.period));

  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── otpauth-migration://offline?data=... ────────────────────────────────────
//
// O payload é um protobuf. Só três tipos de campo aparecem, então um leitor
// mínimo do formato de fio (varint e length-delimited) resolve — sem arrastar
// uma biblioteca de protobuf para dentro da extensão.

type WireField = { field: number; wire: number; varint?: bigint; bytes?: Uint8Array };

function readVarint(buf: Uint8Array, start: number): { value: bigint; next: number } {
  let value = 0n;
  let shift = 0n;
  let index = start;

  while (index < buf.length) {
    const byte = buf[index];
    index += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: index };
    shift += 7n;
    if (shift > 70n) break;
  }

  throw new OtpauthParseError('Payload de migração corrompido (varint).');
}

function readMessage(buf: Uint8Array): WireField[] {
  const fields: WireField[] = [];
  let index = 0;

  while (index < buf.length) {
    const header = readVarint(buf, index);
    index = header.next;
    const field = Number(header.value >> 3n);
    const wire = Number(header.value & 7n);

    if (wire === 0) {
      const v = readVarint(buf, index);
      index = v.next;
      fields.push({ field, wire, varint: v.value });
    } else if (wire === 2) {
      const len = readVarint(buf, index);
      index = len.next;
      const size = Number(len.value);
      if (size < 0 || index + size > buf.length) {
        throw new OtpauthParseError('Payload de migração corrompido (tamanho).');
      }
      fields.push({ field, wire, bytes: buf.subarray(index, index + size) });
      index += size;
    } else if (wire === 5) {
      index += 4;
    } else if (wire === 1) {
      index += 8;
    } else {
      throw new OtpauthParseError('Payload de migração com campo desconhecido.');
    }
  }

  return fields;
}

const GA_ALGORITHM: Record<number, TotpAlgorithm | null> = {
  0: 'SHA1', // ALGORITHM_UNSPECIFIED — o app trata como SHA1
  1: 'SHA1',
  2: 'SHA256',
  3: 'SHA512',
  4: null, // MD5: existe no enum e não é suportado aqui
};

const GA_DIGITS: Record<number, number> = { 0: 6, 1: 6, 2: 8 };

function base64ToBytes(input: string): Uint8Array {
  const normalized = String(input).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '=='.slice(0, (4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export type MigrationResult = {
  entries: ParsedTotpEntry[];
  /** Contas puladas com o porquê — o usuário precisa saber o que não veio. */
  skipped: { name: string; reason: string }[];
  batchIndex: number;
  batchSize: number;
};

export function parseGoogleAuthenticatorMigration(uri: string): MigrationResult {
  const raw = String(uri ?? '').trim();
  if (!/^otpauth-migration:\/\//i.test(raw)) {
    throw new OtpauthParseError('Não é um QR de transferência do Google Authenticator.');
  }

  const queryStart = raw.indexOf('?');
  if (queryStart < 0) throw new OtpauthParseError('QR de transferência sem dados.');

  const data = new URLSearchParams(raw.slice(queryStart + 1)).get('data');
  if (!data) throw new OtpauthParseError('QR de transferência sem dados.');

  const fields = readMessage(base64ToBytes(data));
  const entries: ParsedTotpEntry[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let batchIndex = 0;
  let batchSize = 1;

  for (const field of fields) {
    if (field.field === 4 && field.varint !== undefined) batchIndex = Number(field.varint);
    if (field.field === 3 && field.varint !== undefined) batchSize = Number(field.varint);
    if (field.field !== 1 || !field.bytes) continue;

    const params = readMessage(field.bytes);
    let secretBytes: Uint8Array | null = null;
    let name = '';
    let issuer = '';
    let algorithmCode = 1;
    let digitsCode = 1;
    let typeCode = 2;

    for (const param of params) {
      switch (param.field) {
        case 1: if (param.bytes) secretBytes = param.bytes; break;
        case 2: if (param.bytes) name = new TextDecoder().decode(param.bytes); break;
        case 3: if (param.bytes) issuer = new TextDecoder().decode(param.bytes); break;
        case 4: if (param.varint !== undefined) algorithmCode = Number(param.varint); break;
        case 5: if (param.varint !== undefined) digitsCode = Number(param.varint); break;
        case 6: if (param.varint !== undefined) typeCode = Number(param.varint); break;
        default: break;
      }
    }

    // O `name` do protobuf também pode vir como `Issuer:conta`.
    const label = splitLabel(encodeURIComponent(name));
    const finalIssuer = (issuer || label.issuer || '').trim() || null;
    const account = label.account;
    const display = buildDisplayName(finalIssuer, account);

    if (typeCode === 1) {
      skipped.push({ name: display, reason: 'Conta HOTP (por contador) não é suportada.' });
      continue;
    }
    const algorithm = GA_ALGORITHM[algorithmCode];
    if (!algorithm) {
      skipped.push({ name: display, reason: 'Algoritmo não suportado (MD5).' });
      continue;
    }
    if (!secretBytes || secretBytes.length === 0) {
      skipped.push({ name: display, reason: 'Conta sem segredo.' });
      continue;
    }

    entries.push({
      name: display,
      issuer: finalIssuer,
      accountLabel: account,
      secret: base32Encode(secretBytes),
      algorithm,
      digits: GA_DIGITS[digitsCode] ?? 6,
      // O protobuf do Google não carrega período: o app é sempre 30s.
      period: 30,
    });
  }

  return { entries, skipped, batchIndex, batchSize };
}

/**
 * Ponto de entrada único da importação: aceita URI simples, QR de migração ou
 * várias linhas coladas de uma vez.
 */
export function parseImportPayload(payload: string): MigrationResult {
  const text = String(payload ?? '').trim();
  if (!text) throw new OtpauthParseError('Nada para importar.');

  if (/^otpauth-migration:\/\//i.test(text)) {
    return parseGoogleAuthenticatorMigration(text);
  }

  const lines = text.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean);
  const entries: ParsedTotpEntry[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const line of lines) {
    try {
      if (/^otpauth-migration:\/\//i.test(line)) {
        const nested = parseGoogleAuthenticatorMigration(line);
        entries.push(...nested.entries);
        skipped.push(...nested.skipped);
      } else {
        entries.push(parseOtpauthUri(line));
      }
    } catch (error) {
      skipped.push({
        name: 'Entrada não reconhecida',
        reason: error instanceof Error ? error.message : 'Formato inválido.',
      });
    }
  }

  if (entries.length === 0 && skipped.length > 0) {
    throw new OtpauthParseError(skipped[0].reason);
  }

  return { entries, skipped, batchIndex: 0, batchSize: 1 };
}
