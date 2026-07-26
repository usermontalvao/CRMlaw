import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideCollabSave,
  describeOtherEditors,
} from './collabSaveScope.ts';

/**
 * A regra que impede o sintoma "cada um salva só o que ele mesmo escreveu":
 * com sala, quem grava é o servidor (vale para todos); sem sala e com gente
 * no arquivo, subir a cópia local apagaria o texto do outro — então recusa.
 */

test('com sala, a gravação é do grupo (servidor aplica tudo o que está pendente)', () => {
  assert.deepEqual(
    decideCollabSave({
      collabEnabled: true,
      inRoom: true,
      savingActiveOrigin: true,
      otherEditors: ['Ana Souza'],
    }),
    { kind: 'room-flush' },
  );

  // Vale mesmo sozinho na sala: a sala continua sendo o caminho de gravação.
  assert.deepEqual(
    decideCollabSave({
      collabEnabled: true,
      inRoom: true,
      savingActiveOrigin: true,
      otherEditors: [],
    }),
    { kind: 'room-flush' },
  );
});

test('sem sala e com outra pessoa no arquivo: recusa em vez de apagar o texto dela', () => {
  const decision = decideCollabSave({
    collabEnabled: true,
    inRoom: false,
    savingActiveOrigin: true,
    otherEditors: ['Ana Souza', 'João Lima'],
  });

  assert.equal(decision.kind, 'blocked-others-editing');
  assert.deepEqual(
    decision.kind === 'blocked-others-editing' ? decision.peerNames : [],
    ['Ana Souza', 'João Lima'],
  );
});

test('sozinho no arquivo grava normalmente, com ou sem serviço de co-edição', () => {
  assert.deepEqual(
    decideCollabSave({
      collabEnabled: true,
      inRoom: false,
      savingActiveOrigin: true,
      otherEditors: [],
    }),
    { kind: 'direct-upload' },
  );

  // Ambiente sem co-edição: comportamento antigo preservado — não dá para
  // travar o salvamento de quem nunca teve sala.
  assert.deepEqual(
    decideCollabSave({
      collabEnabled: false,
      inRoom: false,
      savingActiveOrigin: true,
      otherEditors: ['Ana Souza'],
    }),
    { kind: 'direct-upload' },
  );
});

test('"Salvar uma cópia" nunca é bloqueado: o destino é outro arquivo', () => {
  assert.deepEqual(
    decideCollabSave({
      collabEnabled: true,
      inRoom: false,
      savingActiveOrigin: false,
      otherEditors: ['Ana Souza'],
    }),
    { kind: 'direct-upload' },
  );
});

test('nomes vazios não viram uma recusa fantasma', () => {
  assert.deepEqual(
    decideCollabSave({
      collabEnabled: true,
      inRoom: false,
      savingActiveOrigin: true,
      otherEditors: ['   ', ''],
    }),
    { kind: 'direct-upload' },
  );
});

test('a mensagem cita as pessoas pelo primeiro nome', () => {
  assert.equal(describeOtherEditors(['Ana Souza']), 'Ana');
  assert.equal(describeOtherEditors(['Ana Souza', 'João Lima']), 'Ana e João');
  assert.equal(
    describeOtherEditors(['Ana Souza', 'João Lima', 'Carla Dias', 'Rui Melo']),
    'Ana, João e mais 2',
  );
  assert.equal(describeOtherEditors([]), 'Outra pessoa');
});
