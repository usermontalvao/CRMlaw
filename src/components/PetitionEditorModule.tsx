// Editor de Petições Trabalhistas - Syncfusion DocumentEditor v4
// Módulo isolado - pode ser removido sem afetar outros módulos

declare global {
  interface Window {
    __autoSaving?: boolean;
  }
}
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
  AlertCircle,
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
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { petitionEditorService } from '../services/petitionEditor.service';
import { aiService } from '../services/ai.service';
import type {
  PetitionBlock,
  CreatePetitionBlockDTO,
  SavedPetition,
  BlockCategory,
  DocumentType,
  PetitionBlockCategory,
} from '../types/petitionEditor.types';
import type { Client } from '../types/client.types';
import { useAuth } from '../contexts/AuthContext';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { supabase } from '../config/supabase';
import SyncfusionEditor, { SyncfusionEditorRef } from './SyncfusionEditor';

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
    { re: /\bacumulo de funcao\b|\bacumul[oó] de fun[cç][aã]o\b/i, tag: 'acumulo de funcao' },
    { re: /\baviso previo\b.*\bcumprid[oa]\b|\baviso pr[eé]vio\b.*\bcumprid[oa]\b/i, tag: 'aviso previo cumprido' },
    { re: /\bdispensad[oa]\b.*\bsem justa causa\b|\bsem justa causa\b/i, tag: 'dispensa sem justa causa' },
    { re: /\bcontrato de trabalho\b/i, tag: 'contrato de trabalho' },
    { re: /\badmiss[aã]o\b|\bcontratad[oa]\b/i, tag: 'admissao' },
    { re: /\bdispensad[oa]\b|\bdesligament[oó]\b/i, tag: 'dispensa' },
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
    'à',
    'às',
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
  cabecalho: 'Cabeçalho',
  qualificacao: 'DAS QUESTÕES INICIAIS',
  fatos: 'Dos Fatos',
  direito: 'Do Direito',
  pedidos: 'Dos Pedidos',
  citacao: 'Citação',
  encerramento: 'Encerramento',
  outros: 'Outros',
};

const MARITAL_STATUS_LABELS: Record<string, string> = {
  solteiro: 'solteiro(a)',
  casado: 'casado(a)',
  divorciado: 'divorciado(a)',
  viuvo: 'viúvo(a)',
  uniao_estavel: 'em união estável',
};

const SIDEBAR_WIDTH_STORAGE_KEY = 'petition-editor-sidebar-width';
const DEFAULT_TEMPLATE_STORAGE_KEY = 'petition-editor-default-template-docx-v1';

