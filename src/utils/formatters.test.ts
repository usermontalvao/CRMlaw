import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDate, formatDateLong } from './formatters.ts';

// Datas de prazo são gravadas à meia-noite UTC. Formatar com
// `new Date(...).toLocaleDateString()` em Cuiabá (UTC-4) devolvia as 20h do dia
// ANTERIOR — foi assim que um prazo gravado para 2026-08-10 apareceu no card
// como "domingo, 09 de agosto". Prazo não vence em domingo.
const VENCIMENTO_UTC = '2026-08-10T00:00:00+00:00';

test('data de prazo em meia-noite UTC não recua um dia', () => {
  assert.equal(formatDate(VENCIMENTO_UTC), '10/08/2026');
  assert.match(formatDateLong(VENCIMENTO_UTC), /10 de agosto de 2026/);
});

test('o dia da semana bate com a data mostrada', () => {
  // 10/08/2026 é segunda-feira.
  assert.match(formatDateLong(VENCIMENTO_UTC), /^segunda-feira/);
});

test('formato do Postgres (espaço no lugar do T) também não recua', () => {
  assert.equal(formatDate('2026-08-10 00:00:00+00'), '10/08/2026');
});

test('data pura, sem hora, é lida como está', () => {
  assert.equal(formatDate('2026-08-13'), '13/08/2026');
  assert.match(formatDateLong('2026-08-13'), /13 de agosto de 2026/);
});

test('nulo vira travessão, não "Invalid Date"', () => {
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate(undefined), '—');
  assert.equal(formatDate(''), '—');
});
