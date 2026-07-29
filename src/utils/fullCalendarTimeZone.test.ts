import assert from 'node:assert/strict';
import test from 'node:test';

import { getPartsInTimeZone } from './officeTime.ts';

/**
 * Réplica exata da lógica de `fullCalendarTimeZone.ts`. O arquivo real importa
 * `@fullcalendar/core`, que não roda sob `node --test`; o que precisa de trava
 * é a matemática do fuso, e ela está aqui idêntica.
 *
 * Regressão: a grade passou a mostrar 18:00 numa audiência das 14:00 em Cuiabá
 * porque `timeZone="America/Cuiaba"` sem plugin cai em UTC (14:00-04:00 = 18:00Z).
 */
const offsetMinutesAt = (utcMillis: number, timeZone: string): number => {
  const p = getPartsInTimeZone(new Date(utcMillis), timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asIfUtc - utcMillis) / 60000);
};

const offsetForArray = (a: number[], timeZone: string): number => {
  const asIfUtc = Date.UTC(a[0], a[1] || 0, a[2] || 1, a[3] || 0, a[4] || 0, a[5] || 0, a[6] || 0);
  const firstGuess = offsetMinutesAt(asIfUtc, timeZone);
  return offsetMinutesAt(asIfUtc - firstGuess * 60000, timeZone);
};

const timestampToArray = (ms: number, timeZone: string): number[] => {
  const p = getPartsInTimeZone(new Date(ms), timeZone);
  return [p.year, p.month - 1, p.day, p.hour, p.minute, p.second, ((ms % 1000) + 1000) % 1000];
};

const CUIABA = 'America/Cuiaba';

test('a audiência das 14:00 aparece às 14:00 na grade, e não às 18:00', () => {
  // Registro real: AUDIÊNCIA DE CONCILIAÇÃO - VALMIR, 23/07/2026 14:00 em Cuiabá.
  const instante = Date.parse('2026-07-23T18:00:00Z');
  const [ano, mes, dia, hora, minuto] = timestampToArray(instante, CUIABA);
  assert.deepEqual([ano, mes + 1, dia, hora, minuto], [2026, 7, 23, 14, 0]);
});

test('offset de Cuiabá é -04:00 o ano inteiro (sem horário de verão)', () => {
  assert.equal(offsetForArray([2026, 6, 23, 14, 0, 0, 0], CUIABA), -240);  // julho
  assert.equal(offsetForArray([2026, 10, 14, 0, 0, 0, 0], CUIABA), -240);  // novembro
  assert.equal(offsetForArray([2026, 0, 15, 9, 30, 0, 0], CUIABA), -240);  // janeiro
});

test('hora de parede e instante são inversos um do outro', () => {
  const wall = [2026, 6, 23, 14, 0, 0, 0];
  const offset = offsetForArray(wall, CUIABA);
  const instante = Date.UTC(wall[0], wall[1], wall[2], wall[3], wall[4], wall[5], wall[6])
    - offset * 60000;
  assert.equal(new Date(instante).toISOString(), '2026-07-23T18:00:00.000Z');
  assert.deepEqual(timestampToArray(instante, CUIABA), wall);
});

test('num fuso com horário de verão, a virada é respeitada', () => {
  // Zurique: CEST (+02:00) no verão, CET (+01:00) no inverno.
  assert.equal(offsetForArray([2026, 6, 23, 14, 0, 0, 0], 'Europe/Zurich'), 120);
  assert.equal(offsetForArray([2026, 11, 23, 14, 0, 0, 0], 'Europe/Zurich'), 60);
});

test('milissegundos sobrevivem à ida e volta', () => {
  const instante = Date.parse('2026-07-23T18:00:00Z') + 250;
  assert.equal(timestampToArray(instante, CUIABA)[6], 250);
});
