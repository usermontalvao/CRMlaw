import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ancoraDoCasamento,
  casamentoDePrazo,
  escolherMelhorCandidato,
  janelaDeVencimento,
  prazoCasaComIntimacao,
  resolverAncora,
  type IntimacaoParaCasar,
  type PrazoCandidato,
} from './deadlineIntimationMatch.ts';

// Caso 1 — o que originou tudo: intimação do TRT23 disponibilizada em 06/08/2026,
// prazo "MANIFESTAÇÃO" cadastrado no mesmo dia pelo módulo de Prazos (portanto
// com intimation_id nulo) e vencendo em 13/08. Os dois lados têm processo.
const INTIMACAO: IntimacaoParaCasar = {
  id: '3c40ca05-7d48-426b-88c2-2e7ab783c602',
  process_id: 'd1e0f821-b86a-4ec4-b869-1f9a5be2c08c',
  client_id: 'd9f91085-5ae6-496b-91a2-3afffe06a0aa',
  data_disponibilizacao: '2026-08-06T00:00:00+00:00',
  estimativaVencimento: '2026-08-11T00:00:00+00:00',
};

const PRAZO: PrazoCandidato = {
  id: '61c0c21e-c6f7-45aa-9c48-cd0eee545dc1',
  process_id: 'd1e0f821-b86a-4ec4-b869-1f9a5be2c08c',
  client_id: 'd9f91085-5ae6-496b-91a2-3afffe06a0aa',
  intimation_id: null,
  status: 'pendente',
  due_date: '2026-08-13T00:00:00+00:00',
};

// Caso 2 — o que a primeira versão da regra ainda deixava passar: a MESMA decisão
// publicada duas vezes (30/07 e 05/08). O prazo "CONTRARRAZÕES" foi cadastrado na
// primeira publicação, e nem ele nem a intimação têm processo — o processo
// 0000280-78.2026.5.23.0006 sequer existe na tabela `processes`. Só o cliente liga
// os dois.
const INTIMACAO_SEM_PROCESSO: IntimacaoParaCasar = {
  id: '54016ea3-1c06-4b90-beb5-0711327743ac',
  process_id: null,
  client_id: '0300b10f-6436-4df9-9c4d-5a6959ffaed8',
  data_disponibilizacao: '2026-08-05T00:00:00+00:00',
  estimativaVencimento: '2026-08-10T00:00:00+00:00',
};

const PRAZO_SO_CLIENTE: PrazoCandidato = {
  id: '278b2e3c-52b7-47e7-a7d0-2803c89991e5',
  process_id: null,
  client_id: '0300b10f-6436-4df9-9c4d-5a6959ffaed8',
  intimation_id: null,
  status: 'pendente',
  due_date: '2026-08-11T00:00:00+00:00',
};

test('o prazo real da intimação é reconhecido mesmo sem intimation_id', () => {
  assert.equal(casamentoDePrazo(PRAZO, INTIMACAO), 'processo');
});

test('prazo cadastrado na publicação anterior da mesma decisão casa pelo cliente', () => {
  assert.equal(casamentoDePrazo(PRAZO_SO_CLIENTE, INTIMACAO_SEM_PROCESSO), 'cliente');
});

test('processo diferente é "não" definitivo, mesmo com o cliente em comum', () => {
  const outroProcesso = { ...PRAZO, process_id: '00000000-0000-0000-0000-000000000001' };
  assert.equal(ancoraDoCasamento(outroProcesso, INTIMACAO), null);
  assert.equal(prazoCasaComIntimacao(outroProcesso, INTIMACAO), false);
});

test('cliente diferente não casa', () => {
  const outroCliente = { ...PRAZO_SO_CLIENTE, client_id: '00000000-0000-0000-0000-000000000002' };
  assert.equal(prazoCasaComIntimacao(outroCliente, INTIMACAO_SEM_PROCESSO), false);
});

test('sem processo e sem cliente dos dois lados não há âncora', () => {
  const solto = { ...PRAZO, process_id: null, client_id: null };
  const orfa = { ...INTIMACAO, process_id: null, client_id: null };
  assert.equal(ancoraDoCasamento(solto, orfa), null);
});

test('prazo já vinculado a outra intimação tem dono e não casa', () => {
  const comDono = { ...PRAZO, intimation_id: 'b1f923e2-46df-48c8-8e60-57a8fd24fcd9' };
  assert.equal(prazoCasaComIntimacao(comDono, INTIMACAO), false);
});

test('o vínculo forte da própria intimação continua casando', () => {
  assert.equal(prazoCasaComIntimacao({ ...PRAZO, intimation_id: INTIMACAO.id }, INTIMACAO), true);
});

test('prazo cancelado não protege ninguém', () => {
  assert.equal(prazoCasaComIntimacao({ ...PRAZO, status: 'cancelado' }, INTIMACAO), false);
});

test('prazo cumprido protege — o trabalho foi feito', () => {
  assert.equal(prazoCasaComIntimacao({ ...PRAZO, status: 'cumprido' }, INTIMACAO), true);
});

test('prazo que vence ANTES de a intimação sair é de outro assunto', () => {
  assert.equal(
    prazoCasaComIntimacao({ ...PRAZO, due_date: '2026-08-05T00:00:00+00:00' }, INTIMACAO),
    false,
  );
});

test('prazo muito além da estimativa da IA não casa', () => {
  // 11/08 + 21 dias de folga = 01/09. 02/09 fica de fora.
  assert.equal(
    prazoCasaComIntimacao({ ...PRAZO, due_date: '2026-09-01T00:00:00+00:00' }, INTIMACAO),
    true,
  );
  assert.equal(
    prazoCasaComIntimacao({ ...PRAZO, due_date: '2026-09-02T00:00:00+00:00' }, INTIMACAO),
    false,
  );
});

