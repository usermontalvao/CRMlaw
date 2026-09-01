/**
 * O TELEFONE DO AVISO DE PRAZO SAI COM O 55 — a rede que faltava.
 *
 * Em 30/08/2026 descobriu-se que o aviso de prazo por WhatsApp NUNCA tinha
 * chegado a ninguém: zero linhas de `deadline_whatsapp_notice` em
 * `user_notifications` desde que o recurso existe. A véspera tinha consertado a
 * trava de fim de semana, e o conserto funcionou — no domingo seguinte o
 * `notification-scheduler` tentou de hora em hora, 38 vezes, e as 38 morreram
 * no mesmo lugar:
 *
 *   ❌ WhatsApp deadline_overdue: O número 65984173292 não possui WhatsApp ativo.
 *
 * O número tem WhatsApp. O que faltava era o país. `carregarPerfisDoAviso`
 * tirava só a pontuação de `profiles.phone` — que o escritório guarda como o
 * brasileiro escreve, "(65) 98417-3292" — e entregava onze dígitos ao
 * `evolution-send`, que também só tira pontuação. O `/chat/whatsappNumbers` da
 * Evolution respondia `exists:false` e o envio virava 422.
 *
 * Nada pegou isso por três razões que continuam valendo:
 *
 *   - `tsc --noEmit` tem `rootDir: src/` e não olha `supabase/functions`
 *     (memória tsc-nao-cobre-edge-functions);
 *   - `telefoneInternacional` já existia, já era testada e já estava certa — o
 *     defeito era não chamá-la, e teste de módulo puro não vê quem não chama;
 *   - o envio é fail-soft de propósito: um `console.error`, a execução segue,
 *     push e e-mail do mesmo prazo já saíram, e a função devolve sucesso.
 *
 * Este teste é a única rede possível sem subir a função: lê o código do
 * scheduler e confere que o telefone entregue ao `evolution-send` passou por
 * `telefoneInternacional`. Não prova que a mensagem chega — prova que ela sai
 * com o número no formato que a Evolution reconhece, que é onde ela morria.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCHEDULER = fileURLToPath(
  new URL('../notification-scheduler/index.ts', import.meta.url),
);

test('o scheduler importa telefoneInternacional da régua compartilhada', () => {
  const fonte = readFileSync(SCHEDULER, 'utf8');
  assert.match(
    fonte,
    /import\s*\{[^}]*\btelefoneInternacional\b[^}]*\}\s*from\s*["']\.\.\/_shared\/notificacao-whatsapp\.ts["']/s,
    'o telefone do aviso precisa vir da régua compartilhada, não de uma normalização local',
  );
});

test('o telefone do perfil é normalizado com telefoneInternacional', () => {
  const fonte = readFileSync(SCHEDULER, 'utf8');
  const corpo = fonte.slice(fonte.indexOf('async function carregarPerfisDoAviso'));
  assert.ok(corpo, 'carregarPerfisDoAviso sumiu — este teste precisa ser reescrito');
  const ateOFim = corpo.slice(0, corpo.indexOf('\n}\n'));

  assert.match(
    ateOFim,
    /const\s+telefone\s*=\s*telefoneInternacional\(/,
    'o telefone do perfil tem de sair de telefoneInternacional: sem o 55 a Evolution ' +
      'responde exists:false e o aviso de prazo morre em 422',
  );
  assert.doesNotMatch(
    ateOFim,
    /const\s+telefone\s*=\s*String\([^)]*\)\.replace\(/,
    'tirar só a pontuação devolve onze dígitos sem país — foi exatamente o defeito de 30/08/2026',
  );
});

test('o envio manda o telefone do perfil, e não um número montado na hora', () => {
  const fonte = readFileSync(SCHEDULER, 'utf8');
  // O único `phone:` do arquivo é o do corpo enviado ao `evolution-send`. Se
  // aparecer outro, este teste tem de crescer junto — melhor falhar aqui do que
  // deixar um segundo caminho de envio sem normalização.
  const envios = fonte.match(/^\s*phone:\s*(.+),\s*$/gm) ?? [];
  assert.equal(envios.length, 1, `esperava um único destino de envio, achei ${envios.length}`);
  assert.match(
    envios[0],
    /phone:\s*perfil\.telefone,/,
    'o envio tem de usar o telefone já normalizado do perfil',
  );
});
