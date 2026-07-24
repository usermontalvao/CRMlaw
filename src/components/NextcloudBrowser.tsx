import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Folder, File as FileIcon, FileText, Image as ImageIcon, Film, Download, Upload,
  Trash2, FolderPlus, ChevronRight, RefreshCw, Home, AlertCircle, Loader2, Cloud,
  Pencil, Eye, X, UserPlus, Search, Unlink, Wrench, Combine, Scissors, Stamp,
  Hash, RotateCw, Music, CheckSquare, Square, FileImage, Save, Copy, History,
  MoreVertical, FolderInput, List, LayoutGrid, GripVertical, RotateCcw, Layers,
  ClipboardPaste, ShieldAlert, ArrowUpDown,
} from 'lucide-react';
import { nextcloudService, type NextcloudEntry } from '../services/nextcloud.service';
import { clientService } from '../services/client.service';
import type { Client } from '../types/client.types';
import { Modal, ModalBody, ModalFooter } from './ui/Modal';
import { Button } from './ui/Button';
import { events, SYSTEM_EVENTS } from '../utils/events';
import { useAuth } from '../contexts/AuthContext';
import {
  watermarkPdf, numberPdfPages, splitPdf, mergePdfs, rotatePdf, imagesToPdf,
  pdfBytesToBlob, getPdfPageCount, normalizeRotation, type PageNumberPosition,
} from '../utils/pdfTools';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

/** Vídeos/áudios são carregados via base64 no proxy; acima disso, só download. */
const MEDIA_MAX_BYTES = 60 * 1024 * 1024;

// Cache de miniaturas por caminho (data URL do PDF ou object URL da imagem).
const thumbCache = new Map<string, string>();

type NextcloudDragEntry = {
  name?: string;
  isDirectory: boolean;
  isFile: boolean;
  fullPath?: string;
};

type NextcloudDragFileEntry = NextcloudDragEntry & {
  file: (callback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
};

type NextcloudDragDirectoryEntry = NextcloudDragEntry & {
  createReader: () => {
    readEntries: (
      successCallback: (entries: NextcloudDragEntry[]) => void,
      errorCallback?: (error: DOMException) => void,
    ) => void;
  };
};

type NextcloudDroppedFile = {
  file: File;
  relativePath: string;
};

type NextcloudPdfToolMode = 'home' | 'watermark' | 'pagenumber' | 'split';

/** Renderiza a 1ª página de um PDF (bytes) em um data URL, via pdfjs. */
async function pdfFirstPageThumb(bytes: ArrayBuffer, width = 150): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/png');
  } finally {
    doc.destroy();
  }
}

