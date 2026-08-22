import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessMinutesBetween, isWithinBusinessHours, nextBusinessOpening,
  addBusinessMinutes, scheduleFromRows, elapsedMinutesFor, elapsedMinutesForChannels,
  businessHoursStatus, formatMinuteOfDay, alwaysOpenRows, isAlwaysOpen,
  DEFAULT_BUSINESS_SCHEDULE,
  type BusinessSchedule,
} from './businessTime.ts';

// Cuiabá é UTC-4: 8h local = 12:00Z, 18h local = 22:00Z.
const office = (isoLocal: string) => Date.parse(`${isoLocal}-04:00`);

// 04/08/2026 é uma TERÇA-feira.
const TER_10H = office('2026-08-04T10:00:00');
const TER_17H50 = office('2026-08-04T17:50:00');
const SEX_18H05 = office('2026-08-07T18:05:00');
const SEG_08H00 = office('2026-08-10T08:00:00');
const SAB_10H = office('2026-08-08T10:00:00');

// ── Dentro do expediente ─────────────────────────────────────────────
test('terça às 10h está dentro do expediente', () => {
  assert.equal(isWithinBusinessHours(TER_10H), true);
});

test('sábado e madrugada estão fora', () => {
  assert.equal(isWithinBusinessHours(SAB_10H), false);
  assert.equal(isWithinBusinessHours(office('2026-08-04T03:00:00')), false);
});

test('o limite de fechamento é exclusivo (18h já está fechado)', () => {
  assert.equal(isWithinBusinessHours(office('2026-08-04T17:59:00')), true);
  assert.equal(isWithinBusinessHours(office('2026-08-04T18:00:00')), false);
});

// ── O caso que motivou o módulo ──────────────────────────────────────
test('mensagem de sexta 18h05 respondida segunda 8h NÃO é fim de semana inteiro parado', () => {
  const relogio = (SEG_08H00 - SEX_18H05) / 60_000;
  const util = businessMinutesBetween(SEX_18H05, SEG_08H00);
  assert.equal(Math.round(relogio), 3715);   // ~62h no relógio de parede
  assert.equal(util, 0);                     // o escritório esteve fechado o tempo todo
});

test('espera dentro do mesmo dia conta normalmente', () => {
  assert.equal(businessMinutesBetween(TER_10H, office('2026-08-04T11:30:00')), 90);
});

test('espera que atravessa a noite conta só o expediente dos dois dias', () => {
  // 17h30 de terça → 9h de quarta: 30min + 60min = 90min úteis (não 15h30).
  const util = businessMinutesBetween(office('2026-08-04T17:30:00'), office('2026-08-05T09:00:00'));
  assert.equal(util, 90);
});

test('um dia útil cheio são 10 horas', () => {
  assert.equal(businessMinutesBetween(office('2026-08-04T08:00:00'), office('2026-08-04T18:00:00')), 600);
});

test('a semana inteira soma só os cinco dias úteis', () => {
  // Segunda 00h → segunda seguinte 00h = 5 dias × 10h.
  const util = businessMinutesBetween(office('2026-08-03T00:00:00'), office('2026-08-10T00:00:00'));
  assert.equal(util, 5 * 600);
});

test('intervalo invertido ou nulo devolve zero', () => {
  assert.equal(businessMinutesBetween(TER_10H, TER_10H), 0);
  assert.equal(businessMinutesBetween(office('2026-08-04T11:00:00'), TER_10H), 0);
});

test('trecho inteiramente fora do expediente devolve zero', () => {
  assert.equal(businessMinutesBetween(office('2026-08-04T19:00:00'), office('2026-08-04T23:00:00')), 0);
});

