import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import JSZip from 'jszip';
import { renderAsync } from 'docx-preview';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PDFDocument, degrees } from 'pdf-lib';
import { Document, Page, pdfjs } from 'react-pdf';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  CloudCog,
  Cloud,
  Copy,
  Download,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Filter,
  HardDrive,
  Home,
  ImageIcon,
  History,
  Info,
  LayoutGrid,
  Link2,
  Loader2,
  List,
  Minimize2,
  MoveRight,
  MoreHorizontal,
  Pin,
  GripVertical,
  CheckCircle2,
  XCircle,
  RotateCcw,
  RotateCw,
  Scissors,
  Search,
  AlertCircle,
  Share2,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { supabase } from '../config/supabase';
import { cloudService } from '../services/cloud.service';
import { clientService } from '../services/client.service';
import { useToastContext } from '../contexts/ToastContext';
import { ClientSearchSelect } from './ClientSearchSelect';
import SyncfusionEditor, { type SyncfusionEditorRef } from './SyncfusionEditor';
import { events, SYSTEM_EVENTS } from '../utils/events';
import type { Client } from '../types/client.types';
import type { CloudActivityLog, CloudFile, CloudFolder, CloudFolderShare } from '../types/cloud.types';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const isImageFile = (mime?: string | null) => Boolean(mime?.startsWith('image/'));
const isPdfFile = (mime?: string | null, name?: string) => mime === 'application/pdf' || String(name || '').toLowerCase().endsWith('.pdf');
const isVideoFile = (mime?: string | null, name?: string) => {
  const lower = String(name || '').toLowerCase();
  return Boolean(
    mime?.startsWith('video/')
    || lower.endsWith('.mp4')
    || lower.endsWith('.mov')
    || lower.endsWith('.webm')
    || lower.endsWith('.m4v')
    || lower.endsWith('.avi')
    || lower.endsWith('.mkv')
  );
};
const isWordFile = (mime?: string | null, name?: string) => {
  const lower = String(name || '').toLowerCase();
  return mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || mime === 'application/msword'
    || lower.endsWith('.docx')
    || lower.endsWith('.doc');
};

type CloudCardSize = 'small' | 'medium' | 'large';

const isDocxFile = (mime?: string | null, name?: string) => {
  const lower = String(name || '').toLowerCase();
  return mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lower.endsWith('.docx');
};

type CloudDragEntry = {
  name?: string;
  isDirectory: boolean;
  isFile: boolean;
  fullPath?: string;
};

