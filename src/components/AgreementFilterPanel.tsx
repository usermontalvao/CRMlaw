import React from 'react';
import { Search, X, ChevronLeft, ChevronRight } from 'lucide-react';
import SensitiveValue from './SensitiveValue';
import type { AgreementFilters, AgreementDateField, AgreementPeriod, AgreementSort } from '../hooks/useAgreementFilters';

interface PanelProps {
  filters: AgreementFilters;
  /** Rótulos das duas bases de data disponíveis no filtro de período */
  dateFieldLabels: Record<AgreementDateField, string>;
  searchPlaceholder?: string;
  revealed: boolean;
  itemLabel?: { singular: string; plural: string };
}

const inputClass = 'px-2.5 py-1.5 border border-[#e7e5df] rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500';

export const AgreementFilterPanel: React.FC<PanelProps> = ({
  filters,
  dateFieldLabels,
  searchPlaceholder = 'Buscar por cliente, CPF, título, processo, requerimento...',
  revealed,
  itemLabel = { singular: 'lançamento', plural: 'lançamentos' },
}) => {
  if (!filters.open) return null;

  return (
    <div className="border-t border-[#e7e5df] bg-slate-50/80 px-4 py-3 space-y-2.5">
      <div className="flex flex-col @md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => filters.setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-9 pr-8 py-2 border border-[#e7e5df] rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />
          {filters.search && (
            <button
              onClick={() => filters.setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              title="Limpar busca"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <select
          value={filters.sort}
          onChange={(e) => filters.setSort(e.target.value as AgreementSort)}
          className={`${inputClass} cursor-pointer`}
          title="Ordenação"
        >
          <option value="date_desc">Mais recentes</option>
          <option value="date_asc">Mais antigos</option>
          <option value="value_desc">Maior valor</option>
          <option value="value_asc">Menor valor</option>
          <option value="fee_desc">Maior honorário</option>
          <option value="client_asc">Cliente (A-Z)</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filters.dateField}
          onChange={(e) => filters.setDateField(e.target.value as AgreementDateField)}
          className={`${inputClass} cursor-pointer`}
          title="Qual data usar no filtro de período"
        >
          <option value="updated">{dateFieldLabels.updated}</option>
          <option value="agreement">{dateFieldLabels.agreement}</option>
        </select>
        <select
          value={filters.period}
          onChange={(e) => filters.setPeriod(e.target.value as AgreementPeriod)}
          className={`${inputClass} cursor-pointer`}
        >
          <option value="all">Todo o período</option>
          <option value="this_month">Mês atual</option>
          <option value="last_month">Mês passado</option>
          <option value="last_90">Últimos 90 dias</option>
          <option value="this_year">Ano atual</option>
          <option value="month">Mês específico</option>
          <option value="custom">Intervalo personalizado</option>
        </select>

        {filters.period === 'month' && (
          <input
            type="month"
            value={filters.month}
            onChange={(e) => filters.setMonth(e.target.value)}
            className={inputClass}
          />
        )}

        {filters.period === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={filters.from} onChange={(e) => filters.setFrom(e.target.value)} className={inputClass} title="De" />
            <span className="text-xs text-slate-400">até</span>
            <input type="date" value={filters.to} onChange={(e) => filters.setTo(e.target.value)} className={inputClass} title="Até" />
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            value={filters.minValue}
            onChange={(e) => filters.setMinValue(e.target.value)}
            placeholder="Valor mín."
            className={`${inputClass} w-24`}
          />
          <span className="text-xs text-slate-400">até</span>
          <input
            type="number"
            min={0}
            value={filters.maxValue}
            onChange={(e) => filters.setMaxValue(e.target.value)}
            placeholder="Valor máx."
            className={`${inputClass} w-24`}
          />
        </div>

        {filters.active && (
          <button
            onClick={filters.reset}
            className="inline-flex items-center gap-1 rounded-lg border border-[#e7e5df] bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <X className="w-3.5 h-3.5" />
            Limpar filtros
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span>
          <strong className="text-slate-700">{filters.items.length}</strong>{' '}
          {filters.items.length === 1 ? itemLabel.singular : itemLabel.plural}
        </span>
        <span>
          Valor total: <strong className="text-slate-700"><SensitiveValue value={filters.totals.total} isRevealed={revealed} /></strong>
        </span>
        <span>
          Honorários: <strong className="text-blue-700"><SensitiveValue value={filters.totals.fees} isRevealed={revealed} /></strong>
        </span>
      </div>
    </div>
  );
};

interface PaginationProps {
  filters: AgreementFilters;
}

export const AgreementPagination: React.FC<PaginationProps> = ({ filters }) => {
  if (filters.items.length === 0) return null;

  const pages = Array.from({ length: filters.totalPages }, (_, index) => index + 1)
    .filter((page) => page === 1 || page === filters.totalPages || Math.abs(page - filters.page) <= 1);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e7e5df] px-4 py-2.5 text-[11px] text-slate-500">
      <span>
        Mostrando <strong className="text-slate-700">{filters.firstIndex}–{filters.lastIndex}</strong> de{' '}
        <strong className="text-slate-700">{filters.items.length}</strong>
      </span>
      {filters.totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => filters.setPage(Math.max(1, filters.page - 1))}
            disabled={filters.page === 1}
            className="inline-flex items-center gap-1 rounded-lg border border-[#e7e5df] bg-white px-2 py-1 font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Anterior
          </button>
          {pages.map((page, index) => (
            <React.Fragment key={page}>
              {index > 0 && page - pages[index - 1] > 1 && <span className="px-1 text-slate-300">…</span>}
              <button
                onClick={() => filters.setPage(page)}
                className={`min-w-[26px] rounded-lg border px-2 py-1 font-semibold transition ${
                  page === filters.page
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : 'border-[#e7e5df] bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {page}
              </button>
            </React.Fragment>
          ))}
          <button
            onClick={() => filters.setPage(Math.min(filters.totalPages, filters.page + 1))}
            disabled={filters.page === filters.totalPages}
            className="inline-flex items-center gap-1 rounded-lg border border-[#e7e5df] bg-white px-2 py-1 font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Próxima
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
