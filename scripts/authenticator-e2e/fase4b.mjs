// FLUXO H: desligar o usuário no CRM derruba o cofre na chamada seguinte.
import { call, check, login, resumo, USERS } from './lib.mjs';
import { readFileSync } from 'node:fs';
const saida = JSON.parse(readFileSync(new URL('./estado.json', import.meta.url), 'utf8'));

check('a sessão que já estava aberta para de funcionar (401)', (await call('/credentials', { token: saida.pedroAtivo })).status === 401);
check('o código também para (401)', (await call(`/credentials/${saida.credId}/code`, { token: saida.pedroAtivo })).status === 401);
// 401 quando a sessão JÁ foi derrubada pela primeira chamada com conta
// desligada; 403 quando o refresh chega antes disso. Os dois são negativa.
const refresh = await call('/auth/refresh', { method: 'POST', body: { refresh_token: saida.pedroRefresh } });
check('o refresh não ressuscita a sessão', [401, 403].includes(refresh.status), `${refresh.status} ${JSON.stringify(refresh.body)}`);

const relogin = await call('/auth/login', { method: 'POST', body: { email: USERS.pedro.email, password: USERS.pedro.password, device_id: 'dev-pedro-2', device_name: 'tentativa' } });
check('e o login novo é recusado com conta desativada (403)', relogin.status === 403, JSON.stringify(relogin.body));

const maria = await login('maria');
const audit = await call('/admin/audit?event_type=SESSION_REVOKED&limit=20', { token: maria.access_token });
check('a revogação por desativação ficou auditada', audit.body.events.some((e) => e.metadata_safe?.reason === 'user_deactivated'), JSON.stringify(audit.body.events.slice(0, 3)));

const chave = await call('/admin/credentials', { token: maria.access_token });
check('as chaves do desativado continuam no cofre (não somem)', chave.body.credentials.some((c) => c.id === saida.credId));

process.exit(resumo('FLUXO H'));
