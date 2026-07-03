// Editor de PetiçÃµes Trabalhistas - Syncfusion DocumentEditor v4
// MÃ³dulo isolado - pode ser removido sem afetar outros mÃ³dulos

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { renderAsync } from 'docx-preview';
import {
  Plus,
  Save,
  Download,
  Trash2,
  Eye,
  Edit3,
  X,
  Search,
  FolderOpen,
  Star,
  Loader2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  User,
  Clock,
  Users,
  FileText,
  FileUp,
  Minimize2,
  Maximize2,
  XCircle,
  CheckCircle2,
  ArrowLeft,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Scale,
  Pencil,
  LayoutGrid,
  List,
  ChevronUp,
  Copy,
  Hash,
  Layers,
  BarChart3,
  Filter,
  ChevronsUpDown,
  CloudOff,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import PetitionRibbon from './PetitionRibbon';
import { saveAs } from 'file-saver';
import { ModuleSkeleton } from './ui';
import { petitionEditorService } from '../services/petitionEditor.service';
import { settingsService } from '../services/settings.service';
import { aiService } from '../services/ai.service';
import { cloudService } from '../services/cloud.service';
import type {
  PetitionBlock,
  CreatePetitionBlockDTO,
  SavedPetition,
  BlockCategory,
  DocumentType,
  PetitionBlockCategory,
  LegalArea,
  PetitionStandardType,
} from '../types/petitionEditor.types';
import type { Client } from '../types/client.types';
import type { CloudFile } from '../types/cloud.types';
import { useAuth } from '../contexts/AuthContext';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { useToastContext } from '../contexts/ToastContext';
import { supabase } from '../config/supabase';
import SyncfusionEditor, { SyncfusionEditorRef } from './SyncfusionEditor';

const useDebouncedValue = <T,>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
};

const repairLikelyMojibake = (value: string) => {
  const input = String(value ?? '');
  const likelyMojibakePattern = /(?:Ã[\u0080-\u00FF]|Â[\u0080-\u00FF]|â[\u0080-\u00FF]{1,2}|�)/;
  if (!input || !likelyMojibakePattern.test(input)) return input;

  try {
    const bytes = Uint8Array.from(Array.from(input, (char) => char.charCodeAt(0) & 0xff));
    const fixed = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
    return fixed && fixed !== input ? fixed : input;
  } catch {
    return input;
  }
};

const decodeUnicodeEscapes = (value: string) =>
  String(value ?? '').replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  );

const sanitizeText = (value: unknown) => repairLikelyMojibake(decodeUnicodeEscapes(String(value ?? '')));

const sanitizeLegalAreaRecord = (area: LegalArea): LegalArea => ({
  ...area,
  name: sanitizeText(area.name),
  description: area.description ? sanitizeText(area.description) : area.description,
  icon: area.icon ? sanitizeText(area.icon) : area.icon,
});

const sanitizeStandardTypeRecord = (type: PetitionStandardType): PetitionStandardType => ({
  ...type,
  name: sanitizeText(type.name),
  description: type.description ? sanitizeText(type.description) : type.description,
  default_document_name: type.default_document_name ? sanitizeText(type.default_document_name) : type.default_document_name,
});

const sanitizeSavedPetitionRecord = (petition: SavedPetition): SavedPetition => ({
  ...petition,
  title: sanitizeText(petition.title),
  client_name: petition.client_name ? sanitizeText(petition.client_name) : petition.client_name,
});

const sanitizeBlockRecord = (block: PetitionBlock): PetitionBlock => ({
  ...block,
  title: sanitizeText(block.title),
  tags: Array.isArray(block.tags) ? block.tags.map((tag) => sanitizeText(tag)) : block.tags,
});

const sanitizeClientRecord = (client: Client): Client => ({
  ...client,
  full_name: sanitizeText(client.full_name),
  cpf_cnpj: client.cpf_cnpj ? sanitizeText(client.cpf_cnpj) : client.cpf_cnpj,
  rg: client.rg ? sanitizeText(client.rg) : client.rg,
  nationality: client.nationality ? sanitizeText(client.nationality) : client.nationality,
  profession: client.profession ? sanitizeText(client.profession) : client.profession,
  address_street: client.address_street ? sanitizeText(client.address_street) : client.address_street,
  address_number: client.address_number ? sanitizeText(client.address_number) : client.address_number,
  address_complement: client.address_complement ? sanitizeText(client.address_complement) : client.address_complement,
  address_neighborhood: client.address_neighborhood ? sanitizeText(client.address_neighborhood) : client.address_neighborhood,
  address_city: client.address_city ? sanitizeText(client.address_city) : client.address_city,
  address_state: client.address_state ? sanitizeText(client.address_state) : client.address_state,
  address_zip_code: client.address_zip_code ? sanitizeText(client.address_zip_code) : client.address_zip_code,
  phone: client.phone ? sanitizeText(client.phone) : client.phone,
  email: client.email ? sanitizeText(client.email) : client.email,
});

const sanitizePetitionTitleText = (value: unknown, fallback = '') => {
  const repaired = sanitizeText(value);
  const cleaned = repaired
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\uFFFD+/g, ' ')
    .replace(/[^\p{L}\p{N}\s().,_\-&]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || fallback;
};

const getSanitizedDocumentName = (fileName?: string, fallback = 'Documento importado') => {
  const cleanName = String(fileName || fallback).replace(/\.[^.]+$/, '');
  const sanitized = sanitizePetitionTitleText(cleanName).trim();
  return sanitized || fallback;
};

const loadDocxWithFallback = async (
  editor: SyncfusionEditorRef,
  arrayBuffer: ArrayBuffer,
  fileName: string,
) => {
  try {
    await editor.loadDocx(arrayBuffer, fileName);
  } catch (primaryError) {
    try {
      await editor.loadDocxViaImport(arrayBuffer, fileName);
    } catch {
      throw primaryError;
    }
  }
};

const sfdtToPlainText = (value: string) => {
  const raw = String(value ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const extractByRegex = (input: string) => {
    try {
      const matches: string[] = [];
      const re = /"(?:text|txt|t|tlp)"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(input))) {
        try {
          matches.push(JSON.parse(`"${m[1]}"`));
        } catch {
          matches.push(m[1]);
        }
      }
      return matches.join(' ').replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  };

  try {
    const json = JSON.parse(trimmed);
    const parts: string[] = [];

    const walk = (node: unknown) => {
      if (!node) return;
      if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (typeof node === 'object') {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          const key = String(k).toLowerCase();
          if ((key === 'text' || key === 'txt' || key === 't' || key === 'tlp') && typeof v === 'string') parts.push(v);
          else walk(v);
        }
      }
    };
    walk(json);
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text && !text.trim().startsWith('{') && !text.trim().startsWith('[')) return text;
    const byRegex = extractByRegex(trimmed);
    if (!byRegex) return '';
    if (byRegex.trim().startsWith('{') || byRegex.trim().startsWith('[')) return '';
    return byRegex;
  } catch {
    const byRegex = extractByRegex(trimmed);
    if (!byRegex) return '';
    if (byRegex.trim().startsWith('{') || byRegex.trim().startsWith('[')) return '';
    return byRegex;
  }
};

