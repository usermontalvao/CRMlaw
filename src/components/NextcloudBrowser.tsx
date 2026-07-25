import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Folder, File as FileIcon, FileText, Image as ImageIcon, Film, Download, Upload,
  Trash2, FolderPlus, ChevronLeft, ChevronRight, RefreshCw, Home, AlertCircle, CircleCheck, Loader2,
  Pencil, Eye, X, UserPlus, Search, Unlink, Wrench, Combine, Scissors, Stamp,
  Hash, RotateCw, Music, CheckSquare, Square, FileImage, Save, Copy, History,
  MoreVertical, FolderInput, List, LayoutGrid, GripVertical, RotateCcw, Layers,
  ClipboardPaste, ShieldAlert, ArrowUpDown, ChevronDown, PanelLeftClose,
  PanelLeftOpen, NotebookPen, ZoomIn, ZoomOut, Maximize2, Info, MapPin, Clock3, HardDrive,
} from 'lucide-react';
import {
  getNextcloudErrorMessage,
  nextcloudService,
  NextcloudConflictError,
  type NextcloudEntry,
} from '../services/nextcloud.service';
import { clientService } from '../services/client.service';
import type { Client } from '../types/client.types';
import { Modal, ModalBody, ModalFooter } from './ui/Modal';
import { Button } from './ui/Button';
import { events, SYSTEM_EVENTS } from '../utils/events';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import {
  watermarkPdf, numberPdfPages, splitPdf, mergePdfs, rotatePdf, imagesToPdf,
  pdfBytesToBlob, getPdfPageCount, normalizeRotation, type PageNumberPosition,
  splitPdfByRanges, explodePdfToPages, parsePageList, type PageNumberFormat,
} from '../utils/pdfTools';
import { resolveFreeName } from '../services/nextcloudConflict.service';
import type { BatchItemResult, PdfToolScope } from '../types/nextcloud.types';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { Document, Page, pdfjs } from 'react-pdf';
import JSZip from 'jszip';
import { renderAsync } from 'docx-preview';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { Document as DocxDocument, Packer, Paragraph } from 'docx';
import { NextcloudIcon } from './icons/NextcloudIcon';
import { NcModalCloseButton } from './nextcloud/NcModalCloseButton';
import { SortablePdfPage } from './nextcloud/SortablePdfPage';
import { NcThumb, thumbCache } from './nextcloud/NcThumb';
import { useNextcloudSelection } from '../hooks/useNextcloudSelection';
import { useNextcloudClipboard } from '../hooks/useNextcloudClipboard';
import { useNextcloudLocks } from '../hooks/useNextcloudLocks';
import { setLocalPdfWorker } from '../utils/pdfWorker';
import {
  isDocx, isPdf, isImage, isVideo, isAudio, isMedia, isTextFile,
  fileTypeLabel, extIcon, baseName, fileExtension,
} from '../utils/nextcloudFile';

// Worker do PDF.js empacotado localmente (sem depender do unpkg em runtime).
setLocalPdfWorker(pdfjs);

/** Vídeos/áudios são carregados via base64 no proxy; acima disso, só download. */
const MEDIA_MAX_BYTES = 60 * 1024 * 1024;
const NEXTCLOUD_BROWSER_SESSION_KEY = 'nextcloud-browser-session-v1';

type NextcloudBrowserSession = {
  path: string;
  search: string;
  sidebarOpen: boolean;
  selectedPaths: string[];
  selectionAnchorPath: string | null;
  focusedEntryPath: string | null;
  scrollPositions: Record<string, number>;
};

function nextcloudBrowserSessionKey(userId?: string): string {
  return `${NEXTCLOUD_BROWSER_SESSION_KEY}:${userId || 'local'}`;
}

function readNextcloudBrowserSession(userId?: string): Partial<NextcloudBrowserSession> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(nextcloudBrowserSessionKey(userId)) || '{}') as Partial<NextcloudBrowserSession>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

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

type NextcloudDroppedItem = {
  kind: 'file' | 'directory';
  file?: File;
  relativePath: string;
};

type UploadDropReport = {
  filesUploaded: number;
  foldersCreated: number;
  renamedConflicts: number;
  failures: Array<{ path: string; message: string }>;
};

type NextcloudPdfToolMode = 'home' | 'watermark' | 'pagenumber' | 'split' | 'merge';
type PdfPageState = { sourceIndex: number; rotation: number };

