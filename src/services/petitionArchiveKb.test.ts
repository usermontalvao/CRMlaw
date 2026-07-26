import assert from 'node:assert/strict';
import test from 'node:test';

import { archiveKeywords, docxXmlToText, extractRelevantWindow, scoreCandidatePath } from './petitionArchiveKb.ts';

test('extrai palavras-chave úteis e descarta ruído', () => {
  const keywords = archiveKeywords('preciso de um tópico sobre horas extras e adicional de insalubridade');
  assert.deepEqual(keywords, ['insalubridade', 'adicional', 'extras', 'horas']);
});

test('consulta sem palavra relevante não gera busca', () => {
  assert.deepEqual(archiveKeywords('faça isso por favor'), []);
});

test('pontua candidato pelo nome acima da pasta', () => {
  const keywords = ['insalubridade'];
  const byName = scoreCandidatePath({ name: 'inicial insalubridade.docx', path: 'Clientes/2025/inicial insalubridade.docx' }, keywords);
  const byFolder = scoreCandidatePath({ name: 'peca.docx', path: 'Insalubridade/peca.docx' }, keywords);
  assert.ok(byName > byFolder);
});

test('janela relevante centraliza o termo procurado', () => {
  const text = `${'ruído inicial. '.repeat(60)}O ADICIONAL DE INSALUBRIDADE em grau máximo é devido.${' texto final.'.repeat(60)}`;
  const window = extractRelevantWindow(text, ['insalubridade'], 200);
  assert.ok(window.includes('INSALUBRIDADE'), 'a janela deve conter o termo');
  assert.ok(window.length <= 210, `janela deveria caber no limite, veio com ${window.length}`);
});

test('texto curto volta inteiro, sem reticências', () => {
  assert.equal(extractRelevantWindow('peça curta', ['peca'], 500), 'peça curta');
});

test('converte document.xml de .docx em texto por parágrafos', () => {
  const xml = [
    '<w:document><w:body>',
    '<w:p><w:r><w:t>DAS HORAS EXTRAS</w:t></w:r></w:p>',
    '<w:p><w:r><w:t xml:space="preserve">Jornada de 8h </w:t></w:r><w:r><w:t>&amp; 44h semanais.</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Linha</w:t></w:r><w:br/><w:r><w:t>quebrada</w:t></w:r></w:p>',
    '</w:body></w:document>',
  ].join('');

  assert.equal(
    docxXmlToText(xml),
    'DAS HORAS EXTRAS\nJornada de 8h & 44h semanais.\nLinha\nquebrada',
  );
});
