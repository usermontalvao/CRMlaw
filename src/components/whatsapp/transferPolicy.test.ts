import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTransfer, suggestLawyers, isLawyer, buildHandoffNote,
  type TransferStaff, type TransferContext,
} from './transferPolicy.ts';

const NOW = Date.parse('2026-08-04T14:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const person = (patch: Partial<TransferStaff> & Pick<TransferStaff, 'userId'>): TransferStaff => ({
  name: patch.userId,
  isActive: true,
  availability: 'available',
  capacity: 6,
  openLoad: 1,
  departmentIds: ['juridico'],
  channelIds: '*',
  ...patch,
});

const ctx = (patch: Partial<TransferContext> = {}): TransferContext => ({
  conversationId: 'c1',
  channelId: 'canal-a',
  currentAssignee: 'recepcao1',
  currentDepartment: 'recepcao',
  ...patch,
});

const codes = (v: { issues: { code: string }[] }) => v.issues.map(i => i.code);

// ── Quem é advogado ──────────────────────────────────────────────────
test('advogado é reconhecido pelo cargo ou pela OAB', () => {
  assert.equal(isLawyer({ role: 'Advogado' }), true);
  assert.equal(isLawyer({ role: 'Advogada' }), true);
  assert.equal(isLawyer({ role: 'Estagiário', oab: 'MT 12345' }), true);
  assert.equal(isLawyer({ role: 'Recepção', oab: '  ' }), false);
});

// ── Bloqueios ────────────────────────────────────────────────────────
test('transferência sem destino é bloqueada', () => {
  const v = validateTransfer(ctx(), { byUserId: 'recepcao1' }, [], NOW);
  assert.equal(v.ok, false);
  assert.deepEqual(codes(v), ['sem_destino']);
});

test('transferir para quem já é o responsável é bloqueado', () => {
  const v = validateTransfer(
    ctx({ currentAssignee: 'ana' }), { toUserId: 'ana', byUserId: 'bia' }, [person({ userId: 'ana' })], NOW,
  );
  assert.equal(v.ok, false);
  assert.ok(codes(v).includes('ja_responsavel'));
});

test('transferir para si mesmo aponta o caminho certo (Assumir)', () => {
  const v = validateTransfer(
    ctx(), { toUserId: 'bia', byUserId: 'bia' }, [person({ userId: 'bia' })], NOW,
  );
  assert.equal(v.ok, false);
  assert.match(v.blocks[0].message, /Assumir/);
});

test('destino sem acesso ao canal é bloqueado', () => {
  const v = validateTransfer(
    ctx({ channelId: 'canal-a' }),
    { toUserId: 'ana', byUserId: 'recepcao1' },
    [person({ userId: 'ana', channelIds: ['canal-b'] })],
    NOW,
  );
  assert.equal(v.ok, false);
  assert.ok(codes(v).includes('sem_acesso_canal'));
});

test('destino fora do setor escolhido é bloqueado', () => {
  const v = validateTransfer(
    ctx(),
    { toUserId: 'ana', toDepartmentId: 'financeiro', byUserId: 'recepcao1' },
    [person({ userId: 'ana', departmentIds: ['juridico'] })],
    NOW,
  );
  assert.equal(v.ok, false);
  assert.ok(codes(v).includes('fora_do_setor'));
});

test('destino inativo é bloqueado', () => {
  const v = validateTransfer(
    ctx(), { toUserId: 'ana', byUserId: 'recepcao1' }, [person({ userId: 'ana', isActive: false })], NOW,
  );
  assert.equal(v.ok, false);
  assert.ok(codes(v).includes('destino_inativo'));
});

test('contato bloqueado impede encaminhar', () => {
  const v = validateTransfer(
    ctx({ isBlocked: true }), { toUserId: 'ana', byUserId: 'recepcao1' }, [person({ userId: 'ana' })], NOW,
  );
  assert.equal(v.ok, false);
  assert.ok(codes(v).includes('contato_bloqueado'));
});

// ── Avisos (não impedem) ─────────────────────────────────────────────
test('destino ausente e lotado vira aviso, não bloqueio', () => {
  const v = validateTransfer(
    ctx(),
    { toUserId: 'ana', byUserId: 'recepcao1' },
    [person({ userId: 'ana', availability: 'away', capacity: 2, openLoad: 2 })],
    NOW,
  );
  assert.equal(v.ok, true);
  assert.deepEqual(v.warnings.map(w => w.code), ['destino_indisponivel', 'destino_lotado']);
});

test('devolver a conversa a quem acabou de passar adiante avisa ping-pong', () => {
  const v = validateTransfer(
    ctx({
      currentAssignee: 'bia',
      history: [{ fromUserId: 'ana', toUserId: 'bia', toDepartmentId: null, at: minutesAgo(20) }],
    }),
    { toUserId: 'ana', byUserId: 'bia' },
    [person({ userId: 'ana' })],
    NOW,
  );
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some(w => w.code === 'ping_pong'));
});

