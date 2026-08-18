import test from 'node:test';
import assert from 'node:assert/strict';
import { decideCallRing, CALL_ESCALATION_MS } from './callRouting.ts';
import type { CallRingInput } from './callRouting.ts';

const base: CallRingInput = {
  me: 'ana',
  targetUserId: null,
  source: 'everyone',
  contactBlocked: false,
  imBusy: false,
  escalated: false,
};

test('sem responsável, toca para todo mundo', () => {
  const r = decideCallRing(base);
  assert.equal(r.ring, true);
  assert.equal(r.show, true);
  assert.match(r.label, /todos/);
});

test('o responsável da conversa ganha do padrão do canal', () => {
  // A hierarquia é resolvida antes; aqui o que importa é o rótulo dizer qual
  // regra pegou — é o que o operador lê para entender por que está tocando.
  const naConversa = decideCallRing({ ...base, targetUserId: 'ana', source: 'assigned' });
  assert.equal(naConversa.ring, true);
  assert.match(naConversa.label, /responsável por esta conversa/);

  const noCanal = decideCallRing({ ...base, targetUserId: 'ana', source: 'channel' });
  assert.match(noCanal.label, /responsável por este canal/);
});

test('quem não é o dono vê o cartão em silêncio, com o nome de quem deve atender', () => {
  const r = decideCallRing({ ...base, targetUserId: 'bruno', targetName: 'Bruno', source: 'assigned' });
  assert.equal(r.ring, false);
  assert.equal(r.show, true);
  assert.match(r.label, /Tocando para Bruno/);
});

test('escalada: ninguém atendeu, agora toca para todos', () => {
  const r = decideCallRing({
    ...base, targetUserId: 'bruno', targetName: 'Bruno', source: 'channel', escalated: true,
  });
  assert.equal(r.ring, true);
  assert.match(r.label, /liberada para todos/);
});

test('quem já está em chamada vê, mas não é interrompido pelo toque', () => {
  for (const extra of [
    { targetUserId: null, source: 'everyone' as const },
    { targetUserId: 'ana', source: 'assigned' as const },
    { targetUserId: 'bruno', source: 'channel' as const, escalated: true },
  ]) {
    const r = decideCallRing({ ...base, ...extra, imBusy: true });
    assert.equal(r.ring, false, JSON.stringify(extra));
    assert.equal(r.show, true);
  }
});

test('contato bloqueado não toca nem aparece', () => {
  const r = decideCallRing({ ...base, contactBlocked: true, targetUserId: 'ana', source: 'assigned' });
  assert.equal(r.ring, false);
  assert.equal(r.show, false);
});

test('a carência da escalada é curta o bastante para o cliente não desistir', () => {
  assert.ok(CALL_ESCALATION_MS >= 8_000 && CALL_ESCALATION_MS <= 25_000);
});
