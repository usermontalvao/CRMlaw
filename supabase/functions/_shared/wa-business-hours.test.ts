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

// ── Plantão 24 horas ─────────────────────────────────────────────────
// Sete dias ativos, de 00:00 a 24:00. Nenhum instante pode cair fora — nem a
// virada da meia-noite, que é onde uma agenda escrita como 00:00–23:59 abriria
// um buraco de sessenta segundos toda madrugada.

const plantao24h: WaBusinessHourRow[] = [0, 1, 2, 3, 4, 5, 6].map(day_of_week => ({
  day_of_week,
  start_time: '00:00:00',
  end_time: '24:00:00',
  is_active: true,
}));

test('canal 24 horas está aberto em qualquer minuto de qualquer dia', () => {
  for (let dow = 0; dow < 7; dow += 1) {
    for (const curMins of [0, 1, 7 * 60 + 59, 12 * 60, 18 * 60, 23 * 60 + 59]) {
      assert.equal(isWithinBusinessHours(plantao24h, { dow, curMins }), true,
        `fechado em dow=${dow} min=${curMins}`);
    }
  }
});

test('24h aberto porque a agenda diz, não porque a agenda sumiu', () => {
  // A hora 24:00 já foi recusada pelo parser, e a linha inteira caía do filtro:
  // o canal virava "sem agenda", que também dá aberto — pelo motivo errado. Um
  // único dia fechado prova que as linhas estão mesmo sendo lidas.
  const plantaoMenosDomingo = plantao24h.map(r => r.day_of_week === 0 ? { ...r, is_active: false } : r);
  assert.equal(isWithinBusinessHours(plantaoMenosDomingo, { dow: 0, curMins: 3 * 60 }), false);
  assert.equal(isWithinBusinessHours(plantaoMenosDomingo, { dow: 1, curMins: 3 * 60 }), true);
});

test('24:30 não é hora e derruba a linha; 24:00 é', () => {
  const invalida: WaBusinessHourRow[] = [{ day_of_week: 2, start_time: '00:00', end_time: '24:30', is_active: true }];
  // Sem linha legível, a agenda fica vazia → canal sem agenda → aberto.
  assert.equal(isWithinBusinessHours(invalida, { dow: 2, curMins: 3 * 60 }), true);
  assert.equal(isWithinBusinessHours(invalida, { dow: 5, curMins: 3 * 60 }), true);
});

test('jornada da noite até o fim do dia cobre 23:59', () => {
  const noturno: WaBusinessHourRow[] = [{ day_of_week: 6, start_time: '18:00', end_time: '24:00', is_active: true }];
  assert.equal(isWithinBusinessHours(noturno, { dow: 6, curMins: 23 * 60 + 59 }), true);
  assert.equal(isWithinBusinessHours(noturno, { dow: 6, curMins: 17 * 60 + 59 }), false);
});
