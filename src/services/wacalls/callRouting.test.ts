import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_LABEL,
  availableLadder,
  buildCallLadder,
  decideCallRing,
  missedCallAudience,
  missedCallIsMine,
  CALL_ESCALATION_MS,
} from './callRouting.ts';
import type { CallLadderInput, CallRingInput } from './callRouting.ts';

const escritorio: CallLadderInput = {
  assignedUserId: null,
  conversationDepartment: null,
  channelAssigneeId: null,
  channelDepartments: [],
  adminIds: ['chefe'],
};

const tocando = (extra: Partial<CallRingInput>): CallRingInput => ({
  me: 'ana',
  ladder: buildCallLadder(escritorio),
  contactBlocked: false,
  imBusy: false,
  ...extra,
});

test('a escada desce do responsável ao escritório, nesta ordem', () => {
  const escada = buildCallLadder({
    assignedUserId: 'ana',
    assignedName: 'Ana',
    conversationDepartment: { name: 'Trabalhista', memberIds: ['bruno'] },
    channelAssigneeId: 'carla',
    channelAssigneeName: 'Carla',
    channelDepartments: [{ name: 'Recepção', memberIds: ['davi', 'elis'] }],
    adminIds: ['chefe'],
  });
  assert.deepEqual(
    escada.map(d => d.source),
    ['assigned', 'conversation-department', 'channel', 'channel-department', 'admin', 'everyone'],
  );
});

test('degrau vazio não segura a ligação — setor sem gente nem aparece', () => {
  const escada = buildCallLadder({
    ...escritorio,
    conversationDepartment: { name: 'Setor fantasma', memberIds: [] },
    channelDepartments: [{ name: 'Outro vazio', memberIds: [] }],
  });
  assert.deepEqual(escada.map(d => d.source), ['admin', 'everyone']);
});

test('sem responsável, sem setor e sem canal, a chamada é da administração', () => {
  const r = decideCallRing(tocando({ me: 'chefe' }));
  assert.equal(r.source, 'admin');
  assert.equal(r.ring, true);
  assert.match(r.label, /administração/);
});

test('sem admin cadastrado, a última palavra é tocar para todos', () => {
  const escada = buildCallLadder({ ...escritorio, adminIds: [] });
  const r = decideCallRing(tocando({ me: 'qualquer-um', ladder: escada }));
  assert.equal(r.source, 'everyone');
  assert.equal(r.ring, true);
  assert.match(r.label, /todos/);
});

test('o responsável da conversa ganha do canal e do setor', () => {
  const escada = buildCallLadder({
    assignedUserId: 'ana', assignedName: 'Ana',
    conversationDepartment: { name: 'Trabalhista', memberIds: ['bruno'] },
    channelAssigneeId: 'carla', channelAssigneeName: 'Carla',
    adminIds: ['chefe'],
  });
  const paraAna = decideCallRing(tocando({ me: 'ana', ladder: escada }));
  assert.equal(paraAna.ring, true);
  assert.match(paraAna.label, /responsável por esta conversa/);

  const paraCarla = decideCallRing(tocando({ me: 'carla', ladder: escada }));
  assert.equal(paraCarla.ring, false);
  assert.equal(paraCarla.show, true);
  assert.match(paraCarla.label, /Tocando para Ana/);
});

test('o setor da conversa toca para todos os membros dele', () => {
  const escada = buildCallLadder({
    ...escritorio,
    conversationDepartment: { name: 'Trabalhista', memberIds: ['bruno', 'ana'] },
  });
  for (const eu of ['bruno', 'ana']) {
    const r = decideCallRing(tocando({ me: eu, ladder: escada }));
    assert.equal(r.ring, true, eu);
    assert.equal(r.source, 'conversation-department');
  }
  const deFora = decideCallRing(tocando({ me: 'carla', ladder: escada }));
  assert.equal(deFora.ring, false);
  assert.match(deFora.label, /setor da conversa/);
});

test('quem não está com o CRM aberto não segura o degrau', () => {
  const escada = buildCallLadder({
    assignedUserId: 'ana', assignedName: 'Ana',
    channelAssigneeId: 'carla', channelAssigneeName: 'Carla',
    adminIds: ['chefe'],
  });
  // Ana é a responsável, mas saiu para o fórum: toca já para Carla, sem esperar.
  const r = decideCallRing(tocando({ me: 'carla', ladder: escada, online: ['carla', 'chefe'] }));
  assert.equal(r.ring, true);
  assert.equal(r.source, 'channel');
});

test('presença desconhecida não pula ninguém — na dúvida, toca', () => {
  const escada = buildCallLadder({ assignedUserId: 'ana', assignedName: 'Ana', adminIds: ['chefe'] });
  const r = decideCallRing(tocando({ me: 'ana', ladder: escada, online: null }));
  assert.equal(r.ring, true);
  assert.equal(r.source, 'assigned');
});

