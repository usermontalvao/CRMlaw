// Fase 3: escada do PIN sem a interferência do rate limit, e o WAF documentado.
import { call, check, login, resumo } from './lib.mjs';
import { readFileSync } from 'node:fs';

const saida = JSON.parse(readFileSync(new URL('./estado.json', import.meta.url), 'utf8'));
const maria = await login('maria');
const pedro = await login('pedro');
const MOTIVO = 'teste da escada de bloqueio do PIN administrativo';

console.log('\n── WAF do Cloudflare (defesa antes da nossa) ─────────────────────');
const waf = await call(`/users/search?q=${encodeURIComponent("' or 1=1--")}`, { token: pedro.access_token });
check('payload de SQLi é barrado ANTES da função (403 do Cloudflare)', waf.status === 403 && waf.body === null, String(waf.status));
for (const termo of ['a,b', 'a.b', 'a(b)', 'a%b', 'a"b', 'a\\b', "o'brien"]) {
  const r = await call(`/users/search?q=${encodeURIComponent(termo)}`, { token: pedro.access_token });
  check(`o que CHEGA na função é tratado: "${termo}" → 200`, r.status === 200 && Array.isArray(r.body?.users), `${r.status}`);
}
check('busca administrativa com vírgula e ponto: 200', (await call('/admin/credentials?q=a%2Cb.c', { token: maria.access_token })).status === 200);

// O bloqueio agora é o DO SISTEMA (`user_security_pins`): 5 tentativas e 15
// minutos travado, contados junto com o resto do CRM. Antes o cofre tinha uma
// escada própria e progressiva — ver `pin-do-sistema.mjs`.
console.log('\n── BLOQUEIO DO PIN (o do sistema) ────────────────────────────────');
const respostas = [];
for (let i = 0; i < 5; i += 1) {
  respostas.push(await call('/admin/recover', { method: 'POST', token: maria.access_token, body: { credential_id: saida.credId, pin: '999119', reason: MOTIVO } }));
}
check('as 4 primeiras erradas são 401 com contagem', respostas.slice(0, 4).every((r) => r.status === 401 && /Restam \d+/.test(r.body.error)), JSON.stringify(respostas.slice(0, 4).map((r) => r.body?.error)));
check('a contagem decresce 4,3,2,1', respostas.slice(0, 4).map((r) => r.body.error.match(/Restam (\d+)/)[1]).join(',') === '4,3,2,1');
check('a 5ª bloqueia (429) e diz por quanto tempo', respostas[4].status === 429 && /\d+ min/.test(respostas[4].body.error), JSON.stringify(respostas[4].body));
check('durante o bloqueio nem o PIN certo passa', (await call('/admin/recover', { method: 'POST', token: maria.access_token, body: { credential_id: saida.credId, pin: '918273', reason: MOTIVO } })).status === 429);

const falhas = await call('/admin/audit?event_type=ADMIN_RECOVERY_FAILED&limit=50', { token: maria.access_token });
check('cada tentativa virou auditoria', falhas.body.events.length >= 6, String(falhas.body.events.length));
check('a auditoria guarda o motivo e nunca o PIN', falhas.body.events[0].reason === MOTIVO && !JSON.stringify(falhas.body).includes('999119'));
const porques = new Set(falhas.body.events.map((e) => e.metadata_safe?.why));
check('a auditoria distingue PIN errado de PIN bloqueado', porques.has('wrong_pin') && porques.has('pin_locked'), [...porques].join(','));

process.exit(resumo('FASE 3'));
