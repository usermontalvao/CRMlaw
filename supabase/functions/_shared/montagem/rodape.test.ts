import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coubeOuCorta,
  partesDoCarimboLateral,
  textoDeVerificacao,
} from './rodape.ts';

/** Fonte de mentira com largura fixa por caractere — mede sem embutir nada. */
const fonteFalsa = (larguraPorChar = 10) => ({
  widthOfTextAtSize: (t: string, size: number) => t.length * larguraPorChar * (size / 10),
});

test('a URL de verificação vira host + caminho curto', () => {
  assert.equal(
    textoDeVerificacao('https://jurius.com.br/#/verificar/ABC123'),
    'jurius.com.br/#/verificar',
  );
});

test('o www some do host', () => {
  assert.equal(textoDeVerificacao('https://www.jurius.com.br/#/verificar/X'), 'jurius.com.br/#/verificar');
});

test('URL sem protocolo não quebra — cai na limpeza manual', () => {
  assert.equal(textoDeVerificacao('jurius.com.br/verificar/'), 'jurius.com.br/verificar');
});

test('sem URL, texto genérico em vez de vazio', () => {
  // Rodapé com espaço em branco no lugar do endereço parece defeito de impressão.
  assert.equal(textoDeVerificacao(null), 'verificar autenticidade');
  assert.equal(textoDeVerificacao('   '), 'verificar autenticidade');
});

test('texto que cabe não ganha reticências', () => {
  const f = fonteFalsa();
  assert.equal(coubeOuCorta('ABC', f, 10, 1000), 'ABC');
});

test('texto que não cabe é cortado COM reticências, dentro da largura', () => {
  const f = fonteFalsa();
  const r = coubeOuCorta('ABCDEFGHIJ', f, 10, 45);
  assert.ok(r.endsWith('…'), `esperava reticências, veio ${r}`);
  assert.ok(f.widthOfTextAtSize(r, 10) <= 45, 'o corte tem de caber de verdade');
});

test('largura minúscula não gera texto vazio nem laço infinito', () => {
  const f = fonteFalsa();
  const r = coubeOuCorta('ABCDEFGH', f, 10, 1);
  assert.ok(r.length >= 1, 'sobra pelo menos um caractere');
});

test('o carimbo lateral traz protocolo, código, data e selo, nessa ordem', () => {
  const p = partesDoCarimboLateral({
    protocolo: 'abc-123', codigo: 'xyz789',
    assinadoEm: '03/09/2026 21:34', seloCurto: 'DEADBEEF',
  });
  assert.deepEqual(p, [
    'PROTOCOLO ABC-123',
    'CÓDIGO XYZ789',
    '03/09/2026 21:34',
    'CERT. SELO DEADBEEF',
  ]);
});

test('código N/A não entra no carimbo', () => {
  // Carimbar "CÓDIGO N/A" na margem é ruído que ocupa espaço e não informa.
  const p = partesDoCarimboLateral({ protocolo: 'p1', codigo: 'n/a', seloCurto: 'AA' });
  assert.deepEqual(p, ['PROTOCOLO P1', 'CERT. SELO AA']);
});

test('campos ausentes simplesmente não aparecem', () => {
  assert.deepEqual(partesDoCarimboLateral({}), []);
  assert.deepEqual(partesDoCarimboLateral({ protocolo: '   ' }), []);
});

test('o hash NÃO entra no carimbo lateral', () => {
  // 64 caracteres a 6 pt numa faixa vertical são ilegíveis, e o hash já está no
  // rodapé com rótulo. Este teste existe para que acrescentá-lo seja uma
  // decisão consciente, não um descuido.
  const p = partesDoCarimboLateral({
    protocolo: 'p', codigo: 'c', seloCurto: 'S',
    // @ts-expect-error — o campo não existe de propósito
    sha256: 'a'.repeat(64),
  });
  assert.ok(!p.some((parte) => parte.includes('a'.repeat(10))), 'hash não pode vazar para a margem');
});