type CloudDragFileEntry = CloudDragEntry & {
  file: (callback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
};

type CloudDragDirectoryEntry = CloudDragEntry & {
  createReader: () => {
    readEntries: (
      successCallback: (entries: CloudDragEntry[]) => void,
      errorCallback?: (error: DOMException) => void,
    ) => void;
  };
};

type CloudDroppedFile = {
  file: File;
  relativePath: string;
};

const normalizeDroppedRelativePath = (file: File) => {
  const webkitRelativePath = typeof (file as File & { webkitRelativePath?: string }).webkitRelativePath === 'string'
    ? String((file as File & { webkitRelativePath?: string }).webkitRelativePath || '').trim()
    : '';

  return webkitRelativePath || file.name;
};

type UploadQueueStatus = 'pending' | 'uploading' | 'completed' | 'failed';

type UploadQueueItem = {
  id: string;
  file: File;
  fileName: string;
  fileSize: number;
  relativePath: string;
  folderId: string;
  folderLabel: string;
  clientId: string | null;
  status: UploadQueueStatus;
  progress: number;
  error: string | null;
};

const isTextPreviewFile = (mime?: string | null, name?: string) => {
  const lower = String(name || '').toLowerCase();
  return Boolean(
    mime?.startsWith('text/')
    || mime === 'application/json'
    || mime === 'application/xml'
    || lower.endsWith('.txt')
    || lower.endsWith('.json')
    || lower.endsWith('.md')
    || lower.endsWith('.csv')
    || lower.endsWith('.log')
  );
};

const formatFileSize = (value: number) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getAutoUploadFolderName = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `Upload ${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
};

const formatArchiveDeletionLabel = (value?: string | null) => {
  if (!value) return 'Sem exclusão automática';
  const targetDate = new Date(value);
  if (Number.isNaN(targetDate.getTime())) return value;
  const diffMs = targetDate.getTime() - Date.now();
  const diffDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  return `${formatDateTime(value)} (${diffDays} dia(s))`;
};

const getFileTypeLabel = (file: CloudFile) => {
  if (isPdfFile(file.mime_type, file.original_name)) return 'PDF';
  if (isImageFile(file.mime_type)) return 'Imagem';
  if (isVideoFile(file.mime_type, file.original_name)) return 'Vídeo';
  if (isWordFile(file.mime_type, file.original_name)) return 'Documento Word';
  return file.extension?.toUpperCase() || 'Arquivo';
};

const normalizeRotation = (rotation: number) => (((rotation % 360) + 360) % 360);

type FolderLabelConfig = {
  id: string;
  name: string;
  color: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
};

const DEFAULT_FOLDER_LABELS: FolderLabelConfig[] = [
  {
    id: 'pendente',
    name: 'Pendente',
    color: '#f59e0b',
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-700',
    borderClass: 'border-amber-200',
  },
  {
    id: 'concluido',
    name: 'Concluído',
    color: '#10b981',
    bgClass: 'bg-emerald-50',
    textClass: 'text-emerald-700',
    borderClass: 'border-emerald-200',
  },
];

const CLOUD_FOLDER_LABELS_STORAGE_KEY = 'cloud-folder-labels-v1';
const CLOUD_FOLDER_LABEL_ASSIGNMENTS_STORAGE_KEY = 'cloud-folder-label-assignments-v1';
const CLOUD_VIEW_MODE_STORAGE_KEY = 'cloud-view-mode-v1';
const CLOUD_FAVORITE_FOLDER_IDS_STORAGE_KEY = 'cloud-favorite-folder-ids-v1';
const CLOUD_FAVORITE_FILE_IDS_STORAGE_KEY = 'cloud-favorite-file-ids-v1';
const CLOUD_RECENT_FILE_IDS_STORAGE_KEY = 'cloud-recent-file-ids-v1';
const CLOUD_CARD_SIZE_STORAGE_KEY = 'cloud-card-size-v1';
const CLOUD_ARCHIVED_FOLDER_ID = '__cloud_archived__';
const CLOUD_TRASH_FOLDER_ID = '__cloud_trash__';

type CloudSearchFilters = {
  extension: string;
  clientId: string;
  labelId: string;
  dateFrom: string;
  dateTo: string;
  sizeMinKb: string;
  sizeMaxKb: string;
};

const EMPTY_CLOUD_SEARCH_FILTERS: CloudSearchFilters = {
  extension: '',
  clientId: '',
  labelId: '',
  dateFrom: '',
  dateTo: '',
  sizeMinKb: '',
  sizeMaxKb: '',
};

const normalizeLabelId = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

const getRandomImageFileName = (extension = 'png') => `print_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}.${extension}`;
const getRandomPdfFileName = () => `print_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}.pdf`;

const splitFileNameAndExtension = (fileName: string) => {
  const trimmed = String(fileName || '').trim();
  const match = trimmed.match(/^(.*?)(\.[^./\\]+)$/);
  if (!match) {
    return { baseName: trimmed, extension: '' };
  }

  const [, rawBaseName, extension] = match;
  return {
    baseName: rawBaseName || trimmed,
    extension,
  };
};

const getInitialCloudViewMode = (): CloudViewMode => {
  if (typeof window === 'undefined') return 'list';
  const stored = window.localStorage.getItem(CLOUD_VIEW_MODE_STORAGE_KEY);
  return stored === 'cards' ? 'cards' : 'list';
};

const getInitialCloudCardSize = (): CloudCardSize => {
  if (typeof window === 'undefined') return 'medium';
  const stored = window.localStorage.getItem(CLOUD_CARD_SIZE_STORAGE_KEY);
  return stored === 'small' || stored === 'large' ? stored : 'medium';
};

const getEventTargetElement = (target: EventTarget | null): Element | null => {
  if (!target) return null;
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
};

interface CloudModuleProps {
  onNavigateToModule?: (moduleKey: string, params?: Record<string, any>) => void;
}

type CloudViewMode = 'list' | 'cards';
type PdfToolMode = 'home' | 'organize' | 'rotate' | 'remove';
type CloudHeaderActionDetail = {
  action: 'upload' | 'create-folder' | 'toggle-filters' | 'set-view-mode' | 'set-card-size';
  value?: 'list' | 'cards' | 'small' | 'medium' | 'large';
};
type CloudHeaderStateDetail = {
  viewMode: 'list' | 'cards';
  cardSize: 'small' | 'medium' | 'large';
  showFilters: boolean;
};

const SortablePdfPageCard: React.FC<{
  id: string;
  children: React.ReactNode;
}> = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'z-10 opacity-70 scale-[0.98]' : ''}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
};

const CloudModule: React.FC<CloudModuleProps> = ({ onNavigateToModule }) => {
  const toast = useToastContext();
  const editorRef = useRef<SyncfusionEditorRef | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cloudCenterDropRef = useRef<HTMLElement | null>(null);
  const explorerViewportRef = useRef<HTMLDivElement | null>(null);
  const itemElementMapRef = useRef<Record<string, HTMLDivElement | null>>({});
  const [clients, setClients] = useState<Client[]>([]);
  const [allFolders, setAllFolders] = useState<CloudFolder[]>([]);
  const [allFiles, setAllFiles] = useState<CloudFile[]>([]);
  const [folders, setFolders] = useState<CloudFolder[]>([]);
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderClientId, setFolderClientId] = useState('');
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [selectedFileToMove, setSelectedFileToMove] = useState<CloudFile | null>(null);
  const [targetFolderId, setTargetFolderId] = useState('');
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [sharePassword, setSharePassword] = useState('');
  const [shareExpiresAt, setShareExpiresAt] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [activeShare, setActiveShare] = useState<CloudFolderShare | null>(null);
  const [selectedFolderForShare, setSelectedFolderForShare] = useState<CloudFolder | null>(null);
  const [previewFile, setPreviewFile] = useState<CloudFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [detailPreviewUrl, setDetailPreviewUrl] = useState<string | null>(null);
  const [detailPreviewText, setDetailPreviewText] = useState<string | null>(null);
  const [detailPreviewLoading, setDetailPreviewLoading] = useState(false);
  const [cardPreviewUrls, setCardPreviewUrls] = useState<Record<string, string>>({});
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([]);
  const [selectionAnchorKey, setSelectionAnchorKey] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CloudViewMode>(getInitialCloudViewMode);
  const [cardSize, setCardSize] = useState<CloudCardSize>(getInitialCloudCardSize);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [folderLabels, setFolderLabels] = useState<FolderLabelConfig[]>(DEFAULT_FOLDER_LABELS);
  const [folderLabelAssignments, setFolderLabelAssignments] = useState<Record<string, string>>({});
  const [selectedFolderLabelId, setSelectedFolderLabelId] = useState('pendente');
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#f97316');
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const [selectedImageFileIds, setSelectedImageFileIds] = useState<string[]>([]);
  const [imagePdfModalOpen, setImagePdfModalOpen] = useState(false);
  const [imagePdfName, setImagePdfName] = useState('imagens-convertidas');
  const [imagePdfItems, setImagePdfItems] = useState<CloudFile[]>([]);
  const [imagePdfPreviewUrls, setImagePdfPreviewUrls] = useState<Record<string, string>>({});
  const [draggingImagePdfId, setDraggingImagePdfId] = useState<string | null>(null);
  const [convertingImagesToPdf, setConvertingImagesToPdf] = useState(false);
  const [pdfToolsModalOpen, setPdfToolsModalOpen] = useState(false);
  const [selectedPdfToolFile, setSelectedPdfToolFile] = useState<CloudFile | null>(null);
  const [pdfToolPreviewUrl, setPdfToolPreviewUrl] = useState<string | null>(null);
  const [pdfToolPages, setPdfToolPages] = useState<Array<{ sourceIndex: number; rotation: number }>>([]);
  const [pdfToolDocumentReady, setPdfToolDocumentReady] = useState(false);
  const [selectedPdfPageIndexes, setSelectedPdfPageIndexes] = useState<number[]>([]);
  const [pdfToolSaving, setPdfToolSaving] = useState(false);
  const [pdfToolSaveAsCopy, setPdfToolSaveAsCopy] = useState(false);
  const [pdfToolMode, setPdfToolMode] = useState<PdfToolMode>('home');
  const [quickActionFileId, setQuickActionFileId] = useState<string | null>(null);
  const [downloadingFolderId, setDownloadingFolderId] = useState<string | null>(null);
  const [wordToPdfFileId, setWordToPdfFileId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | { x: number; y: number; type: 'folder'; folderId: string }
    | { x: number; y: number; type: 'file'; fileId: string }
    | { x: number; y: number; type: 'blank' }
    | null
  >(null);
  const [draggingItemKey, setDraggingItemKey] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ type: 'file' | 'folder'; id: string; currentName: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [uploadQueueItems, setUploadQueueItems] = useState<UploadQueueItem[]>([]);
  const uploadQueueItemsRef = useRef<UploadQueueItem[]>([]);
  const [archivedFiles, setArchivedFiles] = useState<CloudFile[]>([]);
  const [trashedFiles, setTrashedFiles] = useState<CloudFile[]>([]);
  const [trashedFolders, setTrashedFolders] = useState<CloudFolder[]>([]);
  const [favoriteFolderIds, setFavoriteFolderIds] = useState<string[]>([]);
  const [favoriteFileIds, setFavoriteFileIds] = useState<string[]>([]);
  const [recentFileIds, setRecentFileIds] = useState<string[]>([]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [searchFilters, setSearchFilters] = useState<CloudSearchFilters>(EMPTY_CLOUD_SEARCH_FILTERS);
  const [bulkRenameModalOpen, setBulkRenameModalOpen] = useState(false);
  const [bulkRenamePrefix, setBulkRenamePrefix] = useState('');
  const [bulkRenameSuffix, setBulkRenameSuffix] = useState('');
  const [bulkRenameSearch, setBulkRenameSearch] = useState('');
  const [bulkRenameReplace, setBulkRenameReplace] = useState('');
  const [bulkMoveModalOpen, setBulkMoveModalOpen] = useState(false);
  const [bulkMoveTargetFolderId, setBulkMoveTargetFolderId] = useState('');
  const [clipboardSelection, setClipboardSelection] = useState<{ mode: 'copy' | 'cut'; itemKeys: string[] } | null>(null);
  const [pastingClipboard, setPastingClipboard] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [inlineRenameTarget, setInlineRenameTarget] = useState<{ type: 'file' | 'folder'; id: string; currentName: string } | null>(null);
  const [inlineRenameValue, setInlineRenameValue] = useState('');
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [dragVisualState, setDragVisualState] = useState<{ folderId: string | null; mode: 'move' | 'copy' | 'cut' | null } | null>(null);
  const [deleteModalState, setDeleteModalState] = useState<{
    open: boolean;
    title: string;
    kind: 'file' | 'folder';
    stage: 'processing' | 'success' | 'error';
    error: string | null;
  }>({
    open: false,
    title: '',
    kind: 'file',
    stage: 'processing',
    error: null,
  });
  const uploadModalAutoCloseRef = useRef<number | null>(null);
  const deleteModalAutoCloseRef = useRef<number | null>(null);
  const detailsDrawerAutoOpenRef = useRef<number | null>(null);

  useEffect(() => {
    uploadQueueItemsRef.current = uploadQueueItems;
  }, [uploadQueueItems]);

  useEffect(() => {
    return () => {
      if (uploadModalAutoCloseRef.current) {
        window.clearTimeout(uploadModalAutoCloseRef.current);
        uploadModalAutoCloseRef.current = null;
      }
      if (deleteModalAutoCloseRef.current) {
        window.clearTimeout(deleteModalAutoCloseRef.current);
        deleteModalAutoCloseRef.current = null;
      }
      if (detailsDrawerAutoOpenRef.current) {
        window.clearTimeout(detailsDrawerAutoOpenRef.current);
        detailsDrawerAutoOpenRef.current = null;
      }
    };
  }, []);

  const cardGridMinWidth = useMemo(() => {
    if (cardSize === 'small') return 250;
    if (cardSize === 'large') return 340;
    return 300;
  }, [cardSize]);

  const cardPreviewHeightClass = useMemo(() => {
    if (cardSize === 'small') return 'h-28';
    if (cardSize === 'large') return 'h-44';
    return 'h-36';
  }, [cardSize]);

  const folderCardSizeClasses = useMemo(() => {
    if (cardSize === 'small') {
      return {
        cardClass: 'px-3 py-2.5 min-h-[82px]',
        contentGapClass: 'gap-2.5',
        iconWrapperClass: 'h-9 w-11',
        iconTopTabClass: 'left-1 top-0.5 h-2.5 w-5',
        iconBodyClass: 'top-2.5 h-6',
        iconBadgeClass: 'right-1 top-3 h-2.5 w-3',
        folderIconClass: 'left-2.5 top-3.5 w-4 h-4',
        titlePaddingClass: 'pt-0.5',
      };
    }

    if (cardSize === 'large') {
      return {
        cardClass: 'px-4 py-3.5 min-h-[108px]',
        contentGapClass: 'gap-3.5',
        iconWrapperClass: 'h-12 w-16',
        iconTopTabClass: 'left-2 top-1 h-3.5 w-6.5',
        iconBodyClass: 'top-3.5 h-7.5',
        iconBadgeClass: 'right-2 top-4 h-3.5 w-4',
        folderIconClass: 'left-4 top-4.5 w-5.5 h-5.5',
        titlePaddingClass: 'pt-1.5',
      };
    }

    return {
      cardClass: 'px-3.5 py-3 min-h-[92px]',
      contentGapClass: 'gap-3',
      iconWrapperClass: 'h-11 w-14',
      iconTopTabClass: 'left-1.5 top-1 h-3 w-6',
      iconBodyClass: 'top-3 h-7',
      iconBadgeClass: 'right-1.5 top-3.5 h-3 w-3.5',
      folderIconClass: 'left-3.5 top-4 w-5 h-5',
      titlePaddingClass: 'pt-1',
    };
  }, [cardSize]);

  const hasActiveAdvancedFilters = useMemo(() => {
    return Boolean(
      searchFilters.extension
      || searchFilters.clientId
      || searchFilters.labelId
      || searchFilters.dateFrom
      || searchFilters.dateTo
      || searchFilters.sizeMinKb
      || searchFilters.sizeMaxKb,
    );
  }, [searchFilters]);

  const hasGlobalSearch = useMemo(() => Boolean(searchTerm.trim() || hasActiveAdvancedFilters), [hasActiveAdvancedFilters, searchTerm]);
  const isArchivedView = currentFolderId === CLOUD_ARCHIVED_FOLDER_ID;
  const isTrashView = currentFolderId === CLOUD_TRASH_FOLDER_ID;

  const currentFolder = useMemo(
    () => (currentFolderId && currentFolderId !== CLOUD_TRASH_FOLDER_ID && currentFolderId !== CLOUD_ARCHIVED_FOLDER_ID ? allFolders.find((item) => item.id === currentFolderId) ?? null : null),
    [allFolders, currentFolderId],
  );
  const currentFolderArchived = currentFolder?.archived_at != null;

  const folderChildrenMap = useMemo(() => {
    const map = new Map<string | null, CloudFolder[]>();
    for (const folder of allFolders) {
      const key = folder.parent_id ?? null;
      const current = map.get(key) ?? [];
      current.push(folder);
      map.set(key, current);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    }
    return map;
  }, [allFolders]);

  const inboxFolders = useMemo(
    () => allFolders.filter((item) => !item.archived_at && !item.delete_scheduled_for),
    [allFolders],
  );

  const inboxFolderChildrenMap = useMemo(() => {
    const map = new Map<string | null, CloudFolder[]>();
    for (const folder of inboxFolders) {
      const key = folder.parent_id ?? null;
      const current = map.get(key) ?? [];
      current.push(folder);
      map.set(key, current);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    }
    return map;
  }, [inboxFolders]);

  const breadcrumb = useMemo(() => {
    if (isArchivedView) {
      return [{ id: CLOUD_ARCHIVED_FOLDER_ID, name: 'Arquivado' } as CloudFolder];
    }
    if (isTrashView) {
      return [{ id: CLOUD_TRASH_FOLDER_ID, name: 'Lixeira' } as CloudFolder];
    }
    const items: CloudFolder[] = [];
    let cursor = currentFolder;
    while (cursor) {
      items.unshift(cursor);
      cursor = cursor.parent_id ? allFolders.find((item) => item.id === cursor?.parent_id) ?? null : null;
    }
    return items;
  }, [allFolders, currentFolder, isArchivedView, isTrashView]);

  const rootFolders = useMemo(() => inboxFolderChildrenMap.get(null) ?? [], [inboxFolderChildrenMap]);

  const folderSizeMap = useMemo(() => {
    const cache = new Map<string, number>();

    const getFolderSize = (folderId: string): number => {
      if (cache.has(folderId)) return cache.get(folderId) ?? 0;

      const directFilesSize = allFiles
        .filter((file) => file.folder_id === folderId)
        .reduce((total, file) => total + (file.file_size || 0), 0);

      const childFolders = folderChildrenMap.get(folderId) ?? [];
      const nestedSize = childFolders.reduce((total, child) => total + getFolderSize(child.id), 0);
      const size = directFilesSize + nestedSize;

      cache.set(folderId, size);
      return size;
    };

    for (const folder of allFolders) {
      getFolderSize(folder.id);
    }

    return cache;
  }, [allFiles, allFolders, folderChildrenMap]);

  const quickAccessFolders = useMemo(() => {
    return [...allFolders]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 6);
  }, [allFolders]);

  const favoriteFolders = useMemo(() => {
    return favoriteFolderIds
      .map((folderId) => allFolders.find((folder) => folder.id === folderId) ?? null)
      .filter((folder): folder is CloudFolder => Boolean(folder));
  }, [allFolders, favoriteFolderIds]);

  const favoriteFiles = useMemo(() => {
    return favoriteFileIds
      .map((fileId) => allFiles.find((file) => file.id === fileId) ?? null)
      .filter((file): file is CloudFile => Boolean(file));
  }, [allFiles, favoriteFileIds]);

  const recentFiles = useMemo(() => {
    return recentFileIds
      .map((fileId) => allFiles.find((file) => file.id === fileId) ?? null)
      .filter((file): file is CloudFile => Boolean(file));
  }, [allFiles, recentFileIds]);

  const currentClient = useMemo(
    () => (isTrashView || isArchivedView ? null : clients.find((item) => item.id === currentFolder?.client_id) ?? null),
    [clients, currentFolder, isArchivedView, isTrashView],
  );

  const selectedFile = useMemo(() => {
    if (!selectedItemKey?.startsWith('file:')) return null;
    const fileId = selectedItemKey.replace('file:', '');
    return files.find((item) => item.id === fileId) ?? null;
  }, [files, selectedItemKey]);

  const selectedFolder = useMemo(() => {
    if (!selectedItemKey?.startsWith('folder:')) return null;
    const folderId = selectedItemKey.replace('folder:', '');
    return folders.find((item) => item.id === folderId) ?? allFolders.find((item) => item.id === folderId) ?? null;
  }, [allFolders, folders, selectedItemKey]);

  const clearExplorerSelection = useCallback(() => {
    if (detailsDrawerAutoOpenRef.current) {
      window.clearTimeout(detailsDrawerAutoOpenRef.current);
      detailsDrawerAutoOpenRef.current = null;
    }
    setSelectedItemKey(null);
    setSelectedItemKeys([]);
    setSelectionAnchorKey(null);
    setContextMenu(null);
    setInlineRenameTarget(null);
    setInlineRenameValue('');
  }, []);

  const cancelDetailsDrawerAutoOpen = useCallback(() => {
    if (detailsDrawerAutoOpenRef.current) {
      window.clearTimeout(detailsDrawerAutoOpenRef.current);
      detailsDrawerAutoOpenRef.current = null;
    }
  }, []);

  const selectedFileKeys = useMemo(
    () => selectedItemKeys.filter((key) => key.startsWith('file:')),
    [selectedItemKeys],
  );

  const selectedFolderKeys = useMemo(
    () => selectedItemKeys.filter((key) => key.startsWith('folder:')),
    [selectedItemKeys],
  );

  const selectedImageFiles = useMemo(
    () => files.filter((item) => selectedFileKeys.includes(`file:${item.id}`) && isImageFile(item.mime_type)),
    [files, selectedFileKeys],
  );

  const selectedPdfFiles = useMemo(
    () => files.filter((item) => selectedFileKeys.includes(`file:${item.id}`) && isPdfFile(item.mime_type, item.original_name)),
    [files, selectedFileKeys],
  );

  const selectedClient = useMemo(() => {
    const clientId = selectedFile?.client_id || selectedFolder?.client_id || null;
    return clients.find((item) => item.id === clientId) ?? null;
  }, [clients, selectedFile, selectedFolder]);

  const headerClient = useMemo(() => selectedClient ?? currentClient, [currentClient, selectedClient]);

  useEffect(() => {
    cancelDetailsDrawerAutoOpen();
    if (!selectedFile && !selectedFolder) {
      setDetailsDrawerOpen(false);
    }
  }, [cancelDetailsDrawerAutoOpen, selectedFile, selectedFolder]);

  const uploadQueueSummary = useMemo(() => {
    const totalItems = uploadQueueItems.length;
    const completedItems = uploadQueueItems.filter((item) => item.status === 'completed').length;
    const failedItems = uploadQueueItems.filter((item) => item.status === 'failed').length;
    const uploadingItems = uploadQueueItems.filter((item) => item.status === 'uploading').length;
    const totalProgress = totalItems === 0
      ? 0
      : Math.round(uploadQueueItems.reduce((sum, item) => sum + item.progress, 0) / totalItems);

    return {
      totalItems,
      completedItems,
      failedItems,
      uploadingItems,
      totalProgress,
    };
  }, [uploadQueueItems]);

  const archivedFolders = useMemo(
    () => allFolders.filter((item) => Boolean(item.archived_at) && !item.delete_scheduled_for).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [allFolders],
  );

  const archivedRootFolders = useMemo(() => {
    const archivedFolderIds = new Set(archivedFolders.map((item) => item.id));
    return archivedFolders.filter((item) => !item.parent_id || !archivedFolderIds.has(item.parent_id));
  }, [archivedFolders]);

  const archivedRootFiles = useMemo(() => {
    const archivedFolderIds = new Set(archivedFolders.map((item) => item.id));
    return archivedFiles.filter((item) => !archivedFolderIds.has(item.folder_id));
  }, [archivedFiles, archivedFolders]);

  const trashedRootFolders = useMemo(() => {
    const trashedFolderIds = new Set(trashedFolders.map((item) => item.id));
    return trashedFolders.filter((item) => {
      if (!item.parent_id) return true;
      return !trashedFolderIds.has(item.parent_id);
    });
  }, [trashedFolders]);

  const trashedRootFiles = useMemo(() => {
    const trashedFolderIds = new Set(trashedFolders.map((item) => item.id));
    return trashedFiles.filter((item) => {
      if (!item.folder_id) return true;
      return !trashedFolderIds.has(item.folder_id);
    });
  }, [trashedFiles, trashedFolders]);

  const breadcrumbLabel = useMemo(() => {
    if (isArchivedView) return 'Cloud / Arquivado';
    if (isTrashView) return 'Cloud / Lixeira';
    if (breadcrumb.length === 0) return 'Cloud / Raiz';
    return `Cloud / ${breadcrumb.map((item) => item.name).join(' / ')}`;
  }, [breadcrumb, isArchivedView, isTrashView]);

  const getFolderLabel = useCallback(
    (folderId: string) => {
      const assignedId = folderLabelAssignments[folderId] || 'pendente';
      return folderLabels.find((item) => item.id === assignedId) ?? DEFAULT_FOLDER_LABELS[0];
    },
    [folderLabelAssignments, folderLabels],
  );

  const loadData = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading ?? false;
    try {
      if (showLoading) {
        setLoading(true);
      }
      const viewingArchivedFolder = currentFolderArchived;
      const archivedAllFiles = await cloudService.listAllFiles(true);
      const [foldersData, filesData, allFoldersData, allFilesData, clientsData, archivedFilesData, trashedFoldersData, trashedFilesData] = await Promise.all([
        isTrashView || isArchivedView ? Promise.resolve([]) : cloudService.listFolders(currentFolderId, viewingArchivedFolder),
        isTrashView || isArchivedView ? Promise.resolve([]) : currentFolderId ? cloudService.listFiles(currentFolderId) : Promise.resolve([]),
        cloudService.listAllFolders(true),
        Promise.resolve(archivedAllFiles),
        clientService.listClients(),
        cloudService.listArchivedFiles(),
        cloudService.listTrashedFolders(),
        cloudService.listTrashedFiles(),
      ]);
      setAllFolders(allFoldersData);
      setAllFiles(allFilesData);
      setClients(clientsData);
      setArchivedFiles(archivedFilesData);
      setTrashedFolders(trashedFoldersData);
      setTrashedFiles(trashedFilesData);
      if (isTrashView) {
        const trashedFolderIds = new Set(trashedFoldersData.map((item) => item.id));
        setFolders(trashedFoldersData.filter((item) => {
          if (!item.parent_id) return true;
          return !trashedFolderIds.has(item.parent_id);
        }));
        setFiles(trashedFilesData.filter((item) => {
          if (!item.folder_id) return true;
          return !trashedFolderIds.has(item.folder_id);
        }));
      } else if (isArchivedView) {
        const archivedFoldersData = allFoldersData.filter((item) => Boolean(item.archived_at) && !item.delete_scheduled_for).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        const archivedFolderIds = new Set(archivedFoldersData.map((item) => item.id));
        const archivedVisibleFiles = archivedAllFiles.filter((item) => Boolean(item.archived_at) && !item.delete_scheduled_for).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        setFolders(archivedFoldersData.filter((item) => !item.parent_id || !archivedFolderIds.has(item.parent_id)));
        setFiles(archivedVisibleFiles.filter((item) => !archivedFolderIds.has(item.folder_id)));
      } else {
        setFolders(foldersData);
        setFiles(filesData);
      }
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao carregar arquivos.');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [currentFolderArchived, currentFolderId, isArchivedView, isTrashView, toast]);

  useEffect(() => {
    void loadData({ showLoading: true });
  }, [currentFolderArchived, currentFolderId, isArchivedView, isTrashView]);

  const movePdfToolPage = (index: number, direction: -1 | 1) => {
    setPdfToolPages((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });

    setSelectedPdfPageIndexes((prev) => prev.map((item) => {
      if (item === index) return index + direction;
      if (direction === -1 && item === index - 1) return index;
      if (direction === 1 && item === index + 1) return index;
      return item;
    }));
  };

  const pdfToolPageIds = useMemo(
    () => pdfToolPages.map((page, index) => `${page.sourceIndex}-${index}`),
    [pdfToolPages],
  );

  const pdfToolSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handlePdfToolDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = pdfToolPageIds.indexOf(String(active.id));
    const newIndex = pdfToolPageIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    setPdfToolPages((prev) => arrayMove(prev, oldIndex, newIndex));
    setSelectedPdfPageIndexes((prev) => prev.map((index) => {
      if (index === oldIndex) return newIndex;
      if (oldIndex < newIndex && index > oldIndex && index <= newIndex) return index - 1;
      if (oldIndex > newIndex && index < oldIndex && index >= newIndex) return index + 1;
      return index;
    }));
  };

  const rotateSinglePdfPage = (pageIndex: number, delta: number) => {
    setPdfToolPages((prev) => prev.map((page, index) => (
      index === pageIndex
        ? { ...page, rotation: (((page.rotation + delta) % 360) + 360) % 360 }
        : page
    )));
  };

  useEffect(() => {
    const scheduleRefresh = () => {
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }

      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        void loadData({ showLoading: false });
      }, 200);
    };

    const channel = supabase
      .channel('cloud-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cloud_folders' },
        () => {
          scheduleRefresh();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cloud_files' },
        () => {
          scheduleRefresh();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cloud_folder_shares' },
        () => {
          scheduleRefresh();
        },
      )
      .subscribe();

    const unsubscribeCloudChanged = events.on(SYSTEM_EVENTS.CLOUD_CHANGED, () => {
      scheduleRefresh();
    });

    return () => {
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
      unsubscribeCloudChanged();
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  useEffect(() => {
    if (!previewFile) {
      setPreviewUrl(null);
      return;
    }

    let revokedUrl: string | null = null;
    const loadPreview = async () => {
      try {
        setPreviewLoading(true);
        const signedUrl = await cloudService.getFileSignedUrl(previewFile.storage_path);
        if (isDocxFile(previewFile.mime_type, previewFile.original_name)) {
          const response = await fetch(signedUrl);
          const buffer = await response.arrayBuffer();
          await editorRef.current?.loadDocxViaImport(buffer, previewFile.original_name);
          setPreviewUrl(null);
        } else if (isWordFile(previewFile.mime_type, previewFile.original_name)) {
          await handleOpenDocxEditor(previewFile);
        } else {
          setPreviewUrl(signedUrl);
          revokedUrl = signedUrl.startsWith('blob:') ? signedUrl : null;
        }
      } catch (error: any) {
        toast.error('Preview', error.message || 'Erro ao abrir arquivo.');
      } finally {
        setPreviewLoading(false);
      }
    };

    loadPreview();

    return () => {
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [previewFile, toast]);

  useEffect(() => {
    if (!previewFile) return;
    if (wordToPdfFileId) return;
    const nextPreviewFile = allFiles.find((item) => item.id === previewFile.id) ?? files.find((item) => item.id === previewFile.id) ?? null;
    if (!nextPreviewFile) {
      setPreviewFile(null);
      setPreviewUrl(null);
      return;
    }
    if (nextPreviewFile.original_name !== previewFile.original_name || nextPreviewFile.storage_path !== previewFile.storage_path || nextPreviewFile.updated_at !== previewFile.updated_at) {
      setPreviewFile(nextPreviewFile);
      setPreviewUrl(null);
    }
  }, [allFiles, files, previewFile, wordToPdfFileId]);

  useEffect(() => {
    if (!selectedFile || isWordFile(selectedFile.mime_type, selectedFile.original_name)) {
      setDetailPreviewUrl(null);
      setDetailPreviewText(null);
      setDetailPreviewLoading(false);
      return;
    }

    let cancelled = false;

    const loadDetailPreview = async () => {
      try {
        setDetailPreviewLoading(true);
        const signedUrl = await cloudService.getFileSignedUrl(selectedFile.storage_path);
        if (cancelled) return;

        if (isImageFile(selectedFile.mime_type) || isPdfFile(selectedFile.mime_type, selectedFile.original_name) || isVideoFile(selectedFile.mime_type, selectedFile.original_name)) {
          setDetailPreviewUrl(signedUrl);
          setDetailPreviewText(null);
          return;
        }

        if (isTextPreviewFile(selectedFile.mime_type, selectedFile.original_name)) {
          const response = await fetch(signedUrl);
          const text = response.ok ? await response.text() : '';
          if (cancelled) return;
          setDetailPreviewUrl(null);
          setDetailPreviewText(text.slice(0, 4000));
          return;
        }

        setDetailPreviewUrl(null);
        setDetailPreviewText(null);
      } catch {
        if (!cancelled) {
          setDetailPreviewUrl(null);
          setDetailPreviewText(null);
        }
      } finally {
        if (!cancelled) {
          setDetailPreviewLoading(false);
        }
      }
    };

    void loadDetailPreview();

    return () => {
      cancelled = true;
    };
  }, [selectedFile]);

  useEffect(() => {
    if (currentFolderId) {
      setExpandedFolders((prev) => ({ ...prev, [currentFolderId]: true }));
    }
  }, [currentFolderId]);

  useEffect(() => {
    setSelectedItemKeys((prev) => prev.filter((key) => {
      if (key.startsWith('file:')) {
        const fileId = key.replace('file:', '');
        return files.some((item) => item.id === fileId);
      }
      if (key.startsWith('folder:')) {
        const folderId = key.replace('folder:', '');
        return folders.some((item) => item.id === folderId) || allFolders.some((item) => item.id === folderId);
      }
      return false;
    }));
  }, [files]);

  useEffect(() => {
    setSelectedImageFileIds([]);
    setSelectedItemKeys([]);
    setSelectedItemKey(null);
    setSelectionAnchorKey(null);
  }, [currentFolderId]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, []);

  useEffect(() => {
    try {
      const storedLabels = window.localStorage.getItem(CLOUD_FOLDER_LABELS_STORAGE_KEY);
      const storedAssignments = window.localStorage.getItem(CLOUD_FOLDER_LABEL_ASSIGNMENTS_STORAGE_KEY);
      if (storedLabels) {
        const parsedLabels = JSON.parse(storedLabels);
        if (Array.isArray(parsedLabels) && parsedLabels.length > 0) {
          setFolderLabels(parsedLabels);
        }
      }

      if (storedAssignments) {
        const parsedAssignments = JSON.parse(storedAssignments);
        if (parsedAssignments && typeof parsedAssignments === 'object') {
          setFolderLabelAssignments(parsedAssignments);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CLOUD_FOLDER_LABELS_STORAGE_KEY, JSON.stringify(folderLabels));
  }, [folderLabels]);

  useEffect(() => {
    window.localStorage.setItem(CLOUD_FOLDER_LABEL_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(folderLabelAssignments));
  }, [folderLabelAssignments]);

  useEffect(() => {
    window.localStorage.setItem(CLOUD_VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    window.localStorage.setItem(CLOUD_CARD_SIZE_STORAGE_KEY, cardSize);
  }, [cardSize]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent<CloudHeaderStateDetail>('cloud-header-state', {
      detail: {
        viewMode,
        cardSize,
        showFilters: showAdvancedFilters,
      },
    }));
  }, [viewMode, cardSize, showAdvancedFilters]);

  useEffect(() => {
    const handleCloudHeaderAction = (event: Event) => {
      const detail = (event as CustomEvent<CloudHeaderActionDetail>).detail;
      if (!detail) return;

      if (detail.action === 'upload') {
        fileInputRef.current?.click();
        return;
      }

      if (detail.action === 'create-folder') {
        setFolderName('');
        setFolderClientId(currentFolder?.client_id || '');
        setSelectedFolderLabelId('pendente');
        setNewLabelName('');
        setNewLabelColor('#f97316');
        setFolderModalOpen(true);
        return;
      }

      if (detail.action === 'toggle-filters') {
        setShowAdvancedFilters((prev) => !prev);
        return;
      }

      if (detail.action === 'set-view-mode' && (detail.value === 'list' || detail.value === 'cards')) {
        setViewMode(detail.value);
        return;
      }

      if (detail.action === 'set-card-size' && (detail.value === 'small' || detail.value === 'medium' || detail.value === 'large')) {
        setCardSize(detail.value);
      }
    };

    window.addEventListener('cloud-header-action', handleCloudHeaderAction as EventListener);
    return () => window.removeEventListener('cloud-header-action', handleCloudHeaderAction as EventListener);
  }, [currentFolder?.client_id]);

  useEffect(() => {
    try {
      const storedFavorites = window.localStorage.getItem(CLOUD_FAVORITE_FOLDER_IDS_STORAGE_KEY);
      if (!storedFavorites) return;
      const parsedFavorites = JSON.parse(storedFavorites);
      if (Array.isArray(parsedFavorites)) {
        setFavoriteFolderIds(parsedFavorites.filter((item): item is string => typeof item === 'string'));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CLOUD_FAVORITE_FOLDER_IDS_STORAGE_KEY, JSON.stringify(favoriteFolderIds));
  }, [favoriteFolderIds]);

  useEffect(() => {
    try {
      const storedFavoriteFiles = window.localStorage.getItem(CLOUD_FAVORITE_FILE_IDS_STORAGE_KEY);
      if (!storedFavoriteFiles) return;
      const parsedFavoriteFiles = JSON.parse(storedFavoriteFiles);
      if (Array.isArray(parsedFavoriteFiles)) {
        setFavoriteFileIds(parsedFavoriteFiles.filter((item): item is string => typeof item === 'string'));
      }
    } catch {
      setFavoriteFileIds([]);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CLOUD_FAVORITE_FILE_IDS_STORAGE_KEY, JSON.stringify(favoriteFileIds));
  }, [favoriteFileIds]);

  useEffect(() => {
    try {
      const storedRecentFiles = window.localStorage.getItem(CLOUD_RECENT_FILE_IDS_STORAGE_KEY);
      if (!storedRecentFiles) return;
      const parsedRecentFiles = JSON.parse(storedRecentFiles);
      if (Array.isArray(parsedRecentFiles)) {
        setRecentFileIds(parsedRecentFiles.filter((item): item is string => typeof item === 'string'));
      }
    } catch {
      setRecentFileIds([]);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CLOUD_RECENT_FILE_IDS_STORAGE_KEY, JSON.stringify(recentFileIds));
  }, [recentFileIds]);

  useEffect(() => {
    if (viewMode !== 'cards') return;

    const term = searchTerm.trim().toLowerCase();
    const previewFiles = (hasGlobalSearch ? allFiles : files)
      .filter((file) => !term || file.original_name.toLowerCase().includes(term))
      .filter((file) => isImageFile(file.mime_type) || isPdfFile(file.mime_type, file.original_name));
    if (previewFiles.length === 0) {
      setCardPreviewUrls({});
      return;
    }

    let cancelled = false;
    const previewFileIds = new Set(previewFiles.map((file) => file.id));

    setCardPreviewUrls((prev) => Object.fromEntries(Object.entries(prev).filter(([fileId]) => previewFileIds.has(fileId))));

    const loadCardPreviews = async () => {
      try {
        const entries = await Promise.all(
          previewFiles.map(async (file) => [file.id, await cloudService.getFileSignedUrl(file.storage_path)] as const),
        );

        if (cancelled) return;
        setCardPreviewUrls((prev) => ({
          ...prev,
          ...Object.fromEntries(entries),
        }));
      } catch {
        if (!cancelled) {
          setCardPreviewUrls((prev) => prev);
        }
      }
    };

    void loadCardPreviews();

    return () => {
      cancelled = true;
    };
  }, [allFiles, files, hasGlobalSearch, searchTerm, viewMode]);

  const filteredFolders = useMemo(() => {
    const sourceFolders = hasGlobalSearch
      ? allFolders.filter((item) => !item.archived_at)
      : isArchivedView
        ? folders.filter((item) => {
            if (!item.archived_at) return false;
            if (!item.parent_id) return true;
            const parentFolder = allFolders.find((folder) => folder.id === item.parent_id) ?? null;
            return !parentFolder?.archived_at;
          })
      : isTrashView
        ? folders.filter((item) => Boolean(item.delete_scheduled_for))
        : folders;
    const term = searchTerm.trim().toLowerCase();

    return sourceFolders.filter((item) => {
      const matchesTerm = !term || item.name.toLowerCase().includes(term);
      const matchesClient = !searchFilters.clientId || (item.client_id || '') === searchFilters.clientId;
      const matchesLabel = !searchFilters.labelId || folderLabelAssignments[item.id] === searchFilters.labelId;

      const updatedAtTime = new Date(item.updated_at).getTime();
      const fromTime = searchFilters.dateFrom ? new Date(`${searchFilters.dateFrom}T00:00:00`).getTime() : null;
      const toTime = searchFilters.dateTo ? new Date(`${searchFilters.dateTo}T23:59:59`).getTime() : null;
      const matchesDate = (!fromTime || updatedAtTime >= fromTime) && (!toTime || updatedAtTime <= toTime);

      return matchesTerm && matchesClient && matchesLabel && matchesDate;
    });
  }, [allFolders, folderLabelAssignments, folders, hasGlobalSearch, isArchivedView, isTrashView, searchFilters, searchTerm]);

  const filteredFiles = useMemo(() => {
    const sourceFiles = hasGlobalSearch
      ? allFiles.filter((item) => !item.archived_at)
      : isArchivedView
        ? files.filter((item) => {
            if (!item.archived_at) return false;
            const parentFolder = allFolders.find((folder) => folder.id === item.folder_id) ?? null;
            return !parentFolder?.archived_at;
          })
        : files;
    const term = searchTerm.trim().toLowerCase();

    return sourceFiles.filter((item) => {
      const parentFolder = allFolders.find((folder) => folder.id === item.folder_id) ?? null;
      const folderPath = parentFolder ? [parentFolder.name] : [];
      let cursor = parentFolder;
      while (cursor?.parent_id) {
        cursor = allFolders.find((folder) => folder.id === cursor?.parent_id) ?? null;
        if (cursor) folderPath.unshift(cursor.name);
      }

      const matchesTerm = !term || [item.original_name, parentFolder?.name || '', folderPath.join(' / ')]
        .some((value) => value.toLowerCase().includes(term));
      const matchesExtension = !searchFilters.extension || (item.extension || '').toLowerCase() === searchFilters.extension.toLowerCase();
      const matchesClient = !searchFilters.clientId || (item.client_id || '') === searchFilters.clientId;
      const matchesLabel = !searchFilters.labelId || (parentFolder ? folderLabelAssignments[parentFolder.id] === searchFilters.labelId : false);

      const updatedAtTime = new Date(item.updated_at).getTime();
      const fromTime = searchFilters.dateFrom ? new Date(`${searchFilters.dateFrom}T00:00:00`).getTime() : null;
      const toTime = searchFilters.dateTo ? new Date(`${searchFilters.dateTo}T23:59:59`).getTime() : null;
      const matchesDate = (!fromTime || updatedAtTime >= fromTime) && (!toTime || updatedAtTime <= toTime);

      const minSize = searchFilters.sizeMinKb ? Number(searchFilters.sizeMinKb) * 1024 : null;
      const maxSize = searchFilters.sizeMaxKb ? Number(searchFilters.sizeMaxKb) * 1024 : null;
      const matchesSize = (!minSize || item.file_size >= minSize) && (!maxSize || item.file_size <= maxSize);

      return matchesTerm && matchesExtension && matchesClient && matchesLabel && matchesDate && matchesSize;
    });
  }, [allFiles, allFolders, files, folderLabelAssignments, hasGlobalSearch, searchFilters, searchTerm]);

  const explorerRows = useMemo(
    () => [
      ...filteredFolders.map((folder) => ({ kind: 'folder' as const, folder })),
      ...filteredFiles.map((file) => ({ kind: 'file' as const, file })),
    ],
    [filteredFolders, filteredFiles],
  );

  const explorerItemKeys = useMemo(
    () => explorerRows.map((row) => (row.kind === 'folder' ? `folder:${row.folder.id}` : `file:${row.file.id}`)),
    [explorerRows],
  );

  const syncBoxSelection = useCallback((nextBox: { startX: number; startY: number; currentX: number; currentY: number }) => {
    const container = explorerViewportRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const left = Math.min(nextBox.startX, nextBox.currentX) - containerRect.left + container.scrollLeft;
    const right = Math.max(nextBox.startX, nextBox.currentX) - containerRect.left + container.scrollLeft;
    const top = Math.min(nextBox.startY, nextBox.currentY) - containerRect.top + container.scrollTop;
    const bottom = Math.max(nextBox.startY, nextBox.currentY) - containerRect.top + container.scrollTop;
    const selectedKeysInBox = explorerItemKeys.filter((itemKey) => {
      const element = itemElementMapRef.current[itemKey];
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const itemLeft = rect.left - containerRect.left + container.scrollLeft;
      const itemRight = itemLeft + rect.width;
      const itemTop = rect.top - containerRect.top + container.scrollTop;
      const itemBottom = itemTop + rect.height;
      return itemRight >= left && itemLeft <= right && itemBottom >= top && itemTop <= bottom;
    });

    setSelectedItemKeys(selectedKeysInBox);
    setSelectedItemKey(selectedKeysInBox[selectedKeysInBox.length - 1] ?? null);
    setSelectionAnchorKey(selectedKeysInBox[0] ?? null);
  }, [explorerItemKeys]);

  useEffect(() => {
    if (!selectionBox) return;

    const handlePointerMove = (event: PointerEvent) => {
      const nextBox = {
        startX: selectionBox.startX,
        startY: selectionBox.startY,
        currentX: event.clientX,
        currentY: event.clientY,
      };
      setSelectionBox(nextBox);
      syncBoxSelection(nextBox);
    };

    const handlePointerUp = () => {
      setSelectionBox(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [selectionBox, syncBoxSelection]);

  const previewPdfFiles = useMemo(
    () => filteredFiles.filter((file) => isPdfFile(file.mime_type, file.original_name)),
    [filteredFiles],
  );

  const previewPdfIndex = useMemo(() => {
    if (!previewFile || !isPdfFile(previewFile.mime_type, previewFile.original_name)) return -1;
    return previewPdfFiles.findIndex((file) => file.id === previewFile.id);
  }, [previewFile, previewPdfFiles]);

  const canNavigatePreviewPdf = previewPdfIndex !== -1 && previewPdfFiles.length > 1;

  const openPreviewPdfByOffset = useCallback((offset: number) => {
    if (previewPdfFiles.length === 0 || previewPdfIndex === -1) return;
    const nextIndex = (previewPdfIndex + offset + previewPdfFiles.length) % previewPdfFiles.length;
    setPreviewFile(previewPdfFiles[nextIndex]);
  }, [previewPdfFiles, previewPdfIndex]);

  // Navegação de imagens
  const previewImageFiles = useMemo(
    () => filteredFiles.filter((file) => isImageFile(file.mime_type)),
    [filteredFiles],
  );

  const previewImageIndex = useMemo(() => {
    if (!previewFile || !isImageFile(previewFile.mime_type)) return -1;
    return previewImageFiles.findIndex((file) => file.id === previewFile.id);
  }, [previewFile, previewImageFiles]);

  const canNavigatePreviewImage = previewImageIndex !== -1 && previewImageFiles.length > 1;

  const openPreviewImageByOffset = useCallback((offset: number) => {
    if (previewImageFiles.length === 0 || previewImageIndex === -1) return;
    const nextIndex = (previewImageIndex + offset + previewImageFiles.length) % previewImageFiles.length;
    setPreviewFile(previewImageFiles[nextIndex]);
  }, [previewImageFiles, previewImageIndex]);

  const bulkMoveOptions = useMemo(() => {
    const selectedFolderIds = new Set(selectedFolderKeys.map((key) => key.replace('folder:', '')));
    const walk = (parentId: string | null, depth = 0): Array<{ id: string; label: string }> => {
      const children = (folderChildrenMap.get(parentId) ?? [])
        .filter((folder) => !selectedFolderIds.has(folder.id));

      return children.flatMap((folder) => {
        const prefix = depth === 0 ? '' : `${'— '.repeat(depth)}`;
        return [
          { id: folder.id, label: `${prefix}${folder.name}` },
          ...walk(folder.id, depth + 1),
        ];
      });
    };

    return walk(null);
  }, [folderChildrenMap, selectedFolderKeys]);

  const availableExtensions = useMemo(() => {
    return Array.from(new Set(allFiles.map((file) => (file.extension || '').toLowerCase()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [allFiles]);

  const moveTargetOptions = useMemo(() => {
    const currentFolderIdToExclude = selectedFileToMove?.folder_id || null;
    const walk = (parentId: string | null, depth = 0): Array<{ id: string; label: string }> => {
      const children = (folderChildrenMap.get(parentId) ?? [])
        .filter((folder) => folder.id !== currentFolderIdToExclude);

      return children.flatMap((folder) => {
        const prefix = depth === 0 ? '' : `${'— '.repeat(depth)}`;
        return [
          { id: folder.id, label: `${prefix}${folder.name}` },
          ...walk(folder.id, depth + 1),
        ];
      });
    };

    return walk(null);
  }, [folderChildrenMap, selectedFileToMove]);

  const handleOpenCreateFolder = () => {
    setFolderName('');
    setFolderClientId(currentFolder?.client_id || '');
    setSelectedFolderLabelId('pendente');
    setNewLabelName('');
    setNewLabelColor('#f97316');
    setFolderModalOpen(true);
  };

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return;
    try {
      await cloudService.createFolder({
        name: folderName.trim(),
        parent_id: currentFolderId,
        client_id: folderClientId || null,
      });
      const refreshedFolders = await cloudService.listAllFolders();
      const createdFolder = refreshedFolders.find((item) => item.name === folderName.trim() && item.parent_id === currentFolderId) ?? null;
      if (createdFolder) {
        setFolderLabelAssignments((prev) => ({ ...prev, [createdFolder.id]: selectedFolderLabelId || 'pendente' }));
      }
      toast.success('Cloud', 'Pasta criada com sucesso.');
      setFolderModalOpen(false);
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao criar pasta.');
    }
  };

  const handleConvertWordToPdf = useCallback(async (file: CloudFile) => {
    if (wordToPdfFileId) return;
    if (!isDocxFile(file.mime_type, file.original_name)) {
      toast.info('Cloud', 'A conversão automática para PDF está disponível no Cloud para arquivos .docx.');
      return;
    }

    try {
      setWordToPdfFileId(file.id);
      const signedUrl = await cloudService.getFileSignedUrl(file.storage_path);
      const response = await fetch(signedUrl);
      if (!response.ok) throw new Error('Não foi possível baixar o arquivo Word.');
      const docxBlob = await response.blob();

      const container = document.createElement('div');
      container.className = 'cloud-docx-to-pdf-render';
      container.style.cssText = `
        position: fixed;
        left: -9999px;
        top: 0;
        width: 794px;
        background: white;
        font-family: 'Times New Roman', Times, serif;
      `;
      const style = document.createElement('style');
      style.textContent = `
        .cloud-docx-to-pdf-render .docx-wrapper-wrapper {
          background: transparent !important;
          padding: 0 !important;
          display: flex !important;
          justify-content: center !important;
        }
        .cloud-docx-to-pdf-render .docx-wrapper {
          background: transparent !important;
          padding: 0 !important;
          width: auto !important;
          max-width: none !important;
        }
        .cloud-docx-to-pdf-render .docx-wrapper > section,
        .cloud-docx-to-pdf-render .docx-wrapper > article,
        .cloud-docx-to-pdf-render .docx-wrapper > section > article {
          width: 794px !important;
          min-width: 794px !important;
          max-width: 794px !important;
          margin: 0 auto 20px auto !important;
          background: white !important;
          box-shadow: none !important;
          border: none !important;
          border-radius: 0 !important;
        }
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

        const pageWidth = 210;
        const pageHeight = 297;

        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4',
          compress: true,
        });

        await new Promise((resolve) => window.setTimeout(resolve, 350));

        const docxWrapper = (container.querySelector('.docx-wrapper') as HTMLElement | null) ?? container;
        const topLevelPages = Array.from(docxWrapper.children).filter((node) => {
          if (!(node instanceof HTMLElement)) return false;
          const tag = node.tagName.toLowerCase();
          return tag === 'section' || tag === 'article' || node.classList.contains('docx');
        }) as HTMLElement[];
        const pages = topLevelPages.length > 0 ? topLevelPages : [docxWrapper];

        for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
          const pageElement = pages[pageIndex];
          const originalBoxShadow = pageElement.style.boxShadow;
          pageElement.style.boxShadow = 'none';

          const canvas = await html2canvas(pageElement, {
            scale: 1.5,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            logging: false,
            width: pageElement.scrollWidth || 794,
            windowWidth: pageElement.scrollWidth || 794,
            imageTimeout: 0,
          });

          pageElement.style.boxShadow = originalBoxShadow;

          const imgData = canvas.toDataURL('image/jpeg', 0.88);
          const imgWidth = pageWidth;
          const imgHeight = (canvas.height * pageWidth) / canvas.width;

          if (pageIndex > 0) pdf.addPage();

          if (imgHeight <= pageHeight) {
            pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight, undefined, 'FAST');
            continue;
          }

          const totalSlices = Math.max(1, Math.ceil(imgHeight / pageHeight));
          for (let sliceIndex = 0; sliceIndex < totalSlices; sliceIndex += 1) {
            if (sliceIndex > 0) pdf.addPage();
            const yOffset = -(sliceIndex * pageHeight);
            pdf.addImage(imgData, 'JPEG', 0, yOffset, imgWidth, imgHeight, undefined, 'FAST');
          }
        }

        const pdfBlob = pdf.output('blob');
        const nextName = `${file.original_name.replace(/\.[^/.]+$/i, '')}.pdf`;
        const pdfFile = new window.File([pdfBlob], nextName, { type: 'application/pdf' });

        await cloudService.uploadFiles(file.folder_id, [pdfFile], file.client_id || null);
        toast.success('Cloud', 'Arquivo Word convertido em PDF com sucesso.');
        await loadData();
      } finally {
        document.head.removeChild(style);
        document.body.removeChild(container);
      }
    } catch (error: any) {
      toast.error('Cloud', error?.message || 'Erro ao converter Word em PDF.');
    } finally {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
      setWordToPdfFileId(null);
    }
  }, [cloudService, loadData, toast, wordToPdfFileId]);

  const updateUploadQueueItem = useCallback((itemId: string, updater: (item: UploadQueueItem) => UploadQueueItem) => {
    setUploadQueueItems((prev) => prev.map((item) => (item.id === itemId ? updater(item) : item)));
  }, []);

  const clearFinishedUploads = useCallback(() => {
    setUploadQueueItems((prev) => prev.filter((item) => item.status === 'uploading' || item.status === 'pending'));
  }, []);

  useEffect(() => {
    if (uploadModalAutoCloseRef.current) {
      window.clearTimeout(uploadModalAutoCloseRef.current);
      uploadModalAutoCloseRef.current = null;
    }

    if (
      uploadQueueSummary.totalItems > 0
      && uploadQueueSummary.completedItems === uploadQueueSummary.totalItems
      && uploadQueueSummary.failedItems === 0
      && uploadQueueSummary.uploadingItems === 0
    ) {
      uploadModalAutoCloseRef.current = window.setTimeout(() => {
        clearFinishedUploads();
      }, 1400);
    }
  }, [clearFinishedUploads, uploadQueueSummary]);

  const processUploadQueue = useCallback(async (itemIds?: string[], sourceItems?: UploadQueueItem[]) => {
    const targetIds = itemIds ? new Set(itemIds) : null;
    let successCount = 0;

    try {
      setUploading(true);

      const queueSource = sourceItems ?? uploadQueueItemsRef.current;
      const queueSnapshot = queueSource.filter((item) => {
        if (targetIds && !targetIds.has(item.id)) return false;
        return item.status === 'pending' || item.status === 'failed';
      });

      for (const queueItem of queueSnapshot) {
        updateUploadQueueItem(queueItem.id, (item) => ({
          ...item,
          status: 'uploading',
          progress: Math.max(item.progress, 20),
          error: null,
        }));

        try {
          updateUploadQueueItem(queueItem.id, (item) => ({ ...item, progress: 55 }));
          await cloudService.uploadFile(queueItem.folderId, queueItem.file, queueItem.clientId || null);
          updateUploadQueueItem(queueItem.id, (item) => ({
            ...item,
            status: 'completed',
            progress: 100,
            error: null,
          }));
          successCount += 1;
        } catch (error: any) {
          updateUploadQueueItem(queueItem.id, (item) => ({
            ...item,
            status: 'failed',
            progress: 100,
            error: error?.message || 'Erro no upload.',
          }));
        }
      }

      if (successCount > 0) {
        await loadData();
        toast.success('Cloud', `${successCount} arquivo(s) enviado(s).`);
      }
    } finally {
      setUploading(false);
      setDragActive(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [cloudService, loadData, toast, updateUploadQueueItem]);

  const enqueueUploads = useCallback(async (items: UploadQueueItem[]) => {
    if (items.length === 0) {
      toast.info('Cloud', 'Nenhum arquivo encontrado para envio.');
      return;
    }

    setUploadQueueItems((prev) => [...items, ...prev]);
    await processUploadQueue(items.map((item) => item.id), items);
  }, [processUploadQueue, toast]);

  const retryUploadItem = useCallback(async (itemId: string) => {
    updateUploadQueueItem(itemId, (item) => ({
      ...item,
      status: 'pending',
      progress: 0,
      error: null,
    }));
    await processUploadQueue([itemId]);
  }, [processUploadQueue, updateUploadQueueItem]);

  const uploadFilesToFolder = async (folderId: string, filesToUpload: File[], clientId?: string | null) => {
    if (filesToUpload.length === 0) return;
    const queueItems: UploadQueueItem[] = filesToUpload.map((file) => ({
      id: crypto.randomUUID(),
      file,
      fileName: file.name,
      fileSize: file.size,
      relativePath: file.name,
      folderId,
      folderLabel: currentFolder?.name || 'Pasta atual',
      clientId: clientId || null,
      status: 'pending',
      progress: 0,
      error: null,
    }));

    await enqueueUploads(queueItems);
  };

  const handleUploadFiles = async (list: FileList | File[]) => {
    const filesToUpload = Array.from(list);
    if (filesToUpload.length === 0) return;
    const droppedFiles = filesToUpload.map((file) => ({ file, relativePath: normalizeDroppedRelativePath(file) }));
    const preparedItems = await prepareUploadQueueItems(droppedFiles);
    await enqueueUploads(preparedItems);
  };

  const readFileEntry = useCallback((entry: CloudDragFileEntry, pathSegments: string[]) => {
    return new Promise<CloudDroppedFile>((resolve, reject) => {
      entry.file(
        (file) => {
          const normalizedSegments = pathSegments.filter(Boolean);
          const relativePath = [...normalizedSegments, file.name].join('/');
          resolve({ file, relativePath });
        },
        reject,
      );
    });
  }, []);

  const readDirectoryEntries = useCallback((directoryEntry: CloudDragDirectoryEntry) => {
    return new Promise<CloudDragEntry[]>((resolve, reject) => {
      const reader = directoryEntry.createReader();
      const entries: CloudDragEntry[] = [];

      const readBatch = () => {
        reader.readEntries(
          (batch) => {
            if (!batch.length) {
              resolve(entries);
              return;
            }

            entries.push(...batch);
            readBatch();
          },
          reject,
        );
      };

      readBatch();
    });
  }, []);

  const collectFilesFromEntry = useCallback(async (entry: CloudDragEntry, pathSegments: string[] = []): Promise<CloudDroppedFile[]> => {
    if (entry.isFile) {
      return [await readFileEntry(entry as CloudDragFileEntry, pathSegments)];
    }

    if (entry.isDirectory) {
      const directoryName = String(entry.name || String(entry.fullPath || '').split('/').filter(Boolean).pop() || '').trim();
      const nextPathSegments = directoryName ? [...pathSegments, directoryName] : pathSegments;
      const childEntries = await readDirectoryEntries(entry as CloudDragDirectoryEntry);
      const nestedFiles = await Promise.all(childEntries.map((childEntry) => collectFilesFromEntry(childEntry, nextPathSegments)));
      return nestedFiles.flat();
    }

    return [];
  }, [readDirectoryEntries, readFileEntry]);

  const hasFileDragPayload = useCallback((dataTransfer?: DataTransfer | null) => {
    if (!dataTransfer) return false;
    if (Array.from(dataTransfer.items || []).some((item) => item.kind === 'file')) return true;
    if ((dataTransfer.files?.length || 0) > 0) return true;
    return Array.from(dataTransfer.types || []).includes('Files');
  }, []);

  const extractFilesFromDataTransfer = useCallback(async (dataTransfer: DataTransfer) => {
    const items = Array.from(dataTransfer.items || []);
    const itemEntries = items
      .map((item) => {
        const dragItem = item as DataTransferItem & { webkitGetAsEntry?: () => CloudDragEntry | null };
        return typeof dragItem.webkitGetAsEntry === 'function' ? dragItem.webkitGetAsEntry() : null;
      })
      .filter(Boolean) as CloudDragEntry[];

    if (itemEntries.length > 0) {
      const groupedFiles = await Promise.all(itemEntries.map((entry) => collectFilesFromEntry(entry)));
      const files = groupedFiles.flat();
      if (files.length > 0) return files;
    }

    return Array.from(dataTransfer.files || []).map((file) => ({ file, relativePath: normalizeDroppedRelativePath(file) }));
  }, [collectFilesFromEntry]);

  const ensureFolderPath = useCallback(async (
    pathSegments: string[],
    options: { parentId: string | null; clientId: string | null; cache: Map<string, CloudFolder> },
  ) => {
    let parentId = options.parentId;
    let currentFolderResult: CloudFolder | null = null;

    for (const segment of pathSegments) {
      const trimmedSegment = segment.trim();
      if (!trimmedSegment) continue;

      const cacheKey = `${parentId ?? 'root'}::${trimmedSegment.toLowerCase()}`;
      const cachedFolder = options.cache.get(cacheKey)
        ?? allFolders.find((folder) => (folder.parent_id ?? null) === parentId && folder.name.trim().toLowerCase() === trimmedSegment.toLowerCase())
        ?? null;

      if (cachedFolder) {
        currentFolderResult = cachedFolder;
        parentId = cachedFolder.id;
        options.cache.set(cacheKey, cachedFolder);
        continue;
      }

      const createdFolder = await cloudService.createFolder({
        name: trimmedSegment,
        parent_id: parentId,
        client_id: options.clientId || null,
      });

      options.cache.set(cacheKey, createdFolder);
      currentFolderResult = createdFolder;
      parentId = createdFolder.id;
    }

    return currentFolderResult;
  }, [allFolders]);

  const prepareUploadQueueItems = useCallback(async (droppedFiles: CloudDroppedFile[]) => {
    const folderCache = new Map<string, CloudFolder>();
    const preparedItems: UploadQueueItem[] = [];
    let autoRootFolder: CloudFolder | null = null;

    for (const droppedFile of droppedFiles) {
      const segments = droppedFile.relativePath.split('/').filter(Boolean);
      const folderSegments = segments.slice(0, -1);
      let targetFolderId = currentFolderId;
      let targetClientId = currentFolder?.client_id || null;
      let folderLabel = currentFolder?.name || 'Pasta atual';

      if (folderSegments.length > 0) {
        const ensuredFolder = await ensureFolderPath(folderSegments, {
          parentId: currentFolderId ?? null,
          clientId: currentFolder?.client_id || null,
          cache: folderCache,
        });

        targetFolderId = ensuredFolder?.id ?? null;
        targetClientId = ensuredFolder?.client_id || currentFolder?.client_id || null;
        folderLabel = folderSegments.join(' / ');
      } else if (!currentFolderId) {
        if (!autoRootFolder) {
          autoRootFolder = await cloudService.createFolder({
            name: getAutoUploadFolderName(),
            parent_id: null,
            client_id: null,
          });
        }

        targetFolderId = autoRootFolder.id;
        targetClientId = autoRootFolder.client_id || null;
        folderLabel = autoRootFolder.name;
      }

      if (!targetFolderId) continue;

      preparedItems.push({
        id: crypto.randomUUID(),
        file: droppedFile.file,
        fileName: droppedFile.file.name,
        fileSize: droppedFile.file.size,
        relativePath: droppedFile.relativePath,
        folderId: targetFolderId,
        folderLabel,
        clientId: targetClientId,
        status: 'pending',
        progress: 0,
        error: null,
      });
    }

    return preparedItems;
  }, [cloudService, currentFolder, currentFolderId, ensureFolderPath]);

  const uploadDroppedFiles = useCallback(async (droppedFiles: CloudDroppedFile[]) => {
    const preparedItems = await prepareUploadQueueItems(droppedFiles);
    await enqueueUploads(preparedItems);
  }, [enqueueUploads, prepareUploadQueueItems]);

  const handleDropUpload = useCallback(async (dataTransfer: DataTransfer) => {
    try {
      const files = await extractFilesFromDataTransfer(dataTransfer);
      await uploadDroppedFiles(files);
    } catch (error: any) {
      toast.error('Cloud', error?.message || 'Não foi possível ler os arquivos da pasta arrastada.');
    }
  }, [extractFilesFromDataTransfer, toast, uploadDroppedFiles]);

  useEffect(() => {
    const isWithinCloudCenter = (clientX: number, clientY: number) => {
      const element = cloudCenterDropRef.current;
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    };

    const handleDocumentDragOver = (event: DragEvent) => {
      if (!hasFileDragPayload(event.dataTransfer)) return;
      if (!isWithinCloudCenter(event.clientX, event.clientY)) {
        if (dragActive) setDragActive(false);
        return;
      }
      event.preventDefault();
      if (!dragActive) setDragActive(true);
    };

    const handleDocumentDragLeave = (event: DragEvent) => {
      if (!hasFileDragPayload(event.dataTransfer)) return;
      if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) {
        setDragActive(false);
      }
    };

    const handleDocumentDrop = (event: DragEvent) => {
      if (!hasFileDragPayload(event.dataTransfer)) return;
      if (event.defaultPrevented) return;
      const inside = isWithinCloudCenter(event.clientX, event.clientY);
      setDragActive(false);
      if (!inside || !event.dataTransfer) return;
      event.preventDefault();
      void handleDropUpload(event.dataTransfer);
    };

    window.addEventListener('dragover', handleDocumentDragOver);
    window.addEventListener('dragleave', handleDocumentDragLeave);
    window.addEventListener('drop', handleDocumentDrop);

    return () => {
      window.removeEventListener('dragover', handleDocumentDragOver);
      window.removeEventListener('dragleave', handleDocumentDragLeave);
      window.removeEventListener('drop', handleDocumentDrop);
    };
  }, [dragActive, handleDropUpload, hasFileDragPayload]);

  const uploadClipboardImage = useCallback(async (blob: Blob) => {
    if (!currentFolderId) {
      toast.info('Cloud', 'Selecione uma pasta antes de enviar o print.');
      return;
    }

    try {
      setUploading(true);
      const pdfDocument = await PDFDocument.create();
      const imageBytes = blob.type.includes('jpeg') || blob.type.includes('jpg')
        ? new Uint8Array(await blob.arrayBuffer())
        : await blobToPngBytes(blob);

      const embeddedImage = blob.type.includes('jpeg') || blob.type.includes('jpg')
        ? await pdfDocument.embedJpg(imageBytes)
        : await pdfDocument.embedPng(imageBytes);

      const page = pdfDocument.addPage([embeddedImage.width, embeddedImage.height]);
      page.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: embeddedImage.width,
        height: embeddedImage.height,
      });

      const pdfBytes = await pdfDocument.save();
      const pdfBlob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
      const file = new window.File([pdfBlob], getRandomPdfFileName(), { type: 'application/pdf' });

      await cloudService.uploadFiles(currentFolderId, [file], currentFolder?.client_id || null);
      toast.success('Cloud', 'Print convertido em PDF e salvo na pasta atual.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao converter print em PDF.');
    } finally {
      setUploading(false);
    }
  }, [currentFolderId, currentFolder, loadData, toast]);

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const clipboardItems = Array.from(event.clipboardData?.items || []);
      const imageItem = clipboardItems.find((item) => item.type.startsWith('image/'));
      if (!imageItem) return;
      event.preventDefault();
      const blob = imageItem.getAsFile();
      if (!blob) return;
      await uploadClipboardImage(blob);
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [uploadClipboardImage]);

  const handlePastePrintFromClipboard = async () => {
    if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
      toast.info('Cloud', 'Use Ctrl+V para colar o print nesta pasta.');
      return;
    }

    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        await uploadClipboardImage(blob);
        return;
      }
      toast.info('Cloud', 'Nenhuma imagem encontrada na área de transferência.');
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Não foi possível acessar a área de transferência.');
    }
  };

  const toggleImageSelection = (fileId: string) => {
    const key = `file:${fileId}`;
    setSelectedItemKeys((prev) => (
      prev.includes(key)
        ? prev.filter((item) => item !== key)
        : [...prev, key]
    ));
    setSelectedItemKey(key);
    setSelectionAnchorKey(key);
  };

  const applySelection = (itemKey: string, options?: { additive?: boolean; range?: boolean }) => {
    setInlineRenameTarget(null);
    setInlineRenameValue('');
    if (options?.range && selectionAnchorKey && explorerItemKeys.length > 0) {
      const anchorIndex = explorerItemKeys.indexOf(selectionAnchorKey);
      const targetIndex = explorerItemKeys.indexOf(itemKey);
      if (anchorIndex !== -1 && targetIndex !== -1) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        const rangeKeys = explorerItemKeys.slice(start, end + 1);
        setSelectedItemKeys(rangeKeys);
        setSelectedItemKey(itemKey);
        setContextMenu(null);
        return;
      }
    }

    if (options?.additive) {
      setSelectedItemKeys((prev) => (
        prev.includes(itemKey)
          ? prev.filter((key) => key !== itemKey)
          : [...prev, itemKey]
      ));
    } else {
      setSelectedItemKeys([itemKey]);
    }
    setSelectedItemKey(itemKey);
    setSelectionAnchorKey(itemKey);
    setContextMenu(null);
  };

  const moveSelectionByOffset = useCallback((offset: number) => {
    if (explorerItemKeys.length === 0) return;

    const currentIndex = selectedItemKey ? explorerItemKeys.indexOf(selectedItemKey) : -1;
    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = Math.max(0, Math.min(explorerItemKeys.length - 1, baseIndex + offset));
    const nextKey = explorerItemKeys[nextIndex];
    setSelectedItemKey(nextKey);
    setSelectedItemKeys([nextKey]);
    setSelectionAnchorKey(nextKey);
    setContextMenu(null);
    setInlineRenameTarget(null);
    setInlineRenameValue('');
  }, [explorerItemKeys, selectedItemKey]);

  const rememberRecentFile = useCallback((fileId: string) => {
    setRecentFileIds((prev) => [fileId, ...prev.filter((item) => item !== fileId)].slice(0, 15));
  }, []);

  const handleToggleFavoriteFile = useCallback((fileId: string) => {
    setFavoriteFileIds((prev) => (
      prev.includes(fileId)
        ? prev.filter((id) => id !== fileId)
        : [fileId, ...prev]
    ));
  }, []);

  const startInlineRename = useCallback((target: { type: 'file' | 'folder'; id: string; currentName: string }) => {
    setRenameModalOpen(false);
    setRenameTarget(null);
    setRenameValue('');
    setInlineRenameTarget(target);
    const { baseName, extension } = splitFileNameAndExtension(target.currentName);
    setInlineRenameValue(target.type === 'file' && extension ? baseName : target.currentName);
  }, []);

  const cancelInlineRename = useCallback(() => {
    setInlineRenameTarget(null);
    setInlineRenameValue('');
  }, []);

  const commitInlineRename = useCallback(async () => {
    if (!inlineRenameTarget || !inlineRenameValue.trim()) return;

    try {
      if (inlineRenameTarget.type === 'file') {
        const { extension } = splitFileNameAndExtension(inlineRenameTarget.currentName);
        const nextName = `${inlineRenameValue.trim()}${extension}`;
        await cloudService.renameFile(inlineRenameTarget.id, nextName);
        toast.success('Cloud', 'Arquivo renomeado com sucesso.');
      } else {
        await cloudService.updateFolder(inlineRenameTarget.id, { name: inlineRenameValue.trim() });
        toast.success('Cloud', 'Pasta renomeada com sucesso.');
      }
      cancelInlineRename();
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao renomear.');
    }
  }, [cancelInlineRename, cloudService, inlineRenameTarget, inlineRenameValue, loadData, toast]);

  const openSelectedItem = (itemKey: string | null) => {
    if (!itemKey) return;
    if (itemKey === `folder:${CLOUD_ARCHIVED_FOLDER_ID}`) {
      setCurrentFolderId(CLOUD_ARCHIVED_FOLDER_ID);
      setSelectedItemKey(itemKey);
      setSelectedItemKeys([itemKey]);
      return;
    }
    if (itemKey === `folder:${CLOUD_TRASH_FOLDER_ID}`) {
      setCurrentFolderId(CLOUD_TRASH_FOLDER_ID);
      setSelectedItemKey(itemKey);
      setSelectedItemKeys([itemKey]);
      return;
    }
    if (itemKey.startsWith('folder:')) {
      const folderId = itemKey.replace('folder:', '');
      setCurrentFolderId(folderId);
      setSelectedItemKey(itemKey);
      setSelectedItemKeys([itemKey]);
      return;
    }

    if (itemKey.startsWith('file:')) {
      const fileId = itemKey.replace('file:', '');
      const file = files.find((item) => item.id === fileId) ?? null;
      if (!file) return;
      rememberRecentFile(file.id);
      if (isWordFile(file.mime_type, file.original_name)) {
        void handleOpenDocxEditor(file);
        return;
      }
      setPreviewFile(file);
    }
  };

  const handleDeleteSelectedItems = useCallback(async () => {
    const filesToDelete = files.filter((item) => selectedFileKeys.includes(`file:${item.id}`));
    const foldersToDelete = allFolders.filter((item) => selectedFolderKeys.includes(`folder:${item.id}`));

    if (filesToDelete.length === 0 && foldersToDelete.length === 0) return;

    const confirmed = window.confirm(
      `Excluir ${filesToDelete.length} arquivo(s) e ${foldersToDelete.length} pasta(s) selecionados?`,
    );
    if (!confirmed) return;

    try {
      for (const file of filesToDelete) {
        await cloudService.trashFile(file.id);
      }
      for (const folder of foldersToDelete) {
        await cloudService.trashFolder(folder.id);
      }

      setSelectedItemKey(null);
      setSelectedItemKeys([]);
      setSelectionAnchorKey(null);
      toast.success('Cloud', 'Itens enviados para a lixeira com sucesso.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao remover itens selecionados.');
    }
  }, [allFolders, cloudService, files, loadData, selectedFileKeys, selectedFolderKeys, toast]);

  const openPdfToolsModal = async (file: CloudFile) => {
    try {
      const signedUrl = await cloudService.getFileSignedUrl(file.storage_path);
      const bytes = await fetch(signedUrl).then((res) => res.arrayBuffer());
      const pdfDoc = await PDFDocument.load(bytes);
      const pageStates = pdfDoc.getPages().map((page, index) => ({ sourceIndex: index, rotation: page.getRotation().angle || 0 }));

      setSelectedPdfToolFile(file);
      setPdfToolPreviewUrl(signedUrl);
      setPdfToolPages(pageStates);
      setSelectedPdfPageIndexes([]);
      setPdfToolSaveAsCopy(false);
      setPdfToolMode('home');
      setPdfToolsModalOpen(true);
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Não foi possível abrir as ferramentas de PDF.');
    }
  };

  const closePdfToolsModal = () => {
    setPdfToolsModalOpen(false);
    setSelectedPdfToolFile(null);
    setPdfToolPreviewUrl(null);
    setPdfToolDocumentReady(false);
    setPdfToolPages([]);
    setSelectedPdfPageIndexes([]);
    setPdfToolSaveAsCopy(false);
    setPdfToolMode('home');
  };

  useEffect(() => {
    setPdfToolDocumentReady(false);
  }, [pdfToolPreviewUrl, selectedPdfToolFile?.id]);

  const togglePdfPageSelection = (pageIndex: number) => {
    setSelectedPdfPageIndexes((prev) => (
      prev.includes(pageIndex)
        ? prev.filter((index) => index !== pageIndex)
        : [...prev, pageIndex]
    ));
  };

  const rotateSelectedPdfPages = (delta: number) => {
    if (selectedPdfPageIndexes.length === 0) {
      toast.info('Cloud', 'Selecione ao menos uma página no hub PDF.');
      return;
    }

    setPdfToolPages((prev) => prev.map((page, index) => (
      selectedPdfPageIndexes.includes(index)
        ? { ...page, rotation: (((page.rotation + delta) % 360) + 360) % 360 }
        : page
    )));
  };

  const removeSelectedPdfPages = () => {
    if (selectedPdfPageIndexes.length === 0) {
      toast.info('Cloud', 'Selecione ao menos uma página para remover.');
      return;
    }

    setPdfToolPages((prev) => prev.filter((_, index) => !selectedPdfPageIndexes.includes(index)));
    setSelectedPdfPageIndexes([]);
  };

  const savePdfToolChanges = async () => {
    if (!selectedPdfToolFile || pdfToolPages.length === 0) {
      toast.info('Cloud', 'O PDF precisa ter ao menos uma página.');
      return;
    }

    try {
      setPdfToolSaving(true);
      const signedUrl = await cloudService.getFileSignedUrl(selectedPdfToolFile.storage_path);
      const originalBytes = await fetch(signedUrl).then((res) => res.arrayBuffer());
      const sourcePdf = await PDFDocument.load(originalBytes);
      const nextPdf = await PDFDocument.create();
      const copiedPages = await nextPdf.copyPages(sourcePdf, pdfToolPages.map((page) => page.sourceIndex));

      copiedPages.forEach((page, index) => {
        page.setRotation(degrees(pdfToolPages[index].rotation));
        nextPdf.addPage(page);
      });

      const bytes = await nextPdf.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });

      if (pdfToolSaveAsCopy) {
        const nextName = selectedPdfToolFile.original_name.replace(/\.pdf$/i, '') + '_editado.pdf';
        const outputFile = new window.File([blob], nextName, { type: 'application/pdf' });
        await cloudService.uploadFiles(selectedPdfToolFile.folder_id, [outputFile], selectedPdfToolFile.client_id || null);
      } else {
        await cloudService.replaceFileContents(selectedPdfToolFile, blob, selectedPdfToolFile.original_name);
      }

      toast.success('Cloud', pdfToolSaveAsCopy ? 'Novo PDF gerado com sucesso.' : 'PDF atualizado com sucesso.');
      setPdfToolsModalOpen(false);
      setSelectedPdfToolFile(null);
      setPdfToolPages([]);
      setSelectedPdfPageIndexes([]);
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao salvar alterações do PDF.');
    } finally {
      setPdfToolSaving(false);
    }
  };

  const mergeSelectedPdfFiles = async () => {
    if (selectedPdfFiles.length < 2 || !currentFolderId) {
      toast.info('Cloud', 'Selecione pelo menos 2 PDFs na pasta atual para juntar.');
      return;
    }

    try {
      setPdfToolSaving(true);
      const mergedPdf = await PDFDocument.create();

      for (const file of selectedPdfFiles) {
        const signedUrl = await cloudService.getFileSignedUrl(file.storage_path);
        const bytes = await fetch(signedUrl).then((res) => res.arrayBuffer());
        const sourcePdf = await PDFDocument.load(bytes);
        const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedBytes = await mergedPdf.save();
      const mergedBlob = new Blob([mergedBytes as unknown as BlobPart], { type: 'application/pdf' });
      const mergedFile = new window.File([mergedBlob], 'pdf-unificado.pdf', { type: 'application/pdf' });
      await cloudService.uploadFiles(currentFolderId, [mergedFile], currentFolder?.client_id || null);

      toast.success('Cloud', 'PDFs unidos com sucesso.');
      setPdfToolsModalOpen(false);
      setSelectedPdfToolFile(null);
      setPdfToolPages([]);
      setSelectedPdfPageIndexes([]);
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao juntar PDFs.');
    } finally {
      setPdfToolSaving(false);
    }
  };

  const extractSelectedPdfPages = async () => {
    if (!selectedPdfToolFile || selectedPdfPageIndexes.length === 0) {
      toast.info('Cloud', 'Selecione pelo menos uma página para extrair.');
      return;
    }

    try {
      setPdfToolSaving(true);
      const signedUrl = await cloudService.getFileSignedUrl(selectedPdfToolFile.storage_path);
      const originalBytes = await fetch(signedUrl).then((res) => res.arrayBuffer());
      const sourcePdf = await PDFDocument.load(originalBytes);
      const extractedPdf = await PDFDocument.create();

      const sortedIndexes = [...selectedPdfPageIndexes].sort((a, b) => a - b);
      const sourceIndexes = sortedIndexes.map((idx) => pdfToolPages[idx].sourceIndex);
      const copiedPages = await extractedPdf.copyPages(sourcePdf, sourceIndexes);

      copiedPages.forEach((page, idx) => {
        page.setRotation(degrees(pdfToolPages[sortedIndexes[idx]].rotation));
        extractedPdf.addPage(page);
      });

      const extractedBytes = await extractedPdf.save();
      const blob = new Blob([extractedBytes as unknown as BlobPart], { type: 'application/pdf' });
      const baseName = selectedPdfToolFile.original_name.replace(/\.pdf$/i, '');
      const extractedFile = new window.File([blob], `${baseName}_extraido.pdf`, { type: 'application/pdf' });
      await cloudService.uploadFiles(selectedPdfToolFile.folder_id, [extractedFile], selectedPdfToolFile.client_id || null);

      toast.success('Cloud', `${selectedPdfPageIndexes.length} página(s) extraída(s) para novo PDF.`);
      setSelectedPdfPageIndexes([]);
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao extrair páginas.');
    } finally {
      setPdfToolSaving(false);
    }
  };

  const selectAllPdfPages = () => {
    setSelectedPdfPageIndexes(pdfToolPages.map((_, idx) => idx));
  };

  const invertPdfPageSelection = () => {
    const allIndexes = pdfToolPages.map((_, idx) => idx);
    const newSelection = allIndexes.filter((idx) => !selectedPdfPageIndexes.includes(idx));
    setSelectedPdfPageIndexes(newSelection);
  };

  const openConvertImagesModal = (baseFiles?: CloudFile[]) => {
    const imagesToUse = (baseFiles && baseFiles.length > 0 ? baseFiles : selectedImageFiles).filter((item) => isImageFile(item.mime_type));
    if (imagesToUse.length === 0) {
      toast.info('Cloud', 'Selecione pelo menos uma imagem para converter em PDF.');
      return;
    }
    setImagePdfItems(imagesToUse);
    setImagePdfName(imagesToUse.length === 1 ? imagesToUse[0].original_name.replace(/\.[^.]+$/, '') : 'imagens-convertidas');
    setImagePdfModalOpen(true);
  };

  const moveImagePdfItem = (index: number, direction: -1 | 1) => {
    setImagePdfItems((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const moveImagePdfItemById = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setImagePdfItems((prev) => {
      const draggedIndex = prev.findIndex((item) => item.id === draggedId);
      const targetIndex = prev.findIndex((item) => item.id === targetId);
      if (draggedIndex === -1 || targetIndex === -1) return prev;
      const next = [...prev];
      const [draggedItem] = next.splice(draggedIndex, 1);
      next.splice(targetIndex, 0, draggedItem);
      return next;
    });
  };

  useEffect(() => {
    if (!imagePdfModalOpen || imagePdfItems.length === 0) {
      setImagePdfPreviewUrls({});
      setDraggingImagePdfId(null);
      return;
    }

    let cancelled = false;

    const loadPreviewUrls = async () => {
      try {
        const entries = await Promise.all(
          imagePdfItems.map(async (item) => [item.id, await cloudService.getFileSignedUrl(item.storage_path)] as const),
        );
        if (cancelled) return;
        setImagePdfPreviewUrls(Object.fromEntries(entries));
      } catch {
        if (!cancelled) {
          setImagePdfPreviewUrls({});
        }
      }
    };

    void loadPreviewUrls();

    return () => {
      cancelled = true;
    };
  }, [imagePdfItems, imagePdfModalOpen]);

  const blobToPngBytes = async (blob: Blob) => {
    const imageUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('Não foi possível processar a imagem.'));
        element.src = imageUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas indisponível para converter a imagem.');
      context.drawImage(img, 0, 0);
      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error('Falha ao converter imagem para PNG.'));
        }, 'image/png');
      });
      return new Uint8Array(await pngBlob.arrayBuffer());
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  };

  const rotateImageBlob = async (blob: Blob, delta: number) => {
    const rotation = normalizeRotation(delta);
    if (rotation === 0) return blob;

    const imageUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('Não foi possível processar a imagem para rotação.'));
        element.src = imageUrl;
      });

      const swapSides = rotation === 90 || rotation === 270;
      const canvas = document.createElement('canvas');
      canvas.width = swapSides ? img.naturalHeight : img.naturalWidth;
      canvas.height = swapSides ? img.naturalWidth : img.naturalHeight;

      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas indisponível para girar a imagem.');

      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((rotation * Math.PI) / 180);
      context.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error('Falha ao gerar a imagem rotacionada.'));
        }, blob.type || 'image/png');
      });
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  };

  const handleRotateFileQuick = async (file: CloudFile, delta: number) => {
    if (quickActionFileId) return;

    try {
      setQuickActionFileId(file.id);
      const signedUrl = await cloudService.getFileSignedUrl(file.storage_path);
      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error(`Não foi possível baixar ${file.original_name}.`);
      }

      if (isImageFile(file.mime_type)) {
        const blob = await response.blob();
        const rotatedBlob = await rotateImageBlob(blob, delta);
        await cloudService.replaceFileContents(file, rotatedBlob, file.original_name);
        toast.success('Cloud', 'Imagem girada com sucesso.');
      } else if (isPdfFile(file.mime_type, file.original_name)) {
        const originalBytes = await response.arrayBuffer();
        const sourcePdf = await PDFDocument.load(originalBytes);
        sourcePdf.getPages().forEach((page) => {
          const currentRotation = page.getRotation().angle;
          page.setRotation(degrees(normalizeRotation(currentRotation + delta)));
        });
        const bytes = await sourcePdf.save();
        const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
        await cloudService.replaceFileContents(file, blob, file.original_name);
        toast.success('Cloud', 'PDF girado com sucesso.');
      }

      await loadData({ showLoading: false });
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao girar arquivo.');
    } finally {
      setQuickActionFileId(null);
    }
  };

  const handleConvertImagesToPdf = async () => {
    if (!currentFolderId) {
      toast.info('Cloud', 'Selecione uma pasta antes de gerar o PDF.');
      return;
    }
    if (imagePdfItems.length === 0) {
      toast.info('Cloud', 'Adicione imagens para gerar o PDF.');
      return;
    }

    try {
      setConvertingImagesToPdf(true);
      const pdfDocument = await PDFDocument.create();

      for (const imageFile of imagePdfItems) {
        const signedUrl = await cloudService.getFileSignedUrl(imageFile.storage_path);
        const response = await fetch(signedUrl);
        if (!response.ok) {
          throw new Error(`Não foi possível baixar ${imageFile.original_name}.`);
        }
        const blob = await response.blob();
        const imageBytes = blob.type.includes('jpeg') || blob.type.includes('jpg')
          ? new Uint8Array(await blob.arrayBuffer())
          : await blobToPngBytes(blob);

        const embeddedImage = blob.type.includes('jpeg') || blob.type.includes('jpg')
          ? await pdfDocument.embedJpg(imageBytes)
          : await pdfDocument.embedPng(imageBytes);

        const page = pdfDocument.addPage([embeddedImage.width, embeddedImage.height]);

        page.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: embeddedImage.width,
          height: embeddedImage.height,
        });
      }

      const pdfBytes = await pdfDocument.save();
      const normalizedName = (imagePdfName || 'imagens-convertidas').trim().replace(/\.pdf$/i, '');
      const pdfBlob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
      const outputFile = new window.File([pdfBlob], `${normalizedName}.pdf`, { type: 'application/pdf' });
      await cloudService.uploadFiles(currentFolderId, [outputFile], currentFolder?.client_id || null);
      setImagePdfModalOpen(false);
      setSelectedImageFileIds([]);
      toast.success('Cloud', 'PDF gerado e salvo na pasta atual.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao converter imagens em PDF.');
    } finally {
      setConvertingImagesToPdf(false);
    }
  };

  const handleMoveFile = async () => {
    if (!selectedFileToMove || !targetFolderId) return;
    try {
      const targetFolder = allFolders.find((item) => item.id === targetFolderId) ?? null;
      await cloudService.moveFile(selectedFileToMove.id, targetFolderId, targetFolder?.client_id || null);
      toast.success('Cloud', 'Arquivo movido com sucesso.');
      setMoveModalOpen(false);
      setSelectedFileToMove(null);
      setTargetFolderId('');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao mover arquivo.');
    }
  };

  const handleCreateShare = async () => {
    if (!selectedFolderForShare) return;
    try {
      const share = await cloudService.createShare({
        folder_id: selectedFolderForShare.id,
        password: sharePassword || undefined,
        expires_at: shareExpiresAt ? new Date(`${shareExpiresAt}T23:59:59`).toISOString() : null,
      });
      const publicUrl = cloudService.buildPublicShareUrl(share.token);
      setActiveShare(share);
      setShareLink(publicUrl);
      toast.success('Cloud', 'Link público salvo com sucesso.');
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao criar link público.');
    }
  };

  const handleDisableShare = async () => {
    if (!activeShare) return;
    try {
      await cloudService.updateShare(activeShare.id, { is_active: false });
      setActiveShare(null);
      setShareLink('');
      setSharePassword('');
      setShareExpiresAt('');
      toast.success('Cloud', 'Link privado novamente.');
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao tornar link privado novamente.');
    }
  };

  const handleClearSharePassword = async () => {
    if (!activeShare) return;
    try {
      const share = await cloudService.updateShare(activeShare.id, { password: '' });
      setActiveShare(share);
      setSharePassword('');
      toast.success('Cloud', 'Senha removida do link.');
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao remover senha do link.');
    }
  };

  const handleDeleteFile = async (file: CloudFile) => {
    try {
      setDeleteModalState({
        open: true,
        title: file.original_name,
        kind: 'file',
        stage: 'processing',
        error: null,
      });
      await cloudService.trashFile(file.id);
      setDeleteModalState({
        open: true,
        title: file.original_name,
        kind: 'file',
        stage: 'success',
        error: null,
      });
      if (deleteModalAutoCloseRef.current) {
        window.clearTimeout(deleteModalAutoCloseRef.current);
      }
      deleteModalAutoCloseRef.current = window.setTimeout(() => {
        setDeleteModalState((prev) => ({ ...prev, open: false }));
      }, 1100);
      toast.success('Cloud', 'Arquivo enviado para a lixeira.');
      await loadData();
    } catch (error: any) {
      setDeleteModalState({
        open: true,
        title: file.original_name,
        kind: 'file',
        stage: 'error',
        error: error.message || 'Erro ao remover arquivo.',
      });
      toast.error('Cloud', error.message || 'Erro ao remover arquivo.');
    }
  };

  const handleRestoreArchivedFile = async (file: CloudFile) => {
    try {
      await cloudService.restoreFile(file.id);
      toast.success('Cloud', file.delete_scheduled_for ? 'Arquivo restaurado da lixeira com sucesso.' : 'Arquivo restaurado com sucesso.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao restaurar arquivo.');
    }
  };

  const handleDeleteFilePermanently = async (file: CloudFile) => {
    const confirmed = window.confirm(`Excluir permanentemente o arquivo "${file.original_name}"?`);
    if (!confirmed) return;

    try {
      setDeleteModalState({
        open: true,
        title: file.original_name,
        kind: 'file',
        stage: 'processing',
        error: null,
      });
      await cloudService.deleteFile(file);
      setDeleteModalState({
        open: true,
        title: file.original_name,
        kind: 'file',
        stage: 'success',
        error: null,
      });
      if (deleteModalAutoCloseRef.current) {
        window.clearTimeout(deleteModalAutoCloseRef.current);
      }
      deleteModalAutoCloseRef.current = window.setTimeout(() => {
        setDeleteModalState((prev) => ({ ...prev, open: false }));
      }, 1100);
      toast.success('Cloud', 'Arquivo excluído permanentemente.');
      await loadData();
    } catch (error: any) {
      setDeleteModalState({
        open: true,
        title: file.original_name,
        kind: 'file',
        stage: 'error',
        error: error.message || 'Erro ao excluir arquivo permanentemente.',
      });
      toast.error('Cloud', error.message || 'Erro ao excluir arquivo permanentemente.');
    }
  };

  const handleEmptyTrash = async () => {
    if (files.length === 0 && folders.length === 0) {
      toast.info('Cloud', 'A lixeira já está vazia.');
      return;
    }

    const confirmed = window.confirm(`Esvaziar a lixeira e excluir permanentemente ${files.length} arquivo(s) e ${folders.length} pasta(s)?`);
    if (!confirmed) return;

    try {
      setDeleteModalState({
        open: true,
        title: `${files.length + folders.length} item(ns) da lixeira`,
        kind: 'file',
        stage: 'processing',
        error: null,
      });

      for (const file of files) {
        await cloudService.deleteFile(file);
      }

      for (const folder of folders) {
        await cloudService.deleteFolder(folder.id);
      }

      setDeleteModalState({
        open: true,
        title: 'Lixeira esvaziada',
        kind: 'file',
        stage: 'success',
        error: null,
      });
      if (deleteModalAutoCloseRef.current) {
        window.clearTimeout(deleteModalAutoCloseRef.current);
      }
      deleteModalAutoCloseRef.current = window.setTimeout(() => {
        setDeleteModalState((prev) => ({ ...prev, open: false }));
      }, 1200);

      toast.success('Cloud', 'Lixeira esvaziada com sucesso.');
      await loadData();
    } catch (error: any) {
      setDeleteModalState({
        open: true,
        title: 'Lixeira',
        kind: 'file',
        stage: 'error',
        error: error.message || 'Erro ao esvaziar a lixeira.',
      });
      toast.error('Cloud', error.message || 'Erro ao esvaziar a lixeira.');
    }
  };

  const handleDragStart = (itemKey: string) => {
    setDraggingItemKey(itemKey);
    setDragVisualState({ folderId: null, mode: clipboardSelection?.mode || 'move' });
  };

  const handleDragEnd = () => {
    setDraggingItemKey(null);
    setDropTargetFolderId(null);
    setDragVisualState(null);
  };

  const handleDropOnSpecialView = async (target: 'archived' | 'trash') => {
    if (!draggingItemKey) return;

    try {
      if (draggingItemKey.startsWith('file:')) {
        const fileId = draggingItemKey.replace('file:', '');
        const file = files.find((item) => item.id === fileId)
          ?? archivedFiles.find((item) => item.id === fileId)
          ?? trashedFiles.find((item) => item.id === fileId)
          ?? allFiles.find((item) => item.id === fileId);
        if (!file) return;

        if (target === 'archived') {
          if (file.archived_at && !file.delete_scheduled_for) return;
          await cloudService.archiveFile(file.id);
          toast.success('Cloud', 'Arquivo arquivado com sucesso.');
        } else {
          if (file.delete_scheduled_for) return;
          await cloudService.trashFile(file.id);
          toast.success('Cloud', 'Arquivo enviado para a lixeira.');
        }
      } else if (draggingItemKey.startsWith('folder:')) {
        const folderId = draggingItemKey.replace('folder:', '');
        const folder = folders.find((item) => item.id === folderId)
          ?? archivedFolders.find((item) => item.id === folderId)
          ?? trashedFolders.find((item) => item.id === folderId)
          ?? allFolders.find((item) => item.id === folderId);
        if (!folder) return;

        if (target === 'archived') {
          if (folder.archived_at && !folder.delete_scheduled_for) return;
          await cloudService.archiveFolder(folder.id);
          toast.success('Cloud', 'Pasta arquivada com sucesso.');
        } else {
          if (folder.delete_scheduled_for) return;
          await cloudService.trashFolder(folder.id);
          toast.success('Cloud', 'Pasta enviada para a lixeira.');
        }
      }

      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || `Erro ao mover item para ${target === 'archived' ? 'Arquivado' : 'Lixeira'}.`);
    } finally {
      setDraggingItemKey(null);
      setDropTargetFolderId(null);
      setDragVisualState(null);
    }
  };

  const handleDropOnFolder = async (targetFolderId: string | null) => {
    if (!draggingItemKey) return;

    try {
      if (draggingItemKey.startsWith('file:')) {
        const fileId = draggingItemKey.replace('file:', '');
        const file = files.find((item) => item.id === fileId)
          ?? archivedFiles.find((item) => item.id === fileId)
          ?? trashedFiles.find((item) => item.id === fileId)
          ?? allFiles.find((item) => item.id === fileId);
        if (!file) return;

        const isSpecialStateFile = Boolean(file.delete_scheduled_for || file.archived_at);
        if (!isSpecialStateFile && file.folder_id === targetFolderId) return;

        const targetFolder = allFolders.find((item) => item.id === targetFolderId) ?? null;
        if (!targetFolderId) {
          if (isSpecialStateFile) {
            await cloudService.restoreFile(fileId);
            toast.success('Cloud', file.delete_scheduled_for ? 'Arquivo restaurado da lixeira.' : 'Arquivo desarquivado com sucesso.');
            return;
          }
          toast.info('Cloud', 'Arquivos não podem ser movidos para a raiz diretamente. Envie-os ou mantenha-os em uma pasta.');
          return;
        }

        if (file.delete_scheduled_for || file.archived_at) {
          await cloudService.restoreFile(fileId);
        }

        await cloudService.moveFile(fileId, targetFolderId, targetFolder?.client_id || null);
        toast.success('Cloud', file.delete_scheduled_for ? 'Arquivo restaurado e movido com sucesso.' : file.archived_at ? 'Arquivo desarquivado e movido com sucesso.' : 'Arquivo movido com sucesso.');
      } else if (draggingItemKey.startsWith('folder:')) {
        const folderId = draggingItemKey.replace('folder:', '');
        if (folderId === targetFolderId) return;

        const folder = folders.find((item) => item.id === folderId)
          ?? archivedFolders.find((item) => item.id === folderId)
          ?? trashedFolders.find((item) => item.id === folderId)
          ?? allFolders.find((item) => item.id === folderId);
        if (!folder) return;

        const isSpecialStateFolder = Boolean(folder.delete_scheduled_for || folder.archived_at);
        if (!isSpecialStateFolder && folder.parent_id === targetFolderId) return;

        const isDescendant = (parentId: string, childId: string): boolean => {
          const children = folderChildrenMap.get(parentId) ?? [];
          for (const child of children) {
            if (child.id === childId) return true;
            if (isDescendant(child.id, childId)) return true;
          }
          return false;
        };

        if (targetFolderId && isDescendant(folderId, targetFolderId)) {
          toast.error('Cloud', 'Não é possível mover uma pasta para dentro de si mesma.');
          return;
        }

        if (folder.delete_scheduled_for) {
          await cloudService.restoreFolder(folderId);
        }

        await cloudService.updateFolder(folderId, {
          parent_id: targetFolderId,
          archived_at: null,
          delete_scheduled_for: null,
        });
        toast.success(
          'Cloud',
          folder.delete_scheduled_for
            ? (targetFolderId ? 'Pasta restaurada e movida com sucesso.' : 'Pasta restaurada para a Caixa de entrada com sucesso.')
            : folder.archived_at
              ? (targetFolderId ? 'Pasta desarquivada e movida com sucesso.' : 'Pasta desarquivada para a Caixa de entrada com sucesso.')
              : (targetFolderId ? 'Pasta movida com sucesso.' : 'Pasta movida para a raiz com sucesso.'),
        );
      }

      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao mover item.');
    } finally {
      setDraggingItemKey(null);
      setDropTargetFolderId(null);
    }
  };

  const openRenameModal = (type: 'file' | 'folder', id: string, currentName: string) => {
    setRenameTarget({ type, id, currentName });
    const { baseName, extension } = splitFileNameAndExtension(currentName);
    setRenameValue(type === 'file' && extension ? baseName : currentName);
    setRenameModalOpen(true);
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;

    try {
      if (renameTarget.type === 'file') {
        const { extension } = splitFileNameAndExtension(renameTarget.currentName);
        const nextName = `${renameValue.trim()}${extension}`;
        await cloudService.renameFile(renameTarget.id, nextName);
        toast.success('Cloud', 'Arquivo renomeado com sucesso.');
      } else {
        await cloudService.updateFolder(renameTarget.id, { name: renameValue.trim() });
        toast.success('Cloud', 'Pasta renomeada com sucesso.');
      }
      setRenameModalOpen(false);
      setRenameTarget(null);
      setRenameValue('');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao renomear.');
    }
  };

  const handleDuplicateFile = async (file: CloudFile) => {
    try {
      await cloudService.duplicateFile(file.id);
      toast.success('Cloud', 'Arquivo duplicado com sucesso.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao duplicar arquivo.');
    }
  };

  const handleCopyFileToClipboard = async (file: CloudFile) => {
    try {
      const signedUrl = await cloudService.getFileSignedUrl(file.storage_path);
      await navigator.clipboard.writeText(signedUrl);
      toast.success('Cloud', 'Link do arquivo copiado para a área de transferência.');
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao copiar link.');
    }
  };

  const isFolderDescendant = useCallback((parentId: string, childId: string): boolean => {
    const children = folderChildrenMap.get(parentId) ?? [];
    for (const child of children) {
      if (child.id === childId) return true;
      if (isFolderDescendant(child.id, childId)) return true;
    }
    return false;
  }, [folderChildrenMap]);

  const handleCutSelectionToFolder = useCallback(async (targetFolder: CloudFolder) => {
    const targetFiles = files.filter((item) => selectedFileKeys.includes(`file:${item.id}`));
    const targetFolders = allFolders.filter((item) => selectedFolderKeys.includes(`folder:${item.id}`));

    if (targetFiles.length === 0 && targetFolders.length === 0) {
      toast.info('Cloud', 'Selecione ao menos um item para recortar.');
      return;
    }

    try {
      for (const file of targetFiles) {
        if (file.folder_id === targetFolder.id) continue;
        await cloudService.moveFile(file.id, targetFolder.id, targetFolder.client_id || null);
      }

      for (const folder of targetFolders) {
        if (folder.id === targetFolder.id) continue;
        if (isFolderDescendant(folder.id, targetFolder.id)) {
          toast.error('Cloud', `Não é possível mover "${folder.name}" para dentro de si mesma.`);
          continue;
        }

        await cloudService.updateFolder(folder.id, {
          parent_id: targetFolder.id,
          client_id: targetFolder.client_id || null,
          archived_at: null,
          delete_scheduled_for: null,
        });
      }

      toast.success('Cloud', 'Seleção recortada para a pasta com sucesso.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao recortar itens para a pasta selecionada.');
    }
  }, [allFolders, cloudService, files, isFolderDescendant, loadData, selectedFileKeys, selectedFolderKeys, toast]);

  const handleCopySelectionToFolder = useCallback(async (targetFolder: CloudFolder) => {
    const targetFiles = files.filter((item) => selectedFileKeys.includes(`file:${item.id}`));
    const targetFolders = allFolders.filter((item) => selectedFolderKeys.includes(`folder:${item.id}`));

    if (targetFiles.length === 0 && targetFolders.length === 0) {
      toast.info('Cloud', 'Selecione ao menos um item para copiar.');
      return;
    }

    try {
      for (const file of targetFiles) {
        await cloudService.duplicateFileToFolder(file.id, targetFolder.id, targetFolder.client_id || null);
      }

      for (const folder of targetFolders) {
        if (folder.id === targetFolder.id) continue;
        if (isFolderDescendant(folder.id, targetFolder.id)) {
          toast.error('Cloud', `Não é possível copiar "${folder.name}" para dentro de si mesma.`);
          continue;
        }

        await cloudService.duplicateFolderToFolder(folder.id, targetFolder.id, targetFolder.client_id || null);
      }

      toast.success('Cloud', 'Conteúdo copiado para a pasta selecionada com sucesso.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao copiar conteúdo para a pasta selecionada.');
    }
  }, [allFolders, cloudService, files, isFolderDescendant, loadData, selectedFileKeys, selectedFolderKeys, toast]);

  const handleDuplicateFolder = useCallback(async (folder: CloudFolder) => {
    try {
      await cloudService.duplicateFolderToFolder(folder.id, folder.parent_id ?? null, folder.client_id ?? null);
      toast.success('Cloud', 'Cópia da pasta criada com sucesso.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao criar cópia da pasta.');
    }
  }, [cloudService, loadData, toast]);

  const handleStoreSelectionInClipboard = useCallback((mode: 'copy' | 'cut', itemKeys?: string[]) => {
    const nextKeys = (itemKeys && itemKeys.length > 0 ? itemKeys : selectedItemKeys).filter(Boolean);
    if (nextKeys.length === 0) {
      toast.info('Cloud', mode === 'copy' ? 'Selecione ao menos um item para copiar.' : 'Selecione ao menos um item para recortar.');
      return;
    }

    setClipboardSelection({ mode, itemKeys: nextKeys });
    setDragVisualState((prev) => prev ? { ...prev, mode } : prev);
    toast.success('Cloud', mode === 'copy' ? 'Seleção copiada. Escolha a pasta de destino e use Colar.' : 'Seleção recortada. Escolha a pasta de destino e use Colar.');
  }, [selectedItemKeys, toast]);

  const handlePasteClipboardToFolder = useCallback(async (targetFolder: CloudFolder | null) => {
    if (pastingClipboard) {
      toast.info('Cloud', 'Aguarde a colagem atual terminar.');
      return;
    }

    if (!clipboardSelection || !targetFolder) {
      toast.info('Cloud', 'Nada para colar no momento.');
      return;
    }

    const clipboardFileKeys = clipboardSelection.itemKeys.filter((key) => key.startsWith('file:'));
    const clipboardFolderKeys = clipboardSelection.itemKeys.filter((key) => key.startsWith('folder:'));
    const targetFiles = allFiles.filter((item) => clipboardFileKeys.includes(`file:${item.id}`));
    const targetFolders = allFolders.filter((item) => clipboardFolderKeys.includes(`folder:${item.id}`));

    if (targetFiles.length === 0 && targetFolders.length === 0) {
      toast.info('Cloud', 'Os itens copiados não estão mais disponíveis.');
      setClipboardSelection(null);
      return;
    }

    const itemCount = targetFiles.length + targetFolders.length;
    const loadingToastId = toast.loading(
      'Cloud',
      itemCount === 1
        ? 'Colando item na pasta selecionada...'
        : `Colando ${itemCount} itens na pasta selecionada...`,
    );

    try {
      setPastingClipboard(true);
      if (clipboardSelection.mode === 'copy') {
        for (const file of targetFiles) {
          await cloudService.duplicateFileToFolder(file.id, targetFolder.id, targetFolder.client_id || null);
        }

        for (const folder of targetFolders) {
          if (folder.id === targetFolder.id) continue;
          if (isFolderDescendant(folder.id, targetFolder.id)) continue;
          await cloudService.duplicateFolderToFolder(folder.id, targetFolder.id, targetFolder.client_id || null);
        }

        toast.success('Cloud', 'Itens colados com cópia na pasta selecionada.');
      } else {
        for (const file of targetFiles) {
          if (file.folder_id === targetFolder.id) continue;
          await cloudService.moveFile(file.id, targetFolder.id, targetFolder.client_id || null);
        }

        for (const folder of targetFolders) {
          if (folder.id === targetFolder.id) continue;
          if (isFolderDescendant(folder.id, targetFolder.id)) continue;
          await cloudService.updateFolder(folder.id, {
            parent_id: targetFolder.id,
            client_id: targetFolder.client_id || null,
            archived_at: null,
            delete_scheduled_for: null,
          });
        }

        setClipboardSelection(null);
        setDragVisualState(null);
        toast.success('Cloud', 'Itens colados com sucesso.');
      }

      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao colar itens na pasta selecionada.');
    } finally {
      toast.dismiss(loadingToastId);
      setPastingClipboard(false);
    }
  }, [allFiles, allFolders, clipboardSelection, cloudService, isFolderDescendant, loadData, pastingClipboard, toast]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (inlineRenameTarget) {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelInlineRename();
        }
        return;
      }

      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable) return;
      if (folderModalOpen || moveModalOpen || shareModalOpen || imagePdfModalOpen || pdfToolsModalOpen) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        if (explorerItemKeys.length === 0) return;
        setSelectedItemKeys(explorerItemKeys);
        setSelectedItemKey(explorerItemKeys[0]);
        setSelectionAnchorKey(explorerItemKeys[0]);
        setContextMenu(null);
        return;
      }

      if (event.key === 'F2' && selectedItemKey) {
        event.preventDefault();
        if (selectedItemKey.startsWith('file:')) {
          const fileId = selectedItemKey.replace('file:', '');
          const file = files.find((item) => item.id === fileId) ?? null;
          if (file) startInlineRename({ type: 'file', id: file.id, currentName: file.original_name });
          return;
        }

        if (selectedItemKey.startsWith('folder:')) {
          const folderId = selectedItemKey.replace('folder:', '');
          const folder = allFolders.find((item) => item.id === folderId) ?? null;
          if (folder) startInlineRename({ type: 'folder', id: folder.id, currentName: folder.name });
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm' && selectedItemKeys.length > 0) {
        event.preventDefault();
        setBulkMoveTargetFolderId('');
        setBulkMoveModalOpen(true);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selectedItemKeys.length > 0) {
        event.preventDefault();
        handleStoreSelectionInClipboard('copy');
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x' && selectedItemKeys.length > 0) {
        event.preventDefault();
        handleStoreSelectionInClipboard('cut');
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && currentFolder && clipboardSelection) {
        event.preventDefault();
        void handlePasteClipboardToFolder(currentFolder);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'r' && selectedItemKeys.length > 0) {
        event.preventDefault();
        setBulkRenameModalOpen(true);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelectionByOffset(viewMode === 'cards' ? -4 : -1);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelectionByOffset(viewMode === 'cards' ? 4 : 1);
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (viewMode === 'cards') {
          moveSelectionByOffset(-1);
          return;
        }

        if (selectedItemKey?.startsWith('folder:')) {
          const folderId = selectedItemKey.replace('folder:', '');
          const folder = allFolders.find((item) => item.id === folderId) ?? null;
          if (folder?.parent_id) {
            const parentKey = `folder:${folder.parent_id}`;
            setCurrentFolderId(folder.parent_id);
            setSelectedItemKey(parentKey);
            setSelectedItemKeys([parentKey]);
            setSelectionAnchorKey(parentKey);
          }
        }
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (viewMode === 'cards') {
          moveSelectionByOffset(1);
          return;
        }

        if (selectedItemKey?.startsWith('folder:')) {
          openSelectedItem(selectedItemKey);
        }
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Del') && selectedItemKeys.length > 0) {
        event.preventDefault();
        void handleDeleteSelectedItems();
        return;
      }

      if (event.key === 'Enter' && selectedItemKey) {
        event.preventDefault();
        openSelectedItem(selectedItemKey);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItemKey, selectedItemKeys, folderModalOpen, moveModalOpen, shareModalOpen, imagePdfModalOpen, pdfToolsModalOpen, files, allFolders, moveSelectionByOffset, openSelectedItem, viewMode, explorerItemKeys, handleDeleteSelectedItems, handlePasteClipboardToFolder, handleStoreSelectionInClipboard, clipboardSelection, currentFolder, inlineRenameTarget, cancelInlineRename, startInlineRename]);

  const toggleTreeFolder = (folderId: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  const handleCreateCustomLabel = () => {
    const trimmed = newLabelName.trim();
    if (!trimmed) return;

    const labelId = normalizeLabelId(trimmed);
    if (!labelId) return;

    const exists = folderLabels.some((item) => item.id === labelId || item.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      toast.info('Cloud', 'Essa etiqueta já existe.');
      return;
    }

    const label: FolderLabelConfig = {
      id: labelId,
      name: trimmed,
      color: newLabelColor,
      bgClass: 'bg-orange-50',
      textClass: 'text-orange-700',
      borderClass: 'border-orange-200',
    };

    setFolderLabels((prev) => [...prev, label]);
    setSelectedFolderLabelId(label.id);
    setNewLabelName('');
    toast.success('Cloud', 'Etiqueta cadastrada com sucesso.');
  };

  const handleAssignFolderLabel = (folderId: string, labelId: string) => {
    setFolderLabelAssignments((prev) => ({ ...prev, [folderId]: labelId }));
  };

  const handleToggleFavoriteFolder = useCallback((folderId: string) => {
    setFavoriteFolderIds((prev) => (
      prev.includes(folderId)
        ? prev.filter((id) => id !== folderId)
        : [folderId, ...prev]
    ));
  }, []);

  const resetAdvancedFilters = useCallback(() => {
    setSearchFilters(EMPTY_CLOUD_SEARCH_FILTERS);
    setShowAdvancedFilters(false);
  }, []);

  const handleBulkRename = useCallback(async () => {
    const targetFiles = files.filter((item) => selectedFileKeys.includes(`file:${item.id}`));
    const targetFolders = allFolders.filter((item) => selectedFolderKeys.includes(`folder:${item.id}`));
    if (targetFiles.length === 0 && targetFolders.length === 0) return;

    const buildName = (name: string) => {
      let nextName = name;
      if (bulkRenameSearch) {
        nextName = nextName.split(bulkRenameSearch).join(bulkRenameReplace);
      }
      return `${bulkRenamePrefix}${nextName}${bulkRenameSuffix}`.trim();
    };

    try {
      for (const file of targetFiles) {
        const nextName = buildName(file.original_name);
        if (nextName) await cloudService.renameFile(file.id, nextName);
      }

      for (const folder of targetFolders) {
        const nextName = buildName(folder.name);
        if (nextName) await cloudService.updateFolder(folder.id, { name: nextName });
      }

      setBulkRenameModalOpen(false);
      setBulkRenamePrefix('');
      setBulkRenameSuffix('');
      setBulkRenameSearch('');
      setBulkRenameReplace('');
      toast.success('Cloud', 'Itens renomeados em lote com sucesso.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao renomear em lote.');
    }
  }, [allFolders, bulkRenamePrefix, bulkRenameReplace, bulkRenameSearch, bulkRenameSuffix, cloudService, files, loadData, selectedFileKeys, selectedFolderKeys, toast]);

  const handleBulkMove = useCallback(async () => {
    if (!bulkMoveTargetFolderId) return;

    const targetFiles = files.filter((item) => selectedFileKeys.includes(`file:${item.id}`));
    const targetFolders = allFolders.filter((item) => selectedFolderKeys.includes(`folder:${item.id}`));
    const targetFolder = allFolders.find((item) => item.id === bulkMoveTargetFolderId) ?? null;

    try {
      for (const file of targetFiles) {
        await cloudService.moveFile(file.id, bulkMoveTargetFolderId, targetFolder?.client_id || null);
      }

      for (const folder of targetFolders) {
        if (folder.id === bulkMoveTargetFolderId) continue;
        await cloudService.updateFolder(folder.id, { parent_id: bulkMoveTargetFolderId });
      }

      setBulkMoveModalOpen(false);
      setBulkMoveTargetFolderId('');
      toast.success('Cloud', 'Itens movidos em lote com sucesso.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao mover itens em lote.');
    }
  }, [allFolders, bulkMoveTargetFolderId, cloudService, files, loadData, selectedFileKeys, selectedFolderKeys, toast]);

  const handleLinkFolderClient = async (folderId: string, clientId: string) => {
    try {
      await cloudService.updateFolder(folderId, { client_id: clientId || null });
      toast.success('Cloud', clientId ? 'Cliente vinculado com sucesso.' : 'Vínculo removido com sucesso.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao atualizar vínculo da pasta.');
    }
  };

  const handleOpenDocxEditor = async (file: CloudFile) => {
    try {
      const signedUrl = await cloudService.getFileSignedUrl(file.storage_path);
      toast.info('Cloud', 'Abrindo arquivo Word no editor de petições...');
      events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN, {
        clientId: file.client_id || currentFolder?.client_id,
        mode: 'new',
        initialDocumentUrl: signedUrl,
        initialDocumentName: file.original_name,
        initialCloudFileId: file.id,
        openRequestId: crypto.randomUUID(),
      });
      setPreviewFile(null);
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao abrir arquivo Word.');
    }
  };

  const triggerBrowserDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadSingleFile = async (file: CloudFile) => {
    const signedUrl = await cloudService.getFileSignedUrl(file.storage_path);
    const response = await fetch(signedUrl);
    if (!response.ok) throw new Error('Não foi possível baixar o arquivo.');
    const blob = await response.blob();
    triggerBrowserDownload(blob, file.original_name || 'arquivo');
  };

  const collectFolderFiles = async (folderId: string, relativePrefix = ''): Promise<Array<{ file: CloudFile; relativePath: string }>> => {
    const [folderFiles, childFolders] = await Promise.all([
      cloudService.listFiles(folderId),
      cloudService.listFolders(folderId),
    ]);

    const currentEntries = folderFiles.map((file) => ({
      file,
      relativePath: `${relativePrefix}${file.original_name}`,
    }));

    const nestedEntries = await Promise.all(
      childFolders.map((folder) => collectFolderFiles(folder.id, `${relativePrefix}${folder.name}/`)),
    );

    return [...currentEntries, ...nestedEntries.flat()];
  };

  const handleDownloadFile = async (file: CloudFile) => {
    try {
      await downloadSingleFile(file);
      rememberRecentFile(file.id);
      toast.success('Cloud', 'Download iniciado.');
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao baixar arquivo.');
    }
  };

  const handleDownloadFolder = async (folder: CloudFolder) => {
    try {
      const entries = await collectFolderFiles(folder.id);
      if (entries.length === 0) {
        toast.info('Cloud', 'A pasta não possui arquivos para download.');
        return;
      }

      if (entries.length === 1) {
        await downloadSingleFile(entries[0].file);
        toast.success('Cloud', 'Download iniciado.');
        return;
      }

      const zip = new JSZip();
      for (const entry of entries) {
        const signedUrl = await cloudService.getFileSignedUrl(entry.file.storage_path);
        const response = await fetch(signedUrl);
        if (!response.ok) {
          throw new Error(`Não foi possível baixar ${entry.file.original_name}.`);
        }
        const blob = await response.blob();
        zip.file(entry.relativePath, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      triggerBrowserDownload(zipBlob, `${folder.name || 'pasta'}.zip`);
      toast.success('Cloud', 'Download da pasta iniciado.');
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao baixar pasta.');
    }
  };

  const handleDeleteFolder = async (folder: CloudFolder) => {
    if (folder.delete_scheduled_for) {
      const confirmedPermanent = window.confirm(`Excluir permanentemente a pasta "${folder.name}"?`);
      if (!confirmedPermanent) return;

      try {
        setDeleteModalState({
          open: true,
          title: folder.name,
          kind: 'folder',
          stage: 'processing',
          error: null,
        });
        await cloudService.deleteFolder(folder.id);
        setDeleteModalState({
          open: true,
          title: folder.name,
          kind: 'folder',
          stage: 'success',
          error: null,
        });
        if (deleteModalAutoCloseRef.current) {
          window.clearTimeout(deleteModalAutoCloseRef.current);
        }
        deleteModalAutoCloseRef.current = window.setTimeout(() => {
          setDeleteModalState((prev) => ({ ...prev, open: false }));
        }, 1100);
        toast.success('Cloud', 'Pasta excluída permanentemente.');
        await loadData();
      } catch (error: any) {
        setDeleteModalState({
          open: true,
          title: folder.name,
          kind: 'folder',
          stage: 'error',
          error: error.message || 'Erro ao excluir pasta.',
        });
        toast.error('Cloud', error.message || 'Erro ao excluir pasta.');
      }
      return;
    }

    const confirmed = window.confirm(`Enviar a pasta "${folder.name}" para a lixeira?`);
    if (!confirmed) return;

    try {
      setDeleteModalState({
        open: true,
        title: folder.name,
        kind: 'folder',
        stage: 'processing',
        error: null,
      });
      await cloudService.trashFolder(folder.id);
      if (currentFolderId === folder.id) {
        setCurrentFolderId(folder.parent_id || null);
      }
      if (selectedItemKey === `folder:${folder.id}`) {
        setSelectedItemKey(null);
      }
      setDeleteModalState({
        open: true,
        title: folder.name,
        kind: 'folder',
        stage: 'success',
        error: null,
      });
      if (deleteModalAutoCloseRef.current) {
        window.clearTimeout(deleteModalAutoCloseRef.current);
      }
      deleteModalAutoCloseRef.current = window.setTimeout(() => {
        setDeleteModalState((prev) => ({ ...prev, open: false }));
      }, 1100);
      toast.success('Cloud', 'Pasta enviada para a lixeira.');
      await loadData();
    } catch (error: any) {
      setDeleteModalState({
        open: true,
        title: folder.name,
        kind: 'folder',
        stage: 'error',
        error: error.message || 'Erro ao excluir pasta.',
      });
      toast.error('Cloud', error.message || 'Erro ao excluir pasta.');
    }
  };

  const handleArchiveFolder = async (folder: CloudFolder) => {
    const confirmed = window.confirm(`Arquivar a pasta "${folder.name}"?`);
    if (!confirmed) return;

    try {
      await cloudService.archiveFolder(folder.id);
      if (currentFolderId === folder.id) {
        setCurrentFolderId(folder.parent_id || null);
      }
      if (selectedItemKey === `folder:${folder.id}`) {
        setSelectedItemKey(null);
      }
      toast.success('Cloud', 'Pasta arquivada com sucesso.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao arquivar pasta.');
    }
  };

  const handleUnarchiveFolder = async (folder: CloudFolder) => {
    try {
      if (folder.delete_scheduled_for) {
        await cloudService.restoreFolder(folder.id);
        toast.success('Cloud', 'Pasta restaurada da lixeira com sucesso.');
      } else {
        await cloudService.updateFolder(folder.id, {
          archived_at: null,
          delete_scheduled_for: null,
        });
        toast.success('Cloud', 'Pasta desarquivada com sucesso.');
      }
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao restaurar pasta.');
    }
  };

  const handleOpenFolderShare = (folder: CloudFolder) => {
    setSelectedFolderForShare(folder);
    setSharePassword('');
    setShareExpiresAt('');
    setShareLink('');
    setActiveShare(null);
    setShareModalOpen(true);
  };

  useEffect(() => {
    if (!shareModalOpen || !selectedFolderForShare) return;

    const loadExistingShare = async () => {
      try {
        const share = await cloudService.getActiveShareByFolder(selectedFolderForShare.id);
        setActiveShare(share);
        if (!share) {
          setShareLink('');
          setShareExpiresAt('');
          return;
        }

        setShareLink(cloudService.buildPublicShareUrl(share.token));
        setShareExpiresAt(share.expires_at ? new Date(share.expires_at).toISOString().slice(0, 10) : '');
      } catch (error: any) {
        toast.error('Cloud', error.message || 'Erro ao carregar link compartilhado.');
      }
    };

    void loadExistingShare();
  }, [shareModalOpen, selectedFolderForShare, toast]);

  const openFolderFromContextMenu = (folder: CloudFolder) => {
    setCurrentFolderId(folder.id);
    setSelectedItemKey(`folder:${folder.id}`);
    setContextMenu(null);
  };

  const openFileFromContextMenu = (file: CloudFile) => {
    setSelectedItemKey(`file:${file.id}`);
    if (isWordFile(file.mime_type, file.original_name)) {
      handleOpenDocxEditor(file);
    } else {
      setPreviewFile(file);
    }
    setContextMenu(null);
  };

  const selectedContextFolder = useMemo(() => {
    if (!contextMenu || contextMenu.type !== 'folder') return null;
    return allFolders.find((item) => item.id === contextMenu.folderId) ?? null;
  }, [allFolders, contextMenu]);

  const selectedContextFile = useMemo(() => {
    if (!contextMenu || contextMenu.type !== 'file') return null;
    return files.find((item) => item.id === contextMenu.fileId) ?? null;
  }, [files, contextMenu]);

  const canPasteSelectionIntoContextFolder = useMemo(() => {
    if (!selectedContextFolder || selectedContextFolder.archived_at || selectedContextFolder.delete_scheduled_for) return false;
    if (selectedItemKeys.length === 0) return false;
    if (selectedItemKeys.includes(`folder:${selectedContextFolder.id}`)) return false;
    return true;
  }, [selectedContextFolder, selectedItemKeys]);

  const canPasteClipboardIntoContextFolder = useMemo(() => {
    if (!selectedContextFolder || !clipboardSelection) return false;
    if (selectedContextFolder.archived_at || selectedContextFolder.delete_scheduled_for) return false;
    if (clipboardSelection.itemKeys.includes(`folder:${selectedContextFolder.id}`)) return false;
    return clipboardSelection.itemKeys.length > 0;
  }, [clipboardSelection, selectedContextFolder]);

  const canPasteClipboardIntoCurrentFolder = useMemo(() => {
    return Boolean(currentFolder && clipboardSelection && clipboardSelection.itemKeys.length > 0);
  }, [clipboardSelection, currentFolder]);

  const canStoreSelectionInClipboard = useMemo(() => selectedItemKeys.length > 0, [selectedItemKeys]);

  const handleOpenInPetitionModule = () => {
    events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN, {
      clientId: selectedFile?.client_id || selectedFolder?.client_id,
      mode: 'new',
    });
    toast.info('Cloud', 'Editor de petição aberto.');
  };

  const renderTree = (items: CloudFolder[], depth = 0): React.ReactNode => {
    return items.map((folder) => {
      const children = inboxFolderChildrenMap.get(folder.id) ?? [];
      const expanded = expandedFolders[folder.id] ?? false;
      const isActive = currentFolderId === folder.id;

      const isDropTarget = dropTargetFolderId === folder.id;
      const hasClientLink = Boolean(folder.client_id);
      const showClientLinkBadge = !folder.parent_id;

      return (
        <div key={folder.id}>
          <div
            className={`flex items-start gap-1 rounded-md px-2 py-1.5 text-sm transition ${
              isDropTarget ? 'bg-orange-200 ring-2 ring-orange-400' : isActive ? 'bg-orange-100 text-orange-900' : 'text-slate-700 hover:bg-orange-50'
            }`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            onDragOver={(e) => {
              e.preventDefault();
              if (draggingItemKey && !draggingItemKey.includes(folder.id)) {
                setDropTargetFolderId(folder.id);
              }
            }}
            onDragLeave={() => setDropTargetFolderId(null)}
            onDrop={(e) => {
              e.preventDefault();
              void handleDropOnFolder(folder.id);
            }}
          >
            <button
              type="button"
              onClick={() => children.length > 0 && toggleTreeFolder(folder.id)}
              className="mt-1 flex h-4 w-4 items-center justify-center text-slate-400"
            >
              {children.length > 0 ? (expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : null}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                const itemKey = `folder:${folder.id}`;
                applySelection(itemKey, {
                  additive: event.ctrlKey || event.metaKey,
                  range: event.shiftKey,
                });
                if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
                  setCurrentFolderId(folder.id);
                }
              }}
              className="flex min-w-0 flex-1 items-start gap-2 text-left"
            >
              {isActive ? <FolderOpen className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-500" /> : <Folder className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-500" />}
              <span className="flex min-w-0 flex-1 items-start gap-1.5">
                <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis break-words text-[13px] leading-5 text-inherit" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }} title={folder.name}>
                  {folder.name}
                </span>
                {showClientLinkBadge ? (
                  <span className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${hasClientLink ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-600'}`} title={hasClientLink ? 'Pasta vinculada' : 'Pasta sem vínculo'}>
                    {hasClientLink ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  </span>
                ) : null}
              </span>
            </button>
          </div>
          {expanded && children.length > 0 ? renderTree(children, depth + 1) : null}
        </div>
      );
    });
  };

  return (
    <div className="w-full border border-slate-200 bg-white shadow-sm flex flex-col overflow-visible">

      <div className="border-b border-slate-200 bg-white px-2 py-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSidebarOpen((prev) => !prev)}
          className="inline-flex lg:hidden items-center gap-2 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-sm border border-slate-200 shadow-sm"
        >
          <Cloud className="w-4 h-4 text-orange-600" />
          {sidebarOpen ? 'Ocultar navegação' : 'Navegação'}
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && handleUploadFiles(e.target.files)} />
      </div>

      {showAdvancedFilters ? (
        <div className="border-b border-slate-200 bg-slate-50 px-2 py-2.5">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <select value={searchFilters.clientId} onChange={(e) => setSearchFilters((prev) => ({ ...prev, clientId: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400">
              <option value="">Todos os clientes</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}
            </select>
            <select value={searchFilters.labelId} onChange={(e) => setSearchFilters((prev) => ({ ...prev, labelId: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400">
              <option value="">Todas as etiquetas</option>
              {folderLabels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
            </select>
            <select value={searchFilters.extension} onChange={(e) => setSearchFilters((prev) => ({ ...prev, extension: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400">
              <option value="">Todas as extensões</option>
              {availableExtensions.map((extension) => <option key={extension} value={extension}>{extension.toUpperCase()}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={searchFilters.dateFrom} onChange={(e) => setSearchFilters((prev) => ({ ...prev, dateFrom: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
              <input type="date" value={searchFilters.dateTo} onChange={(e) => setSearchFilters((prev) => ({ ...prev, dateTo: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
            </div>
            <input type="number" min="0" value={searchFilters.sizeMinKb} onChange={(e) => setSearchFilters((prev) => ({ ...prev, sizeMinKb: e.target.value }))} placeholder="Tamanho mín. KB" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
            <input type="number" min="0" value={searchFilters.sizeMaxKb} onChange={(e) => setSearchFilters((prev) => ({ ...prev, sizeMaxKb: e.target.value }))} placeholder="Tamanho máx. KB" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button onClick={resetAdvancedFilters} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50">Limpar filtros</button>
          </div>
        </div>
      ) : null}

      <div className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-slate-100/80 px-3 py-1 flex flex-col gap-1.5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center flex-wrap gap-1 text-sm text-slate-600 min-w-0 xl:flex-[0.9]">
          <button onClick={() => setCurrentFolderId(null)} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 hover:bg-white/70 hover:text-slate-900"><Home className="w-4 h-4" /></button>
          {breadcrumb.map((item) => (
            <React.Fragment key={item.id}>
              <ChevronRight className="w-4 h-4 text-slate-400" />
              <button onClick={() => setCurrentFolderId(item.id)} className="rounded-md px-2 py-0.5 hover:bg-white/70 hover:text-slate-900 truncate max-w-[220px]">{item.name}</button>
            </React.Fragment>
          ))}
        </div>
        <div className="w-full xl:max-w-2xl xl:flex-[1.25] xl:px-1">
          <div className="relative w-full flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={hasGlobalSearch ? 'Buscar em todo o Cloud' : 'Pesquisar nesta pasta'}
              className="w-full rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 pl-9 pr-3 py-1.5 shadow-sm focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
            <span className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500">{headerClient?.full_name || 'Sem cliente'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap xl:justify-end xl:flex-[0.9]">
          {uploading ? <Loader2 className="w-4 h-4 text-orange-600 animate-spin" /> : null}
          {uploadQueueSummary.totalItems > 0 ? (
            <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-orange-700">
              Uploads {uploadQueueSummary.completedItems}/{uploadQueueSummary.totalItems}
            </span>
          ) : null}
          {!isTrashView && !isArchivedView && selectedFolder && !selectedFolder.archived_at ? (
            <button
              type="button"
              onClick={() => void handleArchiveFolder(selectedFolder)}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
            >
              <FolderOpen className="w-4 h-4" />
              Arquivar pasta
            </button>
          ) : null}
          {isTrashView ? (
            <button
              type="button"
              onClick={() => void handleEmptyTrash()}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              <Trash2 className="w-4 h-4" />
              Esvaziar lixeira
            </button>
          ) : null}
          {selectedFolder || selectedFile ? (
            <button
              type="button"
              onClick={() => setDetailsDrawerOpen((prev) => !prev)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${detailsDrawerOpen ? 'border-slate-300 bg-slate-900 text-white hover:bg-slate-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              <Info className="w-4 h-4" />
              {detailsDrawerOpen ? 'Ocultar detalhes' : 'Mostrar detalhes'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-start">
        <aside className={`${sidebarOpen ? 'flex' : 'hidden'} lg:sticky lg:top-20 lg:self-start lg:flex w-full lg:w-[340px] border-b lg:border-b-0 lg:border-r border-slate-100 bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] flex-col`}>
          <div className="p-2 space-y-3">
            <div className="space-y-1 rounded-2xl border border-slate-200 bg-white/80 p-2 shadow-sm">
            <button
              type="button"
              onClick={() => {
                setCurrentFolderId(null);
                setSelectedItemKey('root');
              }}
              className={`w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${
                dropTargetFolderId === '__root__'
                  ? 'bg-orange-100 text-orange-900 border border-orange-300'
                  : currentFolderId === null
                    ? 'bg-orange-100 text-orange-900 border border-orange-200'
                    : 'text-slate-700 hover:bg-slate-50 border border-transparent'
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggingItemKey) {
                  setDropTargetFolderId('__root__');
                }
              }}
              onDragLeave={() => setDropTargetFolderId(null)}
              onDrop={(e) => {
                e.preventDefault();
                void handleDropOnFolder(null);
              }}
            >
              <HardDrive className="w-4 h-4 text-orange-600" />
              <span className="min-w-0 truncate font-medium">Caixa de entrada</span>
            </button>
            {renderTree(rootFolders)}
            <button
              type="button"
              onClick={() => {
                setCurrentFolderId(CLOUD_ARCHIVED_FOLDER_ID);
                setSelectedItemKey(`folder:${CLOUD_ARCHIVED_FOLDER_ID}`);
                setSelectedItemKeys([`folder:${CLOUD_ARCHIVED_FOLDER_ID}`]);
              }}
              className={`mt-2 w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${
                dropTargetFolderId === CLOUD_ARCHIVED_FOLDER_ID
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : isArchivedView
                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                    : 'text-slate-700 hover:bg-slate-50 border border-transparent'
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggingItemKey) {
                  setDropTargetFolderId(CLOUD_ARCHIVED_FOLDER_ID);
                }
              }}
              onDragLeave={() => setDropTargetFolderId(null)}
              onDrop={(e) => {
                e.preventDefault();
                void handleDropOnSpecialView('archived');
              }}
            >
              <FolderOpen className="w-4 h-4 text-amber-500" />
              <span className="min-w-0 truncate font-medium">Arquivado</span>
              <span className="ml-auto rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[10px] text-amber-700">{archivedRootFolders.length + archivedRootFiles.length}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setCurrentFolderId(CLOUD_TRASH_FOLDER_ID);
                setSelectedItemKey(`folder:${CLOUD_TRASH_FOLDER_ID}`);
                setSelectedItemKeys([`folder:${CLOUD_TRASH_FOLDER_ID}`]);
              }}
              className={`mt-1 w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${
                dropTargetFolderId === CLOUD_TRASH_FOLDER_ID
                  ? 'bg-red-100 text-red-700 border border-red-300'
                  : isTrashView
                    ? 'bg-red-100 text-red-700 border border-red-200'
                    : 'text-slate-700 hover:bg-slate-50 border border-transparent'
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggingItemKey) {
                  setDropTargetFolderId(CLOUD_TRASH_FOLDER_ID);
                }
              }}
              onDragLeave={() => setDropTargetFolderId(null)}
              onDrop={(e) => {
                e.preventDefault();
                void handleDropOnSpecialView('trash');
              }}
            >
              <Trash2 className="w-4 h-4 text-red-500" />
              <span className="min-w-0 truncate font-medium">Lixeira</span>
              <span className="ml-auto rounded-full border border-red-200 bg-white px-2 py-0.5 text-[10px] text-red-600">{trashedRootFiles.length + trashedRootFolders.length}</span>
            </button>
            </div>

            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400 font-semibold">Acesso rápido</p>
              <div className="space-y-1">
                {favoriteFolders.length === 0 ? (
                  <p className="px-2 text-xs text-slate-500">Nenhuma pasta fixada.</p>
                ) : (
                  favoriteFolders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => {
                        setCurrentFolderId(folder.id);
                        setSelectedItemKey(`folder:${folder.id}`);
                        setSelectedItemKeys([`folder:${folder.id}`]);
                      }}
                      className="w-full min-w-0 flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <Pin className="w-4 h-4 text-orange-500" />
                      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400 font-semibold">Arquivos favoritos</p>
              <div className="space-y-1">
                {favoriteFiles.length === 0 ? (
                  <p className="px-2 text-xs text-slate-500">Nenhum arquivo fixado.</p>
                ) : (
                  favoriteFiles.slice(0, 8).map((file) => (
                    <button key={file.id} type="button" onClick={() => openSelectedItem(`file:${file.id}`)} className="w-full min-w-0 flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                      <Pin className="w-4 h-4 text-orange-500" />
                      <span className="min-w-0 flex-1 truncate">{file.original_name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400 font-semibold">Recentes</p>
                <History className="w-4 h-4 text-slate-400" />
              </div>
              <div className="space-y-1">
                {recentFiles.length === 0 ? (
                  <p className="px-2 text-xs text-slate-500">Nenhum arquivo recente.</p>
                ) : (
                  recentFiles.slice(0, 8).map((file) => (
                    <button key={file.id} type="button" onClick={() => openSelectedItem(`file:${file.id}`)} className="w-full min-w-0 flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                      <History className="w-4 h-4 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate">{file.original_name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

          </div>
        </aside>

        <section ref={cloudCenterDropRef} className="flex-1 min-w-0 flex flex-col bg-white overflow-visible">
          <div
            onDragOver={(e) => {
              if (!hasFileDragPayload(e.dataTransfer)) return;
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={(e) => {
              if (!hasFileDragPayload(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              setDragActive(false);
              void handleDropUpload(e.dataTransfer);
            }}
            onClick={(e) => {
              const target = getEventTargetElement(e.target);
              if (target?.closest('[data-cloud-item="true"]')) return;
              clearExplorerSelection();
            }}
            className={`relative flex min-h-full flex-1 flex-col overflow-visible ${dragActive ? 'bg-sky-50' : ''}`}
          >
            {viewMode === 'list' ? (
              <div className="hidden md:grid md:grid-cols-[minmax(260px,2.6fr)_170px_170px_130px_220px] gap-3 px-4 py-2 border-b border-slate-100 text-[11px] uppercase tracking-[0.16em] text-slate-400 bg-slate-50/80">
                <span>Nome</span>
                <span>Data de modificação</span>
                <span>Tipo</span>
                <span>Tamanho</span>
                <span>Cliente</span>
              </div>
            ) : (
              <div className="px-4 py-2 border-b border-slate-100 text-[11px] uppercase tracking-[0.16em] text-slate-400 bg-slate-50/80">
                Exibição em cards
              </div>
            )}

            <div
              ref={explorerViewportRef}
              className="min-h-full flex-1 overflow-visible"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                const target = getEventTargetElement(e.target);
                if (target?.closest('[data-cloud-item="true"]') || target?.closest('button') || target?.closest('input') || target?.closest('a')) return;
                const nextBox = { startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY };
                clearExplorerSelection();
                setSelectionBox(nextBox);
              }}
              onClick={(e) => {
                const target = getEventTargetElement(e.target);
                if (target?.closest('[data-cloud-item="true"]')) return;
                clearExplorerSelection();
              }}
              onContextMenu={(e) => {
                const target = getEventTargetElement(e.target);
                if (target?.closest('[data-cloud-item="true"]')) return;
                e.preventDefault();
                clearExplorerSelection();
                setContextMenu({ x: e.clientX, y: e.clientY, type: 'blank' });
              }}
            >
              {selectionBox ? (
                <div
                  className="pointer-events-none absolute z-20 rounded-lg border border-orange-400 bg-orange-200/20"
                  style={{
                    left: Math.min(selectionBox.startX, selectionBox.currentX) - (explorerViewportRef.current?.getBoundingClientRect().left ?? 0) + (explorerViewportRef.current?.scrollLeft ?? 0),
                    top: Math.min(selectionBox.startY, selectionBox.currentY) - (explorerViewportRef.current?.getBoundingClientRect().top ?? 0) + (explorerViewportRef.current?.scrollTop ?? 0),
                    width: Math.abs(selectionBox.currentX - selectionBox.startX),
                    height: Math.abs(selectionBox.currentY - selectionBox.startY),
                  }}
                />
              ) : null}
              {loading ? (
                <div className="flex items-center justify-center px-4 py-14">
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.24 }}
                    className="relative w-full max-w-md overflow-hidden rounded-[28px] bg-[radial-gradient(circle_at_top,#fff7ed_0%,#ffffff_34%,#fffaf5_100%)] px-8 py-10 text-center shadow-[0_24px_70px_rgba(15,23,42,0.12)]"
                  >
                    <motion.div
                      animate={{ x: ['-100%', '100%'] }}
                      transition={{ repeat: Infinity, duration: 2.4, ease: 'linear' }}
                      className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-transparent via-orange-100/50 to-transparent"
                    />
                    <motion.div
                      animate={{ scale: [1, 1.015, 1], y: [0, -1, 0] }}
                      transition={{ repeat: Infinity, duration: 2.8, ease: 'easeInOut' }}
                      className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-[24px] bg-gradient-to-br from-orange-50 via-white to-amber-50 shadow-[0_12px_35px_rgba(249,115,22,0.18)]"
                    >
                      <motion.div
                        animate={{ scale: [1, 1.18, 1], opacity: [0.32, 0.08, 0.32] }}
                        transition={{ repeat: Infinity, duration: 2.1, ease: 'easeInOut' }}
                        className="absolute inset-0 rounded-[24px] shadow-[inset_0_0_0_1px_rgba(253,186,116,0.28)]"
                      />
                      <motion.div
                        animate={{ scale: [0.88, 1.28], opacity: [0.18, 0] }}
                        transition={{ repeat: Infinity, duration: 1.8, ease: 'easeOut' }}
                        className="absolute inset-[-8px] rounded-[30px] shadow-[inset_0_0_0_1px_rgba(254,215,170,0.45)]"
                      />
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 3.4, ease: 'linear' }}
                        className="absolute inset-[8px] rounded-[20px] shadow-[inset_0_0_0_1px_rgba(253,186,116,0.32)]"
                      >
                        <div className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-gradient-to-r from-orange-400 to-amber-300 shadow-[0_0_14px_rgba(251,146,60,0.55)]" />
                      </motion.div>
                      <motion.div
                        animate={{ y: [0, -2, 0], scale: [1, 1.04, 1] }}
                        transition={{ repeat: Infinity, duration: 1.7, ease: 'easeInOut' }}
                        className="relative"
                      >
                        <Cloud className="h-8 w-8 text-orange-500 drop-shadow-[0_4px_10px_rgba(249,115,22,0.35)]" />
                      </motion.div>
                    </motion.div>
                    <h3 className="mt-6 text-xl font-semibold text-slate-900">Carregando seu Cloud</h3>
                    <p className="mt-2 text-sm text-slate-500">Organizando pastas, arquivos e atalhos para exibir tudo com fluidez.</p>
                    <div className="mt-6 overflow-hidden rounded-full bg-orange-100/80 shadow-inner shadow-orange-200/40">
                      <motion.div
                        className="relative h-2.5 rounded-full bg-gradient-to-r from-orange-400 via-orange-500 to-amber-300"
                        animate={{ x: ['-20%', '108%'], width: ['24%', '46%', '30%'] }}
                        transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
                      >
                        <motion.div
                          animate={{ x: ['-100%', '180%'] }}
                          transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
                          className="absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-transparent via-white/60 to-transparent"
                        />
                      </motion.div>
                    </div>
                    <div className="mt-4 flex items-center justify-center gap-2 text-[11px] font-medium uppercase tracking-[0.24em] text-orange-500/85">
                      <motion.span animate={{ opacity: [0.4, 1, 0.4], y: [0, -1, 0] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0 }}>Sincronizando</motion.span>
                      <motion.span animate={{ opacity: [0.3, 1, 0.3], scale: [0.95, 1, 0.95] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0.18 }} className="inline-flex h-1.5 w-1.5 rounded-full bg-orange-300" />
                      <motion.span animate={{ opacity: [0.4, 1, 0.4], y: [0, -1, 0] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0.24 }}>Pastas</motion.span>
                      <motion.span animate={{ opacity: [0.3, 1, 0.3], scale: [0.95, 1, 0.95] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0.42 }} className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-300" />
                      <motion.span animate={{ opacity: [0.4, 1, 0.4], y: [0, -1, 0] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0.48 }}>Arquivos</motion.span>
                      <motion.span animate={{ opacity: [0.3, 1, 0.3], scale: [0.95, 1, 0.95] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0.66 }} className="inline-flex h-1.5 w-1.5 rounded-full bg-orange-400" />
                      <motion.span animate={{ opacity: [0.4, 1, 0.4], y: [0, -1, 0] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0.72 }}>Atalhos</motion.span>
                    </div>
                  </motion.div>
                </div>
              ) : explorerRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-slate-500 gap-4 px-4 py-14">
                  <div className="w-20 h-20 rounded-3xl bg-orange-50 flex items-center justify-center border border-orange-100">
                    <FolderPlus className="w-10 h-10 text-orange-400" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-slate-900">{isTrashView ? 'A lixeira está vazia' : isArchivedView ? 'Nenhuma pasta arquivada' : 'Esta pasta está vazia'}</p>
                    <p className="text-sm text-slate-500">{isTrashView ? 'Itens excluídos aparecerão aqui.' : isArchivedView ? 'Pastas arquivadas aparecerão aqui.' : 'Crie pastas ou arraste arquivos para dentro.'}</p>
                  </div>
                  {!isTrashView && !isArchivedView ? (
                    <div className="flex items-center gap-2">
                      <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm">
                        <Upload className="w-4 h-4" />
                        Enviar arquivos
                      </button>
                      <button onClick={handleOpenCreateFolder} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 text-sm border border-orange-200">
                        <FolderPlus className="w-4 h-4" />
                        Nova pasta
                      </button>
                    </div>
                  ) : isTrashView ? (
                    <button onClick={() => void handleEmptyTrash()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-sm border border-red-200">
                      <Trash2 className="w-4 h-4" />
                      Esvaziar lixeira
                    </button>
                  ) : null}
                </div>
              ) : (
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={`cloud-view-${viewMode}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className="flex min-h-full flex-1 flex-col"
                  >
                    {viewMode === 'list' ? (
                      <div className="flex min-h-full flex-1 flex-col">
                  {explorerRows.map((row) => {
                  if (row.kind === 'folder') {
                    const folder = row.folder;
                    const client = clients.find((item) => item.id === folder.client_id);
                    const itemKey = `folder:${folder.id}`;
                    const isSelected = selectedItemKeys.includes(itemKey);
                    const folderLabel = getFolderLabel(folder.id);
                    const isDropTarget = dropTargetFolderId === folder.id;
                    const hasClientLink = Boolean(folder.client_id);
                    const showClientLinkBadge = !folder.parent_id;
                    const showFolderStatusBadge = !folder.parent_id;
                    const isFavorite = favoriteFolderIds.includes(folder.id);
                    return (
                      <div
                        key={folder.id}
                        data-cloud-item="true"
                        ref={(node) => { itemElementMapRef.current[itemKey] = node; }}
                        draggable
                        onDragStart={() => handleDragStart(itemKey)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (draggingItemKey && draggingItemKey !== itemKey) {
                            setDropTargetFolderId(folder.id);
                            setDragVisualState({ folderId: folder.id, mode: clipboardSelection?.mode || 'move' });
                          }
                        }}
                        onDragLeave={() => {
                          setDropTargetFolderId(null);
                          setDragVisualState((prev) => prev?.folderId === folder.id ? null : prev);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          void handleDropOnFolder(folder.id);
                        }}
                        className={`flex flex-col gap-2 px-4 py-3 border-b border-slate-100 text-sm cursor-pointer md:grid md:grid-cols-[minmax(260px,2.6fr)_170px_170px_130px_220px] md:gap-3 md:py-2.5 ${
                          isDropTarget ? 'bg-orange-100 border-orange-300' : isSelected ? 'bg-orange-50' : 'hover:bg-slate-50'
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          applySelection(itemKey, { additive: event.ctrlKey || event.metaKey || event.altKey });
                        }}
                        onDoubleClick={() => {
                          cancelDetailsDrawerAutoOpen();
                          setDetailsDrawerOpen(false);
                          setCurrentFolderId(folder.id);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (selectedItemKeys.includes(itemKey)) {
                            setSelectedItemKey(itemKey);
                          } else {
                            setSelectedItemKey(itemKey);
                            setSelectedItemKeys([itemKey]);
                            setSelectionAnchorKey(itemKey);
                          }
                          setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', folderId: folder.id });
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          <div className="min-w-0 flex items-center gap-2">
                            {inlineRenameTarget?.type === 'folder' && inlineRenameTarget.id === folder.id ? (
                              <input
                                value={inlineRenameValue}
                                onChange={(e) => setInlineRenameValue(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void commitInlineRename();
                                  }
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancelInlineRename();
                                  }
                                }}
                                onBlur={() => { void commitInlineRename(); }}
                                className="min-w-[180px] rounded-md border border-orange-300 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100"
                                autoFocus
                              />
                            ) : (
                              <span className="truncate text-slate-900">{folder.name}</span>
                            )}
                            {showClientLinkBadge ? (
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${hasClientLink ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>
                                {hasClientLink ? 'Vinculada' : 'Sem vínculo'}
                              </span>
                            ) : null}
                            {showFolderStatusBadge ? (
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${folderLabel.bgClass} ${folderLabel.textClass} ${folderLabel.borderClass}`}>
                                {folderLabel.name}
                              </span>
                            ) : null}
                            {folder.archived_at ? (
                              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                Arquivada
                              </span>
                            ) : null}
                            {dragVisualState?.folderId === folder.id && dragVisualState.mode ? (
                              <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                                {dragVisualState.mode === 'copy' ? 'Copiar para pasta' : dragVisualState.mode === 'cut' ? 'Recortar para pasta' : 'Mover para pasta'}
                              </span>
                            ) : null}
                            {isFavorite ? <Pin className="w-3.5 h-3.5 text-orange-500" /> : null}
                          </div>
                        </div>
                        <span className="text-slate-500 text-xs md:text-sm">{formatDateTime(folder.updated_at)}</span>
                        <span className="text-slate-500 text-xs md:text-sm">Pasta de arquivos</span>
                        <span className="text-slate-500 text-xs md:text-sm">{formatFileSize(folderSizeMap.get(folder.id) ?? 0)}</span>
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="text-slate-500 truncate">{client?.full_name || '—'}</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleFavoriteFolder(folder.id);
                              }}
                              className={`p-1 rounded-md hover:bg-slate-100 ${isFavorite ? 'text-orange-500' : 'text-slate-400 hover:text-slate-600'}`}
                              title={isFavorite ? 'Desafixar pasta' : 'Fixar pasta'}
                            >
                              <Pin className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (selectedItemKeys.includes(itemKey)) {
                                  setSelectedItemKey(itemKey);
                                } else {
                                  setSelectedItemKey(itemKey);
                                  setSelectedItemKeys([itemKey]);
                                  setSelectionAnchorKey(itemKey);
                                }
                                setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', folderId: folder.id });
                              }}
                              className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const file = row.file;
                  const client = clients.find((item) => item.id === file.client_id);
                  const itemKey = `file:${file.id}`;
                  const isSelected = selectedItemKeys.includes(itemKey);
                  const parentFolder = allFolders.find((folder) => folder.id === file.folder_id) ?? null;
                  const isFavorite = favoriteFileIds.includes(file.id);
                  return (
                    <div
                      key={file.id}
                      data-cloud-item="true"
                      ref={(node) => { itemElementMapRef.current[itemKey] = node; }}
                      draggable
                      onDragStart={() => handleDragStart(itemKey)}
                      onDragEnd={handleDragEnd}
                      className={`flex flex-col gap-2 px-4 py-3 border-b border-slate-100 text-sm cursor-pointer md:grid md:grid-cols-[minmax(260px,2.4fr)_170px_170px_130px_220px] md:gap-3 md:py-2.5 ${
                        isSelected ? 'bg-orange-50' : 'hover:bg-slate-50'
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        event.preventDefault();
                        applySelection(itemKey, { additive: event.ctrlKey || event.metaKey || event.altKey });
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (selectedItemKeys.includes(itemKey)) {
                          setSelectedItemKey(itemKey);
                        } else {
                          setSelectedItemKey(itemKey);
                          setSelectedItemKeys([itemKey]);
                          setSelectionAnchorKey(itemKey);
                        }
                        setContextMenu({ x: e.clientX, y: e.clientY, type: 'file', fileId: file.id });
                      }}
                      onDoubleClick={() => {
                        cancelDetailsDrawerAutoOpen();
                        setDetailsDrawerOpen(false);
                        if (isWordFile(file.mime_type, file.original_name)) {
                          handleOpenDocxEditor(file);
                          return;
                        }
                        setPreviewFile(file);
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {isImageFile(file.mime_type) ? (
                          <input
                            type="checkbox"
                            checked={selectedItemKeys.includes(itemKey)}
                            onChange={() => toggleImageSelection(file.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                          />
                        ) : null}
                        {isPdfFile(file.mime_type, file.original_name) ? <FileText className="w-4 h-4 text-red-500 flex-shrink-0" /> : isImageFile(file.mime_type) ? <ImageIcon className="w-4 h-4 text-emerald-500 flex-shrink-0" /> : <File className="w-4 h-4 text-sky-500 flex-shrink-0" />}
                        {inlineRenameTarget?.type === 'file' && inlineRenameTarget.id === file.id ? (
                          splitFileNameAndExtension(file.original_name).extension ? (
                            <div className="flex min-w-[220px] overflow-hidden rounded-md border border-orange-300 bg-white">
                              <input
                                value={inlineRenameValue}
                                onChange={(e) => setInlineRenameValue(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void commitInlineRename();
                                  }
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancelInlineRename();
                                  }
                                }}
                                onBlur={() => { void commitInlineRename(); }}
                                className="flex-1 px-2 py-1 text-sm text-slate-900 focus:outline-none"
                                autoFocus
                              />
                              <span className="inline-flex items-center border-l border-slate-200 bg-slate-50 px-2 text-xs text-slate-500">{splitFileNameAndExtension(file.original_name).extension}</span>
                            </div>
                          ) : (
                            <input
                              value={inlineRenameValue}
                              onChange={(e) => setInlineRenameValue(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void commitInlineRename();
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  cancelInlineRename();
                                }
                              }}
                              onBlur={() => { void commitInlineRename(); }}
                              className="min-w-[220px] rounded-md border border-orange-300 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100"
                              autoFocus
                            />
                          )
                        ) : (
                          <span className="truncate text-slate-900">{file.original_name}</span>
                        )}
                      </div>
                      <span className="text-slate-500 text-xs md:text-sm">{formatDateTime(file.updated_at)}</span>
                      <span className="text-slate-500 text-xs md:text-sm">{getFileTypeLabel(file)}</span>
                      <span className="text-slate-500 text-xs md:text-sm">{formatFileSize(file.file_size)}</span>
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="text-slate-500 truncate text-xs md:text-sm">{hasGlobalSearch ? `${parentFolder?.name || '—'} • ${client?.full_name || '—'}` : client?.full_name || '—'}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleFavoriteFile(file.id);
                          }}
                          className={`p-1 rounded-md hover:bg-slate-100 ${isFavorite ? 'text-orange-500' : 'text-slate-400 hover:text-slate-600'}`}
                          title={isFavorite ? 'Desafixar arquivo' : 'Fixar arquivo'}
                        >
                          <Pin className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                  })}
                        <div className="flex-1" />
                      </div>
                    ) : (
                      <div
                        className="grid min-h-full w-full flex-1 content-start items-start gap-3 p-4"
                        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardGridMinWidth}px, 1fr))` }}
                      >
                        {explorerRows.map((row) => {
                    if (row.kind === 'folder') {
                      const folder = row.folder;
                      const client = clients.find((item) => item.id === folder.client_id);
                      const itemKey = `folder:${folder.id}`;
                      const isSelected = selectedItemKeys.includes(itemKey);
                      const folderLabel = getFolderLabel(folder.id);
                      const isDropTarget = dropTargetFolderId === folder.id;
                      const hasClientLink = Boolean(folder.client_id);
                      const showClientLinkBadge = !folder.parent_id;
                      const showFolderStatusBadge = !folder.parent_id;
                      const isFavorite = favoriteFolderIds.includes(folder.id);

                      return (
                        <div
                          key={folder.id}
                          data-cloud-item="true"
                          ref={(node) => { itemElementMapRef.current[itemKey] = node; }}
                          draggable
                          onDragStart={() => handleDragStart(itemKey)}
                          onDragEnd={handleDragEnd}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (draggingItemKey && draggingItemKey !== itemKey) {
                              setDropTargetFolderId(folder.id);
                              setDragVisualState({ folderId: folder.id, mode: clipboardSelection?.mode || 'move' });
                            }
                          }}
                          onDragLeave={() => {
                            setDropTargetFolderId(null);
                            setDragVisualState((prev) => prev?.folderId === folder.id ? null : prev);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            void handleDropOnFolder(folder.id);
                          }}
                          className={`rounded-xl border bg-white shadow-sm cursor-pointer transition ${folderCardSizeClasses.cardClass} ${isDropTarget ? 'border-orange-400 bg-orange-100' : isSelected ? 'border-orange-300 bg-orange-50/40' : 'border-slate-200 hover:border-orange-200 hover:shadow-md'}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            event.preventDefault();
                            applySelection(itemKey, { additive: event.ctrlKey || event.metaKey || event.altKey });
                          }}
                          onDoubleClick={() => {
                            cancelDetailsDrawerAutoOpen();
                            setDetailsDrawerOpen(false);
                            setCurrentFolderId(folder.id);
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            // Se o item já não estiver selecionado, adicioná-lo à seleção
                            if (!selectedItemKeys.includes(itemKey)) {
                              applySelection(itemKey, { additive: true });
                            } else {
                              setSelectedItemKey(itemKey);
                            }
                            setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', folderId: folder.id });
                          }}
                          style={{ height: 'fit-content' }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className={`flex items-start min-w-0 ${folderCardSizeClasses.contentGapClass}`}>
                              <div className={`relative flex-shrink-0 ${folderCardSizeClasses.iconWrapperClass}`}>
                                <div className={`absolute rounded-t-md bg-amber-300 border border-amber-400 border-b-0 ${folderCardSizeClasses.iconTopTabClass}`} />
                                <div className={`absolute inset-x-0 rounded-md bg-gradient-to-b from-amber-300 to-amber-400 border border-amber-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] ${folderCardSizeClasses.iconBodyClass}`} />
                                <div className={`absolute rounded-sm bg-white/80 border border-amber-200 ${folderCardSizeClasses.iconBadgeClass}`} />
                                <Folder className={`absolute text-amber-700/80 ${folderCardSizeClasses.folderIconClass}`} />
                              </div>
                              <div className={`min-w-0 flex-1 ${folderCardSizeClasses.titlePaddingClass}`}>
                                {inlineRenameTarget?.type === 'folder' && inlineRenameTarget.id === folder.id ? (
                                  <input
                                    value={inlineRenameValue}
                                    onChange={(e) => setInlineRenameValue(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        void commitInlineRename();
                                      }
                                      if (e.key === 'Escape') {
                                        e.preventDefault();
                                        cancelInlineRename();
                                      }
                                    }}
                                    onBlur={() => { void commitInlineRename(); }}
                                    className="w-full rounded-md border border-orange-300 bg-white px-2 py-1 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100"
                                    autoFocus
                                  />
                                ) : (
                                  <p className="truncate text-sm font-medium text-slate-900 leading-tight">{folder.name}</p>
                                )}
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  {isFavorite ? <Pin className="w-3.5 h-3.5 text-orange-500" /> : null}
                                  {showClientLinkBadge ? (
                                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${hasClientLink ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>
                                      {hasClientLink ? 'Vinculada' : 'Sem vínculo'}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-start gap-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleFavoriteFolder(folder.id);
                                }}
                                className={`p-1.5 rounded-lg hover:bg-slate-100 ${isFavorite ? 'text-orange-500' : 'text-slate-400 hover:text-slate-600'}`}
                              >
                                <Pin className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (selectedItemKeys.includes(itemKey)) {
                                    setSelectedItemKey(itemKey);
                                  } else {
                                    setSelectedItemKey(itemKey);
                                    setSelectedItemKeys([itemKey]);
                                    setSelectionAnchorKey(itemKey);
                                  }
                                  setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', folderId: folder.id });
                                }}
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {showFolderStatusBadge ? (
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${folderLabel.bgClass} ${folderLabel.textClass} ${folderLabel.borderClass}`}>
                                {folderLabel.name}
                              </span>
                            ) : null}
                            {folder.archived_at ? (
                              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                Arquivada
                              </span>
                            ) : null}
                            {dragVisualState?.folderId === folder.id && dragVisualState.mode ? (
                              <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                                {dragVisualState.mode === 'copy' ? 'Copiar para pasta' : dragVisualState.mode === 'cut' ? 'Recortar para pasta' : 'Mover para pasta'}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    }

                    const file = row.file;
                    const itemKey = `file:${file.id}`;
                    const isSelected = selectedItemKeys.includes(itemKey);
                    const previewUrl = cardPreviewUrls[file.id] || null;
                    const canQuickRotate = isImageFile(file.mime_type) || isPdfFile(file.mime_type, file.original_name);
                    const isQuickActionLoading = quickActionFileId === file.id;

                    return (
                      <div
                        key={file.id}
                        data-cloud-item="true"
                        ref={(node) => { itemElementMapRef.current[itemKey] = node; }}
                        draggable
                        onDragStart={() => handleDragStart(itemKey)}
                        onDragEnd={handleDragEnd}
                        className={`rounded-2xl border p-4 bg-white shadow-sm cursor-pointer transition ${isSelected ? 'border-orange-300 bg-orange-50/40' : 'border-slate-200 hover:border-orange-200 hover:shadow-md'}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          applySelection(itemKey, { additive: event.ctrlKey || event.metaKey || event.altKey });
                        }}
                        onDoubleClick={() => {
                          cancelDetailsDrawerAutoOpen();
                          setDetailsDrawerOpen(false);
                          if (isWordFile(file.mime_type, file.original_name)) {
                            handleOpenDocxEditor(file);
                            return;
                          }
                          setPreviewFile(file);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          // Se o item já não estiver selecionado, adicioná-lo à seleção
                          if (!selectedItemKeys.includes(itemKey)) {
                            applySelection(itemKey, { additive: true });
                          } else {
                            setSelectedItemKey(itemKey);
                            if (!selectedItemKeys.length) {
                              setSelectedItemKeys([itemKey]);
                            }
                          }
                          setContextMenu({ x: e.clientX, y: e.clientY, type: 'file', fileId: file.id });
                        }}
                      >
                        <div className="mb-3 relative rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden">
                          <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
                            {canQuickRotate ? (
                              <button
                                type="button"
                                disabled={isQuickActionLoading}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  event.preventDefault();
                                  void handleRotateFileQuick(file, 90);
                                }}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                                title="Girar documento 90°"
                              >
                                {isQuickActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled={isQuickActionLoading}
                              onClick={(event) => {
                                event.stopPropagation();
                                event.preventDefault();
                                void handleDownloadFile(file);
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                              title="Baixar arquivo"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                event.preventDefault();
                                handleToggleFavoriteFile(file.id);
                              }}
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white/95 shadow-sm hover:bg-slate-50 ${favoriteFileIds.includes(file.id) ? 'text-orange-500' : 'text-slate-700'}`}
                              title={favoriteFileIds.includes(file.id) ? 'Desafixar arquivo' : 'Fixar arquivo'}
                            >
                              <Pin className="w-4 h-4" />
                            </button>
                          </div>
                          {isImageFile(file.mime_type) && previewUrl ? (
                            <div className={`${cardPreviewHeightClass} flex items-center justify-center bg-slate-100 p-2`}>
                              <img src={previewUrl} alt={file.original_name} className="h-full w-full rounded-xl object-contain bg-white" />
                            </div>
                          ) : isPdfFile(file.mime_type, file.original_name) && previewUrl ? (
                            <div className={`${cardPreviewHeightClass} flex items-center justify-center bg-slate-100 overflow-hidden`}>
                              <Document
                                key={`${file.id}-${previewUrl}`}
                                file={previewUrl}
                                loading={<div className="flex flex-col items-center justify-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /><span className="text-[11px] font-medium">Carregando PDF</span></div>}
                                error={<div className="flex flex-col items-center justify-center gap-2 text-slate-500"><FileText className="w-10 h-10 text-red-500" /><span className="text-[11px] font-medium">Preview indisponível</span></div>}
                                className="flex h-full w-full items-center justify-center"
                              >
                                <Page
                                  key={`${file.id}-${previewUrl}-page-1`}
                                  pageNumber={1}
                                  width={220}
                                  renderAnnotationLayer={false}
                                  renderTextLayer={false}
                                  loading={<div className="flex flex-col items-center justify-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /><span className="text-[11px] font-medium">Gerando preview</span></div>}
                                />
                              </Document>
                            </div>
                          ) : (
                            <div className={`${cardPreviewHeightClass} flex items-center justify-center bg-slate-50`}>
                              {isPdfFile(file.mime_type, file.original_name) ? <FileText className="w-8 h-8 text-red-500" /> : isImageFile(file.mime_type) ? <ImageIcon className="w-8 h-8 text-emerald-500" /> : <File className="w-8 h-8 text-sky-500" />}
                            </div>
                          )}
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="min-w-0">
                              {inlineRenameTarget?.type === 'file' && inlineRenameTarget.id === file.id ? (
                                file.original_name.toLowerCase().endsWith('.pdf') ? (
                                  <div className="flex overflow-hidden rounded-md border border-orange-300 bg-white">
                                    <input
                                      value={inlineRenameValue}
                                      onChange={(e) => setInlineRenameValue(e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          void commitInlineRename();
                                        }
                                        if (e.key === 'Escape') {
                                          e.preventDefault();
                                          cancelInlineRename();
                                        }
                                      }}
                                      onBlur={() => { void commitInlineRename(); }}
                                      className="flex-1 px-2 py-1 text-sm text-slate-900 focus:outline-none"
                                      autoFocus
                                    />
                                    <span className="inline-flex items-center border-l border-slate-200 bg-slate-50 px-2 text-xs text-slate-500">.pdf</span>
                                  </div>
                                ) : (
                                  <input
                                    value={inlineRenameValue}
                                    onChange={(e) => setInlineRenameValue(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        void commitInlineRename();
                                      }
                                      if (e.key === 'Escape') {
                                        e.preventDefault();
                                        cancelInlineRename();
                                      }
                                    }}
                                    onBlur={() => { void commitInlineRename(); }}
                                    className="w-full rounded-md border border-orange-300 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100"
                                    autoFocus
                                  />
                                )
                              ) : (
                                <p className="truncate font-medium text-slate-900">{file.original_name}</p>
                              )}
                            </div>
                          </div>
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            {getFileTypeLabel(file)}
                          </span>
                          {isImageFile(file.mime_type) ? (
                            <input
                              type="checkbox"
                              checked={selectedItemKeys.includes(itemKey)}
                              onChange={() => toggleImageSelection(file.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-4 h-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500 mt-1"
                            />
                          ) : null}
                        </div>
                      </div>
                    );
                        })}
                        <div className="col-span-full min-h-[160px] w-full" />
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              )}
            </div>

            {dragActive ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/12 backdrop-blur-[2px] p-4">
                <div className="w-full max-w-3xl rounded-[32px] border border-dashed border-orange-300 bg-white/96 px-8 py-12 text-center shadow-[0_30px_90px_rgba(15,23,42,0.16)]">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] bg-gradient-to-br from-orange-50 via-white to-amber-50 shadow-[0_18px_45px_rgba(249,115,22,0.20)]">
                    <Upload className="h-9 w-9 text-orange-500" />
                  </div>
                  <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.32em] text-orange-500/80">Upload no Cloud</p>
                  <h3 className="mt-3 text-3xl font-semibold text-slate-900">Solte os arquivos aqui</h3>
                  <p className="mt-3 text-base text-slate-600">
                    Envie diretamente para <span className="font-semibold text-slate-900">{currentFolder?.name || 'a pasta atual'}</span>
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <AnimatePresence>
        {(selectedFolder || selectedFile) && detailsDrawerOpen ? (
          <>
            <motion.div
              key="cloud-details-drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 z-20 bg-slate-900/20 backdrop-blur-[1px]"
              onClick={() => setDetailsDrawerOpen(false)}
            />
            <motion.aside
              key="cloud-details-drawer"
              initial={{ x: '100%', opacity: 0.98 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0.98 }}
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
              className="absolute inset-y-0 right-0 z-30 flex w-full max-w-[340px] flex-col border-l border-slate-200 bg-slate-50 shadow-[-12px_0_40px_rgba(15,23,42,0.12)]"
            >
              <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Painel</p>
                  <p className="text-sm font-medium text-slate-900">Detalhes do item</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailsDrawerOpen(false)}
                  className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-4">
                {selectedFolder ? (
                  <>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <FolderOpen className="w-8 h-8 text-amber-500" />
                      <div className="min-w-0">
                        <p className="text-slate-900 font-semibold truncate">{selectedFolder.name}</p>
                        <p className="text-xs text-slate-500">Pasta</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {folderLabels.map((label) => {
                        const active = getFolderLabel(selectedFolder.id).id === label.id;
                        return (
                          <button
                            key={label.id}
                            type="button"
                            onClick={() => handleAssignFolderLabel(selectedFolder.id, label.id)}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                              active ? `${label.bgClass} ${label.textClass} ${label.borderClass}` : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <Tag className="w-3 h-3" />
                            {label.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="space-y-2 text-sm">
                      <div>
                        <p className="text-slate-400 text-xs">Cliente</p>
                        <p className="text-slate-700">{clients.find((item) => item.id === selectedFolder.client_id)?.full_name || 'Sem cliente vinculado'}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-xs">Modificado</p>
                        <p className="text-slate-700">{formatDateTime(selectedFolder.updated_at)}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-xs">Local</p>
                        <p className="text-slate-700">{breadcrumbLabel}</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    <p className="text-sm font-medium text-slate-900">Vincular cliente</p>
                    <ClientSearchSelect
                      value={selectedFolder.client_id || ''}
                      onChange={(clientId) => handleLinkFolderClient(selectedFolder.id, clientId)}
                      placeholder="Buscar cliente para vincular"
                      allowCreate={false}
                    />
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    <p className="text-sm font-medium text-slate-900">Adicionar mais etiqueta</p>
                    <div className="grid grid-cols-1 gap-3">
                      <input
                        value={newLabelName}
                        onChange={(e) => setNewLabelName(e.target.value)}
                        placeholder="Ex: Protocolado"
                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400"
                      />
                      <div className="flex items-center gap-3">
                        <input type="color" value={newLabelColor} onChange={(e) => setNewLabelColor(e.target.value)} className="w-16 h-11 rounded-xl border border-slate-200 bg-white p-1" />
                        <button type="button" onClick={handleCreateCustomLabel} className="flex-1 px-4 py-2.5 rounded-xl bg-orange-50 text-orange-700 border border-orange-200 text-sm font-medium hover:bg-orange-100">
                          Adicionar mais
                        </button>
                      </div>
                    </div>
                  </div>
                  {selectedFolder.archived_at ? (
                    <button
                      onClick={() => handleUnarchiveFolder(selectedFolder)}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-sm border border-emerald-200"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Desarquivar pasta
                    </button>
                  ) : (
                    <button
                      onClick={() => handleArchiveFolder(selectedFolder)}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm border border-amber-200"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Arquivar pasta
                    </button>
                  )}
                  <button
                    onClick={() => void handleDownloadFolder(selectedFolder)}
                    disabled={downloadingFolderId === selectedFolder.id}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm border border-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {downloadingFolderId === selectedFolder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {downloadingFolderId === selectedFolder.id ? 'Preparando download...' : 'Baixar pasta'}
                  </button>
                  <button
                    onClick={() => {
                      setSelectedFolderForShare(selectedFolder);
                      setSharePassword('');
                      setShareExpiresAt('');
                      setShareLink('');
                      setShareModalOpen(true);
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm"
                  >
                    <Share2 className="w-4 h-4" />
                    Compartilhar pasta
                  </button>
                  </>
                ) : selectedFile ? (
                  <>
                    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        {isPdfFile(selectedFile.mime_type, selectedFile.original_name) ? <FileText className="w-6 h-6 text-red-500" /> : isImageFile(selectedFile.mime_type) ? <ImageIcon className="w-6 h-6 text-emerald-500" /> : isVideoFile(selectedFile.mime_type, selectedFile.original_name) ? <CloudCog className="w-6 h-6 text-orange-500" /> : <File className="w-6 h-6 text-sky-500" />}
                        <div className="min-w-0">
                          <p className="text-slate-900 font-semibold truncate">{selectedFile.original_name}</p>
                          <div className="mt-1">
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                              {getFileTypeLabel(selectedFile)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <button onClick={() => {
                        if (isWordFile(selectedFile.mime_type, selectedFile.original_name)) {
                          handleOpenDocxEditor(selectedFile);
                          return;
                        }
                        setPreviewFile(selectedFile);
                      }} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm">
                        <FileText className="w-4 h-4" />
                        {isWordFile(selectedFile.mime_type, selectedFile.original_name) ? 'Abrir editor' : 'Abrir preview'}
                      </button>
                      <button
                        onClick={() => handleDownloadFile(selectedFile)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm border border-slate-200"
                      >
                        <Download className="w-4 h-4" />
                        Baixar arquivo
                      </button>
                      {isWordFile(selectedFile.mime_type, selectedFile.original_name) ? (
                        <button
                          onClick={() => void handleConvertWordToPdf(selectedFile)}
                          disabled={wordToPdfFileId === selectedFile.id}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {wordToPdfFileId === selectedFile.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                          {wordToPdfFileId === selectedFile.id ? 'Convertendo...' : 'Converter em PDF'}
                        </button>
                      ) : null}
                      {isImageFile(selectedFile.mime_type) ? (
                        <button
                          onClick={() => openConvertImagesModal(selectedImageFiles.some((item) => item.id === selectedFile.id) ? undefined : [selectedFile])}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm"
                        >
                          <FileText className="w-4 h-4" />
                          Converter PDF
                        </button>
                      ) : null}
                      {isPdfFile(selectedFile.mime_type, selectedFile.original_name) ? (
                        <button
                          onClick={() => void openPdfToolsModal(selectedFile)}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm"
                        >
                          <Scissors className="w-4 h-4" />
                          Hub PDF
                        </button>
                      ) : null}
                      <button
                        onClick={() => {
                          setSelectedFileToMove(selectedFile);
                          setTargetFolderId('');
                          setMoveModalOpen(true);
                        }}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm border border-slate-200"
                      >
                        <MoveRight className="w-4 h-4" />
                        Mover arquivo
                      </button>
                      {selectedFile.archived_at ? (
                        <button onClick={() => void handleRestoreArchivedFile(selectedFile)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-sm border border-emerald-200">
                          <FolderOpen className="w-4 h-4" />
                          Desarquivar arquivo
                        </button>
                      ) : null}
                      <button onClick={() => handleDeleteFile(selectedFile)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-sm border border-red-200">
                        <Trash2 className="w-4 h-4" />
                        Excluir arquivo
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
  
      {folderModalOpen && (
        <div className="fixed inset-0 z-[120] bg-slate-900/25 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] border border-slate-200 overflow-hidden">
            <div className="h-2 w-full bg-gradient-to-r from-orange-500 to-orange-600" />
            <div className="p-5 sm:p-6 space-y-5 bg-white">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Cloud</p>
                  <h3 className="text-xl font-semibold text-slate-900">Nova pasta</h3>
                </div>
                <button onClick={() => setFolderModalOpen(false)} className="rounded-xl p-2 hover:bg-slate-100 transition"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
              {currentFolderId ? (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome da subpasta</label>
                  <input value={folderName} onChange={(e) => setFolderName(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" placeholder="Ex: Documentos" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                      <input value={folderName} onChange={(e) => setFolderName(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" placeholder="Ex: Contratos do cliente" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Etiqueta inicial</label>
                      <select value={selectedFolderLabelId} onChange={(e) => setSelectedFolderLabelId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400">
                        {folderLabels.map((label) => (
                          <option key={label.id} value={label.id}>{label.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <ClientSearchSelect value={folderClientId} onChange={(clientId) => setFolderClientId(clientId)} label="Vincular a cliente" required={false} allowCreate={false} />
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <p className="text-sm font-medium text-slate-900">Cadastrar nova etiqueta</p>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_auto] gap-3">
                      <input value={newLabelName} onChange={(e) => setNewLabelName(e.target.value)} placeholder="Ex: Em análise" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
                      <input type="color" value={newLabelColor} onChange={(e) => setNewLabelColor(e.target.value)} className="w-full h-[50px] rounded-xl border border-slate-200 bg-white p-2" />
                      <button type="button" onClick={handleCreateCustomLabel} className="px-4 py-3 rounded-xl bg-orange-50 text-orange-700 border border-orange-200 text-sm font-medium hover:bg-orange-100">
                        Cadastrar etiqueta
                      </button>
                    </div>
                  </div>
                </>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setFolderModalOpen(false)} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50">Cancelar</button>
                <button onClick={handleCreateFolder} className="px-5 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">Criar pasta</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {moveModalOpen && selectedFileToMove && (
        <div className="fixed inset-0 z-[120] bg-slate-900/25 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] border border-slate-200 overflow-hidden">
            <div className="h-2 w-full bg-gradient-to-r from-orange-500 to-orange-600" />
            <div className="p-5 sm:p-6 space-y-5 bg-white">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Cloud</p>
                  <h3 className="text-xl font-semibold text-slate-900">Mover arquivo</h3>
                </div>
                <button onClick={() => setMoveModalOpen(false)} className="rounded-xl p-2 hover:bg-slate-100 transition"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Arquivo: <span className="font-medium text-slate-900">{selectedFileToMove.original_name}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Pasta de destino</label>
                <select value={targetFolderId} onChange={(e) => setTargetFolderId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400">
                  <option value="">Selecione a pasta destino</option>
                  {moveTargetOptions.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setMoveModalOpen(false)} className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
                <button onClick={handleMoveFile} className="px-5 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">Mover</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {shareModalOpen && selectedFolderForShare && (
        <div className="fixed inset-0 z-[120] bg-slate-900/25 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] border border-slate-200 overflow-hidden">
            <div className="h-2 w-full bg-gradient-to-r from-orange-500 to-orange-600" />
            <div className="p-5 sm:p-6 space-y-5 bg-white">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Cloud</p>
                  <h3 className="text-xl font-semibold text-slate-900">Compartilhar pasta</h3>
                </div>
                <button onClick={() => setShareModalOpen(false)} className="rounded-xl p-2 hover:bg-slate-100 transition"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Pasta: <span className="font-medium text-slate-900">{selectedFolderForShare.name}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Senha (opcional)</label>
                <input value={sharePassword} onChange={(e) => setSharePassword(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" placeholder="Defina uma senha para o link" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Expira em (opcional)</label>
                <input type="date" value={shareExpiresAt} onChange={(e) => setShareExpiresAt(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
              </div>
              {activeShare ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <p className="font-medium">Link único já gerado para esta pasta</p>
                  <p className="text-xs mt-1 text-emerald-700">Você pode manter o mesmo link, atualizar senha/validade ou tornar a pasta privada novamente.</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Ainda não existe link compartilhado para esta pasta.
                </div>
              )}
              {shareLink && (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                  <p className="text-xs font-medium text-sky-700 mb-2">Link público</p>
                  <div className="flex gap-2">
                    <input value={shareLink} readOnly className="flex-1 rounded-xl border border-sky-200 px-3 py-2.5 text-sm bg-white text-slate-900" />
                    <button onClick={async () => {
                      await navigator.clipboard.writeText(shareLink);
                      toast.success('Cloud', 'Link copiado.');
                    }} className="px-3 py-2.5 rounded-xl bg-sky-600 text-white hover:bg-sky-700 transition">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
              {activeShare ? (
                <div className="flex flex-wrap gap-2">
                  <button onClick={handleClearSharePassword} className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">
                    Remover senha
                  </button>
                  <button onClick={handleDisableShare} className="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-sm font-medium text-red-700 hover:bg-red-100">
                    Tornar privado novamente
                  </button>
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <button onClick={() => setShareModalOpen(false)} className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">Fechar</button>
                <button onClick={handleCreateShare} className="px-5 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">{activeShare ? 'Salvar link' : 'Gerar link'}</button>
              </div>
          </div>
        </div>
        </div>
      )}

      {previewFile && (
        <div className={`fixed inset-0 z-[130] bg-slate-900/25 backdrop-blur-sm flex justify-center ${isPdfFile(previewFile.mime_type, previewFile.original_name) ? 'items-center p-3 sm:p-4' : 'items-center p-4'}`}>
          <div className={`w-full ${isDocxFile(previewFile.mime_type, previewFile.original_name) ? 'max-w-[98vw] h-[94vh]' : isPdfFile(previewFile.mime_type, previewFile.original_name) ? 'max-w-[96vw] h-[94vh]' : isVideoFile(previewFile.mime_type, previewFile.original_name) ? 'max-w-[96vw] h-[92vh]' : 'max-w-6xl h-[88vh]'} rounded-2xl bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] border border-slate-200 overflow-hidden flex flex-col`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
              <div>
                <h3 className="font-semibold text-slate-900">{previewFile.original_name}</h3>
                <p className="text-xs text-slate-500">{isDocxFile(previewFile.mime_type, previewFile.original_name) ? 'Editor de documento' : isPdfFile(previewFile.mime_type, previewFile.original_name) ? `Preview do PDF${previewPdfIndex !== -1 ? ` • ${previewPdfIndex + 1} de ${previewPdfFiles.length}` : ''}` : isImageFile(previewFile.mime_type) ? `Preview da Imagem${previewImageIndex !== -1 ? ` • ${previewImageIndex + 1} de ${previewImageFiles.length}` : ''}` : isVideoFile(previewFile.mime_type, previewFile.original_name) ? 'Player de vídeo Jurius' : 'Preview do arquivo'}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {isPdfFile(previewFile.mime_type, previewFile.original_name) ? (
                  <>
                    <button
                      onClick={() => openRenameModal('file', previewFile.id, previewFile.original_name)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 inline-flex items-center gap-2"
                    >
                      <Tag className="w-4 h-4" />
                      Renomear
                    </button>
                    <button
                      onClick={() => handleDownloadFile(previewFile)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 inline-flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Baixar
                    </button>
                    <button
                      onClick={() => {
                        void openPdfToolsModal(previewFile);
                        setPreviewFile(null);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-800 inline-flex items-center gap-2"
                    >
                      <Scissors className="w-4 h-4" />
                      Hub PDF
                    </button>
                    <button
                      onClick={() => {
                        void handleDeleteFile(previewFile);
                        setPreviewFile(null);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 text-sm hover:bg-red-100 inline-flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Excluir
                    </button>
                  </>
                ) : null}
                {isImageFile(previewFile.mime_type) ? (
                  <>
                    <button
                      onClick={() => {
                        setSelectedImageFileIds([previewFile.id]);
                        setImagePdfName(`convertido-${previewFile.original_name.replace(/\.[^/.]+$/, '')}`);
                        setImagePdfItems([previewFile]);
                        setImagePdfModalOpen(true);
                        setPreviewFile(null);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-sm hover:bg-orange-600 inline-flex items-center gap-2"
                    >
                      <FileText className="w-4 h-4" />
                      Converter para PDF
                    </button>
                    <button
                      onClick={() => void handleRotateFileQuick(previewFile, 90)}
                      disabled={quickActionFileId === previewFile.id}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {quickActionFileId === previewFile.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                      Girar 90°
                    </button>
                  </>
                ) : isPdfFile(previewFile.mime_type, previewFile.original_name) ? (
                  <button
                    onClick={() => void handleRotateFileQuick(previewFile, 90)}
                    disabled={quickActionFileId === previewFile.id}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {quickActionFileId === previewFile.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                    Girar 90°
                  </button>
                ) : null}
                {isVideoFile(previewFile.mime_type, previewFile.original_name) ? (
                  <button
                    onClick={() => handleDownloadFile(previewFile)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 inline-flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Baixar
                  </button>
                ) : null}
                {isDocxFile(previewFile.mime_type, previewFile.original_name) && (
                  <button onClick={() => setPreviewFile(null)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 inline-flex items-center gap-2">
                    <Minimize2 className="w-4 h-4" />
                    Minimizar
                  </button>
                )}
                <button onClick={() => setPreviewFile(null)} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
            </div>
            <div className={`flex-1 relative ${isPdfFile(previewFile.mime_type, previewFile.original_name) ? 'bg-slate-200 overflow-auto' : 'bg-slate-100 overflow-auto'}`}>
              {isPdfFile(previewFile.mime_type, previewFile.original_name) && canNavigatePreviewPdf ? (
                <>
                  <button
                    type="button"
                    onClick={() => openPreviewPdfByOffset(-1)}
                    className="absolute left-4 top-1/2 z-10 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openPreviewPdfByOffset(1)}
                    className="absolute right-4 top-1/2 z-10 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              ) : null}
              {isImageFile(previewFile.mime_type) && canNavigatePreviewImage ? (
                <>
                  <button
                    type="button"
                    onClick={() => openPreviewImageByOffset(-1)}
                    className="absolute left-4 top-1/2 z-10 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openPreviewImageByOffset(1)}
                    className="absolute right-4 top-1/2 z-10 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              ) : null}
              {previewLoading ? (
                <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>
              ) : isDocxFile(previewFile.mime_type, previewFile.original_name) ? (
                <div className="h-full bg-white">
                  <SyncfusionEditor ref={editorRef} readOnly={false} height="100%" enableToolbar={true} showPropertiesPane={true} showNavigationPane={false} />
                </div>
              ) : isPdfFile(previewFile.mime_type, previewFile.original_name) && previewUrl ? (
                <div className="min-h-full w-full overflow-auto p-3 sm:p-6">
                  <div className="mx-auto flex min-h-full w-full max-w-[1120px] items-start justify-center rounded-2xl bg-slate-300/40 p-2 sm:p-4">
                    <div className="w-full max-w-[900px] rounded-xl bg-white shadow-[0_18px_50px_rgba(15,23,42,0.16)] overflow-hidden">
                      <iframe
                        key={`${previewFile.id}-${previewUrl}`}
                        src={previewUrl}
                        className="block h-[75vh] sm:h-[78vh] w-full bg-white"
                        title={previewFile.original_name}
                      />
                    </div>
                  </div>
                </div>
              ) : isImageFile(previewFile.mime_type) && previewUrl ? (
                <div className="h-full flex items-center justify-center p-6"><img src={previewUrl} alt={previewFile.original_name} className="max-w-full max-h-full object-contain rounded-xl shadow" /></div>
              ) : isVideoFile(previewFile.mime_type, previewFile.original_name) && previewUrl ? (
                <div className="flex h-full flex-col bg-slate-950 p-3 sm:p-5">
                  <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-black shadow-[0_18px_50px_rgba(15,23,42,0.35)]">
                    <video
                      key={`${previewFile.id}-${previewUrl}`}
                      src={previewUrl}
                      className="h-full w-full bg-black object-contain"
                      controls
                      controlsList="nodownload"
                      preload="metadata"
                    />
                  </div>
                  <div className="mx-auto mt-3 flex w-full max-w-[1180px] items-center justify-between gap-3 px-1 text-xs text-slate-400">
                    <span className="truncate">Cloud Jurius</span>
                    <span>{formatFileSize(previewFile.file_size || 0)}</span>
                  </div>
                </div>
              ) : previewUrl ? (
                <div className="h-full flex items-center justify-center">
                  <a href={previewUrl} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium">Abrir arquivo</a>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500">Não foi possível gerar preview.</div>
              )}
            </div>
            {isPdfFile(previewFile.mime_type, previewFile.original_name) && previewPdfFiles.length > 1 ? (
              <div className="border-t border-slate-200 bg-white px-4 py-3">
                <div className="flex gap-3 overflow-x-auto">
                  {previewPdfFiles.map((file, index) => {
                    const active = file.id === previewFile.id;
                    return (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => setPreviewFile(file)}
                        className={`min-w-[170px] rounded-xl border px-3 py-2 text-left transition ${active ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300'}`}
                      >
                        <p className="text-[11px] font-medium text-slate-500">PDF {index + 1}</p>
                        <p className={`mt-1 truncate text-sm font-medium ${active ? 'text-orange-700' : 'text-slate-800'}`}>{file.original_name}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {contextMenu && selectedContextFolder && (
        <div
          className="fixed z-[140]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="w-64 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <button
              type="button"
              onClick={() => openFolderFromContextMenu(selectedContextFolder)}
              className="w-full px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              Abrir pasta
            </button>
            <button
              type="button"
              onClick={() => {
                handleToggleFavoriteFolder(selectedContextFolder.id);
                setContextMenu(null);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              {favoriteFolderIds.includes(selectedContextFolder.id) ? 'Desafixar pasta' : 'Fixar em favoritos'}
            </button>
            <div className="border-t border-slate-100" />
            {folderLabels.map((label) => (
              <button
                key={label.id}
                type="button"
                onClick={() => {
                  handleAssignFolderLabel(selectedContextFolder.id, label.id);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
              >
                Alterar status para: {label.name}
              </button>
            ))}
            <div className="border-t border-slate-100" />
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                if (selectedContextFolder.archived_at) {
                  handleUnarchiveFolder(selectedContextFolder);
                  return;
                }
                handleArchiveFolder(selectedContextFolder);
              }}
              className={`w-full px-3 py-2.5 text-left text-sm transition ${selectedContextFolder.archived_at ? 'text-emerald-700 hover:bg-emerald-50' : 'text-amber-700 hover:bg-amber-50'}`}
            >
              {selectedContextFolder.archived_at ? 'Desarquivar pasta' : 'Arquivar pasta'}
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleStoreSelectionInClipboard('copy', [`folder:${selectedContextFolder.id}`]);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
            >
              <Copy className="w-4 h-4 text-slate-500" />
              Copiar
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleStoreSelectionInClipboard('cut', [`folder:${selectedContextFolder.id}`]);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
            >
              <Scissors className="w-4 h-4 text-slate-500" />
              Recortar
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                void handleDuplicateFolder(selectedContextFolder);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
            >
              <Copy className="w-4 h-4 text-slate-500" />
              Criar cópia
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                void handleDownloadFolder(selectedContextFolder);
              }}
              disabled={downloadingFolderId === selectedContextFolder.id}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition disabled:cursor-not-allowed disabled:opacity-70"
            >
              {downloadingFolderId === selectedContextFolder.id ? 'Preparando download...' : 'Baixar pasta'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedItemKey(`folder:${selectedContextFolder.id}`);
                handleOpenFolderShare(selectedContextFolder);
                setContextMenu(null);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Compartilhar pasta
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedItemKey(`folder:${selectedContextFolder.id}`);
                setContextMenu(null);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Vincular cliente
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedItemKey(`folder:${selectedContextFolder.id}`);
                handleOpenCreateFolder();
                setContextMenu(null);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Criar subpasta
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                openRenameModal('folder', selectedContextFolder.id, selectedContextFolder.name);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Renomear pasta
            </button>
            {selectedItemKeys.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setContextMenu(null);
                    setBulkRenameModalOpen(true);
                  }}
                  className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
                >
                  Renomear seleção
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContextMenu(null);
                    setBulkMoveModalOpen(true);
                  }}
                  className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
                >
                  Mover seleção
                </button>
              </>
            ) : null}
            {canPasteSelectionIntoContextFolder ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setContextMenu(null);
                    void handleCutSelectionToFolder(selectedContextFolder);
                  }}
                  className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
                >
                  <Scissors className="w-4 h-4 text-slate-500" />
                  Recortar seleção para cá
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContextMenu(null);
                    void handleCopySelectionToFolder(selectedContextFolder);
                  }}
                  className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
                >
                  <Copy className="w-4 h-4 text-slate-500" />
                  Copiar seleção para cá
                </button>
              </>
            ) : null}
            {canPasteClipboardIntoContextFolder ? (
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null);
                  void handlePasteClipboardToFolder(selectedContextFolder);
                }}
                className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
              >
                <Clipboard className="w-4 h-4 text-slate-500" />
                Colar aqui
              </button>
            ) : null}
            <div className="border-t border-slate-100" />
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleDeleteFolder(selectedContextFolder);
              }}
              className="w-full px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 transition"
            >
              Excluir pasta
            </button>
          </div>
        </div>
      )}

      {contextMenu && selectedContextFile && (
        <div
          className="fixed z-[140]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="w-64 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <button
              type="button"
              onClick={() => openFileFromContextMenu(selectedContextFile)}
              className="w-full px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              Abrir arquivo
            </button>
            <button
              type="button"
              onClick={() => {
                handleToggleFavoriteFile(selectedContextFile.id);
                setContextMenu(null);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              {favoriteFileIds.includes(selectedContextFile.id) ? 'Desafixar arquivo' : 'Fixar em favoritos'}
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                startInlineRename({ type: 'file', id: selectedContextFile.id, currentName: selectedContextFile.original_name });
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Renomear arquivo
            </button>
            <div className="border-t border-slate-100" />
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleStoreSelectionInClipboard('copy', [`file:${selectedContextFile.id}`]);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
            >
              <Copy className="w-4 h-4 text-slate-500" />
              Copiar
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleStoreSelectionInClipboard('cut', [`file:${selectedContextFile.id}`]);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
            >
              <Scissors className="w-4 h-4 text-slate-500" />
              Recortar
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                void handleDownloadFile(selectedContextFile);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Baixar arquivo
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                void handleDuplicateFile(selectedContextFile);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Criar cópia
            </button>
            <div className="border-t border-slate-100" />
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleDeleteFile(selectedContextFile);
              }}
              className="w-full px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 transition"
            >
              Excluir arquivo
            </button>
          </div>
        </div>
      )}

      {contextMenu && contextMenu.type === 'blank' && (
        <div
          className="fixed z-[140]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="w-56 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleOpenCreateFolder();
              }}
              className="w-full px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
            >
              <FolderPlus className="w-4 h-4 text-amber-500" />
              Nova pasta
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                fileInputRef.current?.click();
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
            >
              <Upload className="w-4 h-4 text-sky-500" />
              Enviar arquivos
            </button>
            <div className="border-t border-slate-100" />
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleStoreSelectionInClipboard('copy');
              }}
              className={`w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2 ${selectedItemKeys.length > 0 ? '' : 'hidden'}`}
            >
              <Copy className="w-4 h-4 text-slate-500" />
              Copiar seleção
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleStoreSelectionInClipboard('cut');
              }}
              className={`w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2 ${selectedItemKeys.length > 0 ? '' : 'hidden'}`}
            >
              <Scissors className="w-4 h-4 text-slate-500" />
              Recortar seleção
            </button>
            {canPasteClipboardIntoCurrentFolder ? (
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null);
                  void handlePasteClipboardToFolder(currentFolder);
                }}
                className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
              >
                <Clipboard className="w-4 h-4 text-slate-500" />
                Colar na pasta atual
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                void handlePastePrintFromClipboard();
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
            >
              <Clipboard className="w-4 h-4 text-slate-400" />
              Colar imagem
            </button>
            <div className="border-t border-slate-100" />
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                void loadData();
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
            >
              <RotateCw className="w-4 h-4 text-slate-400" />
              Atualizar
            </button>
            {selectedImageFiles.length > 0 && (
              <>
                <div className="border-t border-slate-100" />
                <button
                  type="button"
                  onClick={() => {
                    setContextMenu(null);
                    openConvertImagesModal();
                  }}
                  className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
                >
                  <FileText className="w-4 h-4 text-red-500" />
                  Converter {selectedImageFiles.length} imagem(ns) em PDF
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {contextMenu && selectedContextFile && (
        <div
          className="fixed z-[140]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="w-64 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <button
              type="button"
              onClick={() => openFileFromContextMenu(selectedContextFile)}
              className="w-full px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              {isWordFile(selectedContextFile.mime_type, selectedContextFile.original_name) ? 'Abrir editor' : 'Abrir preview'}
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                openConvertImagesModal(selectedImageFiles.some((item) => item.id === selectedContextFile.id) ? undefined : [selectedContextFile]);
              }}
              className={`w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition ${isImageFile(selectedContextFile.mime_type) ? '' : 'hidden'}`}
            >
              Converter em PDF
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                void handleConvertWordToPdf(selectedContextFile);
              }}
              className={`w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition ${isWordFile(selectedContextFile.mime_type, selectedContextFile.original_name) ? '' : 'hidden'}`}
            >
              Converter Word em PDF
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                void openPdfToolsModal(selectedContextFile);
              }}
              className={`w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition ${isPdfFile(selectedContextFile.mime_type, selectedContextFile.original_name) ? '' : 'hidden'}`}
            >
              Hub PDF
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleDownloadFile(selectedContextFile);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Baixar arquivo
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedFileToMove(selectedContextFile);
                setTargetFolderId('');
                setMoveModalOpen(true);
                setContextMenu(null);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Mover arquivo
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                openRenameModal('file', selectedContextFile.id, selectedContextFile.original_name);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Renomear
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleStoreSelectionInClipboard('copy', [`file:${selectedContextFile.id}`]);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
            >
              <Copy className="w-4 h-4 text-slate-500" />
              Copiar
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleStoreSelectionInClipboard('cut', [`file:${selectedContextFile.id}`]);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
            >
              <Scissors className="w-4 h-4 text-slate-500" />
              Recortar
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                void handleDuplicateFile(selectedContextFile);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
            >
              <Copy className="w-4 h-4 text-slate-500" />
              Criar cópia
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                void handleCopyFileToClipboard(selectedContextFile);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Copiar link
            </button>
            {selectedItemKeys.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setContextMenu(null);
                    setBulkRenameModalOpen(true);
                  }}
                  className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
                >
                  Renomear seleção
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContextMenu(null);
                    setBulkMoveModalOpen(true);
                  }}
                  className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
                >
                  Mover seleção
                </button>
              </>
            ) : null}
            <div className="border-t border-slate-100" />
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                if (selectedContextFile.archived_at && !selectedContextFile.delete_scheduled_for) {
                  void handleRestoreArchivedFile(selectedContextFile);
                  return;
                }
                handleDeleteFile(selectedContextFile);
              }}
              className="w-full px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 transition"
            >
              {selectedContextFile.archived_at && !selectedContextFile.delete_scheduled_for ? 'Desarquivar arquivo' : 'Excluir arquivo'}
            </button>
          </div>
        </div>
      )}

      {renameModalOpen && renameTarget && (
        <div className="fixed inset-0 z-[135] bg-slate-900/25 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] border border-slate-200 overflow-hidden">
            <div className="h-2 w-full bg-gradient-to-r from-orange-500 to-orange-600" />
            <div className="p-5 sm:p-6 space-y-5 bg-white">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Cloud</p>
                  <h3 className="text-xl font-semibold text-slate-900">Renomear {renameTarget.type === 'file' ? 'arquivo' : 'pasta'}</h3>
                </div>
                <button onClick={() => setRenameModalOpen(false)} className="rounded-xl p-2 hover:bg-slate-100 transition"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Novo nome</label>
                {renameTarget.type === 'file' && splitFileNameAndExtension(renameTarget.currentName).extension ? (
                  <div className="flex overflow-hidden rounded-xl border border-orange-300 bg-white shadow-[0_0_0_3px_rgba(249,115,22,0.08)]">
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleRename();
                        }
                      }}
                      className="flex-1 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none"
                      placeholder="Digite o novo nome"
                      autoFocus
                    />
                    <div className="inline-flex items-center border-l border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-500 select-none">
                      {splitFileNameAndExtension(renameTarget.currentName).extension}
                    </div>
                  </div>
                ) : (
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleRename();
                      }
                    }}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400"
                    placeholder="Digite o novo nome"
                    autoFocus
                  />
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setRenameModalOpen(false)} className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
                <button onClick={() => void handleRename()} className="px-5 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">Renomear</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {bulkRenameModalOpen && (
        <div className="fixed inset-0 z-[135] bg-slate-900/25 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] border border-slate-200 overflow-hidden">
            <div className="h-2 w-full bg-gradient-to-r from-orange-500 to-orange-600" />
            <div className="p-5 sm:p-6 space-y-5 bg-white">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Cloud</p>
                  <h3 className="text-xl font-semibold text-slate-900">Renomear em lote</h3>
                </div>
                <button onClick={() => setBulkRenameModalOpen(false)} className="rounded-xl p-2 hover:bg-slate-100 transition"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input value={bulkRenamePrefix} onChange={(e) => setBulkRenamePrefix(e.target.value)} placeholder="Prefixo" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
                <input value={bulkRenameSuffix} onChange={(e) => setBulkRenameSuffix(e.target.value)} placeholder="Sufixo" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
                <input value={bulkRenameSearch} onChange={(e) => setBulkRenameSearch(e.target.value)} placeholder="Texto a buscar" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
                <input value={bulkRenameReplace} onChange={(e) => setBulkRenameReplace(e.target.value)} placeholder="Substituir por" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {selectedItemKeys.length} item(ns) selecionado(s)
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setBulkRenameModalOpen(false)} className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
                <button onClick={() => void handleBulkRename()} className="px-5 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">Aplicar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {bulkMoveModalOpen && (
        <div className="fixed inset-0 z-[125] bg-slate-900/25 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] border border-slate-200 overflow-hidden">
            <div className="h-2 w-full bg-gradient-to-r from-orange-500 to-orange-600" />
            <div className="p-5 sm:p-6 space-y-5 bg-white">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Cloud</p>
                  <h3 className="text-xl font-semibold text-slate-900">Mover itens em lote</h3>
                </div>
                <button onClick={() => setBulkMoveModalOpen(false)} className="rounded-xl p-2 hover:bg-slate-100 transition"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {selectedItemKeys.length} item(ns) selecionado(s)
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Pasta de destino</label>
                <select value={bulkMoveTargetFolderId} onChange={(e) => setBulkMoveTargetFolderId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400">
                  <option value="">Selecione a pasta destino</option>
                  {bulkMoveOptions.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setBulkMoveModalOpen(false)} className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
                <button onClick={() => void handleBulkMove()} className="px-5 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">Mover</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {uploadQueueSummary.totalItems > 0 ? (
          <motion.div
            key="upload-progress-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-slate-100/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.96, y: 18, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.98, y: 12, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-orange-100 bg-white text-slate-900 shadow-[0_30px_80px_rgba(15,23,42,0.16)]"
              style={{ backgroundColor: '#ffffff', color: '#0f172a', colorScheme: 'light' }}
            >
              <div className="border-b border-orange-100 bg-white px-6 py-5" style={{ backgroundColor: '#ffffff' }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 shadow-[0_0_30px_rgba(249,115,22,0.14)]">
                      {uploadQueueSummary.failedItems > 0 ? <RotateCcw className="w-6 h-6 text-orange-500" /> : uploadQueueSummary.completedItems === uploadQueueSummary.totalItems ? <CheckCircle2 className="w-6 h-6 text-emerald-500" /> : <Upload className="w-6 h-6 text-orange-500" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-orange-600/80">Central de Transferência</p>
                      <h3 className="mt-1 text-2xl font-semibold text-slate-900">
                        {uploadQueueSummary.failedItems > 0
                          ? 'Alguns arquivos precisaram de atenção'
                          : uploadQueueSummary.completedItems === uploadQueueSummary.totalItems
                            ? 'Upload concluído com sucesso'
                            : 'Enviando seus documentos'}
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {uploadQueueSummary.failedItems > 0
                          ? 'Você pode tentar novamente apenas os arquivos que falharam.'
                          : uploadQueueSummary.completedItems === uploadQueueSummary.totalItems
                            ? 'Tudo certo. O modal vai desaparecer sozinho.'
                            : 'Aguarde enquanto o Cloud organiza e envia os arquivos para a pasta correta.'}
                      </p>
                    </div>
                  </div>
                  {uploadQueueSummary.failedItems > 0 ? (
                    <button
                      type="button"
                      onClick={clearFinishedUploads}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Fechar
                    </button>
                  ) : null}
                </div>

                <div className="mt-5 rounded-2xl border border-orange-100 bg-orange-50/60 p-4" style={{ backgroundColor: '#fff7ed' }}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-600">Progresso do lote</span>
                    <span className="font-semibold text-slate-900">{uploadQueueSummary.totalProgress}%</span>
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-orange-100">
                    <motion.div
                      className={`h-full rounded-full ${uploadQueueSummary.failedItems > 0 ? 'bg-gradient-to-r from-amber-400 to-orange-500' : uploadQueueSummary.completedItems === uploadQueueSummary.totalItems ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : 'bg-gradient-to-r from-orange-400 via-orange-500 to-amber-300'}`}
                      animate={{ width: `${uploadQueueSummary.totalProgress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700">{uploadQueueSummary.completedItems} concluído(s)</span>
                    {uploadQueueSummary.uploadingItems ? <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-orange-700">{uploadQueueSummary.uploadingItems} enviando</span> : null}
                    {uploadQueueSummary.failedItems ? <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">{uploadQueueSummary.failedItems} falhou(ram)</span> : null}
                  </div>
                </div>
              </div>

              <div className="max-h-[45vh] space-y-3 overflow-auto bg-white px-6 py-5" style={{ backgroundColor: '#ffffff' }}>
                {uploadQueueItems.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 backdrop-blur-sm shadow-sm" style={{ backgroundColor: '#ffffff' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{item.fileName}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">{item.folderLabel} • {formatFileSize(item.fileSize)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${item.status === 'completed' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : item.status === 'failed' ? 'border border-red-200 bg-red-50 text-red-700' : item.status === 'uploading' ? 'border border-orange-200 bg-orange-50 text-orange-700' : 'border border-slate-200 bg-slate-50 text-slate-600'}`}>
                          {item.status === 'completed' ? 'Concluído' : item.status === 'failed' ? 'Falhou' : item.status === 'uploading' ? 'Enviando' : 'Na fila'}
                        </span>
                        {item.status === 'failed' ? (
                          <button
                            type="button"
                            onClick={() => void retryUploadItem(item.id)}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Tentar novamente
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <motion.div
                        className={`h-full rounded-full ${item.status === 'failed' ? 'bg-gradient-to-r from-red-400 to-red-500' : item.status === 'completed' ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : 'bg-gradient-to-r from-orange-400 to-amber-300'}`}
                        animate={{ width: `${item.progress}%` }}
                        transition={{ duration: 0.25 }}
                      />
                    </div>
                    {item.error ? <p className="mt-2 text-xs text-red-600">{item.error}</p> : null}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {deleteModalState.open ? (
          <motion.div
            key="delete-document-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[151] bg-white/72 backdrop-blur-md flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(255,255,255,0.72)' }}
          >
            <motion.div
              initial={{ scale: 0.94, y: 16, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.98, y: 12, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="w-full max-w-md overflow-hidden rounded-[28px] border border-red-100 bg-[radial-gradient(circle_at_top,_rgba(248,113,113,0.14),_rgba(255,255,255,0.98)_62%)] text-slate-900 shadow-[0_30px_80px_rgba(15,23,42,0.16)]"
              style={{ backgroundColor: '#ffffff', backgroundImage: 'radial-gradient(circle at top, rgba(248,113,113,0.14), rgba(255,255,255,0.98) 62%)', color: '#0f172a', colorScheme: 'light', isolation: 'isolate' }}
            >
              <div className="relative overflow-hidden px-6 py-6" style={{ backgroundColor: '#ffffff' }}>
                <div className="pointer-events-none absolute inset-0" style={{ backgroundColor: '#ffffff', opacity: 0.94 }} />
                <motion.div
                  animate={deleteModalState.stage === 'processing' ? { x: ['-100%', '100%'] } : { opacity: 0.6 }}
                  transition={deleteModalState.stage === 'processing' ? { repeat: Infinity, duration: 1.5, ease: 'linear' } : { duration: 0.2 }}
                  className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-transparent via-red-100/70 to-transparent"
                />
                <div className="relative flex flex-col items-center text-center">
                  <motion.div
                    animate={deleteModalState.stage === 'processing'
                      ? { y: [0, -10, 0], rotate: [0, -4, 4, 0], opacity: [1, 0.9, 1], scale: [1, 1.03, 1] }
                      : deleteModalState.stage === 'success'
                        ? { scale: [1, 1.08, 1], rotate: [0, -2, 2, 0] }
                        : { x: [0, -6, 6, -4, 4, 0] }}
                    transition={deleteModalState.stage === 'processing'
                      ? { repeat: Infinity, duration: 1.35, ease: 'easeInOut' }
                      : deleteModalState.stage === 'success'
                        ? { duration: 0.45 }
                        : { duration: 0.42 }}
                    className={`relative flex h-24 w-24 items-center justify-center rounded-3xl border ${deleteModalState.stage === 'success' ? 'border-emerald-200 bg-emerald-50' : deleteModalState.stage === 'error' ? 'border-red-200 bg-red-50' : 'border-red-100 bg-white'}`}
                  >
                    {deleteModalState.kind === 'folder' ? <Folder className="w-11 h-11 text-amber-500" /> : <FileText className="w-11 h-11 text-red-500" />}
                    {deleteModalState.stage === 'processing' ? (
                      <>
                        <motion.div initial={{ opacity: 0.4 }} animate={{ opacity: [0.2, 0.8, 0.2], scale: [0.9, 1.15, 0.9] }} transition={{ repeat: Infinity, duration: 1.2 }} className="absolute inset-0 rounded-3xl border border-red-300/40" />
                        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }} className="absolute inset-[7px] rounded-[20px] border-2 border-transparent border-t-orange-300 border-r-red-300/70" />
                      </>
                    ) : null}
                    {deleteModalState.stage === 'success' ? <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3 }} className="absolute -right-1 -top-1 rounded-full border border-emerald-200 bg-emerald-50 p-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-600" /></motion.div> : null}
                    {deleteModalState.stage === 'error' ? <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.25 }} className="absolute -right-1 -top-1 rounded-full border border-red-200 bg-red-50 p-1.5"><AlertCircle className="h-4 w-4 text-red-600" /></motion.div> : null}
                  </motion.div>

                  <h3 className="mt-5 text-2xl font-semibold text-slate-900">
                    {deleteModalState.stage === 'processing' ? 'Excluindo documento' : deleteModalState.stage === 'success' ? 'Documento removido' : 'Não foi possível excluir'}
                  </h3>
                  <p className="mt-2 text-sm text-slate-600">
                    {deleteModalState.stage === 'processing'
                      ? `Processando ${deleteModalState.title}...`
                      : deleteModalState.stage === 'success'
                        ? `${deleteModalState.title} foi processado com sucesso.`
                        : deleteModalState.error || 'Tente novamente em instantes.'}
                  </p>

                  <div className="mt-6 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4" style={{ backgroundColor: '#f8fafc' }}>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Status</span>
                      <span className="font-semibold text-slate-900">{deleteModalState.stage === 'processing' ? 'Excluindo...' : deleteModalState.stage === 'success' ? 'Concluído' : 'Falhou'}</span>
                    </div>
                    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200">
                      <motion.div
                        className={`h-full rounded-full ${deleteModalState.stage === 'success' ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : deleteModalState.stage === 'error' ? 'bg-gradient-to-r from-red-400 to-red-500' : 'bg-gradient-to-r from-red-400 via-orange-400 to-amber-300'}`}
                        animate={{ width: deleteModalState.stage === 'processing' ? ['22%', '78%', '45%'] : deleteModalState.stage === 'success' ? '100%' : '100%' }}
                        transition={deleteModalState.stage === 'processing' ? { repeat: Infinity, duration: 1.3 } : { duration: 0.25 }}
                      />
                    </div>
                    {deleteModalState.stage === 'processing' ? (
                      <div className="mt-4 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.24em] text-red-500/85">
                        <motion.span animate={{ opacity: [0.35, 1, 0.35] }} transition={{ repeat: Infinity, duration: 1.1, delay: 0 }}>Preparando</motion.span>
                        <motion.span animate={{ opacity: [0.35, 1, 0.35] }} transition={{ repeat: Infinity, duration: 1.1, delay: 0.18 }}>Movendo</motion.span>
                        <motion.span animate={{ opacity: [0.35, 1, 0.35] }} transition={{ repeat: Infinity, duration: 1.1, delay: 0.36 }}>Finalizando</motion.span>
                      </div>
                    ) : null}
                  </div>

                  {deleteModalState.stage === 'error' ? (
                    <div className="mt-5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDeleteModalState((prev) => ({ ...prev, open: false }))}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Fechar
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {imagePdfModalOpen && (
        <div className="fixed inset-0 z-[140] bg-slate-900/45 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-3xl bg-white text-slate-900 shadow-[0_25px_60px_rgba(15,23,42,0.22)] border border-slate-200 overflow-hidden">
            <div className="h-2 w-full bg-gradient-to-r from-orange-500 to-orange-600" />
            <div className="p-5 sm:p-6 space-y-5 bg-white">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Converter imagens em PDF</h3>
                  <p className="text-sm text-slate-500">Organize a ordem e defina o título do PDF.</p>
                </div>
                <button onClick={() => setImagePdfModalOpen(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"><X className="w-5 h-5" /></button>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Título do PDF</label>
                <input
                  value={imagePdfName}
                  onChange={(e) => setImagePdfName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-300"
                  placeholder="Ex: documentos-consolidados"
                />
              </div>

              <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-500 font-semibold">
                  Ordem das imagens
                </div>
                <div className="max-h-[420px] overflow-auto bg-white p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {imagePdfItems.map((item, index) => (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={() => setDraggingImagePdfId(item.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (draggingImagePdfId) {
                            moveImagePdfItemById(draggingImagePdfId, item.id);
                          }
                          setDraggingImagePdfId(null);
                        }}
                        onDragEnd={() => setDraggingImagePdfId(null)}
                        className={`rounded-2xl border bg-white shadow-sm transition-all overflow-hidden cursor-grab active:cursor-grabbing ${draggingImagePdfId === item.id ? 'opacity-70 scale-[0.98] border-orange-300 shadow-lg' : 'border-slate-200 hover:border-orange-200 hover:shadow-md'}`}
                      >
                        <div className="aspect-[4/3] bg-slate-100 overflow-hidden border-b border-slate-200">
                          {imagePdfPreviewUrls[item.id] ? (
                            <img
                              src={imagePdfPreviewUrls[item.id]}
                              alt={item.original_name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-slate-400 bg-slate-50">
                              <ImageIcon className="w-8 h-8" />
                            </div>
                          )}
                        </div>
                        <div className="p-3 space-y-3 bg-white">
                          <div className="flex items-start gap-3">
                            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-orange-50 px-2 text-xs font-semibold text-orange-700">{index + 1}</span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-800">{item.original_name}</p>
                              <p className="text-xs text-slate-500">Arraste para reorganizar</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => moveImagePdfItem(index, -1)}
                              disabled={index === 0}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveImagePdfItem(index, 1)}
                              disabled={index === imagePdfItems.length - 1}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={() => setImagePdfModalOpen(false)} className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
                <button onClick={handleConvertImagesToPdf} disabled={convertingImagesToPdf} className="px-4 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-70 shadow-sm shadow-orange-500/20">
                  {convertingImagesToPdf ? 'Convertendo...' : 'Salvar PDF'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pdfToolsModalOpen && selectedPdfToolFile && (
        <div className="fixed inset-0 z-[135] bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
          <div className="w-full max-w-full sm:max-w-6xl h-[95vh] sm:h-[90vh] rounded-3xl bg-white border border-slate-200 shadow-[0_24px_70px_rgba(15,23,42,0.18)] overflow-hidden flex flex-col">
            <div className="h-2 w-full bg-gradient-to-r from-orange-500 to-orange-600" />
            <div className="px-3 sm:px-5 py-3 border-b border-slate-200 bg-white flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Cloud</p>
                <h3 className="text-base sm:text-lg font-semibold text-slate-900 truncate">Hub PDF - {selectedPdfToolFile.original_name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedPdfFiles.length > 1
                    ? `${selectedPdfFiles.length} PDFs selecionados para juntar • editando agora: ${selectedPdfToolFile.original_name}`
                    : 'Editando o PDF atual'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {pdfToolMode !== 'home' ? (
                  <button onClick={() => setPdfToolMode('home')} className="px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50">
                    Voltar
                  </button>
                ) : null}
                <button onClick={closePdfToolsModal} className="rounded-xl p-2 hover:bg-slate-100 transition"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
            </div>

            {pdfToolMode === 'home' ? (
              <div className="flex-1 overflow-auto bg-slate-50 p-4 sm:p-6">
                <div className="max-w-5xl mx-auto space-y-6">
                  <div>
                    <h4 className="text-lg font-semibold text-slate-900">Ferramentas PDF</h4>
                    <p className="text-sm text-slate-500">Somente as funções essenciais para editar e organizar seus PDFs.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    <button onClick={() => setPdfToolMode('organize')} className="rounded-2xl border border-sky-200 bg-white hover:bg-sky-50 text-left p-4 transition shadow-sm">
                      <div className="flex items-center gap-3">
                        <GripVertical className="w-5 h-5 text-sky-600" />
                        <div>
                          <p className="font-medium text-slate-900">Organizar páginas</p>
                          <p className="text-xs text-slate-500">Reordenar arrastando</p>
                        </div>
                      </div>
                    </button>

                    <button onClick={() => setPdfToolMode('rotate')} className="rounded-2xl border border-sky-200 bg-white hover:bg-sky-50 text-left p-4 transition shadow-sm">
                      <div className="flex items-center gap-3">
                        <RotateCw className="w-5 h-5 text-sky-600" />
                        <div>
                          <p className="font-medium text-slate-900">Girar páginas</p>
                          <p className="text-xs text-slate-500">Rotacionar selecionadas</p>
                        </div>
                      </div>
                    </button>

                    <button onClick={() => setPdfToolMode('remove')} className="rounded-2xl border border-sky-200 bg-white hover:bg-sky-50 text-left p-4 transition shadow-sm">
                      <div className="flex items-center gap-3">
                        <Scissors className="w-5 h-5 text-sky-600" />
                        <div>
                          <p className="font-medium text-slate-900">Remover páginas</p>
                          <p className="text-xs text-slate-500">Excluir selecionadas</p>
                        </div>
                      </div>
                    </button>

                    <button onClick={() => void extractSelectedPdfPages()} disabled={selectedPdfPageIndexes.length === 0 || pdfToolSaving} className="rounded-2xl border border-emerald-200 bg-white hover:bg-emerald-50 text-left p-4 transition shadow-sm disabled:opacity-50 disabled:hover:bg-white">
                      <div className="flex items-center gap-3">
                        <Copy className="w-5 h-5 text-emerald-600" />
                        <div>
                          <p className="font-medium text-slate-900">Extrair páginas</p>
                          <p className="text-xs text-slate-500">{selectedPdfPageIndexes.length > 0 ? `${selectedPdfPageIndexes.length} selecionada(s)` : 'Selecione páginas abaixo'}</p>
                        </div>
                      </div>
                    </button>

                    <button onClick={() => void mergeSelectedPdfFiles()} disabled={selectedPdfFiles.length < 2 || pdfToolSaving} className="rounded-2xl border border-amber-200 bg-white hover:bg-amber-50 text-left p-4 transition shadow-sm disabled:opacity-50 disabled:hover:bg-white">
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-amber-600" />
                        <div>
                          <p className="font-medium text-slate-900">Juntar PDFs</p>
                          <p className="text-xs text-slate-500">{selectedPdfFiles.length >= 2 ? `${selectedPdfFiles.length} PDFs selecionados` : 'Selecione 2+ PDFs na pasta'}</p>
                        </div>
                      </div>
                    </button>

                    <button onClick={() => handleDownloadFile(selectedPdfToolFile)} className="rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-left p-4 transition shadow-sm">
                      <div className="flex items-center gap-3">
                        <Download className="w-5 h-5 text-slate-600" />
                        <div>
                          <p className="font-medium text-slate-900">Baixar PDF</p>
                          <p className="text-xs text-slate-500">Download do arquivo</p>
                        </div>
                      </div>
                    </button>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <p className="text-sm font-medium text-slate-900">Páginas do PDF ({pdfToolPages.length})</p>
                      <div className="flex items-center gap-2">
                        <button onClick={selectAllPdfPages} className="px-2 py-1 text-xs rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700">Selecionar todas</button>
                        <button onClick={invertPdfPageSelection} className="px-2 py-1 text-xs rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700">Inverter seleção</button>
                        <button onClick={() => setSelectedPdfPageIndexes([])} className="px-2 py-1 text-xs rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700">Limpar</button>
                      </div>
                    </div>
                    {pdfToolPreviewUrl && selectedPdfToolFile ? (
                      <Document
                        key={`thumbs-${selectedPdfToolFile.id}-${pdfToolPreviewUrl}`}
                        file={pdfToolPreviewUrl}
                        loading={<div className="py-6 text-center text-sm text-slate-500">Carregando miniaturas do PDF...</div>}
                        error={<div className="py-6 text-center text-sm text-slate-500">Preview do PDF indisponível no momento.</div>}
                        onLoadSuccess={() => setPdfToolDocumentReady(true)}
                        onLoadError={() => setPdfToolDocumentReady(false)}
                      >
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-3">
                          {(pdfToolDocumentReady ? pdfToolPages : []).map((page, idx) => {
                            const selected = selectedPdfPageIndexes.includes(idx);
                            return (
                              <button
                                key={`${page.sourceIndex}-${idx}`}
                                onClick={() => togglePdfPageSelection(idx)}
                                className={`overflow-hidden rounded-xl border-2 text-left transition bg-white ${selected ? 'border-orange-500 ring-2 ring-orange-200' : 'border-slate-200 hover:border-slate-300'}`}
                              >
                                <div className="bg-slate-50 p-2 min-h-[170px] flex items-center justify-center">
                                  <Page
                                    key={`thumb-${selectedPdfToolFile.id}-${page.sourceIndex}-${idx}-${page.rotation}`}
                                    pageNumber={page.sourceIndex + 1}
                                    width={110}
                                    rotate={page.rotation}
                                    renderTextLayer={false}
                                    renderAnnotationLayer={false}
                                  />
                                </div>
                                <div className={`flex items-center justify-between gap-2 px-2.5 py-2 text-xs ${selected ? 'bg-orange-50 text-orange-700' : 'text-slate-600'}`}>
                                  <span className="font-medium">Página {idx + 1}</span>
                                  <input
                                    type="checkbox"
                                    readOnly
                                    checked={selected}
                                    className="w-3.5 h-3.5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                                  />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </Document>
                    ) : (
                      <div className="py-6 text-center text-sm text-slate-500">Preview do PDF indisponível no momento.</div>
                    )}
                  </div>

                  {selectedPdfFiles.length > 1 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-4 mb-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">PDFs selecionados para juntar</p>
                          <p className="text-xs text-slate-500">Estes são os arquivos que entrarão na união dos PDFs.</p>
                        </div>
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                          {selectedPdfFiles.length} selecionados
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                        {selectedPdfFiles.map((file) => {
                          const isCurrent = file.id === selectedPdfToolFile.id;
                          return (
                            <div
                              key={file.id}
                              className={`rounded-xl border p-3 ${isCurrent ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-slate-50/70'}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex items-start gap-2">
                                  <FileText className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isCurrent ? 'text-orange-600' : 'text-slate-500'}`} />
                                  <div className="min-w-0">
                                    <p className={`text-sm font-medium truncate ${isCurrent ? 'text-orange-900' : 'text-slate-900'}`}>{file.original_name}</p>
                                    <p className="text-xs text-slate-500 truncate">{formatFileSize(file.file_size)}</p>
                                  </div>
                                </div>
                                {isCurrent ? (
                                  <span className="inline-flex items-center rounded-full border border-orange-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                                    Atual
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                    <p><span className="font-medium text-slate-900">PDF atual:</span> {selectedPdfToolFile.original_name}</p>
                    <p><span className="font-medium text-slate-900">Total de páginas:</span> {pdfToolPages.length}</p>
                    <p><span className="font-medium text-slate-900">Páginas selecionadas:</span> {selectedPdfPageIndexes.length}</p>
                    <p><span className="font-medium text-slate-900">PDFs selecionados para juntar:</span> {selectedPdfFiles.length}{selectedPdfFiles.length > 1 ? ' (incluindo o PDF atual)' : ''}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col bg-slate-100">
                <div className="px-4 py-3 border-b border-slate-200 bg-white flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {pdfToolMode === 'organize' ? 'Organizar PDF arrastando' : pdfToolMode === 'rotate' ? 'Rodar páginas no preview' : 'Selecionar páginas para remover'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {pdfToolMode === 'organize' ? 'Arraste as miniaturas para reorganizar a ordem.' : pdfToolMode === 'rotate' ? 'Use a manivela de rotação em cada página.' : 'Marque no próprio preview as páginas que deseja remover.'}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={pdfToolSaveAsCopy} onChange={(e) => setPdfToolSaveAsCopy(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500" />
                    Salvar como cópia editada
                  </label>
                </div>

                <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5">
                  {pdfToolPreviewUrl && selectedPdfToolFile ? (
                    <Document
                      key={`editor-${selectedPdfToolFile.id}-${pdfToolPreviewUrl}`}
                      file={pdfToolPreviewUrl}
                      loading={<div className="h-full flex items-center justify-center text-slate-500">Carregando PDF...</div>}
                      error={<div className="h-full flex items-center justify-center text-slate-500">Preview do PDF indisponível no momento.</div>}
                      onLoadSuccess={() => setPdfToolDocumentReady(true)}
                      onLoadError={() => setPdfToolDocumentReady(false)}
                    >
                      <DndContext sensors={pdfToolSensors} collisionDetection={closestCenter} onDragEnd={handlePdfToolDragEnd}>
                        <SortableContext items={pdfToolPageIds} strategy={rectSortingStrategy}>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                            {(pdfToolDocumentReady ? pdfToolPages : []).map((page, index) => {
                              const selected = selectedPdfPageIndexes.includes(index);
                              const sortableId = `${page.sourceIndex}-${index}`;
                              return (
                                <SortablePdfPageCard key={sortableId} id={sortableId}>
                                  <div className={`rounded-2xl border bg-white p-3 shadow-sm transition ${selected ? 'border-orange-300 ring-2 ring-orange-200' : 'border-slate-200 hover:border-orange-200 hover:shadow-md'}`}>
                                    <div className="flex items-center justify-between gap-2 mb-3">
                                      <button
                                        type="button"
                                        onClick={() => togglePdfPageSelection(index)}
                                        className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium border ${selected ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-white text-slate-600 border-slate-200'}`}
                                      >
                                        <input type="checkbox" readOnly checked={selected} className="w-3.5 h-3.5 rounded border-slate-300 text-orange-600 focus:ring-orange-500" />
                                        Página {index + 1}
                                      </button>
                                      {pdfToolMode === 'organize' ? (
                                        <span className="inline-flex items-center gap-1 text-xs text-slate-400"><GripVertical className="w-4 h-4" />Arraste</span>
                                      ) : null}
                                    </div>

                                    <div className="flex justify-center bg-slate-50 rounded-xl p-2 min-h-[240px]">
                                      <Page key={`editor-page-${selectedPdfToolFile.id}-${page.sourceIndex}-${index}-${page.rotation}`} pageNumber={page.sourceIndex + 1} width={170} rotate={page.rotation} renderTextLayer={false} renderAnnotationLayer={false} />
                                    </div>

                                    <div className="mt-3 flex items-center justify-between gap-2">
                                      <span className="text-[11px] text-slate-500">Rotação: {page.rotation}°</span>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => rotateSinglePdfPage(index, -90)}
                                          className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                          title="Rodar -90°"
                                        >
                                          <RotateCcw className="w-4 h-4" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => rotateSinglePdfPage(index, 90)}
                                          className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                          title="Rodar +90°"
                                        >
                                          <RotateCw className="w-4 h-4" />
                                        </button>
                                        {pdfToolMode === 'remove' ? (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setSelectedPdfPageIndexes([index]);
                                              setTimeout(() => removeSelectedPdfPages(), 0);
                                            }}
                                            className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                                            title="Remover página"
                                          >
                                            <Scissors className="w-4 h-4" />
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                </SortablePdfPageCard>
                              );
                            })}
                          </div>
                        </SortableContext>
                      </DndContext>
                    </Document>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-500">Carregando preview do PDF...</div>
                  )}
                </div>

                <div className="border-t border-slate-200 bg-white px-4 sm:px-5 py-3 flex items-center justify-between gap-3 sticky bottom-0">
                  <div className="text-sm text-slate-500">
                    {selectedPdfPageIndexes.length} página(s) selecionada(s)
                  </div>
                  <div className="flex items-center gap-2">
                    {pdfToolMode === 'remove' ? (
                      <button onClick={removeSelectedPdfPages} className="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-sm font-medium text-red-700 hover:bg-red-100">
                        Remover selecionadas
                      </button>
                    ) : null}
                    <button onClick={closePdfToolsModal} className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">Fechar</button>
                    <button onClick={savePdfToolChanges} disabled={pdfToolSaving} className="px-5 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-70">
                      {pdfToolSaving ? 'Salvando...' : 'Salvar PDF'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CloudModule;
