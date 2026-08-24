// Revisão ofensiva dirigida à superfície NOVA (/admin/sessions e /admin/transfer).
import { call, check, login, resumo, stepUp, USERS } from './lib.mjs';

const PIN = '918273';

const r = async (...a) => call(...a);

async function main() {
  const pedro = await login('pedro');
  const joao  = await login('joao');
  const maria = await login('maria');

  { const t = await stepUp('maria', maria.access_token);
    await r('/admin/security/pin', { method:'POST', token: maria.access_token, body:{ new_pin: PIN, step_up_token: t } }); }

  const nova = await r('/credentials', { method:'POST', token: pedro.access_token,
    body:{ name:'Alvo ofensivo', secret:'JBSWY3DPEHPK3PXP', algorithm:'SHA1', digits:6, period:30 } });
  const credId = nova.body?.credential?.id ?? nova.body?.id;

  console.log('\n── mass assignment na transferência ─────────────────────────────');
  {
    const t = await stepUp('maria', maria.access_token);
    // Injeta campos que NÃO deveriam ser lidos do corpo.
    const res = await r('/admin/transfer', { method:'POST', token: maria.access_token, body:{
      credential_id: credId, new_owner_user_id: joao.user.id, pin: PIN,
      reason: 'tentando forjar identidade e permissao pelo corpo do pedido',
      step_up_token: t,
      // lixo hostil:
      actor_user_id: maria.user.id, user_id: maria.user.id, is_admin: true,
      owner_user_id: maria.user.id, role: 'OWNER', permission: 'EXPORT',
      status: 'active', secret: 'AAAAAAAAAAAAAAAA',
    }});
    check('a transferência ignora campos forjados e conclui', res.status === 200, JSON.stringify(res.body));

    const painel = await r('/admin/credentials', { token: maria.access_token });
    const alvo = (painel.body?.credentials ?? []).find(c => c.id === credId);
    check('o dono virou João, NÃO a admin que forjou owner_user_id', alvo?.owner_email === USERS.joao.email, alvo?.owner_email);
    check('a admin não ganhou permissão nenhuma', !(alvo?.shares ?? []).some(s => s.user_id === maria.user.id), JSON.stringify(alvo?.shares));
  }

  console.log('\n── transferir para usuário DESATIVADO ───────────────────────────');
  {
    const t = await stepUp('maria', maria.access_token);
    const res = await r('/admin/transfer', { method:'POST', token: maria.access_token, body:{
      credential_id: credId, new_owner_user_id: '00000000-0000-0000-0000-000000000001', pin: PIN,
      reason: 'tentando entregar a chave para um usuario que nao existe', step_up_token: t }});
    check('destino inexistente é recusado (400)', res.status === 400, `${res.status} ${JSON.stringify(res.body)}`);
  }

  console.log('\n── IDOR: João tenta usar as rotas de admin ──────────────────────');
  {
    const a = await r('/admin/sessions', { token: joao.access_token });
    check('João: 403 em /admin/sessions', a.status === 403, `${a.status}`);
    const b = await r('/admin/sessions?include_revoked=1', { token: joao.access_token });
    check('João: 403 mesmo com parâmetro', b.status === 403, `${b.status}`);
    const c = await r('/admin/transfer', { method:'POST', token: joao.access_token, body:{
      credential_id: credId, new_owner_user_id: joao.user.id, pin: PIN, reason: 'joao tentando se dar a chave alheia' }});
    check('João: 403 em /admin/transfer', c.status === 403, `${c.status}`);
  }

  console.log('\n── sessão de outra pessoa pela rota comum ───────────────────────');
  {
    const lista = await r('/admin/sessions', { token: maria.access_token });
    const doPedro = (lista.body?.sessions ?? []).find(s => s.user_email === USERS.pedro.email && !s.revoked_at);
    const res = await r(`/auth/sessions/${doPedro.id}`, { method:'DELETE', token: joao.access_token });
    check('João não derruba a sessão do Pedro (404)', res.status === 404, `${res.status}`);
    const ainda = await r('/credentials', { token: pedro.access_token });
    check('e a sessão do Pedro segue viva', ainda.status === 200, `${ainda.status}`);
  }

  console.log('\n── CORS: origem não autorizada ──────────────────────────────────');
  {
    const res = await r('/admin/sessions', { token: maria.access_token, origin: 'https://site-do-atacante.example' });
    const acao = res.headers.get('access-control-allow-origin');
    check('origem estranha NÃO recebe allow-origin', !acao, `recebeu: ${acao}`);
    const ok = await r('/admin/sessions', { token: maria.access_token, origin: 'chrome-extension://ipapgfacphjdohnonhjkgbcdmojelbjb' });
    check('a extensão autorizada recebe allow-origin', ok.headers.get('access-control-allow-origin') === 'chrome-extension://ipapgfacphjdohnonhjkgbcdmojelbjb');
    check('nunca há Allow-Origin: *', ok.headers.get('access-control-allow-origin') !== '*');
  }

  console.log('\n── payload excessivo e lixo ─────────────────────────────────────');
  {
    const enorme = await r('/admin/transfer', { method:'POST', token: maria.access_token, body:{
      credential_id: credId, new_owner_user_id: joao.user.id, pin: PIN, reason: 'x'.repeat(700_000) }});
    check('corpo gigante é recusado, não derruba a função', [400,413,403,429].includes(enorme.status), `${enorme.status}`);

    const idLixo = await r('/admin/transfer', { method:'POST', token: maria.access_token, body:{
      credential_id: "' or 1=1 --", new_owner_user_id: joao.user.id, pin: PIN,
      reason: 'tentando injecao de sql no identificador da credencial' }});
    check('credential_id com SQL vira erro tratado, nunca 500', idLixo.status !== 500, `${idLixo.status}`);
  }

  console.log('\n── a extensão continua sem receber segredo ──────────────────────');
  {
    const lista = await r('/credentials', { token: joao.access_token });
    check('a listagem NÃO traz segredo nem ciphertext',
      !/"secret"|ciphertext|wrapped_dek|secret_iv/i.test(JSON.stringify(lista.body ?? {})));
    const codigo = await r(`/credentials/${credId}/code`, { token: joao.access_token });
    check('o /code devolve código e NÃO o segredo',
      codigo.status === 200 && codigo.body?.code && !/secret|base32/i.test(JSON.stringify(codigo.body)),
      JSON.stringify(codigo.body));
  }

  process.exit(resumo('REVISÃO OFENSIVA'));
}
main().catch(e => { console.error(e); process.exit(1); });
