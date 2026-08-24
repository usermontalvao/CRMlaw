// FASE 11 — o atalho do CRM pede PIN, e a trava é do SERVIDOR.
//
// O risco que isto fecha: pedir o PIN só no React seria teatro. Bastaria abrir
// o DevTools e chamar `/codes` com o mesmo JWT para pular a tela. Aqui a
// chamada é feita exatamente assim — na mão, sem passar pela interface.

import { call, check, login, resumo, USERS } from './lib.mjs';

const URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const PIN = '918273';

async function jwtDe(email, senha) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login falhou: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function comUnlock(caminho, { jwt, method = 'GET', body, dispositivo } = {}) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` };
  // O CRM manda isto a cada chamada: é o que separa um navegador do outro.
  headers['X-Vault-Device'] = dispositivo ?? 'crm-teste-a';
  const r = await fetch(`${process.env.VITE_SUPABASE_URL}/functions/v1/totp-vault${caminho}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status, body: j };
}

async function principal() {
  const pedro = await login('pedro');   // sessão de EXTENSÃO
  const jwt = await jwtDe(USERS.pedro.email, USERS.pedro.password); // sessão WEB

  // uma chave para haver código a pedir
  await call('/credentials', { method: 'POST', token: pedro.access_token,
    body: { name: 'Chave da fase 11', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 } });

  console.log('\n── sem PIN, o CRM não vê código ────────────────────────────────');
  {
    const r = await comUnlock('/codes', { jwt, method: 'POST', body: {} });
    check('/codes pelo CRM sem destravar: 428', r.status === 428, `${r.status} ${JSON.stringify(r.body)}`);
    check('e a mensagem pede o PIN', /PIN/i.test(r.body?.error ?? ''), r.body?.error);
    check('nenhum código veio junto', !JSON.stringify(r.body ?? {}).match(/"code"/));
  }

  console.log('\n── PIN errado não destrava ─────────────────────────────────────');
  {
    const r = await comUnlock('/auth/unlock', { jwt, method: 'POST', body: { pin: '000111' } });
    check('PIN errado: 401', r.status === 401, `${r.status} ${JSON.stringify(r.body)}`);
    check('e conta as tentativas', /Restam/i.test(r.body?.error ?? ''), r.body?.error);
  }

  console.log('\n── PIN certo destrava, e só então sai código ───────────────────');
  {
    const u = await comUnlock('/auth/unlock', { jwt, method: 'POST', body: { pin: PIN } });
    check('destravamento aceito', u.status === 200, `${u.status} ${JSON.stringify(u.body)}`);
    check('vale 2 horas', u.body?.expires_in === 7200, String(u.body?.expires_in));
    check('e NÃO devolve token para a aba guardar', !u.body?.unlock_token, JSON.stringify(Object.keys(u.body ?? {})));

    const estado = await comUnlock('/auth/unlock', { jwt });
    check('o painel consegue perguntar se já está destravado', estado.status === 200 && estado.body?.unlocked === true,
      JSON.stringify(estado.body));

    const r = await comUnlock('/codes', { jwt, method: 'POST', body: {} });
    check('agora /codes responde', r.status === 200, `${r.status}`);
    check('e traz código de verdade', (r.body?.codes ?? []).some((c) => /^\d{6}$/.test(c.code ?? '')),
      JSON.stringify(r.body?.codes?.[0]));

    console.log('\n── trancar de volta vale na hora ───────────────────────────────');
    const l = await comUnlock('/auth/lock', { jwt, method: 'POST' });
    check('trancar aceito', l.status === 200, `${l.status}`);

    const depois = await comUnlock('/codes', { jwt, method: 'POST', body: {} });
    check('depois de trancar, volta a pedir PIN', depois.status === 428, `${depois.status}`);
  }

  console.log('\n── a extensão NÃO é afetada ────────────────────────────────────');
  {
    const r = await call('/codes', { method: 'POST', token: pedro.access_token, body: {} });
    check('a extensão continua vendo código sem PIN', r.status === 200, `${r.status}`);
    check('e o código é real', (r.body?.codes ?? []).some((c) => /^\d{6}$/.test(c.code ?? '')));
  }

  console.log('\n── o destravamento é de UMA sessão só ──────────────────────────');
  {
    await comUnlock('/auth/unlock', { jwt, method: 'POST', body: { pin: PIN } });
    // Mesma pessoa, OUTRO navegador: identificador diferente, sessão diferente.
    const jwt2 = await jwtDe(USERS.pedro.email, USERS.pedro.password);
    const r = await comUnlock('/codes', { jwt: jwt2, method: 'POST', body: {}, dispositivo: 'crm-teste-b' });
    check('destravar num navegador não abre o outro', r.status === 428, `${r.status}`);

    // E o primeiro continua destravado — separar não pode custar a sessão boa.
    const primeiro = await comUnlock('/codes', { jwt, method: 'POST', body: {} });
    check('o navegador que destravou segue funcionando', primeiro.status === 200, `${primeiro.status}`);
  }

  console.log('\n── auditoria ───────────────────────────────────────────────────');
  {
    const maria = await login('maria');
    const a = await call('/admin/audit?limit=60', { token: maria.access_token });
    const tipos = (a.body?.events ?? []).map((e) => e.event_type);
    check('destravar ficou auditado', tipos.includes('PIN_UNLOCK_COMPLETED'), [...new Set(tipos)].join(','));
    check('a tentativa errada também', tipos.includes('PIN_UNLOCK_FAILED'));
    check('e o PIN não aparece na auditoria', !JSON.stringify(a.body ?? {}).includes(PIN));
  }

  process.exit(resumo('FASE 11 — PIN NO ATALHO DO CRM'));
}

principal().catch((e) => { console.error(e); process.exit(1); });
