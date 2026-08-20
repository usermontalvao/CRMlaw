import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarEmojis, GRUPOS_DE_EMOJI, REACOES_RAPIDAS, TODOS_OS_EMOJIS, normalizarBusca } from './emojiData.ts';

test('a busca ignora acento do que foi digitado', () => {
  const comAcento = buscarEmojis('coração').map(i => i.e);
  const semAcento = buscarEmojis('coracao').map(i => i.e);
  assert.deepEqual(comAcento, semAcento);
  assert.ok(comAcento.includes('❤️'));
});

test('casa por início de palavra, não por trecho solto', () => {
  // "paz" dentro de "capaz" não pode contar como resultado.
  assert.equal(normalizarBusca('  PAZ '), 'paz');
  const achados = buscarEmojis('joinha').map(i => i.e);
  assert.deepEqual(achados, ['👍']);
});

test('termo vazio não devolve nada (quem manda é o grupo aberto)', () => {
  assert.deepEqual(buscarEmojis(''), []);
  assert.deepEqual(buscarEmojis('   '), []);
});

test('as reações rápidas existem no catálogo', () => {
  const catalogo = new Set(TODOS_OS_EMOJIS.map(i => i.e));
  for (const emoji of REACOES_RAPIDAS) assert.ok(catalogo.has(emoji), `${emoji} fora do catálogo`);
});

test('palavras-chave estão normalizadas (sem acento e em minúsculas)', () => {
  for (const item of TODOS_OS_EMOJIS) {
    assert.equal(item.k, normalizarBusca(item.k), `palavra-chave fora do padrão em ${item.e}`);
  }
});

test('nenhum emoji repetido dentro do mesmo grupo', () => {
  for (const grupo of GRUPOS_DE_EMOJI) {
    const vistos = new Set<string>();
    for (const item of grupo.emojis) {
      assert.ok(!vistos.has(item.e), `${item.e} repetido em ${grupo.nome}`);
      vistos.add(item.e);
    }
  }
});
