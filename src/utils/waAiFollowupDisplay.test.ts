import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactWaAiFollowupLabel,
  describeWaAiFollowupSchedule,
  describeWaAiFollowupStatus,
  describeWaAiFollowupWindow,
  formatWaAiFollowupDuration,
  formatWaAiFollowupWhen,
  waAiFollowupCountdown,
  waAiListChip,
  type WaAiFollowupDisplayPolicy,
} from './waAiFollowupDisplay.ts';

const custom: WaAiFollowupDisplayPolicy = {
  enabled: true,
  strategy: 'custom',
  intervalHours: 24,
  customHours: [2, 4, 8, 24, 48, 168, 240, 336],
  maxAttempts: 8,
  days: [1, 2, 3, 4, 5],
  startMinute: 480,
  endMinute: 1080,
  timezone: 'America/Cuiaba',
};

test('formata minutos, horas e dias para leitura rápida', () => {
  assert.equal(formatWaAiFollowupDuration(0.5), '30min');
  assert.equal(formatWaAiFollowupDuration(8), '8h');
  assert.equal(formatWaAiFollowupDuration(24), '1 dia');
  assert.equal(formatWaAiFollowupDuration(168), '7 dias');
});

test('mostra a próxima posição da escada no cabeçalho', () => {
  assert.equal(compactWaAiFollowupLabel(custom, 0), 'Follow-up 1º em 2h');
  assert.equal(compactWaAiFollowupLabel(custom, 2), 'Follow-up 3º em 8h');
});

test('descreve a escada e a janela configuradas', () => {
  assert.equal(
    describeWaAiFollowupSchedule(custom),
    '2h · 4h · 8h · 1 dia · 2 dias · 7 dias · 10 dias · 14 dias',
  );
  assert.equal(describeWaAiFollowupWindow(custom), 'Seg–sex · 08:00–18:00 · Cuiabá');
});

test('descreve política fixa e progressiva', () => {
  assert.equal(describeWaAiFollowupSchedule({ ...custom, strategy: 'fixed', intervalHours: 24, maxAttempts: 3 }),
    'A cada 1 dia · até 3 tentativas');
  assert.equal(describeWaAiFollowupSchedule({ ...custom, strategy: 'progressive', intervalHours: 2, maxAttempts: 4 }),
    'Começa em 2h e dobra a cada tentativa · até 4');
});

// ── O que o painel mostra agora ─────────────────────────────────────────────

/** Quarta-feira, 11:29 em Cuiabá — o instante da conversa que motivou o ajuste. */
const AGORA = Date.parse('2026-08-12T15:29:00.000Z');

test('a conta regressiva fala em minutos, horas e dias', () => {
  const daqui = (ms: number) => waAiFollowupCountdown(new Date(AGORA + ms).toISOString(), AGORA);
  assert.equal(daqui(30_000), 'em instantes');
  assert.equal(daqui(12 * 60_000), 'em 12min');
  assert.equal(daqui(2 * 3_600_000), 'em 2h');
  assert.equal(daqui(92 * 60_000), 'em 1h32');
  assert.equal(daqui(3 * 86_400_000), 'em 3 dias');
  assert.equal(daqui(26 * 3_600_000), 'em 1d 2h');
});

test('o lembrete atrasado diz que está atrasado, não que já saiu', () => {
  assert.equal(waAiFollowupCountdown(new Date(AGORA - 5 * 60_000).toISOString(), AGORA), 'atrasado 5min');
  assert.equal(waAiFollowupCountdown(new Date(AGORA - 10_000).toISOString(), AGORA), 'saindo agora');
  assert.equal(waAiFollowupCountdown(null, AGORA), null);
});

test('a data é lida no fuso do canal, não no do navegador', () => {
  // 17:29Z = 13:29 em Cuiabá, no mesmo dia.
  assert.equal(formatWaAiFollowupWhen('2026-08-12T17:29:00.000Z', 'America/Cuiaba', AGORA), 'hoje 13:29');
  assert.equal(formatWaAiFollowupWhen('2026-08-13T12:00:00.000Z', 'America/Cuiaba', AGORA), 'amanhã 08:00');
  assert.equal(formatWaAiFollowupWhen('2026-08-17T12:00:00.000Z', 'America/Cuiaba', AGORA), '17/08 08:00');
});

