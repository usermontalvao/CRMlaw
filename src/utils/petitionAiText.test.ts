import assert from 'node:assert/strict';
import test from 'node:test';

import {
  explodeInlineOutline,
  normalizeAiInsertText,
  rangeAnchors,
  spansParagraphs,
  splitDeletionChunks,
  stripMarkdownForDocument,
} from './petitionAiText.ts';

test('remove marcação markdown sem tocar em variáveis do modelo', () => {
  const input = '### DAS HORAS EXTRAS\n**Reclamante** trabalhava _além_ da jornada. Valor: [[VALOR_TOTAL]].';
  const output = stripMarkdownForDocument(input);
  assert.equal(
    output,
    'DAS HORAS EXTRAS\nReclamante trabalhava além da jornada. Valor: [[VALOR_TOTAL]].',
  );
});

test('preserva sublinhado interno de variáveis em caixa alta', () => {
  assert.equal(
    stripMarkdownForDocument('Reflexo em [[VALOR_REFLEXO_FERIAS]] e [[VALOR_REFLEXO_13]].'),
    'Reflexo em [[VALOR_REFLEXO_FERIAS]] e [[VALOR_REFLEXO_13]].',
  );
});

test('desdobra estrutura achatada em uma linha só', () => {
  const flat = '1. PREÂMBULO - Identificação das partes - Qualificação do Reclamante 2. DOS FATOS - Descrição detalhada dos eventos 3. DO DIREITO - Fundamentos jurídicos';
  const lines = explodeInlineOutline(flat).split('\n');
  assert.deepEqual(lines, [
    '1. PREÂMBULO',
    '- Identificação das partes',
    '- Qualificação do Reclamante',
    '2. DOS FATOS',
    '- Descrição detalhada dos eventos',
    '3. DO DIREITO',
    '- Fundamentos jurídicos',
  ]);
});

test('não quebra título jurídico com travessão', () => {
  const heading = '2.4 – DA MULTA DO ART. 477, § 8º, DA CLT';
  assert.equal(explodeInlineOutline(heading), heading);
});

test('não quebra parágrafo corrido com incisos', () => {
  const paragraph = 'Nos termos do art. 7º, XVI - da Constituição Federal, a remuneração do serviço extraordinário é superior em 50%.';
  assert.equal(explodeInlineOutline(paragraph), paragraph);
});

test('normaliza texto de inserção: markdown fora, parágrafos de volta', () => {
  const raw = '**Estrutura**\n\n\n\n1. DOS FATOS - Descrição 2. DO DIREITO - Fundamento 3. DOS PEDIDOS - Rol';
  assert.equal(
    normalizeAiInsertText(raw),
    'Estrutura\n\n1. DOS FATOS\n- Descrição\n2. DO DIREITO\n- Fundamento\n3. DOS PEDIDOS\n- Rol',
  );
});

test('divide o trecho a remover em pedaços aplicáveis', () => {
  const excerpt = '1. PREÂMBULO\n- Identificação das partes\nok\n\n2. DOS FATOS';
  assert.deepEqual(splitDeletionChunks(excerpt), [
    'PREÂMBULO',
    'Identificação das partes',
    'DOS FATOS',
  ]);
});

test('âncoras de intervalo usam a primeira e a última linha', () => {
  const excerpt = 'PRIMEIRA LINHA DO BLOCO\nmiolo qualquer\núltima linha do bloco duplicado';
  assert.deepEqual(rangeAnchors(excerpt), {
    start: 'PRIMEIRA LINHA DO BLOCO',
    end: 'última linha do bloco duplicado',
  });
});

test('âncoras longas são cortadas mantendo início e fim reais', () => {
  const long = `${'a'.repeat(200)}\n${'b'.repeat(200)}`;
  const anchors = rangeAnchors(long, undefined, 20);
  assert.equal(anchors?.start, 'a'.repeat(20));
  assert.equal(anchors?.end, 'b'.repeat(20));
});

test('detecta trecho que atravessa parágrafos', () => {
  assert.equal(spansParagraphs('uma linha só'), false);
  assert.equal(spansParagraphs('linha um\nlinha dois'), true);
});
