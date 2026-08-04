// Persistência dos filtros da inbox do WhatsApp. Lógica pura (sem React e sem
// imports do projeto) para poder ser testada — o acesso ao localStorage fica em
// funções finas no fim do arquivo.
//
// O ponto delicado não é gravar, é RESTAURAR: um canal, setor ou etiqueta salvo
// pode ter sido removido/renomeado desde a última sessão. Restaurar um valor
// órfão deixaria a lista vazia sem explicação — o atendente veria "nenhuma
// conversa" e nada indicando o porquê. Por isso todo valor restaurado é
// conferido contra o que existe hoje, caindo para "todos" quando não existe.

export const INBOX_FILTER_KEYS = {
  channel: 'wa_channel_filter',
  dept: 'wa_dept_filter',
  label: 'wa_label_filter',
  panelOpen: 'wa_filters_open',
  leadChannel: 'wa_lead_channel_filter',
} as const;

/** Canal: 'all' ou um id que ainda exista. */
export function sanitizeChannelFilter(stored: string | null, channelIds: string[]): string {
  if (!stored || stored === 'all') return 'all';
  return channelIds.includes(stored) ? stored : 'all';
}

/** Setor: 'all', 'none' (sem setor) ou um id que ainda exista. */
export function sanitizeDeptFilter(stored: string | null, departmentIds: string[]): string {
  if (!stored || stored === 'all') return 'all';
  if (stored === 'none') return 'none';
  return departmentIds.includes(stored) ? stored : 'all';
}

/** Etiqueta: '' (sem filtro) ou uma etiqueta que ainda exista no funil. */
export function sanitizeLabelFilter(stored: string | null, labelKeys: string[]): string {
  if (!stored) return '';
  return labelKeys.includes(stored) ? stored : '';
}

/**
 * A conferência só vale depois que as listas chegaram do servidor: enquanto
 * `channels`/`departments` estão vazios por carregamento, todo valor pareceria
 * órfão e o filtro salvo seria descartado antes de ter chance de valer.
 */
export function canSanitize(available: unknown[]): boolean {
  return available.length > 0;
}

// ── Acesso ao armazenamento (fino de propósito) ──────────────────────
export function readFilter(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeFilter(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage indisponível */ }
}
