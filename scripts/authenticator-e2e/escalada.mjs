// FASE 7 — a escalada de privilégio em `profiles`, testada pela porta que o
// atacante usaria: PostgREST com o JWT de um usuário comum.
//
// A cadeia que existia:
//   1. `update profiles set role='Administrador' where user_id = auth.uid()`
//   2. virar administrador do cofre
//   3. configurar PIN
//   4. break-glass em qualquer chave
//
// Basta quebrar o degrau 1 — e é ele que este arquivo vigia.

import { call, check, login, resumo, USERS } from './lib.mjs';

const URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;

async function jwtDe(email, senha) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login PostgREST falhou para ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function rest(caminho, { method = 'GET', jwt, body, prefer } = {}) {
  const headers = { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${URL}/rest/v1/${caminho}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null;
  try { j = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status, body: j };
}

async function principal() {
  const jwtPedro = await jwtDe(USERS.pedro.email, USERS.pedro.password);
  const jwtJoao  = await jwtDe(USERS.joao.email,  USERS.joao.password);
  const jwtMaria = await jwtDe(USERS.maria.email, USERS.maria.password);

  const eu = await rest(`profiles?email=eq.${encodeURIComponent(USERS.pedro.email)}&select=user_id,role,badge,is_active`, { jwt: jwtPedro });
  const pedroId = eu.body?.[0]?.user_id;
  const joaoRow = await rest(`profiles?email=eq.${encodeURIComponent(USERS.joao.email)}&select=user_id,role`, { jwt: jwtPedro });
  const joaoId = joaoRow.body?.[0]?.user_id;
  check('o perfil do Pedro é legível (a leitura continua funcionando)', Boolean(pedroId), JSON.stringify(eu.body));

  console.log('\n── degrau 1: promover a si mesmo ────────────────────────────────');
  {
    const r = await rest(`profiles?user_id=eq.${pedroId}`, {
      method: 'PATCH', jwt: jwtPedro, prefer: 'return=representation',
      body: { role: 'Administrador' },
    });
    check('Pedro NÃO consegue virar Administrador', r.status >= 400, `${r.status} ${JSON.stringify(r.body)}`);

    const conferir = await rest(`profiles?user_id=eq.${pedroId}&select=role`, { jwt: jwtPedro });
    check('e o cargo dele continua "Advogado"', conferir.body?.[0]?.role === 'Advogado', conferir.body?.[0]?.role);
  }

  console.log('\n── o mesmo degrau, pelo selo ────────────────────────────────────');
  {
    const r = await rest(`profiles?user_id=eq.${pedroId}`, {
      method: 'PATCH', jwt: jwtPedro, body: { badge: 'Administrador' },
    });
    check('Pedro NÃO consegue se dar o selo de Administrador', r.status >= 400, `${r.status}`);
  }

  console.log('\n── desativar/reativar gente ─────────────────────────────────────');
  {
    const r = await rest(`profiles?user_id=eq.${joaoId}`, {
      method: 'PATCH', jwt: jwtPedro, body: { is_active: false },
    });
    // Atenção ao 204: quando a RLS não deixa a linha nem ser vista, o
    // PostgREST devolve 204 tendo afetado ZERO linhas. Status não prova nada
    // aqui — o que prova é o valor continuar de pé.
    const joaoDepois = await rest(`profiles?user_id=eq.${joaoId}&select=is_active`, { jwt: jwtMaria });
    check('Pedro NÃO desativa o João',
      joaoDepois.body?.[0]?.is_active === true,
      `status=${r.status} is_active=${joaoDepois.body?.[0]?.is_active}`);

    const eu2 = await rest(`profiles?user_id=eq.${pedroId}`, {
      method: 'PATCH', jwt: jwtPedro, body: { is_active: false },
    });
    check('Pedro nem a si mesmo desativa pela API', eu2.status >= 400, `${eu2.status}`);
  }

  console.log('\n── advogado escrevendo na linha de terceiros ────────────────────');
  {
    const r = await rest(`profiles?user_id=eq.${joaoId}`, {
      method: 'PATCH', jwt: jwtPedro, body: { name: 'Nome trocado por terceiro' },
    });
    const conferir = await rest(`profiles?user_id=eq.${joaoId}&select=name`, { jwt: jwtPedro });
    check('advogado NÃO altera o perfil de outra pessoa',
      r.status >= 400 || conferir.body?.[0]?.name !== 'Nome trocado por terceiro',
      `${r.status} → nome=${conferir.body?.[0]?.name}`);
  }

  console.log('\n── repontar o perfil para outro usuário ─────────────────────────');
  {
    const r = await rest(`profiles?user_id=eq.${pedroId}`, {
      method: 'PATCH', jwt: jwtPedro, body: { user_id: joaoId },
    });
    check('ninguém repõe o `user_id` de um perfil', r.status >= 400, `${r.status}`);
  }

  console.log('\n── a auto-edição comum continua funcionando ─────────────────────');
  {
    const r = await rest(`profiles?user_id=eq.${pedroId}`, {
      method: 'PATCH', jwt: jwtPedro, body: { bio: 'bio nova de teste', role: 'Advogado' },
    });
    check('Pedro edita a própria bio reenviando o MESMO cargo', r.status < 400, `${r.status} ${JSON.stringify(r.body)}`);
  }

  console.log('\n── administradora de verdade ainda administra ───────────────────');
  {
    const r = await rest(`profiles?user_id=eq.${joaoId}`, {
      method: 'PATCH', jwt: jwtMaria, body: { role: 'Estagiário' },
    });
    check('a administradora troca o cargo do João', r.status < 400, `${r.status} ${JSON.stringify(r.body)}`);

    const volta = await rest(`profiles?user_id=eq.${joaoId}`, {
      method: 'PATCH', jwt: jwtMaria, body: { role: 'Advogado' },
    });
    check('e devolve ao que era', volta.status < 400, `${volta.status}`);
  }

  console.log('\n── o cofre não é enganado pelo que veio do frontend ─────────────');
  {
    const joao = await login('joao');
    const r = await call('/auth/me', { token: joao.access_token });
    check('o cofre diz que João NÃO é admin', r.body?.user?.is_admin === false, JSON.stringify(r.body?.user));

    const painel = await call('/admin/credentials', { token: joao.access_token });
    check('e o painel administrativo recusa (403)', painel.status === 403, `${painel.status}`);

    // Mesmo mandando "is_admin" no corpo: identidade vem da sessão, não do JSON.
    const forjado = await call('/admin/recover', { method: 'POST', token: joao.access_token, body: {
      credential_id: '00000000-0000-0000-0000-000000000000', pin: '000000',
      reason: 'tentando forjar is_admin pelo corpo do pedido para abrir o cofre',
      is_admin: true, role: 'Administrador', isAdmin: true,
    }});
    check('forjar is_admin/role no corpo não promove ninguém', forjado.status === 403, `${forjado.status}`);
  }

  process.exit(resumo('FASE 7 — ESCALADA DE PRIVILÉGIO'));
}

principal().catch((e) => { console.error(e); process.exit(1); });
