import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decidirAvisoDeTransferencia,
  suprimirAvisoDeTransferencia,
  avisoSuprimido,
  limparSupressoes,
  JANELA_DE_NOVIDADE_MS,
} from './transferNotice.ts';
import type { LinhaDeAtribuicao } from './transferNotice.ts';

const AGORA = Date.parse('2026-08-20T17:00:00Z');
const EU = 'user-eu';
const OUTRO = 'user-colega';
const CONVERSA = 'conv-1';
const iso = (offsetMs: number) => new Date(AGORA + offsetMs).toISOString();

const decidir = (linha: LinhaDeAtribuicao, over: {
  donoAnterior?: string | null;
  suprimido?: boolean;
} = {}) => decidirAvisoDeTransferencia({
  linha,
  conversaId: CONVERSA,
  usuarioId: EU,
  agoraMs: AGORA,
  ...over,
});

test('transferência para mim, esperando aceite, avisa', () => {
  const d = decidir({
    assigned_user_id: EU,
    awaiting_accept: true,
    transfer_pending_since: iso(-5_000),
  });
  assert.equal(d.avisar, true);
  assert.equal(d.aguardandoAceite, true);
  assert.match(d.chave, /^transferencia:conv-1:/);
});

test('a chave é o carimbo: a mesma transferência entregue duas vezes tem a mesma chave', () => {
  const linha: LinhaDeAtribuicao = {
    assigned_user_id: EU,
    awaiting_accept: true,
    transfer_pending_since: iso(-5_000),
  };
  // Segunda entrega já com o cache preenchido — o realtime repete, e a linha
  // pode voltar depois de qualquer outro UPDATE.
  assert.equal(decidir(linha).chave, decidir(linha, { donoAnterior: null }).chave);
});

test('transferência antiga não vira cartão de "acabou de chegar"', () => {
  const d = decidir({
    assigned_user_id: EU,
    awaiting_accept: true,
    transfer_pending_since: iso(-JANELA_DE_NOVIDADE_MS - 1_000),
  });
  assert.equal(d.avisar, false);
});

test('transferência para outra pessoa não me avisa', () => {
  const d = decidir({
    assigned_user_id: OUTRO,
    awaiting_accept: true,
    transfer_pending_since: iso(-1_000),
  });
  assert.equal(d.avisar, false);
});

test('mensagem nova numa conversa que JÁ era minha não vira transferência', () => {
  const d = decidir(
    { assigned_user_id: EU, awaiting_accept: false, updated_at: iso(-500) },
    { donoAnterior: EU },
  );
  assert.equal(d.avisar, false);
});

test('distribuição de fila avisa quando o dono anterior era outro', () => {
  const d = decidir(
    { assigned_user_id: EU, awaiting_accept: false, updated_at: iso(-2_000) },
    { donoAnterior: null },
  );
  assert.equal(d.avisar, true);
  assert.equal(d.aguardandoAceite, false);
  assert.match(d.chave, /^atribuicao:conv-1:/);
});

test('sem o "antes", distribuição de fila fica calada — o palpite erraria para o lado barulhento', () => {
  const d = decidir({ assigned_user_id: EU, awaiting_accept: false, updated_at: iso(-2_000) });
  assert.equal(d.avisar, false);
});

test('relógio do servidor à frente do da máquina continua sendo novidade', () => {
  const d = decidir({
    assigned_user_id: EU,
    awaiting_accept: true,
    transfer_pending_since: iso(3_000),
  });
  assert.equal(d.avisar, true);
});

test('conversa sem responsável não avisa ninguém', () => {
  const d = decidir(
    { assigned_user_id: null, awaiting_accept: true, transfer_pending_since: iso(-1_000) },
    { donoAnterior: EU },
  );
  assert.equal(d.avisar, false);
});

test('as duas linhas de canal do mesmo contato são UM aviso, não dois', () => {
  // Duas linhas, uma por número do escritório, movidas na MESMA transação.
  const linha: LinhaDeAtribuicao = {
    assigned_user_id: EU,
    awaiting_accept: true,
    transfer_pending_since: iso(-1_000),
    attendance_key: 'k:5566999990000',
  };
  const a = decidirAvisoDeTransferencia({ linha, conversaId: 'conv-a', usuarioId: EU, agoraMs: AGORA });
  const b = decidirAvisoDeTransferencia({ linha, conversaId: 'conv-b', usuarioId: EU, agoraMs: AGORA });
  assert.equal(a.avisar, true);
  assert.equal(b.avisar, true);
  // Mesma chave = o dedupe do notificador deixa passar só a primeira.
  assert.equal(a.chave, b.chave);
});

test('ação desta aba é suprimida: o sistema não me conta o que eu acabei de fazer', () => {
  const d = decidir(
    { assigned_user_id: EU, awaiting_accept: true, transfer_pending_since: iso(-1_000) },
    { suprimido: true },
  );
  assert.equal(d.avisar, false);
});

test('a supressão expira sozinha', () => {
  limparSupressoes();
  suprimirAvisoDeTransferencia(CONVERSA, AGORA);
  assert.equal(avisoSuprimido(CONVERSA, AGORA + 1_000), true);
  assert.equal(avisoSuprimido(CONVERSA, AGORA + 60_000), false);
});

test('troca de usuário na mesma aba limpa as supressões', () => {
  suprimirAvisoDeTransferencia(CONVERSA, AGORA);
  limparSupressoes();
  assert.equal(avisoSuprimido(CONVERSA, AGORA + 1_000), false);
});
