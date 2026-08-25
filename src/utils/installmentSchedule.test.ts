import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonthsToISODate,
  buildInstallmentSchedule,
  formatLocalISODate,
  parseLocalDate,
} from './installmentSchedule.ts';

test('parseLocalDate lê a data como meia-noite local, sem voltar um dia', () => {
  const d = parseLocalDate('2026-08-15');
  assert.ok(d);
  assert.equal(d!.getFullYear(), 2026);
  assert.equal(d!.getMonth(), 7);
  assert.equal(d!.getDate(), 15);
  assert.equal(formatLocalISODate(d!), '2026-08-15');
});

test('addMonthsToISODate mantém o dia do vencimento', () => {
  assert.equal(addMonthsToISODate('2026-08-15', 0), '2026-08-15');
  assert.equal(addMonthsToISODate('2026-08-15', 1), '2026-09-15');
  assert.equal(addMonthsToISODate('2026-08-15', 5), '2027-01-15');
});

test('addMonthsToISODate não transborda para o mês seguinte', () => {
  assert.equal(addMonthsToISODate('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsToISODate('2026-03-31', 1), '2026-04-30');
  assert.equal(addMonthsToISODate('2028-01-31', 1), '2028-02-29');
});

test('parcelamento simples gera um vencimento por mês', () => {
  const schedule = buildInstallmentSchedule({
    paymentType: 'installments',
    totalValue: 8000,
    installmentsCount: 5,
    firstDueDate: '2026-08-25',
  });
  assert.deepEqual(
    schedule.map((i) => i.dueDate),
    ['2026-08-25', '2026-09-25', '2026-10-25', '2026-11-25', '2026-12-25'],
  );
  assert.deepEqual(new Set(schedule.map((i) => i.value)), new Set([1600]));
});

test('à vista gera uma única parcela na data informada', () => {
  const schedule = buildInstallmentSchedule({
    paymentType: 'upfront',
    totalValue: 2621.18,
    installmentsCount: 1,
    firstDueDate: '2026-08-18',
  });
  assert.deepEqual(schedule, [{ number: 1, dueDate: '2026-08-18', value: 2621.18 }]);
});

test('parcela personalizada sem data cai no mês dela, não na data da primeira', () => {
  const schedule = buildInstallmentSchedule({
    paymentType: 'installments',
    totalValue: 8000,
    installmentsCount: 5,
    firstDueDate: '2026-08-25',
    customInstallments: [
      { due_date: '2026-08-25', value: 1600 },
      { due_date: '', value: 1600 },
      { due_date: '2026-10-26', value: 1600 },
      { due_date: null, value: 1600 },
      { due_date: '2026-12-24', value: 1600 },
    ],
  });
  assert.deepEqual(
    schedule.map((i) => i.dueDate),
    ['2026-08-25', '2026-09-25', '2026-10-26', '2026-11-25', '2026-12-24'],
  );
  assert.equal(new Set(schedule.map((i) => i.dueDate)).size, 5);
});

test('cronograma nunca empilha parcelas numa data só', () => {
  const schedule = buildInstallmentSchedule({
    paymentType: 'installments',
    totalValue: 5206.04,
    installmentsCount: 8,
    firstDueDate: '2026-09-10',
    customInstallments: [{}, {}, {}, {}, {}, {}, {}, {}],
  });
  assert.equal(new Set(schedule.map((i) => i.dueDate)).size, 8);
  assert.equal(schedule[7].dueDate, '2027-04-10');
});
