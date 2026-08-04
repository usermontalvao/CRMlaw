import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWhatsAppChatWordCandidates,
  collectWhatsAppSpellcheckWords,
  findWhatsAppSpellIssueAtOffset,
  rankWhatsAppSpellSuggestions,
  segmentWhatsAppSpellcheckText,
} from './composerSpellcheck.ts';

test('separa palavras e ignora URL, e-mail, número e variável de modelo', () => {
  assert.deepEqual(
    collectWhatsAppSpellcheckWords('Olá whatsap https://jurius.com.br teste@jurius.com.br 12345 {{cliente}}'),
    ['Olá', 'whatsap'],
  );
});

test('deduplica sem diferenciar maiúsculas e minúsculas', () => {
  assert.deepEqual(collectWhatsAppSpellcheckWords('Recurso recurso RECURSO'), ['Recurso']);
});

test('marca somente as palavras suspeitas sem alterar o texto', () => {
  const segments = segmentWhatsAppSpellcheckText('Oi vocee, tudo bem?', [{ word: 'vocee', suggestions: ['você'] }]);
  assert.deepEqual(segments, [
    { text: 'Oi', misspelled: false },
    { text: ' ', misspelled: false },
    { text: 'vocee', misspelled: true },
    { text: ', ', misspelled: false },
    { text: 'tudo', misspelled: false },
    { text: ' ', misspelled: false },
    { text: 'bem', misspelled: false },
    { text: '?', misspelled: false },
  ]);
});

test('prioriza correções comuns do português de conversa', () => {
  assert.deepEqual(rankWhatsAppSpellSuggestions('voce', ['vozerio']), ['você']);
  assert.deepEqual(rankWhatsAppSpellSuggestions('Oieee', ['Oieira']), ['Oi']);
});

test('remove alongamento de chat sem tocar no restante da palavra', () => {
  assert.deepEqual(buildWhatsAppChatWordCandidates('Naooo'), ['Nao']);
  assert.deepEqual(buildWhatsAppChatWordCandidates('tudoo'), ['tudo']);
  assert.deepEqual(buildWhatsAppChatWordCandidates('carro'), []);
});

test('Naooo recebe Não e elimina palpites sem sentido do dicionário', () => {
  assert.deepEqual(
    rankWhatsAppSpellSuggestions('Naooo', ['Naoto', 'Naos', 'Toona', 'Nanato'], ['Nao']),
    ['Não'],
  );
});

test('forma desalongada válida vence as sugestões genéricas', () => {
  assert.deepEqual(rankWhatsAppSpellSuggestions('amigooo', ['amigável'], ['amigo']), ['amigo']);
});

test('encontra a palavra suspeita sob o cursor do textarea', () => {
  const issue = { word: 'voce', suggestions: ['você'] };
  assert.deepEqual(findWhatsAppSpellIssueAtOffset('Olá voce amigo', [issue], 6), {
    issue,
    start: 4,
    end: 8,
  });
  assert.equal(findWhatsAppSpellIssueAtOffset('Olá voce amigo', [issue], 10), null);
});