test('escritório inteiro offline: a chamada ainda toca para todos', () => {
  const escada = buildCallLadder({ assignedUserId: 'ana', adminIds: ['chefe'] });
  const disponivel = availableLadder(escada, []);
  assert.deepEqual(disponivel.map(d => d.source), ['everyone']);
  const r = decideCallRing(tocando({ me: 'zeca', ladder: escada, online: [] }));
  assert.equal(r.ring, true);
});

test('escalada: a cada passo a chamada desce UM degrau', () => {
  const escada = buildCallLadder({
    assignedUserId: 'ana', assignedName: 'Ana',
    channelAssigneeId: 'carla', channelAssigneeName: 'Carla',
    adminIds: ['chefe'],
  });
  const passos = [0, 1, 2, 3].map(step => decideCallRing(tocando({ me: 'chefe', ladder: escada, step })));
  assert.deepEqual(passos.map(p => p.source), ['assigned', 'channel', 'admin', 'everyone']);
  assert.deepEqual(passos.map(p => p.ring), [false, false, true, true]);
  assert.deepEqual(passos.map(p => p.hasNextStep), [true, true, true, false]);
});

test('escalada além do último degrau não estoura a escada', () => {
  const r = decideCallRing(tocando({ me: 'ana', step: 99 }));
  assert.equal(r.source, 'everyone');
  assert.equal(r.hasNextStep, false);
});

test('quem já está em chamada vê, mas não é interrompido pelo toque', () => {
  const escada = buildCallLadder({ assignedUserId: 'ana', assignedName: 'Ana', adminIds: ['chefe'] });
  for (const caso of [
    tocando({ me: 'ana', ladder: escada, imBusy: true }),
    tocando({ me: 'zeca', ladder: buildCallLadder({ ...escritorio, adminIds: [] }), imBusy: true }),
  ]) {
    const r = decideCallRing(caso);
    assert.equal(r.ring, false);
    assert.equal(r.show, true);
  }
});

test('contato bloqueado não toca nem aparece', () => {
  const r = decideCallRing(tocando({ contactBlocked: true }));
  assert.equal(r.ring, false);
  assert.equal(r.show, false);
});

test('a perdida fica com o primeiro degrau, não com o escritório', () => {
  const escada = buildCallLadder({
    assignedUserId: 'ana', assignedName: 'Ana',
    channelAssigneeId: 'carla', adminIds: ['chefe'],
  });
  const dona = missedCallAudience(escada);
  assert.equal(dona.source, 'assigned');
  assert.equal(missedCallIsMine(dona, 'ana'), true);
  assert.equal(missedCallIsMine(dona, 'carla'), false);
  assert.equal(missedCallIsMine(dona, 'chefe'), false);
});

test('perdida sem dono nenhum é da administração; sem admin, é de todos', () => {
  const comAdmin = missedCallAudience(buildCallLadder(escritorio));
  assert.equal(comAdmin.source, 'admin');
  assert.equal(comAdmin.label, ADMIN_LABEL);
  assert.equal(missedCallIsMine(comAdmin, 'chefe'), true);
  assert.equal(missedCallIsMine(comAdmin, 'ana'), false);

  const semAdmin = missedCallAudience(buildCallLadder({ ...escritorio, adminIds: [] }));
  assert.equal(semAdmin.source, 'everyone');
  assert.equal(missedCallIsMine(semAdmin, 'qualquer-um'), true);
});

test('a perdida não olha presença: quem estava fora precisa saber ao voltar', () => {
  const escada = buildCallLadder({ assignedUserId: 'ana', adminIds: ['chefe'] });
  const dona = missedCallAudience(escada);
  assert.equal(dona.source, 'assigned');
  assert.equal(missedCallIsMine(dona, 'ana'), true);
});

test('a carência de escalada continua sendo de 15 segundos', () => {
  assert.equal(CALL_ESCALATION_MS, 15_000);
});

test('a escalada soma: o responsável continua tocando quando o setor entra', () => {
  const escada = buildCallLadder({
    assignedUserId: 'ana', assignedName: 'Ana',
    channelDepartments: [{ name: 'Recepção', memberIds: ['davi'] }],
    adminIds: ['chefe'],
  });
  const anaNoSegundoPasso = decideCallRing(tocando({ me: 'ana', ladder: escada, step: 1 }));
  assert.equal(anaNoSegundoPasso.ring, true, 'o dono da conversa não pode parar de tocar');
  const daviNoSegundoPasso = decideCallRing(tocando({ me: 'davi', ladder: escada, step: 1 }));
  assert.equal(daviNoSegundoPasso.ring, true);
  const daviNoPrimeiro = decideCallRing(tocando({ me: 'davi', ladder: escada, step: 0 }));
  assert.equal(daviNoPrimeiro.ring, false);
});
