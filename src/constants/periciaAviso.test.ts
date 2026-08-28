import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERICIA_AVISO_PADRAO,
  montarAvisoPericia,
  normalizarTemplatesDoAviso,
  instanteDoAviso,
} from './periciaAviso.ts';

const dados = {
  nome: 'MARIA DA SILVA',
  tipo: 'perícia social',
  data: 'terça-feira, 01/09/2026 às 09:00',
  local: 'Rua X, 100 — Centro',
  protocolo: '1506198639',
  beneficio: 'BPC LOAS - Deficiência',
  instrucoes: 'Chegue 30 minutos antes.',
};

test('campo vazio leva a LINHA inteira embora, não deixa rótulo órfão', () => {
  const texto = montarAvisoPericia(PERICIA_AVISO_PADRAO.social, { ...dados, local: '', protocolo: '' });
  assert.ok(!texto.includes('📍'), 'a linha do local não pode sobrar sem endereço');
  assert.ok(!texto.includes('Protocolo:'), 'a linha do protocolo não pode sobrar vazia');
  assert.ok(texto.includes('Chegue 30 minutos antes.'), 'o resto do recado continua');
});

test('sem instruções o aviso não fica com o ⚠️ pendurado', () => {
  const texto = montarAvisoPericia(PERICIA_AVISO_PADRAO.medica, { ...dados, tipo: 'perícia médica', instrucoes: '' });
  assert.ok(!texto.includes('⚠️'));
  assert.ok(!texto.includes('{instrucoes}'));
  assert.ok(!/\n{3,}/.test(texto), 'o buraco da linha removida é fechado');
});

test('a social pede despesas e a médica pede laudos — nunca o contrário', () => {
  const social = montarAvisoPericia(PERICIA_AVISO_PADRAO.social, dados);
  const medica = montarAvisoPericia(PERICIA_AVISO_PADRAO.medica, { ...dados, tipo: 'perícia médica' });
  assert.ok(social.includes('despesas da casa'));
  assert.ok(!social.includes('laudos'));
  assert.ok(medica.includes('laudos'));
  assert.ok(!medica.includes('despesas da casa'));
});

test('nenhum campo do modelo sobra por substituir', () => {
  for (const modelo of [PERICIA_AVISO_PADRAO.social, PERICIA_AVISO_PADRAO.medica]) {
    const texto = montarAvisoPericia(modelo, dados);
    assert.ok(!/\{[a-z]+\}/.test(texto), `sobrou campo não substituído em: ${texto}`);
  }
});

test('modelo salvo vazio ou corrompido cai no padrão de fábrica, lado a lado', () => {
  assert.deepEqual(normalizarTemplatesDoAviso(null), PERICIA_AVISO_PADRAO);
  assert.deepEqual(normalizarTemplatesDoAviso({ social: '   ' }), PERICIA_AVISO_PADRAO);
  const so = normalizarTemplatesDoAviso({ social: 'meu texto' });
  assert.equal(so.social, 'meu texto');
  assert.equal(so.medica, PERICIA_AVISO_PADRAO.medica, 'o lado não configurado continua no padrão');
});

test('o aviso sai N dias antes, na hora escolhida', () => {
  const quando = instanteDoAviso('2026-09-01', 3, '08:30');
  assert.ok(quando);
  assert.equal(quando!.getFullYear(), 2026);
  assert.equal(quando!.getMonth(), 7, 'agosto');
  assert.equal(quando!.getDate(), 29);
  assert.equal(quando!.getHours(), 8);
  assert.equal(quando!.getMinutes(), 30);
});

test('zero dias antes é o próprio dia da perícia', () => {
  const quando = instanteDoAviso('2026-09-01', 0, '07:00');
  assert.equal(quando!.getDate(), 1);
  assert.equal(quando!.getMonth(), 8);
});

test('data ilegível não vira Invalid Date silencioso', () => {
  assert.equal(instanteDoAviso('', 1, '09:00'), null);
  assert.equal(instanteDoAviso('nada', 1, '09:00'), null);
});
