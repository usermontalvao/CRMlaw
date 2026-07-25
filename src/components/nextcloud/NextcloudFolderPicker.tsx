/**
 * NextcloudFolderPicker
 * -----------------------------------------------------------------------------
 * Modal leve para NAVEGAR e ESCOLHER uma pasta do Nextcloud ("explorar para
 * achar"). Lista apenas diretórios via `nextcloudService.list()`, com breadcrumb,
 * busca recursiva (igual ao explorador de arquivos) e um botão "Enviar aqui".
 * Não faz upload — apenas devolve o caminho escolhido ao chamador via `onSelect`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Folder, ChevronRight, Home, Loader2, RefreshCw, X, Check, Search } from 'lucide-react';
import { nextcloudService, type NextcloudEntry } from '../../services/nextcloud.service';

/** Diretório-pai de um caminho ("a/b/c" -> "a/b"; "a" -> raiz). */
function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : '';
}

interface NextcloudFolderPickerProps {
  open: boolean;
  onClose: () => void;
  /** Recebe o caminho relativo escolhido (ex.: "Clientes/João"). '' = raiz. */
  onSelect: (path: string) => void;
  title?: string;
  /** Texto do botão de confirmação. */
  confirmLabel?: string;
  /** Caminho inicial ao abrir. */
  initialPath?: string;
  /** Desabilita a confirmação (ex.: enquanto um upload roda). */
  busy?: boolean;
}

/** Quebra "a/b/c" em segmentos cumulativos para o breadcrumb. */
function crumbsOf(path: string): Array<{ label: string; path: string }> {
  const parts = path.split('/').filter(Boolean);
  const acc: Array<{ label: string; path: string }> = [];
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    acc.push({ label: part, path: current });
  }
  return acc;
}

export function NextcloudFolderPicker({
  open,
  onClose,
  onSelect,
  title = 'Escolher pasta no Nextcloud',
  confirmLabel = 'Enviar aqui',
  initialPath = '',
  busy = false,
}: NextcloudFolderPickerProps) {
  const [path, setPath] = useState(initialPath);
  const [entries, setEntries] = useState<NextcloudEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<NextcloudEntry[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const list = await nextcloudService.list(target);
      setEntries(list.filter((e) => e.isDir).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
    } catch (err) {
      setEntries([]);
      setError(err instanceof Error ? err.message : 'Falha ao listar as pastas.');
    } finally {
      setLoading(false);
    }
  }, []);

  /** Navega para uma pasta e limpa a busca ativa. */
  const goTo = useCallback((target: string) => {
    setSearch('');
    setSearchResults(null);
    setPath(target);
    void load(target);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSearchResults(null);
    setPath(initialPath);
    void load(initialPath);
  }, [open, initialPath, load]);

  // Busca recursiva (debounce), como no explorador — só pastas, a partir do
  // diretório atual (na raiz, procura em tudo).
  useEffect(() => {
    if (!open) return;
    const q = search.trim();
    if (!q) { setSearchResults(null); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const results = await nextcloudService.search(q, path);
        if (cancelled) return;
        setSearchResults(
          results.filter((e) => e.isDir).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Falha ao pesquisar.');
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [search, path, open]);

  if (!open) return null;

  const crumbs = crumbsOf(path);
  const isSearchActive = search.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[3px]" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-[0_32px_90px_rgba(15,23,42,0.35)] ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="flex items-center gap-2 truncate font-semibold">
            <Folder className="h-4 w-4 text-[#0082c9]" /> {title}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Busca recursiva (como no explorador de arquivos) */}
        <div className="border-b border-gray-100 px-4 py-2 dark:border-gray-800">
          <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-1.5 dark:bg-gray-800">
            <Search className="h-4 w-4 shrink-0 text-gray-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={path ? `Buscar pastas em ${path}…` : 'Buscar pastas…'}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            {searching ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />
            ) : search ? (
              <button onClick={() => setSearch('')} title="Limpar" className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Breadcrumb (oculto durante a busca) */}
        {!isSearchActive && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-gray-100 px-4 py-2 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-400">
            <button onClick={() => goTo('')} className="inline-flex items-center gap-1 hover:text-blue-600">
              <Home className="h-4 w-4" /> Início
            </button>
            {crumbs.map((c) => (
              <React.Fragment key={c.path}>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                <button onClick={() => goTo(c.path)} className="truncate hover:text-blue-600">{c.label}</button>
              </React.Fragment>
            ))}
            <button onClick={() => void load(path)} title="Recarregar" className="ml-auto shrink-0 rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}

        {/* Lista de pastas — resultados da busca ou o conteúdo da pasta atual */}
        <div className="min-h-[180px] flex-1 overflow-y-auto">
          {isSearchActive ? (
            searching && !searchResults ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Pesquisando…
              </div>
            ) : (searchResults ?? []).length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">Nenhuma pasta encontrada para “{search.trim()}”.</div>
            ) : (
              (searchResults ?? []).map((e) => (
                <button
                  key={e.path}
                  onClick={() => goTo(e.path)}
                  className="flex w-full items-center gap-2 border-b border-gray-50 px-4 py-2.5 text-left text-sm hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800"
                >
                  <Folder className="h-4 w-4 shrink-0 text-[#0082c9]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{e.name}</span>
                    {parentOf(e.path) && <span className="block truncate text-[11px] text-gray-400">{parentOf(e.path)}</span>}
                  </span>
                  <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-gray-300" />
                </button>
              ))
            )
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : error ? (
            <div className="px-4 py-8 text-center text-sm text-red-500">{error}</div>
          ) : entries.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">Esta pasta não contém subpastas.</div>
          ) : (
            entries.map((e) => (
              <button
                key={e.path}
                onClick={() => goTo(e.path)}
                className="flex w-full items-center gap-2 border-b border-gray-50 px-4 py-2.5 text-left text-sm hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800"
              >
                <Folder className="h-4 w-4 shrink-0 text-[#0082c9]" />
                <span className="truncate">{e.name}</span>
                <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-gray-300" />
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="min-w-0 text-xs text-gray-500">
            Destino: <strong className="truncate">{path || 'Início'}</strong>
          </div>
          <button
            onClick={() => onSelect(path)}
            disabled={busy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#0082c9] px-3 py-2 text-sm font-medium text-white hover:bg-[#0069a3] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default NextcloudFolderPicker;
