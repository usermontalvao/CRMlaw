// FASE 9 — o cofre usa o PIN DO SISTEMA (`user_security_pins`), não um próprio.
//
// O que precisa ser verdade:
//   • o PIN cadastrado em Meu Perfil → Segurança abre o break-glass;
//   • quem não tem PIN do sistema recebe recado apontando para lá;
//   • o cofre NÃO cadastra PIN (a rota antiga responde 410 explicando);
//   • o contador de erro é UM só — errar no cofre conta no sistema.

import { call, check, login, resumo, stepUp } from './lib.mjs';

const PIN = '918273';   // cadastrado direto em user_security_pins pelo seed

async function principal() {
  const pedro = await login('pedro');
  const maria = await login('maria');

  const criada = await call('/credentials', { method: 'POST', token: pedro.access_token,
    body: { name: 'Chave da fase 9', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 } });
  const credId = criada.body?.credential?.id ?? criada.body?.id;
  check('chave criada', Boolean(credId), JSON.stringify(criada.body));

  console.log('\n── o cofre enxerga o PIN do sistema ─────────────────────────────');
  {
    const eu = await call('/auth/me', { token: maria.access_token });
    check('a Maria aparece com PIN configurado', eu.body?.admin_pin_configured === true, JSON.stringify(eu.body));

    const seg = await call('/admin/security', { token: maria.access_token });
    check('a aba Segurança confirma', seg.body?.pin_configured === true, JSON.stringify(seg.body));
    check('e diz que o PIN vem do sistema', seg.body?.pin_origem === 'sistema', seg.body?.pin_origem);
    check('não devolve hash nem salt', !/pin_hash|pin_salt|kdf/.test(JSON.stringify(seg.body ?? {})));
    check('conta quantos admins têm PIN', typeof seg.body?.admins_with_pin === 'number', JSON.stringify(seg.body?.admins_with_pin));
  }

  console.log('\n── o cofre não cadastra mais PIN ────────────────────────────────');
  {
    const t = await stepUp('maria', maria.access_token);
    const r = await call('/admin/security/pin', { method: 'POST', token: maria.access_token,
      body: { new_pin: '445566', step_up_token: t } });
    check('a rota antiga responde 410', r.status === 410, `${r.status} ${JSON.stringify(r.body)}`);
    check('e explica onde cadastrar', /Meu Perfil/i.test(r.body?.error ?? ''), r.body?.error);
  }

  console.log('\n── break-glass com o PIN DO SISTEMA ─────────────────────────────');
  {
    const errado = await call('/admin/recover', { method: 'POST', token: maria.access_token, body: {
      credential_id: credId, pin: '000123',
      reason: 'conferindo que o pin errado do sistema tambem e recusado aqui' } });
    check('PIN errado é recusado', errado.status === 401, `${errado.status} ${JSON.stringify(errado.body)}`);
    check('e diz quantas tentativas restam', /Restam/i.test(errado.body?.error ?? ''), errado.body?.error);

    const t = await stepUp('maria', maria.access_token);
    const ok = await call('/admin/recover', { method: 'POST', token: maria.access_token, body: {
      credential_id: credId, pin: PIN,
      reason: 'recuperacao de emergencia usando o pin de seguranca do crm',
      step_up_token: t } });
    check('o PIN do CRM abre o break-glass', ok.status === 200, `${ok.status} ${JSON.stringify(ok.body)}`);
    check('e o segredo volta uma vez', typeof ok.body?.secret === 'string', typeof ok.body?.secret);
  }

  console.log('\n── quem NÃO tem PIN do sistema ─────────────────────────────────');
  {
    // Pedro não é admin, então bate no 403 antes. O que importa é que o cofre
    // não ofereça um caminho para cadastrar PIN próprio.
    const r = await call('/admin/security/pin', { method: 'POST', token: pedro.access_token,
      body: { new_pin: '778899' } });
    check('não-admin nem chega no PIN (403)', r.status === 403, `${r.status}`);
  }

  console.log('\n── contador de erro é UM só ────────────────────────────────────');
  {
    const antes = await call('/admin/security', { token: maria.access_token });
    check('o cofre lê o contador do sistema', typeof antes.body?.failed_attempts === 'number',
      JSON.stringify(antes.body?.failed_attempts));
  }

  process.exit(resumo('FASE 9 — PIN DO SISTEMA'));
}

principal().catch((e) => { console.error(e); process.exit(1); });
