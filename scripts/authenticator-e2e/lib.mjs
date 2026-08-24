import { createHmac } from 'node:crypto';

export const BASE = `${process.env.VITE_SUPABASE_URL}/functions/v1/totp-vault`;

// As contas de teste são descartáveis e vivem no domínio reservado
// `.invalid`. As senhas NÃO ficam no repositório — vêm do ambiente, como manda
// o README desta pasta.
function conta(prefixo, dispositivo) {
  const senha = process.env[`TOTP_E2E_${prefixo.toUpperCase()}_SENHA`];
  if (!senha) {
    throw new Error(
      `Falta TOTP_E2E_${prefixo.toUpperCase()}_SENHA no ambiente. ` +
      'Veja scripts/authenticator-e2e/README.md.',
    );
  }
  // Todas as contas de teste usam o mesmo PIN do sistema, posto por seed.sql.
  return { email: `${prefixo}.teste@totp-vault-test.invalid`, password: senha, pin: '918273', device: dispositivo };
}

export const USERS = {
  pedro: conta('pedro', 'dev-pedro'),
  joao:  conta('joao',  'dev-joao'),
  maria: conta('maria', 'dev-maria'),
};

export const estado = { pass: 0, fail: 0, falhas: [] };

export function check(label, cond, extra = '') {
  if (cond) { estado.pass++; console.log(`  ✔ ${label}`); }
  else { estado.fail++; estado.falhas.push(label); console.log(`  ✘ ${label}  ${extra}`); }
}

export async function call(path, { method = 'GET', token, body, jwt, origin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Vault-Session'] = token;
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  if (origin) headers['Origin'] = origin;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, body: json, headers: res.headers };
}

export async function login(who) {
  const u = USERS[who];
  const r = await call('/auth/login', {
    method: 'POST',
    // O login da extensão cobra senha E PIN — ver `pin-do-sistema.mjs`.
    body: { email: u.email, password: u.password, pin: u.pin, device_id: u.device, device_name: `Teste ${who}` },
  });
  if (r.status !== 200) throw new Error(`login ${who} falhou: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

export async function stepUp(who, token) {
  const r = await call('/auth/step-up', { method: 'POST', token, body: { password: USERS[who].password } });
  if (r.status !== 200) throw new Error(`step-up ${who} falhou: ${JSON.stringify(r.body)}`);
  return r.body.step_up_token;
}

// TOTP de referência, independente do código do cofre: se os dois batem, o
// servidor está mesmo gerando RFC 6238 a partir do segredo que guardamos.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function b32(input) {
  const s = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  const out = []; let buf = 0, bits = 0;
  for (const c of s) { buf = (buf << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); } }
  return Buffer.from(out);
}
export function totp(secret, { algorithm = 'sha1', digits = 6, period = 30, atSeconds }) {
  const counter = Math.floor(atSeconds / period);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, b32(secret)).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

// Protobuf mínimo, só para montar um QR de transferência de teste.
const varint = (v) => { const o = []; let r = v; do { let b = r & 0x7f; r >>>= 7; if (r > 0) b |= 0x80; o.push(b); } while (r > 0); return o; };
const tag = (f, w) => varint((f << 3) | w);
const ld = (f, b) => { const d = [...b]; return [...tag(f, 2), ...varint(d.length), ...d]; };
export function gaParam(secret, name, issuer, alg, dig, type) {
  const e = new TextEncoder();
  return [...ld(1, b32(secret)), ...ld(2, e.encode(name)), ...ld(3, e.encode(issuer)),
          ...tag(4, 0), ...varint(alg), ...tag(5, 0), ...varint(dig), ...tag(6, 0), ...varint(type)];
}
export function gaUri(params) {
  const corpo = [...params.flatMap((p) => ld(1, p)), ...tag(2, 0), ...varint(1), ...tag(3, 0), ...varint(1), ...tag(4, 0), ...varint(0)];
  return `otpauth-migration://offline?data=${encodeURIComponent(Buffer.from(Uint8Array.from(corpo)).toString('base64'))}`;
}

export function resumo(titulo) {
  console.log(`\n${'='.repeat(66)}\n${titulo}: ${estado.pass} passaram, ${estado.fail} falharam`);
  if (estado.fail) { console.log('FALHAS:'); estado.falhas.forEach((f) => console.log(`  • ${f}`)); }
  console.log('='.repeat(66));
  return estado.fail === 0 ? 0 : 1;
}
