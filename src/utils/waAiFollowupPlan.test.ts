import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WA_AI_ACCOUNT_FOLLOWUP_PRESET,
  formatWaAiFollowupHours,
  parseWaAiFollowupPlan,
  waAiCampaignFollowupPreset,
} from './waAiFollowupPlan.ts';

/**
 * O caso que motivou o recurso: a escada ditada de cabeça, com a unidade
 * mudando no meio da frase e um teto no fim.
 */
test('lê a escada ditada, herdando a unidade do último número que a trouxe', () => {
  const plan = parseWaAiFollowupPlan(
    'primeiro follow up 2 horas, depois 4, 8, 24, 48, 7 dias, 10, 14... maximo 30 dias',
  );
  assert.deepEqual(plan.hours, [2, 4, 8, 24, 48, 168, 240, 336]);
  assert.equal(plan.maxAttempts, 8);
  assert.deepEqual(plan.warnings, []);
});

test('horário comercial vira janela e dias úteis, com o fuso do texto', () => {
  const plan = parseWaAiFollowupPlan(
    'respeito horario comercial para follow up 08 as 18h00 horario de cuiaba',
  );
  assert.equal(plan.startMinute, 8 * 60);
  assert.equal(plan.endMinute, 18 * 60);
  assert.deepEqual(plan.days, [1, 2, 3, 4, 5]);
  assert.equal(plan.timezone, 'America/Cuiaba');
});

test('a janela do dia não é confundida com dois degraus da escada', () => {
  const plan = parseWaAiFollowupPlan('2 horas, depois 4, 8, 24');
  assert.deepEqual(plan.hours, [2, 4, 8, 24]);
  assert.equal(plan.startMinute, null);
  assert.equal(plan.endMinute, null);
});

test('o texto inteiro do usuário: escada, teto, janela e fuso juntos', () => {
  const plan = parseWaAiFollowupPlan(
    'primeiro follow up 2 horas, depois 4, 8, 24, 48, 7 dias, 10, 14, maximo 30 dias. '
    + 'Respeito horario comercial para follow up 08 as 18h00 horario de Cuiaba.',
  );
  assert.deepEqual(plan.hours, [2, 4, 8, 24, 48, 168, 240, 336]);
  assert.equal(plan.startMinute, 480);
  assert.equal(plan.endMinute, 1080);
  assert.deepEqual(plan.days, [1, 2, 3, 4, 5]);
  assert.equal(plan.timezone, 'America/Cuiaba');
  assert.deepEqual(plan.warnings, []);
});

test('só "horário comercial", sem hora escrita, assume 08:00–18:00', () => {
  const plan = parseWaAiFollowupPlan('a cada 24 horas, respeitando horario comercial');
  assert.equal(plan.startMinute, 480);
  assert.equal(plan.endMinute, 1080);
  assert.deepEqual(plan.days, [1, 2, 3, 4, 5]);
});

test('intervalo acima do teto fica de fora, com aviso', () => {
  const plan = parseWaAiFollowupPlan('1 dia, 10 dias, 45 dias');
  assert.deepEqual(plan.hours, [24, 240]);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /ficaram de fora/);
});

test('teto explícito menor que 30 dias é respeitado', () => {
  const plan = parseWaAiFollowupPlan('2 horas, 24, 7 dias, 14, maximo 10 dias');
  assert.deepEqual(plan.hours, [2, 24, 168]);
  assert.equal(plan.warnings.length, 1);
});

test('a escada nunca passa de 10 tentativas — é o teto do serviço', () => {
  const plan = parseWaAiFollowupPlan('1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 horas');
  assert.equal(plan.maxAttempts, 10);
  assert.deepEqual(plan.hours, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.match(plan.warnings[0], /no máximo 10 tentativas/);
});

test('minutos e semanas viram horas', () => {
  const plan = parseWaAiFollowupPlan('30 minutos, depois 2 horas, depois 2 semanas');
  assert.deepEqual(plan.hours, [0.5, 2, 336]);
});

test('fim de semana liberado quando o texto pede', () => {
  const plan = parseWaAiFollowupPlan('24 horas, todos os dias');
  assert.deepEqual(plan.days, [0, 1, 2, 3, 4, 5, 6]);
});

test('texto sem nenhum intervalo avisa em vez de inventar escada', () => {
  const plan = parseWaAiFollowupPlan('seja gentil e pergunte se ainda tem interesse');
  assert.deepEqual(plan.hours, []);
  assert.equal(plan.maxAttempts, 0);
  assert.match(plan.warnings[0], /Nenhum intervalo reconhecido/);
});

test('texto vazio não produz configuração nenhuma', () => {
  const plan = parseWaAiFollowupPlan('   ');
  assert.deepEqual(plan.hours, []);
  assert.deepEqual(plan.notes, []);
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.timezone, null);
});

test('a escada é escrita em horas e dias, como se lê em voz alta', () => {
  assert.equal(formatWaAiFollowupHours([2, 24, 48, 168]), '2h · 1 dia · 2 dias · 7 dias');
});

test('campanha de conta tem follow-ups ligados com a escada revisada', () => {
  const preset = waAiCampaignFollowupPreset('bloqueio_encerramento_conta');
  assert.equal(preset?.followup_enabled, true);
  assert.equal(preset?.followup_strategy, 'custom');
  assert.deepEqual(preset?.followup_custom_hours, [2, 4, 8, 24, 48, 168, 240, 336]);
  assert.equal(preset?.followup_max_attempts, 8);
  assert.deepEqual(preset?.followup_days, [1, 2, 3, 4, 5]);
  assert.equal(preset?.timezone, 'America/Cuiaba');
  assert.match(WA_AI_ACCOUNT_FOLLOWUP_PRESET.followup_instructions, /não duplique essas cobranças/);
  assert.equal(waAiCampaignFollowupPreset('outra_campanha'), null);
});
