// Fase 5: o caminho do CRM — JWT do Supabase em vez do token opaco da extensão.
import { call, check, resumo, USERS } from './lib.mjs';
import { readFileSync } from 'node:fs';
const saida = JSON.parse(readFileSync(new URL('./estado.json', import.meta.url), 'utf8'));

async function jwtDe(quem) {
  const r = await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: USERS[quem].email, password: USERS[quem].password }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`sem JWT para ${quem}: ${JSON.stringify(j)}`);
  return j.access_token;
}

const jwtMaria = await jwtDe('maria');
const jwtJoao = await jwtDe('joao');

console.log('\n── CRM autentica pelo JWT do Supabase ────────────────────────────');
const eu = await call('/auth/me', { jwt: jwtMaria, origin: 'https://jurius.com.br' });
check('/auth/me responde para o JWT do CRM', eu.status === 200 && eu.body.user?.is_admin === true, JSON.stringify(eu.body));
check('a sessão do CRM é do tipo web', eu.body.session?.kind === 'web');
check('sessão web tem id (é onde o step-up mora)', Boolean(eu.body.session?.id));

const lista = await call('/admin/credentials', { jwt: jwtMaria, origin: 'https://jurius.com.br' });
check('painel administrativo carrega pelo CRM', lista.status === 200 && Array.isArray(lista.body.credentials));
check('o painel traz metadado e nunca ciphertext', !JSON.stringify(lista.body).match(/ciphertext|wrapped_dek|fingerprint/));

const seg = await call('/admin/security', { jwt: jwtMaria, origin: 'https://jurius.com.br' });
check('a aba Segurança responde', seg.status === 200 && seg.body.pin_configured === true);
check('e não devolve hash nem salt', !JSON.stringify(seg.body).match(/pin_hash|pin_salt/));

console.log('\n── step-up pelo CRM ──────────────────────────────────────────────');
const stepErrado = await call('/auth/step-up', { method: 'POST', jwt: jwtMaria, origin: 'https://jurius.com.br', body: { password: 'senha-errada' } });
check('senha errada no step-up é 401', stepErrado.status === 401);
const step = await call('/auth/step-up', { method: 'POST', jwt: jwtMaria, origin: 'https://jurius.com.br', body: { password: USERS.maria.password } });
check('step-up pelo CRM devolve token', step.status === 200 && typeof step.body.step_up_token === 'string');

console.log('\n── quem não é admin não entra pelo CRM ───────────────────────────');
check('não-admin: 403 no painel', (await call('/admin/credentials', { jwt: jwtJoao, origin: 'https://jurius.com.br' })).status === 403);
check('não-admin: 403 na auditoria', (await call('/admin/audit', { jwt: jwtJoao, origin: 'https://jurius.com.br' })).status === 403);
check('não-admin: 403 na segurança', (await call('/admin/security', { jwt: jwtJoao, origin: 'https://jurius.com.br' })).status === 403);
check('JWT inventado: 401', (await call('/auth/me', { jwt: 'eyJhbGciOiJIUzI1NiJ9.aaa.bbb', origin: 'https://jurius.com.br' })).status === 401);
check('a chave anônima do projeto NÃO é sessão de usuário', (await call('/auth/me', { jwt: process.env.VITE_SUPABASE_ANON_KEY, origin: 'https://jurius.com.br' })).status === 401);

console.log('\n── a Data API continua fechada para as tabelas do cofre ──────────');
for (const tabela of ['totp_credentials', 'totp_permissions', 'totp_audit_logs', 'totp_admin_security', 'totp_sessions']) {
  const r = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/${tabela}?select=*&limit=1`, {
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${jwtMaria}` },
  });
  const corpo = await r.text();
  check(`${tabela}: nem o ADMIN lê pelo PostgREST`, r.status !== 200 || corpo.trim() === '[]', `${r.status} ${corpo.slice(0, 90)}`);
}
for (const tabela of ['totp_credentials', 'totp_sessions']) {
  const r = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/${tabela}?select=*&limit=1`, {
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY },
  });
  const corpo = await r.text();
  check(`${tabela}: anônimo também não lê`, r.status !== 200 || corpo.trim() === '[]', `${r.status} ${corpo.slice(0, 90)}`);
}
const escrita = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/totp_permissions`, {
  method: 'POST',
  headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${jwtJoao}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ credential_id: saida.credId, user_id: saida.joaoId, permission: 'EXPORT' }),
});
check('e ninguém se autoconcede permissão pela Data API', escrita.status >= 400, String(escrita.status));

process.exit(resumo('FASE 5'));
