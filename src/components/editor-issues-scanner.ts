/**
 * Editor Issues Scanner — detecta problemas de estilo que não são
 * cobertos pelo spell-check tradicional (palavra-por-palavra):
 *   - Espaços duplos (ou triplos)
 *   - Espaço antes de pontuação (".", ",", ";", ":", "?", "!")
 *   - Linhas em branco múltiplas (3+ \n consecutivos)
 *
 * Profissional: roda com debounce, expõe API para corrigir tudo ou um por um.
 */

export type IssueKind = 'double-space' | 'space-before-punct' | 'multi-blank-lines';

export interface DocumentIssue {
  kind: IssueKind;
  /** Texto exato que precisa ser substituído */
  find: string;
  /** Texto que substitui */
  replace: string;
  /** Mensagem amigável para UI */
  label: string;
}

export interface ScanResult {
  /** Issues únicas encontradas (deduped por find string) */
  issues: DocumentIssue[];
  /** Total de ocorrências (somando todas as instâncias) */
  totalOccurrences: number;
}

/**
 * Escaneia o texto e retorna issues encontradas.
 * Não muta nada — apenas analisa.
 */
export function scanDocumentText(text: string): ScanResult {
  const issues: DocumentIssue[] = [];
  let totalOccurrences = 0;

  // 1. Espaços duplos (2 ou mais)
  const doubleSpaceMatches = text.match(/ {2,}/g);
  if (doubleSpaceMatches && doubleSpaceMatches.length > 0) {
    issues.push({
      kind: 'double-space',
      find: '  ', // 2 espaços — replaceAll cuida do resto
      replace: ' ',
      label: `Espaços duplos (${doubleSpaceMatches.length})`,
    });
    totalOccurrences += doubleSpaceMatches.length;
  }

  // 2. Espaço antes de pontuação comum
  const spaceBeforePunctMatches = text.match(/ +[.,;:!?]/g);
  if (spaceBeforePunctMatches && spaceBeforePunctMatches.length > 0) {
    // Deduplica por caractere de pontuação
    const byPunct = new Map<string, number>();
    for (const m of spaceBeforePunctMatches) {
      const punct = m.charAt(m.length - 1);
      byPunct.set(punct, (byPunct.get(punct) || 0) + 1);
    }
    for (const [punct, count] of byPunct.entries()) {
      issues.push({
        kind: 'space-before-punct',
        find: ` ${punct}`,
        replace: punct,
        label: `Espaço antes de "${punct}" (${count})`,
      });
      totalOccurrences += count;
    }
  }

  return { issues, totalOccurrences };
}

/**
 * Aplica todas as correções no editor Syncfusion via search.replaceAll.
 * Retorna número de substituições feitas.
 *
 * Roda em loop pois ' ' + ' ' = '  ' pode gerar novos espaços duplos
 * ao colapsar 4 espaços em 2. Para com segurança após 10 iterações.
 */
export function autoFixIssues(editor: any, issues: DocumentIssue[]): number {
  if (!editor?.search?.replaceAll) return 0;
  let totalReplacements = 0;

  for (const issue of issues) {
    // Para double-space, precisa rodar em loop até não haver mais
    if (issue.kind === 'double-space') {
      for (let i = 0; i < 10; i++) {
        try {
          const before = countOccurrences(getEditorText(editor), '  ');
          if (before === 0) break;
          editor.search.replaceAll(issue.replace, issue.find);
          totalReplacements += before;
        } catch {
          break;
        }
      }
    } else {
      try {
        const before = countOccurrences(getEditorText(editor), issue.find);
        if (before > 0) {
          editor.search.replaceAll(issue.replace, issue.find);
          totalReplacements += before;
        }
      } catch {
        /* ignore */
      }
    }
  }

  return totalReplacements;
}

function countOccurrences(text: string, substr: string): number {
  if (!substr) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(substr, pos)) !== -1) {
    count++;
    pos += substr.length;
  }
  return count;
}

/**
 * Extrai todo o texto do editor Syncfusion.
 * Usa documentEditor.serialize() como fallback se getText não existir.
 */
function getEditorText(editor: any): string {
  try {
    if (typeof editor.serialize === 'function') {
      // SFDT é JSON — extrair só os strings de texto
      const sfdt = editor.serialize();
      try {
        const parsed = JSON.parse(sfdt);
        return extractTextFromSfdt(parsed);
      } catch {
        return '';
      }
    }
  } catch {
    /* ignore */
  }
  return '';
}

function extractTextFromSfdt(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractTextFromSfdt).join('');
  if (typeof node === 'object') {
    // SFDT inline elements têm propriedade `tlp` (texto) ou `text`
    let out = '';
    if (typeof node.tlp === 'string') out += node.tlp;
    else if (typeof node.text === 'string') out += node.text;
    for (const key of Object.keys(node)) {
      if (key === 'tlp' || key === 'text') continue;
      out += extractTextFromSfdt(node[key]);
    }
    return out;
  }
  return '';
}

/**
 * Debounce helper para evitar varrer o documento em cada keystroke.
 */
export function createDebouncedScanner(
  editor: any,
  onResult: (result: ScanResult) => void,
  delayMs = 1500
): { trigger: () => void; cancel: () => void } {
  let timer: number | null = null;

  const trigger = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      try {
        const text = getEditorText(editor);
        if (!text) {
          onResult({ issues: [], totalOccurrences: 0 });
          return;
        }
        onResult(scanDocumentText(text));
      } catch {
        onResult({ issues: [], totalOccurrences: 0 });
      }
    }, delayMs);
  };

  const cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  return { trigger, cancel };
}