// ── Feriado ──────────────────────────────────────────────────────────
test('feriado fecha o dia inteiro', () => {
  const comFeriado: BusinessSchedule = { ...DEFAULT_BUSINESS_SCHEDULE, holidays: ['2026-08-05'] };
  // Terça 17h → quinta 9h: sem feriado seriam 60 + 600... com quarta fechada,
  // sobram 60min de terça + 60min de quinta.
  const util = businessMinutesBetween(office('2026-08-04T17:00:00'), office('2026-08-06T09:00:00'), comFeriado);
  assert.equal(util, 120);
});

test('feriado não atrapalha quem nem passa por ele', () => {
  const comFeriado: BusinessSchedule = { ...DEFAULT_BUSINESS_SCHEDULE, holidays: ['2026-12-25'] };
  assert.equal(businessMinutesBetween(TER_10H, office('2026-08-04T11:00:00'), comFeriado), 60);
});

// ── Próxima abertura ─────────────────────────────────────────────────
test('dentro do expediente a próxima abertura é agora', () => {
  assert.equal(nextBusinessOpening(TER_10H), TER_10H);
});

test('sexta à noite, a próxima abertura é segunda de manhã', () => {
  assert.equal(nextBusinessOpening(SEX_18H05), SEG_08H00);
});

test('antes de abrir, a próxima abertura é hoje mesmo', () => {
  assert.equal(nextBusinessOpening(office('2026-08-04T06:00:00')), office('2026-08-04T08:00:00'));
});

// ── Prazo em minutos úteis ───────────────────────────────────────────
test('prazo que estoura o expediente vence na manhã seguinte', () => {
  // 17h50 + 30min úteis: 10min hoje + 20min amanhã = 8h20.
  assert.equal(addBusinessMinutes(TER_17H50, 30), office('2026-08-05T08:20:00'));
});

test('prazo dentro do dia vence no mesmo dia', () => {
  assert.equal(addBusinessMinutes(TER_10H, 45), office('2026-08-04T10:45:00'));
});

test('prazo aberto na sexta à noite vence na segunda', () => {
  assert.equal(addBusinessMinutes(SEX_18H05, 60), office('2026-08-10T09:00:00'));
});

// ── Agenda vinda do banco ────────────────────────────────────────────
test('linha inativa ou ilegível é descartada; a que vira o dia é dividida', () => {
  const schedule = scheduleFromRows([
    { day_of_week: 1, start_time: '08:00', end_time: '18:00', is_active: true },
    { day_of_week: 2, start_time: '08:00', end_time: '18:00', is_active: false },
    { day_of_week: 3, start_time: '18:00', end_time: '08:00', is_active: true },
    { day_of_week: 4, start_time: 'xx:yy', end_time: '18:00', is_active: true },
  ], -240);
  assert.deepEqual(schedule.days, [
    { dayOfWeek: 1, startMinute: 480, endMinute: 1080 },
    // Quarta 18h → quinta 8h é plantão noturno, não configuração quebrada.
    { dayOfWeek: 3, startMinute: 1080, endMinute: 1440 },
    { dayOfWeek: 4, startMinute: 0, endMinute: 480 },
  ]);
});

test('agenda com almoço fechado desconta o intervalo', () => {
  const schedule = scheduleFromRows([
    { day_of_week: 2, start_time: '08:00', end_time: '12:00', is_active: true },
    { day_of_week: 2, start_time: '14:00', end_time: '18:00', is_active: true },
  ], -240);
  // Terça 08h → 18h com almoço fora: 4h + 4h = 480min, não 600.
  assert.equal(businessMinutesBetween(office('2026-08-04T08:00:00'), office('2026-08-04T18:00:00'), schedule), 480);
  assert.equal(isWithinBusinessHours(office('2026-08-04T13:00:00'), schedule), false);
});

// ── Injeção na fila ──────────────────────────────────────────────────
test('sem agenda configurada, cai no relógio de parede (nada muda)', () => {
  const elapsed = elapsedMinutesFor(null);
  assert.equal(elapsed(SEX_18H05, SEG_08H00), (SEG_08H00 - SEX_18H05) / 60_000);
});

