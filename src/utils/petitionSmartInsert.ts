// Inserção "inteligente" de texto do Assistente IA no Editor de Petições.
//
// Resolve dois problemas do insert simples no fim do documento:
// 1. LUGAR — petição termina com fecho (Termos em que / data / assinatura /
//    OAB). "position: end" precisa inserir ANTES desse bloco, não depois.
// 2. FORMATAÇÃO — texto puro herdaria a formatação do ponto onde caiu (ex.:
//    data centralizada). Aqui os títulos (linhas em caixa alta) espelham o
//    estilo dos títulos que JÁ existem no documento, e os parágrafos espelham
//    o corpo (alinhamento, recuo de primeira linha, entrelinha).
//
// Trabalha direto na API do Syncfusion DocumentEditor (getEditor() do
// SyncfusionEditorRef): selection.characterFormat / paragraphFormat e
// search.findAll — os mesmos mecanismos usados por replaceAll e pelo paste
// com herança de formatação do editor.

interface HeadingStyle {
  bold?: boolean;
  textAlignment?: string;
  beforeSpacing?: number;
  afterSpacing?: number;
}

interface BodyStyle {
  textAlignment?: string;
  firstLineIndent?: number;
  lineSpacing?: number;
  lineSpacingType?: string;
  beforeSpacing?: number;
  afterSpacing?: number;
}

/** Linha de título de tópico: curta e com todas as letras em caixa alta. */
const isHeadingLine = (line: string): boolean => {
  const t = line.trim();
  if (t.length < 4 || t.length > 120) return false;
  const letters = t.replace(/[^A-Za-zÀ-ú]/g, '');
  if (letters.length < 3) return false;
  return letters === letters.toUpperCase();
};

/** Linha que pertence ao fecho da petição (encerramento/data/assinatura). */
const isClosingLine = (line: string): boolean => {
  const t = line.trim();
  if (!t) return false;
  if (/^(nestes\s+termos|termos\s+em\s+que)/i.test(t)) return true;
  if (/pede[\s,]+(e\s+espera\s+)?deferimento/i.test(t)) return true;
  if (/^p\.?\s*deferimento/i.test(t)) return true;
  if (/\boab[\s./-]*n?[ºo°.]?\s*[\d.]/i.test(t) || /\boab\/[a-z]{2}\b/i.test(t)) return true;
  if (/\badvogad[oa]s?\b/i.test(t) && t.length <= 120) return true;
  // "Cuiabá - MT, 12 de julho de 2026" / "Cuiabá- MT, domingo, 12 de julho de 2026"
  if (/,?\s*\d{1,2}\s+de\s+[a-zçã]+\s+de\s+\d{4}/i.test(t) && t.length <= 120) return true;
  return false;
};

/**
 * Encontra a PRIMEIRA linha do bloco de fecho no final do documento.
 * Varre de baixo para cima aceitando linhas de fecho e até 2 linhas curtas
 * intercaladas (nome do advogado entre a data e a OAB, por exemplo) — mas o
 * bloco só se estende por essas linhas se houver outra linha de fecho acima.
 */
export const findClosingLine = (documentText: string): string | null => {
  const lines = String(documentText || '').replace(/\r\n?/g, '\n').split('\n');
  let closingIdx = -1;
  let gap = 0;

  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (isClosingLine(t)) {
      closingIdx = i;
      gap = 0;
      continue;
    }
    if (closingIdx >= 0 && gap < 2 && t.length <= 80) {
      gap++;
      continue;
    }
    break;
  }

  return closingIdx >= 0 ? lines[closingIdx].trim() : null;
};

/** Seleciona uma ocorrência de `text` no documento (via search.findAll). */
const selectMatch = (de: any, text: string, last: boolean): boolean => {
  const search = de?.search ?? de?.searchModule;
  const results = search?.searchResults;
  if (!search || typeof search.findAll !== 'function' || !results) return false;
  try {
    search.findAll(text);
    const count = Number(results.length || 0);
    if (count === 0) {
      try { results.clear?.(); } catch { /* ignore */ }
      return false;
    }
    results.index = last ? count - 1 : 0; // navegar pelo index move a seleção
    const sel = de.selection;
    const start = String(sel?.startOffset || '');
    const end = String(sel?.endOffset || '');
    try { results.clear?.(); } catch { /* ignore */ }
    if (sel && start && end) sel.select(start, end); // garante a seleção após o clear
    return true;
  } catch {
    try { results.clear?.(); } catch { /* ignore */ }
    return false;
  }
};

/**
 * Posiciona o cursor (colapsado) imediatamente ANTES do bloco de fecho.
 * Retorna false se o documento não tem fecho reconhecível.
 */
export const moveCursorToSmartEnd = (de: any, documentText: string): boolean => {
  const closing = findClosingLine(documentText);
  if (!closing || !de?.selection) return false;
  if (!selectMatch(de, closing, true)) return false;
  try {
    const sel = de.selection;
    const start = String(sel.startOffset || '');
    if (!start) return false;
    sel.select(start, start);
    return true;
  } catch {
    return false;
  }
};

