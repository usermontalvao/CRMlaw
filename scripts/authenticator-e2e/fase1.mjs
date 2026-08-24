import { call, check, login, stepUp, totp, gaParam, gaUri, resumo, USERS } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const SEGREDO = 'JBSWY3DPEHPK3PXP';
const saida = {};

console.log('\n── FLUXO A: login, listagem, código ──────────────────────────────');
const pedro = await login('pedro');
check('login devolve token opaco (não JWT)', pedro.access_token?.length === 64 && !pedro.access_token.startsWith('ey'));
check('login não ecoa a senha', !JSON.stringify(pedro).includes(USERS.pedro.password));
check('listagem responde 200', (await call('/credentials', { token: pedro.access_token })).status === 200);

console.log('\n── FLUXO B: Pedro cadastra; só ele vê ────────────────────────────');
const criada = await call('/credentials', { method: 'POST', token: pedro.access_token,
  body: { name: 'Servidor Producao (teste)', issuer: 'Jurius', account_label: 'root', secret: SEGREDO, algorithm: 'SHA1', digits: 6, period: 30 } });
check('cadastro responde 201', criada.status === 201, JSON.stringify(criada.body));
const credId = criada.body?.credential?.id;
saida.credId = credId;

const listaPedro = await call('/credentials', { token: pedro.access_token });
check('a chave aparece para Pedro', listaPedro.body.credentials.some((c) => c.id === credId));
check('a listagem não carrega segredo', !JSON.stringify(listaPedro.body).includes(SEGREDO));

const joao = await login('joao');
check('a chave NÃO aparece para João', !(await call('/credentials', { token: joao.access_token })).body.credentials.some((c) => c.id === credId));

const cod = await call(`/credentials/${credId}/code`, { token: pedro.access_token });
check('o dono obtém o código', cod.status === 200 && /^\d{6}$/.test(cod.body.code || ''), JSON.stringify(cod.body));
check('a resposta do código não traz o segredo', !JSON.stringify(cod.body).includes(SEGREDO));
check('vem contador regressivo coerente', cod.body.expires_in > 0 && cod.body.expires_in <= 30);
check('o código do servidor bate com o RFC 6238', cod.body.code === totp(SEGREDO, { atSeconds: cod.body.server_time }), `${cod.body.code}`);

console.log('\n── SEGURANÇA: IDOR e escalonamento ───────────────────────────────');
check('João sem ACL: 403 no código', (await call(`/credentials/${credId}/code`, { token: joao.access_token })).status === 403);
check('João sem ACL: 403 no detalhe', (await call(`/credentials/${credId}`, { token: joao.access_token })).status === 403);
check('João sem ACL: 403 na exportação', (await call(`/credentials/${credId}/export`, { method: 'POST', token: joao.access_token, body: { reason: 'tentativa de extracao indevida' } })).status === 403);
check('João sem ACL: 403 nas permissões', (await call(`/credentials/${credId}/permissions`, { token: joao.access_token })).status === 403);
const escalada = await call('/credentials', { method: 'POST', token: joao.access_token, body: { name: 'plantada', secret: SEGREDO, owner_user_id: '00000000-0000-0000-0000-000000000000' } });
check('não-admin não cadastra em nome de outro (403)', escalada.status === 403, JSON.stringify(escalada.body));
check('sem token: 401', (await call('/credentials')).status === 401);
check('token inventado: 401', (await call('/credentials', { token: 'f'.repeat(64) })).status === 401);
check('origem estranha é barrada (403)', (await call('/credentials', { token: pedro.access_token, origin: 'https://atacante.example' })).status === 403);
check('origem do CRM é aceita', (await call('/credentials', { token: pedro.access_token, origin: 'https://jurius.com.br' })).status === 200);

console.log('\n── FLUXO C: compartilhar com João ────────────────────────────────');
const joaoId = (await call('/users/search?q=joao.teste', { token: pedro.access_token })).body.users[0]?.user_id;
check('busca encontra o usuário do CRM', Boolean(joaoId));
saida.joaoId = joaoId;
check('compartilhamento USE aceito', (await call(`/credentials/${credId}/permissions`, { method: 'POST', token: pedro.access_token, body: { user_id: joaoId, permission: 'USE' } })).status === 200);