// CSS para o editor - Layout responsivo para 100% zoom
const EDITOR_STYLES = `
  /* ========== ESTRUTURA PRINCIPAL ========== */
  
  /* Wrapper do Editor - ocupa espaço restante após sidebar */
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

  /* ========== ÁREA PRINCIPAL (Toolbar + Viewer + Pane) ========== */
  
  /* Toolbar superior */
  .syncfusion-editor-wrapper .e-de-ctnr-toolbar {
    flex-shrink: 0 !important;
    border-bottom: 1px solid #e2e8f0 !important;
  }

  .syncfusion-editor-wrapper .e-de-ctnr-toolbar,
  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar,
  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar-items {
    height: auto !important;
    min-height: 0 !important;
  }

  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar-items {
    display: flex !important;
    flex-wrap: nowrap !important;
    align-items: center !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    scrollbar-width: thin;
  }

  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar-item {
    flex: 0 0 auto !important;
  }

  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar-items::-webkit-scrollbar {
    height: 6px;
  }

  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar-items::-webkit-scrollbar-thumb {
    background: rgba(148, 163, 184, 0.6);
    border-radius: 999px;
  }

  /* Toolbar ultra-compacta: altura mínima, ícones pequenos, sem textos */
  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar-items {
    padding: 1px 2px !important;
    gap: 1px !important;
  }

  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar-item,
  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar-item .e-tbar-btn {
    height: 22px !important;
    min-width: 22px !important;
  }

  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar-item .e-tbar-btn {
    padding: 1px 3px !important;
    min-height: 22px !important;
  }

  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar-item .e-btn-icon,
  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar-item .e-icons {
    font-size: 12px !important;
    line-height: 1 !important;
  }

  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar-item .e-tbar-btn-text,
  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-toolbar-item .e-btn-text {
    display: none !important;
  }

  /* Separadores menores */
  .syncfusion-editor-wrapper .e-de-ctnr-toolbar .e-separator {
    height: 16px !important;
    margin: 0 2px !important;
  }

  /* Container principal (Viewer + Properties Pane) */
  .syncfusion-editor-wrapper .e-de-ctnr-main-container,
  .syncfusion-editor-wrapper .e-de-ctnr-container {
    display: flex !important;
    flex-direction: row !important;
    flex: 1 1 auto !important;
    min-height: 0 !important;
    max-width: 100% !important;
    overflow: hidden !important;
    background: #f8fafc !important;
  }

  /* ========== VIEWER DA FOLHA (Área Central) ========== */
  
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

  /* ========== PAINEL DE PROPRIEDADES (TEXT) - Lado Direito ========== */
  
  .syncfusion-editor-wrapper .e-de-ctnr-properties-pane,
  .syncfusion-editor-wrapper .e-de-property-pane {
    flex: 0 0 auto !important;
    background: white !important;
    border-left: 1px solid #e2e8f0 !important;
    overflow-y: auto !important;
    overflow-x: hidden !important;
  }

  /* Modo colapsado (aba fina) — controlado via atributo pelo SyncfusionEditor */
  .syncfusion-editor-wrapper .e-de-ctnr-properties-pane[data-prop-collapsed="1"],
  .syncfusion-editor-wrapper .e-de-property-pane[data-prop-collapsed="1"] {
    width: 64px !important;
    min-width: 64px !important;
    max-width: 64px !important;
    overflow: hidden !important;
  }

  /* ========== RESPONSIVIDADE ========== */
  
  @media (max-width: 1600px) {
    .syncfusion-editor-wrapper .e-de-ctnr-properties-pane,
    .syncfusion-editor-wrapper .e-de-property-pane {
      width: 175px;
      min-width: 160px;
    }
  }

  @media (max-width: 1440px) {
    .syncfusion-editor-wrapper .e-de-ctnr-properties-pane,
    .syncfusion-editor-wrapper .e-de-property-pane {
      width: 170px;
      min-width: 160px;
    }
  }

  @media (max-width: 1366px) {
    .syncfusion-editor-wrapper .e-de-ctnr-properties-pane,
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

interface PetitionEditorModuleProps {
  isFloatingWidget?: boolean;
  initialClientId?: string;
  initialPetitionId?: string;
  onUnsavedChanges?: (hasChanges: boolean) => void;
  onWidgetInfoChange?: (payload: { lastSaved: Date | null; selectedClient: Client | null }) => void;
  onRequestClose?: () => void;
  onRequestMinimize?: () => void;
}

const PetitionEditorModule: React.FC<PetitionEditorModuleProps> = ({
  isFloatingWidget = false,
  initialClientId,
  initialPetitionId,
  onUnsavedChanges,
  onWidgetInfoChange,
  onRequestClose,
  onRequestMinimize,
}) => {
  const { user } = useAuth();
  const { confirmDelete } = useDeleteConfirm();

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
    'Usuário';

  const userDisplayName = formatUserDisplayName(rawUserDisplayName) || 'Usuário';

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  };
  
  // Estados principais
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'blocks' | 'clients'>('blocks');
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

  // Blocos
  const [blocks, setBlocks] = useState<PetitionBlock[]>([]);
  const [blockSearch, setBlockSearch] = useState('');
  const [selectedDocumentType, setSelectedDocumentType] = useState<DocumentType>('petition');
  const [blockCategories, setBlockCategories] = useState<PetitionBlockCategory[]>([]);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<{ id?: string; key: string; label: string; order: number }[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Editor Syncfusion
  const [petitionTitle, setPetitionTitle] = useState('Nova Petição Trabalhista');
  const [currentPetitionId, setCurrentPetitionId] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isOnline, setIsOnline] = useState(() => {
    try {
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    } catch {
      return true;
    }
  });
  const [openingPetitionId, setOpeningPetitionId] = useState<string | null>(null);
  const [pendingPetitionLoadKey, setPendingPetitionLoadKey] = useState(0);
  const editorRef = useRef<SyncfusionEditorRef>(null);
  const blockConvertEditorRef = useRef<SyncfusionEditorRef>(null);
  const blockViewDocxTokenRef = useRef(0);
  const blockViewDocxContainerRef = useRef<HTMLDivElement | null>(null);
  const contentChangeSeqRef = useRef(0);
  const defaultTemplateAutoAppliedRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const autoCreateInFlightRef = useRef(false);
  const savePetitionActionRef = useRef<(() => Promise<void>) | null>(null);
  const selectedClientIdRef = useRef<string | null>(null);
  const hasUnsavedChangesRef = useRef(false);
  const savingRef = useRef(false);
  const isOnlineRef = useRef(true);
  const autoSaveInFlightRef = useRef(false);
  const autoSaveCountdownRef = useRef<number | null>(null);
  const nextAutoSaveShownRef = useRef<number | null>(null);
  const instantSaveTimerRef = useRef<number | null>(null);
  const lastInstantSaveAtRef = useRef(0);
  const realtimeRefreshTimerRef = useRef<number | null>(null);

  // Petições salvas
  const [savedPetitions, setSavedPetitions] = useState<SavedPetition[]>([]);

  // Clientes
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const [relativeTimeTick, setRelativeTimeTick] = useState(0);
  const [nextAutoSaveIn, setNextAutoSaveIn] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setRelativeTimeTick((t) => t + 1), 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    selectedClientIdRef.current = selectedClient?.id ?? null;
  }, [selectedClient?.id]);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

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
        setError('Você está offline. O Peticionamento é 100% online: reconecte para editar/salvar.');
      } else {
        setError((prev) => (prev === 'Você está offline. O Peticionamento é 100% online: reconecte para editar/salvar.' ? null : prev));
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

  useEffect(() => {
    const tryBackgroundSave = () => {
      if (!isOnlineRef.current) return;
      if (isLoadingPetitionRef.current) return;
      if (!hasUnsavedChangesRef.current) return;
      if (!selectedClientIdRef.current) return;
      if (savingRef.current || autoSaveInFlightRef.current) return;

      const action = savePetitionActionRef.current;
      if (!action) return;

      autoSaveInFlightRef.current = true;
      (window as any).__autoSaving = true;
      Promise.resolve(action()).finally(() => {
        (window as any).__autoSaving = false;
        autoSaveInFlightRef.current = false;
      });
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChangesRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        tryBackgroundSave();
      }
    };

    const onPageHide = () => {
      tryBackgroundSave();
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    const scheduleRefresh = () => {
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }

      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        petitionEditorService
          .listPetitions()
          .then((petitionsData) => setSavedPetitions(petitionsData))
          .catch(() => {
            // ignore
          });
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
  }, [user?.id]);

  useEffect(() => {
    if (autoSaveTimerRef.current) return;

    autoSaveTimerRef.current = window.setInterval(() => {
      if (!isOnlineRef.current) {
        autoSaveCountdownRef.current = null;
        if (nextAutoSaveShownRef.current !== null) {
          nextAutoSaveShownRef.current = null;
          setNextAutoSaveIn(null);
        }
        return;
      }

      const clientId = selectedClientIdRef.current;
      const dirty = hasUnsavedChangesRef.current;

      if (!clientId || !dirty) {
        autoSaveCountdownRef.current = null;
        if (nextAutoSaveShownRef.current !== null) {
          nextAutoSaveShownRef.current = null;
          setNextAutoSaveIn(null);
        }
        return;
      }

      if (autoSaveCountdownRef.current === null) {
        autoSaveCountdownRef.current = 30;
      } else {
        autoSaveCountdownRef.current = Math.max(0, autoSaveCountdownRef.current - 1);
      }

      const remaining = autoSaveCountdownRef.current;
      if (nextAutoSaveShownRef.current !== remaining) {
        nextAutoSaveShownRef.current = remaining;
        setNextAutoSaveIn(remaining);
      }

      if (remaining <= 0) {
        if (savingRef.current || autoSaveInFlightRef.current) return;

        const action = savePetitionActionRef.current;
        if (!action) {
          autoSaveCountdownRef.current = 30;
          return;
        }

        autoSaveInFlightRef.current = true;
        (window as any).__autoSaving = true;

        Promise.resolve(action())
          .catch(() => {})
          .finally(() => {
            (window as any).__autoSaving = false;
            autoSaveInFlightRef.current = false;
            autoSaveCountdownRef.current = hasUnsavedChangesRef.current ? 30 : null;
            nextAutoSaveShownRef.current = null;
          });
      }
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearInterval(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, []);

  const formatRelativeTime = (dateString?: string | null): string => {
    if (!dateString) return '—';
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return '—';
    const diffMs = Date.now() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 10) return 'Agora';
    if (diffSec < 60) return `Há ${diffSec} s`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Há ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Há ${diffH} h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `Há ${diffD} d`;
    return d.toLocaleDateString('pt-BR');
  };

  // Modal de bloco
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [editingBlock, setEditingBlock] = useState<PetitionBlock | null>(null);
  const [blockFormData, setBlockFormData] = useState<CreatePetitionBlockDTO>({
    title: '',
    content: '',
    category: 'outros',
    document_type: 'petition',
    is_default: false,
    is_active: true,
    tags: [],
  });

  const blockEditorRef = useRef<SyncfusionEditorRef | null>(null);
  const [selectionToCreateBlock, setSelectionToCreateBlock] = useState<{ sfdt: string; text: string } | null>(null);
  const blockModalInitDoneRef = useRef(false);
  const [blockTagInput, setBlockTagInput] = useState('');

  // Modal de busca de bloco
  const [showBlockSearchModal, setShowBlockSearchModal] = useState(false);
  const [blockSearchQuery, setBlockSearchQuery] = useState('');

  const [showBlockViewModal, setShowBlockViewModal] = useState(false);
  const [viewingBlock, setViewingBlock] = useState<PetitionBlock | null>(null);
  const [viewingBlockMatchPct, setViewingBlockMatchPct] = useState<number | null>(null);
  const [blockViewFallbackText, setBlockViewFallbackText] = useState('');
  const [blockViewUseFallback, setBlockViewUseFallback] = useState(false);
  const [blockViewDocxLoading, setBlockViewDocxLoading] = useState(false);
  const [blockViewDocxError, setBlockViewDocxError] = useState('');

  // Modelo Word importado
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasDefaultTemplate, setHasDefaultTemplate] = useState(false);
  const [defaultTemplateName, setDefaultTemplateName] = useState<string | null>(null);
  const defaultTemplateMemoryRef = useRef<{ name: string; dataBase64: string } | null>(null);

  const isLoadingPetitionRef = useRef(false);

  const [showCompanyLookupModal, setShowCompanyLookupModal] = useState(false);
  const [companyCnpjInput, setCompanyCnpjInput] = useState('');
  const [companyLookupLoading, setCompanyLookupLoading] = useState(false);
  const [companyLookupResultText, setCompanyLookupResultText] = useState<string | null>(null);

  const openBlockModal = (block?: PetitionBlock) => {
    setError(null);
    setSuccess(null);
    setSelectionToCreateBlock(null);
    blockModalInitDoneRef.current = false;

    if (block) {
      setEditingBlock(block);
      setBlockFormData({
        title: block.title,
        content: block.content,
        category: block.category,
        document_type: (block.document_type || selectedDocumentType) as any,
        is_default: block.is_default,
        is_active: block.is_active,
        tags: block.tags || [],
      });
    } else {
      setEditingBlock(null);
      setBlockFormData({
        title: '',
        content: '',
        category: 'outros',
        document_type: selectedDocumentType,
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

  const openCreateBlockFromSelection = (selectedText: string, selectedSfdt: string) => {
    setError(null);
    setSuccess(null);
    setEditingBlock(null);
    blockModalInitDoneRef.current = false;

    setBlockFormData({
      title: '',
      content: selectedSfdt || '',
      category: 'outros',
      document_type: selectedDocumentType,
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
          setBlockViewDocxError('Não foi possível inicializar o conversor');
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
          setBlockViewDocxError('Pré-visualização indisponível');
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
          setBlockViewDocxError('Falha ao renderizar pré-visualização');
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
      const systemPrompt = `Você é um assistente jurídico especialista em ações trabalhistas no Brasil.