/** Lê os estilos de referência do documento: um título existente e um parágrafo de corpo. */
const sniffDocumentStyles = (de: any, documentText: string): { heading: HeadingStyle | null; body: BodyStyle | null } => {
  const lines = String(documentText || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  const headingLine = lines.find((l) => isHeadingLine(l) && !isClosingLine(l));
  const bodyLine = lines.find((l) => l.length >= 120 && !isHeadingLine(l) && !isClosingLine(l));

  const readFormats = (line: string | undefined): { cf: any; pf: any } | null => {
    if (!line || !selectMatch(de, line, false)) return null;
    try {
      return { cf: de.selection?.characterFormat, pf: de.selection?.paragraphFormat };
    } catch {
      return null;
    }
  };

  let heading: HeadingStyle | null = null;
  const h = readFormats(headingLine);
  if (h) {
    heading = {
      bold: typeof h.cf?.bold === 'boolean' ? h.cf.bold : true,
      textAlignment: typeof h.pf?.textAlignment === 'string' ? h.pf.textAlignment : undefined,
      beforeSpacing: typeof h.pf?.beforeSpacing === 'number' ? h.pf.beforeSpacing : undefined,
      afterSpacing: typeof h.pf?.afterSpacing === 'number' ? h.pf.afterSpacing : undefined,
    };
  }

  let body: BodyStyle | null = null;
  const b = readFormats(bodyLine);
  if (b) {
    body = {
      textAlignment: typeof b.pf?.textAlignment === 'string' ? b.pf.textAlignment : undefined,
      firstLineIndent: typeof b.pf?.firstLineIndent === 'number' ? b.pf.firstLineIndent : undefined,
      lineSpacing: typeof b.pf?.lineSpacing === 'number' ? b.pf.lineSpacing : undefined,
      lineSpacingType: typeof b.pf?.lineSpacingType === 'string' ? b.pf.lineSpacingType : undefined,
      beforeSpacing: typeof b.pf?.beforeSpacing === 'number' ? b.pf.beforeSpacing : undefined,
      afterSpacing: typeof b.pf?.afterSpacing === 'number' ? b.pf.afterSpacing : undefined,
    };
  }

  return { heading, body };
};

/**
 * Insere texto do assistente no FINAL "inteligente" da petição: antes do
 * fecho, com títulos e parágrafos espelhando os estilos do documento.
 * Retorna false quando não conseguiu (o chamador usa o insert simples).
 */
export const insertPetitionTextSmart = (de: any, documentText: string, text: string): boolean => {
  const payload = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!payload || !de?.editor || typeof de.editor.insertText !== 'function' || !de?.selection) return false;

  try {
    // 1. Estilos de referência (mexe na seleção — antes de posicionar o cursor).
    const styles = sniffDocumentStyles(de, documentText);

    // 2. Ponto de inserção: antes do fecho; sem fecho, fim do documento com
    //    parágrafo novo (comportamento antigo).
    const placedBeforeClosing = moveCursorToSmartEnd(de, documentText);
    if (!placedBeforeClosing) {
      try { de.selection.moveToDocumentEnd?.(); } catch { /* ignore */ }
      de.editor.insertText('\n');
    }

    const sel = de.selection;
    const paragraphs = payload.split('\n');

    try { de.editorHistory?.beginUndoAction?.(); } catch { /* ignore */ }

    for (let i = 0; i < paragraphs.length; i++) {
      const par = paragraphs[i];
      const isLast = i === paragraphs.length - 1;
      const parStart = String(sel.startOffset || '');

      if (par.trim()) {
        de.editor.insertText(par);

        // Negrito do título aplicado só no trecho inserido.
        const parEnd = String(sel.endOffset || '');
        const heading = isHeadingLine(par);
        if (heading && parStart && parEnd) {
          sel.select(parStart, parEnd);
          try { if (sel.characterFormat) sel.characterFormat.bold = styles.heading?.bold ?? true; } catch { /* ignore */ }
          sel.select(parEnd, parEnd);
        }

        // Separa do parágrafo seguinte (no caso do fecho, devolve o fecho ao
        // próprio parágrafo). Sem fecho, o último parágrafo já é o último do
        // documento e dispensa a quebra.
        let nextStart = '';
        if (placedBeforeClosing || !isLast) {
          de.editor.insertText('\n');
          nextStart = String(sel.startOffset || '');
        }

        // Formatação de parágrafo aplicada com o parágrafo já isolado.
        if (parStart) {
          sel.select(parStart, parStart);
          const pf = sel.paragraphFormat;
          if (pf) {
            const ref = heading ? styles.heading : styles.body;
            try {
              if (heading) {
                if (typeof pf.firstLineIndent === 'number') pf.firstLineIndent = 0;
                pf.textAlignment = styles.heading?.textAlignment ?? pf.textAlignment;
              } else {
                pf.textAlignment = styles.body?.textAlignment ?? 'Justify';
                if (typeof styles.body?.firstLineIndent === 'number') pf.firstLineIndent = styles.body.firstLineIndent;
                if (typeof styles.body?.lineSpacingType === 'string' && styles.body.lineSpacingType) pf.lineSpacingType = styles.body.lineSpacingType;
                if (typeof styles.body?.lineSpacing === 'number' && styles.body.lineSpacing > 0) pf.lineSpacing = styles.body.lineSpacing;
              }
              if (typeof ref?.beforeSpacing === 'number') pf.beforeSpacing = ref.beforeSpacing;
              if (typeof ref?.afterSpacing === 'number') pf.afterSpacing = ref.afterSpacing;
            } catch { /* ignore */ }
          }
        }

        if (nextStart) sel.select(nextStart, nextStart);
      } else if (placedBeforeClosing || !isLast) {
        // Linha em branco vira parágrafo vazio (espaçamento entre blocos).
        de.editor.insertText('\n');
      }
    }

    // Documento separa seções com parágrafo vazio — mantém o padrão antes do fecho.
    if (placedBeforeClosing && !/\n\s*$/.test(payload)) {
      de.editor.insertText('\n');
    }

    try { de.editorHistory?.endUndoAction?.(); } catch { /* ignore */ }
    return true;
  } catch {
    try { de.editorHistory?.endUndoAction?.(); } catch { /* ignore */ }
    return false;
  }
};