const codJoao = await call(`/credentials/${credId}/code`, { token: joao.access_token });
check('João COM USE obtém o código', codJoao.status === 200 && /^\d{6}$/.test(codJoao.body.code || ''));
check('e o código dele não traz segredo', !JSON.stringify(codJoao.body).includes(SEGREDO));
check('USE não exporta (403)', (await call(`/credentials/${credId}/export`, { method: 'POST', token: joao.access_token, body: { reason: 'quero o segredo original agora' } })).status === 403);
check('USE não compartilha (403)', (await call(`/credentials/${credId}/permissions`, { method: 'POST', token: joao.access_token, body: { user_id: joaoId, permission: 'EXPORT' } })).status === 403);
check('USE não renomeia (403)', (await call(`/credentials/${credId}`, { method: 'PATCH', token: joao.access_token, body: { name: 'renomeada indevidamente' } })).status === 403);
check('USE não exclui (403)', (await call(`/credentials/${credId}`, { method: 'DELETE', token: joao.access_token })).status === 403);
check('USE não transfere (403)', (await call(`/credentials/${credId}/transfer`, { method: 'POST', token: joao.access_token, body: { new_owner_user_id: joaoId } })).status === 403);

console.log('\n── SEGURANÇA: mass assignment ────────────────────────────────────');
const antes = await call(`/credentials/${credId}`, { token: pedro.access_token });
await call(`/credentials/${credId}`, { method: 'PATCH', token: pedro.access_token,
  body: { name: 'Servidor Producao (teste)', owner_user_id: joaoId, key_version: 99, secret: 'GEZDGNBVGY3TQOJQ', secret_fingerprint: 'x', status: 'active' } });
const depois = await call(`/credentials/${credId}`, { token: pedro.access_token });
check('PATCH não troca o dono', depois.body.credential.owner_user_id === antes.body.credential.owner_user_id);
const cod2 = await call(`/credentials/${credId}/code`, { token: pedro.access_token });
check('PATCH não troca o segredo', cod2.body.code === totp(SEGREDO, { atSeconds: cod2.body.server_time }));

console.log('\n── FLUXO D: revogação imediata ───────────────────────────────────');
check('revogação aceita', (await call(`/credentials/${credId}/permissions/${joaoId}`, { method: 'DELETE', token: pedro.access_token })).status === 200);
check('João perde o código NA HORA (403)', (await call(`/credentials/${credId}/code`, { token: joao.access_token })).status === 403);
check('a chave some da listagem de João', !(await call('/credentials', { token: joao.access_token })).body.credentials.some((c) => c.id === credId));

console.log('\n── FLUXO E: administrador NÃO recebe segredo ─────────────────────');
const maria = await login('maria');
const adminLista = await call('/admin/credentials', { token: maria.access_token });
check('admin lista o cofre (200)', adminLista.status === 200, JSON.stringify(adminLista.body).slice(0, 160));
check('admin vê a chave de Pedro (metadado)', adminLista.body.credentials.some((c) => c.id === credId));
check('a lista administrativa não traz segredo nem ciphertext', !JSON.stringify(adminLista.body).includes(SEGREDO) && !JSON.stringify(adminLista.body).includes('ciphertext'));
check('admin sem ACL: 403 no detalhe', (await call(`/credentials/${credId}`, { token: maria.access_token })).status === 403);
check('admin sem ACL: 403 no código', (await call(`/credentials/${credId}/code`, { token: maria.access_token })).status === 403);
check('admin sem ACL: 403 na exportação', (await call(`/credentials/${credId}/export`, { method: 'POST', token: maria.access_token, body: { reason: 'sou administrador, me entregue' } })).status === 403);
// O caminho mais tentador: em vez de pedir o segredo, o administrador se
// concede EXPORT na chave alheia e depois exporta "legitimamente".
const mariaId = (await call('/users/search?q=maria.teste', { token: maria.access_token })).body.users[0]?.user_id;
check('admin não se autoconcede acesso à chave alheia (403)', (await call(`/credentials/${credId}/permissions`, { method: 'POST', token: maria.access_token, body: { user_id: mariaId, permission: 'EXPORT' } })).status === 403);
check('admin não transfere a propriedade para si (403)', (await call(`/credentials/${credId}/transfer`, { method: 'POST', token: maria.access_token, body: { new_owner_user_id: mariaId } })).status === 403);
check('admin não renomeia chave alheia pelo caminho normal (403)', (await call(`/credentials/${credId}`, { method: 'PATCH', token: maria.access_token, body: { name: 'renomeada pelo admin' } })).status === 403);
check('admin não exclui chave alheia (403)', (await call(`/credentials/${credId}`, { method: 'DELETE', token: maria.access_token })).status === 403);

console.log('\n── FLUXO F: break-glass com PIN + step-up ────────────────────────');
const MOTIVO = 'recuperacao emergencial para migracao do servidor';

// O PIN é o DO SISTEMA (`user_security_pins`), cadastrado por `seed.sql` —
// o cofre não cadastra mais PIN próprio. Ver `pin-do-sistema.mjs`.
const PIN = '918273';