test('agenda vazia também cai no relógio de parede, e não em zero eterno', () => {
  const elapsed = elapsedMinutesFor({ days: [], utcOffsetMinutes: -240 });
  assert.ok(elapsed(SEX_18H05, SEG_08H00) > 3000);
});

test('com agenda, o decorrido é o útil', () => {
  const elapsed = elapsedMinutesFor(DEFAULT_BUSINESS_SCHEDULE);
  assert.equal(elapsed(SEX_18H05, SEG_08H00), 0);
  assert.equal(elapsed(TER_10H, office('2026-08-04T10:30:00')), 30);
});

// ── Início fora do expediente ────────────────────────────────────────
test('mensagem que chega antes de abrir só começa a contar às 8h', () => {
  // 6h → 9h: só a última hora é expediente.
  assert.equal(businessMinutesBetween(office('2026-08-04T06:00:00'), office('2026-08-04T09:00:00')), 60);
  // E o prazo de 30min vence às 8h30, não às 6h30.
  assert.equal(addBusinessMinutes(office('2026-08-04T06:00:00'), 30), office('2026-08-04T08:30:00'));
});

test('mensagem que chega depois de fechar só começa a contar no dia seguinte', () => {
  assert.equal(businessMinutesBetween(office('2026-08-04T19:00:00'), office('2026-08-05T08:30:00')), 30);
  assert.equal(addBusinessMinutes(office('2026-08-04T19:00:00'), 45), office('2026-08-05T08:45:00'));
});

test('dia sem expediente não conta nem começa prazo', () => {
  // Domingo inteiro: zero. E um prazo aberto no domingo vence na segunda.
  const DOM = office('2026-08-09T10:00:00');
  assert.equal(businessMinutesBetween(DOM, office('2026-08-09T23:00:00')), 0);
  assert.equal(addBusinessMinutes(DOM, 20), office('2026-08-10T08:20:00'));
});

test('SLA que sobra para o próximo expediente vence nos primeiros minutos dele', () => {
  // 17h58 + 5min úteis: 2min hoje, 3min amanhã.
  assert.equal(addBusinessMinutes(office('2026-08-04T17:58:00'), 5), office('2026-08-05T08:03:00'));
});

test('SLA já vencido devolve um prazo no passado, não zera', () => {
  // Aberto terça 8h com 30min: venceu 8h30. Consultar isso na quarta não muda
  // o vencimento — quem decide "está estourado" é quem compara com o agora.
  const prazo = addBusinessMinutes(office('2026-08-04T08:00:00'), 30);
  assert.equal(prazo, office('2026-08-04T08:30:00'));
  assert.ok(prazo! < office('2026-08-05T09:00:00'));
  // E o decorrido segue crescendo em minutos úteis, bem além do SLA.
  assert.equal(businessMinutesBetween(office('2026-08-04T08:00:00'), office('2026-08-05T09:00:00')), 660);
});

// ── Configuração inválida ────────────────────────────────────────────
test('linhas com dia fora da faixa, hora impossível ou duração zero são descartadas', () => {
  const schedule = scheduleFromRows([
    { day_of_week: 9, start_time: '08:00', end_time: '18:00', is_active: true },
    { day_of_week: -1, start_time: '08:00', end_time: '18:00', is_active: true },
    { day_of_week: 2, start_time: '25:00', end_time: '26:00', is_active: true },
    { day_of_week: 3, start_time: '08:70', end_time: '18:00', is_active: true },
    { day_of_week: 4, start_time: '09:00', end_time: '09:00', is_active: true },
    { day_of_week: 5, start_time: '', end_time: '', is_active: true },
  ], -240);
  assert.deepEqual(schedule.days, []);
  // Agenda que não abre nunca: não inventa prazo nem próxima abertura.
  assert.equal(addBusinessMinutes(TER_10H, 30, schedule), null);
  assert.equal(nextBusinessOpening(TER_10H, schedule), null);
  assert.equal(businessMinutesBetween(TER_10H, SEG_08H00, schedule), 0);
});

