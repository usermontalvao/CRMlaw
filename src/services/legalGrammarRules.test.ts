// Cobertura das regras jurídicas próprias do revisor do editor de petições.
// Execução: `node --test --import ts-node/esm src/services/legalGrammarRules.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLegalRules } from './legalGrammarRules.ts';

const ids = (text: string) => checkLegalRules(text).map((m) => m.ruleId);
const find = (text: string, ruleId: string) => checkLegalRules(text).find((m) => m.ruleId === ruleId);

test('crase: pega o caso que o LanguageTool deixa passar', () => {
  const match = find('O autor vem a presença de Vossa Excelência.', 'CRASE_PRESENCA');
  assert.ok(match, 'deveria acusar a falta de crase');
  assert.equal(match!.bad, 'vem a presença');
  assert.equal(match!.suggestions[0], 'vem à presença');
  assert.equal(match!.category, 'crase');
  assert.ok(match!.explanation.includes('preposição'));
});

test('crase: não inventa erro onde a crase já está correta', () => {
  assert.deepEqual(ids('O autor vem à presença de Vossa Excelência.'), []);
});

test('crase: acusa crase indevida antes de verbo e de pronome de tratamento', () => {
  assert.equal(find('à partir de hoje', 'CRASE_A_PARTIR')?.suggestions[0], 'a partir de');
  assert.equal(find('Requer à juntar o documento.', 'CRASE_ANTES_DE_VERBO')?.suggestions[0], 'a juntar');
  assert.equal(
    find('Requer à Vossa Excelência o deferimento.', 'CRASE_PRONOME_TRATAMENTO')?.suggestions[0],
    'a Vossa Excelência',
  );
});

test('concordância de número entre artigo e substantivo', () => {
  const match = find('Os autor apresentou a petição.', 'CONCORDANCIA_NUMERO_ARTIGO');
  assert.ok(match);
  assert.equal(match!.bad, 'Os autor');
  // Sugestão coerente, diferente do "Os, autor" que o LanguageTool devolve.
  assert.deepEqual(match!.suggestions, ['O autor', 'Os autores']);
});

test('concordância de gênero entre artigo e substantivo', () => {
  const match = find('O autora juntou os documentos.', 'CONCORDANCIA_GENERO_ARTIGO');
  assert.ok(match);
  assert.equal(match!.suggestions[0], 'A autora');
  assert.equal(match!.suggestions[1], 'O autor');
  assert.equal(match!.category, 'genero');
});

test('concordância verbal com sujeito plural', () => {
  const match = find('Os autores apresentou os documentos.', 'CONCORDANCIA_VERBAL');
  assert.ok(match);
  assert.equal(match!.suggestions[0], 'Os autores apresentaram');
});

test('concordância verbal com sujeito singular', () => {
  assert.equal(
    find('O autor requerem a condenação.', 'CONCORDANCIA_VERBAL')?.suggestions[0],
    'O autor requer',
  );
});

test('não acusa concordância verbal em contração (nos autos consta)', () => {
  assert.ok(!ids('Nos autos consta o comprovante.').includes('CONCORDANCIA_VERBAL'));
});

test('não acusa concordância verbal em sujeito composto', () => {
  assert.ok(!ids('O autor e a ré requerem a homologação.').includes('CONCORDANCIA_VERBAL'));
});

test('concordância entre substantivo e adjetivo (número e gênero)', () => {
  assert.equal(find('Pede danos moral.', 'CONCORDANCIA_NUMERO_ADJETIVO')?.suggestions[0], 'danos morais');
  assert.equal(find('as horas extra', 'CONCORDANCIA_NUMERO_ADJETIVO')?.suggestions[0], 'horas extras');
  assert.equal(find('a prova robusto', 'CONCORDANCIA_GENERO_ADJETIVO')?.suggestions[0], 'prova robusta');
});

test('frases corretas não geram achados', () => {
  const limpo = [
    'Os autores apresentaram a petição inicial e requerem a condenação da ré ao pagamento de danos morais.',
    'A empresa reclamada não pagou as horas extras devidas ao empregado.',
    'Conforme a decisão de fls. 20, o prazo é de 15 dias.',
  ];
  for (const frase of limpo) {
    assert.deepEqual(checkLegalRules(frase), [], `falso positivo em: ${frase}`);
  }
});

