import { normalizeSearchText } from './search';
import type { EventInput } from '@fullcalendar/core';

/**
 * Aliases textuais por tipo — permitem buscar "audiencia", "prazo", etc.
 * sem acento e em minúsculas (já normalizados).
 */
const TYPE_ALIASES: Record<string, string> = {
  deadline:    'prazo prazos',
  hearing:     'audiencia audiencias',
  requirement: 'requerimento requerimentos exigencia',
  payment:     'pagamento pagamentos recebimento financeiro',
  meeting:     'reuniao reunioes',
  pericia:     'pericia pericias',
  personal:    'pessoal',
};

/** Remove tudo que não é alfanumérico — para comparar número de processo sem máscara. */
const stripMask = (v: string) => v.replace(/[^a-z0-9]/g, '');

/**
 * Constrói o corpus de busca de um EventInput como string única normalizada.
 * getResponsavel é a mesma função usada no cronograma.
 */
export const buildCalendarSearchBag = (
  event: EventInput,
  getResponsavel: (e: EventInput) => string,
): string => {
  const ep = (event.extendedProps ?? {}) as Record<string, any>;
  const raw = (ep.data ?? {}) as Record<string, any>;

  const parts: (string | null | undefined)[] = [
    event.title as string,
    ep.description,
    ep.clientName,
    getResponsavel(event),
    TYPE_ALIASES[ep.type as string] ?? ep.type,
    // Campos do dado bruto (processos, prazos, requerimentos, eventos)
    raw.process_code,
    raw.responsible_lawyer,
    raw.beneficiary,
    raw.protocol,
    raw.client_name,
    raw.description,
    raw.manual_note,
    raw.title,
  ];

  return parts
    .filter(Boolean)
    .map((p) => normalizeSearchText(p))
    .join(' ');
};

/**
 * Retorna `true` se o evento deve aparecer para a query.
 * - Ignora maiúsculas/minúsculas e acentos.
 * - Permite localizar número de processo com ou sem máscara.
 * - Query vazia → sempre match.
 */
export const matchesCalendarSearch = (
  event: EventInput,
  query: string,
  getResponsavel: (e: EventInput) => string,
): boolean => {
  const norm = normalizeSearchText(query);
  if (!norm) return true;

  const bag = buildCalendarSearchBag(event, getResponsavel);
  if (bag.includes(norm)) return true;

  // Fallback: compara número de processo sem máscara
  const raw = ((event.extendedProps ?? {}) as Record<string, any>).data as Record<string, any> | undefined;
  const processCode = raw?.process_code as string | undefined;
  if (processCode) {
    const strippedCode  = stripMask(normalizeSearchText(processCode));
    const strippedQuery = stripMask(norm);
    if (strippedCode && strippedQuery.length >= 4 && strippedCode.includes(strippedQuery)) {
      return true;
    }
  }

  return false;
};
