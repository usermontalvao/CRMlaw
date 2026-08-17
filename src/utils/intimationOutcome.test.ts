import assert from 'node:assert/strict';
import test from 'node:test';
import { detectIntimationOutcome, detectIntimationOutcomeKind } from './intimationOutcome.ts';

const kind = (summary: string) => detectIntimationOutcomeKind(summary);

// ── O caso que originou o módulo ─────────────────────────────────────────────

test('tutela indeferida no processo 1049168-60 nao vira "concedida"', () => {
  const resumo =
    'O juiz NEGOU a tutela de urgência. O serviço Vivo Travel Europa e as cobranças ' +
    'não serão suspensos imediatamente. A inversão do ônus da prova foi deferida em favor da autora.';
  assert.equal(detectIntimationOutcome(resumo)?.label, 'TUTELA NEGADA');
});

test('o deferimento de OUTRO pedido na mesma frase nao contamina a tutela', () => {
  assert.equal(kind('O juiz negou a tutela de urgência e deferiu a inversão do ônus da prova.'), 'tutela_negada');
  assert.equal(kind('Deferida a tutela de urgência; indeferido o pedido de multa diária.'), 'tutela_concedida');
});

// ── Mencionar o instituto nao é decidi-lo ────────────────────────────────────

test('"tutela de urgência" sozinha nao rotula nada', () => {
  assert.equal(kind('A parte pediu tutela de urgência para suspender as cobranças.'), null);
  assert.equal(kind('Audiência de conciliação designada para 12/09/2026 às 14h.'), null);
});

// ── Verbos ───────────────────────────────────────────────────────────────────

test('as formas de indeferimento sao lidas como negativa', () => {
  for (const frase of [
    'Indefiro a tutela de urgência vindicada.',
    'O juiz indeferiu a liminar.',
    'Liminar denegada pelo relator.',
    'Rejeitada a tutela antecipada.',
    'O tribunal revogou a liminar concedida em primeiro grau.',
    'O juiz NÃO concedeu a tutela de urgência.',
  ]) {
    assert.equal(kind(frase), 'tutela_negada', frase);
  }
});

test('as formas de deferimento sao lidas como concessao', () => {
  for (const frase of [
    'O juiz CONCEDEU a tutela de urgência. As cobranças ficam suspensas.',
    'Defiro a tutela de urgência para suspender o serviço.',
    'Liminar deferida para reativar o benefício.',
    'Tutela antecipada acolhida.',
  ]) {
    assert.equal(kind(frase), 'tutela_concedida', frase);
  }
});

test('"indeferida" nao é lida como "deferida"', () => {
  assert.equal(kind('Tutela indeferida.'), 'tutela_negada');
  assert.equal(kind('Liminar denegada.'), 'tutela_negada');
});

// ── Gerúndio: como o DJEN e a IA de fato escrevem ───────────────────────────

test('o gerúndio das decisões é lido como verbo', () => {
  assert.equal(kind('Decisão indeferindo pedido de tutela de urgência, determinando audiência de conciliação.'), 'tutela_negada');
  assert.equal(kind('Decisão concedendo a liminar para restabelecer o serviço.'), 'tutela_concedida');
});

test('condenação no feminino e no gerúndio também conta', () => {
  assert.equal(kind('A parte reclamada foi condenada a depositar FGTS e pagar horas extras.'), 'condenacao');
  assert.equal(kind('Sentença condenando o reclamante ao pagamento de honorários sucumbenciais.'), 'condenacao');
});

// ── Julgamento de mérito ─────────────────────────────────────────────────────

test('parcialmente procedente nao é lido como procedente', () => {
  assert.equal(detectIntimationOutcome('A ação foi julgada PARCIALMENTE PROCEDENTE.')?.label, 'PARCIAL');
  assert.equal(kind('A ação foi julgada procedente em parte.'), 'parcial');
});

test('procedente e improcedente continuam separados', () => {
  assert.equal(kind('A ação foi julgada PROCEDENTE. O réu deve pagar R$ 5.000.'), 'procedente');
  assert.equal(kind('A ação foi julgada IMPROCEDENTE. O autor não recebe nada.'), 'improcedente');
});

test('condenação é o ultimo recurso, sem julgamento nem tutela', () => {
  assert.equal(detectIntimationOutcome('O réu foi condenado a pagar R$ 3.000 por danos morais.')?.label, 'CONDENAÇÃO');
});

test('resumo vazio nao rotula', () => {
  assert.equal(detectIntimationOutcome(''), null);
  assert.equal(detectIntimationOutcome(undefined), null);
  assert.equal(detectIntimationOutcome(null), null);
});