test('termos jurídicos homônimos', () => {
  assert.equal(find('Impetrou mandato de segurança.', 'MANDATO_DE_SEGURANCA')?.suggestions[0], 'mandado de segurança');
  assert.equal(find('o iminente relator', 'IMINENTE_EMINENTE')?.suggestions[0], 'eminente relator');
});

test('pontuação e espaçamento', () => {
  assert.ok(ids('texto  com espaço duplo').includes('ESPACO_DUPLO'));
  assert.ok(ids('do autor , conforme').includes('ESPACO_ANTES_PONTUACAO'));
  assert.equal(find('conforme o pedido,requer', 'FALTA_ESPACO_APOS_PONTUACAO')?.suggestions[0], ', r');
  assert.ok(ids('finalizou....').includes('RETICENCIAS'));
});

test('palavra repetida', () => {
  const match = find('o autor autor requer', 'REPETICAO_PALAVRA');
  assert.ok(match);
  assert.equal(match!.bad, 'autor autor');
  assert.equal(match!.suggestions[0], 'autor');
});

test('redundâncias e vícios de linguagem forense', () => {
  assert.equal(find('há dois anos atrás', 'HA_TEMPO_ATRAS')?.suggestions[0], 'há dois anos');
  assert.equal(find('afim de comprovar', 'AFIM_DE')?.suggestions[0], 'a fim de');
  assert.equal(find('haja visto os documentos', 'HAJA_VISTO')?.suggestions[0], 'haja vista');
  assert.ok(ids('o contrato onde consta a cláusula').includes('ONDE_NAO_LOCATIVO'));
});

test('achados não se sobrepõem', () => {
  const matches = checkLegalRules('Os autor  vem a presença de Vossa Excelência.');
  for (let i = 1; i < matches.length; i++) {
    const previous = matches[i - 1];
    const current = matches[i];
    assert.ok(
      previous.offset + previous.length <= current.offset || current.offset + current.length <= previous.offset,
      'achados sobrepostos não foram deduplicados',
    );
  }
});

test('impessoalidade de "haver" e de "fazer" temporal', () => {
  assert.equal(find('Houveram três audiências.', 'HOUVERAM_EXISTENCIAL')?.suggestions[0], 'Houve');
  assert.equal(find('não houveram provas', 'HOUVERAM_EXISTENCIAL')?.suggestions[0], 'houve');
  assert.equal(find('Devem haver provas nos autos.', 'HAVER_LOCUCAO_PLURAL')?.suggestions[0], 'Deve haver');
  assert.equal(find('Vão haver novas testemunhas.', 'HAVER_LOCUCAO_PLURAL')?.suggestions[0], 'Vai haver');
  assert.equal(find('Fazem dois anos que a ré não paga.', 'FAZEM_TEMPO')?.suggestions[0], 'Faz dois anos');
  assert.deepEqual(ids('Houve três audiências e faz dois anos.'), []);
});

test('regência e pronomes: implicar em, para mim, entre eu', () => {
  assert.equal(find('O descumprimento implica em multa.', 'IMPLICAR_EM')?.suggestions[0], 'implica');
  assert.equal(find('prazo para mim apresentar a defesa', 'PARA_MIM_INFINITIVO')?.suggestions[0], 'para eu apresentar');
  assert.equal(find('o contrato entre eu e o réu', 'ENTRE_EU')?.suggestions[0], 'entre mim e');
  assert.deepEqual(ids('O documento foi entregue para mim.'), []);
});

test('grafia consagrada: má-fé e meio-dia e meia', () => {
  assert.equal(find('Agiu de má fé ao omitir.', 'MA_FE_HIFEN')?.suggestions[0], 'má-fé');
  assert.equal(find('A ré agiu de mau fé.', 'MA_FE_HIFEN')?.suggestions[0], 'má-fé');
  assert.equal(find('audiência ao meio-dia e meio', 'MEIO_DIA_E_MEIA')?.suggestions[0], 'meio-dia e meia');
  assert.deepEqual(ids('Agiu de má-fé ao meio-dia e meia.'), []);
});
