import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collapseContactThreads, contactKey, siblingThreadIds, threadPhoneDigits,
} from './contactThreads.ts';

test('completa o DDI e rejeita número implausível', () => {
  assert.equal(threadPhoneDigits('(65) 98404-6375'), '5565984046375');
  assert.equal(threadPhoneDigits('556584046375'), '556584046375');
  assert.equal(threadPhoneDigits('123'), '');
  assert.equal(threadPhoneDigits(null), '');
});

test('mesmo celular com e sem o 9º dígito cai na mesma chave', () => {
  const comNove = contactKey({ id: 'a', contact_phone: '5565984046375' });
  const semNove = contactKey({ id: 'b', contact_phone: '556584046375' });
  assert.equal(comNove, semNove);
});

test('usa o remote_jid quando o telefone não veio', () => {
  assert.equal(
    contactKey({ id: 'a', contact_phone: null, remote_jid: '556584046375@s.whatsapp.net' }),
    contactKey({ id: 'b', contact_phone: '556584046375' }),
  );
});

test('sem telefone utilizável, o cadastro do cliente identifica a pessoa', () => {
  assert.equal(contactKey({ id: 'a', remote_jid: '99@lid', client_id: 'cli-1' }), 'c:cli-1');
  assert.equal(contactKey({ id: 'a', remote_jid: '99@lid' }), null);
});

test('agrupa as duas linhas do mesmo contato em canais diferentes', () => {
  const pedroCanal1 = { id: 'c1', contact_phone: '556584046375' };
  const pedroCanal2 = { id: 'c2', contact_phone: '5565984046375' };
  const outra = { id: 'c3', contact_phone: '556599998888' };
  const ids = siblingThreadIds(pedroCanal1, [pedroCanal1, pedroCanal2, outra]);
  assert.deepEqual(ids, ['c1', 'c2']);
});

test('a conversa aberta vem primeiro e nunca some, mesmo sem chave', () => {
  const semChave = { id: 'c1', remote_jid: '77@lid' };
  const outra = { id: 'c2', remote_jid: '88@lid' };
  assert.deepEqual(siblingThreadIds(semChave, [semChave, outra]), ['c1']);
});

test('sem conversa aberta não há thread', () => {
  assert.deepEqual(siblingThreadIds(null, [{ id: 'c1', contact_phone: '556584046375' }]), []);
});

test('as duas linhas do mesmo contato viram uma, somando as não lidas', () => {
  const canalPedro = { id: 'c1', contact_phone: '556584046375', unread_count: 2 };
  const canalComercial = { id: 'c2', contact_phone: '5565984046375', unread_count: 3 };
  const outra = { id: 'c3', contact_phone: '556599998888', unread_count: 1 };
  const out = collapseContactThreads([canalPedro, canalComercial, outra]);
  assert.deepEqual(out.map(c => c.id), ['c1', 'c3']);
  assert.equal(out[0].unread_count, 5);
  assert.equal(out[1].unread_count, 1);
});

test('a conversa aberta sobrevive ao colapso, mesmo não sendo a mais recente', () => {
  const recente = { id: 'c1', contact_phone: '556584046375', unread_count: 0 };
  const aberta = { id: 'c2', contact_phone: '556584046375', unread_count: 0 };
  const out = collapseContactThreads([recente, aberta], 'c2');
  assert.deepEqual(out.map(c => c.id), ['c2']);
});

test('preserva a ordem recebida e não funde quem não tem chave', () => {
  const semChave1 = { id: 'a', remote_jid: '11@lid' };
  const semChave2 = { id: 'b', remote_jid: '22@lid' };
  const out = collapseContactThreads([semChave1, semChave2]);
  assert.deepEqual(out.map(c => c.id), ['a', 'b']);
});

test('linha única não é recriada à toa', () => {
  const so = { id: 'c1', contact_phone: '556584046375', unread_count: 4 };
  const out = collapseContactThreads([so]);
  assert.equal(out[0], so);
});

test('a linha ativa representa a pessoa, mesmo que a encerrada venha antes', () => {
  const encerrada = { id: 'c1', contact_phone: '556584046375', status: 'closed' };
  const viva = { id: 'c2', contact_phone: '5565984046375', status: 'open' };
  const out = collapseContactThreads([encerrada, viva]);
  assert.deepEqual(out.map(c => c.id), ['c2']);
});

test('a conversa aberta na tela vence até a linha ativa', () => {
  const viva = { id: 'c1', contact_phone: '556584046375', status: 'open' };
  const naTela = { id: 'c2', contact_phone: '556584046375', status: 'closed' };
  assert.deepEqual(collapseContactThreads([viva, naTela], 'c2').map(c => c.id), ['c2']);
});

test('grupo só de encerradas mantém a primeira', () => {
  const a = { id: 'c1', contact_phone: '556584046375', status: 'closed' };
  const b = { id: 'c2', contact_phone: '556584046375', status: 'closed' };
  assert.deepEqual(collapseContactThreads([a, b]).map(c => c.id), ['c1']);
});
