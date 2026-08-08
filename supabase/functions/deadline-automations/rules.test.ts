// Cobertura do miolo das automações de prazo: datas, filtro e templates.
// Execução: `npm test` (node:test + ts-node — não há framework no stack).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aplicarTemplate,
  comparar,
  dataFonteProcurada,
  diaDoValor,
  hojeNoEscritorio,
  janelaDeBusca,
  passaNoFiltro,
  selecionarCandidatos,
  somarDias,
  vencimentoDoPrazo,
} from './rules.ts';

// ─── Aritmética de dias ──────────────────────────────────────────────────────

test('somarDias atravessa mês, ano e ano bissexto', () => {
  assert.equal(somarDias('2026-09-20', -10), '2026-09-10');
  assert.equal(somarDias('2026-09-01', -1), '2026-08-31');
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(somarDias('2028-02-28', 1), '2028-02-29'); // bissexto
  assert.equal(somarDias('2026-02-28', 1), '2026-03-01'); // não bissexto
  assert.equal(somarDias('2026-09-20', 0), '2026-09-20');
});

test('somarDias recusa data inválida em vez de devolver lixo', () => {
  assert.throws(() => somarDias('não é data', 1), /data inválida/);
});

// ─── O gatilho ───────────────────────────────────────────────────────────────

test('dataFonteProcurada inverte o offset: -10 no dia 10/09 procura o dia 20/09', () => {
  assert.equal(dataFonteProcurada('2026-09-10', -10), '2026-09-20');
});

test('offset 0 procura a data de hoje, e offset positivo procura no passado', () => {
  assert.equal(dataFonteProcurada('2026-09-20', 0), '2026-09-20');
  // "5 dias depois da perícia" → hoje é 25/09, a perícia foi dia 20/09.
  assert.equal(dataFonteProcurada('2026-09-25', 5), '2026-09-20');
});

// ─── Natureza dos campos: a armadilha do fuso ────────────────────────────────

test('campo de data pura é lido literalmente, sem conversão de fuso', () => {
  // exigency_due_date é gravado como meia-noite UTC. Convertê-lo para Cuiabá
  // (UTC-4) daria 19/09 — um dia antes do que o escritório digitou.
  assert.equal(diaDoValor('2026-09-20T00:00:00.000Z', 'exigency_due_date'), '2026-09-20');
  assert.equal(diaDoValor('2026-09-20 00:00:00+00', 'exigency_due_date'), '2026-09-20');
  assert.equal(diaDoValor('2026-09-20', 'entry_date'), '2026-09-20');
});

test('campo de instante é lido no fuso do escritório', () => {
  // Perícia às 13:00 UTC = 09:00 em Cuiabá, mesmo dia.
  assert.equal(diaDoValor('2026-08-03 13:00:00+00', 'pericia_medica_at'), '2026-08-03');
  // 22:00 UTC = 18:00 em Cuiabá, ainda o mesmo dia.
  assert.equal(diaDoValor('2026-05-16 22:00:00+00', 'pericia_social_at'), '2026-05-16');
});

test('instante depois das 20h de Cuiabá pertence ao dia seguinte em UTC — e o dia certo é o daqui', () => {
  // 01:30 UTC do dia 21 é 21:30 do dia 20 em Cuiabá. Ler como data pura daria
  // 21/09 e a regra dispararia um dia fora.
  assert.equal(diaDoValor('2026-09-21T01:30:00.000Z', 'pericia_medica_at'), '2026-09-20');
});

test('offset curto do Postgres (+00) é aceito, não vira Invalid Date', () => {
  // O PostgREST devolve "+00", que o Date rejeita sem normalização — a linha
  // seria ignorada em silêncio e o prazo nunca sairia.
  assert.equal(diaDoValor('2026-08-03 13:00:00+00', 'pericia_medica_at'), '2026-08-03');
  assert.equal(diaDoValor('2026-08-03 13:00:00-03', 'pericia_medica_at'), '2026-08-03');
  assert.equal(diaDoValor('2026-08-03T13:00:00+00:00', 'pericia_medica_at'), '2026-08-03');
});

test('valor ausente ou ilegível vira null, não uma data errada', () => {
  assert.equal(diaDoValor(null, 'pericia_medica_at'), null);
  assert.equal(diaDoValor('', 'exigency_due_date'), null);
  assert.equal(diaDoValor(undefined, 'entry_date'), null);
  assert.equal(diaDoValor('qualquer coisa', 'pericia_medica_at'), null);
});

// ─── Janela de busca ─────────────────────────────────────────────────────────

test('a janela cobre um dia de folga de cada lado do dia procurado', () => {
  assert.deepEqual(janelaDeBusca('2026-09-20'), {
    de: '2026-09-19T00:00:00Z',
    ate: '2026-09-22T00:00:00Z',
  });
});

// ─── Vencimento ──────────────────────────────────────────────────────────────

test('vencimento sai em meia-noite UTC, a convenção do módulo de prazos', () => {
  assert.equal(vencimentoDoPrazo('2026-09-20', -1), '2026-09-19T00:00:00.000Z');
  assert.equal(vencimentoDoPrazo('2026-09-20', 0), '2026-09-20T00:00:00.000Z');
  assert.equal(vencimentoDoPrazo('2026-09-20', 15), '2026-10-05T00:00:00.000Z');
});

