import test from 'node:test';
import assert from 'node:assert/strict';
import { contactCardPhone, parseContactMessage } from './contactCard.ts';

test('o cartão do André: nome na primeira linha, telefone embaixo', () => {
  assert.deepEqual(
    parseContactMessage('André Eletricista\n+556581121124'),
    [{ name: 'André Eletricista', phones: ['556581121124'] }],
  );
});

test('o número mascarado do WhatsApp vira dígitos', () => {
  assert.deepEqual(
    parseContactMessage('Lisliandra\n+55 65 9612-8787'),
    [{ name: 'Lisliandra', phones: ['556596128787'] }],
  );
});

test('o mesmo número em duas formas vira UM botão só', () => {
  const lido = parseContactMessage('Maria\n+556581121124\n+55 (65) 8112-1124');
  assert.deepEqual(lido[0].phones, ['556581121124']);
});

test('vários telefones do mesmo contato aparecem todos', () => {
  const lido = parseContactMessage('Escritório\n+5565988887777\n+556533334444');
  assert.deepEqual(lido[0].phones, ['5565988887777', '556533334444']);
});

test('cartão com vários contatos — a linha em branco separa', () => {
  assert.deepEqual(
    parseContactMessage('Ana\n+5565988887777\n\nBruno\n+5565911112222'),
    [
      { name: 'Ana', phones: ['5565988887777'] },
      { name: 'Bruno', phones: ['5565911112222'] },
    ],
  );
});

test('cartão sem telefone continua existindo — a tela precisa dizer isso', () => {
  assert.deepEqual(parseContactMessage('Contato sem nome'), [{ name: 'Contato sem nome', phones: [] }]);
  assert.deepEqual(parseContactMessage(''), []);
  assert.deepEqual(parseContactMessage(null), []);
});

test('nome com número dentro NÃO é confundido com telefone', () => {
  const lido = parseContactMessage('Loja 24h Cuiabá\n+5565988887777');
  assert.equal(lido[0].name, 'Loja 24h Cuiabá');
  assert.deepEqual(lido[0].phones, ['5565988887777']);
});

// ── LID: a mesma regra do discador vale aqui ────────────────────────────────

test('LID dentro do cartão NÃO vira telefone', () => {
  assert.equal(contactCardPhone('30971327959064@lid'), '');
  assert.equal(contactCardPhone('252677908865131@lid'), '');
  const lido = parseContactMessage('Contato\n252677908865131@lid');
  assert.deepEqual(lido[0].phones, [], 'o cartão fica sem número, e não com um número falso');
});

test('número real, em qualquer das três formas, normaliza igual', () => {
  assert.equal(contactCardPhone('5565999999999@s.whatsapp.net'), '5565999999999');
  assert.equal(contactCardPhone('+55 65 99999-9999'), '5565999999999');
  assert.equal(contactCardPhone('5565999999999'), '5565999999999');
  assert.equal(contactCardPhone('65999999999'), '5565999999999');
});

test('o que não chega a ser telefone devolve vazio', () => {
  assert.equal(contactCardPhone('123'), '');
  assert.equal(contactCardPhone(''), '');
  assert.equal(contactCardPhone('5565999999999999'), '');
});
