// Envelope encryption do cofre.
//
//   segredo TOTP ──AES-256-GCM(DEK)──▶ secret_ciphertext
//   DEK aleatório ──AES-256-GCM(KEK)──▶ wrapped_dek
//   KEK = HKDF-SHA256(chave mestra, salt = id da credencial)
//
// A chave mestra mora só em variável de ambiente da Edge Function. O banco
// guarda ciphertext, IV, DEK embrulhado e a VERSÃO da chave — é isso que torna
// a rotação possível sem reescrever a criptografia.
//
// Os dois AAD (dados autenticados, não cifrados) amarram cada ciphertext à
// linha em que ele mora: copiar o `secret_ciphertext` de uma credencial para
// outra faz a decifragem falhar, em vez de entregar o segredo da vizinha.

const HKDF_INFO_DEK = 'jurius-totp/dek-wrap/v1';
const AES_GCM_IV_BYTES = 12;
const DEK_BYTES = 32;

export const CRYPTO_VERSION = 1;

export type SealedSecret = {
  credentialId: string;
  secretCiphertext: Uint8Array;
  secretIv: Uint8Array;
  wrappedDek: Uint8Array;
  dekIv: Uint8Array;
  keyVersion: number;
  cryptoVersion: number;
};

export class VaultCryptoError extends Error {}

// ── chaveiro ────────────────────────────────────────────────────────────────

export class MasterKeyring {
  private readonly keys = new Map<number, Uint8Array>();
  readonly activeVersion: number;

  constructor(keys: Record<number | string, Uint8Array>, activeVersion?: number) {
    for (const [version, bytes] of Object.entries(keys)) {
      const parsed = Number(version);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new VaultCryptoError(`Versão de chave inválida: ${version}`);
      }
      if (bytes.length !== 32) {
        throw new VaultCryptoError(`A chave mestra v${parsed} precisa ter 32 bytes`);
      }
      this.keys.set(parsed, bytes);
    }

    if (this.keys.size === 0) {
      throw new VaultCryptoError('Nenhuma chave mestra configurada');
    }

    const highest = Math.max(...this.keys.keys());
    const chosen = activeVersion ?? highest;
    if (!this.keys.has(chosen)) {
      throw new VaultCryptoError(`A versão ativa v${chosen} não existe no chaveiro`);
    }
    this.activeVersion = chosen;
  }

  get(version: number): Uint8Array {
    const key = this.keys.get(version);
    if (!key) {
      // Mensagem interna: quem chama nunca repassa isto ao usuário.
      throw new VaultCryptoError(`Chave mestra v${version} não está carregada`);
    }
    return key;
  }

  versions(): number[] {
    return [...this.keys.keys()].sort((a, b) => a - b);
  }
}

// ── primitivas ──────────────────────────────────────────────────────────────

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

async function deriveKek(masterKey: Uint8Array, credentialId: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', toArrayBuffer(masterKey), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(utf8(credentialId)),
      info: toArrayBuffer(utf8(HKDF_INFO_DEK)),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function aesKey(raw: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM', length: 256 }, false, usages);
}

function secretAad(credentialId: string, cryptoVersion: number): Uint8Array {
  return utf8(`jurius-totp/secret/${credentialId}/${cryptoVersion}`);
}

function dekAad(credentialId: string, keyVersion: number): Uint8Array {
  return utf8(`jurius-totp/dek/${credentialId}/${keyVersion}`);
}

// ── selar / abrir ───────────────────────────────────────────────────────────

export async function sealSecret(
  keyring: MasterKeyring,
  credentialId: string,
  secret: string,
  keyVersion = keyring.activeVersion,
): Promise<SealedSecret> {
  if (!credentialId) throw new VaultCryptoError('Selar exige o id da credencial');

  const dek = crypto.getRandomValues(new Uint8Array(DEK_BYTES));
  const secretIv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const dekIv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));

  const secretCiphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(secretIv), additionalData: toArrayBuffer(secretAad(credentialId, CRYPTO_VERSION)) },
      await aesKey(dek, ['encrypt']),
      toArrayBuffer(utf8(secret)),
    ),
  );

  const wrappedDek = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(dekIv), additionalData: toArrayBuffer(dekAad(credentialId, keyVersion)) },
      await deriveKek(keyring.get(keyVersion), credentialId),
      toArrayBuffer(dek),
    ),
  );

  dek.fill(0);

  return {
    credentialId,
    secretCiphertext,
    secretIv,
    wrappedDek,
    dekIv,
    keyVersion,
    cryptoVersion: CRYPTO_VERSION,
  };
}

export async function openSecret(keyring: MasterKeyring, sealed: SealedSecret): Promise<string> {
  const dek = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(sealed.dekIv), additionalData: toArrayBuffer(dekAad(sealed.credentialId, sealed.keyVersion)) },
      await deriveKek(keyring.get(sealed.keyVersion), sealed.credentialId),
      toArrayBuffer(sealed.wrappedDek),
    ),
  );

  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(sealed.secretIv), additionalData: toArrayBuffer(secretAad(sealed.credentialId, sealed.cryptoVersion)) },
      await aesKey(dek, ['decrypt']),
      toArrayBuffer(sealed.secretCiphertext),
    );
    return new TextDecoder().decode(plain);
  } finally {
    dek.fill(0);
  }
}

/** Reembrulha o DEK sob outra versão de chave mestra, sem tocar no ciphertext. */
export async function rewrapDek(
  keyring: MasterKeyring,
  sealed: SealedSecret,
  targetVersion = keyring.activeVersion,
): Promise<Pick<SealedSecret, 'wrappedDek' | 'dekIv' | 'keyVersion'>> {
  const dek = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(sealed.dekIv), additionalData: toArrayBuffer(dekAad(sealed.credentialId, sealed.keyVersion)) },
      await deriveKek(keyring.get(sealed.keyVersion), sealed.credentialId),
      toArrayBuffer(sealed.wrappedDek),
    ),
  );

  try {
    const dekIv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
    const wrappedDek = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(dekIv), additionalData: toArrayBuffer(dekAad(sealed.credentialId, targetVersion)) },
        await deriveKek(keyring.get(targetVersion), sealed.credentialId),
        toArrayBuffer(dek),
      ),
    );
    return { wrappedDek, dekIv, keyVersion: targetVersion };
  } finally {
    dek.fill(0);
  }
}

// ── impressão digital para detectar duplicidade ─────────────────────────────
//
// HMAC com pepper de ambiente: sem o pepper não existe dicionário possível, e
// por isso NÃO é um sha256 simples do segredo. Vive numa variável própria
// (`TOTP_VAULT_FINGERPRINT_PEPPER`) porque precisa continuar estável mesmo
// quando a chave mestra é rotacionada.

export async function fingerprintSecret(pepper: Uint8Array, secret: string): Promise<string> {
  if (pepper.length < 32) {
    throw new VaultCryptoError('O pepper de impressão digital precisa ter ao menos 32 bytes');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const normalized = secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, toArrayBuffer(utf8(normalized))));
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── tokens opacos de sessão ────────────────────────────────────────────────

export function randomToken(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(utf8(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── bytea ↔ bytes ───────────────────────────────────────────────────────────
//
// PostgREST devolve `bytea` como texto hex com prefixo `\x`. Converter aqui
// mantém o resto do código lidando só com Uint8Array.

export function bytesToPgHex(bytes: Uint8Array): string {
  return `\\x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function pgHexToBytes(value: string): Uint8Array {
  const hex = String(value ?? '').replace(/^\\x/i, '');
  if (hex.length % 2 !== 0) throw new VaultCryptoError('bytea malformado');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