test('gatilho e vencimento são eixos independentes', () => {
  // Perícia 20/09, regra dispara 10 dias antes, prazo vence na véspera.
  const hoje = '2026-09-10';
  const diaFonte = dataFonteProcurada(hoje, -10);
  assert.equal(diaFonte, '2026-09-20');
  assert.equal(vencimentoDoPrazo(diaFonte, -1), '2026-09-19T00:00:00.000Z');
});

// ─── Filtro ──────────────────────────────────────────────────────────────────

test('comparar cobre os operadores do catálogo, sem diferenciar maiúsculas', () => {
  assert.equal(comparar('Em_Analise', 'eq', 'em_analise'), true);
  assert.equal(comparar('deferido', 'neq', 'indeferido'), true);
  assert.equal(comparar('Auxílio-Doença', 'contains', 'doença'), true);
  assert.equal(comparar(null, 'is_null', null), true);
  assert.equal(comparar('', 'is_null', null), true);
  assert.equal(comparar('algo', 'not_null', null), true);
  assert.equal(comparar('deferido', 'in', ['deferido', 'em_analise']), true);
  assert.equal(comparar('arquivado', 'in', ['deferido']), false);
});

test('operador desconhecido reprova em vez de deixar passar', () => {
  // Uma regra com operador inválido não deve criar prazo para o mundo inteiro.
  assert.equal(comparar('qualquer', 'op_que_nao_existe', 'x'), false);
});

test('filtro vazio aceita tudo; all exige todos, any exige um', () => {
  const linha = { id: '1', status: 'em_analise', benefit_type: 'auxilio-doenca' };
  assert.equal(passaNoFiltro(linha, [], 'all'), true);

  const filtros = [
    { field: 'status', op: 'eq', value: 'em_analise' },
    { field: 'benefit_type', op: 'eq', value: 'bpc' },
  ];
  assert.equal(passaNoFiltro(linha, filtros, 'all'), false);
  assert.equal(passaNoFiltro(linha, filtros, 'any'), true);
});

// ─── Seleção dos candidatos ──────────────────────────────────────────────────

test('selecionarCandidatos aplica dia, arquivamento e filtro juntos', () => {
  const linhas = [
    { id: 'a', pericia_medica_at: '2026-09-20T16:00:00.000Z', status: 'em_analise' },
    { id: 'b', pericia_medica_at: '2026-09-21T16:00:00.000Z', status: 'em_analise' }, // outro dia
    { id: 'c', pericia_medica_at: '2026-09-20T16:00:00.000Z', status: 'indeferido' }, // filtro barra
    { id: 'd', pericia_medica_at: '2026-09-20T16:00:00.000Z', status: 'em_analise', archived: true },
    { id: 'e', pericia_medica_at: null, status: 'em_analise' },
  ];

  const escolhidos = selecionarCandidatos(
    linhas,
    'pericia_medica_at',
    '2026-09-20',
    [{ field: 'status', op: 'eq', value: 'em_analise' }],
    'all',
  );

  assert.deepEqual(escolhidos.map((l) => l.id), ['a']);
});

test('requerimento arquivado nunca gera prazo, mesmo sem filtro nenhum', () => {
  const linhas = [
    { id: 'a', entry_date: '2026-09-20', archived: true },
    { id: 'b', entry_date: '2026-09-20', archived: false },
  ];
  const escolhidos = selecionarCandidatos(linhas, 'entry_date', '2026-09-20', [], 'all');
  assert.deepEqual(escolhidos.map((l) => l.id), ['b']);
});

// ─── Templates ───────────────────────────────────────────────────────────────

test('aplicarTemplate substitui as variáveis do catálogo', () => {
  const linha = {
    id: '1',
    beneficiary: 'Maria da Silva',
    protocol: '123456789',
    benefit_type: 'Auxílio-Doença',
  };

  assert.equal(
    aplicarTemplate('Preparar {{cliente}} para {{evento}} em {{data}}', linha, '2026-09-20', 'pericia_medica_at'),
    'Preparar Maria da Silva para perícia médica em 20/09/2026',
  );
  assert.equal(
    aplicarTemplate('{{protocolo}} · {{beneficio}}', linha, '2026-09-20', 'pericia_medica_at'),
    '123456789 · Auxílio-Doença',
  );
});

test('template tolera espaço dentro das chaves e campo vazio na origem', () => {
  const linha = { id: '1', beneficiary: '', protocol: null };
  assert.equal(
    aplicarTemplate('{{ cliente }} / {{protocolo}}', linha, '2026-09-20', 'entry_date'),
    'sem nome / sem protocolo',
  );
});

test('variável desconhecida fica literal, para o admin ver que errou o nome', () => {
  const linha = { id: '1', beneficiary: 'Maria' };
  assert.equal(
    aplicarTemplate('{{cliente}} {{inexistente}}', linha, '2026-09-20', 'entry_date'),
    'Maria {{inexistente}}',
  );
});

// ─── Fuso do escritório ──────────────────────────────────────────────────────

test('hojeNoEscritorio usa Cuiabá, não UTC', () => {
  // 02:00 UTC do dia 21 ainda é dia 20 no escritório (UTC-4). É exatamente o
  // caso que faria o cron da madrugada cadastrar prazo com a data de amanhã.
  assert.equal(hojeNoEscritorio(new Date('2026-09-21T02:00:00.000Z')), '2026-09-20');
  // 09:00 UTC (o horário do cron) é 05:00 em Cuiabá, mesmo dia.
  assert.equal(hojeNoEscritorio(new Date('2026-09-20T09:00:00.000Z')), '2026-09-20');
});
