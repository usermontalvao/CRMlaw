/**
 * Navegação do módulo Nextcloud: normalização de caminho, leitura dos
 * parâmetros de link direto e histórico voltar/avançar.
 *
 * Sem DOM e sem imports — é a lógica que o `NextcloudBrowser` consome e que os
 * testes (`nextcloudNavigation.test.ts`) cobrem.
 */

/** Estado do histórico de pastas (padrão explorador de arquivos). */
export type FolderHistory = {
  /** Caminhos visitados, do mais antigo ao mais novo. */
  entries: string[];
  /** Posição atual dentro de `entries`. */
  index: number;
};

/** Quantas pastas o histórico guarda antes de descartar as mais antigas. */
export const FOLDER_HISTORY_LIMIT = 60;

/**
 * Forma canônica de um caminho de pasta: sem barra no começo/fim, sem barras
 * duplicadas, sem segmentos vazios. A raiz é a string vazia.
 *
 * Importa porque o caminho pode chegar de fontes diferentes (vínculo salvo no
 * banco, breadcrumb, link direto do perfil do cliente) e o breadcrumb, o
 * histórico e o cache de rolagem comparam caminhos por igualdade de string.
 */
export function normalizeFolderPath(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.')
    .join('/');
}

/** Pasta pai de um caminho. Retorna `null` quando já está na raiz. */
export function parentFolderPath(path: string): string | null {
  const normalized = normalizeFolderPath(path);
  if (!normalized) return null;
  const cut = normalized.lastIndexOf('/');
  return cut < 0 ? '' : normalized.slice(0, cut);
}

export type NextcloudNavParams = {
  /** Pasta a abrir (já normalizada). */
  path: string;
};

/**
 * Lê os parâmetros de navegação do módulo (`moduleParams.nextcloud`).
 *
 * Retorna `null` quando não há link direto — nesse caso o módulo restaura a
 * última sessão. Parâmetro inválido também vira `null`: abrir na raiz é melhor
 * do que abrir numa pasta inventada.
 */
export function parseNextcloudNavParams(raw: string | null | undefined): NextcloudNavParams | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { path?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.path !== 'string') return null;
    return { path: normalizeFolderPath(parsed.path) };
  } catch {
    return null;
  }
}

/** Histórico inicial, ancorado na pasta em que o módulo abriu. */
export function createFolderHistory(initialPath: string): FolderHistory {
  return { entries: [normalizeFolderPath(initialPath)], index: 0 };
}

/**
 * Registra uma navegação.
 *
 * Regras de explorador de arquivos: entrar na mesma pasta não cria entrada
 * nova; navegar depois de voltar descarta o "avançar" (o futuro deixou de
 * existir); e o histórico tem teto para não crescer sem fim.
 */
export function pushFolderHistory(history: FolderHistory, path: string): FolderHistory {
  const normalized = normalizeFolderPath(path);
  const safeIndex = Math.max(0, Math.min(history.index, history.entries.length - 1));
  if (history.entries[safeIndex] === normalized) {
    return history.index === safeIndex ? history : { entries: history.entries, index: safeIndex };
  }
  const kept = history.entries.slice(0, safeIndex + 1);
  kept.push(normalized);
  const overflow = Math.max(0, kept.length - FOLDER_HISTORY_LIMIT);
  const entries = overflow ? kept.slice(overflow) : kept;
  return { entries, index: entries.length - 1 };
}

export function canGoBack(history: FolderHistory): boolean {
  return history.index > 0;
}

export function canGoForward(history: FolderHistory): boolean {
  return history.index < history.entries.length - 1;
}

/**
 * Anda no histórico. Retorna o novo estado e o caminho de destino, ou `null`
 * quando o movimento é impossível (assim o chamador não navega para lugar
 * nenhum nem embaralha o índice).
 */
export function stepFolderHistory(
  history: FolderHistory,
  direction: -1 | 1,
): { history: FolderHistory; path: string } | null {
  const nextIndex = history.index + direction;
  if (nextIndex < 0 || nextIndex > history.entries.length - 1) return null;
  return {
    history: { entries: history.entries, index: nextIndex },
    path: history.entries[nextIndex],
  };
}

/** Caminho atual segundo o histórico (raiz quando o estado está corrompido). */
export function currentFolderPath(history: FolderHistory): string {
  return history.entries[history.index] ?? '';
}