test('segundos no horário não atrapalham (TIME do Postgres vem como HH:MM:SS)', () => {
  const schedule = scheduleFromRows(
    [{ day_of_week: 2, start_time: '08:00:00', end_time: '18:00:00', is_active: true }],
    -240,
  );
  assert.deepEqual(schedule.days, [{ dayOfWeek: 2, startMinute: 480, endMinute: 1080 }]);
});

// ── Jornada que atravessa a meia-noite ───────────────────────────────
const PLANTAO_NOTURNO = scheduleFromRows(
  [{ day_of_week: 2, start_time: '22:00', end_time: '02:00', is_active: true }],
  -240,
);

test('plantão noturno vira duas janelas: fim de terça e começo de quarta', () => {
  assert.deepEqual(PLANTAO_NOTURNO.days, [
    { dayOfWeek: 2, startMinute: 22 * 60, endMinute: 24 * 60 },
    { dayOfWeek: 3, startMinute: 0, endMinute: 2 * 60 },
  ]);
});

test('o plantão que vira o dia conta como uma jornada contínua', () => {
  // Terça 23h → quarta 1h = 2h corridas, todas dentro do plantão.
  assert.equal(
    businessMinutesBetween(office('2026-08-04T23:00:00'), office('2026-08-05T01:00:00'), PLANTAO_NOTURNO),
    120,
  );
  assert.equal(isWithinBusinessHours(office('2026-08-05T00:30:00'), PLANTAO_NOTURNO), true);
  assert.equal(isWithinBusinessHours(office('2026-08-05T03:00:00'), PLANTAO_NOTURNO), false);
  // 23h50 + 30min úteis atravessa a meia-noite sem buraco.
  assert.equal(
    addBusinessMinutes(office('2026-08-04T23:50:00'), 30, PLANTAO_NOTURNO),
    office('2026-08-05T00:20:00'),
  );
});

// ── Fuso ─────────────────────────────────────────────────────────────
test('a agenda é lida no fuso do canal, não no do navegador', () => {
  // Mesmo 8h–18h, mas num canal em UTC+1. O instante que em Cuiabá é 20h (ainda
  // terça) lá já é 1h de quarta: fechado. Quem manda é o offset da agenda.
  const lisboa: BusinessSchedule = { ...DEFAULT_BUSINESS_SCHEDULE, utcOffsetMinutes: 60 };
  assert.equal(isWithinBusinessHours(Date.parse('2026-08-04T08:30:00+01:00'), lisboa), true);
  assert.equal(isWithinBusinessHours(Date.parse('2026-08-04T20:00:00-04:00'), lisboa), false);
  assert.equal(isWithinBusinessHours(Date.parse('2026-08-04T20:00:00-04:00'), DEFAULT_BUSINESS_SCHEDULE), false);
  assert.equal(
    businessMinutesBetween(
      Date.parse('2026-08-04T17:30:00+01:00'),
      Date.parse('2026-08-05T09:00:00+01:00'),
      lisboa,
    ),
    90,
  );
});

test('o offset da agenda é fixo: dois canais no mesmo instante dão contas diferentes', () => {
  const cuiaba = DEFAULT_BUSINESS_SCHEDULE;                                    // UTC-4
  const lisboa: BusinessSchedule = { ...DEFAULT_BUSINESS_SCHEDULE, utcOffsetMinutes: 60 };
  const instante = Date.parse('2026-08-04T12:30:00Z');                         // 8h30 em Cuiabá, 13h30 em Lisboa
  assert.equal(isWithinBusinessHours(instante, cuiaba), true);
  assert.equal(isWithinBusinessHours(instante, lisboa), true);
  const madrugadaLa = Date.parse('2026-08-04T22:00:00Z');                       // 18h em Cuiabá, 23h em Lisboa
  assert.equal(isWithinBusinessHours(madrugadaLa, cuiaba), false);
  assert.equal(isWithinBusinessHours(madrugadaLa, lisboa), false);
});