test('ping-pong antigo (fora da janela) não avisa', () => {
  const v = validateTransfer(
    ctx({
      currentAssignee: 'bia',
      history: [{ fromUserId: 'ana', toUserId: 'bia', toDepartmentId: null, at: minutesAgo(300) }],
    }),
    { toUserId: 'ana', byUserId: 'bia' },
    [person({ userId: 'ana' })],
    NOW,
  );
  assert.equal(v.warnings.some(w => w.code === 'ping_pong'), false);
});

test('conversa rodando entre atendentes avisa excesso de saltos', () => {
  const v = validateTransfer(
    ctx({
      history: [
        { fromUserId: 'a', toUserId: 'b', toDepartmentId: null, at: minutesAgo(600) },
        { fromUserId: 'b', toUserId: 'c', toDepartmentId: null, at: minutesAgo(400) },
        { fromUserId: 'c', toUserId: 'd', toDepartmentId: null, at: minutesAgo(200) },
      ],
    }),
    { toUserId: 'ana', byUserId: 'd' },
    [person({ userId: 'ana' })],
    NOW,
  );
  assert.ok(v.warnings.some(w => w.code === 'excesso_de_saltos'));
});

test('aceite pendente avisa que a transferência anterior será substituída', () => {
  const v = validateTransfer(
    ctx({ awaitingAccept: true }), { toUserId: 'ana', byUserId: 'recepcao1' }, [person({ userId: 'ana' })], NOW,
  );
  assert.ok(v.warnings.some(w => w.code === 'aceite_pendente'));
});

test('transferência só para setor, sem pessoa, é válida', () => {
  const v = validateTransfer(ctx(), { toDepartmentId: 'juridico', byUserId: 'recepcao1' }, [], NOW);
  assert.equal(v.ok, true);
  assert.deepEqual(v.warnings, []);
});

// ── Sugestão de advogado ─────────────────────────────────────────────
const equipe = [
  person({ userId: 'recepcao1', role: 'Recepção', departmentIds: ['recepcao'] }),
  person({ userId: 'dr-pedro', name: 'Dr. Pedro', role: 'Advogado', openLoad: 4 }),
  person({ userId: 'dra-ana', name: 'Dra. Ana', role: 'Advogada', openLoad: 1 }),
  person({ userId: 'dr-caio', name: 'Dr. Caio', oab: 'MT 999', openLoad: 0, availability: 'offline' }),
];

test('só advogados entram na sugestão', () => {
  const s = suggestLawyers(equipe, { channelId: 'canal-a', currentAssignee: 'recepcao1' });
  assert.deepEqual(s.map(x => x.userId).sort(), ['dr-caio', 'dr-pedro', 'dra-ana']);
});

test('menor carga lidera quando não há histórico', () => {
  const s = suggestLawyers(equipe, { channelId: 'canal-a', currentAssignee: 'recepcao1' });
  assert.equal(s[0].userId, 'dra-ana');
});

test('continuidade com o cliente vence a carga menor', () => {
  const s = suggestLawyers(
    equipe,
    { channelId: 'canal-a', currentAssignee: 'recepcao1' },
    { previousAgentIds: ['dr-pedro'] },
  );
  assert.equal(s[0].userId, 'dr-pedro');
  assert.ok(s[0].reasons.includes('já atendeu este cliente'));
});

test('advogado offline continua na lista, mas por último e com ressalva', () => {
  const s = suggestLawyers(equipe, { channelId: 'canal-a', currentAssignee: 'recepcao1' });
  const caio = s.find(x => x.userId === 'dr-caio')!;
  assert.equal(s[s.length - 1].userId, 'dr-caio');
  assert.equal(caio.caution, 'offline agora');
});

test('advogado sem acesso ao canal não é sugerido', () => {
  const s = suggestLawyers(
    [person({ userId: 'dra-ana', role: 'Advogada', channelIds: ['outro-canal'] })],
    { channelId: 'canal-a', currentAssignee: null },
  );
  assert.deepEqual(s, []);
});

test('o responsável atual não é sugerido para receber a própria conversa', () => {
  const s = suggestLawyers(equipe, { channelId: 'canal-a', currentAssignee: 'dra-ana' });
  assert.equal(s.some(x => x.userId === 'dra-ana'), false);
});

test('nota de handoff junta contexto em vez de mandar a conversa pelada', () => {
  const note = buildHandoffNote({
    fromName: 'Carla', clientName: 'Maria Souza', topic: 'Aposentadoria por idade',
    summary: 'Cliente já tem CNIS e quer saber se dá entrada agora.',
    pendingItems: ['enviar CNIS atualizado', 'confirmar carência'],
  });
  assert.match(note, /Cliente: Maria Souza/);
  assert.match(note, /Assunto: Aposentadoria por idade/);
  assert.match(note, /Pendências: enviar CNIS atualizado; confirmar carência/);
  assert.match(note, /Encaminhado por Carla\./);
});