check('o cofre NÃO cadastra PIN: manda cadastrar no perfil (410)',
  (await call('/admin/security/pin', { method: 'POST', token: maria.access_token, body: { new_pin: PIN } })).status === 410);

let step;
const seg = await call('/admin/security', { token: maria.access_token });
check('a API nunca devolve PIN, hash ou salt', seg.body.pin_configured === true && !JSON.stringify(seg.body).match(/pin_hash|pin_salt|918273/));
check('e diz que o PIN vem do sistema', seg.body.pin_origem === 'sistema', seg.body?.pin_origem);
check('motivo curto é recusado', (await call('/admin/recover', { method: 'POST', token: maria.access_token, body: { credential_id: credId, pin: PIN, reason: 'curto' } })).status === 400);

const pinErrado = await call('/admin/recover', { method: 'POST', token: maria.access_token, body: { credential_id: credId, pin: '999119', reason: MOTIVO } });
check('PIN errado: 401', pinErrado.status === 401, JSON.stringify(pinErrado.body));
check('a recusa conta tentativas, não vaza o PIN', /Restam \d+/.test(pinErrado.body.error || ''), pinErrado.body?.error);
check('PIN certo SEM step-up ainda é 401', (await call('/admin/recover', { method: 'POST', token: maria.access_token, body: { credential_id: credId, pin: PIN, reason: MOTIVO } })).status === 401);

step = await stepUp('maria', maria.access_token);
const recuperou = await call('/admin/recover', { method: 'POST', token: maria.access_token, body: { credential_id: credId, pin: PIN, reason: MOTIVO, step_up_token: step } });
check('break-glass completo devolve o segredo', recuperou.status === 200 && recuperou.body.secret === SEGREDO, JSON.stringify(recuperou.body).slice(0, 160));
check('o step-up é de uso único', (await call('/admin/recover', { method: 'POST', token: maria.access_token, body: { credential_id: credId, pin: PIN, reason: MOTIVO, step_up_token: step } })).status === 401);
check('não-admin: 403 antes mesmo do PIN', (await call('/admin/recover', { method: 'POST', token: pedro.access_token, body: { credential_id: credId, pin: PIN, reason: MOTIVO } })).status === 403);
check('não-admin nem chega na rota de PIN (403)', (await call('/admin/security/pin', { method: 'POST', token: joao.access_token, body: { new_pin: '445566' } })).status === 403);
check('não-admin não lê a auditoria (403)', (await call('/admin/audit', { token: joao.access_token })).status === 403);

console.log('\n── FLUXO G: importação ───────────────────────────────────────────');
const uri = gaUri([
  gaParam('JBSWY3DPEHPK3PXP', 'conta1', 'Cloudflare', 1, 1, 2),
  gaParam('GEZDGNBVGY3TQOJQ', 'conta2', 'AWS', 2, 2, 2),
  gaParam('JBSWY3DPEHPK3PXP', 'hotp', 'Velha', 1, 1, 1),
]);
const analise = await call('/import', { method: 'POST', token: pedro.access_token, body: { mode: 'analyze', payload: uri } });
check('análise lista 2 contas', analise.status === 200 && analise.body.items.length === 2, JSON.stringify(analise.body).slice(0, 200));
check('análise NÃO devolve segredo', !JSON.stringify(analise.body).includes('JBSWY3DP'));
check('análise avisa a duplicidade', analise.body.items[0]?.duplicate?.credential_id === credId, JSON.stringify(analise.body.items?.[0]));
check('análise reporta a conta HOTP pulada', analise.body.skipped.length === 1);

const commit = await call('/import', { method: 'POST', token: pedro.access_token, body: { mode: 'commit', payload: uri, selected: [1] } });
check('importação seletiva cria só a escolhida', commit.status === 200 && commit.body.created.length === 1, JSON.stringify(commit.body));
saida.importadaId = commit.body.created?.[0]?.id;
const codImp = await call(`/credentials/${saida.importadaId}/code`, { token: pedro.access_token });
check('a importada gera código SHA256/8 correto', codImp.body.code === totp('GEZDGNBVGY3TQOJQ', { algorithm: 'sha256', digits: 8, atSeconds: codImp.body.server_time }), `${codImp.body.code}`);
check('QR corrompido vira 400', (await call('/import', { method: 'POST', token: pedro.access_token, body: { mode: 'analyze', payload: 'otpauth-migration://offline?data=AAAAAAAAAAAA' } })).status === 400);
check('URI sem segredo válido vira 400', (await call('/import', { method: 'POST', token: pedro.access_token, body: { mode: 'analyze', payload: 'otpauth://totp/x?secret=!!!' } })).status === 400);

