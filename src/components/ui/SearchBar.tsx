import React from 'react';
import { Search, X } from 'lucide-react';

interface SearchBarProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  /** Conteúdo adicional à direita (filtros, selects) */
  append?: React.ReactNode;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  onClear,
  append,
  placeholder = 'Buscar...',
  className = '',
  ...props
}) => (
  <div className={['flex items-center gap-2', className].filter(Boolean).join(' ')}>
    <div className="relative flex-1 min-w-0">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 pl-9 pr-8 text-sm bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-400 transition-colors"
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(''); onClear?.(); }}
          aria-label="Limpar busca"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded transition"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
    {append}
  </div>
);
