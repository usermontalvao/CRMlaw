import test from 'node:test';
import assert from 'node:assert/strict';
import {
  curateSpellingSuggestions,
  normalizeContextualSentenceSpellingIssues,
  normalizeContextualSpellingSuggestions,
  replaceSpellingWordInRange,
} from './spelling-suggestions.ts';

test('corrige "Oe" para "Oi" sem completar o menu com ruído do Hunspell', () => {
  assert.deepEqual(
    curateSpellingSuggestions('Oe', ['OE', 'De', 'Oz', 'Ose', 'Soe']),
    ['Oi'],
  );
});

test('preserva a caixa da palavra nas correções de alta confiança', () => {
  assert.deepEqual(curateSpellingSuggestions('PETICAO', ['petição']), ['PETIÇÃO']);
  assert.deepEqual(curateSpellingSuggestions('Concerteza', []), ['Com certeza']);
});

test('não inventa lista lexical para palavra curta desconhecida', () => {
  assert.deepEqual(curateSpellingSuggestions('xy', ['Xi', 'Xá', 'Xô']), []);
});

test('deduplica, remove a própria palavra e limita candidatos curtos', () => {
  assert.deepEqual(
    curateSpellingSuggestions('abc', ['ABC', 'abd', 'ABD', 'abe', 'abri', 'abro']),
    ['abd', 'abe', 'abri'],
  );
});

test('fallback local não repete as sugestões ruins das capturas', () => {
  assert.deepEqual(curateSpellingSuggestions('Oiee', ['Oire', 'Oide']), ['Oi', 'Olá']);
  assert.deepEqual(
    curateSpellingSuggestions('amiguo', ['amigou', 'amigo', 'amigão', 'amigue', 'amiguismo']),
    ['amigo'],
  );
});

test('normaliza a resposta contextual antes de criar itens clicáveis', () => {
  assert.deepEqual(
    normalizeContextualSpellingSuggestions(['amigo', 'AMIGO', 'amigo\nmalicioso', 42], 'amiguo'),
    ['amigo'],
  );
});

test('valida erro que só aparece ao analisar a frase inteira', () => {
  assert.deepEqual(
    normalizeContextualSentenceSpellingIssues(
      [
        { bad: 'mei', good: 'meu', message: 'Antes de “amigo”, cabe o possessivo “meu”.' },
        { bad: 'palavra ausente', good: 'outra', message: 'ruído' },
      ],
      'Olá mei amigo, tudo bem?',
    ),
    [{ bad: 'mei', good: 'meu', message: 'Antes de “amigo”, cabe o possessivo “meu”.' }],
  );
});

test('bloqueia a sugestão estrangeira "mi" no caso contextual "mei amigo"', () => {
  assert.deepEqual(
    normalizeContextualSentenceSpellingIssues(
      [{ bad: 'mei', good: 'mi', message: 'Sugestão insegura do modelo.' }],
      'Olá mei amigo, tudo bem?',
    ),
    [{ bad: 'mei', good: 'meu', message: 'Sugestão insegura do modelo.' }],
  );
});

test('descarta falso positivo quando o modelo repete a mesma palavra', () => {
  assert.deepEqual(
    normalizeContextualSentenceSpellingIssues(
      [{ bad: 'meu', good: 'meu', message: 'Não requer correção.' }],
      'Olá meu amigo, tudo bem?',
    ),
    [],
  );
});

test('preserva espaços e pontuação que vieram dentro do intervalo do Syncfusion', () => {
  assert.equal(replaceSpellingWordInRange('amiguo ', 'amiguo', 'amigo'), 'amigo ');
  assert.equal(replaceSpellingWordInRange(' amiguo', 'amiguo', 'amigo'), ' amigo');
  assert.equal(replaceSpellingWordInRange('“amiguo,” ', 'amiguo', 'amigo'), '“amigo,” ');
  assert.equal(
    replaceSpellingWordInRange('meu amiguo tudo bem', 'amiguo', 'amigo'),
    'meu amigo tudo bem',
  );
});

test('duas correções consecutivas não juntam as palavras da frase', () => {
  const afterGreeting = replaceSpellingWordInRange(
    'Oiee meu amiguo tudo bem',
    'Oiee',
    'Oi',
  );
  assert.equal(afterGreeting, 'Oi meu amiguo tudo bem');
  assert.equal(
    replaceSpellingWordInRange(afterGreeting || '', 'amiguo', 'amigo'),
    'Oi meu amigo tudo bem',
  );
});

test('não altera um intervalo quando a palavra-alvo não está nele', () => {
  assert.equal(replaceSpellingWordInRange('meu amigo', 'amiguo', 'amigo'), null);
});
