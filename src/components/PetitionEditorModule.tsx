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
  Moon,
  Sun,
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
  Sparkles,
  Layers,
  CloudOff,
  RefreshCw,
  AlertTriangle,
  Cloud,
} from 'lucide-react';
import PetitionRibbon from './PetitionRibbon';
import { saveAs } from 'file-saver';
import { ModuleSkeleton } from './ui';
import { petitionEditorService } from '../services/petitionEditor.service';
import { settingsService } from '../services/settings.service';
import { aiService } from '../services/ai.service';
import { cloudService } from '../services/cloud.service';
import {
  nextcloudService,
  NextcloudConflictError,
  getNextcloudErrorMessage,
} from '../services/nextcloud.service';
import { resolveFreeName } from '../services/nextcloudConflict.service';
import NextcloudFileDialog, { type NextcloudSaveTarget } from './nextcloud/NextcloudFileDialog';
import { sameEntityTag } from '../utils/entityTag';
import {
  type ActiveDocumentOrigin,
  activeNextcloudPath,
  buildNextcloudFilePath,
  decideSaveTarget,
  describeOrigin,
  fileNameOf,
  normalizeDocxFileName,
  parentPathOf,
  savedLabelFor,
} from '../utils/editorDocumentOrigin';
import { type EditorDocSource, loadEditorDocSource, saveEditorDocSource, editorDocSourceSavedLabel, editorDocSourceKey } from '../utils/editorDocSource';
import {
  documentEditHistoryService,
  type DocumentEditHistoryEntry,
  type TouchDocumentEditHistoryInput,
} from '../services/documentEditHistory.service';
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
import { ligarRecargaPorBroadcast } from '../utils/broadcastReloadChannel';
import SyncfusionEditor, { SyncfusionEditorRef } from './SyncfusionEditor';
import PetitionAiChat from './PetitionAiChat';
import PetitionLiveStatusBar from './petition/PetitionLiveStatusBar';
import { createPetitionDocStatusStore } from './petition/petitionDocStatus';
import PetitionFindReplacePanel from './petition/PetitionFindReplacePanel';
import PetitionProofreaderPanel from './petition/PetitionProofreaderPanel';
import { moveCursorToSmartEnd } from '../utils/petitionSmartInsert';
import { usePetitionEditorTheme } from '../hooks/usePetitionEditorTheme';
import { useEditingPresence } from '../hooks/useNextcloudPresence';
import EditorPresenceBar from './EditorPresenceBar';
import {
  isCollabEnabled,
  isNothingToSave,
  isSaveConfirmed,
  type CollabPeer,
  type CollabSaveOutcome,
  type CollabStatus,
} from '../services/syncfusionCollab.service';
import { decideCollabSave, describeOtherEditors } from '../services/collabSaveScope';
import { profileService } from '../services/profile.service';
import { useUserAvatars } from '../hooks/useUserAvatars';
import { primeAvatar } from '../services/userAvatars';
import { layerStack, zc, zcStack } from '../styles/layers';