test('a data de cadastro não entra na conta — a mesma decisão sai publicada duas vezes', () => {
  // O prazo do caso 2 foi cadastrado em 30/07, seis dias ANTES da intimação de
  // 05/08. A regra antiga descartava por isso; esta reconhece.
  assert.equal(prazoCasaComIntimacao(PRAZO_SO_CLIENTE, INTIMACAO_SEM_PROCESSO), true);
});

test('sem data de disponibilização não há âncora temporal', () => {
  assert.equal(janelaDeVencimento({ ...INTIMACAO, data_disponibilizacao: null }), null);
  assert.equal(prazoCasaComIntimacao(PRAZO, { ...INTIMACAO, data_disponibilizacao: null }), false);
});

test('sem estimativa da IA a janela cai para 90 dias', () => {
  const semEstimativa = { ...INTIMACAO, estimativaVencimento: null };
  assert.equal(
    prazoCasaComIntimacao({ ...PRAZO, due_date: '2026-10-01T00:00:00+00:00' }, semEstimativa),
    true,
  );
  assert.equal(
    prazoCasaComIntimacao({ ...PRAZO, due_date: '2026-11-30T00:00:00+00:00' }, semEstimativa),
    false,
  );
});

test('o casado por processo ganha do casado só por cliente', () => {
  // O de cliente vence exatamente na estimativa; o de processo, dois dias depois.
  // Ainda assim o processo manda, porque a âncora é mais forte que a distância.
  const porCliente = { ...PRAZO, id: 'aaaa', process_id: null, due_date: '2026-08-11T00:00:00+00:00' };
  const porProcesso = { ...PRAZO, id: 'zzzz', due_date: '2026-08-13T00:00:00+00:00' };
  const escolhido = escolherMelhorCandidato([porCliente, porProcesso], INTIMACAO);
  assert.equal(escolhido?.prazo.id, 'zzzz');
  assert.equal(escolhido?.ancora, 'processo');
});

test('entre candidatos da mesma âncora, vence o que cai mais perto da estimativa', () => {
  const longe = { ...PRAZO, id: 'aaaa', due_date: '2026-08-28T00:00:00+00:00' };
  const perto = { ...PRAZO, id: 'zzzz', due_date: '2026-08-13T00:00:00+00:00' };
  assert.equal(escolherMelhorCandidato([longe, perto], INTIMACAO)?.prazo.id, 'zzzz');
});

test('empate de distância resolve pelo id, não pela ordem do banco', () => {
  // 09/08 e 13/08 estão ambos a 2 dias da estimativa (11/08).
  const antes = { ...PRAZO, id: 'bbbb', due_date: '2026-08-09T00:00:00+00:00' };
  const depois = { ...PRAZO, id: 'aaaa', due_date: '2026-08-13T00:00:00+00:00' };
  assert.equal(escolherMelhorCandidato([antes, depois], INTIMACAO)?.prazo.id, 'aaaa');
  assert.equal(escolherMelhorCandidato([depois, antes], INTIMACAO)?.prazo.id, 'aaaa');
});

// Caso 3 — a intimação de 05/08 do mesmo processo chegou SEM processo e SEM
// cliente. Duas irmãs de mesmo número (16/07) estão vinculadas ao cliente.
test('intimação órfã pega a âncora das irmãs de mesmo número de processo', () => {
  const orfa = { numero_processo: '00002807820265230006', process_id: null, client_id: null };
  const irmas = [
    { numero_processo: '00009999999999999999', process_id: null, client_id: 'outro-cliente' },
    { numero_processo: '00002807820265230006', process_id: null, client_id: '0300b10f-6436-4df9-9c4d-5a6959ffaed8' },
  ];
  assert.deepEqual(resolverAncora(orfa, irmas), {
    process_id: null,
    client_id: '0300b10f-6436-4df9-9c4d-5a6959ffaed8',
  });
});

test('o que a intimação já tem manda sobre o que a irmã diz', () => {
  const propria = { numero_processo: 'X', process_id: 'proc-a', client_id: 'cli-a' };
  const irmas = [{ numero_processo: 'X', process_id: 'proc-b', client_id: 'cli-b' }];
  assert.deepEqual(resolverAncora(propria, irmas), { process_id: 'proc-a', client_id: 'cli-a' });
});

test('a irmã completa só o campo que falta', () => {
  const meia = { numero_processo: 'X', process_id: 'proc-a', client_id: null };
  const irmas = [{ numero_processo: 'X', process_id: 'proc-b', client_id: 'cli-b' }];
  assert.deepEqual(resolverAncora(meia, irmas), { process_id: 'proc-a', client_id: 'cli-b' });
});

test('sem número de processo não há irmã para consultar', () => {
  const semNumero = { numero_processo: null, process_id: null, client_id: null };
  const irmas = [{ numero_processo: 'X', process_id: 'proc-b', client_id: 'cli-b' }];
  assert.deepEqual(resolverAncora(semNumero, irmas), { process_id: null, client_id: null });
});

test('nenhuma irmã vinculada: continua órfã, e o Guardião cobra com razão', () => {
  const orfa = { numero_processo: 'X', process_id: null, client_id: null };
  const irmas = [{ numero_processo: 'X', process_id: null, client_id: null }];
  assert.deepEqual(resolverAncora(orfa, irmas), { process_id: null, client_id: null });
});

test('sem candidato válido devolve null', () => {
  assert.equal(escolherMelhorCandidato([{ ...PRAZO, due_date: '2026-12-01T00:00:00+00:00' }], INTIMACAO), null);
});