const xss = await call('/credentials', { method: 'POST', token: pedro.access_token, body: { name: '<img src=x onerror=alert(1)>', secret: SEGREDO } });
check('nome com HTML entra como texto', xss.status === 201);
saida.xssId = xss.body?.credential?.id;
// A busca com caractere especial é exercitada na fase 3, que também explica o
// 403 do WAF do Cloudflare para payload clássico de SQLi.
check('segredo inválido é recusado (400)', (await call('/credentials', { method: 'POST', token: pedro.access_token, body: { name: 'ruim', secret: 'nao-e-base32!' } })).status === 400);
check('algoritmo não suportado é recusado (400)', (await call('/credentials', { method: 'POST', token: pedro.access_token, body: { name: 'ruim', secret: SEGREDO, algorithm: 'MD5' } })).status === 400);
check('7 dígitos é recusado (400)', (await call('/credentials', { method: 'POST', token: pedro.access_token, body: { name: 'ruim', secret: SEGREDO, digits: 7 } })).status === 400);

console.log('\n── SESSÕES ───────────────────────────────────────────────────────');
const renov = await call('/auth/refresh', { method: 'POST', body: { refresh_token: pedro.refresh_token } });
check('refresh devolve par novo', renov.status === 200 && renov.body.access_token !== pedro.access_token && renov.body.refresh_token !== pedro.refresh_token);
// Reuso IMEDIATO agora é lido como resposta perdida, não como roubo: o
// servidor rotacionou, a resposta não chegou, e o cliente honesto retenta com o
// token que tem em mãos. Derrubar a sessão aqui era o que deslogava o usuário
// sozinho. O reuso FORA da janela continua sendo roubo — quem vigia isso é
// `sessao-persistente.mjs`, que espera a janela fechar.
const retentativa = await call('/auth/refresh', { method: 'POST', body: { refresh_token: pedro.refresh_token } });
check('reuso imediato é aceito como resposta perdida', retentativa.status === 200, `${retentativa.status} ${JSON.stringify(retentativa.body)}`);
check('e a sessão continua viva', (await call('/credentials', { token: retentativa.body.access_token })).status === 200);

const pedro2 = await login('pedro');
const sessoes = await call('/auth/sessions', { token: pedro2.access_token });
check('lista de dispositivos responde', sessoes.status === 200 && Array.isArray(sessoes.body.sessions));
check('a lista não expõe token nem hash', !JSON.stringify(sessoes.body).match(/token_hash|refresh_token/));
check('João não derruba sessão de Pedro (404)', (await call(`/auth/sessions/${pedro2.session_id}`, { method: 'DELETE', token: joao.access_token })).status === 404);
check('logout encerra a própria sessão', (await call('/auth/logout', { method: 'POST', token: pedro2.access_token })).status === 200);
check('depois do logout o token morre (401)', (await call('/credentials', { token: pedro2.access_token })).status === 401);

const pedro3 = await login('pedro');
saida.pedroToken = pedro3.access_token;
saida.mariaToken = maria.access_token;
writeFileSync(new URL('./estado.json', import.meta.url), JSON.stringify(saida, null, 2));

console.log('\n── AUDITORIA ─────────────────────────────────────────────────────');
const audit = await call('/admin/audit?limit=200', { token: maria.access_token });
check('a auditoria responde para o admin', audit.status === 200);
const texto = JSON.stringify(audit.body);
check('nenhum segredo, PIN ou token na auditoria', !texto.includes(SEGREDO) && !texto.includes(PIN) && !texto.includes('GEZDGNBVGY3TQOJQ'));
const tipos = new Set(audit.body.events.map((e) => e.event_type));
for (const t of ['LOGIN', 'LOGOUT', 'CREDENTIAL_CREATED', 'ACCESS_GRANTED', 'ACCESS_REVOKED', 'CODE_ACCESSED', 'EXPORT_REQUESTED', 'ADMIN_RECOVERY_REQUESTED', 'ADMIN_RECOVERY_COMPLETED', 'ADMIN_RECOVERY_FAILED', 'SESSION_REVOKED', 'ACCESS_DENIED']) {
  check(`auditoria registra ${t}`, tipos.has(t));
}
const recovery = audit.body.events.find((e) => e.event_type === 'ADMIN_RECOVERY_COMPLETED');
check('a recuperação guarda quem, de quem e por quê', Boolean(recovery?.actor_user_id && recovery?.target_user_id && recovery?.reason && recovery?.credential_id));
check('a recuperação guarda o IP', recovery?.ip !== undefined);

process.exit(resumo('FASE 1'));
