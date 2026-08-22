import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialLetter, filterContacts, groupByLetter, enterTarget, type ContactEntry,
} from './contactBook.ts';

const contato = (name: string, phone: string, extra: Partial<ContactEntry> = {}): ContactEntry => ({
  clientId: `id-${name}-${phone}`,
  name,
  phone,
  phoneKind: 'mobile',
  avatarUrl: null,
  isPreCadastro: false,
  ...extra,
});

const agenda: ContactEntry[] = [
  contato('Álvaro Nunes', '5565984001122'),
  contato('Ana Beatriz', '5565984002233'),
  contato('Bruno Carvalho', '5565984003344'),
  contato('Bruno Carvalho', '556533221100', { phoneKind: 'phone' }),
  contato('Ícaro Melo', '5565984005566'),
  contato('3M do Brasil', '551133445566'),
];

// ── Letra da seção ────────────────────────────────────────────────────
test('acento não separa grupo: Álvaro fica junto de Ana, no A', () => {
  assert.equal(initialLetter('Álvaro Nunes'), 'A');
  assert.equal(initialLetter('Ana Beatriz'), 'A');
});

test('nome que não começa com letra cai no grupo "#"', () => {
  assert.equal(initialLetter('3M do Brasil'), '#');
  assert.equal(initialLetter(''), '#');
});

test('o grupo "#" vai para o fim, não para o começo', () => {
  const secoes = groupByLetter(agenda).map(s => s.letter);
  assert.deepEqual(secoes, ['A', 'B', 'I', '#']);
});

test('a ordem de dentro da seção é a que veio do servidor', () => {
  const a = groupByLetter(agenda).find(s => s.letter === 'A')!;
  assert.deepEqual(a.entries.map(e => e.name), ['Álvaro Nunes', 'Ana Beatriz']);
});

test('cliente com dois números aparece duas vezes — a lista é por número', () => {
  const b = groupByLetter(agenda).find(s => s.letter === 'B')!;
  assert.equal(b.entries.length, 2);
  assert.deepEqual(b.entries.map(e => e.phoneKind), ['mobile', 'phone']);
});

// ── Peneira ───────────────────────────────────────────────────────────
test('busca vazia devolve a agenda inteira — ela começa cheia', () => {
  assert.equal(filterContacts(agenda, '').length, agenda.length);
  assert.equal(filterContacts(agenda, '   ').length, agenda.length);
});

test('nome é encontrado sem digitar o acento', () => {
  assert.deepEqual(filterContacts(agenda, 'alvaro').map(e => e.name), ['Álvaro Nunes']);
  assert.deepEqual(filterContacts(agenda, 'icaro').map(e => e.name), ['Ícaro Melo']);
});

test('busca por pedaço do telefone acha a linha daquele número', () => {
  const achados = filterContacts(agenda, '3322');
  assert.equal(achados.length, 1);
  assert.equal(achados[0].phone, '556533221100');
});

test('telefone digitado com máscara também casa', () => {
  assert.equal(filterContacts(agenda, '(65) 98400-2233').length, 1);
});

// A agenda não carrega mais CPF/CNPJ (nem do banco, nem para a tela): para
// COMEÇAR uma conversa basta o telefone. Digitar documento agora não casa com
// ninguém — é este o comportamento esperado, não uma regressão.
test('documento digitado não casa com ninguém: o CPF saiu da agenda', () => {
  assert.equal(filterContacts(agenda, '123.456').length, 0);
});

test('nada casando devolve lista vazia, não a agenda toda', () => {
  assert.equal(filterContacts(agenda, 'zzzz').length, 0);
});

// ── Enter ─────────────────────────────────────────────────────────────
test('telefone digitado ganha do resto da peneira', () => {
  const alvo = enterTarget('5565999998888', agenda);
  assert.deepEqual(alvo, { kind: 'phone', phone: '5565999998888' });
});

test('sobrando um contato só, Enter abre aquele', () => {
  const um = filterContacts(agenda, 'alvaro');
  const alvo = enterTarget('', um);
  assert.equal(alvo?.kind, 'contact');
});

test('com vários na tela o Enter não escolhe por conta própria', () => {
  assert.equal(enterTarget('', agenda), null);
});

test('sem nada na peneira o Enter não faz nada', () => {
  assert.equal(enterTarget('', []), null);
});