const NextcloudTreeNode: React.FC<{
  name: string;
  nodePath: string;
  activePath: string;
  depth?: number;
  onNavigate: (path: string) => void;
  dropEnabled?: boolean;
  onDropItems?: (event: React.DragEvent, targetPath: string) => void;
}> = ({ name, nodePath, activePath, depth = 0, onNavigate, dropEnabled = false, onDropItems }) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const expandOnDragTimerRef = useRef<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<NextcloudEntry[] | null>(null);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dropOperation, setDropOperation] = useState<'move' | 'copy'>('move');
  const isActive = nodePath === activePath;

  const loadChildren = useCallback(async () => {
    if (children || loadingChildren) return;
    setLoadingChildren(true);
    try {
      const items = await nextcloudService.list(nodePath);
      setChildren(items.filter((item) => item.isDir).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
    } catch {
      setChildren([]);
    } finally {
      setLoadingChildren(false);
    }
  }, [children, loadingChildren, nodePath]);

  useEffect(() => {
    const belongsToActivePath = activePath === nodePath || activePath.startsWith(`${nodePath}/`);
    if (!belongsToActivePath) return;
    setExpanded(true);
    void loadChildren();
  }, [activePath, loadChildren, nodePath]);

  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isActive]);

  useEffect(() => {
    if (dropEnabled) return;
    clearExpandOnDragTimer();
    setDragOver(false);
  }, [dropEnabled]);

  const toggleExpanded = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded) await loadChildren();
  };

  const clearExpandOnDragTimer = () => {
    if (expandOnDragTimerRef.current !== null) {
      window.clearTimeout(expandOnDragTimerRef.current);
      expandOnDragTimerRef.current = null;
    }
  };

  useEffect(() => () => clearExpandOnDragTimer(), []);

  return (
    <div>
      <div
        ref={rowRef}
        role="button"
        tabIndex={0}
        onClick={() => onNavigate(nodePath)}
        onDoubleClick={(event) => void toggleExpanded(event)}
        onDragEnter={(event) => {
          if (!dropEnabled) return;
          event.preventDefault();
          setDragOver(true);
          setDropOperation(event.ctrlKey || event.metaKey || event.altKey ? 'copy' : 'move');
          if (!expanded && expandOnDragTimerRef.current === null) {
            expandOnDragTimerRef.current = window.setTimeout(() => {
              setExpanded(true);
              void loadChildren();
              expandOnDragTimerRef.current = null;
            }, 650);
          }
        }}
        onDragOver={(event) => {
          if (!dropEnabled) return;
          event.preventDefault();
          event.stopPropagation();
          const operation = event.ctrlKey || event.metaKey || event.altKey ? 'copy' : 'move';
          event.dataTransfer.dropEffect = operation;
          setDropOperation(operation);
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          clearExpandOnDragTimer();
          setDragOver(false);
        }}
        onDrop={(event) => {
          if (!dropEnabled || !onDropItems) return;
          event.preventDefault();
          event.stopPropagation();
          clearExpandOnDragTimer();
          setDragOver(false);
          onDropItems(event, nodePath);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onNavigate(nodePath);
          if (event.key === 'ArrowRight' && !expanded) void toggleExpanded(event as unknown as React.MouseEvent);
        }}
        className={`group flex h-8 cursor-default items-center gap-1 rounded-lg pr-2 text-[13px] transition ${
          dragOver
            ? 'bg-blue-600 font-semibold text-white shadow-sm ring-2 ring-blue-300 dark:ring-blue-700'
            : isActive
            ? 'bg-blue-100 font-semibold text-blue-800 dark:bg-blue-950/60 dark:text-blue-200'
            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-zinc-800'
        }`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <button
          type="button"
          onClick={(event) => void toggleExpanded(event)}
          aria-label={expanded ? `Recolher ${name}` : `Expandir ${name}`}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-black/5"
        >
          {loadingChildren
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />}
        </button>
        {dragOver
          ? <FolderInput className="h-4 w-4 shrink-0 animate-pulse text-white" />
          : <Folder className={`h-4 w-4 shrink-0 ${isActive ? 'text-blue-600' : 'text-amber-500'}`} />}
        <span className="truncate" title={name}>{name}</span>
        {dragOver && <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wide">{dropOperation === 'copy' ? 'Copiar' : 'Mover'}</span>}
      </div>
      {expanded && children?.map((child) => (
        <NextcloudTreeNode
          key={child.path}
          name={child.name}
          nodePath={child.path}
          activePath={activePath}
          depth={depth + 1}
          onNavigate={onNavigate}
          dropEnabled={dropEnabled}
          onDropItems={onDropItems}
        />
      ))}
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

function formatDateTime(mtime: string | null): string {
  if (!mtime) return 'Não informado';
  const date = new Date(mtime);
  if (isNaN(date.getTime())) return 'Não informado';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function extensionBadgeClass(extension: string): string {
  if (extension === 'PDF') return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300';
  if (extension === 'DOC' || extension === 'DOCX') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300';
  if (['XLS', 'XLSX', 'CSV'].includes(extension)) return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300';
  if (['PPT', 'PPTX'].includes(extension)) return 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300';
  if (['PNG', 'JPG', 'JPEG', 'GIF', 'WEBP', 'SVG'].includes(extension)) return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300';
  if (['TXT', 'MD', 'LOG', 'JSON', 'XML', 'YAML', 'YML'].includes(extension)) return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';
}

const NextcloudBrowser: React.FC = () => {
  const { user } = useAuth();
  const { moduleParams, clearModuleParams } = useNavigation();
  const myId = user?.id;
  const restoredSessionRef = useRef<Partial<NextcloudBrowserSession>>(readNextcloudBrowserSession(myId));
  const [path, setPath] = useState<string>(() =>
    typeof restoredSessionRef.current.path === 'string' ? restoredSessionRef.current.path : '',
  );
  const [entries, setEntries] = useState<NextcloudEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; stamp: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadDropReport, setUploadDropReport] = useState<UploadDropReport | null>(null);
  // Fila de upload com progresso real por arquivo, cancelamento e nova tentativa.
  type UploadJob = {
    id: string; name: string; file: File; size: number;
    status: 'pending' | 'uploading' | 'done' | 'failed' | 'canceled';
    progress: number; error?: string;
  };
  const [uploadJobs, setUploadJobs] = useState<UploadJob[] | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  // Progresso da geração de ZIP (assíncrona e cancelável).
  const [zipProgress, setZipProgress] = useState<{ label: string; percent: number } | null>(null);
  const zipAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const cancelZip = () => { zipAbortRef.current.cancelled = true; };
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof restoredSessionRef.current.sidebarOpen === 'boolean'
      ? restoredSessionRef.current.sidebarOpen
      : typeof window === 'undefined' || window.innerWidth >= 1024,
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('nextcloud-sidebar-width'));
      return Number.isFinite(saved) && saved >= 210 && saved <= 420 ? saved : 260;
    } catch {
      return 260;
    }
  });
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [sidebarRoots, setSidebarRoots] = useState<NextcloudEntry[]>([]);
  const [sidebarTreeRevision, setSidebarTreeRevision] = useState(0);
  const [nameDialog, setNameDialog] = useState<{
    mode: 'create' | 'createWord' | 'rename';
    entry?: NextcloudEntry;
    value: string;
  } | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<NextcloudEntry[]>([]);
  const [restoreVersionId, setRestoreVersionId] = useState<string | null>(null);
  const [textEditorOpen, setTextEditorOpen] = useState(false);
  const [textEditorEntry, setTextEditorEntry] = useState<NextcloudEntry | null>(null);
  const [textEditorName, setTextEditorName] = useState('Novo documento.txt');
  const [textEditorContent, setTextEditorContent] = useState('');
  const [textEditorSavedContent, setTextEditorSavedContent] = useState('');
  const [textEditorLoading, setTextEditorLoading] = useState(false);
  const [textEditorSaving, setTextEditorSaving] = useState(false);
  const [textDiscardConfirm, setTextDiscardConfirm] = useState(false);
  const [textDiscardAction, setTextDiscardAction] = useState<'close' | 'new'>('close');
  // ETag da versão aberta (controle de concorrência otimista via If-Match).
  const [textEditorEtag, setTextEditorEtag] = useState<string | null>(null);
  // Conflito 412 no salvar do editor de texto: oferece recarregar/copiar/cancelar.
  const [textConflict, setTextConflict] = useState(false);
  const [inlineRename, setInlineRename] = useState<{ path: string; value: string; extension?: string } | null>(null);

  useEffect(() => {
    const rawParams = moduleParams.nextcloud;
    if (!rawParams) return;
    try {
      const params = JSON.parse(rawParams) as { path?: string };
      if (typeof params.path === 'string') {
        setSearch('');
        setPath(params.path);
      }
    } catch {
      // Parâmetros inválidos não devem impedir a abertura do módulo.
    } finally {
      clearModuleParams('nextcloud');
    }
  }, [clearModuleParams, moduleParams.nextcloud]);

  // Busca (recursiva, tipo Windows Explorer) e menu de contexto.
  const [search, setSearch] = useState(() =>
    typeof restoredSessionRef.current.search === 'string' ? restoredSessionRef.current.search : '',
  );
  const [searchResults, setSearchResults] = useState<NextcloudEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry?: NextcloudEntry } | null>(null);
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

  useEffect(() => {
    try { localStorage.setItem('nextcloud-sidebar-width', String(sidebarWidth)); } catch { /* ignore */ }
  }, [sidebarWidth]);

  useEffect(() => {
    if (!resizingSidebar) return;
    const onPointerMove = (event: PointerEvent) => {
      const left = dropZoneRef.current?.getBoundingClientRect().left ?? 0;
      setSidebarWidth(Math.max(210, Math.min(420, event.clientX - left)));
    };
    const stopResizing = () => setResizingSidebar(false);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
    };
  }, [resizingSidebar]);

  // Preview (PDF / imagem)
  const [previewFile, setPreviewFile] = useState<NextcloudEntry | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPdfPages, setPreviewPdfPages] = useState(0);
  const [previewPdfPage, setPreviewPdfPage] = useState(1);
  const [previewPdfZoom, setPreviewPdfZoom] = useState(1);
  const [previewPdfRotation, setPreviewPdfRotation] = useState(0);
  const [previewPdfSidebar, setPreviewPdfSidebar] = useState(true);
  const [previewPageAreaWidth, setPreviewPageAreaWidth] = useState(900);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [previewRotationConfirm, setPreviewRotationConfirm] = useState(false);
  const [previewRotationSaveMode, setPreviewRotationSaveMode] = useState<'copy' | 'replace'>('copy');
  const [previewRotationSaving, setPreviewRotationSaving] = useState(false);
  const previewPageAreaRef = useRef<HTMLDivElement>(null);
  const [previewMediaZoom, setPreviewMediaZoom] = useState(1);
  const [previewMediaRotation, setPreviewMediaRotation] = useState(0);
  const previewMediaShellRef = useRef<HTMLDivElement>(null);

  // Vínculo pasta -> cliente
  const [clients, setClients] = useState<Client[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({}); // path -> client_id
  const [linkTarget, setLinkTarget] = useState<NextcloudEntry | null>(null); // pasta sendo vinculada
  const [clientSearch, setClientSearch] = useState('');

  // Seleção múltipla — estado centralizado no hook useNextcloudSelection.
  const {
    selected, setSelected,
    selectionAnchorPath, setSelectionAnchorPath,
    focusedEntryPath, setFocusedEntryPath,
    toggleSelect,
  } = useNextcloudSelection({
    selectedPaths: restoredSessionRef.current.selectedPaths,
    selectionAnchorPath: restoredSessionRef.current.selectionAnchorPath,
    focusedEntryPath: restoredSessionRef.current.focusedEntryPath,
  });
  const [draggedEntries, setDraggedEntries] = useState<NextcloudEntry[] | null>(null);
  const [dragTargetPath, setDragTargetPath] = useState<string | null>(null);
  const [dragOperation, setDragOperation] = useState<'move' | 'copy'>('move');
  const fileAreaRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef<Record<string, number>>(restoredSessionRef.current.scrollPositions || {});
  const restoredScrollKeyRef = useRef<string | null>(null);
  const sessionSaveTimerRef = useRef<number | null>(null);
  const browserSessionSnapshotRef = useRef<NextcloudBrowserSession>({
    path,
    search,
    sidebarOpen,
    selectedPaths: Object.keys(selected),
    selectionAnchorPath,
    focusedEntryPath,
    scrollPositions: scrollPositionsRef.current,
  });
  const browserScrollKey = JSON.stringify([path, search]);
  browserSessionSnapshotRef.current = {
    path,
    search,
    sidebarOpen,
    selectedPaths: Object.keys(selected),
    selectionAnchorPath,
    focusedEntryPath,
    scrollPositions: scrollPositionsRef.current,
  };
  const persistBrowserSession = useCallback(() => {
    try {
      localStorage.setItem(
        nextcloudBrowserSessionKey(myId),
        JSON.stringify(browserSessionSnapshotRef.current),
      );
    } catch {
      // A navegação continua funcional mesmo quando o armazenamento é bloqueado.
    }
  }, [myId]);
  const scheduleBrowserSessionPersist = useCallback(() => {
    if (sessionSaveTimerRef.current !== null) window.clearTimeout(sessionSaveTimerRef.current);
    sessionSaveTimerRef.current = window.setTimeout(() => {
      sessionSaveTimerRef.current = null;
      persistBrowserSession();
    }, 120);
  }, [persistBrowserSession]);

  useEffect(() => {
    persistBrowserSession();
  }, [
    focusedEntryPath,
    path,
    persistBrowserSession,
    search,
    selected,
    selectionAnchorPath,
    sidebarOpen,
  ]);

  useEffect(() => () => {
    if (sessionSaveTimerRef.current !== null) window.clearTimeout(sessionSaveTimerRef.current);
    persistBrowserSession();
  }, [persistBrowserSession]);

  const marqueeBaseSelectionRef = useRef<Record<string, boolean>>({});
  const suppressFileAreaClickRef = useRef(false);
  const [marquee, setMarquee] = useState<{
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Área de transferência (estado no hook; colar orquestrado no componente).
  // notifyRef desacopla o hook do showTransient (definido mais abaixo).
  const notifyRef = useRef<(message: string) => void>(() => {});
  const notify = useCallback((message: string) => notifyRef.current(message), []);
  const {
    clipboard, setClipboard, isCut, copyEntries, cutEntries,
  } = useNextcloudClipboard(notify);
  const [pendingMovement, setPendingMovement] = useState<{
    entries: NextcloudEntry[];
    targetFolderPath: string;
    source: 'drag' | 'clipboard';
  } | null>(null);
  const [movementExecuting, setMovementExecuting] = useState(false);

  useEffect(() => {
    if (!pendingMovement || movementExecuting) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingMovement(null);
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  }, [movementExecuting, pendingMovement]);

  // Presença de edição: path -> quem está editando.
  const { locks } = useNextcloudLocks();

  // Ferramentas de PDF (modal por arquivo).
  const [pdfToolFile, setPdfToolFile] = useState<NextcloudEntry | null>(null);
  const [pdfToolFiles, setPdfToolFiles] = useState<NextcloudEntry[]>([]);
  const [pdfToolMode, setPdfToolMode] = useState<NextcloudPdfToolMode>('home');
  const [pdfToolPreviewUrl, setPdfToolPreviewUrl] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfWatermarkText, setPdfWatermarkText] = useState('CONFIDENCIAL');
  const [pdfWatermarkOpacity, setPdfWatermarkOpacity] = useState(0.15);
  const [pdfWatermarkDiagonal, setPdfWatermarkDiagonal] = useState(true);
  const [pdfPageNumPosition, setPdfPageNumPosition] = useState<PageNumberPosition>('bottom-center');
  const [pdfPageNumStart, setPdfPageNumStart] = useState(1);
  const [pdfPageNumFormat, setPdfPageNumFormat] = useState<'n' | 'n-of-total' | 'custom'>('n-of-total');
  const [pdfPageNumTemplate, setPdfPageNumTemplate] = useState('Fls. {n}');
  const [pdfPageNumRange, setPdfPageNumRange] = useState('');
  const [pdfWatermarkRange, setPdfWatermarkRange] = useState('');
  // Pré-visualização real da marca d'água (bytes gerados sob demanda).
  const [pdfWatermarkPreviewUrl, setPdfWatermarkPreviewUrl] = useState<string | null>(null);
  const [pdfWatermarkPreviewBusy, setPdfWatermarkPreviewBusy] = useState(false);
  const [pdfSplitAt, setPdfSplitAt] = useState(1);
  const [pdfSaveAsCopy, setPdfSaveAsCopy] = useState(true);
  const [mergePdfName, setMergePdfName] = useState('documentos-unificados');
  const [applyingTool, setApplyingTool] = useState(false);
  // Escopo explícito das ferramentas que aceitam vários PDFs: só o documento
  // ativo, ou todos os PDFs do conjunto carregado. Fonte única de verdade.
  const [pdfToolScope, setPdfToolScope] = useState<PdfToolScope>('active');
  // Modo de divisão: em duas partes, por intervalos ("1-3, 5"), ou 1 por página.
  const [pdfSplitMode, setPdfSplitMode] = useState<'half' | 'ranges' | 'pages'>('half');
  const [pdfSplitRanges, setPdfSplitRanges] = useState('');
  // Resultado por item da última operação em lote (para exibir e re-tentar).
  const [pdfBatchResults, setPdfBatchResults] = useState<BatchItemResult[] | null>(null);
  // Guarda a última operação de lote para re-tentar só os itens que falharam.
  const lastPdfBatchOpRef = useRef<{
    label: string; fn: (b: ArrayBuffer) => Promise<Uint8Array>; suffix: string; asCopy: boolean;
  } | null>(null);

  // Organizador de páginas de PDF (reordenar / girar / remover / extrair).
  const [organizeFile, setOrganizeFile] = useState<NextcloudEntry | null>(null);
  const [organizeUrl, setOrganizeUrl] = useState<string | null>(null);
  const [organizePages, setOrganizePages] = useState<PdfPageState[]>([]);
  const [organizeInitialPages, setOrganizeInitialPages] = useState<PdfPageState[]>([]);
  const [organizePast, setOrganizePast] = useState<PdfPageState[][]>([]);
  const [organizeFuture, setOrganizeFuture] = useState<PdfPageState[][]>([]);
  const [organizeSelected, setOrganizeSelected] = useState<number[]>([]);
  const [organizeReady, setOrganizeReady] = useState(false);
  const [organizeSaving, setOrganizeSaving] = useState(false);
  const [organizeSaveAsCopy, setOrganizeSaveAsCopy] = useState(true);
  const [organizeExitIntent, setOrganizeExitIntent] = useState<'back' | 'close' | null>(null);
  const organizeSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const organizerDirty = useMemo(
    () => JSON.stringify(organizePages) !== JSON.stringify(organizeInitialPages),
    [organizeInitialPages, organizePages],
  );

  // Conversão de imagens em PDF.
  const [imagesPdfName, setImagesPdfName] = useState('imagens-convertidas');
  const [imagesPdfTargets, setImagesPdfTargets] = useState<NextcloudEntry[] | null>(null);
  const [imagesPdfViewMode, setImagesPdfViewMode] = useState<'list' | 'grid'>('grid');
  const [convertingImages, setConvertingImages] = useState(false);
  const [convertingDocxPaths, setConvertingDocxPaths] = useState<string[]>([]);

  // Histórico de versões do Nextcloud.
  const [versionsFile, setVersionsFile] = useState<NextcloudEntry | null>(null);
  const [versions, setVersions] = useState<Array<{ id: string; label: string; size: number; mtime: string | null }> | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState<string | null>(null);

  // Propriedades de arquivos e pastas, incluindo totais calculados recursivamente.
  const [propertiesTargets, setPropertiesTargets] = useState<NextcloudEntry[]>([]);
  const [propertiesStats, setPropertiesStats] = useState<{ files: number; folders: number; size: number } | null>(null);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);
  // Cancelamento do cálculo recursivo de propriedades (compartilhado com a UI).
  const propertiesAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const cancelPropertiesCalc = () => {
    propertiesAbortRef.current.cancelled = true;
    setPropertiesLoading(false);
    setPropertiesError('Cálculo cancelado. Os totais mostrados são parciais.');
  };
  // Teto defensivo: evita varrer eternamente árvores gigantescas.
  const PROPERTIES_MAX_NODES = 50_000;

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
        if (!cancelled) {
          setError(getNextcloudErrorMessage(err, 'pesquisar arquivos e pastas'));
          setSearchResults([]);
        }
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

  useLayoutEffect(() => {
    if (loading || searching || restoredScrollKeyRef.current === browserScrollKey) return;
    const area = fileAreaRef.current;
    if (!area) return;
    const desiredPosition = Math.max(0, scrollPositionsRef.current[browserScrollKey] || 0);
    // Na primeira passagem os itens ainda podem não ter sido carregados. Nesse
    // caso, aguardamos a lista ganhar altura antes de confirmar a restauração.
    if (desiredPosition > 0 && area.scrollHeight <= area.clientHeight) return;
    const frame = window.requestAnimationFrame(() => {
      area.scrollTop = Math.min(desiredPosition, Math.max(0, area.scrollHeight - area.clientHeight));
      restoredScrollKeyRef.current = browserScrollKey;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [browserScrollKey, displayEntries.length, loading, searching, viewMode]);

  useEffect(() => {
    if (!propertiesTargets.length) {
      setPropertiesStats(null);
      setPropertiesLoading(false);
      setPropertiesError(null);
      return;
    }
    const token = { cancelled: false };
    propertiesAbortRef.current = token;
    const hasFolder = propertiesTargets.some((entry) => entry.isDir);
    setPropertiesLoading(hasFolder);
    setPropertiesError(null);
    setPropertiesStats(null);
    const stats = { files: 0, folders: 0, size: 0 };
    let visited = 0;
    let capped = false;

    const collect = async (entry: NextcloudEntry, countFolder: boolean): Promise<void> => {
      if (token.cancelled || capped) return;
      visited += 1;
      if (visited > PROPERTIES_MAX_NODES) { capped = true; return; }
      if (!entry.isDir) {
        stats.files += 1;
        stats.size += entry.size || 0;
        // Atualização parcial periódica para o usuário ver progresso.
        if (stats.files % 200 === 0 && !token.cancelled) setPropertiesStats({ ...stats });
        return;
      }
      if (countFolder) stats.folders += 1;
      const children = await nextcloudService.list(entry.path);
      for (const child of children) {
        if (token.cancelled || capped) return;
        await collect(child, true);
      }
    };

    void (async () => {
      try {
        for (const target of propertiesTargets) await collect(target, false);
        if (!token.cancelled) {
          setPropertiesStats({ ...stats });
          if (capped) setPropertiesError(`Pasta muito grande: totais parciais até ${PROPERTIES_MAX_NODES.toLocaleString('pt-BR')} itens.`);
        }
      } catch (err) {
        if (!token.cancelled) {
          setPropertiesStats({ ...stats });
          setPropertiesError(err instanceof Error ? err.message : 'Não foi possível calcular todo o conteúdo.');
        }
      } finally {
        if (!token.cancelled) setPropertiesLoading(false);
      }
    })();

    return () => { token.cancelled = true; };
  }, [propertiesTargets]);

  useEffect(() => {
    if (!propertiesTargets.length) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPropertiesTargets([]);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [propertiesTargets.length]);

  const previewMediaFiles = useMemo(
    () => displayEntries.filter((entry) => !entry.isDir && (isImage(entry) || isVideo(entry))),
    [displayEntries],
  );
  const previewMediaIndex = previewFile
    ? previewMediaFiles.findIndex((entry) => entry.path === previewFile.path)
    : -1;
  const navigatePreviewMedia = useCallback((offset: number) => {
    if (previewMediaIndex < 0 || previewMediaFiles.length < 2) return;
    const nextIndex = (previewMediaIndex + offset + previewMediaFiles.length) % previewMediaFiles.length;
    setPreviewFile(previewMediaFiles[nextIndex]);
  }, [previewMediaFiles, previewMediaIndex]);

  // Fecha o menu de contexto ao clicar fora ou pressionar Esc.
  useEffect(() => {
    if (!ctxMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const menu = ctxMenuRef.current;
      if (!menu || !menu.contains(event.target as Node)) setCtxMenu(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setCtxMenu(null); };
    const onWindowBlur = () => setCtxMenu(null);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [ctxMenu]);

  // Mede o menu já renderizado e o mantém integralmente dentro da viewport.
  // Isso evita depender de uma altura estimada, que quebra quando novas ações
  // são adicionadas ou quando o item está próximo da borda inferior.
  useLayoutEffect(() => {
    if (!ctxMenu || !ctxMenuRef.current) return;
    const reposition = () => {
      const menu = ctxMenuRef.current;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      const margin = 8;
      const nextX = Math.max(margin, Math.min(ctxMenu.x, window.innerWidth - rect.width - margin));
      const nextY = Math.max(margin, Math.min(ctxMenu.y, window.innerHeight - rect.height - margin));
      if (Math.abs(nextX - ctxMenu.x) > 0.5 || Math.abs(nextY - ctxMenu.y) > 0.5) {
        setCtxMenu((current) => current ? { ...current, x: nextX, y: nextY } : current);
      }
    };
    reposition();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [ctxMenu]);

  const openCtxMenu = (e: React.MouseEvent, entry: NextcloudEntry) => {
    e.preventDefault();
    e.stopPropagation();
    // Como no Explorer/Finder: botão direito preserva uma seleção múltipla
    // quando o item clicado já faz parte dela; caso contrário, seleciona apenas
    // o item clicado. Assim todas as ações do menu usam o mesmo conjunto.
    if (!selected[entry.path]) {
      setSelected({ [entry.path]: true });
      setSelectionAnchorPath(entry.path);
      setFocusedEntryPath(entry.path);
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const openBlankCtxMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    if ((event.target as HTMLElement).closest('[data-nextcloud-entry-path]')) return;
    clearSelection();
    setCtxMenu({ x: event.clientX, y: event.clientY });
  };

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
    const isCreateWord = nameDialog.mode === 'createWord';
    const dir = isRename ? dirOf(nameDialog.entry!.path) : path;
    const normalizedName = isCreateWord && !name.toLowerCase().endsWith('.docx') ? `${name}.docx` : name;
    const destination = [dir, normalizedName].filter(Boolean).join('/');
    setBusy(isRename ? 'Renomeando…' : isCreateWord ? 'Criando documento Word…' : `Criando pasta ${name}…`);
    setError(null);
    try {
      if (isRename) {
        await nextcloudService.move(nameDialog.entry!.path, destination);
      } else if (isCreateWord) {
        const document = new DocxDocument({
          sections: [{ properties: {}, children: [new Paragraph('')] }],
        });
        await nextcloudService.writeFile(destination, await Packer.toBlob(document));
      } else {
        await nextcloudService.makeFolder(destination);
      }
      setNameDialog(null);
      await load(path);
      showTransient(isRename ? 'Item renomeado com sucesso.' : isCreateWord ? 'Documento Word criado.' : 'Pasta criada com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : isRename ? 'Falha ao renomear.' : isCreateWord ? 'Falha ao criar o documento Word.' : 'Falha ao criar pasta.');
    } finally {
      setBusy(null);
    }
  };

  // ── Copiar / Recortar / Colar ─────────────────────────────────────────────
  // Gera um nome único no destino (evita sobrescrever ao colar).
  const uniqueNameForPaste = (name: string, reservedNames: Set<string>) => {
    if (!reservedNames.has(name)) {
      reservedNames.add(name);
      return name;
    }
    const dot = name.lastIndexOf('.');
    const b = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let i = 1;
    let cand = `${b} (cópia)${ext}`;
    while (reservedNames.has(cand)) { i++; cand = `${b} (cópia ${i})${ext}`; }
    reservedNames.add(cand);
    return cand;
  };

  const createItemInline = async (kind: 'folder' | 'word' | 'text' | 'markdown') => {
    const defaults = {
      folder: { name: 'Nova pasta', mime: 'httpd/unix-directory', extension: undefined },
      word: { name: 'Novo documento.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx' },
      text: { name: 'Novo documento.txt', mime: 'text/plain', extension: '.txt' },
      markdown: { name: 'Nova nota.md', mime: 'text/markdown', extension: '.md' },
    } as const;
    const definition = defaults[kind];
    setBusy(kind === 'folder' ? 'Criando pasta…' : 'Criando arquivo…');
    setError(null);
    try {
      const name = await resolveFreeName(path, definition.name);
      const target = [path, name].filter(Boolean).join('/');
      let size = 0;
      if (kind === 'folder') {
        await nextcloudService.makeFolder(target);
      } else {
        const blob = kind === 'word'
          ? await Packer.toBlob(new DocxDocument({ sections: [{ properties: {}, children: [new Paragraph('')] }] }))
          : new Blob([''], { type: `${definition.mime};charset=utf-8` });
        size = blob.size;
        await nextcloudService.writeFile(target, blob);
      }
      const createdEntry: NextcloudEntry = {
        name,
        path: target,
        isDir: kind === 'folder',
        size,
        mime: definition.mime,
        mtime: new Date().toISOString(),
      };
      setEntries((current) => [...current.filter((entry) => entry.path !== target), createdEntry]);
      if (kind === 'folder') {
        if (!path) setSidebarRoots((current) => [...current.filter((entry) => entry.path !== target), createdEntry]);
        setSidebarTreeRevision((revision) => revision + 1);
      }
      setInlineRename({ path: target, value: name, extension: definition.extension });
      setSelected({ [target]: true });
      setFocusedEntryPath(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar o item.');
    } finally {
      setBusy(null);
    }
  };

  const finishInlineRename = async () => {
    if (!inlineRename) return;
    const source = inlineRename.path;
    const originalName = source.split('/').pop() || 'Novo documento.docx';
    let name = inlineRename.value.trim();
    if (!name) name = originalName;
    const requiredExtension = inlineRename.extension;
    if (requiredExtension && !name.toLowerCase().endsWith(requiredExtension)) name += requiredExtension;
    if (name.includes('/') || name.includes('\\')) {
      setError('Use um nome válido, sem barras.');
      return;
    }
    if (name === originalName) {
      setInlineRename(null);
      return;
    }
    const destination = [dirOf(source), name].filter(Boolean).join('/');
    setBusy('Renomeando documento…');
    setError(null);
    try {
      await nextcloudService.move(source, destination);
      setInlineRename(null);
      setEntries((current) => current.map((entry) => entry.path === source
        ? { ...entry, name, path: destination, mtime: new Date().toISOString() }
        : entry));
      setSidebarRoots((current) => current.map((entry) => entry.path === source
        ? { ...entry, name, path: destination, mtime: new Date().toISOString() }
        : entry));
      setSidebarTreeRevision((revision) => revision + 1);
      setSelected({ [destination]: true });
      setFocusedEntryPath(destination);
      showTransient('Documento criado e renomeado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao renomear o documento.');
    } finally {
      setBusy(null);
    }
  };

  const startInlineRename = (entry: NextcloudEntry) => {
    const dot = entry.name.lastIndexOf('.');
    const extension = !entry.isDir && dot > 0 ? entry.name.slice(dot) : undefined;
    setInlineRename({ path: entry.path, value: entry.name, extension });
    setSelected({ [entry.path]: true });
    setFocusedEntryPath(entry.path);
  };

  const paste = async (destinationPath = path, confirmedMovement = false): Promise<boolean> => {
    if (!clipboard || clipboard.entries.length === 0) return false;
    if (clipboard.mode === 'cut' && !confirmedMovement) {
      setPendingMovement({
        entries: [...clipboard.entries],
        targetFolderPath: destinationPath,
        source: 'clipboard',
      });
      return false;
    }
    setBusy(clipboard.mode === 'copy' ? 'Colando (copiar)…' : 'Colando (mover)…');
    setError(null);
    try {
      // Nome livre confirmado no SERVIDOR (não na lista exibida) — nunca
      // sobrescreve silenciosamente. `reserved` evita colisão entre os itens
      // desta mesma operação.
      const reserved = new Set<string>();
      for (const e of clipboard.entries) {
        const srcDir = dirOf(e.path);
        if (clipboard.mode === 'cut' && srcDir === destinationPath) continue; // mover p/ mesma pasta: ignora
        const targetName = await resolveFreeName(destinationPath, e.name, reserved);
        reserved.add(targetName);
        const dest = [destinationPath, targetName].filter(Boolean).join('/');
        if (clipboard.mode === 'copy') await nextcloudService.copy(e.path, dest);
        else await nextcloudService.move(e.path, dest);
      }
      if (clipboard.mode === 'cut') setClipboard(null);
      clearSelection();
      await load(path);
      showTransient(clipboard.mode === 'copy'
        ? `Itens copiados para ${destinationPath === path ? 'esta pasta' : 'a pasta escolhida'}.`
        : `Itens movidos para ${destinationPath === path ? 'esta pasta' : 'a pasta escolhida'}.`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao colar.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const load = useCallback(async (target: string, opts?: { silent?: boolean }) => {
    // `silent`: refresh de fundo (realtime/foco/polling) — não mostra o spinner
    // de carregamento nem apaga a lista/erro atual em caso de falha transitória.
    const silent = opts?.silent === true;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const list = await nextcloudService.list(target);
      list.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, 'pt-BR');
      });
      setEntries(list);
      if (!target) setSidebarRoots(list.filter((item) => item.isDir).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Falha ao carregar do Nextcloud.');
        setEntries([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(path); }, [path, load]);

  // ── Realtime: mudanças externas no Nextcloud (webhook → Supabase → aqui) ────
  // Mantém a pasta aberta sincronizada quando alguém altera arquivos direto no
  // servidor, sem exigir "Recarregar". O refresh é SILENCIOSO: preserva seleção,
  // rolagem, modo de exibição e a busca em andamento (recarrega `entries`, que
  // fica oculto enquanto a busca mostra `searchResults`).
  const pathRef = useRef(path);
  useEffect(() => { pathRef.current = path; }, [path]);

  // Não faz refresh de fundo enquanto um modal/editor está aberto por cima.
  const backgroundBlockedRef = useRef(false);
  useEffect(() => {
    backgroundBlockedRef.current = Boolean(
      previewFile || textEditorOpen || nameDialog || pdfToolFile || organizeFile
      || versionsFile || linkTarget || deleteTargets.length > 0 || imagesPdfTargets
      || uploadDropReport || busy,
    );
  }, [previewFile, textEditorOpen, nameDialog, pdfToolFile, organizeFile, versionsFile, linkTarget, deleteTargets.length, imagesPdfTargets, uploadDropReport, busy]);

  const refreshSidebarRoots = useCallback(async () => {
    try {
      const items = await nextcloudService.list('');
      setSidebarRoots(items.filter((item) => item.isDir).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
    } catch { /* a barra lateral é secundária */ }
  }, []);

  useEffect(() => {
    const parentOf = (p: string | null | undefined): string | null => {
      if (p === null || p === undefined) return null;
      const i = p.lastIndexOf('/');
      return i >= 0 ? p.slice(0, i) : '';
    };
    const pendingDirs = new Set<string>();
    let rootTouched = false;
    let timer: number | null = null;

    // Debounce: eventos costumam vir em rajada (ex.: create + write juntos).
    const flush = () => {
      timer = null;
      const current = pathRef.current;
      if (rootTouched) { rootTouched = false; void refreshSidebarRoots(); }
      if (pendingDirs.has(current)) void load(current, { silent: true });
      pendingDirs.clear();
    };

    const unsub = nextcloudService.subscribeFileChanges((evt) => {
      // Miniaturas: conteúdo pode ter mudado (write) ou o caminho sumiu (rename).
      for (const p of [evt.nodePath, evt.sourcePath, evt.targetPath]) if (p) thumbCache.delete(p);

      // Se a pasta ATUALMENTE aberta foi apagada/renomeada, sobe para a pai.
      const removed = evt.eventClass.includes('NodeDeleted')
        ? (evt.nodePath ?? evt.sourcePath)
        : evt.eventClass.includes('NodeRenamed') ? evt.sourcePath : null;
      if (removed && removed === pathRef.current) {
        setPath(parentOf(removed) ?? '');
      } else if (removed) {
        // Remove da seleção o item que deixou de existir.
        setSelected((prev) => { if (!prev[removed]) return prev; const next = { ...prev }; delete next[removed]; return next; });
      }

      // Diretórios afetados: o calculado pelo backend + pais de origem/destino.
      for (const d of [evt.affectedDirectory, parentOf(evt.sourcePath), parentOf(evt.targetPath)]) {
        if (d !== null) pendingDirs.add(d);
      }
      // Alteração em nível raiz → atualizar a barra lateral (pasta raiz criada/removida/renomeada).
      if (evt.affectedDirectory === '' || parentOf(evt.sourcePath) === '' || parentOf(evt.targetPath) === '') rootTouched = true;

      if (timer === null) timer = window.setTimeout(flush, 500);
    });

    return () => { unsub(); if (timer !== null) window.clearTimeout(timer); };
  }, [load, refreshSidebarRoots]);

  // Fallback (caso o Realtime caia): recupera mudanças no foco/visibilidade e um
  // polling leve de 45s — só com a aba visível e sem modal/editor bloqueando.
  useEffect(() => {
    const silentRefresh = () => {
      if (document.visibilityState === 'visible' && !backgroundBlockedRef.current) {
        void load(pathRef.current, { silent: true });
      }
    };
    const onFocus = () => silentRefresh();
    const onVisibility = () => { if (document.visibilityState === 'visible') silentRefresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const iv = window.setInterval(silentRefresh, 45_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(iv);
    };
  }, [load]);

  useEffect(() => {
    let active = true;
    nextcloudService.list('')
      .then((items) => {
        if (active) setSidebarRoots(items.filter((item) => item.isDir).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      })
      .catch(() => {
        if (active) setSidebarRoots([]);
      });
    return () => { active = false; };
  }, []);

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
    setPreviewPdfPages(0);
    setPreviewPdfPage(1);
    setPreviewPdfZoom(1);
    setPreviewPdfRotation(0);
    setPreviewRotationConfirm(false);
    setPreviewRotationSaveMode('copy');
    setPreviewMediaZoom(1);
    setPreviewMediaRotation(0);
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
  }, [previewFile, previewRevision]);

  useEffect(() => {
    if (!previewFile) return;
    const closePreviewOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (previewRotationConfirm) {
          setPreviewRotationConfirm(false);
          return;
        }
        setPreviewFile(null);
        return;
      }
      if (isImage(previewFile) || isVideo(previewFile)) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          navigatePreviewMedia(-1);
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          navigatePreviewMedia(1);
        }
        return;
      }
      if (!isPdf(previewFile)) return;
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        setPreviewPdfPage((page) => Math.max(1, page - 1));
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        setPreviewPdfPage((page) => Math.min(Math.max(1, previewPdfPages), page + 1));
      }
    };
    window.addEventListener('keydown', closePreviewOnEscape);
    return () => window.removeEventListener('keydown', closePreviewOnEscape);
  }, [navigatePreviewMedia, previewFile, previewPdfPages, previewRotationConfirm]);

  useEffect(() => {
    if (!previewFile || !isPdf(previewFile) || !previewUrl) return;
    const element = previewPageAreaRef.current;
    if (!element) return;
    const updateWidth = () => setPreviewPageAreaWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [previewFile, previewUrl, previewPdfSidebar]);

  // Abre o .docx no EDITOR PRINCIPAL (mesmo das petições), em uma NOVA ABA do
  // navegador, mantendo este navegador de arquivos aberto. O payload (que contém
  // o caminho com nome de cliente) vai por um TOKEN aleatório no localStorage —
  // nunca na URL — e a nova aba lê o arquivo do servidor pelo initialNextcloudPath.
  // window.open é chamado DENTRO do clique (sem await antes) p/ não ser bloqueado.
  const openInMainEditor = (entry: NextcloudEntry) => {
    const others = othersEditing(entry.path);
    if (others.length > 0) {
      const names = others.map((o) => o.name).join(', ');
      if (!window.confirm(`${names} ${others.length > 1 ? 'estão' : 'está'} editando "${entry.name}" agora. Se você salvar por cima, pode sobrescrever o trabalho ${others.length > 1 ? 'deles' : 'dele/dela'}.\n\nAbrir mesmo assim?`)) return;
    }
    // Cliente vinculado à pasta do arquivo (se houver).
    const dir = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    const linkedClientId = links[dir] || links[entry.path];
    const payload = {
      clientId: linkedClientId,
      mode: 'new' as const,
      initialDocumentName: entry.name,
      initialNextcloudPath: entry.path,
      openRequestId: crypto.randomUUID(),
    };
    try {
      const token = crypto.randomUUID();
      const key = `petition-editor-open:${token}`;
      localStorage.setItem(key, JSON.stringify(payload));
      const target = `${window.location.pathname}${window.location.search}#editor-doc=${token}`;
      const win = window.open(target, '_blank');
      if (!win) {
        // Popup bloqueado → fallback: abre na mesma aba (comportamento antigo).
        localStorage.removeItem(key);
        events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN, payload);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir no editor.');
    }
  };

  const openTextEditor = async (entry?: NextcloudEntry) => {
    setTextEditorOpen(true);
    setTextEditorEntry(entry ?? null);
    setTextEditorName(entry?.name ?? 'Novo documento.txt');
    setTextEditorContent('');
    setTextEditorSavedContent('');
    if (!entry) return;
    setTextEditorLoading(true);
    setError(null);
    try {
      const blob = await nextcloudService.readFile(entry.path);
      const content = await blob.text();
      setTextEditorContent(content);
      setTextEditorSavedContent(content);
      // Guarda o ETag remoto para detectar edição concorrente ao salvar.
      try { const meta = await nextcloudService.stat(entry.path); setTextEditorEtag(meta.etag ?? null); }
      catch { setTextEditorEtag(null); }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir o arquivo de texto.');
      setTextEditorOpen(false);
    } finally {
      setTextEditorLoading(false);
    }
  };

  const saveTextEditor = async () => {
    if (!textEditorOpen || textEditorSaving) return false;
    let normalizedName = textEditorName.trim() || 'Novo documento.txt';
    if (!/\.[a-z0-9]+$/i.test(normalizedName)) normalizedName += '.txt';
    if (normalizedName.includes('/') || normalizedName.includes('\\')) {
      setError('O nome do arquivo não pode conter barras.');
      return false;
    }
    const target = textEditorEntry?.path
      ? [dirOf(textEditorEntry.path), normalizedName].filter(Boolean).join('/')
      : [path, normalizedName].filter(Boolean).join('/');
    setTextEditorSaving(true);
    setError(null);
    try {
      const movedNow = Boolean(textEditorEntry && target !== textEditorEntry.path);
      if (movedNow) {
        await nextcloudService.move(textEditorEntry!.path, target);
      }
      const blob = new Blob([textEditorContent], { type: 'text/plain;charset=utf-8' });
      // Só usa If-Match ao SOBRESCREVER a mesma versão que abrimos (não em
      // arquivo novo nem após mover). Assim detectamos edição concorrente (412).
      const useIfMatch = !movedNow && textEditorEntry && target === textEditorEntry.path ? textEditorEtag : null;
      const put = await nextcloudService.writeFile(target, blob, { ifMatch: useIfMatch });
      setTextEditorName(normalizedName);
      setTextEditorSavedContent(textEditorContent);
      setTextEditorEtag(put.etag ?? null);
      setTextEditorEntry({
        name: normalizedName,
        path: target,
        isDir: false,
        size: blob.size,
        mime: 'text/plain',
        mtime: new Date().toISOString(),
      });
      await load(path);
      showTransient('Arquivo de texto salvo no Nextcloud.');
      return true;
    } catch (err) {
      if (err instanceof NextcloudConflictError) {
        setTextConflict(true);
        return false;
      }
      setError(err instanceof Error ? err.message : 'Falha ao salvar o arquivo de texto.');
      return false;
    } finally {
      setTextEditorSaving(false);
    }
  };

  // --- Resolução do conflito 412 do editor de texto -------------------------
  // Recarrega a versão do servidor, descartando as edições locais.
  const textConflictReload = async () => {
    if (!textEditorEntry) return;
    setTextConflict(false);
    setTextEditorSaving(true);
    setError(null);
    try {
      const blob = await nextcloudService.readFile(textEditorEntry.path);
      const content = await blob.text();
      setTextEditorContent(content);
      setTextEditorSavedContent(content);
      const meta = await nextcloudService.stat(textEditorEntry.path);
      setTextEditorEtag(meta.etag ?? null);
      showTransient('Versão do servidor recarregada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao recarregar a versão do servidor.');
    } finally {
      setTextEditorSaving(false);
    }
  };

  // Salva as edições locais como uma CÓPIA nova (sem sobrescrever a do servidor).
  const textConflictSaveCopy = async () => {
    if (!textEditorEntry) return;
    setTextConflict(false);
    setTextEditorSaving(true);
    setError(null);
    try {
      const dir = dirOf(textEditorEntry.path);
      const freeName = await resolveFreeName(dir, textEditorName.trim() || 'Novo documento.txt');
      const target = [dir, freeName].filter(Boolean).join('/');
      const blob = new Blob([textEditorContent], { type: 'text/plain;charset=utf-8' });
      const put = await nextcloudService.writeFile(target, blob);
      setTextEditorName(freeName);
      setTextEditorSavedContent(textEditorContent);
      setTextEditorEtag(put.etag ?? null);
      setTextEditorEntry({ name: freeName, path: target, isDir: false, size: blob.size, mime: 'text/plain', mtime: new Date().toISOString() });
      await load(path);
      showTransient(`Cópia salva como “${freeName}”.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar a cópia.');
    } finally {
      setTextEditorSaving(false);
    }
  };

  const closeTextEditor = (discard = false) => {
    if (!discard && textEditorContent !== textEditorSavedContent) {
      setTextDiscardAction('close');
      setTextDiscardConfirm(true);
      return;
    }
    setTextDiscardConfirm(false);
    setTextEditorOpen(false);
    setTextEditorEntry(null);
    setTextEditorContent('');
    setTextEditorSavedContent('');
  };

  const createNewTextDocument = () => {
    if (textEditorContent !== textEditorSavedContent) {
      setTextDiscardAction('new');
      setTextDiscardConfirm(true);
      return;
    }
    void openTextEditor();
  };

  useEffect(() => {
    if (!textEditorOpen) return;
    const onTextEditorShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveTextEditor();
      }
      if (event.key === 'Escape' && !textDiscardConfirm) {
        event.preventDefault();
        closeTextEditor();
      }
    };
    window.addEventListener('keydown', onTextEditorShortcut);
    return () => window.removeEventListener('keydown', onTextEditorShortcut);
  });

  const openEntry = (entry: NextcloudEntry) => {
    if (entry.isDir) { setSearch(''); setPath(entry.path); return; }
    if (isDocx(entry)) { openInMainEditor(entry); return; }
    if (isTextFile(entry)) { void openTextEditor(entry); return; }
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
      triggerBlobDownload(blob, entry.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao baixar.');
    } finally {
      setBusy(null);
    }
  };

  const triggerBlobDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadEntries = async (requestedEntries: NextcloudEntry[]) => {
    if (requestedEntries.length === 0) return;
    if (requestedEntries.length === 1 && !requestedEntries[0].isDir) {
      await download(requestedEntries[0]);
      return;
    }

    // Evita duplicar itens quando uma pasta e um arquivo dentro dela foram
    // selecionados ao mesmo tempo nos resultados da pesquisa.
    const roots = requestedEntries.filter((entry, index, all) =>
      all.findIndex((candidate) => candidate.path === entry.path) === index
      && !all.some((candidate) => candidate.isDir && entry.path.startsWith(`${candidate.path}/`)),
    );
    // Geração ASSÍNCRONA (JSZip) — não trava a interface como o generate síncrono
    // do PizZip. Cancelável: interrompemos a coleta de arquivos e a geração.
    const token = { cancelled: false };
    zipAbortRef.current = token;
    const zip = new JSZip();
    const usedRootNames = new Set<string>();
    let downloadedFiles = 0;

    const uniqueRootName = (name: string) => {
      if (!usedRootNames.has(name)) {
        usedRootNames.add(name);
        return name;
      }
      const extension = fileExtension(name);
      const stem = extension ? name.slice(0, -(extension.length + 1)) : name;
      let suffix = 2;
      let candidate = extension ? `${stem} (${suffix}).${extension.toLowerCase()}` : `${stem} (${suffix})`;
      while (usedRootNames.has(candidate)) {
        suffix += 1;
        candidate = extension ? `${stem} (${suffix}).${extension.toLowerCase()}` : `${stem} (${suffix})`;
      }
      usedRootNames.add(candidate);
      return candidate;
    };

    const addEntryToZip = async (entry: NextcloudEntry, zipPath: string): Promise<void> => {
      if (token.cancelled) return;
      if (entry.isDir) {
        zip.folder(zipPath);
        const children = await nextcloudService.list(entry.path);
        for (const child of children) {
          if (token.cancelled) return;
          await addEntryToZip(child, `${zipPath}/${child.name}`);
        }
        return;
      }
      const blob = await nextcloudService.readFile(entry.path);
      zip.file(zipPath, await blob.arrayBuffer(), { binary: true });
      downloadedFiles += 1;
      setZipProgress({ label: `Lendo arquivos… (${downloadedFiles})`, percent: 0 });
    };

    setError(null);
    setZipProgress({ label: 'Preparando arquivos…', percent: 0 });
    try {
      for (const entry of roots) {
        if (token.cancelled) break;
        await addEntryToZip(entry, uniqueRootName(entry.name));
      }
      if (token.cancelled) { showTransient('Download em ZIP cancelado.'); return; }

      const zipBlob = await zip.generateAsync(
        { type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE' },
        (meta) => {
          if (token.cancelled) throw new Error('__zip_cancelled__');
          setZipProgress({ label: `Compactando ${downloadedFiles} arquivo(s)…`, percent: Math.round(meta.percent) });
        },
      );
      if (token.cancelled) { showTransient('Download em ZIP cancelado.'); return; }

      const stamp = new Date().toISOString().slice(0, 10);
      const zipName = roots.length === 1 && roots[0].isDir
        ? `${roots[0].name}.zip`
        : `arquivos-nextcloud-${stamp}.zip`;
      triggerBlobDownload(zipBlob, zipName);
      showTransient(`${downloadedFiles} arquivo(s) baixado(s) em ZIP.`);
    } catch (err) {
      if (token.cancelled || (err instanceof Error && err.message === '__zip_cancelled__')) {
        showTransient('Download em ZIP cancelado.');
      } else {
        setError(err instanceof Error ? err.message : 'Falha ao preparar o arquivo ZIP.');
      }
    } finally {
      setZipProgress(null);
    }
  };

  const remove = (targets: NextcloudEntry[]) => {
    if (targets.length) setDeleteTargets(targets);
  };

  const confirmRemove = async () => {
    if (!deleteTargets.length) return;
    const targets = [...deleteTargets];
    setBusy(targets.length === 1 ? `Apagando ${targets[0].name}…` : `Apagando ${targets.length} itens…`);
    setError(null);
    try {
      const results = await Promise.allSettled(targets.map((entry) => nextcloudService.remove(entry.path)));
      const removedPaths = targets
        .filter((_, index) => results[index].status === 'fulfilled')
        .map((entry) => entry.path);
      const failedTargets = targets.filter((_, index) => results[index].status === 'rejected');

      setSelected((prev) => {
        const next = { ...prev };
        removedPaths.forEach((entryPath) => delete next[entryPath]);
        return next;
      });
      await load(path);

      if (failedTargets.length) {
        setDeleteTargets(failedTargets);
        setError(`${removedPaths.length} item(ns) removido(s), mas ${failedTargets.length} não puderam ser apagado(s). Tente novamente.`);
      } else {
        setDeleteTargets([]);
        showTransient(targets.length === 1
          ? `${targets[0].isDir ? 'Pasta' : 'Arquivo'} removido com sucesso.`
          : `${targets.length} itens removidos com sucesso.`);
      }
    } finally {
      setBusy(null);
    }
  };

  const newFolder = () => { void createItemInline('folder'); };

  // Envia uma fila de jobs com progresso real por arquivo, concorrência
  // limitada e cancelamento. Atualiza `uploadJobs` no lugar. Resolve o nome
  // livre no servidor (não sobrescreve arquivos existentes).
  const runUploadJobs = async (jobs: UploadJob[]) => {
    const abort = new AbortController();
    uploadAbortRef.current = abort;
    const reserved = new Set<string>();

    const patch = (id: string, changes: Partial<UploadJob>) =>
      setUploadJobs((prev) => (prev ? prev.map((j) => (j.id === id ? { ...j, ...changes } : j)) : prev));

    const uploadOne = async (job: UploadJob) => {
      if (abort.signal.aborted) { patch(job.id, { status: 'canceled' }); return; }
      patch(job.id, { status: 'uploading', progress: 0, error: undefined });
      try {
        const name = await resolveFreeName(path, job.name, reserved);
        reserved.add(name);
        const target = [path, name].filter(Boolean).join('/');
        await nextcloudService.writeFileWithProgress(target, job.file, {
          signal: abort.signal,
          onProgress: (loaded, totalBytes) =>
            patch(job.id, { progress: totalBytes ? Math.round((loaded / totalBytes) * 100) : 0 }),
        });
        patch(job.id, { status: 'done', progress: 100 });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') patch(job.id, { status: 'canceled' });
        else patch(job.id, { status: 'failed', error: err instanceof Error ? err.message : 'Falha no envio.' });
      }
    };

    const CONCURRENCY = 3;
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length && !abort.signal.aborted) {
        await uploadOne(jobs[cursor++]);
      }
      // Marca como cancelados os que ainda estavam pendentes ao abortar.
      if (abort.signal.aborted) {
        setUploadJobs((prev) => (prev ? prev.map((j) => (j.status === 'pending' || j.status === 'uploading' ? { ...j, status: 'canceled' } : j)) : prev));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
    uploadAbortRef.current = null;
    await load(path);
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const jobs: UploadJob[] = Array.from(files).map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name, file, size: file.size, status: 'pending', progress: 0,
    }));
    setError(null);
    setUploadJobs(jobs);
    await runUploadJobs(jobs);
  };

  const cancelUploads = () => uploadAbortRef.current?.abort();

  const retryFailedUploads = async () => {
    const failed = (uploadJobs ?? []).filter((j) => j.status === 'failed' || j.status === 'canceled');
    if (failed.length === 0) return;
    const retried = failed.map((j) => ({ ...j, status: 'pending' as const, progress: 0, error: undefined }));
    setUploadJobs((prev) => (prev ? prev.map((j) => {
      const match = retried.find((r) => r.id === j.id);
      return match ?? j;
    }) : retried));
    await runUploadJobs(retried);
  };

  const dismissUploadJobs = () => { setUploadJobs(null); uploadAbortRef.current = null; };

  const readDroppedFile = useCallback((entry: NextcloudDragFileEntry, parentSegments: string[]) =>
    new Promise<NextcloudDroppedItem>((resolve, reject) => {
      entry.file(
        (file) => resolve({ kind: 'file', file, relativePath: [...parentSegments, file.name].filter(Boolean).join('/') }),
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
  ): Promise<NextcloudDroppedItem[]> => {
    if (entry.isFile) return [await readDroppedFile(entry as NextcloudDragFileEntry, parentSegments)];
    if (!entry.isDirectory) return [];
    const directoryName = String(entry.name || entry.fullPath?.split('/').filter(Boolean).pop() || '').trim();
    const nextSegments = directoryName ? [...parentSegments, directoryName] : parentSegments;
    const children = await readDroppedDirectory(entry as NextcloudDragDirectoryEntry);
    const directoryPath = nextSegments.filter(Boolean).join('/');
    const descendants = (await Promise.all(children.map((child) => collectDroppedFiles(child, nextSegments)))).flat();
    return directoryPath
      ? [{ kind: 'directory', relativePath: directoryPath }, ...descendants]
      : descendants;
  }, [readDroppedDirectory, readDroppedFile]);

  const extractDroppedFiles = useCallback(async (dataTransfer: DataTransfer): Promise<NextcloudDroppedItem[]> => {
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
      kind: 'file' as const,
      file,
      relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }));
  }, [collectDroppedFiles]);

  const uploadDroppedFiles = useCallback(async (droppedItems: NextcloudDroppedItem[]) => {
    if (!droppedItems.length) return;
    setError(null);
    setUploadDropReport(null);
    const report: UploadDropReport = { filesUploaded: 0, foldersCreated: 0, renamedConflicts: 0, failures: [] };
    const directories = Array.from(new Set(
      droppedItems
        .filter((item) => item.kind === 'directory')
        .map((item) => item.relativePath),
    )).sort((a, b) => a.split('/').length - b.split('/').length);
    const files = droppedItems.filter((item): item is NextcloudDroppedItem & { kind: 'file'; file: File } =>
      item.kind === 'file' && item.file instanceof File,
    );

    try {
      // Cria primeiro toda a árvore, inclusive pastas vazias. MKCOL é
      // idempotente no proxy, portanto pastas existentes são reutilizadas.
      for (const relativeDirectory of directories) {
        try {
          setBusy(`Preparando pasta ${relativeDirectory}…`);
          await nextcloudService.makeFolder([path, relativeDirectory].filter(Boolean).join('/'));
          report.foldersCreated += 1;
        } catch (err) {
          report.failures.push({
            path: relativeDirectory,
            message: err instanceof Error ? err.message : 'Falha ao criar pasta.',
          });
        }
      }

      // Cacheia nomes por diretório para evitar sobrescrever arquivos existentes.
      const namesByDirectory = new Map<string, Set<string>>();
      const namesForDirectory = async (directoryPath: string) => {
        const cached = namesByDirectory.get(directoryPath);
        if (cached) return cached;
        try {
          const children = await nextcloudService.list(directoryPath);
          const names = new Set(children.map((entry) => entry.name));
          namesByDirectory.set(directoryPath, names);
          return names;
        } catch {
          const names = new Set<string>();
          namesByDirectory.set(directoryPath, names);
          return names;
        }
      };

      for (let index = 0; index < files.length; index += 1) {
        const dropped = files[index];
        const segments = dropped.relativePath.split('/').map((segment) => segment.trim()).filter(Boolean);
        const originalName = segments[segments.length - 1] || dropped.file.name;
        const relativeDirectory = segments.slice(0, -1).join('/');
        const destinationDirectory = [path, relativeDirectory].filter(Boolean).join('/');

        // Alguns navegadores não expõem as pastas separadamente no DataTransfer.
        // Garante a árvore pai também nesse fallback.
        let currentRelativePath = '';
        for (const segment of segments.slice(0, -1)) {
          currentRelativePath = [currentRelativePath, segment].filter(Boolean).join('/');
          const folderPath = [path, currentRelativePath].filter(Boolean).join('/');
          if (!directories.includes(currentRelativePath)) {
            try {
              setBusy(`Preparando pasta ${currentRelativePath}…`);
              await nextcloudService.makeFolder(folderPath);
              directories.push(currentRelativePath);
              report.foldersCreated += 1;
            } catch (err) {
              report.failures.push({
                path: currentRelativePath,
                message: err instanceof Error ? err.message : 'Falha ao criar pasta.',
              });
            }
          }
        }

        try {
          const reservedNames = await namesForDirectory(destinationDirectory);
          const targetName = reservedNames.has(originalName)
            ? uniqueNameForPaste(originalName, reservedNames)
            : originalName;
          if (targetName !== originalName) report.renamedConflicts += 1;
          reservedNames.add(targetName);

          const targetPath = [destinationDirectory, targetName].filter(Boolean).join('/');
          setBusy(`Enviando ${index + 1} de ${files.length}: ${targetName}`);
          await nextcloudService.writeFile(targetPath, dropped.file);
          report.filesUploaded += 1;
        } catch (err) {
          report.failures.push({
            path: dropped.relativePath,
            message: err instanceof Error ? err.message : 'Falha ao enviar arquivo.',
          });
        }
      }
      await load(path);
    } finally {
      setBusy(null);
      setDragActive(false);
    }
    setUploadDropReport(report);
    if (!report.failures.length) {
      showTransient(`${report.filesUploaded} arquivo(s) enviado(s), mantendo a estrutura de pastas.`);
    } else {
      setError(`${report.filesUploaded} arquivo(s) enviado(s); ${report.failures.length} item(ns) falharam. Veja o resumo.`);
    }
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

      // Deriva a extensão do MIME (ex.: image/png -> png; image/jpeg -> jpg).
      const mime = image.type || 'image/png';
      const extFromMime = mime.split('/')[1]?.split('+')[0] || 'png';
      const ext = extFromMime === 'jpeg' ? 'jpg' : extFromMime;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `print-${stamp}.${ext}`;

      setBusy(`Enviando imagem colada (${fileName})…`);
      setError(null);
      let pastedSuccessfully = false;
      try {
        // Envia a imagem crua para a pasta aberta (sem converter em PDF).
        const blob = image instanceof Blob ? image : new Blob([image], { type: mime });
        await nextcloudService.writeFile([path, fileName].filter(Boolean).join('/'), blob);
        await load(path);
        pastedSuccessfully = true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao colar a imagem.');
      } finally {
        setBusy(null);
      }
      if (pastedSuccessfully) showTransient(`Imagem colada e salva como ${fileName} na pasta atual.`);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [imagesPdfTargets, linkTarget, load, organizeFile, path, pdfToolFile, previewFile, versionsFile]);

  // ── Seleção múltipla (estado no hook; orquestração aqui) ──────────────────
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

  const handleMarqueePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-nextcloud-entry-path], button, input, textarea, select, a')) return;

    event.preventDefault();
    const additive = event.ctrlKey || event.metaKey;
    marqueeBaseSelectionRef.current = additive ? { ...selected } : {};
    if (!additive) {
      setSelected({});
      setSelectionAnchorPath(null);
      setFocusedEntryPath(null);
    }
    setMarquee({
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      width: 0,
      height: 0,
    });
  };

  useEffect(() => {
    if (!marquee) return;

    const onPointerMove = (event: PointerEvent) => {
      const left = Math.min(marquee.startX, event.clientX);
      const top = Math.min(marquee.startY, event.clientY);
      const right = Math.max(marquee.startX, event.clientX);
      const bottom = Math.max(marquee.startY, event.clientY);
      const next = {
        ...marquee,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      };
      setMarquee(next);

      const hits: Record<string, boolean> = { ...marqueeBaseSelectionRef.current };
      fileAreaRef.current?.querySelectorAll<HTMLElement>('[data-nextcloud-entry-path]').forEach((element) => {
        const rect = element.getBoundingClientRect();
        const intersects = rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
        const entryPath = element.dataset.nextcloudEntryPath;
        if (intersects && entryPath) hits[entryPath] = true;
      });
      setSelected(hits);
    };

    const finish = () => {
      suppressFileAreaClickRef.current = true;
      setMarquee(null);
      window.setTimeout(() => { suppressFileAreaClickRef.current = false; }, 0);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [marquee?.startX, marquee?.startY]);

  const selectedEntries = useMemo(
    () => displayEntries.filter((e) => selected[e.path]),
    [displayEntries, selected],
  );
  const selectedFiles = useMemo(() => selectedEntries.filter((entry) => !entry.isDir), [selectedEntries]);
  const selectedPdfs = useMemo(() => selectedFiles.filter(isPdf), [selectedFiles]);
  const selectedImages = useMemo(() => selectedFiles.filter(isImage), [selectedFiles]);
  const selectedDocx = useMemo(() => selectedFiles.filter(isDocx), [selectedFiles]);

  const handleInternalDragStart = (event: React.DragEvent, entry: NextcloudEntry) => {
    const items = selected[entry.path] ? selectedEntries : [entry];
    if (!selected[entry.path]) selectEntry(entry);
    setDraggedEntries(items);
    setDragTargetPath(null);
    setDragOperation('move');
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData('application/x-nextcloud-paths', JSON.stringify(items.map((item) => item.path)));
    event.dataTransfer.setData('text/plain', `${items.length} item(ns)`);

    // O fantasma representa visualmente o documento (ícone/miniatura), sem
    // transformar o título do arquivo no objeto arrastado.
    const preview = document.createElement('div');
    preview.style.cssText = [
      'position:fixed',
      'left:-9999px',
      'top:-9999px',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'width:96px',
      'height:96px',
      'padding:10px',
      'border-radius:18px',
      'background:rgba(255,255,255,.96)',
      'box-shadow:0 12px 35px rgba(0,0,0,.35)',
      'border:2px solid rgba(59,130,246,.7)',
      'overflow:hidden',
    ].join(';');
    const sourceVisual = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-nextcloud-drag-visual]');
    if (sourceVisual) {
      const visual = sourceVisual.cloneNode(true) as HTMLElement;
      visual.style.cssText = 'display:flex;align-items:center;justify-content:center;width:76px;height:76px;max-width:76px;max-height:76px;overflow:hidden;color:#3b82f6;';
      visual.querySelectorAll<HTMLElement>('svg').forEach((svg) => {
        svg.style.width = '56px';
        svg.style.height = '56px';
      });
      visual.querySelectorAll<HTMLElement>('img').forEach((image) => {
        image.style.maxWidth = '76px';
        image.style.maxHeight = '76px';
        image.style.objectFit = 'contain';
      });
      preview.appendChild(visual);
    } else {
      const icon = document.createElement('div');
      icon.textContent = '📄';
      icon.style.fontSize = '52px';
      preview.appendChild(icon);
    }
    if (items.length > 1) {
      const counter = document.createElement('span');
      counter.textContent = String(items.length);
      counter.style.cssText = 'position:absolute;right:-7px;top:-7px;display:flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 6px;border-radius:999px;background:#2563eb;color:white;font:700 12px system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.28);';
      preview.appendChild(counter);
    }
    document.body.appendChild(preview);
    event.dataTransfer.setDragImage(preview, 48, 48);
    window.setTimeout(() => preview.remove(), 0);
  };

  const finishInternalDrag = () => {
    setDraggedEntries(null);
    setDragTargetPath(null);
    setDragOperation('move');
  };

  const executeDroppedTransfer = async (
    items: NextcloudEntry[],
    targetFolderPath: string,
    shouldCopy: boolean,
  ): Promise<boolean> => {
    setBusy(`${shouldCopy ? 'Copiando' : 'Movendo'} ${items.length} item(ns)…`);
    setMovementExecuting(true);
    setError(null);
    let completedSuccessfully = false;
    try {
      // Nome livre confirmado no servidor — o proxy usa Overwrite:T, então sem
      // isto um arraste sobrescreveria silenciosamente um arquivo homônimo.
      const reserved = new Set<string>();
      for (const item of items) {
        if (item.path === targetFolderPath || targetFolderPath.startsWith(`${item.path}/`)) continue;
        // Mover para a mesma pasta de origem mantém o nome (não é conflito real).
        const sameFolder = dirOf(item.path) === targetFolderPath;
        const targetName = sameFolder && !shouldCopy
          ? item.name
          : await resolveFreeName(targetFolderPath, item.name, reserved);
        reserved.add(targetName);
        const destination = `${targetFolderPath}/${targetName}`;
        if (shouldCopy) await nextcloudService.copy(item.path, destination);
        else await nextcloudService.move(item.path, destination);
      }
      setDraggedEntries(null);
      clearSelection();
      await load(path);
      const rootItems = await nextcloudService.list('');
      setSidebarRoots(rootItems.filter((item) => item.isDir).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      setSidebarTreeRevision((revision) => revision + 1);
      completedSuccessfully = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao mover os itens selecionados.');
    } finally {
      setBusy(null);
      setMovementExecuting(false);
    }
    if (completedSuccessfully) showTransient(`${shouldCopy ? 'Cópia' : 'Movimentação'} concluída.`);
    return completedSuccessfully;
  };

  const dropDraggedItemsIntoPath = async (event: React.DragEvent, targetFolderPath: string) => {
    if (!draggedEntries?.length) return;
    event.preventDefault();
    event.stopPropagation();
    const items = [...draggedEntries];
    const shouldCopy = event.ctrlKey || event.metaKey || event.altKey;
    finishInternalDrag();
    if (!shouldCopy) {
      const movableItems = items.filter((item) =>
        item.path !== targetFolderPath && !targetFolderPath.startsWith(`${item.path}/`),
      );
      if (!movableItems.length) {
        setError('Não é possível mover uma pasta para ela mesma ou para uma de suas subpastas.');
        return;
      }
      setPendingMovement({ entries: movableItems, targetFolderPath, source: 'drag' });
      return;
    }
    await executeDroppedTransfer(items, targetFolderPath, true);
  };

  const dropSelectedIntoFolder = async (event: React.DragEvent, folder: NextcloudEntry) => {
    if (!folder.isDir) return;
    await dropDraggedItemsIntoPath(event, folder.path);
  };

  // Atalhos Ctrl/⌘ + C / X / V (só quando o foco não está num campo de texto
  // nem há modal aberto — para não brigar com o editor ou com a busca).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return;
      if (previewFile || pdfToolFile || organizeFile || imagesPdfTargets || versionsFile || linkTarget || pendingMovement) return;
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
      } else if (e.key === 'F2' && selectedEntries.length === 1) {
        e.preventDefault();
        startInlineRename(selectedEntries[0]);
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
  }, [selectedEntries, clipboard, previewFile, pdfToolFile, organizeFile, imagesPdfTargets, versionsFile, linkTarget, pendingMovement, path, entries, displayEntries, focusedEntryPath, viewMode, selectionAnchorPath]);

  // Diretório de um arquivo (para gravar derivados na mesma pasta).
  const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

  const docxBlobToPdf = async (docxBlob: Blob): Promise<Blob> => {
    const container = document.createElement('div');
    container.className = 'nextcloud-docx-to-pdf-render';
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:white;font-family:\"Times New Roman\",Times,serif;';
    const style = document.createElement('style');
    style.textContent = `
      .nextcloud-docx-to-pdf-render .docx-wrapper-wrapper{background:transparent!important;padding:0!important;display:flex!important;justify-content:center!important}
      .nextcloud-docx-to-pdf-render .docx-wrapper{background:transparent!important;padding:0!important;width:auto!important;max-width:none!important}
      .nextcloud-docx-to-pdf-render .docx-wrapper>section,
      .nextcloud-docx-to-pdf-render .docx-wrapper>article,
      .nextcloud-docx-to-pdf-render .docx-wrapper>section>article{width:794px!important;min-width:794px!important;max-width:794px!important;margin:0 auto 20px!important;background:white!important;box-shadow:none!important;border:0!important;border-radius:0!important}
    `;
    document.head.appendChild(style);
    document.body.appendChild(container);
    try {
      await renderAsync(docxBlob, container, undefined, {
        className: 'docx-wrapper',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
      });
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      const wrapper = (container.querySelector('.docx-wrapper') as HTMLElement | null) ?? container;
      const candidates = Array.from(wrapper.children).filter((node) => {
        if (!(node instanceof HTMLElement)) return false;
        const tag = node.tagName.toLowerCase();
        return tag === 'section' || tag === 'article' || node.classList.contains('docx');
      }) as HTMLElement[];
      const pages = candidates.length ? candidates : [wrapper];
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const canvas = await html2canvas(pages[pageIndex], {
          scale: 1.5,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
          width: pages[pageIndex].scrollWidth || 794,
          windowWidth: pages[pageIndex].scrollWidth || 794,
          imageTimeout: 0,
        });
        const image = canvas.toDataURL('image/jpeg', 0.88);
        const imageHeight = (canvas.height * 210) / canvas.width;
        const slices = Math.max(1, Math.ceil(imageHeight / 297));
        for (let slice = 0; slice < slices; slice += 1) {
          if (pageIndex > 0 || slice > 0) pdf.addPage();
          pdf.addImage(image, 'JPEG', 0, -(slice * 297), 210, imageHeight, undefined, 'FAST');
        }
      }
      return pdf.output('blob');
    } finally {
      style.remove();
      container.remove();
    }
  };

  const convertDocxEntriesToPdf = async (targets: NextcloudEntry[]) => {
    if (!targets.length || convertingDocxPaths.length) return;
    setConvertingDocxPaths(targets.map((entry) => entry.path));
    setError(null);
    let converted = 0;
    const failures: string[] = [];
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const entry = targets[index];
        try {
          setBusy(`Convertendo ${index + 1} de ${targets.length}: ${entry.name}`);
          const source = await nextcloudService.readFile(entry.path);
          const pdf = await docxBlobToPdf(source);
          const target = [dirOf(entry.path), `${baseName(entry.name)}.pdf`].filter(Boolean).join('/');
          await nextcloudService.writeFile(target, pdf);
          converted += 1;
        } catch {
          failures.push(entry.name);
        }
      }
      clearSelection();
      await load(path);
      if (failures.length) setError(`${converted} DOCX convertido(s); falha em ${failures.length}: ${failures.join(', ')}`);
      else showTransient(`${converted} documento(s) Word convertido(s) em PDF.`);
    } finally {
      setBusy(null);
      setConvertingDocxPaths([]);
    }
  };

  // Grava um resultado de PDF: sobrescreve o original ou cria novo arquivo.
  const writePdfResult = async (source: NextcloudEntry, blob: Blob, newName: string, asCopy: boolean) => {
    const dir = dirOf(source.path);
    // "Manter ambos" (asCopy) checa o destino REAL no servidor — nunca a lista
    // exibida, que pode estar desatualizada. Sobrescrever (asCopy=false) mantém
    // o nome de origem propositalmente.
    const targetName = asCopy ? await resolveFreeName(dir, newName) : source.name;
    const target = [dir, targetName].filter(Boolean).join('/');
    await nextcloudService.writeFile(target, blob);
    return { target, targetName };
  };

  const savePreviewPdfRotation = async () => {
    const source = previewFile;
    const rotation = normalizeRotation(previewPdfRotation);
    if (!source || !isPdf(source) || rotation === 0 || previewRotationSaving) return;
    setPreviewRotationSaving(true);
    setError(null);
    try {
      const original = await nextcloudService.readFile(source.path);
      const rotated = await rotatePdf(await original.arrayBuffer(), rotation);
      const blob = pdfBytesToBlob(rotated);
      const result = await writePdfResult(
        source,
        blob,
        `${baseName(source.name)}-girado.pdf`,
        previewRotationSaveMode === 'copy',
      );
      await load(path);
      setPreviewRotationConfirm(false);
      setPreviewPdfRotation(0);
      if (previewRotationSaveMode === 'copy') {
        setPreviewFile({
          ...source,
          name: result.targetName,
          path: result.target,
          size: blob.size,
          mime: 'application/pdf',
          mtime: new Date().toISOString(),
        });
        showTransient(`Rotação salva em ${result.targetName}.`);
      } else {
        setPreviewRevision((revision) => revision + 1);
        showTransient('Rotação salva no PDF original.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a rotação.');
    } finally {
      setPreviewRotationSaving(false);
    }
  };

  // ── Ferramentas de PDF ────────────────────────────────────────────────────
  const openPdfTools = async (entry: NextcloudEntry, targets?: NextcloudEntry[]) => {
    const requestedFiles = (targets?.length ? targets : selectedPdfs.length > 1 && selected[entry.path] ? selectedPdfs : [entry])
      .filter(isPdf);
    const toolFiles = requestedFiles.some((item) => item.path === entry.path)
      ? requestedFiles
      : [entry, ...requestedFiles];
    setPdfToolFile(entry);
    setPdfToolFiles(toolFiles);
    setPdfToolMode('home');
    setPdfPageCount(null);
    setPdfSplitAt(1);
    setPdfSaveAsCopy(true);
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
    setPdfToolFiles([]);
    setPdfToolMode('home');
    setPdfBatchResults(null);
    setPdfToolScope('active');
    setPdfSplitMode('half');
    setPdfSplitRanges('');
    setPdfWatermarkPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  };

  const openPdfMergeTools = async (targets: NextcloudEntry[]) => {
    if (targets.length < 2) return;
    await openPdfTools(targets[0], targets);
    setPdfToolMode('merge');
  };

  const readPdfBytes = async (entry: NextcloudEntry) =>
    (await nextcloudService.readFile(entry.path)).arrayBuffer();

  // Lista de PDFs que uma ferramenta vai processar, conforme o escopo escolhido.
  // 'active' = só o documento aberto; 'selected' = todo o conjunto carregado.
  const pdfToolTargets = (): NextcloudEntry[] => {
    if (!pdfToolFile) return [];
    const conjunto = pdfToolFiles.length ? pdfToolFiles : [pdfToolFile];
    return pdfToolScope === 'selected' && conjunto.length > 1 ? conjunto : [pdfToolFile];
  };

  // Núcleo reutilizável: aplica `fn` a uma lista explícita de PDFs, com
  // resultado por item. Usado tanto pela execução normal quanto pelo retry.
  const runPdfToolOn = async (
    targets: NextcloudEntry[],
    label: string,
    fn: (bytes: ArrayBuffer) => Promise<Uint8Array>,
    suffix: string,
    asCopy: boolean,
  ) => {
    if (!pdfToolFile || targets.length === 0) return;
    const sourceFile = pdfToolFile;
    const conjunto = pdfToolFiles.length ? pdfToolFiles : [sourceFile];
    lastPdfBatchOpRef.current = { label, fn, suffix, asCopy };

    setApplyingTool(true);
    setError(null);

    const results: BatchItemResult[] = targets.map((file) => ({
      id: file.path, source: file.name, status: 'pending',
    }));
    setPdfBatchResults(results);

    for (let i = 0; i < targets.length; i += 1) {
      const file = targets[i];
      results[i] = { ...results[i], status: 'processing' };
      setPdfBatchResults([...results]);
      try {
        const bytes = await readPdfBytes(file);
        const out = await fn(bytes);
        const blob = pdfBytesToBlob(out);
        const newName = `${baseName(file.name)} (${suffix}).pdf`;
        const { targetName } = await writePdfResult(file, blob, newName, asCopy);
        results[i] = { ...results[i], status: 'done', destination: targetName };
      } catch (err) {
        results[i] = {
          ...results[i],
          status: 'failed',
          error: err instanceof Error ? err.message : `Falha ao aplicar ${label}.`,
        };
      }
      setPdfBatchResults([...results]);
    }

    setApplyingTool(false);
    await load(path);
    await openPdfTools(sourceFile, conjunto);

    const done = results.filter((r) => r.status === 'done').length;
    const failed = results.filter((r) => r.status === 'failed');
    if (failed.length === 0) {
      setPdfBatchResults(targets.length > 1 ? results : null);
      showTransient(
        targets.length > 1
          ? `${label}: ${done} PDF(s) processado(s).`
          : (asCopy ? `${label}: novo PDF gerado.` : `${label}: PDF atualizado.`),
      );
    } else {
      // Nunca declara sucesso geral quando há falhas — mantém o painel por item.
      setError(`${label}: ${done} concluído(s), ${failed.length} com falha. Veja o resultado por item.`);
    }
  };

  const runPdfTool = async (
    label: string,
    fn: (bytes: ArrayBuffer) => Promise<Uint8Array>,
    suffix: string,
  ) => {
    const targets = pdfToolTargets();
    // Em lote (>1 alvo) preservamos SEMPRE os originais (salva cópia) para não
    // sobrescrever vários arquivos de uma vez sem escolha por item.
    const asCopy = targets.length > 1 ? true : pdfSaveAsCopy;
    await runPdfToolOn(targets, label, fn, suffix, asCopy);
  };

  // Re-executa a última operação SOMENTE nos itens que falharam.
  const retryFailedPdfBatch = async () => {
    const op = lastPdfBatchOpRef.current;
    const failed = (pdfBatchResults ?? []).filter((r) => r.status === 'failed');
    if (!op || failed.length === 0) return;
    const failedPaths = new Set(failed.map((r) => r.id));
    const conjunto = pdfToolFiles.length ? pdfToolFiles : (pdfToolFile ? [pdfToolFile] : []);
    const targets = conjunto.filter((f) => failedPaths.has(f.path));
    await runPdfToolOn(targets, op.label, op.fn, op.suffix, op.asCopy);
  };

  // Converte um texto de intervalo em índices 0-based, validando contra o total
  // do documento ATIVO. Vazio => undefined (todas as páginas). Lança em inválido.
  const rangeToIndices = (spec: string): number[] | undefined => {
    if (!spec.trim()) return undefined;
    return parsePageList(spec, pdfPageCount ?? 0);
  };

  const handleWatermark = () => {
    let pages: number[] | undefined;
    try { pages = rangeToIndices(pdfWatermarkRange); }
    catch (err) { setError(err instanceof Error ? err.message : 'Intervalo inválido.'); return; }
    void runPdfTool('Marca d\'água', (b) => watermarkPdf(b, {
      text: pdfWatermarkText, opacity: pdfWatermarkOpacity, diagonal: pdfWatermarkDiagonal, pages,
    }), 'marca d\'água');
  };

  // Gera a pré-visualização REAL da marca d'água no documento ativo (aplica o
  // watermark de verdade e mostra o PDF resultante antes de salvar).
  const generateWatermarkPreview = async () => {
    if (!pdfToolFile || !pdfWatermarkText.trim()) return;
    let pages: number[] | undefined;
    try { pages = rangeToIndices(pdfWatermarkRange); }
    catch (err) { setError(err instanceof Error ? err.message : 'Intervalo inválido.'); return; }
    setPdfWatermarkPreviewBusy(true);
    setError(null);
    try {
      const bytes = await readPdfBytes(pdfToolFile);
      const out = await watermarkPdf(bytes, {
        text: pdfWatermarkText, opacity: pdfWatermarkOpacity, diagonal: pdfWatermarkDiagonal, pages,
      });
      setPdfWatermarkPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(pdfBytesToBlob(out)); });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar a pré-visualização.');
    } finally {
      setPdfWatermarkPreviewBusy(false);
    }
  };

  const handlePageNumbers = () => {
    let pages: number[] | undefined;
    try { pages = rangeToIndices(pdfPageNumRange); }
    catch (err) { setError(err instanceof Error ? err.message : 'Intervalo inválido.'); return; }
    void runPdfTool('Numeração', (b) => numberPdfPages(b, {
      position: pdfPageNumPosition,
      startNumber: pdfPageNumStart,
      format: pdfPageNumFormat,
      template: pdfPageNumTemplate,
      pages,
    }), 'numerado');
  };

  const handleRotateAll = () =>
    runPdfTool('Rotação', (b) => rotatePdf(b, 90), 'girado');

  const handleSplit = async () => {
    if (!pdfToolFile) return;
    const total = pdfPageCount ?? 0;
    if (total < 2) {
      setError('O PDF precisa ter ao menos duas páginas para ser dividido.');
      return;
    }
    const sourceFile = pdfToolFile;
    const toolFiles = pdfToolFiles.length ? pdfToolFiles : [sourceFile];
    setApplyingTool(true);
    setError(null);
    try {
      const bytes = await readPdfBytes(sourceFile);
      const dir = dirOf(sourceFile.path);
      const base = baseName(sourceFile.name);

      // Monta os pedaços conforme o modo, validando os intervalos ANTES de gravar.
      let parts: Array<{ label: string; bytes: Uint8Array }> = [];
      if (pdfSplitMode === 'ranges') {
        // splitPdfByRanges valida e lança em intervalo inválido/fora do total.
        const chunks = await splitPdfByRanges(bytes, pdfSplitRanges);
        parts = chunks.map((b, i) => ({ label: `intervalo ${i + 1}`, bytes: b }));
      } else if (pdfSplitMode === 'pages') {
        const chunks = await explodePdfToPages(bytes);
        parts = chunks.map((b, i) => ({ label: `página ${i + 1}`, bytes: b }));
      } else {
        const { part1, part2 } = await splitPdf(bytes, pdfSplitAt);
        parts = [{ label: 'parte 1', bytes: part1 }, { label: 'parte 2', bytes: part2 }];
      }

      // Grava cada pedaço com nome livre confirmado no servidor (sem sobrescrever).
      const reserved = new Set<string>();
      let saved = 0;
      for (let i = 0; i < parts.length; i += 1) {
        const desired = `${base} (${parts[i].label}).pdf`;
        const name = await resolveFreeName(dir, desired, reserved);
        reserved.add(name);
        await nextcloudService.writeFile([dir, name].filter(Boolean).join('/'), pdfBytesToBlob(parts[i].bytes));
        saved += 1;
      }
      await load(path);
      await openPdfTools(sourceFile, toolFiles);
      showTransient(`PDF dividido em ${saved} arquivo(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao dividir PDF.');
    } finally {
      setApplyingTool(false);
    }
  };

  const moveEntryInList = (
    list: NextcloudEntry[],
    fromIndex: number,
    toIndex: number,
  ) => {
    if (toIndex < 0 || toIndex >= list.length) return list;
    return arrayMove(list, fromIndex, toIndex);
  };

  const mergePdfEntries = async (targets: NextcloudEntry[], outputName = 'pdf-unificado') => {
    if (!targets || targets.length < 2) return;
    setBusy(`Juntando ${targets.length} PDFs…`);
    setError(null);
    try {
      const list: ArrayBuffer[] = [];
      for (const f of targets) list.push(await readPdfBytes(f));
      const out = await mergePdfs(list);
      const normalizedName = (outputName || 'pdf-unificado').trim().replace(/\.pdf$/i, '');
      // Nome livre confirmado no servidor (não na lista exibida) — sem sobrescrever.
      const outputFileName = await resolveFreeName(path, `${normalizedName}.pdf`);
      const target = [path, outputFileName].filter(Boolean).join('/');
      await nextcloudService.writeFile(target, pdfBytesToBlob(out));
      clearSelection();
      await load(path);
      setPdfToolMode('home');
      showTransient(`${targets.length} PDFs reunidos em “${outputFileName}”.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao juntar PDFs.');
    } finally {
      setBusy(null);
    }
  };


  // ── Organizador de páginas (reordenar / girar / remover / extrair) ────────
  const openOrganizer = async (entry: NextcloudEntry) => {
    if (pdfToolPreviewUrl) URL.revokeObjectURL(pdfToolPreviewUrl);
    setPdfToolPreviewUrl(null);
    setPdfToolFile(null);
    setPdfToolMode('home');
    setOrganizeFile(entry);
    setOrganizePages([]);
    setOrganizeInitialPages([]);
    setOrganizePast([]);
    setOrganizeFuture([]);
    setOrganizeSelected([]);
    setOrganizeReady(false);
    setOrganizeSaveAsCopy(true);
    setOrganizeExitIntent(null);
    setError(null);
    try {
      const blob = await nextcloudService.readFile(entry.path);
      const { PDFDocument } = await import('pdf-lib');
      const source = await PDFDocument.load(await blob.arrayBuffer());
      const initialPages = source.getPages().map((page, sourceIndex) => ({
        sourceIndex,
        rotation: normalizeRotation(page.getRotation().angle || 0),
      }));
      setOrganizePages(initialPages);
      setOrganizeInitialPages(initialPages);
      setOrganizeUrl(URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir o PDF.');
      setOrganizeFile(null);
    }
  };

  const closeOrganizer = (clearPdfContext = true) => {
    if (organizeUrl) { try { URL.revokeObjectURL(organizeUrl); } catch { /* já revogada */ } }
    setOrganizeUrl(null);
    setOrganizeFile(null);
    setOrganizePages([]);
    setOrganizeInitialPages([]);
    setOrganizePast([]);
    setOrganizeFuture([]);
    setOrganizeSelected([]);
    setOrganizeReady(false);
    setOrganizeExitIntent(null);
    if (clearPdfContext) setPdfToolFiles([]);
  };

  const returnToPdfTools = () => {
    const entry = organizeFile;
    const targets = pdfToolFiles.length ? pdfToolFiles : entry ? [entry] : [];
    closeOrganizer(false);
    if (entry) void openPdfTools(entry, targets);
  };

  const requestOrganizerExit = (intent: 'back' | 'close') => {
    if (organizerDirty) {
      setOrganizeExitIntent(intent);
      return;
    }
    if (intent === 'back') returnToPdfTools();
    else closeOrganizer();
  };

  const discardOrganizerChanges = () => {
    const intent = organizeExitIntent;
    setOrganizeExitIntent(null);
    if (intent === 'back') returnToPdfTools();
    else closeOrganizer();
  };

  const onOrganizeLoaded = (numPages: number) => {
    setOrganizePages((prev) => {
      if (prev.length) return prev;
      const initial = Array.from({ length: numPages }, (_, i) => ({ sourceIndex: i, rotation: 0 }));
      setOrganizeInitialPages(initial);
      return initial;
    });
    setOrganizeReady(true);
  };

  const updateOrganizePages = (updater: (pages: PdfPageState[]) => PdfPageState[]) => {
    const next = updater(organizePages);
    if (JSON.stringify(next) === JSON.stringify(organizePages)) return;
    setOrganizePast((history) => [...history.slice(-29), organizePages]);
    setOrganizeFuture([]);
    setOrganizePages(next);
  };

  const undoOrganize = () => {
    if (organizePast.length === 0) return;
    const previous = organizePast[organizePast.length - 1];
    setOrganizeFuture((future) => [organizePages, ...future].slice(0, 30));
    setOrganizePast((history) => history.slice(0, -1));
    setOrganizePages(previous);
    setOrganizeSelected([]);
  };

  const redoOrganize = () => {
    if (organizeFuture.length === 0) return;
    const next = organizeFuture[0];
    setOrganizePast((history) => [...history.slice(-29), organizePages]);
    setOrganizeFuture((future) => future.slice(1));
    setOrganizePages(next);
    setOrganizeSelected([]);
  };

  const onOrganizeDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = organizePages.map((p, i) => `${p.sourceIndex}-${i}`);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    updateOrganizePages((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrganizeSelected([]);
  };

  const rotateOrganizePage = (index: number, delta: number) =>
    updateOrganizePages((prev) => prev.map((p, i) => (i === index ? { ...p, rotation: normalizeRotation(p.rotation + delta) } : p)));

  const rotateSelectedOrganizePages = (delta: number) => {
    if (organizeSelected.length === 0) return;
    updateOrganizePages((prev) => prev.map((page, index) => (
      organizeSelected.includes(index)
        ? { ...page, rotation: normalizeRotation(page.rotation + delta) }
        : page
    )));
  };

  const toggleOrganizeSel = (index: number) =>
    setOrganizeSelected((prev) => (prev.includes(index) ? prev.filter((x) => x !== index) : [...prev, index]));

  const removeOrganizeSelected = () => {
    if (organizeSelected.length === 0) return;
    updateOrganizePages((prev) => prev.filter((_, i) => !organizeSelected.includes(i)));
    setOrganizeSelected([]);
  };

  const removeOrganizePage = (index: number) => {
    updateOrganizePages((prev) => prev.filter((_, pageIndex) => pageIndex !== index));
    setOrganizeSelected((selectedPages) => selectedPages
      .filter((pageIndex) => pageIndex !== index)
      .map((pageIndex) => (pageIndex > index ? pageIndex - 1 : pageIndex)));
  };

  const duplicateOrganizeSelected = () => {
    if (organizeSelected.length === 0) return;
    const selectedSet = new Set(organizeSelected);
    updateOrganizePages((pages) => pages.flatMap((page, index) => (
      selectedSet.has(index) ? [page, { ...page }] : [page]
    )));
    setOrganizeSelected([]);
  };

  const reverseOrganizePages = () => {
    updateOrganizePages((pages) => [...pages].reverse());
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

  const saveOrganize = async (afterSave: 'hub' | 'close' = 'hub') => {
    if (!organizeFile || organizePages.length === 0) { setError('O PDF precisa ter ao menos uma página.'); return; }
    const sourceFile = organizeFile;
    const toolFiles = pdfToolFiles.length ? pdfToolFiles : [sourceFile];
    setOrganizeSaving(true);
    setError(null);
    try {
      const blob = await buildPdfFromPages(organizePages);
      const dir = dirOf(organizeFile.path);
      const targetName = organizeSaveAsCopy
        ? await resolveFreeName(dir, `${baseName(organizeFile.name)} (editado).pdf`)
        : organizeFile.name;
      await nextcloudService.writeFile([dir, targetName].filter(Boolean).join('/'), blob);
      closeOrganizer(afterSave === 'close');
      await load(path);
      if (afterSave === 'hub') await openPdfTools(sourceFile, toolFiles);
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
      const targetName = await resolveFreeName(dir, `${baseName(organizeFile.name)} (extraído).pdf`);
      const target = [dir, targetName].filter(Boolean).join('/');
      await nextcloudService.writeFile(target, blob);
      await load(path);
      showTransient(`${sorted.length} página(s) extraída(s) em “${targetName}”.`);
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

  const handleImagePdfDragEnd = (event: DragEndEvent) => {
    if (!imagesPdfTargets || !event.over || event.active.id === event.over.id) return;
    const fromIndex = imagesPdfTargets.findIndex((entry) => entry.path === String(event.active.id));
    const toIndex = imagesPdfTargets.findIndex((entry) => entry.path === String(event.over!.id));
    if (fromIndex >= 0 && toIndex >= 0) setImagesPdfTargets(arrayMove(imagesPdfTargets, fromIndex, toIndex));
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

  // Mensagem de sucesso flutuante; não participa do layout do explorador.
  const showTransient = (msg: string) => {
    const stamp = Date.now();
    setNotice({ message: msg, stamp });
    window.setTimeout(() => setNotice((current) => (current?.stamp === stamp ? null : current)), 2800);
  };
  // Liga o notify do hook de clipboard ao toast (showTransient definido acima).
  notifyRef.current = showTransient;

  useEffect(() => {
    if (!organizeFile || organizeSaving || organizeExitIntent) return;
    const handleOrganizerKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select')) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setOrganizeSelected(organizePages.map((_, index) => index));
      } else if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoOrganize();
        else undoOrganize();
      } else if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveOrganize();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && organizeSelected.length > 0) {
        event.preventDefault();
        removeOrganizeSelected();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        requestOrganizerExit('back');
      }
    };
    window.addEventListener('keydown', handleOrganizerKeyboard);
    return () => window.removeEventListener('keydown', handleOrganizerKeyboard);
  }, [
    organizeExitIntent,
    organizeFile,
    organizePages,
    organizePast,
    organizeFuture,
    organizeSaving,
    organizeSelected,
    organizerDirty,
  ]);

  return (
    <div
      ref={dropZoneRef}
      className={`relative flex h-full min-h-0 flex-col overflow-hidden bg-white text-gray-900 transition-[padding] duration-200 dark:bg-gray-900 dark:text-gray-100 ${sidebarOpen ? 'lg:pl-[var(--nextcloud-sidebar-width)]' : ''}`}
      style={{ '--nextcloud-sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      {sidebarOpen && (
        <>
          <button type="button" aria-label="Fechar navegação lateral" onClick={() => setSidebarOpen(false)} className="absolute inset-0 z-30 bg-slate-950/20 backdrop-blur-[1px] lg:hidden" />
          <aside
            className={`absolute inset-y-0 left-0 z-40 flex max-w-[calc(100vw_-_32px)] flex-col border-r bg-[#f8f9fb] shadow-xl lg:z-20 lg:shadow-none dark:bg-zinc-950 ${resizingSidebar ? 'border-blue-400' : 'border-slate-200 dark:border-zinc-800'}`}
            style={{ width: sidebarWidth }}
          >
            <div className="flex h-[61px] shrink-0 items-center justify-between border-b border-slate-200 px-3 dark:border-zinc-800">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg bg-[#0082c9] text-white shadow-sm">
                  <NextcloudIcon className="h-4 w-8" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">Explorador</p>
                  <p className="text-[11px] text-slate-400">Nextcloud</p>
                </div>
              </div>
              <button type="button" onClick={() => setSidebarOpen(false)} title="Recolher painel" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-zinc-800 dark:hover:text-white">
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
              <p className="mb-1 flex items-center gap-1 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"><ChevronDown className="h-3 w-3" /> Acesso rápido</p>
              <button type="button" onClick={() => { setSearch(''); setPath(''); }} className={`flex h-8 w-full items-center gap-2 rounded-lg px-3 text-[13px] transition ${path === '' ? 'bg-blue-100 font-semibold text-blue-800 dark:bg-blue-950/60 dark:text-blue-200' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-zinc-800'}`}>
                <Home className="h-4 w-4 text-blue-600" /> Início
              </button>

              <div className="mt-4">
                <p className="mb-1 flex items-center gap-1 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"><ChevronDown className="h-3 w-3" /> Este Nextcloud</p>
                {sidebarRoots.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">Nenhuma pasta na raiz.</p>
                ) : sidebarRoots.map((folder) => (
                  <NextcloudTreeNode
                    key={`${sidebarTreeRevision}:${folder.path}`}
                    name={folder.name}
                    nodePath={folder.path}
                    activePath={path}
                    onNavigate={(nextPath) => { setSearch(''); setPath(nextPath); }}
                    dropEnabled={Boolean(draggedEntries?.length)}
                    onDropItems={(event, targetPath) => { void dropDraggedItemsIntoPath(event, targetPath); }}
                  />
                ))}
              </div>
            </div>

            <div className="shrink-0 border-t border-slate-200 px-3 py-3 text-[11px] text-slate-400 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <span>{entries.length} item(ns) na pasta atual</span>
                <span className="tabular-nums">{sidebarWidth}px</span>
              </div>
            </div>
            <button
              type="button"
              aria-label="Redimensionar barra lateral"
              title="Arraste para redimensionar · duplo clique para restaurar"
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture?.(event.pointerId);
                setResizingSidebar(true);
              }}
              onDoubleClick={() => setSidebarWidth(260)}
              className={`group absolute inset-y-0 -right-1.5 z-50 hidden w-3 cursor-col-resize items-center justify-center lg:flex ${resizingSidebar ? 'bg-blue-500/10' : 'hover:bg-blue-500/10'}`}
            >
              <span className={`h-12 w-1 rounded-full transition ${resizingSidebar ? 'bg-blue-500' : 'bg-slate-300 opacity-0 group-hover:opacity-100'}`} />
            </button>
          </aside>
        </>
      )}
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
            {!sidebarOpen && (
              <button type="button" onClick={() => setSidebarOpen(true)} title="Mostrar painel de navegação" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-white">
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            )}
            <div className="flex h-9 w-12 items-center justify-center rounded-xl bg-[#0082c9] text-white shadow-sm shadow-sky-600/20">
              <NextcloudIcon className="h-4 w-9" />
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
            <button onClick={() => void openTextEditor()} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
              <NotebookPen className="w-4 h-4 text-blue-600" /> <span className="hidden xl:inline">Bloco de notas</span>
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

      {(busy || notice || error) && (
        <div className="pointer-events-none absolute right-4 top-[72px] z-[130] flex w-[min(380px,calc(100%_-_32px))] flex-col items-end gap-2" aria-live="polite">
          {busy && (
            <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-xl border border-blue-200/80 bg-white/95 px-4 py-3 text-sm font-medium text-blue-800 shadow-[0_12px_35px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:border-blue-900 dark:bg-zinc-900/95 dark:text-blue-200">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
              <span className="min-w-0 leading-snug">{busy}</span>
            </div>
          )}
          {notice && (
            <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-xl border border-emerald-200/80 bg-white/95 px-4 py-3 text-sm font-medium text-emerald-800 shadow-[0_12px_35px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:border-emerald-900 dark:bg-zinc-900/95 dark:text-emerald-200">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300">
                <CircleCheck className="h-4 w-4" />
              </span>
              <span className="min-w-0 leading-snug">{notice.message}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Fechar notificação" className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-emerald-700/60 transition hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-950/60">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {error && (
            <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-xl border border-red-200/80 bg-white/95 px-4 py-3 text-sm font-medium text-red-800 shadow-[0_12px_35px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:border-red-900 dark:bg-zinc-900/95 dark:text-red-200" role="alert">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300">
                <AlertCircle className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 leading-snug">{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="Fechar erro" className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-red-700/60 transition hover:bg-red-50 hover:text-red-800 dark:hover:bg-red-950/60">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Barra de ações da seleção */}
      {selectedEntries.length > 0 && (
        <div
          className="fixed bottom-5 left-1/2 z-[120] flex max-w-[calc(100vw_-_24px)] -translate-x-1/2 flex-wrap items-center justify-center gap-0.5 overflow-hidden rounded-2xl bg-[#111113]/95 px-1.5 py-1.5 text-white shadow-[0_20px_60px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.07)] backdrop-blur-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="mr-0.5 flex shrink-0 items-center gap-1.5 rounded-lg bg-orange-500/20 px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap text-orange-300">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[10px] font-black leading-none text-white">{selectedEntries.length}</span>
            <span className="hidden sm:inline">{selectedEntries.length === 1 ? 'item' : 'itens'}</span>
          </span>
          <span className="mx-1 h-4 w-px shrink-0 bg-white/10" />
          <button onClick={() => copyEntries(selectedEntries)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
            <Copy className="h-3.5 w-3.5 text-sky-400" /> <span className="hidden sm:inline">Copiar</span>
          </button>
          <button onClick={() => cutEntries(selectedEntries)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
            <Scissors className="h-3.5 w-3.5 text-amber-300" /> <span className="hidden sm:inline">Recortar</span>
          </button>
          <button onClick={() => { void downloadEntries(selectedEntries); }} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
            <Download className="h-3.5 w-3.5 text-emerald-400" /> <span className="hidden sm:inline">Baixar{selectedEntries.length > 1 || selectedEntries.some((entry) => entry.isDir) ? ' ZIP' : ''}</span>
          </button>
          <button onClick={() => remove(selectedEntries)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/15 hover:text-red-200">
            <Trash2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Apagar</span>
          </button>
          {selectedPdfs.length === 1 && (
            <button onClick={() => { void openPdfTools(selectedPdfs[0]); }} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-300 transition hover:bg-white/10 hover:text-red-200">
              <Wrench className="h-3.5 w-3.5" /> <span className="hidden md:inline">Hub PDF</span>
            </button>
          )}
          {selectedPdfs.length >= 2 && selectedPdfs.length === selectedEntries.length && (
            <button
              onClick={() => { void openPdfTools(selectedPdfs[0], selectedPdfs); }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-300 transition hover:bg-white/10 hover:text-red-200"
              title={`Abrir ${selectedPdfs.length} PDFs no Hub`}
            >
              <Wrench className="h-3.5 w-3.5 text-red-400" /> <span className="hidden md:inline">Biblioteca PDF</span>
            </button>
          )}
          {selectedPdfs.length >= 2 && (
            <button onClick={() => { void openPdfMergeTools(selectedPdfs); }} disabled={Boolean(busy)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/20 hover:text-red-200 disabled:opacity-40">
              <FileText className="h-3.5 w-3.5 text-red-400" /> <span className="hidden lg:inline">Mesclar PDF</span>
            </button>
          )}
          {selectedImages.length >= 1 && (
            <button onClick={() => { setImagesPdfTargets(selectedImages); setImagesPdfName('imagens-convertidas'); }} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-violet-300 transition hover:bg-white/10 hover:text-violet-200">
              <FileImage className="h-3.5 w-3.5" /> <span className="hidden lg:inline">{selectedImages.length} imagem(ns) → PDF</span>
            </button>
          )}
          {selectedDocx.length >= 1 && (
            <button onClick={() => void convertDocxEntriesToPdf(selectedDocx)} disabled={convertingDocxPaths.length > 0} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-blue-300 transition hover:bg-white/10 hover:text-blue-200 disabled:opacity-40">
              {convertingDocxPaths.length ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              <span className="hidden lg:inline">{selectedDocx.length} Word → PDF</span>
            </button>
          )}
          <span className="mx-1 h-4 w-px shrink-0 bg-white/10" />
          <button onClick={clearSelection} title="Limpar seleção" aria-label="Limpar seleção" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Lista / Blocos */}
      <div
        ref={fileAreaRef}
        className="relative flex-1 overflow-y-auto"
        onScroll={(event) => {
          scrollPositionsRef.current[browserScrollKey] = event.currentTarget.scrollTop;
          scheduleBrowserSessionPersist();
        }}
        onPointerDown={handleMarqueePointerDown}
        onContextMenu={openBlankCtxMenu}
        onClick={() => {
          if (!suppressFileAreaClickRef.current) clearSelection();
        }}
      >
        {marquee && (
          <div
            className="pointer-events-none fixed z-[80] border border-blue-500 bg-blue-500/15 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]"
            style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
          />
        )}
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
              const extension = entry.isDir ? null : fileExtension(entry.name);
              const isDropTarget = entry.isDir && dragTargetPath === entry.path;
              return (
                <div
                  key={entry.path}
                  data-nextcloud-entry-path={entry.path}
                  onContextMenu={(e) => openCtxMenu(e, entry)}
                  onDoubleClick={() => openEntry(entry)}
                  onClick={(event) => handleEntryClick(event, entry)}
                  draggable
                  onDragStart={(event) => handleInternalDragStart(event, entry)}
                  onDragEnd={finishInternalDrag}
                  onDragEnter={(event) => {
                    if (!entry.isDir || !draggedEntries?.length) return;
                    event.preventDefault();
                    setDragTargetPath(entry.path);
                    setDragOperation(event.ctrlKey || event.metaKey || event.altKey ? 'copy' : 'move');
                  }}
                  onDragOver={(event) => {
                    if (entry.isDir && draggedEntries?.length) {
                      event.preventDefault();
                      event.stopPropagation();
                      const operation = event.ctrlKey || event.metaKey || event.altKey ? 'copy' : 'move';
                      event.dataTransfer.dropEffect = operation;
                      setDragTargetPath(entry.path);
                      setDragOperation(operation);
                    }
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    if (dragTargetPath === entry.path) setDragTargetPath(null);
                  }}
                  onDrop={(event) => void dropSelectedIntoFolder(event, entry)}
                  className={`group relative flex flex-col items-center gap-2 rounded-xl border p-3 cursor-pointer transition-all duration-150 ${
                    isDropTarget
                      ? 'scale-[1.025] border-blue-500 bg-blue-100 shadow-[0_10px_30px_rgba(37,99,235,0.2)] ring-4 ring-blue-500/15 dark:bg-blue-950/70'
                      : isSel
                        ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/30'
                        : 'border-gray-200 hover:border-gray-300 hover:shadow-sm dark:border-gray-800 dark:hover:border-gray-700'
                  } ${isCut(entry.path) ? 'opacity-50' : ''}`}
                >
                  <button onClick={(e) => { e.stopPropagation(); selectEntry(entry, { toggle: true }); }} title={isSel ? 'Desmarcar' : 'Selecionar'} className="absolute top-1.5 left-1.5 text-gray-400 hover:text-blue-600">
                    {isSel ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 opacity-0 group-hover:opacity-100" />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openCtxMenu(e, entry); }} title="Mais ações" className="absolute top-1.5 right-1.5 p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 opacity-0 group-hover:opacity-100 z-10">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  <div data-nextcloud-drag-visual className="relative w-full">
                    {entry.isDir
                      ? (
                        <div className="flex h-24 w-full items-center justify-center">
                          {isDropTarget ? (
                            <span className="flex h-20 w-20 animate-pulse items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/30 ring-4 ring-blue-300/50">
                              <FolderInput className="h-11 w-11" />
                            </span>
                          ) : (
                            <Icon className="h-12 w-12 text-blue-500" />
                          )}
                        </div>
                      )
                      : <NcThumb entry={entry} />}
                    {isDropTarget && (
                      <span className="absolute inset-x-2 bottom-0 inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-2 py-1.5 text-[10px] font-bold text-white shadow-lg">
                        <FolderInput className="h-3 w-3" />
                        {dragOperation === 'copy' ? 'Copiar para esta pasta' : 'Mover para esta pasta'}
                      </span>
                    )}
                    {extension && (
                      <span className={`absolute bottom-1.5 left-1.5 inline-flex rounded-md border px-1.5 py-1 text-[9px] font-extrabold leading-none tracking-[0.08em] shadow-sm backdrop-blur-sm ${extensionBadgeClass(extension)}`}>
                        {extension}
                      </span>
                    )}
                  </div>
                  {inlineRename?.path === entry.path ? (
                    <input
                      autoFocus
                      value={inlineRename.value}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onChange={(event) => setInlineRename((current) => current ? { ...current, value: event.target.value } : current)}
                      onFocus={(event) => event.currentTarget.setSelectionRange(0, Math.max(0, event.currentTarget.value.length - (inlineRename.extension?.length ?? 0)))}
                      onBlur={() => { void finishInlineRename(); }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                        if (event.key === 'Escape') { event.preventDefault(); setInlineRename(null); }
                      }}
                      aria-label="Nome do novo documento"
                      className="w-full rounded-md border border-blue-500 bg-white px-1.5 py-1 text-center text-xs text-slate-900 outline-none ring-2 ring-blue-500/20 dark:bg-zinc-900 dark:text-white"
                    />
                  ) : (
                    <span className="text-xs text-center leading-tight line-clamp-2 break-all w-full" title={entry.name}>{entry.name}</span>
                  )}
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
              const extension = entry.isDir ? null : fileExtension(entry.name);
              const isDropTarget = entry.isDir && dragTargetPath === entry.path;
              return (
                  <tr
                    key={entry.path}
                    data-nextcloud-entry-path={entry.path}
                    onContextMenu={(e) => openCtxMenu(e, entry)}
                    onDoubleClick={() => openEntry(entry)}
                    onClick={(event) => handleEntryClick(event, entry)}
                    draggable
                    onDragStart={(event) => handleInternalDragStart(event, entry)}
                    onDragEnd={finishInternalDrag}
                    onDragEnter={(event) => {
                      if (!entry.isDir || !draggedEntries?.length) return;
                      event.preventDefault();
                      setDragTargetPath(entry.path);
                      setDragOperation(event.ctrlKey || event.metaKey || event.altKey ? 'copy' : 'move');
                    }}
                    onDragOver={(event) => {
                      if (entry.isDir && draggedEntries?.length) {
                        event.preventDefault();
                        event.stopPropagation();
                        const operation = event.ctrlKey || event.metaKey || event.altKey ? 'copy' : 'move';
                        event.dataTransfer.dropEffect = operation;
                        setDragTargetPath(entry.path);
                        setDragOperation(operation);
                      }
                    }}
                    onDragLeave={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                      if (dragTargetPath === entry.path) setDragTargetPath(null);
                    }}
                    onDrop={(event) => void dropSelectedIntoFolder(event, entry)}
                    className={`group border-b transition ${
                      isDropTarget
                        ? 'border-blue-300 bg-blue-100 shadow-[inset_4px_0_0_#2563eb] dark:border-blue-900 dark:bg-blue-950/60'
                        : `border-gray-50 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40 ${isSel ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''}`
                    } ${isCut(entry.path) ? 'opacity-50' : ''}`}
                  >
                    <td className="px-2 py-2.5 text-center">
                      <button onClick={(event) => { event.stopPropagation(); selectEntry(entry, { toggle: true }); }} title={isSel ? 'Desmarcar' : 'Selecionar'} className="p-1 text-gray-400 hover:text-blue-600">
                        {isSel ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 opacity-0 group-hover:opacity-100" />}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`inline-flex items-center gap-2.5 text-left ${entry.isDir ? 'font-medium' : ''}`}>
                          <span data-nextcloud-drag-visual className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all ${isDropTarget ? 'animate-pulse bg-blue-600 text-white shadow-md ring-2 ring-blue-300' : ''}`}>
                            {isDropTarget
                              ? <FolderInput className="h-4.5 w-4.5" />
                              : <Icon className={`h-5 w-5 ${entry.isDir ? 'text-blue-500' : 'text-gray-400'}`} />}
                          </span>
                          <span className="flex flex-col min-w-0">
                            {inlineRename?.path === entry.path ? (
                              <input
                                autoFocus
                                value={inlineRename.value}
                                onClick={(event) => event.stopPropagation()}
                                onDoubleClick={(event) => event.stopPropagation()}
                                onChange={(event) => setInlineRename((current) => current ? { ...current, value: event.target.value } : current)}
                                onFocus={(event) => event.currentTarget.setSelectionRange(0, Math.max(0, event.currentTarget.value.length - (inlineRename.extension?.length ?? 0)))}
                                onBlur={() => { void finishInlineRename(); }}
                                onKeyDown={(event) => {
                                  event.stopPropagation();
                                  if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                                  if (event.key === 'Escape') { event.preventDefault(); setInlineRename(null); }
                                }}
                                aria-label="Nome do novo documento"
                                className="w-full max-w-[40vw] rounded-md border border-blue-500 bg-white px-2 py-1 text-sm text-slate-900 outline-none ring-2 ring-blue-500/20 dark:bg-zinc-900 dark:text-white"
                              />
                            ) : (
                              <span className="truncate max-w-[40vw]">{entry.name}</span>
                            )}
                            {isSearchActive && <span className="text-[11px] text-gray-400 truncate max-w-[40vw]">{dirOf(entry.path) || 'raiz'}</span>}
                            {isDropTarget && (
                              <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                                {dragOperation === 'copy' ? 'Solte para copiar aqui' : 'Solte para mover aqui'}
                              </span>
                            )}
                          </span>
                        </div>
                        {extension && (
                          <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[9px] font-extrabold leading-none tracking-[0.08em] ${extensionBadgeClass(extension)}`}>
                            {extension}
                          </span>
                        )}
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
        const item = (icon: React.ReactNode, label: string, onClick: () => void, danger = false) => (
          <button
            onClick={() => { setCtxMenu(null); onClick(); }}
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-3 transition ${danger ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
          >
            <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${danger ? 'bg-red-50 dark:bg-red-950/40' : 'bg-gray-100 dark:bg-gray-800'}`}>{icon}</span>
            {label}
          </button>
        );
        const entry = ctxMenu.entry;
        if (!entry) {
          const pasteLabel = clipboard
            ? clipboard.mode === 'copy'
              ? `Colar ${clipboard.entries.length} item(ns) copiado(s)`
              : `Mover para cá ${clipboard.entries.length} item(ns) recortado(s)`
            : '';
          return (
            <div
              ref={ctxMenuRef}
              className="fixed z-[9999] max-h-[calc(100dvh-16px)] w-64 overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white py-1 shadow-[0_18px_55px_rgba(15,23,42,0.24)] dark:border-zinc-700 dark:bg-zinc-900"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="border-b border-slate-100 px-3 py-2 dark:border-zinc-800">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pasta atual</p>
                <p className="truncate text-xs text-slate-500">{path || 'Início'}</p>
              </div>
              <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Novo</div>
              {item(<FolderPlus className="h-4 w-4 text-blue-600" />, 'Nova pasta', newFolder)}
              {item(<FileText className="h-4 w-4 text-blue-600" />, 'Novo documento Word', () => { void createItemInline('word'); })}
              {item(<NotebookPen className="h-4 w-4 text-amber-600" />, 'Nova nota de texto', () => { void createItemInline('text'); })}
              {item(<FileIcon className="h-4 w-4 text-slate-500" />, 'Nova nota Markdown', () => { void createItemInline('markdown'); })}
              <div className="my-1 border-t border-slate-100 dark:border-zinc-800" />
              {clipboard && item(
                <ClipboardPaste className={`h-4 w-4 ${clipboard.mode === 'copy' ? 'text-blue-600' : 'text-amber-600'}`} />,
                pasteLabel,
                () => { void paste(path); },
              )}
              {item(<Upload className="h-4 w-4 text-emerald-600" />, 'Enviar arquivos', () => fileInputRef.current?.click())}
              {item(<RefreshCw className="h-4 w-4 text-slate-500" />, 'Atualizar', () => { void load(path); })}
              <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400 dark:border-zinc-800">
                {clipboard ? (clipboard.mode === 'copy' ? 'Ctrl/Cmd + V para colar' : 'O recorte será concluído ao colar') : 'Clique com o botão direito em um item para mais ações'}
              </div>
            </div>
          );
        }
        const contextEntries = selected[entry.path] && selectedEntries.length > 0 ? selectedEntries : [entry];
        const isMultiContext = contextEntries.length > 1;
        return (
          <div
            ref={ctxMenuRef}
            className="fixed z-[9999] max-h-[calc(100dvh-16px)] w-56 overflow-y-auto overscroll-contain rounded-2xl border border-gray-200 bg-white py-1 shadow-2xl dark:border-gray-700 dark:bg-gray-900"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide truncate">
                {isMultiContext ? `${contextEntries.length} itens selecionados` : entry.name}
              </p>
            </div>

            {!isMultiContext && entry.isDir && item(<Folder className="w-4 h-4 text-blue-500" />, 'Abrir pasta', () => setPath(entry.path))}
            {!isMultiContext && isDocx(entry) && item(<Pencil className="w-4 h-4 text-blue-600" />, 'Editar no editor', () => openInMainEditor(entry))}
            {!isMultiContext && isDocx(entry) && item(<FileText className="w-4 h-4 text-red-500" />, 'Converter Word em PDF', () => { void convertDocxEntriesToPdf([entry]); })}
            {isMultiContext && contextEntries.some(isDocx) && item(<FileText className="w-4 h-4 text-red-500" />, `Converter ${contextEntries.filter(isDocx).length} Word em PDF`, () => { void convertDocxEntriesToPdf(contextEntries.filter(isDocx)); })}
            {!isMultiContext && isTextFile(entry) && item(<NotebookPen className="w-4 h-4 text-blue-600" />, 'Editar no Bloco de Notas', () => { void openTextEditor(entry); })}
            {!isMultiContext && (isPdf(entry) || isImage(entry) || isMedia(entry)) && item(<Eye className="w-4 h-4 text-slate-500" />, 'Visualizar', () => setPreviewFile(entry))}
            {!isMultiContext && isPdf(entry) && item(<Layers className="w-4 h-4 text-indigo-600" />, 'Organizar páginas', () => openOrganizer(entry))}
            {!isMultiContext && isPdf(entry) && item(<Wrench className="w-4 h-4 text-violet-600" />, 'Ferramentas de PDF', () => openPdfTools(entry))}
            {isMultiContext && contextEntries.every(isPdf) && item(
              <Wrench className="w-4 h-4 text-red-500" />,
              `Ferramentas de PDF (${contextEntries.length})`,
              () => { void openPdfTools(entry, contextEntries); },
            )}
            {!isMultiContext && isImage(entry) && item(<FileImage className="w-4 h-4 text-rose-500" />, 'Converter em PDF', () => { setImagesPdfTargets([entry]); setImagesPdfName(baseName(entry.name)); })}

            <div className="my-1 border-t border-gray-100 dark:border-gray-800" />

            {item(<Copy className="w-4 h-4 text-slate-500" />, isMultiContext ? `Copiar ${contextEntries.length} itens` : 'Copiar', () => copyEntries(contextEntries))}
            {item(<Scissors className="w-4 h-4 text-slate-500" />, isMultiContext ? `Recortar ${contextEntries.length} itens` : 'Recortar', () => cutEntries(contextEntries))}
            {clipboard && item(
              <ClipboardPaste className={`w-4 h-4 ${clipboard.mode === 'copy' ? 'text-blue-600' : 'text-amber-600'}`} />,
              clipboard.mode === 'copy'
                ? (!isMultiContext && entry.isDir
                  ? `Colar ${clipboard.entries.length} item(ns) copiado(s) nesta pasta`
                  : `Colar ${clipboard.entries.length} item(ns) copiado(s) aqui`)
                : (!isMultiContext && entry.isDir
                  ? `Mover ${clipboard.entries.length} item(ns) recortado(s) para esta pasta`
                  : `Mover ${clipboard.entries.length} item(ns) recortado(s) para cá`),
              () => { void paste(!isMultiContext && entry.isDir ? entry.path : path); },
            )}

            <div className="my-1 border-t border-gray-100 dark:border-gray-800" />

            {!isMultiContext && entry.isDir && item(<UserPlus className="w-4 h-4 text-emerald-600" />, links[entry.path] ? 'Alterar vínculo' : 'Vincular a cliente', () => setLinkTarget(entry))}
            {!isMultiContext && !entry.isDir && item(<History className="w-4 h-4 text-amber-600" />, 'Histórico de versões', () => openVersions(entry))}
            {!isMultiContext && item(<FolderInput className="w-4 h-4 text-slate-500" />, 'Renomear', () => startInlineRename(entry))}
            {item(
              <Download className="w-4 h-4 text-slate-500" />,
              entry.isDir || isMultiContext ? 'Baixar como ZIP' : 'Baixar',
              () => { void downloadEntries(contextEntries); },
            )}

            <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
            {item(<Trash2 className="w-4 h-4 text-red-500" />, isMultiContext ? `Apagar ${contextEntries.length} itens` : 'Apagar', () => remove(contextEntries), true)}
            <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
            {item(
              <Info className="h-4 w-4 text-blue-600" />,
              isMultiContext ? `Propriedades de ${contextEntries.length} itens` : 'Propriedades',
              () => setPropertiesTargets(contextEntries),
            )}
          </div>
        );
      })()}

      {/* Propriedades de arquivos e pastas */}
      {propertiesTargets.length > 0 && (() => {
        const single = propertiesTargets.length === 1 ? propertiesTargets[0] : null;
        const PropertyIcon = single ? extIcon(single) : Layers;
        const selectedFolders = propertiesTargets.filter((entry) => entry.isDir).length;
        const selectedFiles = propertiesTargets.length - selectedFolders;
        const commonLocation = (() => {
          const locations = propertiesTargets.map((entry) => dirOf(entry.path) || 'Início');
          return locations.every((location) => location === locations[0]) ? locations[0] : 'Vários locais';
        })();
        const latestMtime = propertiesTargets
          .map((entry) => entry.mtime)
          .filter((mtime): mtime is string => Boolean(mtime))
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
        const totalSize = propertiesStats?.size
          ?? (single && !single.isDir ? single.size : propertiesTargets.filter((entry) => !entry.isDir).reduce((sum, entry) => sum + entry.size, 0));
        const propertyRow = (label: string, value: React.ReactNode, icon?: React.ReactNode) => (
          <div className="grid grid-cols-[132px_minmax(0,1fr)] items-start gap-3 border-b border-slate-100 py-3 last:border-b-0 dark:border-zinc-800">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              {icon}<span>{label}</span>
            </div>
            <div className="min-w-0 break-words text-sm font-medium text-slate-800 dark:text-slate-100">{value}</div>
          </div>
        );
        return (
          <div
            className="fixed inset-0 z-[155] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-[4px]"
            onClick={() => setPropertiesTargets([])}
          >
            <div
              className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-white/10 bg-white shadow-[0_35px_110px_rgba(0,0,0,0.48)] dark:bg-zinc-900"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900">
                    <PropertyIcon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-slate-900 dark:text-white">
                      {single ? single.name : `${propertiesTargets.length} itens selecionados`}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">Propriedades gerais</p>
                  </div>
                </div>
                <NcModalCloseButton onClick={() => setPropertiesTargets([])} label="Fechar propriedades" />
              </div>

              <div className="max-h-[68dvh] overflow-y-auto px-5 py-2">
                {propertyRow('Tipo', single ? fileTypeLabel(single) : 'Seleção múltipla', <FileText className="h-4 w-4" />)}
                {single && !single.isDir && propertyRow('Formato', fileExtension(single.name) ? `.${fileExtension(single.name)!.toLowerCase()}` : 'Sem extensão')}
                {single && !single.isDir && propertyRow('Tipo MIME', single.mime || 'Não informado')}
                {propertyRow(
                  'Tamanho',
                  propertiesLoading
                    ? <span className="inline-flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Calculando…</span>
                    : `${formatBytes(totalSize)}${totalSize > 0 ? ` (${totalSize.toLocaleString('pt-BR')} bytes)` : ''}`,
                  <HardDrive className="h-4 w-4" />,
                )}
                {(single?.isDir || !single) && propertyRow(
                  'Contém',
                  propertiesLoading
                    ? <span className="inline-flex items-center gap-2">
                        <span className="text-slate-500">{propertiesStats ? `${propertiesStats.files} arquivo(s), ${propertiesStats.folders} subpasta(s)…` : 'Analisando conteúdo…'}</span>
                        <button type="button" onClick={cancelPropertiesCalc} className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Cancelar</button>
                      </span>
                    : `${propertiesStats?.files ?? selectedFiles} arquivo(s) e ${propertiesStats?.folders ?? selectedFolders} subpasta(s)`,
                  <Folder className="h-4 w-4" />,
                )}
                {propertyRow('Localização', commonLocation, <MapPin className="h-4 w-4" />)}
                {propertyRow('Última modificação', formatDateTime(single?.mtime ?? latestMtime), <Clock3 className="h-4 w-4" />)}
                {single && propertyRow(
                  'Caminho',
                  <div className="flex items-start gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-100 px-2.5 py-2 text-[11px] font-normal text-slate-600 dark:bg-zinc-800 dark:text-slate-300">{single.path || '/'}</code>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(single.path || '/').then(
                          () => showTransient('Caminho copiado.'),
                          () => setError('Não foi possível copiar o caminho.'),
                        );
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-blue-600 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      title="Copiar caminho"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>,
                )}
                {single?.isDir && links[single.path] && propertyRow('Cliente vinculado', clientNameById(links[single.path]) || 'Cliente não encontrado', <UserPlus className="h-4 w-4" />)}
                {propertiesError && (
                  <div className="my-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Alguns dados não puderam ser calculados: {propertiesError}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-950">
                <span className="text-[11px] text-slate-400">
                  {single ? (single.isDir ? 'Pasta no Nextcloud' : 'Arquivo no Nextcloud') : `${selectedFiles} arquivo(s) e ${selectedFolders} pasta(s) selecionado(s)`}
                </span>
                <button
                  type="button"
                  onClick={() => setPropertiesTargets([])}
                  className="h-9 rounded-lg bg-blue-600 px-5 text-xs font-semibold text-white transition hover:bg-blue-700"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Confirmação obrigatória para qualquer movimentação de arquivos. */}
      {pendingMovement && (() => {
        const destinationLabel = pendingMovement.targetFolderPath || 'Início';
        const folderCount = pendingMovement.entries.filter((entry) => entry.isDir).length;
        const fileCount = pendingMovement.entries.length - folderCount;
        return (
          <div
            className="fixed inset-0 z-[165] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-[4px]"
            onClick={() => { if (!movementExecuting) setPendingMovement(null); }}
          >
            <div
              className="w-full max-w-[520px] overflow-hidden rounded-2xl border border-white/10 bg-white shadow-[0_35px_110px_rgba(0,0,0,0.5)] dark:bg-zinc-900"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-zinc-800">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
                    <ShieldAlert className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">Confirmar movimentação</h2>
                    <p className="mt-0.5 text-xs text-slate-500">Os itens deixarão a localização atual.</p>
                  </div>
                </div>
                <NcModalCloseButton
                  onClick={() => setPendingMovement(null)}
                  disabled={movementExecuting}
                  label="Cancelar movimentação"
                />
              </div>

              <div className="space-y-4 px-5 py-5">
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  Verifique o destino antes de continuar. Esta confirmação evita movimentações acidentais por arrastar ou recortar.
                </div>

                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Itens que serão movidos</p>
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-zinc-700 dark:bg-zinc-950">
                    {pendingMovement.entries.slice(0, 12).map((entry) => {
                      const ItemIcon = extIcon(entry);
                      return (
                        <div key={entry.path} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-700 dark:text-slate-200">
                          <ItemIcon className={`h-4 w-4 shrink-0 ${entry.isDir ? 'text-blue-500' : 'text-slate-400'}`} />
                          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                          <span className="shrink-0 text-[10px] text-slate-400">{entry.isDir ? 'Pasta' : formatBytes(entry.size)}</span>
                        </div>
                      );
                    })}
                    {pendingMovement.entries.length > 12 && (
                      <div className="px-2.5 py-2 text-xs font-medium text-slate-500">
                        + {pendingMovement.entries.length - 12} outro(s) item(ns)
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-400">{fileCount} arquivo(s) · {folderCount} pasta(s)</p>
                </div>

                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Mover para</p>
                  <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
                    <FolderInput className="h-5 w-5 shrink-0" />
                    <span className="min-w-0 break-all text-sm font-semibold">{destinationLabel}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-950">
                <span className="hidden text-[11px] text-slate-400 sm:inline">Esc cancela a operação</span>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    disabled={movementExecuting}
                    onClick={() => setPendingMovement(null)}
                    className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-300 dark:hover:bg-zinc-800"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={movementExecuting}
                    onClick={() => {
                      const movement = pendingMovement;
                      void (async () => {
                        if (movement.source === 'drag') {
                          const succeeded = await executeDroppedTransfer(
                            movement.entries,
                            movement.targetFolderPath,
                            false,
                          );
                          if (succeeded) setPendingMovement(null);
                          return;
                        }
                        setMovementExecuting(true);
                        try {
                          const succeeded = await paste(movement.targetFolderPath, true);
                          if (succeeded) setPendingMovement(null);
                        } finally {
                          setMovementExecuting(false);
                        }
                      })();
                    }}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-600 px-4 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
                  >
                    {movementExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderInput className="h-4 w-4" />}
                    {movementExecuting ? 'Movendo…' : `Mover ${pendingMovement.entries.length} item(ns)`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bloco de Notas para arquivos de texto */}
      {textEditorOpen && (
        <div className="fixed inset-0 z-[145] flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-[3px] sm:p-5" onClick={() => closeTextEditor()}>
          <div className="flex h-[90dvh] w-full max-w-[1000px] flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[0_35px_100px_rgba(0,0,0,0.35)] dark:border-zinc-700 dark:bg-zinc-900 sm:h-[76dvh]" onClick={(event) => event.stopPropagation()}>
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-3 dark:border-zinc-700 dark:bg-zinc-800">
              <div className="flex min-w-0 items-center gap-2.5">
                <NotebookPen className="h-5 w-5 shrink-0 text-blue-600" />
                <input
                  value={textEditorName}
                  onChange={(event) => setTextEditorName(event.target.value)}
                  aria-label="Nome do arquivo"
                  className="min-w-0 max-w-[55vw] rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-slate-800 outline-none hover:border-slate-300 focus:border-blue-400 focus:bg-white dark:text-white dark:focus:bg-zinc-900"
                />
                {textEditorContent !== textEditorSavedContent && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" title="Alterações não salvas" />}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button type="button" onClick={() => void saveTextEditor()} disabled={textEditorSaving || textEditorLoading} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50">
                  {textEditorSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Salvar
                </button>
                <NcModalCloseButton onClick={closeTextEditor} label="Fechar Bloco de Notas" />
              </div>
            </div>
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-2 text-xs text-slate-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-slate-300">
              <button type="button" onClick={createNewTextDocument} className="rounded px-2.5 py-1 hover:bg-slate-100 dark:hover:bg-zinc-800">Novo</button>
              <button type="button" onClick={() => void saveTextEditor()} className="rounded px-2.5 py-1 hover:bg-slate-100 dark:hover:bg-zinc-800">Salvar</button>
              <button type="button" onClick={() => setTextEditorContent('')} className="rounded px-2.5 py-1 hover:bg-slate-100 dark:hover:bg-zinc-800">Limpar</button>
              <span className="ml-auto hidden text-slate-400 sm:inline">Ctrl/Cmd + S para salvar</span>
            </div>
            <div className="relative min-h-0 flex-1 bg-white dark:bg-zinc-950">
              {textEditorLoading ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 text-slate-400 dark:bg-zinc-950/90">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Abrindo arquivo…
                </div>
              ) : null}
              <textarea
                autoFocus
                spellCheck
                value={textEditorContent}
                onChange={(event) => setTextEditorContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Tab') return;
                  event.preventDefault();
                  const element = event.currentTarget;
                  const start = element.selectionStart;
                  const end = element.selectionEnd;
                  setTextEditorContent((content) => `${content.slice(0, start)}\t${content.slice(end)}`);
                  window.requestAnimationFrame(() => {
                    element.selectionStart = element.selectionEnd = start + 1;
                  });
                }}
                className="h-full w-full resize-none border-0 bg-white p-5 font-mono text-[14px] leading-6 text-slate-900 outline-none dark:bg-zinc-950 dark:text-zinc-100"
                placeholder="Digite aqui…"
              />
            </div>
            <div className="flex h-7 shrink-0 items-center justify-end gap-4 border-t border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-slate-400">
              <span>{textEditorContent.split('\n').length} linha(s)</span>
              <span>{textEditorContent.length} caractere(s)</span>
              <span>UTF-8</span>
            </div>
          </div>
        </div>
      )}

      {/* Modal de preview (PDF / imagem) */}
      {previewFile && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-[#090b0f]/80 p-2 backdrop-blur-md sm:p-5" onClick={() => setPreviewFile(null)}>
          <div
            ref={!isPdf(previewFile) ? previewMediaShellRef : undefined}
            className={[
              'group/preview relative flex flex-col overflow-hidden rounded-[18px] shadow-[0_32px_100px_rgba(0,0,0,0.65)] ring-1 ring-white/15 fullscreen:h-screen fullscreen:w-screen fullscreen:max-h-none fullscreen:max-w-none fullscreen:rounded-none',
              isPdf(previewFile)
                ? 'h-[94dvh] w-[calc(100vw_-_16px)] max-w-[1540px] bg-[#24272c] sm:w-[96vw]'
                : isVideo(previewFile)
                  ? 'w-[min(1280px,96vw)] max-h-[92dvh] bg-black'
                  : isAudio(previewFile)
                    ? 'w-[min(620px,calc(100vw_-_16px))] bg-[#17191d]'
                    : 'w-fit max-h-[92dvh] max-w-[96vw] bg-[#0b0d10]',
            ].join(' ')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={[
              'flex shrink-0 items-center justify-between gap-3 px-3 sm:px-4',
              isPdf(previewFile) || isAudio(previewFile)
                ? 'h-14 border-b border-white/10 bg-[#17191d]'
                : 'absolute inset-x-0 top-0 z-30 h-[72px] bg-gradient-to-b from-black/85 via-black/55 to-transparent pb-3 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/preview:opacity-100',
            ].join(' ')}>
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-blue-300 ring-1 ring-blue-300/20 backdrop-blur-md">
                  {isPdf(previewFile) ? <FileText className="h-4 w-4" /> : isImage(previewFile) ? <ImageIcon className="h-4 w-4" /> : isVideo(previewFile) ? <Film className="h-4 w-4" /> : <Music className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <span className="block max-w-[52vw] truncate text-[13px] font-semibold text-white drop-shadow">{previewFile.name}</span>
                  <span className="block text-[10px] font-medium text-white/55">
                    {formatBytes(previewFile.size)}
                    {previewMediaIndex >= 0 && previewMediaFiles.length > 1 ? ` · ${previewMediaIndex + 1} de ${previewMediaFiles.length}` : ' · Visualização segura'}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isPdf(previewFile) && (
                  <button
                    onClick={() => {
                      const file = previewFile;
                      setPreviewFile(null);
                      void openPdfTools(file);
                    }}
                    className="hidden h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium text-white/70 transition hover:bg-white/10 hover:text-white sm:inline-flex"
                    title="Abrir ferramentas de PDF"
                  >
                    <Wrench className="h-3.5 w-3.5" /> Ferramentas PDF
                  </button>
                )}
                <button onClick={() => download(previewFile)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium text-white/70 transition hover:bg-white/10 hover:text-white">
                  <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Baixar</span>
                </button>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-red-500 hover:text-white"
                  aria-label="Fechar visualização"
                  title="Fechar (Esc)"
                >
                  <X className="h-[18px] w-[18px]" />
                </button>
              </div>
            </div>

            {isPdf(previewFile) ? (
              <>
                <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-black/20 bg-[#202226] px-2 text-white/70 sm:px-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPreviewPdfSidebar((value) => !value)}
                      className="flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-white/10 hover:text-white"
                      title={previewPdfSidebar ? 'Ocultar páginas' : 'Mostrar páginas'}
                    >
                      {previewPdfSidebar ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                    </button>
                    <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
                    <button
                      disabled={previewPdfPage <= 1}
                      onClick={() => setPreviewPdfPage((page) => Math.max(1, page - 1))}
                      className="flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
                      title="Página anterior"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <div className="flex h-8 items-center gap-1.5 rounded-md bg-black/20 px-2 text-[11px] tabular-nums">
                      <input
                        aria-label="Página atual"
                        type="number"
                        min={1}
                        max={Math.max(1, previewPdfPages)}
                        value={previewPdfPage}
                        onChange={(event) => setPreviewPdfPage(Math.min(Math.max(1, Number(event.target.value) || 1), Math.max(1, previewPdfPages)))}
                        className="w-8 border-0 bg-transparent text-center font-semibold text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <span className="text-white/35">/</span>
                      <span>{previewPdfPages || '—'}</span>
                    </div>
                    <button
                      disabled={!previewPdfPages || previewPdfPage >= previewPdfPages}
                      onClick={() => setPreviewPdfPage((page) => Math.min(Math.max(1, previewPdfPages), page + 1))}
                      className="flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
                      title="Próxima página"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    {normalizeRotation(previewPdfRotation) !== 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setPreviewRotationConfirm(true)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-blue-500"
                          title={`Salvar rotação de ${normalizeRotation(previewPdfRotation)}°`}
                        >
                          <Save className="h-3.5 w-3.5" />
                          <span className="hidden lg:inline">Salvar rotação</span>
                          <span className="tabular-nums text-blue-100">{normalizeRotation(previewPdfRotation)}°</span>
                        </button>
                        <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
                      </>
                    )}
                    <button
                      disabled={previewPdfZoom <= 0.5}
                      onClick={() => setPreviewPdfZoom((zoom) => Math.max(0.5, Number((zoom - 0.1).toFixed(1))))}
                      className="flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                      title="Diminuir zoom"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setPreviewPdfZoom(1)}
                      className="h-8 min-w-14 rounded-md px-2 text-[11px] font-semibold tabular-nums transition hover:bg-white/10 hover:text-white"
                      title="Restaurar zoom"
                    >
                      {Math.round(previewPdfZoom * 100)}%
                    </button>
                    <button
                      disabled={previewPdfZoom >= 2}
                      onClick={() => setPreviewPdfZoom((zoom) => Math.min(2, Number((zoom + 0.1).toFixed(1))))}
                      className="flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                      title="Aumentar zoom"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                    <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
                    <button
                      onClick={() => setPreviewPdfZoom(1)}
                      className="hidden h-8 w-8 items-center justify-center rounded-md transition hover:bg-white/10 hover:text-white sm:flex"
                      title="Ajustar à área"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setPreviewPdfRotation((rotation) => normalizeRotation(rotation - 90))}
                      className="hidden h-8 w-8 items-center justify-center rounded-md transition hover:bg-white/10 hover:text-white sm:flex"
                      title="Girar à esquerda"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setPreviewPdfRotation((rotation) => normalizeRotation(rotation + 90))}
                      className="flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-white/10 hover:text-white"
                      title="Girar à direita"
                    >
                      <RotateCw className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 bg-[#303338]">
                  {previewPdfSidebar && (
                    <aside className="hidden w-[164px] shrink-0 overflow-y-auto border-r border-black/25 bg-[#25282d] px-3 py-4 sm:block">
                      {previewUrl && previewPdfPages > 0 ? (
                        <Document file={previewUrl} loading={<Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-white/35" />}>
                          <div className="space-y-3">
                            {Array.from({ length: previewPdfPages }, (_, index) => {
                              const page = index + 1;
                              const renderThumbnail = previewPdfPages <= 30 || Math.abs(page - previewPdfPage) <= 4;
                              return (
                                <button
                                  key={page}
                                  onClick={() => setPreviewPdfPage(page)}
                                  className={[
                                    'group w-full rounded-lg p-1.5 text-left transition',
                                    page === previewPdfPage ? 'bg-blue-500/20 ring-1 ring-blue-400/70' : 'hover:bg-white/7',
                                  ].join(' ')}
                                >
                                  <div className="flex min-h-[112px] items-center justify-center overflow-hidden rounded bg-white shadow-md">
                                    {renderThumbnail ? (
                                      <Page pageNumber={page} width={112} renderTextLayer={false} renderAnnotationLayer={false} />
                                    ) : (
                                      <FileText className="h-8 w-8 text-slate-300" />
                                    )}
                                  </div>
                                  <span className={['mt-1.5 block text-center text-[10px] font-medium', page === previewPdfPage ? 'text-blue-300' : 'text-white/45 group-hover:text-white/70'].join(' ')}>
                                    Página {page}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </Document>
                      ) : (
                        <div className="space-y-3">
                          {[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-lg bg-white/5" />)}
                        </div>
                      )}
                    </aside>
                  )}

                  <div ref={previewPageAreaRef} className="relative flex min-w-0 flex-1 items-start justify-center overflow-auto bg-[#35383d] px-4 py-6 sm:px-8">
                    {!previewUrl ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/45">
                        <Loader2 className="h-7 w-7 animate-spin" />
                        <span className="text-xs">Preparando documento…</span>
                      </div>
                    ) : (
                      <Document
                        file={previewUrl}
                        onLoadSuccess={({ numPages }) => {
                          setPreviewPdfPages(numPages);
                          setPreviewPdfPage((page) => Math.min(Math.max(1, page), numPages));
                        }}
                        onLoadError={() => setError('Não foi possível renderizar este PDF.')}
                        loading={<div className="flex items-center gap-2 pt-20 text-xs text-white/45"><Loader2 className="h-5 w-5 animate-spin" /> Carregando PDF…</div>}
                      >
                        <div className="overflow-hidden bg-white shadow-[0_14px_55px_rgba(0,0,0,0.45)] ring-1 ring-black/15">
                          <Page
                            pageNumber={previewPdfPage}
                            width={Math.max(300, Math.min(980, previewPageAreaWidth - 64)) * previewPdfZoom}
                            rotate={previewPdfRotation}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                            loading={<div className="flex h-[70vh] w-[520px] items-center justify-center bg-white text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>}
                          />
                        </div>
                      </Document>
                    )}
                  </div>
                </div>
                <div className="flex h-7 shrink-0 items-center justify-between border-t border-black/20 bg-[#202226] px-3 text-[10px] text-white/35">
                  <span>{previewPdfPages ? `${previewPdfPages} página${previewPdfPages === 1 ? '' : 's'}` : 'Lendo documento…'}</span>
                  <span className="hidden sm:inline">← → para navegar · Esc para fechar</span>
                </div>
              </>
            ) : (
              <div className={[
                'relative flex min-h-0 items-center justify-center overflow-auto',
                isVideo(previewFile)
                  ? 'max-h-[92dvh] min-h-[320px] bg-black'
                  : isAudio(previewFile)
                    ? 'h-56 bg-[#202226]'
                    : 'max-h-[92dvh] max-w-[96vw] bg-[#0b0d10]',
              ].join(' ')}>
                {!previewUrl ? (
                  <div className="flex h-[420px] w-[min(780px,92vw)] items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-white/35" />
                  </div>
                ) : isImage(previewFile) ? (
                  <img
                    src={previewUrl}
                    alt={previewFile.name}
                    draggable={false}
                    className="block max-h-[92dvh] max-w-[96vw] select-none object-contain transition-transform duration-200"
                    style={{ transform: `scale(${previewMediaZoom}) rotate(${previewMediaRotation}deg)` }}
                  />
                ) : isVideo(previewFile) ? (
                  <video src={previewUrl} controls autoPlay className="block max-h-[92dvh] min-h-[320px] w-full bg-black object-contain" />
                ) : (
                  <div className="w-full max-w-lg px-6">
                    <div className="flex flex-col items-center gap-4 text-white/55">
                      <Music className="h-16 w-16 opacity-60" />
                      <audio src={previewUrl} controls autoPlay className="w-full" />
                    </div>
                  </div>
                )}

                {(isImage(previewFile) || isVideo(previewFile)) && previewMediaFiles.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => navigatePreviewMedia(-1)}
                      className="absolute left-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white/75 opacity-100 shadow-lg ring-1 ring-white/15 backdrop-blur-md transition hover:scale-105 hover:bg-black/70 hover:text-white sm:opacity-0 sm:group-hover/preview:opacity-100"
                      title="Mídia anterior"
                      aria-label="Mídia anterior"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigatePreviewMedia(1)}
                      className="absolute right-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white/75 opacity-100 shadow-lg ring-1 ring-white/15 backdrop-blur-md transition hover:scale-105 hover:bg-black/70 hover:text-white sm:opacity-0 sm:group-hover/preview:opacity-100"
                      title="Próxima mídia"
                      aria-label="Próxima mídia"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}

                {(isImage(previewFile) || isVideo(previewFile)) && (
                  <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-black/60 p-1.5 text-white/75 opacity-100 shadow-xl ring-1 ring-white/15 backdrop-blur-xl transition-opacity sm:opacity-0 sm:group-hover/preview:opacity-100">
                    {isImage(previewFile) && (
                      <>
                        <button
                          type="button"
                          disabled={previewMediaZoom <= 0.6}
                          onClick={() => setPreviewMediaZoom((zoom) => Math.max(0.6, Number((zoom - 0.1).toFixed(1))))}
                          className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                          title="Diminuir zoom"
                        >
                          <ZoomOut className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewMediaZoom(1)}
                          className="h-8 min-w-12 rounded-lg px-1.5 text-[11px] font-semibold tabular-nums transition hover:bg-white/10 hover:text-white"
                          title="Tamanho original"
                        >
                          {Math.round(previewMediaZoom * 100)}%
                        </button>
                        <button
                          type="button"
                          disabled={previewMediaZoom >= 2}
                          onClick={() => setPreviewMediaZoom((zoom) => Math.min(2, Number((zoom + 0.1).toFixed(1))))}
                          className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                          title="Aumentar zoom"
                        >
                          <ZoomIn className="h-4 w-4" />
                        </button>
                        <span className="mx-1 h-5 w-px bg-white/15" />
                        <button
                          type="button"
                          onClick={() => setPreviewMediaRotation((rotation) => normalizeRotation(rotation - 90))}
                          className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10 hover:text-white"
                          title="Girar à esquerda"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewMediaRotation((rotation) => normalizeRotation(rotation + 90))}
                          className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10 hover:text-white"
                          title="Girar à direita"
                        >
                          <RotateCw className="h-4 w-4" />
                        </button>
                        <span className="mx-1 h-5 w-px bg-white/15" />
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const shell = previewMediaShellRef.current;
                        if (!shell) return;
                        if (document.fullscreenElement) void document.exitFullscreen();
                        else void shell.requestFullscreen();
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10 hover:text-white"
                      title="Tela cheia"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {previewRotationConfirm && previewFile && isPdf(previewFile) && (
        <div
          className="fixed inset-0 z-[175] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
          onClick={() => { if (!previewRotationSaving) setPreviewRotationConfirm(false); }}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-white shadow-[0_30px_90px_rgba(0,0,0,0.5)] dark:bg-zinc-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-zinc-800">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
                  <RotateCw className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Salvar rotação do PDF</h2>
                  <p className="truncate text-xs text-slate-500">{previewFile.name}</p>
                </div>
              </div>
              <NcModalCloseButton
                onClick={() => setPreviewRotationConfirm(false)}
                disabled={previewRotationSaving}
                label="Cancelar"
              />
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
                A rotação de <strong>{normalizeRotation(previewPdfRotation)}°</strong> será aplicada a todas as {previewPdfPages || ''} página(s).
              </div>

              <div className="space-y-2">
                <label className={[
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition',
                  previewRotationSaveMode === 'copy'
                    ? 'border-blue-500 bg-blue-50/70 ring-2 ring-blue-500/10 dark:bg-blue-950/25'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-zinc-700 dark:hover:bg-zinc-800',
                ].join(' ')}>
                  <input
                    type="radio"
                    name="preview-rotation-save-mode"
                    checked={previewRotationSaveMode === 'copy'}
                    onChange={() => setPreviewRotationSaveMode('copy')}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800 dark:text-white">Salvar como nova cópia</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{baseName(previewFile.name)}-girado.pdf · mantém o original</span>
                  </span>
                </label>
                <label className={[
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition',
                  previewRotationSaveMode === 'replace'
                    ? 'border-amber-500 bg-amber-50/70 ring-2 ring-amber-500/10 dark:bg-amber-950/25'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-zinc-700 dark:hover:bg-zinc-800',
                ].join(' ')}>
                  <input
                    type="radio"
                    name="preview-rotation-save-mode"
                    checked={previewRotationSaveMode === 'replace'}
                    onChange={() => setPreviewRotationSaveMode('replace')}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800 dark:text-white">Substituir o arquivo original</span>
                    <span className="mt-0.5 block text-xs text-slate-500">Grava a rotação diretamente neste PDF.</span>
                  </span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-950">
              <button
                type="button"
                disabled={previewRotationSaving}
                onClick={() => setPreviewRotationConfirm(false)}
                className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-300 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={previewRotationSaving}
                onClick={() => { void savePreviewPdfRotation(); }}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                {previewRotationSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {previewRotationSaving ? 'Salvando…' : 'Salvar rotação'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: vincular pasta a cliente */}
      {linkTarget && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[3px]" onClick={() => { setLinkTarget(null); setClientSearch(''); }}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-[0_32px_90px_rgba(15,23,42,0.35)] ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="min-w-0">
                <h2 className="font-semibold truncate">Vincular a cliente</h2>
                <p className="text-xs text-gray-500 truncate">Pasta: {linkTarget.name}</p>
              </div>
              <NcModalCloseButton onClick={() => { setLinkTarget(null); setClientSearch(''); }} />
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
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-[3px] sm:items-center sm:p-4" onClick={() => !applyingTool && closePdfTools()}>
          <div className="flex h-[96dvh] w-full flex-col overflow-hidden rounded-t-[20px] bg-[#f3f3f3] shadow-[0_40px_100px_rgba(0,0,0,0.35)] [font-family:'Segoe_UI',system-ui,sans-serif] sm:h-[90dvh] sm:max-w-6xl sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-center gap-4 bg-[#202020] px-5 py-3.5">
              <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-[#0082c9] text-white shadow-sm">
                <NextcloudIcon className="h-4 w-10" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Nextcloud · Biblioteca PDF</p>
                <p className="truncate text-[14px] font-semibold leading-tight text-white">{pdfToolFile.name}</p>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                  <span>{pdfPageCount ?? '…'} página{pdfPageCount === 1 ? '' : 's'}</span>
                  <span className="text-slate-700">·</span>
                  <span>{formatBytes(pdfToolFile.size)}</span>
                  {pdfToolFiles.length > 1 && (
                    <>
                      <span className="text-slate-700">·</span>
                      <span className="font-semibold text-red-400">{pdfToolFiles.length} PDFs no conjunto</span>
                    </>
                  )}
                </div>
              </div>
              {pdfToolMode !== 'home' && (
                <button onClick={() => setPdfToolMode('home')} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/20 hover:text-white">
                  Ferramentas
                </button>
              )}
              <NcModalCloseButton onClick={closePdfTools} disabled={applyingTool} label="Fechar Hub PDF" />
            </div>

            <div className="shrink-0 border-b border-[#d7d7d7] bg-[#fafafa] px-3 py-2 shadow-[0_1px_0_rgba(255,255,255,0.8)]">
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" onClick={() => setPdfToolMode('home')} className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold transition ${pdfToolMode === 'home' ? 'bg-[#e5f3ff] text-[#005a9e]' : 'text-slate-700 hover:bg-[#e9e9e9]'}`}>
                  <Home className="h-4 w-4" /> Início
                </button>
                <span className="mx-1 h-6 w-px bg-[#d8d8d8]" />
                <button type="button" onClick={() => void openOrganizer(pdfToolFile)} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9]">
                  <GripVertical className="h-4 w-4 text-sky-600" /> Organizar
                </button>
                <button type="button" onClick={() => void openOrganizer(pdfToolFile)} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9]">
                  <RotateCw className="h-4 w-4 text-indigo-600" /> Girar páginas
                </button>
                <button type="button" onClick={() => void openOrganizer(pdfToolFile)} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9]">
                  <Trash2 className="h-4 w-4 text-red-600" /> Remover
                </button>
                <button type="button" onClick={() => void openOrganizer(pdfToolFile)} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9]">
                  <Copy className="h-4 w-4 text-emerald-600" /> Extrair
                </button>
                <span className="mx-1 h-6 w-px bg-[#d8d8d8]" />
                <button type="button" onClick={() => setPdfToolMode('watermark')} className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium transition ${pdfToolMode === 'watermark' ? 'bg-purple-100 text-purple-800' : 'text-slate-700 hover:bg-[#e9e9e9]'}`}>
                  <Stamp className="h-4 w-4 text-purple-600" /> Marca d’água
                </button>
                <button type="button" onClick={() => setPdfToolMode('pagenumber')} className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium transition ${pdfToolMode === 'pagenumber' ? 'bg-teal-100 text-teal-800' : 'text-slate-700 hover:bg-[#e9e9e9]'}`}>
                  <Hash className="h-4 w-4 text-teal-600" /> Numerar
                </button>
                <button type="button" onClick={() => setPdfToolMode('split')} className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium transition ${pdfToolMode === 'split' ? 'bg-amber-100 text-amber-800' : 'text-slate-700 hover:bg-[#e9e9e9]'}`}>
                  <Scissors className="h-4 w-4 text-amber-600" /> Dividir
                </button>
                <button type="button" disabled={pdfToolFiles.length < 2 || Boolean(busy)} onClick={() => setPdfToolMode('merge')} className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${pdfToolMode === 'merge' ? 'bg-orange-100 text-orange-800' : 'text-slate-700 hover:bg-[#e9e9e9]'}`}>
                  <Combine className="h-4 w-4 text-orange-600" /> Juntar ({pdfToolFiles.length})
                </button>
                <span className="mx-1 h-6 w-px bg-[#d8d8d8]" />
                <button type="button" onClick={() => download(pdfToolFile)} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9]">
                  <Download className="h-4 w-4 text-slate-500" /> Baixar
                </button>
              </div>
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
                    <button key={tool.label} type="button" onClick={tool.action} className="group mx-3 mb-0.5 flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition hover:bg-slate-50">
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
                    <button key={tool.label} type="button" onClick={tool.action} className="group mx-3 mb-0.5 flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition hover:bg-slate-50">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${tool.bg} ${tool.color}`}>{tool.icon}</span>
                      <span className="min-w-0 flex-1 text-left"><span className="block text-[13px] font-semibold text-slate-800">{tool.label}</span><span className="block truncate text-[11px] text-slate-400">{tool.desc}</span></span>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                    </button>
                  ))}
                  <p className="mt-1 px-5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Páginas</p>
                  <button onClick={() => void openOrganizer(pdfToolFile)} className="mx-3 mb-0.5 flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition hover:bg-slate-50">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600"><Copy className="h-5 w-5" /></span>
                    <span className="flex-1 text-left"><span className="block text-[13px] font-semibold text-slate-800">Extrair</span><span className="block text-[11px] text-slate-400">Selecione páginas</span></span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                  </button>
                  <button disabled={pdfToolFiles.length < 2 || Boolean(busy)} onClick={() => setPdfToolMode('merge')} className="mx-3 mb-0.5 flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-orange-200 bg-orange-50 text-orange-600"><Combine className="h-5 w-5" /></span>
                    <span className="flex-1 text-left"><span className="block text-[13px] font-semibold text-slate-800">Juntar PDFs</span><span className="block text-[11px] text-slate-400">{pdfToolFiles.length >= 2 ? `${pdfToolFiles.length} PDFs carregados` : 'Selecione 2+ PDFs'}</span></span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                  </button>
                  <div className="mt-auto border-t border-slate-100 px-4 py-4">
                    <button onClick={() => download(pdfToolFile)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] text-slate-600 transition hover:bg-white"><Download className="h-4 w-4 text-slate-400" />Baixar PDF original</button>
                  </div>
                </div>

                <div className="hidden min-w-0 flex-1 flex-col bg-[#f8f9fb] lg:flex">
                  {pdfToolFiles.length > 1 && (
                    <div className="border-b border-slate-100 bg-white px-5 py-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">PDFs carregados</p>
                          <p className="text-xs text-slate-400">Clique para visualizar e use as setas para definir a ordem do PDF unificado.</p>
                        </div>
                        <span className="rounded-full bg-red-500 px-2.5 py-1 text-xs font-bold text-white">{pdfToolFiles.length}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                        {pdfToolFiles.map((entry, index) => {
                          const active = entry.path === pdfToolFile.path;
                          return (
                            <div
                              key={entry.path}
                              className={`flex min-w-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-left transition ${
                                active
                                  ? 'border-red-300 bg-red-50 text-red-800'
                                  : 'border-slate-200 bg-[#f8f7f5] text-slate-600 hover:border-slate-300 hover:bg-white'
                              }`}
                            >
                              <button type="button" onClick={() => { if (!active) void openPdfTools(entry, pdfToolFiles); }} className="flex min-w-0 flex-1 items-center gap-2">
                                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-black ${active ? 'bg-red-500 text-white' : 'bg-white text-slate-500'}`}>
                                  {index + 1}
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-xs font-semibold">{entry.name}</span>
                                  <span className="block text-[10px] opacity-70">{formatBytes(entry.size)}</span>
                                </span>
                              </button>
                              <span className="flex shrink-0 flex-col">
                                <button type="button" disabled={index === 0} onClick={() => setPdfToolFiles((files) => moveEntryInList(files, index, index - 1))} title="Mover para antes" className="h-5 w-5 rounded text-[11px] hover:bg-white disabled:opacity-20">↑</button>
                                <button type="button" disabled={index === pdfToolFiles.length - 1} onClick={() => setPdfToolFiles((files) => moveEntryInList(files, index, index + 1))} title="Mover para depois" className="h-5 w-5 rounded text-[11px] hover:bg-white disabled:opacity-20">↓</button>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="border-b border-slate-100 bg-white px-5 py-3">
                    <p className="text-sm font-bold text-slate-900">Páginas do documento</p>
                    <p className="mt-0.5 text-xs text-slate-400">Selecione uma ferramenta ao lado para editar o PDF.</p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto bg-[#f5f5f5] p-5">
                    {pdfToolPreviewUrl ? (
                      <Document file={pdfToolPreviewUrl} loading={<div className="py-12 text-center text-sm text-slate-400"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Carregando PDF…</div>}>
                        <div className="grid grid-cols-3 gap-4 xl:grid-cols-4">
                          {Array.from({ length: pdfPageCount ?? 0 }, (_, index) => (
                            <div key={index} className="overflow-hidden rounded-lg border border-[#cfcfcf] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition hover:border-[#8abde6] hover:shadow-[0_2px_8px_rgba(0,90,158,0.12)]">
                              <div className="flex min-h-[150px] items-center justify-center bg-white p-3"><Page pageNumber={index + 1} width={130} renderTextLayer={false} renderAnnotationLayer={false} /></div>
                              <div className="flex items-center justify-between border-t border-[#e2e2e2] bg-[#fafafa] px-3 py-2 text-[11px] font-semibold text-slate-600">
                                <span>Página {index + 1}</span>
                                <span className="text-[10px] font-normal text-slate-400">PDF</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </Document>
                    ) : <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>}
                  </div>
                  <div className="flex h-7 shrink-0 items-center justify-between border-t border-[#d7d7d7] bg-[#f8f8f8] px-3 text-[11px] text-slate-600">
                    <span>{pdfPageCount ?? 0} página(s) · {pdfToolFiles.length} PDF(s) carregado(s)</span>
                    <span className="max-w-[45%] truncate">{pdfToolFile.name}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1">
                <div className="flex w-full flex-col border-r border-slate-100 bg-white lg:w-[400px] lg:shrink-0">
                  <div className="border-b border-slate-100 px-6 pb-4 pt-6">
                    <h4 className="text-base font-bold text-slate-900">{pdfToolMode === 'watermark' ? 'Marca d’água' : pdfToolMode === 'pagenumber' ? 'Numeração de páginas' : pdfToolMode === 'merge' ? 'Juntar PDFs' : 'Dividir PDF'}</h4>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{pdfToolMode === 'watermark' ? `Texto aplicado em todas as ${pdfPageCount ?? 0} páginas.` : pdfToolMode === 'pagenumber' ? 'Adiciona a numeração em todas as páginas.' : pdfToolMode === 'merge' ? `${pdfToolFiles.length} arquivos serão reunidos na ordem abaixo.` : 'Escolha o ponto de corte do documento.'}</p>
                  </div>
                  <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                    {pdfToolMode === 'watermark' && <>
                      <label className="block text-xs font-semibold text-slate-600">Texto da marca d’água<input value={pdfWatermarkText} onChange={(e) => setPdfWatermarkText(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#e7e5df] bg-slate-50 px-3.5 py-2.5 text-sm font-bold uppercase outline-none focus:border-purple-400" /></label>
                      <label className="block text-xs font-semibold text-slate-600">Opacidade — <span className="text-purple-600">{Math.round(pdfWatermarkOpacity * 100)}%</span><input type="range" min={5} max={60} value={Math.round(pdfWatermarkOpacity * 100)} onChange={(e) => setPdfWatermarkOpacity(Number(e.target.value) / 100)} className="mt-2 w-full accent-purple-500" /></label>
                      <div className="grid grid-cols-2 gap-2">{[{ value: true, label: '↗ Diagonal (45°)' }, { value: false, label: '— Horizontal' }].map((option) => <button key={String(option.value)} onClick={() => setPdfWatermarkDiagonal(option.value)} className={`rounded-xl border py-2.5 text-sm font-medium ${pdfWatermarkDiagonal === option.value ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-[#e7e5df] text-slate-600'}`}>{option.label}</button>)}</div>
                      <label className="block text-xs font-semibold text-slate-600">Aplicar nas páginas (vazio = todas)<input value={pdfWatermarkRange} onChange={(e) => setPdfWatermarkRange(e.target.value)} placeholder={`ex.: 1-3, 5 (de 1 a ${pdfPageCount ?? '?'})`} className="mt-1.5 w-full rounded-xl border border-[#e7e5df] bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-purple-400" /></label>
                    </>}
                    {pdfToolMode === 'pagenumber' && <div className="space-y-3">
                      <div>
                        <p className="mb-1.5 text-xs font-semibold text-slate-600">Posição</p>
                        <div className="space-y-2">{([{ value: 'bottom-center', label: 'Rodapé — Centro' }, { value: 'bottom-right', label: 'Rodapé — Direita' }, { value: 'top-center', label: 'Cabeçalho — Centro' }] as { value: PageNumberPosition; label: string }[]).map((option) => <button key={option.value} onClick={() => setPdfPageNumPosition(option.value)} className={`w-full rounded-xl border px-4 py-2.5 text-left text-sm font-medium ${pdfPageNumPosition === option.value ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-[#e7e5df] text-slate-600'}`}>{option.label}</button>)}</div>
                      </div>
                      <div>
                        <p className="mb-1.5 text-xs font-semibold text-slate-600">Formato</p>
                        <div className="grid grid-cols-3 gap-2">{([{ value: 'n', label: 'N' }, { value: 'n-of-total', label: 'N / Total' }, { value: 'custom', label: 'Personalizado' }] as { value: PageNumberFormat; label: string }[]).map((option) => <button key={option.value} onClick={() => setPdfPageNumFormat(option.value)} className={`rounded-xl border py-2 text-xs font-medium ${pdfPageNumFormat === option.value ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-[#e7e5df] text-slate-600'}`}>{option.label}</button>)}</div>
                      </div>
                      {pdfPageNumFormat === 'custom' && (
                        <label className="block text-xs font-semibold text-slate-600">Modelo (use {'{n}'} e {'{total}'})<input value={pdfPageNumTemplate} onChange={(e) => setPdfPageNumTemplate(e.target.value)} placeholder="Fls. {n} de {total}" className="mt-1.5 w-full rounded-xl border border-[#e7e5df] bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-teal-400" /></label>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block text-xs font-semibold text-slate-600">Nº inicial<input type="number" min={0} value={pdfPageNumStart} onChange={(e) => setPdfPageNumStart(Math.max(0, Number(e.target.value) || 0))} className="mt-1.5 w-full rounded-xl border border-[#e7e5df] bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-teal-400" /></label>
                        <label className="block text-xs font-semibold text-slate-600">Páginas (vazio = todas)<input value={pdfPageNumRange} onChange={(e) => setPdfPageNumRange(e.target.value)} placeholder="ex.: 2-10" className="mt-1.5 w-full rounded-xl border border-[#e7e5df] bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-teal-400" /></label>
                      </div>
                    </div>}
                    {pdfToolMode === 'split' && <>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { value: 'half', label: 'Em duas partes' },
                          { value: 'ranges', label: 'Por intervalos' },
                          { value: 'pages', label: 'Uma por página' },
                        ] as { value: 'half' | 'ranges' | 'pages'; label: string }[]).map((option) => (
                          <button key={option.value} type="button" onClick={() => setPdfSplitMode(option.value)} className={`rounded-xl border py-2 text-xs font-medium ${pdfSplitMode === option.value ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-[#e7e5df] text-slate-600'}`}>{option.label}</button>
                        ))}
                      </div>
                      {pdfSplitMode === 'half' && <>
                        <label className="block text-xs font-semibold text-slate-600">Dividir após a página <span className="text-amber-600">{pdfSplitAt}</span><input type="range" min={1} max={Math.max(1, (pdfPageCount ?? 2) - 1)} value={pdfSplitAt} onChange={(e) => setPdfSplitAt(Number(e.target.value))} className="mt-3 w-full accent-amber-500" /></label>
                        <div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center"><p className="text-2xl font-black text-amber-700">{pdfSplitAt}</p><p className="text-xs text-amber-600">Parte 1</p></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center"><p className="text-2xl font-black text-amber-700">{Math.max(0, (pdfPageCount ?? 0) - pdfSplitAt)}</p><p className="text-xs text-amber-600">Parte 2</p></div></div>
                      </>}
                      {pdfSplitMode === 'ranges' && (
                        <label className="block text-xs font-semibold text-slate-600">
                          Intervalos (ex.: 1-3, 5, 8-10)
                          <input value={pdfSplitRanges} onChange={(e) => setPdfSplitRanges(e.target.value)} placeholder={`1-3, 5, 8-${pdfPageCount ?? '?'}`} className="mt-1.5 w-full rounded-xl border border-[#e7e5df] bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-amber-400" />
                          <span className="mt-1.5 block font-normal text-[11px] text-slate-400">Gera um PDF por intervalo. Páginas fora de 1–{pdfPageCount ?? '?'} ou intervalos inválidos são recusados.</span>
                        </label>
                      )}
                      {pdfSplitMode === 'pages' && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">Gera {pdfPageCount ?? 0} PDF(s), um por página.</div>
                      )}
                    </>}
                    {pdfToolMode === 'merge' && (
                      <>
                        <label className="block text-xs font-semibold text-slate-600">
                          Nome do PDF unificado
                          <div className="mt-1.5 flex items-center rounded-xl border border-[#d7d7d7] bg-slate-50 px-3 focus-within:border-orange-400">
                            <input value={mergePdfName} onChange={(event) => setMergePdfName(event.target.value.replace(/[\\/:*?"<>|]/g, ''))} className="min-w-0 flex-1 bg-transparent py-2.5 text-sm font-medium outline-none" />
                            <span className="text-xs text-slate-400">.pdf</span>
                          </div>
                        </label>
                        <div className="space-y-1.5">
                          {pdfToolFiles.map((entry, index) => (
                            <div key={entry.path} className="flex items-center gap-2 rounded-lg border border-[#e1e1e1] bg-[#fafafa] px-2.5 py-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-orange-100 text-[10px] font-bold text-orange-700">{index + 1}</span>
                              <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{entry.name}</span>
                              <button type="button" disabled={index === 0} onClick={() => setPdfToolFiles((files) => moveEntryInList(files, index, index - 1))} title="Mover para cima" className="h-7 w-7 rounded-md text-xs hover:bg-white disabled:opacity-20">↑</button>
                              <button type="button" disabled={index === pdfToolFiles.length - 1} onClick={() => setPdfToolFiles((files) => moveEntryInList(files, index, index + 1))} title="Mover para baixo" className="h-7 w-7 rounded-md text-xs hover:bg-white disabled:opacity-20">↓</button>
                            </div>
                          ))}
                        </div>
                        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs leading-relaxed text-blue-800">
                          Se já existir um arquivo com esse nome, o sistema criará uma nova versão numerada sem sobrescrever o anterior.
                        </div>
                      </>
                    )}
                    {(pdfToolMode === 'watermark' || pdfToolMode === 'pagenumber') && (
                      <>
                        {(pdfToolFiles.length > 1) && (
                          <div>
                            <p className="mb-1.5 text-xs font-semibold text-slate-600">Aplicar em</p>
                            <div className="grid grid-cols-2 gap-2">
                              {([
                                { value: 'active', label: 'Documento ativo', desc: pdfToolFile.name },
                                { value: 'selected', label: 'Todos os selecionados', desc: `${pdfToolFiles.length} PDFs` },
                              ] as { value: PdfToolScope; label: string; desc: string }[]).map((option) => (
                                <button key={option.value} type="button" onClick={() => setPdfToolScope(option.value)} className={`rounded-xl border px-3 py-2 text-left ${pdfToolScope === option.value ? 'border-blue-400 bg-blue-50' : 'border-[#e7e5df]'}`}>
                                  <span className="block text-xs font-semibold text-slate-800">{option.label}</span>
                                  <span className="block truncate text-[11px] text-slate-400">{option.desc}</span>
                                </button>
                              ))}
                            </div>
                            {pdfToolScope === 'selected' && (
                              <p className="mt-1.5 text-[11px] text-amber-600">Em lote, cada original é preservado e uma cópia processada é gerada.</p>
                            )}
                          </div>
                        )}
                        {!(pdfToolScope === 'selected' && pdfToolFiles.length > 1) && (
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={pdfSaveAsCopy} onChange={(e) => setPdfSaveAsCopy(e.target.checked)} className="rounded" />Preservar o original e salvar como cópia</label>
                        )}
                      </>
                    )}

                    {(pdfToolMode === 'watermark' || pdfToolMode === 'pagenumber') && pdfBatchResults && pdfBatchResults.length > 0 && (
                      <div className="rounded-xl border border-slate-200 bg-white">
                        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                          <span className="text-xs font-semibold text-slate-700">Resultado por item</span>
                          <div className="flex items-center gap-2">
                            {pdfBatchResults.some((r) => r.status === 'failed') && !applyingTool && (
                              <button type="button" onClick={() => void retryFailedPdfBatch()} className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-100">
                                <RotateCcw className="h-3 w-3" /> Tentar os que falharam
                              </button>
                            )}
                            <span className="text-[11px] text-slate-400">{pdfBatchResults.filter((r) => r.status === 'done').length}/{pdfBatchResults.length} ok</span>
                          </div>
                        </div>
                        <ul className="max-h-40 space-y-0.5 overflow-y-auto px-3 py-2 text-xs">
                          {pdfBatchResults.map((r) => (
                            <li key={r.id} className="flex items-center gap-2">
                              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${r.status === 'done' ? 'bg-emerald-500' : r.status === 'failed' ? 'bg-red-500' : r.status === 'processing' ? 'bg-amber-400' : 'bg-slate-300'}`} />
                              <span className="min-w-0 flex-1 truncate text-slate-700">{r.source}</span>
                              <span className={`shrink-0 ${r.status === 'failed' ? 'text-red-600' : 'text-slate-400'}`}>{r.status === 'done' ? 'concluído' : r.status === 'failed' ? 'falhou' : r.status === 'processing' ? '…' : 'pendente'}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
                    <button onClick={() => setPdfToolMode('home')} className="flex-1 rounded-xl border border-[#e7e5df] py-2.5 text-sm font-medium text-slate-700">Cancelar</button>
                    <button
                      onClick={() => pdfToolMode === 'watermark' ? handleWatermark() : pdfToolMode === 'pagenumber' ? handlePageNumbers() : pdfToolMode === 'merge' ? void mergePdfEntries(pdfToolFiles, mergePdfName) : void handleSplit()}
                      disabled={applyingTool || (pdfToolMode === 'watermark' && !pdfWatermarkText.trim()) || (pdfToolMode === 'split' && ((pdfPageCount ?? 0) < 2 || (pdfSplitMode === 'ranges' && !pdfSplitRanges.trim()))) || (pdfToolMode === 'merge' && (pdfToolFiles.length < 2 || !mergePdfName.trim()))}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 ${pdfToolMode === 'merge' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-red-500 hover:bg-red-600'}`}
                    >
                      {applyingTool || busy ? <Loader2 className="h-4 w-4 animate-spin" /> : pdfToolMode === 'merge' ? <Combine className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                      {applyingTool || busy ? 'Processando…' : pdfToolMode === 'merge' ? `Juntar ${pdfToolFiles.length} PDFs` : 'Aplicar'}
                    </button>
                  </div>
                </div>
                {pdfToolMode === 'watermark' ? (
                  <div className="hidden min-h-0 flex-1 flex-col bg-[#f8f9fb] lg:flex">
                    <div className="flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">Pré-visualização</p>
                        <p className="text-xs text-slate-400">Resultado real da marca d'água no documento ativo.</p>
                      </div>
                      <button type="button" onClick={() => void generateWatermarkPreview()} disabled={pdfWatermarkPreviewBusy || !pdfWatermarkText.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-purple-700 disabled:opacity-50">
                        {pdfWatermarkPreviewBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                        {pdfWatermarkPreviewUrl ? 'Atualizar' : 'Pré-visualizar'}
                      </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto bg-[#f5f5f5] p-5">
                      {pdfWatermarkPreviewUrl ? (
                        <Document file={pdfWatermarkPreviewUrl} loading={<div className="py-12 text-center text-sm text-slate-400"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Renderizando…</div>}>
                          <div className="flex flex-col items-center gap-4">
                            {Array.from({ length: Math.min(pdfPageCount ?? 1, 5) }, (_, index) => (
                              <div key={index} className="overflow-hidden rounded-lg border border-[#cfcfcf] bg-white shadow-sm">
                                <Page pageNumber={index + 1} width={340} renderTextLayer={false} renderAnnotationLayer={false} />
                              </div>
                            ))}
                            {(pdfPageCount ?? 0) > 5 && <p className="text-xs text-slate-400">Mostrando as 5 primeiras de {pdfPageCount} páginas.</p>}
                          </div>
                        </Document>
                      ) : (
                        <div className="flex h-full items-center justify-center text-center"><div><div className="mx-auto mb-4 flex h-20 w-16 items-center justify-center rounded-xl bg-white shadow-md"><Stamp className="h-7 w-7 text-purple-300" /></div><p className="max-w-[240px] text-sm leading-relaxed text-slate-400">Clique em "Pré-visualizar" para ver a marca d'água aplicada antes de salvar.</p></div></div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="hidden flex-1 items-center justify-center bg-[#f8f9fb] p-10 lg:flex"><div className="text-center"><div className="mx-auto mb-4 flex h-20 w-16 items-center justify-center rounded-xl bg-white shadow-md"><FileText className="h-7 w-7 text-slate-300" /></div><p className="max-w-[220px] text-sm leading-relaxed text-slate-400">O resultado será salvo diretamente no Nextcloud.</p></div></div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: organizador de páginas de PDF */}
      {organizeFile && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-[3px] sm:p-5" onClick={() => !organizeSaving && requestOrganizerExit('close')}>
          <div className="flex h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-[#f3f3f3] shadow-[0_32px_90px_rgba(15,23,42,0.4)] ring-1 ring-black/10 [font-family:'Segoe_UI',system-ui,sans-serif] dark:bg-zinc-900 dark:ring-white/10 sm:h-[88dvh]" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2 min-w-0">
                <Layers className="w-5 h-5 text-indigo-600 shrink-0" />
                <div className="min-w-0">
                  <h2 className="font-semibold truncate">Organizar páginas</h2>
                  <p className="text-xs text-gray-500 truncate">{organizeFile.name} · {organizePages.length} página(s){organizeSelected.length ? ` · ${organizeSelected.length} selecionada(s)` : ''}{organizerDirty ? ' · alterações não salvas' : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => requestOrganizerExit('back')}
                  disabled={organizeSaving}
                  title="Voltar ao Hub sem salvar estas alterações"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-200"
                >
                  <ChevronLeft className="h-4 w-4" /> Voltar às ferramentas
                </button>
                <label className="hidden cursor-pointer items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 sm:flex">
                  <input type="checkbox" checked={organizeSaveAsCopy} onChange={(e) => setOrganizeSaveAsCopy(e.target.checked)} className="rounded" /> Salvar como cópia
                </label>
                <NcModalCloseButton onClick={() => requestOrganizerExit('close')} disabled={organizeSaving} />
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[#d7d7d7] bg-[#fafafa] px-3 py-2">
              <button type="button" onClick={undoOrganize} disabled={organizePast.length === 0} title="Desfazer (Ctrl/Cmd + Z)" className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9] disabled:opacity-40">
                <RotateCcw className="h-4 w-4 text-slate-600" /> Desfazer
              </button>
              <button type="button" onClick={redoOrganize} disabled={organizeFuture.length === 0} title="Refazer (Ctrl/Cmd + Shift + Z)" className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9] disabled:opacity-40">
                <RotateCw className="h-4 w-4 text-slate-600" /> Refazer
              </button>
              <span className="mx-1 h-6 w-px bg-[#d8d8d8]" />
              <button type="button" onClick={() => setOrganizeSelected(organizePages.map((_, index) => index))} disabled={!organizeReady || organizeSelected.length === organizePages.length} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9] disabled:opacity-40">
                <CheckSquare className="h-4 w-4 text-[#0078d4]" /> Selecionar tudo
              </button>
              <button type="button" onClick={() => setOrganizeSelected([])} disabled={organizeSelected.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9] disabled:opacity-40">
                <Square className="h-4 w-4 text-slate-500" /> Limpar seleção
              </button>
              <span className="mx-1 h-6 w-px bg-[#d8d8d8]" />
              <button type="button" onClick={() => rotateSelectedOrganizePages(-90)} disabled={organizeSelected.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9] disabled:opacity-40">
                <RotateCcw className="h-4 w-4 text-indigo-600" /> Girar à esquerda
              </button>
              <button type="button" onClick={() => rotateSelectedOrganizePages(90)} disabled={organizeSelected.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9] disabled:opacity-40">
                <RotateCw className="h-4 w-4 text-indigo-600" /> Girar à direita
              </button>
              <button type="button" onClick={duplicateOrganizeSelected} disabled={organizeSelected.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9] disabled:opacity-40">
                <Copy className="h-4 w-4 text-blue-600" /> Duplicar
              </button>
              <button type="button" onClick={reverseOrganizePages} disabled={organizePages.length < 2} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9] disabled:opacity-40">
                <ArrowUpDown className="h-4 w-4 text-slate-600" /> Inverter ordem
              </button>
              <span className="mx-1 h-6 w-px bg-[#d8d8d8]" />
              <button type="button" onClick={extractOrganizeSelected} disabled={organizeSaving || organizeSelected.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-slate-700 transition hover:bg-[#e9e9e9] disabled:opacity-40">
                <Copy className="h-4 w-4 text-emerald-600" /> Extrair
              </button>
              <button type="button" onClick={removeOrganizeSelected} disabled={organizeSaving || organizeSelected.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-40">
                <Trash2 className="h-4 w-4" /> Remover
              </button>
              {organizeSelected.length > 0 && (
                <span className="ml-auto rounded-full bg-[#e5f3ff] px-2.5 py-1 text-[11px] font-semibold text-[#005a9e]">{organizeSelected.length} selecionada(s)</span>
              )}
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
                                    <button type="button" onClick={() => removeOrganizePage(index)} title="Remover página" className="w-7 h-7 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>
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
              <p className="hidden text-xs text-gray-500 sm:block">Arraste para reordenar · Ctrl/Cmd+A seleciona tudo · Ctrl/Cmd+Z desfaz · Delete remove.</p>
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
                <button onClick={() => void saveOrganize()} disabled={organizeSaving || organizePages.length === 0} className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                  {organizeSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {organizeSaveAsCopy ? 'Salvar cópia e voltar' : 'Salvar e voltar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(organizeExitIntent)}
        onClose={() => setOrganizeExitIntent(null)}
        size="sm"
        title="Salvar alterações no PDF?"
        eyebrow="Biblioteca PDF"
        subtitle={organizeFile?.name}
        icon={<ShieldAlert className="h-5 w-5" />}
        accentBarClassName="bg-amber-500"
        iconContainerClassName="rounded-xl bg-amber-500 text-white"
        zIndex={170}
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => setOrganizeExitIntent(null)}>Continuar editando</Button>
            <Button variant="danger" onClick={discardOrganizerChanges}>Descartar</Button>
            <Button onClick={() => void saveOrganize(organizeExitIntent === 'close' ? 'close' : 'hub')}>
              <Save className="h-4 w-4" /> Salvar
            </Button>
          </ModalFooter>
        }
      >
        <ModalBody>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            A ordem, as rotações ou as páginas removidas ainda não foram gravadas. Você pode salvar, descartar ou continuar a edição.
          </p>
        </ModalBody>
      </Modal>

      {/* Modal: imagens → PDF */}
      {imagesPdfTargets && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[3px]" onClick={() => !convertingImages && setImagesPdfTargets(null)}>
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_32px_90px_rgba(15,23,42,0.35)] ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2"><FileImage className="w-5 h-5 text-violet-600" /> <h2 className="font-semibold">Imagens → PDF</h2></div>
              <NcModalCloseButton onClick={() => setImagesPdfTargets(null)} disabled={convertingImages} />
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500">{imagesPdfTargets.length} imagem(ns), uma por página. Arraste ou use as setas para definir a ordem final.</p>
                <div className="flex shrink-0 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700" aria-label="Modo de visualização">
                  <button type="button" onClick={() => setImagesPdfViewMode('list')} title="Lista" className={`p-2 transition ${imagesPdfViewMode === 'list' ? 'bg-violet-600 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                    <List className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setImagesPdfViewMode('grid')} title="Blocos com miniaturas" className={`p-2 transition ${imagesPdfViewMode === 'grid' ? 'bg-violet-600 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <label className="block text-sm">Nome do PDF
                <input value={imagesPdfName} onChange={(e) => setImagesPdfName(e.target.value)} className="mt-1 w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent" />
              </label>
              <DndContext sensors={organizeSensors} collisionDetection={closestCenter} onDragEnd={handleImagePdfDragEnd}>
                <SortableContext items={imagesPdfTargets.map((entry) => entry.path)} strategy={rectSortingStrategy}>
                  <ul className={imagesPdfViewMode === 'grid'
                    ? 'grid max-h-[52vh] grid-cols-2 gap-3 overflow-y-auto pr-1 text-sm text-gray-600 dark:text-gray-400 sm:grid-cols-3 lg:grid-cols-4'
                    : 'max-h-72 space-y-2 overflow-y-auto text-sm text-gray-600 dark:text-gray-400'}>
                    {imagesPdfTargets.map((img, index) => (
                      <SortablePdfPage key={img.path} id={img.path}>
                        <li className={imagesPdfViewMode === 'grid'
                          ? 'relative flex h-full flex-col rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-zinc-700 dark:bg-zinc-800'
                          : 'flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800'}>
                          {imagesPdfViewMode === 'grid' ? (
                            <>
                              <div className="absolute left-3 top-3 z-[1] flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-xs font-bold text-white shadow">{index + 1}</div>
                              <div className="absolute right-3 top-3 z-[1] rounded-lg bg-white/90 p-1 text-slate-500 shadow dark:bg-zinc-900/90"><GripVertical className="h-4 w-4 cursor-grab" /></div>
                              <NcThumb entry={img} />
                              <span className="mt-2 line-clamp-2 min-h-10 break-all text-center text-xs" title={img.name}>{img.name}</span>
                              <div className="mt-auto flex justify-center gap-2 pt-2">
                                <button type="button" title="Mover para antes" disabled={index === 0} onClick={(event) => { event.stopPropagation(); setImagesPdfTargets(moveEntryInList(imagesPdfTargets, index, index - 1)); }} className="rounded-lg border border-slate-200 bg-white px-3 py-1 hover:bg-slate-100 disabled:opacity-30 dark:border-zinc-600 dark:bg-zinc-700 dark:hover:bg-zinc-600">↑</button>
                                <button type="button" title="Mover para depois" disabled={index === imagesPdfTargets.length - 1} onClick={(event) => { event.stopPropagation(); setImagesPdfTargets(moveEntryInList(imagesPdfTargets, index, index + 1)); }} className="rounded-lg border border-slate-200 bg-white px-3 py-1 hover:bg-slate-100 disabled:opacity-30 dark:border-zinc-600 dark:bg-zinc-700 dark:hover:bg-zinc-600">↓</button>
                              </div>
                            </>
                          ) : (
                            <>
                              <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-400" />
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-xs font-bold text-violet-700">{index + 1}</span>
                              <ImageIcon className="w-4 h-4 shrink-0" />
                              <span className="min-w-0 flex-1 truncate">{img.name}</span>
                              <button type="button" disabled={index === 0} onClick={(event) => { event.stopPropagation(); setImagesPdfTargets(moveEntryInList(imagesPdfTargets, index, index - 1)); }} className="rounded-lg px-2 py-1 hover:bg-white disabled:opacity-30 dark:hover:bg-zinc-700">↑</button>
                              <button type="button" disabled={index === imagesPdfTargets.length - 1} onClick={(event) => { event.stopPropagation(); setImagesPdfTargets(moveEntryInList(imagesPdfTargets, index, index + 1)); }} className="rounded-lg px-2 py-1 hover:bg-white disabled:opacity-30 dark:hover:bg-zinc-700">↓</button>
                            </>
                          )}
                        </li>
                      </SortablePdfPage>
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
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
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[3px]" onClick={() => setVersionsFile(null)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-[0_32px_90px_rgba(15,23,42,0.35)] ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2 min-w-0"><History className="w-5 h-5 text-amber-600 shrink-0" /> <div className="min-w-0"><h2 className="font-semibold truncate">Versões</h2><p className="text-xs text-gray-500 truncate">{versionsFile.name}</p></div></div>
              <NcModalCloseButton onClick={() => setVersionsFile(null)} />
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
        open={textDiscardConfirm}
        onClose={() => setTextDiscardConfirm(false)}
        size="sm"
        title="Salvar alterações?"
        eyebrow="Bloco de Notas"
        subtitle={textEditorName}
        icon={<NotebookPen className="h-5 w-5" />}
        accentBarClassName="bg-blue-600"
        iconContainerClassName="rounded-xl bg-blue-600 text-white"
        zIndex={170}
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => setTextDiscardConfirm(false)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                setTextDiscardConfirm(false);
                if (textDiscardAction === 'new') void openTextEditor();
                else closeTextEditor(true);
              }}
            >
              Descartar
            </Button>
            <Button
              onClick={async () => {
                const saved = await saveTextEditor();
                if (!saved) return;
                setTextDiscardConfirm(false);
                if (textDiscardAction === 'new') void openTextEditor();
                else closeTextEditor(true);
              }}
            >
              <Save className="h-4 w-4" /> Salvar
            </Button>
          </ModalFooter>
        }
      >
        <ModalBody>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Existem alterações não salvas. Salve o arquivo antes de {textDiscardAction === 'new' ? 'criar um novo documento' : 'fechar'}.
          </p>
        </ModalBody>
      </Modal>

      <Modal
        open={textConflict}
        onClose={() => setTextConflict(false)}
        size="sm"
        title="Conflito de versão"
        eyebrow="Bloco de Notas"
        subtitle={textEditorName}
        icon={<AlertCircle className="h-5 w-5" />}
        accentBarClassName="bg-amber-500"
        iconContainerClassName="rounded-xl bg-amber-500 text-white"
        zIndex={175}
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => setTextConflict(false)}>Cancelar</Button>
            <Button variant="secondary" onClick={() => void textConflictReload()}>Recarregar do servidor</Button>
            <Button onClick={() => void textConflictSaveCopy()}><Copy className="h-4 w-4" /> Salvar como cópia</Button>
          </ModalFooter>
        }
      >
        <ModalBody>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Outra pessoa (ou outra aba) alterou este arquivo no servidor desde que você o abriu.
            Para não sobrescrever esse trabalho, escolha uma opção:
          </p>
          <ul className="mt-3 space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
            <li><strong className="text-slate-700 dark:text-slate-200">Recarregar do servidor</strong> — descarta suas edições e traz a versão atual.</li>
            <li><strong className="text-slate-700 dark:text-slate-200">Salvar como cópia</strong> — mantém as duas versões, salvando a sua com outro nome.</li>
            <li><strong className="text-slate-700 dark:text-slate-200">Cancelar</strong> — volta ao editor sem salvar.</li>
          </ul>
        </ModalBody>
      </Modal>

      <Modal
        open={Boolean(nameDialog)}
        onClose={closeNameDialog}
        size="sm"
        title={nameDialog?.mode === 'create' ? 'Criar nova pasta' : nameDialog?.mode === 'createWord' ? 'Novo documento Word' : 'Renomear item'}
        eyebrow="Nextcloud"
        subtitle={nameDialog?.mode === 'create' || nameDialog?.mode === 'createWord' ? `Local: ${path || 'Início'}` : nameDialog?.entry?.name}
        icon={nameDialog?.mode === 'create' ? <FolderPlus className="h-5 w-5" /> : nameDialog?.mode === 'createWord' ? <FileText className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
        accentBarClassName="bg-blue-600"
        iconContainerClassName="rounded-xl bg-blue-600 text-white shadow-sm"
        zIndex={160}
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={closeNameDialog} disabled={Boolean(busy)}>Cancelar</Button>
            <Button onClick={() => void submitNameDialog()} disabled={Boolean(busy) || !nameDialog?.value.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : nameDialog?.mode === 'create' ? <FolderPlus className="h-4 w-4" /> : nameDialog?.mode === 'createWord' ? <FileText className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {nameDialog?.mode === 'create' ? 'Criar pasta' : nameDialog?.mode === 'createWord' ? 'Criar documento' : 'Salvar nome'}
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
            onFocus={(event) => {
              if (nameDialog?.mode === 'createWord') {
                const end = event.currentTarget.value.toLowerCase().endsWith('.docx')
                  ? event.currentTarget.value.length - 5
                  : event.currentTarget.value.length;
                event.currentTarget.setSelectionRange(0, end);
              }
            }}
            onChange={(event) => setNameDialog((current) => current ? { ...current, value: event.target.value } : current)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitNameDialog();
              }
            }}
            placeholder={nameDialog?.mode === 'create' ? 'Ex.: Documentos do processo' : nameDialog?.mode === 'createWord' ? 'Ex.: Petição inicial.docx' : 'Novo nome'}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
          <p className="text-xs text-slate-500">O nome não pode conter barras.</p>
        </ModalBody>
      </Modal>

      {zipProgress && (
        <div className="fixed bottom-4 left-4 z-[150] w-[min(92vw,340px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.25)] dark:border-zinc-700 dark:bg-zinc-900" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{zipProgress.label}</p>
              <p className="text-[11px] text-slate-400">{zipProgress.percent > 0 ? `${zipProgress.percent}%` : 'preparando…'}</p>
            </div>
            <button type="button" onClick={cancelZip} className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-100">Cancelar</button>
          </div>
          <div className="h-1.5 w-full bg-slate-100 dark:bg-zinc-800">
            <div className="h-full bg-blue-500 transition-[width] duration-200" style={{ width: `${zipProgress.percent}%` }} />
          </div>
        </div>
      )}

      {uploadJobs && uploadJobs.length > 0 && (() => {
        const active = uploadJobs.some((j) => j.status === 'pending' || j.status === 'uploading');
        const done = uploadJobs.filter((j) => j.status === 'done').length;
        const failed = uploadJobs.filter((j) => j.status === 'failed' || j.status === 'canceled').length;
        return (
          <div className="fixed bottom-4 right-4 z-[150] w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.25)] dark:border-zinc-700 dark:bg-zinc-900" role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-zinc-800">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {active ? 'Enviando arquivos…' : failed ? 'Envio concluído com falhas' : 'Envio concluído'}
                </p>
                <p className="text-[11px] text-slate-400">{done}/{uploadJobs.length} enviado(s){failed ? ` · ${failed} com falha` : ''}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {active && (
                  <button type="button" onClick={cancelUploads} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-100">Cancelar</button>
                )}
                {!active && failed > 0 && (
                  <button type="button" onClick={() => void retryFailedUploads()} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100"><RotateCcw className="h-3 w-3" />Repetir falhas</button>
                )}
                {!active && (
                  <button type="button" onClick={dismissUploadJobs} aria-label="Fechar painel de envio" className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
                )}
              </div>
            </div>
            <ul className="max-h-64 space-y-2 overflow-y-auto px-4 py-3">
              {uploadJobs.map((job) => (
                <li key={job.id}>
                  <div className="mb-1 flex items-center gap-2 text-xs">
                    <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${job.status === 'done' ? 'bg-emerald-500' : job.status === 'failed' ? 'bg-red-500' : job.status === 'canceled' ? 'bg-slate-400' : job.status === 'uploading' ? 'bg-blue-500' : 'bg-slate-300'}`} />
                    <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200" title={job.name}>{job.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">
                      {job.status === 'uploading' ? `${job.progress}%` : job.status === 'done' ? 'ok' : job.status === 'failed' ? 'falhou' : job.status === 'canceled' ? 'cancelado' : '…'}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
                    <div className={`h-full rounded-full transition-[width] duration-200 ${job.status === 'failed' ? 'bg-red-400' : job.status === 'canceled' ? 'bg-slate-300' : job.status === 'done' ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${job.status === 'done' ? 100 : job.progress}%` }} />
                  </div>
                  {job.error && <p className="mt-0.5 truncate text-[11px] text-red-500" title={job.error}>{job.error}</p>}
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      <Modal
        open={Boolean(uploadDropReport)}
        onClose={() => setUploadDropReport(null)}
        size="md"
        title="Resumo do envio"
        eyebrow={uploadDropReport?.failures.length ? 'Concluído com ocorrências' : 'Envio concluído'}
        subtitle="Arquivos e pastas arrastados"
        icon={<Upload className="h-5 w-5" />}
        accentBarClassName={uploadDropReport?.failures.length ? 'bg-amber-500' : 'bg-emerald-500'}
        iconContainerClassName={uploadDropReport?.failures.length ? 'rounded-xl bg-amber-500 text-white' : 'rounded-xl bg-emerald-500 text-white'}
        zIndex={161}
        footer={
          <ModalFooter>
            <Button onClick={() => setUploadDropReport(null)}>Concluir</Button>
          </ModalFooter>
        }
      >
        <ModalBody className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Enviados', uploadDropReport?.filesUploaded ?? 0],
              ['Pastas preparadas', uploadDropReport?.foldersCreated ?? 0],
              ['Renomeados', uploadDropReport?.renamedConflicts ?? 0],
              ['Falhas', uploadDropReport?.failures.length ?? 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center dark:border-zinc-700 dark:bg-zinc-800">
                <p className="text-xl font-bold text-slate-900 dark:text-white">{value}</p>
                <p className="text-[11px] text-slate-500">{label}</p>
              </div>
            ))}
          </div>
          {(uploadDropReport?.renamedConflicts ?? 0) > 0 && (
            <p className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
              Arquivos com nomes já existentes foram preservados e os novos receberam “(cópia)” no nome.
            </p>
          )}
          {uploadDropReport?.failures.length ? (
            <div className="max-h-52 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-2 dark:border-amber-900/60 dark:bg-amber-950/30">
              {uploadDropReport.failures.map((failure, index) => (
                <div key={`${failure.path}-${index}`} className="border-b border-amber-200/70 px-2 py-2 text-xs last:border-0 dark:border-amber-900/50">
                  <p className="font-semibold text-amber-900 dark:text-amber-200">{failure.path}</p>
                  <p className="mt-0.5 text-amber-700 dark:text-amber-300">{failure.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
              Todos os itens foram processados. A estrutura de pastas, inclusive pastas vazias, foi preservada.
            </p>
          )}
        </ModalBody>
      </Modal>

      <Modal
        open={deleteTargets.length > 0}
        onClose={() => !busy && setDeleteTargets([])}
        size="sm"
        title={deleteTargets.length > 1
          ? `Excluir ${deleteTargets.length} itens?`
          : `Excluir ${deleteTargets[0]?.isDir ? 'pasta' : 'arquivo'}?`}
        eyebrow="Ação irreversível"
        subtitle={deleteTargets.length > 1 ? 'Seleção múltipla' : deleteTargets[0]?.name}
        icon={<ShieldAlert className="h-5 w-5" />}
        accentBarClassName="bg-red-500"
        iconContainerClassName="rounded-xl bg-red-500 text-white shadow-sm"
        zIndex={161}
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => setDeleteTargets([])} disabled={Boolean(busy)}>Cancelar</Button>
            <Button variant="danger" onClick={() => void confirmRemove()} disabled={Boolean(busy)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {deleteTargets.length > 1 ? `Excluir ${deleteTargets.length} itens` : 'Excluir definitivamente'}
            </Button>
          </ModalFooter>
        }
      >
        <ModalBody>
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm leading-relaxed text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {deleteTargets.length > 1
              ? `Os ${deleteTargets.length} itens selecionados serão removidos do Nextcloud. Pastas terão todo o seu conteúdo apagado.`
              : deleteTargets[0]?.isDir
                ? 'A pasta e todo o conteúdo dentro dela serão removidos do Nextcloud.'
                : 'O arquivo será removido do Nextcloud.'}
            {' '}Esta ação não pode ser desfeita por este módulo.
          </div>
          {deleteTargets.length > 1 && (
            <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
              {deleteTargets.map((entry) => (
                <div key={entry.path} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-600 dark:text-slate-300">
                  {entry.isDir ? <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" /> : <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                  <span className="truncate">{entry.name}</span>
                </div>
              ))}
            </div>
          )}
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
