import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANCORA_ALTURA_PT, ANCORA_LARGURA_PT, caixaDaAssinatura, comRelacionamentos, comTipoPng,
  desenhoDaAncora, nosDeTexto, plantarAncoras, relacionamentosDasAncoras,
} from './ancoraNoDocx.ts';

/** Um `document.xml` mínimo, com os runs que o Word produziria. */
const doc = (...runs: string[]) =>
  `<?xml version="1.0"?><w:document><w:body><w:p>${
    runs.map((t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`).join('')
  }</w:p></w:body></w:document>`;

/** O texto que sobra, na ordem — é o que seria impresso na folha. */
const textoDe = (xml: string) => nosDeTexto(xml).map((n) => n.texto).join('');

test('o marcador SOME do texto — é isso que impede o [[ASSINATURA]] impresso', () => {
  const { xml, ancoras } = plantarAncoras(doc('Assino abaixo: [[ASSINATURA]] — obrigado.'));
  assert.equal(ancoras.length, 1);
  assert.doesNotMatch(textoDe(xml), /\[\[/);
  assert.match(textoDe(xml), /Assino abaixo: /);
  assert.match(textoDe(xml), /— obrigado\./);
});

test('marcador PARTIDO em vários runs é achado e removido inteiro', () => {
  // O caso normal, não a exceção: basta o autor ter digitado um colchete e
  // formatado o resto para o Word quebrar o marcador em pedaços. Uma busca
  // run a run acharia ZERO marcadores num documento perfeitamente válido.
  const { xml, ancoras } = plantarAncoras(doc('Fica ', '[[ASSIN', 'ATURA', ']]', ' aqui.'));
  assert.equal(ancoras.length, 1);
  assert.equal(textoDe(xml).includes('ASSIN'), false);
  assert.equal(textoDe(xml).includes(']]'), false);
  assert.match(textoDe(xml), /Fica /);
  assert.match(textoDe(xml), / aqui\./);
});

test('o desenho entra UMA vez, mesmo com o marcador partido em 4 runs', () => {
  // Um desenho por pedaço daria quatro imagens sobrepostas — e quatro campos de
  // assinatura no mesmo lugar.
  const { xml } = plantarAncoras(doc('[[ASS', 'INA', 'TU', 'RA]]'));
  assert.equal((xml.match(/<w:drawing>/g) ?? []).length, 1);
});

test('dois marcadores viram duas âncoras, com relIds diferentes', () => {
  const { xml, ancoras } = plantarAncoras(doc('A: [[ASSINATURA]] B: [[ASSINATURA_2]]'));
  assert.equal(ancoras.length, 2);
  assert.deepEqual(ancoras.map((a) => a.indiceDoAssinante), [1, 2]);
  assert.notEqual(ancoras[0].relId, ancoras[1].relId);
  assert.equal((xml.match(/<w:drawing>/g) ?? []).length, 2);
});

test('o índice do assinante é preservado — [[ASSINATURA_2]] é do segundo', () => {
  // Perder isto faria as duas rubricas irem para o primeiro signatário: um
  // documento atribuindo a manifestação de vontade de uma pessoa a outra.
  const { ancoras } = plantarAncoras(doc('[[ASSINATURA_3]]'));
  assert.equal(ancoras[0].indiceDoAssinante, 3);
});

test('sem marcador, o XML volta IDÊNTICO', () => {
  // Documento sem `[[ASSINATURA]]` não pode ser reescrito: qualquer alteração
  // muda o SHA-256 do congelado sem motivo.
  const original = doc('Contrato comum, sem marcador.');
  const { xml, ancoras } = plantarAncoras(original);
  assert.equal(xml, original);
  assert.deepEqual(ancoras, []);
});

test('o XML continua bem formado — tags balanceadas depois do recorte', () => {
  // O recorte acontece DENTRO de `<w:t>`; errar o índice cortaria no meio de
  // uma tag e produziria o "conteúdo ilegível" do Word.
  const { xml } = plantarAncoras(doc('x [[ASSINATURA]] y'));
  const abre = (xml.match(/<w:t[\s>]/g) ?? []).length;
  const fecha = (xml.match(/<\/w:t>/g) ?? []).length;
  assert.equal(abre, fecha, 'sobrou um <w:t> sem fechar');
  assert.equal((xml.match(/<w:drawing>/g) ?? []).length,
    (xml.match(/<\/w:drawing>/g) ?? []).length);
});

test('marcadores múltiplos são aplicados DE TRÁS PARA A FRENTE, sem embaralhar', () => {
  // Aplicar da esquerda para a direita invalidaria os índices seguintes: o
  // segundo recorte cairia deslocado pelo tamanho do primeiro desenho.
  const { xml } = plantarAncoras(doc('início [[ASSINATURA]] meio [[ASSINATURA_2]] fim'));
  const texto = textoDe(xml);
  assert.match(texto, /início /);
  assert.match(texto, / meio /);
  assert.match(texto, / fim/);
  assert.doesNotMatch(texto, /\[\[/);
});

test('o marcador com espaço interno também é pego', () => {
  const { ancoras } = plantarAncoras(doc('[[ ASSINATURA ]]'));
  assert.equal(ancoras.length, 1);
});

test('a âncora é INLINE, nunca flutuante', () => {
  // `<wp:anchor>` sai do fluxo do texto e o diagramador pode movê-la — a
  // coordenada lida do PDF deixaria de ser o lugar do marcador.
  const desenho = desenhoDaAncora('rId9', 'assinatura-1-1');
  assert.match(desenho, /<wp:inline/);
  assert.doesNotMatch(desenho, /<wp:anchor/);
  assert.match(desenho, /r:embed="rId9"/);
});

test('o tamanho da âncora vai em EMU, e é o da caixa da assinatura', () => {
  // 914.400 EMU por polegada; 12.700 por ponto. Errar a unidade daria uma
  // imagem 12.700× maior ou menor — e um campo de assinatura absurdo.
  const desenho = desenhoDaAncora('rId1', 'a', ANCORA_LARGURA_PT, ANCORA_ALTURA_PT);
  assert.match(desenho, new RegExp(`cx="${ANCORA_LARGURA_PT * 12700}"`));
  assert.match(desenho, new RegExp(`cy="${ANCORA_ALTURA_PT * 12700}"`));
});

test('o relacionamento aponta o PNG, e entra antes do fecho', () => {
  const ancoras = plantarAncoras(doc('[[ASSINATURA]]')).ancoras;
  const rels = relacionamentosDasAncoras(ancoras);
  assert.match(rels, /Type="[^"]*\/image"/);
  assert.match(rels, new RegExp(`Id="${ancoras[0].relId}"`));

  const base = '<?xml version="1.0"?><Relationships><Relationship Id="rId1"/></Relationships>';
  const juntos = comRelacionamentos(base, rels);
  assert.ok(juntos.indexOf(ancoras[0].relId) < juntos.indexOf('</Relationships>'));
  assert.equal((juntos.match(/<\/Relationships>/g) ?? []).length, 1);
});

test('sem âncoras, os rels ficam intocados', () => {
  const base = '<Relationships></Relationships>';
  assert.equal(comRelacionamentos(base, relacionamentosDasAncoras([])), base);
});

test('o PNG é declarado no Content_Types — uma vez só', () => {
  // Pacote sem a extensão declarada é inválido; declarar duas vezes também.
  const semPng = '<?xml version="1.0"?><Types><Default Extension="xml" '
    + 'ContentType="application/xml"/></Types>';
  const comPng = comTipoPng(semPng);
  assert.equal((comPng.match(/Extension="png"/g) ?? []).length, 1);
  assert.equal(comTipoPng(comPng), comPng, 'declarar de novo não pode duplicar');
});

test('nosDeTexto ignora `<w:t/>` vazio e respeita xml:space', () => {
  const xml = '<w:p><w:r><w:t/></w:r><w:r><w:t xml:space="preserve">  a  </w:t></w:r></w:p>';
  assert.deepEqual(nosDeTexto(xml).map((n) => n.texto), ['  a  ']);
});

// ── A âncora é um PONTO, e a caixa é derivada dela ──────────────────────────

test('a âncora é de 1 pt — foi isso que salvou a paginação', () => {
  // MEDIDO em 04/09/2026 contra o `ConvertToPdf` de verdade: com âncora de
  // 40 pt o `kit-trabalhista-source.docx` saiu com 3 páginas; com 1 pt, com as
  // 2 originais. Uma âncora que cresce muda o documento que ela deveria só
  // marcar — e o defeito é silencioso, porque o PDF sai bonito.
  assert.equal(ANCORA_ALTURA_PT, 1);
  assert.equal(ANCORA_LARGURA_PT, 1);
});

test('a assinatura cresce para CIMA e para a direita da âncora', () => {
  // A âncora é o canto inferior esquerdo. Crescer para baixo colocaria a
  // rubrica por cima do "Nome:" que costuma vir logo abaixo da linha.
  const c = caixaDaAssinatura({ x: 100, y: 200 }, 595, 842);
  assert.equal(c.x, 100);
  assert.equal(c.y, 200);          // a base fica NA âncora
  assert.equal(c.largura, 160);
  assert.equal(c.altura, 40);
});

test('marcador colado na margem direita não desenha para fora do papel', () => {
  const c = caixaDaAssinatura({ x: 580, y: 100 }, 595, 842);
  assert.ok(c.x + c.largura <= 595, 'vazou pela direita');
  assert.equal(c.x, 595 - 160);
});

test('marcador no topo não empurra a caixa para fora pela borda de cima', () => {
  const c = caixaDaAssinatura({ x: 10, y: 830 }, 595, 842);
  assert.ok(c.y + c.altura <= 842, 'vazou por cima');
});

test('página menor que a caixa encolhe a caixa, não estoura', () => {
  const c = caixaDaAssinatura({ x: 0, y: 0 }, 100, 20);
  assert.equal(c.largura, 100);
  assert.equal(c.altura, 20);
  assert.equal(c.x, 0);
  assert.equal(c.y, 0);
});