const normalizeTag = (input: string) => {
  return String(input || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
};

const parseSearchTerms = (q: string) => {
  const stop = new Set([
    'a',
    'o',
    'os',
    'as',
    'de',
    'da',
    'do',
    'das',
    'dos',
    'e',
    'em',
    'no',
    'na',
    'nos',
    'nas',
    'por',
    'para',
    'com',
    'sem',
    'ao',
    'aos',
    'um',
    'uma',
  ]);

  const input = String(q || '');
  if (!input.trim()) return [];

  const phrases: string[] = [];
  const re = /\"([^\"]+)\"/g;
  let remainder = input;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const phrase = normalizeTag(match[1] || '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (phrase) phrases.push(phrase);
  }
  remainder = remainder.replace(re, ' ');

  const tokens = remainder
    .replace(/[\n\r\t,]+/g, ' ')
    .split(' ')
    .map((s) =>
      normalizeTag(s)
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .filter((t) => !stop.has(t))
    .filter((t) => t.length >= 2 || /^\d+$/.test(t));

  const out = [...phrases, ...tokens];
  const seen = new Set<string>();
  return out.filter((t) => {
    const key = normalizeTag(t);
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

type BlockSearchResult = {
  block: PetitionBlock;
  score: number;
  matchPct: number;
};

const dedupeTags = (tags: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const key = normalizeTag(t);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(String(t).trim());
  }
  return out;
};

const getPhraseTagsFromText = (text: string) => {
  const n = normalizeTag(text);
  if (!n) return [] as string[];

  const rules: { re: RegExp; tag: string }[] = [
    { re: /\bacumulo de funcao\b|\bacumul[oÃ³] de fun[cç][aÃ£]o\b/i, tag: 'acumulo de funcao' },
    { re: /\baviso previo\b.*\bcumprid[oa]\b|\baviso pr[eÃ©]vio\b.*\bcumprid[oa]\b/i, tag: 'aviso previo cumprido' },
    { re: /\bdispensad[oa]\b.*\bsem justa causa\b|\bsem justa causa\b/i, tag: 'dispensa sem justa causa' },
    { re: /\bcontrato de trabalho\b/i, tag: 'contrato de trabalho' },
    { re: /\badmiss[aÃ£]o\b|\bcontratad[oa]\b/i, tag: 'admissao' },
    { re: /\bdispensad[oa]\b|\bdesligament[oÃ³]\b/i, tag: 'dispensa' },
    { re: /\batendente\b/i, tag: 'funcao: atendente' },
  ];

  const found: string[] = [];
  for (const r of rules) {
    if (r.re.test(n)) found.push(r.tag);
  }
  return dedupeTags(found);
};

const getDerivedTagsFromText = (text: string) => {
  const n = normalizeTag(text);
  if (!n) return [] as string[];

  const phraseTags = getPhraseTagsFromText(text);
  const stop = new Set([
    'a',
    'o',
    'os',
    'as',
    'de',
    'da',
    'do',
    'das',
    'dos',
    'e',
    'em',
    'no',
    'na',
    'nos',
    'nas',
    'por',
    'para',
    'com',
    'sem',
    'ao',
    'aos',
    'Ã ',
    'Ã s',
  ]);
  const words = n
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !stop.has(w));

  const wordTags = Array.from(new Set(words)).slice(0, 6);
  return dedupeTags([...phraseTags, ...wordTags]).slice(0, 8);
};

// Labels
const CATEGORY_LABELS: Record<BlockCategory, string> = {
  cabecalho: 'Cabecalho',
  qualificacao: 'DAS QUESTOES INICIAIS',
  fatos: 'Dos Fatos',
  direito: 'Do Direito',
  pedidos: 'Dos Pedidos',
  citacao: 'Citacao',
  encerramento: 'Encerramento',
  outros: 'Outros',
};

const MARITAL_STATUS_LABELS: Record<string, string> = {
  solteiro: 'solteiro(a)',
  casado: 'casado(a)',
  divorciado: 'divorciado(a)',
  viuvo: 'viÃºvo(a)',
  uniao_estavel: 'em uniÃ£o estÃ¡vel',
};

const SIDEBAR_WIDTH_STORAGE_KEY = 'petition-editor-sidebar-width';
const DEFAULT_TEMPLATE_STORAGE_KEY = 'petition-editor-default-template-docx-v1';
const DEFAULT_FONT_STORAGE_KEY = 'petition-editor-default-font-v1';
const SELECTED_LEGAL_AREA_STORAGE_KEY = 'petition-editor-selected-legal-area-v1';
const SELECTED_STANDARD_TYPE_STORAGE_KEY_PREFIX = 'petition-editor-selected-standard-type-v1:';
const BLOCK_FILTER_SCOPE_STORAGE_KEY = 'petition-editor-block-filter-scope-v1';

// CSS para o editor - Layout responsivo para 100% zoom
const EDITOR_STYLES = `
  /* ========== ESTRUTURA PRINCIPAL ========== */
  
  /* Wrapper do Editor - ocupa espaço restante apÃ³s sidebar */
  .syncfusion-editor-wrapper {
    flex: 1 1 0%;
    min-width: 0;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    background: #f8fafc;
  }
  
  /* Container Raiz do Syncfusion */
  .syncfusion-editor-wrapper .e-documenteditorcontainer {
    width: 100% !important;
    height: 100% !important;
    max-width: 100% !important;
    border: none !important;
    overflow: hidden !important;
  }

  /* ========== ÃREA PRINCIPAL (Toolbar + Viewer + Pane) ========== */
  
  /* Toolbar nativa do Syncfusion desativada no editor principal (enableToolbar={false});
     a faixa de opçÃµes Ã© o PetitionRibbon. Regras da toolbar nativa removidas (cÃ³digo morto). */

  /* Container principal do Syncfusion quando a toolbar nativa estÃ¡ desligada */
  .syncfusion-editor-wrapper .e-de-tool-ctnr-properties-pane,
  .syncfusion-editor-wrapper .e-de-ctnr-properties-pane,
  .syncfusion-editor-wrapper .e-de-ribbon-simplified-ctnr-properties-pane,
  .syncfusion-editor-wrapper .e-de-ribbon-classic-ctnr-properties-pane {
    display: flex !important;
    flex-direction: row !important;
    flex: 1 1 auto !important;
    min-height: 0 !important;
    min-width: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    overflow: hidden !important;
    background: #f8fafc !important;
  }

  /* ========== VIEWER DA FOLHA (Area Central) ========== */
  
  /* Container do viewer - deve encolher para caber */
  .syncfusion-editor-wrapper .e-de-ctn {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    overflow: auto !important;
    background: #f1f5f9 !important;
  }

  /* Viewer interno */
  .syncfusion-editor-wrapper .e-de-viewer-container {
    min-width: 0 !important;
  }

  .syncfusion-editor-wrapper .e-de-page-container {
    width: 100% !important;
    min-width: 0 !important;
    display: flex !important;
    justify-content: center !important;
    align-items: flex-start !important;
    padding: 24px 32px !important;
    box-sizing: border-box !important;
  }

  /* ========== PAINEL DE PROPRIEDADES (TEXT) - Lado Direito ========== */
  
  .syncfusion-editor-wrapper .e-de-pane,
  .syncfusion-editor-wrapper .e-de-pane-rtl,
  .syncfusion-editor-wrapper .e-de-property-pane {
    flex: 0 0 auto !important;
    background: white !important;
    border-left: 1px solid #e2e8f0 !important;
    overflow-y: auto !important;
    overflow-x: hidden !important;
  }

  /* Modo colapsado (aba fina) â€” controlado via atributo pelo SyncfusionEditor */
  .syncfusion-editor-wrapper .e-de-pane[data-prop-collapsed="1"],
  .syncfusion-editor-wrapper .e-de-pane-rtl[data-prop-collapsed="1"],
  .syncfusion-editor-wrapper .e-de-property-pane[data-prop-collapsed="1"] {
    width: 64px !important;
    min-width: 64px !important;
    max-width: 64px !important;
    overflow: hidden !important;
  }

  /* ========== RESPONSIVIDADE ========== */
  
  @media (max-width: 1600px) {
    .syncfusion-editor-wrapper .e-de-pane,
    .syncfusion-editor-wrapper .e-de-pane-rtl,
    .syncfusion-editor-wrapper .e-de-property-pane {
      width: 175px;
      min-width: 160px;
    }
  }

  @media (max-width: 1440px) {
    .syncfusion-editor-wrapper .e-de-pane,
    .syncfusion-editor-wrapper .e-de-pane-rtl,
    .syncfusion-editor-wrapper .e-de-property-pane {
      width: 170px;
      min-width: 160px;
    }
  }

  @media (max-width: 1366px) {
    .syncfusion-editor-wrapper .e-de-pane,
    .syncfusion-editor-wrapper .e-de-pane-rtl,
    .syncfusion-editor-wrapper .e-de-property-pane {
      width: 165px;
      min-width: 160px;
    }
  }

  /* ========== NAVIGATION PANE (Desabilitar gap) ========== */
  
  .syncfusion-editor-wrapper .e-de-ctnr-navigation-pane,
  .syncfusion-editor-wrapper .e-de-navigation-pane {
    display: none !important;
    width: 0 !important;
  }

  .syncfusion-editor-wrapper .e-toolbar,
  .syncfusion-editor-wrapper .e-de-toolbar,
  .syncfusion-editor-wrapper .e-de-ctnr-toolbar {
    position: relative !important;
    z-index: 0 !important;
  }

  /* Viewer do bloco: esconder status bar (page/zoom) */
  #petition-block-viewer .e-de-status-bar,
  #petition-block-viewer .e-de-ctnr-status-bar,
  #petition-block-viewer .e-de-statusbar,
  #petition-block-viewer .e-de-ctnr-statusbar,
  #petition-block-viewer .e-de-ctnr-statusbar-div {
    display: none !important;
  }
  #petition-block-viewer .e-documenteditorcontainer,
  #petition-block-viewer .e-de-ctn,
  #petition-block-viewer .e-de-ctnr,
  #petition-block-viewer .e-de-ctnr-container {
    height: 100% !important;
  }
  .context-menu {
    position: fixed;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.15);
    z-index: 1000;
    min-width: 180px;
    padding: 4px 0;
  }
  .context-menu-item {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #374151;
  }
  .context-menu-item:hover {
    background: #fef3c7;
  }
`;

// Injeta os estilos estruturais do editor (flex do wrapper, container Syncfusion, etc.).
// Sem isto o .syncfusion-editor-wrapper nÃ£o recebe flex:1 e colapsa para a largura mÃ­nima do conteudo.
if (typeof document !== 'undefined' && !document.getElementById('petition-editor-structural-styles')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'petition-editor-structural-styles';
  styleEl.innerHTML = EDITOR_STYLES;
  document.head.appendChild(styleEl);
}

interface PetitionEditorModuleProps {
  isFloatingWidget?: boolean;
  initialClientId?: string;
  initialPetitionId?: string;
  initialDocumentBase64?: string;
  initialDocumentUrl?: string;
  initialDocumentName?: string;
  initialCloudFileId?: string;
  initialDocumentRequestId?: string;
  onUnsavedChanges?: (hasChanges: boolean) => void;
  onWidgetInfoChange?: (payload: { lastSaved: Date | null; selectedClient: Client | null }) => void;
  onRequestClose?: () => void;
  onRequestMinimize?: () => void;
}

let lastHandledInitialDocumentRequestId: string | null = null;

const PetitionEditorModule: React.FC<PetitionEditorModuleProps> = ({
  isFloatingWidget = false,
  initialClientId,
  initialPetitionId,
  initialDocumentBase64,
  initialDocumentUrl,
  initialDocumentName,
  initialCloudFileId,
  initialDocumentRequestId,
  onUnsavedChanges,
  onWidgetInfoChange,
  onRequestClose,
  onRequestMinimize,
}) => {
  const { user } = useAuth();
  const { confirmDelete, notifyDeleted } = useDeleteConfirm();
  const { success: toastSuccess, error: toastError } = useToastContext();

  const formatUserDisplayName = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return '';

    const lowerWords = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
    return trimmed
      .split(/\s+/g)
      .map((word, idx) => {
        const lower = word.toLowerCase();
        if (idx > 0 && lowerWords.has(lower)) return lower;
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(' ');
  };

  const rawUserDisplayName =
    (user?.user_metadata as any)?.full_name ||
    (user?.user_metadata as any)?.name ||
    (user?.user_metadata as any)?.display_name ||
    (typeof user?.email === 'string' && user.email.includes('@') ? user.email.split('@')[0] : '') ||
    'Usuario';

  const userDisplayName = formatUserDisplayName(rawUserDisplayName) || 'Usuario';
  const isCloudImportMode = isFloatingWidget && Boolean(initialDocumentBase64 || initialDocumentUrl);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  };
  
  // Estados principais
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [formattingWithAI, setFormattingWithAI] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentImportLoading, setDocumentImportLoading] = useState(false);

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'blocks' | 'clients'>('blocks');
  const [activeWorkspace, setActiveWorkspace] = useState<'editor' | 'blocks'>('editor');
  const [blocksEnabled, setBlocksEnabled] = useState(true);
  const [bmExpandedBlocks, setBmExpandedBlocks] = useState<Set<string>>(new Set());
  const [bmDocxPreviews, setBmDocxPreviews] = useState<Map<string, 'loading' | 'done' | 'error'>>(new Map());
  const bmPreviewContainersRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const bmPreviewQueueRef = useRef<string[]>([]);
  const bmPreviewBusyRef = useRef(false);
  const [bmViewMode, setBmViewMode] = useState<'list' | 'grid'>('list');
  const [bmSortBy, setBmSortBy] = useState<'title' | 'updated' | 'category'>('category');
  const [bmCollapsedCategories, setBmCollapsedCategories] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      if (typeof window === 'undefined') return 288;
      const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 288;
    } catch {
      return 288;
    }
  });
  const isResizingSidebarRef = useRef(false);
  const sidebarResizeStartXRef = useRef(0);
  const sidebarResizeStartWidthRef = useRef(288);

  // Areas JurÃ­dicas
  const [legalAreas, setLegalAreas] = useState<LegalArea[]>([]);
  const [selectedLegalAreaId, setSelectedLegalAreaId] = useState<string | null>(() => {
    try {
      const v = window.localStorage.getItem(SELECTED_LEGAL_AREA_STORAGE_KEY);
      return v || null;
    } catch {
      return null;
    }
  });
  const [showLegalAreaModal, setShowLegalAreaModal] = useState(false);
  const [editingLegalArea, setEditingLegalArea] = useState<LegalArea | null>(null);
  const [legalAreaFormData, setLegalAreaFormData] = useState({ name: '', description: '', color: '#f97316', icon: 'scale' });

  // PetiçÃµes Padroes (Standard Types)
  const [standardTypes, setStandardTypes] = useState<PetitionStandardType[]>([]);
  const [standardTypesByArea, setStandardTypesByArea] = useState<Record<string, PetitionStandardType[]>>({});
  const [selectedStandardTypeId, setSelectedStandardTypeId] = useState<string | null>(() => {
    try {
      const areaId = window.localStorage.getItem(SELECTED_LEGAL_AREA_STORAGE_KEY);
      if (!areaId) return null;
      const v = window.localStorage.getItem(`${SELECTED_STANDARD_TYPE_STORAGE_KEY_PREFIX}${areaId}`);
      return v || null;
    } catch {
      return null;
    }
  });
  const [showStandardTypeModal, setShowStandardTypeModal] = useState(false);
  const [editingStandardType, setEditingStandardType] = useState<PetitionStandardType | null>(null);
  const [standardTypeFormData, setStandardTypeFormData] = useState({ name: '', description: '' });
  // Escopo de filtro de blocos: 'type' = petiçÃ£o padrÃ£o, 'area' = area jurÃ­dica, 'global' = todos
  const [blockFilterScope, setBlockFilterScope] = useState<'type' | 'area' | 'global'>(() => {
    try {
      const v = window.localStorage.getItem(BLOCK_FILTER_SCOPE_STORAGE_KEY);
      if (v === 'type' || v === 'area' || v === 'global') return v;
      return 'area';
    } catch {
      return 'area';
    }
  });

  // Blocos
  const [blocks, setBlocks] = useState<PetitionBlock[]>([]);
  const [blockSearch, setBlockSearch] = useState('');
  const blockSearchDebounced = useDebouncedValue(blockSearch, 220);
  const [selectedDocumentType, setSelectedDocumentType] = useState<DocumentType>('petition');
  const [blockCategories, setBlockCategories] = useState<PetitionBlockCategory[]>([]);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<{ id?: string; key: string; label: string; order: number }[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Editor Syncfusion
  const [petitionTitle, setPetitionTitle] = useState('Nova Peticao Trabalhista');
  const [currentPetitionId, setCurrentPetitionId] = useState<string | null>(null);
  // Ref sÃ­ncrono: usado em savePetition para evitar race condition de duplicaçÃ£o
  // (setCurrentPetitionId Ã© async; sem este ref, mÃºltiplos saves concorrentes
  // viam null e criavam vÃ¡rias petiçÃµes do mesmo documento).
  const currentPetitionIdRef = useRef<string | null>(null);
  // Lock sÃ­ncrono: impede 2 saves concorrentes de chegarem ao create() simultÃ¢neo
  const saveInFlightRef = useRef(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isOnline, setIsOnline] = useState(() => {
    try {
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    } catch {
      return true;
    }
  });
  // Conexao real com o servidor (Supabase). navigator.onLine so sabe da rede local;
  // aqui confirmamos que o banco que salva a peticao esta respondendo de fato.
  const [serverReachable, setServerReachable] = useState(true);
  const [checkingServer, setCheckingServer] = useState(false);
  // Estado dedicado ao clique manual em "Tentar reconectar" (independe do ping automatico de 60s).
  const [isRetrying, setIsRetrying] = useState(false);
  // Sinaliza que a ultima tentativa manual falhou -> dispara feedback (shake + mensagem).
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const reconnectFailedTimerRef = useRef<number | null>(null);
  const [settingDefaultTemplate, setSettingDefaultTemplate] = useState(false);

  useEffect(() => {
    if (!petitionTitle) return;
    const fixedTitle = sanitizePetitionTitleText(petitionTitle);
    if (fixedTitle !== petitionTitle) {
      setPetitionTitle(fixedTitle);
    }
  }, [petitionTitle]);

  // Confirma ativamente que o servidor (banco) responde. Retorna true/false.
  const checkServerConnection = useCallback(async () => {
    const online = (() => {
      try {
        return typeof navigator !== 'undefined' ? navigator.onLine : true;
      } catch {
        return true;
      }
    })();
    if (!online) {
      setServerReachable(false);
      return false;
    }
    setCheckingServer(true);
    try {
      const ok = await petitionEditorService.pingServer();
      setServerReachable(ok);
      return ok;
    } catch {
      setServerReachable(false);
      return false;
    } finally {
      setCheckingServer(false);
    }
  }, []);

  const handleRetryConnection = useCallback(async () => {
    if (isRetrying) return;
    const next = (() => {
      try {
        return typeof navigator !== 'undefined' ? navigator.onLine : true;
      } catch {
        return true;
      }
    })();
    setIsOnline(next);
    setReconnectFailed(false);
    if (reconnectFailedTimerRef.current) {
      window.clearTimeout(reconnectFailedTimerRef.current);
      reconnectFailedTimerRef.current = null;
    }
    setIsRetrying(true);
    const startedAt = Date.now();
    let ok = false;
    try {
      ok = await checkServerConnection();
    } finally {
      // Garante que a animacao seja perceptivel mesmo quando o ping responde instantaneamente.
      const elapsed = Date.now() - startedAt;
      const MIN_SPIN_MS = 700;
      if (elapsed < MIN_SPIN_MS) {
        await new Promise((r) => window.setTimeout(r, MIN_SPIN_MS - elapsed));
      }
      setIsRetrying(false);
    }
    if (!ok) {
      // Ainda offline: feedback visivel (shake + aviso), auto-limpa depois.
      setReconnectFailed(true);
      reconnectFailedTimerRef.current = window.setTimeout(() => {
        setReconnectFailed(false);
        reconnectFailedTimerRef.current = null;
      }, 3200);
    }
  }, [checkServerConnection, isRetrying]);

  useEffect(() => () => {
    if (reconnectFailedTimerRef.current) window.clearTimeout(reconnectFailedTimerRef.current);
  }, []);
  const [openingPetitionId, setOpeningPetitionId] = useState<string | null>(null);
  const [pendingPetitionLoadKey, setPendingPetitionLoadKey] = useState(0);
  const editorRef = useRef<SyncfusionEditorRef>(null);
  const blockConvertEditorRef = useRef<SyncfusionEditorRef>(null);
  const [editorReady, setEditorReady] = useState(false);

  const [defaultDocFont, setDefaultDocFont] = useState<{ fontFamily?: string; fontSize?: number } | null>(null);
  const defaultDocFontRef = useRef<{ fontFamily?: string; fontSize?: number } | null>(null);
  const blockViewDocxTokenRef = useRef(0);
  const blockViewDocxContainerRef = useRef<HTMLDivElement | null>(null);
  const contentChangeSeqRef = useRef(0);
  const defaultTemplateAutoAppliedRef = useRef(false);
  const autoCreateInFlightRef = useRef(false);
  const savePetitionActionRef = useRef<(() => Promise<void>) | null>(null);
  const selectedClientIdRef = useRef<string | null>(null);
  const hasUnsavedChangesRef = useRef(false);
  const isOnlineRef = useRef(true);
  const serverReachableRef = useRef(true);
  const realtimeRefreshTimerRef = useRef<number | null>(null);

  // PetiçÃµes salvas
  const [savedPetitions, setSavedPetitions] = useState<SavedPetition[]>([]);
  const [savedPetitionsLoading, setSavedPetitionsLoading] = useState(true);
  const [sourceCloudFile, setSourceCloudFile] = useState<CloudFile | null>(null);

  // Clientes
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const [relativeTimeTick, setRelativeTimeTick] = useState(0);

  useEffect(() => {
    settingsService.getPetitionEditorModuleConfig().then(cfg => {
      setBlocksEnabled(cfg.blocks_enabled);
      if (!cfg.blocks_enabled) setActiveWorkspace('editor');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setRelativeTimeTick((t) => t + 1), 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    defaultDocFontRef.current = defaultDocFont;
  }, [defaultDocFont]);

  const saveDefaultDocFont = (font: { fontFamily?: string; fontSize?: number } | null) => {
    setDefaultDocFont(font);
    // Salvar no banco
    petitionEditorService.saveDefaultFont(
      font?.fontFamily ?? null,
      font?.fontSize ?? null,
    ).catch(() => {
      // Fallback localStorage
      try {
        if (!font) {
          window.localStorage.removeItem(DEFAULT_FONT_STORAGE_KEY);
        } else {
          window.localStorage.setItem(DEFAULT_FONT_STORAGE_KEY, JSON.stringify(font));
        }
      } catch { /* ignore */ }
    });
  };

  const captureAndApplyDocFontSoon = (editor: SyncfusionEditorRef) => {
    window.setTimeout(() => {
      try {
        editor.moveToDocumentStart?.();
        const f = editor.getCurrentFont?.() || {};
        const fontFamily = typeof f.fontFamily === 'string' && f.fontFamily.trim() ? f.fontFamily.trim() : undefined;
        const fontSize = typeof f.fontSize === 'number' && Number.isFinite(f.fontSize) && f.fontSize > 0 ? f.fontSize : undefined;
        if (!fontFamily && !fontSize) return;
        saveDefaultDocFont({ fontFamily, fontSize });
        editor.applyCurrentFont?.(fontFamily, fontSize);
      } catch {
        // ignore
      }
    }, 180);
  };

  useEffect(() => {
    selectedClientIdRef.current = selectedClient?.id ?? null;
  }, [selectedClient?.id]);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    serverReachableRef.current = serverReachable;
  }, [serverReachable]);

  useEffect(() => {
    const update = () => {
      const next = (() => {
        try {
          return typeof navigator !== 'undefined' ? navigator.onLine : true;
        } catch {
          return true;
        }
      })();
      setIsOnline(next);

      if (!next) {
        setError('Voce esta offline. O Peticionamento e 100% online: reconecte para editar/salvar.');
      } else {
        setError((prev) => (prev === 'Voce esta offline. O Peticionamento e 100% online: reconecte para editar/salvar.' ? null : prev));
      }
    };

    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Verificacao ativa da conexao com o servidor a cada 1 minuto enquanto o editor esta aberto.
  // Detecta queda do banco/servidor mesmo quando a internet local continua "online".
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void checkServerConnection();
    };
    tick(); // checagem imediata ao abrir
    const id = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [checkServerConnection]);

  // Ao recuperar a internet, revalida o servidor imediatamente (nao espera o proximo ciclo).
  useEffect(() => {
    if (isOnline) {
      void checkServerConnection();
    } else {
      setServerReachable(false);
    }
  }, [isOnline, checkServerConnection]);

  // Toast ao restabelecer a conexao (transicao desconectado -> conectado).
  const wasConnectedRef = useRef(true);
  useEffect(() => {
    const connected = isOnline && serverReachable;
    if (connected && !wasConnectedRef.current) {
      toastSuccess('Conexao com o servidor restabelecida');
    }
    wasConnectedRef.current = connected;
  }, [isOnline, serverReachable]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChangesRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    if (isCloudImportMode) return;

    const scheduleRefresh = () => {
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }

      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        setSavedPetitionsLoading(true);
        petitionEditorService
          .listPetitions()
          .then((petitionsData) => setSavedPetitions((petitionsData || []).map(sanitizeSavedPetitionRecord)))
          .catch(() => {
            // ignore
          })
          .finally(() => setSavedPetitionsLoading(false));
      }, 1500);
    };

    const channel = supabase
      .channel(`petition-editor-saved-petitions-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'saved_petitions',
          filter: `created_by=eq.${user.id}`,
        },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [user?.id, isCloudImportMode]);

  const formatRelativeTime = (dateString?: string | null): string => {
    if (!dateString) return '-';
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return '-';
    const diffMs = Date.now() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 10) return 'Agora';
    if (diffSec < 60) return `Ha ${diffSec} s`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Ha ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Ha ${diffH} h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `Ha ${diffD} d`;
    return d.toLocaleDateString('pt-BR');
  };

  // Modal de bloco
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [editingBlock, setEditingBlock] = useState<PetitionBlock | null>(null);
  const [updateExistingBlockMode, setUpdateExistingBlockMode] = useState(false);
  const [updateExistingBlockId, setUpdateExistingBlockId] = useState('');
  const [blockStandardTypeId, setBlockStandardTypeId] = useState<string | null>(null);
  const [blockStandardTypeLoading, setBlockStandardTypeLoading] = useState(false);
  const [blockFormData, setBlockFormData] = useState<CreatePetitionBlockDTO>({
    title: '',
    content: '',
    category: 'outros',
    document_type: 'petition',
    legal_area_id: null,
    is_default: false,
    is_active: true,
    tags: [],
  });

  const blockEditorRef = useRef<SyncfusionEditorRef | null>(null);
  const [selectionToCreateBlock, setSelectionToCreateBlock] = useState<{ sfdt: string; text: string } | null>(null);
  const blockModalInitDoneRef = useRef(false);
  const [blockTagInput, setBlockTagInput] = useState('');

  const addTagsFromText = (rawText: string) => {
    const text = String(rawText || '').trim();
    if (!text) return;

    const ignore = new Set([
      'a',
      'as',
      'ao',
      'aos',
      'Ã ',
      'Ã s',
      'com',
      'da',
      'das',
      'de',
      'do',
      'dos',
      'e',
      'em',
      'na',
      'nas',
      'no',
      'nos',
      'para',
      'por',
      'sem',
      'uma',
      'um',
    ]);

    const parts = text
      .split(/\s+/g)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => t.replace(/[^0-9a-zA-Z\u00C0-\u017F_-]/g, ''))
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => t.toLowerCase())
      .filter((t) => t.length >= 3)
      .filter((t) => {
        const n = normalizeSearchText(t);
        if (!n) return false;
        if (ignore.has(n)) return false;
        return true;
      });

    if (parts.length === 0) {
      setBlockTagInput('');
      return;
    }

    setBlockFormData((prev) => {
      const existing = Array.isArray(prev.tags) ? prev.tags : [];
      const next = existing.slice();
      for (const p of parts) {
        if (!next.includes(p)) next.push(p);
      }
      return { ...prev, tags: next };
    });
    setBlockTagInput('');
  };

  // Modal de busca de bloco
  const [showBlockSearchModal, setShowBlockSearchModal] = useState(false);
  const [blockSearchQuery, setBlockSearchQuery] = useState('');
  const blockSearchQueryDebounced = useDebouncedValue(blockSearchQuery, 260);
  const [blockSearchScope, setBlockSearchScope] = useState<'type' | 'area' | 'global'>(() => {
    if (selectedStandardTypeId) return 'type';
    return 'area';
  });
  const [blockSearchBlocks, setBlockSearchBlocks] = useState<PetitionBlock[]>([]);
  const [blockSearchLoading, setBlockSearchLoading] = useState(false);

  const [showBlockViewModal, setShowBlockViewModal] = useState(false);
  const [viewingBlock, setViewingBlock] = useState<PetitionBlock | null>(null);
  const [viewingBlockMatchPct, setViewingBlockMatchPct] = useState<number | null>(null);
  const [blockViewFallbackText, setBlockViewFallbackText] = useState('');
  const [blockViewUseFallback, setBlockViewUseFallback] = useState(false);
  const [blockViewDocxLoading, setBlockViewDocxLoading] = useState(false);
  const [blockViewDocxError, setBlockViewDocxError] = useState('');

  useEffect(() => {
    if (!showBlockSearchModal) return;
    if (selectedStandardTypeId && blockSearchScope !== 'type') return;
    if (!selectedStandardTypeId && blockSearchScope === 'type') {
      setBlockSearchScope('area');
    }
  }, [showBlockSearchModal, selectedStandardTypeId, blockSearchScope]);

  useEffect(() => {
    if (!showBlockSearchModal) return;
    let cancelled = false;
    const load = async () => {
      try {
        setBlockSearchLoading(true);
        let data: PetitionBlock[] = [];

        if (blockSearchScope === 'type' && selectedStandardTypeId) {
          data = await petitionEditorService.listBlocksByStandardType(selectedStandardTypeId);
        } else if (blockSearchScope === 'global') {
          data = await petitionEditorService.listBlocks(selectedDocumentType);
        } else {
          data = await petitionEditorService.listBlocksByLegalArea(selectedLegalAreaId, selectedDocumentType);
        }

        const filtered = (data || []).filter(
          (b) =>
            Boolean(b?.is_active) &&
            String((b.document_type || 'petition') as any) === String(selectedDocumentType)
        );

        if (!cancelled) setBlockSearchBlocks(filtered);
      } catch {
        if (!cancelled) setBlockSearchBlocks([]);
      } finally {
        if (!cancelled) setBlockSearchLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [showBlockSearchModal, blockSearchScope, selectedStandardTypeId, selectedLegalAreaId, selectedDocumentType]);

  // Modelo Word importado
  const fileInputRef = useRef<HTMLInputElement>(null);
  const defaultTemplateInputRef = useRef<HTMLInputElement>(null);
  const [hasDefaultTemplate, setHasDefaultTemplate] = useState(false);
  const [defaultTemplateName, setDefaultTemplateName] = useState<string | null>(null);
  const defaultTemplateMemoryRef = useRef<{ name: string; dataBase64: string } | null>(null);

  const isLoadingPetitionRef = useRef(false);

  const [showCompanyLookupModal, setShowCompanyLookupModal] = useState(false);
  const [companyCnpjInput, setCompanyCnpjInput] = useState('');
  const [companyLookupLoading, setCompanyLookupLoading] = useState(false);
  const [companyLookupResultText, setCompanyLookupResultText] = useState<string | null>(null);
  const [showAiEditModal, setShowAiEditModal] = useState(false);
  const [aiEditInstruction, setAiEditInstruction] = useState('');
  const [aiEditSelectedText, setAiEditSelectedText] = useState('');

  useEffect(() => {
    if (!error) return;
    toastError(error);
  }, [error, toastError]);

  const openBlockModal = (block?: PetitionBlock) => {
    setError(null);
    setSelectionToCreateBlock(null);
    blockModalInitDoneRef.current = false;
    setBlockStandardTypeLoading(false);

    if (block) {
      const normalizedBlock = sanitizeBlockRecord(block);
      setEditingBlock(normalizedBlock);
      setUpdateExistingBlockMode(false);
      setUpdateExistingBlockId('');
      setBlockStandardTypeId(null);
      setBlockFormData({
        title: normalizedBlock.title,
        content: normalizedBlock.content,
        category: normalizedBlock.category,
        document_type: (normalizedBlock.document_type || selectedDocumentType) as any,
        legal_area_id: (normalizedBlock.legal_area_id ?? selectedLegalAreaId) as any,
        is_default: normalizedBlock.is_default,
        is_active: normalizedBlock.is_active,
        tags: normalizedBlock.tags || [],
      });
    } else {
      setEditingBlock(null);
      setUpdateExistingBlockMode(false);
      setUpdateExistingBlockId('');
      setBlockStandardTypeId(selectedStandardTypeId || null);
      setBlockFormData({
        title: '',
        content: selectionToCreateBlock?.sfdt || '',
        category: 'outros',
        document_type: selectedDocumentType,
        legal_area_id: selectedLegalAreaId,
        is_default: false,
        is_active: true,
        tags: [],
      });
    }

    setShowBlockModal(true);
  };

  const getCategoryLabel = (key: string) => {
    const found = blockCategories.find((c) => c.is_active && c.key === key);
    if (found?.label) return found.label;
    return (CATEGORY_LABELS as any)[key] || key;
  };

  const categoryKeysOrdered = useMemo(() => {
    const active = (blockCategories || []).filter((c) => c.is_active);
    if (!active.length) {
      return Object.keys(CATEGORY_LABELS);
    }
    return [...active].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((c) => c.key);
  }, [blockCategories]);

  const ensureDraftFromCategories = (cats: PetitionBlockCategory[]) => {
    const active = (cats || []).filter((c) => c.is_active);
    const base = active.length
      ? [...active].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((c) => ({ id: c.id, key: c.key, label: c.label, order: c.order }))
      : Object.entries(CATEGORY_LABELS).map(([k, v], idx) => ({ key: k, label: v, order: idx }));
    setCategoryDraft(base);
  };

  // ==================== ÃREAS JURÃDICAS ====================

  const openLegalAreaModal = (area?: LegalArea) => {
    setError(null);
    if (area) {
      setEditingLegalArea(area);
      setLegalAreaFormData({
        name: area.name,
        description: area.description || '',
        color: area.color || '#f97316',
        icon: area.icon || 'scale',
      });
    } else {
      setEditingLegalArea(null);
      setLegalAreaFormData({ name: '', description: '', color: '#f97316', icon: 'scale' });
    }
    setShowLegalAreaModal(true);
  };

  const handleSaveLegalArea = async () => {
    if (!legalAreaFormData.name.trim()) {
      setError('Nome da area e obrigatorio');
      return;
    }

    try {
      setSaving(true);
      if (editingLegalArea) {
        await petitionEditorService.updateLegalArea(editingLegalArea.id, {
          name: legalAreaFormData.name.trim(),
          description: legalAreaFormData.description.trim() || null,
          color: legalAreaFormData.color,
          icon: legalAreaFormData.icon,
        });
        showSuccessMessage('Area atualizada com sucesso');
      } else {
        const newArea = await petitionEditorService.createLegalArea({
          name: legalAreaFormData.name.trim(),
          description: legalAreaFormData.description.trim() || null,
          color: legalAreaFormData.color,
          icon: legalAreaFormData.icon,
        });
        // Selecionar a nova area
        setSelectedLegalAreaId(newArea.id);
        showSuccessMessage('Area criada com sucesso');
      }
      // Recarregar areas
      const areas = (await petitionEditorService.listLegalAreas()).map(sanitizeLegalAreaRecord);
      setLegalAreas(areas);
      setShowLegalAreaModal(false);
    } catch (err) {
      console.error('Erro ao salvar area:', err);
      setError('Erro ao salvar area juridica');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLegalArea = async (areaId: string) => {
    try {
      await petitionEditorService.deleteLegalArea(areaId);
      const areas = (await petitionEditorService.listLegalAreas()).map(sanitizeLegalAreaRecord);
      setLegalAreas(areas);
      // Se a area deletada era a selecionada, selecionar outra
      if (selectedLegalAreaId === areaId) {
        setSelectedLegalAreaId(areas.length > 0 ? areas[0].id : null);
      }
      showSuccessMessage('Area desativada com sucesso');
    } catch (err) {
      console.error('Erro ao deletar area:', err);
      setError('Erro ao desativar area juridica');
    }
  };

  // ==================== PETIÃ‡Ã•ES PADRÃ•ES ====================

  const openStandardTypeModal = (type?: PetitionStandardType) => {
    if (type) {
      setEditingStandardType(type);
      setStandardTypeFormData({ name: type.name, description: type.description || '' });
    } else {
      setEditingStandardType(null);
      setStandardTypeFormData({ name: '', description: '' });
    }
    setShowStandardTypeModal(true);
  };

  const handleSaveStandardType = async () => {
    if (!standardTypeFormData.name.trim()) {
      setError('Nome da peticao padrao e obrigatorio');
      return;
    }
    if (!selectedLegalAreaId) {
      setError('Selecione uma area juridica primeiro');
      return;
    }

    try {
      setSaving(true);
      if (editingStandardType) {
        await petitionEditorService.updateStandardType(editingStandardType.id, {
          name: standardTypeFormData.name.trim(),
          description: standardTypeFormData.description.trim() || null,
        });
        showSuccessMessage('Peticao padrao atualizada');
      } else {
        const newType = await petitionEditorService.createStandardType({
          legal_area_id: selectedLegalAreaId,
          name: standardTypeFormData.name.trim(),
          description: standardTypeFormData.description.trim() || null,
        });
        setSelectedStandardTypeId(newType.id);
        showSuccessMessage('Peticao padrao criada');
      }
      // Recarregar tipos
      const types = (await petitionEditorService.listStandardTypes(selectedLegalAreaId)).map(sanitizeStandardTypeRecord);
      setStandardTypes(types);
      if (selectedLegalAreaId) {
        setStandardTypesByArea((prev) => ({ ...prev, [selectedLegalAreaId]: types }));
      }
      setShowStandardTypeModal(false);
    } catch (err) {
      console.error('Erro ao salvar peticao padrao:', err);
      setError('Erro ao salvar peticao padrao');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStandardType = async (typeId: string) => {
    try {
      await petitionEditorService.deleteStandardType(typeId);
      const types = (await petitionEditorService.listStandardTypes(selectedLegalAreaId)).map(sanitizeStandardTypeRecord);
      setStandardTypes(types);
      if (selectedLegalAreaId) {
        setStandardTypesByArea((prev) => ({ ...prev, [selectedLegalAreaId]: types }));
      }
      if (selectedStandardTypeId === typeId) {
        setSelectedStandardTypeId(null);
        setBlockFilterScope('area');
      }
      showSuccessMessage('Peticao padrao removida');
    } catch (err) {
      console.error('Erro ao deletar peticao padrao:', err);
      setError('Erro ao remover peticao padrao');
    }
  };

  const handleSetDefaultDocument = async (typeId: string) => {
    if (!editorRef.current) return;
    try {
      setSaving(true);
      const sfdt = editorRef.current.getSfdt();
      const updated = sanitizeStandardTypeRecord(await petitionEditorService.updateStandardType(typeId, {
        default_document: sfdt,
        default_document_name: petitionTitle || 'Documento Padrao',
      }));
      setStandardTypes((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setStandardTypesByArea((prev) => {
        const areaId = String(updated.legal_area_id || '');
        if (!areaId) return prev;
        const current = prev[areaId] ?? [];
        const next = current.some((t) => t.id === updated.id)
          ? current.map((t) => (t.id === updated.id ? updated : t))
          : [...current, updated];
        return { ...prev, [areaId]: next };
      });
      setEditingStandardType((prev) => (prev && prev.id === updated.id ? updated : prev));
      showSuccessMessage('Documento padrao vinculado');
    } catch (err) {
      console.error('Erro ao vincular documento:', err);
      setError('Erro ao vincular documento padrao');
    } finally {
      setSaving(false);
    }
  };

  const handleLinkBlockToStandardType = async (blockId: string) => {
    if (!selectedStandardTypeId) return;
    try {
      await petitionEditorService.addBlockToStandardType(selectedStandardTypeId, blockId);
      showSuccessMessage('Bloco vinculado a peticao padrao');
    } catch (err) {
      console.error('Erro ao vincular bloco:', err);
      setError('Erro ao vincular bloco');
    }
  };

  const selectedLegalArea = useMemo(() => {
    return legalAreas.find((a) => a.id === selectedLegalAreaId) || null;
  }, [legalAreas, selectedLegalAreaId]);

  // TÃ­tulo dinÃ¢mico baseado na area selecionada
  const getDefaultPetitionTitle = useCallback(() => {
    if (selectedLegalArea) {
      return `Nova Peticao ${selectedLegalArea.name}`;
    }
    return 'Nova Peticao';
  }, [selectedLegalArea]);

  const openCreateBlockFromSelection = (selectedText: string, selectedSfdt: string) => {
    setError(null);
    setEditingBlock(null);
    setUpdateExistingBlockMode(false);
    setUpdateExistingBlockId('');
    blockModalInitDoneRef.current = false;

    setBlockFormData({
      title: '',
      content: selectedSfdt || '',
      category: 'outros',
      document_type: selectedDocumentType,
      legal_area_id: selectedLegalAreaId,
      is_default: false,
      is_active: true,
      tags: [],
    });

    setSelectionToCreateBlock({
      sfdt: selectedSfdt || '',
      text: selectedText || '',
    });

    setShowBlockModal(true);
  };

  const openViewBlock = (block: PetitionBlock, matchPct?: number) => {
    const token = (blockViewDocxTokenRef.current += 1);
    setViewingBlock(block);
    setViewingBlockMatchPct(typeof matchPct === 'number' ? matchPct : null);
    setShowBlockViewModal(true);
    setBlockViewUseFallback(false);
    setBlockViewFallbackText('');
    setBlockViewDocxError('');
    setBlockViewDocxLoading(true);
    if (blockViewDocxContainerRef.current) blockViewDocxContainerRef.current.innerHTML = '';

    const sfdt = String(block.content || '').trim();
    const looksLikeSfdt = sfdt.startsWith('{') || sfdt.startsWith('[');

    let tries = 0;
    const maxTries = 20;

    const tryLoad = () => {
      if (blockViewDocxTokenRef.current !== token) return;
      const ed = blockConvertEditorRef.current;
      const container = blockViewDocxContainerRef.current;
      if (!ed) {
        tries += 1;
        if (tries <= maxTries) window.setTimeout(tryLoad, 80);
        else {
          if (blockViewDocxTokenRef.current !== token) return;
          setBlockViewUseFallback(true);
          setBlockViewFallbackText(sfdtToPlainText(sfdt));
          setBlockViewDocxLoading(false);
          setBlockViewDocxError('Nao foi possivel inicializar o conversor');
        }
        return;
      }

      if (!container) {
        tries += 1;
        if (tries <= maxTries) window.setTimeout(tryLoad, 80);
        else {
          if (blockViewDocxTokenRef.current !== token) return;
          setBlockViewUseFallback(true);
          setBlockViewFallbackText(sfdtToPlainText(sfdt));
          setBlockViewDocxLoading(false);
          setBlockViewDocxError('Pre-visualizacao indisponivel');
        }
        return;
      }

      (async () => {
        try {
          if (looksLikeSfdt) {
            ed.loadSfdt(sfdt);
          } else {
            ed.clear();
            if (sfdt) ed.insertText(sfdt);
          }

          await new Promise((r) => window.setTimeout(r, 80));
          ed.refresh?.();
          await new Promise((r) => window.setTimeout(r, 80));

          const blob = await ed.exportDocx(`${block.title || 'bloco'}.docx`);
          if (blockViewDocxTokenRef.current !== token) return;
          const arrayBuffer = await blob.arrayBuffer();
          if (blockViewDocxContainerRef.current) blockViewDocxContainerRef.current.innerHTML = '';
          await renderAsync(arrayBuffer, container, undefined, {
            className: 'docx-preview',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            experimental: false,
            trimXmlDeclaration: true,
            useBase64URL: true,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true,
          } as any);

          if (blockViewDocxTokenRef.current !== token) return;
          setBlockViewDocxLoading(false);
          setBlockViewDocxError('');
          setBlockViewUseFallback(false);
        } catch {
          if (blockViewDocxTokenRef.current !== token) return;
          setBlockViewDocxLoading(false);
          setBlockViewDocxError('Falha ao renderizar pre-visualizacao');
          setBlockViewUseFallback(true);
          setBlockViewFallbackText(sfdtToPlainText(sfdt));
        }
      })();
    };

    window.setTimeout(tryLoad, 0);
  };

  const generateBlockTags = async (title: string, contentSfdt: string): Promise<string[]> => {
    const plain = sfdtToPlainText(contentSfdt);
    const baseText = `${title}\n${plain}`.trim();

    const fallbackCandidates = [
      'contrato de trabalho',
      'aviso previo cumprido',
      'acumulo de funcao',
      'horas extras',
      'fgts',
      'dano moral',
      'rescisao indireta',
      'pedido de demissao',
      'dispensa sem justa causa',
      'ctps',
      'assinatura ctps',
      'verbas rescisorias',
      'adicional noturno',
      'intervalo intrajornada',
      'intervalo interjornada',
      'insalubridade',
      'periculosidade',
      'desvio de funcao',
      'equiparacao salarial',
    ];

    const fallback = () => {
      const n = normalizeTag(baseText);
      const phraseTags = getPhraseTagsFromText(baseText);
      const found = fallbackCandidates
        .filter((k) => n.includes(k))
        .map((k) => k.replace(/\s+/g, ' ').trim());
      const uniq = dedupeTags([...phraseTags, ...found]).slice(0, 8);
      if (uniq.length) return uniq;
      return getDerivedTagsFromText(baseText);
    };

    if (!aiService.isEnabled()) return fallback();

    try {
      const systemPrompt = `VocÃª Ã© um assistente jurÃ­dico especialista em açÃµes trabalhistas no Brasil.
Sua tarefa Ã© gerar palavras-chave (tags) curtas para um bloco de petiçÃ£o.
Regras:
- Retorne APENAS um JSON vÃ¡lido no formato: {"tags": ["tag1", "tag2", ...]}
- Tags em portuguÃªs, minÃºsculas, sem acentos.
- 3 a 8 tags.
- Prefira EXPRESSOES COMPOSTAS (2-4 palavras) quando fizer sentido.
- Inclua fatos relevantes quando presentes (ex.: "aviso previo cumprido", "acumulo de funcao", "contrato de trabalho", "dispensa sem justa causa").
- Evite tags genÃ©ricas sem utilidade jurÃ­dica (ex.: "juizo", "digital", "informacoes").
- Foque em tema + contexto (ex.: "horas extras", "rescisao indireta", "pedido de demissao", "dispensa sem justa causa", "fgts", "ctps", "dano moral").`;

      const userPrompt = `Titulo do bloco:\n${title}\n\nConteudo (texto extraido):\n${plain}\n\nGere as tags.`;
      const raw = await aiService.generateText(systemPrompt, userPrompt, 220);
      const jsonText = String(raw || '').trim();
      const parsed: any = JSON.parse(jsonText);
      const parsedTags: unknown[] = Array.isArray(parsed?.tags) ? parsed.tags : [];
      const normalized = parsedTags
        .map((t) => normalizeTag(String(t)))
        .filter(Boolean);
      const uniq = Array.from(new Set(normalized)).slice(0, 8);
      return uniq.length ? uniq : fallback();
    } catch {
      return fallback();
    }
  };

  const getBlockTagsForUI = (block: PetitionBlock, plainOverride?: string) => {
    const existing = Array.isArray(block.tags) ? block.tags.map((t) => String(t)).filter(Boolean) : [];
    if (existing.length) return existing;

    const plain = typeof plainOverride === 'string' ? plainOverride : sfdtToPlainText(block.content);
    const baseText = `${block.title}\n${plain}`.trim();
    const n = normalizeTag(baseText);
    const phraseTags = getPhraseTagsFromText(baseText);
    const candidates = [
      'contrato de trabalho',
      'aviso previo cumprido',
      'acumulo de funcao',
      'horas extras',
      'fgts',
      'dano moral',
      'rescisao indireta',
      'pedido de demissao',
      'dispensa sem justa causa',
      'ctps',
      'assinatura ctps',
      'verbas rescisorias',
      'adicional noturno',
      'intervalo intrajornada',
      'intervalo interjornada',
      'insalubridade',
      'periculosidade',
      'desvio de funcao',
      'equiparacao salarial',
    ];
    const found = candidates.filter((k) => n.includes(k));
    const uniq = dedupeTags([...phraseTags, ...found]).slice(0, 8);
    if (uniq.length) return uniq;
    return getDerivedTagsFromText(baseText);
  };

  const normalizeCnpj = (value: string): string => {
    return String(value || '').replace(/\D/g, '');
  };

  const formatCnpj = (digits: string): string => {
    const d = normalizeCnpj(digits);
    if (d.length !== 14) return d;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
  };

  const titleCaseCity = (value: string): string => {
    const sRaw = String(value || '').trim();
    if (!sRaw) return '';
    const s = sRaw.toLowerCase();
    const base = s
      .split(' ')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    // Ajustes comuns sem depender de biblioteca externa
    return base
      .replace(/\bSao\b/g, 'São')
      .replace(/\bJoao\b/g, 'João')
      .replace(/\bCuiaba\b/g, 'Cuiabá');
  };

  const expandLogradouro = (value: string): string => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const mapPrefix = (prefix: string, full: string) => {
      const re = new RegExp(`^${prefix}\\s+`, 'i');
      if (re.test(raw)) return raw.replace(re, `${full} `);
      return '';
    };

    return (
      mapPrefix('AV', 'Avenida') ||
      mapPrefix('AV.', 'Avenida') ||
      mapPrefix('R', 'Rua') ||
      mapPrefix('R.', 'Rua') ||
      mapPrefix('ROD', 'Rodovia') ||
      mapPrefix('ROD.', 'Rodovia') ||
      mapPrefix('AL', 'Alameda') ||
      mapPrefix('AL.', 'Alameda') ||
      mapPrefix('PC', 'Praça') ||
      mapPrefix('PC.', 'Praça') ||
      raw
    );
  };

  const formatAddressIntro = (logradouroFull: string): string => {
    const l = String(logradouroFull || '').trim();
    if (!l) return '';
    const first = l.split(' ')[0]?.toLowerCase() || '';
    // Tipos mais comuns (femininos)
    const feminine = new Set(['rua', 'avenida', 'alameda', 'praca', 'praça', 'travessa', 'estrada', 'rodovia']);
    if (feminine.has(first)) return `na ${l}`;
    return `no ${l}`;
  };

  const formatPhone = (ddd?: string, number?: string): string => {
    const d = String(ddd || '').replace(/\D/g, '');
    const n = String(number || '').replace(/\D/g, '');
    if (!d || !n) return '';
    if (n.length === 8) return `(${d}) ${n.slice(0, 4)}-${n.slice(4)}`;
    if (n.length === 9) return `(${d}) ${n.slice(0, 5)}-${n.slice(5)}`;
    return `(${d}) ${n}`;
  };

  const formatCompanyQualification = (payload: any): string => {
    const normalizedPayload = Object.fromEntries(
      Object.entries(payload || {}).map(([key, value]) => [
        key,
        typeof value === 'string' ? sanitizeText(value) : value,
      ])
    ) as Record<string, any>;

    const cnpjDigits = normalizeCnpj(normalizedPayload?.cnpj);
    const cnpjFmt = formatCnpj(cnpjDigits);
    const razao = String(normalizedPayload?.razao_social || '').trim();
    const fantasia = String(normalizedPayload?.nome_fantasia || '').trim();
    const nomeBase = fantasia ? `${fantasia} - ${razao}` : razao;

    const logradouro = expandLogradouro(normalizedPayload?.logradouro);
    const numero = String(normalizedPayload?.numero || '').trim();
    const complemento = String(normalizedPayload?.complemento || '').trim();
    const bairro = String(normalizedPayload?.bairro || '').trim();
    const municipio = titleCaseCity(normalizedPayload?.municipio);
    const uf = String(normalizedPayload?.uf || '').trim().toUpperCase();
    const cepDigits = String(normalizedPayload?.cep || '').replace(/\D/g, '');
    const cepFmt = cepDigits.length === 8 ? `${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}` : String(normalizedPayload?.cep || '').trim();

    const partsAddr: string[] = [];
    if (logradouro) partsAddr.push(logradouro);
    if (numero) partsAddr.push(`número ${numero}`);
    if (complemento) partsAddr.push(complemento);
    if (bairro) partsAddr.push(bairro);
    let addr = partsAddr.join(', ');
    if (municipio || uf) {
      addr = addr ? `${addr}, ${municipio}${municipio && uf ? '-' : ''}${uf}` : `${municipio}${municipio && uf ? '-' : ''}${uf}`;
    }
    if (cepFmt) {
      addr = addr ? `${addr}, CEP: ${cepFmt}` : `CEP: ${cepFmt}`;
    }

    const phones = Array.isArray(normalizedPayload?.telefones) ? normalizedPayload.telefones : [];
    const phoneFormattedRaw = phones
      .map((p: any) => formatPhone(p?.ddd, p?.numero))
      .filter((x: string) => Boolean(x));
    const phoneSet = new Set<string>();
    const phoneFormatted: string[] = [];
    for (const p of phoneFormattedRaw) {
      const key = p.replace(/\D/g, '');
      if (!key) continue;
      if (phoneSet.has(key)) continue;
      phoneSet.add(key);
      phoneFormatted.push(p);
    }
    const phoneLabel = phoneFormatted.length > 1 ? 'telefones' : 'telefone';
    const phoneText = phoneFormatted.length ? `${phoneLabel} ${phoneFormatted.join('/ ')}` : '';

    const email = String(normalizedPayload?.email || '').trim().toLowerCase();
    const emailText = email ? `e-mail ${email}` : '';

    const addrIntro = logradouro ? formatAddressIntro(logradouro) : '';
    const addrRestParts: string[] = [];
    if (numero) addrRestParts.push(`número ${numero}`);
    if (complemento) addrRestParts.push(complemento);
    if (bairro) addrRestParts.push(bairro);
    let addrRest = addrRestParts.join(', ');
    if (municipio || uf) {
      addrRest = addrRest ? `${addrRest}, ${municipio}${municipio && uf ? '-' : ''}${uf}` : `${municipio}${municipio && uf ? '-' : ''}${uf}`;
    }
    if (cepFmt) {
      addrRest = addrRest ? `${addrRest}, CEP: ${cepFmt}` : `CEP: ${cepFmt}`;
    }

    const fullAddr = addrIntro ? `${addrIntro}${addrRest ? `, ${addrRest}` : ''}` : (addr ? `na ${addr}` : '');

    const tailParts = [fullAddr ? `localizado ${fullAddr}` : '', phoneText, emailText].filter(Boolean);
    const tail = tailParts.length ? `, ${tailParts.join(', ')}` : '';

    const nomeUpper = (nomeBase || '').toUpperCase();
    return `${nomeUpper}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${cnpjFmt}${tail}, pelos fatos e fundamentos jurídicos enunciados.`;
  };

  const openCompanyLookup = () => {
    setCompanyLookupResultText(null);
    setCompanyCnpjInput('');
    setShowCompanyLookupModal(true);
  };

  const handleCompanyLookup = async () => {
    const digits = normalizeCnpj(companyCnpjInput);
    if (digits.length !== 14) {
      setError('Informe um CNPJ valido (14 digitos)');
      return;
    }

    setCompanyLookupLoading(true);
    setCompanyLookupResultText(null);
    try {
      const pickFirst = <T,>(...vals: T[]): T | undefined => {
        for (const v of vals) {
          if (v === null || v === undefined) continue;
          if (typeof v === 'string') {
            const s = v.trim();
            if (s) return v;
            continue;
          }
          return v;
        }
        return undefined;
      };

      const fetchJson = async (url: string) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      };

      const [brasilRes, openCnpjRes] = await Promise.allSettled([
        fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${digits}`),
        fetchJson(`https://api.opencnpj.org/${digits}`),
      ]);

      const brasil = brasilRes.status === 'fulfilled' ? (brasilRes.value as any) : null;
      const openCnpj = openCnpjRes.status === 'fulfilled' ? (openCnpjRes.value as any) : null;

      if (!brasil && !openCnpj) {
        throw new Error('Falha ao consultar BrasilAPI e OpenCNPJ');
      }

      const tipo = String(brasil?.descricao_tipo_de_logradouro || '').trim();
      const tipoTitle = tipo ? tipo.toLowerCase().split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '';
      const logradouroNome = String(brasil?.logradouro || '').trim();
      const logradouroFull = `${tipoTitle ? `${tipoTitle} ` : ''}${logradouroNome}`.trim();

      const parseDddTelefone = (raw: unknown): { ddd?: string; numero?: string } | null => {
        const s = String(raw || '').replace(/\D/g, '');
        if (s.length < 10) return null;
        const ddd = s.slice(0, 2);
        const numero = s.slice(2);
        return { ddd, numero };
      };

      const phones: { ddd?: string; numero?: string }[] = [];
      const p1 = parseDddTelefone(brasil?.ddd_telefone_1);
      const p2 = parseDddTelefone(brasil?.ddd_telefone_2);
      const pf = parseDddTelefone(brasil?.ddd_fax);
      if (p1) phones.push(p1);
      if (p2) phones.push(p2);
      if (pf) phones.push(pf);

      const openPhones = Array.isArray(openCnpj?.telefones) ? openCnpj.telefones : [];
      for (const p of openPhones) {
        const ddd = String(p?.ddd || '').replace(/\D/g, '');
        const numero = String(p?.numero || '').replace(/\D/g, '');
        if (ddd && numero) phones.push({ ddd, numero });
      }

      const email = String(pickFirst(openCnpj?.email, brasil?.email, openCnpj?.contato?.email, openCnpj?.dados?.email) || '').trim();

      const mergedPayload = {
        cnpj: pickFirst(brasil?.cnpj, openCnpj?.cnpj, digits) || digits,
        razao_social: pickFirst(brasil?.razao_social, openCnpj?.razao_social, openCnpj?.razaoSocial, openCnpj?.empresa?.razao_social) || '',
        nome_fantasia: pickFirst(brasil?.nome_fantasia, openCnpj?.nome_fantasia, openCnpj?.nomeFantasia, openCnpj?.empresa?.nome_fantasia) || '',
        logradouro: pickFirst(logradouroFull, brasil?.logradouro, openCnpj?.logradouro, openCnpj?.endereco?.logradouro) || '',
        numero: pickFirst(brasil?.numero, openCnpj?.numero, openCnpj?.endereco?.numero) || '',
        complemento: pickFirst(brasil?.complemento, openCnpj?.complemento, openCnpj?.endereco?.complemento) || '',
        bairro: pickFirst(brasil?.bairro, openCnpj?.bairro, openCnpj?.endereco?.bairro) || '',
        municipio: pickFirst(brasil?.municipio, openCnpj?.municipio, openCnpj?.endereco?.municipio) || '',
        uf: pickFirst(brasil?.uf, openCnpj?.uf, openCnpj?.endereco?.uf) || '',
        cep: pickFirst(brasil?.cep, openCnpj?.cep, openCnpj?.endereco?.cep) || '',
        email,
        telefones: phones,
        natureza_juridica: pickFirst(brasil?.natureza_juridica, openCnpj?.natureza_juridica, openCnpj?.naturezaJuridica) || '',
        situacao: pickFirst(brasil?.descricao_situacao_cadastral, openCnpj?.situacao, openCnpj?.situacao_cadastral) || '',
        porte: pickFirst(brasil?.porte, openCnpj?.porte) || '',
      };

      let payload: any = mergedPayload;
      let text = formatCompanyQualification(payload);

      if (aiService.isEnabled()) {
        const systemPrompt =
          'VocÃª Ã© um assistente jurÃ­dico. Sua tarefa Ã© COMPILAR e NORMALIZAR dados cadastrais de empresa a partir de DUAS fontes (BrasilAPI e OpenCNPJ). ' +
          'Use apenas dados fornecidos. NÃ£o invente. Quando houver conflito, escolha o valor mais completo e consistente. ' +
          'IMPORTANTE: e-mail e telefones podem existir em apenas uma fonte.';

        const schema = {
          cnpj: 'string (somente dÃ­gitos ou formatado)',
          razao_social: 'string',
          nome_fantasia: 'string',
          logradouro: 'string',
          numero: 'string',
          complemento: 'string',
          bairro: 'string',
          municipio: 'string',
          uf: 'string',
          cep: 'string',
          email: 'string',
          telefones: [{ ddd: 'string', numero: 'string' }],
          natureza_juridica: 'string',
          situacao: 'string',
          porte: 'string',
        };

        const userPrompt =
          'Fonte BrasilAPI (JSON, pode ser null):\n' + JSON.stringify(brasil, null, 2) +
          '\n\nFonte OpenCNPJ (JSON, pode ser null):\n' + JSON.stringify(openCnpj, null, 2) +
          '\n\nPayload atual (merge determinÃ­stico):\n' + JSON.stringify(mergedPayload, null, 2) +
          '\n\nRetorne APENAS um JSON vÃ¡lido seguindo este schema (sem texto extra):\n' + JSON.stringify(schema, null, 2);

        const aiJsonText = (await aiService.generateText(systemPrompt, userPrompt, 750)).trim();
        if (aiJsonText) {
          try {
            const compiled = JSON.parse(aiJsonText);
            if (compiled && typeof compiled === 'object') {
              payload = { ...mergedPayload, ...compiled };
              text = formatCompanyQualification(payload);
            }
          } catch {
            // Se a IA nÃ£o retornar JSON, mantÃ©m fallback determinÃ­stico
          }
        }
      }

      setCompanyLookupResultText(text);
    } catch (err) {
      console.error(err);
      setError('Erro ao consultar CNPJ. Verifique o numero e tente novamente.');
    } finally {
      setCompanyLookupLoading(false);
    }
  };

  const insertCompanyText = () => {
    if (!companyLookupResultText) return;
    const editor = editorRef.current;
    if (!editor) return;

    const raw = String(companyLookupResultText || '');
    const idx = raw.indexOf(',');
    const namePart = (idx >= 0 ? raw.slice(0, idx) : raw).trim();
    const restPart = (idx >= 0 ? raw.slice(idx) : '').trimEnd();

    editor.focus();
    if (namePart) {
      editor.setBold(true);
      editor.insertText(namePart);
      editor.setBold(false);
      editor.insertText(restPart ? ` ${restPart}` : '');
    } else {
      editor.setBold(false);
      editor.insertText(raw);
    }

    setHasUnsavedChanges(true);
    setShowCompanyLookupModal(false);
    window.setTimeout(() => {
      const ed = editorRef.current;
      if (ed) {
        ed.focus();
        const selection = (ed as any).containerRef?.current?.documentEditor?.selection;
        if (selection && typeof selection.moveToDocumentEnd === 'function') {
          selection.moveToDocumentEnd();
        }
      }
    }, 0);
  };

  // Modal fullscreen
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showStartScreen, setShowStartScreen] = useState<boolean>(() => isFloatingWidget && !initialPetitionId && !initialDocumentBase64 && !initialDocumentUrl);

  const applyInitialClientIfNeeded = useCallback(() => {
    if (!initialClientId) return null;
    const client = clients.find((c) => c.id === initialClientId) || null;
    if (client) {
      setSelectedClient(client);
      setSidebarTab('blocks');
    }
    return client;
  }, [initialClientId, clients]);

  // Helper para mostrar mensagem de sucesso temporÃ¡ria
  const showSuccessMessage = (msg: string) => {
    toastSuccess(msg);
  };

  useEffect(() => {
    if (!initialCloudFileId) {
      setSourceCloudFile(null);
      return;
    }

    let cancelled = false;
    supabase
      .from('cloud_files')
      .select('*')
      .eq('id', initialCloudFileId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('Erro ao carregar arquivo origem do Cloud:', error);
          return;
        }
        setSourceCloudFile((data as CloudFile | null) ?? null);
      });

    return () => {
      cancelled = true;
    };
  }, [initialCloudFileId]);

  // Salvar petiçÃ£o
  const savePetition = async () => {
    const startSeq = contentChangeSeqRef.current;
    // Regra: salvar apenas documentos vinculados a cliente
    if (!selectedClient?.id) {
      if (initialClientId) {
        return;
      }
      setError('Selecione um cliente antes de salvar a peticao');
      return;
    }
    if (!isOnlineRef.current) {
      setError('Voce esta offline. O Peticionamento e 100% online: reconecte para editar/salvar.');
      return;
    }
    if (isLoadingPetitionRef.current) {
      setError('Aguarde o carregamento do documento antes de salvar');
      return;
    }
    if (savingDoc) return;
    // Lock sÃ­ncrono: previne race condition onde 2 autosaves disparam
    // antes de setCurrentPetitionId ter efeito â†’ criavam petiçÃµes duplicadas
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setSavingDoc(true);
    setError(null);

    try {
      const editor = editorRef.current;
      if (!editor) throw new Error('Editor nao disponivel');

      const sfdt = await editor.getSfdt();
      if (!sfdt) throw new Error('Nao foi possivel obter o conteudo do documento');

      const title = sanitizePetitionTitleText(petitionTitle, 'Sem titulo');
      const clientId = selectedClient?.id || null;
      const clientName = selectedClient?.full_name || null;

      let savedRow: SavedPetition | null = null;

      // LÃª do ref sÃ­ncrono â€” garante valor mais atualizado entre saves concorrentes
      const existingId = currentPetitionIdRef.current ?? currentPetitionId;

      if (existingId) {
        // Atualizar petiçÃ£o existente
        savedRow = await petitionEditorService.updatePetition(existingId, {
          title,
          content: sfdt,
          client_id: clientId,
          client_name: clientName,
        });
      } else {
        // Criar nova petiçÃ£o
        savedRow = await petitionEditorService.createPetition({
          title,
          content: sfdt,
          client_id: clientId,
          client_name: clientName,
        });
        if (savedRow?.id) {
          // Atualiza ref ANTES do state â€” prÃ³ximos saves leem imediatamente
          currentPetitionIdRef.current = savedRow.id;
          setCurrentPetitionId(savedRow.id);
        }
      }

      // Update otimista da lista de petiçÃµes salvas
      if (savedRow) {
        setSavedPetitions((prev) => {
          const normalizedSavedRow = sanitizeSavedPetitionRecord(savedRow!);
          const next = prev.filter((p) => p.id !== normalizedSavedRow.id);
          next.unshift(normalizedSavedRow);
          next.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
          return next;
        });
      }

      if (sourceCloudFile) {
        const exportedName = initialDocumentName || sourceCloudFile.original_name || `${title}.docx`;
        const blob = await editor.exportDocx(exportedName.endsWith('.docx') ? exportedName : `${exportedName}.docx`);
        const updatedCloudFile = await cloudService.replaceFileContents(sourceCloudFile, blob, exportedName.endsWith('.docx') ? exportedName : `${exportedName}.docx`);
        setSourceCloudFile(updatedCloudFile);
      }

      setHasUnsavedChanges(contentChangeSeqRef.current !== startSeq);
      setLastSaved(new Date());
      showSuccessMessage('Documento salvo com sucesso');
    } catch (err) {
      console.error('Erro ao salvar:', err);
      setError(err instanceof Error ? err.message : 'Erro ao salvar documento');
    } finally {
      saveInFlightRef.current = false;
      setSavingDoc(false);
    }
  };

  // Atualizar ref para Ctrl+S
  useEffect(() => {
    savePetitionActionRef.current = savePetition;
  }, [savePetition]);

  // PetiçÃ£o pendente para carregar apÃ³s o editor estar pronto
  const pendingPetitionRef = useRef<SavedPetition | null>(null);

  // Carregar petiçÃ£o existente
  const loadPetition = async (petition: SavedPetition) => {
    if (isLoadingPetitionRef.current) return;
    isLoadingPetitionRef.current = true;
    setOpeningPetitionId(petition.id);

    let petitionToLoad = petition;

    if (!petitionToLoad.content) {
      try {
        const fullPetition = await petitionEditorService.getPetition(petition.id);
        if (!fullPetition) {
          throw new Error('Peticao nao encontrada');
        }
        petitionToLoad = fullPetition;
      } catch (err) {
        console.error('Erro ao buscar peticao completa:', err);
        setError('Erro ao carregar documento');
        isLoadingPetitionRef.current = false;
        setOpeningPetitionId(null);
        return;
      }
    }

    // Atualizar estados primeiro
    currentPetitionIdRef.current = petitionToLoad.id;
    setCurrentPetitionId(petitionToLoad.id);
    setPetitionTitle(sanitizeText(petitionToLoad.title) || '');
    setLastSaved(petitionToLoad.updated_at ? new Date(petitionToLoad.updated_at) : null);

    // Carregar cliente se houver
    if (petitionToLoad.client_id) {
      const client = clients.find((c) => c.id === petitionToLoad.client_id);
      if (client) {
        setSelectedClient(client);
      }
    } else {
      setSelectedClient(null);
    }

    setHasUnsavedChanges(false);

    const editor = editorRef.current;
    if (editor && petitionToLoad.content) {
      try {
        await editor.loadSfdt(petitionToLoad.content);
        captureAndApplyDocFontSoon(editor);
        setShowStartScreen(false);
      } catch (err) {
        console.error('Erro ao carregar conteudo:', err);
        setError('Erro ao carregar documento');
      } finally {
        isLoadingPetitionRef.current = false;
        setOpeningPetitionId(null);
      }
      return;
    }

    // Guardar para carregar depois que o editor estiver pronto
    pendingPetitionRef.current = petitionToLoad;
    setShowStartScreen(false);
    setPendingPetitionLoadKey((k) => k + 1);
  };

  // Carregar petiçÃ£o pendente quando o editor estiver pronto
  useEffect(() => {
    const petition = pendingPetitionRef.current;
    if (!petition) return;
    
    const editor = editorRef.current;
    if (!editor) return;

    pendingPetitionRef.current = null;
    
    const loadContent = async () => {
      try {
        if (petition.content) {
          await editor.loadSfdt(petition.content);
          captureAndApplyDocFontSoon(editor);
          showSuccessMessage('Documento carregado');
        }
      } catch (err) {
        console.error('Erro ao carregar conteudo:', err);
        setError('Erro ao carregar documento');
      } finally {
        isLoadingPetitionRef.current = false;
        setOpeningPetitionId(null);
      }
    };
    
    // Pequeno delay para garantir que o editor estÃ¡ totalmente inicializado
    window.setTimeout(loadContent, 100);
  }, [pendingPetitionLoadKey]);

  // Nova petiçÃ£o
  const newPetition = (options?: { keepClient?: boolean }) => {
    const editor = editorRef.current;
    if (editor) {
      editor.clear();
      const f = defaultDocFontRef.current;
      if (f) {
        editor.applyCurrentFont?.(f.fontFamily, f.fontSize);
      }
    }

    currentPetitionIdRef.current = null;
    setCurrentPetitionId(null);
    setPetitionTitle('');
    setLastSaved(null);

    if (!options?.keepClient) {
      setSelectedClient(null);
    }

    setHasUnsavedChanges(false);
    defaultTemplateAutoAppliedRef.current = false;
    setShowStartScreen(false);
  };

  // Exportar para Word
  const exportToWord = async () => {
    try {
      const editor = editorRef.current;
      if (!editor) {
        setError('Editor nao disponivel');
        return;
      }

      const filename = (petitionTitle.trim() || 'documento') + '.docx';
      const blob = await editor.exportDocx(filename);
      
      // Download do arquivo
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showSuccessMessage('Documento exportado');
    } catch (err) {
      console.error('Erro ao exportar:', err);
      setError('Erro ao exportar documento');
    }
  };

  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  // Importar template Word
  const handleImportTemplate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const editor = editorRef.current;
      if (!editor) {
        setError('Editor nao disponivel');
        return;
      }

      const arrayBuffer = await file.arrayBuffer();
      await loadDocxWithFallback(editor, arrayBuffer, file.name);
      captureAndApplyDocFontSoon(editor);

      try {
        const dataBase64 = arrayBufferToBase64(arrayBuffer);
        const normalizedFileName = sanitizeText(file.name);
        defaultTemplateMemoryRef.current = { name: normalizedFileName, dataBase64 };
        setHasDefaultTemplate(true);
        setDefaultTemplateName(normalizedFileName);

        // Salvar no Supabase
        try {
          await petitionEditorService.saveDefaultTemplate(normalizedFileName, dataBase64);
        } catch (dbErr) {
          console.error('Erro ao salvar modelo padrao no banco:', dbErr);
          // Fallback para localStorage se falhar
          try {
            window.localStorage.setItem(
              DEFAULT_TEMPLATE_STORAGE_KEY,
              JSON.stringify({ name: normalizedFileName, dataBase64 })
            );
          } catch (storageErr) {
            console.error('Erro ao salvar Documento padrao no storage:', storageErr);
            setError('Nao foi possivel salvar o Documento padrao no navegador (armazenamento cheio).');
          }
        }
      } catch {
        // ignore
      } finally {
        // Limpar input para permitir reimportar o mesmo arquivo
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    } catch (err) {
      console.error('Erro ao importar:', err);
      setError('Erro ao importar arquivo');
    } finally {
      // Limpar input para permitir reimportar o mesmo arquivo
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Define o documento aberto no editor como o modelo padrao do usuario.
  const setCurrentDocAsDefaultTemplate = async () => {
    const editor = editorRef.current;
    if (!editor) {
      setError('Editor nao disponivel');
      return;
    }
    try {
      if (typeof editor.hasContent === 'function' && !editor.hasContent()) {
        setError('O documento esta vazio: nada para definir como padrao.');
        return;
      }
    } catch {
      // se nao der para checar, segue o fluxo
    }

    setSettingDefaultTemplate(true);
    try {
      const rawName = petitionTitle.trim() || 'Documento Padrao';
      const fileName = sanitizeText(
        rawName.toLowerCase().endsWith('.docx') ? rawName : `${rawName}.docx`
      );
      const blob = await editor.exportDocx(fileName);
      const arrayBuffer = await blob.arrayBuffer();
      const dataBase64 = arrayBufferToBase64(arrayBuffer);

      defaultTemplateMemoryRef.current = { name: fileName, dataBase64 };
      setHasDefaultTemplate(true);
      setDefaultTemplateName(fileName);

      try {
        await petitionEditorService.saveDefaultTemplate(fileName, dataBase64);
      } catch (dbErr) {
        console.error('Erro ao salvar documento padrao no banco:', dbErr);
        try {
          window.localStorage.setItem(
            DEFAULT_TEMPLATE_STORAGE_KEY,
            JSON.stringify({ name: fileName, dataBase64 })
          );
        } catch (storageErr) {
          console.error('Erro ao salvar documento padrao no storage:', storageErr);
          setError('Nao foi possivel salvar o documento padrao (armazenamento cheio).');
          return;
        }
      }
      showSuccessMessage('Documento atual definido como padrao');
    } catch (err) {
      console.error('Erro ao definir documento padrao:', err);
      setError('Erro ao definir documento padrao');
    } finally {
      setSettingDefaultTemplate(false);
    }
  };

  // Sobe um arquivo .docx e o define como modelo padrao (sem precisar abrir o editor).
  const handleUploadDefaultTemplate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setError('Selecione um arquivo .docx para o documento padrao.');
      if (defaultTemplateInputRef.current) defaultTemplateInputRef.current.value = '';
      return;
    }

    setSettingDefaultTemplate(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const dataBase64 = arrayBufferToBase64(arrayBuffer);
      const name = sanitizeText(file.name);

      defaultTemplateMemoryRef.current = { name, dataBase64 };
      defaultTemplateAutoAppliedRef.current = false;
      setHasDefaultTemplate(true);
      setDefaultTemplateName(name);

      try {
        await petitionEditorService.saveDefaultTemplate(name, dataBase64);
      } catch (dbErr) {
        console.error('Erro ao salvar documento padrao no banco:', dbErr);
        try {
          window.localStorage.setItem(
            DEFAULT_TEMPLATE_STORAGE_KEY,
            JSON.stringify({ name, dataBase64 })
          );
        } catch (storageErr) {
          console.error('Erro ao salvar documento padrao no storage:', storageErr);
          setError('Nao foi possivel salvar o documento padrao (armazenamento cheio).');
          return;
        }
      }
      showSuccessMessage('Documento padrao definido');
    } catch (err) {
      console.error('Erro ao subir documento padrao:', err);
      setError('Erro ao subir documento padrao');
    } finally {
      setSettingDefaultTemplate(false);
      if (defaultTemplateInputRef.current) defaultTemplateInputRef.current.value = '';
    }
  };

  // Remove o modelo padrao do usuario.
  const clearDefaultTemplate = async () => {
    defaultTemplateMemoryRef.current = null;
    setHasDefaultTemplate(false);
    setDefaultTemplateName(null);
    defaultTemplateAutoAppliedRef.current = true; // evita reaplicacao automatica
    try {
      await petitionEditorService.saveDefaultTemplate('', '');
    } catch (err) {
      console.error('Erro ao remover documento padrao no banco:', err);
    }
    try {
      window.localStorage.removeItem(DEFAULT_TEMPLATE_STORAGE_KEY);
    } catch {
      // ignore
    }
    showSuccessMessage('Documento padrao removido');
  };

  // Inserir bloco no editor
  const insertBlock = async (block: PetitionBlock) => {
    if (!isOnlineRef.current) {
      setError('Voce esta offline. O Peticionamento e 100% online: reconecte para editar/salvar.');
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;

    const sfdt = String(block.content || '').trim();
    const looksLikeSfdt = sfdt.startsWith('{') || sfdt.startsWith('[');

    // FunçÃ£o para restaurar foco e garantir estado editÃ¡vel
    const restoreFocus = () => {
      try {
        editorRef.current?.refresh?.();
        editorRef.current?.focus();
      } catch {
        // ignore
      }
    };

    const applyClientPlaceholders = (input: string) => {
      if (!selectedClient) return input;
      const replacements: Array<[string, string]> = [
        ['[[NOME_CLIENTE]]', selectedClient.full_name],
        ['[[CPF]]', selectedClient.cpf_cnpj || ''],
        ['[[RG]]', selectedClient.rg || ''],
        ['[[NACIONALIDADE]]', selectedClient.nationality || ''],
        ['[[ESTADO_CIVIL]]', MARITAL_STATUS_LABELS[selectedClient.marital_status || ''] || ''],
        ['[[PROFISSAO]]', selectedClient.profession || ''],
        ['[[ENDERECO]]', selectedClient.address_street || ''],
        ['[[CIDADE]]', selectedClient.address_city || ''],
        ['[[UF]]', selectedClient.address_state || ''],
        ['[[CEP]]', selectedClient.address_zip_code || ''],
        ['[[EMAIL]]', selectedClient.email || ''],
        ['[[TELEFONE]]', selectedClient.phone || ''],
      ];
      let out = String(input ?? '');
      for (const [from, to] of replacements) {
        out = out.split(from).join(to ?? '');
      }
      return out;
    };

    try {
      if (looksLikeSfdt && blockConvertEditorRef.current?.convertSfdtToFragment && editor.pasteSfdt) {
        const processed = applyClientPlaceholders(sfdt);
        const fragment = await blockConvertEditorRef.current.convertSfdtToFragment(processed);
        if (fragment && fragment.trim()) {
          // InserçÃ£o sÃ­ncrona para evitar perda de foco
          const ok = editor.pasteSfdt(fragment);
          if (ok) {
            setHasUnsavedChanges(true);
            showSuccessMessage('Bloco inserido');
            restoreFocus();
            return;
          }
        }
      }

      // Fallback: texto puro
      let content = sfdtToPlainText(block.content);
      if (!content.trim() || content.trim().startsWith('{') || content.trim().startsWith('[')) {
        content = 'Pre-visualizacao indisponivel';
      }
      editor.insertText(applyClientPlaceholders(content));
      setHasUnsavedChanges(true);
      showSuccessMessage('Bloco inserido');
      restoreFocus();
    } catch (err) {
      console.error('Erro ao inserir bloco:', err);
      restoreFocus();
    }
  };

  // Deletar bloco
  const deleteBlock = async (blockId: string) => {
    if (!confirm('Tem certeza que deseja excluir este bloco?')) return;

    try {
      await petitionEditorService.deleteBlock(blockId);
      setBlocks((prev) => prev.filter((b) => b.id !== blockId));
      showSuccessMessage('Bloco excluido');
    } catch (err) {
      console.error('Erro ao excluir bloco:', err);
      setError('Erro ao excluir bloco');
    }
  };

  // Handler de mudança de conteudo do editor
  const handleContentChange = () => {
    if (isLoadingPetitionRef.current) return;
    if (!isOnlineRef.current) {
      setError('Voce esta offline. O Peticionamento e 100% online: reconecte para editar/salvar.');
      return;
    }
    contentChangeSeqRef.current += 1;
    setHasUnsavedChanges(true);
  };

  // Salvar bloco (criar ou atualizar)
  const saveBlock = async () => {
    if (!blockFormData.title.trim()) {
      setError('Titulo e obrigatorio');
      return;
    }

    const targetUpdateId = editingBlock?.id || (updateExistingBlockMode ? updateExistingBlockId : '');
    if (!editingBlock && updateExistingBlockMode && !targetUpdateId) {
      setError('Selecione o bloco que sera atualizado');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const effectiveStandardTypeId = (blockFilterScope === 'type' && selectedStandardTypeId)
        ? selectedStandardTypeId
        : blockStandardTypeId;

      let content = blockFormData.content;
      if (blockEditorRef.current) {
        content = blockEditorRef.current.getSfdt() || '';
      }

      if (targetUpdateId) {
        if (!editingBlock && updateExistingBlockMode) {
          const ok = window.confirm('Atualizar bloco existente? Isso substituira titulo, conteudo e tags do bloco selecionado.');
          if (!ok) return;
        }

        const updated = await petitionEditorService.updateBlock(targetUpdateId, {
          title: blockFormData.title,
          content,
          category: blockFormData.category,
          document_type: (blockFormData.document_type || selectedDocumentType) as any,
          legal_area_id: (blockFormData.legal_area_id ?? selectedLegalAreaId) as any,
          is_default: blockFormData.is_default,
          is_active: blockFormData.is_active,
          tags: blockFormData.tags,
        } as any);
        await petitionEditorService.setBlockStandardType(updated.id, effectiveStandardTypeId);

        // Atualizar lista conforme escopo atual
        if (blockFilterScope === 'type' && selectedStandardTypeId) {
          const blocksData = await petitionEditorService.listBlocksByStandardType(selectedStandardTypeId);
          setBlocks(blocksData.map(sanitizeBlockRecord));
        } else if (blockFilterScope === 'global') {
          const blocksData = await petitionEditorService.listBlocks(selectedDocumentType);
          setBlocks(blocksData.map(sanitizeBlockRecord));
        } else {
          const blocksData = await petitionEditorService.listBlocksByLegalArea(selectedLegalAreaId, selectedDocumentType);
          setBlocks(blocksData.map(sanitizeBlockRecord));
        }
        showSuccessMessage('Bloco atualizado');
      } else {
        const created = await petitionEditorService.createBlock({
          title: blockFormData.title,
          content,
          category: blockFormData.category,
          document_type: (blockFormData.document_type || selectedDocumentType) as any,
          legal_area_id: (blockFormData.legal_area_id ?? selectedLegalAreaId) as any,
          is_default: blockFormData.is_default,
          is_active: blockFormData.is_active,
          tags: blockFormData.tags,
        } as any);
        await petitionEditorService.setBlockStandardType(created.id, effectiveStandardTypeId);

        // Atualizar lista conforme escopo atual
        if (blockFilterScope === 'type' && selectedStandardTypeId) {
          const blocksData = await petitionEditorService.listBlocksByStandardType(selectedStandardTypeId);
          setBlocks(blocksData.map(sanitizeBlockRecord));
        } else if (blockFilterScope === 'global') {
          const blocksData = await petitionEditorService.listBlocks(selectedDocumentType);
          setBlocks(blocksData.map(sanitizeBlockRecord));
        } else {
          const blocksData = await petitionEditorService.listBlocksByLegalArea(selectedLegalAreaId, selectedDocumentType);
          setBlocks(blocksData.map(sanitizeBlockRecord));
        }
        showSuccessMessage('Bloco criado');
      }

      setShowBlockModal(false);
      setEditingBlock(null);
      setUpdateExistingBlockMode(false);
      setUpdateExistingBlockId('');
    } catch (err) {
      console.error('Erro ao salvar bloco:', err);
      setError('Erro ao salvar bloco');
    } finally {
      setSaving(false);
    }
  };

  const updatableBlocks = useMemo(() => {
    return (blocks || [])
      .filter((b) => b.is_active && ((b.document_type || 'petition') as string) === selectedDocumentType)
      .slice()
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR'));
  }, [blocks, selectedDocumentType]);

  // Carregar dados
  useEffect(() => {
    loadData();
  }, []);

  // Carregar conteudo do bloco no editor do modal quando abrir
  useEffect(() => {
    if (!showBlockModal) {
      blockModalInitDoneRef.current = false;
      return;
    }

    let cancelled = false;
    let tries = 0;
    const maxTries = 20;
    const sfdt = String(blockFormData.content || '').trim();
    const looksLikeSfdt = sfdt.startsWith('{') || sfdt.startsWith('[');

    const tryLoad = () => {
      if (cancelled) return;
      const ed = blockEditorRef.current;
      if (!ed) {
        tries += 1;
        if (tries <= maxTries) window.setTimeout(tryLoad, 80);
        return;
      }

      try {
        ed.clear?.();
        if (looksLikeSfdt && sfdt) {
          ed.loadSfdt(sfdt);
        } else if (sfdt) {
          ed.insertText(sfdt);
        }

        blockModalInitDoneRef.current = true;

        // Reforço: se renderizar vazio, tentar novamente e, por fim, fallback para texto
        window.setTimeout(() => {
          if (cancelled) return;
          const txt = (ed.getText?.() || '').trim();
          if (txt) return;

          if (looksLikeSfdt && sfdt) {
            // Tentar recarregar SFDT
            try {
              ed.clear?.();
              ed.loadSfdt(sfdt);
            } catch {
              // ignore
            }
            window.setTimeout(() => {
              if (cancelled) return;
              const txt2 = (ed.getText?.() || '').trim();
              if (!txt2) {
                const fallback = sfdtToPlainText(sfdt);
                ed.clear?.();
                if (fallback) ed.insertText(fallback);
              }
            }, 160);
          } else if (sfdt) {
            // Texto puro jÃ¡ inserido; se vazio, nada a fazer
          }
        }, 160);
      } catch {
        // ignore
      }
    };

    tryLoad();

    return () => {
      cancelled = true;
    };
  }, [showBlockModal, blockFormData.content, editingBlock?.id]);

  useEffect(() => {
    if (!showBlockModal) return;

    // Se estiver criando dentro de um modelo, manter como padrÃ£o
    if (!editingBlock && !updateExistingBlockMode && selectedStandardTypeId) {
      setBlockStandardTypeId(selectedStandardTypeId);
      return;
    }
  }, [showBlockModal, editingBlock, updateExistingBlockMode, selectedStandardTypeId]);

  useEffect(() => {
    if (!showBlockModal) return;
    const targetId = editingBlock?.id || (updateExistingBlockMode ? updateExistingBlockId : '');
    if (!targetId) return;

    let cancelled = false;
    const load = async () => {
      try {
        setBlockStandardTypeLoading(true);
        const stdId = await petitionEditorService.getBlockStandardTypeId(targetId);
        if (!cancelled) setBlockStandardTypeId(stdId);
      } catch {
        if (!cancelled) setBlockStandardTypeId(null);
      } finally {
        if (!cancelled) setBlockStandardTypeLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [showBlockModal, editingBlock?.id, updateExistingBlockMode, updateExistingBlockId]);

  useEffect(() => {
    const loadDefaultTemplateFromDB = async () => {
      try {
        const template = await petitionEditorService.getDefaultTemplate();
        if (template) {
          if (template.dataBase64) {
            setHasDefaultTemplate(true);
            setDefaultTemplateName(template.name);
            defaultTemplateMemoryRef.current = { name: template.name, dataBase64: template.dataBase64 };
          } else {
            setHasDefaultTemplate(false);
            setDefaultTemplateName(null);
            defaultTemplateMemoryRef.current = null;
          }
          // Restaurar fonte padrão do banco
          if (template.fontFamily || template.fontSize) {
            const font = {
              fontFamily: template.fontFamily ?? undefined,
              fontSize: template.fontSize ?? undefined,
            };
            setDefaultDocFont(font);
            defaultDocFontRef.current = font;
          }
        } else {
          setHasDefaultTemplate(false);
          setDefaultTemplateName(null);
          defaultTemplateMemoryRef.current = null;
        }
      } catch (err) {
        console.error('Erro ao carregar modelo padrao do banco:', err);
        // Fallback para localStorage se falhar
        try {
          const raw = window.localStorage.getItem(DEFAULT_TEMPLATE_STORAGE_KEY);
          if (!raw) {
            setHasDefaultTemplate(false);
            setDefaultTemplateName(null);
            return;
          }
          const parsed = JSON.parse(raw) as { name?: string; dataBase64?: string };
          const ok = Boolean(parsed?.dataBase64);
          setHasDefaultTemplate(ok);
          setDefaultTemplateName(parsed?.name ?? null);
        } catch {
          setHasDefaultTemplate(false);
          setDefaultTemplateName(null);
        }
        // Fallback fonte localStorage
        try {
          const raw = window.localStorage.getItem(DEFAULT_FONT_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as { fontFamily?: string; fontSize?: number };
            if (parsed?.fontFamily || parsed?.fontSize) {
              setDefaultDocFont(parsed);
              defaultDocFontRef.current = parsed;
            }
          }
        } catch { /* ignore */ }
      }
    };

    void loadDefaultTemplateFromDB();
  }, []);

  const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  };

  const waitForEditorReady = async (maxTries = 30, intervalMs = 150) => {
    for (let i = 0; i < maxTries; i += 1) {
      const editor = editorRef.current;
      if (editor && typeof (editor as any).loadDocx === 'function') return editor;
      await new Promise<void>((resolve) => window.setTimeout(resolve, intervalMs));
    }
    return null;
  };

  const importInitialDocument = useCallback(async (dataBase64: string, fileName?: string) => {
    try {
      setDocumentImportLoading(true);
      applyInitialClientIfNeeded();
      const editor = await waitForEditorReady();
      if (!editor) {
        setError('Editor nao disponivel');
        return;
      }

      const arrayBuffer = base64ToArrayBuffer(dataBase64);
      await loadDocxWithFallback(editor, arrayBuffer, fileName || 'documento.docx');
      captureAndApplyDocFontSoon(editor);
      setShowStartScreen(false);
      setHasUnsavedChanges(true);
      showSuccessMessage('Documento importado. As alteracoes ficam em rascunho ate voce salvar manualmente.');
      if (!petitionTitle || petitionTitle === 'Nova Peticao Trabalhista') {
        setPetitionTitle(getSanitizedDocumentName(fileName));
      }
    } catch (err) {
      console.error('Erro ao importar documento inicial:', err);
      setError('Erro ao abrir documento inicial');
    } finally {
      setDocumentImportLoading(false);
    }
  }, [applyInitialClientIfNeeded, petitionTitle]);

  const importInitialDocumentFromUrl = useCallback(async (documentUrl: string, fileName?: string) => {
    try {
      setDocumentImportLoading(true);
      applyInitialClientIfNeeded();

      const response = await fetch(documentUrl);
      if (!response.ok) {
        throw new Error(`Falha ao baixar documento: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();

      if (arrayBuffer.byteLength === 0) {
        throw new Error('O documento baixado esta vazio (0 bytes). Verifique se o link e valido.');
      }

      const editor = await waitForEditorReady();
      if (!editor) {
        setError('O editor Syncfusion nao carregou a tempo. Tente recarregar a pagina.');
        return;
      }

      await loadDocxWithFallback(editor, arrayBuffer, fileName || 'documento.docx');
      captureAndApplyDocFontSoon(editor);
      setShowStartScreen(false);
      setHasUnsavedChanges(true);
      showSuccessMessage('Documento importado com sucesso.');
      if (!petitionTitle || petitionTitle === 'Nova Peticao Trabalhista') {
        setPetitionTitle(getSanitizedDocumentName(fileName));
      }
    } catch (err: any) {
      console.error('Erro ao importar documento inicial por URL:', err);
      const msg = err?.message || 'Erro desconhecido';
      setError(`Nao foi possivel abrir o documento: ${msg}`);
    } finally {
      setDocumentImportLoading(false);
    }
  }, [applyInitialClientIfNeeded, petitionTitle]);

  const loadDefaultTemplate = async () => {
    if (!isOnlineRef.current) {
      setError('Voce esta offline. O Peticionamento e 100% online: reconecte para editar/salvar.');
      return;
    }
    try {
      const memory = defaultTemplateMemoryRef.current;
      let parsed: { name: string; dataBase64: string } | null = memory;

      // Se nÃ£o tiver em memÃ³ria, tentar do banco
      if (!parsed) {
        try {
          console.log('[PetitionEditor] Buscando modelo padrÃ£o no Supabase...');
          const template = await petitionEditorService.getDefaultTemplate();
          if (template) {
            console.log('[PetitionEditor] Modelo padrÃ£o encontrado no banco.');
            parsed = { name: template.name, dataBase64: template.dataBase64 };
            defaultTemplateMemoryRef.current = parsed;
          } else {
            console.log('[PetitionEditor] Nenhum modelo padrÃ£o encontrado no banco.');
          }
        } catch (dbErr: any) {
          console.error('Erro ao buscar modelo padrÃ£o do banco:', dbErr);
          const isTimeout = dbErr?.message?.includes('timeout') || dbErr?.code === '500';
          if (isTimeout) {
            setError('O banco de dados demorou muito para responder (timeout). Tente recarregar ou use um arquivo local.');
          }
          // Fallback para localStorage
          const raw = window.localStorage.getItem(DEFAULT_TEMPLATE_STORAGE_KEY);
          const fallback = raw ? (JSON.parse(raw) as { name?: string; dataBase64?: string }) : null;
          if (fallback?.name && fallback.dataBase64) {
            parsed = { name: fallback.name, dataBase64: fallback.dataBase64 };
          }
        }
      }

      if (!parsed?.dataBase64) {
        setError('Nenhum modelo padrao definido');
        return;
      }

      const editor = await waitForEditorReady();
      if (!editor) {
        setError('Editor nao disponivel');
        return;
      }

      const arrayBuffer = base64ToArrayBuffer(parsed.dataBase64);
      await loadDocxWithFallback(editor, arrayBuffer, parsed.name || 'modelo.docx');
      captureAndApplyDocFontSoon(editor);
      setHasUnsavedChanges(true);
      showSuccessMessage(`Modelo padrao${parsed.name ? ` "${parsed.name}"` : ''} carregado`);
    } catch (err) {
      console.error(err);
      setError('Erro ao carregar modelo padrao');
    }
  };

  useEffect(() => {
    if (defaultTemplateAutoAppliedRef.current) return;
    if (loading) return;
    if (!hasDefaultTemplate) return;

    // NÃ£o sobrescrever petiçÃ£o carregada ou alteraçÃµes do usuÃ¡rio
    if (currentPetitionId) return;
    if (hasUnsavedChanges) return;

    let cancelled = false;
    let tries = 0;
    const maxTries = 20;

    const tryApply = async () => {
      if (cancelled) return;
      if (defaultTemplateAutoAppliedRef.current) return;

      const editor = editorRef.current;
      if (!editor) {
        tries += 1;
        if (tries <= maxTries) window.setTimeout(tryApply, 150);
        return;
      }

      defaultTemplateAutoAppliedRef.current = true;
      await loadDefaultTemplate();
    };

    window.setTimeout(tryApply, 0);
    return () => {
      cancelled = true;
    };
  }, [loading, hasDefaultTemplate, currentPetitionId, hasUnsavedChanges]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch {
      // ignore
    }
  }, [sidebarWidth]);

  // Sidebar resize handlers
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizingSidebarRef.current) return;
      const delta = e.clientX - sidebarResizeStartXRef.current;
      const minWidth = 220;
      const maxWidth = Math.min(620, Math.max(260, Math.floor(window.innerWidth * 0.55)));
      const next = Math.max(minWidth, Math.min(maxWidth, sidebarResizeStartWidthRef.current + delta));
      setSidebarWidth(next);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };

    const onMouseUp = () => {
      if (!isResizingSidebarRef.current) return;
      isResizingSidebarRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  // Atalho Ctrl+S para salvar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        savePetitionActionRef.current?.();
      }

      // Alt+Space abre modal de busca de bloco (atalho)
      if (e.altKey && e.code === 'Space') {
        e.preventDefault();
        setBlockSearchQuery('');
        setBlockSearchScope(
          blockFilterScope === 'type'
            ? selectedStandardTypeId
              ? 'type'
              : 'area'
            : blockFilterScope
        );
        setShowBlockSearchModal(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const normalizeSearchText = (value: string): string => {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9\s\[\]_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const levenshteinLimited = (a: string, b: string, maxDist: number): number => {
    if (a === b) return 0;
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > maxDist) return maxDist + 1;
    if (la === 0) return lb;
    if (lb === 0) return la;

    const v0 = new Array<number>(lb + 1);
    const v1 = new Array<number>(lb + 1);
    for (let j = 0; j <= lb; j += 1) v0[j] = j;

    for (let i = 0; i < la; i += 1) {
      v1[0] = i + 1;
      let rowMin = v1[0];
      const ca = a.charCodeAt(i);
      for (let j = 0; j < lb; j += 1) {
        const cost = ca === b.charCodeAt(j) ? 0 : 1;
        const del = v0[j + 1] + 1;
        const ins = v1[j] + 1;
        const sub = v0[j] + cost;
        const val = Math.min(del, ins, sub);
        v1[j + 1] = val;
        if (val < rowMin) rowMin = val;
      }
      if (rowMin > maxDist) return maxDist + 1;
      for (let j = 0; j <= lb; j += 1) v0[j] = v1[j];
    }
    return v0[lb];
  };

  const scoreSingleTermInText = (termRaw: string, textRaw: string, weightExact: number, weightFuzzy: number) => {
    const term = normalizeSearchText(termRaw);
    if (!term) return 0;
    const text = normalizeSearchText(textRaw);
    if (!text) return 0;
    const words = text.split(' ').filter(Boolean);
    if (words.length === 0) return 0;

    if (words.join(' ').includes(term)) return weightExact;

    let best = 0;
    const maxDist = term.length <= 4 ? 1 : 2;
    for (const w of words) {
      if (!w) continue;
      if (w === term) return weightExact;
      const d = levenshteinLimited(term, w, maxDist);
      if (d <= maxDist) {
        const local = weightFuzzy * (1 - d / (maxDist + 1));
        if (local > best) best = local;
      }
    }
    return best;
  };

  const fuzzyScore = (queryRaw: string, titleRaw: string, contentRaw: string): number => {
    const query = normalizeSearchText(queryRaw);
    if (!query) return 0;
    const title = normalizeSearchText(titleRaw);
    const content = normalizeSearchText(contentRaw);

    const stop = new Set([
      'a',
      'o',
      'os',
      'as',
      'de',
      'da',
      'do',
      'das',
      'dos',
      'e',
      'em',
      'no',
      'na',
      'nos',
      'nas',
      'por',
      'para',
      'com',
      'sem',
      'ao',
      'aos',
      'um',
      'uma',
    ]);
    const terms = query
      .split(' ')
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !stop.has(t));
    if (terms.length === 0) return 0;

    const titleWords = title.split(' ').filter(Boolean);
    const contentWords = content.split(' ').filter(Boolean);

    const scoreTermInWords = (term: string, words: string[], weightExact: number, weightFuzzy: number) => {
      if (!term) return 0;
      // Substring match direto
      if (words.join(' ').includes(term)) return weightExact;

      // Fuzzy por palavra (limitado, barato)
      let best = 0;
      const maxDist = term.length <= 4 ? 1 : 2;
      for (const w of words) {
        if (!w) continue;
        if (w === term) return weightExact;
        const d = levenshteinLimited(term, w, maxDist);
        if (d <= maxDist) {
          const local = weightFuzzy * (1 - d / (maxDist + 1));
          if (local > best) best = local;
        }
      }
      return best;
    };

    let score = 0;
    for (const term of terms) {
      // Prioriza tÃ­tulo
      const sTitle = scoreTermInWords(term, titleWords, 1.0, 0.75);
      const sContent = scoreTermInWords(term, contentWords, 0.5, 0.35);
      score += Math.max(sTitle, sContent);
    }

    // Normaliza por quantidade de termos
    score = score / terms.length;

    // Boost se query inteira aparece no tÃ­tulo
    if (title.includes(query)) score += 0.35;
    if (score > 1.5) score = 1.5;
    return score;
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      setSavedPetitionsLoading(true);

      const [petitionsData, clientsData, areasData] = await Promise.all([
        isCloudImportMode ? Promise.resolve([]) : petitionEditorService.listPetitions(),
        loadClients(),
        petitionEditorService.listLegalAreas(),
      ]);

      const normalizedAreas = (areasData || []).map(sanitizeLegalAreaRecord);
      const normalizedPetitions = (petitionsData || []).map(sanitizeSavedPetitionRecord);
      const preferredAreaId = selectedLegalAreaId && normalizedAreas.some((a) => a.id === selectedLegalAreaId) ? selectedLegalAreaId : null;
      const nextAreaId = preferredAreaId || normalizedAreas[0]?.id || null;
      setLegalAreas(normalizedAreas);
      if (!preferredAreaId && nextAreaId) setSelectedLegalAreaId(nextAreaId);
      if (nextAreaId) {
        try {
          window.localStorage.setItem(SELECTED_LEGAL_AREA_STORAGE_KEY, nextAreaId);
        } catch {
          // ignore
        }
      }

      // Carregar PetiçÃµes Padroes (todas as areas para navegaçÃ£o hierÃ¡rquica no header)
      const allTypes = (await petitionEditorService.listStandardTypes(null)).map(sanitizeStandardTypeRecord);
      const byArea: Record<string, PetitionStandardType[]> = {};
      for (const t of allTypes || []) {
        const key = String(t.legal_area_id || '');
        if (!key) continue;
        if (!byArea[key]) byArea[key] = [];
        byArea[key].push(t);
      }
      setStandardTypesByArea(byArea);

      // Tipos da area selecionada
      const typesData = nextAreaId ? byArea[nextAreaId] ?? [] : [];
      setStandardTypes(typesData);
      if (nextAreaId) {
        try {
          const storedTypeId = window.localStorage.getItem(`${SELECTED_STANDARD_TYPE_STORAGE_KEY_PREFIX}${nextAreaId}`);
          if (storedTypeId && typesData.some((t) => t.id === storedTypeId)) {
            setSelectedStandardTypeId(storedTypeId);
          } else {
            setSelectedStandardTypeId(null);
          }
        } catch {
          setSelectedStandardTypeId(null);
        }
      }

      const blocksData = (await petitionEditorService.listBlocksByLegalArea(nextAreaId, selectedDocumentType)).map(sanitizeBlockRecord);
      setBlocks(blocksData);
      const withClient = normalizedPetitions.filter((p) => Boolean(p.client_id));
      const orphans = normalizedPetitions.filter((p) => !p.client_id);
      setSavedPetitions(withClient);
      // Limpar automaticamente documentos antigos sem vinculaçÃ£o
      if (orphans.length) {
        petitionEditorService.deleteOrphanPetitions().catch(() => {
          // ignore
        });
      }
      setClients(clientsData);
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
      setError('Erro ao carregar dados. Tente novamente.');
    } finally {
      setLoading(false);
      setSavedPetitionsLoading(false);
    }
  };

  useEffect(() => {
    // Recarregar blocos e petiçÃµes padrÃµes quando trocar area ou tipo de documento
    let cancelled = false;
    const reload = async () => {
      try {
        // Carregar petiçÃµes padrÃµes da area
        if (selectedLegalAreaId) {
          const typesData = (await petitionEditorService.listStandardTypes(selectedLegalAreaId)).map(sanitizeStandardTypeRecord);
          if (!cancelled) {
            setStandardTypes(typesData);
            setStandardTypesByArea((prev) => ({ ...prev, [selectedLegalAreaId]: typesData }));
            if (!selectedStandardTypeId) {
              try {
                const storedTypeId = window.localStorage.getItem(`${SELECTED_STANDARD_TYPE_STORAGE_KEY_PREFIX}${selectedLegalAreaId}`);
                if (storedTypeId && typesData.find((t) => t.id === storedTypeId)) {
                  setSelectedStandardTypeId(storedTypeId);
                }
              } catch {
                // ignore
              }
            }
            // Se tinha um tipo selecionado que nÃ£o existe mais na nova area, limpar
            if (selectedStandardTypeId && !typesData.find((t) => t.id === selectedStandardTypeId)) {
              setSelectedStandardTypeId(null);
              setBlockFilterScope('area');
            }
          }
        } else {
          if (!cancelled) {
            setStandardTypes([]);
            setSelectedStandardTypeId(null);
          }
        }

        // Carregar blocos baseado no escopo
        let blocksData: PetitionBlock[] = [];
        if (blockFilterScope === 'type' && selectedStandardTypeId) {
          blocksData = (await petitionEditorService.listBlocksByStandardType(selectedStandardTypeId)).map(sanitizeBlockRecord);
        } else if (blockFilterScope === 'global') {
          blocksData = (await petitionEditorService.listBlocks(selectedDocumentType)).map(sanitizeBlockRecord);
        } else {
          blocksData = (await petitionEditorService.listBlocksByLegalArea(selectedLegalAreaId, selectedDocumentType)).map(sanitizeBlockRecord);
        }
        if (!cancelled) setBlocks(blocksData);
      } catch {
        // ignore
      }
    };
    void reload();
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentType, selectedLegalAreaId, selectedStandardTypeId, blockFilterScope]);

  useEffect(() => {
    if (!selectedLegalAreaId) return;
    try {
      window.localStorage.setItem(SELECTED_LEGAL_AREA_STORAGE_KEY, selectedLegalAreaId);
    } catch {
      // ignore
    }
  }, [selectedLegalAreaId]);

  useEffect(() => {
    if (!selectedLegalAreaId) return;
    try {
      const key = `${SELECTED_STANDARD_TYPE_STORAGE_KEY_PREFIX}${selectedLegalAreaId}`;
      if (selectedStandardTypeId) {
        window.localStorage.setItem(key, selectedStandardTypeId);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }, [selectedLegalAreaId, selectedStandardTypeId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(BLOCK_FILTER_SCOPE_STORAGE_KEY, blockFilterScope);
    } catch {
      // ignore
    }
  }, [blockFilterScope]);

  useEffect(() => {
    let cancelled = false;
    const loadCats = async () => {
      try {
        const cats = await petitionEditorService.listBlockCategories(selectedDocumentType);
        if (cancelled) return;
        setBlockCategories(cats);
        if (showCategoryModal) ensureDraftFromCategories(cats);
      } catch {
        if (cancelled) return;
        setBlockCategories([]);
      }
    };
    void loadCats();
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentType]);

  const loadClients = async (): Promise<Client[]> => {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'ativo')
      .order('full_name');
    
    if (error) {
      console.error('Erro ao carregar clientes:', error);
      return [];
    }
    return (data || []).map(sanitizeClientRecord);
  };

  // Notificar parent sobre mudanças nÃ£o salvas (para widget flutuante)
  useEffect(() => {
    onUnsavedChanges?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChanges]);

  useEffect(() => {
    onWidgetInfoChange?.({ lastSaved, selectedClient });
  }, [lastSaved, selectedClient, onWidgetInfoChange]);

  // Carregar cliente/petiçÃ£o inicial quando em modo widget flutuante
  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    if (!isFloatingWidget) return;

    if (!loading && !initialDocumentBase64 && !initialDocumentUrl && !initialPetitionId) {
      initialLoadDoneRef.current = true;
    }

    if (initialDocumentBase64) {
      if (initialDocumentRequestId) return;
      initialLoadDoneRef.current = true;
      setShowStartScreen(false);
      void importInitialDocument(initialDocumentBase64, initialDocumentName);
      return;
    }

    if (initialDocumentUrl) {
      if (initialDocumentRequestId) return;
      initialLoadDoneRef.current = true;
      setShowStartScreen(false);
      void importInitialDocumentFromUrl(initialDocumentUrl, initialDocumentName);
      return;
    }

    if (loading) return;

    initialLoadDoneRef.current = true;

    // Se tiver petiçÃ£o inicial, carregar
    if (initialPetitionId) {
      const petition = savedPetitions.find(p => p.id === initialPetitionId);
      if (petition) {
        loadPetition(petition);
        return;
      }
    }

    // Se tiver cliente inicial, selecionar e mostrar peticoes do cliente
    if (initialClientId) {
      const client = clients.find(c => c.id === initialClientId);
      if (client) {
        setSelectedClient(client);
        setSidebarTab('blocks');
        // Filtrar peticoes do cliente para mostrar opçÃµes
        const clientPetitions = savedPetitions.filter(p => p.client_id === initialClientId);
        if (clientPetitions.length > 0) {
          showSuccessMessage(`${clientPetitions.length} peticao(oes) encontrada(s) para ${client.full_name}`);
        }
      }
    }
  }, [loading, isFloatingWidget, initialClientId, initialPetitionId, initialDocumentBase64, initialDocumentUrl, initialDocumentName, clients, savedPetitions, importInitialDocument, importInitialDocumentFromUrl]);

  useEffect(() => {
    if (!initialClientId) return;
    if (selectedClient?.id === initialClientId) return;
    const client = clients.find((c) => c.id === initialClientId);
    if (!client) return;
    setSelectedClient(client);
    setSidebarTab('blocks');
  }, [initialClientId, clients, selectedClient?.id]);

  const lastImportedRequestIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isFloatingWidget) return;
    if (!initialDocumentBase64 && !initialDocumentUrl) return;
    if (!initialDocumentRequestId) return;
    if (lastImportedRequestIdRef.current === initialDocumentRequestId) return;
    if (lastHandledInitialDocumentRequestId === initialDocumentRequestId) return;

    lastHandledInitialDocumentRequestId = initialDocumentRequestId;
    lastImportedRequestIdRef.current = initialDocumentRequestId;
    if (initialDocumentUrl) {
      void importInitialDocumentFromUrl(initialDocumentUrl, initialDocumentName);
      return;
    }

    if (initialDocumentBase64) {
      void importInitialDocument(initialDocumentBase64, initialDocumentName);
    }
  }, [isFloatingWidget, loading, initialDocumentBase64, initialDocumentUrl, initialDocumentName, initialDocumentRequestId, importInitialDocument, importInitialDocumentFromUrl]);

  const blockIndexMap = useMemo(() => {
    const map = new Map<
      string,
      {
        plain: string;
        titleN: string;
        tagsText: string;
        tagsN: string;
        contentN: string;
        hayForSidebar: string;
        tags: string[];
      }
    >();

    for (const b of blocks) {
      const plain = sfdtToPlainText(b.content);
      const tags = getBlockTagsForUI(b, plain);
      const tagsText = tags.join(' ');
      map.set(b.id, {
        plain,
        titleN: normalizeSearchText(b.title),
        tagsText,
        tagsN: normalizeSearchText(tagsText),

        contentN: normalizeSearchText(plain),
        hayForSidebar: `${normalizeSearchText(b.title)} ${normalizeSearchText(tagsText)} ${normalizeSearchText(plain)}`.trim(),
        tags,
      });
    }

    return map;
  }, [blocks]);

  const getRelevantBlocksForAiEdit = useCallback((selectedText: string) => {
    const query = normalizeSearchText(selectedText);
    const terms = parseSearchTerms(selectedText);

    return (blocks || [])
      .filter((block) => Boolean(block?.is_active) && String((block.document_type || 'petition') as any) === String(selectedDocumentType))
      .map((block) => {
        const idx = blockIndexMap.get(block.id);
        const hay = idx?.hayForSidebar || '';
        let score = 0;

        if (query) {
          if (hay.includes(query)) score += 80;
          if ((idx?.titleN || '').includes(query)) score += 35;
          if ((idx?.tagsN || '').includes(query)) score += 25;
          if ((idx?.contentN || '').includes(query)) score += 20;
        }

        for (const term of terms) {
          if (hay.includes(term)) score += 12;
          if ((idx?.tagsN || '').includes(term)) score += 10;
          if ((idx?.titleN || '').includes(term)) score += 8;
        }

        if (block.is_default) score += 6;

        return {
          block,
          score,
          plain: idx?.plain ?? sfdtToPlainText(block.content),
          tags: idx?.tags ?? getBlockTagsForUI(block),
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => ({
        title: item.block.title,
        category: getCategoryLabel(String(item.block.category || 'outros')),
        tags: item.tags,
        content: item.plain,
      }));
  }, [blocks, selectedDocumentType, blockIndexMap]);

  // Filtrar blocos
  const filteredBlocks = useMemo(() => {
    const terms = parseSearchTerms(blockSearchDebounced);
    return blocks.filter((block) => {
      const dt = (block.document_type || 'petition') as string;
      if (dt !== selectedDocumentType) return false;
      if (!block.is_active) return false;
      const hay = blockIndexMap.get(block.id)?.hayForSidebar || '';
      const matchesSearch = terms.length === 0 || terms.every((t) => hay.includes(t));
      return matchesSearch;
    });
  }, [blocks, blockSearchDebounced, selectedDocumentType, blockIndexMap]);

  // Agrupar por categoria
  const blocksByCategory = useMemo(() => {
    const grouped: Record<string, PetitionBlock[]> = {};
    for (const block of filteredBlocks) {
      const key = String(block.category || 'outros');
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(block);
    }
    return grouped;
  }, [filteredBlocks]);

  const sidebarCategoryKeys = useMemo(() => {
    const keysFromBlocks = new Set(Object.keys(blocksByCategory || {}));
    const ordered = categoryKeysOrdered.filter((k) => keysFromBlocks.has(k));
    for (const k of keysFromBlocks) {
      if (!ordered.includes(k)) ordered.push(k);
    }
    return ordered;
  }, [blocksByCategory, categoryKeysOrdered]);

  // Filtrar blocos para modal de busca
  const searchFilteredBlocks = useMemo(() => {
    const active = (blockSearchBlocks || []).filter(
      (b) => Boolean(b.is_active) && String((b.document_type || 'petition') as any) === String(selectedDocumentType)
    );
    const q = (blockSearchQueryDebounced || '').trim();
    if (!q) return active.map((b) => ({ block: b, score: 0, matchPct: 0 } as BlockSearchResult));

    const terms = parseSearchTerms(q);
    const ignored = new Set([
      'a',
      'as',
      'ao',
      'aos',
      'Ã ',
      'Ã s',
      'com',
      'da',
      'das',
      'de',
      'do',
      'dos',
      'e',
      'em',
      'na',
      'nas',
      'no',
      'nos',
      'para',
      'por',
      'sem',
      'uma',
      'um',
    ]);
    const termsN = terms
      .map((t) => normalizeSearchText(String(t || '')))
      .filter(Boolean)
      .filter((t) => {
        const token = String(t || '');
        if (!token) return false;
        if (token.length <= 2) return false;
        if (ignored.has(token)) return false;
        return true;
      });
    const qN = normalizeSearchText(q);

    if (termsN.length === 0) return active.map((b) => ({ block: b, score: 0, matchPct: 0 } as BlockSearchResult));

    const meaningfulTerms = termsN.filter((t) => String(t || '').length >= 4);

    const scoreTermInNormalizedText = (
      term: string,
      text: string,
      weightExact: number,
      weightFuzzy: number,
      wordsOverride?: string[],
    ) => {
      if (!term || !text) return 0;
      if (text.includes(term)) return weightExact;
      const words = Array.isArray(wordsOverride) ? wordsOverride : text.split(' ').filter(Boolean);
      if (words.length === 0) return 0;
      let best = 0;
      const termLen = term.length;
      const termPrefix = termLen >= 6 ? term.slice(0, 4) : '';
      const maxDist = termLen <= 4 ? 1 : termLen <= 7 ? 2 : 3;
      for (const w of words) {
        if (!w) continue;
        if (w === term) return weightExact;
        if (termPrefix && w.startsWith(termPrefix)) {
          const local = weightFuzzy * 0.92;
          if (local > best) best = local;
        }
        const d = levenshteinLimited(term, w, maxDist);
        if (d <= maxDist) {
          const local = weightFuzzy * (1 - d / (maxDist + 1));
          if (local > best) best = local;
        }
      }
      return best;
    };

    const ranked = active
      .map((b) => {
        const idx = blockIndexMap.get(b.id);
        const plain = idx?.plain ?? sfdtToPlainText(b.content);
        const titleN = idx?.titleN ?? normalizeSearchText(b.title);
        const tagsText = idx?.tagsText ?? getBlockTagsForUI(b, plain).join(' ');
        const tagsN = idx?.tagsN ?? normalizeSearchText(tagsText);
        const contentN = idx?.contentN ?? normalizeSearchText(plain);

        const titleWords = titleN.split(' ').filter(Boolean);
        const tagsWords = tagsN.split(' ').filter(Boolean);
        const contentWords = contentN.split(' ').filter(Boolean);

        const scores = termsN.map((term) => {
          if (!term) return 0;

          if (term.includes(' ')) {
            if (tagsN.includes(term)) return 1.15;
            if (titleN.includes(term)) return 1.0;
            if (contentN.includes(term)) return 0.7;
            return 0;
          }

          const sTags = scoreTermInNormalizedText(term, tagsN, 1.2, 0.95, tagsWords);
          const sTitle = scoreTermInNormalizedText(term, titleN, 1.0, 0.75, titleWords);
          const sContent = scoreTermInNormalizedText(term, contentN, 0.7, 0.55, contentWords);
          return Math.max(sTags, sTitle * 0.95, sContent * 0.85);
        });

        const sorted = scores.slice().sort((a, b) => b - a);
        const best = sorted[0] ?? 0;
        const topK = Math.min(sorted.length, sorted.length >= 3 ? 3 : sorted.length);
        const base = sorted.slice(0, topK).reduce((acc, v) => acc + v, 0) / Math.max(1, topK);

        if (best < 0.5 && base < 0.45) return null;

        const tagsAllTerms = meaningfulTerms.length > 0 && meaningfulTerms.every((t) => tagsN.includes(t));
        const contentAllTerms = meaningfulTerms.length > 0 && meaningfulTerms.every((t) => contentN.includes(t));

        let score = base;
        if (tagsAllTerms) score += 0.35;
        if (contentAllTerms) score += 0.12;
        if (qN && tagsN.includes(qN)) score += 0.25;
        if (qN && titleN.includes(qN)) score += 0.15;
        if (qN && contentN.includes(qN)) score += 0.05;
        if (score > 1.8) score = 1.8;
        const matchPct = Math.round(Math.max(0, Math.min(1, score / 1.8)) * 100);
        return { block: b, score, matchPct } as BlockSearchResult;
      })
      .filter((x): x is BlockSearchResult => Boolean(x) && x !== null && x.score > 0.25)
      .sort((a, b) => b.score - a.score);

    return ranked;
  }, [blockSearchBlocks, blockSearchQueryDebounced, selectedDocumentType, blockIndexMap]);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const filteredClients = useMemo(() => {
    const q = (clientSearch || '').trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((client) => {
      const name = (client.full_name || '').toLowerCase();
      const doc = (client.cpf_cnpj || '').toLowerCase();
      return name.includes(q) || doc.includes(q);
    });
  }, [clients, clientSearch]);

  // Gerar qualificaçÃ£o do cliente
  const generateClientQualification = (client: Client): string => {
    const normalizedClient = sanitizeClientRecord(client);
    const parts: string[] = [];
    
    parts.push(`${normalizedClient.full_name.toUpperCase()}`);
    
    if (normalizedClient.nationality) parts.push(normalizedClient.nationality.toLowerCase());
    if (normalizedClient.marital_status) parts.push(MARITAL_STATUS_LABELS[normalizedClient.marital_status] || normalizedClient.marital_status);
    if (normalizedClient.profession) parts.push(normalizedClient.profession.toLowerCase());
    if (normalizedClient.cpf_cnpj) parts.push(`inscrito(a) no CPF sob o nº ${normalizedClient.cpf_cnpj}`);
    if (normalizedClient.rg) parts.push(`RG nº ${normalizedClient.rg}`);
    
    let address = '';
    if (normalizedClient.address_street) address += `residente e domiciliado(a) na ${normalizedClient.address_street}`;
    if (normalizedClient.address_number) address += `, nº ${normalizedClient.address_number}`;
    if (normalizedClient.address_complement) address += `, ${normalizedClient.address_complement}`;
    if (normalizedClient.address_neighborhood) address += `, Bairro ${normalizedClient.address_neighborhood}`;
    if (normalizedClient.address_city) address += `, ${normalizedClient.address_city}`;
    if (normalizedClient.address_state) address += ` – ${normalizedClient.address_state}`;
    if (normalizedClient.address_zip_code) address += `, CEP ${normalizedClient.address_zip_code}`;
    if (address) parts.push(address);
    
    if (normalizedClient.phone) parts.push(`telefone/WhatsApp ${normalizedClient.phone}`);
    if (normalizedClient.email) parts.push(`e-mail ${normalizedClient.email}`);
    
    return parts.join(', ');
  };

  const selectClientForPetition = (client: Client) => {
    const normalizedClient = sanitizeClientRecord(client);
    setSelectedClient(normalizedClient);
    setSidebarTab('clients');
    setHasUnsavedChanges(true);
  };

  // Inserir qualificaçÃ£o do cliente
  const insertClientQualification = (client: Client) => {
    if (!isOnlineRef.current) {
      setError('Voce esta offline. O Peticionamento e 100% online: reconecte para editar/salvar.');
      return;
    }
    const normalizedClient = sanitizeClientRecord(client);
    setSelectedClient(normalizedClient);
    const editor = editorRef.current;
    if (!editor) return;

    const name = (normalizedClient.full_name || '').toUpperCase();
    const qualification = generateClientQualification(normalizedClient);
    const rest = qualification.startsWith(name) ? qualification.slice(name.length) : `, ${qualification}`;

    editor.focus();
    editor.setBold(true);
    editor.insertText(name);
    editor.setBold(false);
    editor.insertText(rest);
    setHasUnsavedChanges(true);
    showSuccessMessage('Qualificacao do cliente inserida no documento');
    window.setTimeout(() => {
      const ed = editorRef.current;
      if (ed) {
        ed.focus();
        // Move cursor to end of inserted qualification
        const selection = (ed as any).containerRef?.current?.documentEditor?.selection;
        if (selection && typeof selection.moveToDocumentEnd === 'function') {
          selection.moveToDocumentEnd();
        }
      }
    }, 0);
  };

  const openAiEditModalFromSelection = useCallback((selectedText: string) => {
    const text = String(selectedText || '').trim();
    if (!text) {
      setError('Selecione um trecho do documento para editar com IA');
      return;
    }

    setError(null);
    setAiEditInstruction('Melhore a redacao juridica, preservando o sentido e deixando o texto mais tecnico e claro.');
    setAiEditSelectedText(text);
    setShowAiEditModal(true);
  }, []);

  // Formatar qualificaçÃ£o com IA
  const handleFormatQualification = async (selectedText: string) => {
    openAiEditModalFromSelection(selectedText);
  };

  const handleApplyAiEdit = async () => {
    if (!isOnlineRef.current) {
      setError('Voce esta offline. O Peticionamento e 100% online: reconecte para editar/salvar.');
      return;
    }

    const selectedText = String(aiEditSelectedText || '').trim();
    const instruction = String(aiEditInstruction || '').trim();
    if (!selectedText) {
      setError('Selecione um trecho do documento para editar com IA');
      return;
    }
    if (!instruction) {
      setError('Informe o que a IA deve fazer no trecho selecionado');
      return;
    }

    try {
      setFormattingWithAI(true);
      setError(null);

      const contextBlocks = getRelevantBlocksForAiEdit(selectedText);
      const editedText = await aiService.editLegalTextWithContext({
        instruction,
        selectedText,
        contextBlocks,
      });

      const editor = editorRef.current;
      if (!editor) throw new Error('Editor nao disponivel');

      editor.focus();
      const selection = (editor as any).containerRef?.current?.documentEditor?.selection;
      if (selection) {
        selection.delete();
      }

      editor.insertText(editedText);
      setHasUnsavedChanges(true);
      setShowAiEditModal(false);
      showSuccessMessage('Trecho editado com IA');
    } catch (err) {
      console.error('Erro ao editar trecho com IA:', err);
      setError(err instanceof Error ? err.message : 'Erro ao editar trecho com IA');
    } finally {
      setFormattingWithAI(false);
    }
  };

  // ========== RENDER ==========
  // Tela de inÃ­cio (quando showStartScreen === true)
  if (showStartScreen) {
    return (
      <div className={`${isFloatingWidget ? 'h-full' : 'h-screen'} flex flex-col bg-white`}>
        {/* Barra de tÃ­tulo (estilo Word) */}
        <div className="h-12 flex items-center justify-between px-4 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-[#2b579a] flex items-center justify-center shadow-sm">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div className="text-sm font-semibold text-slate-900">Editor de Peticoes</div>
          </div>
          <div className="flex items-center gap-1">
            {isFloatingWidget && (
              <button
                onClick={() => onRequestMinimize?.()}
                className="p-1.5 hover:bg-slate-100 rounded transition-colors text-slate-500 hover:text-slate-700"
                title="Minimizar"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            )}
            {isFloatingWidget && (
              <button
                onClick={() => onRequestClose?.()}
                className="p-1.5 hover:bg-slate-100 rounded transition-colors text-slate-500 hover:text-slate-700"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-8">
            {/* SaudaçÃ£o */}
            <div className="mb-7">
              <div className="text-[26px] font-semibold tracking-tight text-slate-900">{getGreeting()}</div>
              <div className="mt-0.5 text-sm text-slate-500">{userDisplayName}</div>
            </div>

            {/* Novo */}
            <div className="mb-9">
              <div className="text-sm font-semibold text-slate-700 mb-3">Novo</div>
              <div className="flex gap-5 flex-wrap">
                <button
                  onClick={() => { newPetition(); setShowStartScreen(false); }}
                  className="group w-[168px] text-left"
                >
                  <div className="relative h-[152px] rounded-md border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center transition group-hover:border-[#2b579a] group-hover:shadow-md">
                    <div className="w-[98px] h-[126px] bg-white border border-slate-200 shadow-sm" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                      <div className="w-10 h-10 rounded-full bg-[#2b579a] text-white flex items-center justify-center shadow-md">
                        <Plus className="w-5 h-5" />
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 text-[13px] font-medium text-slate-700 group-hover:text-[#2b579a] transition-colors">Documento em branco</div>
                </button>

                <div className="relative w-[168px]">
                  {/* Configurar: subir modelo padrao (.docx) */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); defaultTemplateInputRef.current?.click(); }}
                    disabled={settingDefaultTemplate}
                    className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-white/95 backdrop-blur border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover:text-[#2b579a] hover:border-[#2b579a] transition-colors disabled:opacity-60"
                    title="Configurar: subir modelo padrão (.docx)"
                  >
                    {settingDefaultTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Settings className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    onClick={() => {
                      // Abrir o editor primeiro para garantir que o Syncfusion esteja montado
                      if (isLoadingPetitionRef.current) return;
                      isLoadingPetitionRef.current = true;
                      newPetition();
                      setShowStartScreen(false);
                      window.setTimeout(() => {
                        void Promise.resolve(loadDefaultTemplate()).finally(() => {
                          isLoadingPetitionRef.current = false;
                        });
                      }, 200);
                    }}
                    disabled={!hasDefaultTemplate}
                    className="group w-full text-left disabled:opacity-50"
                    title={hasDefaultTemplate ? `Carregar documento padrao${defaultTemplateName ? `: ${defaultTemplateName}` : ''}` : 'Nenhum documento padrao definido — use a engrenagem para subir um modelo'}
                  >
                    <div className="relative h-[152px] rounded-md border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center transition group-hover:border-[#2b579a] group-hover:shadow-md group-disabled:border-slate-200 group-disabled:shadow-none">
                      <div className="w-[98px] h-[126px] bg-white border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                        <div className="h-2 shrink-0 bg-[#2b579a]/80" />
                        <div className="p-2.5 space-y-1.5">
                          <div className="h-1 rounded bg-slate-200" />
                          <div className="h-1 rounded bg-slate-200 w-4/5" />
                          <div className="h-1 rounded bg-slate-200" />
                          <div className="h-1 rounded bg-slate-200 w-2/3" />
                          <div className="h-1 rounded bg-slate-200 w-5/6" />
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5 text-[13px] font-medium text-slate-700 group-hover:text-[#2b579a] transition-colors">Documento padrao</div>
                  </button>

                  {/* Input oculto para subir o modelo padrao (disponivel ja na tela inicial) */}
                  <input
                    ref={defaultTemplateInputRef}
                    type="file"
                    accept=".docx"
                    className="hidden"
                    onChange={handleUploadDefaultTemplate}
                  />
                </div>

                <button
                  onClick={() => {
                    setShowStartScreen(false);
                    window.setTimeout(() => {
                      fileInputRef.current?.click();
                    }, 150);
                  }}
                  className="group w-[168px] text-left"
                >
                  <div className="relative h-[152px] rounded-md border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center transition group-hover:border-[#2b579a] group-hover:shadow-md">
                    <div className="w-[98px] h-[126px] bg-white border border-slate-200 shadow-sm flex items-center justify-center">
                      <FileUp className="w-8 h-8 text-slate-400 group-hover:text-[#2b579a] transition-colors" />
                    </div>
                  </div>
                  <div className="mt-2.5 text-[13px] font-medium text-slate-700 group-hover:text-[#2b579a] transition-colors">Importar arquivo</div>
                </button>
              </div>

              {/* Status do documento padrao */}
              <div className="mt-4 flex items-center gap-2 text-[12px] flex-wrap">
                {hasDefaultTemplate ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 px-2.5 py-1 text-slate-700">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-medium">Documento padrão:</span>
                      <span className="max-w-[220px] truncate">{defaultTemplateName || 'definido'}</span>
                    </span>
                    <button
                      onClick={clearDefaultTemplate}
                      className="inline-flex items-center gap-1 text-slate-400 hover:text-red-600 font-medium transition-colors"
                      title="Remover documento padrão"
                    >
                      <X className="w-3.5 h-3.5" />
                      Remover
                    </button>
                  </>
                ) : (
                  <span className="text-slate-400">
                    Nenhum documento padrão definido. Clique na <span className="font-medium text-slate-500">engrenagem</span> do card “Documento padrão” para subir um modelo, ou em <span className="font-medium text-slate-500">“Definir padrão”</span> na barra do editor.
                  </span>
                )}
              </div>
            </div>

            {/* Recentes */}
            <div className="border-t border-slate-200 pt-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-slate-700">Recentes</div>
              </div>

              <div>
                {savedPetitionsLoading ? (
                  <div className="px-1 py-2"><ModuleSkeleton variant="list" rows={5} /></div>
                ) : savedPetitions.length === 0 ? (
                  <div className="px-3 py-12 text-center">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-slate-100 flex items-center justify-center">
                      <Clock className="w-6 h-6 text-slate-400" />
                    </div>
                    <div className="text-sm text-slate-500">Nenhuma peticao recente</div>
                  </div>
                ) : (
                  <div className="max-h-[420px] overflow-y-auto -mx-1.5">
                    {(() => {
                      // Dedup: agrupa por (tÃ­tulo normalizado + client_id), mantÃ©m o mais recente.
                      // NormalizaçÃ£o remove sufixos Windows ` (N)` do final do tÃ­tulo:
                      // "MODELO MASCULINO (8) (1) (2)" â†’ "modelo masculino"
                      const normalizeTitle = (t: string) =>
                        t.trim().replace(/(\s*\(\d+\))+$/g, '').trim().toLowerCase();
                      const seen = new Map<string, SavedPetition>();
                      for (const p of savedPetitions) {
                        const key = `${normalizeTitle(p.title || '')}|${p.client_id || ''}`;
                        const existing = seen.get(key);
                        if (!existing || new Date(p.updated_at).getTime() > new Date(existing.updated_at).getTime()) {
                          seen.set(key, p);
                        }
                      }
                      return Array.from(seen.values())
                        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                        .slice(0, 15);
                    })().map((p) => {
                      const isOpening = openingPetitionId === p.id;
                      const isBusyOpening = openingPetitionId !== null;

                      return (
                        <div
                          key={p.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (isBusyOpening) return;
                            void loadPetition(p);
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            if (isBusyOpening) return;
                            e.preventDefault();
                            void loadPetition(p);
                          }}
                          className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent transition-colors ${
                            isBusyOpening ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:bg-[#2b579a]/[0.06] hover:border-slate-200'
                          }`}
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#2b579a]/10 text-[#2b579a]">
                            {isOpening ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-[18px] h-[18px]" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-slate-800 truncate">{isOpening ? 'Abrindo...' : (p.title || 'Sem titulo')}</div>
                            <div className="text-xs text-slate-500 truncate">{p.client_name || 'Sem cliente'}</div>
                          </div>
                          <div className="shrink-0 text-xs text-slate-400 whitespace-nowrap tabular-nums" data-tick={relativeTimeTick}>
                            {formatRelativeTime(p.updated_at)}
                          </div>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (isBusyOpening) return;
                              const confirmed = await confirmDelete({
                                title: 'Excluir peticao',
                                entityName: p.title || 'Sem titulo',
                                message: `Deseja excluir a peticao "${p.title || 'Sem titulo'}"${p.client_name ? ` vinculada ao cliente ${p.client_name}` : ''}?`,
                                confirmLabel: 'Excluir',
                              });
                              if (!confirmed) return;
                              try {
                                await petitionEditorService.deletePetition(p.id);
                                notifyDeleted(p.title || undefined);
                                setSavedPetitions((prev) => prev.filter((x) => x.id !== p.id));
                              } catch (err) {
                                console.error('Erro ao excluir peticao:', err);
                                setError('Erro ao excluir peticao');
                              }
                            }}
                            disabled={isBusyOpening}
                            className="shrink-0 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Excluir peticao"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const ribbonTopContent = (
    <>
      <div className="pet-top-group is-left">
        <div className="pet-top-cluster">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="pet-top-icon-btn"
            title={sidebarOpen ? 'Ocultar painel' : 'Mostrar painel'}
          >
            {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
          </button>

          <div className="flex items-center rounded-xl border border-[#e7e5df] bg-[#f8f7f5] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            <button
              type="button"
              onClick={() => setActiveWorkspace('editor')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeWorkspace === 'editor'
                  ? 'bg-[#f8f7f5] text-amber-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              Editor
            </button>
            {blocksEnabled && (
              <button
                type="button"
                onClick={() => setActiveWorkspace('blocks')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  activeWorkspace === 'blocks'
                    ? 'bg-[#f8f7f5] text-amber-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                Blocos
              </button>
            )}
          </div>

          <button
            onClick={() => {
              if (hasUnsavedChanges) {
                const what = [
                  petitionTitle ? `Documento: "${petitionTitle}"` : '',
                  selectedClient?.full_name ? `Cliente: ${selectedClient.full_name}` : '',
                ]
                  .filter(Boolean)
                  .join('\n');
                const msg = `Ha alteracoes nao salvas.${what ? `\n\n${what}` : ''}\n\nDeseja voltar para a tela inicial mesmo assim?`;
                if (!confirm(msg)) return;
              }
              setShowStartScreen(true);
            }}
            className="pet-top-icon-btn"
            title="Voltar para a tela inicial"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>

        <div className="pet-top-title-shell pet-top-grow min-w-0">
          <input
            type="text"
            value={petitionTitle}
            onChange={(e) => { setPetitionTitle(e.target.value); setHasUnsavedChanges(true); }}
            className="pet-top-title-input px-3 py-2 text-sm font-semibold border border-transparent bg-transparent hover:border-[#e7e5df] focus:border-amber-400 rounded-xl focus:outline-none w-full"
            placeholder={"T\u00edtulo da peti\u00e7\u00e3o..."}
          />
        </div>
      </div>

      <div className="pet-top-group is-center">
        {legalAreas.length > 0 && (
          <div className="pet-top-filter-shell pet-top-grow">
          <select
            value={selectedStandardTypeId ? `type:${selectedStandardTypeId}` : `area:${selectedLegalAreaId || ''}`}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw.startsWith('type:')) {
                const typeId = raw.replace('type:', '').trim();
                const foundType = Object.values(standardTypesByArea).flat().find((t) => t.id === typeId) || null;
                const areaId = foundType?.legal_area_id || null;
                if (areaId) {
                  setSelectedLegalAreaId(areaId);
                  try {
                    window.localStorage.setItem(SELECTED_LEGAL_AREA_STORAGE_KEY, areaId);
                  } catch {
                    // ignore
                  }
                  setStandardTypes((standardTypesByArea[areaId] ?? []).map(sanitizeStandardTypeRecord));
                }

                setSelectedStandardTypeId(typeId);
                setBlockFilterScope('type');
                if (areaId) {
                  try {
                    window.localStorage.setItem(`${SELECTED_STANDARD_TYPE_STORAGE_KEY_PREFIX}${areaId}`, typeId);
                  } catch {
                    // ignore
                  }
                }
                if (foundType?.default_document && editorRef.current) {
                  editorRef.current.loadSfdt(foundType.default_document);
                  if (foundType.default_document_name) {
                    setPetitionTitle(sanitizeText(foundType.default_document_name));
                  }
                }
                return;
              }

              const newAreaId = raw.replace('area:', '').trim() || null;
              setSelectedLegalAreaId(newAreaId);
              setSelectedStandardTypeId(null);
              setBlockFilterScope('area');
              if (newAreaId) {
                try {
                  window.localStorage.setItem(SELECTED_LEGAL_AREA_STORAGE_KEY, newAreaId);
                  window.localStorage.removeItem(`${SELECTED_STANDARD_TYPE_STORAGE_KEY_PREFIX}${newAreaId}`);
                } catch {
                  // ignore
                }
              }
              setStandardTypes(newAreaId ? (standardTypesByArea[newAreaId] ?? []).map(sanitizeStandardTypeRecord) : []);

              const area = legalAreas.find((a) => a.id === newAreaId);
              if (area && (!petitionTitle || petitionTitle.startsWith('Nova Peticao'))) {
                setPetitionTitle(`Nova Peticao ${sanitizeText(area.name)}`);
              }
            }}
            className="pet-top-select px-3 py-2 text-xs border border-[#e7e5df] rounded-xl bg-white hover:border-amber-400 focus:border-amber-400 focus:outline-none"
            style={{ borderLeftColor: selectedLegalArea?.color || '#e2e8f0', borderLeftWidth: '3px' }}
          >
            {legalAreas.map((area) => (
              <optgroup key={area.id} label={area.name}>
                <option value={`area:${area.id}`}>{"Todos da \u00e1rea"}</option>
                {(standardTypesByArea[area.id] ?? []).map((t) => (
                  <option key={t.id} value={`type:${t.id}`}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            onClick={() => openLegalAreaModal()}
            className="pet-top-icon-btn is-soft"
            title={"Gerenciar \u00e1reas jur\u00eddicas"}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => openStandardTypeModal()}
            className="pet-top-icon-btn is-soft"
            title={"Gerenciar modelos (peti\u00e7\u00f5es padr\u00e3o)"}
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
          </div>
        )}

        {legalAreas.length === 0 && (
          <button
            onClick={() => openLegalAreaModal()}
            className="px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 border border-amber-200 rounded transition-colors flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            {"Criar \u00c1rea Jur\u00eddica"}
          </button>
        )}
      </div>

      <div className="pet-top-group is-right">
        {selectedClient && (
          <div className="pet-top-client-chip pet-top-shrink">
            <User className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="text-amber-700 font-medium truncate">{selectedClient.full_name}</span>
            <button
              onClick={() => insertClientQualification(selectedClient)}
              className="pet-top-icon-btn is-chip"
              title="Inserir qualificacao do cliente no documento"
              aria-label="Inserir qualificacao do cliente no documento"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { setSelectedClient(null); setHasUnsavedChanges(true); }}
              className="pet-top-icon-btn is-chip"
              title="Remover cliente vinculado"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {lastSaved && (
          <>
            <div className="pet-top-meta-chip flex sm:hidden items-center whitespace-nowrap">
              <span title={lastSaved.toLocaleString('pt-BR')}>Agora</span>
            </div>
            <div className="pet-top-meta-chip pet-top-shrink hidden sm:flex lg:hidden items-center gap-1 tabular-nums whitespace-nowrap">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span title={lastSaved.toLocaleString('pt-BR')}>{formatRelativeTime(lastSaved.toISOString())}</span>
            </div>
            <div className="pet-top-meta-chip pet-top-shrink hidden lg:flex items-center gap-1.5 min-w-[170px] justify-end tabular-nums whitespace-nowrap">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span title={lastSaved.toLocaleString('pt-BR')}>Atualizado {formatRelativeTime(lastSaved.toISOString())}</span>
            </div>
          </>
        )}

        <div className="pet-top-actionbar">
          <button
            onClick={() => newPetition({ keepClient: true })}
            className="pet-top-text-btn hidden sm:flex"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo
          </button>
          <button
            onClick={savePetition}
            disabled={savingDoc}
            className="pet-top-primary-btn"
          >
            {savingDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Salvar</span>
          </button>
          <button
            onClick={exportToWord}
            className="pet-top-text-btn hidden md:flex"
          >
            <Download className="w-3.5 h-3.5" />
            Word
          </button>
          <button
            onClick={loadDefaultTemplate}
            disabled={!hasDefaultTemplate}
            className="pet-top-text-btn hidden lg:flex disabled:opacity-50 disabled:hover:bg-transparent"
            title={hasDefaultTemplate ? `Carregar modelo padrão${defaultTemplateName ? `: ${defaultTemplateName}` : ''}` : 'Nenhum modelo padrão definido'}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {"Padrão"}
          </button>
          <button
            onClick={setCurrentDocAsDefaultTemplate}
            disabled={settingDefaultTemplate}
            className="pet-top-text-btn hidden lg:flex disabled:opacity-50 disabled:hover:bg-transparent"
            title="Definir o documento aberto como modelo padrão"
          >
            {settingDefaultTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Star className="w-3.5 h-3.5" />}
            Definir padrão
          </button>
        </div>

        <div className="pet-top-cluster is-utility">
        <button
          onClick={() => {
            if (isFloatingWidget) {
              onRequestMinimize?.();
              return;
            }
            setIsMinimized(true);
          }}
          className="pet-top-icon-btn"
          title="Minimizar"
        >
          <Minimize2 className="w-4 h-4" />
        </button>
        {!isFloatingWidget && (
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="pet-top-icon-btn"
            title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        )}
        <button
          onClick={() => {
            if (hasUnsavedChanges) {
              const what = [
                petitionTitle ? `Documento: "${petitionTitle}"` : '',
                selectedClient?.full_name ? `Cliente: ${selectedClient.full_name}` : '',
              ]
                .filter(Boolean)
                .join('\n');
              const msg = `Ha alteracoes nao salvas.${what ? `\n\n${what}` : ''}\n\nDeseja fechar mesmo assim?`;
              if (!confirm(msg)) return;
            }
            if (isFloatingWidget) {
              onRequestClose?.();
            } else {
              setIsMinimized(true);
            }
          }}
          className="pet-top-icon-btn is-danger"
          title="Fechar editor"
        >
          <XCircle className="w-4 h-4" />
        </button>
        </div>
      </div>
    </>
  );

  return (
    <div className={`${isFloatingWidget ? 'h-full' : 'h-screen'} relative flex flex-col overflow-hidden bg-[#f5f6f8]`}>
      {documentImportLoading && (
        <div className="absolute inset-0 z-[140] flex items-center justify-center bg-slate-950/35 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/10 p-6">
            <div className="flex items-center gap-4">
              <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold text-slate-900">Carregando documento...</div>
                <div className="mt-1 text-sm text-slate-600">Importando o arquivo no editor de peticoes e aplicando o vinculo do cliente da pasta.</div>
              </div>
            </div>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-amber-100">
              <div className="h-full w-1/2 rounded-full bg-amber-500 animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {/* Modal: Visualizar ConteÃºdo do Bloco */}
      {showBlockViewModal && viewingBlock && (
        <aside id="petition-editor-backdrop" className="fixed inset-0 z-[110] flex items-start justify-center p-2 sm:p-6 pt-8 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
          <main id="block-editor-modal" className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 w-full max-w-4xl max-h-[92vh] my-2 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-1 w-full shrink-0 bg-amber-500" />

            <header className="relative px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 leading-none">Visualizar Bloco</div>
                <div className="mt-1 flex items-center gap-2">
                  <h3 className="text-sm sm:text-base font-semibold text-slate-900 leading-tight">{viewingBlock.title}</h3>
                  {typeof viewingBlockMatchPct === 'number' && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold">
                      {viewingBlockMatchPct}%
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => {
                  blockViewDocxTokenRef.current += 1;
                  setShowBlockViewModal(false);
                  setViewingBlock(null);
                  setViewingBlockMatchPct(null);
                  setBlockViewFallbackText('');
                  setBlockViewUseFallback(false);
                  setBlockViewDocxError('');
                  setBlockViewDocxLoading(false);
                  if (blockViewDocxContainerRef.current) blockViewDocxContainerRef.current.innerHTML = '';
                }}
                className="absolute top-1.5 sm:top-2 right-1.5 sm:right-2 p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="p-4 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-[12px] font-medium text-slate-600 mb-2">Titulo do Bloco *</label>
                  <input
                    type="text"
                    value={viewingBlock.title}
                    readOnly
                    className="w-full px-3 py-2.5 text-sm border border-[#e7e5df] rounded-lg bg-slate-50 font-medium text-slate-600"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-2">Categoria</label>
                  <select
                    value={viewingBlock.category}
                    disabled
                    className="w-full px-3 py-2.5 text-sm border border-[#e7e5df] rounded-lg bg-slate-50 font-medium text-slate-600 cursor-not-allowed"
                  >
                    <option value={viewingBlock.category}>{getCategoryLabel(String(viewingBlock.category || 'outros'))}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1">Conteudo SFDT *</label>
                <div className="border border-[#e7e5df] rounded-2xl overflow-hidden bg-[#f8f7f5] shadow-inner">
                  <div className="relative w-full h-[620px] overflow-auto bg-[#f8f7f5] petition-block-docx-preview">
                    <div className="min-h-[620px] p-4">
                      <div
                        ref={(node) => {
                          blockViewDocxContainerRef.current = node;
                        }}
                      />
                    </div>

                    {blockViewDocxLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-[#f8f7f5]/80">
                        <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Carregando...</span>
                        </div>
                      </div>
                    )}

                    {!blockViewDocxLoading && blockViewDocxError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-[#f8f7f5]/80">
                        <div className="text-slate-500 text-sm font-medium">{blockViewDocxError}</div>
                      </div>
                    )}

                    {!blockViewDocxLoading && !blockViewDocxError && blockViewUseFallback && (
                      <div className="absolute inset-0 bg-[#f8f7f5]">
                        <div className="h-full w-full p-4 overflow-y-auto">
                          <pre className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">
                            {(() => {
                              const t = (blockViewFallbackText || '').trim();
                              if (!t) return 'Pre-visualizacao indisponivel';
                              if (t.startsWith('{') || t.startsWith('[')) return 'Pre-visualizacao indisponivel';
                              return t;
                            })()}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Variaveis disponiveis</span>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    [[NOME_CLIENTE]], [[CPF]], [[RG]], [[NACIONALIDADE]], [[ESTADO_CIVIL]], [[PROFISSAO]], [[ENDERECO]], [[CIDADE]], [[UF]], [[CEP]], [[EMAIL]], [[TELEFONE]]
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-3 sm:col-span-2 space-y-2">
                  <label className="block text-[12px] font-medium text-slate-600">Tags</label>
                  {(() => {
                    const tags = getBlockTagsForUI(viewingBlock);
                    if (tags.length === 0) {
                      return <p className="text-[11px] text-slate-400">Nenhuma tag cadastrada</p>;
                    }
                    return (
                      <div className="flex flex-wrap gap-2">
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[11px] font-medium rounded-md bg-slate-100 text-slate-700 border border-slate-200 max-w-[260px] truncate"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                  <p className="text-[11px] text-slate-400">Tags usadas para facilitar a busca de blocos.</p>
                </div>
              </div>

              <label className="group flex items-center gap-4 cursor-pointer p-3 bg-amber-50/50 rounded-xl border border-amber-100">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={viewingBlock.is_default}
                    disabled
                    className="peer w-5 h-5 text-amber-600 rounded-lg border-amber-300 focus:ring-amber-500 transition-all cursor-pointer appearance-none border-2 checked:bg-amber-500 opacity-60"
                  />
                  <CheckCircle2 className="w-3 h-3 text-white absolute left-1 opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" />
                </div>
                <div>
                  <span className="text-sm font-bold text-amber-900 uppercase tracking-tight">Incluir por padrao</span>
                  <p className="text-xs text-amber-700/70 font-medium">Este bloco sera inserido automaticamente ao criar uma nova peticao</p>
                </div>
              </label>
            </div>

            <footer className="px-4 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50 gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    // Abrir modal de ediçÃ£o com o bloco atual
                    if (viewingBlock) {
                      openBlockModal(viewingBlock);
                      setShowBlockViewModal(false);
                      setViewingBlock(null);
                      setViewingBlockMatchPct(null);
                      setBlockViewFallbackText('');
                      setBlockViewUseFallback(false);
                      setBlockViewDocxError('');
                      setBlockViewDocxLoading(false);
                      if (blockViewDocxContainerRef.current) blockViewDocxContainerRef.current.innerHTML = '';
                    }
                  }}
                  className="px-4 py-2.5 text-xs sm:text-sm font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 uppercase tracking-wider petition-btn-orange"
                >
                  <Edit3 className="w-4 h-4" />
                  <span>Editar</span>
                </button>
                <button
                  onClick={async () => {
                    if (!isOnlineRef.current) {
                      setError('Voce esta offline. O Peticionamento e 100% online: reconecte para editar/salvar.');
                      return;
                    }
                    await insertBlock(viewingBlock);
                    setShowBlockSearchModal(false);
                    blockViewDocxTokenRef.current += 1;
                    setShowBlockViewModal(false);
                    setViewingBlock(null);
                    setViewingBlockMatchPct(null);
                    setBlockViewFallbackText('');
                    setBlockViewUseFallback(false);
                    setBlockViewDocxError('');
                    setBlockViewDocxLoading(false);
                    if (blockViewDocxContainerRef.current) blockViewDocxContainerRef.current.innerHTML = '';
                  }}
                  className="px-6 py-2.5 text-xs sm:text-sm font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 uppercase tracking-wider petition-btn-orange"
                >
                  <Plus className="w-4 h-4" />
                  <span>Adicionar no documento</span>
                </button>
              </div>
              <button
                onClick={() => {
                  blockViewDocxTokenRef.current += 1;
                  setShowBlockViewModal(false);
                  setViewingBlock(null);
                  setViewingBlockMatchPct(null);
                  setBlockViewFallbackText('');
                  setBlockViewUseFallback(false);
                  setBlockViewDocxError('');
                  setBlockViewDocxLoading(false);
                  if (blockViewDocxContainerRef.current) blockViewDocxContainerRef.current.innerHTML = '';
                }}
                className="px-8 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200 bg-white rounded-xl transition-all duration-200 shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04]"
              >
                Fechar
              </button>
            </footer>
          </main>
        </aside>
      )}

      {/* ConteÃºdo Principal */}
      {activeWorkspace === 'blocks' ? (() => {
        const bmDefaultCount = filteredBlocks.filter((b) => b.is_default).length;
        const bmInactiveCount = blocks.filter((b) => !b.is_active && String((b.document_type || 'petition') as any) === String(selectedDocumentType)).length;
        const bmAllTags = new Set<string>();
        filteredBlocks.forEach((b) => { (blockIndexMap.get(b.id)?.tags ?? getBlockTagsForUI(b)).forEach((t) => bmAllTags.add(t)); });

        const bmSortedBlocks = bmSortBy === 'category' ? filteredBlocks : [...filteredBlocks].sort((a, b) => {
          if (bmSortBy === 'title') return a.title.localeCompare(b.title, 'pt-BR');
          if (bmSortBy === 'updated') return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
          return 0;
        });

        const bmRenderDocxPreview = async (blockId: string, sfdt: string) => {
          const container = bmPreviewContainersRef.current.get(blockId);
          if (!container) return;

          setBmDocxPreviews((prev) => { const n = new Map(prev); n.set(blockId, 'loading'); return n; });
          container.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:16px;color:#94a3b8;font-size:13px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Renderizando preview formatado...</div>';

          const ed = blockConvertEditorRef.current;
          if (!ed) {
            container.innerHTML = '<div style="padding:12px;color:#ef4444;font-size:12px">Editor nao disponivel</div>';
            setBmDocxPreviews((prev) => { const n = new Map(prev); n.set(blockId, 'error'); return n; });
            return;
          }

          try {
            const trimmed = sfdt.trim();
            const looksLikeSfdt = trimmed.startsWith('{') || trimmed.startsWith('[');
            if (looksLikeSfdt) { ed.loadSfdt(trimmed); } else { ed.clear(); if (trimmed) ed.insertText(trimmed); }

            await new Promise((r) => window.setTimeout(r, 100));
            ed.refresh?.();
            await new Promise((r) => window.setTimeout(r, 100));

            const blob = await ed.exportDocx('preview.docx');
            const arrayBuffer = await blob.arrayBuffer();

            const currentContainer = bmPreviewContainersRef.current.get(blockId);
            if (!currentContainer) return;
            currentContainer.innerHTML = '';

            await renderAsync(arrayBuffer, currentContainer, undefined, {
              className: 'docx-preview-inline',
              inWrapper: true,
              ignoreWidth: false,
              ignoreHeight: true,
              ignoreFonts: false,
              breakPages: false,
              ignoreLastRenderedPageBreak: true,
              experimental: false,
              trimXmlDeclaration: true,
              useBase64URL: true,
              renderHeaders: false,
              renderFooters: false,
              renderFootnotes: false,
              renderEndnotes: false,
            } as any);

            setBmDocxPreviews((prev) => { const n = new Map(prev); n.set(blockId, 'done'); return n; });
          } catch {
            const currentContainer = bmPreviewContainersRef.current.get(blockId);
            if (currentContainer) currentContainer.innerHTML = '<div style="padding:12px;color:#ef4444;font-size:12px">Falha ao renderizar preview formatado</div>';
            setBmDocxPreviews((prev) => { const n = new Map(prev); n.set(blockId, 'error'); return n; });
          }
        };

        const bmProcessQueue = async () => {
          if (bmPreviewBusyRef.current) return;
          const nextId = bmPreviewQueueRef.current.shift();
          if (!nextId) return;
          bmPreviewBusyRef.current = true;
          const block = filteredBlocks.find((b) => b.id === nextId);
          if (block) {
            await bmRenderDocxPreview(nextId, block.content);
          }
          bmPreviewBusyRef.current = false;
          if (bmPreviewQueueRef.current.length > 0) bmProcessQueue();
        };

        const bmQueuePreview = (blockId: string) => {
          if (bmDocxPreviews.get(blockId) === 'done' || bmDocxPreviews.get(blockId) === 'loading') return;
          if (!bmPreviewQueueRef.current.includes(blockId)) {
            bmPreviewQueueRef.current.push(blockId);
          }
          bmProcessQueue();
        };

        const bmToggleExpand = (id: string) => {
          setBmExpandedBlocks((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
              next.delete(id);
            } else {
              next.add(id);
              window.setTimeout(() => bmQueuePreview(id), 50);
            }
            return next;
          });
        };
        const bmExpandAll = () => {
          const ids = filteredBlocks.map((b) => b.id);
          setBmExpandedBlocks(new Set(ids));
          window.setTimeout(() => { ids.forEach((id) => bmQueuePreview(id)); }, 100);
        };
        const bmCollapseAll = () => setBmExpandedBlocks(new Set());

        const bmToggleCategory = (cat: string) => {
          setBmCollapsedCategories((prev) => {
            const next = new Set(prev);
            if (next.has(cat)) next.delete(cat); else next.add(cat);
            return next;
          });
        };

        const bmCopyPlainText = (text: string) => {
          navigator.clipboard.writeText(text).then(() => {
            showSuccessMessage('Texto copiado');
          }).catch(() => {});
        };

        const renderBlockCard = (block: PetitionBlock) => {
          const idx = blockIndexMap.get(block.id);
          const plain = idx?.plain ?? sfdtToPlainText(block.content);
          const tags = idx?.tags ?? getBlockTagsForUI(block, plain);
          const isExpanded = bmExpandedBlocks.has(block.id);
          const previewLength = 180;
          const summaryText = plain.slice(0, previewLength) + (plain.length > previewLength ? '...' : '');
          const updatedDate = block.updated_at ? new Date(block.updated_at) : null;
          const docxStatus = bmDocxPreviews.get(block.id);

          const headerRow = (compact?: boolean) => (
            <div className={`flex items-center gap-2 ${compact ? '' : 'flex-wrap'}`}>
              <h4 className={`font-semibold text-slate-900 ${compact ? 'text-sm leading-snug line-clamp-2' : 'text-sm'}`}>{block.title}</h4>
              {block.is_default && (
                <span className={`inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 font-bold ${compact ? 'p-1' : 'px-2 py-0.5 text-[10px]'}`} title="Bloco padrao">
                  <Star className="w-3 h-3" />{!compact && ' Padrao'}
                </span>
              )}
              {!block.is_active && (
                <span className={`inline-flex items-center rounded-full bg-red-50 border border-red-200 text-red-600 font-bold ${compact ? 'p-1' : 'px-2 py-0.5 text-[10px]'}`} title="Inativo">
                  {compact ? <XCircle className="w-3 h-3" /> : 'Inativo'}
                </span>
              )}
              {!compact && updatedDate && (
                <span className="text-[10px] text-slate-400 ml-auto flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {updatedDate.toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>
          );

          const tagsRow = (maxTags: number) => tags.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-2">
              {tags.slice(0, maxTags).map((tag) => (
                <span key={tag} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-slate-100 text-[11px] font-medium text-slate-700 border border-slate-200">
                  <Hash className="w-2.5 h-2.5 text-amber-500" />{tag}
                </span>
              ))}
              {tags.length > maxTags && (
                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-medium text-slate-500">+{tags.length - maxTags}</span>
              )}
            </div>
          ) : null;

          const docxPreviewContainer = (
            <div
              ref={(el) => {
                bmPreviewContainersRef.current.set(block.id, el);
                if (el && isExpanded && !docxStatus) {
                  window.setTimeout(() => bmQueuePreview(block.id), 30);
                }
              }}
              className="bm-docx-preview-container overflow-auto bg-[#f8f7f5] rounded-lg border border-[#e7e5df] shadow-inner"
              style={{ maxHeight: 500, minHeight: 80 }}
            />
          );

          if (bmViewMode === 'grid') {
            return (
              <div key={block.id} className="group bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-200 transition-all duration-200 flex flex-col overflow-hidden">
                <div className="p-4 flex-1 flex flex-col">
                  {headerRow(true)}

                  <div className="flex-1 min-h-0 mt-2">
                    {isExpanded ? (
                      docxPreviewContainer
                    ) : (
                      <div className="text-xs text-slate-600 leading-relaxed line-clamp-4">
                        {summaryText || <span className="italic text-slate-400">Sem conteudo</span>}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => bmToggleExpand(block.id)}
                      className="mt-2 text-[11px] font-semibold text-amber-600 hover:text-amber-700 flex items-center gap-0.5"
                    >
                      {isExpanded ? <><ChevronUp className="w-3 h-3" /> Recolher</> : <><Eye className="w-3 h-3" /> Ver formatado</>}
                    </button>
                  </div>

                  {!isExpanded && tagsRow(4)}

                  {!isExpanded && updatedDate && (
                    <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {updatedDate.toLocaleDateString('pt-BR')}
                    </div>
                  )}
                </div>

                <div className="px-4 py-2.5 bg-slate-50/60 border-t border-slate-100 flex items-center gap-1.5">
                  <button type="button" onClick={() => openBlockModal(block)} className="flex-1 px-2 py-1.5 text-[12px] font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors flex items-center justify-center gap-1">
                    <Edit3 className="w-3 h-3" /> Editar
                  </button>
                  <button type="button" onClick={() => bmCopyPlainText(plain)} className="px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-white transition-colors" title="Copiar texto">
                    <Copy className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={() => { void deleteBlock(block.id); }} className="px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-slate-200 text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors" title="Excluir">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div key={block.id} className="group bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-200 transition-all duration-200 overflow-hidden">
              <div className="px-5 py-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    {headerRow(false)}

                    {/* Preview area */}
                    <div className="mt-3">
                      {isExpanded ? (
                        <div className="rounded-xl overflow-hidden border border-[#e7e5df]">
                          <div className="bg-slate-50 px-3 py-2 border-b border-[#e7e5df] flex items-center justify-between">
                            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5" /> Preview formatado
                            </span>
                            <button type="button" onClick={() => bmToggleExpand(block.id)}
                              className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 flex items-center gap-0.5">
                              <ChevronUp className="w-3.5 h-3.5" /> Recolher
                            </button>
                          </div>
                          {docxPreviewContainer}
                        </div>
                      ) : (
                        <div className="p-3.5 bg-slate-50 border border-[#e7e5df]/80 rounded-xl">
                          <div className="text-[13px] text-slate-600 leading-relaxed line-clamp-3">
                            {summaryText || <span className="italic text-slate-400">Sem conteudo</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => bmToggleExpand(block.id)}
                            className="mt-2 text-[11px] font-semibold text-amber-600 hover:text-amber-700 flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" /> Ver conteudo formatado (Word)
                          </button>
                        </div>
                      )}
                    </div>

                    {tagsRow(10)}
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button type="button" onClick={() => openBlockModal(block)} className="px-3 py-1.5 text-[12px] font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors flex items-center gap-1.5" title="Editar">
                      <Edit3 className="w-3.5 h-3.5" /> Editar
                    </button>
                    <button type="button" onClick={() => bmCopyPlainText(plain)} className="px-3 py-1.5 text-[12px] font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1.5" title="Copiar texto">
                      <Copy className="w-3.5 h-3.5" /> Copiar
                    </button>
                    <button type="button" onClick={() => { void deleteBlock(block.id); }} className="px-3 py-1.5 text-[12px] font-medium rounded-lg border border-slate-200 text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors flex items-center gap-1.5" title="Excluir">
                      <Trash2 className="w-3.5 h-3.5" /> Excluir
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        };

        return (
        <div className="flex-1 overflow-hidden bg-slate-50">
          <div className="h-full overflow-y-auto">
            <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-4">

              {/* Stats Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl border border-slate-200 p-3.5 flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                    <Layers className="w-[18px] h-[18px] text-amber-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[22px] font-semibold leading-none text-slate-900 tabular-nums">{filteredBlocks.length}</div>
                    <div className="mt-1 text-[12px] text-slate-500">Blocos visiveis</div>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-3.5 flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                    <BarChart3 className="w-[18px] h-[18px] text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[22px] font-semibold leading-none text-slate-900 tabular-nums">{sidebarCategoryKeys.length}</div>
                    <div className="mt-1 text-[12px] text-slate-500">Categorias</div>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-3.5 flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                    <Star className="w-[18px] h-[18px] text-emerald-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[22px] font-semibold leading-none text-slate-900 tabular-nums">{bmDefaultCount}</div>
                    <div className="mt-1 text-[12px] text-slate-500">Padroes</div>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-3.5 flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-500/10">
                    <Hash className="w-[18px] h-[18px] text-slate-500" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[22px] font-semibold leading-none text-slate-900 tabular-nums">{bmAllTags.size}</div>
                    <div className="mt-1 text-[12px] text-slate-500">Tags unicas</div>
                  </div>
                </div>
              </div>

              {/* Filters + Actions Bar */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="p-4 flex flex-col xl:flex-row xl:items-center gap-3">
                  {/* Search */}
                  <div className="relative flex-1 min-w-0 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar por titulo, tags ou conteudo..."
                      value={blockSearch}
                      onChange={(e) => setBlockSearch(e.target.value)}
                      className="w-full pl-9 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500/25 focus:border-amber-400 bg-slate-50 focus:bg-white transition-colors"
                    />
                    {blockSearch && (
                      <button type="button" onClick={() => setBlockSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Filters inline */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={selectedDocumentType}
                      onChange={(e) => setSelectedDocumentType(e.target.value as DocumentType)}
                      className="px-3 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg bg-white hover:border-slate-300 focus:ring-2 focus:ring-amber-500/25 focus:border-amber-400"
                    >
                      <option value="petition">Peticao</option>
                      <option value="contestation">Contestacao</option>
                      <option value="impugnation">Impugnacao</option>
                      <option value="appeal">Recurso</option>
                    </select>

                    <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                      {selectedStandardTypeId && (
                        <button type="button" onClick={() => setBlockFilterScope('type')}
                          className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${blockFilterScope === 'type' ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-white'}`}>
                          Peticao
                        </button>
                      )}
                      <button type="button" onClick={() => setBlockFilterScope('area')}
                        className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${blockFilterScope === 'area' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}>
                        Area
                      </button>
                      <button type="button" onClick={() => setBlockFilterScope('global')}
                        className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${blockFilterScope === 'global' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}>
                        Global
                      </button>
                    </div>

                    <div className="h-5 w-px bg-slate-200" />

                    <select
                      value={bmSortBy}
                      onChange={(e) => setBmSortBy(e.target.value as any)}
                      className="px-3 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg bg-white hover:border-slate-300 focus:ring-2 focus:ring-amber-500/25 focus:border-amber-400"
                      title="Ordenar por"
                    >
                      <option value="category">Por categoria</option>
                      <option value="title">Por titulo A-Z</option>
                      <option value="updated">Mais recentes</option>
                    </select>

                    <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                      <button type="button" onClick={() => setBmViewMode('list')} title="Lista"
                        className={`p-1.5 rounded-lg transition-colors ${bmViewMode === 'list' ? 'bg-[#f8f7f5] text-amber-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                        <List className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => setBmViewMode('grid')} title="Grade"
                        className={`p-1.5 rounded-lg transition-colors ${bmViewMode === 'grid' ? 'bg-[#f8f7f5] text-amber-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                        <LayoutGrid className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-auto">
                    <button type="button" onClick={bmExpandAll}
                      className="px-3 py-2 text-[12px] font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1.5" title="Expandir todos">
                      <ChevronsUpDown className="w-3.5 h-3.5" /> Expandir
                    </button>
                    <button type="button" onClick={bmCollapseAll}
                      className="px-3 py-2 text-[12px] font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1.5" title="Recolher todos">
                      <ChevronUp className="w-3.5 h-3.5" /> Recolher
                    </button>
                    <button type="button" onClick={() => { ensureDraftFromCategories(blockCategories); setShowCategoryModal(true); }}
                      className="px-3 py-2 text-[12px] font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1.5">
                      <Settings className="w-3.5 h-3.5" /> Categorias
                    </button>
                    <button type="button" onClick={() => openBlockModal()}
                      className="px-4 py-2 text-[12px] font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 shadow-sm shadow-amber-500/30 transition-colors flex items-center gap-1.5">
                      <Plus className="w-4 h-4" /> Novo bloco
                    </button>
                  </div>
                </div>

                {/* Standard Types pills */}
                {standardTypes.length > 0 && selectedLegalAreaId && (
                  <div className="px-4 pb-4 pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Modelo:</span>
                      <button type="button" onClick={() => { setSelectedStandardTypeId(null); setBlockFilterScope('area'); }}
                        className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors ${!selectedStandardTypeId ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-[#f8f7f5] border-[#e7e5df] text-slate-600 hover:bg-slate-50'}`}>
                        {selectedLegalArea?.name || 'Area'}
                      </button>
                      {standardTypes.map((t) => (
                        <button key={t.id} type="button"
                          onClick={() => { setSelectedStandardTypeId(t.id); setBlockFilterScope('type'); if (t.default_document && editorRef.current) { editorRef.current.loadSfdt(t.default_document); if (t.default_document_name) setPetitionTitle(sanitizeText(t.default_document_name)); } }}
                          className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors ${selectedStandardTypeId === t.id ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-[#f8f7f5] border-[#e7e5df] text-slate-600 hover:bg-blue-50/40'}`}>
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Active filters breadcrumb */}
              {(blockSearch || blockFilterScope !== 'area' || selectedStandardTypeId) && (
                <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-medium">Filtros:</span>
                  {blockSearch && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 font-medium">
                      Busca: "{blockSearch}"
                      <button type="button" onClick={() => setBlockSearch('')} className="hover:text-amber-900"><X className="w-3 h-3" /></button>
                    </span>
                  )}
                  {blockFilterScope === 'global' && (
                    <span className="inline-flex items-center px-2 py-1 rounded-lg bg-slate-100 border border-[#e7e5df] text-slate-600 font-medium">Global</span>
                  )}
                  {blockFilterScope === 'type' && selectedStandardTypeId && (
                    <span className="inline-flex items-center px-2 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 font-medium">
                      Peticao padrao
                    </span>
                  )}
                  {selectedLegalArea && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-medium" style={{ backgroundColor: (selectedLegalArea.color || '#f97316') + '10', borderColor: (selectedLegalArea.color || '#f97316') + '40', color: selectedLegalArea.color || '#f97316' }}>
                      <Scale className="w-3 h-3" /> {selectedLegalArea.name}
                    </span>
                  )}
                </div>
              )}

              {/* Block List / Grid */}
              {filteredBlocks.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-14 text-center">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-slate-100 flex items-center justify-center">
                    <FileText className="w-7 h-7 text-slate-400" />
                  </div>
                  <div className="text-base font-semibold text-slate-800">Nenhum bloco encontrado</div>
                  <div className="text-sm text-slate-500 mt-1.5 max-w-md mx-auto">Tente ajustar os filtros, alterar o escopo ou o tipo de documento.</div>
                  <button type="button" onClick={() => openBlockModal()}
                    className="mt-5 px-5 py-2.5 text-sm font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors inline-flex items-center gap-2">
                    <Plus className="w-4 h-4" /> Criar primeiro bloco
                  </button>
                </div>
              ) : bmSortBy !== 'category' ? (
                bmViewMode === 'grid' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {bmSortedBlocks.map(renderBlockCard)}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {bmSortedBlocks.map(renderBlockCard)}
                  </div>
                )
              ) : (
                <div className="space-y-4">
                  {sidebarCategoryKeys.map((category) => {
                    const items = (blocksByCategory as Record<string, PetitionBlock[]>)[category] || [];
                    if (items.length === 0) return null;
                    const isCatCollapsed = bmCollapsedCategories.has(category);
                    return (
                      <section key={category} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <button
                          type="button"
                          onClick={() => bmToggleCategory(category)}
                          className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
                              <Layers className="w-4 h-4 text-amber-600" />
                            </div>
                            <div className="text-left">
                              <h3 className="text-sm font-semibold text-slate-900">{getCategoryLabel(category)}</h3>
                              <p className="text-[11px] text-slate-500">{items.length} bloco{items.length !== 1 ? 's' : ''}</p>
                            </div>
                          </div>
                          {isCatCollapsed ? <ChevronRight className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                        </button>

                        {!isCatCollapsed && (
                          bmViewMode === 'grid' ? (
                            <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                              {items.map(renderBlockCard)}
                            </div>
                          ) : (
                            <div className="px-4 pb-4 space-y-3">
                              {items.map(renderBlockCard)}
                            </div>
                          )
                        )}
                      </section>
                    );
                  })}
                </div>
              )}

            </div>
          </div>
        </div>
        );
      })() : (
      <>
      {/* Input oculto para importar DOCX */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx"
        className="hidden"
        onChange={handleImportTemplate}
      />

      {/* Faixa de opçÃµes (ribbon) estilo Word */}
      <PetitionRibbon
        editorRef={editorRef}
        ready={editorReady}
        topContent={ribbonTopContent}
        onNew={() => { editorRef.current?.clear?.(); setHasUnsavedChanges(true); }}
        onOpen={() => fileInputRef.current?.click()}
        onSave={() => { void savePetition(); }}
        onExportDocx={() => { void exportToWord(); }}
      />

      <div className="flex-1 flex min-w-0 max-w-full overflow-hidden relative">
        {/* Sidebar — overlay no mobile, inline no desktop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-[30] bg-black/40 sm:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {sidebarOpen && (
          <div className="fixed sm:relative inset-y-0 left-0 z-[31] sm:z-[20] flex flex-col flex-shrink-0 border-r border-[#ddd7cd] bg-[#f7f3ec] shadow-[inset_-1px_0_0_rgba(255,255,255,0.65)]" style={{ width: Math.min(sidebarWidth, typeof window !== 'undefined' ? window.innerWidth * 0.85 : sidebarWidth) }}>
            {/* Tabs */}
            <div className="flex items-end gap-1 border-b border-[#ddd7cd] bg-[#f3eee5] px-2 pt-2">
              <button
                onClick={() => setSidebarTab('blocks')}
                className={`flex-1 rounded-t-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  sidebarTab === 'blocks'
                    ? 'border border-[#ddd7cd] border-b-transparent bg-[#fbfaf8] text-[#c0531f]'
                    : 'text-slate-500 hover:bg-[#f8f4ee] hover:text-slate-700'
                }`}
              >
                Blocos
              </button>
              <button
                onClick={() => setSidebarTab('clients')}
                className={`flex-1 rounded-t-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  sidebarTab === 'clients'
                    ? 'border border-[#ddd7cd] border-b-transparent bg-[#fbfaf8] text-[#c0531f]'
                    : 'text-slate-500 hover:bg-[#f8f4ee] hover:text-slate-700'
                }`}
              >
                Clientes
              </button>
            </div>

            {/* Tab: Blocos */}
            {sidebarTab === 'blocks' && (
              <>
                <div className="border-b border-[#e6dfd3] bg-[#fbfaf8] p-2.5">
                  <div className="flex gap-1.5 items-center">
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar bloco..."
                      value={blockSearch}
                      onChange={(e) => setBlockSearch(e.target.value)}
                      className="w-full rounded-lg border border-[#ddd7cd] bg-white pl-8 pr-2 py-2 text-xs text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] focus:border-amber-400 focus:ring-1 focus:ring-amber-300"
                    />
                  </div>
                  <select
                    value={selectedDocumentType}
                    onChange={(e) => setSelectedDocumentType(e.target.value as DocumentType)}
                    className="w-[110px] shrink-0 rounded-lg border border-[#ddd7cd] bg-white px-2 py-2 text-xs text-slate-700 focus:border-amber-400 focus:ring-1 focus:ring-amber-300"
                    title="Tipo de documento"
                  >
                    <option value="petition">Peticao</option>
                    <option value="contestation">Contestacao</option>
                    <option value="impugnation">Impugnacao</option>
                    <option value="appeal">Recurso</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      ensureDraftFromCategories(blockCategories);
                      setShowCategoryModal(true);
                    }}
                    className="shrink-0 rounded-lg border border-[#ddd7cd] bg-white p-2 text-slate-500 transition hover:bg-[#f7f1e7] hover:text-[#c0531f]"
                    title="Configurar categorias"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openBlockModal()}
                    className="shrink-0 rounded-lg bg-[#ff9f0a] p-2 text-white shadow-sm transition-colors hover:bg-[#f08c00]"
                    title="Novo bloco"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                </div>

                {/* Filtro de escopo de blocos */}
                <div className="flex items-center gap-2 border-b border-[#e6dfd3] bg-[#fbfaf8] px-2 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Exibir:</span>
                  <div className="flex flex-1 gap-1 rounded-xl border border-[#e4ddcf] bg-[#f3eee5] p-1">
                    {selectedStandardTypeId && (
                      <button
                        onClick={() => setBlockFilterScope('type')}
                        className={`flex-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                          blockFilterScope === 'type'
                            ? 'bg-[#2f6fa8] text-white shadow-sm'
                            : 'text-slate-600 hover:bg-white'
                        }`}
                        title="Blocos vinculados a peticao padrao selecionada"
                      >
                        Peticao
                      </button>
                    )}
                    <button
                      onClick={() => setBlockFilterScope('area')}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                        blockFilterScope === 'area'
                          ? 'bg-[#ff9f0a] text-white shadow-sm'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                      title="Blocos da area juridica selecionada"
                    >
                      Area
                    </button>
                    <button
                      onClick={() => setBlockFilterScope('global')}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                        blockFilterScope === 'global'
                          ? 'bg-slate-700 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                      title="Todos os blocos (consulta global)"
                    >
                      Global
                    </button>
                  </div>
                </div>

                {standardTypes.length > 0 && selectedLegalAreaId && (
                  <div className="border-b border-[#e6dfd3] bg-[#fbfaf8] px-2 py-2">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1">
                        <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider">Modelos</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openStandardTypeModal()}
                        className="rounded-lg border border-[#ddd7cd] bg-white p-1.5 text-slate-500 transition hover:bg-[#f7f1e7] hover:text-[#c0531f]"
                        title="Gerenciar modelos"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStandardTypeId(null);
                          setBlockFilterScope('area');
                        }}
                        className={`w-full rounded-xl px-2.5 py-2 text-left text-xs border transition-colors ${
                          !selectedStandardTypeId
                            ? 'bg-amber-50 border-amber-200 text-amber-800 shadow-[inset_0_0_0_1px_rgba(255,159,10,0.08)]'
                            : 'bg-white border-[#ddd7cd] text-slate-700 hover:bg-[#f8f4ee]'
                        }`}
                        title="Ver todos os blocos da area"
                      >
                        <span className="font-semibold">Area</span>
                        {selectedLegalArea?.name ? <span className="text-slate-400"> - {selectedLegalArea.name}</span> : null}
                      </button>

                      <div className="max-h-36 overflow-y-auto pr-0.5">
                        {standardTypes.map((t) => {
                          const active = selectedStandardTypeId === t.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => {
                                setSelectedStandardTypeId(t.id);
                                setBlockFilterScope('type');
                                if (t.default_document && editorRef.current) {
                                  editorRef.current.loadSfdt(t.default_document);
                                  if (t.default_document_name) setPetitionTitle(sanitizeText(t.default_document_name));
                                }
                              }}
                              className={`mt-1 w-full rounded-xl px-2.5 py-2 text-left text-xs border transition-colors ${
                                active
                                  ? 'bg-blue-50 border-blue-200 text-blue-800 shadow-[inset_0_0_0_1px_rgba(47,111,168,0.08)]'
                                  : 'bg-white border-[#ddd7cd] text-slate-700 hover:bg-[#f4f7fb]'
                              }`}
                              title={t.description ? t.description : t.name}
                            >
                              <div className="flex items-center gap-1">
                                <FileText className="w-3.5 h-3.5 text-slate-400" />
                                <span className="font-semibold truncate">{t.name}</span>
                                {active && <ChevronLeft className="w-3.5 h-3.5 ml-auto text-blue-400" />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto bg-[#fffdfa]">
                  {sidebarCategoryKeys.map((category) => {
                    const items = (blocksByCategory as any)[category] || [];
                    if (items.length === 0) return null;
                    const isExpanded = expandedCategories.has(category);
                    return (
                      <div key={category} className="border-b border-[#ece5d9]">
                        <button
                          onClick={() => toggleCategory(category)}
                          className="flex w-full items-center gap-1 px-3 py-3 text-left text-[13px] font-semibold text-slate-700 transition hover:bg-[#f8f2e8]"
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          {getCategoryLabel(category)}
                          <span className="ml-auto text-[11px] font-semibold text-[#8ca1c1]">({items.length})</span>
                        </button>

                        {isExpanded && (
                          <div className="space-y-1 px-2 pb-2">
                            {(items as PetitionBlock[]).map((block: PetitionBlock) => (
                              <div
                                key={block.id}
                                className="group cursor-pointer rounded-xl border border-transparent bg-white px-2.5 py-2.5 transition-colors hover:border-[#efd8b5] hover:bg-[#fff7eb]"
                                onClick={() => openViewBlock(block)}
                              >
                                <div className="flex items-center gap-1">
                                  <span className="flex-1 truncate text-[13px] font-medium text-slate-700">{block.title}</span>
                                  {block.is_default && <Star className="w-2.5 h-2.5 text-amber-400" />}
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openBlockModal(block); }}
                                      className="rounded p-0.5 hover:bg-amber-100"
                                      title="Editar bloco"
                                    >
                                      <Edit3 className="w-2.5 h-2.5 text-amber-600" />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openViewBlock(block); }}
                                      className="rounded p-0.5 hover:bg-slate-100"
                                      title="Visualizar bloco"
                                    >
                                      <Eye className="w-2.5 h-2.5 text-slate-500" />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); void deleteBlock(block.id); }}
                                      className="rounded p-0.5 hover:bg-red-100"
                                      title="Excluir bloco"
                                    >
                                      <Trash2 className="w-2.5 h-2.5 text-red-500" />
                                    </button>
                                  </div>
                                </div>
                                {(() => {
                                  const tags = getBlockTagsForUI(block);
                                  if (!tags.length) return null;
                                  const visible = tags.slice(0, 5);
                                  const remaining = tags.length - visible.length;
                                  return (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {visible.map((t) => (
                                        <span key={t} className="inline-flex max-w-[140px] items-center truncate rounded-md border border-[#e5ddd0] bg-[#f6f1e8] px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                          {t}
                                        </span>
                                      ))}
                                      {remaining > 0 && (
                                        <span className="inline-flex items-center rounded-md border border-[#e5ddd0] bg-[#f6f1e8] px-2 py-0.5 text-[10px] font-medium text-slate-500">
                                          +{remaining}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Tab: Clientes */}
            {sidebarTab === 'clients' && (
              <>
                <div className="border-b border-[#e6dfd3] bg-[#fbfaf8] p-2.5">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar cliente..."
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      className="w-full rounded-lg border border-[#ddd7cd] bg-white pl-8 pr-2 py-2 text-xs text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] focus:border-amber-400 focus:ring-1 focus:ring-amber-300"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-[#fffdfa]">
                  {filteredClients.length === 0 ? (
                    <div className="p-4 text-center text-slate-400">
                      <Users className="w-8 h-8 mx-auto mb-2" />
                      <p className="text-xs">Nenhum cliente encontrado</p>
                    </div>
                  ) : (
                    filteredClients.map(client => (
                      <div
                        key={client.id}
                        className={`group cursor-pointer border-b border-[#ece5d9] px-3 py-3 transition-colors ${
                          selectedClient?.id === client.id ? 'bg-[#fff4df]' : 'hover:bg-[#f8f2e8]'
                        }`}
                        onClick={() => selectClientForPetition(client)}
                      >
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
                            <User className="w-3.5 h-3.5 text-amber-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-[13px] font-medium text-slate-700">{client.full_name}</p>
                            <p className="text-[10px] text-slate-400">{client.cpf_cnpj}</p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              insertClientQualification(client);
                            }}
                            className="rounded-md border border-amber-200 bg-white px-2 py-1 text-[10px] font-semibold text-amber-700 opacity-0 shadow-sm transition group-hover:opacity-100 hover:bg-amber-50"
                            title="Inserir qualificacao no documento"
                          >
                            Inserir
                          </button>
                          {selectedClient?.id === client.id && (
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">Selecionado</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

          </div>
        )}

        {/* Splitter — oculto no mobile */}
        {sidebarOpen && (
          <div
            className="hidden sm:block w-1 flex-shrink-0 bg-slate-200 hover:bg-amber-400 cursor-col-resize"
            onMouseDown={(e) => {
              isResizingSidebarRef.current = true;
              sidebarResizeStartXRef.current = e.clientX;
              sidebarResizeStartWidthRef.current = sidebarWidth;
              e.preventDefault();
            }}
          />
        )}

        {/* Area do Editor Syncfusion */}
        <div
          className="syncfusion-editor-wrapper relative flex-1 min-w-0 flex flex-col overflow-hidden"
          style={{ flex: '1 1 0%', minWidth: 0, width: '100%' }}
        >
          {/* Banner de conexao: internet caiu ou servidor inacessivel */}
          {(!isOnline || !serverReachable) && (
            <div className="absolute top-0 inset-x-0 z-[55] p-3 pointer-events-none">
              <div className={`pointer-events-auto mx-auto max-w-3xl overflow-hidden rounded-2xl border bg-[#fffdf7] shadow-[0_18px_45px_rgba(180,120,10,0.20)] animate-in fade-in slide-in-from-top-2 duration-300 ${reconnectFailed ? 'border-red-300/80 petition-shake' : 'border-amber-200/80'}`}>
                <div className={`h-1 w-full bg-gradient-to-r ${reconnectFailed ? 'from-red-400 via-red-500 to-red-400' : 'from-amber-400 via-orange-500 to-amber-400'} ${(checkingServer || isRetrying) ? 'petition-progress-stripes' : ''}`} />
                <div className="flex items-start gap-3 p-4">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <CloudOff className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600">Conexao instavel</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                        <span className={`w-1.5 h-1.5 rounded-full bg-amber-500 ${(checkingServer || isRetrying) ? 'animate-ping' : 'animate-pulse'}`} />
                        {(checkingServer || isRetrying) ? 'Verificando...' : 'Offline'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-sm font-bold text-slate-900">
                      {!isOnline ? 'Voce esta sem internet' : 'Sem conexao com o servidor'}
                    </div>
                    <p className="mt-1 text-[13px] text-slate-600 leading-relaxed">
                      Suas alteracoes podem <span className="font-semibold">nao estar sendo salvas</span>. Baixe uma copia em Word agora para nao perder nada — assim que a conexao voltar, o salvamento normaliza.
                    </p>
                    {reconnectFailed && (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-red-600 animate-in fade-in slide-in-from-left-1 duration-200">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        Ainda sem conexao. Verifique sua internet e tente novamente.
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={exportToWord}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-bold rounded-xl transition-all shadow-md petition-btn-orange"
                      >
                        <Download className="w-4 h-4" />
                        Baixar em Word
                      </button>
                      <button
                        type="button"
                        onClick={handleRetryConnection}
                        disabled={isRetrying}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-bold rounded-xl transition-all shadow-sm petition-btn-slate disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
                        {isRetrying ? 'Reconectando...' : 'Tentar reconectar'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Overlay de formataçÃ£o com IA */}
          {formattingWithAI && (
            <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="bg-[#f8f7f5] rounded-2xl border border-[#e7e5df] shadow-2xl p-8 max-w-xs w-full mx-4">
                <div className="flex flex-col items-center text-center space-y-4">
                  {/* Ãcone animado */}
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center">
                      <div className="w-8 h-8 text-white">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                          <path d="M21 12a9 9 0 11-6.219-8.56"/>
                        </svg>
                      </div>
                    </div>
                    {/* AnÃ©is de onda */}
                    <div className="absolute inset-0 rounded-full border-2 border-orange-400/30 animate-ping"></div>
                    <div className="absolute inset-0 rounded-full border-2 border-orange-400/20 animate-ping" style={{ animationDelay: '200ms' }}></div>
                  </div>
                  
                  {/* Texto */}
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-slate-900">Formatando com IA</h3>
                    <p className="text-sm text-slate-600">Aplicando formatacao inteligente...</p>
                  </div>
                  
                  {/* Dots animados */}
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce"></div>
                    <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: '100ms' }}></div>
                    <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: '200ms' }}></div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <SyncfusionEditor
            ref={editorRef}
            id="petition-main-editor"
            height="100%"
            readOnly={!isOnline}
            enableToolbar={false}
            showPropertiesPane={false}
            showNavigationPane={false}
            onReady={() => {
              setEditorReady(true);
              // Recalcula o layout apÃ³s o wrapper assumir a largura final (evita folha comprimida)
              window.setTimeout(() => editorRef.current?.refresh?.(), 60);
              window.setTimeout(() => editorRef.current?.refresh?.(), 320);
            }}
            onContentChange={handleContentChange}
            onRequestInsertBlock={() => {
              setBlockSearchQuery('');
              setBlockSearchScope(
                blockFilterScope === 'type'
                  ? selectedStandardTypeId
                    ? 'type'
                    : 'area'
                  : blockFilterScope
              );
              setShowBlockSearchModal(true);
            }}
            onRequestCompanyLookup={() => {
              openCompanyLookup();
            }}
            onRequestCreateBlockFromSelection={(selectedText, selectedSfdt) => {
              openCreateBlockFromSelection(selectedText || '', selectedSfdt || '');
            }}
            onRequestFormatQualification={handleFormatQualification}
          />

        </div>

        </div>
      </>
      )}

      {/* Hidden editor for DOCX conversion - always available */}
      <div style={{ position: 'fixed', left: -10000, top: -10000, width: 1, height: 1, overflow: 'hidden' }}>
        <SyncfusionEditor
          ref={blockConvertEditorRef}
          id="petition-block-converter"
          height="1px"
          readOnly
          enableToolbar={false}
          showPropertiesPane={false}
          showRuler={false}
          showNavigationPane={false}
          removeMargins
        />
      </div>

      {/* Modal de Busca de Empresa (CNPJ) */}
      {showCompanyLookupModal && (
        <aside id="petition-lookup-backdrop" className="fixed inset-0 z-[100] flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
          <main id="company-lookup-modal" className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 w-full max-w-xl my-4 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-1 w-full shrink-0 bg-amber-500" />

            <header className="relative px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400 leading-none">Qualificacao Juridica</div>
                <h3 className="mt-2 text-base sm:text-lg font-semibold text-slate-900 leading-tight">Buscar Empresa (CNPJ)</h3>
              </div>
              <button
                onClick={() => setShowCompanyLookupModal(false)}
                className="absolute top-2 sm:top-4 right-2 sm:right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="px-6 py-6 space-y-6">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-2">Informe o CNPJ</label>
                <input
                  type="text"
                  value={companyCnpjInput}
                  onChange={(e) => setCompanyCnpjInput(e.target.value)}
                  placeholder="00.000.000/0000-00"
                  className="w-full px-4 py-3 text-sm border border-[#e7e5df] rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-slate-50 transition-all font-medium placeholder:text-slate-300"
                  autoFocus
                />
                <p className="mt-2 text-[11px] text-slate-400 italic">Aceita CNPJ com ponto, barra e hifen. O sistema considera apenas numeros.</p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleCompanyLookup}
                  disabled={companyLookupLoading}
                  className="flex-1 font-bold px-4 py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md petition-btn-orange"
                >
                  {companyLookupLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Consultando...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>Consultar CNPJ</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowCompanyLookupModal(false)}
                  className="px-6 py-3 text-sm font-bold rounded-xl transition-all shadow-md petition-btn-slate"
                >
                  <span>Cancelar</span>
                </button>
              </div>

              {companyLookupResultText && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                  <label className="block text-[11px] font-medium text-slate-500 mb-2">Resultado da Qualificacao</label>
                  <textarea
                    value={companyLookupResultText}
                    onChange={(e) => setCompanyLookupResultText(e.target.value)}
                    rows={6}
                    className="w-full px-4 py-3 text-sm border border-[#e7e5df] rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 bg-[#f8f7f5] transition-all leading-relaxed text-slate-700 font-medium"
                  />
                </div>
              )}
            </div>

            <footer className="px-6 py-5 border-t border-slate-100 flex justify-end bg-slate-50">
              <button
                onClick={insertCompanyText}
                disabled={!companyLookupResultText}
                className="w-full sm:w-auto font-bold px-10 py-3.5 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 uppercase tracking-wider text-xs petition-btn-emerald"
              >
                <Plus className="w-5 h-5" />
                <span>Inserir no documento</span>
              </button>
            </footer>
          </main>
        </aside>
      )}

      {/* Modal de Busca de Bloco */}
      {showBlockSearchModal && (
        <aside id="petition-search-backdrop" className="fixed inset-0 z-[100] flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/50 backdrop-blur-sm overflow-y-auto">
          <main id="block-search-modal" className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 w-full max-w-3xl my-4 overflow-hidden flex flex-col mx-auto">
            <div className="h-1 w-full shrink-0 bg-amber-500" />

            <header className="px-5 sm:px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3 bg-white">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                  <Layers className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400 leading-none">Biblioteca de textos</div>
                  <h3 className="mt-1 text-base font-semibold text-slate-900 leading-tight">Adicionar bloco</h3>
                </div>
              </div>
              <button
                onClick={() => setShowBlockSearchModal(false)}
                className="shrink-0 p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="px-5 sm:px-6 py-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[12px] font-medium text-slate-500">Escopo</div>
                <div className="inline-flex items-center p-0.5 rounded-lg border border-slate-200 bg-slate-50">
                  {selectedStandardTypeId && (
                    <button
                      type="button"
                      onClick={() => setBlockSearchScope('type')}
                      className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                        blockSearchScope === 'type'
                          ? 'bg-amber-500 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                      title="Buscar apenas nos blocos vinculados a Peticao Padrao"
                    >
                      Peticao
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setBlockSearchScope('area')}
                    className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                      blockSearchScope === 'area'
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-white'
                    }`}
                    title="Buscar nos blocos da Area Juridica selecionada"
                  >
                    Area
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlockSearchScope('global')}
                    className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                      blockSearchScope === 'global'
                        ? 'bg-slate-700 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-white'
                    }`}
                    title="Buscar em todos os blocos (consulta global)"
                  >
                    Global
                  </button>
                </div>
              </div>

              <div className="relative mt-3">
                <Search className="w-[18px] h-[18px] text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar bloco..."
                  value={blockSearchQuery}
                  onChange={(e) => setBlockSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500/25 focus:border-amber-400 bg-slate-50 focus:bg-white transition"
                  autoFocus
                />
              </div>

              <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
                <div className="max-h-[65vh] overflow-y-auto">
                  {blockSearchLoading ? (
                    <div className="p-6 text-center text-slate-400">
                      <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin" />
                      <p className="text-sm">Carregando blocos...</p>
                    </div>
                  ) : searchFilteredBlocks.length === 0 ? (
                    <div className="p-6 text-center text-slate-400">
                      <FileText className="w-10 h-10 mx-auto mb-2" />
                      <p className="text-sm">Nenhum bloco encontrado</p>
                    </div>
                  ) : (
                    searchFilteredBlocks.map((item: BlockSearchResult) => {
                      const b = item.block;
                      const matchPct = item.matchPct;
                      const showMatchPct = Boolean((blockSearchQuery || '').trim());
                      const area = b.legal_area_id ? legalAreas.find((a) => a.id === b.legal_area_id) : null;
                      return (
                      <div
                        key={b.id}
                        className="px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer transition-colors"
                        onClick={() => {
                          openViewBlock(b, showMatchPct ? matchPct : undefined);
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-slate-800">{b.title}</span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">
                            {getCategoryLabel(String(b.category || 'outros'))}
                          </span>
                          {blockSearchScope === 'global' && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded border font-bold"
                              style={{
                                backgroundColor: (area?.color ? `${area.color}20` : '#e2e8f0'),
                                borderColor: area?.color || '#cbd5e1',
                                color: area?.color || '#475569',
                              }}
                              title={area?.name ? `Area Juridica: ${area.name}` : 'Area Juridica: Sem area'}
                            >
                              {area?.name || 'Sem area'}
                            </span>
                          )}
                          {showMatchPct && (
                            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold">
                              {matchPct}%
                            </span>
                          )}
                          {b.is_default && <Star className="w-3 h-3 text-amber-400" />}
                        </div>
                        {(() => {
                          const tags = blockIndexMap.get(b.id)?.tags ?? getBlockTagsForUI(b);
                          if (!tags.length) return null;
                          const visible = tags.slice(0, 6);
                          const remaining = tags.length - visible.length;
                          return (
                            <div className="flex flex-wrap gap-1.5 mb-1.5">
                              {visible.map((t) => (
                                <span
                                  key={t}
                                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium max-w-[180px] truncate"
                                >
                                  <Hash className="w-2.5 h-2.5 text-amber-500" />{t}
                                </span>
                              ))}
                              {remaining > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-medium">
                                  +{remaining}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        <p className="text-xs text-slate-500 line-clamp-4">
                          {(() => {
                            const plain = blockIndexMap.get(b.id)?.plain ?? sfdtToPlainText(b.content);
                            const t = (plain || '').trim();
                            if (!t) return '-';
                            if (t.startsWith('{') || t.startsWith('[')) return 'Pre-visualizacao indisponivel';
                            return t.length > 280 ? `${t.substring(0, 280)}...` : t;
                          })()}
                        </p>
                      </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </main>
        </aside>
      )}

      {showAiEditModal && (
        <aside className="fixed inset-0 z-[110] flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
          <main className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 w-full max-w-3xl my-4 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-1 w-full shrink-0 bg-amber-500" />

            <header className="relative px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400 leading-none">IA no documento</div>
                <h3 className="mt-2 text-base sm:text-lg font-semibold text-slate-900 leading-tight">Editar selecao com IA</h3>
                <div className="mt-1 text-xs text-slate-500">A IA usa os blocos como base de conhecimento para refinar o trecho selecionado.</div>
              </div>
              <button
                onClick={() => setShowAiEditModal(false)}
                className="absolute top-2 sm:top-4 right-2 sm:right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="px-6 py-6 space-y-6">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-2">Instrucao para a IA</label>
                <textarea
                  value={aiEditInstruction}
                  onChange={(e) => setAiEditInstruction(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-3 text-sm border border-[#e7e5df] rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 bg-slate-50 transition-all leading-relaxed text-slate-700 font-medium"
                  placeholder="Ex.: Reescreva esse trecho com linguagem mais tecnica, mais objetiva e com melhor conexao logica, sem mudar o pedido."
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-2">Trecho selecionado</label>
                <div className="w-full px-4 py-3 text-sm border border-[#e7e5df] rounded-xl bg-[#f8f7f5] text-slate-700 leading-relaxed whitespace-pre-wrap max-h-[240px] overflow-y-auto">
                  {aiEditSelectedText}
                </div>
              </div>
            </div>

            <footer className="px-6 py-5 border-t border-slate-100 flex flex-col sm:flex-row justify-end gap-3 bg-slate-50">
              <button
                onClick={() => setShowAiEditModal(false)}
                className="w-full sm:w-auto px-6 py-3 text-sm font-bold rounded-xl transition-all shadow-md petition-btn-slate"
              >
                Cancelar
              </button>
              <button
                onClick={handleApplyAiEdit}
                disabled={formattingWithAI}
                className="w-full sm:w-auto font-bold px-8 py-3 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 petition-btn-orange disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {formattingWithAI ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                <span>Aplicar edicao no documento</span>
              </button>
            </footer>
          </main>
        </aside>
      )}

      {showCategoryModal && (
        <aside id="petition-categories-backdrop" className="fixed inset-0 z-[110] flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
          <main id="petition-categories-modal" className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 w-full max-w-2xl my-4 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-1 w-full shrink-0 bg-amber-500" />

            <header className="relative px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400 leading-none">Categorias</div>
                <h3 className="mt-2 text-base sm:text-lg font-semibold text-slate-900 leading-tight">Configurar categorias</h3>
                <div className="mt-1 text-xs text-slate-500">Tipo: {selectedDocumentType}</div>
              </div>
              <button
                onClick={() => setShowCategoryModal(false)}
                className="absolute top-2 sm:top-4 right-2 sm:right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="flex justify-between items-center">
                <div className="text-xs text-slate-500">Edite nome e ordem. A ordem de cima para baixo e a ordem na sidebar.</div>
                <button
                  type="button"
                  onClick={() => {
                    const nextOrder = categoryDraft.length;
                    setCategoryDraft((prev) => [...prev, { key: '', label: '', order: nextOrder }]);
                  }}
                  className="px-3 py-2 text-xs font-bold rounded-lg petition-btn-orange"
                >
                  <span>Adicionar</span>
                </button>
              </div>

              <div className="border border-[#e7e5df] rounded-xl overflow-hidden">
                {categoryDraft.length === 0 ? (
                  <div className="p-4 text-center text-slate-400 text-sm">Nenhuma categoria</div>
                ) : (
                  categoryDraft
                    .slice()
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map((c, idx) => (
                      <div key={`${c.key}-${idx}`} className="p-4 border-b border-slate-100 last:border-b-0">
                        <div className="grid grid-cols-12 gap-3 items-center">
                          <div className="col-span-3">
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">Key</label>
                            <input
                              value={c.key}
                              onChange={(e) => {
                                const v = e.target.value;
                                setCategoryDraft((prev) => {
                                  const ordered = prev.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                                  ordered[idx] = { ...ordered[idx], key: v };
                                  return ordered.map((x, i) => ({ ...x, order: i }));
                                });
                              }}
                              placeholder="ex: preliminares"
                              className="w-full px-3 py-2 text-xs border border-[#e7e5df] rounded-lg bg-slate-50"
                            />
                          </div>
                          <div className="col-span-6">
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">Nome</label>
                            <input
                              value={c.label}
                              onChange={(e) => {
                                const v = e.target.value;
                                setCategoryDraft((prev) => {
                                  const ordered = prev.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                                  ordered[idx] = { ...ordered[idx], label: v };
                                  return ordered.map((x, i) => ({ ...x, order: i }));
                                });
                              }}
                              placeholder="ex: Preliminares"
                              className="w-full px-3 py-2 text-xs border border-[#e7e5df] rounded-lg bg-slate-50"
                            />
                          </div>
                          <div className="col-span-3 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setCategoryDraft((prev) => {
                                  const ordered = prev.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                                  if (idx <= 0) return ordered;
                                  const tmp = ordered[idx - 1];
                                  ordered[idx - 1] = ordered[idx];
                                  ordered[idx] = tmp;
                                  return ordered.map((x, i) => ({ ...x, order: i }));
                                });
                              }}
                              className="px-2 py-2 text-xs border border-[#e7e5df] rounded-lg hover:bg-slate-50"
                              title="Mover para cima"
                            >
                              â†‘
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCategoryDraft((prev) => {
                                  const ordered = prev.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                                  if (idx >= ordered.length - 1) return ordered;
                                  const tmp = ordered[idx + 1];
                                  ordered[idx + 1] = ordered[idx];
                                  ordered[idx] = tmp;
                                  return ordered.map((x, i) => ({ ...x, order: i }));
                                });
                              }}
                              className="px-2 py-2 text-xs border border-[#e7e5df] rounded-lg hover:bg-slate-50"
                              title="Mover para baixo"
                            >
                              â†“
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCategoryDraft((prev) => {
                                  const ordered = prev.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                                  const filtered = ordered.filter((_, i) => i !== idx);
                                  return filtered.map((x, i) => ({ ...x, order: i }));
                                });
                              }}
                              className="px-2 py-2 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
                              title="Remover"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>

            <footer className="px-6 py-5 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
              <button
                type="button"
                onClick={() => setShowCategoryModal(false)}
                className="px-6 py-2.5 text-sm font-bold rounded-xl transition-all shadow-md petition-btn-slate"
              >
                <span>Cancelar</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const normalized = categoryDraft
                      .slice()
                      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                      .map((c, i) => {
                        const key = String(c.key || '')
                          .trim()
                          .toLowerCase()
                          .replace(/\s+/g, '_')
                          .replace(/[^a-z0-9_\-]/g, '');
                        return { ...c, key, order: i };
                      })
                      .filter((c) => Boolean(c.key) && Boolean(String(c.label || '').trim()));

                    await petitionEditorService.upsertBlockCategories(selectedDocumentType, normalized, blockCategories);
                    const cats = await petitionEditorService.listBlockCategories(selectedDocumentType);
                    setBlockCategories(cats);
                    ensureDraftFromCategories(cats);
                    setShowCategoryModal(false);
                    showSuccessMessage('Categorias atualizadas');
                  } catch {
                    setError('Erro ao salvar categorias');
                  }
                }}
                className="font-bold px-8 py-2.5 rounded-xl transition-all shadow-md flex items-center gap-2 petition-btn-orange"
              >
                <Save className="w-4 h-4" />
                <span>Salvar</span>
              </button>
            </footer>
          </main>
        </aside>
      )}

      {/* Modal de Areas JurÃ­dicas */}
      {showLegalAreaModal && (
        <aside id="legal-area-backdrop" className="fixed inset-0 z-[120] flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
          <main id="legal-area-modal" className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 w-full max-w-lg my-4 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-2 w-full shrink-0" style={{ backgroundColor: editingLegalArea?.color || legalAreaFormData.color || '#f97316' }} />

            <header className="relative px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400 leading-none">Areas Juridicas</div>
                <h3 className="mt-2 text-base sm:text-lg font-semibold text-slate-900 leading-tight">
                  {editingLegalArea ? 'Editar Area' : 'Nova Area Juridica'}
                </h3>
              </div>
              <button
                onClick={() => setShowLegalAreaModal(false)}
                className="absolute top-2 sm:top-4 right-2 sm:right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-2">Nome da Area *</label>
                <input
                  type="text"
                  value={legalAreaFormData.name}
                  onChange={(e) => setLegalAreaFormData({ ...legalAreaFormData, name: e.target.value })}
                  placeholder="Ex: Trabalhista, Civel, Penal..."
                  className="w-full px-4 py-3 text-sm border border-[#e7e5df] rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 transition-all font-medium bg-slate-50"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-2">Descricao (opcional)</label>
                <textarea
                  value={legalAreaFormData.description}
                  onChange={(e) => setLegalAreaFormData({ ...legalAreaFormData, description: e.target.value })}
                  placeholder="Ex: Direito do Trabalho - CLT, Justica do Trabalho"
                  rows={2}
                  className="w-full px-4 py-3 text-sm border border-[#e7e5df] rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 transition-all font-medium bg-slate-50 resize-none"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-2">Cor de Identificacao</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={legalAreaFormData.color}
                    onChange={(e) => setLegalAreaFormData({ ...legalAreaFormData, color: e.target.value })}
                    className="w-12 h-10 rounded-lg border border-[#e7e5df] cursor-pointer"
                  />
                  <div className="flex gap-2">
                    {['#f97316', '#3b82f6', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4'].map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setLegalAreaFormData({ ...legalAreaFormData, color })}
                        className={`w-8 h-8 rounded-lg border-2 transition-all ${legalAreaFormData.color === color ? 'border-slate-900 scale-110' : 'border-transparent hover:scale-105'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Lista de areas existentes */}
              {legalAreas.length > 0 && !editingLegalArea && (
                <div className="pt-4 border-t border-[#e7e5df]">
                  <label className="block text-[12px] font-medium text-slate-600 mb-3">Areas Cadastradas</label>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {legalAreas.map((area) => (
                      <div
                        key={area.id}
                        className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-[#e7e5df]"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-8 rounded" style={{ backgroundColor: area.color }} />
                          <div>
                            <div className="text-sm font-semibold text-slate-700">{area.name}</div>
                            {area.description && (
                              <div className="text-xs text-slate-500">{area.description}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openLegalAreaModal(area)}
                            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="Editar"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Desativar a area "${area.name}"? Os blocos vinculados a ela ficarao disponiveis para todas as areas.`)) {
                                handleDeleteLegalArea(area.id);
                              }
                            }}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Desativar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <footer className="px-6 py-5 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
              <button
                type="button"
                onClick={() => setShowLegalAreaModal(false)}
                className="px-6 py-2.5 text-sm font-bold rounded-xl transition-all shadow-md petition-btn-slate"
              >
                <span>Cancelar</span>
              </button>
              <button
                type="button"
                onClick={handleSaveLegalArea}
                disabled={saving || !legalAreaFormData.name.trim()}
                className="font-bold px-8 py-2.5 rounded-xl transition-all shadow-md flex items-center gap-2 petition-btn-orange disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{editingLegalArea ? 'Atualizar' : 'Criar Area'}</span>
              </button>
            </footer>
          </main>
        </aside>
      )}

      {/* Modal de PetiçÃµes Padroes */}
      {showStandardTypeModal && (
        <aside className="fixed inset-0 z-[120] flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
          <main className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 w-full max-w-lg my-4 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-1 w-full shrink-0 bg-amber-500" />
            <header className="relative px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400 leading-none">Peticoes Padrao</div>
                  <h3 className="mt-1 text-base sm:text-lg font-semibold text-slate-900 leading-tight">
                    {editingStandardType ? 'Editar Peticao Padrao' : 'Nova Peticao Padrao'}
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setShowStandardTypeModal(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="p-6 space-y-5">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-2">Nome *</label>
                <input
                  type="text"
                  value={standardTypeFormData.name}
                  onChange={(e) => setStandardTypeFormData({ ...standardTypeFormData, name: e.target.value })}
                  placeholder="Ex: Auxilio-acidente, BPC, Aposentadoria..."
                  className="w-full px-4 py-3 text-sm border border-[#e7e5df] rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 transition-all font-medium bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-2">Descricao</label>
                <textarea
                  value={standardTypeFormData.description}
                  onChange={(e) => setStandardTypeFormData({ ...standardTypeFormData, description: e.target.value })}
                  placeholder="Descricao opcional..."
                  rows={2}
                  className="w-full px-4 py-3 text-sm border border-[#e7e5df] rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 transition-all font-medium bg-slate-50 resize-none"
                />
              </div>

              {/* Area vinculada */}
              <div className="p-3 bg-slate-50 rounded-xl border border-[#e7e5df]">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Scale className="w-4 h-4" />
                  <span>Area Juridica:</span>
                  <span className="font-bold text-slate-700">{selectedLegalArea?.name || 'Nenhuma'}</span>
                </div>
              </div>

              {/* Documento padrao vinculado */}
              {editingStandardType && (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-amber-700">
                      <FileText className="w-4 h-4" />
                      <span>Documento padrao:</span>
                      <span className="font-bold">
                        {editingStandardType.default_document_name || 'Nenhum vinculado'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleSetDefaultDocument(editingStandardType.id)}
                      disabled={saving}
                      className="px-2 py-1 text-[10px] bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors disabled:opacity-50"
                      title="Vincular o documento atual do editor como padrao"
                    >
                      {saving ? 'Salvando...' : 'Vincular Atual'}
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-amber-600">
                    Ao selecionar esta peticao padrao, o documento vinculado sera carregado automaticamente.
                  </p>
                </div>
              )}

              {/* Lista de petiçÃµes padrÃµes cadastradas */}
              <div className="pt-4 border-t border-[#e7e5df]">
                <label className="block text-[12px] font-medium text-slate-600 mb-3">
                  Peticoes Padrao de "{selectedLegalArea?.name}"
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {standardTypes.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">Nenhuma peticao padrao cadastrada</p>
                  ) : (
                    standardTypes.map((type) => (
                      <div
                        key={type.id}
                        className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-[#e7e5df]"
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-amber-500" />
                          <div>
                            <span className="text-sm font-medium text-slate-700">{type.name}</span>
                            {type.default_document_name && (
                              <span className="ml-2 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                                {type.default_document_name}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openStandardTypeModal(type)}
                            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="Editar"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteStandardType(type.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Excluir"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <footer className="px-6 py-5 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
              <button
                type="button"
                onClick={() => setShowStandardTypeModal(false)}
                className="px-6 py-2.5 text-sm font-bold rounded-xl transition-all shadow-md petition-btn-slate"
              >
                <span>Cancelar</span>
              </button>
              <button
                type="button"
                onClick={handleSaveStandardType}
                disabled={saving || !standardTypeFormData.name.trim()}
                className="font-bold px-8 py-2.5 rounded-xl transition-all shadow-md flex items-center gap-2 petition-btn-orange disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{editingStandardType ? 'Atualizar' : 'Criar'}</span>
              </button>
            </footer>
          </main>
        </aside>
      )}

      {showBlockModal && (
        <aside id="petition-editor-backdrop" className="fixed inset-0 z-[999999] flex flex-col bg-white">
          <main id="block-editor-modal" className="flex flex-col flex-1 overflow-hidden">
            {/* App bar do editor */}
            <header className="shrink-0 h-14 px-3 flex items-center gap-3 border-b border-slate-200 bg-white">
              <button
                onClick={() => setShowBlockModal(false)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                title="Voltar sem salvar"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="h-7 w-px bg-slate-200" />
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                <FileText className="w-[18px] h-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="ml-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 leading-none">
                  {editingBlock ? 'Editar bloco' : 'Novo bloco'}
                </div>
                <input
                  type="text"
                  value={blockFormData.title}
                  onChange={(e) => setBlockFormData({ ...blockFormData, title: e.target.value })}
                  placeholder="Titulo do bloco"
                  className="mt-0.5 w-full max-w-xl bg-transparent px-1.5 py-0.5 -ml-1.5 text-[15px] font-semibold text-slate-900 placeholder:text-slate-300 rounded-md outline-none transition hover:bg-slate-100 focus:bg-white focus:ring-2 focus:ring-amber-500/30"
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setShowBlockModal(false)}
                  className="px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveBlock}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 shadow-sm shadow-amber-500/30 transition"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>{editingBlock || updateExistingBlockMode ? 'Atualizar' : 'Criar'}</span>
                    </>
                  )}
                </button>
              </div>
            </header>

            {/* Propriedades do bloco */}
            <div className="shrink-0 px-4 py-2.5 border-b border-slate-200 bg-slate-50/70 flex items-center gap-5 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-medium text-slate-500 whitespace-nowrap">Categoria</label>
                <select
                  value={blockFormData.category}
                  onChange={(e) => setBlockFormData({ ...blockFormData, category: e.target.value as BlockCategory })}
                  className="px-2.5 py-1.5 text-[13px] text-slate-700 border border-slate-200 rounded-lg bg-white hover:border-slate-300 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition cursor-pointer"
                >
                  {categoryKeysOrdered.map((key) => (
                    <option key={key} value={key}>{getCategoryLabel(key)}</option>
                  ))}
                </select>
              </div>

              {legalAreas.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-medium text-slate-500 whitespace-nowrap">Area</label>
                  <select
                    value={(blockFormData.legal_area_id ?? selectedLegalAreaId ?? '') as any}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      setBlockFormData({ ...blockFormData, legal_area_id: v as any });
                      if (v && blockStandardTypeId) {
                        const types = standardTypesByArea[String(v)] ?? [];
                        if (!types.some((t) => t.id === blockStandardTypeId)) {
                          setBlockStandardTypeId(null);
                        }
                      }
                    }}
                    className="px-2.5 py-1.5 text-[13px] text-slate-700 border border-slate-200 rounded-lg bg-white hover:border-slate-300 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition cursor-pointer"
                  >
                    {legalAreas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {legalAreas.length > 0 && (standardTypesByArea[String(blockFormData.legal_area_id ?? selectedLegalAreaId ?? '')] ?? []).length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-medium text-slate-500 whitespace-nowrap">Modelo</label>
                  <select
                    value={(blockFilterScope === 'type' && selectedStandardTypeId ? selectedStandardTypeId : (blockStandardTypeId || '')) as any}
                    onChange={(e) => {
                      if (blockFilterScope === 'type' && selectedStandardTypeId) return;
                      const v = e.target.value || null;
                      setBlockStandardTypeId(v as any);
                      const found = Object.values(standardTypesByArea).flat().find((t) => t.id === v) || null;
                      if (found?.legal_area_id) {
                        setBlockFormData((prev) => ({ ...prev, legal_area_id: found.legal_area_id as any }));
                      }
                    }}
                    disabled={blockStandardTypeLoading || (blockFilterScope === 'type' && Boolean(selectedStandardTypeId))}
                    className="px-2.5 py-1.5 text-[13px] text-slate-700 border border-slate-200 rounded-lg bg-white hover:border-slate-300 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition cursor-pointer disabled:opacity-60"
                  >
                    <option value="">Sem modelo</option>
                    {(standardTypesByArea[String(blockFormData.legal_area_id ?? selectedLegalAreaId ?? '')] ?? []).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="ml-auto flex items-center gap-2.5">
                {!editingBlock && (
                  <label className="flex items-center gap-2 cursor-pointer px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition">
                    <input
                      type="checkbox"
                      checked={updateExistingBlockMode}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setUpdateExistingBlockMode(checked);
                        if (!checked) setUpdateExistingBlockId('');
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500/40 cursor-pointer"
                    />
                    <span className="text-[12px] font-medium text-slate-600 whitespace-nowrap">Atualizar existente</span>
                  </label>
                )}

                {updateExistingBlockMode && !editingBlock && (
                  <select
                    value={updateExistingBlockId}
                    onChange={(e) => setUpdateExistingBlockId(e.target.value)}
                    className="px-2.5 py-1.5 text-[13px] text-slate-700 border border-slate-200 rounded-lg bg-white hover:border-slate-300 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition cursor-pointer w-48"
                  >
                    <option value="">Selecione o bloco</option>
                    {updatableBlocks.map((b) => (
                      <option key={b.id} value={b.id}>{b.title}</option>
                    ))}
                  </select>
                )}

                <label className="flex items-center gap-2 cursor-pointer px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100/70 transition">
                  <input
                    type="checkbox"
                    checked={blockFormData.is_default}
                    onChange={(e) => setBlockFormData({ ...blockFormData, is_default: e.target.checked })}
                    className="w-4 h-4 rounded border-amber-300 text-amber-500 focus:ring-amber-500/40 cursor-pointer"
                  />
                  <span className="text-[12px] font-medium text-amber-700 whitespace-nowrap">Padrao</span>
                </label>
              </div>
            </div>

            {/* Editor - ocupa todo o espaço restante */}
            <div className="flex-1 min-h-0 flex flex-col">
              <SyncfusionEditor
                ref={blockEditorRef}
                id="petition-block-editor"
                height="100%"
                showPropertiesPane
                enableToolbar
                enableCustomContextMenu
                showRuler
                showNavigationPane={false}
                layoutType="Pages"
                pageFit="FitPageWidth"
                removeMargins={false}
              />
            </div>

            {/* Barra de status */}
            <footer className="shrink-0 h-10 px-4 border-t border-slate-200 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-2 min-w-0 text-[11px] text-slate-400">
                <Hash className="w-3.5 h-3.5 shrink-0 text-slate-300" />
                <span className="truncate">
                  <span className="font-semibold text-slate-500">Variaveis:</span> [[NOME_CLIENTE]], [[CPF]], [[RG]], [[ENDERECO]], [[CIDADE]], [[UF]]...
                </span>
              </div>
              {editingBlock && (
                <button
                  onClick={() => { deleteBlock(editingBlock.id); setShowBlockModal(false); }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-lg text-red-600 hover:bg-red-50 transition shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Excluir</span>
                </button>
              )}
            </footer>
          </main>
        </aside>
      )}
    </div>
  );
};

// Estilos injetados para vencer regras globais do index.css
const petitionModalStyles = `
  /* BotÃµes dos modais de petiçÃ£o â€” flat, consistentes, sem caixa alta */
  .petition-btn-orange, .petition-btn-emerald, .petition-btn-slate, .petition-btn-red {
    text-transform: none !important;
    letter-spacing: normal !important;
    font-weight: 600 !important;
    border-radius: 8px !important;
    box-shadow: none !important;
    opacity: 1 !important;
    transition: background-color .15s ease, border-color .15s ease, color .15s ease !important;
  }
  .petition-btn-orange { background-color: #f59e0b !important; color: #ffffff !important; }
  .petition-btn-orange:hover { background-color: #d97706 !important; }
  .petition-btn-emerald { background-color: #059669 !important; color: #ffffff !important; }
  .petition-btn-emerald:hover { background-color: #047857 !important; }
  .petition-btn-slate { background-color: #f1f5f9 !important; color: #334155 !important; border: 1px solid #e2e8f0 !important; }
  .petition-btn-slate:hover { background-color: #e2e8f0 !important; }
  .petition-btn-red { background-color: #dc2626 !important; color: #ffffff !important; }
  .petition-btn-red:hover { background-color: #b91c1c !important; }

  /* Feedback do banner de conexao: shake ao falhar a reconexao */
  @keyframes petitionShake {
    0%, 100% { transform: translateX(0); }
    15% { transform: translateX(-7px); }
    30% { transform: translateX(6px); }
    45% { transform: translateX(-5px); }
    60% { transform: translateX(4px); }
    75% { transform: translateX(-2px); }
  }
  .petition-shake { animation: petitionShake 0.5s cubic-bezier(.36,.07,.19,.97) both; }

  /* Barra superior "viva" enquanto tenta reconectar */
  @keyframes petitionStripes {
    from { background-position: 0 0; }
    to { background-position: 28px 0; }
  }
  .petition-progress-stripes {
    background-image: linear-gradient(115deg, rgba(255,255,255,0.55) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0.55) 75%, transparent 75%);
    background-size: 28px 28px;
    animation: petitionStripes 0.7s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .petition-shake, .petition-progress-stripes { animation: none !important; }
  }

  /* Garantir que o painel do modal nÃ£o seja sequestrado */
  main#company-lookup-modal,
  main#block-search-modal,
  main#block-editor-modal {
    background-color: #ffffff !important;
    color: #0f172a !important;
  }

  /* docx-preview (view do bloco) - restaurar espaçamento de parÃ¡grafos e quebras */
  .petition-block-docx-preview .docx-wrapper,
  .petition-block-docx-preview .docx-wrapper * {
    box-sizing: border-box;
  }
  .petition-block-docx-preview .docx-wrapper > section.docx {
    background: #ffffff !important;
    margin: 16px auto !important;
    box-shadow: 0 12px 40px rgba(15, 23, 42, 0.16) !important;
    border: 1px solid #e2e8f0 !important;
  }
  .petition-block-docx-preview .docx-wrapper p {
    display: block !important;
    white-space: normal !important;
    margin: 0 0 12pt 0 !important;
  }
  .petition-block-docx-preview .docx-wrapper br {
    display: block !important;
    content: '' !important;
    margin-top: 12pt !important;
  }
`;

if (typeof document !== 'undefined' && !document.getElementById('petition-modal-isolation')) {
  const style = document.createElement('style');
  style.id = 'petition-modal-isolation';
  style.innerHTML = petitionModalStyles;
  document.head.appendChild(style);
}

// Estilos especÃ­ficos do editor de blocos (Syncfusion) para largura total e folha A4 centrada
const blockEditorModalStyles = `
  #petition-block-editor {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    height: 100% !important;
    border: none;
    border-radius: 0;
    overflow: hidden;
    background: #fff;
  }
  #petition-block-editor .e-documenteditorcontainer {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    height: 100% !important;
  }
  #petition-block-editor .e-de-ctn,
  #petition-block-editor .e-de-ctnr {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    background: #fff !important;
  }
  #petition-block-editor .e-de-ctnr .e-de-status-bar {
    display: none !important;
  }
  #petition-block-editor .e-de-ctnr .e-de-ctnr-inner {
    max-width: 100% !important;
  }
  #petition-block-editor .e-de-page-container {
    width: 100% !important;
    max-width: 100% !important;
    display: flex !important;
    justify-content: center !important;
    align-items: flex-start !important;
    padding: 28px 12px !important;
    box-sizing: border-box !important;
    overflow: auto !important;
    background: #eef1f5 !important;
  }
  #petition-block-editor .e-de-page {
    width: 595px !important; /* ~210mm */
    min-height: 842px !important; /* ~297mm */
    box-shadow: 0 12px 40px rgba(15, 23, 42, 0.16) !important;
    border: 1px solid #e2e8f0 !important;
    margin: 0 auto !important;
    background: #fff !important;
  }
  #petition-block-editor .e-de-editor {
    min-height: 820px !important;
  }
  #petition-block-editor .e-de-ctnr .e-scrollbar::-webkit-scrollbar {
    height: 8px;
    width: 8px;
  }
  #petition-block-editor .e-de-ctnr .e-scrollbar::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 8px;
  }
  #petition-block-editor .e-de-ctnr .e-scrollbar::-webkit-scrollbar-track {
    background: #f8fafc;
  }
`;

if (typeof document !== 'undefined' && !document.getElementById('petition-block-editor-styles')) {
  const style = document.createElement('style');
  style.id = 'petition-block-editor-styles';
  style.innerHTML = blockEditorModalStyles;
  document.head.appendChild(style);
}

export default PetitionEditorModule;



