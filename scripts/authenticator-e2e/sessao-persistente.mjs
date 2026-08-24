// FASE 10 — a sessão sobrevive a uma resposta perdida.
//
// O bug que isto vigia: a extensão pedia renovação, o servidor rotacionava e
// gravava, e a resposta se perdia (rede, service worker morto, máquina
// dormindo). A extensão ficava com o token ANTIGO; no uso seguinte ele batia em
// `previous_refresh_hash` e a sessão inteira caía. Com ~144 rotações por dia,
// perder uma era questão de horas — e o usuário via "entre novamente" sem nada
// de errado ter acontecido.
//
// Simular a resposta perdida é simples: renovar e JOGAR FORA o resultado. O
// cliente honesto fica exatamente no estado de quem não recebeu a resposta.

import { call, check, login, resumo } from './lib.mjs';

async function principal() {
  console.log('\n── resposta perdida NÃO derruba a sessão ────────────────────────');
  {
    const sessao = await login('joao');
    const refreshOriginal = sessao.refresh_token;

    // Rotação 1: acontece de verdade no servidor, e nós ignoramos a resposta.
    const perdida = await call('/auth/refresh', { method: 'POST', body: { refresh_token: refreshOriginal } });
    check('a renovação aconteceu no servidor', perdida.status === 200, `${perdida.status}`);

    // A extensão, sem ter recebido nada, tenta de novo com o token antigo.
    const retentativa = await call('/auth/refresh', { method: 'POST', body: { refresh_token: refreshOriginal } });
    check('a retentativa com o token antigo é ACEITA', retentativa.status === 200,
      `${retentativa.status} ${JSON.stringify(retentativa.body)}`);
    check('e devolve um par novo e utilizável', typeof retentativa.body?.access_token === 'string');

    const usando = await call('/credentials', { token: retentativa.body.access_token });
    check('o token da retentativa realmente abre o cofre', usando.status === 200, `${usando.status}`);

    const aindaVive = await call('/auth/sessions', { token: retentativa.body.access_token });
    check('a sessão continua viva (não foi revogada)', aindaVive.status === 200, `${aindaVive.status}`);
  }

  console.log('\n── mas reuso ANTIGO continua sendo tratado como roubo ───────────');
  {
    // A janela é de 90s. Um token guardado além disso é o cenário de roubo, e
    // aí a severidade antiga volta: derruba a família toda.
    const sessao = await login('joao');
    const antigo = sessao.refresh_token;

    const primeira = await call('/auth/refresh', { method: 'POST', body: { refresh_token: antigo } });
    check('rotação inicial ok', primeira.status === 200, `${primeira.status}`);

    console.log('   (esperando a janela de graça fechar — 95s)');
    await new Promise((r) => setTimeout(r, 95_000));

    const roubo = await call('/auth/refresh', { method: 'POST', body: { refresh_token: antigo } });
    check('token velho fora da janela é recusado', roubo.status === 401, `${roubo.status}`);
    check('e a mensagem fala em segurança', /segurança/i.test(roubo.body?.error ?? ''), roubo.body?.error);

    const morta = await call('/credentials', { token: primeira.body.access_token });
    check('a sessão inteira foi derrubada', morta.status === 401, `${morta.status}`);
  }

  console.log('\n── o access dura mais, e revogar continua imediato ──────────────');
  {
    const sessao = await login('maria');
    check('o access agora vale 60 minutos', sessao.access_expires_in === 3600, String(sessao.access_expires_in));

    const lista = await call('/auth/sessions', { token: sessao.access_token });
    const propria = (lista.body?.sessions ?? []).find((s) => s.is_current);
    check('a própria sessão aparece', Boolean(propria), JSON.stringify(lista.body?.sessions?.length));

    // Derrubar tem de valer AGORA, não no vencimento do access.
    await call(`/auth/sessions/${propria.id}`, { method: 'DELETE', token: sessao.access_token });
    const depois = await call('/credentials', { token: sessao.access_token });
    check('derrubar o dispositivo vale na chamada seguinte, não no vencimento',
      depois.status === 401, `${depois.status}`);
  }

  process.exit(resumo('FASE 10 — SESSÃO PERSISTENTE'));
}

principal().catch((e) => { console.error(e); process.exit(1); });
