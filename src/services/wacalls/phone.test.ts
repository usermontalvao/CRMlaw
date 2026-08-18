import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALLABLE_PHONE_UNKNOWN, ehLid, lidDeJid, parseWaPeer, phoneFromWaCallsPeer,
  resolveCallablePhone, toWaCallsPhone,
} from './phone.ts';

test('o número que o WhatsApp guarda já sai pronto', () => {
  assert.equal(toWaCallsPhone('5565999999999'), '5565999999999');
});

test('máscara, espaço e "+" caem fora — o servidor só quer dígitos', () => {
  assert.equal(toWaCallsPhone('+55 (65) 99999-9999'), '5565999999999');
});

test('sem código do país, assume Brasil (celular e fixo)', () => {
  assert.equal(toWaCallsPhone('65999999999'), '5565999999999');
  assert.equal(toWaCallsPhone('6533334444'), '556533334444');
});

test('número antigo de 8 dígitos com o 55 continua valendo', () => {
  assert.equal(toWaCallsPhone('556533334444'), '556533334444');
});

test('o que não dá número devolve vazio em vez de discar errado', () => {
  assert.equal(toWaCallsPhone(''), '');
  assert.equal(toWaCallsPhone(null), '');
  assert.equal(toWaCallsPhone('123'), '');
  assert.equal(toWaCallsPhone('5565999999999999'), '');
});

test('o JID com telefone volta como dígitos', () => {
  assert.equal(toWaCallsPhone('5565999999999@s.whatsapp.net'), '5565999999999');
  assert.equal(phoneFromWaCallsPeer('5565999999999@s.whatsapp.net'), '5565999999999');
  assert.equal(phoneFromWaCallsPeer('5565999999999:12@s.whatsapp.net'), '5565999999999');
  assert.equal(phoneFromWaCallsPeer(null), '');
});

// ── LID: o defeito que fez o escritório discar para a Somália ────────────────

test('LID É RECONHECIDO como LID, não como número', () => {
  assert.equal(ehLid('30971327959064@lid'), true);
  assert.equal(ehLid('252677908865131@lid'), true);
  assert.equal(ehLid('5565999999999@s.whatsapp.net'), false);
  assert.equal(ehLid('5565999999999'), false);
  assert.equal(lidDeJid('252677908865131@lid'), '252677908865131');
  assert.equal(lidDeJid('5565999999999@s.whatsapp.net'), null);
});

test('LID NUNCA vira telefone — nem cortado, nem com o 55 na frente', () => {
  for (const lid of ['30971327959064@lid', '252677908865131@lid']) {
    assert.equal(toWaCallsPhone(lid), '', `${lid} não pode virar número`);
    assert.equal(phoneFromWaCallsPeer(lid), '', `${lid} não pode virar número`);
  }
});

test('LID do tamanho de um telefone TAMBÉM é recusado (o formato não decide)', () => {
  // 13 dígitos caberiam num MSISDN brasileiro; o `@lid` é que manda.
  assert.equal(toWaCallsPhone('5565999999999@lid'), '');
  assert.deepEqual(parseWaPeer('5565999999999@lid'), { phone: '', lid: '5565999999999' });
});

test('o convite recebido é lido pelo que ele é', () => {
  assert.deepEqual(parseWaPeer('5565999999999@s.whatsapp.net'), { phone: '5565999999999', lid: null });
  assert.deepEqual(parseWaPeer('30971327959064@lid'), { phone: '', lid: '30971327959064' });
  assert.deepEqual(parseWaPeer(''), { phone: '', lid: null });
});

// ── resolveCallablePhone: a decisão em um lugar só ──────────────────────────

test('a prioridade é respeitada: o primeiro candidato com número de verdade vence', () => {
  const r = resolveCallablePhone([
    { source: 'vcard', value: '+55 65 8112-1124' },
    { source: 'conversation', value: '5565999999999' },
  ]);
  assert.deepEqual(r, { phone: '556581121124', source: 'vcard', lid: null, failure: null });
});

test('candidato vazio é pulado, não interrompe a busca', () => {
  const r = resolveCallablePhone([
    { source: 'vcard', value: null },
    { source: 'conversation', value: '' },
    { source: 'client', value: '65 99999-9999' },
  ]);
  assert.equal(r.phone, '5565999999999');
  assert.equal(r.source, 'client');
});

test('LID na frente NÃO bloqueia o telefone que vem atrás', () => {
  const r = resolveCallablePhone([
    { source: 'conversation', value: '252677908865131@lid' },
    { source: 'client', value: '5565961287 87'.replace(/\s/g, '') },
  ]);
  assert.equal(r.phone, '556596128787');
  assert.equal(r.source, 'client');
  // O LID visto continua disponível para quem quiser registrar o mapeamento.
  assert.equal(r.lid, '252677908865131');
});

test('SÓ LID: recusa a chamada e diz por quê (o caso da Lisliandra)', () => {
  const r = resolveCallablePhone([{ source: 'conversation', value: '252677908865131@lid' }]);
  assert.equal(r.phone, '', 'não pode existir número para discar');
  assert.equal(r.failure, 'lid-only');
  assert.equal(r.lid, '252677908865131');
  assert.notEqual(r.phone, '252677908865131');
  assert.notEqual(r.phone, '+252677908865131');
});

test('o mapeamento LID → telefone É aceito — é consulta, não conversão', () => {
  const r = resolveCallablePhone([
    { source: 'conversation', value: '252677908865131@lid' },
    { source: 'lid-map', value: '556596128787' },
  ]);
  assert.deepEqual(r, {
    phone: '556596128787', source: 'lid-map', lid: '252677908865131', failure: null,
  });
});

test('sem candidato nenhum, e com lixo, os motivos são diferentes', () => {
  assert.equal(resolveCallablePhone([]).failure, 'empty');
  assert.equal(resolveCallablePhone([{ source: 'vcard', value: '  ' }]).failure, 'empty');
  assert.equal(resolveCallablePhone([{ source: 'vcard', value: '123' }]).failure, 'invalid');
});

test('o recado de recusa existe e fala com o operador', () => {
  assert.match(CALLABLE_PHONE_UNKNOWN, /não foi possível identificar/i);
});