// ── Agenda por canal ─────────────────────────────────────────────────
const PLANTAO_24H = scheduleFromRows(
  [0, 1, 2, 3, 4, 5, 6].map(d => ({ day_of_week: d, start_time: '00:00', end_time: '23:59', is_active: true })),
  -240,
);

test('cada conversa é medida no expediente do próprio canal', () => {
  const elapsed = elapsedMinutesForChannels({ comercial: DEFAULT_BUSINESS_SCHEDULE, plantao: PLANTAO_24H });
  // Sexta 18h05 → segunda 8h: o comercial esteve fechado; o plantão, não.
  assert.equal(elapsed(SEX_18H05, SEG_08H00, 'comercial'), 0);
  assert.ok(elapsed(SEX_18H05, SEG_08H00, 'plantao') > 3000);
});

test('canal desconhecido ou conversa sem canal cai no fallback', () => {
  const semFallback = elapsedMinutesForChannels({ comercial: DEFAULT_BUSINESS_SCHEDULE });
  // Sem fallback é o relógio de parede — o comportamento histórico.
  assert.equal(semFallback(TER_10H, office('2026-08-04T11:00:00'), 'outro'), 60);
  assert.equal(semFallback(SEX_18H05, SEG_08H00, null), (SEG_08H00 - SEX_18H05) / 60_000);

  const comFallback = elapsedMinutesForChannels({ comercial: PLANTAO_24H }, DEFAULT_BUSINESS_SCHEDULE);
  assert.equal(comFallback(SEX_18H05, SEG_08H00, 'nao-cadastrado'), 0);
  assert.equal(comFallback(SEX_18H05, SEG_08H00, undefined), 0);
});

test('canal com agenda vazia não vira "0min para sempre"', () => {
  const elapsed = elapsedMinutesForChannels({ quebrado: { days: [], utcOffsetMinutes: -240 } });
  assert.ok(elapsed(SEX_18H05, SEG_08H00, 'quebrado') > 3000);
});

// ── Estado do expediente (mensagem de ausência) ──────────────────────
test('o estado do expediente traz as janelas do dia em HH:MM', () => {
  const aberto = businessHoursStatus(TER_10H);
  assert.equal(aberto.open, true);
  assert.deepEqual(aberto.windows, [{ start: '08:00', end: '18:00' }]);

  const fechado = businessHoursStatus(office('2026-08-04T19:00:00'));
  assert.equal(fechado.open, false);
  assert.deepEqual(fechado.windows, [{ start: '08:00', end: '18:00' }]);
  assert.equal(fechado.nextOpening, office('2026-08-05T08:00:00'));

  const domingo = businessHoursStatus(office('2026-08-09T10:00:00'));
  assert.equal(domingo.open, false);
  assert.deepEqual(domingo.windows, []);
  assert.equal(domingo.nextOpening, SEG_08H00);
});

test('dia com almoço fechado mostra as duas janelas', () => {
  const schedule = scheduleFromRows([
    { day_of_week: 2, start_time: '08:00', end_time: '12:00', is_active: true },
    { day_of_week: 2, start_time: '14:00', end_time: '18:00', is_active: true },
  ], -240);
  const status = businessHoursStatus(office('2026-08-04T13:00:00'), schedule);
  assert.equal(status.open, false);
  assert.deepEqual(status.windows, [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }]);
  assert.equal(status.nextOpening, office('2026-08-04T14:00:00'));
});

test('o fim de uma jornada que vira o dia é exibido como 00:00', () => {
  assert.deepEqual(businessHoursStatus(office('2026-08-04T23:00:00'), PLANTAO_NOTURNO).windows, [
    { start: '22:00', end: '00:00' },
  ]);
  assert.equal(formatMinuteOfDay(0), '00:00');
  assert.equal(formatMinuteOfDay(1440), '00:00');
  assert.equal(formatMinuteOfDay(8 * 60 + 5), '08:05');
});

