import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  contarPrazoDaIntimacao,
  dataDePublicacao,
  dataInternaDoPrazo,
  diaDeCalendario,
  ehDiaUtil,
  inicioDaContagem,
  prioridadePorUrgencia,
  somarDiasUteis,
} from './intimationDeadline.ts';

// Feriados forenses de referência nos testes.
const FERIADOS = ['2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15'];

const diaDaSemana = (dia: string) =>
  ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'][new Date(`${dia}T00:00:00Z`).getUTCDay()];

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./intimationDeadline.ts', import.meta.url), 'utf8');
  const espelho = readFileSync(
    new URL('../../supabase/functions/_shared/intimation-deadline.ts', import.meta.url), 'utf8');
  assert.equal(espelho, src,
    'intimation-deadline.ts divergiu de intimationDeadline.ts — copie o arquivo inteiro');
});

// ── O defeito que originou o módulo ──────────────────────────────────────────

test('nenhum vencimento cai em fim de semana (o bug dos 30% em produção)', () => {
  for (let dia = 1; dia <= 28; dia++) {
    const disp = `2026-09-${String(dia).padStart(2, '0')}`;
    for (const prazo of [5, 10, 15, 30]) {
      const conta = contarPrazoDaIntimacao(disp, prazo, FERIADOS)!;
      assert.ok(ehDiaUtil(conta.vencimento, FERIADOS), `${disp} + ${prazo} caiu em ${diaDaSemana(conta.vencimento)}`);
      assert.ok(ehDiaUtil(conta.publicacao, FERIADOS));
      assert.ok(ehDiaUtil(conta.inicio, FERIADOS));
    }
  }
});

test('a conta nao muda com o fuso do computador', () => {
  const original = process.env.TZ;
  const resultados = new Set<string>();
  for (const tz of ['America/Cuiaba', 'UTC', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
    process.env.TZ = tz;
    resultados.add(contarPrazoDaIntimacao('2026-08-17T00:00:00+00', 15, FERIADOS)!.vencimento);
  }
  process.env.TZ = original;
  assert.equal(resultados.size, 1, `variou por fuso: ${[...resultados].join(', ')}`);
});

// ── Regra do CPC ─────────────────────────────────────────────────────────────

test('publicação é o primeiro dia útil DEPOIS da disponibilização (CPC 224, §2º)', () => {
  // 17/08/2026 é segunda-feira.
  assert.equal(dataDePublicacao('2026-08-17'), '2026-08-18');
  // Sexta 21/08 → publica na segunda 24/08.
  assert.equal(dataDePublicacao('2026-08-21'), '2026-08-24');
  // Véspera de feriado: 04/09/2026 é sexta, 07/09 é feriado → publica em 08/09.
  assert.equal(dataDePublicacao('2026-09-04', FERIADOS), '2026-09-08');
});

test('o dia do começo nao se conta (CPC 224, caput)', () => {
  assert.equal(inicioDaContagem('2026-08-17'), '2026-08-19');
});

test('prazo de 15 dias úteis da intimação de 17/08/2026', () => {
  const conta = contarPrazoDaIntimacao('2026-08-17T00:00:00+00', 15, FERIADOS)!;
  assert.deepEqual(conta, { publicacao: '2026-08-18', inicio: '2026-08-19', vencimento: '2026-09-09' });
  assert.equal(diaDaSemana(conta.vencimento), 'qua');
});

test('prazo de 1 dia vence no proprio dia de inicio', () => {
  const conta = contarPrazoDaIntimacao('2026-08-17', 1)!;
  assert.equal(conta.vencimento, conta.inicio);
  assert.equal(conta.vencimento, '2026-08-19');
});

test('feriado no meio empurra o vencimento', () => {
  const sem = contarPrazoDaIntimacao('2026-08-31', 10)!.vencimento;
  const com = contarPrazoDaIntimacao('2026-08-31', 10, FERIADOS)!.vencimento;
  assert.equal(sem, '2026-09-15');
  assert.equal(com, '2026-09-16', 'o feriado de 07/09 tem de adiar um dia útil');
});

// ── Entradas ruins nao inventam prazo ───────────────────────────────────────

test('sem data ou sem numero de dias, nao ha contagem', () => {
  assert.equal(contarPrazoDaIntimacao(null, 15), null);
  assert.equal(contarPrazoDaIntimacao('2026-08-17', null), null);
  assert.equal(contarPrazoDaIntimacao('2026-08-17', 0), null);
  assert.equal(contarPrazoDaIntimacao('data ruim', 15), null);
});

test('diaDeCalendario nao reinterpreta a meia-noite UTC do DJEN', () => {
  assert.equal(diaDeCalendario('2026-08-17 00:00:00+00'), '2026-08-17');
  assert.equal(diaDeCalendario('2026-08-17T00:00:00.000Z'), '2026-08-17');
  assert.equal(diaDeCalendario('2026-08-17'), '2026-08-17');
  assert.equal(diaDeCalendario(null), null);
});

// ── Prioridade e margem interna ─────────────────────────────────────────────

test('a urgência declarada é respeitada; so a ausencia vira alta', () => {
  assert.equal(prioridadePorUrgencia('critica'), 'urgente');
  assert.equal(prioridadePorUrgencia('alta'), 'alta');
  assert.equal(prioridadePorUrgencia('media'), 'media');
  assert.equal(prioridadePorUrgencia('baixa'), 'baixa');
  assert.equal(prioridadePorUrgencia(undefined), 'alta');
});

test('a margem interna cai um dia ÚTIL antes, nunca no sabado', () => {
  // 14/09/2026 é segunda → a margem tem de ser sexta 11/09, não domingo 13/09.
  assert.equal(dataInternaDoPrazo('2026-09-14'), '2026-09-11');
  assert.equal(dataInternaDoPrazo('2026-09-09'), '2026-09-08');
  assert.equal(dataInternaDoPrazo('2026-09-08', FERIADOS), '2026-09-04', 'pula o feriado de 07/09');
  assert.equal(dataInternaDoPrazo(null), '');
});

test('somarDiasUteis nao conta o proprio dia', () => {
  assert.equal(somarDiasUteis('2026-08-19', 0), '2026-08-19');
  assert.equal(somarDiasUteis('2026-08-19', 1), '2026-08-20');
});
