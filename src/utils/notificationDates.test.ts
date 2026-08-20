import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareNotificationDates,
  formatNotificationDate,
  getCalendarDayDifference,
  parseNotificationDate,
} from './notificationDates.ts';

const NOW = new Date(2026, 7, 20, 14, 30);

test('compromisso futuro nunca é descrito com dias negativos atrás', () => {
  assert.equal(getCalendarDayDifference('2027-07-09T00:00:00', NOW), 323);
  assert.equal(formatNotificationDate('2026-08-23T00:00:00', NOW), 'Em 3d');
  assert.equal(formatNotificationDate('2026-08-21T00:00:00', NOW), 'Amanhã');
  assert.equal(formatNotificationDate('2027-07-09T00:00:00', NOW), '09 de jul. de 2027');
});

test('datas passadas mantêm os rótulos relativos corretos', () => {
  assert.equal(formatNotificationDate('2026-08-20T08:00:00', NOW), 'Hoje');
  assert.equal(formatNotificationDate('2026-08-19T23:00:00', NOW), 'Ontem');
  assert.equal(formatNotificationDate('2026-08-17T09:00:00', NOW), '3d atrás');
});

test('data sem horário é interpretada no calendário local', () => {
  const parsed = parseNotificationDate('2027-07-09');
  assert.equal(parsed.getFullYear(), 2027);
  assert.equal(parsed.getMonth(), 6);
  assert.equal(parsed.getDate(), 9);
  assert.equal(parsed.getHours(), 0);
});

test('compromissos futuros são ordenados do mais próximo para o mais distante', () => {
  const dates = [
    '2027-07-09T00:00:00',
    '2026-09-09T00:00:00',
    '2027-02-09T00:00:00',
  ];

  assert.deepEqual([...dates].sort((a, b) => compareNotificationDates(a, b, NOW)), [
    '2026-09-09T00:00:00',
    '2027-02-09T00:00:00',
    '2027-07-09T00:00:00',
  ]);
});

test('notificações de hoje já ocorridas continuam da mais recente para a mais antiga', () => {
  const dates = ['2026-08-20T08:00:00', '2026-08-20T14:00:00', '2026-08-20T10:00:00'];

  assert.deepEqual([...dates].sort((a, b) => compareNotificationDates(a, b, NOW)), [
    '2026-08-20T14:00:00',
    '2026-08-20T10:00:00',
    '2026-08-20T08:00:00',
  ]);
});
