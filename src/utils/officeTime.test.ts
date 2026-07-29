import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addMinutesToWallTime,
  formatOfficeDateTime,
  formatOfficeTime,
  getOfficeTimeZone,
  hasExplicitOffset,
  isOfficeMidnight,
  toOfficeDateKey,
  toOfficeTimestamp,
} from './officeTime.ts';

// O ponto do módulo é justamente não depender do relógio da máquina: estes
// testes valem rodando em Cuiabá, em Bern ou no CI em UTC.

test('o fuso-âncora padrão é o do escritório', () => {
  assert.equal(getOfficeTimeZone(), 'America/Cuiaba');
});

test('a hora digitada é ancorada em Cuiabá, não no relógio de quem digita', () => {
  assert.equal(toOfficeTimestamp('2026-07-29T14:00'), '2026-07-29T14:00:00-04:00');
  assert.equal(toOfficeTimestamp('2026-07-29T14:00:00'), '2026-07-29T14:00:00-04:00');
});

test('evento de dia inteiro fica na meia-noite de Cuiabá — não pula de dia', () => {
  const anchored = toOfficeTimestamp('2026-07-28T00:00:00');
  assert.equal(anchored, '2026-07-28T00:00:00-04:00');
  // O bug antigo gravava 22:00Z (meia-noite de Bern), que em Cuiabá é dia 27.
  assert.equal(new Date(anchored).toISOString(), '2026-07-28T04:00:00.000Z');
  assert.equal(toOfficeDateKey(anchored), '2026-07-28');
});

test('Cuiabá não tem horário de verão: novembro usa o mesmo -04:00', () => {
  // A Parcela 4 do acordo caiu em 23:00Z porque o offset foi tirado do
  // navegador na data do evento (Bern em CET). Ancorado, novembro é -04:00.
  assert.equal(toOfficeTimestamp('2026-11-14T00:00:00'), '2026-11-14T00:00:00-04:00');
});

test('string que já traz fuso explícito é preservada', () => {
  assert.equal(hasExplicitOffset('2026-07-29T14:00:00-04:00'), true);
  assert.equal(hasExplicitOffset('2026-07-29T17:00:00Z'), true);
  assert.equal(hasExplicitOffset('2026-07-29T14:00:00'), false);
  assert.equal(toOfficeTimestamp('2026-07-29T17:00:00Z'), '2026-07-29T17:00:00Z');
  assert.equal(toOfficeTimestamp('2026-07-29T14:00:00-04:00'), '2026-07-29T14:00:00-04:00');
});

test('data sem hora vira meia-noite do escritório', () => {
  assert.equal(toOfficeTimestamp('2026-07-29'), '2026-07-29T00:00:00-04:00');
});

test('end_at é derivado da hora de parede, sem passar pelo navegador', () => {
  assert.equal(addMinutesToWallTime('2026-07-29T14:00', 120), '2026-07-29T16:00:00');
  assert.equal(addMinutesToWallTime('2026-07-29T23:30', 60), '2026-07-30T00:30:00');
  assert.equal(
    toOfficeTimestamp(addMinutesToWallTime('2026-07-29T14:00', 180)),
    '2026-07-29T17:00:00-04:00',
  );
});

test('exibição traduz o instante gravado para o fuso do escritório', () => {
  // Audiência real do banco: 2026-08-25 19:40Z = 15:40 em Cuiabá.
  assert.equal(formatOfficeTime('2026-08-25T19:40:00Z'), '15:40');
  assert.equal(formatOfficeDateTime('2026-08-25T19:40:00Z'), '25/08/2026 às 15:40');
  // Prazo gravado antes da correção, com meia-noite de Bern (22:00Z).
  assert.equal(formatOfficeDateTime('2026-09-02T22:00:00Z'), '02/09/2026 às 18:00');
});

test('dia inteiro é detectado no fuso do escritório', () => {
  assert.equal(isOfficeMidnight('2026-07-28T04:00:00Z'), true);   // 00:00 em Cuiabá
  assert.equal(isOfficeMidnight('2026-07-27T22:00:00Z'), false);  // 18:00 em Cuiabá
  assert.equal(isOfficeMidnight('2026-08-25T19:40:00Z'), false);
});

test('valores vazios ou inválidos não explodem', () => {
  assert.equal(toOfficeTimestamp(''), '');
  assert.equal(formatOfficeDateTime(null), '');
  assert.equal(formatOfficeDateTime('nada disso'), '');
  assert.equal(toOfficeDateKey(undefined), '');
});
