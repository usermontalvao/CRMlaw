import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORDMARK_ALTURA,
  WORDMARK_LARGURA,
  WORDMARK_RATIO,
  wordmarkPngBytes,
} from './wordmark.ts';

// O que estes testes existem para pegar: a constante é um blob opaco de 22 mil
// caracteres. Ninguém revisa isso lendo. Se ela for truncada num merge, colada
// pela metade, ou trocada por outra imagem, o sintoma seria um PDF assinado com
// um retângulo quebrado no lugar da marca — e só alguém abrindo o documento
// perceberia. Aqui o erro aparece no `npm test`.

test('a constante decodifica para bytes', () => {
  const bytes = wordmarkPngBytes();
  assert.ok(bytes.length > 1000, `PNG pequeno demais: ${bytes.length} bytes`);
});

test('os bytes são mesmo um PNG (assinatura de 8 bytes)', () => {
  const bytes = wordmarkPngBytes();
  // \x89 P N G \r \n \x1a \n — o cabeçalho que a norma exige, sem tolerância:
  // aqui o arquivo é nosso e nasceu certo, então lixo na frente é corrupção.
  const assinatura = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  assinatura.forEach((esperado, i) => {
    assert.equal(bytes[i], esperado, `byte ${i} da assinatura PNG`);
  });
});

test('as dimensões declaradas batem com as do próprio PNG', () => {
  const bytes = wordmarkPngBytes();
  // O IHDR é o primeiro chunk e começa no byte 8: 4 de tamanho, 4 de tipo,
  // depois largura e altura em big-endian de 32 bits.
  const leiaUint32 = (offset: number) =>
    (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];

  const tipo = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  assert.equal(tipo, 'IHDR', 'o primeiro chunk de um PNG é sempre o IHDR');

  assert.equal(leiaUint32(16), WORDMARK_LARGURA, 'largura do PNG x constante declarada');
  assert.equal(leiaUint32(20), WORDMARK_ALTURA, 'altura do PNG x constante declarada');
});

test('a proporção é a mesma que o cliente calcula', () => {
  // `renderWordmarkPng()` devolve `ratio: w / h`. Quem desenha escala por ela,
  // então um ratio errado entorta o wordmark sem quebrar nada — o tipo de
  // defeito que passa despercebido até alguém olhar o documento de perto.
  assert.equal(WORDMARK_RATIO, WORDMARK_LARGURA / WORDMARK_ALTURA);
  assert.ok(
    Math.abs(WORDMARK_RATIO - 5.328859060402684) < 1e-12,
    `ratio mudou: ${WORDMARK_RATIO}. Se foi de propósito, a bancada precisa aprovar o antes/depois.`,
  );
});

test('o PNG termina no chunk IEND (não foi truncado)', () => {
  const bytes = wordmarkPngBytes();
  // O IEND ocupa os 12 bytes finais: 4 de tamanho (zero), 4 do tipo, 4 de CRC.
  // O tipo NÃO é o fim do arquivo — os últimos 4 bytes são o CRC.
  const fim = bytes.subarray(bytes.length - 8);
  const tipo = String.fromCharCode(fim[0], fim[1], fim[2], fim[3]);
  assert.equal(tipo, 'IEND', 'PNG sem IEND no fim é arquivo cortado');
});

test('duas chamadas não compartilham o mesmo buffer', () => {
  // Duas montagens simultâneas embutindo o wordmark não podem enxergar o mesmo
  // Uint8Array: uma escrita de uma corromperia o PDF da outra.
  const a = wordmarkPngBytes();
  const b = wordmarkPngBytes();
  assert.notEqual(a, b, 'devolveu a MESMA instância');
  assert.deepEqual(Array.from(a.subarray(0, 16)), Array.from(b.subarray(0, 16)));
});
