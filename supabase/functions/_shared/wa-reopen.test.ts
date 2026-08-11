import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HORAS_NOVA_SESSAO,
  MINUTOS_CUMPRIMENTO_NOVO,
  classificarReabertura,
  ehCortesia,
  ehCumprimento,
  normalizarTexto,
} from './wa-reopen.ts';

/** Atalho: mensagem de texto com um tempo de silêncio em minutos. */
const msg = (texto: string, minutosDeSilencio: number | null) =>
  classificarReabertura({ texto, tipo: 'text', minutosDeSilencio });

const HORAS = 60;

test('"oie" no dia seguinte reabre — foi o caso que virou pergunta automática', () => {
  assert.equal(msg('oie', 20 * HORAS), 'reopen');
});

test('cumprimento reabre depois do intervalo, mesmo escrito de qualquer jeito', () => {
  for (const t of ['oi', 'oiii', 'oieee', 'olá', 'Olá!', 'opa', 'e aí', 'bom dia', 'oi boa tarde']) {
    assert.equal(msg(t, MINUTOS_CUMPRIMENTO_NOVO), 'reopen', t);
  }
});

test('cumprimento colado no encerramento ainda é despedida — vai para a IA', () => {
  assert.equal(msg('oi', MINUTOS_CUMPRIMENTO_NOVO - 1), 'ia');
});

test('qualquer assunto depois das horas de silêncio reabre sem IA', () => {
  const silencio = HORAS_NOVA_SESSAO * HORAS;
  assert.equal(msg('bom', silencio), 'reopen');
  assert.equal(msg('preciso ver aquele documento', silencio), 'reopen');
  assert.equal(msg('meu', silencio), 'reopen');
});

test('dentro da mesma sessão, texto ambíguo continua indo para a IA', () => {
  const silencio = HORAS_NOVA_SESSAO * HORAS - 1;
  assert.equal(msg('meu', silencio), 'ia');
  assert.equal(msg('preciso ver aquele documento', silencio), 'ia');
});

test('cortesia inequívoca mantém encerrada por mais tarde que chegue', () => {
  const silencio = 48 * HORAS;
  for (const t of ['obrigada', 'obrigado!', 'vlw', 'tá bom', 'muito obrigado', 'até mais']) {
    assert.equal(msg(t, silencio), 'keep', t);
  }
});

test('pergunta e demanda explícita reabrem na hora', () => {
  assert.equal(msg('vocês atendem hoje?', 0), 'reopen');
  assert.equal(msg('tenho outra dúvida', 0), 'reopen');
  assert.equal(msg('preciso de ajuda', 0), 'reopen');
});

test('mídia sem legenda reabre; texto vazio não', () => {
  assert.equal(classificarReabertura({ texto: null, tipo: 'image', minutosDeSilencio: 0 }), 'reopen');
  assert.equal(classificarReabertura({ texto: '  ', tipo: 'audio', minutosDeSilencio: null }), 'reopen');
  assert.equal(classificarReabertura({ texto: '', tipo: 'text', minutosDeSilencio: null }), 'keep');
});

test('sem saber o tempo, a decisão volta para a IA em vez de chutar', () => {
  assert.equal(msg('oi', null), 'ia');
  assert.equal(msg('e o processo', null), 'ia');
});

test('normalização tira acento e pontuação', () => {
  assert.equal(normalizarTexto('Olá, tudo bem?'), 'ola tudo bem');
});

test('cumprimento não engole frase de verdade', () => {
  assert.equal(ehCumprimento('oi'), true);
  assert.equal(ehCumprimento('bom dia'), true);
  assert.equal(ehCumprimento('bom dia preciso do contrato'), false);
  assert.equal(ehCumprimento(''), false);
});

test('cortesia não engole frase de verdade', () => {
  assert.equal(ehCortesia('ok'), true);
  assert.equal(ehCortesia('ok obrigado'), true);
  assert.equal(ehCortesia('ok mas e o prazo'), false);
});
