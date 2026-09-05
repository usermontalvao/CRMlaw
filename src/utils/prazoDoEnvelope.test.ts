import test from 'node:test';
import assert from 'node:assert/strict';

import { fimDoDiaNoEscritorio, DESLOCAMENTO_DO_ESCRITORIO } from './prazoDoEnvelope.ts';

/**
 * O defeito que estes testes seguram foi medido no banco em 04/09/2026:
 * `'2026-09-10'::timestamptz` na sessão do PostgREST (UTC) devolve
 * `2026-09-10 00:00:00+00`, que em Cuiabá é `09/09/2026 20:00`. O envelope
 * fechava 28 horas antes do que a tela prometia.
 */

test('o prazo vale até o FIM do dia escolhido, no fuso do escritório', () => {
  const iso = fimDoDiaNoEscritorio('2026-09-10');
  assert.equal(iso, '2026-09-10T23:59:59.999-04:00');

  // O que o banco vai guardar, e como isso se lê em Cuiabá.
  const instante = new Date(iso!);
  const emCuiaba = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Cuiaba',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(instante);
  assert.equal(emCuiaba, '10/09/2026, 23:59');
});

test('a forma crua — a que estava em produção — perde o último dia', () => {
  // Documenta a razão de existir deste módulo: mandar a data crua faz o banco
  // lê-la em UTC, e o prazo recua para as 20h do dia ANTERIOR.
  const cru = new Date('2026-09-10T00:00:00Z');
  const emCuiaba = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Cuiaba', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(cru);
  assert.equal(emCuiaba, '09/09, 20:00');

  // E o corrigido cai depois — é o dia inteiro que a tela prometeu.
  assert.ok(new Date(fimDoDiaNoEscritorio('2026-09-10')!).getTime() > cru.getTime());
});

test('a assinatura ainda é aceita às 23h do dia do prazo', () => {
  const limite = new Date(fimDoDiaNoEscritorio('2026-09-10')!).getTime();
  // 23:00 em Cuiabá do próprio dia 10 = 03:00Z do dia 11.
  const assinouAs23h = new Date('2026-09-11T03:00:00Z').getTime();
  assert.ok(assinouAs23h < limite, 'o envelope fechou antes do fim do dia escolhido');

  // E no minuto seguinte à virada, não.
  const depoisDaMeiaNoite = new Date('2026-09-11T04:01:00Z').getTime();
  assert.ok(depoisDaMeiaNoite > limite, 'o envelope continuou aceitando depois do prazo');
});

test('data inexistente é recusada em vez de escorregar de mês', () => {
  // `2026-02-31` casa com o formato e viraria 03/03 num `new Date` ingênuo.
  assert.equal(fimDoDiaNoEscritorio('2026-02-31'), null);
  assert.equal(fimDoDiaNoEscritorio('2026-13-01'), null);
  assert.equal(fimDoDiaNoEscritorio('10/09/2026'), null);
  assert.equal(fimDoDiaNoEscritorio(''), null);
  assert.equal(fimDoDiaNoEscritorio(null), null);
  assert.equal(fimDoDiaNoEscritorio(undefined), null);
});

test('29 de fevereiro passa em ano bissexto e é recusado fora dele', () => {
  assert.equal(fimDoDiaNoEscritorio('2028-02-29'), `2028-02-29T23:59:59.999${DESLOCAMENTO_DO_ESCRITORIO}`);
  assert.equal(fimDoDiaNoEscritorio('2026-02-29'), null);
});
