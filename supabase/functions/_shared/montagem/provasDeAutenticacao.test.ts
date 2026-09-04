import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVA_BASE,
  provasDeAutenticacao,
  resumoDoDispositivo,
} from './provasDeAutenticacao.ts';

test('a assinatura manuscrita é sempre a primeira linha', () => {
  assert.deepEqual(provasDeAutenticacao({}), [PROVA_BASE]);
});

test('a ordem vai do mais forte ao mais circunstancial', () => {
  const p = provasDeAutenticacao({
    fraseDeIdentidade: 'Identidade confirmada por WhatsApp',
    googleId: 'sub-123',
    ip: '200.1.2.3',
    coordenadas: '-15.6,-56.1',
    temSelfie: true,
    dispositivo: 'iPhone - Safari - iOS',
  });
  assert.deepEqual(p, [
    'Assinatura manuscrita digital',
    'Identidade confirmada por WhatsApp',
    'Google ID: sub-123',
    'Endereço IP: 200.1.2.3',
    'Geolocalização: -15.6,-56.1',
    'Verificação facial (selfie)',
    'Dispositivo: iPhone - Safari - iOS',
  ]);
});

test('SEM confirmação do servidor, o laudo não afirma canal nenhum', () => {
  // O ponto jurídico deste arquivo. Assinatura antiga (anterior às colunas de
  // confirmação) não tem como provar se o código foi por WhatsApp ou SMS.
  // Afirmar o errado num documento de prova é pior do que não afirmar.
  const p = provasDeAutenticacao({ ip: '200.1.2.3' });
  assert.deepEqual(p, ['Assinatura manuscrita digital', 'Endereço IP: 200.1.2.3']);
  assert.ok(!p.some((l) => /whatsapp|sms|e-?mail/i.test(l)), 'nenhum canal pode ser afirmado');
});

test('frase vazia ou só espaço não vira linha em branco no laudo', () => {
  assert.deepEqual(provasDeAutenticacao({ fraseDeIdentidade: '   ' }), [PROVA_BASE]);
  assert.deepEqual(provasDeAutenticacao({ fraseDeIdentidade: null }), [PROVA_BASE]);
});

test('campos ausentes somem, não viram "não informado"', () => {
  // Um laudo cheio de "Endereço IP: não informado" transforma ausência de dado
  // em texto, e quem lê rápido registra que o dado existe.
  const p = provasDeAutenticacao({ ip: '', coordenadas: '  ', dispositivo: '' });
  assert.deepEqual(p, [PROVA_BASE]);
});

test('selfie falsa não entra', () => {
  assert.deepEqual(provasDeAutenticacao({ temSelfie: false }), [PROVA_BASE]);
});

test('o resumo do dispositivo descarta partes vazias', () => {
  // O erro fácil é join direto com campo indefinido: "iPhone -  - " no laudo.
  assert.equal(resumoDoDispositivo(['iPhone', undefined, 'iOS']), 'iPhone - iOS');
  assert.equal(resumoDoDispositivo([null, '  ', undefined]), null);
  assert.equal(resumoDoDispositivo([]), null);
});

test('dispositivo totalmente desconhecido não gera linha', () => {
  const p = provasDeAutenticacao({ dispositivo: resumoDoDispositivo([null, undefined]) });
  assert.deepEqual(p, [PROVA_BASE]);
});
