// FASE 6 — os poderes administrativos acrescentados depois da fase 5:
// listar/derrubar dispositivos de qualquer pessoa e transferir propriedade.
//
// O teste que importa mais nesta fase é o do ATALHO: o administrador tentando
// transferir uma chave para si mesmo. Se isso passar, ele vira dono, e dono
// exporta o segredo sem break-glass — o cofre inteiro perde o sentido.

// PRÉ-REQUISITO: a fase 3 deixa o PIN da Maria configurado e, no fim, em
// bloqueio progressivo. Rode `reset-pin.sql` antes desta fase, senão os
// primeiros passos falham com "Informe o PIN atual" e 429.

import { call, check, login, resumo, stepUp, USERS } from './lib.mjs';

const PIN = '918273';

async function principal() {
  const pedro = await login('pedro');
  const joao = await login('joao');
  const maria = await login('maria'); // administradora

  // ── PIN da administradora, que a transferência vai cobrar ────────────────
  //
  // O PIN é o DO SISTEMA (`user_security_pins`), cadastrado por `seed.sql`.
  // O cofre não cadastra PIN próprio — ver `pin-do-sistema.mjs`.
  {
    const seg = await call('/admin/security', { token: maria.access_token });
    check('PIN do sistema pronto para a fase', seg.body?.pin_configured === true,
      'rode reset-pin.sql antes desta fase');
  }

  // ── uma chave do Pedro, para ser o objeto da transferência ───────────────
  const criada = await call('/credentials', {
    method: 'POST', token: pedro.access_token,
    body: { name: 'Chave da Fase 6', issuer: 'Fase6', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 },
  });
  check('chave de teste criada', criada.status === 200 || criada.status === 201, JSON.stringify(criada.body));
  const credId = criada.body?.credential?.id ?? criada.body?.id;

  console.log('\n── /admin/sessions ───────────────────────────────────────────────');
  {
    const r = await call('/admin/sessions', { token: maria.access_token });
    check('a administradora lista os dispositivos de todos', r.status === 200, JSON.stringify(r.body));

    const lista = r.body?.sessions ?? [];
    check('a lista alcança mais de uma pessoa', new Set(lista.map((s) => s.user_id)).size >= 2, `${lista.length} sessões`);

    const bruto = JSON.stringify(lista);
    check('a lista NÃO traz token de sessão', !/token/i.test(bruto));
    check('a lista NÃO traz hash nem salt', !/hash|salt/i.test(bruto));
    check('a lista diz se a pessoa ainda está ativa', lista.every((s) => typeof s.user_is_active === 'boolean'));
    check('a lista marca a própria sessão da admin', lista.some((s) => s.is_current === true));

    const doPedro = lista.find((s) => s.user_email === USERS.pedro.email);
    check('a sessão do Pedro aparece com o nome dele', Boolean(doPedro?.user_name), JSON.stringify(doPedro ?? null));

    const busca = await call(`/admin/sessions?q=${encodeURIComponent('pedro')}`, { token: maria.access_token });
    check('a busca por pessoa filtra', busca.status === 200 && (busca.body.sessions ?? []).every((s) => /pedro/i.test(`${s.user_name} ${s.user_email}`)));

    const semAcento = await call(`/admin/sessions?q=${encodeURIComponent('téste')}`, { token: maria.access_token });
    check('a busca ignora acento', semAcento.status === 200 && (semAcento.body.sessions ?? []).length > 0);
  }

  console.log('\n── quem não é admin não enxerga dispositivo alheio ──────────────');
  {
    const r = await call('/admin/sessions', { token: joao.access_token });
    check('João: 403 em /admin/sessions', r.status === 403, `${r.status}`);

    const semSessao = await call('/admin/sessions');
    check('sem sessão: 401', semSessao.status === 401, `${semSessao.status}`);

    const proprias = await call('/auth/sessions', { token: joao.access_token });
    const soDele = (proprias.body?.sessions ?? []);
    check('a rota comum devolve SÓ os dispositivos de quem pediu', proprias.status === 200 && soDele.length > 0);
  }

  console.log('\n── o ATALHO fechado: admin não transfere para si mesma ──────────');
  {
    const t = await stepUp('maria', maria.access_token);
    const r = await call('/admin/transfer', {
      method: 'POST', token: maria.access_token,
      body: {
        credential_id: credId,
        new_owner_user_id: maria.user.id,
        pin: PIN,
        reason: 'tentando virar dona da chave para exportar o segredo depois',
        step_up_token: t,
      },
    });
    check('transferir para si mesma é 403', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
    check('a recusa explica o caminho certo (recuperação)', /recupera/i.test(r.body?.error ?? ''), r.body?.error);

    const dono = await call('/admin/credentials', { token: maria.access_token });
    const alvo = (dono.body?.credentials ?? []).find((c) => c.id === credId);
    check('a chave continua sendo do Pedro', alvo?.owner_email === USERS.pedro.email, alvo?.owner_email);
  }

  console.log('\n── a transferência administrativa legítima ──────────────────────');
  {
    const semMotivo = await call('/admin/transfer', {
      method: 'POST', token: maria.access_token,
      body: { credential_id: credId, new_owner_user_id: joao.user.id, pin: PIN, reason: 'curto' },
    });
    check('motivo curto é recusado (400)', semMotivo.status === 400, `${semMotivo.status}`);

    const semPin = await call('/admin/transfer', {
      method: 'POST', token: maria.access_token,
      body: { credential_id: credId, new_owner_user_id: joao.user.id, pin: '', reason: 'motivo suficientemente longo para a auditoria' },
    });
    check('sem PIN é recusado', semPin.status === 401 || semPin.status === 400, `${semPin.status}`);

    const semStepUp = await call('/admin/transfer', {
      method: 'POST', token: maria.access_token,
      body: { credential_id: credId, new_owner_user_id: joao.user.id, pin: PIN, reason: 'motivo suficientemente longo para a auditoria' },
    });
    check('PIN certo SEM step-up ainda é 401', semStepUp.status === 401, `${semStepUp.status}`);

    const naoAdmin = await call('/admin/transfer', {
      method: 'POST', token: joao.access_token,
      body: { credential_id: credId, new_owner_user_id: joao.user.id, pin: PIN, reason: 'joao tentando se dar a chave do pedro' },
    });
    check('não-admin: 403 em /admin/transfer', naoAdmin.status === 403, `${naoAdmin.status}`);

    const t = await stepUp('maria', maria.access_token);
    const ok = await call('/admin/transfer', {
      method: 'POST', token: maria.access_token,
      body: {
        credential_id: credId, new_owner_user_id: joao.user.id, pin: PIN,
        reason: 'proprietario desligado e a chave precisa de responsavel novo',
        step_up_token: t,
      },
    });
    check('transferência administrativa aceita', ok.status === 200, JSON.stringify(ok.body));
    check('a resposta NÃO traz segredo', !/secret|uri/i.test(JSON.stringify(ok.body ?? {})));

    const painel = await call('/admin/credentials', { token: maria.access_token });
    const alvo = (painel.body?.credentials ?? []).find((c) => c.id === credId);
    check('João virou o dono', alvo?.owner_email === USERS.joao.email, alvo?.owner_email);
    check('o dono anterior NÃO ficou com acesso', !(alvo?.shares ?? []).some((s) => s.user_id === pedro.user.id), JSON.stringify(alvo?.shares));

    const pedroTenta = await call(`/credentials/${credId}/code`, { token: pedro.access_token });
    check('Pedro perdeu o código na hora (403/404)', pedroTenta.status === 403 || pedroTenta.status === 404, `${pedroTenta.status}`);
  }

  console.log('\n── admin derruba dispositivo alheio ─────────────────────────────');
  {
    const lista = await call('/admin/sessions', { token: maria.access_token });
    const doJoao = (lista.body?.sessions ?? []).find((s) => s.user_email === USERS.joao.email && !s.revoked_at);
    check('há uma sessão do João para derrubar', Boolean(doJoao), JSON.stringify(doJoao ?? null));
    if (!doJoao) return process.exit(resumo('FASE 6'));

    const r = await call(`/auth/sessions/${doJoao.id}`, { method: 'DELETE', token: maria.access_token });
    check('a administradora derruba a sessão do João', r.status === 200, JSON.stringify(r.body));

    const morta = await call('/credentials', { token: joao.access_token });
    check('o token do João morre na hora (401)', morta.status === 401, `${morta.status}`);

    const revogadas = await call('/admin/sessions?include_revoked=1', { token: maria.access_token });
    const linha = (revogadas.body?.sessions ?? []).find((s) => s.id === doJoao.id);
    check('a revogada aparece quando pedida', Boolean(linha?.revoked_at));
    check('e o motivo diz que foi o admin', linha?.revoked_reason === 'revoked_by_admin', linha?.revoked_reason);
  }

  console.log('\n── auditoria dos novos eventos ──────────────────────────────────');
  {
    const r = await call('/admin/audit?limit=200', { token: maria.access_token });
    const eventos = (r.body?.events ?? []).map((e) => e.event_type);
    for (const esperado of ['ADMIN_SESSIONS_LISTED', 'ADMIN_TRANSFER_REQUESTED', 'ADMIN_TRANSFER_COMPLETED', 'ADMIN_TRANSFER_FAILED']) {
      check(`auditoria registra ${esperado}`, eventos.includes(esperado));
    }
    const bruto = JSON.stringify(r.body?.events ?? []);
    check('nenhum PIN, segredo ou token na auditoria da fase', !new RegExp(`${PIN}|JBSWY3DPEHPK3PXP|access_token`, 'i').test(bruto));

    // `find` pegava a recusa mais RECENTE (step_up_missing) e escondia esta.
    // A fase provoca várias recusas de propósito: é preciso olhar todas.
    const recusas = (r.body?.events ?? []).filter((e) => e.event_type === 'ADMIN_TRANSFER_FAILED');
    check(
      'a tentativa de virar dona ficou registrada como self_transfer_blocked',
      recusas.some((e) => e.metadata_safe?.why === 'self_transfer_blocked'),
      JSON.stringify(recusas.map((e) => e.metadata_safe?.why)),
    );
  }

  process.exit(resumo('FASE 6'));
}

principal().catch((erro) => { console.error(erro); process.exit(1); });
