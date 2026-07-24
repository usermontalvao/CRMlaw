import { useEffect, useMemo, useState } from 'react';
import { matchesNormalizedSearch } from '../utils/search';
import type { Agreement } from '../types/financial.types';

export type AgreementDateField = 'updated' | 'agreement';
export type AgreementPeriod = 'all' | 'this_month' | 'last_month' | 'last_90' | 'this_year' | 'month' | 'custom';
export type AgreementSort = 'date_desc' | 'date_asc' | 'value_desc' | 'value_asc' | 'fee_desc' | 'client_asc';

interface Options {
  agreements: Agreement[];
  pageSize: number;
  getSearchValues: (agreement: Agreement) => Array<string | null | undefined>;
  getClientName: (clientId: string) => string;
  defaultDateField?: AgreementDateField;
}

const toISODate = (date: Date) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Estado + lógica de filtro, ordenação e paginação de uma lista de lançamentos.
 * Compartilhado pelas seções do módulo financeiro (concluídos, aguardando definição...).
 */
export function useAgreementFilters({
  agreements,
  pageSize,
  getSearchValues,
  getClientName,
  defaultDateField = 'updated',
}: Options) {
  const currentMonth = toISODate(new Date()).slice(0, 7);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dateField, setDateField] = useState<AgreementDateField>(defaultDateField);
  const [period, setPeriod] = useState<AgreementPeriod>('all');
  const [month, setMonth] = useState(currentMonth);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [sort, setSort] = useState<AgreementSort>('date_desc');
  const [page, setPage] = useState(1);

  // Intervalo [de, até] em ISO derivado do período escolhido
  const range = useMemo(() => {
    const now = new Date();

    switch (period) {
      case 'this_month':
        return {
          from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)),
          to: toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
        };
      case 'last_month':
        return {
          from: toISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
          to: toISODate(new Date(now.getFullYear(), now.getMonth(), 0)),
        };
      case 'last_90': {
        const start = new Date(now);
        start.setDate(start.getDate() - 90);
        return { from: toISODate(start), to: toISODate(now) };
      }
      case 'this_year':
        return {
          from: toISODate(new Date(now.getFullYear(), 0, 1)),
          to: toISODate(new Date(now.getFullYear(), 11, 31)),
        };
      case 'month': {
        if (!month) return { from: '', to: '' };
        const [y, m] = month.split('-').map(Number);
        if (!y || !m) return { from: '', to: '' };
        return { from: toISODate(new Date(y, m - 1, 1)), to: toISODate(new Date(y, m, 0)) };
      }
      case 'custom':
        return { from, to };
      default:
        return { from: '', to: '' };
    }
  }, [period, month, from, to]);

  const active = Boolean(search.trim() || period !== 'all' || minValue || maxValue || sort !== 'date_desc');

  const reset = () => {
    setSearch('');
    setPeriod('all');
    setMonth(currentMonth);
    setFrom('');
    setTo('');
    setMinValue('');
    setMaxValue('');
    setSort('date_desc');
    setDateField(defaultDateField);
  };

  const items = useMemo(() => {
    const term = search.trim();
    const min = minValue ? Number(minValue) : null;
    const max = maxValue ? Number(maxValue) : null;

    const dateOf = (agreement: Agreement) => (
      dateField === 'updated'
        ? String(agreement.updated_at || '').slice(0, 10)
        : String(agreement.agreement_date || '').slice(0, 10)
    );

    const result = agreements.filter((agreement) => {
      if (term && !matchesNormalizedSearch(term, getSearchValues(agreement))) return false;

      const reference = dateOf(agreement);
      if (range.from && (!reference || reference < range.from)) return false;
      if (range.to && (!reference || reference > range.to)) return false;

      if (min !== null && !Number.isNaN(min) && agreement.total_value < min) return false;
      if (max !== null && !Number.isNaN(max) && agreement.total_value > max) return false;

      return true;
    });

    return [...result].sort((a, b) => {
      switch (sort) {
        case 'date_asc':
          return dateOf(a).localeCompare(dateOf(b));
        case 'value_desc':
          return b.total_value - a.total_value;
        case 'value_asc':
          return a.total_value - b.total_value;
        case 'fee_desc':
          return b.fee_value - a.fee_value;
        case 'client_asc':
          return getClientName(a.client_id).localeCompare(getClientName(b.client_id), 'pt-BR');
        default:
          return dateOf(b).localeCompare(dateOf(a));
      }
    });
  }, [agreements, search, range, dateField, minValue, maxValue, sort, getSearchValues, getClientName]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // Volta para a primeira página sempre que o resultado filtrado muda
  useEffect(() => {
    setPage(1);
  }, [search, range, dateField, minValue, maxValue, sort, agreements.length]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = useMemo(
    () => items.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
    [items, page, pageSize],
  );

  const totals = useMemo(() => ({
    total: items.reduce((sum, a) => sum + (a.total_value || 0), 0),
    fees: items.reduce((sum, a) => sum + (a.fee_value || 0), 0),
  }), [items]);

  return {
    open, setOpen,
    search, setSearch,
    dateField, setDateField,
    period, setPeriod,
    month, setMonth,
    from, setFrom,
    to, setTo,
    minValue, setMinValue,
    maxValue, setMaxValue,
    sort, setSort,
    page, setPage,
    totalPages,
    active,
    reset,
    items,
    pageItems,
    totals,
    firstIndex: items.length === 0 ? 0 : (page - 1) * pageSize + 1,
    lastIndex: Math.min(page * pageSize, items.length),
  };
}

export type AgreementFilters = ReturnType<typeof useAgreementFilters>;
