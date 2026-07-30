/**
 * Texto POSICIONADO da árvore de widgets do Syncfusion — a matéria-prima da
 * camada pesquisável do PDF.
 *
 * A conversão Word->PDF desenha cada página como imagem e escreve o texto por
 * cima, invisível (ver `pdfTextLayer.ts`). Para o PDF ser pesquisável DE
 * VERDADE, cada trecho precisa cair exatamente sobre a palavra desenhada. Logo,
 * este módulo tem uma única obrigação: reproduzir a conta que o renderizador do
 * Syncfusion faz para desenhar.
 *
 * O BUG QUE ISTO CORRIGE: a versão anterior lia `line.x` / `line.y` do
 * `LineWidget`. Essas propriedades existem na tipagem do EJ2, mas o layout NUNCA
 * as preenche — nascem 0 no construtor e ficam 0. Resultado: todo o texto da
 * página ia para o canto superior esquerdo, empilhado. O PDF abria com a imagem
 * certa e nenhum texto selecionável sobre o corpo do documento, ou seja,
 * indistinguível de um digitalizado sem OCR.
 *
 * A posição real vem do `ParagraphWidget` (`x`/`y`, que o layout preenche) mais
 * a soma das alturas das linhas, exatamente como
 * `Renderer.renderParagraphWidget` -> `renderLine` -> `renderTextElementBox`:
 *
 *     top = paragraph.y;  left = paragraph.x
 *     para cada linha:  top += linha.marginTop;  ...;  top += linha.height
 *     na 1ª linha (LTR): left += firstLineIndent
 *     para cada elemento: left += padding.left
 *                         desenha em (left + margin.left, top + margin.top + baselineOffset)
 *                         left += width + margin.left
 *
 * Coordenadas de saída: px CSS (96 dpi) RELATIVAS À PÁGINA — é a mesma origem da
 * imagem exportada, porque `exportAsImage` renderiza a página em (0, 0) com
 * `isPrinting`, e nesse modo o renderizador usa os valores dos widgets crus.
 *
 * Este módulo é PURO e SEM IMPORT RELATIVO de propósito: é a única forma de
 * testá-lo com `node --test --import ts-node/esm` (import relativo sem extensão
 * na cadeia quebra o runner). Conversão para mm, normalização do texto e junção
 * de trechos vizinhos ficam com quem chama.
 *
 * A árvore é API interna do EJ2, então tudo aqui é defensivo e por "duck
 * typing": se a estrutura mudar numa atualização, a extração devolve vazio e a
 * conversão continua gerando o PDF (só sem camada de texto) em vez de falhar.
 */

/** Um trecho de texto medido em px CSS, com a linha de base em `baselinePx`. */
export type WidgetTextRun = {
  text: string;
  xPx: number;
  /** Linha de base (não o topo) — é como PDF e canvas posicionam texto. */
  baselinePx: number;
  widthPx: number;
  fontSizePt: number;
  bold: boolean;
  italic: boolean;
  /** Fonte declarada no documento; o chamador mapeia para a fonte do PDF. */
  fontFamily: string | null;
};

type UnknownRecord = Record<string, unknown>;

/** Trava contra estrutura circular / aninhamento absurdo de tabelas. */
const MAX_DEPTH = 40;

/** px CSS por ponto (96 dpi / 72 pt) — o `convertPointToPixel` do EJ2. */
const PX_PER_POINT = 96 / 72;

/** Sobrescrito/subscrito são desenhados com a fonte reduzida por este fator. */
const BASELINE_ALIGNMENT_FACTOR = 1.5;

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === 'object' ? (value as UnknownRecord) : null;

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Número com padrão — mede tudo que é opcional na árvore (margem, recuo). */
const numberOr = (value: unknown, fallback: number): number => asNumber(value) ?? fallback;

/**
 * Percorre widgets recursivamente juntando os parágrafos (inclusive de tabela).
 *
 * Um `ParagraphWidget` se reconhece pelos filhos: `LineWidget` é o único widget
 * do EJ2 com a propriedade `children`. Tabela, linha e célula caem na recursão.
 */
function collectParagraphs(node: unknown, output: UnknownRecord[], depth = 0): void {
  if (depth > MAX_DEPTH) return;
  const record = asRecord(node);
  if (!record) return;

  const children = record.childWidgets;
  if (Array.isArray(children)) {
    const isParagraph = children.some((child) => {
      const line = asRecord(child);
      return Boolean(line && Array.isArray(line.children));
    });
    if (isParagraph) {
      output.push(record);
      return;
    }
    for (const child of children) collectParagraphs(child, output, depth + 1);
  }

  // `rows`/`cells`/`bodyWidgets` aparecem em versões diferentes do EJ2.
  for (const key of ['rows', 'cells', 'bodyWidgets']) {
    const list = record[key];
    if (Array.isArray(list)) for (const item of list) collectParagraphs(item, output, depth + 1);
  }
}

/** Elementos na ordem em que são desenhados (`renderedElements` reordena RTL). */
function lineElements(line: UnknownRecord): unknown[] {
  const rendered = line.renderedElements;
  if (Array.isArray(rendered) && rendered.length) return rendered;
  return Array.isArray(line.children) ? line.children : [];
}

/**
 * `true` quando o elemento é um marcador de campo (`FieldElementBox`).
 *
 * Reconhecido pelo `fieldType`: 0 = início, 1 = separador, 2 = fim.
 */
const isFieldElement = (element: UnknownRecord): boolean => asNumber(element.fieldType) !== null;

