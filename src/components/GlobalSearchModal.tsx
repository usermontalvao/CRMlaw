import { useEffect, useRef, useState, useCallback } from 'react';
import { Search, X, FileText, Users, Gavel, Loader2, ChevronRight } from 'lucide-react';
import { processService } from '../services/process.service';
import { clientService } from '../services/client.service';
import { djenLocalService } from '../services/djenLocal.service';
import { matchesNormalizedSearch } from '../utils/search';

interface SearchResult {
  id: string;
  type: 'processo' | 'cliente' | 'intimacao';
  title: string;
  subtitle?: string;
  meta?: string;
}

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (module: string, params?: Record<string, unknown>) => void;
}

const TYPE_CONFIG = {
  processo:  { label: 'Processo',  icon: FileText, color: 'text-amber-600 bg-amber-50',  border: 'border-amber-200' },
  cliente:   { label: 'Cliente',   icon: Users,    color: 'text-slate-600 bg-slate-100',  border: 'border-slate-200' },
  intimacao: { label: 'Intimação', icon: Gavel,    color: 'text-orange-600 bg-orange-50', border: 'border-orange-200' },
};

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ open, onClose, onNavigate }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const [processes, clients, intimacoes] = await Promise.all([
        processService.listProcesses(),
        clientService.listClients(),
        djenLocalService.listComunicacoes({ lida: false }),
      ]);

      const q2 = q.trim();
      const processResults: SearchResult[] = processes
        .filter(p => matchesNormalizedSearch(q2, [p.process_code ?? '', p.court ?? '', p.responsible_lawyer ?? '']))
        .slice(0, 5)
        .map(p => ({
          id: p.id, type: 'processo',
          title: p.process_code ?? 'Processo',
          subtitle: p.court || undefined,
          meta: p.status,
        }));

      const clientResults: SearchResult[] = clients
        .filter(c => matchesNormalizedSearch(q2, [c.full_name ?? '', c.cpf_cnpj ?? '', c.email ?? '']))
        .slice(0, 5)
        .map(c => ({
          id: c.id, type: 'cliente',
          title: c.full_name ?? 'Cliente',
          subtitle: c.email || c.cpf_cnpj || undefined,
        }));

      const intimacaoResults: SearchResult[] = intimacoes
        .filter(i => matchesNormalizedSearch(q2, [i.numero_processo ?? '', i.texto ?? '', i.polo_ativo ?? '', i.polo_passivo ?? '']))
        .slice(0, 4)
        .map(i => ({
          id: i.id, type: 'intimacao',
          title: i.numero_processo ?? 'Intimação',
          subtitle: i.tipo_documento || i.tipo_comunicacao || undefined,
          meta: i.data_disponibilizacao?.slice(0, 10),
        }));

      setResults([...processResults, ...clientResults, ...intimacaoResults]);
      setSelected(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
      if (e.key === 'Enter' && results[selected]) handleSelect(results[selected]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, results, selected]);

  const handleSelect = (result: SearchResult) => {
    if (result.type === 'processo') onNavigate('processes');
    else if (result.type === 'cliente') onNavigate('clients');
    else if (result.type === 'intimacao') onNavigate('intimations');
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[12vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-xl mx-4 bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
          <Search className="w-4.5 h-4.5 text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar processo, cliente, intimação..."
            className="flex-1 text-sm text-slate-900 placeholder-slate-400 bg-transparent outline-none"
          />
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
            <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] font-medium text-slate-400 bg-slate-100 rounded border border-slate-200">Esc</kbd>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-0.5">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Results */}
        {results.length > 0 ? (
          <ul className="max-h-80 overflow-y-auto py-2">
            {results.map((r, i) => {
              const cfg = TYPE_CONFIG[r.type];
              const Icon = cfg.icon;
              return (
                <li key={r.id}>
                  <button
                    onClick={() => handleSelect(r)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === selected ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                  >
                    <span className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center border ${cfg.color} ${cfg.border}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{r.title}</div>
                      {r.subtitle && <div className="text-xs text-slate-500 truncate">{r.subtitle}</div>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {r.meta && <span className="text-[10px] text-slate-400">{r.meta}</span>}
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cfg.color}`}>{cfg.label}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : query.trim().length >= 2 && !loading ? (
          <div className="py-10 text-center text-sm text-slate-400">Nenhum resultado para "{query}"</div>
        ) : query.trim().length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-slate-400 mb-3">Pesquise em todos os módulos</p>
            <div className="flex items-center justify-center gap-4 text-xs text-slate-500">
              {Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <span key={key} className="flex items-center gap-1">
                    <Icon className="w-3.5 h-3.5" /> {cfg.label}s
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-slate-100 flex items-center gap-3 text-[10px] text-slate-400">
          <span><kbd className="bg-slate-100 px-1 rounded">↑↓</kbd> navegar</span>
          <span><kbd className="bg-slate-100 px-1 rounded">Enter</kbd> abrir</span>
          <span><kbd className="bg-slate-100 px-1 rounded">Esc</kbd> fechar</span>
          <span className="ml-auto opacity-60">⌘K · Ctrl+K</span>
        </div>
      </div>
    </div>
  );
};
