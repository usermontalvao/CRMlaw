import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CollabPeerRegistry,
  TypingBroadcastGate,
  describeCollabStatus,
  describePresence,
  shouldBroadcastTyping,
  shouldShowTypingIndicator,
  TYPING_IDLE_MS,
  TYPING_THROTTLE_MS,
} from './collabPresence.ts';

/**
 * O que estes testes protegem: a tela nunca mais deve dizer que há gente
 * "editando junto"/"digitando" fora de uma sala de co-edição real, e nada de
 * aviso de digitação quando a pessoa está sozinha no documento.
 */

// --------------------------------------------------- aviso de digitação

test('sozinho na sala: o aviso de digitação NÃO é transmitido', () => {
  assert.equal(shouldBroadcastTyping(0), false);

  const gate = new TypingBroadcastGate();
  assert.equal(gate.shouldSend(0), false);
  assert.equal(gate.shouldSend(0, Date.now() + 10_000), false);
});

test('com mais alguém na sala, o primeiro aviso sai na hora', () => {
  const gate = new TypingBroadcastGate();
  assert.equal(gate.shouldSend(1, 1_000), true);
});

test('avisos seguidos são segurados pelo intervalo mínimo', () => {
  const gate = new TypingBroadcastGate();
  assert.equal(gate.shouldSend(1, 1_000), true);
  assert.equal(gate.shouldSend(1, 1_000 + TYPING_THROTTLE_MS - 1), false);
  assert.equal(gate.shouldSend(1, 1_000 + TYPING_THROTTLE_MS + 1), true);
});

test('ficar sozinho e depois voltar a ter companhia reabre o aviso imediatamente', () => {
  const gate = new TypingBroadcastGate();
  assert.equal(gate.shouldSend(1, 1_000), true);
  // A outra pessoa saiu: nada é transmitido e o estado local zera.
  assert.equal(gate.shouldSend(0, 1_100), false);
  // Voltou alguém: o próximo caractere avisa na hora, sem esperar o intervalo.
  assert.equal(gate.shouldSend(1, 1_200), true);
});

// ----------------------------------------------------- lista da sala

test('a lista ignora a própria conexão', () => {
  const registry = new CollabPeerRegistry();
  registry.setSelfConnectionId('eu');

  registry.add({ connectionId: 'eu', currentUser: 'Pedro' });
  assert.equal(registry.count(), 0);

  registry.add({ connectionId: 'ana', currentUser: 'Ana Souza' });
  assert.equal(registry.count(), 1);
});

test('quando o próprio id chega depois, a pessoa sai da lista', () => {
  const registry = new CollabPeerRegistry();
  // `addUser` com a lista de quem já estava pode chegar antes do connectionId.
  registry.add([
    { connectionId: 'eu', currentUser: 'Pedro' },
    { connectionId: 'ana', currentUser: 'Ana Souza' },
  ]);
  assert.equal(registry.count(), 2);

  registry.setSelfConnectionId('eu');
  assert.deepEqual(registry.list().map((peer) => peer.connectionId), ['ana']);
});

test('a lista carrega foto e id do usuário', () => {
  const registry = new CollabPeerRegistry();
  registry.setSelfConnectionId('eu');
  registry.add({
    connectionId: 'ana',
    currentUser: 'Ana Souza',
    userId: 'u-1',
    avatarUrl: 'https://exemplo.test/ana.png',
  });

  const [ana] = registry.list();
  assert.equal(ana.userName, 'Ana Souza');
  assert.equal(ana.userId, 'u-1');
  assert.equal(ana.avatarUrl, 'https://exemplo.test/ana.png');
  assert.equal(ana.typing, false);
});

test('sair da sala remove a pessoa da lista', () => {
  const registry = new CollabPeerRegistry();
  registry.setSelfConnectionId('eu');
  registry.add({ connectionId: 'ana', currentUser: 'Ana Souza' });

  assert.equal(registry.remove('ana'), true);
  assert.equal(registry.count(), 0);
  // Remover duas vezes não quebra nem mente sobre ter mudado algo.
  assert.equal(registry.remove('ana'), false);
});

test('digitando só vale para quem está na sala', () => {
  const registry = new CollabPeerRegistry();
  registry.setSelfConnectionId('eu');

  // Ninguém com esse id: nada muda (nada de peer fantasma "digitando").
  assert.equal(registry.setTyping('fantasma', true), false);
  assert.equal(registry.count(), 0);

  registry.add({ connectionId: 'ana', currentUser: 'Ana Souza' });
  assert.equal(registry.setTyping('ana', true), true);
  assert.equal(registry.list()[0].typing, true);
  registry.clear();
});

test('o aviso de digitação cai sozinho depois do tempo de ociosidade', async () => {
  const registry = new CollabPeerRegistry();
  registry.setSelfConnectionId('eu');
  registry.add({ connectionId: 'ana', currentUser: 'Ana Souza' });

  let expirou = false;
  registry.setTyping('ana', true, () => { expirou = true; });
  assert.equal(registry.list()[0].typing, true);

  await new Promise((resolve) => { setTimeout(resolve, TYPING_IDLE_MS + 120); });

  assert.equal(expirou, true, 'o aviso de "digitando" ficou preso na tela');
  assert.equal(registry.list()[0].typing, false);
  registry.clear();
});

test('atualizar alguém que já está na lista preserva o estado de digitação', () => {
  const registry = new CollabPeerRegistry();
  registry.setSelfConnectionId('eu');
  registry.add({ connectionId: 'ana', currentUser: 'Ana Souza' });
  registry.setTyping('ana', true);

  // Uma operação da Ana chega e reafirma a presença dela.
  registry.add({ connectionId: 'ana', currentUser: 'Ana Souza', avatarUrl: 'https://exemplo.test/a.png' });

  assert.equal(registry.list()[0].typing, true);
  assert.equal(registry.list()[0].avatarUrl, 'https://exemplo.test/a.png');
  registry.clear();
});

// -------------------------------------------------- textos mostrados

test('o indicador de digitação não existe com a sala vazia', () => {
  assert.equal(shouldShowTypingIndicator([]), false);
  assert.equal(shouldShowTypingIndicator([{ typing: false }]), false);
  assert.equal(shouldShowTypingIndicator([{ typing: true }]), true);
});

test('a barra mostra o NOME de quem está digitando', () => {
  assert.equal(
    describePresence([{ userName: 'Ana Paula Souza', typing: true }]),
    'Ana está digitando…',
  );
  assert.equal(
    describePresence([
      { userName: 'Ana Paula Souza', typing: true },
      { userName: 'Carlos Eduardo Lima', typing: true },
    ]),
    'Ana e Carlos estão digitando…',
  );
  assert.equal(
    describePresence([{ userName: 'Ana Paula Souza', typing: false }]),
    'Ana também está neste documento',
  );
  assert.equal(describePresence([]), '');
});

test('o estado da coedição nunca é anunciado como sincronizado quando não está', () => {
  assert.equal(describeCollabStatus('disconnected'), 'Coedição desconectada');
  assert.equal(describeCollabStatus('reconnecting'), 'Coedição reconectando…');
  assert.equal(describeCollabStatus('connected'), 'Coedição ativa');
  assert.equal(describeCollabStatus('off'), '');
});