/** Imagem (`ImageElementBox`) — a única que conserva largura dentro do campo. */
const isImageElement = (element: UnknownRecord): boolean => typeof element.imageString === 'string';

/** Trechos de um parágrafo já paginado, na ordem do documento. */
function collectParagraphRuns(paragraph: UnknownRecord, output: WidgetTextRun[]): void {
  const paragraphX = asNumber(paragraph.x);
  const paragraphY = asNumber(paragraph.y);
  // Sem posição não há como escrever a camada no lugar certo; pular é melhor
  // que empilhar texto no canto da página (era justamente o defeito antigo).
  if (paragraphX === null || paragraphY === null) return;

  const lines = Array.isArray(paragraph.childWidgets) ? paragraph.childWidgets : [];
  const format = asRecord(paragraph.paragraphFormat);
  const bidi = format?.bidi === true;
  const firstLineIndentPx = numberOr(format?.firstLineIndent, 0) * PX_PER_POINT;

  // O código do campo (o "MERGEFIELD Nome" entre início e separador) não é
  // desenhado. O estado atravessa linhas porque um campo pode quebrar de linha.
  let inFieldCode = false;
  let top = paragraphY;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = asRecord(lines[lineIndex]);
    if (!line) continue;

    top += numberOr(line.marginTop, 0);
    // O recuo de primeira linha entra depois do x do parágrafo, e só na
    // primeira linha de um parágrafo da esquerda para a direita.
    let left = paragraphX + (lineIndex === 0 && !bidi ? firstLineIndentPx : 0);

    for (const rawElement of lineElements(line)) {
      const element = asRecord(rawElement);
      if (!element) continue;

      const margin = asRecord(element.margin);
      const marginLeft = numberOr(margin?.left, 0);
      const marginTop = numberOr(margin?.top, 0);
      const width = numberOr(element.width, 0);
      const height = numberOr(element.height, 0);
      const isField = isFieldElement(element);

      // Marcador de campo, texto dentro do código do campo e elemento sem
      // dimensão nenhuma: não desenham, só avançam o cursor. Dentro do código
      // do campo a largura é tratada como 0 (o renderizador zera).
      if (isField || inFieldCode || (width === 0 && height === 0)) {
        left += (inFieldCode && !isImageElement(element) ? 0 : width) + marginLeft;
        if (isField) {
          const fieldType = asNumber(element.fieldType);
          if (fieldType === 0) {
            // Só entra em código de campo se o campo tiver fim: um início órfão
            // engoliria o resto do parágrafo.
            inFieldCode = Boolean(element.fieldEnd) || element.hasFieldEnd === true;
          } else if (fieldType === 1 || fieldType === 2) {
            inFieldCode = false;
          }
        }
        continue;
      }

      // `padding.left` entra ANTES do desenho e permanece no acumulador.
      left += numberOr(asRecord(element.padding)?.left, 0);

      const text = typeof element.text === 'string' ? element.text : null;
      if (text !== null && text.length > 0 && width > 0) {
        const charFormat = asRecord(element.characterFormat);
        const alignment = typeof charFormat?.baselineAlignment === 'string'
          ? charFormat.baselineAlignment
          : 'Normal';
        const isNormalBaseline = alignment === 'Normal';
        // `baselineOffset` é o que o renderizador usa. Sem ele, aproxima-se pela
        // altura do elemento — a camada é invisível, então basta cair sobre a
        // palavra para busca e seleção funcionarem.
        const baselineOffset = numberOr(element.baselineOffset, height * 0.82);
        let offsetTop = marginTop;
        if (alignment === 'Subscript') offsetTop += height - height / BASELINE_ALIGNMENT_FACTOR;
        offsetTop += isNormalBaseline ? baselineOffset : baselineOffset / BASELINE_ALIGNMENT_FACTOR;
        const fontSize = numberOr(charFormat?.fontSize, 12);

        output.push({
          text,
          xPx: left + marginLeft,
          baselinePx: top + offsetTop,
          widthPx: width,
          fontSizePt: isNormalBaseline ? fontSize : fontSize / BASELINE_ALIGNMENT_FACTOR,
          bold: charFormat?.bold === true,
          italic: charFormat?.italic === true,
          fontFamily: typeof charFormat?.fontFamily === 'string' ? charFormat.fontFamily : null,
        });
      }

      left += width + marginLeft;
    }

    top += numberOr(line.height, 0);
  }
}

/**
 * Todo o texto posicionado de uma página do Syncfusion, em px CSS.
 *
 * Inclui corpo, cabeçalho, rodapé e notas: número de processo, OAB e endereço do
 * rodapé também precisam ser pesquisáveis.
 */
export function extractPageWidgetTextRuns(page: unknown): WidgetTextRun[] {
  const runs: WidgetTextRun[] = [];
  const pageRecord = asRecord(page);
  if (!pageRecord) return runs;

  const containers: unknown[] = [];
  if (Array.isArray(pageRecord.bodyWidgets)) containers.push(...pageRecord.bodyWidgets);
  // São os MESMOS objetos que o renderizador desenha. `headerWidget` é um atalho
  // que pode devolver o próprio `headerWidgetIn` — usar os dois duplicaria o
  // cabeçalho inteiro na camada de texto.
  for (const key of ['headerWidgetIn', 'footerWidgetIn', 'footnoteWidget', 'endnoteWidget']) {
    if (pageRecord[key]) containers.push(pageRecord[key]);
  }

  const paragraphs: UnknownRecord[] = [];
  for (const container of containers) collectParagraphs(container, paragraphs);
  for (const paragraph of paragraphs) collectParagraphRuns(paragraph, runs);

  return runs;
}
