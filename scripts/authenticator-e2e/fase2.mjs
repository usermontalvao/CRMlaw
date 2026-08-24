// Fase 2: EXPORT, transferência, arquivamento, escada do PIN e busca corrigida.
import { call, check, login, stepUp, totp, resumo } from './lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const SEGREDO = 'JBSWY3DPEHPK3PXP';
const estadoArq = new URL('./estado.json', import.meta.url);
const saida = JSON.parse(readFileSync(estadoArq, 'utf8'));

const pedro = await login('pedro');
const joao = await login('joao');
const maria = await login('maria');
const { credId, joaoId } = saida;

// Busca com caractere especial e escada do PIN: fase 3.

console.log('\n── PERMISSÃO EXPORT ──────────────────────────────────────────────');
const semStep = await call(`/credentials/${credId}/permissions`, { method: 'POST', token: pedro.access_token, body: { user_id: joaoId, permission: 'EXPORT' } });
check('conceder EXPORT sem step-up é recusado (401)', semStep.status === 401, JSON.stringify(semStep.body));

let stepPedro = await stepUp('pedro', pedro.access_token);
const concedeu = await call(`/credentials/${credId}/permissions`, { method: 'POST', token: pedro.access_token, body: { user_id: joaoId, permission: 'EXPORT', step_up_token: stepPedro } });
check('EXPORT concedido com step-up', concedeu.status === 200, JSON.stringify(concedeu.body));

const semMotivo = await call(`/credentials/${credId}/export`, { method: 'POST', token: joao.access_token, body: { reason: 'curto' } });
check('exportar sem motivo suficiente: 400', semMotivo.status === 400);
const semStepExport = await call(`/credentials/${credId}/export`, { method: 'POST', token: joao.access_token, body: { reason: 'preciso reconfigurar o aplicativo do servidor' } });
check('exportar sem step-up: 401', semStepExport.status === 401);

const stepJoao = await stepUp('joao', joao.access_token);
const exportou = await call(`/credentials/${credId}/export`, { method: 'POST', token: joao.access_token, body: { reason: 'preciso reconfigurar o aplicativo do servidor', step_up_token: stepJoao } });
check('EXPORT com motivo e step-up devolve o segredo', exportou.status === 200 && exportou.body.secret === SEGREDO, JSON.stringify(exportou.body).slice(0, 150));
check('e devolve a URI otpauth completa', String(exportou.body.uri || '').startsWith('otpauth://totp/'));
check('o step-up da exportação também é de uso único', (await call(`/credentials/${credId}/export`, { method: 'POST', token: joao.access_token, body: { reason: 'tentando reusar a confirmacao', step_up_token: stepJoao } })).status === 401);

console.log('\n── ARQUIVAR ──────────────────────────────────────────────────────');
const arquivou = await call(`/credentials/${saida.xssId}`, { method: 'PATCH', token: pedro.access_token, body: { status: 'archived' } });
check('arquivar aceito', arquivou.status === 200);
check('arquivada não gera código (403)', (await call(`/credentials/${saida.xssId}/code`, { token: pedro.access_token })).status === 403);
check('arquivada continua visível no detalhe', (await call(`/credentials/${saida.xssId}`, { token: pedro.access_token })).status === 200);
check('status inválido é recusado (400)', (await call(`/credentials/${saida.xssId}`, { method: 'PATCH', token: pedro.access_token, body: { status: 'deleted' } })).status === 400);

console.log('\n── TRANSFERÊNCIA DE PROPRIEDADE ──────────────────────────────────');
check('transferir sem step-up: 401', (await call(`/credentials/${saida.importadaId}/transfer`, { method: 'POST', token: pedro.access_token, body: { new_owner_user_id: joaoId } })).status === 401);
stepPedro = await stepUp('pedro', pedro.access_token);
const transferiu = await call(`/credentials/${saida.importadaId}/transfer`, { method: 'POST', token: pedro.access_token, body: { new_owner_user_id: joaoId, step_up_token: stepPedro, reason: 'saida do responsavel' } });
check('transferência aceita', transferiu.status === 200, JSON.stringify(transferiu.body));
const detalhe = await call(`/credentials/${saida.importadaId}`, { token: joao.access_token });
check('João virou o dono', detalhe.status === 200 && detalhe.body.credential.is_owner === true);
const pedroDepois = await call(`/credentials/${saida.importadaId}`, { token: pedro.access_token });
check('Pedro não perdeu o acesso (virou MANAGE)', pedroDepois.status === 200 && pedroDepois.body.credential.role === 'MANAGE', JSON.stringify(pedroDepois.body));
const perms = await call(`/credentials/${saida.importadaId}/permissions`, { token: joao.access_token });
check('o novo dono não aparece duplicado na ACL', !perms.body.permissions.some((p) => p.user_id === joaoId));

console.log('\n── EXCLUSÃO (soft-delete) ────────────────────────────────────────');
const criadaTmp = await call('/credentials', { method: 'POST', token: pedro.access_token, body: { name: 'para excluir', secret: SEGREDO } });
const tmpId = criadaTmp.body.credential.id;
check('exclusão aceita', (await call(`/credentials/${tmpId}`, { method: 'DELETE', token: pedro.access_token, body: { reason: 'chave desativada no fornecedor' } })).status === 200);
check('excluída some da listagem', !(await call('/credentials', { token: pedro.access_token })).body.credentials.some((c) => c.id === tmpId));
check('excluída não gera código nem para o dono (403)', (await call(`/credentials/${tmpId}/code`, { token: pedro.access_token })).status === 403);
const adminComExcluidas = await call('/admin/credentials?include_deleted=1', { token: maria.access_token });
check('o admin ainda enxerga a excluída (retenção)', adminComExcluidas.body.credentials.some((c) => c.id === tmpId && c.status === 'deleted'));

saida.tmpId = tmpId;
writeFileSync(estadoArq, JSON.stringify(saida, null, 2));

const auditExport = await call('/admin/audit?event_type=EXPORT_COMPLETED&limit=5', { token: maria.access_token });
check('a exportação ficou auditada', auditExport.body.events.length >= 1 && auditExport.body.events[0].reason?.includes('reconfigurar'));

process.exit(resumo('FASE 2'));
