import test from 'node:test';
import assert from 'node:assert/strict';
import { autoCloseClock, autoCloseLeftLabel, autoCloseIdleLabel } from './autoCloseClock.ts';
import type { AutoCloseConversation, AutoCloseChannel } from './autoCloseClock.ts';

const AGORA = Date.parse('2026-08-17T18:00:00Z');
const min = (n: number) => n * 60_000;
const iso = (offsetMin: number) => new Date(AGORA + min(offsetMin)).toISOString();

const canal: AutoCloseChannel = {
  auto_close_enabled: true,
  auto_close_minutes: 240,
  auto_close_business_hours_only: true,
};

const conversa = (over: Partial<AutoCloseConversation> = {}): AutoCloseConversation => ({
  status: 'open',
  is_blocked: false,
  awaiting_accept: false,
  auto_close_suppressed: false,
  last_message_at: iso(-60),
  last_message_direction: 'out',
  ...over,
});

test('responder reinicia a contagem do zero', () => {
  // O bug relatado: cliente às 10h38, respostas às 14h13 e 14h14, e às 15h a
  // conversa anunciava "encerra em 8min" — contando desde as 10h38. Com o
  // relógio na última mensagem da conversa, às 15h faltam 3h14.
  const c = autoCloseClock(conversa({ last_message_at: iso(-46) }), canal, AGORA);
  assert.equal(c.key, 'counting');
  if (c.key !== 'counting') return;
  assert.equal(Math.round(c.minutesLeft), 194);
  assert.equal(c.label, 'encerra em 3h14');
});

test('cada mensagem nossa empurra o encerramento para a frente', () => {
  const passos = [-202, -47, -46, -10].map(t =>
    autoCloseClock(conversa({ last_message_at: iso(t) }), canal, AGORA));
  const restantes = passos.map(p => (p.key === 'counting' ? Math.round(p.minutesLeft) : -1));
  assert.deepEqual(restantes, [38, 193, 194, 230]);
});

test('cliente falando por último: a inatividade é NOSSA, e nada conta', () => {
  // O caso do Fabiano: parado há quase 7h, mas a última palavra é dele. Quem
  // está inativo é o escritório, e isso não encerra atendimento nenhum.
  const c = autoCloseClock(
    conversa({ last_message_at: iso(-406), last_message_direction: 'in' }),
    canal, AGORA,
  );
  assert.equal(c.key, 'waiting_us');
});

test('aviso automático de fora do horário não passa a bola para o cliente', () => {
  const c = autoCloseClock(
    conversa({ last_message_at: iso(-600), absence_sent_at: iso(-600) }),
    canal, AGORA,
  );
  assert.equal(c.key, 'waiting_us');
});

test('prompt de reabertura também não conta como resposta', () => {
  const c = autoCloseClock(
    conversa({ last_message_at: iso(-600), reopen_prompt_sent_at: iso(-601) }),
    canal, AGORA,
  );
  assert.equal(c.key, 'waiting_us');
});

test('resposta de gente logo depois do aviso automático volta a contar', () => {
  // A marca do aviso continua na conversa; o que decide é a última mensagem
  // estar FORA da janela dela.
  const c = autoCloseClock(
    conversa({ last_message_at: iso(-100), absence_sent_at: iso(-600) }),
    canal, AGORA,
  );
  assert.equal(c.key, 'counting');
});

test('conversa parada além do prazo encerra na próxima varredura', () => {
  const c = autoCloseClock(conversa({ last_message_at: iso(-500) }), canal, AGORA, false);
  assert.equal(c.key, 'due');
  if (c.key !== 'due') return;
  assert.equal(Math.round(c.idleMinutes), 500);
});

test('vencido fora do expediente espera o canal abrir em vez de zerar', () => {
  const c = autoCloseClock(conversa({ last_message_at: iso(-500) }), canal, AGORA, true);
  assert.equal(c.key, 'waiting_hours');
});

test('a última hora é a que fica em âmbar', () => {
  const longe = autoCloseClock(conversa({ last_message_at: iso(-100) }), canal, AGORA);
  const perto = autoCloseClock(conversa({ last_message_at: iso(-200) }), canal, AGORA);
  assert.equal(longe.key === 'counting' && longe.urgent, false);
  assert.equal(perto.key === 'counting' && perto.urgent, true);
});

test('conversa sem mensagem nenhuma não tem inatividade a medir', () => {
  assert.equal(autoCloseClock(conversa({ last_message_at: null }), canal, AGORA).key, 'off');
});

test('canal com a regra desligada não mostra contador nenhum', () => {
  assert.equal(autoCloseClock(conversa(), { ...canal, auto_close_enabled: false }, AGORA).key, 'off');
  assert.equal(autoCloseClock(conversa(), null, AGORA).key, 'off');
});

test('pausa da conversa e estados fora da regra', () => {
  assert.equal(autoCloseClock(conversa({ auto_close_suppressed: true }), canal, AGORA).key, 'suppressed');
  assert.equal(autoCloseClock(conversa({ status: 'closed' }), canal, AGORA).key, 'off');
  assert.equal(autoCloseClock(conversa({ is_blocked: true }), canal, AGORA).key, 'off');
  assert.equal(autoCloseClock(conversa({ awaiting_accept: true }), canal, AGORA).key, 'off');
});

test('os rótulos são legíveis num badge', () => {
  assert.equal(autoCloseLeftLabel(0.4), 'menos de 1 min');
  assert.equal(autoCloseLeftLabel(38), '38min');
  assert.equal(autoCloseLeftLabel(120), '2h');
  assert.equal(autoCloseLeftLabel(135), '2h15');
  assert.equal(autoCloseIdleLabel(45), '45min');
  assert.equal(autoCloseIdleLabel(300), '5h');
  assert.equal(autoCloseIdleLabel(1440), '1 dia');
  assert.equal(autoCloseIdleLabel(4400), '3 dias');
});