test('com pendente, o painel mostra a tentativa, o horário e o quanto falta', () => {
  const status = describeWaAiFollowupStatus({
    policy: custom,
    attemptsDone: 1,
    pending: { attempt: 2, scheduledAt: '2026-08-12T17:29:00.000Z' },
    nowMs: AGORA,
  });
  assert.equal(status.tone, 'scheduled');
  assert.equal(status.label, 'Follow-up ativo');
  assert.equal(status.attempt, '2ª de 8');
  assert.equal(status.when, 'hoje 13:29');
  assert.equal(status.countdown, 'em 2h');
  assert.equal(status.detail, '2ª de 8 tentativa · hoje 13:29 · em 2h');
});

test('política ligada sem pendente é dita com todas as letras', () => {
  const status = describeWaAiFollowupStatus({
    policy: custom, attemptsDone: 0, pending: null, nowMs: AGORA,
  });
  assert.equal(status.tone, 'configured');
  assert.equal(status.detail, 'Follow-up configurado, ainda não agendado.');
});

test('tentativas esgotadas não viram promessa de retomada', () => {
  const status = describeWaAiFollowupStatus({
    policy: custom, attemptsDone: 8, pending: null, nowMs: AGORA,
  });
  assert.equal(status.detail, 'Todas as tentativas de retomada já foram usadas.');
});

test('agente sem política não anuncia follow-up nenhum', () => {
  const status = describeWaAiFollowupStatus({
    policy: { ...custom, enabled: false }, attemptsDone: 0, pending: null, nowMs: AGORA,
  });
  assert.equal(status.tone, 'off');
  assert.equal(describeWaAiFollowupStatus({ policy: null, attemptsDone: 0, pending: null }).tone, 'off');
});

// ── O chip da lista ─────────────────────────────────────────────────────────

test('a linha da inbox mostra a IA e quando ela volta a falar', () => {
  const chip = waAiListChip({
    aiActive: true,
    nextFollowupAt: new Date(AGORA + 9 * 60_000).toISOString(),
    attemptsDone: 0,
    maxAttempts: 9,
    nowMs: AGORA,
  });
  assert.equal(chip?.label, 'IA · 1ª em 9min');
  assert.match(chip!.title, /retomada 1 de 9/);
});

test('sem retomada agendada, o chip diz só que a IA está ativa', () => {
  const chip = waAiListChip({ aiActive: true, nextFollowupAt: null, attemptsDone: 0, maxAttempts: 9, nowMs: AGORA });
  assert.equal(chip?.label, 'IA ativa');
});

test('depois do handoff a linha volta a ser humana e não tem chip de IA', () => {
  assert.equal(waAiListChip({ aiActive: false, nextFollowupAt: null, attemptsDone: 0, maxAttempts: 9, nowMs: AGORA }), null);
});

test('a contagem da tentativa acompanha o que já saiu', () => {
  const chip = waAiListChip({
    aiActive: true,
    nextFollowupAt: new Date(AGORA + 2 * 3_600_000).toISOString(),
    attemptsDone: 2, maxAttempts: 9, nowMs: AGORA,
  });
  assert.equal(chip?.label, 'IA · 3ª em 2h');
});

// ── Compromisso marcado pelo cliente ────────────────────────────────────────

test('compromisso não é chamado de tentativa da escada', () => {
  const status = describeWaAiFollowupStatus({
    policy: custom,
    attemptsDone: 2,
    pending: { attempt: 3, scheduledAt: '2026-08-12T18:00:00.000Z', kind: 'appointment' },
    nowMs: AGORA,
  });
  assert.equal(status.tone, 'appointment');
  assert.equal(status.label, 'Contato agendado');
  // Nada de "3ª de 8": a escada está pausada, as tentativas seguem disponíveis.
  assert.equal(status.attempt, null);
  assert.doesNotMatch(status.detail, /tentativa/);
  assert.match(status.detail, /hoje 14:00/);
});

test('a etiqueta da lista distingue compromisso de cobrança', () => {
  const compromisso = waAiListChip({
    aiActive: true, kind: 'appointment',
    nextFollowupAt: new Date(AGORA + 2 * 3_600_000).toISOString(),
    attemptsDone: 2, maxAttempts: 8, nowMs: AGORA,
  });
  assert.equal(compromisso?.label, 'IA · contato em 2h');

  const cobranca = waAiListChip({
    aiActive: true, kind: 'followup',
    nextFollowupAt: new Date(AGORA + 2 * 3_600_000).toISOString(),
    attemptsDone: 2, maxAttempts: 8, nowMs: AGORA,
  });
  assert.equal(cobranca?.label, 'IA · 3ª em 2h');
});