// Tipo do documento do editor traduzido para o vocabulário do briefing do
// Assistente IA (o formulário fala "Petição inicial", não "petition").
const DOCUMENT_TYPE_BRIEFING_LABELS: Record<string, string> = {
  petition: 'Petição inicial',
  contestation: 'Contestação',
  impugnation: 'Manifestação',
  appeal: 'Recurso',
};

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
const PETITION_LOCAL_DRAFT_STORAGE_KEY_PREFIX = 'petition-editor-local-draft-v2:';
const DEFAULT_EDITOR_ZOOM = 1.2;
const DEFAULT_BLOCK_EDITOR_ZOOM = 1.1;
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
  
  /* Container do viewer - deve encolher para caber.
     overflow: hidden de propósito: QUEM ROLA O DOCUMENTO É UM CONTAINER SÓ,
     o viewerContainer do Syncfusion. Com "auto" aqui, este elemento — que é
     ancestral do viewer — vira um segundo container rolável; na rolagem por
     inércia do macOS a rolagem encadeia entre os dois e a folha se desloca em
     relação à régua. */
  .syncfusion-editor-wrapper .e-de-ctn {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    overflow: hidden !important;
    background: #eef0f3 !important;
  }

  /* Viewer interno */
  .syncfusion-editor-wrapper .e-de-viewer-container {
    min-width: 0 !important;
  }

  /* Editor principal sem a moldura cinza do workspace do Syncfusion. */
  #petition-main-editor,
  #petition-main-editor > div,
  #petition-main-editor .e-de-ctn,
  #petition-main-editor [id$="_viewerContainer"] {
    height: 100% !important;
    min-height: 100% !important;
  }

  /* O tema do Syncfusion reserva 40px para a status bar nativa mesmo quando
     ela está oculta. Como usamos a PetitionStatusBar fora do container, essa
     reserva cortava o final visível da página. */
  #petition-main-editor .e-de-tool-ctnr-properties-pane,
  #petition-main-editor .e-de-ctnr-properties-pane,
  #petition-main-editor .e-de-ribbon-simplified-ctnr-properties-pane,
  #petition-main-editor .e-de-ribbon-classic-ctnr-properties-pane {
    height: 100% !important;
  }

  #petition-main-editor [id$="_viewerContainer"] {
    background: #eef0f3 !important;
  }

  #petition-main-editor .e-de-background {
    background: #eef0f3 !important;
    min-height: 100% !important;
  }

  /* NÃO aplicar filter (drop-shadow, blur…) neste canvas.
     -----------------------------------------------------------------------
     Era a causa da deformação das bordas na rolagem rápida com inversão de
     sentido. O Syncfusion repinta este canvas a CADA evento de rolagem, e o
     canvas é TRANSPARENTE fora da folha — medido: 18,5 px totalmente
     transparentes no vão entre duas páginas. Um drop-shadow é calculado a
     partir dessa silhueta de transparência, então a sombra existe exatamente
     na borda superior, na borda inferior e no vão entre páginas. Como o filtro
     obriga o Chrome a rasterizar uma camada composta à parte a cada repintura,
     nas rolagens rápidas a sombra e o conteúdo do canvas chegam à tela em
     quadros diferentes — a borda aparece esticada/duplicada/deslocada,
     enquanto o texto (no miolo, longe da sombra) continua correto.

     A folha continua delimitada pelo contorno que o próprio Syncfusion desenha
     DENTRO do canvas (pageOutline, um strokeRect por página): mesma função
     visual, sem camada de filtro e sem custo por quadro. */

  .syncfusion-editor-wrapper .e-de-page-container {
    width: 100% !important;
    min-width: 0 !important;
    display: flex !important;
    justify-content: center !important;
    align-items: flex-start !important;
    padding: 0 !important;
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

  /* Editor principal: a status bar nativa dá lugar à PetitionStatusBar */
  .petition-editor-root .syncfusion-editor-wrapper .e-de-status-bar,
  .petition-editor-root .syncfusion-editor-wrapper .e-de-ctnr-status-bar,
  #petition-main-editor .e-de-status-bar,
  #petition-main-editor .e-de-ctnr-status-bar {
    display: none !important;
  }

  /* ========== STATUS BAR CUSTOMIZADA (estilo Word) ========== */
  .pet-statusbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 28px;
    padding: 0 12px;
    flex-shrink: 0;
    background: #fafafa;
    border-top: 1px solid #e2e4e8;
    font-size: 11.5px;
    color: #6b7280;
    user-select: none;
    z-index: 30;
  }
  .pet-statusbar-left, .pet-statusbar-right { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .pet-statusbar-item { white-space: nowrap; }
  .pet-statusbar-sep { width: 1px; height: 14px; background: #e2e4e8; }
  .pet-statusbar-modes { display: flex; align-items: center; gap: 2px; }
  .pet-statusbar-mode-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 22px; border: none; border-radius: 5px;
    background: transparent; color: #9ca3af; cursor: pointer;
    transition: background .15s ease, color .15s ease;
  }
  .pet-statusbar-mode-btn:hover { background: #eef0f3; color: #374151; }
  .pet-statusbar-mode-btn.is-active { background: #e5e9f2; color: #2563eb; }
  .pet-statusbar-zoom { display: flex; align-items: center; gap: 6px; }
  .pet-statusbar-zoom-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border: none; border-radius: 5px;
    background: transparent; color: #9ca3af; cursor: pointer;
    transition: background .15s ease, color .15s ease;
  }
  .pet-statusbar-zoom-btn:hover { background: #eef0f3; color: #374151; }
  .pet-statusbar-zoom-btn:disabled { opacity: .35; cursor: default; }
  .pet-statusbar-zoom-slider {
    width: 90px; height: 3px; appearance: none; -webkit-appearance: none;
    background: #d2d6dc; border-radius: 3px; outline: none; cursor: pointer;
  }
  .pet-statusbar-zoom-slider::-webkit-slider-thumb {
    appearance: none; -webkit-appearance: none;
    width: 11px; height: 11px; border-radius: 50%;
    background: #6b7280; border: 2px solid #fafafa;
    box-shadow: 0 0 0 1px #d2d6dc; cursor: grab;
  }
  .pet-statusbar-zoom-slider::-moz-range-thumb {
    width: 11px; height: 11px; border-radius: 50%;
    background: #6b7280; border: 2px solid #fafafa;
    box-shadow: 0 0 0 1px #d2d6dc; cursor: grab;
  }
  .pet-statusbar-zoom-pct {
    min-width: 40px; text-align: right; border: none; background: transparent;
    font-size: 11.5px; color: #6b7280; cursor: pointer; padding: 2px 4px;
    border-radius: 5px; transition: background .15s ease, color .15s ease;
  }
  .pet-statusbar-zoom-pct:hover { background: #eef0f3; color: #374151; }
  @media (max-width: 640px) {
    .pet-statusbar-zoom-slider { display: none; }
    .pet-statusbar-left .pet-statusbar-item + .pet-statusbar-sep,
    .pet-statusbar-left .pet-statusbar-sep + .pet-statusbar-item { display: none; }
  }
  body.petition-dark .pet-statusbar { background: #262626; border-top-color: #3d3d3d; color: #a3a3a3; }
  body.petition-dark .pet-statusbar-sep { background: #3d3d3d; }
  body.petition-dark .pet-statusbar-mode-btn { color: #737373; }
  body.petition-dark .pet-statusbar-mode-btn:hover { background: #333; color: #d4d4d4; }
  body.petition-dark .pet-statusbar-mode-btn.is-active { background: #1e2a44; color: #60a5fa; }
  body.petition-dark .pet-statusbar-zoom-btn { color: #737373; }
  body.petition-dark .pet-statusbar-zoom-btn:hover { background: #333; color: #d4d4d4; }
  body.petition-dark .pet-statusbar-zoom-slider { background: #4a4a4a; }
  body.petition-dark .pet-statusbar-zoom-slider::-webkit-slider-thumb { background: #a3a3a3; border-color: #262626; box-shadow: 0 0 0 1px #4a4a4a; }
  body.petition-dark .pet-statusbar-zoom-pct { color: #a3a3a3; }
  body.petition-dark .pet-statusbar-zoom-pct:hover { background: #333; color: #d4d4d4; }
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

  /* ========== MODO ESCURO (body.petition-dark) ========== */
  /* Chrome do editor: fundos, painel de propriedades, régua e status bar. */
  body.petition-dark .syncfusion-editor-wrapper { background: #1b1b1b; }
  body.petition-dark .syncfusion-editor-wrapper .e-de-tool-ctnr-properties-pane,
  body.petition-dark .syncfusion-editor-wrapper .e-de-ctnr-properties-pane,
  body.petition-dark .syncfusion-editor-wrapper .e-de-ribbon-simplified-ctnr-properties-pane,
  body.petition-dark .syncfusion-editor-wrapper .e-de-ribbon-classic-ctnr-properties-pane {
    background: #1f1f1f !important;
  }
  /* NÃO aplicar filter no .e-de-ctn: ele é o container rolável e abriga
     overlays (menu de contexto, status bar). Um filter ali cria novo
     containing block, prendendo/recortando o menu de contexto e
     re-invertendo a status bar. Invertemos apenas a folha, abaixo. */
  body.petition-dark .syncfusion-editor-wrapper .e-de-ctn {
    background: #252525 !important;
  }

  /* O editor principal possui regras claras com seletor por ID acima.
     Sem uma contraparte igualmente específica, o espaço virtualizado entre
     páginas volta a ficar branco durante a rolagem. */
  body.petition-dark #petition-main-editor,
  body.petition-dark #petition-main-editor > div,
  body.petition-dark #petition-main-editor .e-documenteditorcontainer,
  body.petition-dark #petition-main-editor .e-de-ctnr,
  body.petition-dark #petition-main-editor .e-de-ctnr-container,
  body.petition-dark #petition-main-editor .e-de-ctn,
  body.petition-dark #petition-main-editor .e-de-viewer-container,
  body.petition-dark #petition-main-editor [id$="_viewerContainer"],
  body.petition-dark #petition-main-editor .e-de-background,
  body.petition-dark #petition-main-editor .e-de-page-container {
    background: #252525 !important;
    background-color: #252525 !important;
  }

  /* Folha: nesta versão do Syncfusion NÃO existe .e-de-page-container no
     DOM — o container real é .e-de-background, e as páginas (fundo branco
     + texto) são PINTADAS em dois <canvas> filhos dele (conteúdo e
     seleção), verificado no fonte do pacote. Invertemos os canvas: página
     branca vira escura, texto preto vira claro. Os vãos entre páginas são
     transparentes no canvas e mostram o div escuro atrás. Filtro apenas
     de tela; export/impressão saem normais. */
  body.petition-dark .syncfusion-editor-wrapper .e-de-background {
    background: #252525 !important;
  }
  /* Único filter que sobrevive no canvas — e só porque é per-pixel puro
     (invert/hue-rotate não leem pixels vizinhos, não criam geometria fora do
     canvas e por isso não deslocam borda nenhuma). NÃO acrescentar aqui nada
     baseado em desfoque — drop-shadow, blur — pelo motivo explicado na regra
     do modo claro. */
  body.petition-dark .syncfusion-editor-wrapper .e-de-background canvas {
    filter: invert(0.92) hue-rotate(180deg);
  }
  /* Cursor de digitação visível sobre a folha escura. */
  body.petition-dark .syncfusion-editor-wrapper .e-de-blink-cursor {
    background: #ffffff !important;
    border-left: 2px solid #ffffff !important;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.18), 0 0 8px rgba(255,255,255,0.55) !important;
    opacity: 1 !important;
    width: 2px !important;
    min-width: 2px !important;
  }

  /* Status bar: filhos (input de página, Spelling, zoom) também escuros. */
  body.petition-dark .syncfusion-editor-wrapper .e-de-status-bar input,
  body.petition-dark .syncfusion-editor-wrapper .e-de-status-bar button,
  body.petition-dark .syncfusion-editor-wrapper .e-de-status-bar .e-btn,
  body.petition-dark .syncfusion-editor-wrapper .e-de-ctnr-pagenumber,
  body.petition-dark .syncfusion-editor-wrapper .e-de-statusbar-zoom,
  body.petition-dark .syncfusion-editor-wrapper .e-de-statusbar-spellcheck {
    background: #333333 !important;
    color: #e5e7eb !important;
    border-color: #4a4a4a !important;
  }

  /* Menu de contexto do Syncfusion (portado para fora do editor). */
  body.petition-dark .e-de-contextmenu-wrapper .e-menu-parent,
  body.petition-dark .e-contextmenu-wrapper .e-menu-parent {
    background: #2f2f2f !important;
    border-color: #454545 !important;
  }
  body.petition-dark .e-de-contextmenu-wrapper .e-menu-item,
  body.petition-dark .e-contextmenu-wrapper .e-menu-item {
    color: #e5e7eb !important;
  }
  body.petition-dark .e-de-contextmenu-wrapper .e-menu-item.e-focused,
  body.petition-dark .e-contextmenu-wrapper .e-menu-item.e-focused,
  body.petition-dark .e-de-contextmenu-wrapper .e-menu-item:hover,
  body.petition-dark .e-contextmenu-wrapper .e-menu-item:hover {
    background: #3a3a3a !important;
  }
  body.petition-dark .e-de-contextmenu-wrapper .e-separator,
  body.petition-dark .e-contextmenu-wrapper .e-separator {
    border-bottom-color: #454545 !important;
  }

  /* Painel Localizar/Substituir (options pane). */
  body.petition-dark .syncfusion-editor-wrapper .e-de-op,
  body.petition-dark .syncfusion-editor-wrapper .e-de-op-header,
  body.petition-dark .syncfusion-editor-wrapper .e-de-op-dlg-footer {
    background: #2b2b2b !important;
    color: #e5e7eb !important;
    border-color: #3d3d3d !important;
  }
  body.petition-dark .syncfusion-editor-wrapper .e-de-op input {
    background: #333333 !important;
    color: #e5e7eb !important;
    border-color: #4a4a4a !important;
  }
  body.petition-dark .syncfusion-editor-wrapper .e-de-pane,
  body.petition-dark .syncfusion-editor-wrapper .e-de-pane-rtl,
  body.petition-dark .syncfusion-editor-wrapper .e-de-property-pane {
    background: #2b2b2b !important;
    border-left-color: #3d3d3d !important;
    color: #e5e7eb !important;
  }
  /* Réguas: os containers usam ID (…_hRuler/…_vRuler), não classe —
     verificado no fonte do pacote. Ticks/números são desenhados escuros,
     então inverter é a forma de mantê-los legíveis em fundo escuro. */
  body.petition-dark .syncfusion-editor-wrapper .e-de-ruler-margin,
  body.petition-dark .syncfusion-editor-wrapper .e-de-ruler-markIndicator {
    background: #1a1a1a !important;
    border-color: #2f2f2f !important;
  }
  body.petition-dark .syncfusion-editor-wrapper .e-de-hRuler,
  body.petition-dark .syncfusion-editor-wrapper .e-de-vRuler {
    background: #4a4a4a !important;
    border-color: #6a6a6a !important;
  }
  body.petition-dark .syncfusion-editor-wrapper div[id$="_hRuler"],
  body.petition-dark .syncfusion-editor-wrapper div[id$="_vRuler"],
  body.petition-dark .syncfusion-editor-wrapper div[id$="_markIndicator"],
  body.petition-dark .syncfusion-editor-wrapper .e-de-hRuler,
  body.petition-dark .syncfusion-editor-wrapper .e-de-vRuler,
  body.petition-dark .syncfusion-editor-wrapper .e-de-hruler,
  body.petition-dark .syncfusion-editor-wrapper .e-de-vruler {
    filter: none !important;
  }
  body.petition-dark #petition-main-editor div[id$="_hRuler"],
  body.petition-dark #petition-main-editor .e-de-hRuler,
  body.petition-dark #petition-main-editor .e-de-ruler-markIndicator,
  body.petition-dark #petition-block-editor div[id$="_hRuler"],
  body.petition-dark #petition-block-editor .e-de-hRuler,
  body.petition-dark #petition-block-editor .e-de-ruler-markIndicator {
    color: #c7ccd4 !important;
    background: #3b3d42 !important;
    border-color: #55585f !important;
  }
  body.petition-dark #petition-main-editor .e-de-ruler-indent-svg,
  body.petition-dark #petition-main-editor .e-de-ruler-tab-svg,
  body.petition-dark #petition-main-editor .e-de-ruler-table-svg,
  body.petition-dark #petition-block-editor .e-de-ruler-indent-svg,
  body.petition-dark #petition-block-editor .e-de-ruler-tab-svg,
  body.petition-dark #petition-block-editor .e-de-ruler-table-svg {
    fill: #d4d8df !important;
    stroke: #8e959f !important;
  }
  #petition-main-editor .crm-pinned-ruler-host,
  #petition-block-editor .crm-pinned-ruler-host {
    position: relative !important;
  }
  #petition-main-editor .crm-pinned-horizontal-ruler,
  #petition-block-editor .crm-pinned-horizontal-ruler {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    margin-top: 0 !important;
    z-index: 24 !important;
  }
  body.petition-dark .syncfusion-editor-wrapper .e-de-ruler-tick {
    stroke: #d6d6d6 !important;
  }
  body.petition-dark .syncfusion-editor-wrapper .e-de-ruler-tick-label {
    fill: rgba(255, 255, 255, 0.88) !important;
  }
  body.petition-dark .syncfusion-editor-wrapper .e-de-status-bar,
  body.petition-dark .syncfusion-editor-wrapper .e-de-ctnr-status-bar,
  body.petition-dark .syncfusion-editor-wrapper .e-de-statusbar,
  body.petition-dark .syncfusion-editor-wrapper .e-de-ctnr-statusbar,
  body.petition-dark .syncfusion-editor-wrapper .e-de-ctnr-statusbar-div {
    background: #2b2b2b !important;
    color: #d0d6df !important;
  }


  /* Fundo geral da área de edição. */
  body.petition-dark .petition-editor-root { background: #1b1b1b !important; }

  /* Painel lateral (Blocos / Clientes). As classes do Tailwind com cores
     fixas são alvejadas por seletor de atributo (~=), evitando escape. */
  body.petition-dark .petition-sidebar {
    background: #242424 !important;
    border-right-color: #3a3a3a !important;
    box-shadow: none !important;
  }
  body.petition-dark .petition-sidebar [class~="bg-[#f7f8fa]"],
  body.petition-dark .petition-sidebar [class~="bg-[#eef0f3]"],
  body.petition-dark .petition-sidebar [class~="bg-[#ffffff]"],
  body.petition-dark .petition-sidebar [class~="bg-[#eef0f3]"],
  body.petition-dark .petition-sidebar [class~="bg-[#eef2f7]"] { background-color: #2b2b2b !important; }
  body.petition-dark .petition-sidebar [class~="bg-white"] { background-color: #333333 !important; }
  body.petition-dark .petition-sidebar [class~="border-[#e3e6ea]"],
  body.petition-dark .petition-sidebar [class~="border-[#e6dfd3]"] { border-color: #3d3d3d !important; }
  body.petition-dark .petition-sidebar [class~="text-slate-700"],
  body.petition-dark .petition-sidebar [class~="text-slate-600"],
  body.petition-dark .petition-sidebar [class~="text-slate-500"] { color: #d5d9e1 !important; }
  body.petition-dark .petition-sidebar [class~="text-slate-400"] { color: #909090 !important; }
  body.petition-dark .petition-sidebar input,
  body.petition-dark .petition-sidebar select,
  body.petition-dark .petition-sidebar textarea {
    background-color: #333333 !important;
    color: #eef2f7 !important;
    border-color: #4a4a4a !important;
  }
  /* Pega-tudo: qualquer bg arbitrário do Tailwind (bg-[#...]) na lateral
     vira escuro; os acentos laranja são restaurados logo abaixo (regras
     posteriores de mesma especificidade vencem). */
  body.petition-dark .petition-sidebar [class*="bg-["] { background-color: #262626 !important; }
  body.petition-dark .petition-sidebar [class*="border-[#"] { border-color: #3d3d3d !important; }
  body.petition-dark .petition-sidebar [class*="hover:bg-"]:hover { background-color: #343434 !important; }
  body.petition-dark .petition-sidebar [class*="bg-[#eff6ff]"] { background-color: #4b3f28 !important; } /* cliente selecionado */
  body.petition-dark .petition-sidebar [class*="bg-[#2563eb]"] { background-color: #2563eb !important; } /* botão + (novo bloco) */
  body.petition-dark .petition-sidebar [class*="bg-[#2f6fa8]"] { background-color: #2f6fa8 !important; }
  body.petition-dark .petition-sidebar [class~="bg-blue-100"] { background-color: #544225 !important; }
  body.petition-dark .petition-sidebar [class~="text-blue-700"] { color: #f8c968 !important; }
  body.petition-dark .petition-sidebar [class~="text-slate-800"],
  body.petition-dark .petition-sidebar [class~="text-slate-900"] { color: #eef2f7 !important; }
  body.petition-dark .petition-sidebar [class~="shadow-sm"],
  body.petition-dark .petition-sidebar [class*="shadow-["] { box-shadow: none !important; }
  /* Splitter da lateral (fica fora do .petition-sidebar) */
  body.petition-dark .petition-editor-root [class~="bg-slate-200"] { background-color: #3a3a3a !important; }

  /* Alça que traz a biblioteca de volta. Encostada na borda esquerda da área
     da página, centrada na altura visível — não rola com o documento. */
  .petition-library-handle {
    position: absolute; left: 0; top: 50%; transform: translateY(-50%);
    z-index: 21; width: 26px; padding: 14px 0; display: flex; flex-direction: column;
    align-items: center; gap: 7px; border: 1px solid #d8dde6; border-left: 0;
    border-radius: 0 8px 8px 0; background: #fff; color: #2563eb; cursor: pointer;
    box-shadow: 2px 0 10px rgba(16,24,40,.07);
    transition: width .15s ease, background .15s ease, border-color .15s ease;
  }
  .petition-library-handle:hover { width: 30px; background: #f0f5ff; border-color: #b8cdf5; }
  .petition-library-handle:focus-visible {
    outline: none; border-color: #84adff; box-shadow: 0 0 0 3px rgba(47,101,234,.18);
  }
  .petition-library-handle-label {
    writing-mode: vertical-rl; font-size: 10px; font-weight: 600; letter-spacing: .06em;
  }
  /* Recolher é a MESMA alça, agora pendurada na borda de fora do painel. */
  .petition-library-handle.is-collapse { left: 100%; }
  body.petition-dark .petition-library-handle {
    border-color: #3a3d44; background: #25262a; color: #75a7ff;
    box-shadow: 2px 0 10px rgba(0,0,0,.28);
  }
  body.petition-dark .petition-library-handle:hover { background: #1e3655; border-color: #365f8d; }

  /* Biblioteca lateral integrada ao editor. */
  .petition-sidebar {
    color: #334155;
    background: #f8fafc !important;
    border-right: 1px solid #dfe4ea !important;
    box-shadow: 1px 0 0 rgba(255,255,255,.9), 8px 0 24px rgba(15,23,42,.025) !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .petition-sidebar-header {
    min-height: 52px; display: flex; align-items: center; justify-content: space-between;
    gap: 10px; padding: 0 12px 0 14px; background: #fff; border-bottom: 1px solid #e7ebf0;
  }
  .petition-sidebar-heading { min-width: 0; display: flex; align-items: center; gap: 9px; }
  .petition-sidebar-heading-icon {
    width: 28px; height: 28px; flex: 0 0 auto; display: inline-flex; align-items: center;
    justify-content: center; border-radius: 8px; color: #2563eb; background: #eff6ff;
    border: 1px solid #dbeafe;
  }
  .petition-sidebar-heading strong {
    display: block; color: #1e293b; font-size: 12px; font-weight: 700; line-height: 1.2;
  }
  .petition-sidebar-heading span {
    display: block; margin-top: 2px; color: #94a3b8; font-size: 9px; font-weight: 600;
    letter-spacing: .08em; line-height: 1.1; text-transform: uppercase;
  }
  .petition-sidebar-close {
    width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
    flex: 0 0 auto; border: 0; border-radius: 7px; background: transparent; color: #94a3b8;
    cursor: pointer; transition: background .15s ease, color .15s ease;
  }
  .petition-sidebar-close:hover { color: #475569; background: #f1f5f9; }
  .petition-sidebar-tabs {
    min-height: 46px; display: flex; align-items: center; gap: 4px;
    border-bottom: 1px solid #e7ebf0; background: #fff; padding: 7px 10px;
  }
  .petition-sidebar-tab {
    height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    position: relative; flex: 1; border: 1px solid transparent; border-radius: 7px;
    background: transparent; color: #64748b; padding: 0 10px; font-size: 11px;
    font-weight: 650; cursor: pointer; transition: color .15s ease, background .15s ease, border-color .15s ease;
  }
  .petition-sidebar-tab:hover { color: #334155; background: #f8fafc; }
  .petition-sidebar-tab.is-active { color: #1d4ed8; border-color: #dbeafe; background: #eff6ff; }
  .petition-sidebar-tab-count {
    min-width: 17px; height: 17px; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 999px; padding: 0 5px; background: rgba(148,163,184,.14); color: #64748b;
    font-size: 9px; font-variant-numeric: tabular-nums;
  }
  .petition-sidebar-tab.is-active .petition-sidebar-tab-count { background: #dbeafe; color: #2563eb; }
  .petition-sidebar-context { padding: 11px 10px 9px !important; }
  .petition-sidebar-search { padding: 0 10px 10px !important; }
  .petition-sidebar-field-label {
    display: flex; align-items: center; justify-content: space-between; min-height: 22px;
    margin-bottom: 5px; padding: 0 2px;
  }
  .petition-sidebar-field-label > span {
    color: #94a3b8; font-size: 9px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  }
  .petition-sidebar-field-actions { display: flex; align-items: center; gap: 2px; }
  .petition-sidebar-field-actions button {
    width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 6px; background: transparent; color: #94a3b8; cursor: pointer;
  }
  .petition-sidebar-field-actions button:hover { color: #2563eb; background: #eff6ff; }
  .petition-sidebar-context select,
  .petition-sidebar-search input,
  .petition-sidebar-search select {
    height: 34px; border-radius: 7px !important; border-color: #dfe4ea !important;
    box-shadow: 0 1px 1px rgba(15,23,42,.025) !important;
  }
  .petition-sidebar-context select:focus,
  .petition-sidebar-search input:focus,
  .petition-sidebar-search select:focus {
    border-color: #93c5fd !important; box-shadow: 0 0 0 3px rgba(59,130,246,.10) !important;
    outline: none;
  }
  .petition-sidebar-toolbar { display: flex; align-items: center; gap: 6px; margin-top: 7px; }
  .petition-sidebar-toolbar select { flex: 1; width: auto !important; min-width: 0; }
  .petition-sidebar-tool-button {
    width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center;
    flex: 0 0 auto; border: 1px solid #dfe4ea; border-radius: 7px; background: #fff;
    color: #64748b; cursor: pointer; box-shadow: 0 1px 1px rgba(15,23,42,.025);
    transition: border-color .15s ease, background .15s ease, color .15s ease;
  }
  .petition-sidebar-tool-button:hover { border-color: #bfdbfe; color: #2563eb; background: #f8fbff; }
  .petition-sidebar-tool-button.is-primary {
    width: auto; gap: 6px; padding: 0 10px; border-color: #2563eb; background: #2563eb;
    color: #fff; font-size: 10px; font-weight: 700; box-shadow: 0 1px 2px rgba(37,99,235,.2);
  }
  .petition-sidebar-tool-button.is-primary:hover { border-color: #1d4ed8; background: #1d4ed8; color: #fff; }
  .petition-sidebar-scope {
    min-height: 42px; padding: 6px 10px 8px !important; background: #fff !important;
    border-bottom: 1px solid #e7ebf0 !important;
  }
  .petition-sidebar-scope > span { display: none; }
  .petition-sidebar-scope > div {
    width: 100%; border: 0 !important; border-radius: 7px !important; padding: 2px !important;
    background: #f1f5f9 !important;
  }
  .petition-sidebar-scope button {
    border-radius: 5px !important; padding-top: 5px !important; padding-bottom: 5px !important;
    color: #64748b; font-size: 10px !important;
  }
  .petition-sidebar-scope button[class*="bg-[#2563eb]"],
  .petition-sidebar-scope button[class*="bg-[#2f6fa8]"],
  .petition-sidebar-scope button[class*="bg-slate-700"] {
    background: #fff !important; color: #1d4ed8 !important;
    box-shadow: 0 1px 3px rgba(15,23,42,.10) !important;
  }
  .petition-sidebar-list { scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
  .petition-sidebar-category { border-bottom: 1px solid #edf0f3 !important; }
  .petition-sidebar-category-button {
    min-height: 42px; padding: 0 12px !important; color: #475569 !important;
    font-size: 11px !important; font-weight: 700 !important; letter-spacing: .01em;
  }
  .petition-sidebar-category-button:hover { background: #f1f5f9 !important; }
  .petition-sidebar-category-chevron {
    width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center;
    flex: 0 0 auto; border-radius: 5px; color: #94a3b8; background: #f1f5f9;
  }
  .petition-sidebar-category-count {
    margin-left: auto; color: #94a3b8; font-size: 9px; font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .petition-sidebar-block {
    position: relative; border: 1px solid transparent !important; border-radius: 8px !important;
    background: transparent !important; padding: 8px !important;
  }
  .petition-sidebar-block:hover {
    border-color: #dbe5f1 !important; background: #fff !important;
    box-shadow: 0 1px 2px rgba(15,23,42,.04);
  }
  .petition-sidebar-block-icon {
    width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
    flex: 0 0 auto; border-radius: 6px; color: #64748b; background: #eef2f7;
  }
  .petition-sidebar-block:hover .petition-sidebar-block-icon { color: #2563eb; background: #eff6ff; }
  .petition-sidebar-empty {
    min-height: 210px; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 28px 22px; color: #94a3b8; text-align: center;
  }
  .petition-sidebar-empty-icon {
    width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center;
    margin-bottom: 10px; border: 1px solid #e2e8f0; border-radius: 10px; color: #94a3b8;
    background: #fff; box-shadow: 0 1px 2px rgba(15,23,42,.04);
  }
  .petition-sidebar-empty strong { color: #475569; font-size: 11px; font-weight: 700; }
  .petition-sidebar-empty p { max-width: 210px; margin-top: 4px; font-size: 10px; line-height: 1.5; }
  .petition-sidebar-client {
    position: relative; margin: 3px 6px; padding: 9px 8px; border: 1px solid transparent;
    border-radius: 8px; cursor: pointer; transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
  }
  .petition-sidebar-client:hover { border-color: #dbe5f1; background: #fff; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
  .petition-sidebar-client.is-selected { border-color: #bfdbfe; background: #eff6ff; }
  .petition-sidebar-client-avatar {
    width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
    flex: 0 0 auto; border-radius: 8px; color: #64748b; background: #e9eef5;
    font-size: 10px; font-weight: 750; letter-spacing: .02em;
  }
  .petition-sidebar-client.is-selected .petition-sidebar-client-avatar { color: #1d4ed8; background: #dbeafe; }
  .petition-sidebar-client-action {
    min-width: 25px; height: 25px; display: inline-flex; align-items: center; justify-content: center;
    gap: 4px; border: 1px solid #dbeafe; border-radius: 6px; padding: 0 7px; background: #fff;
    color: #2563eb; font-size: 9px; font-weight: 700; opacity: 0; cursor: pointer;
    transition: opacity .15s ease, background .15s ease;
  }
  .petition-sidebar-client:hover .petition-sidebar-client-action,
  .petition-sidebar-client:focus-within .petition-sidebar-client-action { opacity: 1; }
  .petition-sidebar-client-action:hover { background: #eff6ff; }
  .petition-sidebar-resizer {
    width: 3px !important; background: #e7ebf0 !important; cursor: col-resize;
    transition: background .15s ease;
  }
  .petition-sidebar-resizer:hover { background: #60a5fa !important; }
  body.petition-dark .petition-sidebar { background: #242424 !important; border-right-color: #3d3d3d !important; }
  body.petition-dark .petition-sidebar-header,
  body.petition-dark .petition-sidebar-tabs { background: #262626; border-color: #3d3d3d; }
  body.petition-dark .petition-sidebar-heading-icon { color: #60a5fa; background: #1e3655; border-color: #284a72; }
  body.petition-dark .petition-sidebar-heading strong { color: #e5e7eb; }
  body.petition-dark .petition-sidebar-tab { color: #a3a3a3; }
  body.petition-dark .petition-sidebar-tab:hover { background: #303030; color: #e5e7eb; }
  body.petition-dark .petition-sidebar-tab.is-active { color: #93c5fd; background: #1e3655; border-color: #284a72; }
  body.petition-dark .petition-sidebar-scope { background: #2b2b2b !important; border-color: #3d3d3d !important; }
  body.petition-dark .petition-sidebar-scope > div { background: #202020 !important; }
  body.petition-dark .petition-sidebar-scope button[class*="bg-"] { background: #383838 !important; color: #93c5fd !important; }
  body.petition-dark .petition-sidebar-block:hover { background: #303030 !important; border-color: #454545 !important; }
  body.petition-dark .petition-sidebar-block-icon { background: #383838; color: #a3a3a3; }
  body.petition-dark .petition-sidebar-empty-icon { background: #303030; border-color: #454545; }
  body.petition-dark .petition-sidebar-empty strong { color: #d4d4d4; }
  body.petition-dark .petition-sidebar-client:hover { background: #303030; border-color: #454545; }
  body.petition-dark .petition-sidebar-client.is-selected { background: #1e3655; border-color: #284a72; }
  body.petition-dark .petition-sidebar-client-avatar { background: #383838; color: #d4d4d4; }

  /* V2 — superfície única, densidade Office e hierarquia sem cartões empilhados. */
  .petition-sidebar {
    color: #303846; background: #fff !important; border-right-color: #d9dee7 !important;
    box-shadow: none !important;
  }
  .petition-sidebar-header {
    height: 45px; min-height: 45px; align-items: stretch; gap: 4px;
    padding: 0 6px 0 10px; border-bottom-color: #e3e7ed; background: #fff;
  }
  .petition-sidebar-header .petition-sidebar-tabs {
    min-width: 0; flex: 1; align-items: stretch; gap: 18px; padding: 0;
    border: 0; background: transparent;
  }
  .petition-sidebar-tab {
    height: 45px; flex: 0 1 auto; gap: 6px; padding: 0 2px; border: 0;
    border-radius: 0; color: #667085; background: transparent; font-size: 11px; font-weight: 600;
  }
  .petition-sidebar-tab:hover { color: #344054; background: transparent; }
  .petition-sidebar-tab.is-active { color: #1d4ed8; border-color: transparent; background: transparent; }
  .petition-sidebar-tab.is-active::after {
    content: ''; position: absolute; right: 0; bottom: -1px; left: 0; height: 2px;
    border-radius: 2px 2px 0 0; background: #2563eb;
  }
  .petition-sidebar-tab-count,
  .petition-sidebar-tab.is-active .petition-sidebar-tab-count {
    min-width: auto; height: auto; padding: 0; border-radius: 0; background: transparent;
    color: #98a2b3; font-size: 9px; font-weight: 600;
  }
  .petition-sidebar-tab.is-active .petition-sidebar-tab-count { color: #2563eb; }
  .petition-sidebar-close {
    width: 28px; height: 28px; align-self: center; border-radius: 5px; color: #8a94a4;
  }
  .petition-sidebar-close:hover { color: #344054; background: #f0f2f5; }
  .petition-sidebar-controls { background: #fbfcfe; border-bottom: 1px solid #e3e7ed; }
  .petition-sidebar-context { padding: 10px 12px 7px !important; }
  .petition-sidebar-search { padding: 0 12px 8px !important; }
  .petition-sidebar-field-label { min-height: 20px; margin-bottom: 4px; padding: 0; }
  .petition-sidebar-field-label > span {
    color: #667085; font-size: 10px; font-weight: 600; letter-spacing: 0; text-transform: none;
  }
  .petition-sidebar-field-actions { gap: 1px; }
  .petition-sidebar-field-actions button {
    width: 22px; height: 22px; border-radius: 5px; color: #8a94a4;
  }
  .petition-sidebar-field-actions button:hover { color: #344054; background: #eceff3; }
  .petition-sidebar-context select,
  .petition-sidebar-search input,
  .petition-sidebar-search select {
    height: 34px; border-radius: 6px !important; border-color: #d8dde6 !important;
    box-shadow: 0 1px 2px rgba(16,24,40,.035) !important;
  }
  .petition-sidebar-context select:focus,
  .petition-sidebar-search input:focus,
  .petition-sidebar-search select:focus {
    border-color: #84adff !important; box-shadow: 0 0 0 3px rgba(47,101,234,.10) !important;
  }
  .petition-sidebar-context-selector { position: relative; }
  .petition-sidebar-context-selector > span {
    position: absolute; z-index: 1; top: 50%; left: 11px; width: 6px; height: 6px;
    transform: translateY(-50%); border-radius: 999px; box-shadow: 0 0 0 3px rgba(148,163,184,.12);
    pointer-events: none;
  }
  .petition-sidebar-context-selector select { padding-left: 27px !important; }
  .petition-sidebar-toolbar { gap: 5px; margin-top: 6px; }
  .petition-sidebar-tool-button {
    border-color: #d8dde6; border-radius: 6px; color: #667085;
    box-shadow: 0 1px 2px rgba(16,24,40,.035);
  }
  .petition-sidebar-tool-button:hover { border-color: #b8c0cc; color: #344054; background: #f8f9fb; }
  .petition-sidebar-tool-button.is-primary {
    gap: 5px; border-color: #2f65ea; background: #2f65ea; font-weight: 650;
    box-shadow: 0 1px 2px rgba(47,101,234,.24);
  }
  .petition-sidebar-tool-button.is-primary:hover { border-color: #2457d6; background: #2457d6; }
  .petition-sidebar-scope {
    min-height: 32px; padding: 0 12px 8px !important; border-bottom: 0 !important;
    background: #fbfcfe !important;
  }
  .petition-sidebar-scope > div {
    width: auto; flex: 0 1 auto; gap: 3px !important; padding: 0 !important;
    border-radius: 0 !important; background: transparent !important;
  }
  .petition-sidebar-scope button {
    flex: 0 0 auto !important; min-width: 54px; padding: 4px 10px !important;
    border: 1px solid transparent; border-radius: 999px !important; color: #667085;
    font-size: 9px !important; font-weight: 600 !important;
  }
  .petition-sidebar-scope button[class*="bg-[#2563eb]"],
  .petition-sidebar-scope button[class*="bg-[#2f6fa8]"],
  .petition-sidebar-scope button[class*="bg-slate-700"] {
    border-color: #cbd8fb !important; background: #edf3ff !important; color: #2457d6 !important;
    box-shadow: none !important;
  }
  .petition-sidebar-list { background: #fff !important; }
  .petition-sidebar-list-heading {
    height: 31px; display: flex; align-items: center; justify-content: space-between;
    padding: 0 12px; border-bottom: 1px solid #edf0f4; color: #98a2b3; background: #fff;
    font-size: 9px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  }
  .petition-sidebar-list-heading span:last-child {
    font-variant-numeric: tabular-nums; letter-spacing: 0; text-transform: none;
  }
  .petition-sidebar-category { border-bottom-color: #edf0f4 !important; }
  .petition-sidebar-category-button {
    min-height: 44px; color: #344054 !important; font-size: 11px !important;
    font-weight: 600 !important; letter-spacing: 0;
  }
  .petition-sidebar-category-button:hover { background: #f7f8fa !important; }
  .petition-sidebar-category-chevron {
    width: 16px; border-radius: 0; color: #98a2b3; background: transparent;
  }
  .petition-sidebar-category-count { color: #98a2b3; font-weight: 600; }

  /* V3 — densidade de painel lateral do Word, sem cartões ou focos excessivos. */
  .petition-sidebar-category-button {
    min-height: 36px !important;
    padding: 0 10px !important;
    border: 0 !important;
    border-radius: 0 !important;
    outline: none !important;
    box-shadow: none !important;
    font-size: 10.5px !important;
  }
  .petition-sidebar-category-button:focus,
  .petition-sidebar-category-button:focus-visible {
    outline: none !important;
    box-shadow: inset 2px 0 0 #2563eb !important;
    background: #f5f8fc !important;
  }
  .petition-sidebar-category-chevron {
    width: 14px !important;
    height: 14px !important;
  }
  .petition-sidebar-block {
    min-height: 38px;
    margin: 1px 0;
    padding: 6px 7px !important;
    border: 0 !important;
    border-radius: 4px !important;
    outline: none !important;
  }
  .petition-sidebar-block:hover {
    border: 0 !important;
    background: #f3f6fa !important;
    box-shadow: none !important;
  }
  .petition-sidebar-block-icon {
    width: 22px !important;
    height: 22px !important;
    border-radius: 4px !important;
    color: #7c8797 !important;
    background: transparent !important;
  }
  .petition-sidebar-block:hover .petition-sidebar-block-icon {
    color: #185abd !important;
    background: #eaf2fd !important;
  }
  .petition-sidebar-block [class~="text-[12px]"] {
    font-size: 11px !important;
    font-weight: 550 !important;
  }
  .petition-sidebar-block button {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 !important;
  }
  .petition-sidebar-block-tags {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 17px;
    margin: 1px 0 0 30px;
    overflow: hidden;
  }
  .petition-sidebar-block-tags > span {
    max-width: 150px !important;
    padding: 1px 5px !important;
    border-color: #e1e6ed !important;
    border-radius: 3px !important;
    background: #f4f6f8 !important;
    font-size: 8.5px !important;
    line-height: 13px !important;
  }
  body.petition-dark .petition-sidebar-header .petition-sidebar-tabs { background: transparent; }
  body.petition-dark .petition-sidebar-tab:hover { background: transparent; }
  body.petition-dark .petition-sidebar-tab.is-active { color: #93c5fd; background: transparent; }
  body.petition-dark .petition-sidebar-controls,
  body.petition-dark .petition-sidebar-scope { background: #2b2b2b !important; border-color: #3d3d3d !important; }
  body.petition-dark .petition-sidebar-scope > div { background: transparent !important; }
  body.petition-dark .petition-sidebar-scope button[class*="bg-"] {
    border-color: #365f8d !important; background: #1e3655 !important; color: #93c5fd !important;
  }
  body.petition-dark .petition-sidebar {
    color: #d4d8df !important; background: #202124 !important; border-right-color: #3a3d44 !important;
  }
  body.petition-dark .petition-sidebar-header {
    background: #25262a !important; border-bottom-color: #3a3d44 !important;
  }
  body.petition-dark .petition-sidebar-tab { color: #9da4b1 !important; }
  body.petition-dark .petition-sidebar-tab:hover { color: #e1e5eb !important; }
  body.petition-dark .petition-sidebar-tab.is-active { color: #75a7ff !important; }
  body.petition-dark .petition-sidebar-tab.is-active::after { background: #4f8cff !important; }
  body.petition-dark .petition-sidebar-tab-count { color: #747d8c !important; }
  body.petition-dark .petition-sidebar-tab.is-active .petition-sidebar-tab-count { color: #75a7ff !important; }
  body.petition-dark .petition-sidebar-close { color: #858e9d !important; }
  body.petition-dark .petition-sidebar-close:hover { color: #e1e5eb !important; background: #34363c !important; }
  body.petition-dark .petition-sidebar-controls,
  body.petition-dark .petition-sidebar-context,
  body.petition-dark .petition-sidebar-search,
  body.petition-dark .petition-sidebar-scope {
    background: #25262a !important;
  }
  body.petition-dark .petition-sidebar-controls { border-bottom-color: #3a3d44 !important; }
  body.petition-dark .petition-sidebar-field-label > span { color: #a5acb8 !important; }
  body.petition-dark .petition-sidebar-field-actions button { color: #858e9d !important; }
  body.petition-dark .petition-sidebar-field-actions button:hover {
    color: #e1e5eb !important; background: #34363c !important;
  }
  body.petition-dark .petition-sidebar-context select,
  body.petition-dark .petition-sidebar-search input,
  body.petition-dark .petition-sidebar-search select {
    color: #e4e7ec !important; background: #2d2f34 !important; border-color: #454951 !important;
    box-shadow: none !important;
  }
  body.petition-dark .petition-sidebar-search input::placeholder { color: #777f8d !important; }
  body.petition-dark .petition-sidebar-context select:focus,
  body.petition-dark .petition-sidebar-search input:focus,
  body.petition-dark .petition-sidebar-search select:focus {
    border-color: #5f8fe8 !important; box-shadow: 0 0 0 3px rgba(79,140,255,.14) !important;
  }
  body.petition-dark .petition-sidebar-context-selector > span {
    box-shadow: 0 0 0 3px rgba(255,255,255,.08) !important;
  }
  body.petition-dark .petition-sidebar-tool-button {
    color: #b6bdc8 !important; background: #303238 !important; border-color: #484c55 !important;
    box-shadow: none !important;
  }
  body.petition-dark .petition-sidebar-tool-button:hover {
    color: #f0f2f5 !important; background: #393c43 !important; border-color: #5b606b !important;
  }
  body.petition-dark .petition-sidebar-tool-button.is-primary {
    color: #fff !important; background: #3478f6 !important; border-color: #3478f6 !important;
    box-shadow: 0 1px 2px rgba(0,0,0,.22) !important;
  }
  body.petition-dark .petition-sidebar-tool-button.is-primary:hover {
    background: #4385fb !important; border-color: #4385fb !important;
  }
  body.petition-dark .petition-sidebar-scope button {
    color: #9da4b1 !important; background: transparent !important;
  }
  body.petition-dark .petition-sidebar-scope button:hover { color: #e1e5eb !important; background: #303238 !important; }
  body.petition-dark .petition-sidebar-scope button[class*="bg-[#2563eb]"],
  body.petition-dark .petition-sidebar-scope button[class*="bg-[#2f6fa8]"],
  body.petition-dark .petition-sidebar-scope button[class*="bg-slate-700"] {
    color: #9ec1ff !important; background: #253a5d !important; border-color: #3e6095 !important;
  }
  body.petition-dark .petition-sidebar-list { background: #202124 !important; }
  body.petition-dark .petition-sidebar-list-heading {
    color: #818a99 !important; background: #242529 !important; border-bottom-color: #373a41 !important;
  }
  body.petition-dark .petition-sidebar-category { border-bottom-color: #363940 !important; }
  body.petition-dark .petition-sidebar-category-button { color: #c8ced8 !important; }
  body.petition-dark .petition-sidebar-category-button:hover { color: #eef1f5 !important; background: #292b30 !important; }
  body.petition-dark .petition-sidebar-category-chevron,
  body.petition-dark .petition-sidebar-category-count { color: #7f8897 !important; }
  body.petition-dark .petition-sidebar-block { color: #d4d8df !important; background: transparent !important; }
  body.petition-dark .petition-sidebar-block:hover {
    background: #2a2c31 !important; border-color: #41454d !important; box-shadow: none !important;
  }
  body.petition-dark .petition-sidebar-block-icon { color: #aab1bd !important; background: #34363c !important; }
  body.petition-dark .petition-sidebar-block:hover .petition-sidebar-block-icon {
    color: #8db6ff !important; background: #283b5c !important;
  }
  body.petition-dark .petition-sidebar-block [class~="text-slate-700"] { color: #d6dbe3 !important; }
  body.petition-dark .petition-sidebar-block [class~="bg-[#f1f5f9]"] {
    color: #aeb6c2 !important; background: #303238 !important; border-color: #444851 !important;
  }
  body.petition-dark .petition-sidebar-empty { color: #858e9d !important; }
  body.petition-dark .petition-sidebar-empty-icon {
    color: #858e9d !important; background: #2b2d32 !important; border-color: #42464e !important;
  }
  body.petition-dark .petition-sidebar-empty strong { color: #cbd1da !important; }
  body.petition-dark .petition-sidebar-client { color: #d4d8df !important; }
  body.petition-dark .petition-sidebar-client:hover {
    background: #2a2c31 !important; border-color: #41454d !important; box-shadow: none !important;
  }
  body.petition-dark .petition-sidebar-client.is-selected {
    background: #253a5d !important; border-color: #3e6095 !important;
  }
  body.petition-dark .petition-sidebar-client-avatar { color: #b8c0cb !important; background: #34363c !important; }
  body.petition-dark .petition-sidebar-client.is-selected .petition-sidebar-client-avatar {
    color: #a8c8ff !important; background: #31517f !important;
  }
  body.petition-dark .petition-sidebar-client [class~="text-slate-700"] { color: #d6dbe3 !important; }
  body.petition-dark .petition-sidebar-client-action {
    color: #9ec1ff !important; background: #303238 !important; border-color: #4d6590 !important;
  }
  body.petition-dark .petition-sidebar-resizer { background: #3a3d44 !important; }
  body.petition-dark .petition-sidebar-resizer:hover { background: #4f8cff !important; }

  .petition-find-panel {
    width: 318px; min-width: 280px; max-width: min(360px, 88vw); height: 100%;
    flex: 0 0 auto; display: flex; flex-direction: column; background: #fff;
    border-left: 1px solid #e3e6ea; color: #334155; z-index: 24;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .petition-find-header {
    height: 42px; flex-shrink: 0; display: flex; align-items: center;
    justify-content: space-between; border-bottom: 1px solid #e3e6ea; padding: 0 8px 0 12px;
  }
  .petition-find-tabs { display: flex; align-self: stretch; gap: 14px; }
  .petition-find-tabs button {
    position: relative; border: 0; background: transparent; color: #64748b;
    font-size: 12px; font-weight: 600; cursor: pointer; padding: 0 2px;
  }
  .petition-find-tabs button.is-active { color: #2563eb; }
  .petition-find-tabs button.is-active::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: #2563eb;
  }
  .petition-find-close, .petition-find-summary button {
    width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 6px; background: transparent; color: #64748b; cursor: pointer;
  }
  .petition-find-close:hover, .petition-find-summary button:hover { background: #eef2f7; color: #2563eb; }
  .petition-find-content { padding: 14px; overflow-y: auto; }
  .petition-find-field { display: block; margin-bottom: 12px; }
  .petition-find-field > span {
    display: block; margin-bottom: 5px; font-size: 10px; font-weight: 700;
    letter-spacing: .08em; text-transform: uppercase; color: #94a3b8;
  }
  .petition-find-field > div {
    height: 36px; display: flex; align-items: center; gap: 8px; border: 1px solid #d9dee6;
    border-radius: 7px; padding: 0 10px; background: #fff; color: #94a3b8;
  }
  .petition-find-field > div:focus-within { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,.1); }
  .petition-find-field input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; font-size: 13px; color: #334155; }
  .petition-find-options { display: flex; flex-direction: column; gap: 8px; padding: 2px 0 12px; }
  .petition-find-options label { display: flex; align-items: center; gap: 7px; font-size: 11px; color: #64748b; cursor: pointer; }
  .petition-find-options input { accent-color: #2563eb; }
  .petition-find-summary {
    min-height: 34px; display: flex; align-items: center; justify-content: space-between;
    border-block: 1px solid #edf0f3; padding: 7px 0; font-size: 11px; color: #64748b;
  }
  .petition-find-summary > div { display: flex; align-items: center; gap: 4px; }
  .petition-find-actions { display: flex; justify-content: flex-end; gap: 7px; padding-top: 12px; }
  .petition-find-actions button {
    height: 32px; border: 1px solid #d9dee6; border-radius: 6px; background: #fff;
    padding: 0 11px; font-size: 11px; font-weight: 600; color: #475569; cursor: pointer;
  }
  .petition-find-actions button.is-primary { border-color: #2563eb; background: #2563eb; color: #fff; }
  .petition-find-actions button:disabled { opacity: .45; cursor: not-allowed; }
  .petition-find-feedback { margin: 10px 0 0; font-size: 11px; color: #64748b; }
  body.petition-dark .petition-find-panel { background: #262626; border-left-color: #3d3d3d; color: #e5e7eb; }
  body.petition-dark .petition-find-header, body.petition-dark .petition-find-summary { border-color: #3d3d3d; }
  body.petition-dark .petition-find-tabs button { color: #a3a3a3; }
  body.petition-dark .petition-find-tabs button.is-active { color: #60a5fa; }
  body.petition-dark .petition-find-field > div { background: #303030; border-color: #474747; }
  body.petition-dark .petition-find-field input { color: #e5e7eb; }
  body.petition-dark .petition-find-actions button { background: #303030; border-color: #474747; color: #d4d4d4; }
  body.petition-dark .petition-find-actions button.is-primary { background: #2563eb; border-color: #2563eb; color: #fff; }

  /* ── Painel de revisão de texto (ortografia + gramática + IA) ── */
  .petition-proof-panel {
    width: 360px; min-width: 300px; max-width: min(400px, 92vw); height: 100%;
    flex: 0 0 auto; display: flex; flex-direction: column; background: #fff;
    border-left: 1px solid #e3e6ea; color: #334155; z-index: 24;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .petition-proof-header {
    height: 46px; flex-shrink: 0; display: flex; align-items: center;
    justify-content: space-between; border-bottom: 1px solid #e3e6ea; padding: 0 8px 0 14px;
  }
  .petition-proof-header > div:first-child { display: flex; flex-direction: column; line-height: 1.25; }
  .petition-proof-header strong { font-size: 13px; font-weight: 700; color: #1e293b; }
  .petition-proof-header span { font-size: 10px; color: #94a3b8; }
  .petition-proof-header-actions { display: flex; gap: 2px; }
  .petition-proof-header-actions button {
    width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 6px; background: transparent; color: #64748b; cursor: pointer;
  }
  .petition-proof-header-actions button:hover { background: #eef2f7; color: #2563eb; }
  .petition-proof-header-actions button:disabled { opacity: .45; cursor: default; }
  .petition-proof-toolbar { padding: 10px 14px 8px; border-bottom: 1px solid #edf0f3; }
  .petition-proof-switch {
    display: flex; align-items: center; gap: 6px; font-size: 11px; color: #475569; cursor: pointer;
  }
  .petition-proof-switch input { accent-color: #4338ca; }
  .petition-proof-switch svg { color: #4338ca; }
  .petition-proof-switch input:disabled { cursor: not-allowed; }
  .petition-proof-filters { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 9px; }
  .petition-proof-filters button {
    border: 1px solid #e2e8f0; border-radius: 999px; background: #fff; color: #64748b;
    padding: 2px 9px; font-size: 10px; font-weight: 600; cursor: pointer;
  }
  .petition-proof-filters button.is-active { border-color: #2563eb; background: #eff6ff; color: #2563eb; }
  .petition-proof-status, .petition-proof-warning, .petition-proof-feedback {
    display: flex; align-items: center; gap: 6px; margin: 0;
    padding: 8px 14px; font-size: 11px; color: #64748b;
  }
  .petition-proof-warning { color: #b45309; background: #fffbeb; }
  .petition-proof-warning svg { flex-shrink: 0; }
  .petition-proof-feedback { color: #475569; background: #f8fafc; }
  .petition-proof-spin { animation: petitionProofSpin 1s linear infinite; }
  @keyframes petitionProofSpin { to { transform: rotate(360deg); } }
  .petition-proof-list { flex: 1; overflow-y: auto; padding: 10px 12px 18px; display: flex; flex-direction: column; gap: 9px; }
  .petition-proof-card {
    border: 1px solid #e6e9ee; border-radius: 9px; background: #fff; padding: 10px 11px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
  }
  .petition-proof-card > header { display: flex; align-items: center; gap: 6px; margin-bottom: 7px; }
  .petition-proof-badge {
    border-radius: 4px; padding: 1px 6px; color: #fff; font-size: 9px; font-weight: 700;
    letter-spacing: .04em; text-transform: uppercase;
  }
  .petition-proof-source { font-size: 9px; color: #94a3b8; text-transform: uppercase; letter-spacing: .04em; }
  .petition-proof-locate {
    margin-left: auto; width: 22px; height: 22px; display: inline-flex; align-items: center;
    justify-content: center; border: 0; border-radius: 5px; background: transparent; color: #94a3b8; cursor: pointer;
  }
  .petition-proof-locate:hover { background: #eff6ff; color: #2563eb; }
  .petition-proof-context {
    margin: 0 0 6px; font-size: 11.5px; line-height: 1.5; color: #64748b; word-break: break-word;
  }
  .petition-proof-context mark { background: #fee2e2; color: #b91c1c; font-weight: 600; padding: 0 2px; border-radius: 3px; }
  .petition-proof-message { margin: 0 0 6px; font-size: 12px; color: #1e293b; }
  .petition-proof-explain-toggle {
    display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent;
    padding: 0; color: #2563eb; font-size: 10.5px; font-weight: 600; cursor: pointer;
  }
  .petition-proof-explanation {
    margin: 5px 0 0; padding: 7px 9px; border-radius: 6px; background: #f8fafc;
    font-size: 11px; line-height: 1.55; color: #475569;
  }
  .petition-proof-suggestions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .petition-proof-apply {
    display: inline-flex; align-items: center; gap: 4px; border: 1px solid #bbf7d0;
    border-radius: 6px; background: #f0fdf4; color: #15803d; padding: 3px 8px;
    font-size: 11.5px; font-weight: 600; cursor: pointer; max-width: 100%; word-break: break-word; text-align: left;
  }
  .petition-proof-apply:hover { background: #dcfce7; }
  .petition-proof-empty { font-size: 10.5px; color: #94a3b8; font-style: italic; }
  .petition-proof-card > footer { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 9px; }
  .petition-proof-card > footer button {
    display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent;
    padding: 0; color: #64748b; font-size: 10.5px; font-weight: 600; cursor: pointer;
  }
  .petition-proof-card > footer button:hover { color: #2563eb; }
  .petition-proof-card > footer button:disabled { opacity: .5; cursor: default; }
  .petition-proof-empty-state { margin: 18px 0; text-align: center; font-size: 11.5px; color: #94a3b8; }
  body.petition-dark .petition-proof-panel { background: #262626; border-left-color: #3d3d3d; color: #e5e7eb; }
  body.petition-dark .petition-proof-header, body.petition-dark .petition-proof-toolbar { border-color: #3d3d3d; }
  body.petition-dark .petition-proof-header strong { color: #f1f5f9; }
  body.petition-dark .petition-proof-card { background: #303030; border-color: #474747; box-shadow: none; }
  body.petition-dark .petition-proof-message { color: #e5e7eb; }
  body.petition-dark .petition-proof-context { color: #a3a3a3; }
  body.petition-dark .petition-proof-context mark { background: #7f1d1d; color: #fecaca; }
  body.petition-dark .petition-proof-explanation { background: #3a3a3a; color: #cbd5e1; }
  body.petition-dark .petition-proof-filters button { background: #303030; border-color: #474747; color: #cbd5e1; }
  body.petition-dark .petition-proof-filters button.is-active { background: #1e3a8a; border-color: #3b82f6; color: #bfdbfe; }
  body.petition-dark .petition-proof-apply { background: #14532d; border-color: #166534; color: #bbf7d0; }
  body.petition-dark .petition-proof-feedback { background: #303030; color: #cbd5e1; }
  body.petition-dark .petition-proof-warning { background: #422006; color: #fcd34d; }
`;

// Injeta os estilos estruturais do editor (flex do wrapper, container Syncfusion, etc.).
// Sem isto o .syncfusion-editor-wrapper nÃ£o recebe flex:1 e colapsa para a largura mÃ­nima do conteudo.
if (typeof document !== 'undefined') {
  let styleEl = document.getElementById('petition-editor-structural-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'petition-editor-structural-styles';
    document.head.appendChild(styleEl);
  }
  // Sempre atualiza o conteúdo (idempotente) para que mudanças no CSS
  // sejam refletidas mesmo com o <style> já presente (HMR / re-render).
  styleEl.innerHTML = EDITOR_STYLES;
}

interface PetitionEditorModuleProps {
  isFloatingWidget?: boolean;
  initialClientId?: string;
  initialPetitionId?: string;
  initialDocumentBase64?: string;
  initialDocumentUrl?: string;
  initialDocumentName?: string;
  initialCloudFileId?: string;
  /** Caminho no Nextcloud (relativo à raiz). Quando presente, o documento é
   *  salvo de volta no Nextcloud em vez de criar registro de petição. */
  initialNextcloudPath?: string;
  /** Origem externa (template principal/anexo, petição padrão, …): quando
   *  presente, o documento é carregado dessa origem e o "Salvar" grava de volta
   *  NELA, sem criar petição. Ver src/utils/editorDocSource.ts. */
  initialDocSource?: EditorDocSource;
  initialDocumentRequestId?: string;
  onUnsavedChanges?: (hasChanges: boolean) => void;
  onWidgetInfoChange?: (payload: { lastSaved: Date | null; selectedClient: Client | null }) => void;
  onRequestClose?: () => void;
  onRequestMinimize?: () => void;
  /** Oculta (só visualmente) o botão Minimizar — usado na janela dedicada do
   *  Editor, onde minimizar não faz sentido (usa-se a janela do SO). */
  hideMinimize?: boolean;
}

type LocalPetitionDraft = {
  title: string;
  content: string;
  currentPetitionId: string | null;
  clientId: string | null;
  legalAreaId: string | null;
  standardTypeId: string | null;
  updatedAt: string;
};

type RecentDocumentItem = {
  key: string;
  source: 'petition' | 'nextcloud';
  title: string;
  clientName: string | null;
  location: string | null;
  updatedAt: string;
  lastAction: 'opened' | 'saved';
  petition?: SavedPetition;
  nextcloudPath?: string;
  nextcloudAvailability?: 'checking' | 'available' | 'missing' | 'unknown';
  clientId?: string | null;
};

let lastHandledInitialDocumentRequestId: string | null = null;

const PetitionEditorModule: React.FC<PetitionEditorModuleProps> = ({
  isFloatingWidget = false,
  initialClientId,
  initialPetitionId,
  initialDocumentBase64,
  initialDocumentUrl,
  initialDocumentName,
  initialCloudFileId,
  initialNextcloudPath,
  initialDocSource,
  initialDocumentRequestId,
  onUnsavedChanges,
  onWidgetInfoChange,
  onRequestClose,
  onRequestMinimize,
  hideMinimize = false,
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

  // A foto do PRÓPRIO usuário não precisa de ida ao banco quando já veio no
  // login: alimenta o cache compartilhado e serve para os componentes que
  // mostram "você" junto dos demais.
  useEffect(() => {
    const metadataAvatar = (user?.user_metadata as any)?.avatar_url;
    if (user?.id && metadataAvatar) primeAvatar(user.id, metadataAvatar);
  }, [user?.id, (user?.user_metadata as any)?.avatar_url]);

  const isCloudImportMode = isFloatingWidget && Boolean(initialDocumentBase64 || initialDocumentUrl || initialNextcloudPath || initialDocSource);

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [findReplaceMode, setFindReplaceMode] = useState<'find' | 'replace' | null>(null);
  // Painel de revisão de texto (ortografia + gramática + regras jurídicas + IA).
  const [showProofreader, setShowProofreader] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'blocks' | 'clients'>('blocks');
  const [activeWorkspace, setActiveWorkspace] = useState<'editor' | 'blocks'>('editor');
  const [blocksReturnTarget, setBlocksReturnTarget] = useState<'start' | 'editor'>('editor');
  const [blocksEnabled, setBlocksEnabled] = useState(true);
  const [aiAssistantEnabled, setAiAssistantEnabled] = useState(true);
  const [bmExpandedBlocks, setBmExpandedBlocks] = useState<Set<string>>(new Set());
  const [bmDocxPreviews, setBmDocxPreviews] = useState<Map<string, 'loading' | 'done' | 'error'>>(new Map());
  const bmPreviewContainersRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
  /** HTML já renderizado por bloco: recolher desmonta o container, então
   *  guardamos o resultado para reexibir na hora ao expandir de novo. */
  const bmPreviewHtmlRef = useRef<Map<string, string>>(new Map());
  const bmPreviewQueueRef = useRef<string[]>([]);
  const bmPreviewBusyRef = useRef(false);
  const [bmViewMode, setBmViewMode] = useState<'list' | 'grid'>('list');
  const [bmSortBy, setBmSortBy] = useState<'title' | 'updated' | 'category'>('category');
  const [bmCollapsedCategories, setBmCollapsedCategories] = useState<Set<string>>(new Set());
  const [bmCategoryFilter, setBmCategoryFilter] = useState<string>('all');
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      if (typeof window === 'undefined') return 320;
      const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed) && parsed > 0
        ? Math.max(296, Math.min(360, parsed))
        : 320;
    } catch {
      return 320;
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
  const [pendingOfflineSync, setPendingOfflineSync] = useState(false);
  const [localDraftUpdatedAt, setLocalDraftUpdatedAt] = useState<string | null>(null);
  const [restorableLocalDraft, setRestorableLocalDraft] = useState<LocalPetitionDraft | null>(null);
  const pendingOfflineSyncRef = useRef(false);

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
  const openingResetTimeoutRef = useRef<number | null>(null);
  const [pendingPetitionLoadKey, setPendingPetitionLoadKey] = useState(0);

  useEffect(() => {
    return () => {
      if (openingResetTimeoutRef.current) {
        window.clearTimeout(openingResetTimeoutRef.current);
      }
    };
  }, []);
  const editorRef = useRef<SyncfusionEditorRef>(null);
  const blockConvertEditorRef = useRef<SyncfusionEditorRef>(null);
  const [editorReady, setEditorReady] = useState(false);

  // O painel de busca ocupa espaço real ao lado do documento. Recalcular o
  // Syncfusion evita que a folha fique comprimida ou mantenha a largura antiga.
  useEffect(() => {
    if (!editorReady) return;
    const immediateRefresh = window.setTimeout(() => editorRef.current?.refresh?.(), 0);
    const settledRefresh = window.setTimeout(() => editorRef.current?.refresh?.(), 180);
    return () => {
      window.clearTimeout(immediateRefresh);
      window.clearTimeout(settledRefresh);
    };
  }, [editorReady, findReplaceMode]);

  const [defaultDocFont, setDefaultDocFont] = useState<{ fontFamily?: string; fontSize?: number } | null>(null);
  const defaultDocFontRef = useRef<{ fontFamily?: string; fontSize?: number } | null>(null);
  const blockViewDocxTokenRef = useRef(0);
  const blockViewDocxContainerRef = useRef<HTMLDivElement | null>(null);
  const contentChangeSeqRef = useRef(0);
  const defaultTemplateAutoAppliedRef = useRef(false);
  const autoCreateInFlightRef = useRef(false);
  const savePetitionActionRef = useRef<((request?: { auto?: boolean }) => Promise<void>) | null>(null);
  const selectedClientIdRef = useRef<string | null>(null);
  const hasUnsavedChangesRef = useRef(false);
  const isOnlineRef = useRef(true);
  const serverReachableRef = useRef(true);
  const cursorPersistTimerRef = useRef<number | null>(null);

  // PetiçÃµes salvas
  const [savedPetitions, setSavedPetitions] = useState<SavedPetition[]>([]);
  const [savedPetitionsLoading, setSavedPetitionsLoading] = useState(true);
  const [documentHistory, setDocumentHistory] = useState<DocumentEditHistoryEntry[]>([]);
  const [documentHistoryLoading, setDocumentHistoryLoading] = useState(true);
  const [recentNextcloudAvailability, setRecentNextcloudAvailability] = useState<
    Record<string, 'checking' | 'available' | 'missing' | 'unknown'>
  >({});
  const [recentDocumentSearch, setRecentDocumentSearch] = useState('');
  const [recentDocumentSource, setRecentDocumentSource] = useState<'all' | 'petition' | 'nextcloud'>('all');
  const [sourceCloudFile, setSourceCloudFile] = useState<CloudFile | null>(null);

  // ORIGEM ATIVA do documento — fonte ÚNICA de verdade para responder "de onde
  // este documento veio", "onde o Ctrl+S grava", "qual lock/ETag vale". As
  // propriedades `initial*` só descrevem como o editor foi MONTADO; depois disso
  // o usuário pode abrir outro arquivo ou salvar em outro lugar, e é esta
  // origem — não as props — que manda. Ver utils/editorDocumentOrigin.
  const [activeOrigin, setActiveOriginState] = useState<ActiveDocumentOrigin>(() => {
    if (initialNextcloudPath) {
      return {
        kind: 'nextcloud',
        path: initialNextcloudPath,
        fileName: initialDocumentName || fileNameOf(initialNextcloudPath),
        etag: null,
      };
    }
    if (initialDocSource) {
      return { kind: 'external', source: initialDocSource, fileName: initialDocumentName || 'documento.docx' };
    }
    return { kind: 'new' };
  });
  const activeOriginRef = useRef<ActiveDocumentOrigin>(activeOrigin);

  // Refs legados: continuam existindo porque muitos pontos do módulo os leem de
  // forma síncrona. São ESCRITOS apenas por `setActiveOrigin`, nunca à mão.
  const sourceNextcloudPathRef = useRef<string | null>(activeNextcloudPath(activeOrigin));
  const docSourceRef = useRef<EditorDocSource | null>(
    activeOrigin.kind === 'external' ? activeOrigin.source : null,
  );

  /** Troca a origem ativa e limpa as referências incompatíveis da anterior. */
  const setActiveOrigin = useCallback((origin: ActiveDocumentOrigin) => {
    activeOriginRef.current = origin;
    sourceNextcloudPathRef.current = activeNextcloudPath(origin);
    docSourceRef.current = origin.kind === 'external' ? origin.source : null;
    if (origin.kind === 'nextcloud' || origin.kind === 'external') {
      // Um arquivo do Nextcloud/origem externa não é uma petição do Jurius:
      // manter o id faria o próximo save sobrescrever a petição anterior.
      currentPetitionIdRef.current = null;
      setCurrentPetitionId(null);
    }
    if (origin.kind === 'petition') {
      currentPetitionIdRef.current = origin.petitionId;
      setCurrentPetitionId(origin.petitionId);
    }
    setActiveOriginState(origin);
  }, []);

  /** Guarda o ETag confirmado pelo servidor sem trocar a origem. */
  const updateActiveNextcloudEtag = useCallback((path: string, etag: string | null) => {
    const current = activeOriginRef.current;
    if (current.kind !== 'nextcloud' || current.path !== path) return;
    setActiveOrigin({ ...current, etag });
  }, [setActiveOrigin]);

  const activeNextcloudPathValue = activeOrigin.kind === 'nextcloud' ? activeOrigin.path : null;

  // Props de montagem -> origem ativa. Só age quando descrevem um documento
  // DIFERENTE do que já está aberto (senão apagaria o ETag recém-lido).
  useEffect(() => {
    if (!initialNextcloudPath) return;
    const current = activeOriginRef.current;
    if (current.kind === 'nextcloud' && current.path === initialNextcloudPath) return;
    setActiveOrigin({
      kind: 'nextcloud',
      path: initialNextcloudPath,
      fileName: initialDocumentName || fileNameOf(initialNextcloudPath),
      etag: null,
    });
  }, [initialNextcloudPath, initialDocumentName, setActiveOrigin]);

  useEffect(() => {
    if (!initialDocSource) return;
    const current = activeOriginRef.current;
    if (current.kind === 'external' && editorDocSourceKey(current.source) === editorDocSourceKey(initialDocSource)) return;
    setActiveOrigin({
      kind: 'external',
      source: initialDocSource,
      fileName: initialDocumentName || 'documento.docx',
    });
  }, [initialDocSource, initialDocumentName, setActiveOrigin]);

  // Escopo do documento aberto (Nextcloud ou origem externa). Isola rascunho
  // local e posição do cursor POR DOCUMENTO: sem isso, editar um template
  // gravaria o rascunho na mesma chave da petição comum — e salvar o template
  // apagaria o rascunho da petição do usuário. Acompanha a ORIGEM ATIVA.
  const documentScopeKey = useMemo(
    () => {
      if (activeOrigin.kind === 'nextcloud') return `nextcloud:${encodeURIComponent(activeOrigin.path)}`;
      if (activeOrigin.kind === 'external') return `src:${encodeURIComponent(editorDocSourceKey(activeOrigin.source))}`;
      return null;
    },
    [activeOrigin],
  );

  const localDraftStorageKey = useMemo(
    () => {
      const owner = user?.id || 'anon';
      return `${PETITION_LOCAL_DRAFT_STORAGE_KEY_PREFIX}${owner}${documentScopeKey ? `:${documentScopeKey}` : ''}`;
    },
    [documentScopeKey, user?.id],
  );

  // Chave (localStorage) da última posição de leitura/edição por documento —
  // usada para reabrir exatamente onde o usuário parou, sem voltar ao topo. Só
  // existe quando o documento veio de uma origem externa (Nextcloud/template/…).
  const cursorPositionStorageKey = useMemo(
    () => {
      const owner = user?.id || 'anon';
      // Formato legado do Nextcloud mantido: já existem posições salvas assim.
      if (activeNextcloudPathValue) return `petition-editor-pos:${owner}:${encodeURIComponent(activeNextcloudPathValue)}`;
      return documentScopeKey ? `petition-editor-pos:${owner}:${documentScopeKey}` : null;
    },
    [documentScopeKey, activeNextcloudPathValue, user?.id],
  );

  // Clientes
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const [relativeTimeTick, setRelativeTimeTick] = useState(0);

  const trackDocumentActivity = useCallback(async (input: TouchDocumentEditHistoryInput) => {
    try {
      const entry = await documentEditHistoryService.touch(input);
      if (!entry) return;
      setDocumentHistory((current) => {
        const next = current.filter(
          (item) => !(item.source === entry.source && item.source_key === entry.source_key),
        );
        next.unshift(entry);
        return next
          .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())
          .slice(0, 50);
      });
    } catch (historyError) {
      console.warn('Não foi possível registrar a atividade do documento:', historyError);
    }
  }, []);

  useEffect(() => {
    settingsService.getPetitionEditorModuleConfig().then(cfg => {
      setBlocksEnabled(cfg.blocks_enabled);
      if (!cfg.blocks_enabled) setActiveWorkspace('editor');
    }).catch(() => {});
    // Assistente de IA é escolha de cada usuário (coluna no perfil), não do escritório.
    profileService.getMyPetitionAiAssistantEnabled()
      .then(setAiAssistantEnabled)
      .catch(() => {});
  }, []);

  /* Liga/desliga o assistente na hora e grava no perfil. Se o banco recusar,
     o botão volta ao estado anterior — ele não pode dizer "desligado" e o
     assistente reaparecer na próxima sessão. */
  const toggleAiAssistant = useCallback(async () => {
    const next = !aiAssistantEnabled;
    setAiAssistantEnabled(next);
    try {
      const ok = await profileService.updateMyPetitionAiAssistantEnabled(next);
      if (!ok) setAiAssistantEnabled(!next);
    } catch {
      setAiAssistantEnabled(!next);
    }
  }, [aiAssistantEnabled]);

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

  // Abrir um documento dispara `contentChange` várias vezes DEPOIS que o load
  // termina: aplicação da fonte padrão (+180ms), margens/fitPage aplicados pelo
  // SyncfusionEditor no `documentChange` e a repaginação do layout. Sem uma
  // janela de acomodação, um documento recém-aberto e intocado já aparecia como
  // "Alterações pendentes".
  const DOCUMENT_SETTLE_MS = 3000;
  const DOCUMENT_LOAD_GUARD_MS = 30000;
  const settleWindowStartRef = useRef(0);
  const settleWindowEndRef = useRef(0);
  const lastUserInputAtRef = useRef(0);

  const beginDocumentSettleWindow = useCallback((settleMs: number = DOCUMENT_SETTLE_MS) => {
    const now = Date.now();
    settleWindowStartRef.current = now;
    settleWindowEndRef.current = now + settleMs;
  }, []);

  const isProgrammaticContentChange = useCallback(() => {
    if (Date.now() >= settleWindowEndRef.current) return false;
    // Apenas entradas que podem alterar conteúdo quebram a proteção. Um clique
    // para selecionar texto, fechar o editor ou usar a navegação não é edição.
    return lastUserInputAtRef.current < settleWindowStartRef.current;
  }, []);

  useEffect(() => {
    const markUserInput = () => {
      lastUserInputAtRef.current = Date.now();
    };
    const events: Array<keyof DocumentEventMap> = ['beforeinput', 'keydown', 'paste', 'cut', 'drop'];
    events.forEach((event) => document.addEventListener(event, markUserInput, true));
    return () => {
      events.forEach((event) => document.removeEventListener(event, markUserInput, true));
    };
  }, []);

  const captureAndApplyDocFontSoon = (editor: SyncfusionEditorRef) => {
    // Todo carregamento programático de documento passa por aqui: é o ponto
    // certo para abrir a janela de acomodação pós-load.
    beginDocumentSettleWindow();
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
    pendingOfflineSyncRef.current = pendingOfflineSync;
  }, [pendingOfflineSync]);

  const clearLocalDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(localDraftStorageKey);
    } catch {
      // ignore
    }
    setLocalDraftUpdatedAt(null);
    setRestorableLocalDraft(null);
    setPendingOfflineSync(false);
  }, [localDraftStorageKey]);

  const loadLocalDraftFromStorage = useCallback((): LocalPetitionDraft | null => {
    try {
      const raw = window.localStorage.getItem(localDraftStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as LocalPetitionDraft;
      if (!parsed || typeof parsed !== 'object') return null;
      if (!String(parsed.content || '').trim()) return null;
      return {
        title: String(parsed.title || ''),
        content: String(parsed.content || ''),
        currentPetitionId: parsed.currentPetitionId || null,
        clientId: parsed.clientId || null,
        legalAreaId: parsed.legalAreaId || null,
        standardTypeId: parsed.standardTypeId || null,
        updatedAt: String(parsed.updatedAt || new Date().toISOString()),
      };
    } catch {
      return null;
    }
  }, [localDraftStorageKey]);

  const writeLocalDraft = useCallback(
    (draft: LocalPetitionDraft) => {
      try {
        window.localStorage.setItem(localDraftStorageKey, JSON.stringify(draft));
      } catch {
        // ignore
      }
      setLocalDraftUpdatedAt(draft.updatedAt);
      setRestorableLocalDraft(draft);
    },
    [localDraftStorageKey],
  );

  const restoreNextcloudDraft = useCallback(async (editor: SyncfusionEditorRef): Promise<boolean> => {
    if (!sourceNextcloudPathRef.current) return false;
    const draft = loadLocalDraftFromStorage();
    if (!draft) return false;

    // Uma detecção falsa de alteração em versões anteriores podia gravar como
    // rascunho exatamente o mesmo SFDT recém-aberto. Não restauramos nem
    // sinalizamos pendência quando não há diferença real de conteúdo.
    const openedContent = String(editor.getSfdt?.() || '').trim();
    const draftContent = String(draft.content || '').trim();
    if (openedContent && openedContent === draftContent) {
      clearLocalDraft();
      return false;
    }

    await Promise.resolve(editor.loadSfdt(draft.content));
    editor.focus();
    setRestorableLocalDraft(draft);
    setLocalDraftUpdatedAt(draft.updatedAt);
    setPendingOfflineSync(false);
    setHasUnsavedChanges(true);
    showSuccessMessage('Rascunho local recuperado. Clique em Salvar para atualizar o arquivo no Nextcloud.');
    return true;
  }, [clearLocalDraft, loadLocalDraftFromStorage]);

  // Guarda a posição atual do cursor (índice hierárquico do Syncfusion, ex.:
  // "3;0;12") para reabrir o documento exatamente onde o usuário parou.
  const persistCursorPosition = useCallback(() => {
    const key = cursorPositionStorageKey;
    if (!key) return;
    try {
      const ed: any = editorRef.current?.getEditor?.();
      const offset = ed?.selection?.startOffset;
      if (typeof offset === 'string' && offset) {
        window.localStorage.setItem(key, offset);
      }
    } catch {
      // ignore
    }
  }, [cursorPositionStorageKey]);

  // Debounce: cursor move o tempo todo enquanto se digita/rola; grava só quando
  // estabiliza para não martelar o localStorage.
  const scheduleCursorPersist = useCallback(() => {
    if (!cursorPositionStorageKey) return;
    if (cursorPersistTimerRef.current) window.clearTimeout(cursorPersistTimerRef.current);
    cursorPersistTimerRef.current = window.setTimeout(() => {
      persistCursorPosition();
    }, 600);
  }, [cursorPositionStorageKey, persistCursorPosition]);

  // Restaura a última posição salva (chamado após o documento carregar). Um
  // pequeno atraso garante que o layout já existe antes de rolar até lá.
  const restoreCursorPosition = useCallback(() => {
    const key = cursorPositionStorageKey;
    if (!key) return;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(key);
    } catch {
      saved = null;
    }
    if (!saved) return;
    window.setTimeout(() => {
      try {
        const ed: any = editorRef.current?.getEditor?.();
        // select(inicio, fim) posiciona o cursor E rola a seleção para a vista.
        ed?.selection?.select?.(saved, saved);
        editorRef.current?.focus?.();
      } catch {
        // ignore — se o offset não existir mais, apenas ignora
      }
    }, 450);
  }, [cursorPositionStorageKey]);

  // Limpa o timer pendente ao desmontar.
  useEffect(() => {
    return () => {
      if (cursorPersistTimerRef.current) window.clearTimeout(cursorPersistTimerRef.current);
    };
  }, []);

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
    const draft = loadLocalDraftFromStorage();
    if (!draft) return;
    setRestorableLocalDraft(draft);
    setLocalDraftUpdatedAt(draft.updatedAt);
    setPendingOfflineSync(true);
  }, [loadLocalDraftFromStorage]);

  useEffect(() => {
    if (!user?.id) return;
    if (isCloudImportMode) return;

    // Broadcast, e não postgres_changes. Dois motivos:
    //
    // 1. O handler descarta o payload e só recarrega a lista — e cada linha de
    //    saved_petitions carrega o .docx inteiro (83 MB de TOAST na tabela).
    // 2. O filtro antigo era `created_by=eq.<usuário>`, mas created_by está
    //    NULL em todas as linhas: aquele filtro nunca casou, e esta
    //    atualização automática nunca chegou a funcionar. `listPetitions()`
    //    não filtra por dono, devolve a lista do escritório — então o tópico
    //    também é único.
    //
    // Fonte única: a rede de postgres_changes saiu junto com saved_petitions da
    // publicação `supabase_realtime` — sobre tabela despublicada aquele canal
    // não receberia evento nenhum. O canal é privado e a policy de
    // realtime.messages só aceita equipe interna ATIVA. Ver
    // src/utils/broadcastReloadChannel.ts.
    return ligarRecargaPorBroadcast({
      escopo: 'Petitions',
      topico: 'petitions:changes',
      atrasoMs: 1500,
      recarregar: () => {
        setSavedPetitionsLoading(true);
        petitionEditorService
          .listPetitions()
          .then((petitionsData) => setSavedPetitions((petitionsData || []).map(sanitizeSavedPetitionRecord)))
          .catch(() => {
            // ignore
          })
          .finally(() => setSavedPetitionsLoading(false));
      },
    });
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
  const [blockEditorReady, setBlockEditorReady] = useState(false);
  const [blockEditorDirty, setBlockEditorDirty] = useState(false);
  const [blockFindReplaceMode, setBlockFindReplaceMode] = useState<'find' | 'replace' | null>(null);
  const blockDocStatusStore = useRef(createPetitionDocStatusStore()).current;
  const [blockWordCount, setBlockWordCount] = useState(0);
  const blockWordCountTimerRef = useRef<number | null>(null);
  const [selectionToCreateBlock, setSelectionToCreateBlock] = useState<{ sfdt: string; text: string } | null>(null);
  const blockModalInitDoneRef = useRef(false);
  const [blockTagInput, setBlockTagInput] = useState('');
  const [blockTagsSuggesting, setBlockTagsSuggesting] = useState(false);
  const [blockPropsOpen, setBlockPropsOpen] = useState(true);

  // Aceita "horas extras, dano moral" (vírgula/;/quebra de linha) preservando
  // expressões compostas — a busca de blocos pontua frases inteiras.
  const addBlockTags = (rawText: string) => {
    const parts = String(rawText || '')
      .split(/[,;\n]+/)
      .map((t) => normalizeTag(t))
      .filter(Boolean);
    if (parts.length === 0) return;

    setBlockFormData((prev) => {
      const existing = Array.isArray(prev.tags) ? prev.tags : [];
      const next = existing.slice();
      for (const p of parts) {
        if (!next.includes(p)) next.push(p);
      }
      return { ...prev, tags: next };
    });
    setBlockTagInput('');
    setBlockEditorDirty(true);
  };

  const removeBlockTag = (tag: string) => {
    setBlockFormData((prev) => ({
      ...prev,
      tags: (Array.isArray(prev.tags) ? prev.tags : []).filter((t) => t !== tag),
    }));
    setBlockEditorDirty(true);
  };

  const suggestBlockTags = async () => {
    if (blockTagsSuggesting) return;
    try {
      setBlockTagsSuggesting(true);
      const content = blockEditorRef.current?.getSfdt?.() || blockFormData.content || '';
      const suggested = await generateBlockTags(blockFormData.title, content);
      if (suggested.length) addBlockTags(suggested.join(','));
    } catch (err) {
      console.error('Erro ao sugerir tags do bloco:', err);
    } finally {
      setBlockTagsSuggesting(false);
    }
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
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setShowBlockSearchModal(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showBlockSearchModal]);

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
    setBlockEditorReady(false);
    setBlockEditorDirty(false);
    setBlockFindReplaceMode(null);
    blockDocStatusStore.set({ page: 1, pageCount: 1, zoom: DEFAULT_BLOCK_EDITOR_ZOOM, layout: 'Pages' });
    setBlockWordCount(0);
    setBlockStandardTypeLoading(false);
    setBlockTagInput('');
    setBlockPropsOpen(true);

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
        // Blocos antigos não têm tags gravadas: mostrar as mesmas que a
        // biblioteca deriva, para o painel bater com o card.
        tags: (normalizedBlock.tags || []).length ? normalizedBlock.tags : getBlockTagsForUI(normalizedBlock),
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

  const closeBlockView = useCallback(() => {
    blockViewDocxTokenRef.current += 1;
    setShowBlockViewModal(false);
    setViewingBlock(null);
    setViewingBlockMatchPct(null);
    setBlockViewFallbackText('');
    setBlockViewUseFallback(false);
    setBlockViewDocxError('');
    setBlockViewDocxLoading(false);
    if (blockViewDocxContainerRef.current) {
      blockViewDocxContainerRef.current.innerHTML = '';
    }
  }, []);

  useEffect(() => {
    if (!showBlockViewModal) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeBlockView();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [closeBlockView, showBlockViewModal]);

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
  const [showStartScreen, setShowStartScreen] = useState<boolean>(() => isFloatingWidget && !initialPetitionId && !initialDocumentBase64 && !initialDocumentUrl && !initialNextcloudPath && !initialDocSource);

  // Presença de edição em tempo real: este usuário aparece como "editando" para
  // os outros ENQUANTO ESTÁ NA TELA DE EDIÇÃO do documento — e some na hora em
  // que sai dela (volta ao início, vai para os blocos, fecha a janela), igual ao
  // Word. O estado vive no websocket, não em heartbeat de tabela: fechar a
  // janela derruba a presença sozinho.
  // Segue a ORIGEM ATIVA: ao abrir outro arquivo, a presença migra sozinha.
  const { peers: supabasePeers, signalTyping } = useEditingPresence({
    path: activeNextcloudPathValue,
    userId: user?.id,
    userName: userDisplayName,
    enabled: !showStartScreen && activeWorkspace === 'editor',
  });

  // ---------------------------------------------------------------------------
  // CO-EDIÇÃO: quem está editando junto vem da SALA, não do canal de presença.
  //
  // Havia duas listas concorrentes. A do Supabase diz apenas "esta pessoa está
  // com o arquivo aberto" — e era ela que pintava o "fulano está digitando…",
  // dando a entender que as edições estavam sendo sincronizadas mesmo quando
  // NENHUMA operação chegava ao servidor. Com uma sala de co-edição ativa, a
  // lista boa é a do SignalR: quem aparece nela está de fato no mesmo documento
  // e recebendo as mesmas operações.
  //
  // A presença do Supabase continua sendo publicada — o explorador do Nextcloud
  // depende dela para avisar quem está com um arquivo aberto —, mas o aviso de
  // digitação só passa por ela quando NÃO há co-edição.
  // ---------------------------------------------------------------------------
  const [collabPeers, setCollabPeers] = useState<CollabPeer[]>([]);
  const [collabStatus, setCollabStatus] = useState<CollabStatus>('off');
  const collabStatusRef = useRef<CollabStatus>('off');
  collabStatusRef.current = collabStatus;
  const collabSessionActive = collabStatus !== 'off';

  /**
   * ALGUÉM da sala gravou o documento no Nextcloud (o servidor avisa a sala
   * inteira). Numa sessão de coedição as edições desta tela já estão no
   * servidor, então a gravação de UM vale para TODOS: sem isto, quem não
   * clicou em Salvar continuava vendo "Alterações pendentes" de um conteúdo
   * que já estava gravado.
   */
  const handleCollabRemoteSave = useCallback((outcome: CollabSaveOutcome) => {
    // Desconectado, as edições daqui podem NEM TER CHEGADO ao servidor — a
    // gravação do outro não cobre o que só existe nesta tela.
    if (collabStatusRef.current !== 'connected') return;
    // Sobraram operações fora da gravação (chegaram durante o upload): a
    // pendência continua verdadeira até o próximo flush.
    if (outcome.stillPending > 0) return;
    // Só duas situações liberam a pendência: o arquivo foi gravado E CONFERIDO no
    // Nextcloud, ou não havia nada para gravar. Qualquer outra coisa — inclusive um
    // PUT que voltou 2xx sem a releitura conferir — continua sendo pendência.
    if (!isSaveConfirmed(outcome) && !isNothingToSave(outcome)) return;
    setHasUnsavedChanges(false);
    setLastSaved(outcome.savedAt ? new Date(outcome.savedAt) : new Date());
  }, []);

  /** A barra dentro do papel: sala de co-edição quando existe, presença quando não. */
  const editingPeersBase = useMemo(() => {
    if (collabSessionActive) {
      return collabPeers.map((peer) => ({
        id: peer.connectionId,
        userId: peer.userId,
        userName: peer.userName,
        typing: peer.typing,
      }));
    }
    return supabasePeers.map((peer) => ({
      id: peer.userId,
      userId: peer.userId,
      userName: peer.userName,
      // Sem sala de co-edição não existe edição sincronizada: mostrar "digitando"
      // aqui seria prometer o que o sistema não está fazendo.
      typing: false,
    }));
  }, [collabSessionActive, collabPeers, supabasePeers]);

  // A foto NÃO viaja com a presença (pode ser um `data:` de megabytes, que
  // derruba o SignalR e é recusado pelo Realtime). Ela é resolvida aqui, pelo
  // id, e fica em cache para a sessão inteira.
  const avatarOf = useUserAvatars(editingPeersBase.map((peer) => peer.userId));

  const editingPeers = useMemo(
    () => editingPeersBase.map((peer) => ({ ...peer, avatarUrl: avatarOf(peer.userId) })),
    [editingPeersBase, avatarOf],
  );

  // Plaquinha nome+foto EM CIMA DO CURSOR de cada pessoa (estilo Google Docs).
  // O cursor colorido é do Syncfusion; a identificação acompanha a lista da
  // sala — inclusive o "está digitando", que acende e apaga a plaquinha.
  useEffect(() => {
    if (!collabSessionActive) return;
    editorRef.current?.syncCollabCaretFlags?.(
      editingPeers.map((peer) => ({
        connectionId: peer.id,
        userName: peer.userName,
        avatarUrl: peer.avatarUrl,
        typing: peer.typing,
      })),
    );
  }, [editingPeers, collabSessionActive]);

  // Modo escuro do editor (estilo Word). Fonte unica de verdade: alterna a
  // classe `petition-dark` no <body> (cobre a faixa, o chrome do Syncfusion e
  // popups portados) e inverte a folha apenas na exibicao. Persistido em
  // localStorage e removido do <body> ao desmontar para nao afetar o CRM.
  const { darkMode, toggleDarkMode } = usePetitionEditorTheme();
  // Reforça a aplicação dos estilos estruturais/escuros na montagem (a injeção
  // no topo do módulo pode não re-executar sob HMR/Fast Refresh).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let styleEl = document.getElementById('petition-editor-structural-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'petition-editor-structural-styles';
      document.head.appendChild(styleEl);
    }
    styleEl.innerHTML = EDITOR_STYLES;
  }, []);

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

  // ===== Nextcloud dentro do editor: abrir, salvar, salvar como, cópia ======

  /** Qual janela do Nextcloud está aberta e para quê. */
  type NextcloudDialogState =
    | { mode: 'open' }
    | {
        mode: 'save';
        /** `save-as` troca a origem ativa; `save-copy` a preserva. */
        intent: 'save-as' | 'save-copy';
        initialPath: string;
        initialFileName: string;
      };

  const [nextcloudDialog, setNextcloudDialog] = useState<NextcloudDialogState | null>(null);
  const [nextcloudDialogBusy, setNextcloudDialogBusy] = useState(false);
  const [saveDestinationOpen, setSaveDestinationOpen] = useState(false);
  const [overwritePrompt, setOverwritePrompt] = useState<
    { path: string; adopt: boolean } | null
  >(null);
  const [versionConflict, setVersionConflict] = useState<{ path: string; adopt: boolean } | null>(null);
  const [unsavedPrompt, setUnsavedPrompt] = useState<
    { title: string; description: string; run: () => void } | null
  >(null);
  // Uma operação de rede por vez (evita download/upload duplicados).
  const nextcloudBusyRef = useRef(false);
  // Alguma janela do editor está aberta? Enquanto estiver, os atalhos globais
  // (Ctrl+S) e a faixa de opções ficam fora do caminho.
  const editorModalOpenRef = useRef(false);
  // Última pasta visitada no Nextcloud: reabrir a janela já no lugar de antes.
  const lastNextcloudDirRef = useRef<string>('');
  // Ação represada por "Salvar e continuar": só roda após a gravação CONFIRMADA.
  const pendingAfterSaveRef = useRef<(() => void) | null>(null);
  const flushPendingAfterSave = useCallback(() => {
    const run = pendingAfterSaveRef.current;
    if (!run) return;
    pendingAfterSaveRef.current = null;
    run();
  }, []);
  // File System Access API: enquanto a permissão vale, "baixar" atualiza o mesmo
  // arquivo local. É melhoria progressiva — nunca é exigida.
  const localFileHandleRef = useRef<any>(null);
  const [localFileHandleName, setLocalFileHandleName] = useState<string | null>(null);

  const originBadge = useMemo(() => describeOrigin(activeOrigin), [activeOrigin]);

  useEffect(() => {
    editorModalOpenRef.current = Boolean(
      nextcloudDialog || saveDestinationOpen || overwritePrompt || versionConflict || unsavedPrompt,
    );
  }, [nextcloudDialog, saveDestinationOpen, overwritePrompt, versionConflict, unsavedPrompt]);

  /** Nome sugerido para o documento atual, sempre terminado em `.docx`. */
  const suggestedDocxName = useCallback(() => {
    if (activeOrigin.kind === 'nextcloud') return activeOrigin.fileName;
    const raw = sanitizePetitionTitleText(petitionTitle, '') || initialDocumentName || 'documento';
    return normalizeDocxFileName(raw, 'documento');
  }, [activeOrigin, petitionTitle, initialDocumentName]);

  /** Exporta o documento aberto em DOCX, recusando um arquivo vazio. */
  const exportCurrentDocx = useCallback(async (fileName: string): Promise<Blob> => {
    const editor = editorRef.current;
    if (!editor) throw new Error('Editor nao disponivel');
    const blob = await editor.exportDocx(normalizeDocxFileName(fileName, 'documento'));
    if (!blob.size) {
      throw new Error('O documento exportado veio vazio (0 bytes). Nada foi enviado.');
    }
    return blob;
  }, []);

  /**
   * Grava o documento em `path` e só então dá o salvamento por concluído.
   * `adopt` decide se o caminho passa a ser a ORIGEM ATIVA ("Salvar como") ou se
   * a origem anterior é preservada ("Salvar uma cópia").
   */
  const persistToNextcloud = useCallback(async (
    path: string,
    options: { adopt: boolean; ifMatch?: string | null },
  ): Promise<boolean> => {
    if (nextcloudBusyRef.current) return false;
    nextcloudBusyRef.current = true;
    const startSeq = contentChangeSeqRef.current;
    setNextcloudDialogBusy(true);
    setSavingDoc(true);
    setError(null);
    try {
      const fileName = fileNameOf(path);

      // QUEM grava — ver `collabSaveScope.ts`. Com sala, quem grava é o
      // servidor e a gravação vale para TODO MUNDO; sem sala, este navegador
      // subiria a própria cópia por cima do arquivo, apagando o texto de quem
      // estiver editando junto (era o "cada um salva só o que escreveu").
      const saveScope = decideCollabSave({
        collabEnabled: isCollabEnabled(),
        inRoom: Boolean(editorRef.current?.isCollaborating?.()),
        savingActiveOrigin: options.adopt && activeNextcloudPathValue === path,
        otherEditors: editingPeers.map((peer) => peer.userName),
      });

      if (saveScope.kind === 'blocked-others-editing') {
        const who = describeOtherEditors(saveScope.peerNames);
        setError(
          `${who} está com este documento aberto e a edição em conjunto não subiu nesta janela. ` +
          'Gravar agora substituiria o texto dessa pessoa pelo seu. Feche e reabra o documento ' +
          'para entrar na edição em conjunto — ou use "Salvar uma cópia" para guardar o seu ' +
          'trabalho em outro arquivo, sem perder nada.',
        );
        return false;
      }

      // CO-EDIÇÃO, mesmo arquivo: NÃO subir o documento daqui. O servidor da sala
      // ainda tem operações a aplicar sobre a versão gravada; se o navegador
      // gravasse por cima agora, essas operações seriam aplicadas de novo depois
      // e o texto sairia duplicado. Quem escreve no Nextcloud é o servidor —
      // mas AGORA, a pedido, e só damos o salvamento por feito quando ele
      // confirma. (Antes esta linha mostrava "tudo sincronizado" sem pedir
      // gravação nenhuma: o arquivo só era escrito quando a última pessoa saía
      // do documento, e o usuário achava que tinha salvado.)
      if (saveScope.kind === 'room-flush') {
        if (collabStatusRef.current === 'disconnected') {
          setError(
            'A coedição está desconectada: as últimas edições não chegaram ao servidor. ' +
            'Reabra o documento para voltar a editar junto — nada do que você escreveu foi perdido.',
          );
          return false;
        }

        const collabEditor = editorRef.current;
        if (!collabEditor) {
          setError('O editor ainda não está pronto para gravar. Tente de novo em instantes.');
          return false;
        }

        const outcome = await collabEditor.flushCollaboration();

        // O serviço só responde 200 depois de gravar E RELER o arquivo no
        // Nextcloud. Ainda assim, conferimos aqui: "Salvo" não pode sair de um
        // resultado que não confirmou a gravação — era exatamente essa confiança
        // no 2xx que fazia a tela dizer "Salvo no Nextcloud" com o arquivo intacto.
        if (!isSaveConfirmed(outcome) && !isNothingToSave(outcome)) {
          setError(
            'O serviço não confirmou a gravação do documento no Nextcloud. ' +
            'Nada foi perdido: as edições continuam na sala. Tente salvar novamente.',
          );
          return false;
        }

        clearLocalDraft();
        setHasUnsavedChanges(contentChangeSeqRef.current !== startSeq);
        setLastSaved(new Date());

        await trackDocumentActivity({
          source: 'nextcloud',
          sourceKey: path,
          title: fileName,
          clientId: selectedClient?.id || null,
          clientName: selectedClient?.full_name || null,
          nextcloudPath: path,
          action: 'saved',
        });

        showSuccessMessage(
          isSaveConfirmed(outcome)
            ? 'Salvo no Nextcloud.'
            : 'Nada novo para gravar — o documento no Nextcloud já está em dia.',
        );
        // Libera a ação que estava esperando o salvamento (fechar, abrir outro…).
        flushPendingAfterSave();
        return true;
      }

      const blob = await exportCurrentDocx(fileName);
      // Gravação VERIFICADA: relê o arquivo no servidor e compara o tamanho.
      // Nada de "salvo" antes da confirmação do servidor.
      const write = (ifMatch: string | null) => nextcloudService.writeFileVerified(path, blob, {
        ifMatch: ifMatch ?? undefined,
      });

      let confirmed: { size: number; etag: string | null };
      try {
        confirmed = await write(options.ifMatch ?? null);
      } catch (writeError) {
        if (!(writeError instanceof NextcloudConflictError)) throw writeError;
        // 412 NÃO é prova de conflito: confirma contra o servidor antes de
        // alarmar. Acusar "outra pessoa alterou" quando ninguém alterou é pior
        // do que não checar — ensina o usuário a ignorar o aviso de verdade.
        const remote = await nextcloudService.stat(path).catch(() => null);
        const remoteUnchanged = Boolean(remote?.exists) && sameEntityTag(remote?.etag, options.ifMatch);
        if (!remoteUnchanged) {
          setVersionConflict({ path, adopt: options.adopt });
          return false;
        }
        // A versão remota é EXATAMENTE a que abrimos: ninguém mexeu no arquivo
        // e regravar é seguro.
        confirmed = await write(null);
      }

      if (options.adopt) {
        setActiveOrigin({ kind: 'nextcloud', path, fileName, etag: confirmed.etag });
        setPetitionTitle(getSanitizedDocumentName(fileName));
        clearLocalDraft();
        setHasUnsavedChanges(contentChangeSeqRef.current !== startSeq);
        setLastSaved(new Date());
        // "Salvar como" com co-edição: o arquivo mudou, então a sala tem de mudar
        // junto — senão o que for digitado daqui em diante continuaria indo para
        // o documento antigo.
        if (isCollabEnabled()) {
          try {
            await editorRef.current?.startCollaboration({
              path,
              fileName,
              userName: userDisplayName,
              userId: user?.id ?? null,
            });
          } catch (collabError) {
            console.error('Falha ao mover a co-edição para o novo arquivo:', collabError);
          }
        }
      } else {
        // A cópia não muda a origem: o documento aberto continua "sujo" se ainda
        // não foi gravado no destino original.
        updateActiveNextcloudEtag(path, confirmed.etag);
      }

      await trackDocumentActivity({
        source: 'nextcloud',
        sourceKey: path,
        title: fileName,
        clientId: selectedClient?.id || null,
        clientName: selectedClient?.full_name || null,
        nextcloudPath: path,
        action: 'saved',
      });

      showSuccessMessage(options.adopt ? 'Salvo no Nextcloud' : `Cópia criada em ${path}`);
      setNextcloudDialog(null);
      // "Salvar uma cópia" não resolve a pendência do documento aberto: só o
      // salvamento na origem ativa libera a ação represada.
      if (options.adopt) flushPendingAfterSave();
      return true;
    } catch (err) {
      if (err instanceof NextcloudConflictError) {
        setVersionConflict({ path, adopt: options.adopt });
        return false;
      }
      console.error('Erro ao salvar no Nextcloud:', err);
      setError(getNextcloudErrorMessage(err, 'salvar o arquivo'));
      return false;
    } finally {
      nextcloudBusyRef.current = false;
      setNextcloudDialogBusy(false);
      setSavingDoc(false);
    }
  }, [
    exportCurrentDocx,
    setActiveOrigin,
    updateActiveNextcloudEtag,
    clearLocalDraft,
    trackDocumentActivity,
    selectedClient?.id,
    selectedClient?.full_name,
    activeNextcloudPathValue,
    userDisplayName,
    user?.id,
    // Quem mais está no arquivo decide se a cópia local pode subir.
    editingPeers,
  ]);

  /** Confirma no SERVIDOR se o destino já existe antes de gravar. */
  const requestNextcloudSave = useCallback(async (target: NextcloudSaveTarget, adopt: boolean) => {
    if (nextcloudBusyRef.current) return;
    setNextcloudDialogBusy(true);
    try {
      const remote = await nextcloudService.stat(target.path);
      if (remote.exists) {
        // Nunca sobrescreve em silêncio: a decisão é sempre do usuário.
        setOverwritePrompt({ path: target.path, adopt });
        return;
      }
    } catch (err) {
      setError(getNextcloudErrorMessage(err, 'verificar o destino'));
      return;
    } finally {
      setNextcloudDialogBusy(false);
    }
    await persistToNextcloud(target.path, { adopt });
  }, [persistToNextcloud]);

  /** "Salvar uma cópia" a partir de um destino ocupado: resolve um nome livre. */
  const saveAsFreeCopy = useCallback(async (path: string, adopt: boolean) => {
    setNextcloudDialogBusy(true);
    try {
      const dir = parentPathOf(path);
      const freeName = await resolveFreeName(dir, fileNameOf(path));
      const freePath = buildNextcloudFilePath(dir, freeName);
      setOverwritePrompt(null);
      setVersionConflict(null);
      await persistToNextcloud(freePath, { adopt });
    } catch (err) {
      setError(getNextcloudErrorMessage(err, 'criar uma cópia'));
    } finally {
      setNextcloudDialogBusy(false);
    }
  }, [persistToNextcloud]);

  /** Abre um .docx do Nextcloud direto no editor (sem passar pelo módulo Cloud). */
  const openNextcloudDocument = useCallback(async (entry: { path: string; name: string }) => {
    if (nextcloudBusyRef.current) return;
    nextcloudBusyRef.current = true;
    setNextcloudDialogBusy(true);
    setDocumentImportLoading(true);
    setError(null);
    try {
      beginDocumentSettleWindow(DOCUMENT_LOAD_GUARD_MS);
      // PRIMEIRO sair da tela inicial: o SyncfusionEditor só é montado no
      // workspace do editor. Abrindo a partir da tela de início (Recentes ou
      // "Abrir do Nextcloud"), esperar pelo editor antes disso estourava o
      // tempo limite — ele nem existia ainda.
      setShowStartScreen(false);
      setActiveWorkspace('editor');

      // Co-edição ligada: o documento vem do serviço de co-edição, que abre o
      // arquivo do Nextcloud JÁ com o que as outras pessoas digitaram e ainda não
      // foi gravado. Baixar o arquivo aqui devolveria uma versão atrasada.
      const collabActive = isCollabEnabled();

      const arrayBuffer = collabActive
        ? null
        : await (async () => {
            const blob = await nextcloudService.readFile(entry.path);
            const buffer = await blob.arrayBuffer();
            if (buffer.byteLength === 0) {
              throw new Error('O documento do Nextcloud está vazio (0 bytes).');
            }
            return buffer;
          })();

      // Margem maior: vindo da tela inicial, o Syncfusion está sendo montado
      // (e o chunk pode estar sendo baixado) agora.
      const editor = await waitForEditorReady(80, 150);
      if (!editor) throw new Error('O editor Syncfusion nao carregou a tempo. Tente recarregar a pagina.');

      // ETag da versão que estamos abrindo: é ele que detecta, no próximo save,
      // que outra pessoa alterou o arquivo enquanto editávamos.
      let etag: string | null = null;
      try {
        etag = (await nextcloudService.stat(entry.path)).etag ?? null;
      } catch {
        // Sem ETag apenas perdemos a checagem otimista — a gravação verificada
        // continua valendo.
      }

      let collabFallbackReason: string | null = null;

      if (collabActive) {
        try {
          await editor.startCollaboration({
            path: entry.path,
            fileName: entry.name,
            userName: userDisplayName,
            userId: user?.id ?? null,
          });
        } catch (collabError) {
          // O serviço de co-edição fora do ar não pode impedir de trabalhar no
          // documento: cai para a abertura direta do Nextcloud e DIZ que a
          // edição em conjunto não está valendo para este arquivo.
          console.error('Falha ao entrar na coedição; abrindo o documento sozinho:', collabError);
          collabFallbackReason =
            'Não foi possível entrar na edição em conjunto: você está editando uma cópia própria deste ' +
            'documento. Se outra pessoa abrir o mesmo arquivo, quem salvar por último sobrescreve o outro.';

          const blob = await nextcloudService.readFile(entry.path);
          const buffer = await blob.arrayBuffer();
          if (buffer.byteLength === 0) {
            throw new Error('O documento do Nextcloud está vazio (0 bytes).');
          }
          await loadDocxWithFallback(editor, buffer, entry.name);
        }
      } else {
        await loadDocxWithFallback(editor, arrayBuffer!, entry.name);
      }
      captureAndApplyDocFontSoon(editor);

      // A origem ativa troca AQUI: o lock/heartbeat do documento anterior é
      // liberado pelo efeito de presença e o novo caminho assume.
      setActiveOrigin({ kind: 'nextcloud', path: entry.path, fileName: entry.name, etag });
      setPetitionTitle(getSanitizedDocumentName(entry.name));
      setSourceCloudFile(null);
      setNextcloudDialog(null);

      await waitForDocumentRendered(editor);
      beginDocumentSettleWindow();
      setHasUnsavedChanges(false);
      setLastSaved(null);

      void trackDocumentActivity({
        source: 'nextcloud',
        sourceKey: entry.path,
        title: entry.name,
        clientId: selectedClient?.id || null,
        clientName: selectedClient?.full_name || null,
        nextcloudPath: entry.path,
        action: 'opened',
      });
      if (collabFallbackReason) {
        setError(collabFallbackReason);
      } else {
        showSuccessMessage('Documento aberto do Nextcloud.');
      }
    } catch (err) {
      console.error('Erro ao abrir documento do Nextcloud:', err);
      setError(getNextcloudErrorMessage(err, 'abrir o documento'));
    } finally {
      nextcloudBusyRef.current = false;
      setNextcloudDialogBusy(false);
      setDocumentImportLoading(false);
    }
  }, [
    beginDocumentSettleWindow,
    setActiveOrigin,
    trackDocumentActivity,
    selectedClient?.id,
    selectedClient?.full_name,
    userDisplayName,
    user?.id,
  ]);

  /** Recarrega a versão do servidor, descartando as alterações locais (escolha explícita). */
  const reloadFromServer = useCallback(async (path: string) => {
    setVersionConflict(null);
    clearLocalDraft();
    await openNextcloudDocument({ path, name: fileNameOf(path) });
  }, [clearLocalDraft, openNextcloudDocument]);

  /**
   * Baixa uma cópia DOCX para o dispositivo. NUNCA altera a origem ativa: um
   * download comum não dá ao navegador um caminho local reutilizável.
   * Quando o navegador suporta `showSaveFilePicker`, guardamos o handle para
   * atualizar o mesmo arquivo durante a sessão.
   */
  const downloadDocxCopy = useCallback(async (options: { reuseHandle?: boolean } = {}) => {
    const fileName = suggestedDocxName();
    try {
      const blob = await exportCurrentDocx(fileName);
      const picker = (window as any).showSaveFilePicker;

      if (options.reuseHandle && localFileHandleRef.current) {
        const handle = localFileHandleRef.current;
        const permission = await handle.queryPermission?.({ mode: 'readwrite' });
        const granted = permission === 'granted'
          || (await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted';
        if (granted) {
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          showSuccessMessage(`Arquivo local atualizado: ${handle.name}`);
          return;
        }
      }

      if (typeof picker === 'function') {
        try {
          const handle = await picker.call(window, {
            suggestedName: fileName,
            types: [{
              description: 'Documento do Word',
              accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] },
            }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          localFileHandleRef.current = handle;
          setLocalFileHandleName(handle.name || fileName);
          showSuccessMessage(`Cópia salva no dispositivo: ${handle.name || fileName}`);
          return;
        } catch (pickerError) {
          // Cancelou o seletor: não é erro, e nada mais deve acontecer.
          if ((pickerError as DOMException)?.name === 'AbortError') return;
          // Qualquer outra falha cai no download comum abaixo.
        }
      }

      saveAs(blob, fileName);
      showSuccessMessage('Download preparado. O arquivo baixado não fica conectado ao Nextcloud.');
    } catch (err) {
      console.error('Erro ao baixar cópia:', err);
      setError(err instanceof Error ? err.message : 'Erro ao baixar o documento');
    }
  }, [exportCurrentDocx, suggestedDocxName]);

  /** Abre a janela do Nextcloud no modo salvar. */
  const openNextcloudSaveDialog = useCallback((intent: 'save-as' | 'save-copy') => {
    const origin = activeOriginRef.current;
    setSaveDestinationOpen(false);
    setNextcloudDialog({
      mode: 'save',
      intent,
      initialPath: origin.kind === 'nextcloud' ? parentPathOf(origin.path) : '',
      initialFileName: suggestedDocxName(),
    });
  }, [suggestedDocxName]);

  // Salvar petiçÃ£o
  const savePetition = async (request: { auto?: boolean; forceJurius?: boolean } = {}) => {
    const startSeq = contentChangeSeqRef.current;
    const origin = activeOriginRef.current;

    // Documento já salvo e sem alterações: nada a gravar. O Ctrl+S segue a
    // mesma regra do botão (que fica cinza) em vez de refazer um upload igual.
    // "Salvar como" e "Salvar uma cópia" não passam por aqui e continuam ativos.
    if (!request.forceJurius && !hasUnsavedChangesRef.current) return;
    // `forceJurius`: escolha explícita do usuário no diálogo de destino.
    const decision: ReturnType<typeof decideSaveTarget> = request.forceJurius
      ? { action: 'petition', petitionId: currentPetitionIdRef.current }
      : decideSaveTarget(origin, {
        hasPersistedPetition: Boolean(currentPetitionIdRef.current ?? currentPetitionId),
      });

    // Sem destino persistente (documento novo, modelo ou DOCX do computador):
    // o usuário escolhe onde salvar antes de qualquer gravação. Salvamentos
    // automáticos (sincronização pós-offline) nunca abrem janela.
    if (decision.action === 'ask') {
      if (request.auto) return;
      setSaveDestinationOpen(true);
      return;
    }

    const docSource = decision.action === 'external' ? decision.source : null;

    // Origem Nextcloud: grava direto no caminho conhecido, com If-Match.
    if (decision.action === 'nextcloud') {
      if (!isOnlineRef.current) {
        setPendingOfflineSync(true);
        setError('Voce esta offline. O Peticionamento e 100% online: reconecte para editar/salvar.');
        return;
      }
      if (isLoadingPetitionRef.current) {
        setError('Aguarde o carregamento do documento antes de salvar');
        return;
      }
      await persistToNextcloud(decision.path, { adopt: true, ifMatch: decision.etag });
      return;
    }

    // Regra: salvar apenas documentos vinculados a cliente — exceto quando o
    // documento veio de uma ORIGEM EXTERNA (template/petição padrão/…):
    // salvamos de volta na origem, sem criar petição.
    if (!selectedClient?.id && !docSource) {
      if (initialClientId) {
        return;
      }
      setError('Selecione um cliente antes de salvar a peticao');
      return;
    }
    if (!isOnlineRef.current) {
      setPendingOfflineSync(true);
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

      if (docSource) {
        // Origem externa: exporta e grava de volta na origem, sem petição.
        const exportedName = initialDocumentName || `${title}.docx`;
        const fileName = exportedName.endsWith('.docx') ? exportedName : `${exportedName}.docx`;
        const blob = await editor.exportDocx(fileName);
        if (!blob.size) {
          throw new Error('O documento exportado veio vazio (0 bytes). Nada foi salvo.');
        }
        await saveEditorDocSource(docSource, blob, fileName);
      } else {
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
            // Atualiza ref ANTES do state â€” prÃ³ximos saves leem imediatamente.
            // A origem ativa passa a ser a petição recém-criada: o próximo
            // Ctrl+S atualiza este registro em vez de perguntar de novo.
            setActiveOrigin({ kind: 'petition', petitionId: savedRow.id });
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
          await trackDocumentActivity({
            source: 'petition',
            sourceKey: savedRow.id,
            title: savedRow.title || title,
            clientId: savedRow.client_id || clientId,
            clientName: savedRow.client_name || clientName,
            action: 'saved',
            activityAt: savedRow.updated_at,
          });
        }

        if (sourceCloudFile) {
          const exportedName = initialDocumentName || sourceCloudFile.original_name || `${title}.docx`;
          const blob = await editor.exportDocx(exportedName.endsWith('.docx') ? exportedName : `${exportedName}.docx`);
          const updatedCloudFile = await cloudService.replaceFileContents(sourceCloudFile, blob, exportedName.endsWith('.docx') ? exportedName : `${exportedName}.docx`);
          setSourceCloudFile(updatedCloudFile);
        }
      }

      setHasUnsavedChanges(contentChangeSeqRef.current !== startSeq);
      setLastSaved(new Date());
      clearLocalDraft();
      showSuccessMessage(docSource ? editorDocSourceSavedLabel(docSource) : savedLabelFor(decision));
      flushPendingAfterSave();
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

  // Autosave para o Nextcloud REMOVIDO a pedido do usuário: documentos abertos
  // do Nextcloud são gravados de volta apenas quando o usuário salva manualmente
  // (botão Salvar / Ctrl+S). O rascunho local continua sendo mantido para não
  // perder trabalho, mas a gravação no servidor não é mais automática.

  const restoreLocalDraft = useCallback(async () => {
    const draft = loadLocalDraftFromStorage();
    if (!draft) {
      setError('Nenhuma cópia local encontrada para restaurar.');
      return;
    }

    if (hasUnsavedChangesRef.current) {
      const proceed = window.confirm('Existem alterações atuais não salvas. Deseja substituí-las pela última cópia local?');
      if (!proceed) return;
    }

    if (draft.clientId) {
      const client = clients.find((item) => item.id === draft.clientId) || null;
      if (client) setSelectedClient(client);
    }
    if (draft.legalAreaId) setSelectedLegalAreaId(draft.legalAreaId);
    setSelectedStandardTypeId(draft.standardTypeId || null);
    currentPetitionIdRef.current = draft.currentPetitionId || null;
    setCurrentPetitionId(draft.currentPetitionId || null);
    setPetitionTitle(draft.title || getDefaultPetitionTitle());

    const editor = editorRef.current;
    if (editor) {
      await Promise.resolve(editor.loadSfdt(draft.content));
      editor.focus();
    }

    setHasUnsavedChanges(true);
    setPendingOfflineSync(true);
    setLocalDraftUpdatedAt(draft.updatedAt);
    setRestorableLocalDraft(draft);
    showSuccessMessage('Última cópia local restaurada');
  }, [clients, getDefaultPetitionTitle, loadLocalDraftFromStorage]);

  useEffect(() => {
    if (!editorReady) return;
    if (!hasUnsavedChanges) return;

    const timer = window.setTimeout(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const content = editor.getSfdt();
      if (!String(content || '').trim()) return;

      const draft: LocalPetitionDraft = {
        title: petitionTitle || getDefaultPetitionTitle(),
        content,
        currentPetitionId: currentPetitionIdRef.current ?? currentPetitionId ?? null,
        clientId: selectedClient?.id ?? null,
        legalAreaId: selectedLegalAreaId ?? null,
        standardTypeId: selectedStandardTypeId ?? null,
        updatedAt: new Date().toISOString(),
      };

      writeLocalDraft(draft);
      if (!isOnlineRef.current || !serverReachableRef.current) {
        setPendingOfflineSync(true);
      }
    }, sourceNextcloudPathRef.current ? 350 : 1800);

    return () => window.clearTimeout(timer);
  }, [
    currentPetitionId,
    editorReady,
    getDefaultPetitionTitle,
    hasUnsavedChanges,
    petitionTitle,
    selectedClient?.id,
    selectedLegalAreaId,
    selectedStandardTypeId,
    writeLocalDraft,
  ]);

  useEffect(() => {
    if (!editorReady) return;
    if (!pendingOfflineSync) return;
    if (!hasUnsavedChangesRef.current) return;
    if (!isOnline || !serverReachable) return;
    if (!selectedClientIdRef.current) return;
    if (saveInFlightRef.current) return;

    const timer = window.setTimeout(() => {
      void savePetitionActionRef.current?.({ auto: true });
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [editorReady, isOnline, pendingOfflineSync, serverReachable]);

  // PetiçÃ£o pendente para carregar apÃ³s o editor estar pronto
  const pendingPetitionRef = useRef<SavedPetition | null>(null);

  // Carregar petiçÃ£o existente
  const loadPetition = async (petition: SavedPetition) => {
    if (isLoadingPetitionRef.current) return;
    isLoadingPetitionRef.current = true;
    beginDocumentSettleWindow(DOCUMENT_LOAD_GUARD_MS);
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

    // Atualizar estados primeiro. A origem ativa passa a ser a petição do
    // Jurius — isso libera o lock de um eventual documento Nextcloud anterior.
    setActiveOrigin({ kind: 'petition', petitionId: petitionToLoad.id });
    setSourceCloudFile(null);
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
    void trackDocumentActivity({
      source: 'petition',
      sourceKey: petitionToLoad.id,
      title: petitionToLoad.title || 'Sem título',
      clientId: petitionToLoad.client_id,
      clientName: petitionToLoad.client_name,
      action: 'opened',
    });

    const editor = editorRef.current;
    if (editor && petitionToLoad.content) {
      try {
        await editor.loadSfdt(petitionToLoad.content);
        captureAndApplyDocFontSoon(editor);
        setHasUnsavedChanges(false);
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
          setHasUnsavedChanges(false);
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
      beginDocumentSettleWindow();
      editor.clear();
      const f = defaultDocFontRef.current;
      if (f) {
        editor.applyCurrentFont?.(f.fontFamily, f.fontSize);
      }
    }

    // Documento em branco: sem destino persistente até o usuário escolher um.
    setActiveOrigin({ kind: 'new' });
    setSourceCloudFile(null);
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
    const replacingSavedDocument = Boolean(currentPetitionIdRef.current);

    try {
      const editor = editorRef.current;
      if (!editor) {
        setError('Editor nao disponivel');
        return;
      }

      beginDocumentSettleWindow(DOCUMENT_LOAD_GUARD_MS);
      const arrayBuffer = await file.arrayBuffer();
      await loadDocxWithFallback(editor, arrayBuffer, file.name);
      captureAndApplyDocFontSoon(editor);
      // Um DOCX do computador não tem caminho reutilizável no navegador: o
      // documento fica SEM origem persistente e o primeiro "Salvar" pergunta
      // onde gravar (Nextcloud, Jurius ou download).
      setActiveOrigin({ kind: 'new' });
      setSourceCloudFile(null);
      setPetitionTitle(getSanitizedDocumentName(file.name));
      // Abrir um arquivo a partir da tela inicial estabelece uma nova linha de
      // base limpa. Se já havia uma petição salva aberta, a importação substitui
      // seu conteúdo e deve continuar sendo tratada como alteração.
      setHasUnsavedChanges(replacingSavedDocument);

      try {
        // Importar um documento no editor NAO deve alterar o modelo padrao global.
        // O modelo padrao so muda pelos fluxos explicitos de configuracao.
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
  /** O preview formatado é cacheado por bloco; qualquer alteração invalida. */
  const invalidateBlockPreview = (blockId: string) => {
    bmPreviewHtmlRef.current.delete(blockId);
    const container = bmPreviewContainersRef.current.get(blockId);
    if (container) container.innerHTML = '';
    setBmDocxPreviews((prev) => {
      if (!prev.has(blockId)) return prev;
      const next = new Map(prev);
      next.delete(blockId);
      return next;
    });
  };

  const deleteBlock = async (blockId: string): Promise<boolean> => {
    if (!confirm('Tem certeza que deseja excluir este bloco?')) return false;

    try {
      await petitionEditorService.deleteBlock(blockId);
      setBlocks((prev) => prev.filter((b) => b.id !== blockId));
      invalidateBlockPreview(blockId);
      showSuccessMessage('Bloco excluido');
      return true;
    } catch (err) {
      console.error('Erro ao excluir bloco:', err);
      setError('Erro ao excluir bloco');
      return false;
    }
  };

  // Handler de mudança de conteudo do editor
  // ── Status bar (página, palavras, zoom, modo) ─────────────────────────────
  const docStatusStore = useRef(createPetitionDocStatusStore()).current;
  const [wordCount, setWordCount] = useState(0);
  /** Total de páginas para o assistente de IA — atualizado no debounce da
   *  contagem de palavras, NÃO a cada rolagem (ver petitionDocStatus.ts). */
  const [aiPageCount, setAiPageCount] = useState(1);
  const [aiSelectedText, setAiSelectedText] = useState('');
  const [aiHasDocumentContent, setAiHasDocumentContent] = useState(false);
  const wordCountTimerRef = useRef<number | null>(null);

  const refreshDocStatus = useCallback(() => {
    const editor = editorRef.current;
    if (!editor?.getPageInfo) return;
    try {
      const info = editor.getPageInfo();
      const zoom = editor.getZoom();
      const layout = editor.getLayoutType();
      docStatusStore.set({ page: info.current, pageCount: info.total, zoom, layout });
    } catch {
      // ignore
    }
  }, [docStatusStore]);

  /** Recontagem de palavras com debounce — a travessia do modelo é barata, mas
   *  não precisa rodar a cada tecla. */
  const scheduleWordCount = useCallback((delayMs = 900) => {
    if (wordCountTimerRef.current) window.clearTimeout(wordCountTimerRef.current);
    wordCountTimerRef.current = window.setTimeout(() => {
      try {
        const editor = editorRef.current;
        const nextWordCount = editor?.getWordCount?.() ?? 0;
        const pageCount = editor?.getPageInfo?.().total ?? 1;
        setWordCount(nextWordCount);
        setAiPageCount(pageCount);
        setAiHasDocumentContent(
          nextWordCount > 0
          || pageCount > 1
          || Boolean(editor?.hasContent?.())
        );
      } catch {
        // ignore
      }
    }, delayMs);
  }, []);

  useEffect(() => () => {
    if (wordCountTimerRef.current) window.clearTimeout(wordCountTimerRef.current);
  }, []);

  const refreshBlockDocStatus = useCallback(() => {
    const editor = blockEditorRef.current;
    if (!editor?.getPageInfo) return;
    try {
      const info = editor.getPageInfo();
      const zoom = editor.getZoom();
      const layout = editor.getLayoutType();
      blockDocStatusStore.set({ page: info.current, pageCount: info.total, zoom, layout });
    } catch {
      // ignore
    }
  }, [blockDocStatusStore]);

  const scheduleBlockWordCount = useCallback((delayMs = 500) => {
    if (blockWordCountTimerRef.current) window.clearTimeout(blockWordCountTimerRef.current);
    blockWordCountTimerRef.current = window.setTimeout(() => {
      try {
        setBlockWordCount(blockEditorRef.current?.getWordCount?.() ?? 0);
      } catch {
        // ignore
      }
    }, delayMs);
  }, []);

  useEffect(() => () => {
    if (blockWordCountTimerRef.current) window.clearTimeout(blockWordCountTimerRef.current);
  }, []);

  const handleBlockContentChange = useCallback(() => {
    refreshBlockDocStatus();
    scheduleBlockWordCount();
    if (blockModalInitDoneRef.current) setBlockEditorDirty(true);
  }, [refreshBlockDocStatus, scheduleBlockWordCount]);

  const handleContentChange = () => {
    refreshDocStatus();
    scheduleWordCount();
    if (isLoadingPetitionRef.current) return;
    // Ajustes automáticos logo após abrir o documento (fonte padrão, margens,
    // repaginação) não são edição do usuário — não marcam alterações pendentes.
    if (isProgrammaticContentChange()) return;
    // "Está digitando": numa sessão de co-edição quem avisa é a própria SALA
    // (o SyncfusionEditor chama `notifyTyping` junto com a operação, e só quando
    // há mais alguém lá). Mandar também pelo canal de presença duplicaria o
    // aviso — e era esse canal que pintava "fulano digitando" mesmo quando nada
    // estava sincronizando.
    if (!collabSessionActive) signalTyping();
    // Marcar o documento como alterado antes de qualquer validação de conectividade.
    // Se a conexão cair no meio da edição, o navegador ainda precisa bloquear a saída.
    contentChangeSeqRef.current += 1;
    setHasUnsavedChanges(true);
    if (!isOnlineRef.current) {
      setPendingOfflineSync(true);
      setError('Voce esta offline. O Peticionamento e 100% online: reconecte para editar/salvar.');
      return;
    }
    if (!serverReachableRef.current) {
      setPendingOfflineSync(true);
      setError('Sem conexao com o servidor. Reconecte antes de continuar para nao perder alteracoes.');
      return;
    }
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
        invalidateBlockPreview(updated.id);

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
      setBlockEditorDirty(false);
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
      setBlockEditorReady(false);
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
        ed.setZoom(DEFAULT_BLOCK_EDITOR_ZOOM);
        window.setTimeout(() => ed.setZoom(DEFAULT_BLOCK_EDITOR_ZOOM), 80);

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

        // O Syncfusion emite contentChange durante a abertura do SFDT. Só
        // começamos a considerar mudanças do usuário após a carga e o fallback.
        window.setTimeout(() => {
          if (cancelled) return;
          ed.setZoom(DEFAULT_BLOCK_EDITOR_ZOOM);
          blockModalInitDoneRef.current = true;
          setBlockEditorDirty(false);
          refreshBlockDocStatus();
          scheduleBlockWordCount(100);
        }, 420);
      } catch {
        // ignore
      }
    };

    tryLoad();

    return () => {
      cancelled = true;
    };
  }, [
    showBlockModal,
    blockFormData.content,
    editingBlock?.id,
    refreshBlockDocStatus,
    scheduleBlockWordCount,
  ]);

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

  // editor.open() resolve assim que o DOCX vira modelo interno, mas o Syncfusion
  // ainda pagina e pinta o conteúdo depois. Sem esperar por isso, o overlay
  // "Preparando documento" sumia cedo demais e o usuário via o editor em branco
  // por alguns instantes. Aqui aguardamos a paginação estabilizar (documentos
  // grandes paginam em etapas) e um frame de pintura antes de liberar.
  const waitForDocumentRendered = async (
    editor: SyncfusionEditorRef,
    maxWaitMs = 15000,
    intervalMs = 120,
  ) => {
    const startedAt = Date.now();
    let lastPageCount = -1;
    let stableTicks = 0;

    while (Date.now() - startedAt < maxWaitMs) {
      const instance = (editor as any)?.getEditor?.();
      const viewer = instance?.documentHelper ?? instance?.viewer;
      const pageCount = Number(instance?.pageCount ?? 0);
      const renderedPages = Number(viewer?.pages?.length ?? 0);

      if (pageCount > 0 && renderedPages > 0) {
        if (pageCount === lastPageCount) {
          stableTicks += 1;
          if (stableTicks >= 2) break;
        } else {
          stableTicks = 0;
        }
        lastPageCount = pageCount;
      }

      await new Promise<void>((resolve) => window.setTimeout(resolve, intervalMs));
    }

    // Um frame para o canvas efetivamente pintar. Aba em segundo plano não
    // dispara rAF, então mantemos um timeout como saída garantida.
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      window.requestAnimationFrame(finish);
      window.setTimeout(finish, 200);
    });
  };

  const importInitialDocument = useCallback(async (dataBase64: string, fileName?: string) => {
    try {
      setDocumentImportLoading(true);
      beginDocumentSettleWindow(DOCUMENT_LOAD_GUARD_MS);
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
      await waitForDocumentRendered(editor);
      beginDocumentSettleWindow();
      setHasUnsavedChanges(false);
      showSuccessMessage('Documento aberto');
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
    // Object URLs (ex.: documento vindo do Nextcloud) só valem enquanto vivos.
    // Só podem ser revogados DEPOIS que o fetch abaixo terminar de ler o blob —
    // revogar antes quebraria o carregamento. Fazemos isso no finally.
    const isObjectUrl = documentUrl.startsWith('blob:');
    try {
      setDocumentImportLoading(true);
      beginDocumentSettleWindow(DOCUMENT_LOAD_GUARD_MS);
      const initialClient = applyInitialClientIfNeeded();

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
      const restoredDraft = await restoreNextcloudDraft(editor);
      if (!restoredDraft) {
        const openedFromNextcloud = Boolean(sourceNextcloudPathRef.current);
        setHasUnsavedChanges(false);
        showSuccessMessage(openedFromNextcloud ? 'Documento aberto do Nextcloud.' : 'Documento importado com sucesso.');
      }
      restoreCursorPosition();
      // Depois do rascunho restaurado (que repagina o documento), só então o
      // conteúdo final está na tela — é aqui que a animação pode parar.
      await waitForDocumentRendered(editor);
      if (!restoredDraft) {
        beginDocumentSettleWindow();
        setHasUnsavedChanges(false);
      }
      const nextcloudPath = sourceNextcloudPathRef.current;
      if (nextcloudPath) {
        // ETag da versão aberta: habilita o If-Match do próximo salvamento.
        void nextcloudService.stat(nextcloudPath)
          .then((meta) => updateActiveNextcloudEtag(nextcloudPath, meta.etag ?? null))
          .catch(() => { /* sem ETag, a gravação verificada ainda protege */ });
        void trackDocumentActivity({
          source: 'nextcloud',
          sourceKey: nextcloudPath,
          title: fileName || nextcloudPath.split('/').pop() || 'Documento do Nextcloud',
          clientId: initialClient?.id || initialClientId || null,
          clientName: initialClient?.full_name || null,
          nextcloudPath,
          action: 'opened',
        });
      }
      if (!petitionTitle || petitionTitle === 'Nova Peticao Trabalhista') {
        setPetitionTitle(getSanitizedDocumentName(fileName));
      }
    } catch (err: any) {
      console.error('Erro ao importar documento inicial por URL:', err);
      const msg = err?.message || 'Erro desconhecido';
      setError(`Nao foi possivel abrir o documento: ${msg}`);
    } finally {
      setDocumentImportLoading(false);
      // Libera a object URL agora que o blob já foi totalmente lido (ou falhou).
      if (isObjectUrl) {
        try { URL.revokeObjectURL(documentUrl); } catch { /* já revogada */ }
      }
      // Avisa o app (abertura em nova aba) que o documento terminou de carregar,
      // para o loader próprio da aba sumir só agora — uma animação só, contínua.
      window.setTimeout(() => {
        try { window.dispatchEvent(new Event('petition-editor-doc-ready')); } catch { /* ignore */ }
      }, 350);
    }
  }, [applyInitialClientIfNeeded, initialClientId, petitionTitle, restoreNextcloudDraft, restoreCursorPosition, trackDocumentActivity, updateActiveNextcloudEtag]);

  // Recarrega o .docx direto do Nextcloud pelo caminho de origem. Usado na
  // restauração do widget após um reload da página: a object URL do blob morre
  // com o reload, então relemos o arquivo salvo no servidor.
  const importInitialDocumentFromNextcloud = useCallback(async (nextcloudPath: string, fileName?: string) => {
    try {
      setDocumentImportLoading(true);
      beginDocumentSettleWindow(DOCUMENT_LOAD_GUARD_MS);
      const initialClient = applyInitialClientIfNeeded();
      const documentName = fileName || nextcloudPath.split('/').pop() || 'documento.docx';

      // ESTE é o caminho que abre o documento quando ele vem do explorador do
      // Nextcloud (janela própria do Editor, `/editor?...initialNextcloudPath`)
      // — na prática, o caminho mais usado. Ele baixava o .docx direto e nunca
      // entrava na sala de co-edição: duas pessoas no mesmo arquivo ficavam
      // cada uma com a sua cópia, sem ver o que a outra digitava, ainda que o
      // serviço de co-edição estivesse no ar e configurado.
      const collabActive = isCollabEnabled();

      // Com co-edição, o conteúdo vem do serviço (que já aplica o que os outros
      // digitaram e ainda não foi gravado). Baixar aqui devolveria uma versão
      // atrasada.
      const readFromNextcloud = async () => {
        const blob = await nextcloudService.readFile(nextcloudPath);
        const buffer = await blob.arrayBuffer();
        if (buffer.byteLength === 0) {
          throw new Error('O documento do Nextcloud esta vazio (0 bytes).');
        }
        return buffer;
      };

      const arrayBuffer = collabActive ? null : await readFromNextcloud();

      // ETag da versão aberta: habilita o If-Match do próximo salvamento.
      try {
        const meta = await nextcloudService.stat(nextcloudPath);
        updateActiveNextcloudEtag(nextcloudPath, meta.etag ?? null);
      } catch {
        // sem ETag, a gravação verificada ainda protege contra "salvo" falso
      }

      const editor = await waitForEditorReady();
      if (!editor) {
        setError('O editor Syncfusion nao carregou a tempo. Tente recarregar a pagina.');
        return;
      }

      let joinedCollab = false;
      let collabFallbackReason: string | null = null;

      if (collabActive) {
        try {
          await editor.startCollaboration({
            path: nextcloudPath,
            fileName: documentName,
            userName: userDisplayName,
            userId: user?.id ?? null,
          });
          joinedCollab = true;
        } catch (collabError) {
          // Serviço fora do ar não pode impedir de trabalhar: abre normalmente
          // e DIZ que a edição em conjunto não está valendo para este arquivo.
          console.error('Falha ao entrar na coedição; abrindo o documento sozinho:', collabError);
          collabFallbackReason =
            'Não foi possível entrar na edição em conjunto: você está editando uma cópia própria deste ' +
            'documento. Se outra pessoa abrir o mesmo arquivo, quem salvar por último sobrescreve o outro.';
          await loadDocxWithFallback(editor, await readFromNextcloud(), documentName);
        }
      } else {
        await loadDocxWithFallback(editor, arrayBuffer!, documentName);
      }

      captureAndApplyDocFontSoon(editor);
      setShowStartScreen(false);
      // Rascunho local NÃO entra por cima de um documento em co-edição: o que
      // ele contém já foi para o servidor operação por operação, e reaplicá-lo
      // duplicaria o texto.
      const restoredDraft = joinedCollab ? false : await restoreNextcloudDraft(editor);
      if (!restoredDraft) {
        // Recém-carregado do servidor: sem alterações pendentes ainda.
        setHasUnsavedChanges(false);
      }
      if (collabFallbackReason) setError(collabFallbackReason);
      restoreCursorPosition();
      await waitForDocumentRendered(editor);
      if (!restoredDraft) {
        beginDocumentSettleWindow();
        setHasUnsavedChanges(false);
      }
      void trackDocumentActivity({
        source: 'nextcloud',
        sourceKey: nextcloudPath,
        title: documentName,
        clientId: initialClient?.id || initialClientId || null,
        clientName: initialClient?.full_name || null,
        nextcloudPath,
        action: 'opened',
      });
      if (!petitionTitle || petitionTitle === 'Nova Peticao Trabalhista') {
        setPetitionTitle(getSanitizedDocumentName(fileName));
      }
    } catch (err: any) {
      console.error('Erro ao reabrir documento do Nextcloud:', err);
      const msg = err?.message || 'Erro desconhecido';
      setError(`Nao foi possivel reabrir o documento do Nextcloud: ${msg}`);
    } finally {
      setDocumentImportLoading(false);
      window.setTimeout(() => {
        try { window.dispatchEvent(new Event('petition-editor-doc-ready')); } catch { /* ignore */ }
      }, 350);
    }
  }, [
    applyInitialClientIfNeeded,
    initialClientId,
    petitionTitle,
    restoreNextcloudDraft,
    restoreCursorPosition,
    trackDocumentActivity,
    updateActiveNextcloudEtag,
    userDisplayName,
    user?.id,
  ]);

  // Carrega o .docx de uma ORIGEM EXTERNA (template/petição padrão/…) no editor.
  // Espelha o fluxo do Nextcloud; ao salvar, grava de volta (ver savePetition).
  const importInitialDocumentFromSource = useCallback(async (src: EditorDocSource, fileName?: string) => {
    try {
      setDocumentImportLoading(true);
      beginDocumentSettleWindow(DOCUMENT_LOAD_GUARD_MS);

      const blob = await loadEditorDocSource(src);
      const arrayBuffer = await blob.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        throw new Error('O documento está vazio (0 bytes).');
      }

      const editor = await waitForEditorReady();
      if (!editor) {
        setError('O editor Syncfusion nao carregou a tempo. Tente recarregar a pagina.');
        return;
      }

      await loadDocxWithFallback(editor, arrayBuffer, fileName || 'documento.docx');
      captureAndApplyDocFontSoon(editor);
      setShowStartScreen(false);
      setHasUnsavedChanges(false);
      restoreCursorPosition();
      await waitForDocumentRendered(editor);
      beginDocumentSettleWindow();
      setHasUnsavedChanges(false);
      if (!petitionTitle || petitionTitle === 'Nova Peticao Trabalhista') {
        setPetitionTitle(getSanitizedDocumentName(fileName));
      }
    } catch (err: any) {
      console.error('Erro ao abrir documento da origem externa:', err);
      const msg = err?.message || 'Erro desconhecido';
      setError(`Nao foi possivel abrir o documento: ${msg}`);
    } finally {
      setDocumentImportLoading(false);
      window.setTimeout(() => {
        try { window.dispatchEvent(new Event('petition-editor-doc-ready')); } catch { /* ignore */ }
      }, 350);
    }
  }, [petitionTitle, restoreCursorPosition]);

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

    // Abrindo um documento específico (import do Cloud por URL/base64)? Então NUNCA
    // aplicar o modelo padrão: a importação faz seu próprio editor.open() e, em
    // documentos grandes (ex.: KIT CONSUMIDOR), a conversão demora — o modelo
    // padrão venceria a corrida e sobrescreveria o import, deixando a página em
    // branco. hasUnsavedChanges só vira true no fim do import, tarde demais.
    if (isCloudImportMode) return;

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
  }, [loading, hasDefaultTemplate, currentPetitionId, hasUnsavedChanges, isCloudImportMode]);

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
      const minWidth = 280;
      const maxWidth = Math.min(440, Math.max(320, Math.floor(window.innerWidth * 0.4)));
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
      const target = e.target as HTMLElement | null;
      const tagName = String(target?.tagName || '').toLowerCase();
      const isInsideSyncEditor =
        Boolean(target?.closest('.e-de-ctn')) ||
        Boolean(target?.closest('[contenteditable="true"]')) ||
        Boolean(target?.closest('.e-documenteditorcontainer'));
      const isTypingInFormControl =
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        Boolean(target?.isContentEditable && !target.closest('.e-de-ctn'));
      const editor = editorRef.current;
      const syncEditor = editor?.getEditor?.();

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && isInsideSyncEditor) {
        const lowerKey = e.key.toLowerCase();
        if (lowerKey === 'b') {
          e.preventDefault();
          syncEditor?.editor?.toggleBold?.();
          editor?.focus?.();
          return;
        }
        if (lowerKey === 'i') {
          e.preventDefault();
          syncEditor?.editor?.toggleItalic?.();
          editor?.focus?.();
          return;
        }
        if (lowerKey === 'u') {
          e.preventDefault();
          syncEditor?.editor?.toggleUnderline?.();
          editor?.focus?.();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && isInsideSyncEditor) {
        const lowerKey = e.key.toLowerCase();
        if (lowerKey === 'n') {
          e.preventDefault();
          syncEditor?.editor?.toggleBold?.();
          editor?.focus?.();
          return;
        }
        if (lowerKey === 's') {
          e.preventDefault();
          syncEditor?.editor?.toggleUnderline?.();
          editor?.focus?.();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        // Com uma janela do editor aberta (destino, sobrescrita, conflito,
        // proteção de alterações), o Ctrl+S pertence a ela — não ao documento.
        if (editorModalOpenRef.current) return;
        savePetitionActionRef.current?.();
        return;
      }

      if (isTypingInFormControl) return;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        syncEditor?.showOptionsPane?.();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        syncEditor?.showOptionsPane?.();
        return;
      }

      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        syncEditor?.editor?.insertComment?.('');
        editor?.focus?.();
        return;
      }

      if (e.shiftKey && e.key === 'F3') {
        e.preventDefault();
        editor?.transformSelectionCase?.('toggle');
        return;
      }

      if (e.ctrlKey && e.altKey && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault();
        const styleName =
          e.key === '1' ? 'Heading 1' :
          e.key === '2' ? 'Heading 2' :
          'Heading 3';
        syncEditor?.editor?.applyStyle?.(styleName, true);
        editor?.focus?.();
        return;
      }

      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        syncEditor?.editor?.applyStyle?.('Normal', true);
        editor?.focus?.();
        return;
      }

      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        void editor?.pasteCleanedFromWord?.();
        return;
      }

      if (e.ctrlKey && e.altKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        if (syncEditor && typeof syncEditor.zoomFactor === 'number') {
          syncEditor.zoomFactor = Math.min(5, syncEditor.zoomFactor + 0.1);
        }
        return;
      }

      if (e.ctrlKey && e.altKey && e.key === '-') {
        e.preventDefault();
        if (syncEditor && typeof syncEditor.zoomFactor === 'number') {
          syncEditor.zoomFactor = Math.max(0.5, syncEditor.zoomFactor - 0.1);
        }
        return;
      }

      if (e.ctrlKey && e.altKey && e.key === '0') {
        e.preventDefault();
        if (syncEditor) syncEditor.zoomFactor = 1;
        return;
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
      setDocumentHistoryLoading(true);

      const [petitionsData, clientsData, areasData, historyData] = await Promise.all([
        isCloudImportMode ? Promise.resolve([]) : petitionEditorService.listPetitions(),
        loadClients(),
        petitionEditorService.listLegalAreas(),
        documentEditHistoryService.list(50).catch(() => []),
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
      setDocumentHistory(historyData);
      setClients(clientsData);
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
      setError('Erro ao carregar dados. Tente novamente.');
    } finally {
      setLoading(false);
      setSavedPetitionsLoading(false);
      setDocumentHistoryLoading(false);
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

  // Restauração do widget após reload: existe o caminho do Nextcloud mas a
  // object URL do blob já morreu (não é persistida). Relê o arquivo do servidor.
  // No fluxo normal (abertura em sessão) a object URL está presente e este
  // efeito não faz nada — quem importa é o efeito acima.
  useEffect(() => {
    if (!isFloatingWidget) return;
    if (!initialNextcloudPath) return;
    if (initialDocumentBase64 || initialDocumentUrl) return;
    const key = `nc:${initialDocumentRequestId || initialNextcloudPath}`;
    if (lastImportedRequestIdRef.current === key) return;
    if (lastHandledInitialDocumentRequestId === key) return;

    lastHandledInitialDocumentRequestId = key;
    lastImportedRequestIdRef.current = key;
    setShowStartScreen(false);
    void importInitialDocumentFromNextcloud(initialNextcloudPath, initialDocumentName);
  }, [isFloatingWidget, initialNextcloudPath, initialDocumentBase64, initialDocumentUrl, initialDocumentName, initialDocumentRequestId, importInitialDocumentFromNextcloud]);

  // Origem externa: carrega o documento no editor (uma vez).
  useEffect(() => {
    if (!isFloatingWidget) return;
    if (!initialDocSource) return;
    const key = `src:${initialDocumentRequestId || editorDocSourceKey(initialDocSource)}`;
    if (lastImportedRequestIdRef.current === key) return;
    if (lastHandledInitialDocumentRequestId === key) return;

    lastHandledInitialDocumentRequestId = key;
    lastImportedRequestIdRef.current = key;
    setShowStartScreen(false);
    void importInitialDocumentFromSource(initialDocSource, initialDocumentName);
  }, [isFloatingWidget, initialDocSource, initialDocumentName, initialDocumentRequestId, importInitialDocumentFromSource]);

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

  // Base de conhecimento do Assistente IA: blocos ativos do tipo de documento
  // atual, com texto puro. A busca em si é local (petitionKbSearch) — só os
  // trechos relevantes vão para o prompt da IA.
  const aiKbEntries = useMemo(() => (
    (blocks || [])
      .filter((block) => Boolean(block?.is_active) && String((block.document_type || 'petition') as any) === String(selectedDocumentType))
      .map((block) => {
        const idx = blockIndexMap.get(block.id);
        return {
          id: block.id,
          title: block.title,
          category: getCategoryLabel(String(block.category || 'outros')),
          tags: idx?.tags ?? getBlockTagsForUI(block),
          content: idx?.plain ?? sfdtToPlainText(block.content),
          sfdt: block.content,
        };
      })
  ), [blocks, selectedDocumentType, blockIndexMap, blockCategories]);

  // Contexto do cliente/petição vinculados enviado ao Assistente IA: evita que
  // ele pergunte dados que já temos (nome, CPF, profissão, cidade) e ancora a
  // redação na área jurídica da petição atual.
  const aiClientContext = useMemo(() => {
    const lines: string[] = [];
    if (selectedClient) {
      const c = selectedClient;
      const push = (label: string, value?: string | null) => {
        const v = String(value || '').trim();
        if (v) lines.push(`- ${label}: ${v}`);
      };
      push('Nome', c.full_name);
      push('CPF/CNPJ', c.cpf_cnpj);
      push('RG', c.rg);
      push('Nacionalidade', c.nationality);
      push('Estado civil', MARITAL_STATUS_LABELS[c.marital_status || ''] || c.marital_status);
      push('Profissão', c.profession);
      const cidadeUf = [c.address_city, c.address_state].filter(Boolean).join(' / ');
      push('Cidade/UF', cidadeUf);
    }
    const titulo = String(petitionTitle || '').trim();
    if (titulo) lines.push(`- Título da petição: ${titulo}`);
    if (selectedLegalArea?.name) lines.push(`- Área jurídica: ${selectedLegalArea.name}`);
    return lines.length ? lines.join('\n') : undefined;
  }, [selectedClient, petitionTitle, selectedLegalArea]);

  // Inserção de modelo pelo Assistente IA: mesmo mecanismo do insertBlock da
  // sidebar (converte o SFDT em fragmento no editor oculto e cola no
  // principal), preservando a formatação original do bloco.
  const insertAiBlockSfdt = useCallback(async (sfdt: string, position: 'cursor' | 'end'): Promise<boolean> => {
    const editor = editorRef.current;
    const converter = blockConvertEditorRef.current;
    const payload = String(sfdt || '').trim();
    if (!editor?.pasteSfdt || !converter?.convertSfdtToFragment || !payload) return false;
    try {
      const fragment = await converter.convertSfdtToFragment(payload);
      if (!fragment || !fragment.trim()) return false;
      editor.focus();
      if (position === 'end') {
        // "Fim" da petição é ANTES do fecho (Termos em que / data / assinatura).
        const de = (editor as any).getEditor?.();
        const docText = String(editor.getText() || '').replace(/\r\n?/g, '\n');
        const placed = de ? moveCursorToSmartEnd(de, docText) : false;
        if (!placed) {
          try { de?.selection?.moveToDocumentEnd?.(); } catch { /* ignore */ }
        }
      }
      return editor.pasteSfdt(fragment);
    } catch {
      return false;
    }
  }, []);

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

  const recentDocumentsAll = useMemo<RecentDocumentItem[]>(() => {
    const byKey = new Map<string, RecentDocumentItem>();
    const savedById = new Map(savedPetitions.map((petition) => [petition.id, petition]));

    // O histórico da home é de QUEM ESTÁ LOGADO. A biblioteca de petições é do
    // escritório inteiro, então semear a lista com ela enchia os "recentes" de
    // cada um com o documento que o colega salvou. Aqui entram só as minhas —
    // o que eu abri de outra pessoa continua entrando pelo `documentHistory`,
    // que já é por usuário.
    for (const petition of savedPetitions) {
      if (!user?.id || petition.created_by !== user.id) continue;
      byKey.set(`petition:${petition.id}`, {
        key: `petition:${petition.id}`,
        source: 'petition',
        title: petition.title || 'Sem título',
        clientName: petition.client_name || null,
        location: petition.process_number ? `Processo ${petition.process_number}` : 'Jurius',
        updatedAt: petition.updated_at,
        lastAction: 'saved',
        petition,
        clientId: petition.client_id,
      });
    }

    for (const historyEntry of documentHistory) {
      if (historyEntry.source === 'petition') {
        const petition = savedById.get(historyEntry.source_key);
        if (!petition) continue;
        const current = byKey.get(`petition:${petition.id}`);
        const currentTime = current ? new Date(current.updatedAt).getTime() : 0;
        const historyTime = new Date(historyEntry.last_activity_at).getTime();
        byKey.set(`petition:${petition.id}`, {
          key: `petition:${petition.id}`,
          source: 'petition',
          title: historyEntry.title || petition.title || 'Sem título',
          clientName: historyEntry.client_name || petition.client_name || null,
          location: petition.process_number ? `Processo ${petition.process_number}` : 'Jurius',
          updatedAt: historyTime > currentTime ? historyEntry.last_activity_at : (current?.updatedAt || petition.updated_at),
          lastAction: historyTime > currentTime ? historyEntry.last_action : (current?.lastAction || 'saved'),
          petition,
          clientId: historyEntry.client_id || petition.client_id,
        });
        continue;
      }

      const nextcloudPath = historyEntry.nextcloud_path || historyEntry.source_key;
      if (!nextcloudPath) continue;
      const pathParts = nextcloudPath.split('/').filter(Boolean);
      const fileName = pathParts.pop() || historyEntry.title || 'Documento do Nextcloud';
      byKey.set(`nextcloud:${historyEntry.source_key}`, {
        key: `nextcloud:${historyEntry.source_key}`,
        source: 'nextcloud',
        title: historyEntry.title || fileName,
        clientName: historyEntry.client_name || null,
        location: pathParts.length ? pathParts.join(' / ') : 'Nextcloud',
        updatedAt: historyEntry.last_activity_at,
        lastAction: historyEntry.last_action,
        nextcloudPath,
        nextcloudAvailability: recentNextcloudAvailability[nextcloudPath],
        clientId: historyEntry.client_id,
      });
    }

    return Array.from(byKey.values());
  }, [
    documentHistory,
    recentNextcloudAvailability,
    savedPetitions,
    user?.id,
  ]);

  const recentDocuments = useMemo<RecentDocumentItem[]>(() => {
    const normalizedSearch = recentDocumentSearch.trim().toLocaleLowerCase('pt-BR');
    return recentDocumentsAll
      .filter((item) => recentDocumentSource === 'all' || item.source === recentDocumentSource)
      .filter((item) => {
        if (!normalizedSearch) return true;
        return [item.title, item.clientName, item.location]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('pt-BR').includes(normalizedSearch));
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 40);
  }, [recentDocumentsAll, recentDocumentSearch, recentDocumentSource]);

  useEffect(() => {
    const paths = Array.from(new Set(
      documentHistory
        .filter((entry) => entry.source === 'nextcloud')
        .map((entry) => entry.nextcloud_path || entry.source_key)
        .filter((path): path is string => Boolean(path)),
    ));
    if (paths.length === 0) {
      setRecentNextcloudAvailability({});
      return;
    }

    let cancelled = false;
    setRecentNextcloudAvailability((current) => Object.fromEntries(
      paths.map((path) => [path, current[path] || 'checking']),
    ));

    let cursor = 0;
    const checkNext = async () => {
      while (!cancelled) {
        const path = paths[cursor++];
        if (!path) return;
        try {
          const metadata = await nextcloudService.stat(path);
          if (cancelled) return;
          setRecentNextcloudAvailability((current) => ({
            ...current,
            [path]: metadata.exists ? 'available' : 'missing',
          }));
        } catch {
          if (cancelled) return;
          // Falha de rede ou autenticação não prova que o arquivo foi excluído.
          setRecentNextcloudAvailability((current) => ({
            ...current,
            [path]: 'unknown',
          }));
        }
      }
    };

    void Promise.all(Array.from(
      { length: Math.min(4, paths.length) },
      () => checkNext(),
    ));

    return () => {
      cancelled = true;
    };
  }, [documentHistory]);

  // Os contadores das abas contam a MESMA lista que aparece embaixo. Contando
  // `savedPetitions` cru, "Jurius (37)" convivia com três linhas na tela.
  const recentDocumentTotals = useMemo(() => {
    let petition = 0;
    let nextcloud = 0;
    for (const item of recentDocumentsAll) {
      if (item.source === 'petition') petition += 1;
      else nextcloud += 1;
    }
    return { all: petition + nextcloud, petition, nextcloud };
  }, [recentDocumentsAll]);

  /**
   * Ponte única de proteção contra perda de trabalho. Qualquer ação que troque
   * o documento aberto (abrir local, abrir do Nextcloud, recente, novo, voltar
   * ao início) passa por aqui: com alterações pendentes, o usuário escolhe
   * salvar, descartar ou cancelar — nunca perdemos o trabalho em silêncio.
   */
  const guardUnsaved = (
    prompt: { title: string; description: string },
    run: () => void,
  ) => {
    if (!hasUnsavedChangesRef.current) {
      run();
      return;
    }
    setUnsavedPrompt({ ...prompt, run });
  };

  const openRecentDocument = (item: RecentDocumentItem) => {
    guardUnsaved(
      {
        title: 'Abrir outro documento?',
        description: `As alterações não salvas serão perdidas ao abrir “${item.title}”.`,
      },
      () => {
        if (item.source === 'petition' && item.petition) {
          void loadPetition(item.petition);
          return;
        }
        if (!item.nextcloudPath) return;
        // Abertura NATIVA: o editor lê o arquivo do servidor, assume o caminho
        // como origem ativa e mantém o lock — sem depender do widget externo.
        setOpeningPetitionId(item.key);
        void openNextcloudDocument({
          path: item.nextcloudPath,
          name: fileNameOf(item.nextcloudPath) || item.title,
        }).finally(() => {
          setOpeningPetitionId((current) => (current === item.key ? null : current));
        });
      },
    );
  };

  /** "Abrir do computador…" — mantém o input local existente. */
  const requestOpenLocalFile = () => {
    guardUnsaved(
      {
        title: 'Abrir um arquivo do computador?',
        description: 'As alterações não salvas do documento atual serão perdidas.',
      },
      () => {
        setActiveWorkspace('editor');
        setShowStartScreen(false);
        window.setTimeout(() => fileInputRef.current?.click(), 150);
      },
    );
  };

  /** "Abrir do Nextcloud…" — janela de navegação/pesquisa dentro do editor. */
  const requestOpenNextcloud = () => {
    guardUnsaved(
      {
        title: 'Abrir um documento do Nextcloud?',
        description: 'As alterações não salvas do documento atual serão perdidas.',
      },
      () => {
        setActiveWorkspace('editor');
        setNextcloudDialog({ mode: 'open' });
      },
    );
  };

  /** "Novo documento" com a mesma proteção. */
  const requestNewDocument = (options?: { keepClient?: boolean }) => {
    guardUnsaved(
      {
        title: 'Criar um novo documento?',
        description: 'As alterações não salvas do documento atual serão perdidas.',
      },
      () => {
        newPetition(options);
        setActiveWorkspace('editor');
        setShowStartScreen(false);
      },
    );
  };

  const openBlocksWorkspaceFromStart = () => {
    if (!blocksEnabled) return;
    setBlocksReturnTarget('start');
    setActiveWorkspace('blocks');
    setSidebarOpen(true);
    setShowStartScreen(false);
  };

  const returnFromBlocksWorkspace = () => {
    setActiveWorkspace('editor');
    if (blocksReturnTarget === 'start') {
      setShowStartScreen(true);
    }
  };

  const requestGoHome = () => {
    guardUnsaved(
      {
        title: 'Voltar para o início?',
        description: 'As alterações feitas desde o último salvamento não serão gravadas.',
      },
      () => setShowStartScreen(true),
    );
  };

  /** Descarta as alterações pendentes e executa a ação represada. */
  const discardAndContinue = () => {
    const pending = unsavedPrompt;
    setUnsavedPrompt(null);
    if (!pending) return;
    clearLocalDraft();
    setHasUnsavedChanges(false);
    pending.run();
  };

  /**
   * "Salvar e continuar": a ação represada só roda depois da confirmação REAL
   * do salvamento (ver `flushPendingAfterSave`). Se o documento ainda não tem
   * destino, o fluxo de escolha abre e a ação espera lá.
   */
  const saveAndContinue = async () => {
    const pending = unsavedPrompt;
    if (!pending) return;
    setUnsavedPrompt(null);
    pendingAfterSaveRef.current = pending.run;
    await savePetition();
  };

  /** "Salvar no Jurius" a partir do diálogo de destino (exige cliente). */
  const savePetitionAsJurius = () => savePetition({ forceJurius: true });

  // ===== Janelas do editor (abrir/salvar no Nextcloud e proteções) =========
  // Ficam em uma variável para serem renderizadas TANTO na tela inicial quanto
  // no editor — "Abrir do Nextcloud" precisa funcionar nos dois lugares.
  const editorDialogs = (
    <>
    {unsavedPrompt && typeof document !== 'undefined' && createPortal(
      <div
        className={`fixed inset-0 ${zcStack[4]} flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]`}
        style={{ position: 'fixed', inset: 0, zIndex: layerStack(4) }}
        role="presentation"
      >
        <section
          id="petition-unsaved-guard-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="petition-unsaved-guard-title"
          aria-describedby="petition-unsaved-guard-description"
          className={`w-full max-w-[480px] overflow-hidden rounded-xl border shadow-[0_28px_80px_rgba(15,23,42,0.32)] ring-1 ring-black/5 ${
            darkMode
              ? 'border-[#484848] bg-[#2b2b2b] text-slate-100'
              : 'border-slate-200 bg-white text-slate-900'
          }`}
        >
          <header className={`flex items-start gap-3.5 border-b px-5 py-5 ${darkMode ? 'border-[#454545]' : 'border-slate-200'}`}>
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${
              darkMode
                ? 'border-amber-400/20 bg-amber-400/10 text-amber-300'
                : 'border-amber-200 bg-amber-50 text-amber-600'
            }`}>
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                Documento não salvo
              </div>
              <h2 id="petition-unsaved-guard-title" className="mt-1 text-[17px] font-semibold leading-6">
                {unsavedPrompt.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setUnsavedPrompt(null)}
              className={`rounded-md p-1.5 transition-colors ${
                darkMode ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
              }`}
              aria-label="Fechar aviso"
              title="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="px-5 py-5">
            <div className={`flex items-center gap-3 rounded-lg border px-3.5 py-3 ${
              darkMode ? 'border-[#484848] bg-[#333333]' : 'border-slate-200 bg-slate-50'
            }`}>
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                darkMode ? 'bg-[#185abd]/25 text-blue-300' : 'bg-blue-100 text-[#185abd]'
              }`}>
                {activeOrigin.kind === 'nextcloud'
                  ? <Cloud className="h-[18px] w-[18px]" />
                  : <FileText className="h-[18px] w-[18px]" />}
              </div>
              <div className="min-w-0">
                <div className={`text-[10px] font-medium uppercase tracking-[0.1em] ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  {originBadge.label}
                </div>
                <div className="mt-0.5 truncate text-[13px] font-semibold" title={originBadge.detail || petitionTitle || 'Documento sem título'}>
                  {petitionTitle || 'Documento sem título'}
                </div>
              </div>
            </div>

            <p id="petition-unsaved-guard-description" className={`mt-4 text-[13px] leading-5 ${darkMode ? 'text-slate-300' : 'text-slate-600'}`}>
              {unsavedPrompt.description}
            </p>
          </div>

          <footer className={`flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end ${
            darkMode ? 'border-[#454545] bg-[#303030]' : 'border-slate-200 bg-slate-50/80'
          }`}>
            <button
              type="button"
              onClick={() => setUnsavedPrompt(null)}
              className={`h-9 rounded-md border px-4 text-[12px] font-semibold transition-colors ${
                darkMode
                  ? 'border-[#565656] bg-transparent text-slate-200 hover:bg-white/10'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={discardAndContinue}
              className={`h-9 rounded-md border px-4 text-[12px] font-semibold transition-colors ${
                darkMode
                  ? 'border-red-400/30 bg-transparent text-red-300 hover:bg-red-400/10'
                  : 'border-red-200 bg-white text-red-700 hover:bg-red-50'
              }`}
            >
              Descartar alterações
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => { void saveAndContinue(); }}
              className="h-9 rounded-md bg-[#185abd] px-4 text-[12px] font-semibold text-white transition-colors hover:bg-[#144f9f] focus:outline-none focus:ring-2 focus:ring-[#185abd]/30"
            >
              Salvar e continuar
            </button>
          </footer>
        </section>
      </div>,
      document.body,
    )}

    {/* Janela do Nextcloud: abrir arquivo ou escolher destino */}
    <NextcloudFileDialog
      open={Boolean(nextcloudDialog)}
      mode={nextcloudDialog?.mode === 'save' ? 'save' : 'open'}
      darkMode={darkMode}
      busy={nextcloudDialogBusy}
      busyLabel={nextcloudDialog?.mode === 'save' ? 'Salvando…' : 'Abrindo…'}
      initialPath={nextcloudDialog?.mode === 'save' ? nextcloudDialog.initialPath : lastNextcloudDirRef.current}
      initialFileName={nextcloudDialog?.mode === 'save' ? nextcloudDialog.initialFileName : ''}
      title={
        nextcloudDialog?.mode === 'save'
          ? (nextcloudDialog.intent === 'save-copy' ? 'Salvar uma cópia no Nextcloud' : 'Salvar como — Nextcloud')
          : 'Abrir do Nextcloud'
      }
      description={
        nextcloudDialog?.mode === 'save'
          ? (nextcloudDialog.intent === 'save-copy'
              ? 'Cria outro arquivo e mantém o documento atual conectado à origem de antes.'
              : 'O caminho escolhido passa a ser a origem deste documento.')
          : 'Navegue ou pesquise para escolher um documento .docx.'
      }
      confirmLabel={nextcloudDialog?.mode === 'save' ? 'Salvar aqui' : 'Abrir'}
      onClose={() => { if (!nextcloudDialogBusy) { setNextcloudDialog(null); pendingAfterSaveRef.current = null; } }}
      onSelectFile={(entry) => {
        lastNextcloudDirRef.current = parentPathOf(entry.path);
        void openNextcloudDocument({ path: entry.path, name: entry.name });
      }}
      onConfirmSave={(target) => {
        lastNextcloudDirRef.current = target.dir;
        void requestNextcloudSave(target, nextcloudDialog?.mode === 'save' ? nextcloudDialog.intent === 'save-as' : true);
      }}
    />

    {/* Onde salvar este documento? (primeiro salvamento) */}
    {saveDestinationOpen && typeof document !== 'undefined' && createPortal(
      <div
        className={`fixed inset-0 ${zcStack[3]} flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]`}
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) { setSaveDestinationOpen(false); pendingAfterSaveRef.current = null; }
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="petition-save-destination-title"
          className={`w-full max-w-[560px] overflow-hidden rounded-xl border shadow-[0_28px_80px_rgba(15,23,42,0.32)] ${
            darkMode ? 'border-[#484848] bg-[#2b2b2b] text-slate-100' : 'border-slate-200 bg-white text-slate-900'
          }`}
        >
          <header className={`flex items-start gap-3 border-b px-5 py-4 ${darkMode ? 'border-[#454545]' : 'border-slate-200'}`}>
            <div className="min-w-0 flex-1">
              <h2 id="petition-save-destination-title" className="text-[16px] font-semibold leading-6">
                Onde deseja salvar este documento?
              </h2>
              <p className={`mt-1 text-[12px] ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                Baixar para o dispositivo cria um arquivo local. Salvar no Nextcloud mantém o documento
                conectado para atualizações futuras.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setSaveDestinationOpen(false); pendingAfterSaveRef.current = null; }}
              className={`rounded-md p-1.5 ${darkMode ? 'text-slate-400 hover:bg-white/10' : 'text-slate-400 hover:bg-slate-100'}`}
              aria-label="Fechar"
              title="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="grid gap-3 px-5 py-5 sm:grid-cols-2">
            <button
              type="button"
              autoFocus
              onClick={() => openNextcloudSaveDialog('save-as')}
              className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition ${
                darkMode
                  ? 'border-[#4d4d4d] bg-[#333333] hover:border-[#0082c9] hover:bg-[#0082c9]/10'
                  : 'border-slate-200 bg-white hover:border-[#0082c9] hover:bg-[#0082c9]/5'
              }`}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0082c9]/10 text-[#0082c9]">
                <Cloud className="h-5 w-5" />
              </span>
              <span className="text-[13px] font-semibold">Nextcloud</span>
              <span className={`text-[11px] leading-4 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                Escolha uma pasta e mantenha o documento conectado para futuras edições.
              </span>
            </button>

            <button
              type="button"
              onClick={() => { setSaveDestinationOpen(false); pendingAfterSaveRef.current = null; void downloadDocxCopy({ reuseHandle: true }); }}
              className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition ${
                darkMode
                  ? 'border-[#4d4d4d] bg-[#333333] hover:border-[#185abd] hover:bg-[#185abd]/10'
                  : 'border-slate-200 bg-white hover:border-[#185abd] hover:bg-blue-50'
              }`}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#185abd]/10 text-[#185abd]">
                <Download className="h-5 w-5" />
              </span>
              <span className="text-[13px] font-semibold">
                {localFileHandleName ? `Atualizar “${localFileHandleName}”` : 'Este dispositivo'}
              </span>
              <span className={`text-[11px] leading-4 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                Baixe uma cópia DOCX para o seu computador. O arquivo baixado não fica conectado.
              </span>
            </button>
          </div>

          <footer className={`flex items-center justify-between gap-3 border-t px-5 py-3 ${
            darkMode ? 'border-[#454545] bg-[#303030]' : 'border-slate-200 bg-slate-50/80'
          }`}>
            <button
              type="button"
              onClick={() => {
                setSaveDestinationOpen(false);
                void savePetitionAsJurius();
              }}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] font-medium transition ${
                darkMode
                  ? 'border-[#565656] text-slate-200 hover:bg-white/10'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
              title="Cria uma petição no Jurius (exige cliente vinculado)"
            >
              <FileText className="h-3.5 w-3.5" />
              Salvar como petição no Jurius
            </button>
            <button
              type="button"
              onClick={() => { setSaveDestinationOpen(false); pendingAfterSaveRef.current = null; }}
              className={`h-8 rounded-md px-3 text-[12px] font-medium ${darkMode ? 'text-slate-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Cancelar
            </button>
          </footer>
        </section>
      </div>,
      document.body,
    )}

    {/* Confirmação de sobrescrita */}
    {overwritePrompt && typeof document !== 'undefined' && createPortal(
      <div className={`fixed inset-0 ${zcStack[4]} flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]`} role="presentation">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="petition-overwrite-title"
          className={`w-full max-w-[500px] overflow-hidden rounded-xl border shadow-[0_28px_80px_rgba(15,23,42,0.32)] ${
            darkMode ? 'border-[#484848] bg-[#2b2b2b] text-slate-100' : 'border-slate-200 bg-white text-slate-900'
          }`}
        >
          <header className={`flex items-start gap-3 border-b px-5 py-4 ${darkMode ? 'border-[#454545]' : 'border-slate-200'}`}>
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              darkMode ? 'bg-amber-400/10 text-amber-300' : 'bg-amber-50 text-amber-600'
            }`}>
              <AlertTriangle className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <h2 id="petition-overwrite-title" className="text-[16px] font-semibold leading-6">Já existe um arquivo com esse nome</h2>
              <p className={`mt-1 break-all text-[12px] ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>{overwritePrompt.path}</p>
            </div>
          </header>
          <footer className={`flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end ${
            darkMode ? 'border-[#454545] bg-[#303030]' : 'border-slate-200 bg-slate-50/80'
          }`}>
            <button
              type="button"
              onClick={() => setOverwritePrompt(null)}
              disabled={nextcloudDialogBusy}
              className={`h-9 rounded-md border px-4 text-[12px] font-semibold disabled:opacity-50 ${
                darkMode ? 'border-[#565656] text-slate-200 hover:bg-white/10' : 'border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => { void saveAsFreeCopy(overwritePrompt.path, overwritePrompt.adopt); }}
              disabled={nextcloudDialogBusy}
              className={`h-9 rounded-md border px-4 text-[12px] font-semibold disabled:opacity-50 ${
                darkMode ? 'border-[#565656] text-slate-200 hover:bg-white/10' : 'border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              Salvar uma cópia
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => {
                const target = overwritePrompt;
                setOverwritePrompt(null);
                void persistToNextcloud(target.path, { adopt: target.adopt });
              }}
              disabled={nextcloudDialogBusy}
              className="h-9 rounded-md bg-red-600 px-4 text-[12px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Substituir
            </button>
          </footer>
        </section>
      </div>,
      document.body,
    )}

    {/* Conflito de versão (o arquivo remoto mudou) */}
    {versionConflict && typeof document !== 'undefined' && createPortal(
      <div className={`fixed inset-0 ${zcStack[4]} flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]`} role="presentation">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="petition-conflict-title"
          className={`w-full max-w-[520px] overflow-hidden rounded-xl border shadow-[0_28px_80px_rgba(15,23,42,0.32)] ${
            darkMode ? 'border-[#484848] bg-[#2b2b2b] text-slate-100' : 'border-slate-200 bg-white text-slate-900'
          }`}
        >
          <header className={`flex items-start gap-3 border-b px-5 py-4 ${darkMode ? 'border-[#454545]' : 'border-slate-200'}`}>
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              darkMode ? 'bg-amber-400/10 text-amber-300' : 'bg-amber-50 text-amber-600'
            }`}>
              <AlertTriangle className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <h2 id="petition-conflict-title" className="text-[16px] font-semibold leading-6">A versão no servidor mudou</h2>
              <p className={`mt-1 text-[12px] ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                O arquivo <strong className="break-all">{versionConflict.path}</strong> foi alterado no servidor
                depois que você o abriu — pode ter sido outra pessoa, outro dispositivo ou outra aba sua.
                Suas alterações locais continuam aqui — escolha como seguir.
              </p>
            </div>
          </header>
          <footer className={`flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end ${
            darkMode ? 'border-[#454545] bg-[#303030]' : 'border-slate-200 bg-slate-50/80'
          }`}>
            <button
              type="button"
              onClick={() => setVersionConflict(null)}
              disabled={nextcloudDialogBusy}
              className={`h-9 rounded-md border px-4 text-[12px] font-semibold disabled:opacity-50 ${
                darkMode ? 'border-[#565656] text-slate-200 hover:bg-white/10' : 'border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              Continuar editando
            </button>
            <button
              type="button"
              onClick={() => { void reloadFromServer(versionConflict.path); }}
              disabled={nextcloudDialogBusy}
              className={`h-9 rounded-md border px-4 text-[12px] font-semibold disabled:opacity-50 ${
                darkMode ? 'border-red-400/30 text-red-300 hover:bg-red-400/10' : 'border-red-200 text-red-700 hover:bg-red-50'
              }`}
            >
              Recarregar do servidor
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => { void saveAsFreeCopy(versionConflict.path, versionConflict.adopt); }}
              disabled={nextcloudDialogBusy}
              className="h-9 rounded-md bg-[#0082c9] px-4 text-[12px] font-semibold text-white hover:bg-[#0069a3] disabled:opacity-50"
            >
              Salvar como nova cópia
            </button>
          </footer>
        </section>
      </div>,
      document.body,
    )}
    </>
  );

  // ========== RENDER ==========
  // Tela de inÃ­cio (quando showStartScreen === true)
  if (showStartScreen) {
    return (
      <div className={`${isFloatingWidget ? 'h-full' : 'h-screen'} flex bg-white text-slate-900`}>
        <aside className="hidden w-[210px] shrink-0 flex-col bg-[#185abd] text-white md:flex">
          <div className="flex h-16 items-center gap-3 px-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-white text-[#185abd] shadow-sm">
              <FileText className="h-[18px] w-[18px]" />
            </div>
            <div>
              <div className="text-sm font-semibold">Jurius</div>
              <div className="text-[10px] text-blue-100">Documentos</div>
            </div>
          </div>

          <nav className="mt-3 space-y-1 px-3" aria-label="Navegação do editor">
            <button type="button" className="flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-[13px] font-medium bg-white/15">
              <FileText className="h-4 w-4" />
              Início
            </button>
            <button
              type="button"
              onClick={() => requestNewDocument()}
              className="flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-[13px] font-medium text-blue-50 transition hover:bg-white/10"
            >
              <Plus className="h-4 w-4" />
              Novo
            </button>
            <button
              type="button"
              onClick={requestOpenLocalFile}
              className="flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-[13px] font-medium text-blue-50 transition hover:bg-white/10"
            >
              <FolderOpen className="h-4 w-4" />
              Abrir do computador
            </button>
            <button
              type="button"
              onClick={requestOpenNextcloud}
              className="flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-[13px] font-medium text-blue-50 transition hover:bg-white/10"
            >
              <Cloud className="h-4 w-4" />
              Abrir do Nextcloud
            </button>
            <button
              type="button"
              onClick={openBlocksWorkspaceFromStart}
              disabled={!blocksEnabled}
              className="flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-[13px] font-medium text-blue-50 transition hover:bg-white/10 disabled:opacity-40"
            >
              <Layers className="h-4 w-4" />
              Blocos
            </button>
          </nav>

          <div className="mt-auto border-t border-white/15 p-4">
            <div className="mb-3 flex items-center gap-2 text-[11px] text-blue-100">
              <Cloud className="h-3.5 w-3.5" />
              Nextcloud integrado
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">
                {userDisplayName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{userDisplayName}</div>
                <div className="text-[10px] text-blue-200">Conta profissional</div>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center bg-[#185abd] text-white md:hidden">
                <FileText className="h-4 w-4" />
              </div>
              <div className="text-sm font-semibold text-slate-800">Início</div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={openBlocksWorkspaceFromStart}
                disabled={!blocksEnabled}
                className="mr-2 flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium text-[#185abd] transition hover:bg-blue-50 disabled:opacity-40 md:hidden"
              >
                <Layers className="h-3.5 w-3.5" />
                Blocos
              </button>
              {isFloatingWidget && !hideMinimize && (
                <button
                  onClick={() => onRequestMinimize?.()}
                  className="rounded p-2 text-slate-500 transition hover:bg-slate-100"
                  title="Minimizar"
                  aria-label="Minimizar"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              )}
              {isFloatingWidget && (
                <button
                  onClick={() => onRequestClose?.()}
                  className="rounded p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                  title="Fechar"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </header>

          <div className="flex-1 overflow-y-auto bg-[#f7f7f7]">
            <main className="mx-auto w-full max-w-[1100px] px-5 py-7 sm:px-8 lg:py-9">
              <div className="mb-7">
                <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">{getGreeting()}</h1>
                <p className="mt-1 text-sm text-slate-500">{userDisplayName}</p>
              </div>

              <section className="mb-8">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-700">Novo</h2>
                  {hasDefaultTemplate && (
                    <button
                      type="button"
                      onClick={clearDefaultTemplate}
                      className="text-[11px] text-slate-400 transition hover:text-red-600"
                    >
                      Remover documento padrão
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 items-start gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  <button
                    onClick={() => requestNewDocument()}
                    className="group flex w-full flex-col text-left"
                  >
                    <div className="flex h-[120px] items-center justify-center border border-slate-200 bg-white shadow-sm transition group-hover:border-[#185abd] group-hover:shadow-md">
                      <div className="relative h-[88px] w-[68px] border border-slate-200 bg-white shadow-sm">
                        <Plus className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-[#185abd] opacity-0 transition group-hover:opacity-100" />
                      </div>
                    </div>
                    <div className="mt-2 text-[12px] font-medium text-slate-700 group-hover:text-[#185abd]">Documento em branco</div>
                  </button>

                  <div className="relative self-start">
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); defaultTemplateInputRef.current?.click(); }}
                      disabled={settingDefaultTemplate}
                      className="absolute right-2 top-2 z-10 rounded-full border border-slate-200 bg-white p-1.5 text-slate-400 shadow-sm transition hover:text-[#185abd] disabled:opacity-50"
                      title="Configurar documento padrão"
                    >
                      {settingDefaultTemplate ? <Loader2 className="h-3 w-3 animate-spin" /> : <Settings className="h-3 w-3" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (isLoadingPetitionRef.current) return;
                        isLoadingPetitionRef.current = true;
                        newPetition();
                        setActiveWorkspace('editor');
                        setShowStartScreen(false);
                        window.setTimeout(() => {
                          void Promise.resolve(loadDefaultTemplate()).finally(() => {
                            isLoadingPetitionRef.current = false;
                          });
                        }, 200);
                      }}
                      disabled={!hasDefaultTemplate}
                      className="group flex w-full flex-col text-left disabled:opacity-50"
                    >
                      <div className="flex h-[120px] items-center justify-center border border-slate-200 bg-white shadow-sm transition group-hover:border-[#185abd] group-hover:shadow-md">
                        <div className="h-[88px] w-[68px] overflow-hidden border border-slate-200 bg-white shadow-sm">
                          <div className="h-2 bg-[#185abd]" />
                          <div className="space-y-1.5 p-2">
                            <div className="h-1 bg-slate-200" />
                            <div className="h-1 w-4/5 bg-slate-200" />
                            <div className="h-1 bg-slate-200" />
                            <div className="h-1 w-2/3 bg-slate-200" />
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 truncate text-[12px] font-medium text-slate-700 group-hover:text-[#185abd]">Documento padrão</div>
                      {hasDefaultTemplate && (
                        <div className="mt-0.5 truncate text-[10px] text-slate-400">{defaultTemplateName || 'Modelo configurado'}</div>
                      )}
                    </button>
                    <input
                      ref={defaultTemplateInputRef}
                      type="file"
                      accept=".docx"
                      className="hidden"
                      onChange={handleUploadDefaultTemplate}
                    />
                  </div>

                  <button
                    onClick={requestOpenLocalFile}
                    className="group flex w-full flex-col text-left"
                  >
                    <div className="flex h-[120px] items-center justify-center border border-slate-200 bg-white shadow-sm transition group-hover:border-[#185abd] group-hover:shadow-md">
                      <div className="flex h-[88px] w-[68px] items-center justify-center border border-slate-200 bg-white shadow-sm">
                        <FileUp className="h-6 w-6 text-slate-400 transition group-hover:text-[#185abd]" />
                      </div>
                    </div>
                    <div className="mt-2 text-[12px] font-medium text-slate-700 group-hover:text-[#185abd]">Importar arquivo</div>
                  </button>

                  <button
                    onClick={requestOpenNextcloud}
                    className="group flex w-full flex-col text-left"
                  >
                    <div className="flex h-[120px] items-center justify-center border border-slate-200 bg-white shadow-sm transition group-hover:border-[#0082c9] group-hover:shadow-md">
                      <div className="flex h-[88px] w-[68px] flex-col items-center justify-center border border-cyan-100 bg-cyan-50 text-[#0082c9] shadow-sm">
                        <Cloud className="h-7 w-7" />
                        <span className="mt-2 text-[9px] font-semibold uppercase tracking-wide">Nuvem</span>
                      </div>
                    </div>
                    <div className="mt-2 text-[12px] font-medium text-slate-700 group-hover:text-[#0082c9]">Abrir do Nextcloud</div>
                  </button>

                  <button
                    onClick={openBlocksWorkspaceFromStart}
                    disabled={!blocksEnabled}
                    className="group flex w-full flex-col text-left disabled:opacity-50"
                  >
                    <div className="flex h-[120px] items-center justify-center border border-slate-200 bg-white shadow-sm transition group-hover:border-[#185abd] group-hover:shadow-md">
                      <div className="flex h-[88px] w-[68px] flex-col items-center justify-center border border-blue-100 bg-blue-50 text-[#185abd] shadow-sm">
                        <Layers className="h-7 w-7" />
                        <span className="mt-2 text-[9px] font-semibold uppercase tracking-wide">Biblioteca</span>
                      </div>
                    </div>
                    <div className="mt-2 text-[12px] font-medium text-slate-700 group-hover:text-[#185abd]">Blocos</div>
                  </button>
                </div>
              </section>

              <section>
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-700">Recentes</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">Jurius e Nextcloud no mesmo histórico</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-4 border-b border-slate-200">
                      {([
                        ['all', 'Todos', recentDocumentTotals.all],
                        ['petition', 'Jurius', recentDocumentTotals.petition],
                        ['nextcloud', 'Nextcloud', recentDocumentTotals.nextcloud],
                      ] as const).map(([value, label, count]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setRecentDocumentSource(value)}
                          className={`border-b-2 px-0.5 pb-1.5 text-[11px] font-medium transition ${
                            recentDocumentSource === value
                              ? 'border-[#185abd] text-[#185abd]'
                              : 'border-transparent text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          {label} <span className="text-slate-400">{count}</span>
                        </button>
                      ))}
                    </div>
                    <div className="relative sm:w-[230px]">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        type="search"
                        value={recentDocumentSearch}
                        onChange={(event) => setRecentDocumentSearch(event.target.value)}
                        placeholder="Pesquisar recentes"
                        className="h-8 w-full border border-slate-200 bg-white pl-8 pr-2.5 text-[11px] outline-none focus:border-[#185abd]"
                      />
                    </div>
                  </div>
                </div>

                <div className="border border-slate-200 bg-white">
                  {savedPetitionsLoading || documentHistoryLoading ? (
                    <div className="px-4 py-3"><ModuleSkeleton variant="list" rows={5} /></div>
                  ) : recentDocuments.length === 0 ? (
                    <div className="px-4 py-12 text-center">
                      <Clock className="mx-auto h-6 w-6 text-slate-300" />
                      <div className="mt-2 text-xs text-slate-500">
                        {recentDocumentSearch ? 'Nenhum documento encontrado' : 'Nenhum documento recente'}
                      </div>
                    </div>
                  ) : (
                    <div className="max-h-[390px] overflow-y-auto">
                      {recentDocuments.map((item) => {
                        const isOpening = openingPetitionId === item.petition?.id || openingPetitionId === item.key;
                        const isBusyOpening = openingPetitionId !== null;
                        const isMissing = item.source === 'nextcloud' && item.nextcloudAvailability === 'missing';
                        const subtitle = isMissing
                          ? 'Arquivo removido do Nextcloud'
                          : item.clientName || item.location || (item.source === 'nextcloud' ? 'Nextcloud' : 'Sem cliente vinculado');
                        return (
                          <div
                            key={item.key}
                            role={isMissing ? undefined : 'button'}
                            tabIndex={isMissing ? undefined : 0}
                            onClick={isMissing ? undefined : () => {
                              if (!isBusyOpening) openRecentDocument(item);
                            }}
                            onKeyDown={isMissing ? undefined : (event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return;
                              if (isBusyOpening) return;
                              event.preventDefault();
                              openRecentDocument(item);
                            }}
                            className={`group grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_120px_105px_32px] ${
                              isMissing
                                ? 'cursor-default bg-slate-50 opacity-70'
                                : isBusyOpening
                                  ? 'cursor-wait opacity-60'
                                  : 'cursor-pointer hover:bg-[#f2f6fc]'
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div className={`flex h-8 w-8 shrink-0 items-center justify-center ${
                                isMissing
                                  ? 'text-slate-400'
                                  : item.source === 'nextcloud'
                                    ? 'text-cyan-700'
                                    : 'text-[#185abd]'
                              }`}>
                                {isOpening
                                  ? <Loader2 className="h-4 w-4 animate-spin" />
                                  : isMissing
                                    ? <CloudOff className="h-[18px] w-[18px]" />
                                  : item.source === 'nextcloud'
                                    ? <Cloud className="h-[18px] w-[18px]" />
                                    : <FileText className="h-[18px] w-[18px]" />}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-[12px] font-medium text-slate-800">
                                  {isOpening ? 'Abrindo...' : item.title}
                                </div>
                                <div className="mt-0.5 truncate text-[10px] text-slate-500">{subtitle}</div>
                              </div>
                            </div>

                            <div className="hidden text-[10px] text-slate-500 sm:flex sm:items-center sm:gap-1.5">
                              {isMissing
                                ? <CloudOff className="h-3 w-3 text-slate-400" />
                                : item.source === 'nextcloud'
                                  ? <Cloud className="h-3 w-3 text-cyan-700" />
                                  : <FileText className="h-3 w-3 text-[#185abd]" />}
                              {isMissing ? 'Removido' : item.source === 'nextcloud' ? 'Nextcloud' : 'Jurius'}
                            </div>

                            <div
                              className="text-right text-[10px] tabular-nums text-slate-400"
                              data-tick={relativeTimeTick}
                              title={new Date(item.updatedAt).toLocaleString('pt-BR')}
                            >
                              {formatRelativeTime(item.updatedAt)}
                            </div>

                            <div className="flex justify-end">
                              {item.source === 'petition' && item.petition && (
                                <button
                                  type="button"
                                  onClick={async (event) => {
                                    event.stopPropagation();
                                    if (isBusyOpening) return;
                                    const petition = item.petition!;
                                    const confirmed = await confirmDelete({
                                      title: 'Excluir petição',
                                      entityName: petition.title || 'Sem título',
                                      message: `Deseja excluir a petição "${petition.title || 'Sem título'}"${petition.client_name ? ` vinculada ao cliente ${petition.client_name}` : ''}?`,
                                      confirmLabel: 'Excluir',
                                      permission: { module: 'peticoes', action: 'delete' },
                                    });
                                    if (!confirmed) return;
                                    try {
                                      await petitionEditorService.deletePetition(petition.id);
                                      await documentEditHistoryService.remove('petition', petition.id);
                                      notifyDeleted(petition.title || undefined);
                                      setSavedPetitions((current) => current.filter((candidate) => candidate.id !== petition.id));
                                      setDocumentHistory((current) => current.filter(
                                        (historyEntry) => !(historyEntry.source === 'petition' && historyEntry.source_key === petition.id),
                                      ));
                                    } catch (deleteError) {
                                      console.error('Erro ao excluir petição:', deleteError);
                                      setError('Erro ao excluir petição');
                                    }
                                  }}
                                  disabled={isBusyOpening}
                                  className="p-1.5 text-slate-300 opacity-0 transition hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
                                  title="Excluir petição"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </main>
          </div>
        </div>

        {editorDialogs}
      </div>
    );
  }

  // Mantido temporariamente como referência durante a migração visual.
  // A barra compacta abaixo é a interface ativa.
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

          <div className="petition-workspace-toggle flex items-center rounded-xl border border-[#e3e6ea] bg-[#f7f8fa] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            <button
              type="button"
              onClick={() => setActiveWorkspace('editor')}
              className={`petition-workspace-toggle-btn px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeWorkspace === 'editor'
                  ? 'bg-white text-[#2563eb] shadow-sm'
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              Editor
            </button>
            {blocksEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    setBlocksReturnTarget('editor');
                    setActiveWorkspace('blocks');
                  }}
                  className={`petition-workspace-toggle-btn px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    activeWorkspace === 'blocks'
                      ? 'bg-white text-[#2563eb] shadow-sm'
                      : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                Blocos
              </button>
            )}
          </div>

          <button
            onClick={requestGoHome}
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
            className="pet-top-title-input px-3 py-2 text-sm font-semibold border border-transparent bg-transparent hover:border-[#e3e6ea] focus:border-blue-400 rounded-xl focus:outline-none w-full"
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
            className="pet-top-select px-3 py-2 text-xs border border-[#e3e6ea] rounded-xl bg-white hover:border-blue-300 focus:border-blue-400 focus:outline-none"
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
            className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 border border-blue-200 rounded transition-colors flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            {"Criar \u00c1rea Jur\u00eddica"}
          </button>
        )}
      </div>

      <div className="pet-top-group is-right">
        {selectedClient && (
          <div className="pet-top-client-chip pet-top-shrink">
            <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-slate-700 font-medium truncate">{selectedClient.full_name}</span>
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

        {/* Indicador de salvamento estilo Word: Salvando… / Alterações não salvas / Salvo às HH:MM */}
        {(saving || savingDoc) ? (
          <div className="pet-top-save-status is-saving pet-top-shrink" title="Salvando o documento...">
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
            <span className="hidden sm:inline">Salvando…</span>
          </div>
        ) : hasUnsavedChanges ? (
          <div className="pet-top-save-status is-dirty pet-top-shrink" title="Há alterações que ainda não foram salvas">
            <span className="pet-top-save-dot shrink-0" />
            <span className="hidden sm:inline">Alterações não salvas</span>
          </div>
        ) : lastSaved ? (
          <div
            className="pet-top-save-status is-saved pet-top-shrink"
            title={`Salvo em ${lastSaved.toLocaleString('pt-BR')}`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline tabular-nums">
              Salvo às {lastSaved.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ) : null}

        {localDraftUpdatedAt && (
          <button
            type="button"
            onClick={() => { void restoreLocalDraft(); }}
            className="pet-top-meta-chip pet-top-shrink hidden lg:inline-flex items-center gap-1.5"
            title={`Última cópia local: ${new Date(localDraftUpdatedAt).toLocaleString('pt-BR')}`}
          >
            <CloudOff className="w-3.5 h-3.5 shrink-0" />
            <span>Restaurar cópia local</span>
          </button>
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
            onClick={() => { void savePetition(); }}
            disabled={savingDoc}
            className="pet-top-primary-btn"
          >
            {savingDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Salvar</span>
          </button>
          <button
            onClick={() => { void exportToWord(); }}
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
            onClick={toggleDarkMode}
            className="pet-top-text-btn flex"
            title={darkMode ? 'Voltar ao modo claro' : 'Modo escuro (igual ao Word)'}
          >
            {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{darkMode ? 'Modo claro' : 'Modo escuro'}</span>
          </button>
        </div>

        <div className="pet-top-cluster is-utility">
        {!hideMinimize && (
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
        )}
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
          onClick={requestGoHome}
          className="pet-top-icon-btn is-danger"
          title="Voltar ao início"
          aria-label="Voltar ao início"
        >
          <XCircle className="w-4 h-4" />
        </button>
        </div>
      </div>
    </>
  );

  const compactRibbonTopContent = (
    <div className="pet-titlebar">
      <div className="pet-titlebar-nav" />

      <div className="pet-titlebar-document">
        <input
          type="text"
          value={petitionTitle}
          onChange={(event) => {
            setPetitionTitle(event.target.value);
            setHasUnsavedChanges(true);
          }}
          className="pet-titlebar-input"
          placeholder="Documento sem título"
          aria-label="Nome do documento"
        />
        {/* Procedência do documento — discreta, sem aumentar a altura da barra. */}
        <span
          className={`pet-titlebar-origin ${originBadge.icon === 'cloud' ? 'is-cloud' : ''}`}
          title={originBadge.detail || originBadge.label}
        >
          {originBadge.icon === 'cloud' ? (
            <Cloud className="w-3 h-3" />
          ) : originBadge.icon === 'jurius' ? (
            <FileText className="w-3 h-3" />
          ) : originBadge.icon === 'external' ? (
            <Layers className="w-3 h-3" />
          ) : (
            <CloudOff className="w-3 h-3" />
          )}
          <span className="pet-titlebar-origin-label">
            {activeOrigin.kind === 'nextcloud' ? activeOrigin.fileName : originBadge.label}
          </span>
        </span>
        <span className={`pet-titlebar-state ${(saving || savingDoc) ? 'is-saving' : hasUnsavedChanges ? 'is-dirty' : 'is-saved'}`}>
          {(saving || savingDoc) ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Salvando…
            </>
          ) : hasUnsavedChanges ? (
            <>
              <span className="pet-titlebar-dot" />
              Alterações pendentes
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3 h-3" />
              Salvo
            </>
          )}
        </span>
      </div>

      <div className="pet-titlebar-actions">
        <button
          type="button"
          onClick={() => { void savePetition(); }}
          // Documento já salvo e sem alterações: não há o que gravar. O botão
          // fica cinza e sem ação, em vez de refazer um upload idêntico.
          disabled={savingDoc || !hasUnsavedChanges}
          className="pet-titlebar-save"
          title={
            savingDoc
              ? 'Salvando…'
              : hasUnsavedChanges
                ? 'Salvar alterações'
                : 'Nada para salvar — o documento está atualizado'
          }
        >
          {savingDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          <span>{savingDoc ? 'Salvando…' : hasUnsavedChanges ? 'Salvar' : 'Salvo'}</span>
        </button>
        {!hideMinimize && (
        <button
          type="button"
          onClick={() => {
            if (isFloatingWidget) {
              onRequestMinimize?.();
              return;
            }
            setIsMinimized(true);
          }}
          className="pet-top-icon-btn"
          title="Minimizar"
          aria-label="Minimizar editor"
        >
          <Minimize2 className="w-4 h-4" />
        </button>
        )}
        {!isFloatingWidget && (
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="pet-top-icon-btn"
            title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={requestGoHome}
          className="pet-top-icon-btn is-danger"
          title="Voltar ao início"
          aria-label="Voltar ao início"
        >
          <XCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  const closeBlockEditor = () => {
    if (blockEditorDirty && !saving) {
      const title = blockFormData.title.trim() || 'Bloco sem título';
      if (!confirm(`Há alterações não salvas em "${title}". Deseja fechar mesmo assim?`)) return;
    }
    setShowBlockModal(false);
    setBlockEditorDirty(false);
  };

  const blockRibbonTopContent = (
    <div className="pet-titlebar">
      <div className="pet-titlebar-nav">
        <button
          type="button"
          onClick={closeBlockEditor}
          className="pet-top-icon-btn"
          title="Voltar ao gerenciador de blocos"
          aria-label="Voltar ao gerenciador de blocos"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600">
          <FileText className="h-3.5 w-3.5" />
        </div>
      </div>

      <div className="pet-titlebar-document">
        <input
          type="text"
          value={blockFormData.title}
          onChange={(event) => {
            setBlockFormData((current) => ({ ...current, title: event.target.value }));
            setBlockEditorDirty(true);
          }}
          className="pet-titlebar-input"
          placeholder="Bloco sem título"
          aria-label="Nome do bloco"
        />
        <span className={`pet-titlebar-state ${saving ? 'is-saving' : blockEditorDirty ? 'is-dirty' : 'is-saved'}`}>
          {saving ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Salvando…
            </>
          ) : blockEditorDirty ? (
            <>
              <span className="pet-titlebar-dot" />
              Alterações pendentes
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3 h-3" />
              {editingBlock ? 'Bloco carregado' : 'Novo bloco'}
            </>
          )}
        </span>
      </div>

      <div className="pet-titlebar-actions">
        <button
          type="button"
          onClick={() => { void saveBlock(); }}
          disabled={saving || !blockFormData.title.trim()}
          className="pet-titlebar-save"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          <span>{editingBlock || updateExistingBlockMode ? 'Atualizar' : 'Criar bloco'}</span>
        </button>
        <button
          type="button"
          onClick={closeBlockEditor}
          className="pet-top-icon-btn is-danger"
          title="Fechar editor de blocos"
          aria-label="Fechar editor de blocos"
        >
          <XCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className={`petition-editor-root ${isFloatingWidget ? 'h-full' : 'h-screen'} relative flex flex-col overflow-hidden bg-[#f5f6f8]`}>
      {documentImportLoading && (
        <div className="absolute inset-0 z-[140] flex items-center justify-center bg-slate-950/30 backdrop-blur-[2px]">
          <div className="petition-import-progress w-full max-w-md mx-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.24)] ring-1 ring-black/5">
            <div className="flex items-start gap-3 px-5 pt-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-[#185abd]">
                <FileUp className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-slate-900">Preparando documento</div>
                <div className="mt-1 text-[11px] leading-4 text-slate-500">Aguarde enquanto o conteúdo e o vínculo do cliente são configurados.</div>
              </div>
            </div>
            <div className="mx-5 mt-4 grid grid-cols-2 gap-2 pb-5">
              <div className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-[10px] font-medium text-slate-600">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#185abd]" />
                Importando conteúdo
              </div>
              <div className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-[10px] font-medium text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                Vinculando cliente
              </div>
            </div>
            <div className="h-1 overflow-hidden bg-slate-100">
              <div className="petition-import-progress-bar h-full w-1/3 bg-[#185abd]" />
            </div>
          </div>
        </div>
      )}

      {editorDialogs}

      {/* Modal: Visualizar ConteÃºdo do Bloco */}
      {showBlockViewModal && viewingBlock && typeof document !== 'undefined' && createPortal(
        <div
          id="petition-block-view-backdrop"
          className="fixed inset-0 flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-[2px] sm:p-6"
          style={{ zIndex: layerStack(3) }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeBlockView();
          }}
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="petition-block-view-title"
            className={`flex max-h-[92vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-xl border shadow-[0_30px_90px_rgba(15,23,42,0.34)] ring-1 ring-black/5 ${
              darkMode
                ? 'border-[#464646] bg-[#252525] text-slate-100'
                : 'border-slate-200 bg-white text-slate-900'
            }`}
          >
            <header className={`flex min-h-[72px] shrink-0 items-center gap-3 border-b px-5 py-4 sm:px-6 ${
              darkMode ? 'border-[#454545] bg-[#2b2b2b]' : 'border-slate-200 bg-white'
            }`}>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${
                darkMode
                  ? 'border-blue-400/20 bg-blue-400/10 text-blue-300'
                  : 'border-blue-100 bg-blue-50 text-[#185abd]'
              }`}>
                <Layers className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
                  darkMode ? 'text-slate-400' : 'text-slate-500'
                }`}>
                  Biblioteca de blocos
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <h2 id="petition-block-view-title" className="truncate text-[16px] font-semibold leading-5 sm:text-[17px]">
                    {viewingBlock.title}
                  </h2>
                  <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                    darkMode
                      ? 'border-[#505050] bg-[#333333] text-slate-300'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                  }`}>
                    {getCategoryLabel(String(viewingBlock.category || 'outros'))}
                  </span>
                  {typeof viewingBlockMatchPct === 'number' && (
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                      darkMode
                        ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    }`}>
                      {viewingBlockMatchPct}% de correspondência
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={closeBlockView}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
                  darkMode
                    ? 'text-slate-400 hover:bg-white/10 hover:text-white'
                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                }`}
                title="Fechar"
                aria-label="Fechar visualização"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_270px]">
              <div className={`flex min-h-[420px] min-w-0 flex-col ${
                darkMode ? 'bg-[#202020]' : 'bg-[#eef0f3]'
              }`}>
                <div className={`flex h-11 shrink-0 items-center justify-between border-b px-4 sm:px-5 ${
                  darkMode ? 'border-[#414141] bg-[#2b2b2b]' : 'border-slate-200 bg-white'
                }`}>
                  <div className="flex items-center gap-2">
                    <Eye className={`h-4 w-4 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`} />
                    <span className="text-[12px] font-semibold">Pré-visualização</span>
                  </div>
                  <span className={`text-[10px] ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    Somente leitura
                  </span>
                </div>

                <div className="petition-block-docx-preview relative min-h-0 flex-1 overflow-auto">
                  <div className="min-h-full px-3 py-5 sm:px-6 sm:py-6">
                    <div
                      ref={(node) => {
                        blockViewDocxContainerRef.current = node;
                      }}
                    />
                  </div>

                  {blockViewDocxLoading && (
                    <div className={`absolute inset-0 flex items-center justify-center ${
                      darkMode ? 'bg-[#202020]/90' : 'bg-[#eef0f3]/90'
                    }`}>
                      <div className={`w-full max-w-[310px] rounded-lg border px-5 py-4 shadow-sm ${
                        darkMode
                          ? 'border-[#484848] bg-[#2b2b2b]'
                          : 'border-slate-200 bg-white'
                      }`}>
                        <div className="flex items-center gap-3">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-md ${
                            darkMode ? 'bg-blue-400/10 text-blue-300' : 'bg-blue-50 text-[#185abd]'
                          }`}>
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </div>
                          <div>
                            <div className="text-[12px] font-semibold">Preparando visualização</div>
                            <div className={`mt-0.5 text-[10px] ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                              Aplicando a formatação do documento
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!blockViewDocxLoading && blockViewDocxError && !blockViewUseFallback && (
                    <div className={`absolute inset-0 flex items-center justify-center px-6 ${
                      darkMode ? 'bg-[#202020]' : 'bg-[#eef0f3]'
                    }`}>
                      <div className="max-w-sm text-center">
                        <AlertTriangle className="mx-auto h-6 w-6 text-amber-500" />
                        <div className="mt-2 text-[12px] font-semibold">{blockViewDocxError}</div>
                        <div className={`mt-1 text-[10px] ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          Você ainda pode editar ou inserir este bloco.
                        </div>
                      </div>
                    </div>
                  )}

                  {!blockViewDocxLoading && blockViewUseFallback && (
                    <div className={`absolute inset-0 overflow-y-auto p-5 sm:p-8 ${
                      darkMode ? 'bg-[#202020]' : 'bg-[#eef0f3]'
                    }`}>
                      <article className="mx-auto min-h-full max-w-[720px] bg-white px-[8%] py-12 text-slate-800 shadow-[0_2px_8px_rgba(15,23,42,0.18)]">
                        <pre className="whitespace-pre-wrap font-serif text-[13px] leading-6">
                          {(() => {
                            const text = (blockViewFallbackText || '').trim();
                            if (!text || text.startsWith('{') || text.startsWith('[')) {
                              return 'Pré-visualização indisponível';
                            }
                            return text;
                          })()}
                        </pre>
                      </article>
                    </div>
                  )}
                </div>
              </div>

              <aside className={`min-h-0 overflow-y-auto border-t p-5 lg:border-l lg:border-t-0 ${
                darkMode
                  ? 'border-[#454545] bg-[#292929]'
                  : 'border-slate-200 bg-slate-50/80'
              }`}>
                <section>
                  <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
                    darkMode ? 'text-slate-400' : 'text-slate-500'
                  }`}>
                    Informações
                  </div>
                  <dl className="mt-3 space-y-3">
                    <div>
                      <dt className={`text-[10px] ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>Categoria</dt>
                      <dd className="mt-0.5 text-[12px] font-medium">
                        {getCategoryLabel(String(viewingBlock.category || 'outros'))}
                      </dd>
                    </div>
                    <div>
                      <dt className={`text-[10px] ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>Inserção automática</dt>
                      <dd className="mt-1 flex items-center gap-1.5 text-[12px] font-medium">
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          viewingBlock.is_default ? 'bg-emerald-500' : darkMode ? 'bg-slate-600' : 'bg-slate-300'
                        }`} />
                        {viewingBlock.is_default ? 'Ativada' : 'Desativada'}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className={`mt-5 border-t pt-5 ${darkMode ? 'border-[#454545]' : 'border-slate-200'}`}>
                  <div className="flex items-center gap-2">
                    <Hash className={`h-3.5 w-3.5 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                    <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
                      darkMode ? 'text-slate-400' : 'text-slate-500'
                    }`}>
                      Tags
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {getBlockTagsForUI(viewingBlock).length > 0 ? (
                      getBlockTagsForUI(viewingBlock).map((tag) => (
                        <span
                          key={tag}
                          className={`max-w-full truncate rounded-md border px-2 py-1 text-[10px] font-medium ${
                            darkMode
                              ? 'border-[#4b4b4b] bg-[#333333] text-slate-300'
                              : 'border-slate-200 bg-white text-slate-600'
                          }`}
                          title={tag}
                        >
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span className={`text-[11px] ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                        Nenhuma tag cadastrada
                      </span>
                    )}
                  </div>
                </section>

                <section className={`mt-5 border-t pt-5 ${darkMode ? 'border-[#454545]' : 'border-slate-200'}`}>
                  <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
                    darkMode ? 'text-slate-400' : 'text-slate-500'
                  }`}>
                    Variáveis compatíveis
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-1.5">
                    {['NOME_CLIENTE', 'CPF', 'RG', 'ENDERECO', 'CIDADE', 'UF', 'CEP', 'EMAIL', 'TELEFONE'].map((variable) => (
                      <code
                        key={variable}
                        className={`truncate rounded border px-1.5 py-1 text-[9px] ${
                          darkMode
                            ? 'border-[#484848] bg-[#303030] text-blue-300'
                            : 'border-blue-100 bg-blue-50/70 text-[#185abd]'
                        }`}
                        title={`[[${variable}]]`}
                      >
                        {variable}
                      </code>
                    ))}
                  </div>
                </section>
              </aside>
            </div>

            <footer className={`flex shrink-0 flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 ${
              darkMode ? 'border-[#454545] bg-[#2b2b2b]' : 'border-slate-200 bg-white'
            }`}>
              <div className={`hidden items-center gap-2 text-[10px] sm:flex ${
                darkMode ? 'text-slate-500' : 'text-slate-400'
              }`}>
                <FileText className="h-3.5 w-3.5" />
                O conteúdo será inserido na posição atual do cursor.
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    const block = viewingBlock;
                    closeBlockView();
                    openBlockModal(block);
                  }}
                  className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border px-4 text-[12px] font-semibold transition-colors ${
                    darkMode
                      ? 'border-[#505050] bg-[#333333] text-slate-200 hover:bg-[#3a3a3a]'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Editar bloco
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!isOnlineRef.current) {
                      setError('Voce esta offline. O Peticionamento e 100% online: reconecte para editar/salvar.');
                      return;
                    }
                    await insertBlock(viewingBlock);
                    setShowBlockSearchModal(false);
                    closeBlockView();
                  }}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#185abd] px-5 text-[12px] font-semibold text-white transition-colors hover:bg-[#144f9f] focus:outline-none focus:ring-2 focus:ring-[#185abd]/30"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar ao documento
                </button>
              </div>
            </footer>
          </section>
        </div>,
        document.body,
      )}

      {/* ConteÃºdo Principal */}
      {activeWorkspace === 'blocks' ? (() => {
        const bmDefaultCount = filteredBlocks.filter((b) => b.is_default).length;
        const bmVisibleBlocks = bmCategoryFilter === 'all'
          ? filteredBlocks
          : filteredBlocks.filter((block) => String(block.category || 'outros') === bmCategoryFilter);
        const bmActiveCategoryLabel = bmCategoryFilter === 'all'
          ? 'Todos os blocos'
          : getCategoryLabel(bmCategoryFilter);

        const bmSortedBlocks = bmSortBy === 'category' ? bmVisibleBlocks : [...bmVisibleBlocks].sort((a, b) => {
          if (bmSortBy === 'title') return a.title.localeCompare(b.title, 'pt-BR');
          if (bmSortBy === 'updated') return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
          return 0;
        });

        const bmRenderDocxPreview = async (blockId: string, sfdt: string) => {
          const container = bmPreviewContainersRef.current.get(blockId);
          if (!container) return;
          // Já reexibido a partir do cache: nada a refazer.
          if (container.childElementCount > 0) return;

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

            bmPreviewHtmlRef.current.set(blockId, currentContainer.innerHTML);
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
          // 'done' não impede: ao expandir de novo o container é outro, vazio.
          if (bmDocxPreviews.get(blockId) === 'loading') return;
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
          const ids = bmVisibleBlocks.map((b) => b.id);
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
          const previewLength = bmViewMode === 'grid' ? 150 : 210;
          const summaryText = plain.slice(0, previewLength) + (plain.length > previewLength ? '...' : '');
          const updatedDate = block.updated_at ? new Date(block.updated_at) : null;
          const wordCount = plain.trim() ? plain.trim().split(/\s+/).length : 0;

          const tagsRow = (maxTags: number) => tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.slice(0, maxTags).map((tag) => (
                <span key={tag} className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                  {tag}
                </span>
              ))}
              {tags.length > maxTags && (
                <span className="px-1 py-0.5 text-[10px] font-medium text-slate-400">+{tags.length - maxTags}</span>
              )}
            </div>
          ) : null;

          const docxPreviewContainer = (
            <div
              ref={(el) => {
                bmPreviewContainersRef.current.set(block.id, el);
                if (!el || !isExpanded || el.childElementCount > 0) return;
                const cached = bmPreviewHtmlRef.current.get(block.id);
                if (cached) {
                  el.innerHTML = cached;
                  return;
                }
                window.setTimeout(() => bmQueuePreview(block.id), 30);
              }}
              className="bm-docx-preview-container overflow-auto bg-[#f8fafd]"
              style={{ maxHeight: 460, minHeight: 96 }}
            />
          );

          if (bmViewMode === 'grid') {
            return (
              <article key={block.id} className="group flex min-h-[220px] flex-col overflow-hidden rounded-2xl border border-[#dde3ea] bg-white transition hover:border-[#c5d1df] hover:shadow-[0_4px_18px_rgba(60,64,67,.10)]">
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f0fe] text-[#1967d2]">
                      <FileText className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => openBlockModal(block)}
                        className="block max-w-full text-left text-sm font-semibold leading-5 text-[#202124] hover:text-[#1967d2]"
                      >
                        <span className="line-clamp-2">{block.title}</span>
                      </button>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-[#5f6368]">
                        <span>{wordCount} palavra{wordCount !== 1 ? 's' : ''}</span>
                        {block.is_default && (
                          <span className="inline-flex items-center gap-1 text-[#1967d2]">
                            <Star className="h-3 w-3 fill-current" /> Padrão
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex-1">
                    {isExpanded ? (
                      <div className="overflow-hidden rounded-xl border border-[#e3e7ec]">
                        {docxPreviewContainer}
                      </div>
                    ) : (
                      <p className="line-clamp-4 text-xs leading-[1.65] text-[#5f6368]">
                        {summaryText || <span className="italic text-[#9aa0a6]">Sem conteúdo</span>}
                      </p>
                    )}
                    {!isExpanded && tagsRow(3)}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-[#edf0f3] pt-3">
                    <span className="text-[10px] text-[#80868b]">
                      {updatedDate ? `Editado em ${updatedDate.toLocaleDateString('pt-BR')}` : 'Sem data de edição'}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button type="button" onClick={() => bmToggleExpand(block.id)} className="rounded-full p-2 text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#1967d2]" title={isExpanded ? 'Recolher visualização' : 'Visualizar conteúdo formatado'} aria-label={isExpanded ? 'Recolher visualização' : 'Visualizar conteúdo formatado'}>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      <button type="button" onClick={() => openBlockModal(block)} className="rounded-full p-2 text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#1967d2]" title="Editar bloco" aria-label={`Editar ${block.title}`}>
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => bmCopyPlainText(plain)} className="rounded-full p-2 text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#1967d2]" title="Copiar texto" aria-label={`Copiar ${block.title}`}>
                        <Copy className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => { void deleteBlock(block.id); }} className="rounded-full p-2 text-[#5f6368] hover:bg-red-50 hover:text-red-600" title="Excluir bloco" aria-label={`Excluir ${block.title}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          }

          return (
            <article key={block.id} className="group border-b border-[#edf0f3] bg-white last:border-b-0 hover:bg-[#f8fafd]">
              <div className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f0fe] text-[#1967d2]">
                  <FileText className="h-[18px] w-[18px]" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      onClick={() => openBlockModal(block)}
                      className="max-w-full truncate text-left text-sm font-semibold text-[#202124] hover:text-[#1967d2]"
                    >
                      {block.title}
                    </button>
                    {block.is_default && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f0fe] px-2 py-0.5 text-[10px] font-medium text-[#1967d2]">
                        <Star className="h-3 w-3 fill-current" /> Padrão
                      </span>
                    )}
                  </div>
                  {!isExpanded && (
                    <p className="mt-1 line-clamp-2 max-w-4xl text-xs leading-5 text-[#5f6368]">
                      {summaryText || <span className="italic text-[#9aa0a6]">Sem conteúdo</span>}
                    </p>
                  )}
                  {!isExpanded && tagsRow(4)}
                </div>

                <div className="hidden w-28 shrink-0 pt-0.5 text-right sm:block">
                  <div className="text-[11px] text-[#5f6368]">{wordCount} palavra{wordCount !== 1 ? 's' : ''}</div>
                  {updatedDate && <div className="mt-1 text-[10px] text-[#9aa0a6]">{updatedDate.toLocaleDateString('pt-BR')}</div>}
                </div>

                <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                  <button type="button" onClick={() => bmToggleExpand(block.id)} className="rounded-full p-2 text-[#5f6368] hover:bg-[#e8eaed] hover:text-[#1967d2]" title={isExpanded ? 'Recolher visualização' : 'Visualizar conteúdo formatado'} aria-label={isExpanded ? 'Recolher visualização' : 'Visualizar conteúdo formatado'}>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={() => openBlockModal(block)} className="rounded-full p-2 text-[#5f6368] hover:bg-[#e8eaed] hover:text-[#1967d2]" title="Editar bloco" aria-label={`Editar ${block.title}`}>
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => bmCopyPlainText(plain)} className="hidden rounded-full p-2 text-[#5f6368] hover:bg-[#e8eaed] hover:text-[#1967d2] sm:inline-flex" title="Copiar texto" aria-label={`Copiar ${block.title}`}>
                    <Copy className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => { void deleteBlock(block.id); }} className="hidden rounded-full p-2 text-[#5f6368] hover:bg-red-50 hover:text-red-600 sm:inline-flex" title="Excluir bloco" aria-label={`Excluir ${block.title}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-[#edf0f3] bg-[#f8fafd] px-4 py-4 sm:px-16">
                  <div className="overflow-hidden rounded-xl border border-[#dde3ea] bg-white">
                    <div className="flex items-center justify-between border-b border-[#edf0f3] px-3 py-2">
                      <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[#5f6368]">
                        <FileText className="h-3.5 w-3.5" /> Visualização formatada
                      </span>
                      <button type="button" onClick={() => bmToggleExpand(block.id)} className="rounded-full p-1 text-[#5f6368] hover:bg-[#f1f3f4]" title="Recolher visualização">
                        <ChevronUp className="h-4 w-4" />
                      </button>
                    </div>
                    {docxPreviewContainer}
                  </div>
                </div>
              )}
            </article>
          );
        };

        return (
        <div className="flex flex-1 flex-col overflow-hidden bg-[#f8fafd] text-[#202124]">
          <header className="z-10 shrink-0 border-b border-[#e3e7ec] bg-white">
            <div className="flex min-h-[68px] items-center gap-3 px-4 sm:px-6">
              <button
                type="button"
                onClick={returnFromBlocksWorkspace}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4]"
                title={blocksReturnTarget === 'start' ? 'Voltar ao início' : 'Voltar ao editor'}
                aria-label={blocksReturnTarget === 'start' ? 'Voltar ao início' : 'Voltar ao editor'}
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e8f0fe] text-[#1967d2]">
                <Layers className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-medium leading-6">Biblioteca de blocos</h2>
                <p className="hidden text-xs text-[#5f6368] sm:block">Trechos jurídicos prontos para reutilizar no editor</p>
              </div>

              <div className="relative ml-auto hidden w-full max-w-[520px] md:block">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#5f6368]" />
                <input
                  type="search"
                  placeholder="Pesquisar na biblioteca"
                  value={blockSearch}
                  onChange={(event) => setBlockSearch(event.target.value)}
                  className="h-11 w-full rounded-full border border-transparent bg-[#f1f3f4] pl-11 pr-10 text-sm text-[#202124] outline-none transition placeholder:text-[#5f6368] hover:bg-[#eceff1] focus:border-[#a8c7fa] focus:bg-white focus:shadow-[0_1px_2px_rgba(60,64,67,.18)]"
                  aria-label="Pesquisar blocos"
                />
                {blockSearch && (
                  <button type="button" onClick={() => setBlockSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-[#5f6368] hover:bg-[#e8eaed]" title="Limpar pesquisa" aria-label="Limpar pesquisa">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => openBlockModal()}
                className="ml-auto inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#0b57d0] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-[#0a4ebd] md:ml-2"
              >
                <Plus className="h-[18px] w-[18px]" />
                <span className="hidden sm:inline">Novo bloco</span>
              </button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[#e3e7ec] bg-white px-3 py-4 md:flex">
              <button
                type="button"
                onClick={() => setBmCategoryFilter('all')}
                className={`flex h-10 w-full items-center gap-3 rounded-full px-3 text-left text-sm font-medium transition ${bmCategoryFilter === 'all' ? 'bg-[#c2e7ff] text-[#001d35]' : 'text-[#3c4043] hover:bg-[#f1f3f4]'}`}
              >
                <Layers className="h-[18px] w-[18px]" />
                <span className="min-w-0 flex-1 truncate">Todos os blocos</span>
                <span className="text-[11px] tabular-nums opacity-70">{filteredBlocks.length}</span>
              </button>

              <div className="mb-1 mt-5 flex items-center justify-between px-3">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#5f6368]">Categorias</span>
                <button
                  type="button"
                  onClick={() => { ensureDraftFromCategories(blockCategories); setShowCategoryModal(true); }}
                  className="rounded-full p-1.5 text-[#5f6368] hover:bg-[#f1f3f4]"
                  title="Gerenciar categorias"
                  aria-label="Gerenciar categorias"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </div>

              <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label="Categorias de blocos">
                {sidebarCategoryKeys.map((category) => {
                  const count = ((blocksByCategory as Record<string, PetitionBlock[]>)[category] || []).length;
                  const isActive = bmCategoryFilter === category;
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setBmCategoryFilter(category)}
                      className={`flex min-h-9 w-full items-center gap-3 rounded-full px-3 text-left text-[13px] transition ${isActive ? 'bg-[#e8f0fe] font-medium text-[#1967d2]' : 'text-[#3c4043] hover:bg-[#f1f3f4]'}`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${isActive ? 'bg-[#1967d2]' : 'bg-[#bdc1c6]'}`} />
                      <span className="min-w-0 flex-1 truncate">{getCategoryLabel(category)}</span>
                      <span className="text-[11px] tabular-nums opacity-70">{count}</span>
                    </button>
                  );
                })}
              </nav>

              <div className="mt-4 rounded-xl bg-[#f8fafd] p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-[#3c4043]">
                  <Star className="h-3.5 w-3.5 text-[#1967d2]" />
                  {bmDefaultCount} bloco{bmDefaultCount !== 1 ? 's' : ''} padrão
                </div>
                <p className="mt-1 text-[10px] leading-4 text-[#80868b]">Os padrões aparecem primeiro nas rotinas do editor.</p>
              </div>
            </aside>

            <main className="min-w-0 flex-1 overflow-y-auto">
              <div className="border-b border-[#e3e7ec] bg-white px-4 py-3 md:hidden">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5f6368]" />
                  <input
                    type="search"
                    placeholder="Pesquisar na biblioteca"
                    value={blockSearch}
                    onChange={(event) => setBlockSearch(event.target.value)}
                    className="h-10 w-full rounded-full bg-[#f1f3f4] pl-10 pr-9 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-[#a8c7fa]"
                    aria-label="Pesquisar blocos"
                  />
                  {blockSearch && (
                    <button type="button" onClick={() => setBlockSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-2 text-[#5f6368]" aria-label="Limpar pesquisa">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  <button type="button" onClick={() => setBmCategoryFilter('all')} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${bmCategoryFilter === 'all' ? 'bg-[#c2e7ff] text-[#001d35]' : 'bg-[#f1f3f4] text-[#3c4043]'}`}>
                    Todos
                  </button>
                  {sidebarCategoryKeys.map((category) => (
                    <button key={category} type="button" onClick={() => setBmCategoryFilter(category)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${bmCategoryFilter === category ? 'bg-[#c2e7ff] text-[#001d35]' : 'bg-[#f1f3f4] text-[#3c4043]'}`}>
                      {getCategoryLabel(category)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mx-auto w-full max-w-[1380px] px-4 py-5 sm:px-6 lg:px-8">
                <div className="rounded-2xl border border-[#dde3ea] bg-white">
                  <div className="flex flex-col gap-3 p-3 sm:p-4 xl:flex-row xl:items-center">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={selectedDocumentType}
                        onChange={(event) => setSelectedDocumentType(event.target.value as DocumentType)}
                        className="h-9 rounded-lg border border-[#dadce0] bg-white px-3 text-xs font-medium text-[#3c4043] outline-none hover:bg-[#f8fafd] focus:border-[#1a73e8]"
                        aria-label="Tipo de documento"
                      >
                        <option value="petition">Petição</option>
                        <option value="contestation">Contestação</option>
                        <option value="impugnation">Impugnação</option>
                        <option value="appeal">Recurso</option>
                      </select>

                      <select
                        value={blockFilterScope === 'global' ? '__all__' : (selectedLegalAreaId || '')}
                        onChange={(event) => {
                          const areaId = event.target.value;
                          if (areaId === '__all__') {
                            setBlockFilterScope('global');
                            return;
                          }
                          setSelectedLegalAreaId(areaId || null);
                          setSelectedStandardTypeId(null);
                          setStandardTypes(areaId ? (standardTypesByArea[areaId] ?? []).map(sanitizeStandardTypeRecord) : []);
                          setBlockFilterScope('area');
                        }}
                        className="h-9 min-w-[150px] rounded-lg border border-[#dadce0] bg-white px-3 text-xs font-medium text-[#3c4043] outline-none hover:bg-[#f8fafd] focus:border-[#1a73e8]"
                        aria-label="Área jurídica"
                      >
                        <option value="__all__">Todas as áreas</option>
                        {legalAreas.map((area) => (
                          <option key={area.id} value={area.id}>{area.name}</option>
                        ))}
                      </select>

                      <div className="flex h-9 items-center rounded-lg border border-[#dadce0] p-0.5">
                        {selectedStandardTypeId && (
                          <button type="button" onClick={() => setBlockFilterScope('type')} className={`h-8 rounded-md px-2.5 text-[11px] font-medium ${blockFilterScope === 'type' ? 'bg-[#e8f0fe] text-[#1967d2]' : 'text-[#5f6368] hover:bg-[#f1f3f4]'}`}>
                            Modelo
                          </button>
                        )}
                        <button type="button" onClick={() => setBlockFilterScope('area')} className={`h-8 rounded-md px-2.5 text-[11px] font-medium ${blockFilterScope === 'area' ? 'bg-[#e8f0fe] text-[#1967d2]' : 'text-[#5f6368] hover:bg-[#f1f3f4]'}`}>
                          Área
                        </button>
                        <button type="button" onClick={() => setBlockFilterScope('global')} className={`h-8 rounded-md px-2.5 text-[11px] font-medium ${blockFilterScope === 'global' ? 'bg-[#e8f0fe] text-[#1967d2]' : 'text-[#5f6368] hover:bg-[#f1f3f4]'}`}>
                          Global
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
                      <select
                        value={bmSortBy}
                        onChange={(event) => setBmSortBy(event.target.value as 'title' | 'updated' | 'category')}
                        className="h-9 rounded-lg border border-[#dadce0] bg-white px-3 text-xs font-medium text-[#3c4043] outline-none hover:bg-[#f8fafd] focus:border-[#1a73e8]"
                        aria-label="Ordenar blocos"
                      >
                        <option value="category">Por categoria</option>
                        <option value="title">Título A–Z</option>
                        <option value="updated">Mais recentes</option>
                      </select>

                      <button
                        type="button"
                        onClick={bmExpandedBlocks.size > 0 ? bmCollapseAll : bmExpandAll}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#dadce0] px-3 text-xs font-medium text-[#3c4043] hover:bg-[#f8fafd]"
                        title={bmExpandedBlocks.size > 0 ? 'Recolher visualizações' : 'Visualizar todos'}
                      >
                        {bmExpandedBlocks.size > 0 ? <ChevronUp className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        <span className="hidden sm:inline">{bmExpandedBlocks.size > 0 ? 'Recolher' : 'Visualizar'}</span>
                      </button>

                      <div className="flex h-9 items-center rounded-lg border border-[#dadce0] p-0.5">
                        <button type="button" onClick={() => setBmViewMode('list')} className={`rounded-md p-1.5 ${bmViewMode === 'list' ? 'bg-[#e8f0fe] text-[#1967d2]' : 'text-[#5f6368] hover:bg-[#f1f3f4]'}`} title="Exibir em lista" aria-label="Exibir em lista">
                          <List className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => setBmViewMode('grid')} className={`rounded-md p-1.5 ${bmViewMode === 'grid' ? 'bg-[#e8f0fe] text-[#1967d2]' : 'text-[#5f6368] hover:bg-[#f1f3f4]'}`} title="Exibir em grade" aria-label="Exibir em grade">
                          <LayoutGrid className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {standardTypes.length > 0 && selectedLegalAreaId && (
                    <div className="flex items-center gap-2 overflow-x-auto border-t border-[#edf0f3] px-4 py-2.5">
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-[#80868b]">Modelo</span>
                      <button type="button" onClick={() => { setSelectedStandardTypeId(null); setBlockFilterScope('area'); }} className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium ${!selectedStandardTypeId ? 'bg-[#c2e7ff] text-[#001d35]' : 'bg-[#f1f3f4] text-[#3c4043] hover:bg-[#e8eaed]'}`}>
                        {selectedLegalArea?.name || 'Área'}
                      </button>
                      {standardTypes.map((type) => (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => {
                            setSelectedStandardTypeId(type.id);
                            setBlockFilterScope('type');
                            if (type.default_document && editorRef.current) {
                              editorRef.current.loadSfdt(type.default_document);
                              if (type.default_document_name) setPetitionTitle(sanitizeText(type.default_document_name));
                            }
                          }}
                          className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium ${selectedStandardTypeId === type.id ? 'bg-[#c2e7ff] text-[#001d35]' : 'bg-[#f1f3f4] text-[#3c4043] hover:bg-[#e8eaed]'}`}
                        >
                          {type.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mb-3 mt-6 flex flex-wrap items-end justify-between gap-3 px-1">
                  <div>
                    <h3 className="text-base font-medium text-[#202124]">{bmActiveCategoryLabel}</h3>
                    <p className="mt-0.5 text-xs text-[#5f6368]">
                      {bmVisibleBlocks.length} resultado{bmVisibleBlocks.length !== 1 ? 's' : ''}
                      {selectedLegalArea ? ` · ${selectedLegalArea.name}` : ''}
                      {blockFilterScope === 'global' ? ' · escopo global' : ''}
                    </p>
                  </div>
                  {blockSearch && (
                    <button type="button" onClick={() => setBlockSearch('')} className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f0fe] px-3 py-1.5 text-xs font-medium text-[#1967d2] hover:bg-[#dbe8fd]">
                      “{blockSearch}” <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {bmVisibleBlocks.length === 0 ? (
                  <div className="rounded-2xl border border-[#dde3ea] bg-white px-6 py-16 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#f1f3f4]">
                      <Search className="h-6 w-6 text-[#80868b]" />
                    </div>
                    <div className="mt-4 text-base font-medium text-[#202124]">Nenhum bloco por aqui</div>
                    <p className="mx-auto mt-1 max-w-md text-sm leading-5 text-[#5f6368]">
                      Ajuste a pesquisa ou escolha outra categoria. Você também pode criar um novo bloco para este contexto.
                    </p>
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      {(blockSearch || bmCategoryFilter !== 'all') && (
                        <button type="button" onClick={() => { setBlockSearch(''); setBmCategoryFilter('all'); }} className="h-9 rounded-full border border-[#dadce0] px-4 text-sm font-medium text-[#1967d2] hover:bg-[#f8fafd]">
                          Limpar filtros
                        </button>
                      )}
                      <button type="button" onClick={() => openBlockModal()} className="inline-flex h-9 items-center gap-2 rounded-full bg-[#0b57d0] px-4 text-sm font-medium text-white hover:bg-[#0a4ebd]">
                        <Plus className="h-4 w-4" /> Novo bloco
                      </button>
                    </div>
                  </div>
                ) : bmSortBy === 'category' && bmCategoryFilter === 'all' ? (
                  <div className="space-y-6">
                    {sidebarCategoryKeys.map((category) => {
                      const items = (blocksByCategory as Record<string, PetitionBlock[]>)[category] || [];
                      if (items.length === 0) return null;
                      const isCatCollapsed = bmCollapsedCategories.has(category);
                      return (
                        <section key={category}>
                          <button type="button" onClick={() => bmToggleCategory(category)} className="mb-2 flex w-full items-center gap-2 px-1 text-left">
                            {isCatCollapsed ? <ChevronRight className="h-4 w-4 text-[#5f6368]" /> : <ChevronDown className="h-4 w-4 text-[#5f6368]" />}
                            <span className="text-sm font-medium text-[#3c4043]">{getCategoryLabel(category)}</span>
                            <span className="text-[11px] text-[#80868b]">{items.length}</span>
                            <span className="h-px flex-1 bg-[#e3e7ec]" />
                          </button>
                          {!isCatCollapsed && (
                            bmViewMode === 'grid' ? (
                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                {items.map(renderBlockCard)}
                              </div>
                            ) : (
                              <div className="overflow-hidden rounded-2xl border border-[#dde3ea] bg-white">
                                {items.map(renderBlockCard)}
                              </div>
                            )
                          )}
                        </section>
                      );
                    })}
                  </div>
                ) : bmViewMode === 'grid' ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {bmSortedBlocks.map(renderBlockCard)}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-[#dde3ea] bg-white">
                    {bmSortedBlocks.map(renderBlockCard)}
                  </div>
                )}
              </div>
            </main>
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
        topContent={compactRibbonTopContent}
        shortcutScopeActive={
          !showBlockModal
          && !nextcloudDialog
          && !saveDestinationOpen
          && !overwritePrompt
          && !versionConflict
          && !unsavedPrompt
        }
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
        onNew={() => requestNewDocument({ keepClient: true })}
        onOpenLocal={requestOpenLocalFile}
        onOpenNextcloud={requestOpenNextcloud}
        onSave={() => { void savePetition(); }}
        saveDisabled={savingDoc || !hasUnsavedChanges}
        onSaveAs={() => openNextcloudSaveDialog('save-as')}
        onSaveCopyNextcloud={() => openNextcloudSaveDialog('save-copy')}
        onExportDocx={() => { void exportToWord(); }}
        onLoadDefaultTemplate={() => { void loadDefaultTemplate(); }}
        hasDefaultTemplate={hasDefaultTemplate}
        onManageAreas={() => openLegalAreaModal()}
        onManageModels={() => openStandardTypeModal()}
        onManageBlocks={() => {
          setBlocksReturnTarget('editor');
          setActiveWorkspace('blocks');
        }}
        onGoHome={requestGoHome}
        aiAssistantEnabled={aiAssistantEnabled}
        onToggleAiAssistant={() => { void toggleAiAssistant(); }}
        onOpenFindReplace={(mode) => setFindReplaceMode(mode)}
        onOpenProofreader={() => setShowProofreader((current) => !current)}
      />

      <div className="flex-1 flex min-h-0 min-w-0 max-w-full overflow-hidden relative">
        {/* Alça da biblioteca — vive na área da página (não na faixa), então
           continua à mão com a faixa recolhida. Fechada ela encosta na borda
           esquerda; aberta, a MESMA alça gruda na borda de fora do painel e só
           inverte a seta. Abrir e recolher têm o mesmo alvo e o mesmo desenho. */}
        {!sidebarOpen && (
          <button
            type="button"
            className="petition-library-handle"
            onClick={() => setSidebarOpen(true)}
            title="Abrir biblioteca"
            aria-label="Abrir biblioteca"
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="petition-library-handle-label">Biblioteca</span>
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
        {/* Sidebar — overlay no mobile, inline no desktop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-[30] bg-black/40 sm:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {sidebarOpen && (
          <div className="petition-sidebar fixed sm:relative inset-y-0 left-0 z-[31] sm:z-[20] flex flex-col flex-shrink-0" style={{ width: Math.min(sidebarWidth, typeof window !== 'undefined' ? window.innerWidth * 0.85 : sidebarWidth) }}>
            <button
              type="button"
              className="petition-library-handle is-collapse"
              onClick={() => setSidebarOpen(false)}
              title="Recolher biblioteca"
              aria-label="Recolher biblioteca"
            >
              <Layers className="h-3.5 w-3.5" />
              <span className="petition-library-handle-label">Biblioteca</span>
              <ChevronLeft className="h-3 w-3" />
            </button>
            <div className="petition-sidebar-header">
              <div className="petition-sidebar-heading">
                <span className="petition-sidebar-heading-icon"><Layers className="h-4 w-4" /></span>
                <div>
                  <strong>Biblioteca</strong>
                  <span>Conteúdo do documento</span>
                </div>
              </div>
            </div>
            <div className="petition-sidebar-tabs" role="tablist" aria-label="Conteúdo do documento">
              <button
                type="button"
                role="tab"
                aria-selected={sidebarTab === 'blocks'}
                onClick={() => setSidebarTab('blocks')}
                className={`petition-sidebar-tab ${sidebarTab === 'blocks' ? 'is-active' : ''}`}
              >
                <Layers className="h-3.5 w-3.5" />
                Blocos
                <span className="petition-sidebar-tab-count">{filteredBlocks.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sidebarTab === 'clients'}
                onClick={() => setSidebarTab('clients')}
                className={`petition-sidebar-tab ${sidebarTab === 'clients' ? 'is-active' : ''}`}
              >
                <Users className="h-3.5 w-3.5" />
                Clientes
                <span className="petition-sidebar-tab-count">{filteredClients.length}</span>
              </button>
            </div>

            {/* Tab: Blocos */}
            {sidebarTab === 'blocks' && (
              <>
                <div className="petition-sidebar-controls">
                <div className="petition-sidebar-context">
                  <div className="petition-sidebar-field-label">
                    <span>
                      Contexto jurídico
                    </span>
                    <div className="petition-sidebar-field-actions">
                      <button
                        type="button"
                        onClick={() => openLegalAreaModal()}
                        title="Gerenciar áreas jurídicas"
                        aria-label="Gerenciar áreas jurídicas"
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openStandardTypeModal()}
                        title="Gerenciar modelos"
                        aria-label="Gerenciar modelos"
                      >
                        <FileText className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {legalAreas.length > 0 ? (
                    <div className="petition-sidebar-context-selector">
                      <span style={{ backgroundColor: selectedLegalArea?.color || '#94a3b8' }} />
                    <select
                      value={selectedStandardTypeId ? `type:${selectedStandardTypeId}` : `area:${selectedLegalAreaId || ''}`}
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw.startsWith('type:')) {
                          const typeId = raw.replace('type:', '').trim();
                          const foundType = Object.values(standardTypesByArea).flat().find((type) => type.id === typeId) || null;
                          const areaId = foundType?.legal_area_id || null;
                          if (areaId) {
                            setSelectedLegalAreaId(areaId);
                            setStandardTypes((standardTypesByArea[areaId] ?? []).map(sanitizeStandardTypeRecord));
                            try {
                              window.localStorage.setItem(SELECTED_LEGAL_AREA_STORAGE_KEY, areaId);
                              window.localStorage.setItem(`${SELECTED_STANDARD_TYPE_STORAGE_KEY_PREFIX}${areaId}`, typeId);
                            } catch {
                              // ignore
                            }
                          }
                          setSelectedStandardTypeId(typeId);
                          setBlockFilterScope('type');
                          if (foundType?.default_document && editorRef.current) {
                            editorRef.current.loadSfdt(foundType.default_document);
                            if (foundType.default_document_name) setPetitionTitle(sanitizeText(foundType.default_document_name));
                          }
                          return;
                        }

                        const areaId = raw.replace('area:', '').trim() || null;
                        setSelectedLegalAreaId(areaId);
                        setSelectedStandardTypeId(null);
                        setBlockFilterScope('area');
                        setStandardTypes(areaId ? (standardTypesByArea[areaId] ?? []).map(sanitizeStandardTypeRecord) : []);
                        if (areaId) {
                          try {
                            window.localStorage.setItem(SELECTED_LEGAL_AREA_STORAGE_KEY, areaId);
                            window.localStorage.removeItem(`${SELECTED_STANDARD_TYPE_STORAGE_KEY_PREFIX}${areaId}`);
                          } catch {
                            // ignore
                          }
                        }
                      }}
                      className="w-full border bg-white pr-2.5 text-xs font-medium text-slate-700 outline-none transition"
                      title="Área jurídica e modelo de petição"
                    >
                      {legalAreas.map((area) => (
                        <optgroup key={area.id} label={area.name}>
                          <option value={`area:${area.id}`}>Todos da área</option>
                          {(standardTypesByArea[area.id] ?? []).map((type) => (
                            <option key={type.id} value={`type:${type.id}`}>{type.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openLegalAreaModal()}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-blue-300 px-3 py-2 text-xs font-semibold text-blue-600 transition hover:bg-blue-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Criar área jurídica
                    </button>
                  )}
                </div>
                <div className="petition-sidebar-search">
                  <div className="relative min-w-0">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar por título, conteúdo ou tag"
                      value={blockSearch}
                      onChange={(e) => setBlockSearch(e.target.value)}
                      className="w-full border bg-white pl-8 pr-2 text-xs text-slate-700"
                    />
                  </div>
                  <div className="petition-sidebar-toolbar">
                  <select
                    value={selectedDocumentType}
                    onChange={(e) => setSelectedDocumentType(e.target.value as DocumentType)}
                    className="border bg-white px-2 text-xs text-slate-700"
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
                    className="petition-sidebar-tool-button"
                    title="Configurar categorias"
                    aria-label="Configurar categorias"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openBlockModal()}
                    className="petition-sidebar-tool-button is-primary"
                    title="Novo bloco"
                  >
                    <Plus className="w-4 h-4" />
                    Novo
                  </button>
                </div>
                </div>

                {/* Filtro de escopo de blocos */}
                <div className="petition-sidebar-scope flex items-center gap-2 border-b border-[#e6dfd3] bg-[#ffffff] px-2 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Exibir:</span>
                  <div className="flex flex-1 gap-1 rounded-xl border border-[#e4ddcf] bg-[#eef0f3] p-1">
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
                        Modelo
                      </button>
                    )}
                    <button
                      onClick={() => setBlockFilterScope('area')}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                        blockFilterScope === 'area'
                          ? 'bg-[#2563eb] text-white shadow-sm'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                      title="Blocos da area juridica selecionada"
                      >
                      Área
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
                      Todos
                    </button>
                  </div>
                </div>
                </div>

                <div className="petition-sidebar-list flex-1 overflow-y-auto bg-[#f8fafc]">
                  <div className="petition-sidebar-list-heading">
                    <span>Seções</span>
                    <span>{filteredBlocks.length} blocos</span>
                  </div>
                  {filteredBlocks.length === 0 ? (
                    <div className="petition-sidebar-empty">
                      <span className="petition-sidebar-empty-icon">
                        <Search className="h-4 w-4" />
                      </span>
                      <strong>Nenhum bloco encontrado</strong>
                      <p>Ajuste a busca, o tipo de documento ou o escopo selecionado.</p>
                    </div>
                  ) : sidebarCategoryKeys.map((category) => {
                    const items = (blocksByCategory as any)[category] || [];
                    if (items.length === 0) return null;
                    const isExpanded = expandedCategories.has(category);
                    return (
                      <div key={category} className="petition-sidebar-category">
                        <button
                          onClick={() => toggleCategory(category)}
                          className="petition-sidebar-category-button flex w-full items-center gap-2 text-left transition"
                        >
                          <span className="petition-sidebar-category-chevron">
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </span>
                          <span className="truncate">{getCategoryLabel(category)}</span>
                          <span className="petition-sidebar-category-count">{items.length}</span>
                        </button>

                        {isExpanded && (
                          <div className="space-y-0.5 px-2 pb-2">
                            {(items as PetitionBlock[]).map((block: PetitionBlock) => (
                              <div
                                key={block.id}
                                className="petition-sidebar-block group cursor-pointer transition"
                                onClick={() => openViewBlock(block)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="petition-sidebar-block-icon">
                                    <FileText className="h-3.5 w-3.5" />
                                  </span>
                                  <span className="flex-1 truncate text-[12px] font-medium text-slate-700">{block.title}</span>
                                  {block.is_default && <Star className="w-2.5 h-2.5 text-blue-400" />}
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openBlockModal(block); }}
                                      className="rounded p-0.5 hover:bg-blue-100"
                                      title="Editar bloco"
                                    >
                                      <Edit3 className="w-2.5 h-2.5 text-blue-600" />
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
                                  const visible = tags.slice(0, 1);
                                  const remaining = tags.length - visible.length;
                                  return (
                                    <div className="petition-sidebar-block-tags">
                                      {visible.map((t) => (
                                        <span key={t} className="inline-flex max-w-[120px] items-center truncate rounded border border-[#e2e8f0] bg-[#f1f5f9] px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                                          {t}
                                        </span>
                                      ))}
                                      {remaining > 0 && (
                                        <span className="inline-flex items-center rounded border border-[#e2e8f0] bg-[#f1f5f9] px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
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
                <div className="petition-sidebar-search border-b border-[#e7ebf0] bg-[#ffffff] pt-2.5">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar por nome ou documento"
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      className="w-full border bg-white pl-8 pr-2 text-xs text-slate-700"
                    />
                  </div>
                </div>

                <div className="petition-sidebar-list flex-1 overflow-y-auto bg-[#f8fafc] py-1">
                  <div className="petition-sidebar-list-heading">
                    <span>Clientes</span>
                    <span>{filteredClients.length} disponíveis</span>
                  </div>
                  {filteredClients.length === 0 ? (
                    <div className="petition-sidebar-empty">
                      <span className="petition-sidebar-empty-icon">
                        <Users className="h-4 w-4" />
                      </span>
                      <strong>Nenhum cliente encontrado</strong>
                      <p>Pesquise pelo nome completo, CPF ou CNPJ.</p>
                    </div>
                  ) : (
                    filteredClients.map(client => (
                      <div
                        key={client.id}
                        className={`petition-sidebar-client group ${selectedClient?.id === client.id ? 'is-selected' : ''}`}
                        onClick={() => selectClientForPetition(client)}
                      >
                        <div className="flex items-center gap-2">
                          <div className="petition-sidebar-client-avatar" aria-hidden="true">
                            {client.full_name
                              .split(/\s+/)
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((part) => part.charAt(0))
                              .join('')
                              .toUpperCase() || <User className="h-3.5 w-3.5" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-[12px] font-semibold text-slate-700">{client.full_name}</p>
                            <p className="mt-0.5 truncate text-[9px] text-slate-400">{client.cpf_cnpj || 'Documento não informado'}</p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              insertClientQualification(client);
                            }}
                            className="petition-sidebar-client-action"
                            title="Inserir qualificacao no documento"
                          >
                            <Plus className="h-3 w-3" />
                            Inserir
                          </button>
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
            className="petition-sidebar-resizer hidden sm:block flex-shrink-0"
            onMouseDown={(e) => {
              isResizingSidebarRef.current = true;
              sidebarResizeStartXRef.current = e.clientX;
              sidebarResizeStartWidthRef.current = sidebarWidth;
              e.preventDefault();
            }}
          />
        )}

        {/* Area do Editor Syncfusion */}
        {/* min-h-0: sem isso um filho de coluna flex nunca encolhe abaixo do
            conteúdo, e a área do editor passa da altura do pai — quem tem de
            rolar é só o viewer do Syncfusion, nunca um wrapper. */}
        <div
          className="syncfusion-editor-wrapper relative flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden"
          style={{ flex: '1 1 0%', minWidth: 0, minHeight: 0, width: '100%' }}
        >
          {/* Banner de conexao: internet caiu ou servidor inacessivel */}
          {(!isOnline || !serverReachable) && (
            <div className="absolute top-0 inset-x-0 z-[55] p-3 pointer-events-none">
              <div className={`pointer-events-auto mx-auto max-w-3xl overflow-hidden rounded-2xl border bg-[#fffdf7] shadow-[0_18px_45px_rgba(180,120,10,0.20)] animate-in fade-in slide-in-from-top-2 duration-300 ${reconnectFailed ? 'border-red-300/80 petition-shake' : 'border-amber-200/80'}`}>
                <div className={`h-1 w-full bg-gradient-to-r ${reconnectFailed ? 'from-red-400 via-red-500 to-red-400' : 'from-amber-400 via-amber-500 to-amber-400'} ${(checkingServer || isRetrying) ? 'petition-progress-stripes' : ''}`} />
                <div className="flex items-start gap-3 p-4">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center flex-shrink-0 shadow-sm">
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
                    {localDraftUpdatedAt && (
                      <p className="mt-2 text-[12.5px] font-medium text-amber-700">
                        Cópia local temporária salva em {new Date(localDraftUpdatedAt).toLocaleString('pt-BR')}.
                      </p>
                    )}
                    {reconnectFailed && (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-red-600 animate-in fade-in slide-in-from-left-1 duration-200">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        Ainda sem conexao. Verifique sua internet e tente novamente.
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => { void exportToWord(); }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-bold rounded-xl transition-all shadow-md bg-amber-500 text-white hover:bg-amber-600"
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
                      {restorableLocalDraft && (
                        <button
                          type="button"
                          onClick={() => { void restoreLocalDraft(); }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-bold rounded-xl transition-all shadow-sm petition-btn-slate"
                        >
                          <Clock className="w-4 h-4" />
                          Restaurar cópia local
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Overlay de formataçÃ£o com IA */}
          {formattingWithAI && (
            <div className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-950/30 backdrop-blur-[2px]">
              <div className="petition-import-progress mx-4 w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.24)]">
                <div className="flex items-start gap-3 px-5 py-5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-[#185abd]">
                    <Pencil className="h-[18px] w-[18px]" />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-slate-900">Processando seleção</h3>
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">A IA está revisando o texto e preparando a nova versão.</p>
                  </div>
                </div>
                <div className="h-1 overflow-hidden bg-slate-100">
                  <div className="petition-import-progress-bar h-full w-1/3 bg-[#185abd]" />
                </div>
              </div>
            </div>
          )}
          {/* Quem mais está neste documento agora — e, quando a coedição cai, o
              aviso de que as edições PARARAM de ser sincronizadas. */}
          {(editingPeers.length > 0 || collabStatus === 'disconnected' || collabStatus === 'reconnecting') && (
            <div className="pointer-events-none absolute right-4 top-3 z-[45] flex justify-end">
              <EditorPresenceBar peers={editingPeers} collabStatus={collabStatus} />
            </div>
          )}

          <SyncfusionEditor
            ref={editorRef}
            id="petition-main-editor"
            height="100%"
            currentUserName={userDisplayName}
            onCollabPeersChange={setCollabPeers}
            onCollabStatusChange={setCollabStatus}
            onCollabSaved={handleCollabRemoteSave}
            readOnly={!isOnline || !serverReachable}
            enableToolbar={false}
            showPropertiesPane={false}
            showNavigationPane={false}
            onReady={() => {
              setEditorReady(true);
              // Avisa o loader de boot (app /editor ou nova aba) que o editor já
              // está interativo — cobre também a petição EM BRANCO, que não passa
              // pelos fluxos de carregamento de documento que emitem este evento.
              try { window.dispatchEvent(new Event('petition-editor-doc-ready')); } catch { /* ignore */ }
              editorRef.current?.setZoom(DEFAULT_EDITOR_ZOOM);
              // Recalcula o layout apÃ³s o wrapper assumir a largura final (evita folha comprimida)
              window.setTimeout(() => {
                editorRef.current?.refresh?.();
                editorRef.current?.setZoom(DEFAULT_EDITOR_ZOOM);
              }, 60);
              window.setTimeout(() => {
                editorRef.current?.refresh?.();
                editorRef.current?.setZoom(DEFAULT_EDITOR_ZOOM);
                refreshDocStatus();
                scheduleWordCount(400);
              }, 320);
            }}
            onContentChange={handleContentChange}
            // `documentChange` = documento terminou de abrir. Re-arma a janela de
            // acomodação para cobrir os ajustes automáticos que vêm em seguida
            // (margens, fitPage, repaginação), mesmo em documentos grandes.
            onDocumentChange={() => {
              beginDocumentSettleWindow();
              refreshDocStatus();
              scheduleWordCount(350);
            }}
            onSelectionChange={() => {
              refreshDocStatus();
              scheduleCursorPersist();
              setAiSelectedText(editorRef.current?.getSelectedText?.() || '');
            }}
            onViewChange={refreshDocStatus}
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

          {/* Widget de chat IA — assistente da petição (revisa, corrige, insere).
             Preferência de CADA usuário (profiles.petition_ai_assistant_enabled),
             alternada na aba Configurações da faixa ou no card do CRM. Desligado
             nem monta: sem botão flutuante e sem chamada de IA saindo daqui. */}
          {aiAssistantEnabled && (
          <PetitionAiChat
            editorRef={editorRef}
            onDocumentChanged={() => setHasUnsavedChanges(true)}
            kbEntries={aiKbEntries}
            clientContext={aiClientContext}
            insertBlockSfdt={insertAiBlockSfdt}
            disabled={!isOnline || !serverReachable}
            disabledReason="Voce esta offline. Reconecte para usar o assistente."
            selectedText={aiSelectedText}
            documentWordCount={wordCount}
            documentHasContent={aiHasDocumentContent || wordCount > 0 || aiPageCount > 1}
            documentPageCount={aiPageCount}
            suggestedArea={selectedLegalArea?.name}
            suggestedDocumentType={DOCUMENT_TYPE_BRIEFING_LABELS[selectedDocumentType]}
          />
          )}

        </div>

        {findReplaceMode && (
          <PetitionFindReplacePanel
            key={findReplaceMode}
            editorRef={editorRef}
            initialMode={findReplaceMode}
            onClose={() => setFindReplaceMode(null)}
            onDocumentChanged={() => setHasUnsavedChanges(true)}
          />
        )}

        {showProofreader && editorReady && (
          <PetitionProofreaderPanel
            editorRef={editorRef}
            onClose={() => setShowProofreader(false)}
            onDocumentChanged={() => setHasUnsavedChanges(true)}
          />
        )}

        </div>

        {/* Status bar estilo Word: página, palavras, modos e zoom */}
        {activeWorkspace === 'editor' && editorReady && (
          <PetitionLiveStatusBar
            store={docStatusStore}
            words={wordCount}
            onZoomChange={(zoom) => {
              editorRef.current?.setZoom(zoom);
              refreshDocStatus();
            }}
            onLayoutChange={(layout) => {
              editorRef.current?.setLayoutType(layout);
              refreshDocStatus();
            }}
          />
        )}
      </>
      )}

      {/* Hidden editor for DOCX conversion - always available */}
      <div style={{ position: 'fixed', left: -10000, top: -10000, width: 1, height: 1, overflow: 'hidden' }}>
        <SyncfusionEditor
          ref={blockConvertEditorRef}
          id="petition-block-converter"
          height="1px"
          currentUserName={userDisplayName}
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
        <aside id="petition-lookup-backdrop" className={`fixed inset-0 ${zcStack[0]} flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/40 backdrop-blur-sm overflow-y-auto`}>
          <main id="company-lookup-modal" className="bg-white rounded-xl shadow-[0_28px_80px_rgba(15,23,42,0.26)] ring-1 ring-black/10 w-full max-w-2xl my-4 overflow-hidden flex flex-col mx-auto">
            <header className="relative px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-[#185abd]">
                  <Search className="h-[18px] w-[18px]" />
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">Consultar empresa</h3>
                  <div className="mt-1 text-[11px] text-slate-500">Busque os dados cadastrais e gere a qualificação jurídica.</div>
                </div>
              </div>
              <button
                onClick={() => setShowCompanyLookupModal(false)}
                className="absolute top-2 sm:top-4 right-2 sm:right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-[220px_minmax(0,1fr)]">
              <div>
                <label className="mb-2 block text-[11px] font-semibold text-slate-600">CNPJ da empresa</label>
                <input
                  type="text"
                  value={companyCnpjInput}
                  onChange={(e) => setCompanyCnpjInput(e.target.value)}
                  placeholder="00.000.000/0000-00"
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-medium outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 placeholder:text-slate-300"
                  autoFocus
                />
                <p className="mt-2 text-[10px] leading-4 text-slate-400">Digite com ou sem pontuação.</p>
                <button
                  onClick={handleCompanyLookup}
                  disabled={companyLookupLoading}
                  className="petition-btn-orange mt-4 flex h-9 w-full items-center justify-center gap-2 px-4 text-[11px]"
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
              </div>

              <div className="min-w-0">
                <label className="mb-2 block text-[11px] font-semibold text-slate-600">Qualificação gerada</label>
              {companyLookupResultText ? (
                  <textarea
                    value={companyLookupResultText}
                    onChange={(e) => setCompanyLookupResultText(e.target.value)}
                    rows={6}
                    className="min-h-[150px] w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-[12px] font-medium leading-relaxed text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                  />
              ) : (
                <div className="flex min-h-[150px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 px-5 text-center text-[11px] leading-5 text-slate-400">
                  O resultado da consulta aparecerá aqui para revisão antes da inserção.
                </div>
              )}
              </div>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                onClick={() => setShowCompanyLookupModal(false)}
                className="petition-btn-slate h-9 px-4 text-[11px]"
              >
                Cancelar
              </button>
              <button
                onClick={insertCompanyText}
                disabled={!companyLookupResultText}
                className="petition-btn-emerald flex h-9 items-center justify-center gap-2 px-4 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                <span>Inserir no documento</span>
              </button>
            </footer>
          </main>
        </aside>
      )}

      {/* Modal de Busca de Bloco */}
      {showBlockSearchModal && (
        <aside id="petition-search-backdrop" className={`fixed inset-0 ${zcStack[0]} flex items-start justify-center p-2 sm:p-6 pt-8 bg-slate-900/45 backdrop-blur-sm overflow-y-auto`}>
          <main id="block-search-modal" className="bg-white rounded-xl shadow-[0_28px_80px_rgba(15,23,42,0.28)] ring-1 ring-black/10 w-full max-w-5xl my-4 overflow-hidden flex flex-col mx-auto">
            <header className="px-5 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-white">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-[#185abd]">
                  <Layers className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">Biblioteca de conteúdo</h3>
                  <div className="mt-1 text-[11px] text-slate-500">Localize, revise e insira textos padronizados no documento.</div>
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

            <div className="grid min-h-[520px] grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
              <aside className="border-b border-slate-200 bg-slate-50 p-4 md:border-b-0 md:border-r">
                <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Pesquisar em</div>
                <div className="petition-scope-toggle flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-1">
                  {selectedStandardTypeId && (
                    <button
                      type="button"
                      onClick={() => setBlockSearchScope('type')}
                      className={`petition-scope-toggle-btn w-full px-3 py-2 text-left text-[11px] font-semibold rounded-md transition-colors ${
                        blockSearchScope === 'type'
                          ? 'bg-blue-50 text-[#185abd]'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                      title="Buscar apenas nos blocos vinculados a Peticao Padrao"
                    >
                      Peticao
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setBlockSearchScope('area')}
                    className={`petition-scope-toggle-btn w-full px-3 py-2 text-left text-[11px] font-semibold rounded-md transition-colors ${
                      blockSearchScope === 'area'
                        ? 'bg-blue-50 text-[#185abd]'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                    title="Buscar nos blocos da Area Juridica selecionada"
                  >
                    Area
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlockSearchScope('global')}
                    className={`petition-scope-toggle-btn w-full px-3 py-2 text-left text-[11px] font-semibold rounded-md transition-colors ${
                      blockSearchScope === 'global'
                        ? 'bg-blue-50 text-[#185abd]'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                    title="Buscar em todos os blocos (consulta global)"
                  >
                    Global
                  </button>
                </div>
                <div className="mt-5 border-t border-slate-200 pt-4">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Contexto atual</div>
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-[11px] font-semibold text-slate-700">{selectedLegalArea?.name || 'Todas as áreas'}</div>
                    <div className="mt-1 text-[10px] leading-relaxed text-slate-400">
                      {selectedStandardTypeId ? 'Modelo de petição selecionado' : 'Biblioteca da área jurídica'}
                    </div>
                  </div>
                </div>
              </aside>

              <section className="flex min-w-0 flex-col p-4 sm:p-5">
              <div className="relative">
                <Search className="w-[18px] h-[18px] text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Pesquisar por título, conteúdo ou palavra-chave"
                  value={blockSearchQuery}
                  onChange={(e) => setBlockSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-24 py-2.5 text-sm border border-slate-200 rounded-md focus:ring-2 focus:ring-blue-500/15 focus:border-blue-400 bg-white transition"
                  autoFocus
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">ESC</span>
              </div>

              <div className="mt-3 flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="text-[11px] font-semibold text-slate-600">Resultados</span>
                <span className="text-[10px] tabular-nums text-slate-400">{searchFilteredBlocks.length} itens encontrados</span>
              </div>

              <div className="mt-2 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                <div className="max-h-[58vh] overflow-y-auto p-2">
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
                        className="mb-2 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm last:mb-0 hover:border-blue-200 hover:shadow-md cursor-pointer transition"
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
                          {b.is_default && <Star className="w-3 h-3 text-blue-400" />}
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
                                  <Hash className="w-2.5 h-2.5 text-blue-500" />{t}
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
              <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
                <span>Clique em um item para visualizar antes de inserir.</span>
                <span>Biblioteca Jurius</span>
              </div>
              </section>
            </div>
          </main>
        </aside>
      )}

      {showAiEditModal && (
        <aside className={`fixed inset-0 ${zcStack[1]} flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/40 backdrop-blur-sm overflow-y-auto`}>
          <main id="ai-edit-modal" className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 w-full max-w-3xl my-4 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-1 w-full shrink-0 bg-blue-500" />

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
                  className="w-full px-4 py-3 text-sm border border-[#e3e6ea] rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-slate-50 transition-all leading-relaxed text-slate-700 font-medium"
                  placeholder="Ex.: Reescreva esse trecho com linguagem mais tecnica, mais objetiva e com melhor conexao logica, sem mudar o pedido."
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-2">Trecho selecionado</label>
                <div className="w-full px-4 py-3 text-sm border border-[#e3e6ea] rounded-xl bg-[#f7f8fa] text-slate-700 leading-relaxed whitespace-pre-wrap max-h-[240px] overflow-y-auto">
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
        <aside id="petition-categories-backdrop" className={`fixed inset-0 ${zcStack[1]} flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/40 backdrop-blur-sm overflow-y-auto`}>
          <main id="petition-categories-modal" className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 w-full max-w-2xl my-4 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-1 w-full shrink-0 bg-blue-500" />

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

              <div className="border border-[#e3e6ea] rounded-xl overflow-hidden">
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
                              className="w-full px-3 py-2 text-xs border border-[#e3e6ea] rounded-lg bg-slate-50"
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
                              className="w-full px-3 py-2 text-xs border border-[#e3e6ea] rounded-lg bg-slate-50"
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
                              className="px-2 py-2 text-xs border border-[#e3e6ea] rounded-lg hover:bg-slate-50"
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
                              className="px-2 py-2 text-xs border border-[#e3e6ea] rounded-lg hover:bg-slate-50"
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
        <aside id="legal-area-backdrop" className={`fixed inset-0 ${zcStack[2]} flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/40 backdrop-blur-sm overflow-y-auto`}>
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
                  className="w-full px-4 py-3 text-sm border border-[#e3e6ea] rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all font-medium bg-slate-50"
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
                  className="w-full px-4 py-3 text-sm border border-[#e3e6ea] rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all font-medium bg-slate-50 resize-none"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-2">Cor de Identificacao</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={legalAreaFormData.color}
                    onChange={(e) => setLegalAreaFormData({ ...legalAreaFormData, color: e.target.value })}
                    className="w-12 h-10 rounded-lg border border-[#e3e6ea] cursor-pointer"
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
                <div className="pt-4 border-t border-[#e3e6ea]">
                  <label className="block text-[12px] font-medium text-slate-600 mb-3">Areas Cadastradas</label>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {legalAreas.map((area) => (
                      <div
                        key={area.id}
                        className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-[#e3e6ea]"
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
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
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
        <aside className={`fixed inset-0 ${zcStack[2]} flex items-start justify-center p-2 sm:p-6 pt-12 bg-slate-900/40 backdrop-blur-sm overflow-y-auto`}>
          <main id="standard-type-modal" className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 w-full max-w-lg my-4 overflow-hidden flex flex-col mx-auto transition-all duration-300">
            <div className="h-1 w-full shrink-0 bg-blue-500" />
            <header className="relative px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
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
                  className="w-full px-4 py-3 text-sm border border-[#e3e6ea] rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all font-medium bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-2">Descricao</label>
                <textarea
                  value={standardTypeFormData.description}
                  onChange={(e) => setStandardTypeFormData({ ...standardTypeFormData, description: e.target.value })}
                  placeholder="Descricao opcional..."
                  rows={2}
                  className="w-full px-4 py-3 text-sm border border-[#e3e6ea] rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all font-medium bg-slate-50 resize-none"
                />
              </div>

              {/* Area vinculada */}
              <div className="p-3 bg-slate-50 rounded-xl border border-[#e3e6ea]">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Scale className="w-4 h-4" />
                  <span>Area Juridica:</span>
                  <span className="font-bold text-slate-700">{selectedLegalArea?.name || 'Nenhuma'}</span>
                </div>
              </div>

              {/* Documento padrao vinculado */}
              {editingStandardType && (
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-blue-700">
                      <FileText className="w-4 h-4" />
                      <span>Documento padrao:</span>
                      <span className="font-bold">
                        {editingStandardType.default_document_name || 'Nenhum vinculado'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleSetDefaultDocument(editingStandardType.id)}
                      disabled={saving}
                      className="px-2 py-1 text-[10px] bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50"
                      title="Vincular o documento atual do editor como padrao"
                    >
                      {saving ? 'Salvando...' : 'Vincular Atual'}
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-blue-600">
                    Ao selecionar esta peticao padrao, o documento vinculado sera carregado automaticamente.
                  </p>
                </div>
              )}

              {/* Lista de petiçÃµes padrÃµes cadastradas */}
              <div className="pt-4 border-t border-[#e3e6ea]">
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
                        className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-[#e3e6ea]"
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-blue-500" />
                          <div>
                            <span className="text-sm font-medium text-slate-700">{type.name}</span>
                            {type.default_document_name && (
                              <span className="ml-2 text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                                {type.default_document_name}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openStandardTypeModal(type)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
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
        <aside id="petition-editor-backdrop" className={`fixed inset-0 ${zc.MODAL} flex flex-col bg-white`}>
          <main id="block-editor-modal" className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <PetitionRibbon
              editorRef={blockEditorRef}
              ready={blockEditorReady}
              topContent={blockRibbonTopContent}
              entityLabel="bloco"
              shortcutScopeActive
              darkMode={darkMode}
              onToggleDarkMode={toggleDarkMode}
              onNew={() => {
                blockEditorRef.current?.clear?.();
                setBlockEditorDirty(true);
              }}
              onSave={() => { void saveBlock(); }}
              onOpenFindReplace={(mode) => setBlockFindReplaceMode(mode)}
            />

            {/* Editor - ocupa todo o espaço restante */}
            <div className="syncfusion-editor-wrapper petition-block-editor-surface relative flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
              <SyncfusionEditor
                ref={blockEditorRef}
                id="petition-block-editor"
                height="100%"
                currentUserName={userDisplayName}
                showPropertiesPane={false}
                enableToolbar={false}
                enableCustomContextMenu
                showRuler
                showNavigationPane={false}
                layoutType="Pages"
                removeMargins={false}
                onReady={() => {
                  setBlockEditorReady(true);
                  blockEditorRef.current?.setZoom(DEFAULT_BLOCK_EDITOR_ZOOM);
                  window.setTimeout(() => {
                    blockEditorRef.current?.refresh?.();
                    blockEditorRef.current?.setZoom(DEFAULT_BLOCK_EDITOR_ZOOM);
                  }, 60);
                  window.setTimeout(() => {
                    blockEditorRef.current?.refresh?.();
                    blockEditorRef.current?.setZoom(DEFAULT_BLOCK_EDITOR_ZOOM);
                    refreshBlockDocStatus();
                    scheduleBlockWordCount(100);
                  }, 320);
                }}
                onContentChange={handleBlockContentChange}
                onDocumentChange={() => {
                  blockEditorRef.current?.setZoom(DEFAULT_BLOCK_EDITOR_ZOOM);
                  window.setTimeout(() => {
                    blockEditorRef.current?.setZoom(DEFAULT_BLOCK_EDITOR_ZOOM);
                    refreshBlockDocStatus();
                  }, 80);
                }}
                onSelectionChange={refreshBlockDocStatus}
                onViewChange={refreshBlockDocStatus}
              />
              {blockFindReplaceMode && (
                <PetitionFindReplacePanel
                  key={blockFindReplaceMode}
                  editorRef={blockEditorRef}
                  initialMode={blockFindReplaceMode}
                  onClose={() => setBlockFindReplaceMode(null)}
                  onDocumentChanged={() => setBlockEditorDirty(true)}
                />
              )}

              {/* Propriedades do bloco: cartão flutuante sobre o editor, recolhível */}
              <div className={`petition-block-properties absolute right-4 top-4 z-30 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.18)] ${blockPropsOpen ? 'w-[340px] max-w-[calc(100%-2rem)]' : ''}`}>
                <button
                  type="button"
                  onClick={() => setBlockPropsOpen((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition"
                  title={blockPropsOpen ? 'Recolher propriedades' : 'Expandir propriedades do bloco'}
                >
                  <Settings className="h-4 w-4 shrink-0 text-blue-500" />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-700">
                    {blockPropsOpen ? 'Propriedades do bloco' : (blockFormData.title.trim() || 'Bloco sem título')}
                  </span>
                  {!blockPropsOpen && (blockFormData.tags || []).length > 0 && (
                    <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      {(blockFormData.tags || []).length}
                    </span>
                  )}
                  {blockPropsOpen ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
                </button>

                {blockPropsOpen && (
                  <div className="max-h-[min(70vh,560px)] space-y-3 overflow-y-auto border-t border-slate-100 px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-slate-500">Nome do bloco *</label>
                      <input
                        type="text"
                        value={blockFormData.title}
                        onChange={(e) => {
                          setBlockFormData({ ...blockFormData, title: e.target.value });
                          setBlockEditorDirty(true);
                        }}
                        placeholder="Ex.: Das questões iniciais"
                        className="w-full px-2.5 py-1.5 text-[13px] font-medium text-slate-800 border border-slate-200 rounded-lg bg-white hover:border-slate-300 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
                      />
                    </div>

                    {legalAreas.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-medium text-slate-500">Área</label>
                        <select
                          value={(blockFormData.legal_area_id ?? selectedLegalAreaId ?? '') as any}
                          onChange={(e) => {
                            const v = e.target.value || null;
                            setBlockFormData({ ...blockFormData, legal_area_id: v as any });
                            setBlockEditorDirty(true);
                            if (v && blockStandardTypeId) {
                              const types = standardTypesByArea[String(v)] ?? [];
                              if (!types.some((t) => t.id === blockStandardTypeId)) {
                                setBlockStandardTypeId(null);
                              }
                            }
                          }}
                          className="w-full px-2.5 py-1.5 text-[13px] text-slate-700 border border-slate-200 rounded-lg bg-white hover:border-slate-300 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition cursor-pointer"
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
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-medium text-slate-500">Modelo</label>
                        <select
                          value={(blockFilterScope === 'type' && selectedStandardTypeId ? selectedStandardTypeId : (blockStandardTypeId || '')) as any}
                          onChange={(e) => {
                            if (blockFilterScope === 'type' && selectedStandardTypeId) return;
                            const v = e.target.value || null;
                            setBlockStandardTypeId(v as any);
                            setBlockEditorDirty(true);
                            const found = Object.values(standardTypesByArea).flat().find((t) => t.id === v) || null;
                            if (found?.legal_area_id) {
                              setBlockFormData((prev) => ({ ...prev, legal_area_id: found.legal_area_id as any }));
                            }
                          }}
                          disabled={blockStandardTypeLoading || (blockFilterScope === 'type' && Boolean(selectedStandardTypeId))}
                          className="w-full px-2.5 py-1.5 text-[13px] text-slate-700 border border-slate-200 rounded-lg bg-white hover:border-slate-300 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition cursor-pointer disabled:opacity-60"
                        >
                          <option value="">Sem modelo</option>
                          {(standardTypesByArea[String(blockFormData.legal_area_id ?? selectedLegalAreaId ?? '')] ?? []).map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-slate-500">Categoria</label>
                      <select
                        value={blockFormData.category}
                        onChange={(e) => {
                          setBlockFormData({ ...blockFormData, category: e.target.value as BlockCategory });
                          setBlockEditorDirty(true);
                        }}
                        className="w-full px-2.5 py-1.5 text-[13px] text-slate-700 border border-slate-200 rounded-lg bg-white hover:border-slate-300 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition cursor-pointer"
                      >
                        {categoryKeysOrdered.map((key) => (
                          <option key={key} value={key}>{getCategoryLabel(key)}</option>
                        ))}
                      </select>
                    </div>

                    {/* Tags: alimentam a busca de blocos (título + tags + conteúdo) */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-medium text-slate-500">Tags</label>

                      {(blockFormData.tags || []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {(blockFormData.tags || []).map((tag) => (
                            <span
                              key={tag}
                              className="petition-block-tag inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-[12px] font-medium text-slate-700"
                            >
                              <Hash className="w-2.5 h-2.5 text-blue-500" />
                              {tag}
                              <button
                                type="button"
                                onClick={() => removeBlockTag(tag)}
                                className="p-0.5 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                                title={`Remover tag ${tag}`}
                                aria-label={`Remover tag ${tag}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={blockTagInput}
                          onChange={(e) => setBlockTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault();
                              addBlockTags(blockTagInput);
                            } else if (e.key === 'Backspace' && !blockTagInput) {
                              const current = blockFormData.tags || [];
                              if (current.length) removeBlockTag(current[current.length - 1]);
                            }
                          }}
                          onBlur={() => addBlockTags(blockTagInput)}
                          placeholder="Nova tag + Enter"
                          className="min-w-0 flex-1 px-2.5 py-1 text-[12px] text-slate-700 border border-slate-200 rounded-lg bg-white hover:border-slate-300 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
                          aria-label="Adicionar tag ao bloco"
                        />
                        <button
                          type="button"
                          onClick={() => { void suggestBlockTags(); }}
                          disabled={blockTagsSuggesting}
                          className="petition-block-tag inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[12px] font-medium text-slate-600 hover:border-slate-300 hover:text-blue-600 transition disabled:opacity-60"
                          title="Sugerir tags a partir do título e do conteúdo"
                        >
                          {blockTagsSuggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          Sugerir
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={blockFormData.is_default}
                          onChange={(e) => {
                            setBlockFormData({ ...blockFormData, is_default: e.target.checked });
                            setBlockEditorDirty(true);
                          }}
                          className="w-4 h-4 rounded border-blue-300 text-blue-500 focus:ring-blue-500/40 cursor-pointer"
                        />
                        <span className="text-[12px] font-medium text-blue-700">Bloco padrão</span>
                      </label>

                      {!editingBlock && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={updateExistingBlockMode}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setUpdateExistingBlockMode(checked);
                              setBlockEditorDirty(true);
                              if (!checked) setUpdateExistingBlockId('');
                            }}
                            className="w-4 h-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500/40 cursor-pointer"
                          />
                          <span className="text-[12px] font-medium text-slate-600">Atualizar bloco existente</span>
                        </label>
                      )}

                      {updateExistingBlockMode && !editingBlock && (
                        <select
                          value={updateExistingBlockId}
                          onChange={(e) => {
                            setUpdateExistingBlockId(e.target.value);
                            setBlockEditorDirty(true);
                          }}
                          className="w-full px-2.5 py-1.5 text-[13px] text-slate-700 border border-slate-200 rounded-lg bg-white hover:border-slate-300 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition cursor-pointer"
                        >
                          <option value="">Selecione o bloco</option>
                          {updatableBlocks.map((b) => (
                            <option key={b.id} value={b.id}>{b.title}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    {editingBlock && (
                      <button
                        type="button"
                        onClick={async () => {
                          const removed = await deleteBlock(editingBlock.id);
                          if (removed) {
                            setBlockEditorDirty(false);
                            setShowBlockModal(false);
                            setEditingBlock(null);
                          }
                        }}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-semibold text-red-600 hover:bg-red-100 transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Excluir bloco
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {blockEditorReady && (
              <PetitionLiveStatusBar
                store={blockDocStatusStore}
                words={blockWordCount}
                onZoomChange={(zoom) => {
                  blockEditorRef.current?.setZoom(zoom);
                  refreshBlockDocStatus();
                }}
                onLayoutChange={(layout) => {
                  blockEditorRef.current?.setLayoutType(layout);
                  refreshBlockDocStatus();
                }}
              />
            )}
          </main>
        </aside>
      )}
    </div>
  );
};

// Estilos injetados para vencer regras globais do index.css
const petitionModalStyles = `
  @keyframes petitionImportProgress {
    0% { transform: translateX(-130%); }
    55% { transform: translateX(120%); }
    100% { transform: translateX(300%); }
  }
  .petition-import-progress-bar {
    animation: petitionImportProgress 2.4s cubic-bezier(.4,0,.2,1) infinite;
  }

  /* Linguagem visual única para os diálogos auxiliares do editor. */
  main#company-lookup-modal,
  main#block-search-modal,
  main#petition-categories-modal,
  main#legal-area-modal,
  main#standard-type-modal,
  main#ai-edit-modal {
    border-radius: 12px !important;
    border: 1px solid rgba(15,23,42,.08) !important;
    box-shadow: 0 28px 72px rgba(15,23,42,.24) !important;
  }
  main#petition-categories-modal > div:first-child[class*="h-1"],
  main#legal-area-modal > div:first-child[class*="h-1"],
  main#standard-type-modal > div:first-child[class*="h-1"],
  main#ai-edit-modal > div:first-child[class*="h-1"] {
    display: none !important;
  }
  main#petition-categories-modal header,
  main#legal-area-modal header,
  main#standard-type-modal header,
  main#ai-edit-modal header {
    min-height: 64px;
    padding: 14px 20px !important;
    border-bottom-color: #dfe4ea !important;
  }
  main#petition-categories-modal footer,
  main#legal-area-modal footer,
  main#standard-type-modal footer,
  main#ai-edit-modal footer {
    padding: 12px 20px !important;
    border-top-color: #dfe4ea !important;
  }
  main#petition-categories-modal input,
  main#petition-categories-modal textarea,
  main#legal-area-modal input,
  main#legal-area-modal textarea,
  main#standard-type-modal input,
  main#standard-type-modal textarea,
  main#standard-type-modal select,
  main#ai-edit-modal input,
  main#ai-edit-modal textarea {
    border-radius: 6px !important;
    box-shadow: none !important;
  }

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
  .petition-btn-orange { background-color: #2563eb !important; color: #ffffff !important; }
  .petition-btn-orange:hover { background-color: #1d4ed8 !important; }
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
    .petition-shake, .petition-progress-stripes, .petition-import-progress-bar { animation: none !important; }
  }

  /* Garantir que o painel do modal nÃ£o seja sequestrado */
  main#company-lookup-modal,
  main#block-search-modal,
  main#block-editor-modal {
    background-color: #ffffff !important;
    color: #0f172a !important;
  }

  body.petition-dark .petition-workspace-toggle {
    background: #2d2d2d !important;
    border-color: #444444 !important;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.03) !important;
  }
  body.petition-dark .petition-workspace-toggle-btn {
    color: #c9d2df !important;
  }
  body.petition-dark .petition-workspace-toggle-btn:hover {
    background: #3a3a3a !important;
    color: #eef2f7 !important;
  }
  body.petition-dark .petition-workspace-toggle-btn.bg-white {
    background: #3f4550 !important;
    color: #93c5fd !important;
    box-shadow: 0 1px 2px rgba(0,0,0,0.25) !important;
  }

  body.petition-dark main#company-lookup-modal,
  body.petition-dark main#block-search-modal,
  body.petition-dark main#petition-categories-modal,
  body.petition-dark main#legal-area-modal,
  body.petition-dark aside#petition-lookup-backdrop > main,
  body.petition-dark aside#petition-search-backdrop > main,
  body.petition-dark aside#petition-categories-backdrop > main,
  body.petition-dark aside#legal-area-backdrop > main,
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main,
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main {
    background: #2b2b2b !important;
    color: #e5e7eb !important;
    border-color: #434343 !important;
    box-shadow: 0 24px 60px rgba(0,0,0,0.45) !important;
  }
  body.petition-dark main#company-lookup-modal header,
  body.petition-dark main#block-search-modal header,
  body.petition-dark main#petition-categories-modal header,
  body.petition-dark main#legal-area-modal header,
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main header,
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main header {
    background: #2f2f2f !important;
    border-bottom-color: #434343 !important;
  }
  body.petition-dark main#company-lookup-modal .text-slate-900,
  body.petition-dark main#block-search-modal .text-slate-900,
  body.petition-dark main#petition-categories-modal .text-slate-900,
  body.petition-dark main#legal-area-modal .text-slate-900,
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main .text-slate-900,
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main .text-slate-900 {
    color: #f3f4f6 !important;
  }
  body.petition-dark main#company-lookup-modal .text-slate-800,
  body.petition-dark main#company-lookup-modal .text-slate-700,
  body.petition-dark main#block-search-modal .text-slate-800,
  body.petition-dark main#block-search-modal .text-slate-700,
  body.petition-dark main#petition-categories-modal .text-slate-800,
  body.petition-dark main#petition-categories-modal .text-slate-700,
  body.petition-dark main#legal-area-modal .text-slate-800,
  body.petition-dark main#legal-area-modal .text-slate-700,
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main .text-slate-800,
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main .text-slate-700,
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main .text-slate-800,
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main .text-slate-700 {
    color: #d6d9df !important;
  }
  body.petition-dark main#company-lookup-modal .text-slate-600,
  body.petition-dark main#company-lookup-modal .text-slate-500,
  body.petition-dark main#block-search-modal .text-slate-600,
  body.petition-dark main#block-search-modal .text-slate-500,
  body.petition-dark main#petition-categories-modal .text-slate-600,
  body.petition-dark main#petition-categories-modal .text-slate-500,
  body.petition-dark main#legal-area-modal .text-slate-600,
  body.petition-dark main#legal-area-modal .text-slate-500,
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main .text-slate-600,
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main .text-slate-500,
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main .text-slate-600,
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main .text-slate-500 {
    color: #aeb6c3 !important;
  }
  body.petition-dark main#company-lookup-modal [class*="bg-white"],
  body.petition-dark main#block-search-modal [class*="bg-white"],
  body.petition-dark main#petition-categories-modal [class*="bg-white"],
  body.petition-dark main#legal-area-modal [class*="bg-white"],
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main [class*="bg-white"],
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main [class*="bg-white"] {
    background-color: #313131 !important;
    border-color: #454545 !important;
  }
  body.petition-dark main#company-lookup-modal [class*="bg-slate-50"],
  body.petition-dark main#company-lookup-modal [class*="bg-slate-100"],
  body.petition-dark main#block-search-modal [class*="bg-slate-50"],
  body.petition-dark main#block-search-modal [class*="bg-slate-100"],
  body.petition-dark main#petition-categories-modal [class*="bg-slate-50"],
  body.petition-dark main#petition-categories-modal [class*="bg-slate-100"],
  body.petition-dark main#legal-area-modal [class*="bg-slate-50"],
  body.petition-dark main#legal-area-modal [class*="bg-slate-100"],
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main [class*="bg-slate-50"],
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main [class*="bg-slate-100"],
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main [class*="bg-slate-50"],
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main [class*="bg-slate-100"] {
    background-color: #353535 !important;
    border-color: #454545 !important;
  }
  body.petition-dark main#company-lookup-modal input,
  body.petition-dark main#company-lookup-modal textarea,
  body.petition-dark main#company-lookup-modal select,
  body.petition-dark main#block-search-modal input,
  body.petition-dark main#block-search-modal textarea,
  body.petition-dark main#block-search-modal select,
  body.petition-dark main#petition-categories-modal input,
  body.petition-dark main#petition-categories-modal textarea,
  body.petition-dark main#petition-categories-modal select,
  body.petition-dark main#legal-area-modal input,
  body.petition-dark main#legal-area-modal textarea,
  body.petition-dark main#legal-area-modal select,
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main input,
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main textarea,
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main select,
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main input,
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main textarea,
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main select {
    background: #363636 !important;
    color: #eef2f7 !important;
    border-color: #555555 !important;
  }
  body.petition-dark .petition-scope-toggle {
    background: #383838 !important;
    border-color: #4b4b4b !important;
  }
  body.petition-dark .petition-scope-toggle-btn {
    color: #c7cfda !important;
  }
  body.petition-dark .petition-scope-toggle-btn:hover {
    background: #424242 !important;
    color: #f3f4f6 !important;
  }
  body.petition-dark main#block-search-modal .border-slate-200,
  body.petition-dark main#block-search-modal .border-slate-100,
  body.petition-dark main#company-lookup-modal .border-slate-200,
  body.petition-dark main#petition-categories-modal .border-slate-200,
  body.petition-dark main#legal-area-modal .border-slate-200,
  body.petition-dark aside[class*="fixed"][class*="z-\\[110\\]"] > main .border-slate-200,
  body.petition-dark aside[class*="fixed"][class*="z-\\[120\\]"] > main .border-slate-200 {
    border-color: #454545 !important;
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

if (typeof document !== 'undefined') {
  let style = document.getElementById('petition-modal-isolation');
  if (!style) {
    style = document.createElement('style');
    style.id = 'petition-modal-isolation';
    document.head.appendChild(style);
  }
  // Idempotente: atualiza sempre para refletir mudanças de CSS (HMR / re-render).
  style.innerHTML = petitionModalStyles;
}

// O editor de blocos usa a mesma superfície responsiva do editor de documentos.
const blockEditorModalStyles = `
  #block-editor-modal {
    background: #f5f6f8;
  }
  #block-editor-modal .pet-ribbon {
    width: 100%;
  }
  /* Cartão flutuante de propriedades: fica acima da folha do editor. */
  #block-editor-modal .petition-block-properties {
    min-width: 190px;
  }
  .petition-block-editor-surface {
    background: #ffffff;
  }
  #petition-block-editor {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    height: 100% !important;
    border: 0 !important;
    border-radius: 0 !important;
    overflow: hidden !important;
    background: #ffffff !important;
  }
  #petition-block-editor > div,
  #petition-block-editor .e-documenteditorcontainer {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    height: 100% !important;
  }
  #petition-block-editor .e-de-tool-ctnr-properties-pane,
  #petition-block-editor .e-de-ctnr-properties-pane,
  #petition-block-editor .e-de-ribbon-simplified-ctnr-properties-pane,
  #petition-block-editor .e-de-ribbon-classic-ctnr-properties-pane {
    height: 100% !important;
  }
  #petition-block-editor .e-de-ctn {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    height: 100% !important;
    overflow: auto !important;
    background: #ffffff !important;
  }
  #petition-block-editor .e-de-status-bar,
  #petition-block-editor .e-de-ctnr-status-bar,
  #petition-block-editor .e-de-statusbar {
    display: none !important;
  }
  #petition-block-editor [id$="_viewerContainer"],
  #petition-block-editor .e-de-background {
    min-height: 100% !important;
    background: #ffffff !important;
  }
  #petition-block-editor .e-de-page-container {
    width: 100% !important;
    min-width: 0 !important;
    display: flex !important;
    justify-content: center !important;
    align-items: flex-start !important;
    padding: 0 !important;
    box-sizing: border-box !important;
  }
  #petition-block-editor .e-scrollbar::-webkit-scrollbar {
    height: 8px;
    width: 8px;
  }
  #petition-block-editor .e-scrollbar::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 8px;
  }
  #petition-block-editor .e-scrollbar::-webkit-scrollbar-track {
    background: #f8fafc;
  }
  body.petition-dark #block-editor-modal,
  body.petition-dark #block-editor-modal .petition-block-editor-surface,
  body.petition-dark #petition-block-editor,
  body.petition-dark #petition-block-editor > div,
  body.petition-dark #petition-block-editor .e-documenteditorcontainer,
  body.petition-dark #petition-block-editor .e-de-ctnr,
  body.petition-dark #petition-block-editor .e-de-ctn,
  body.petition-dark #petition-block-editor [id$="_viewerContainer"],
  body.petition-dark #petition-block-editor .e-de-background,
  body.petition-dark #petition-block-editor .e-de-page-container {
    background: #252525 !important;
    background-color: #252525 !important;
  }
  body.petition-dark #block-editor-modal .petition-block-properties {
    background: #2b2b2b !important;
    border-color: #3d3d3d !important;
  }
  body.petition-dark #block-editor-modal .petition-block-properties label {
    color: #c8ccd3 !important;
  }
  body.petition-dark #block-editor-modal .petition-block-properties select,
  body.petition-dark #block-editor-modal .petition-block-properties input {
    background-color: #333333 !important;
    border-color: #4a4a4a !important;
    color: #eef2f7 !important;
  }
  body.petition-dark #block-editor-modal .petition-block-tag {
    background-color: #333333 !important;
    border-color: #4a4a4a !important;
    color: #d6dbe3 !important;
  }
  body.petition-dark #block-editor-modal .petition-block-properties span {
    color: #d6dbe3;
  }
  body.petition-dark #block-editor-modal .petition-block-properties > button:hover {
    background-color: #333333 !important;
  }
  body.petition-dark #block-editor-modal .petition-block-properties [class*="border-slate-100"] {
    border-color: #3d3d3d !important;
  }
`;

if (typeof document !== 'undefined') {
  let style = document.getElementById('petition-block-editor-styles');
  if (!style) {
    style = document.createElement('style');
    style.id = 'petition-block-editor-styles';
    document.head.appendChild(style);
  }
  style.innerHTML = blockEditorModalStyles;
}

export default PetitionEditorModule;
