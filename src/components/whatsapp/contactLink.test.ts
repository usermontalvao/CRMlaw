import test from 'node:test';
import assert from 'node:assert/strict';
import { linkPhoneDigits, planPhoneLink, sameLinkPhone } from './contactLink.ts';

test('ficha vazia: o número entra no celular', () => {
  assert.deepEqual(planPhoneLink({ mobile: null, phone: null }, '+55 65 8112-1124'), {
    action: 'add', field: 'mobile', value: '556581121124', replaced: null,
  });
});

test('celular ocupado, fixo vazio: entra no fixo, sem apagar nada', () => {
  assert.deepEqual(planPhoneLink({ mobile: '5565999999999', phone: null }, '556533334444'), {
    action: 'add', field: 'phone', value: '556533334444', replaced: null,
  });
});

test('NÚMERO JÁ VINCULADO não faz nada — nem "adicionar", nem duplicata', () => {
  assert.equal(planPhoneLink({ mobile: '5565999999999', phone: null }, '5565999999999').action, 'none');
  assert.equal(planPhoneLink({ mobile: null, phone: '556533334444' }, '556533334444').action, 'none');
});

test('já vinculado NA OUTRA FORMA do 9º dígito também não faz nada', () => {
  // `5565992216459` (com o 9) e `556592216459` (sem) são a MESMA pessoa: o
  // painel antigo oferecia "adicionar" o que já estava na ficha.
  assert.equal(planPhoneLink({ mobile: '556592216459', phone: null }, '5565992216459').action, 'none');
  assert.equal(planPhoneLink({ mobile: '5565992216459', phone: null }, '556592216459').action, 'none');
  assert.equal(sameLinkPhone('5565992216459', '556592216459'), true);
  assert.equal(sameLinkPhone('5565992216459', '5565992216458'), false);
});

test('ficha cheia: substitui o celular E DIZ qual número saiu', () => {
  const plano = planPhoneLink({ mobile: '5565999999999', phone: '556533334444' }, '5565988887777');
  assert.deepEqual(plano, {
    action: 'replace', field: 'mobile', value: '5565988887777', replaced: '5565999999999',
  });
});

test('CONTATO SEM NÚMERO não mexe na ficha', () => {
  assert.equal(planPhoneLink({ mobile: null, phone: null }, '').action, 'none');
  assert.equal(planPhoneLink({ mobile: null, phone: null }, null).action, 'none');
  assert.equal(planPhoneLink({ mobile: null, phone: null }, '123').action, 'none');
});

test('LID NUNCA entra num cadastro como telefone', () => {
  assert.equal(linkPhoneDigits('252677908865131@lid'), '');
  assert.equal(planPhoneLink({ mobile: null, phone: null }, '252677908865131@lid').action, 'none');
  assert.equal(planPhoneLink({ mobile: null, phone: null }, '30971327959064@lid').value, '');
});

test('o JID com telefone de verdade é aceito', () => {
  assert.equal(linkPhoneDigits('5565999999999@s.whatsapp.net'), '5565999999999');
  assert.equal(planPhoneLink({ mobile: null, phone: null }, '5565999999999@s.whatsapp.net').value, '5565999999999');
});
