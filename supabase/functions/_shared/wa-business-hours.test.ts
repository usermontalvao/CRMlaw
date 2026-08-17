import test from 'node:test';
import assert from 'node:assert/strict';
import { isWithinBusinessHours, localTimeInTz, type WaBusinessHourRow } from './wa-business-hours.ts';

const semanaComercial: WaBusinessHourRow[] = [0, 1, 2, 3, 4, 5, 6].map(day_of_week => ({
  day_of_week,
  start_time: '08:00',
  end_time: '18:00',
  is_active: day_of_week >= 1 && day_of_week <= 5,
}));

test('meio da tarde de quarta está dentro do expediente', () => {
  assert.equal(isWithinBusinessHours(semanaComercial, { dow: 3, curMins: 14 * 60 }), true);
});

test('a abertura conta; o fechamento não', () => {
  assert.equal(isWithinBusinessHours(semanaComercial, { dow: 3, curMins: 8 * 60 }), true);
  assert.equal(isWithinBusinessHours(semanaComercial, { dow: 3, curMins: 18 * 60 }), false);
});

test('madrugada de quarta está fora — é a hora que a despedida não pode sair', () => {
  assert.equal(isWithinBusinessHours(semanaComercial, { dow: 3, curMins: 3 * 60 }), false);
});

test('domingo inteiro fechado, mesmo em horário comercial', () => {
  assert.equal(isWithinBusinessHours(semanaComercial, { dow: 0, curMins: 14 * 60 }), false);
});

test('dia sem linha nenhuma é fechado', () => {
  const soSegunda: WaBusinessHourRow[] = [{ day_of_week: 1, start_time: '08:00', end_time: '18:00', is_active: true }];
  assert.equal(isWithinBusinessHours(soSegunda, { dow: 2, curMins: 10 * 60 }), false);
});

test('canal sem agenda nenhuma conta como aberto', () => {
  assert.equal(isWithinBusinessHours([], { dow: 0, curMins: 3 * 60 }), true);
  assert.equal(isWithinBusinessHours(null, { dow: 0, curMins: 3 * 60 }), true);
});

test('hora com segundos (o formato que o Postgres devolve) é aceita', () => {
  const comSegundos: WaBusinessHourRow[] = [{ day_of_week: 4, start_time: '08:00:00', end_time: '18:00:00', is_active: true }];
  assert.equal(isWithinBusinessHours(comSegundos, { dow: 4, curMins: 9 * 60 }), true);
});

test('janela que atravessa a meia-noite vale dos dois lados', () => {
  const plantao: WaBusinessHourRow[] = [{ day_of_week: 5, start_time: '22:00', end_time: '02:00', is_active: true }];
  assert.equal(isWithinBusinessHours(plantao, { dow: 5, curMins: 23 * 60 }), true);
  assert.equal(isWithinBusinessHours(plantao, { dow: 5, curMins: 1 * 60 }), true);
  assert.equal(isWithinBusinessHours(plantao, { dow: 5, curMins: 12 * 60 }), false);
});

test('fuso inválido não derruba a leitura do relógio', () => {
  const lido = localTimeInTz('Nao/Existe', new Date(Date.UTC(2026, 7, 17, 15, 30)));
  assert.equal(lido.curMins, 15 * 60 + 30);
});

test('o fuso do escritório é lido de verdade (Cuiabá = UTC-4)', () => {
  const lido = localTimeInTz('America/Cuiaba', new Date(Date.UTC(2026, 7, 17, 15, 30)));
  assert.equal(lido.curMins, 11 * 60 + 30);
});
