import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Search, X, FileText, Users, Gavel, Loader2, ChevronRight, ArrowRight,
} from 'lucide-react';
import { processService } from '../services/process.service';
import { clientService } from '../services/client.service';
import { djenLocalService } from '../services/djenLocal.service';
import { matchesNormalizedSearch } from '../utils/search';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';

interface SearchResult {
  id: string;
  type: 'processo' | 'cliente' | 'intimacao' | 'processo-via-cliente';
  title: string;
  subtitle?: string;
  meta?: string;
  navModule: string;
  navParams?: Record<string, string>;
}

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (module: string, params?: Record<string, unknown>) => void;
}

const TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; border: string }> = {
  processo:             { label: 'Processo',   icon: FileText, color: 'text-amber-600 bg-amber-50',   border: 'border-amber-200'  },
  'processo-via-cliente': { label: 'Processo', icon: FileText, color: 'text-amber-600 bg-amber-50',   border: 'border-amber-200'  },
  cliente:              { label: 'Cliente',    icon: Users,    color: 'text-slate-600 bg-slate-100',  border: 'border-slate-200'  },
  intimacao:            { label: 'Intimação',  icon: Gavel,    color: 'text-orange-600 bg-orange-50', border: 'border-orange-200' },
};

const normalizeStr = (s: string) =>
  (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ open, onClose, onNavigate }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const q2 = q.trim();

      const [processes, clients, intimacoes] = await Promise.all([
        processService.listProcesses(),
        clientService.listClients(),
        djenLocalService.listComunicacoes({}),
      ]);

      // Mapa cliente_id → client para cross-search
      const clientById = new Map<string, Client>(clients.map(c => [c.id, c]));

      // ── Clientes ────────────────────────────────────────────────────────────
      const clientResults: SearchResult[] = clients
        .filter(c => matchesNormalizedSearch(q2, [c.full_name ?? '', c.cpf_cnpj ?? '', c.email ?? '', c.phone ?? '']))
        .slice(0, 5)
        .map(c => ({
          id: c.id, type: 'cliente',
          title: c.full_name ?? 'Cliente',
          subtitle: [c.cpf_cnpj, c.email].filter(Boolean).join(' · ') || undefined,
          meta: c.phone || undefined,
          navModule: 'clientes',
          navParams: { clientes: JSON.stringify({ mode: 'details', entityId: c.id }) },
        }));

      // IDs dos clientes que bateram no nome
      const matchedClientIds = new Set(clientResults.map(r => r.id));

      // ── Processos (por código, comarca, advogado) ────────────────────────────
      const processResults: SearchResult[] = processes
        .filter(p => matchesNormalizedSearch(q2, [
          p.process_code ?? '', p.court ?? '', p.responsible_lawyer ?? '',
        ]))
        .slice(0, 5)
        .map(p => {
          const client = clientById.get(p.client_id ?? '');
          return {
            id: p.id, type: 'processo' as const,
            title: p.process_code ?? 'Processo',
            subtitle: [p.court, client?.full_name].filter(Boolean).join(' · ') || undefined,
            meta: p.status,
            navModule: 'processos',
            navParams: { processos: JSON.stringify({ searchQuery: p.process_code }) },
          };
        });

      // ── Processos via nome do cliente (cross-search) ──────────────────────
      const processViaClientResults: SearchResult[] = processes
        .filter(p => {
          if (!p.client_id) return false;
          const client = clientById.get(p.client_id);
          if (!client) return false;
          // Só incluir se o cliente não veio direto na busca de clientes E o nome bate
          return !matchedClientIds.has(p.client_id) &&
            matchesNormalizedSearch(q2, [client.full_name ?? '']);
        })
        .slice(0, 4)
        .map(p => {
          const client = clientById.get(p.client_id ?? '');
          return {
            id: p.id, type: 'processo-via-cliente' as const,
            title: p.process_code ?? 'Processo',
            subtitle: `Cliente: ${client?.full_name ?? ''}${p.court ? ' · ' + p.court : ''}`,
            meta: p.status,
            navModule: 'processos',
            navParams: { processos: JSON.stringify({ searchQuery: p.process_code }) },
          };
        });

      // ── Intimações (número do processo, polo_ativo, polo_passivo, texto) ────
      const normalizedQ = normalizeStr(q2);
      const intimacaoResults: SearchResult[] = intimacoes
        .filter(i => {
          const fields = [
            i.numero_processo ?? '', i.polo_ativo ?? '', i.polo_passivo ?? '',
            i.tipo_documento ?? '', i.nome_classe ?? '',
            // texto limitado para não ser lento
            (i.texto ?? '').slice(0, 400),
          ].map(normalizeStr);
          return fields.some(f => f.includes(normalizedQ));
        })
        .slice(0, 5)
        .map(i => ({
          id: i.id, type: 'intimacao' as const,
          title: i.numero_processo ?? 'Intimação',
          subtitle: [i.polo_ativo, i.polo_passivo].filter(Boolean).join(' × ') ||
                    i.tipo_documento || undefined,
          meta: i.data_disponibilizacao?.slice(0, 10),
          navModule: 'intimacoes',
          navParams: undefined,
        }));

      // Merge: clientes primeiro, depois processos, depois intimações
      const merged = [
        ...clientResults,
        ...processResults,
        ...processViaClientResults,
        ...intimacaoResults,
      ];

      // Deduplicar por id
      const seen = new Set<string>();
      const deduped = merged.filter(r => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });

      setResults(deduped);
      setSelected(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

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
    onNavigate(result.navModule, result.navParams as any);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl mx-4 bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
          <Search className="w-4.5 h-4.5 text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Nome, processo, CPF, comarca, advogado, polo..."
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
          <ul className="max-h-[60vh] overflow-y-auto py-2 divide-y divide-slate-50">
            {results.map((r, i) => {
              const cfg = TYPE_CONFIG[r.type] ?? TYPE_CONFIG.cliente;
              const Icon = cfg.icon;
              const isSelected = i === selected;
              return (
                <li key={`${r.type}-${r.id}`}>
                  <button
                    onClick={() => handleSelect(r)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${isSelected ? 'bg-amber-50' : 'hover:bg-slate-50'}`}
                  >
                    <span className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center border ${cfg.color} ${cfg.border}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{r.title}</div>
                      {r.subtitle && <div className="text-xs text-slate-500 truncate mt-0.5">{r.subtitle}</div>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {r.meta && <span className="text-[10px] text-slate-400 tabular-nums">{r.meta}</span>}
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.color} ${cfg.border}`}>{cfg.label}</span>
                      {isSelected
                        ? <ArrowRight className="w-3.5 h-3.5 text-amber-500" />
                        : <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : query.trim().length >= 2 && !loading ? (
          <div className="py-12 text-center text-sm text-slate-400">
            <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
            Nenhum resultado para <strong>"{query}"</strong>
          </div>
        ) : query.trim().length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">O que você pode buscar</p>
            <div className="grid grid-cols-3 gap-3 text-xs text-slate-600">
              {[
                { icon: Users,    label: 'Clientes',   desc: 'nome, CPF, e-mail' },
                { icon: FileText, label: 'Processos',  desc: 'número, comarca, advogado' },
                { icon: Gavel,    label: 'Intimações', desc: 'polo, número, tipo' },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <Icon className="w-5 h-5 text-amber-500" />
                  <span className="font-semibold">{label}</span>
                  <span className="text-slate-400 text-center leading-tight">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-100 flex items-center gap-4 text-[10px] text-slate-400">
          <span><kbd className="bg-slate-100 px-1.5 rounded">↑↓</kbd> navegar</span>
          <span><kbd className="bg-slate-100 px-1.5 rounded">Enter</kbd> abrir</span>
          <span><kbd className="bg-slate-100 px-1.5 rounded">Esc</kbd> fechar</span>
          <span className="ml-auto font-mono opacity-50">⌘K · Ctrl+K</span>
        </div>
      </div>
    </div>
  );
};