Sua tarefa é gerar palavras-chave (tags) curtas para um bloco de petição.
Regras:
- Retorne APENAS um JSON válido no formato: {"tags": ["tag1", "tag2", ...]}
- Tags em português, minúsculas, sem acentos.
- 3 a 8 tags.
- Prefira EXPRESSOES COMPOSTAS (2-4 palavras) quando fizer sentido.
- Inclua fatos relevantes quando presentes (ex.: "aviso previo cumprido", "acumulo de funcao", "contrato de trabalho", "dispensa sem justa causa").
- Evite tags genéricas sem utilidade jurídica (ex.: "juizo", "digital", "informacoes").
- Foque em tema + contexto (ex.: "horas extras", "rescisao indireta", "pedido de demissao", "dispensa sem justa causa", "fgts", "ctps", "dano moral").`;

      const userPrompt = `Título do bloco:\n${title}\n\nConteúdo (texto extraído):\n${plain}\n\nGere as tags.`;
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

  const getBlockTagsForUI = (block: PetitionBlock) => {
    const existing = Array.isArray(block.tags) ? block.tags.map((t) => String(t)).filter(Boolean) : [];
    if (existing.length) return existing;

    const plain = sfdtToPlainText(block.content);
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
    const cnpjDigits = normalizeCnpj(payload?.cnpj);
    const cnpjFmt = formatCnpj(cnpjDigits);
    const razao = String(payload?.razao_social || '').trim();
    const fantasia = String(payload?.nome_fantasia || '').trim();
    const nomeBase = fantasia ? `${fantasia} - ${razao}` : razao;

    const logradouro = expandLogradouro(payload?.logradouro);
    const numero = String(payload?.numero || '').trim();
    const complemento = String(payload?.complemento || '').trim();
    const bairro = String(payload?.bairro || '').trim();
    const municipio = titleCaseCity(payload?.municipio);
    const uf = String(payload?.uf || '').trim().toUpperCase();
    const cepDigits = String(payload?.cep || '').replace(/\D/g, '');
    const cepFmt = cepDigits.length === 8 ? `${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}` : String(payload?.cep || '').trim();

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

    const phones = Array.isArray(payload?.telefones) ? payload.telefones : [];
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

    const email = String(payload?.email || '').trim().toLowerCase();
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
      setError('Informe um CNPJ válido (14 dígitos)');
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
          'Você é um assistente jurídico. Sua tarefa é COMPILAR e NORMALIZAR dados cadastrais de empresa a partir de DUAS fontes (BrasilAPI e OpenCNPJ). ' +
          'Use apenas dados fornecidos. Não invente. Quando houver conflito, escolha o valor mais completo e consistente. ' +
          'IMPORTANTE: e-mail e telefones podem existir em apenas uma fonte.';

        const schema = {
          cnpj: 'string (somente dígitos ou formatado)',
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
          '\n\nPayload atual (merge determinístico):\n' + JSON.stringify(mergedPayload, null, 2) +
          '\n\nRetorne APENAS um JSON válido seguindo este schema (sem texto extra):\n' + JSON.stringify(schema, null, 2);

        const aiJsonText = (await aiService.generateText(systemPrompt, userPrompt, 750)).trim();
        if (aiJsonText) {
          try {
            const compiled = JSON.parse(aiJsonText);
            if (compiled && typeof compiled === 'object') {
              payload = { ...mergedPayload, ...compiled };
              text = formatCompanyQualification(payload);
            }
          } catch {
            // Se a IA não retornar JSON, mantém fallback determinístico
          }
        }
      }

      setCompanyLookupResultText(text);
    } catch (err) {
      console.error(err);
      setError('Erro ao consultar CNPJ. Verifique o número e tente novamente.');
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
  const [showStartScreen, setShowStartScreen] = useState<boolean>(() => isFloatingWidget && !initialPetitionId);

  // Helper para mostrar mensagem de sucesso temporária (desativado para não poluir o topo)
  const showSuccessMessage = (msg: string) => {
    // Desativado para não ocupar espaço no topo
    // setSuccess(msg);
    // window.setTimeout(() => setSuccess(null), 3000);
  };

  // Salvar petição
  const savePetition = async () => {
    const startSeq = contentChangeSeqRef.current;
    // Regra: salvar apenas documentos vinculados a cliente
    if (!selectedClient?.id) {
      if (!window.__autoSaving) setError('Selecione um cliente antes de salvar a petição');
      return;
    }
    if (!isOnlineRef.current) {
      if (!window.__autoSaving) setError('Você está offline. O Peticionamento é 100% online: reconecte para editar/salvar.');
      return;
    }
    if (isLoadingPetitionRef.current) {
      if (!window.__autoSaving) setError('Aguarde o carregamento do documento antes de salvar');
      return;
    }
    if (saving) return;
    setSaving(true);
    setError(null);

    try {
      const editor = editorRef.current;
      if (!editor) throw new Error('Editor não disponível');

      const sfdt = await editor.getSfdt();
      if (!sfdt) throw new Error('Não foi possível obter o conteúdo do documento');

      const title = petitionTitle.trim() || 'Sem título';
      const clientId = selectedClient?.id || null;
      const clientName = selectedClient?.full_name || null;

      let savedRow: SavedPetition | null = null;

      if (currentPetitionId) {
        // Atualizar petição existente
        savedRow = await petitionEditorService.updatePetition(currentPetitionId, {
          title,
          content: sfdt,
          client_id: clientId,
          client_name: clientName,
        });
      } else {
        // Criar nova petição
        savedRow = await petitionEditorService.createPetition({
          title,
          content: sfdt,
          client_id: clientId,
          client_name: clientName,
        });
        if (savedRow?.id) {
          setCurrentPetitionId(savedRow.id);
        }
      }

      // Update otimista da lista de petições salvas
      if (savedRow) {
        setSavedPetitions((prev) => {
          const next = prev.filter((p) => p.id !== savedRow!.id);
          next.unshift(savedRow!);
          next.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
          return next;
        });
      }

      setHasUnsavedChanges(contentChangeSeqRef.current !== startSeq);
      setLastSaved(new Date());
      // Não mostrar mensagem de sucesso em salvamento automático (apenas em salvamento manual)
      if (!window.__autoSaving) {
        showSuccessMessage('Documento salvo com sucesso');
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      setError(err instanceof Error ? err.message : 'Erro ao salvar documento');
    } finally {
      setSaving(false);
    }
  };

  // Atualizar ref para Ctrl+S
  useEffect(() => {
    savePetitionActionRef.current = savePetition;
  }, [savePetition]);

  // Petição pendente para carregar após o editor estar pronto
  const pendingPetitionRef = useRef<SavedPetition | null>(null);

  // Carregar petição existente
  const loadPetition = async (petition: SavedPetition) => {
    if (isLoadingPetitionRef.current) return;
    isLoadingPetitionRef.current = true;
    setOpeningPetitionId(petition.id);

    // Atualizar estados primeiro
    setCurrentPetitionId(petition.id);
    setPetitionTitle(petition.title || '');
    setLastSaved(petition.updated_at ? new Date(petition.updated_at) : null);

    // Carregar cliente se houver
    if (petition.client_id) {
      const client = clients.find((c) => c.id === petition.client_id);
      if (client) {
        setSelectedClient(client);
      }
    } else {
      setSelectedClient(null);
    }

    setHasUnsavedChanges(false);

    // Bloquear autosave durante load (evita salvar documento vazio)
    window.__autoSaving = true;

    const editor = editorRef.current;
    if (editor && petition.content) {
      try {
        await editor.loadSfdt(petition.content);
        setShowStartScreen(false);
      } catch (err) {
        console.error('Erro ao carregar conteúdo:', err);
        setError('Erro ao carregar documento');
      } finally {
        window.__autoSaving = false;
        isLoadingPetitionRef.current = false;
        setOpeningPetitionId(null);
      }
      return;
    }

    // Guardar para carregar depois que o editor estiver pronto
    pendingPetitionRef.current = petition;
    setShowStartScreen(false);
    setPendingPetitionLoadKey((k) => k + 1);
  };

  // Carregar petição pendente quando o editor estiver pronto
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
          showSuccessMessage('Documento carregado');
        }
      } catch (err) {
        console.error('Erro ao carregar conteúdo:', err);
        setError('Erro ao carregar documento');
      } finally {
        window.__autoSaving = false;
        isLoadingPetitionRef.current = false;
        setOpeningPetitionId(null);
      }
    };
    
    // Pequeno delay para garantir que o editor está totalmente inicializado
    window.setTimeout(loadContent, 100);
  }, [pendingPetitionLoadKey]);

  // Nova petição
  const newPetition = (options?: { keepClient?: boolean }) => {
    const editor = editorRef.current;
    if (editor) {
      editor.clear();
    }

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
        setError('Editor não disponível');
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
        setError('Editor não disponível');
        return;
      }

      const arrayBuffer = await file.arrayBuffer();
      await editor.loadDocx(arrayBuffer, file.name);

      try {
        const dataBase64 = arrayBufferToBase64(arrayBuffer);
        defaultTemplateMemoryRef.current = { name: file.name, dataBase64 };
        setHasDefaultTemplate(true);
        setDefaultTemplateName(file.name);

        // Salvar no Supabase
        try {
          await petitionEditorService.saveDefaultTemplate(file.name, dataBase64);
        } catch (dbErr) {
          console.error('Erro ao salvar modelo padrão no banco:', dbErr);
          // Fallback para localStorage se falhar
          try {
            window.localStorage.setItem(
              DEFAULT_TEMPLATE_STORAGE_KEY,
              JSON.stringify({ name: file.name, dataBase64 })
            );
          } catch (storageErr) {
            console.error('Erro ao salvar Documento padrão no storage:', storageErr);
            setError('Não foi possível salvar o Documento padrão no navegador (armazenamento cheio).');
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

  // Inserir bloco no editor
  const insertBlock = async (block: PetitionBlock) => {
    if (!isOnlineRef.current) {
      setError('Você está offline. O Peticionamento é 100% online: reconecte para editar/salvar.');
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;

    const sfdt = String(block.content || '').trim();
    const looksLikeSfdt = sfdt.startsWith('{') || sfdt.startsWith('[');

    // Função para restaurar foco e garantir estado editável
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
          // Inserção síncrona para evitar perda de foco
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
        content = 'Pré-visualização indisponível';
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
      showSuccessMessage('Bloco excluído');
    } catch (err) {
      console.error('Erro ao excluir bloco:', err);
      setError('Erro ao excluir bloco');
    }
  };

  // Handler de mudança de conteúdo do editor
  const handleContentChange = () => {
    if (isLoadingPetitionRef.current) return;
    if (!isOnlineRef.current) {
      setError('Você está offline. O Peticionamento é 100% online: reconecte para editar/salvar.');
      return;
    }
    contentChangeSeqRef.current += 1;
    setHasUnsavedChanges(true);

    autoSaveCountdownRef.current = 30;
    nextAutoSaveShownRef.current = 30;
    setNextAutoSaveIn(30);

    if (!selectedClientIdRef.current) return;

    if (instantSaveTimerRef.current) {
      window.clearTimeout(instantSaveTimerRef.current);
      instantSaveTimerRef.current = null;
    }

    instantSaveTimerRef.current = window.setTimeout(() => {
      if (isLoadingPetitionRef.current) return;
      if (!isOnlineRef.current) return;
      if (!hasUnsavedChangesRef.current) return;
      if (!selectedClientIdRef.current) return;
      if (savingRef.current || autoSaveInFlightRef.current) return;

      const MIN_INTERVAL_MS = 15000;
      const now = Date.now();
      const elapsed = now - lastInstantSaveAtRef.current;
      if (elapsed < MIN_INTERVAL_MS) {
        const remaining = MIN_INTERVAL_MS - elapsed;
        if (instantSaveTimerRef.current) {
          window.clearTimeout(instantSaveTimerRef.current);
          instantSaveTimerRef.current = null;
        }
        instantSaveTimerRef.current = window.setTimeout(() => {
          if (isLoadingPetitionRef.current) return;
          if (!isOnlineRef.current) return;
          if (!hasUnsavedChangesRef.current) return;
          if (!selectedClientIdRef.current) return;
          if (savingRef.current || autoSaveInFlightRef.current) return;

          const action = savePetitionActionRef.current;
          if (!action) return;

          lastInstantSaveAtRef.current = Date.now();
          autoSaveInFlightRef.current = true;
          (window as any).__autoSaving = true;
          Promise.resolve(action()).finally(() => {
            (window as any).__autoSaving = false;
            autoSaveInFlightRef.current = false;
          });
        }, remaining);
        return;
      }

      const action = savePetitionActionRef.current;
      if (!action) return;

      lastInstantSaveAtRef.current = now;
      autoSaveInFlightRef.current = true;
      (window as any).__autoSaving = true;
      Promise.resolve(action()).finally(() => {
        (window as any).__autoSaving = false;
        autoSaveInFlightRef.current = false;
      });
    }, 800);
  };

  // Salvar bloco (criar ou atualizar)
  const saveBlock = async () => {
    if (!blockFormData.title.trim()) {
      setError('Título é obrigatório');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      let content = blockFormData.content;
      if (blockEditorRef.current) {
        content = blockEditorRef.current.getSfdt() || '';
      }

      if (editingBlock) {
        const updated = await petitionEditorService.updateBlock(editingBlock.id, {
          title: blockFormData.title,
          content,
          category: blockFormData.category,
          document_type: blockFormData.document_type,
          is_default: blockFormData.is_default,
          is_active: blockFormData.is_active,
          tags: blockFormData.tags,
        });
        setBlocks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
        showSuccessMessage('Bloco atualizado');
      } else {
        const created = await petitionEditorService.createBlock({
          title: blockFormData.title,
          content,
          category: blockFormData.category,
          document_type: blockFormData.document_type,
          is_default: blockFormData.is_default,
          is_active: blockFormData.is_active,
          tags: blockFormData.tags,
        });
        setBlocks((prev) => [...prev, created]);
        showSuccessMessage('Bloco criado');
      }

      setShowBlockModal(false);
      setEditingBlock(null);
    } catch (err) {
      console.error('Erro ao salvar bloco:', err);
      setError('Erro ao salvar bloco');
    } finally {
      setSaving(false);
    }
  };

  // Carregar dados
  useEffect(() => {
    loadData();
  }, []);

  // Carregar conteúdo do bloco no editor do modal quando abrir
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
            // Texto puro já inserido; se vazio, nada a fazer
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
    const loadDefaultTemplateFromDB = async () => {
      try {
        const template = await petitionEditorService.getDefaultTemplate();
        if (template) {
          setHasDefaultTemplate(true);
          setDefaultTemplateName(template.name);
          defaultTemplateMemoryRef.current = { name: template.name, dataBase64: template.dataBase64 };
        } else {
          setHasDefaultTemplate(false);
          setDefaultTemplateName(null);
          defaultTemplateMemoryRef.current = null;
        }
      } catch (err) {
        console.error('Erro ao carregar modelo padrão do banco:', err);
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

  const loadDefaultTemplate = async () => {
    if (!isOnlineRef.current) {
      setError('Você está offline. O Peticionamento é 100% online: reconecte para editar/salvar.');
      return;
    }
    try {
      const memory = defaultTemplateMemoryRef.current;
      let parsed: { name: string; dataBase64: string } | null = memory;

      // Se não tiver em memória, tentar do banco
      if (!parsed) {
        try {
          const template = await petitionEditorService.getDefaultTemplate();
          if (template) {
            parsed = { name: template.name, dataBase64: template.dataBase64 };
            defaultTemplateMemoryRef.current = parsed;
          }
        } catch (dbErr) {
          console.error('Erro ao buscar modelo padrão do banco:', dbErr);
          // Fallback para localStorage
          const raw = window.localStorage.getItem(DEFAULT_TEMPLATE_STORAGE_KEY);
          const fallback = raw ? (JSON.parse(raw) as { name?: string; dataBase64?: string }) : null;
          if (fallback?.name && fallback.dataBase64) {
            parsed = { name: fallback.name, dataBase64: fallback.dataBase64 };
          }
        }
      }

      if (!parsed?.dataBase64) {
        setError('Nenhum modelo padrão definido');
        return;
      }

      const editor = await waitForEditorReady();
      if (!editor) {
        setError('Editor não disponível');
        return;
      }

      const arrayBuffer = base64ToArrayBuffer(parsed.dataBase64);
      await editor.loadDocx(arrayBuffer, parsed.name || 'modelo.docx');
      setHasUnsavedChanges(true);
      showSuccessMessage(`Modelo padrão${parsed.name ? ` "${parsed.name}"` : ''} carregado`);
    } catch (err) {
      console.error(err);
      setError('Erro ao carregar modelo padrão');
    }
  };

  useEffect(() => {
    if (defaultTemplateAutoAppliedRef.current) return;
    if (loading) return;
    if (!hasDefaultTemplate) return;

    // Não sobrescrever petição carregada ou alterações do usuário
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

      // Atalho: Alt + Space abre busca de blocos
      if (e.altKey && e.code === 'Space') {
        e.preventDefault();
        setBlockSearchQuery('');
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
      // Prioriza título
      const sTitle = scoreTermInWords(term, titleWords, 1.0, 0.75);
      const sContent = scoreTermInWords(term, contentWords, 0.5, 0.35);
      score += Math.max(sTitle, sContent);
    }

    // Normaliza por quantidade de termos
    score = score / terms.length;

    // Boost se query inteira aparece no título
    if (title.includes(query)) score += 0.35;
    if (score > 1.5) score = 1.5;
    return score;
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [blocksData, petitionsData, clientsData] = await Promise.all([
        petitionEditorService.listBlocks(selectedDocumentType),
        petitionEditorService.listPetitions(),
        loadClients(),
      ]);

      setBlocks(blocksData);
      const withClient = (petitionsData || []).filter((p) => Boolean(p.client_id));
      const orphans = (petitionsData || []).filter((p) => !p.client_id);
      setSavedPetitions(withClient);
      // Limpar automaticamente documentos antigos sem vinculação
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
    }
  };

  useEffect(() => {
    // Recarregar blocos quando trocar o tipo do documento
    let cancelled = false;
    const reload = async () => {
      try {
        const blocksData = await petitionEditorService.listBlocks(selectedDocumentType);
        if (!cancelled) setBlocks(blocksData);
      } catch {
        // ignore
      }
    };
    void reload();
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentType]);

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
    return data || [];
  };

  // Notificar parent sobre mudanças não salvas (para widget flutuante)
  useEffect(() => {
    onUnsavedChanges?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChanges]);

  useEffect(() => {
    onWidgetInfoChange?.({ lastSaved, selectedClient });
  }, [lastSaved, selectedClient, onWidgetInfoChange]);

  // Carregar cliente/petição inicial quando em modo widget flutuante
  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    if (loading) return;
    if (!isFloatingWidget) return;

    initialLoadDoneRef.current = true;

    // Se tiver petição inicial, carregar
    if (initialPetitionId) {
      const petition = savedPetitions.find(p => p.id === initialPetitionId);
      if (petition) {
        loadPetition(petition);
        return;
      }
    }

    // Se tiver cliente inicial, selecionar e mostrar petições do cliente
    if (initialClientId) {
      const client = clients.find(c => c.id === initialClientId);
      if (client) {
        setSelectedClient(client);
        setSidebarTab('blocks');
        window.setTimeout(() => savePetition(), 0);
        // Filtrar petições do cliente para mostrar opções
        const clientPetitions = savedPetitions.filter(p => p.client_id === initialClientId);
        if (clientPetitions.length > 0) {
          showSuccessMessage(`${clientPetitions.length} petição(ões) encontrada(s) para ${client.full_name}`);
        }
      }
    }
  }, [loading, isFloatingWidget, initialClientId, initialPetitionId, clients, savedPetitions]);

  // Filtrar blocos
  const filteredBlocks = useMemo(() => {
    return blocks.filter(block => {
      const dt = (block.document_type || 'petition') as string;
      if (dt !== selectedDocumentType) return false;
      const tagsText = getBlockTagsForUI(block).join(' ');
      const terms = parseSearchTerms(blockSearch);
      const hay = normalizeTag(`${block.title}\n${tagsText}\n${sfdtToPlainText(block.content)}`);
      const matchesSearch = terms.length === 0 || terms.every((t) => hay.includes(t));
      return matchesSearch && block.is_active;
    });
  }, [blocks, blockSearch, selectedDocumentType]);

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
    const active = blocks.filter(b => b.is_active && ((b.document_type || 'petition') as string) === selectedDocumentType);
    const q = (blockSearchQuery || '').trim();
    if (!q) return active.map((b) => ({ block: b, score: 0, matchPct: 0 } as BlockSearchResult));

    const terms = parseSearchTerms(q);

    const ranked = active
      .map((b) => {
        const plain = sfdtToPlainText(b.content);
        const tagsText = getBlockTagsForUI(b).join(' ');
        const titleRaw = b.title;
        const titleN = normalizeSearchText(titleRaw);
        const tagsN = normalizeSearchText(tagsText);
        const contentN = normalizeSearchText(plain);
        const qN = normalizeSearchText(q);

        const scores = terms.map((t) => {
          const token = String(t || '').trim();
          if (!token) return 0;

          if (token.includes(' ')) {
            const phrase = normalizeSearchText(token);
            if (!phrase) return 0;
            if (titleN.includes(phrase)) return 1.0;
            if (tagsN.includes(phrase)) return 0.95;
            if (contentN.includes(phrase)) return 0.6;
            return 0;
          }

          const sTitle = scoreSingleTermInText(token, titleRaw, 1.0, 0.75);
          const sTags = scoreSingleTermInText(token, tagsText, 0.9, 0.6);
          const sContent = scoreSingleTermInText(token, plain, 0.55, 0.3);
          return Math.max(sTitle, sTags, sContent);
        });

        const baseMin = terms.length <= 1 ? 0.2 : 0.35;
        const passed = scores.every((s, idx) => {
          const token = terms[idx] || '';
          if (terms.length >= 2 && String(token).length <= 3) return s >= 0.8;
          return s >= baseMin;
        });

        if (!passed) return null;

        let score = scores.reduce((acc, v) => acc + v, 0) / Math.max(scores.length, 1);
        if (qN && titleN.includes(qN)) score += 0.25;
        if (qN && tagsN.includes(qN)) score += 0.15;
        if (score > 1.5) score = 1.5;
        const matchPct = Math.round(Math.max(0, Math.min(1, score / 1.5)) * 100);
        return { block: b, score, matchPct } as BlockSearchResult;
      })
      .filter((x): x is BlockSearchResult => Boolean(x) && x !== null && x.score > 0.25)
      .sort((a, b) => b.score - a.score);

    return ranked;
  }, [blocks, blockSearchQuery, selectedDocumentType]);

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

  // Gerar qualificação do cliente
  const generateClientQualification = (client: Client): string => {
    const parts: string[] = [];
    
    parts.push(`${client.full_name.toUpperCase()}`);
    
    if (client.nationality) parts.push(client.nationality.toLowerCase());
    if (client.marital_status) parts.push(MARITAL_STATUS_LABELS[client.marital_status] || client.marital_status);
    if (client.profession) parts.push(client.profession.toLowerCase());
    if (client.cpf_cnpj) parts.push(`inscrito(a) no CPF sob o nº ${client.cpf_cnpj}`);
    if (client.rg) parts.push(`RG nº ${client.rg}`);
    
    let address = '';
    if (client.address_street) address += `residente e domiciliado(a) na ${client.address_street}`;
    if (client.address_number) address += `, nº ${client.address_number}`;
    if (client.address_complement) address += `, ${client.address_complement}`;
    if (client.address_neighborhood) address += `, Bairro ${client.address_neighborhood}`;
    if (client.address_city) address += `, ${client.address_city}`;
    if (client.address_state) address += ` – ${client.address_state}`;
    if (client.address_zip_code) address += `, CEP ${client.address_zip_code}`;
    if (address) parts.push(address);
    
    if (client.phone) parts.push(`telefone/WhatsApp ${client.phone}`);
    if (client.email) parts.push(`e-mail ${client.email}`);
    
    return parts.join(', ');
  };

  // Inserir qualificação do cliente
  const insertClientQualification = (client: Client) => {
    if (!isOnlineRef.current) {
      setError('Você está offline. O Peticionamento é 100% online: reconecte para editar/salvar.');
      return;
    }
    setSelectedClient(client);
    window.setTimeout(() => savePetition(), 0);
    const editor = editorRef.current;
    if (!editor) return;

    const name = (client.full_name || '').toUpperCase();
    const qualification = generateClientQualification(client);
    const rest = qualification.startsWith(name) ? qualification.slice(name.length) : `, ${qualification}`;

    editor.focus();
    editor.setBold(true);
    editor.insertText(name);
    editor.setBold(false);
    editor.insertText(rest);
    setHasUnsavedChanges(true);
    showSuccessMessage('DAS QUESTÕES INICIAIS inseridas');
    window.setTimeout(() => savePetition(), 0);
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

  // ========== RENDER ==========
  // Tela de início (quando showStartScreen === true)
  if (showStartScreen) {
    return (
      <div className={`${isFloatingWidget ? 'h-full' : 'h-screen'} flex flex-col bg-white`}>
        {/* Top bar (estilo Word) */}
        <div className="h-12 flex items-center justify-between px-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-blue-600 flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div className="text-sm font-semibold text-slate-900">Editor de Petições</div>
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
          <div className="max-w-6xl mx-auto px-4 py-6">
            {/* Saudação */}
            <div className="mb-5">
              <div className="text-xl font-bold text-slate-900">{getGreeting()}</div>
              <div className="text-xs text-slate-500">{userDisplayName}</div>
            </div>

            {/* Novo */}
            <div className="mb-6">
              <div className="text-xs font-semibold text-slate-700 mb-2">Novo</div>
              <div className="flex gap-4 flex-wrap">
                <button
                  onClick={() => { newPetition(); setShowStartScreen(false); }}
                  className="w-[160px] rounded border border-slate-300 hover:border-blue-500 hover:shadow-sm bg-white transition text-left"
                >
                  <div className="h-[110px] bg-slate-100 flex items-center justify-center">
                    <div className="w-[78px] h-[96px] bg-white border border-slate-300 shadow-sm" />
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-xs font-medium text-slate-800">Documento em branco</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    // Abrir o editor primeiro para garantir que o Syncfusion esteja montado
                    if (isLoadingPetitionRef.current) return;
                    isLoadingPetitionRef.current = true;
                    window.__autoSaving = true;
                    newPetition();
                    setShowStartScreen(false);
                    window.setTimeout(() => {
                      void Promise.resolve(loadDefaultTemplate()).finally(() => {
                        window.__autoSaving = false;
                        isLoadingPetitionRef.current = false;
                      });
                    }, 200);
                  }}
                  disabled={!hasDefaultTemplate}
                  className="w-[160px] rounded border border-slate-300 hover:border-blue-500 hover:shadow-sm bg-white transition text-left disabled:opacity-60 disabled:hover:border-slate-300"
                  title={hasDefaultTemplate ? `Carregar documento padrão${defaultTemplateName ? `: ${defaultTemplateName}` : ''}` : 'Nenhum documento padrão definido'}
                >
                  <div className="h-[110px] bg-slate-100 flex items-center justify-center">
                    <div className="w-[78px] h-[96px] bg-white border border-slate-300 shadow-sm flex items-center justify-center">
                      <FileText className="w-8 h-8 text-slate-400" />
                    </div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-xs font-medium text-slate-800">Documento padrão</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setShowStartScreen(false);
                    window.setTimeout(() => {
                      fileInputRef.current?.click();
                    }, 150);
                  }}
                  className="w-[160px] rounded border border-slate-300 hover:border-blue-500 hover:shadow-sm bg-white transition text-left"
                >
                  <div className="h-[110px] bg-slate-100 flex items-center justify-center">
                    <div className="w-[78px] h-[96px] bg-white border border-slate-300 shadow-sm flex items-center justify-center">
                      <FileUp className="w-8 h-8 text-slate-400" />
                    </div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-xs font-medium text-slate-800">Importar arquivo</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Recentes */}
            <div className="border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-slate-700">Recentes</div>
              </div>

              <div className="bg-white border border-slate-200 rounded">
                <div className="grid grid-cols-12 px-3 py-2 text-[11px] text-slate-500 border-b border-slate-200">
                  <div className="col-span-5">Arquivo</div>
                  <div className="col-span-3">Cliente</div>
                  <div className="col-span-3 text-right">Modificado</div>
                  <div className="col-span-1 text-right"></div>
                </div>

                {savedPetitions.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-slate-500">Nenhuma petição recente</div>
                ) : (
                  <div className="max-h-[360px] overflow-y-auto">
                    {savedPetitions.slice(0, 15).map((p) => {
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
                          className={`w-full grid grid-cols-12 px-3 py-2 text-left border-b border-slate-100 last:border-b-0 items-center group ${
                            isBusyOpening ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:bg-slate-50'
                          }`}
                        >
                          <div className="col-span-5 text-left">
                            <div className="text-sm text-slate-800 truncate flex items-center gap-2">
                              {isOpening && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />}
                              <span>{isOpening ? 'Abrindo...' : (p.title || 'Sem título')}</span>
                            </div>
                          </div>
                          <div className="col-span-3 text-xs text-slate-600 truncate text-left">{p.client_name || '—'}</div>
                          <div className="col-span-3 text-right text-xs text-slate-500" data-tick={relativeTimeTick}>
                            {formatRelativeTime(p.updated_at)}
                          </div>
                          <div className="col-span-1 text-right">
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (isBusyOpening) return;
                                const confirmed = await confirmDelete({
                                  title: 'Excluir petição',
                                  entityName: p.title || 'Sem título',
                                  message: `Deseja excluir a petição "${p.title || 'Sem título'}"${p.client_name ? ` vinculada ao cliente ${p.client_name}` : ''}?`,
                                  confirmLabel: 'Excluir',
                                });
                                if (!confirmed) return;
                                try {
                                  await petitionEditorService.deletePetition(p.id);
                                  setSavedPetitions((prev) => prev.filter((x) => x.id !== p.id));
                                } catch (err) {
                                  console.error('Erro ao excluir petição:', err);
                                  setError('Erro ao excluir petição');
                                }
                              }}
                              disabled={isBusyOpening}
                              className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
                              title="Excluir petição"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
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

  // Tela principal do editor
  return (
    <div className={`${isFloatingWidget ? 'h-full' : 'h-screen'} flex flex-col bg-slate-50`}>
      {/* Faixa Laranja */}
      <div className="h-2 w-full shrink-0 bg-gradient-to-r from-orange-500 to-orange-600" />

      {/* Toolbar Superior */}
      <div className="relative z-[20] bg-white border-b border-slate-200 px-3 py-1.5 flex items-center gap-2 flex-shrink-0">
        {/* Toggle Sidebar */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 hover:bg-slate-100 rounded transition-colors"
          title={sidebarOpen ? 'Ocultar painel' : 'Mostrar painel'}
        >
          {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
        </button>

        {/* Voltar para a tela inicial */}
        <button
          onClick={() => {
            if (hasUnsavedChanges) {
              const what = [
                petitionTitle ? `Documento: "${petitionTitle}"` : '',
                selectedClient?.full_name ? `Cliente: ${selectedClient.full_name}` : '',
              ]
                .filter(Boolean)
                .join('\n');
              const msg = `Há alterações não salvas.${what ? `\n\n${what}` : ''}\n\nDeseja voltar para a tela inicial mesmo assim?`;
              if (!confirm(msg)) return;
            }
            setShowStartScreen(true);
          }}
          className="p-1.5 hover:bg-amber-100 rounded transition-colors text-slate-500 hover:text-amber-600"
          title="Voltar para a tela inicial"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        {/* Título */}
        <input
          type="text"
          value={petitionTitle}
          onChange={(e) => { setPetitionTitle(e.target.value); setHasUnsavedChanges(true); window.setTimeout(() => savePetition(), 0); }}
          className="w-[240px] sm:w-[320px] px-2 py-1 text-sm font-semibold border border-transparent hover:border-slate-200 focus:border-amber-400 rounded focus:outline-none"
          placeholder="Título da petição..."
        />

        {/* Cliente selecionado */}
        {selectedClient && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-xs">
            <User className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-amber-700 font-medium">{selectedClient.full_name}</span>
            <button onClick={() => { setSelectedClient(null); window.setTimeout(() => savePetition(), 0); }} className="text-amber-500 hover:text-amber-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* Status de salvamento */}
        {lastSaved && (
          <div className="flex items-center gap-1 text-xs text-slate-400 w-[170px] justify-end tabular-nums whitespace-nowrap">
            <Clock className="w-3.5 h-3.5" />
            <span title={lastSaved.toLocaleString('pt-BR')}>Atualizado {formatRelativeTime(lastSaved.toISOString())}</span>
          </div>
        )}

        {/* Ações */}
        <button
          onClick={() => newPetition({ keepClient: true })}
          className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded transition-colors flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          Novo
        </button>
        <button
          onClick={savePetition}
          disabled={saving}
          className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors flex items-center gap-1 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Salvar
        </button>
        <button
          onClick={exportToWord}
          className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded transition-colors flex items-center gap-1"
        >
          <Download className="w-3.5 h-3.5" />
          Word
        </button>

        <div className="h-4 w-px bg-slate-200 mx-1" />

        {/* Importar modelo */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".doc,.docx"
          onChange={handleImportTemplate}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded transition-colors flex items-center gap-1"
          title="Importar modelo Word"
        >
          <FileUp className="w-3.5 h-3.5" />
          Modelo
        </button>

        <button
          onClick={loadDefaultTemplate}
          disabled={!hasDefaultTemplate}
          className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded transition-colors flex items-center gap-1 disabled:opacity-50 disabled:hover:bg-transparent"
          title={hasDefaultTemplate ? `Carregar modelo padrão${defaultTemplateName ? `: ${defaultTemplateName}` : ''}` : 'Nenhum modelo padrão definido'}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Padrão
        </button>

        <div className="h-4 w-px bg-slate-200 mx-1" />

        {/* Botões de controle do modal */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (isFloatingWidget) {
                onRequestMinimize?.();
                return;
              }
              setIsMinimized(true);
            }}
            className="p-1.5 hover:bg-slate-100 rounded transition-colors text-slate-500 hover:text-slate-700"
            title="Minimizar"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
          {!isFloatingWidget && (
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1.5 hover:bg-slate-100 rounded transition-colors text-slate-500 hover:text-slate-700"
              title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            >
              <Maximize2 className="w-4 h-4" />
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
                const msg = `Há alterações não salvas.${what ? `\n\n${what}` : ''}\n\nDeseja fechar mesmo assim?`;
                if (!confirm(msg)) return;
              }
              if (isFloatingWidget) {
                onRequestClose?.();
              } else {
                setIsMinimized(true);
              }
            }}
            className="p-1.5 hover:bg-red-100 rounded transition-colors text-slate-500 hover:text-red-600"
            title="Fechar"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mensagens */}
      {error && (
        <div className="mx-3 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
          <AlertCircle className="w-4 h-4" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Modal: Visualizar Conteúdo do Bloco */}
      {showBlockViewModal && viewingBlock && (
        <aside id="petition-editor-backdrop" className="fixed inset-0 z-[100] flex items-start justify-center p-2 sm:p-6 pt-8 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
          <main id="block-editor-modal" className="bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.12)] border border-slate-200 w-full max-w-7xl max-h-[92vh] my-2 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-1.5 w-full shrink-0 bg-orange-600" style={{ backgroundColor: '#ea580c' }} />

            <header className="relative px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 leading-none">Visualizar Bloco</div>
                <div className="mt-1 flex items-center gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 uppercase tracking-tight leading-tight">{viewingBlock.title}</h3>
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
                className="absolute top-1.5 sm:top-2 right-1.5 sm:right-2 p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all duration-200 hover:rotate-90"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="p-4 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Título do Bloco *</label>
                  <input
                    type="text"
                    value={viewingBlock.title}
                    readOnly
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-slate-50 font-medium text-slate-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Categoria</label>
                  <select
                    value={viewingBlock.category}
                    disabled
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-slate-50 font-medium text-slate-600 cursor-not-allowed"
                  >
                    <option value={viewingBlock.category}>{getCategoryLabel(String(viewingBlock.category || 'outros'))}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Conteúdo SFDT *</label>
                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-inner">
                  <div className="relative w-full h-[620px] overflow-auto bg-white petition-block-docx-preview">
                    <div className="min-h-[620px] p-4">
                      <div
                        ref={(node) => {
                          blockViewDocxContainerRef.current = node;
                        }}
                      />
                    </div>

                    {blockViewDocxLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                        <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Carregando...</span>
                        </div>
                      </div>
                    )}

                    {!blockViewDocxLoading && blockViewDocxError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                        <div className="text-slate-500 text-sm font-medium">{blockViewDocxError}</div>
                      </div>
                    )}

                    {!blockViewDocxLoading && !blockViewDocxError && blockViewUseFallback && (
                      <div className="absolute inset-0 bg-white">
                        <div className="h-full w-full p-4 overflow-y-auto">
                          <pre className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">
                            {(() => {
                              const t = (blockViewFallbackText || '').trim();
                              if (!t) return 'Pré-visualização indisponível';
                              if (t.startsWith('{') || t.startsWith('[')) return 'Pré-visualização indisponível';
                              return t;
                            })()}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Variáveis disponíveis</span>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    [[NOME_CLIENTE]], [[CPF]], [[RG]], [[NACIONALIDADE]], [[ESTADO_CIVIL]], [[PROFISSAO]], [[ENDERECO]], [[CIDADE]], [[UF]], [[CEP]], [[EMAIL]], [[TELEFONE]]
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-3 sm:col-span-2 space-y-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Tags</label>
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
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-200"
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
                  <span className="text-sm font-bold text-amber-900 uppercase tracking-tight">Incluir por padrão</span>
                  <p className="text-xs text-amber-700/70 font-medium">Este bloco será inserido automaticamente ao criar uma nova petição</p>
                </div>
              </label>
            </div>

            <footer className="px-4 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50 gap-2">
              <button
                onClick={async () => {
                  if (!isOnlineRef.current) {
                    setError('Você está offline. O Peticionamento é 100% online: reconecte para editar/salvar.');
                    return;
                  }
                  await insertBlock(viewingBlock);
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
                className="px-6 py-2.5 text-xs sm:text-sm font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 uppercase tracking-wider petition-btn-emerald"
              >
                <Plus className="w-4 h-4" />
                <span>Adicionar no documento</span>
              </button>
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
                className="px-8 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200 bg-white border border-slate-200 rounded-xl transition-all duration-200 shadow-sm"
              >
                Fechar
              </button>
            </footer>
          </main>
        </aside>
      )}

      {/* Desativado para não ocupar espaço no topo */}
      {false && success && (
        <div className="mx-3 mt-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-sm text-emerald-700">
          <Star className="w-4 h-4" />
          {success}
        </div>
      )}

      {/* Conteúdo Principal */}
      <div className="flex-1 flex min-w-0 max-w-full overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="relative z-[20] bg-white border-r border-slate-200 flex flex-col flex-shrink-0" style={{ width: sidebarWidth }}>
            {/* Tabs */}
            <div className="flex border-b border-slate-200">
              <button
                onClick={() => setSidebarTab('blocks')}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                  sidebarTab === 'blocks' ? 'text-amber-600 border-b-2 border-amber-500' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Blocos
              </button>
              <button
                onClick={() => setSidebarTab('clients')}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                  sidebarTab === 'clients' ? 'text-amber-600 border-b-2 border-amber-500' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Clientes
              </button>
            </div>

            {/* Tab: Blocos */}
            {sidebarTab === 'blocks' && (
              <>
                <div className="p-2 border-b border-slate-100 flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar bloco..."
                      value={blockSearch}
                      onChange={(e) => setBlockSearch(e.target.value)}
                      className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                    />
                  </div>
                  <select
                    value={selectedDocumentType}
                    onChange={(e) => setSelectedDocumentType(e.target.value as DocumentType)}
                    className="px-2 py-1.5 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-amber-400 focus:border-amber-400 bg-white"
                    title="Tipo de documento"
                  >
                    <option value="petition">Petição</option>
                    <option value="contestation">Contestação</option>
                    <option value="impugnation">Impugnação</option>
                    <option value="appeal">Recurso</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      ensureDraftFromCategories(blockCategories);
                      setShowCategoryModal(true);
                    }}
                    className="p-1.5 border border-slate-200 text-slate-500 rounded hover:bg-slate-50"
                    title="Configurar categorias"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openBlockModal()}
                    className="p-1.5 bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors"
                    title="Novo bloco"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {sidebarCategoryKeys.map((category) => {
                    const items = (blocksByCategory as any)[category] || [];
                    if (items.length === 0) return null;
                    const isExpanded = expandedCategories.has(category);
                    return (
                      <div key={category} className="border-b border-slate-100">
                        <button
                          onClick={() => toggleCategory(category)}
                          className="w-full px-2 py-2 flex items-center gap-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          {getCategoryLabel(category)}
                          <span className="ml-auto text-slate-400">({items.length})</span>
                        </button>

                        {isExpanded && (
                          <div className="pb-1">
                            {(items as PetitionBlock[]).map((block: PetitionBlock) => (
                              <div
                                key={block.id}
                                className="group px-2 py-2 hover:bg-amber-50 rounded cursor-pointer transition-colors"
                                onClick={() => void insertBlock(block)}
                              >
                                <div className="flex items-center gap-1">
                                  <span className="flex-1 text-xs text-slate-700 truncate">{block.title}</span>
                                  {block.is_default && <Star className="w-2.5 h-2.5 text-amber-400" />}
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openBlockModal(block); }}
                                      className="p-0.5 hover:bg-amber-50 rounded"
                                      title="Editar bloco"
                                    >
                                      <Edit3 className="w-2.5 h-2.5 text-amber-600" />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openViewBlock(block); }}
                                      className="p-0.5 hover:bg-slate-100 rounded"
                                      title="Visualizar bloco"
                                    >
                                      <Eye className="w-2.5 h-2.5 text-slate-500" />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); void deleteBlock(block.id); }}
                                      className="p-0.5 hover:bg-red-100 rounded"
                                      title="Excluir bloco"
                                    >
                                      <Trash2 className="w-2.5 h-2.5 text-red-500" />
                                    </button>
                                  </div>
                                </div>
                                {(() => {
                                  const tags = getBlockTagsForUI(block);
                                  if (!tags.length) return null;
                                  return (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {tags.slice(0, 3).map((t) => (
                                        <span key={t} className="text-[9px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                                          {t}
                                        </span>
                                      ))}
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
                <div className="p-2 border-b border-slate-100">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar cliente..."
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {filteredClients.length === 0 ? (
                    <div className="p-4 text-center text-slate-400">
                      <Users className="w-8 h-8 mx-auto mb-2" />
                      <p className="text-xs">Nenhum cliente encontrado</p>
                    </div>
                  ) : (
                    filteredClients.map(client => (
                      <div
                        key={client.id}
                        className={`group px-2 py-2 border-b border-slate-100 hover:bg-amber-50 transition-colors cursor-pointer ${
                          selectedClient?.id === client.id ? 'bg-amber-50' : ''
                        }`}
                        onClick={() => insertClientQualification(client)}
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                            <User className="w-3.5 h-3.5 text-amber-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-700 truncate">{client.full_name}</p>
                            <p className="text-[10px] text-slate-400">{client.cpf_cnpj}</p>
                          </div>
                          {selectedClient?.id === client.id && (
                            <span className="text-[10px] text-amber-600 font-medium">Selecionado</span>
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

        {/* Splitter */}
        {sidebarOpen && (
          <div
            className="w-1 flex-shrink-0 bg-slate-200 hover:bg-amber-400 cursor-col-resize"
            onMouseDown={(e) => {
              isResizingSidebarRef.current = true;
              sidebarResizeStartXRef.current = e.clientX;
              sidebarResizeStartWidthRef.current = sidebarWidth;
              e.preventDefault();
            }}
          />
        )}

        {/* Área do Editor Syncfusion */}
        <div className="syncfusion-editor-wrapper">
          <SyncfusionEditor
            ref={editorRef}
            id="petition-main-editor"
            height="100%"
            readOnly={!isOnline}
            showPropertiesPane
            showNavigationPane={false}
            onContentChange={handleContentChange}
            onRequestInsertBlock={() => {
              setBlockSearchQuery('');
              setShowBlockSearchModal(true);
            }}
            onRequestCompanyLookup={() => {
              openCompanyLookup();
            }}
            onRequestCreateBlockFromSelection={(selectedText, selectedSfdt) => {
              openCreateBlockFromSelection(selectedText || '', selectedSfdt || '');
            }}
          />
        </div>

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
      </div>

      {/* Modal de Busca de Empresa (CNPJ) */}
      {showCompanyLookupModal && (
        <aside id="petition-lookup-backdrop" className="fixed inset-0 z-[100] flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
          <main id="company-lookup-modal" className="bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.12)] border border-slate-200 w-full max-w-xl my-4 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-2 w-full shrink-0 bg-orange-600" style={{ backgroundColor: '#ea580c' }} />

            <header className="relative px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400 leading-none">Qualificação Jurídica</div>
                <h3 className="mt-2 text-base sm:text-lg font-bold text-slate-900 uppercase tracking-tight leading-tight">Buscar Empresa (CNPJ)</h3>
              </div>
              <button
                onClick={() => setShowCompanyLookupModal(false)}
                className="absolute top-2 sm:top-4 right-2 sm:right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all duration-200 hover:rotate-90"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="px-6 py-6 space-y-6">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-2">Informe o CNPJ</label>
                <input
                  type="text"
                  value={companyCnpjInput}
                  onChange={(e) => setCompanyCnpjInput(e.target.value)}
                  placeholder="00.000.000/0000-00"
                  className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-slate-50 transition-all font-medium placeholder:text-slate-300"
                  autoFocus
                />
                <p className="mt-2 text-[11px] text-slate-400 italic">Aceita CNPJ com ponto, barra e hífen. O sistema considera apenas números.</p>
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
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-2">Resultado da Qualificação</label>
                  <textarea
                    value={companyLookupResultText}
                    onChange={(e) => setCompanyLookupResultText(e.target.value)}
                    rows={6}
                    className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 bg-white transition-all leading-relaxed text-slate-700 font-medium"
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
        <aside id="petition-search-backdrop" className="fixed inset-0 z-[100] flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
          <main id="block-search-modal" className="bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.12)] border border-slate-200 w-full max-w-lg my-4 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-2 w-full shrink-0 bg-orange-600" style={{ backgroundColor: '#ea580c' }} />

            <header className="relative px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400 leading-none">Biblioteca de Textos</div>
                <h3 className="mt-2 text-base sm:text-lg font-bold text-slate-900 uppercase tracking-tight leading-tight">Adicionar Bloco</h3>
              </div>
              <button
                onClick={() => setShowBlockSearchModal(false)}
                className="absolute top-2 sm:top-4 right-2 sm:right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all duration-200 hover:rotate-90"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="px-6 py-6">
              <div className="relative">
                <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar bloco..."
                  value={blockSearchQuery}
                  onChange={(e) => setBlockSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 bg-slate-50 transition-all font-medium"
                  autoFocus
                />
              </div>

              <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
                {searchFilteredBlocks.length === 0 ? (
                  <div className="p-6 text-center text-slate-400">
                    <FileText className="w-10 h-10 mx-auto mb-2" />
                    <p className="text-sm">Nenhum bloco encontrado</p>
                  </div>
                ) : (
                  searchFilteredBlocks.map((item: BlockSearchResult) => {
                    const b = item.block;
                    const matchPct = item.matchPct;
                    const showMatchPct = Boolean((blockSearchQuery || '').trim());
                    return (
                    <div
                      key={b.id}
                      className="px-4 py-3 border-b border-slate-100 hover:bg-amber-50 cursor-pointer transition-colors"
                      onClick={() => {
                        openViewBlock(b, showMatchPct ? matchPct : undefined);
                        setShowBlockSearchModal(false);
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-slate-700">{b.title}</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">
                          {getCategoryLabel(String(b.category || 'outros'))}
                        </span>
                        {showMatchPct && (
                          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold">
                            {matchPct}%
                          </span>
                        )}
                        {b.is_default && <Star className="w-3 h-3 text-amber-400" />}
                      </div>
                      {(() => {
                        const tags = getBlockTagsForUI(b);
                        if (!tags.length) return null;
                        return (
                          <div className="flex flex-wrap gap-1 mb-1">
                            {tags.map((t) => (
                              <span
                                key={t}
                                className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                      <p className="text-xs text-slate-500 line-clamp-2">
                        {(() => {
                          const plain = sfdtToPlainText(b.content);
                          const t = (plain || '').trim();
                          if (!t) return '—';
                          if (t.startsWith('{') || t.startsWith('[')) return 'Pré-visualização indisponível';
                          return t.length > 150 ? `${t.substring(0, 150)}...` : t;
                        })()}
                      </p>
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          </main>
        </aside>
      )}

      {showCategoryModal && (
        <aside id="petition-categories-backdrop" className="fixed inset-0 z-[110] flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
          <main id="petition-categories-modal" className="bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.12)] border border-slate-200 w-full max-w-2xl my-4 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-2 w-full shrink-0 bg-orange-600" style={{ backgroundColor: '#ea580c' }} />

            <header className="relative px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400 leading-none">Categorias</div>
                <h3 className="mt-2 text-base sm:text-lg font-bold text-slate-900 uppercase tracking-tight leading-tight">Configurar categorias</h3>
                <div className="mt-1 text-xs text-slate-500">Tipo: {selectedDocumentType}</div>
              </div>
              <button
                onClick={() => setShowCategoryModal(false)}
                className="absolute top-2 sm:top-4 right-2 sm:right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all duration-200 hover:rotate-90"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="flex justify-between items-center">
                <div className="text-xs text-slate-500">Edite nome e ordem. A ordem (cima → baixo) é a ordem na sidebar.</div>
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

              <div className="border border-slate-200 rounded-xl overflow-hidden">
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
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-1">Key</label>
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
                              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50"
                            />
                          </div>
                          <div className="col-span-6">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-1">Nome</label>
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
                              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50"
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
                              className="px-2 py-2 text-xs border border-slate-200 rounded-lg hover:bg-slate-50"
                              title="Mover para cima"
                            >
                              ↑
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
                              className="px-2 py-2 text-xs border border-slate-200 rounded-lg hover:bg-slate-50"
                              title="Mover para baixo"
                            >
                              ↓
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

      {showBlockModal && (
        <aside id="petition-editor-backdrop" className="fixed inset-0 z-[100] flex items-start justify-center p-2 sm:p-6 pt-8 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
          <main id="block-editor-modal" className="bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.12)] border border-slate-200 w-full max-w-7xl max-h-[92vh] my-2 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-1.5 w-full shrink-0 bg-orange-600" style={{ backgroundColor: '#ea580c' }} />

            <header className="relative px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 leading-none">Editor de Blocos</div>
                <h3 className="mt-1 text-sm sm:text-base font-bold text-slate-900 uppercase tracking-tight leading-tight">{editingBlock ? 'Editar Bloco' : 'Novo Bloco'}</h3>
              </div>
              <button
                onClick={() => setShowBlockModal(false)}
                className="absolute top-1.5 sm:top-2 right-1.5 sm:right-2 p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all duration-200 hover:rotate-90"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="p-4 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Título do Bloco *</label>
                  <input
                    type="text"
                    value={blockFormData.title}
                    onChange={(e) => setBlockFormData({ ...blockFormData, title: e.target.value })}
                    placeholder="Ex: Das Questões Iniciais"
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 transition-all font-medium bg-slate-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Categoria</label>
                  <select
                    value={blockFormData.category}
                    onChange={(e) => setBlockFormData({ ...blockFormData, category: e.target.value as BlockCategory })}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 transition-all bg-slate-50 font-medium cursor-pointer"
                  >
                    {categoryKeysOrdered.map((key) => (
                      <option key={key} value={key}>{getCategoryLabel(key)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Conteúdo SFDT *</label>
                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-inner">
                  <SyncfusionEditor
                    ref={blockEditorRef}
                    id="petition-block-editor"
                    height="620px"
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
                <div className="mt-2 p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Variáveis disponíveis</span>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    [[NOME_CLIENTE]], [[CPF]], [[RG]], [[NACIONALIDADE]], [[ESTADO_CIVIL]], [[PROFISSAO]], [[ENDERECO]], [[CIDADE]], [[UF]], [[CEP]], [[EMAIL]], [[TELEFONE]]
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-3 sm:col-span-2 space-y-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Tags</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={blockTagInput}
                      onChange={(e) => setBlockTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const tag = blockTagInput.trim();
                          if (!tag) return;
                          const tags = Array.from(new Set([...(blockFormData.tags || []), tag]));
                          setBlockFormData({ ...blockFormData, tags });
                          setBlockTagInput('');
                        }
                      }}
                      placeholder="Digite a tag e pressione Enter"
                      className="flex-1 px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 transition-all font-medium bg-slate-50"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const tag = blockTagInput.trim();
                        if (!tag) return;
                        const tags = Array.from(new Set([...(blockFormData.tags || []), tag]));
                        setBlockFormData({ ...blockFormData, tags });
                        setBlockTagInput('');
                      }}
                      className="px-3 py-2.5 text-sm font-bold rounded-lg transition-all shadow-md petition-btn-emerald"
                    >
                      Adicionar
                    </button>
                  </div>
                  {(blockFormData.tags || []).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {(blockFormData.tags || []).map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-200"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => {
                              const next = (blockFormData.tags || []).filter((t) => t !== tag);
                              setBlockFormData({ ...blockFormData, tags: next });
                            }}
                            className="text-amber-700 hover:text-amber-900"
                            title="Remover"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-slate-400">Adicione uma tag por vez. Use para facilitar a busca.</p>
                </div>
              </div>

              <label className="group flex items-center gap-4 cursor-pointer p-3 bg-amber-50/50 rounded-xl border border-amber-100 hover:bg-amber-100/50 transition-all">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={blockFormData.is_default}
                    onChange={(e) => setBlockFormData({ ...blockFormData, is_default: e.target.checked })}
                    className="peer w-5 h-5 text-amber-600 rounded-lg border-amber-300 focus:ring-amber-500 transition-all cursor-pointer appearance-none border-2 checked:bg-amber-500"
                  />
                  <CheckCircle2 className="w-3 h-3 text-white absolute left-1 opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" />
                </div>
                <div>
                  <span className="text-sm font-bold text-amber-900 uppercase tracking-tight">Incluir por padrão</span>
                  <p className="text-xs text-amber-700/70 font-medium">Este bloco será inserido automaticamente ao criar uma nova petição</p>
                </div>
              </label>
            </div>

            <footer className="px-4 py-3 border-t border-slate-100 flex justify-between bg-slate-50">
              {editingBlock && (
                <button
                  onClick={() => { deleteBlock(editingBlock.id); setShowBlockModal(false); }}
                  className="px-4 py-2 text-sm font-bold rounded-lg transition-all shadow-md petition-btn-red"
                >
                  <span>Excluir bloco</span>
                </button>
              )}
              <div className="flex gap-3 ml-auto">
                <button
                  onClick={() => setShowBlockModal(false)}
                  className="px-4 py-2 text-sm font-bold rounded-lg transition-all shadow-md petition-btn-slate"
                >
                  <span>Cancelar</span>
                </button>
                <button
                  onClick={saveBlock}
                  disabled={saving}
                  className="font-bold px-6 py-2 rounded-lg transition-all shadow-md flex items-center gap-2 petition-btn-orange"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>{editingBlock ? 'Atualizar Bloco' : 'Criar Bloco'}</span>
                    </>
                  )}
                </button>
              </div>
            </footer>
          </main>
        </aside>
      )}
    </div>
  );
};

// Estilos injetados para vencer regras globais do index.css
const petitionModalStyles = `
  /* Vencer seletores div[class*="z-50"] e div[class*="fixed"] */
  aside[id*="petition-"][class*="z-[100]"] .petition-btn-orange {
    background-color: #ea580c !important;
    color: #ffffff !important;
    opacity: 1 !important;
  }
  aside[id*="petition-"][class*="z-[100]"] .petition-btn-orange:hover {
    background-color: #c2410c !important;
  }
  aside[id*="petition-"][class*="z-[100]"] .petition-btn-emerald {
    background-color: #059669 !important;
    color: #ffffff !important;
    opacity: 1 !important;
  }
  aside[id*="petition-"][class*="z-[100]"] .petition-btn-emerald:hover {
    background-color: #047857 !important;
  }
  aside[id*="petition-"][class*="z-[100]"] .petition-btn-slate {
    background-color: #334155 !important;
    color: #ffffff !important;
    opacity: 1 !important;
  }
  aside[id*="petition-"][class*="z-[100]"] .petition-btn-slate:hover {
    background-color: #1e293b !important;
  }
  aside[id*="petition-"][class*="z-[100]"] .petition-btn-red {
    background-color: #dc2626 !important;
    color: #ffffff !important;
    opacity: 1 !important;
  }
  aside[id*="petition-"][class*="z-[100]"] .petition-btn-red:hover {
    background-color: #b91c1c !important;
  }
  
  /* Garantir que o painel do modal não seja sequestrado */
  main#company-lookup-modal,
  main#block-search-modal,
  main#block-editor-modal {
    background-color: #ffffff !important;
    color: #0f172a !important;
  }

  /* docx-preview (view do bloco) - restaurar espaçamento de parágrafos e quebras */
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

// Estilos específicos do editor de blocos (Syncfusion) para largura total e folha A4 centrada
const blockEditorModalStyles = `
  #petition-block-editor {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    overflow: hidden;
    background: #fff;
  }
  #petition-block-editor .e-documenteditorcontainer {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    height: 520px !important;
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
    padding: 12px !important;
    box-sizing: border-box !important;
    overflow: auto !important;
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