// ── Conferência independente ─────────────────────────────────────────
// Varredura minuto a minuto: lenta e burra de propósito, serve de segunda
// opinião contra a versão esperta que pula de janela em janela.
const forcaBruta = (fromMs: number, toMs: number): number => {
  let total = 0;
  for (let cursor = fromMs; cursor < toMs; cursor += 60_000) {
    const local = new Date(cursor - 4 * 3_600_000);
    const dow = local.getUTCDay();
    const min = local.getUTCHours() * 60 + local.getUTCMinutes();
    if (dow >= 1 && dow <= 5 && min >= 480 && min < 1080) total += 1;
  }
  return total;
};

test('a conta rápida bate com a varredura minuto a minuto', () => {
  const inicios = [
    office('2026-08-03T00:00:00'), office('2026-08-04T07:59:00'), office('2026-08-04T12:00:00'),
    office('2026-08-06T17:59:00'), office('2026-08-07T18:05:00'), office('2026-08-09T13:00:00'),
  ];
  const duracoes = [15, 90, 60 * 12, 60 * 30, 60 * 24 * 5];
  for (const inicio of inicios) {
    for (const dur of duracoes) {
      const fim = inicio + dur * 60_000;
      assert.equal(
        businessMinutesBetween(inicio, fim),
        forcaBruta(inicio, fim),
        `de ${new Date(inicio).toISOString()} por ${dur}min`,
      );
    }
  }
});

// ── Plantão 24 horas ─────────────────────────────────────────────────

test('as sete linhas de plantão viram uma agenda sempre aberta', () => {
  const schedule = scheduleFromRows(alwaysOpenRows(), -240);
  assert.equal(schedule.days.length, 7);
  for (const instante of [
    ' 2026-08-04T00:00:00', '2026-08-04T03:17:00', '2026-08-04T12:00:00',
    '2026-08-04T23:59:00', '2026-08-08T05:00:00', '2026-08-09T21:00:00',
  ]) {
    assert.equal(isWithinBusinessHours(office(instante.trim()), schedule), true, instante);
  }
});

test('em canal 24h o tempo de espera vira o relógio de parede', () => {
  const schedule = scheduleFromRows(alwaysOpenRows(), -240);
  // Sexta 18h05 até segunda 8h: 61h55 corridas, e nenhum minuto some.
  assert.equal(businessMinutesBetween(SEX_18H05, SEG_08H00, schedule), 61 * 60 + 55);
  assert.equal(nextBusinessOpening(SAB_10H, schedule), SAB_10H);
  assert.equal(businessHoursStatus(SAB_10H, schedule).open, true);
});

test('isAlwaysOpen reconhece o plantão como o banco o devolve', () => {
  assert.equal(isAlwaysOpen(alwaysOpenRows()), true);
  assert.equal(isAlwaysOpen(alwaysOpenRows().map(r => ({ ...r, start_time: '00:00:00', end_time: '24:00:00' }))), true);
});

test('isAlwaysOpen recusa o que só se parece com plantão', () => {
  assert.equal(isAlwaysOpen([]), false, 'canal sem agenda não é 24h');
  assert.equal(isAlwaysOpen(null), false);
  // Um dia de folga não é plantão — e é justamente a agenda que a tela não pode
  // reabrir com o interruptor de 24h ligado.
  assert.equal(isAlwaysOpen(alwaysOpenRows().filter(r => r.day_of_week !== 0)), false);
  assert.equal(isAlwaysOpen(alwaysOpenRows().map(r => r.day_of_week === 0 ? { ...r, is_active: false } : r)), false);
  // 23:59 deixa o último minuto do dia de fora: parecido, mas não é 24h.
  assert.equal(isAlwaysOpen(alwaysOpenRows().map(r => ({ ...r, end_time: '23:59' }))), false);
  assert.equal(isAlwaysOpen(alwaysOpenRows().map(r => ({ ...r, start_time: '08:00' }))), false);
});
