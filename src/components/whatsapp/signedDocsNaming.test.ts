import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ehNomeDeArmazenamento, extensaoDoCaminho, nomeDeArquivoSeguro, nomeUnicoNoZip, signedDocLabel,
} from './signedDocsNaming.ts';

test('extensão sai do caminho, e só quando é extensão de verdade', () => {
  assert.equal(extensaoDoCaminho('assinados/abc/4585e82c.docx'), 'docx');
  assert.equal(extensaoDoCaminho('pasta/contrato.PDF'), 'pdf');
  assert.equal(extensaoDoCaminho('contrato-2026-08-27'), '');
  assert.equal(extensaoDoCaminho('relatorio.2026-08-27'), '');
  assert.equal(extensaoDoCaminho(null), '');
});

test('uuid do armazenamento não é nome', () => {
  assert.equal(ehNomeDeArmazenamento('4585e82c-57b3-4799-a7b2-91e68dc25e5b.docx'), true);
  assert.equal(ehNomeDeArmazenamento('f74bda20-1f1f-4522-a639-8bcf21d3ec10'), true);
  assert.equal(ehNomeDeArmazenamento('   '), true);
  assert.equal(ehNomeDeArmazenamento('1724776800000.pdf'), true);
});

test('nome escrito por gente continua sendo o nome', () => {
  assert.equal(ehNomeDeArmazenamento('Contrato de honorários'), false);
  assert.equal(ehNomeDeArmazenamento('Procuração.pdf'), false);
});

test('o uuid vira "Documento N de M", com a extensão preservada', () => {
  const rotulo = signedDocLabel({
    displayName: '4585e82c-57b3-4799-a7b2-91e68dc25e5b.docx',
    path: 'assinados/kit/4585e82c-57b3-4799-a7b2-91e68dc25e5b.docx',
    index: 0, total: 2,
  });
  assert.equal(rotulo, 'Documento 1 de 2.docx');
});

test('arquivo único não é numerado', () => {
  const rotulo = signedDocLabel({
    displayName: null, path: 'assinados/kit/f74bda20.pdf', index: 0, total: 1,
  });
  assert.equal(rotulo, 'Documento assinado.pdf');
});

test('nome de gente ganha a extensão do caminho, sem duplicar', () => {
  assert.equal(signedDocLabel({
    displayName: 'Contrato de honorários.pdf',
    path: 'assinados/x/uuid.pdf', index: 0, total: 2,
  }), 'Contrato de honorários.pdf');
});

test('nomes repetidos no zip não se sobrescrevem', () => {
  const usados = new Set<string>();
  assert.equal(nomeUnicoNoZip('Documento assinado.docx', usados), 'Documento assinado.docx');
  assert.equal(nomeUnicoNoZip('Documento assinado.docx', usados), 'Documento assinado (2).docx');
  assert.equal(nomeUnicoNoZip('Documento assinado.docx', usados), 'Documento assinado (3).docx');
});

test('o que o sistema de arquivos recusa sai do nome', () => {
  assert.equal(nomeDeArquivoSeguro('KIT/CONSUMIDOR: 2026?', 'reserva.zip'), 'KIT_CONSUMIDOR_ 2026_');
  assert.equal(nomeDeArquivoSeguro('   ', 'reserva.zip'), 'reserva.zip');
});
