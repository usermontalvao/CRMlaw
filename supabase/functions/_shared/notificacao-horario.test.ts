import assert from 'node:assert/strict';
import test from 'node:test';
import { dentroDoHorarioDeAviso } from './notificacao-whatsapp.ts';

/**
 * A janela do aviso de WhatsApp à equipe.
 *
 * Os instantes são escritos em UTC porque é assim que a função recebe o relógio
 * em produção; Brasília é UTC-3 o ano inteiro, então 11:00Z = 08:00 em Brasília.
 */
const em = (iso: string) => new Date(Date.parse(iso));

test('a janela é 08:00–18:00 de Brasília', () => {
  assert.equal(dentroDoHorarioDeAviso(em('2026-08-26T10:59:00Z')), false, '07:59 — cedo demais');
  assert.equal(dentroDoHorarioDeAviso(em('2026-08-26T11:00:00Z')), true, '08:00 — abre');
  assert.equal(dentroDoHorarioDeAviso(em('2026-08-26T20:59:00Z')), true, '17:59 — ainda vale');
  assert.equal(dentroDoHorarioDeAviso(em('2026-08-26T21:00:00Z')), false, '18:00 — fecha');
  assert.equal(dentroDoHorarioDeAviso(em('2026-08-26T06:00:00Z')), false, '03:00 — a razão do piso');
});

test('sábado e domingo passam — prazo não espera segunda', () => {
  // Até 29/08/2026 esta trava barrava o fim de semana, e só ela: push e e-mail
  // saíam normalmente. O aviso de prazo VENCIDO chegava no sábado por e-mail e
  // era engolido no WhatsApp, que é o canal que a pessoa olha fora do
  // expediente. A decisão do escritório foi igualar os canais.
  assert.equal(dentroDoHorarioDeAviso(em('2026-08-29T15:00:00Z')), true, 'sábado, 12:00');
  assert.equal(dentroDoHorarioDeAviso(em('2026-08-30T15:00:00Z')), true, 'domingo, 12:00');
});

test('o piso de horário vale igual no fim de semana', () => {
  // Liberar o sábado não pode ter liberado a madrugada junto.
  assert.equal(dentroDoHorarioDeAviso(em('2026-08-29T06:00:00Z')), false, 'sábado, 03:00');
  assert.equal(dentroDoHorarioDeAviso(em('2026-08-30T23:00:00Z')), false, 'domingo, 20:00');
});
