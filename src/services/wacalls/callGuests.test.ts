import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyInviteReason, guestStatusLabel, invitableOperators, inviteExpired,
  inviteExplanation, inviteHeadline, INVITE_TTL_MS,
} from './callGuests.ts';

const equipe = [
  { userId: 'ana', name: 'Ana', busy: false },
  { userId: 'bruno', name: 'Bruno', busy: true },
  { userId: 'carla', name: 'Carla', busy: false },
  { userId: 'davi', name: null, busy: false },
];

test('não se convida a si mesmo, quem está ocupado nem quem já está dentro', () => {
  const lista = invitableOperators({ operators: equipe, me: 'ana', alreadyIn: ['carla'] });
  assert.deepEqual(lista.map(o => o.userId), ['davi']);
});

test('quem tem nome vem antes, e em ordem alfabética', () => {
  const lista = invitableOperators({ operators: equipe, me: 'zeca' });
  assert.deepEqual(lista.map(o => o.userId), ['ana', 'carla', 'davi']);
});

test('a lista vazia sempre diz por quê', () => {
  assert.match(emptyInviteReason({ operators: [{ userId: 'ana', name: 'Ana', busy: false }], me: 'ana' }),
    /Ninguém mais/);
  assert.match(emptyInviteReason({ operators: equipe.map(o => ({ ...o, busy: true })), me: 'ana' }),
    /em ligação/);
  assert.match(
    emptyInviteReason({ operators: equipe.filter(o => !o.busy), me: 'ana', alreadyIn: ['carla', 'davi'] }),
    /já estão nesta ligação/);
});

test('convidar e transferir se apresentam de formas diferentes', () => {
  assert.match(inviteHeadline('assist', 'Ana'), /chamando você/);
  assert.match(inviteHeadline('transfer', 'Ana'), /transferir/);
  assert.match(inviteHeadline('assist', null), /^Um atendente/);
  assert.match(inviteExplanation('transfer'), /assume o atendimento/);
  assert.match(inviteExplanation('assist'), /junto com quem já está/);
});

test('cada estado do convidado tem uma frase própria', () => {
  assert.match(guestStatusLabel('inviting', 'Ana'), /Chamando Ana/);
  assert.match(guestStatusLabel('live', 'Ana'), /está na ligação/);
  assert.match(guestStatusLabel('declined', null), /^O atendente/);
});

test('convite esquecido na tela expira', () => {
  const agora = 1_000_000;
  assert.equal(inviteExpired(agora - INVITE_TTL_MS - 1, agora), true);
  assert.equal(inviteExpired(agora - 5_000, agora), false);
});
