// Normalização do texto que o Assistente IA propõe escrever/remover no
// Editor de Petições.
//
// O modelo às vezes responde com markdown (**negrito**, "###") ou devolve uma
// estrutura inteira numa ÚNICA linha ("1. PREÂMBULO - Identificação das partes
// - Qualificação ... 2. DOS FATOS ..."). Inserido assim, o documento vira um
// parágrafo só — sem títulos, sem hierarquia. Aqui o texto é devolvido ao
// formato que o editor entende: um parágrafo por linha, sem marcação.
//
// Tudo aqui é PURO (sem editor, sem DOM) para poder ser testado isoladamente.

/** Marcador de item de lista no começo de uma linha ("- ", "1. ", "• "). */
const LEADING_MARKER = /^\s*(?:[-–—•*]|\d{1,2}[.)])\s+/;

/**
 * Remove a marcação markdown que não tem sentido num documento .docx.
 * Preserva variáveis [[COMO_ESTA]] e o sublinhado interno de palavras
 * (VALOR_TOTAL continua VALOR_TOTAL).
 */
export const stripMarkdownForDocument = (input: string): string => {
  let text = String(input || '');

  // Cercas de código inteiras (```...```), que nunca fazem parte de uma peça.
  text = text.replace(/^[ \t]*```[^\n]*\n?/gm, '');
  // Código inline: `art. 477` → art. 477
  text = text.replace(/`([^`\n]+)`/g, '$1');
  // Títulos e citações markdown no começo da linha.
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  text = text.replace(/^[ \t]*>[ \t]?/gm, '');
  // Linha divisória (---, ***, ___) vira linha vazia.
  text = text.replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '');
  // Ênfase: **x**, __x__, *x*, e _x_ apenas quando isolado por não-palavra.
  text = text.replace(/\*\*([^\n*]+)\*\*/g, '$1');
  text = text.replace(/__([^\n_]+)__/g, '$1');
  text = text.replace(/(^|[\s(["'])\*([^\n*]+)\*(?=$|[\s).,;:!?\]"'])/g, '$1$2');
  text = text.replace(/(^|[\s(["'])_([^\n_]+)_(?=$|[\s).,;:!?\]"'])/g, '$1$2');
  // Link markdown: [texto](url) → texto
  text = text.replace(/\[([^\]\n]+)\]\((?:[^)\n]*)\)/g, '$1');
  // Marcador de lista "* " no começo da linha vira "- " (padrão do editor).
  text = text.replace(/^([ \t]*)\*[ \t]+/gm, '$1- ');

  return text;
};

/**
 * Conta os marcadores de tópico que aparecem NO MEIO de uma linha — o sinal de
 * que uma estrutura inteira veio achatada em um parágrafo só.
 */
const countInlineMarkers = (line: string): { numbered: number; bullets: number } => {
  let numbered = 0;
  let bullets = 0;
  // Só conta marcador precedido de espaço (nunca o do início da linha) para
  // não confundir com "2.4 – DA MULTA", que é um título legítimo.
  const re = /\s(?:(\d{1,2}[.)])|([-–—•])) +(?=\S)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    if (match[1]) numbered += 1;
    else bullets += 1;
  }
  return { numbered, bullets };
};

/**
 * Reconstrói as quebras de linha de uma estrutura achatada.
 *
 * Só age quando a linha tem cara de sumário/estrutura: vários marcadores
 * numerados ou muitos marcadores de lista. Um parágrafo jurídico comum
 * ("...art. 7º, XVI – CF...") não atinge o limiar e passa intacto.
 */
export const explodeInlineOutline = (line: string): string => {
  const text = String(line || '');
  if (text.includes('\n')) return text;

  const { numbered, bullets } = countInlineMarkers(text);
  const isOutline = numbered >= 2 || bullets >= 3 || (numbered >= 1 && bullets >= 2);
  if (!isOutline) return text;

  const parts = text
    .split(/\s+(?=(?:\d{1,2}[.)]|[-–—•]) +\S)/g)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 1 ? parts.join('\n') : text;
};

/**
 * Prepara o texto de uma ação "insert" para entrar no documento:
 * markdown removido, estrutura achatada desdobrada em parágrafos e espaços
 * em branco normalizados.
 */
export const normalizeAiInsertText = (input: string): string => {
  const stripped = stripMarkdownForDocument(String(input || '')).replace(/\r\n?/g, '\n');

  const lines = stripped
    .split('\n')
    .flatMap((line) => explodeInlineOutline(line).split('\n'))
    .map((line) => line.replace(/[ \t]+$/g, ''));

  // No máximo uma linha em branco entre blocos.
  const compacted: string[] = [];
  for (const line of lines) {
    if (!line.trim() && !compacted.length) continue;
    if (!line.trim() && !compacted[compacted.length - 1]?.trim()) continue;
    compacted.push(line);
  }

  return compacted.join('\n').trim();
};

/**
 * Quebra um trecho a REMOVER em pedaços aplicáveis um a um.
 *
 * A busca do editor não atravessa marca de parágrafo: quando a remoção por
 * intervalo falha, cada parágrafo é apagado separadamente. Pedaços curtos
 * demais são descartados — apagar "de" no documento inteiro seria destrutivo.
 */
export const splitDeletionChunks = (input: string, minLength = 6): string[] => {
  return String(input || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((chunk) => chunk.replace(LEADING_MARKER, '').trim())
    .filter((chunk) => chunk.length >= minLength);
};

/**
 * Âncoras de início e fim de um intervalo a remover/substituir.
 *
 * O editor localiza o intervalo por duas buscas curtas (primeira e última
 * linha do trecho) e seleciona tudo que houver entre elas — inclusive as
 * quebras de parágrafo, que nenhuma busca única alcançaria.
 */
export const rangeAnchors = (
  input: string,
  explicitEnd?: string,
  maxAnchor = 80,
): { start: string; end: string } | null => {
  const text = String(input || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return null;

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;

  const clampStart = (value: string) => value.slice(0, maxAnchor).trim();
  const clampEnd = (value: string) => (
    value.length > maxAnchor ? value.slice(value.length - maxAnchor).trim() : value.trim()
  );

  const start = clampStart(lines[0]);
  const explicit = String(explicitEnd || '').trim();
  const end = explicit ? clampEnd(explicit) : clampEnd(lines[lines.length - 1]);

  return start && end ? { start, end } : null;
};

/** Trecho ocupa mais de um parágrafo — busca simples do editor não alcança. */
export const spansParagraphs = (input: string): boolean =>
  String(input || '').replace(/\r\n?/g, '\n').trim().includes('\n');