/** Miniatura de um item no modo blocos: imagem real, 1ª página do PDF, ou ícone. */
const NcThumb: React.FC<{ entry: NextcloudEntry }> = ({ entry }) => {
  const eligible = (isImage(entry) && entry.size <= 12 * 1024 * 1024) || (isPdf(entry) && entry.size <= 25 * 1024 * 1024);
  const [url, setUrl] = useState<string | null>(() => thumbCache.get(entry.path) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!eligible || thumbCache.has(entry.path)) { setUrl(thumbCache.get(entry.path) ?? null); return; }
    let cancelled = false;
    (async () => {
      try {
        const blob = await nextcloudService.readFile(entry.path);
        let out: string;
        if (isImage(entry)) {
          out = URL.createObjectURL(blob);
        } else {
          out = await pdfFirstPageThumb(await blob.arrayBuffer());
        }
        thumbCache.set(entry.path, out);
        if (!cancelled) setUrl(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [entry.path, entry.size, eligible]);

  const Icon = extIcon(entry);
  if (!eligible || failed) {
    return <div className="w-full h-24 flex items-center justify-center"><Icon className={`w-12 h-12 ${entry.isDir ? 'text-blue-500' : 'text-gray-400'}`} /></div>;
  }
  if (!url) {
    return <div className="w-full h-24 flex items-center justify-center bg-slate-100 dark:bg-gray-800 rounded-lg"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  }
  return (
    <div className="w-full h-24 overflow-hidden rounded-lg bg-slate-100 dark:bg-gray-800 flex items-center justify-center">
      <img src={url} alt={entry.name} className="max-w-full max-h-full object-contain" />
    </div>
  );
};

/** Card arrastável de página do PDF (usado no organizador). */
const SortablePdfPage: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'z-10 opacity-70 scale-[0.98]' : ''}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
};

/**
 * NextcloudBrowser
 * -----------------------------------------------------------------------------
 * Navegador de arquivos que lê/escreve direto no servidor Nextcloud através da
 * Edge Function `nextcloud-proxy`. Independente do CloudModule (Supabase).
 *
 * Recursos: navegar, enviar, baixar, apagar, nova pasta, abrir .docx no
 * EDITOR PRINCIPAL de petições (mesmo editor, em tela cheia — salva de volta
 * no mesmo caminho do Nextcloud, sem criar petição) e pré-visualizar PDF/imagem.
 */

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(mtime: string | null): string {
  if (!mtime) return '';
  const d = new Date(mtime);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

const isDocx = (e: NextcloudEntry) =>
  e.mime.includes('word') || /\.docx?$/i.test(e.name);
const isPdf = (e: NextcloudEntry) =>
  e.mime.includes('pdf') || /\.pdf$/i.test(e.name);
const isImage = (e: NextcloudEntry) =>
  e.mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(e.name);
const isVideo = (e: NextcloudEntry) =>
  e.mime.startsWith('video/') || /\.(mp4|webm|ogv|mov|m4v|mkv|avi)$/i.test(e.name);
const isAudio = (e: NextcloudEntry) =>
  e.mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(e.name);
const isMedia = (e: NextcloudEntry) => isVideo(e) || isAudio(e);

function extIcon(entry: NextcloudEntry) {
  if (entry.isDir) return Folder;
  if (isImage(entry)) return ImageIcon;
  if (isVideo(entry)) return Film;
  if (isAudio(entry)) return Music;
  if (isDocx(entry) || isPdf(entry)) return FileText;
  return FileIcon;
}

/** Nome base (sem extensão) para compor nomes de arquivos derivados. */
function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

const NextcloudBrowser: React.FC = () => {
  const { user } = useAuth();
  const myId = user?.id;
  const [path, setPath] = useState<string>('');
  const [entries, setEntries] = useState<NextcloudEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pdfLibraryOpen, setPdfLibraryOpen] = useState(false);
  const [nameDialog, setNameDialog] = useState<{
    mode: 'create' | 'rename';
    entry?: NextcloudEntry;
    value: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NextcloudEntry | null>(null);
  const [restoreVersionId, setRestoreVersionId] = useState<string | null>(null);

  // Busca (recursiva, tipo Windows Explorer) e menu de contexto.
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<NextcloudEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: NextcloudEntry } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);

  // Modo de exibição (lista / blocos), persistido.
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    try { return localStorage.getItem('nextcloud-view-mode') === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
  });
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>(() => {
    try {
      const saved = localStorage.getItem('nextcloud-sort-by');
      return saved === 'date' || saved === 'size' ? saved : 'name';
    } catch { return 'name'; }
  });
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    try { return localStorage.getItem('nextcloud-sort-dir') === 'desc' ? 'desc' : 'asc'; } catch { return 'asc'; }
  });
  useEffect(() => {
    try { localStorage.setItem('nextcloud-view-mode', viewMode); } catch { /* ignore */ }
  }, [viewMode]);
  useEffect(() => {
    try {
      localStorage.setItem('nextcloud-sort-by', sortBy);
      localStorage.setItem('nextcloud-sort-dir', sortDir);
    } catch { /* ignore */ }
  }, [sortBy, sortDir]);

  // Preview (PDF / imagem)
  const [previewFile, setPreviewFile] = useState<NextcloudEntry | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Vínculo pasta -> cliente
  const [clients, setClients] = useState<Client[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({}); // path -> client_id
  const [linkTarget, setLinkTarget] = useState<NextcloudEntry | null>(null); // pasta sendo vinculada
  const [clientSearch, setClientSearch] = useState('');

  // Seleção múltipla (para juntar PDFs / converter imagens em PDF).
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null);
  const [focusedEntryPath, setFocusedEntryPath] = useState<string | null>(null);
  const [draggedEntries, setDraggedEntries] = useState<NextcloudEntry[] | null>(null);

  // Área de transferência (copiar / recortar / colar).
  const [clipboard, setClipboard] = useState<{ mode: 'copy' | 'cut'; entries: NextcloudEntry[] } | null>(null);

  // Presença de edição: path -> quem está editando.
  const [locks, setLocks] = useState<Record<string, Array<{ id: string; name: string }>>>({});

  // Ferramentas de PDF (modal por arquivo).
  const [pdfToolFile, setPdfToolFile] = useState<NextcloudEntry | null>(null);
  const [pdfToolMode, setPdfToolMode] = useState<NextcloudPdfToolMode>('home');
  const [pdfToolPreviewUrl, setPdfToolPreviewUrl] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfWatermarkText, setPdfWatermarkText] = useState('CONFIDENCIAL');
  const [pdfWatermarkOpacity, setPdfWatermarkOpacity] = useState(0.15);
  const [pdfWatermarkDiagonal, setPdfWatermarkDiagonal] = useState(true);
  const [pdfPageNumPosition, setPdfPageNumPosition] = useState<PageNumberPosition>('bottom-center');
  const [pdfSplitAt, setPdfSplitAt] = useState(1);
  const [pdfSaveAsCopy, setPdfSaveAsCopy] = useState(false);
  const [applyingTool, setApplyingTool] = useState(false);

  // Organizador de páginas de PDF (reordenar / girar / remover / extrair).
  const [organizeFile, setOrganizeFile] = useState<NextcloudEntry | null>(null);
  const [organizeUrl, setOrganizeUrl] = useState<string | null>(null);
  const [organizePages, setOrganizePages] = useState<Array<{ sourceIndex: number; rotation: number }>>([]);
  const [organizeSelected, setOrganizeSelected] = useState<number[]>([]);
  const [organizeReady, setOrganizeReady] = useState(false);
  const [organizeSaving, setOrganizeSaving] = useState(false);
  const [organizeSaveAsCopy, setOrganizeSaveAsCopy] = useState(false);
  const organizeSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Conversão de imagens em PDF.
  const [imagesPdfName, setImagesPdfName] = useState('imagens-convertidas');
  const [imagesPdfTargets, setImagesPdfTargets] = useState<NextcloudEntry[] | null>(null);
  const [convertingImages, setConvertingImages] = useState(false);

  // Histórico de versões do Nextcloud.
  const [versionsFile, setVersionsFile] = useState<NextcloudEntry | null>(null);
  const [versions, setVersions] = useState<Array<{ id: string; label: string; size: number; mtime: string | null }> | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState<string | null>(null);

  const clientNameById = useCallback(
    (id: string | undefined) => (id ? clients.find((c) => c.id === id)?.full_name ?? null : null),
    [clients],
  );

  const segments = useMemo(() => path.split('/').filter(Boolean), [path]);

  const isSearchActive = search.trim().length > 0;

  // Busca recursiva (debounce). Ao buscar, procura em TODAS as subpastas a
  // partir do diretório atual — como o explorador de arquivos do Windows.
  useEffect(() => {
    const q = search.trim();
    if (!q) { setSearchResults(null); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const results = await nextcloudService.search(q, path);
        if (cancelled) return;
        results.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name, 'pt-BR');
        });
        setSearchResults(results);
      } catch (err) {
        if (!cancelled) { setError(err instanceof Error ? err.message : 'Falha na busca.'); setSearchResults([]); }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [search, path]);

  // Entradas exibidas: resultados da busca recursiva quando há termo, senão a pasta.
  const displayEntries = useMemo(() => {
    const list = [...(isSearchActive ? (searchResults ?? []) : entries)];
    return list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let comparison = 0;
      if (sortBy === 'date') comparison = new Date(a.mtime || 0).getTime() - new Date(b.mtime || 0).getTime();
      else if (sortBy === 'size') comparison = a.size - b.size;
      else comparison = a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true });
      return sortDir === 'asc' ? comparison : -comparison;
    });
  }, [entries, isSearchActive, searchResults, sortBy, sortDir]);

  // Fecha o menu de contexto ao clicar fora ou pressionar Esc.
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [ctxMenu]);

  const openCtxMenu = (e: React.MouseEvent, entry: NextcloudEntry) => {
    e.preventDefault();
    // Limita à viewport (menu ~240px largura).
    const x = Math.min(e.clientX, window.innerWidth - 250);
    const y = Math.min(e.clientY, window.innerHeight - 380);
    setCtxMenu({ x, y, entry });
  };

  // Presença de edição: carrega locks + assina realtime (outros editores).
  const loadLocks = useCallback(async () => {
    try {
      const rows = await nextcloudService.listLocks();
      const map: Record<string, Array<{ id: string; name: string }>> = {};
      for (const r of rows) (map[r.path] ||= []).push({ id: r.user_id, name: r.user_name || 'Alguém' });
      setLocks(map);
    } catch { /* presença é opcional */ }
  }, []);
  useEffect(() => {
    loadLocks();
    const unsub = nextcloudService.subscribeLocks(loadLocks);
    const iv = window.setInterval(loadLocks, 60_000); // reavalia expiração dos locks
    return () => { unsub(); window.clearInterval(iv); };
  }, [loadLocks]);

  // Quem (além de mim) está editando `path`.
  const othersEditing = (p: string) => (locks[p] || []).filter((l) => l.id !== myId);

  const closeNameDialog = () => {
    if (!busy) setNameDialog(null);
  };

  const submitNameDialog = async () => {
    if (!nameDialog) return;
    const name = nameDialog.value.trim();
    if (!name || name.includes('/') || name.includes('\\')) {
      setError('Use um nome válido, sem barras.');
      return;
    }
    if (nameDialog.mode === 'rename' && name === nameDialog.entry?.name) {
      setNameDialog(null);
      return;
    }

    const isRename = nameDialog.mode === 'rename' && nameDialog.entry;
    const dir = isRename ? dirOf(nameDialog.entry!.path) : path;
    const destination = [dir, name].filter(Boolean).join('/');
    setBusy(isRename ? 'Renomeando…' : `Criando pasta ${name}…`);
    setError(null);
    try {
      if (isRename) await nextcloudService.move(nameDialog.entry!.path, destination);
      else await nextcloudService.makeFolder(destination);
      setNameDialog(null);
      await load(path);
      showTransient(isRename ? 'Item renomeado com sucesso.' : 'Pasta criada com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : isRename ? 'Falha ao renomear.' : 'Falha ao criar pasta.');
    } finally {
      setBusy(null);
    }
  };

  // ── Copiar / Recortar / Colar ─────────────────────────────────────────────
  const isCut = (p: string) => clipboard?.mode === 'cut' && clipboard.entries.some((e) => e.path === p);

  const copyEntries = (list: NextcloudEntry[]) => {
    if (!list.length) return;
    setClipboard({ mode: 'copy', entries: list });
    showTransient(`${list.length} item(ns) copiado(s). Cole com Ctrl+V.`);
  };
  const cutEntries = (list: NextcloudEntry[]) => {
    if (!list.length) return;
    setClipboard({ mode: 'cut', entries: list });
    showTransient(`${list.length} item(ns) recortado(s). Cole com Ctrl+V.`);
  };

  // Gera um nome único na pasta atual (evita sobrescrever ao colar).
  const uniqueNameHere = (name: string) => {
    const exists = (n: string) => entries.some((e) => e.name === n);
    if (!exists(name)) return name;
    const dot = name.lastIndexOf('.');
    const b = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let i = 1;
    let cand = `${b} (cópia)${ext}`;
    while (exists(cand)) { i++; cand = `${b} (cópia ${i})${ext}`; }
    return cand;
  };

  const paste = async () => {
    if (!clipboard || clipboard.entries.length === 0) return;
    setBusy(clipboard.mode === 'copy' ? 'Colando (copiar)…' : 'Colando (mover)…');
    setError(null);
    try {
      for (const e of clipboard.entries) {
        const srcDir = dirOf(e.path);
        if (clipboard.mode === 'cut' && srcDir === path) continue; // mover p/ mesma pasta: ignora
        const targetName = (clipboard.mode === 'copy' || entries.some((x) => x.name === e.name)) ? uniqueNameHere(e.name) : e.name;
        const dest = [path, targetName].filter(Boolean).join('/');
        if (clipboard.mode === 'copy') await nextcloudService.copy(e.path, dest);
        else await nextcloudService.move(e.path, dest);
      }
      if (clipboard.mode === 'cut') setClipboard(null);
      clearSelection();
      await load(path);
      showTransient(clipboard.mode === 'copy' ? 'Itens colados.' : 'Itens movidos.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao colar.');
    } finally {
      setBusy(null);
    }
  };

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const list = await nextcloudService.list(target);
      list.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, 'pt-BR');
      });
      setEntries(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar do Nextcloud.');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(path); }, [path, load]);

  // Clientes + vínculos de pasta (uma vez).
  const loadLinks = useCallback(async () => {
    try {
      const map = await nextcloudService.getFolderLinks();
      setLinks(map);
    } catch { /* silencioso: vínculo é opcional */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await clientService.listClients();
        setClients(list);
      } catch { /* clientes indisponíveis: recurso de vínculo fica inerte */ }
    })();
    loadLinks();
  }, [loadLinks]);

  const linkToClient = async (clientId: string) => {
    if (!linkTarget) return;
    setBusy('Vinculando cliente…');
    try {
      await nextcloudService.linkFolder(linkTarget.path, clientId);
      await loadLinks();
      setLinkTarget(null);
      setClientSearch('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao vincular cliente.');
    } finally {
      setBusy(null);
    }
  };

  const unlink = async (folderPath: string) => {
    setBusy('Removendo vínculo…');
    try {
      await nextcloudService.unlinkFolder(folderPath);
      await loadLinks();
      setLinkTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover vínculo.');
    } finally {
      setBusy(null);
    }
  };

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients.slice(0, 50);
    return clients.filter((c) => (c.full_name || '').toLowerCase().includes(q)).slice(0, 50);
  }, [clients, clientSearch]);

  // Carrega o blob de preview (PDF/imagem) em uma object URL.
  useEffect(() => {
    if (!previewFile) return;
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const blob = await nextcloudService.readFile(previewFile.path);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Falha ao abrir arquivo.');
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setPreviewUrl(null);
    };
  }, [previewFile]);

  useEffect(() => {
    if (!previewFile) return;
    const closePreviewOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewFile(null);
    };
    window.addEventListener('keydown', closePreviewOnEscape);
    return () => window.removeEventListener('keydown', closePreviewOnEscape);
  }, [previewFile]);

  // Abre o .docx no EDITOR PRINCIPAL (mesmo das petições), com salvamento de
  // volta no Nextcloud. Emite o evento que o PetitionEditorWidget escuta.
  const openInMainEditor = async (entry: NextcloudEntry) => {
    const others = othersEditing(entry.path);
    if (others.length > 0) {
      const names = others.map((o) => o.name).join(', ');
      if (!window.confirm(`${names} ${others.length > 1 ? 'estão' : 'está'} editando "${entry.name}" agora. Se você salvar por cima, pode sobrescrever o trabalho ${others.length > 1 ? 'deles' : 'dele/dela'}.\n\nAbrir mesmo assim?`)) return;
    }
    setBusy(`Abrindo ${entry.name} no editor…`);
    try {
      const blob = await nextcloudService.readFile(entry.path);
      const url = URL.createObjectURL(new Blob([blob], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }));
      // Cliente vinculado à pasta do arquivo (se houver).
      const dir = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
      const linkedClientId = links[dir] || links[entry.path];
      events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN, {
        clientId: linkedClientId,
        mode: 'new',
        initialDocumentUrl: url,
        initialDocumentName: entry.name,
        initialNextcloudPath: entry.path,
        openRequestId: crypto.randomUUID(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir no editor.');
    } finally {
      setBusy(null);
    }
  };

  const openEntry = (entry: NextcloudEntry) => {
    if (entry.isDir) { setSearch(''); setPath(entry.path); return; }
    if (isDocx(entry)) { openInMainEditor(entry); return; }
    if (isMedia(entry) && entry.size > MEDIA_MAX_BYTES) {
      setError(`"${entry.name}" é grande demais (${formatBytes(entry.size)}) para reproduzir no navegador. Baixando…`);
      download(entry);
      return;
    }
    if (isPdf(entry) || isImage(entry) || isMedia(entry)) { setPreviewFile(entry); return; }
    download(entry);
  };

  const download = async (entry: NextcloudEntry) => {
    setBusy(`Baixando ${entry.name}…`);
    try {
      const blob = await nextcloudService.readFile(entry.path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entry.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao baixar.');
    } finally {
      setBusy(null);
    }
  };

  const remove = (entry: NextcloudEntry) => setDeleteTarget(entry);

  const confirmRemove = async () => {
    if (!deleteTarget) return;
    const entry = deleteTarget;
    setBusy(`Apagando ${entry.name}…`);
    setError(null);
    try {
      await nextcloudService.remove(entry.path);
      setDeleteTarget(null);
      setSelected((prev) => {
        const next = { ...prev };
        delete next[entry.path];
        return next;
      });
      await load(path);
      showTransient(`${entry.isDir ? 'Pasta' : 'Arquivo'} removido com sucesso.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao apagar.');
    } finally {
      setBusy(null);
    }
  };

  const newFolder = () => setNameDialog({ mode: 'create', value: '' });

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      setBusy(`Enviando ${file.name}…`);
      try {
        const target = [path, file.name].filter(Boolean).join('/');
        await nextcloudService.writeFile(target, file);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Falha ao enviar ${file.name}.`);
      }
    }
    setBusy(null);
    await load(path);
  };

  const readDroppedFile = useCallback((entry: NextcloudDragFileEntry, parentSegments: string[]) =>
    new Promise<NextcloudDroppedFile>((resolve, reject) => {
      entry.file(
        (file) => resolve({ file, relativePath: [...parentSegments, file.name].filter(Boolean).join('/') }),
        reject,
      );
    }), []);

  const readDroppedDirectory = useCallback((entry: NextcloudDragDirectoryEntry) =>
    new Promise<NextcloudDragEntry[]>((resolve, reject) => {
      const reader = entry.createReader();
      const entries: NextcloudDragEntry[] = [];
      const readBatch = () => {
        reader.readEntries((batch) => {
          if (!batch.length) {
            resolve(entries);
            return;
          }
          entries.push(...batch);
          readBatch();
        }, reject);
      };
      readBatch();
    }), []);

  const collectDroppedFiles = useCallback(async (
    entry: NextcloudDragEntry,
    parentSegments: string[] = [],
  ): Promise<NextcloudDroppedFile[]> => {
    if (entry.isFile) return [await readDroppedFile(entry as NextcloudDragFileEntry, parentSegments)];
    if (!entry.isDirectory) return [];
    const directoryName = String(entry.name || entry.fullPath?.split('/').filter(Boolean).pop() || '').trim();
    const nextSegments = directoryName ? [...parentSegments, directoryName] : parentSegments;
    const children = await readDroppedDirectory(entry as NextcloudDragDirectoryEntry);
    return (await Promise.all(children.map((child) => collectDroppedFiles(child, nextSegments)))).flat();
  }, [readDroppedDirectory, readDroppedFile]);

  const extractDroppedFiles = useCallback(async (dataTransfer: DataTransfer): Promise<NextcloudDroppedFile[]> => {
    const entries = Array.from(dataTransfer.items || [])
      .map((item) => {
        const dragItem = item as DataTransferItem & { webkitGetAsEntry?: () => NextcloudDragEntry | null };
        return dragItem.webkitGetAsEntry?.() ?? null;
      })
      .filter(Boolean) as NextcloudDragEntry[];

    if (entries.length) {
      const nested = (await Promise.all(entries.map((entry) => collectDroppedFiles(entry)))).flat();
      if (nested.length) return nested;
    }

    return Array.from(dataTransfer.files || []).map((file) => ({
      file,
      relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }));
  }, [collectDroppedFiles]);

  const uploadDroppedFiles = useCallback(async (droppedFiles: NextcloudDroppedFile[]) => {
    if (!droppedFiles.length) return;
    setError(null);
    const createdFolders = new Set<string>();
    let completedSuccessfully = false;
    try {
      let completed = 0;
      for (const dropped of droppedFiles) {
        const segments = dropped.relativePath.split('/').map((segment) => segment.trim()).filter(Boolean);
        const folderSegments = segments.slice(0, -1);
        let currentRelativePath = '';
        for (const segment of folderSegments) {
          currentRelativePath = [currentRelativePath, segment].filter(Boolean).join('/');
          const folderPath = [path, currentRelativePath].filter(Boolean).join('/');
          if (!createdFolders.has(folderPath)) {
            setBusy(`Criando ${currentRelativePath}…`);
            await nextcloudService.makeFolder(folderPath);
            createdFolders.add(folderPath);
          }
        }
        const targetPath = [path, ...segments].filter(Boolean).join('/');
        setBusy(`Enviando ${++completed} de ${droppedFiles.length}: ${dropped.file.name}`);
        await nextcloudService.writeFile(targetPath, dropped.file);
      }
      await load(path);
      completedSuccessfully = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar a pasta arrastada.');
    } finally {
      setBusy(null);
      setDragActive(false);
    }
    if (completedSuccessfully) showTransient(`${droppedFiles.length} arquivo(s) enviado(s), mantendo a estrutura de pastas.`);
  }, [load, path]);

  useEffect(() => {
    const element = dropZoneRef.current;
    if (!element) return;
    const containsFiles = (transfer: DataTransfer | null) =>
      Boolean(transfer && (
        Array.from(transfer.items || []).some((item) => item.kind === 'file')
        || Array.from(transfer.types || []).includes('Files')
      ));
    const onDragOver = (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setDragActive(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!element.contains(event.relatedTarget as Node | null)) setDragActive(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer) || !event.dataTransfer) return;
      event.preventDefault();
      setDragActive(false);
      void extractDroppedFiles(event.dataTransfer).then(uploadDroppedFiles);
    };
    element.addEventListener('dragover', onDragOver);
    element.addEventListener('dragleave', onDragLeave);
    element.addEventListener('drop', onDrop);
    return () => {
      element.removeEventListener('dragover', onDragOver);
      element.removeEventListener('dragleave', onDragLeave);
      element.removeEventListener('drop', onDrop);
    };
  }, [extractDroppedFiles, uploadDroppedFiles]);

  useEffect(() => {
    const onPaste = async (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (previewFile || pdfToolFile || organizeFile || imagesPdfTargets || versionsFile || linkTarget) return;
      const imageItem = Array.from(event.clipboardData?.items || []).find((item) => item.type.startsWith('image/'));
      const image = imageItem?.getAsFile();
      if (!image) return;
      event.preventDefault();
      setBusy('Convertendo imagem colada em PDF…');
      setError(null);
      let pastedSuccessfully = false;
      try {
        const bytes = await imagesToPdf([image]);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        await nextcloudService.writeFile([path, `print-${stamp}.pdf`].filter(Boolean).join('/'), pdfBytesToBlob(bytes));
        await load(path);
        pastedSuccessfully = true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao colar a imagem.');
      } finally {
        setBusy(null);
      }
      if (pastedSuccessfully) showTransient('Imagem colada, convertida em PDF e salva na pasta atual.');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [imagesPdfTargets, linkTarget, load, organizeFile, path, pdfToolFile, previewFile, versionsFile]);

  // ── Seleção múltipla ──────────────────────────────────────────────────────
  const toggleSelect = (p: string) =>
    setSelected((prev) => { const next = { ...prev }; if (next[p]) delete next[p]; else next[p] = true; return next; });
  const clearSelection = () => {
    setSelected({});
    setSelectionAnchorPath(null);
    setFocusedEntryPath(null);
  };
  const selectEntry = (entry: NextcloudEntry, options: { toggle?: boolean; range?: boolean } = {}) => {
    const index = displayEntries.findIndex((item) => item.path === entry.path);
    setFocusedEntryPath(entry.path);
    if (options.range && selectionAnchorPath) {
      const anchorIndex = displayEntries.findIndex((item) => item.path === selectionAnchorPath);
      if (anchorIndex >= 0 && index >= 0) {
        const [start, end] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
        setSelected(Object.fromEntries(displayEntries.slice(start, end + 1).map((item) => [item.path, true])));
        return;
      }
    }
    if (options.toggle) {
      toggleSelect(entry.path);
      setSelectionAnchorPath(entry.path);
      return;
    }
    setSelected({ [entry.path]: true });
    setSelectionAnchorPath(entry.path);
  };
  const handleEntryClick = (event: React.MouseEvent, entry: NextcloudEntry) => {
    event.stopPropagation();
    selectEntry(entry, {
      toggle: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
    });
  };
  const selectedEntries = useMemo(
    () => displayEntries.filter((e) => selected[e.path]),
    [displayEntries, selected],
  );
  const selectedFiles = useMemo(() => selectedEntries.filter((entry) => !entry.isDir), [selectedEntries]);
  const selectedPdfs = useMemo(() => selectedFiles.filter(isPdf), [selectedFiles]);
  const selectedImages = useMemo(() => selectedFiles.filter(isImage), [selectedFiles]);

  const handleInternalDragStart = (event: React.DragEvent, entry: NextcloudEntry) => {
    const items = selected[entry.path] ? selectedEntries : [entry];
    if (!selected[entry.path]) selectEntry(entry);
    setDraggedEntries(items);
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData('application/x-nextcloud-paths', JSON.stringify(items.map((item) => item.path)));
    event.dataTransfer.setData('text/plain', `${items.length} item(ns)`);
  };

  const dropSelectedIntoFolder = async (event: React.DragEvent, folder: NextcloudEntry) => {
    if (!folder.isDir || !draggedEntries?.length) return;
    event.preventDefault();
    event.stopPropagation();
    const shouldCopy = event.ctrlKey || event.metaKey || event.altKey;
    setBusy(`${shouldCopy ? 'Copiando' : 'Movendo'} ${draggedEntries.length} item(ns)…`);
    setError(null);
    let completedSuccessfully = false;
    try {
      for (const item of draggedEntries) {
        if (item.path === folder.path || folder.path.startsWith(`${item.path}/`)) continue;
        const destination = `${folder.path}/${item.name}`;
        if (shouldCopy) await nextcloudService.copy(item.path, destination);
        else await nextcloudService.move(item.path, destination);
      }
      setDraggedEntries(null);
      clearSelection();
      await load(path);
      completedSuccessfully = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao mover os itens selecionados.');
    } finally {
      setBusy(null);
    }
    if (completedSuccessfully) showTransient(`${shouldCopy ? 'Cópia' : 'Movimentação'} concluída.`);
  };

  // Atalhos Ctrl/⌘ + C / X / V (só quando o foco não está num campo de texto
  // nem há modal aberto — para não brigar com o editor ou com a busca).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return;
      if (previewFile || pdfToolFile || organizeFile || imagesPdfTargets || versionsFile || linkTarget) return;
      const k = e.key.toLowerCase();
      const command = e.ctrlKey || e.metaKey;
      if (command && k === 'c' && selectedEntries.length) { e.preventDefault(); copyEntries(selectedEntries); }
      else if (command && k === 'x' && selectedEntries.length) { e.preventDefault(); cutEntries(selectedEntries); }
      else if (command && k === 'v' && clipboard) { e.preventDefault(); void paste(); }
      else if (command && k === 'a' && displayEntries.length) {
        e.preventDefault();
        setSelected(Object.fromEntries(displayEntries.map((entry) => [entry.path, true])));
        setSelectionAnchorPath(displayEntries[0].path);
        setFocusedEntryPath(displayEntries[displayEntries.length - 1].path);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!displayEntries.length) return;
        e.preventDefault();
        const currentIndex = Math.max(0, displayEntries.findIndex((entry) => entry.path === focusedEntryPath));
        const gridStep = viewMode === 'grid' ? (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? 1 : 4) : 1;
        const direction = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = Math.max(0, Math.min(displayEntries.length - 1, currentIndex + direction * gridStep));
        const nextEntry = displayEntries[nextIndex];
        selectEntry(nextEntry, { range: e.shiftKey || command, toggle: false });
      } else if (e.key === 'Enter' && focusedEntryPath) {
        const focused = displayEntries.find((entry) => entry.path === focusedEntryPath);
        if (focused) {
          e.preventDefault();
          openEntry(focused);
        }
      } else if (e.key === 'Escape' && selectedEntries.length) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntries, clipboard, previewFile, pdfToolFile, organizeFile, imagesPdfTargets, versionsFile, linkTarget, path, entries, displayEntries, focusedEntryPath, viewMode, selectionAnchorPath]);

  // Diretório de um arquivo (para gravar derivados na mesma pasta).
  const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

  // Grava um resultado de PDF: sobrescreve o original ou cria novo arquivo.
  const writePdfResult = async (source: NextcloudEntry, blob: Blob, newName: string, asCopy: boolean) => {
    const dir = dirOf(source.path);
    const targetName = asCopy ? newName : source.name;
    const target = [dir, targetName].filter(Boolean).join('/');
    await nextcloudService.writeFile(target, blob);
  };

  // ── Ferramentas de PDF ────────────────────────────────────────────────────
  const openPdfTools = async (entry: NextcloudEntry) => {
    setPdfToolFile(entry);
    setPdfToolMode('home');
    setPdfPageCount(null);
    setPdfSplitAt(1);
    setPdfSaveAsCopy(false);
    try {
      const blob = await nextcloudService.readFile(entry.path);
      const buf = await blob.arrayBuffer();
      if (pdfToolPreviewUrl) URL.revokeObjectURL(pdfToolPreviewUrl);
      setPdfToolPreviewUrl(URL.createObjectURL(new Blob([buf], { type: 'application/pdf' })));
      setPdfPageCount(await getPdfPageCount(buf));
    } catch {
      setPdfPageCount(null);
    }
  };

  const closePdfTools = () => {
    if (pdfToolPreviewUrl) URL.revokeObjectURL(pdfToolPreviewUrl);
    setPdfToolPreviewUrl(null);
    setPdfToolFile(null);
    setPdfToolMode('home');
  };

  const readPdfBytes = async (entry: NextcloudEntry) =>
    (await nextcloudService.readFile(entry.path)).arrayBuffer();

  const runPdfTool = async (
    label: string,
    fn: (bytes: ArrayBuffer) => Promise<Uint8Array>,
    suffix: string,
  ) => {
    if (!pdfToolFile) return;
    setApplyingTool(true);
    setError(null);
    try {
      const bytes = await readPdfBytes(pdfToolFile);
      const out = await fn(bytes);
      const blob = pdfBytesToBlob(out);
      const newName = `${baseName(pdfToolFile.name)} (${suffix}).pdf`;
      await writePdfResult(pdfToolFile, blob, newName, pdfSaveAsCopy);
      closePdfTools();
      await load(path);
      setBusy(null);
      showTransient(pdfSaveAsCopy ? `${label}: novo PDF gerado.` : `${label}: PDF atualizado.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao aplicar: ${label}.`);
    } finally {
      setApplyingTool(false);
    }
  };

  const handleWatermark = () =>
    runPdfTool('Marca d\'água', (b) => watermarkPdf(b, {
      text: pdfWatermarkText, opacity: pdfWatermarkOpacity, diagonal: pdfWatermarkDiagonal,
    }), 'marca d\'água');

  const handlePageNumbers = () =>
    runPdfTool('Numeração', (b) => numberPdfPages(b, { position: pdfPageNumPosition }), 'numerado');

  const handleRotateAll = () =>
    runPdfTool('Rotação', (b) => rotatePdf(b, 90), 'girado');

  const handleSplit = async () => {
    if (!pdfToolFile) return;
    setApplyingTool(true);
    setError(null);
    try {
      const bytes = await readPdfBytes(pdfToolFile);
      const { part1, part2, splitAt, total } = await splitPdf(bytes, pdfSplitAt);
      const dir = dirOf(pdfToolFile.path);
      const base = baseName(pdfToolFile.name);
      await nextcloudService.writeFile([dir, `${base} (parte 1).pdf`].filter(Boolean).join('/'), pdfBytesToBlob(part1));
      await nextcloudService.writeFile([dir, `${base} (parte 2).pdf`].filter(Boolean).join('/'), pdfBytesToBlob(part2));
      closePdfTools();
      await load(path);
      showTransient(`PDF dividido: páginas 1-${splitAt} e ${splitAt + 1}-${total}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao dividir PDF.');
    } finally {
      setApplyingTool(false);
    }
  };

  const handleMergeSelected = async () => {
    if (selectedPdfs.length < 2) return;
    setBusy(`Juntando ${selectedPdfs.length} PDFs…`);
    setError(null);
    try {
      const list: ArrayBuffer[] = [];
      for (const f of selectedPdfs) list.push(await readPdfBytes(f));
      const out = await mergePdfs(list);
      const target = [path, `mesclado-${selectedPdfs.length}-arquivos.pdf`].filter(Boolean).join('/');
      await nextcloudService.writeFile(target, pdfBytesToBlob(out));
      clearSelection();
      await load(path);
      showTransient(`${selectedPdfs.length} PDFs juntados com sucesso.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao juntar PDFs.');
    } finally {
      setBusy(null);
    }
  };

  // ── Organizador de páginas (reordenar / girar / remover / extrair) ────────
  const openOrganizer = async (entry: NextcloudEntry) => {
    closePdfTools();
    setOrganizeFile(entry);
    setOrganizePages([]);
    setOrganizeSelected([]);
    setOrganizeReady(false);
    setOrganizeSaveAsCopy(false);
    setError(null);
    try {
      const blob = await nextcloudService.readFile(entry.path);
      setOrganizeUrl(URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir o PDF.');
      setOrganizeFile(null);
    }
  };

  const closeOrganizer = () => {
    if (organizeUrl) { try { URL.revokeObjectURL(organizeUrl); } catch { /* já revogada */ } }
    setOrganizeUrl(null);
    setOrganizeFile(null);
    setOrganizePages([]);
    setOrganizeSelected([]);
    setOrganizeReady(false);
  };

  const onOrganizeLoaded = (numPages: number) => {
    setOrganizePages((prev) => (prev.length ? prev : Array.from({ length: numPages }, (_, i) => ({ sourceIndex: i, rotation: 0 }))));
    setOrganizeReady(true);
  };

  const onOrganizeDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = organizePages.map((p, i) => `${p.sourceIndex}-${i}`);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setOrganizePages((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrganizeSelected([]);
  };

  const rotateOrganizePage = (index: number, delta: number) =>
    setOrganizePages((prev) => prev.map((p, i) => (i === index ? { ...p, rotation: normalizeRotation(p.rotation + delta) } : p)));

  const toggleOrganizeSel = (index: number) =>
    setOrganizeSelected((prev) => (prev.includes(index) ? prev.filter((x) => x !== index) : [...prev, index]));

  const removeOrganizeSelected = () => {
    if (organizeSelected.length === 0) return;
    setOrganizePages((prev) => prev.filter((_, i) => !organizeSelected.includes(i)));
    setOrganizeSelected([]);
  };

  const buildPdfFromPages = async (pageList: Array<{ sourceIndex: number; rotation: number }>): Promise<Blob> => {
    const { PDFDocument, degrees } = await import('pdf-lib');
    const bytes = await (await nextcloudService.readFile(organizeFile!.path)).arrayBuffer();
    const src = await PDFDocument.load(bytes);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, pageList.map((p) => p.sourceIndex));
    copied.forEach((pg, i) => { pg.setRotation(degrees(pageList[i].rotation)); out.addPage(pg); });
    return pdfBytesToBlob(await out.save());
  };

  const saveOrganize = async () => {
    if (!organizeFile || organizePages.length === 0) { setError('O PDF precisa ter ao menos uma página.'); return; }
    setOrganizeSaving(true);
    setError(null);
    try {
      const blob = await buildPdfFromPages(organizePages);
      const dir = dirOf(organizeFile.path);
      const targetName = organizeSaveAsCopy ? `${baseName(organizeFile.name)} (editado).pdf` : organizeFile.name;
      await nextcloudService.writeFile([dir, targetName].filter(Boolean).join('/'), blob);
      closeOrganizer();
      await load(path);
      showTransient(organizeSaveAsCopy ? 'Novo PDF salvo no Nextcloud.' : 'PDF atualizado no Nextcloud.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o PDF.');
    } finally {
      setOrganizeSaving(false);
    }
  };

  const extractOrganizeSelected = async () => {
    if (!organizeFile || organizeSelected.length === 0) { setError('Selecione ao menos uma página para extrair.'); return; }
    setOrganizeSaving(true);
    setError(null);
    try {
      const sorted = [...organizeSelected].sort((a, b) => a - b);
      const blob = await buildPdfFromPages(sorted.map((i) => organizePages[i]));
      const dir = dirOf(organizeFile.path);
      const target = [dir, `${baseName(organizeFile.name)} (extraído).pdf`].filter(Boolean).join('/');
      await nextcloudService.writeFile(target, blob);
      closeOrganizer();
      await load(path);
      showTransient(`${sorted.length} página(s) extraída(s) para novo PDF.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao extrair páginas.');
    } finally {
      setOrganizeSaving(false);
    }
  };

  // ── Conversão imagem → PDF ────────────────────────────────────────────────
  const handleConvertImages = async () => {
    const targets = imagesPdfTargets;
    if (!targets || targets.length === 0) return;
    setConvertingImages(true);
    setError(null);
    try {
      const blobs: Blob[] = [];
      for (const img of targets) blobs.push(await nextcloudService.readFile(img.path));
      const out = await imagesToPdf(blobs);
      const name = (imagesPdfName || 'imagens-convertidas').trim().replace(/\.pdf$/i, '');
      const target = [path, `${name}.pdf`].filter(Boolean).join('/');
      await nextcloudService.writeFile(target, pdfBytesToBlob(out));
      setImagesPdfTargets(null);
      clearSelection();
      await load(path);
      showTransient('PDF gerado a partir das imagens.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao converter imagens em PDF.');
    } finally {
      setConvertingImages(false);
    }
  };

  // ── Versões (Nextcloud Versions app) ──────────────────────────────────────
  const openVersions = async (entry: NextcloudEntry) => {
    setVersionsFile(entry);
    setVersions(null);
    setVersionsLoading(true);
    try {
      setVersions(await nextcloudService.listVersions(entry.path));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar versões.');
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!versionsFile) return;
    setRestoringVersion(versionId);
    try {
      await nextcloudService.restoreVersion(versionsFile.path, versionId);
      setRestoreVersionId(null);
      setVersionsFile(null);
      await load(path);
      showTransient('Versão restaurada com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao restaurar versão.');
    } finally {
      setRestoringVersion(null);
    }
  };

  // Mensagem de sucesso efêmera reutilizando a faixa "busy" (auto-some).
  const showTransient = (msg: string) => {
    setBusy(msg);
    window.setTimeout(() => setBusy((b) => (b === msg ? null : b)), 2500);
  };

  return (
    <div ref={dropZoneRef} className="relative flex flex-col h-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {dragActive && (
        <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-3xl border-2 border-dashed border-blue-500 bg-blue-50/95 shadow-2xl backdrop-blur-sm dark:bg-blue-950/90">
          <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/25">
              <Upload className="h-8 w-8" />
            </div>
            <div>
              <p className="text-lg font-bold text-blue-900 dark:text-blue-100">Solte para enviar ao Nextcloud</p>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">Pastas e subpastas serão recriadas com a estrutura original.</p>
            </div>
          </div>
        </div>
      )}
      {/* Cabeçalho / toolbar (barra do cloud) */}
      <div className="border-b border-gray-200 dark:border-gray-800 bg-gradient-to-r from-blue-50/60 to-transparent dark:from-blue-950/20">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5 min-w-0 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600/10 dark:bg-blue-500/15 flex items-center justify-center">
              <Cloud className="w-5 h-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold leading-tight truncate">Nextcloud</h1>
              <p className="text-xs text-gray-500 truncate">
                {isSearchActive
                  ? (searching ? 'Buscando…' : `${displayEntries.length} resultado(s)`)
                  : `${entries.length} item(ns)`}
              </p>
            </div>
          </div>

          {/* Barra de pesquisa */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus-within:ring-2 focus-within:ring-blue-500/40 focus-within:border-blue-500">
              <Search className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={path ? 'Pesquisar aqui e nas subpastas…' : 'Pesquisar em tudo…'}
                className="bg-transparent outline-none text-sm flex-1 min-w-0"
              />
              {searching && <Loader2 className="w-4 h-4 animate-spin text-gray-400 shrink-0" />}
              {search && (
                <button onClick={() => setSearch('')} title="Limpar busca" className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden lg:flex items-center rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800">
              <ArrowUpDown className="ml-2.5 h-4 w-4 text-gray-400" />
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as 'name' | 'date' | 'size')}
                aria-label="Ordenar por"
                className="h-9 bg-transparent px-2 text-xs outline-none"
              >
                <option value="name">Nome</option>
                <option value="date">Modificação</option>
                <option value="size">Tamanho</option>
              </select>
              <button
                type="button"
                onClick={() => setSortDir((current) => current === 'asc' ? 'desc' : 'asc')}
                title={sortDir === 'asc' ? 'Ordem crescente' : 'Ordem decrescente'}
                className="h-9 border-l border-gray-200 px-2.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
              >
                {sortDir === 'asc' ? 'A–Z' : 'Z–A'}
              </button>
            </div>
            {/* Alternância lista / blocos (preferência salva) */}
            <div className="flex items-center rounded-xl border border-gray-300 dark:border-gray-700 overflow-hidden">
              <button onClick={() => setViewMode('list')} title="Lista" className={`p-2 ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-500'}`}>
                <List className="w-4 h-4" />
              </button>
              <button onClick={() => setViewMode('grid')} title="Blocos" className={`p-2 ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-500'}`}>
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
            <button onClick={newFolder} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
              <FolderPlus className="w-4 h-4" /> <span className="hidden sm:inline">Nova pasta</span>
            </button>
            <button onClick={() => setPdfLibraryOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
              <Wrench className="w-4 h-4 text-red-500" /> <span className="hidden sm:inline">Biblioteca PDF</span>
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl bg-blue-600 text-white hover:bg-blue-700 shadow-sm">
              <Upload className="w-4 h-4" /> <span className="hidden sm:inline">Enviar</span>
            </button>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { handleUpload(e.target.files); e.target.value = ''; }} />
            <button onClick={() => load(path)} title="Recarregar" className="p-2 rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
        <button onClick={() => setPath('')} className="inline-flex items-center gap-1 hover:text-blue-600">
          <Home className="w-4 h-4" /> Início
        </button>
        {segments.map((seg, i) => {
          const target = segments.slice(0, i + 1).join('/');
          return (
            <React.Fragment key={target}>
              <ChevronRight className="w-4 h-4 opacity-50 shrink-0" />
              <button onClick={() => setPath(target)} className="hover:text-blue-600 whitespace-nowrap">{seg}</button>
            </React.Fragment>
          );
        })}
        {clipboard && (
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-gray-400 hidden sm:inline">{clipboard.entries.length} {clipboard.mode === 'cut' ? 'recortado(s)' : 'copiado(s)'}</span>
            <button onClick={() => void paste()} title="Colar (Ctrl+V)" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-xs">
              <ClipboardPaste className="w-3.5 h-3.5" /> Colar
            </button>
            <button onClick={() => setClipboard(null)} title="Cancelar" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {busy && (
        <div className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300">
          <Loader2 className="w-4 h-4 animate-spin" /> {busy}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 text-sm bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Barra de ações da seleção */}
      {selectedEntries.length > 0 && (
        <div
          className="absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100vw_-_24px)] -translate-x-1/2 items-center gap-1.5 overflow-x-auto rounded-2xl border border-violet-200/80 bg-white/95 px-2.5 py-2 text-sm shadow-[0_16px_45px_rgba(76,29,149,0.20)] backdrop-blur-xl dark:border-violet-800/70 dark:bg-zinc-900/95"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="shrink-0 border-r border-violet-100 px-2 pr-3 font-semibold text-violet-700 dark:border-violet-900 dark:text-violet-300">{selectedEntries.length} selecionado(s)</span>
          <button onClick={() => copyEntries(selectedEntries)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-slate-600 transition hover:bg-violet-50 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-violet-950/40 dark:hover:text-violet-300">
            <Copy className="w-4 h-4" /> Copiar
          </button>
          <button onClick={() => cutEntries(selectedEntries)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-slate-600 transition hover:bg-violet-50 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-violet-950/40 dark:hover:text-violet-300">
            <Scissors className="w-4 h-4" /> Recortar
          </button>
          {selectedPdfs.length >= 2 && (
            <button onClick={handleMergeSelected} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-1.5 text-white transition hover:bg-violet-700">
              <Combine className="w-4 h-4" /> Juntar {selectedPdfs.length} PDFs
            </button>
          )}
          {selectedImages.length >= 1 && (
            <button onClick={() => { setImagesPdfTargets(selectedImages); setImagesPdfName('imagens-convertidas'); }} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-1.5 text-white transition hover:bg-violet-700">
              <FileImage className="w-4 h-4" /> {selectedImages.length} imagem(ns) → PDF
            </button>
          )}
          <button onClick={clearSelection} title="Limpar seleção" aria-label="Limpar seleção" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-zinc-800 dark:hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Lista / Blocos */}
      <div className="flex-1 overflow-y-auto" onClick={() => clearSelection()}>
        {(loading && !isSearchActive) || (isSearchActive && searching && !searchResults) ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
            <Loader2 className="w-6 h-6 animate-spin" />
            {isSearchActive && <span className="text-sm">Buscando em todas as subpastas…</span>}
          </div>
        ) : displayEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
            {isSearchActive ? <Search className="w-10 h-10 opacity-40" /> : <Folder className="w-10 h-10 opacity-40" />}
            <span className="text-sm">{isSearchActive ? `Nenhum resultado para “${search}”` : 'Pasta vazia'}</span>
          </div>
        ) : viewMode === 'grid' ? (
          /* ── Blocos ── */
          <div className="grid gap-3 p-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {displayEntries.map((entry) => {
              const Icon = extIcon(entry);
              const linkedClient = entry.isDir ? clientNameById(links[entry.path]) : null;
              const isSel = !!selected[entry.path];
              return (
                <div
                  key={entry.path}
                  onContextMenu={(e) => openCtxMenu(e, entry)}
                  onDoubleClick={() => openEntry(entry)}
                  onClick={(event) => handleEntryClick(event, entry)}
                  draggable
                  onDragStart={(event) => handleInternalDragStart(event, entry)}
                  onDragEnd={() => setDraggedEntries(null)}
                  onDragOver={(event) => {
                    if (entry.isDir && draggedEntries?.length) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey || event.altKey ? 'copy' : 'move';
                    }
                  }}
                  onDrop={(event) => void dropSelectedIntoFolder(event, entry)}
                  className={`group relative flex flex-col items-center gap-2 p-3 rounded-xl border cursor-pointer transition ${isSel ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-sm'} ${isCut(entry.path) ? 'opacity-50' : ''}`}
                >
                  <button onClick={(e) => { e.stopPropagation(); selectEntry(entry, { toggle: true }); }} title={isSel ? 'Desmarcar' : 'Selecionar'} className="absolute top-1.5 left-1.5 text-gray-400 hover:text-blue-600">
                    {isSel ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 opacity-0 group-hover:opacity-100" />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openCtxMenu(e, entry); }} title="Mais ações" className="absolute top-1.5 right-1.5 p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 opacity-0 group-hover:opacity-100 z-10">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {entry.isDir
                    ? <div className="w-full h-24 flex items-center justify-center"><Icon className="w-12 h-12 text-blue-500" /></div>
                    : <NcThumb entry={entry} />}
                  <span className="text-xs text-center leading-tight line-clamp-2 break-all w-full" title={entry.name}>{entry.name}</span>
                  {isSearchActive && <span className="text-[10px] text-gray-400 truncate w-full text-center" title={dirOf(entry.path) || 'raiz'}>{dirOf(entry.path) || 'raiz'}</span>}
                  {!entry.isDir && othersEditing(entry.path).length > 0 && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 truncate max-w-full" title={`Editando agora: ${othersEditing(entry.path).map((o) => o.name).join(', ')}`}>
                      <Pencil className="w-2.5 h-2.5 shrink-0" /> <span className="truncate">{othersEditing(entry.path)[0].name}</span>
                    </span>
                  )}
                  {linkedClient && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 truncate max-w-full">
                      <UserPlus className="w-2.5 h-2.5 shrink-0" /> <span className="truncate">{linkedClient}</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Lista ── */
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-gray-500 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
              <tr>
                <th className="px-2 py-2 w-8" />
                <th className="text-left font-medium px-4 py-2">
                  <button type="button" onClick={() => { if (sortBy === 'name') setSortDir((value) => value === 'asc' ? 'desc' : 'asc'); else setSortBy('name'); }} className="inline-flex items-center gap-1 hover:text-blue-600">
                    Nome {sortBy === 'name' && <ArrowUpDown className="h-3 w-3" />}
                  </button>
                </th>
                <th className="text-right font-medium px-4 py-2 hidden sm:table-cell">
                  <button type="button" onClick={() => { if (sortBy === 'size') setSortDir((value) => value === 'asc' ? 'desc' : 'asc'); else setSortBy('size'); }} className="ml-auto inline-flex items-center gap-1 hover:text-blue-600">
                    Tamanho {sortBy === 'size' && <ArrowUpDown className="h-3 w-3" />}
                  </button>
                </th>
                <th className="text-right font-medium px-4 py-2 hidden md:table-cell">
                  <button type="button" onClick={() => { if (sortBy === 'date') setSortDir((value) => value === 'asc' ? 'desc' : 'asc'); else setSortBy('date'); }} className="ml-auto inline-flex items-center gap-1 hover:text-blue-600">
                    Modificado {sortBy === 'date' && <ArrowUpDown className="h-3 w-3" />}
                  </button>
                </th>
                <th className="px-4 py-2 w-24" />
              </tr>
            </thead>
            <tbody>
              {displayEntries.map((entry) => {
                const Icon = extIcon(entry);
                const linkedClient = entry.isDir ? clientNameById(links[entry.path]) : null;
                const isSel = !!selected[entry.path];
                return (
                  <tr
                    key={entry.path}
                    onContextMenu={(e) => openCtxMenu(e, entry)}
                    onDoubleClick={() => openEntry(entry)}
                    onClick={(event) => handleEntryClick(event, entry)}
                    draggable
                    onDragStart={(event) => handleInternalDragStart(event, entry)}
                    onDragEnd={() => setDraggedEntries(null)}
                    onDragOver={(event) => {
                      if (entry.isDir && draggedEntries?.length) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey || event.altKey ? 'copy' : 'move';
                      }
                    }}
                    onDrop={(event) => void dropSelectedIntoFolder(event, entry)}
                    className={`border-b border-gray-50 dark:border-gray-800/60 hover:bg-gray-50 dark:hover:bg-gray-800/40 group ${isSel ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''} ${isCut(entry.path) ? 'opacity-50' : ''}`}
                  >
                    <td className="px-2 py-2.5 text-center">
                      <button onClick={(event) => { event.stopPropagation(); selectEntry(entry, { toggle: true }); }} title={isSel ? 'Desmarcar' : 'Selecionar'} className="p-1 text-gray-400 hover:text-blue-600">
                        {isSel ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 opacity-0 group-hover:opacity-100" />}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`inline-flex items-center gap-2.5 text-left ${entry.isDir ? 'font-medium' : ''}`}>
                          <Icon className={`w-5 h-5 shrink-0 ${entry.isDir ? 'text-blue-500' : 'text-gray-400'}`} />
                          <span className="flex flex-col min-w-0">
                            <span className="truncate max-w-[40vw]">{entry.name}</span>
                            {isSearchActive && <span className="text-[11px] text-gray-400 truncate max-w-[40vw]">{dirOf(entry.path) || 'raiz'}</span>}
                          </span>
                        </div>
                        {linkedClient && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                            <UserPlus className="w-3 h-3" /> {linkedClient}
                          </span>
                        )}
                        {!entry.isDir && othersEditing(entry.path).length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" title={`Editando agora: ${othersEditing(entry.path).map((o) => o.name).join(', ')}`}>
                            <Pencil className="w-3 h-3" /> {othersEditing(entry.path)[0].name}{othersEditing(entry.path).length > 1 ? ` +${othersEditing(entry.path).length - 1}` : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500 hidden sm:table-cell">{entry.isDir ? '—' : formatBytes(entry.size)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500 hidden md:table-cell">{formatDate(entry.mtime)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end">
                        <button
                          onClick={(e) => { e.stopPropagation(); openCtxMenu(e, entry); }}
                          title="Mais ações"
                          className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 opacity-60 group-hover:opacity-100"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Menu de contexto (botão direito / kebab) */}
      {ctxMenu && (() => {
        const entry = ctxMenu.entry;
        const item = (icon: React.ReactNode, label: string, onClick: () => void, danger = false) => (
          <button
            onClick={() => { setCtxMenu(null); onClick(); }}
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-3 transition ${danger ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
          >
            <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${danger ? 'bg-red-50 dark:bg-red-950/40' : 'bg-gray-100 dark:bg-gray-800'}`}>{icon}</span>
            {label}
          </button>
        );
        return (
          <div
            ref={ctxMenuRef}
            className="fixed z-[9999] w-56 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl py-1 overflow-hidden"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide truncate">{entry.name}</p>
            </div>

            {entry.isDir && item(<Folder className="w-4 h-4 text-blue-500" />, 'Abrir pasta', () => setPath(entry.path))}
            {isDocx(entry) && item(<Pencil className="w-4 h-4 text-blue-600" />, 'Editar no editor', () => openInMainEditor(entry))}
            {(isPdf(entry) || isImage(entry) || isMedia(entry)) && item(<Eye className="w-4 h-4 text-slate-500" />, 'Visualizar', () => setPreviewFile(entry))}
            {isPdf(entry) && item(<Layers className="w-4 h-4 text-indigo-600" />, 'Organizar páginas', () => openOrganizer(entry))}
            {isPdf(entry) && item(<Wrench className="w-4 h-4 text-violet-600" />, 'Ferramentas de PDF', () => openPdfTools(entry))}
            {isImage(entry) && item(<FileImage className="w-4 h-4 text-rose-500" />, 'Converter em PDF', () => { setImagesPdfTargets([entry]); setImagesPdfName(baseName(entry.name)); })}

            <div className="my-1 border-t border-gray-100 dark:border-gray-800" />

            {item(<Copy className="w-4 h-4 text-slate-500" />, 'Copiar', () => copyEntries(selected[entry.path] ? selectedEntries : [entry]))}
            {item(<Scissors className="w-4 h-4 text-slate-500" />, 'Recortar', () => cutEntries(selected[entry.path] ? selectedEntries : [entry]))}
            {clipboard && item(<ClipboardPaste className="w-4 h-4 text-blue-600" />, `Colar ${clipboard.entries.length} aqui`, () => { void paste(); })}

            <div className="my-1 border-t border-gray-100 dark:border-gray-800" />

            {entry.isDir && item(<UserPlus className="w-4 h-4 text-emerald-600" />, links[entry.path] ? 'Alterar vínculo' : 'Vincular a cliente', () => setLinkTarget(entry))}
            {!entry.isDir && item(<History className="w-4 h-4 text-amber-600" />, 'Histórico de versões', () => openVersions(entry))}
            {item(<FolderInput className="w-4 h-4 text-slate-500" />, 'Renomear', () => setNameDialog({ mode: 'rename', entry, value: entry.name }))}
            {!entry.isDir && item(<Download className="w-4 h-4 text-slate-500" />, 'Baixar', () => download(entry))}

            <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
            {item(<Trash2 className="w-4 h-4 text-red-500" />, 'Apagar', () => remove(entry), true)}
          </div>
        );
      })()}

      {/* Modal de preview (PDF / imagem) */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-2 backdrop-blur-sm sm:p-6" onClick={() => setPreviewFile(null)}>
          <div
            className="flex h-[94dvh] w-full max-w-[1380px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-white/15 dark:bg-gray-900 sm:h-[84dvh] sm:w-[88vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-2 dark:border-gray-800 sm:px-5">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">Visualização</p>
                <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{previewFile.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => download(previewFile)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-slate-200 dark:hover:bg-gray-800">
                  <Download className="h-4 w-4" /> <span className="hidden sm:inline">Baixar</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewFile(null)}
                  title="Fechar visualização"
                  aria-label="Fechar visualização"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-slate-100 text-slate-700 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                >
                  <X className="h-5 w-5" strokeWidth={2.5} />
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-200 dark:bg-gray-950">
              {!previewUrl ? (
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              ) : isImage(previewFile) ? (
                <img src={previewUrl} alt={previewFile.name} className="max-w-full max-h-full object-contain" />
              ) : isVideo(previewFile) ? (
                <video src={previewUrl} controls autoPlay className="max-w-full max-h-full" />
              ) : isAudio(previewFile) ? (
                <div className="w-full max-w-lg px-6">
                  <div className="flex flex-col items-center gap-4 text-gray-300">
                    <Music className="w-16 h-16 opacity-60" />
                    <audio src={previewUrl} controls autoPlay className="w-full" />
                  </div>
                </div>
              ) : (
                <iframe src={previewUrl} title={previewFile.name} className="w-full h-full border-0" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: vincular pasta a cliente */}
      {linkTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={() => { setLinkTarget(null); setClientSearch(''); }}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 overflow-hidden flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <div className="min-w-0">
                <h2 className="font-semibold truncate">Vincular a cliente</h2>
                <p className="text-xs text-gray-500 truncate">Pasta: {linkTarget.name}</p>
              </div>
              <button onClick={() => { setLinkTarget(null); setClientSearch(''); }} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            {links[linkTarget.path] && (
              <div className="flex items-center justify-between gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-950/30 text-sm">
                <span className="text-emerald-700 dark:text-emerald-300 truncate">
                  Vinculada a <strong>{clientNameById(links[linkTarget.path])}</strong>
                </span>
                <button onClick={() => unlink(linkTarget.path)} className="inline-flex items-center gap-1 text-red-600 hover:underline shrink-0">
                  <Unlink className="w-4 h-4" /> Remover
                </button>
              </div>
            )}
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800">
                <Search className="w-4 h-4 text-gray-400" />
                <input
                  autoFocus
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Buscar cliente…"
                  className="bg-transparent outline-none text-sm flex-1"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredClients.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-400">Nenhum cliente encontrado.</div>
              ) : (
                filteredClients.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => linkToClient(c.id)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-50 dark:border-gray-800/60"
                  >
                    <UserPlus className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="truncate">{c.full_name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: ferramentas de PDF */}
      {pdfToolFile && (
        <div className="fixed inset-0 z-[135] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => !applyingTool && closePdfTools()}>
          <div className="flex h-[96dvh] w-full flex-col overflow-hidden rounded-t-[24px] bg-[#f8f7f5] shadow-[0_40px_100px_rgba(0,0,0,0.35)] sm:h-[88dvh] sm:max-w-5xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-center gap-4 bg-slate-900 px-5 py-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/15">
                <FileText className="h-5 w-5 text-red-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Hub PDF</p>
                <p className="truncate text-[14px] font-semibold leading-tight text-white">{pdfToolFile.name}</p>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                  <span>{pdfPageCount ?? '…'} página{pdfPageCount === 1 ? '' : 's'}</span>
                  <span className="text-slate-700">·</span>
                  <span>{formatBytes(pdfToolFile.size)}</span>
                </div>
              </div>
              {pdfToolMode !== 'home' && (
                <button onClick={() => setPdfToolMode('home')} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/20 hover:text-white">
                  Ferramentas
                </button>
              )}
              <button onClick={closePdfTools} disabled={applyingTool} aria-label="Fechar Hub PDF" className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-slate-400 transition hover:bg-white/20 hover:text-white disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>

            {pdfToolMode === 'home' ? (
              <div className="flex min-h-0 flex-1">
                <div className="flex w-full shrink-0 flex-col overflow-y-auto border-r border-slate-100 bg-[#f8f7f5] lg:w-[272px]">
                  <p className="px-5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Editar</p>
                  {[
                    { label: 'Organizar', desc: 'Reordenar páginas arrastando', icon: <GripVertical className="h-5 w-5" />, color: 'text-sky-600', bg: 'bg-sky-50 border-sky-200', action: () => void openOrganizer(pdfToolFile) },
                    { label: 'Girar', desc: 'Rotacionar páginas', icon: <RotateCw className="h-5 w-5" />, color: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-200', action: () => void openOrganizer(pdfToolFile) },
                    { label: 'Remover', desc: 'Excluir páginas selecionadas', icon: <Trash2 className="h-5 w-5" />, color: 'text-red-600', bg: 'bg-red-50 border-red-200', action: () => void openOrganizer(pdfToolFile) },
                    { label: 'Dividir', desc: 'Separar em duas partes', icon: <Scissors className="h-5 w-5" />, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', action: () => setPdfToolMode('split' as const) },
                  ].map((tool) => (
                    <button key={tool.label} type="button" onClick={tool.action} className="group mx-3 mb-0.5 flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition hover:bg-white">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${tool.bg} ${tool.color}`}>{tool.icon}</span>
                      <span className="min-w-0 flex-1 text-left"><span className="block text-[13px] font-semibold text-slate-800">{tool.label}</span><span className="block truncate text-[11px] text-slate-400">{tool.desc}</span></span>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                    </button>
                  ))}
                  <p className="mt-1 px-5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Gerar</p>
                  {[
                    { label: 'Marca d’água', desc: 'Estampar texto no PDF', icon: <Stamp className="h-5 w-5" />, color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200', action: () => setPdfToolMode('watermark' as const) },
                    { label: 'Numeração', desc: 'Adicionar nº de páginas', icon: <Hash className="h-5 w-5" />, color: 'text-teal-600', bg: 'bg-teal-50 border-teal-200', action: () => setPdfToolMode('pagenumber' as const) },
                  ].map((tool) => (
                    <button key={tool.label} type="button" onClick={tool.action} className="group mx-3 mb-0.5 flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition hover:bg-white">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${tool.bg} ${tool.color}`}>{tool.icon}</span>
                      <span className="min-w-0 flex-1 text-left"><span className="block text-[13px] font-semibold text-slate-800">{tool.label}</span><span className="block truncate text-[11px] text-slate-400">{tool.desc}</span></span>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                    </button>
                  ))}
                  <p className="mt-1 px-5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Páginas</p>
                  <button onClick={() => void openOrganizer(pdfToolFile)} className="mx-3 mb-0.5 flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition hover:bg-white">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600"><Copy className="h-5 w-5" /></span>
                    <span className="flex-1 text-left"><span className="block text-[13px] font-semibold text-slate-800">Extrair</span><span className="block text-[11px] text-slate-400">Selecione páginas</span></span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                  </button>
                  <button disabled={selectedPdfs.length < 2} onClick={() => void handleMergeSelected()} className="mx-3 mb-0.5 flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-orange-200 bg-orange-50 text-orange-600"><Combine className="h-5 w-5" /></span>
                    <span className="flex-1 text-left"><span className="block text-[13px] font-semibold text-slate-800">Juntar PDFs</span><span className="block text-[11px] text-slate-400">{selectedPdfs.length >= 2 ? `${selectedPdfs.length} PDFs` : 'Selecione 2+ PDFs'}</span></span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                  </button>
                  <div className="mt-auto border-t border-slate-100 px-4 py-4">
                    <button onClick={() => download(pdfToolFile)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] text-slate-600 transition hover:bg-white"><Download className="h-4 w-4 text-slate-400" />Baixar PDF original</button>
                  </div>
                </div>

                <div className="hidden min-w-0 flex-1 flex-col bg-[#f8f9fb] lg:flex">
                  <div className="border-b border-slate-100 bg-white px-5 py-3">
                    <p className="text-sm font-bold text-slate-900">Páginas do documento</p>
                    <p className="mt-0.5 text-xs text-slate-400">Selecione uma ferramenta ao lado para editar o PDF.</p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-5">
                    {pdfToolPreviewUrl ? (
                      <Document file={pdfToolPreviewUrl} loading={<div className="py-12 text-center text-sm text-slate-400"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Carregando PDF…</div>}>
                        <div className="grid grid-cols-3 gap-4 xl:grid-cols-4">
                          {Array.from({ length: pdfPageCount ?? 0 }, (_, index) => (
                            <div key={index} className="overflow-hidden rounded-2xl border border-[#e7e5df] bg-white shadow-sm">
                              <div className="flex min-h-[150px] items-center justify-center bg-slate-50 p-3"><Page pageNumber={index + 1} width={130} renderTextLayer={false} renderAnnotationLayer={false} /></div>
                              <div className="bg-[#f8f7f5] px-3 py-2 text-[11px] font-semibold text-slate-500">{index + 1}</div>
                            </div>
                          ))}
                        </div>
                      </Document>
                    ) : <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1">
                <div className="flex w-full flex-col border-r border-slate-100 bg-white lg:w-[400px] lg:shrink-0">
                  <div className="border-b border-slate-100 px-6 pb-4 pt-6">
                    <h4 className="text-base font-bold text-slate-900">{pdfToolMode === 'watermark' ? 'Marca d’água' : pdfToolMode === 'pagenumber' ? 'Numeração de páginas' : 'Dividir PDF'}</h4>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{pdfToolMode === 'watermark' ? `Texto aplicado em todas as ${pdfPageCount ?? 0} páginas.` : pdfToolMode === 'pagenumber' ? 'Adiciona a numeração em todas as páginas.' : 'Escolha o ponto de corte do documento.'}</p>
                  </div>
                  <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                    {pdfToolMode === 'watermark' && <>
                      <label className="block text-xs font-semibold text-slate-600">Texto da marca d’água<input value={pdfWatermarkText} onChange={(e) => setPdfWatermarkText(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#e7e5df] bg-slate-50 px-3.5 py-2.5 text-sm font-bold uppercase outline-none focus:border-purple-400" /></label>
                      <label className="block text-xs font-semibold text-slate-600">Opacidade — <span className="text-purple-600">{Math.round(pdfWatermarkOpacity * 100)}%</span><input type="range" min={5} max={60} value={Math.round(pdfWatermarkOpacity * 100)} onChange={(e) => setPdfWatermarkOpacity(Number(e.target.value) / 100)} className="mt-2 w-full accent-purple-500" /></label>
                      <div className="grid grid-cols-2 gap-2">{[{ value: true, label: '↗ Diagonal (45°)' }, { value: false, label: '— Horizontal' }].map((option) => <button key={String(option.value)} onClick={() => setPdfWatermarkDiagonal(option.value)} className={`rounded-xl border py-2.5 text-sm font-medium ${pdfWatermarkDiagonal === option.value ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-[#e7e5df] text-slate-600'}`}>{option.label}</button>)}</div>
                    </>}
                    {pdfToolMode === 'pagenumber' && <div className="space-y-2">{([{ value: 'bottom-center', label: 'Rodapé — Centro' }, { value: 'bottom-right', label: 'Rodapé — Direita' }, { value: 'top-center', label: 'Cabeçalho — Centro' }] as { value: PageNumberPosition; label: string }[]).map((option) => <button key={option.value} onClick={() => setPdfPageNumPosition(option.value)} className={`w-full rounded-xl border px-4 py-3 text-left text-sm font-medium ${pdfPageNumPosition === option.value ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-[#e7e5df] text-slate-600'}`}>{option.label}</button>)}</div>}
                    {pdfToolMode === 'split' && <><label className="block text-xs font-semibold text-slate-600">Dividir após a página <span className="text-amber-600">{pdfSplitAt}</span><input type="range" min={1} max={Math.max(1, (pdfPageCount ?? 2) - 1)} value={pdfSplitAt} onChange={(e) => setPdfSplitAt(Number(e.target.value))} className="mt-3 w-full accent-amber-500" /></label><div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center"><p className="text-2xl font-black text-amber-700">{pdfSplitAt}</p><p className="text-xs text-amber-600">Parte 1</p></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center"><p className="text-2xl font-black text-amber-700">{Math.max(0, (pdfPageCount ?? 0) - pdfSplitAt)}</p><p className="text-xs text-amber-600">Parte 2</p></div></div></>}
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={pdfSaveAsCopy} onChange={(e) => setPdfSaveAsCopy(e.target.checked)} className="rounded" />Salvar como cópia</label>
                  </div>
                  <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
                    <button onClick={() => setPdfToolMode('home')} className="flex-1 rounded-xl border border-[#e7e5df] py-2.5 text-sm font-medium text-slate-700">Cancelar</button>
                    <button onClick={() => pdfToolMode === 'watermark' ? handleWatermark() : pdfToolMode === 'pagenumber' ? handlePageNumbers() : void handleSplit()} disabled={applyingTool} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-50">{applyingTool ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{applyingTool ? 'Processando…' : 'Aplicar'}</button>
                  </div>
                </div>
                <div className="hidden flex-1 items-center justify-center bg-[#f8f9fb] p-10 lg:flex"><div className="text-center"><div className="mx-auto mb-4 flex h-20 w-16 items-center justify-center rounded-xl bg-white shadow-md"><FileText className="h-7 w-7 text-slate-300" /></div><p className="max-w-[220px] text-sm leading-relaxed text-slate-400">O resultado será salvo diretamente no Nextcloud.</p></div></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: organizador de páginas de PDF */}
      {organizeFile && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950/70 backdrop-blur-sm" onClick={() => !organizeSaving && closeOrganizer()}>
          <div className="m-2 sm:m-6 flex-1 flex flex-col rounded-2xl bg-white dark:bg-gray-900 overflow-hidden shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-2 min-w-0">
                <Layers className="w-5 h-5 text-indigo-600 shrink-0" />
                <div className="min-w-0">
                  <h2 className="font-semibold truncate">Organizar páginas</h2>
                  <p className="text-xs text-gray-500 truncate">{organizeFile.name} · {organizePages.length} página(s){organizeSelected.length ? ` · ${organizeSelected.length} selecionada(s)` : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="hidden sm:flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={organizeSaveAsCopy} onChange={(e) => setOrganizeSaveAsCopy(e.target.checked)} className="rounded" /> Salvar como cópia
                </label>
                <button onClick={closeOrganizer} disabled={organizeSaving} title="Fechar" className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"><X className="w-5 h-5" /></button>
              </div>
            </div>

            {/* Thumbnails com drag-and-drop */}
            <div className="flex-1 min-h-0 overflow-auto p-4 bg-slate-50 dark:bg-gray-950">
              {organizeUrl ? (
                <Document
                  key={`org-${organizeFile.path}`}
                  file={organizeUrl}
                  loading={<div className="py-12 text-center text-sm text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />Carregando páginas…</div>}
                  error={<div className="py-12 text-center text-sm text-red-400">Não foi possível abrir o PDF.</div>}
                  onLoadSuccess={(pdf) => onOrganizeLoaded(pdf.numPages)}
                  onLoadError={() => setError('Falha ao renderizar o PDF.')}
                >
                  <DndContext sensors={organizeSensors} collisionDetection={closestCenter} onDragEnd={onOrganizeDragEnd}>
                    <SortableContext items={organizePages.map((p, i) => `${p.sourceIndex}-${i}`)} strategy={rectSortingStrategy}>
                      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                        {(organizeReady ? organizePages : []).map((page, index) => {
                          const sel = organizeSelected.includes(index);
                          const id = `${page.sourceIndex}-${index}`;
                          return (
                            <SortablePdfPage key={id} id={id}>
                              <div
                                onClick={() => toggleOrganizeSel(index)}
                                className={`rounded-2xl border bg-white dark:bg-gray-900 transition-all cursor-pointer group hover:shadow-md ${sel ? 'border-indigo-500 shadow-[0_0_0_3px_rgba(99,102,241,0.15)]' : 'border-gray-200 dark:border-gray-800 hover:border-gray-300'}`}
                              >
                                <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
                                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${sel ? 'bg-indigo-500 border-indigo-500' : 'border-gray-300 group-hover:border-indigo-300'}`}>
                                    {sel && <svg viewBox="0 0 8 6" className="w-2 h-2" fill="none" stroke="white" strokeWidth="2"><path d="M1 3l2 2 4-4" /></svg>}
                                  </div>
                                  <span className={`text-[10px] font-bold ${sel ? 'text-indigo-600' : 'text-gray-400'}`}>Pág. {index + 1}</span>
                                  <GripVertical className="w-4 h-4 text-gray-300 cursor-grab" />
                                </div>
                                <div className="mx-3 mb-2 rounded-xl overflow-hidden bg-slate-100 dark:bg-gray-800 flex items-center justify-center" style={{ minHeight: 150 }}>
                                  <Page
                                    key={`p-${page.sourceIndex}-${index}-${page.rotation}`}
                                    pageNumber={page.sourceIndex + 1}
                                    width={130}
                                    rotate={page.rotation}
                                    renderTextLayer={false}
                                    renderAnnotationLayer={false}
                                  />
                                </div>
                                <div className="px-3 pb-2.5 flex items-center justify-between gap-1" onClick={(e) => e.stopPropagation()}>
                                  <span className="text-[10px] text-gray-400 tabular-nums">{page.rotation !== 0 ? `${page.rotation}°` : ''}</span>
                                  <div className="flex items-center gap-1">
                                    <button type="button" onClick={() => rotateOrganizePage(index, -90)} title="Girar esquerda" className="w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-center"><RotateCcw className="w-3.5 h-3.5 text-gray-500" /></button>
                                    <button type="button" onClick={() => rotateOrganizePage(index, 90)} title="Girar direita" className="w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-center"><RotateCw className="w-3.5 h-3.5 text-gray-500" /></button>
                                    <button type="button" onClick={() => { setOrganizeSelected([index]); setTimeout(removeOrganizeSelected, 0); }} title="Remover página" className="w-7 h-7 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>
                                  </div>
                                </div>
                              </div>
                            </SortablePdfPage>
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                </Document>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
              )}
            </div>

            {/* Footer de ações */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <p className="text-xs text-gray-500 hidden sm:block">Arraste para reordenar · clique para selecionar · gire ou remova por página.</p>
              <div className="flex items-center gap-2 ml-auto">
                {organizeSelected.length > 0 && (
                  <>
                    <button onClick={extractOrganizeSelected} disabled={organizeSaving} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40">
                      <Copy className="w-4 h-4" /> Extrair {organizeSelected.length}
                    </button>
                    <button onClick={removeOrganizeSelected} disabled={organizeSaving} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-red-300 dark:border-red-800 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40">
                      <Trash2 className="w-4 h-4" /> Remover {organizeSelected.length}
                    </button>
                  </>
                )}
                <button onClick={saveOrganize} disabled={organizeSaving || organizePages.length === 0} className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                  {organizeSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {organizeSaveAsCopy ? 'Salvar cópia' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: imagens → PDF */}
      {imagesPdfTargets && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={() => !convertingImages && setImagesPdfTargets(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 overflow-hidden flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-2"><FileImage className="w-5 h-5 text-violet-600" /> <h2 className="font-semibold">Imagens → PDF</h2></div>
              <button onClick={() => setImagesPdfTargets(null)} disabled={convertingImages} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500">{imagesPdfTargets.length} imagem(ns), 1 por página, na ordem da pasta. Salvo na pasta atual.</p>
              <label className="block text-sm">Nome do PDF
                <input value={imagesPdfName} onChange={(e) => setImagesPdfName(e.target.value)} className="mt-1 w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent" />
              </label>
              <ul className="max-h-40 overflow-y-auto text-sm text-gray-600 dark:text-gray-400 space-y-1">
                {imagesPdfTargets.map((img) => (
                  <li key={img.path} className="flex items-center gap-2 truncate"><ImageIcon className="w-4 h-4 shrink-0" /> <span className="truncate">{img.name}</span></li>
                ))}
              </ul>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-800">
              <button onClick={() => setImagesPdfTargets(null)} disabled={convertingImages} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 disabled:opacity-40">Cancelar</button>
              <button onClick={handleConvertImages} disabled={convertingImages || !imagesPdfName.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">
                {convertingImages ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Gerar PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: histórico de versões */}
      {versionsFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={() => setVersionsFile(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 overflow-hidden flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-2 min-w-0"><History className="w-5 h-5 text-amber-600 shrink-0" /> <div className="min-w-0"><h2 className="font-semibold truncate">Versões</h2><p className="text-xs text-gray-500 truncate">{versionsFile.name}</p></div></div>
              <button onClick={() => setVersionsFile(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {versionsLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : !versions || versions.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-gray-400">
                  Nenhuma versão anterior.<br />
                  <span className="text-xs">O Nextcloud cria versões automaticamente a cada vez que o arquivo é sobrescrito (requer o app Versions ativo).</span>
                </div>
              ) : (
                versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm border-b border-gray-50 dark:border-gray-800/60">
                    <div className="min-w-0">
                      <div className="truncate">{v.label}</div>
                      <div className="text-xs text-gray-500">{formatBytes(v.size)}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={async () => {
                          try {
                            const blob = await nextcloudService.readVersion(versionsFile.path, v.id);
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = `${baseName(versionsFile.name)} (versão).${versionsFile.name.split('.').pop() || 'bin'}`;
                            document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                          } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao baixar versão.'); }
                        }}
                        title="Baixar esta versão" className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"><Download className="w-4 h-4" /></button>
                      <button onClick={() => setRestoreVersionId(v.id)} disabled={!!restoringVersion} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40">
                        {restoringVersion === v.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />} Restaurar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <Modal
        open={pdfLibraryOpen}
        onClose={() => setPdfLibraryOpen(false)}
        size="lg"
        title="Biblioteca PDF"
        eyebrow="Nextcloud"
        subtitle="Escolha um PDF da pasta atual para abrir o conjunto completo de ferramentas."
        icon={<FileText className="h-5 w-5" />}
        accentBarClassName="bg-red-500"
        iconContainerClassName="rounded-xl bg-red-500 text-white shadow-sm"
        zIndex={159}
      >
        <ModalBody className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { icon: <GripVertical className="h-4 w-4" />, label: 'Organizar' },
              { icon: <RotateCw className="h-4 w-4" />, label: 'Girar' },
              { icon: <Scissors className="h-4 w-4" />, label: 'Dividir' },
              { icon: <Stamp className="h-4 w-4" />, label: 'Marca d’água' },
              { icon: <Hash className="h-4 w-4" />, label: 'Numerar' },
              { icon: <Copy className="h-4 w-4" />, label: 'Extrair' },
              { icon: <Trash2 className="h-4 w-4" />, label: 'Remover páginas' },
              { icon: <Combine className="h-4 w-4" />, label: 'Juntar PDFs' },
            ].map((tool) => (
              <div key={tool.label} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium text-slate-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-slate-300">
                <span className="text-red-500">{tool.icon}</span>
                {tool.label}
              </div>
            ))}
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">PDFs nesta pasta</p>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-zinc-700">
              {entries.filter(isPdf).length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-slate-400">
                  <FileText className="h-9 w-9 opacity-40" />
                  <p className="text-sm">Nenhum PDF na pasta atual.</p>
                  <p className="text-xs">Envie, arraste ou cole uma imagem para criar um PDF.</p>
                </div>
              ) : entries.filter(isPdf).map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => {
                    setPdfLibraryOpen(false);
                    void openPdfTools(entry);
                  }}
                  className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-red-50 dark:border-zinc-800 dark:hover:bg-red-950/20"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500 dark:bg-red-950/40">
                    <FileText className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{entry.name}</span>
                    <span className="text-xs text-slate-400">{formatBytes(entry.size)} · {formatDate(entry.mtime)}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </button>
              ))}
            </div>
          </div>
        </ModalBody>
      </Modal>

      <Modal
        open={Boolean(nameDialog)}
        onClose={closeNameDialog}
        size="sm"
        title={nameDialog?.mode === 'create' ? 'Criar nova pasta' : 'Renomear item'}
        eyebrow="Nextcloud"
        subtitle={nameDialog?.mode === 'create' ? `Local: ${path || 'Início'}` : nameDialog?.entry?.name}
        icon={nameDialog?.mode === 'create' ? <FolderPlus className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
        accentBarClassName="bg-blue-600"
        iconContainerClassName="rounded-xl bg-blue-600 text-white shadow-sm"
        zIndex={160}
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={closeNameDialog} disabled={Boolean(busy)}>Cancelar</Button>
            <Button onClick={() => void submitNameDialog()} disabled={Boolean(busy) || !nameDialog?.value.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : nameDialog?.mode === 'create' ? <FolderPlus className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {nameDialog?.mode === 'create' ? 'Criar pasta' : 'Salvar nome'}
            </Button>
          </ModalFooter>
        }
      >
        <ModalBody className="space-y-2">
          <label htmlFor="nextcloud-item-name" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Nome
          </label>
          <input
            id="nextcloud-item-name"
            autoFocus
            value={nameDialog?.value ?? ''}
            onChange={(event) => setNameDialog((current) => current ? { ...current, value: event.target.value } : current)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitNameDialog();
              }
            }}
            placeholder={nameDialog?.mode === 'create' ? 'Ex.: Documentos do processo' : 'Novo nome'}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
          <p className="text-xs text-slate-500">O nome não pode conter barras.</p>
        </ModalBody>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => !busy && setDeleteTarget(null)}
        size="sm"
        title={`Excluir ${deleteTarget?.isDir ? 'pasta' : 'arquivo'}?`}
        eyebrow="Ação irreversível"
        subtitle={deleteTarget?.name}
        icon={<ShieldAlert className="h-5 w-5" />}
        accentBarClassName="bg-red-500"
        iconContainerClassName="rounded-xl bg-red-500 text-white shadow-sm"
        zIndex={161}
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={Boolean(busy)}>Cancelar</Button>
            <Button variant="danger" onClick={() => void confirmRemove()} disabled={Boolean(busy)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Excluir definitivamente
            </Button>
          </ModalFooter>
        }
      >
        <ModalBody>
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm leading-relaxed text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {deleteTarget?.isDir
              ? 'A pasta e todo o conteúdo dentro dela serão removidos do Nextcloud.'
              : 'O arquivo será removido do Nextcloud.'}
            {' '}Esta ação não pode ser desfeita por este módulo.
          </div>
        </ModalBody>
      </Modal>

      <Modal
        open={Boolean(restoreVersionId && versionsFile)}
        onClose={() => !restoringVersion && setRestoreVersionId(null)}
        size="sm"
        title="Restaurar esta versão?"
        eyebrow="Histórico de versões"
        subtitle={versionsFile?.name}
        icon={<History className="h-5 w-5" />}
        accentBarClassName="bg-amber-500"
        iconContainerClassName="rounded-xl bg-amber-500 text-white shadow-sm"
        zIndex={162}
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => setRestoreVersionId(null)} disabled={Boolean(restoringVersion)}>Cancelar</Button>
            <Button onClick={() => restoreVersionId && void handleRestoreVersion(restoreVersionId)} disabled={Boolean(restoringVersion)}>
              {restoringVersion ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              Restaurar versão
            </Button>
          </ModalFooter>
        }
      >
        <ModalBody>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            A versão atual será substituída. O Nextcloud continuará mantendo o histórico do documento.
          </p>
        </ModalBody>
      </Modal>
    </div>
  );
};

export default NextcloudBrowser;
