/**
 * NextcloudFileDialog
 * -----------------------------------------------------------------------------
 * Janela de ABRIR / SALVAR COMO / ESCOLHER PASTA do Nextcloud, no espírito do
 * explorador de arquivos do Windows: breadcrumb, voltar/avançar/subir, pesquisa
 * recursiva, lista com pastas primeiro, duplo clique para entrar e Enter para
 * abrir.
 *
 * É um IRMÃO do NextcloudFolderPicker (que continua servindo o módulo de
 * assinaturas sem alteração): a lógica pura de nomes/caminhos/ordenação mora em
 * `utils/editorDocumentOrigin` e é compartilhada.
 *
 * Quem chama decide o que fazer com a escolha — o diálogo NÃO lê nem grava
 * arquivos. No modo `save` ele apenas devolve o destino (pasta + nome + os nomes
 * já existentes na pasta), para que o chamador confirme sobrescrita e grave.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { zc } from '../../styles/layers';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  Cloud,
  FileText,
  Folder,
  FolderPlus,
  Home,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  nextcloudService,
  getNextcloudErrorMessage,
  type NextcloudEntry,
} from '../../services/nextcloud.service';
import {
  compareExplorerEntries,
  crumbsOf,
  isSupportedEditorFileName,
  normalizeDocxFileName,
  normalizeNextcloudDirPath,
  parentPathOf,
  buildNextcloudFilePath,
} from '../../utils/editorDocumentOrigin';

export type NextcloudFileDialogMode = 'open' | 'save' | 'folder';

export interface NextcloudSaveTarget {
  /** Pasta escolhida (relativa à raiz; '' = raiz). */
  dir: string;
  /** Nome já normalizado com `.docx`. */
  fileName: string;
  /** Caminho completo do destino. */
  path: string;
  /** Nomes de arquivos visíveis na pasta — detecção rápida de sobrescrita. */
  existingNames: string[];
}

interface NextcloudFileDialogProps {
  open: boolean;
  mode: NextcloudFileDialogMode;
  onClose: () => void;
  /** modo `open`: arquivo escolhido. */
  onSelectFile?: (entry: NextcloudEntry) => void;
  /** modo `save`: destino escolhido (o chamador confirma e grava). */
  onConfirmSave?: (target: NextcloudSaveTarget) => void;
  /** modo `folder`: pasta escolhida. */
  onSelectFolder?: (path: string) => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  initialPath?: string;
  /** modo `save`: nome sugerido (normalizado para `.docx`). */
  initialFileName?: string;
  /** Bloqueia ações enquanto o chamador baixa/envia o arquivo. */
  busy?: boolean;
  busyLabel?: string;
  /** Tema escuro do módulo (ativa as variantes `dark:` dentro do diálogo). */
  darkMode?: boolean;
}

const formatSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const formatDate = (mtime: string | null): string => {
  if (!mtime) return '—';
  const parsed = new Date(mtime);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

export function NextcloudFileDialog({
  open,
  mode,
  onClose,
  onSelectFile,
  onConfirmSave,
  onSelectFolder,
  title,
  description,
  confirmLabel,
  initialPath = '',
  initialFileName = '',
  busy = false,
  busyLabel,
  darkMode = false,
}: NextcloudFileDialogProps) {
  const [path, setPath] = useState(() => normalizeNextcloudDirPath(initialPath));
  const [entries, setEntries] = useState<NextcloudEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<NextcloudEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [savingFolder, setSavingFolder] = useState(false);

  // Histórico de navegação (voltar / avançar), como no explorador.
  const historyRef = useRef<string[]>([normalizeNextcloudDirPath(initialPath)]);
  const historyIndexRef = useRef(0);
  const [historyTick, setHistoryTick] = useState(0);

  const listLoadTokenRef = useRef(0);
  const searchTokenRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const fileNameInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Devolve o foco ao botão que abriu o diálogo.
  const openerRef = useRef<HTMLElement | null>(null);

  const showsFiles = mode !== 'folder';
  const isSaveMode = mode === 'save';

  const load = useCallback(async (target: string) => {
    const token = ++listLoadTokenRef.current;
    setLoading(true);
    setError(null);
    try {
      const list = await nextcloudService.list(target);
      if (token !== listLoadTokenRef.current) return;
      setEntries(list);
    } catch (err) {
      if (token !== listLoadTokenRef.current) return;
      setEntries([]);
      setError(getNextcloudErrorMessage(err, 'listar a pasta'));
    } finally {
      if (token === listLoadTokenRef.current) setLoading(false);
    }
  }, []);

  /** Navega para uma pasta, empilhando no histórico e limpando a busca. */
  const goTo = useCallback((target: string, options: { push?: boolean } = {}) => {
    const normalized = normalizeNextcloudDirPath(target);
    if (options.push !== false) {
      const stack = historyRef.current.slice(0, historyIndexRef.current + 1);
      if (stack[stack.length - 1] !== normalized) stack.push(normalized);
      historyRef.current = stack;
      historyIndexRef.current = stack.length - 1;
      setHistoryTick((tick) => tick + 1);
    }
    setSearch('');
    setSearchResults(null);
    setSelectedPath(null);
    setCreatingFolder(false);
    setPath(normalized);
    void load(normalized);
  }, [load]);

  const goBack = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    setHistoryTick((tick) => tick + 1);
    goTo(historyRef.current[historyIndexRef.current], { push: false });
  }, [goTo]);

  const goForward = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    setHistoryTick((tick) => tick + 1);
    goTo(historyRef.current[historyIndexRef.current], { push: false });
  }, [goTo]);

  // Reinicia o diálogo a cada abertura.
  useEffect(() => {
    if (!open) return;
    openerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const start = normalizeNextcloudDirPath(initialPath);
    historyRef.current = [start];
    historyIndexRef.current = 0;
    setHistoryTick((tick) => tick + 1);
    setSearch('');
    setSearchResults(null);
    setSelectedPath(null);
    setCreatingFolder(false);
    setNewFolderName('');
    setError(null);
    setPath(start);
    setFileName(isSaveMode ? normalizeDocxFileName(initialFileName, 'documento') : '');
    void load(start);
    // O foco inicial vai para o campo mais útil de cada modo.
    window.setTimeout(() => {
      if (isSaveMode) fileNameInputRef.current?.select();
      else searchInputRef.current?.focus();
    }, 60);
  }, [open, initialPath, initialFileName, isSaveMode, load]);

  // Devolve o foco ao abridor quando o diálogo fecha.
  useEffect(() => {
    if (open) return;
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener && typeof opener.focus === 'function') {
      window.setTimeout(() => opener.focus(), 0);
    }
  }, [open]);

  // Pesquisa recursiva a partir da pasta atual, com debounce e descarte de
  // respostas antigas (uma resposta lenta não pode sobrescrever a atual).
  useEffect(() => {
    if (!open) return;
    const query = search.trim();
    if (!query) {
      searchTokenRef.current += 1;
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const token = ++searchTokenRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const results = await nextcloudService.search(query, path);
        if (token !== searchTokenRef.current) return;
        setSearchResults(results);
        setError(null);
      } catch (err) {
        if (token !== searchTokenRef.current) return;
        setSearchResults([]);
        setError(getNextcloudErrorMessage(err, 'pesquisar arquivos e pastas'));
      } finally {
        if (token === searchTokenRef.current) setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, path, open]);

  const isSearchActive = search.trim().length > 0;

  /** Linhas visíveis: pastas sempre; arquivos só nos modos open/save. */
  const visibleEntries = useMemo(() => {
    const source = isSearchActive ? (searchResults ?? []) : entries;
    return source
      .filter((entry) => {
        if (entry.isDir) return true;
        if (!showsFiles) return false;
        return isSupportedEditorFileName(entry.name);
      })
      .slice()
      .sort(compareExplorerEntries);
  }, [entries, searchResults, isSearchActive, showsFiles]);

  const existingFileNames = useMemo(
    () => entries.filter((entry) => !entry.isDir).map((entry) => entry.name),
    [entries],
  );

  const selectedEntry = useMemo(
    () => visibleEntries.find((entry) => entry.path === selectedPath) ?? null,
    [visibleEntries, selectedPath],
  );

  const confirmSelection = useCallback(() => {
    if (busy) return;
    if (mode === 'folder') {
      onSelectFolder?.(path);
      return;
    }
    if (mode === 'open') {
      if (!selectedEntry || selectedEntry.isDir) return;
      onSelectFile?.(selectedEntry);
      return;
    }
    let target: string;
    try {
      target = buildNextcloudFilePath(path, normalizeDocxFileName(fileName, 'documento'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Informe um nome de arquivo válido.');
      return;
    }
    onConfirmSave?.({
      dir: path,
      fileName: normalizeDocxFileName(fileName, 'documento'),
      path: target,
      existingNames: existingFileNames,
    });
  }, [busy, mode, onSelectFolder, onSelectFile, onConfirmSave, path, selectedEntry, fileName, existingFileNames]);

  /** Clique simples seleciona; duplo clique entra na pasta ou abre o arquivo. */
  const activateEntry = useCallback((entry: NextcloudEntry) => {
    if (busy) return;
    if (entry.isDir) {
      goTo(entry.path);
      return;
    }
    if (mode === 'open') {
      onSelectFile?.(entry);
      return;
    }
    if (isSaveMode) setFileName(normalizeDocxFileName(entry.name, 'documento'));
  }, [busy, goTo, mode, isSaveMode, onSelectFile]);

  const selectEntry = useCallback((entry: NextcloudEntry) => {
    setSelectedPath(entry.path);
    // Escolher um arquivo existente preenche o nome (comportamento do Windows).
    if (isSaveMode && !entry.isDir) setFileName(normalizeDocxFileName(entry.name, 'documento'));
  }, [isSaveMode]);

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || savingFolder) return;
    setSavingFolder(true);
    try {
      const target = buildNextcloudFilePath(path, name);
      await nextcloudService.makeFolder(target);
      setCreatingFolder(false);
      setNewFolderName('');
      goTo(target);
    } catch (err) {
      setError(getNextcloudErrorMessage(err, 'criar a pasta'));
    } finally {
      setSavingFolder(false);
    }
  }, [newFolderName, savingFolder, path, goTo]);

  // Atalhos globais do diálogo: Escape fecha, setas movem, Enter confirma.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (creatingFolder) { setCreatingFolder(false); return; }
        if (!busy) onClose();
        return;
      }

      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      if (event.key === 'Enter') {
        if (creatingFolder) { event.preventDefault(); void createFolder(); return; }
        // Enter dentro da busca não deve confirmar sem uma escolha feita.
        if (typing && target === searchInputRef.current && !selectedEntry) return;
        event.preventDefault();
        if (selectedEntry?.isDir && !isSaveMode) { goTo(selectedEntry.path); return; }
        confirmSelection();
        return;
      }

      if (typing) return;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      if (!visibleEntries.length) return;
      const currentIndex = visibleEntries.findIndex((entry) => entry.path === selectedPath);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? (event.key === 'ArrowDown' ? 0 : visibleEntries.length - 1)
        : Math.min(visibleEntries.length - 1, Math.max(0, currentIndex + delta));
      const next = visibleEntries[nextIndex];
      if (!next) return;
      selectEntry(next);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-entry-index="${nextIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, busy, creatingFolder, createFolder, onClose, selectedEntry, selectedPath, visibleEntries, confirmSelection, goTo, isSaveMode, selectEntry]);

  if (!open) return null;

  const crumbs = crumbsOf(path);
  const canGoBack = historyIndexRef.current > 0;
  const canGoForward = historyIndexRef.current < historyRef.current.length - 1;
  const canGoUp = Boolean(path);

  const resolvedTitle = title
    ?? (mode === 'open' ? 'Abrir do Nextcloud' : mode === 'save' ? 'Salvar no Nextcloud' : 'Escolher pasta no Nextcloud');
  const resolvedConfirmLabel = confirmLabel
    ?? (mode === 'open' ? 'Abrir' : mode === 'save' ? 'Salvar aqui' : 'Selecionar pasta');

  const previewPath = isSaveMode
    ? [path, normalizeDocxFileName(fileName, 'documento')].filter(Boolean).join('/')
    : (selectedEntry?.path ?? path);

  const confirmDisabled = busy
    || (mode === 'open' && (!selectedEntry || selectedEntry.isDir))
    || (isSaveMode && !fileName.trim());

  const iconButton = 'rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 disabled:opacity-35 disabled:hover:bg-transparent dark:text-slate-400 dark:hover:bg-white/10';

  return (
    <div
      className={`${darkMode ? 'dark ' : ''}fixed inset-0 ${zc.MODAL} flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[3px] sm:p-6`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={resolvedTitle}
        className="flex max-h-[88vh] w-full max-w-[760px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-[0_32px_90px_rgba(15,23,42,0.35)] dark:border-[#454545] dark:bg-[#2b2b2b] dark:text-slate-100"
      >
        {/* Cabeçalho */}
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-[#454545]">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#0082c9]/20 bg-[#0082c9]/10 text-[#0082c9]">
            <Cloud className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold leading-5">{resolvedTitle}</h2>
            <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
              {description ?? (mode === 'open'
                ? 'Navegue ou pesquise para escolher um documento .docx.'
                : mode === 'save'
                  ? 'Escolha a pasta e o nome do arquivo.'
                  : 'Escolha uma pasta de destino.')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { if (!busy) onClose(); }}
            disabled={busy}
            className={iconButton}
            aria-label="Fechar janela"
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Barra de navegação: voltar / avançar / subir / início / breadcrumb */}
        <div className="flex items-center gap-1 border-b border-slate-200 px-3 py-2 dark:border-[#454545]" data-history-tick={historyTick}>
          <button type="button" onClick={goBack} disabled={!canGoBack || busy} className={iconButton} aria-label="Voltar" title="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={goForward} disabled={!canGoForward || busy} className={iconButton} aria-label="Avançar" title="Avançar">
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => goTo(parentPathOf(path))}
            disabled={!canGoUp || busy}
            className={iconButton}
            aria-label="Subir um nível"
            title="Subir um nível"
          >
            <ArrowUp className="h-4 w-4" />
          </button>

          <div className="mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[12px] dark:border-[#4a4a4a] dark:bg-[#333333]">
            <button
              type="button"
              onClick={() => goTo('')}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 hover:text-[#0082c9]"
              aria-label="Ir para o início"
              title="Início"
            >
              <Home className="h-3.5 w-3.5" /> Início
            </button>
            {crumbs.map((crumb) => (
              <React.Fragment key={crumb.path}>
                <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
                <button
                  type="button"
                  onClick={() => goTo(crumb.path)}
                  className="max-w-[180px] shrink-0 truncate rounded px-1 py-0.5 hover:text-[#0082c9]"
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            ))}
          </div>

          <button
            type="button"
            onClick={() => { setSelectedPath(null); void load(path); }}
            disabled={busy}
            className={iconButton}
            aria-label="Atualizar lista"
            title="Atualizar"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {isSaveMode && (
            <button
              type="button"
              onClick={() => { setCreatingFolder(true); setNewFolderName(''); }}
              disabled={busy}
              className={iconButton}
              aria-label="Criar nova pasta"
              title="Nova pasta"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Pesquisa recursiva */}
        <div className="border-b border-slate-200 px-3 py-2 dark:border-[#454545]">
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 focus-within:border-[#0082c9] dark:border-[#4a4a4a] dark:bg-[#333333]">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={path ? `Pesquisar em ${path}…` : 'Pesquisar em todo o Nextcloud…'}
              aria-label="Pesquisar arquivos e pastas"
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-slate-400"
            />
            {searching ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
            ) : search ? (
              <button
                type="button"
                onClick={() => { setSearch(''); searchInputRef.current?.focus(); }}
                className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10"
                aria-label="Limpar pesquisa"
                title="Limpar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Nova pasta (modo salvar) */}
        {creatingFolder && (
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-[#454545] dark:bg-[#333333]">
            <FolderPlus className="h-4 w-4 shrink-0 text-[#0082c9]" />
            <input
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="Nome da nova pasta"
              aria-label="Nome da nova pasta"
              className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-[12px] outline-none focus:border-[#0082c9] dark:border-[#4a4a4a] dark:bg-[#2b2b2b]"
            />
            <button
              type="button"
              onClick={() => void createFolder()}
              disabled={!newFolderName.trim() || savingFolder}
              className="inline-flex items-center gap-1 rounded-md bg-[#0082c9] px-2.5 py-1 text-[12px] font-medium text-white hover:bg-[#0069a3] disabled:opacity-50"
            >
              {savingFolder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Criar
            </button>
            <button
              type="button"
              onClick={() => setCreatingFolder(false)}
              className="rounded-md px-2 py-1 text-[12px] text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10"
            >
              Cancelar
            </button>
          </div>
        )}

        {/* Cabeçalho de colunas */}
        <div className="hidden grid-cols-[minmax(0,1fr)_110px_150px] gap-3 border-b border-slate-200 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:grid dark:border-[#454545]">
          <span>Nome</span>
          <span className="text-right">Tamanho</span>
          <span className="text-right">Modificado</span>
        </div>

        {/* Lista */}
        <div ref={listRef} className="min-h-[220px] flex-1 overflow-y-auto">
          {error && (
            <div className="m-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">{error}</span>
            </div>
          )}

          {(loading && !isSearchActive) || (searching && !searchResults) ? (
            <div className="flex items-center justify-center gap-2 py-14 text-[12px] text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {isSearchActive ? 'Pesquisando…' : 'Carregando…'}
            </div>
          ) : visibleEntries.length === 0 && !error ? (
            <div className="px-4 py-14 text-center text-[12px] text-slate-400">
              {isSearchActive
                ? `Nenhum resultado para “${search.trim()}”.`
                : mode === 'folder'
                  ? 'Esta pasta não contém subpastas.'
                  : 'Esta pasta está vazia ou não tem documentos .docx.'}
            </div>
          ) : (
            visibleEntries.map((entry, index) => {
              const isSelected = entry.path === selectedPath;
              const folder = parentPathOf(entry.path);
              return (
                <div
                  key={entry.path}
                  data-entry-index={index}
                  role="button"
                  tabIndex={-1}
                  aria-selected={isSelected}
                  onClick={() => selectEntry(entry)}
                  onDoubleClick={() => activateEntry(entry)}
                  className={`grid cursor-pointer grid-cols-[minmax(0,1fr)] items-center gap-3 border-b border-slate-100 px-4 py-2 text-[12px] transition sm:grid-cols-[minmax(0,1fr)_110px_150px] dark:border-[#3a3a3a] ${
                    isSelected
                      ? 'bg-[#0082c9]/10 text-[#0069a3] dark:bg-[#0082c9]/20 dark:text-white'
                      : 'hover:bg-slate-50 dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {entry.isDir
                      ? <Folder className="h-4 w-4 shrink-0 text-[#0082c9]" />
                      : <FileText className="h-4 w-4 shrink-0 text-slate-400" />}
                    <span className="min-w-0">
                      <span className="block truncate">{entry.name}</span>
                      {isSearchActive && folder && (
                        <span className="block truncate text-[10px] text-slate-400">{folder}</span>
                      )}
                    </span>
                  </div>
                  <div className="hidden text-right tabular-nums text-slate-400 sm:block">
                    {entry.isDir ? '—' : formatSize(entry.size)}
                  </div>
                  <div className="hidden text-right tabular-nums text-slate-400 sm:block">
                    {formatDate(entry.mtime)}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Nome do arquivo (modo salvar) */}
        {isSaveMode && (
          <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-2.5 dark:border-[#454545]">
            <label htmlFor="nextcloud-save-name" className="shrink-0 text-[12px] text-slate-500 dark:text-slate-400">
              Nome do arquivo
            </label>
            <input
              id="nextcloud-save-name"
              ref={fileNameInputRef}
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              onBlur={() => setFileName((current) => normalizeDocxFileName(current, 'documento'))}
              disabled={busy}
              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#0082c9] disabled:opacity-60 dark:border-[#4a4a4a] dark:bg-[#333333]"
            />
          </div>
        )}

        {/* Rodapé: caminho completo + ação principal */}
        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-[#454545] dark:bg-[#303030]">
          <div className="min-w-0 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="mr-1">{mode === 'open' ? 'Arquivo:' : 'Destino:'}</span>
            <strong className="break-all font-medium text-slate-700 dark:text-slate-200" title={previewPath || 'Início'}>
              {previewPath || 'Início'}
            </strong>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => { if (!busy) onClose(); }}
              disabled={busy}
              className="h-8 rounded-md border border-slate-200 px-3 text-[12px] font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-[#4a4a4a] dark:text-slate-300 dark:hover:bg-white/10"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmSelection}
              disabled={confirmDisabled}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0082c9] px-3.5 text-[12px] font-semibold text-white transition hover:bg-[#0069a3] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {busy ? (busyLabel ?? 'Processando…') : resolvedConfirmLabel}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export default NextcloudFileDialog;
