// Syncfusion Document Editor Component
// Wrapper para o DocumentEditorContainerComponent com funcionalidades de petição

import React, { useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import type { MenuItemModel } from '@syncfusion/ej2-navigations';
import { L10n, registerLicense, setCulture } from '@syncfusion/ej2-base';
import * as EJ2_PT_LOCALE from '@syncfusion/ej2-locale/src/pt.json';
import {
  DocumentEditorContainerComponent,
  DocumentEditor,
  Toolbar,
  CollaborativeEditingHandler,
} from '@syncfusion/ej2-react-documenteditor';
import '../styles/syncfusion-editor.css';
import {
  getCachedSuggestions,
  setCachedSuggestions,
  pruneExpiredEntries,
} from './spell-check-cache';
import { attachLocalSpellChecker } from './local-spell-checker';
import { syncCollabCaretFlags, type CaretFlagPeer } from './collabCaretFlags';
import {
  curateSpellingSuggestions,
  hasHighConfidenceCorrection,
  replaceSpellingWordInRange,
  type ContextualSentenceSpellingIssue,
} from './spelling-suggestions';
import {
  collectSuspectWords,
  evaluateContextGate,
  registerProofTokens,
} from '../services/proofContextBudget';
import { resetSyncfusionHistoryAfterDocumentLoad } from '../utils/syncfusionHistory';
import { aiService } from '../services/ai.service';
import { supabase } from '../config/supabase';
import {
  collabApiUrl,
  collabLog,
  CollabSaveConflictError,
  connectToCollabRoom,
  currentAccessToken,
  fetchMissedActions,
  flushCollabRoom,
  importCollabDocument,
  isCollabEnabled,
  renewAccessToken,
  roomNameForPath,
  type CollabConnection,
  type CollabPeer,
  type CollabSaveOutcome,
  type CollabStatus,
} from '../services/syncfusionCollab.service';

// Prune entradas expiradas na inicialização do módulo
pruneExpiredEntries();

const syncfusionLicenseKey = String(import.meta.env.VITE_SYNCFUSION_LICENSE_KEY || '').trim();
if (syncfusionLicenseKey) {
  registerLicense(syncfusionLicenseKey);
}

// Inject required modules
DocumentEditorContainerComponent.Inject(Toolbar);

// CO-EDIÇÃO — a injeção tem de acontecer AQUI, no carregamento do módulo.
//
// O EJ2 só cria os módulos em `dataBind()`, e `dataBind()` é agendado com
// `setImmediate` quando uma propriedade muda. Fazendo
// `DocumentEditor.Inject(...)` + `enableCollaborativeEditing = true` e lendo
// `collaborativeEditingHandlerModule` na linha seguinte (era o que o código
// fazia), o módulo AINDA NÃO EXISTE: a co-edição estourava logo na abertura do
// documento. Injetando no topo, basta ligar a propriedade e chamar `dataBind()`
// à mão para o módulo nascer na hora — ver `startCollaboration`.
DocumentEditor.Inject(CollaborativeEditingHandler);

const PT_BR_LOCALE: any = (EJ2_PT_LOCALE as any).default || EJ2_PT_LOCALE;
L10n.load({ 'pt-BR': PT_BR_LOCALE });
setCulture('pt-BR');

// Toolbar items completa similar ao Word
const TOOLBAR_ITEMS = [
  'New',
  'Open',
  'Separator',
  'Undo',
  'Redo',
  'Separator',
  'Image',
  'Table',
  'Hyperlink',
  'Bookmark',
  'TableOfContents',
  'Separator',
  'Header',
  'Footer',
  'PageSetup',
  'PageNumber',
  'Separator',
  'Find',
];

const PROPERTIES_PANE_WIDTH_KEY = 'syncfusion-properties-pane-width-v2';
const DEFAULT_PROPERTIES_PANE_WIDTH = 180;
const MIN_PROPERTIES_PANE_WIDTH = 160;
const MAX_PROPERTIES_PANE_WIDTH = 420;

const PROPERTIES_PANE_PINNED_KEY = 'syncfusion-properties-pane-pinned-v1';
const PROPERTIES_PANE_COLLAPSED_WIDTH = 64;

const normalizeSyncfusionServiceUrl = (value: unknown) => {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  return normalized ? `${normalized}/` : '';
};

const configuredSyncfusionServiceUrl = normalizeSyncfusionServiceUrl(import.meta.env.VITE_SYNC_FUSION);
const supabaseProjectUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const supabaseSyncfusionProxyUrl = supabaseProjectUrl
  ? `${supabaseProjectUrl}/functions/v1/syncfusion-proxy/`
  : '';

// Servidor dedicado de documentos do Jurius (Syncfusion DocumentEditor self-hosted).
// A Edge Function `syncfusion-proxy` apenas repassa para o endpoint público de
// demonstração da Syncfusion, que responde 403 de forma intermitente — por isso
// ela fica como último recurso, e nunca usamos o demo público diretamente.
const DEFAULT_SYNCFUSION_SERVICE_URL = 'https://docs.jurius-api.com/api/documenteditor/';

const SYNCFUSION_SERVICE_URL =
  configuredSyncfusionServiceUrl || DEFAULT_SYNCFUSION_SERVICE_URL || supabaseSyncfusionProxyUrl;

const SYNCFUSION_SUPABASE_API_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

const isSupabaseFunctionsServiceUrl = (value: string) =>
  /\/functions\/v1\/[^/]+\/?$/i.test(String(value || '').trim());

const buildSyncfusionHeaders = (accessToken?: string | null): object[] => {
  const headers: Record<string, string>[] = [];

  if (isSupabaseFunctionsServiceUrl(SYNCFUSION_SERVICE_URL)) {
    if (SYNCFUSION_SUPABASE_API_KEY) {
      headers.push({ apikey: SYNCFUSION_SUPABASE_API_KEY });
    }
    if (accessToken) {
      headers.push({ Authorization: `Bearer ${accessToken}` });
    }
  }

  return headers;
};

const buildDocxImportError = (error: unknown) => {
  const message = String((error as any)?.message || '').toLowerCase();
  const raw = String(error || '');

  if (
    message.includes('cors') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    raw.includes('ERR_FAILED')
  ) {
    return new Error(
      'Não foi possível acessar o servidor dedicado de documentos (CORS/rede). Verifique a disponibilidade do `syncfusion-proxy` ou o endereço configurado em `VITE_SYNC_FUSION`.'
    );
  }

  if (message.includes('504') || message.includes('gateway timeout') || message.includes('timeout')) {
    return new Error(
      'O serviço de conversão DOCX do Syncfusion demorou demais para responder. Tente novamente ou configure `VITE_SYNC_FUSION` com um endpoint próprio mais estável.'
    );
  }

  if (message.includes('404') || raw.includes('404')) {
    return new Error(
      'O servidor dedicado de documentos não foi encontrado. Verifique se a Edge Function `syncfusion-proxy` está publicada ou configure `VITE_SYNC_FUSION` com um endpoint válido.'
    );
  }

  return new Error('Não foi possível importar o arquivo DOCX no editor. Verifique a configuração de `VITE_SYNC_FUSION`.');
};

const forceRulerVisibility = (container: any, show: boolean) => {
  try {
    const host = container?.element as HTMLElement | undefined;
    if (host) host.dataset.codexRulerVisible = show ? '1' : '0';

    const root = (container?.element || container?.containerTarget || container) as ParentNode | null;
    if (!root?.querySelectorAll) return;

    const rulerNodes = root.querySelectorAll<HTMLElement>(
      '.e-de-hruler, .e-de-vruler, .e-ruler, .e-ruler-container, .e-de-ruler'
    );

    rulerNodes.forEach((node) => {
      node.style.display = show ? '' : 'none';
      node.style.visibility = show ? '' : 'hidden';
      node.style.pointerEvents = show ? '' : 'none';
    });
  } catch {
    // ignore
  }
};

const pinHorizontalRulerToViewport = (editor: any): (() => void) | null => {
  try {
    const root = editor?.element as HTMLElement | undefined;
    const helper = editor?.documentHelper as any;
    const viewer = helper?.viewerContainer as HTMLElement | undefined;
    const host = (helper?.optionsPaneContainer || viewer?.parentElement) as HTMLElement | undefined;
    if (!root || !viewer || !host) return null;

    host.classList.add('crm-pinned-ruler-host');

    const pin = () => {
      const selectors = [
        `[id="${editor.element.id}_hRulerBottom"]`,
        `[id="${editor.element.id}_markIndicator"]`,
        `[id="${editor.element.id}_overlapRuler"]`,
      ];

      selectors.forEach((selector) => {
        const node = root.querySelector<HTMLElement>(selector);
        if (!node) return;
        node.classList.add('crm-pinned-horizontal-ruler');
        if (node.parentElement !== host) {
          host.insertBefore(node, viewer);
        }
      });
    };

    pin();
    const observer = new MutationObserver(pin);
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      root.querySelectorAll<HTMLElement>('.crm-pinned-horizontal-ruler').forEach((node) => {
        node.classList.remove('crm-pinned-horizontal-ruler');
        if (node.parentElement === host && viewer.isConnected) {
          viewer.insertBefore(node, viewer.firstChild);
        }
      });
      host.classList.remove('crm-pinned-ruler-host');
    };
  } catch {
    return null;
  }
};

const applySyncfusionServiceUrl = (editor: any) => {
  if (!editor) return;
  try {
    editor.serviceUrl = SYNCFUSION_SERVICE_URL;
  } catch {
    // ignore
  }
};

/* ────────────────────────────────────────────────────────────────
 * Colagem de conteúdo grande vindo de fora
 *
 * Conteúdo COM formatação (Word, RTF, HTML de site) não é convertido aqui: o
 * Syncfusion sobe o conteúdo inteiro para o servidor de documentos e espera o
 * SFDT de volta — com `timeout: 0`, ou seja, SEM prazo nenhum. Enquanto a
 * resposta não chega, ele deixa o spinner de pé por cima do editor. Se a
 * conversão empaca, o spinner fica lá para sempre e o console não registra
 * nada: é exatamente o "editor eternamente carregando" relatado.
 *
 * Medido contra docs.jurius-api.com (20/08/2026):
 *
 *     120 KB → 1,7s | 1 MB → 3,5s | 4 MB → 15s | 12 MB → 200 com corpo VAZIO
 *
 * Acima de poucos MB o servidor deixa de responder direito e, quando responde,
 * o SFDT que volta é grande o bastante para a montagem das páginas (síncrona)
 * pendurar a aba. Daí as duas travas abaixo.
 * ──────────────────────────────────────────────────────────────── */

/** Teto do que vai para o servidor. Acima disto, cola como texto na hora. */
const RICH_PASTE_MAX_BYTES = 2 * 1024 * 1024;

/** Prazo do que foi para o servidor. Vencido, a colagem cai para texto. */
const RICH_PASTE_TIMEOUT_MS = 30_000;

const formatMegabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;

/**
 * Baixa o spinner do Syncfusion à força.
 *
 * Cinto e suspensório: ao abortarmos o XHR, o próprio `onPasteFailure` da
 * biblioteca chama `hideSpinner`. Isto cobre o caso de o abort não chegar a
 * disparar o `readystatechange` — e é o que garante que a tela SEMPRE volta.
 */
const forceHideEditorSpinner = (editor: any) => {
  try {
    const host: HTMLElement | null = editor?.element ?? null;
    host?.querySelectorAll<HTMLElement>('.e-spinner-pane').forEach((wrap) => {
      wrap.classList.remove('e-spin-show');
      wrap.classList.add('e-spin-hide');
    });
  } catch {
    // ignore
  }
};

const normalizeExternalPastedText = (value: string) =>
  String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\t+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const normalizePastedParagraphs = (value: string) => {
  const normalized = normalizeExternalPastedText(value);
  if (!normalized) return '';

  // Cada quebra de linha vira um parágrafo real (insertText trata '\n' como
  // parágrafo). Não fundir linhas: previsibilidade > heurística de "des-quebrar".
  return normalized
    .split('\n')
    .map((line) => line.trim().replace(/[ ]{2,}/g, ' '))
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
};

const normalizePlainTextOnly = (value: string) =>
  String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

const stripOfficeMarkup = (html: string): string => {
  const raw = String(html || '').trim();
  if (!raw || typeof DOMParser === 'undefined') return raw;

  try {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const body = doc.body;
    if (!body) return raw;

    body.querySelectorAll('script,style,xml,meta,link,o\\:p').forEach((node) => node.remove());

    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
    const comments: Comment[] = [];
    while (walker.nextNode()) comments.push(walker.currentNode as Comment);
    comments.forEach((node) => node.remove());

    body.querySelectorAll<HTMLElement>('*').forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        const attrName = attr.name.toLowerCase();
        if (
          attrName === 'style' ||
          attrName === 'class' ||
          attrName === 'lang' ||
          attrName.startsWith('mso-') ||
          attrName.startsWith('xmlns') ||
          attrName.startsWith('data-')
        ) {
          el.removeAttribute(attr.name);
        }
      });

      if (el.tagName.toLowerCase() === 'span' && !el.attributes.length) {
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
    });

    return body.innerHTML || raw;
  } catch {
    return raw;
  }
};

const extractStructuredTextFromHtml = (html: string): string => {
  const raw = String(html || '').trim();
  if (!raw || typeof DOMParser === 'undefined') return '';

  try {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const body = doc.body;
    if (!body) return '';

    const lines: string[] = [];
    const listStack: Array<{ type: 'ul' | 'ol'; index: number }> = [];

    const appendLine = (value: string, forceBreak = false) => {
      const text = normalizeExternalPastedText(value);
      if (!text) {
        if (forceBreak && lines.length && lines[lines.length - 1] !== '') lines.push('');
        return;
      }
      lines.push(text);
    };

    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || '';
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (tag === 'br') {
        return '\n';
      }

      if (tag === 'ul' || tag === 'ol') {
        listStack.push({ type: tag as 'ul' | 'ol', index: 0 });
        Array.from(el.children).forEach((child) => {
          if (child.tagName.toLowerCase() === 'li') walk(child);
        });
        listStack.pop();
        appendLine('', true);
        return '';
      }

      if (tag === 'li') {
        const currentList = listStack[listStack.length - 1];
        if (currentList?.type === 'ol') currentList.index += 1;
        const prefix = currentList?.type === 'ol' ? `${currentList.index}. ` : '• ';
        const indent = '  '.repeat(Math.max(0, listStack.length - 1));

        const childText: string = Array.from(el.childNodes)
          .map((child) => walk(child))
          .join('')
          .replace(/\n+/g, ' ')
          .replace(/[ ]{2,}/g, ' ')
          .trim();

        appendLine(`${indent}${prefix}${childText}`);

        Array.from(el.children).forEach((child) => {
          const childTag = child.tagName.toLowerCase();
          if (childTag === 'ul' || childTag === 'ol') walk(child);
        });
        return '';
      }

      const childText: string = Array.from(el.childNodes).map((child) => walk(child)).join('');
      if (['p', 'div', 'section', 'article', 'header', 'footer', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
        appendLine(childText, true);
        return '';
      }

      if (tag === 'table') {
        Array.from(el.querySelectorAll('tr')).forEach((row) => {
          const cols = Array.from(row.querySelectorAll('th,td'))
            .map((cell) => normalizeExternalPastedText(cell.textContent || ''))
            .filter(Boolean);
          appendLine(cols.join(' | '));
        });
        appendLine('', true);
        return '';
      }

      return childText;
    };

    Array.from(body.childNodes).forEach((child) => {
      const text = walk(child);
      if (text) appendLine(text, true);
    });

    return normalizePastedParagraphs(lines.join('\n'));
  } catch {
    return '';
  }
};

/* ────────────────────────────────────────────────────────────────
 * Sugestão de ortografia com contexto de frase (IA)
 *
 * Estado de módulo (e não do componente) porque quem consome é o patch do
 * context menu, que também vive no módulo.
 * ──────────────────────────────────────────────────────────────── */

/** Silêncio depois da última tecla antes de olhar o trecho do cursor. */
const SENTENCE_ANALYSIS_IDLE_MS = 900;
const SENTENCE_ANALYSIS_TIMEOUT_MS = 8_000;
/** Teto de espera do tempo ocioso: em digitação contínua, não fica para depois. */
const IDLE_WORK_TIMEOUT_MS = 1_200;

/**
 * Fila de tempo ocioso do editor.
 *
 * Tudo que envolve percorrer parágrafo, buscar no documento ou injetar
 * sublinhado passa por aqui: assim o trabalho cai entre os frames, e a
 * digitação nunca espera por ele. Onde não existe `requestIdleCallback`
 * (Safari antigo), um timeout curto cumpre o mesmo papel.
 */
const scheduleIdleWork = (work: () => void): number => {
  const idle = (window as any).requestIdleCallback;
  if (typeof idle === 'function') {
    return idle(() => work(), { timeout: IDLE_WORK_TIMEOUT_MS }) as number;
  }
  return window.setTimeout(work, 60);
};

const cancelIdleWork = (handle: number | null): void => {
  if (handle === null) return;
  const cancel = (window as any).cancelIdleCallback;
  if (typeof cancel === 'function') {
    cancel(handle);
    return;
  }
  window.clearTimeout(handle);
};

/** Identidade da análise aberta agora — evita injetar resposta atrasada. */
let activeSpellRequestId = 0;
let activeSpellAbortController: AbortController | null = null;

/**
 * Tudo o que o filtro de ortografia mexeu no DOM do menu de contexto na
 * ABERTURA ANTERIOR — para desfazer antes que a próxima comece a se montar.
 *
 * O Syncfusion reaproveita os MESMOS elementos entre uma abertura e outra, e só
 * recalcula o `display` dos itens NATIVOS. Duas marcas nossas ficavam para trás:
 *
 *   • os itens do CRM ("Inserir bloco...", "Adicionar bloco...", "Buscar
 *     empresa...", "Formatar com IA...") e os separadores, escondidos quando o
 *     clique caiu sobre palavra com erro de ortografia, continuavam escondidos
 *     em TODOS os cliques seguintes — o menu perdia as opções de bloco;
 *
 *   • o `position: fixed` que usamos para reposicionar o menu sobrevivia no
 *     wrapper, e aí o Syncfusion escrevia coordenadas de DOCUMENTO num elemento
 *     posicionado pelo VIEWPORT: com a petição rolada para baixo, o menu abria
 *     fora da tela — o clique direito parecia simplesmente não fazer nada.
 *
 * Por isso o desfazer roda no início de `onContextMenuInternal`, ANTES de
 * `showContextMenuOnSel`: assim o Syncfusion recalcula os itens nativos por
 * cima do estado limpo, e o que ele não gerencia volta ao que era.
 */
const spellMenuMutations: {
  items: { el: HTMLElement; display: string }[];
  wrappers: { el: HTMLElement; position: string; top: string; left: string }[];
} = { items: [], wrappers: [] };

/** Guarda o estado atual do elemento antes da primeira alteração desta abertura. */
function rememberSpellMenuItem(el: HTMLElement): void {
  if (spellMenuMutations.items.some((entry) => entry.el === el)) return;
  spellMenuMutations.items.push({ el, display: el.style.display });
}

function rememberSpellMenuWrapper(el: HTMLElement): void {
  if (spellMenuMutations.wrappers.some((entry) => entry.el === el)) return;
  spellMenuMutations.wrappers.push({
    el,
    position: el.style.position,
    top: el.style.top,
    left: el.style.left,
  });
}

/** Devolve o menu ao estado anterior ao filtro. Idempotente. */
function restoreSpellMenuMutations(): void {
  // As sugestões injetadas são <li> nossos, criados à mão dentro do <ul> que o
  // Syncfusion reaproveita. Só eram removidos quando havia uma injeção NOVA —
  // então, depois de um clique sobre palavra errada, a correção de outra palavra
  // continuava no topo de todos os menus seguintes, pronta para ser clicada.
  document
    .querySelectorAll('[data-spell-suggestion]')
    .forEach((el) => el.remove());

  spellMenuMutations.items.forEach(({ el, display }) => { el.style.display = display; });
  spellMenuMutations.wrappers.forEach(({ el, position, top, left }) => {
    el.style.position = position;
    el.style.top = top;
    el.style.left = left;
  });
  spellMenuMutations.items = [];
  spellMenuMutations.wrappers = [];
}

/** Cache por palavra+frase: reabrir o menu não gasta tokens de novo. */
const contextSuggestionCache = new Map<string, string[]>();
const contextSuggestionPending = new Map<string, Promise<string[]>>();
const contextualSentenceIssueCache = new Map<string, ContextualSentenceSpellingIssue[]>();

type InjectedContextualError = {
  word: string;
  span: any;
  hostElement: any;
  ownsErrorWordEntry: boolean;
};
const injectedContextualErrors = new WeakMap<any, InjectedContextualError[]>();

const contextSuggestionKey = (word: string, sentence: string): string =>
  `${word.toLocaleLowerCase('pt-BR')}::${sentence}`;

const contextualSentenceKey = (sentence: string): string =>
  sentence.replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');

/**
 * Deduplica a chamada por palavra+frase: dois cliques no mesmo erro (ou o menu
 * reaberto) reaproveitam a resposta em vez de gerar uma nova cobrança.
 */
function getOrStartContextSuggestion(params: {
  word: string;
  sentence: string;
  candidates: Promise<string[]> | string[];
  signal?: AbortSignal;
}): Promise<string[]> {
  const key = contextSuggestionKey(params.word, params.sentence);
  if (contextSuggestionCache.has(key)) {
    return Promise.resolve(contextSuggestionCache.get(key) || []);
  }

  const pending = contextSuggestionPending.get(key);
  if (pending) return pending;

  const request = Promise.resolve(params.candidates)
    .then((candidates) => aiService.suggestSpellingInContext({
      word: params.word,
      sentence: params.sentence,
      candidates,
      signal: params.signal,
    }))
    .then((suggestions) => {
      contextSuggestionCache.set(key, suggestions);
      return suggestions;
    })
    .finally(() => {
      contextSuggestionPending.delete(key);
    });

  contextSuggestionPending.set(key, request);
  return request;
}

/** Extrai texto inclusive quando o parágrafo está quebrado entre páginas. */
function paragraphTextOfWidget(paragraph: any): string {
  if (!paragraph) return '';

  const splitWidgets = typeof paragraph.getSplitWidgets === 'function'
    ? paragraph.getSplitWidgets()
    : [paragraph];
  const widgets = Array.isArray(splitWidgets) && splitWidgets.length ? splitWidgets : [paragraph];
  const visited = new Set<any>();
  let text = '';
  for (const widget of widgets) {
    if (!widget || visited.has(widget)) continue;
    visited.add(widget);
    for (const line of widget.childWidgets || []) {
      for (const child of line?.children || []) {
        // ListTextElementBox usa `listLevel`, inclusive 0. O teste antigo com
        // `!child.listLevel` deixava o marcador da lista vazar para a frase.
        if (typeof child?.text === 'string' && !('listLevel' in child)) {
          text += child.text;
        }
      }
    }
  }
  return text.replace(/[\u0000-\u001F]/g, '').replace(/\u00A0/g, ' ');
}

function isSameLogicalParagraph(left: any, right: any): boolean {
  if (!left || !right) return false;
  if (left === right) return true;

  const leftWidgets = typeof left.getSplitWidgets === 'function'
    ? left.getSplitWidgets()
    : [left];
  return Array.isArray(leftWidgets) && leftWidgets.includes(right);
}

/**
 * O ErrorTextElementBox é o caminho ideal. Os demais candidatos cobrem
 * versões/estados do Syncfusion em que `findCurretText()` devolve só o texto.
 */
function paragraphTextForSpellInfo(editor: any, info: any): string {
  const candidates = [
    info?.element?.line?.paragraph,
    editor?.selectionModule?.start?.paragraph,
    editor?.documentHelper?.selection?.start?.paragraph,
    editor?.selection?.start?.paragraph,
  ];

  for (const paragraph of candidates) {
    const text = paragraphTextOfWidget(paragraph);
    if (text.trim()) return text;
  }
  return '';
}

function sentenceAroundPosition(paragraph: string, rawPosition: number): string {
  if (!paragraph.trim()) return '';

  const position = Math.min(Math.max(Number(rawPosition) || 0, 0), paragraph.length);
  const before = paragraph.slice(0, position);
  let start = 0;
  // Para achar o INÍCIO, pontuação só vira limite quando já há espaço depois.
  // Assim o "?" final da frase, com o cursor logo após ele, não recorta tudo.
  const boundaryPattern = /[.!?;]\s+/g;
  let boundary: RegExpExecArray | null;
  while ((boundary = boundaryPattern.exec(before)) !== null) {
    start = boundary.index + boundary[0].length;
  }

  const after = paragraph.slice(position);
  const endBoundary = after.match(/[.!?;](?=\s|$)/);
  const end = endBoundary?.index !== undefined
    ? position + endBoundary.index + 1
    : paragraph.length;

  return paragraph.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 600);
}

/** Recorta a frase em volta da palavra errada (contexto enviado à IA). */
function getSentenceForSpellInfo(editor: any, info: any, word: string): string {
  const paragraph = paragraphTextForSpellInfo(editor, info);
  if (!paragraph) return '';

  const rawOffset = Number(
    info?.element?.start?.offset
    ?? info?.start?.offset
    ?? editor?.documentHelper?.selection?.start?.offset
    ?? 0,
  );
  const normalizedParagraph = paragraph.toLocaleLowerCase('pt-BR');
  const normalizedWord = String(word || '').toLocaleLowerCase('pt-BR');
  const occurrences: number[] = [];
  let searchFrom = 0;
  while (normalizedWord && searchFrom < normalizedParagraph.length) {
    const index = normalizedParagraph.indexOf(normalizedWord, searchFrom);
    if (index < 0) break;
    occurrences.push(index);
    searchFrom = index + Math.max(normalizedWord.length, 1);
  }

  const position = occurrences.length
    ? occurrences.reduce((closest, index) => (
      Math.abs(index - rawOffset) < Math.abs(closest - rawOffset) ? index : closest
    ))
    : rawOffset;
  return sentenceAroundPosition(paragraph, position);
}

function getCurrentSentenceForAnalysis(editor: any): string {
  const paragraph = paragraphTextForSpellInfo(editor, null);
  if (!paragraph) return '';
  const offset = Number(
    editor?.documentHelper?.selection?.start?.offset
    ?? editor?.selectionModule?.start?.offset
    ?? 0,
  );
  return sentenceAroundPosition(paragraph, offset);
}

function clearInjectedContextualErrors(editor: any, shouldRelayout = true): void {
  const entries = injectedContextualErrors.get(editor) || [];
  if (entries.length === 0) return;

  const spellChecker = editor?.spellCheckerModule ?? editor?.spellChecker;
  for (const entry of entries) {
    const hostErrors = entry.hostElement?.errorCollection;
    if (Array.isArray(hostErrors)) {
      const hostIndex = hostErrors.indexOf(entry.span);
      if (hostIndex >= 0) hostErrors.splice(hostIndex, 1);
    }

    const collection = spellChecker?.errorWordCollection;
    const elements = collection?.containsKey?.(entry.word)
      ? collection.get(entry.word)
      : null;
    if (Array.isArray(elements)) {
      const collectionIndex = elements.indexOf(entry.span);
      if (collectionIndex >= 0) elements.splice(collectionIndex, 1);
      if (entry.ownsErrorWordEntry && elements.length === 0) {
        collection.remove?.(entry.word);
      }
    }
  }

  injectedContextualErrors.delete(editor);
  if (shouldRelayout) {
    try { editor?.editor?.reLayout?.(editor?.selection); } catch { /* visual fallback: badge */ }
  }
}

function findSearchResultInParagraph(editor: any, text: string, paragraph: any): {
  result: any;
  hostElement: any;
} | null {
  const search = editor?.searchModule ?? editor?.search;
  const results = search?.searchResults;
  if (!search || !results || typeof search.findAll !== 'function' || !text) return null;

  try {
    results.clear?.();
    search.findAll(text, 'CaseSensitive');
    const innerList = Array.from(results.innerList || []) as any[];
    const result = innerList.find((candidate) => {
      const candidateParagraph = candidate?.start?.currentWidget?.paragraph;
      return isSameLogicalParagraph(candidateParagraph, paragraph);
    });
    if (!result) return null;
    const inline = result.start?.currentWidget?.getInline?.(result.start.offset, 0);
    return { result, hostElement: inline?.element };
  } catch {
    return null;
  } finally {
    try { results.clear?.(); } catch { /* ignore */ }
  }
}

/**
 * Converte em ErrorTextElementBox os erros que só a leitura do contexto pega.
 * A palavra recebe o mesmo sublinhado vermelho e o mesmo menu do corretor
 * nativo — para quem está escrevendo, é o corretor de sempre.
 *
 * Palavra que o dicionário JÁ sublinhou não é injetada de novo: a correção fica
 * no cache e aparece no menu daquele sublinhado, sem risco de linha dupla.
 */
function injectContextualSentenceErrors(
  editor: any,
  sentence: string,
  issues: ContextualSentenceSpellingIssue[],
): number {
  clearInjectedContextualErrors(editor, false);

  const spellChecker = editor?.spellCheckerModule ?? editor?.spellChecker;
  const paragraph = editor?.documentHelper?.selection?.start?.paragraph;
  const injected: InjectedContextualError[] = [];

  for (const issue of issues) {
    contextSuggestionCache.set(contextSuggestionKey(issue.bad, sentence), [issue.good]);
    if (
      !spellChecker
      || typeof spellChecker.createErrorElementWithInfo !== 'function'
      || typeof spellChecker.addErrorCollection !== 'function'
    ) continue;

    const alreadyMarked = typeof spellChecker.manageSpecialCharacters === 'function'
      ? spellChecker.manageSpecialCharacters(issue.bad, undefined, true)
      : issue.bad;
    if (spellChecker.errorWordCollection?.containsKey?.(alreadyMarked)) continue;

    const match = findSearchResultInParagraph(editor, issue.bad, paragraph);
    if (!match?.hostElement) continue;

    try {
      const span = spellChecker.createErrorElementWithInfo(match.result, match.hostElement);
      if (!span?.start || !span?.end) continue;

      if (!Array.isArray(match.hostElement.errorCollection)) {
        match.hostElement.errorCollection = [];
      }
      if (!match.hostElement.errorCollection.includes(span)) {
        match.hostElement.errorCollection.push(span);
      }

      const word = typeof spellChecker.manageSpecialCharacters === 'function'
        ? spellChecker.manageSpecialCharacters(span.text, undefined, true)
        : issue.bad;
      const ownsErrorWordEntry = !spellChecker.errorWordCollection?.containsKey?.(word);
      spellChecker.addErrorCollection(word, span, [issue.good]);
      injected.push({ word, span, hostElement: match.hostElement, ownsErrorWordEntry });
    } catch {
      // Sem sublinhado, a correção ainda chega pelo menu (cache acima).
    }
  }

  // Relayout só quando existe sublinhado novo para pintar: repintar a página
  // sem motivo é exatamente o tipo de trabalho que o usuário sente como travada.
  if (injected.length > 0) {
    injectedContextualErrors.set(editor, injected);
    try { editor?.editor?.reLayout?.(editor?.selection); } catch { /* ignore */ }
  }
  return injected.length;
}

/**
 * Revalida a ortografia do documento inteiro.
 *
 * Necessário depois de QUALQUER troca de texto feita por código (correções do
 * painel de revisão). O Syncfusion guarda o resultado do check por página em
 * `uniqueSpelledWords` + `cachedPages` e só reabre esse portão no carregamento
 * ou na rolagem: sem isto, a palavra corrigida continua sublinhada e a palavra
 * NOVA (inclusive uma que tenha ficado errada) nunca é verificada.
 *
 * O que o usuário mandou ignorar continua ignorado — `ignoreAllItems` é
 * preservado de propósito.
 */
function rescanSpelling(editor: any): void {
  const documentHelper = editor?.documentHelper;
  const spellChecker = editor?.spellChecker ?? editor?.spellCheckerModule;
  if (!documentHelper || !spellChecker || !editor.isSpellCheck) return;

  try {
    spellChecker.errorWordCollection?.clear?.();
    spellChecker.uniqueWordsCollection?.clear?.();
    spellChecker.uniqueSpelledWords = {};
    documentHelper.cachedPages = [];

    for (const page of documentHelper.pages || []) {
      for (const body of page?.bodyWidgets || []) {
        for (const block of body?.childWidgets || []) {
          for (const line of block?.childWidgets || []) {
            for (const element of line?.children || []) {
              if (typeof element?.text !== 'string') continue;
              element.isSpellChecked = false;
              element.isSpellCheckTriggered = false;
              element.canTrigger = true;
              element.istextCombined = false;
            }
          }
        }
      }
    }

    // `triggerElementsOnLoading` é o portão do check por página; sem ele o
    // repaint acontece e o corretor simplesmente não roda.
    documentHelper.triggerElementsOnLoading = true;
    documentHelper.triggerSpellCheck = true;
    editor.editor?.reLayout?.(editor.selection);

    window.setTimeout(() => {
      documentHelper.triggerElementsOnLoading = false;
      documentHelper.triggerSpellCheck = false;
    }, 1500);
  } catch (err) {
    console.warn('[SyncfusionEditor] rescanSpelling erro:', err);
  }
}

/**
 * Localiza, seleciona e rola até a N-ésima ocorrência EXATA de um trecho.
 *
 * Base da revisão de texto: o painel guarda uma janela de contexto + o índice
 * da ocorrência, e a substituição usa o próprio SearchResults do Syncfusion —
 * que troca o texto preservando a formatação do parágrafo.
 *
 * Busca sempre com diferenciação de maiúsculas: correção gramatical depende da
 * caixa ("Os autor" no início da frase não é "os autor" no meio dela).
 */
function focusSearchOccurrence(editor: any, searchText: string, occurrence: number): any | null {
  const value = String(searchText || '');
  if (!editor || !value.trim()) return null;

  const search: any = editor.search ?? editor.searchModule;
  const results: any = search?.searchResults;
  if (!results || typeof search.findAll !== 'function') return null;

  try {
    results.clear?.();
    search.findAll(value, 'CaseSensitive');
    const count = Number(results.length || 0);
    if (count === 0) return null;

    // O documento pode ter mudado desde a revisão: com menos ocorrências do
    // que o esperado, cai na última — melhor que não achar nada.
    const index = Math.min(Math.max(Number(occurrence) || 0, 0), count - 1);
    results.index = index; // o setter navega e destaca
    return results;
  } catch (err) {
    console.warn('[SyncfusionEditor] focusSearchOccurrence erro:', err);
    return null;
  }
}

/** Compara offsets do Syncfusion ("secao;bloco;posicao") na ordem do documento. */
function compareEditorOffsets(a: string, b: string): number {
  const left = String(a || '').split(';').map((part) => Number(part) || 0);
  const right = String(b || '').split(';').map((part) => Number(part) || 0);
  const size = Math.max(left.length, right.length);
  for (let i = 0; i < size; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const normalizeForAnchor = (value: string): string =>
  String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Todas as ocorrências de um trecho, como pares de offsets.
 *
 * Base da remoção por intervalo: a busca do editor não atravessa marca de
 * parágrafo, mas `selection.select(inicio, fim)` atravessa. Localizamos as duas
 * pontas separadamente e selecionamos tudo que houver entre elas.
 */
function collectOccurrenceOffsets(editor: any, value: string, limit = 60): Array<{ start: string; end: string }> {
  const search: any = editor?.search ?? editor?.searchModule;
  const results: any = search?.searchResults;
  const text = String(value || '');
  if (!search || !results || typeof search.findAll !== 'function' || !text.trim()) return [];

  const findWith = (option: string): number => {
    try {
      results.clear?.();
      search.findAll(text, option);
      return Number(results.length || 0);
    } catch {
      return 0;
    }
  };

  try {
    // Caixa alta importa numa peça ("DOS FATOS" != "dos fatos"); só relaxamos
    // quando a busca exata não acha nada.
    let count = findWith('CaseSensitive');
    if (count === 0) count = findWith('None');
    if (count === 0) return [];

    const offsets: Array<{ start: string; end: string }> = [];
    const total = Math.min(count, limit);
    for (let i = 0; i < total; i++) {
      results.index = i; // o setter navega e move a seleção
      const start = String(editor.selection?.startOffset || '');
      const end = String(editor.selection?.endOffset || '');
      if (start && end) offsets.push({ start, end });
    }
    return offsets;
  } catch {
    return [];
  } finally {
    try { results.clear?.(); } catch { /* ignore */ }
  }
}

/**
 * Junta os parágrafos vazios que sobram no lugar do trecho removido.
 *
 * Apagar um bloco inteiro deixa para trás o parágrafo do bloco E o separador
 * que vinha depois dele — o texto ficaria com um buraco de duas linhas. Cada
 * passo é um "delete para frente", e só acontece enquanto o parágrafo atual
 * estiver realmente vazio, então nunca come conteúdo.
 */
function collapseEmptyParagraphsAtCursor(editor: any, maxSteps = 2): void {
  const editorModule = editor?.editorModule ?? editor?.editor;
  if (typeof editorModule?.delete !== 'function') return;
  for (let step = 0; step < maxSteps; step++) {
    if (!isCurrentParagraphEmpty(editor)) return;
    try { editorModule.delete(); } catch { return; }
  }
}

/** O parágrafo onde o cursor está ficou sem texto? */
function isCurrentParagraphEmpty(editor: any): boolean {
  const selection = editor?.selection;
  if (!selection) return false;
  const cursor = String(selection.startOffset || '');
  try {
    selection.selectParagraph?.();
    const text = String(selection.text || '').replace(/[\u0000-\u001F\u00A0]/g, ' ').trim();
    if (cursor) selection.select(cursor, cursor);
    return text.length === 0;
  } catch {
    try { if (cursor) selection.select(cursor, cursor); } catch { /* ignore */ }
    return false;
  }
}

/**
 * Remove (ou substitui) o intervalo entre duas âncoras de texto.
 *
 * É o mecanismo que faz "remova este bloco duplicado" funcionar: o bloco tem
 * vários parágrafos, então nenhum replaceAll o alcança. Devolve false sem
 * tocar no documento quando as âncoras não delimitam um intervalo coerente —
 * apagar o pedaço errado de uma petição é pior do que não apagar.
 */
function removeEditorRange(
  editor: any,
  startAnchor: string,
  endAnchor: string | undefined,
  options: { replaceWith?: string; occurrence?: 'first' | 'last'; maxChars?: number } = {},
): boolean {
  const selection = editor?.selection;
  const editorModule = editor?.editorModule ?? editor?.editor;
  if (!selection || typeof editorModule?.delete !== 'function') return false;

  const heads = collectOccurrenceOffsets(editor, startAnchor);
  if (!heads.length) return false;
  const head = options.occurrence === 'last' ? heads[heads.length - 1] : heads[0];

  const tailText = String(endAnchor || '').trim();
  let tail = head;
  if (tailText && normalizeForAnchor(tailText) !== normalizeForAnchor(startAnchor)) {
    const tails = collectOccurrenceOffsets(editor, tailText);
    if (!tails.length) return false;
    // Fecha o intervalo na PRIMEIRA ocorrência a partir do início — pegar uma
    // ocorrência posterior arrastaria texto que não faz parte do trecho.
    tail = tails.find((candidate) => compareEditorOffsets(candidate.end, head.end) >= 0) ?? tails[tails.length - 1];
  }

  if (compareEditorOffsets(tail.end, head.start) <= 0) return false;

  const restore = String(selection.startOffset || '');
  try {
    selection.select(head.start, tail.end);
    const covered = String(selection.text || '');
    const normalizedCover = normalizeForAnchor(covered);
    if (!normalizedCover) return false;

    // Conferência das duas pontas: a seleção precisa começar e terminar
    // exatamente onde as âncoras dizem.
    const expectedStart = normalizeForAnchor(startAnchor);
    const expectedEnd = normalizeForAnchor(tailText || startAnchor);
    if (!normalizedCover.startsWith(expectedStart) || !normalizedCover.endsWith(expectedEnd)) {
      if (restore) selection.select(restore, restore);
      return false;
    }
    if (options.maxChars && covered.length > options.maxChars) {
      if (restore) selection.select(restore, restore);
      return false;
    }

    try { editor.editorHistory?.beginUndoAction?.(); } catch { /* ignore */ }
    editorModule.delete();

    const replaceWith = String(options.replaceWith ?? '');
    if (replaceWith) {
      editorModule.insertText(replaceWith);
    } else {
      // Sem isto sobra um buraco de parágrafos vazios no lugar do bloco.
      collapseEmptyParagraphsAtCursor(editor);
    }

    try { editor.editorHistory?.endUndoAction?.(); } catch { /* ignore */ }
    return true;
  } catch (err) {
    console.warn('[SyncfusionEditor] removeEditorRange erro:', err);
    try { editor.editorHistory?.endUndoAction?.(); } catch { /* ignore */ }
    return false;
  }
}

/* ────────────────────────────────────────────────────────────────
 * Patch do context menu: adicionar .catch() no caminho assíncrono
 * de spell-check para evitar que o menu nunca abra quando a
 * chamada ao spell checker falha ou retorna JSON inválido.
 *
 * Syncfusion faz event.preventDefault() ANTES do .then() sem
 * .catch(), então qualquer erro silencia o menu E o browser menu.
 * ──────────────────────────────────────────────────────────────── */
function patchContextMenuForSpellCheck(editor: any): void {
  if (!editor) return;
  const ctxModule = editor.contextMenu;
  const spellChecker = editor.spellCheckerModule ?? editor.spellChecker;
  if (!ctxModule) return;

  if (typeof ctxModule.onContextMenuInternal !== 'function') return;
  // editor.open() pode restaurar onContextMenuInternal na MESMA instância do
  // módulo. Só consideramos o patch válido enquanto o handler instalado ainda
  // for exatamente o handler atual.
  const activePatchedHandler = (ctxModule as any).__spellPatchHandler;
  if (activePatchedHandler && ctxModule.onContextMenuInternal === activePatchedHandler) return;

  /**
   * Substitui o range real do erro, não apenas a palavra solta. O Syncfusion
   * às vezes inclui espaço/pontuação no start/end do ErrorTextElementBox; por
   * isso lemos o range e o reconstruímos antes de inserir.
   */
  const replaceSpellingSelection = (
    info: any,
    word: string,
    suggestion: string,
  ): boolean => {
    const element = info?.element;
    const rangeStart = element?.start ?? info?.start;
    const rangeEnd = element?.end ?? info?.end;
    const documentHelper = editor?.documentHelper;
    const selection = documentHelper?.selection;
    const editorModule = editor?.editorModule ?? editor?.editor;
    if (
      !rangeStart?.clone
      || !rangeEnd?.clone
      || !selection
      || typeof editorModule?.insertTextInternal !== 'function'
    ) return false;

    const start = rangeStart.clone();
    const end = rangeEnd.clone();
    const rangeText = typeof selection.getTextInternal === 'function'
      ? String(selection.getTextInternal(start, end, false) ?? '')
      : String(element?.text ?? info?.text ?? '');
    const replacement = replaceSpellingWordInRange(rangeText, word, suggestion);
    if (replacement === null) return false;

    documentHelper.triggerSpellCheck = true;
    try {
      selection.start = start;
      selection.end = end;
      if (element) spellChecker?.addRemovedElements?.(false, element);
      editorModule.insertTextInternal(replacement, true);
      if (element) spellChecker?.removeErrorsFromCollection?.({ text: word, element });
      selection.start?.setPositionInternal?.(selection.end);
      documentHelper.clearSelectionHighlight?.();
      editorModule.reLayout?.(selection);
      return true;
    } finally {
      documentHelper.triggerSpellCheck = false;
    }
  };

  // Helper: injeta sugestões no DOM do menu já aberto.
  const injectSpellSuggestions = (
    suggestions: string[],
    word: string,
    source: 'ai' | 'dictionary',
  ) => {
    try {
      // Localizar o wrapper do context menu visível
      const wrappers = Array.from(
        document.querySelectorAll<HTMLElement>('.e-de-contextmenu-wrapper, .e-contextmenu-wrapper')
      ).filter((w) => {
        const s = window.getComputedStyle(w);
        return s.display !== 'none' && s.visibility !== 'hidden';
      });
      if (wrappers.length === 0) return;
      const wrapper = wrappers[0];
      const ul = wrapper.querySelector<HTMLElement>('ul.e-menu-parent') || wrapper.querySelector<HTMLElement>('ul');
      if (!ul) return;

      // Remover sugestões antigas se houver
      ul.querySelectorAll('[data-spell-suggestion]').forEach((el) => el.remove());

      // Construir itens de sugestão
      const items: HTMLElement[] = [];
      if (suggestions.length === 0) {
        const li = document.createElement('li');
        li.className = 'e-menu-item e-disabled';
        li.setAttribute('data-spell-suggestion', '1');
        li.setAttribute('data-spell-source', source);
        li.setAttribute('role', 'menuitem');
        li.innerHTML = '<span class="e-menu-icon"></span><span class="e-menu-text" style="font-style:italic;color:#888">Nenhuma sugestão</span>';
        items.push(li);
      } else {
        // O menu é o mesmo para as duas origens: a correção que aparece é a
        // melhor que o editor tem, sem rótulo de procedência.
        suggestions.slice(0, 5).forEach((sug) => {
          const li = document.createElement('li');
          li.className = 'e-menu-item';
          li.setAttribute('data-spell-suggestion', '1');
          li.setAttribute('data-spell-source', source);
          li.setAttribute('role', 'menuitem');
          li.setAttribute('tabindex', '-1');
          const escaped = sug.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
          li.innerHTML = `<span class="e-menu-icon"></span><span class="e-menu-text" style="font-weight:600">${escaped}</span>`;

          // Click: substituir a palavra errada pela sugestão
          li.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            try {
              const info = spellChecker?.currentContextInfo;
              if (!replaceSpellingSelection(info, word, sug)) {
                console.warn(
                  '[SyncfusionEditor] correção cancelada: intervalo da palavra não foi localizado com segurança.',
                );
              }
            } catch (err) {
              console.warn('[SyncfusionEditor] replace word erro:', err);
            }
            // Fechar o menu
            try { ctxModule.contextMenuInstance?.close?.(); } catch { /* ignore */ }
          });

          // Hover highlight
          li.addEventListener('mouseenter', () => li.classList.add('e-focused'));
          li.addEventListener('mouseleave', () => li.classList.remove('e-focused'));
          items.push(li);
        });
      }

      // Adicionar separador
      const sep = document.createElement('li');
      sep.className = 'e-separator e-menu-item';
      sep.setAttribute('data-spell-suggestion', '1');
      items.push(sep);

      // Inserir no topo do ul
      for (let i = items.length - 1; i >= 0; i--) {
        ul.insertBefore(items[i], ul.firstChild);
      }

      void word; // suppress unused warning
    } catch (err) {
      console.warn('[SyncfusionEditor] injectSpellSuggestions erro:', err);
    }
  };

  // Helper: busca sugestões via callSpellChecker, retorna Promise<string[]>
  const fetchSuggestionsFromAPI = (word: string): Promise<string[]> => {
    if (typeof spellChecker?.callSpellChecker !== 'function') {
      return Promise.resolve([]);
    }
    return spellChecker
      .callSpellChecker(spellChecker.languageID, word, false, true, false, false)
      .then((data: string) => {
        try {
          const json = JSON.parse(data);
          return curateSpellingSuggestions(word, (json.Suggestions || []) as string[]);
        } catch {
          return [];
        }
      })
      .catch(() => []);
  };

  /** Busca/hidrata a camada local sem exibi-la antes da análise contextual. */
  const getDictionarySuggestions = async (word: string): Promise<string[]> => {
    const sfCache = spellChecker?.errorSuggestions;
    if (sfCache?.containsKey?.(word)) {
      return curateSpellingSuggestions(word, (sfCache.get(word) || []).slice());
    }

    const cached = getCachedSuggestions(word);
    if (cached !== null) {
      const curated = curateSpellingSuggestions(word, cached);
      try { sfCache?.add?.(word, curated.slice()); } catch { /* ignore */ }
      return curated;
    }

    const suggestions = await fetchSuggestionsFromAPI(word);
    setCachedSuggestions(word, suggestions);
    try { sfCache?.add?.(word, suggestions.slice()); } catch { /* ignore */ }
    return suggestions;
  };

  /**
   * Quando a IA encontrou um falso negativo ainda sem ErrorTextElementBox,
   * captura a palavra sob o cursor e seu range real sem deixar a seleção
   * visualmente alterada.
   */
  const getCurrentWordInfo = (nativeInfo: any): { info: any; word: string } | null => {
    if (nativeInfo?.element && nativeInfo?.text) {
      const nativeWord = typeof spellChecker.manageSpecialCharacters === 'function'
        ? spellChecker.manageSpecialCharacters(nativeInfo.text, undefined, true)
        : String(nativeInfo.text).trim();
      return nativeWord ? { info: nativeInfo, word: nativeWord } : null;
    }

    const selection = editor?.documentHelper?.selection;
    if (!selection?.start?.clone || !selection?.end?.clone || typeof selection.selectCurrentWord !== 'function') {
      return null;
    }

    const originalStart = selection.start.clone();
    const originalEnd = selection.end.clone();
    try {
      selection.isModifyingSelectionInternally = true;
      selection.selectCurrentWord();
      const start = selection.start?.clone?.();
      const end = selection.end?.clone?.();
      const rawText = String(
        selection.text
        ?? selection.getTextInternal?.(start, end, false)
        ?? '',
      );
      const word = typeof spellChecker.manageSpecialCharacters === 'function'
        ? spellChecker.manageSpecialCharacters(rawText, undefined, true)
        : rawText.trim();
      if (!word || !start || !end) return null;
      return { info: { text: rawText, start, end }, word };
    } finally {
      selection.start = originalStart;
      selection.end = originalEnd;
      selection.isModifyingSelectionInternally = false;
    }
  };

  /**
   * Monta as sugestões do menu do botão direito.
   *
   * Sequência pensada para parecer com o Word: o menu abre com as sugestões
   * LOCAIS na hora (sem spinner, sem espera). Se o editor já tiver o veredicto
   * contextual daquela frase — normalmente tem, porque a revisão rodou durante
   * a pausa da digitação — ele substitui a lista silenciosamente. A chamada de
   * modelo no próprio clique só acontece quando o dicionário não tem resposta.
   */
  const tryFetchSpellSuggestions = () => {
    const requestId = ++activeSpellRequestId;
    activeSpellAbortController?.abort();
    activeSpellAbortController = null;

    try {
      if (!spellChecker || !editor.isSpellCheck) return;
      if (!spellChecker.allowSpellCheckAndSuggestion) return;

      const nativeInfo = typeof spellChecker.findCurretText === 'function' ? spellChecker.findCurretText() : null;
      const currentWord = getCurrentWordInfo(nativeInfo);
      if (!currentWord) return;
      const { info, word } = currentWord;
      const sentence = getSentenceForSpellInfo(editor, info, word);
      const contextualIssue = (
        contextualSentenceIssueCache.get(contextualSentenceKey(sentence)) || []
      ).find((issue) => (
        issue.bad.toLocaleLowerCase('pt-BR') === word.toLocaleLowerCase('pt-BR')
      ));

      const errorColl = spellChecker.errorWordCollection;
      const isDictionaryError = Boolean(
        errorColl
        && typeof errorColl.containsKey === 'function'
        && errorColl.containsKey(word),
      );
      // Palavra que só a análise de contexto reprovou também abre sugestão.
      if (!isDictionaryError && !contextualIssue) return;

      spellChecker.currentContextInfo = info;

      // 1. Já sabemos a correção certa para esta palavra nesta frase: aplica na
      //    hora, sem consultar nada.
      const cacheKey = contextSuggestionKey(word, sentence);
      if (contextualIssue) {
        contextSuggestionCache.set(cacheKey, [contextualIssue.good]);
        injectSpellSuggestions([contextualIssue.good], word, 'ai');
        return;
      }
      if (contextSuggestionCache.has(cacheKey)) {
        injectSpellSuggestions(contextSuggestionCache.get(cacheKey) || [], word, 'ai');
        return;
      }

      // 2. Dicionário local: instantâneo, é o que o menu mostra de imediato.
      void getDictionarySuggestions(word).then((dictionary) => {
        if (requestId !== activeSpellRequestId) return;
        injectSpellSuggestions(dictionary, word, 'dictionary');

        // 3. Só quando o dicionário não resolve é que vale gastar uma chamada:
        //    o resultado troca a lista sem qualquer aviso na tela.
        if (dictionary.length > 0 || !aiService.isEnabled()) return;

        const verdict = evaluateContextGate({
          sentence,
          suspects: [word],
          isResolvedLocally: hasHighConfidenceCorrection,
        });
        if (!verdict.allow) return;

        registerProofTokens(verdict.estimatedTokens);
        const controller = new AbortController();
        activeSpellAbortController = controller;
        const timeoutId = window.setTimeout(() => controller.abort(), SENTENCE_ANALYSIS_TIMEOUT_MS);

        void getOrStartContextSuggestion({
          word,
          sentence: verdict.context,
          candidates: dictionary,
          signal: controller.signal,
        }).then((suggestions) => {
          if (requestId !== activeSpellRequestId || suggestions.length === 0) return;
          contextSuggestionCache.set(cacheKey, suggestions);
          injectSpellSuggestions(suggestions, word, 'ai');
        }).catch(() => {
          // O menu já está exibindo o que o dicionário tinha.
        }).finally(() => {
          window.clearTimeout(timeoutId);
          if (activeSpellAbortController === controller) activeSpellAbortController = null;
        });
      });
    } catch (err) {
      console.warn('[SyncfusionEditor] tryFetchSpellSuggestions erro:', err);
    }
  };

  const patchedOnContextMenu = function patchedOnContextMenu(event: any) {
    try {
      // 0) Desfaz o filtro da abertura anterior. Tem de vir ANTES de
      //    showContextMenuOnSel: ele recalcula os itens nativos, e o que ele não
      //    gerencia (itens do CRM, separadores, posição do wrapper) só volta ao
      //    normal aqui. Sem isto, um clique sobre palavra com erro deixava o
      //    menu mutilado — e mal posicionado — em todos os cliques seguintes.
      restoreSpellMenuMutations();

      // 1) Abrir o menu normal IMEDIATAMENTE (sem esperar spell check)
      if (typeof ctxModule.hideSpellContextItems === 'function') {
        ctxModule.hideSpellContextItems();
      }
      if (typeof ctxModule.showContextMenuOnSel === 'function') {
        ctxModule.showContextMenuOnSel(event);
      } else {
        const isTouch = !(event instanceof MouseEvent);
        let xPos = 0;
        let yPos = 0;
        if (isTouch) {
          const point = ctxModule.documentHelper?.getTouchOffsetValue?.(event);
          xPos = point?.x ?? 0;
          yPos = point?.y ?? 0;
        } else {
          yPos = (event.clientY ?? event.y ?? 0) + document.body.scrollTop + document.documentElement.scrollTop;
          xPos = (event.clientX ?? event.x ?? 0) + document.body.scrollLeft + document.documentElement.scrollLeft;
        }
        ctxModule.contextMenuInstance?.open?.(yPos, xPos);
      }
      event.preventDefault?.();

      // 2) Async: buscar e injetar sugestões de spell-check no menu já aberto
      tryFetchSpellSuggestions();
    } catch (err) {
      console.warn('[SyncfusionEditor] onContextMenuInternal erro:', err);
    }
  };
  ctxModule.onContextMenuInternal = patchedOnContextMenu;
  (ctxModule as any).__spellPatchHandler = patchedOnContextMenu;
}

/* ────────────────────────────────────────────────────────────────
 * Patch do ruler do Syncfusion para mostrar valores em CENTÍMETROS
 *
 * O Syncfusion desenha o ruler com incrementos de 36 pt (= 0,5 inch
 * = ~1,27 cm). A gente intercepta `updateSegment` do protótipo da
 * classe Ruler para:
 *   1. Usar incremento de 28,3464 pt (= exatamente 1 cm)
 *   2. Mostrar o label dividido por 28,3464 (= valor em cm inteiro)
 *
 * Também sobrescreve `segmentWidth` em pixels para que cada segmento
 * desenhado equivalha a 1 cm visualmente.
 * ──────────────────────────────────────────────────────────────── */
const PT_PER_CM = 28.3464566929;
const PX_PER_PT = 96 / 72; // 1.3333... (96 DPI padrão)
const CM_IN_PX = PT_PER_CM * PX_PER_PT; // ~37.795 px = 1 cm

function patchRulerForCentimeters(editor: any): void {
  if (!editor) return;
  const rulers = [editor.hRuler, editor.vRuler].filter(Boolean);
  if (rulers.length === 0) return;

  for (const ruler of rulers) {
    // segmentWidth do Syncfusion está em PIXELS (padrão: 47.9988 px ≈ 0,5 polegada).
    // Mudamos para CM_IN_PX (≈ 37.795 px) para que cada segmento = exatamente 1 cm.
    try { ruler.segmentWidth = CM_IN_PX; } catch { /* ignore */ }

    const proto = Object.getPrototypeOf(ruler);
    if (!proto || (proto as any).__crmCmPatched) continue;

    // ── Substitui updateSegment com fórmula direta em pixels ──
    //
    // Problema anterior: as abordagens com rulerStartValue acumulavam erro de ponto
    // flutuante (1584 pt / 28,3464 pt/cm = 55,88 — não inteiro → oscilação).
    //
    // SOLUÇÃO: usar this.zeroPosition (px) — propriedade que o próprio Syncfusion
    // mantém atualizada em cada redraw com a posição em pixels do início do conteúdo.
    //
    //   cm = Math.round((run - this.zeroPosition) / CM_IN_PX)
    //   cm > 0  → mostrar (conteúdo da página)
    //   cm <= 0 → ocultar (área cinza + margem esquerda)
    //
    // run e zeroPosition estão no mesmo sistema de coordenadas do ruler (pixels).
    // Não há aritmética acumulada → impossível oscilar.
    (proto as any).updateSegment = function (
      start: number,
      _end: number,
      rulerSegment: any,
      run: number,
      trans: any,
      rulerSize: number
    ) {
      const segWidth = this.updateSegmentWidth(this.scale); // = CM_IN_PX

      if (run === start) {
        // ── 1.º segmento de cada passagem ──
        const cmFirst = Math.round((run - this.zeroPosition) / CM_IN_PX);
        rulerSegment.label.textContent = cmFirst > 0 ? cmFirst.toString() : '';

        this.startValue = (Math.floor(start / segWidth) * segWidth) / this.scale;
        this.startValue =
          this.startValue % 1 !== 0 ? Number(this.startValue.toFixed(1)) : this.startValue;
        this.defStartValue = run = this.startValue * this.scale;
        if (this.orientation === 'Horizontal') {
          this.hRulerOffset = start - run;
        } else {
          this.vRulerOffset = start - run;
        }
      } else {
        // ── Segmentos seguintes ──
        this.startValue = run / PX_PER_PT;
        this.startValue =
          this.startValue % 1 !== 0 ? Number(this.startValue.toFixed(1)) : this.startValue;

        const cmFromMargin = Math.round((run - this.zeroPosition) / CM_IN_PX);
        rulerSegment.label.textContent = cmFromMargin > 0 ? cmFromMargin.toString() : '';
      }

      this.updateTickLabel(rulerSegment, rulerSize);
      if (this.orientation === 'Horizontal' && rulerSegment?.label) {
        try {
          const labelEl = rulerSegment.label as SVGTextElement;
          // Pequeno recuo à esquerda para o número não colidir com o marcador
          // do fim da régua, preservando o alinhamento visual do modelo antigo.
          labelEl.setAttribute('x', '-6');
          const box = labelEl.getBBox();
          const rightEdge = box.x + box.width;
          const maxRight = this.length - 6;
          if (rightEdge > maxRight) {
            const shift = Math.ceil(rightEdge - maxRight);
            labelEl.setAttribute('x', String(-6 - shift));
          }
        } catch {
          // ignore
        }
      }
      const translate =
        this.orientation === 'Horizontal'
          ? trans.trans + 0.5 + ',0.5'
          : '0.5,' + (trans.trans + 0.5);
      rulerSegment.segment.setAttribute(
        'transform',
        'translate(' + translate + ') scale(1,1)'
      );
      trans.trans += segWidth * this.scale;
      run += segWidth;
      return run;
    };

    (proto as any).__crmCmPatched = true;
  }

  // Re-renderiza o ruler para aplicar o patch imediatamente
  try {
    if (editor.rulerHelper && typeof editor.rulerHelper.updateRuler === 'function') {
      editor.rulerHelper.updateRuler(editor, true);
    }
  } catch {
    // ignore
  }
}

export interface SyncfusionEditorRef {
  /**
   * Abre um .docx do Nextcloud em modo CO-EDIÇÃO: o documento vem do serviço de
   * co-edição (que já aplica o que os outros digitaram) e, a partir daí, cada
   * edição sua vai para os outros e cada edição deles aparece aqui.
   * Só funciona com `VITE_SYNCFUSION_COLLAB_URL` configurada — sem ela, quem
   * chama deve seguir pelo caminho normal (`loadDocx`).
   */
  startCollaboration: (input: {
    path: string;
    fileName: string;
    userName: string;
    /**
     * Id do usuário no CRM. A FOTO não entra aqui: ela pode ser um `data:` de
     * megabytes e estoura o limite de mensagem do SignalR, derrubando a sala.
     * Cada navegador resolve a foto por este id (`services/userAvatars.ts`).
     */
    userId?: string | null;
  }) => Promise<void>;
  /** Sai da sala de co-edição (ao fechar o documento ou abrir outro). */
  stopCollaboration: () => Promise<void>;
  /** Há uma sala de co-edição ativa para o documento aberto? */
  isCollaborating: () => boolean;
  /**
   * Pede ao servidor da sala que grave AGORA o documento no Nextcloud e espera a
   * confirmação. É o que o botão Salvar usa: sem isto o arquivo só era escrito
   * quando a última pessoa saía do documento.
   */
  flushCollaboration: () => Promise<CollabSaveOutcome>;
  /** Avisa a sala que este usuário está digitando (não sai com a sala vazia). */
  notifyCollabTyping: () => void;
  /**
   * Plaquinha nome+foto em cima do cursor de cada pessoa da sala (estilo
   * Google Docs). Chamar a cada mudança da lista de participantes.
   */
  syncCollabCaretFlags: (peers: CaretFlagPeer[]) => void;
  // Get document content as SFDT (Syncfusion Document Text format)
  getSfdt: () => string;
  // Load SFDT content into editor
  loadSfdt: (sfdt: string) => void;
  convertSfdtToFragment: (sfdt: string) => Promise<string>;
  // Load DOCX file from ArrayBuffer
  loadDocx: (arrayBuffer: ArrayBuffer, fileName?: string) => Promise<void>;
  loadDocxViaImport: (arrayBuffer: ArrayBuffer, fileName?: string) => Promise<void>;
  // Export as DOCX blob
  exportDocx: (fileName?: string) => Promise<Blob>;
  // Export as PDF blob
  exportPdf: (fileName?: string) => Promise<Blob>;
  // Insert text at cursor
  insertText: (text: string) => void;
  // Get plain text content
  getText: () => string;
  // Get selected text
  getSelectedText: () => string;
  /**
   * Assina o `selectionChange` do Syncfusion SEM roubar o evento de ninguém.
   * O Syncfusion expõe `selectionChange` como propriedade de UM handler só:
   * quem atribui por último apaga o anterior. Aqui instalamos um despachante
   * único e distribuímos para todos os assinantes. Devolve a função de cancelar.
   */
  addSelectionChangeListener: (handler: () => void) => () => void;
  // Focus the editor
  focus: () => void;
  // Toggle bold on current selection / next inserted text
  setBold: (bold: boolean) => void;
  getCurrentFont: () => { fontFamily?: string; fontSize?: number };
  applyCurrentFont: (fontFamily?: string, fontSize?: number) => void;
  moveToDocumentStart: () => void;
  // Check if editor has content
  hasContent: () => boolean;
  // Clear editor
  clear: () => void;
  // Apply paragraph formatting (first line indent, left indent)
  applyParagraphFormat: (firstLineIndent?: number, leftIndent?: number) => void;
  // Apply citation formatting (block quote style)
  applyCitationFormat: () => void;
  // Copy current selection to clipboard (best-effort)
  copySelection: () => boolean;
  // Paste from clipboard at current cursor (best-effort)
  paste: () => boolean;
  pasteWithSourceFormatting: () => Promise<boolean>;
  pasteWithMergedFormatting: () => Promise<boolean>;
  pasteAsPlainText: () => Promise<boolean>;
  pasteCleanedFromWord: () => Promise<boolean>;
  // Select all and copy (best-effort)
  copyAll: () => boolean;
  // Get SFDT of current selection (fragment)
  getSelectionSfdt: () => string;
  // Paste/insert an SFDT fragment at cursor position
  pasteSfdt: (sfdt: string) => boolean;
  // Force minimal margins and fit page width (for modal use)
  applyMinimalMargins: () => void;
  // Replace all occurrences of a text (best-effort, preserves formatting)
  replaceAll: (
    searchText: string,
    replaceText: string,
    options?: { matchCase?: boolean; wholeWord?: boolean },
  ) => boolean;
  findText: (
    searchText: string,
    options?: { matchCase?: boolean; wholeWord?: boolean },
  ) => { count: number; current: number };
  navigateSearch: (direction: 'previous' | 'next') => { count: number; current: number };
  replaceCurrentSearch: (replaceText: string) => boolean;
  clearSearch: () => void;
  // Transform the current selection text case preserving formatting when possible
  transformSelectionCase: (mode: 'sentence' | 'lower' | 'upper' | 'title' | 'toggle') => boolean;
  // Force editor to refresh its layout and repaint
  refresh: () => void;
  // Get the underlying Syncfusion DocumentEditor instance (for the custom ribbon)
  getEditor: () => any;
  // Get the underlying DocumentEditorContainer instance
  getContainer: () => any;
  // Toggle the ruler visibility at runtime
  setShowRuler: (show: boolean) => void;
  // Toggle the navigation pane (document headings) at runtime
  setShowNavigationPane: (show: boolean) => void;
  // Enable/disable track changes (controle de alterações)
  setTrackChanges: (enabled: boolean) => void;
  // Open the browser print dialog for the document
  printDocument: () => void;
  // Zoom do documento (1 = 100%)
  getZoom: () => number;
  setZoom: (factor: number) => void;
  // Modo de exibição: páginas ou contínuo
  getLayoutType: () => 'Pages' | 'Continuous';
  setLayoutType: (layout: 'Pages' | 'Continuous') => void;
  // Página atual (pela seleção) e total de páginas
  getPageInfo: () => { current: number; total: number };
  // Contagem de palavras SEM tocar na seleção (getText usa selectAll e move o cursor)
  getWordCount: () => number;
  // Parágrafos do corpo do documento, na ordem, SEM mexer na seleção.
  // Base da revisão de texto (ortografia/gramática/IA).
  getParagraphs: () => Array<{ index: number; text: string }>;
  // Seleciona (e rola até) a N-ésima ocorrência EXATA de um trecho.
  selectOccurrence: (searchText: string, occurrence: number) => boolean;
  // Substitui a N-ésima ocorrência EXATA preservando a formatação do entorno.
  replaceOccurrence: (searchText: string, occurrence: number, replaceText: string) => boolean;
  // Remove (ou substitui) um intervalo delimitado por duas âncoras de texto.
  // Diferente de replaceAll, ATRAVESSA parágrafos: a busca do editor não
  // alcança marcas de parágrafo, mas a seleção por offsets sim.
  deleteRange: (
    startAnchor: string,
    endAnchor?: string,
    options?: {
      replaceWith?: string;
      occurrence?: 'first' | 'last';
      /** Trava de segurança: intervalo maior que isto é recusado. */
      maxChars?: number;
    },
  ) => boolean;
  // Remove UMA ocorrência de um trecho (por padrão a última) sem tocar nas
  // demais — o caminho certo para apagar conteúdo duplicado.
  deleteOccurrence: (searchText: string, occurrence?: 'first' | 'last' | number) => boolean;
}

interface SyncfusionEditorProps {
  id?: string;
  height?: string;
  onContentChange?: () => void;
  onDocumentChange?: () => void;
  onRequestInsertBlock?: () => void;
  onRequestCreateBlockFromSelection?: (selectedText: string, selectedSfdt?: string) => void;
  onRequestCompanyLookup?: () => void;
  onRequestFormatQualification?: (selectedText: string) => void;
  /** Called once the underlying DocumentEditor is created and ready. */
  onReady?: () => void;
  /** Seleção mudou (cursor moveu) — usado pela status bar (página atual). */
  onSelectionChange?: () => void;
  /** Viewport mudou (rolagem/zoom) — usado pela status bar (página visível). */
  onViewChange?: () => void;
  showPropertiesPane?: boolean;
  enableToolbar?: boolean;
  toolbarItems?: any;
  enableCustomContextMenu?: boolean;
  showRuler?: boolean;
  showNavigationPane?: boolean;
  pageFit?: 'FitPageWidth' | 'FitOnePage' | string;
  layoutType?: 'Pages' | 'Continuous';
  removeMargins?: boolean;
  readOnly?: boolean;
  currentUserName?: string;
  /**
   * Quem mais está na SALA de co-edição (a mesma que entrega as operações).
   * Esta é a lista boa: qualquer outra fonte de presença pode mostrar gente
   * "editando junto" sem que uma única letra esteja sendo sincronizada.
   */
  onCollabPeersChange?: (peers: CollabPeer[]) => void;
  /**
   * Alguém da sala gravou o documento no Nextcloud. Deixa o chamador tirar o
   * "Alterações pendentes" da tela de quem NÃO clicou em Salvar.
   */
  onCollabSaved?: (outcome: CollabSaveOutcome) => void;
  /**
   * Estado da co-edição. É o ÚNICO sinal que autoriza a tela a dizer que está
   * tudo sincronizado — e o que manda mostrar "Coedição desconectada".
   */
  onCollabStatusChange?: (status: CollabStatus) => void;
}

const SyncfusionEditor = forwardRef<SyncfusionEditorRef, SyncfusionEditorProps>(
  (
    {
      id = 'petition-document-editor',
      height = '100%',
      onContentChange,
      onDocumentChange,
      onRequestInsertBlock,
      onRequestCreateBlockFromSelection,
      onRequestCompanyLookup,
      onRequestFormatQualification,
      onReady,
      onSelectionChange,
      onViewChange,
      showPropertiesPane = true,
      enableToolbar = true,
      toolbarItems,
      enableCustomContextMenu = true,
      showRuler = true,
      showNavigationPane = true,
      pageFit,
      layoutType = 'Pages',
      removeMargins = false,
      readOnly = false,
      currentUserName,
      onCollabPeersChange,
      onCollabStatusChange,
      onCollabSaved,
    },
    ref
  ) => {
    const containerRef = useRef<DocumentEditorContainerComponent | null>(null);
    // Sessão de co-edição ativa (null = documento comum, sem sala).
    const collabHandlerRef = useRef<any>(null);
    const collabConnectionRef = useRef<CollabConnection | null>(null);
    const collabRoomRef = useRef<{ roomName: string; filePath: string; fileName: string } | null>(null);
    const collabStatusRef = useRef<CollabStatus>('off');
    /** Quantas vezes já tentamos reenviar depois de uma recusa do servidor. */
    const collabRetryRef = useRef(0);
    /**
     * Ids de conexão que JÁ foram nossos. Depois de uma reconexão o servidor dá
     * um id novo, e as operações que nós mesmos enviamos antes da queda voltariam
     * como se fossem "de outra pessoa" — aplicadas de novo, duplicando o texto.
     */
    const collabOwnConnectionIdsRef = useRef<Set<string>>(new Set());
    /**
     * Resolver de uma única vez: liga o `documentChange` do editor ao fim do
     * `editor.open()` da co-edição. Enquanto o layout do open está pendente,
     * NÃO podemos alimentar operações remotas — elas entram na fila de layout do
     * Syncfusion e, ao rodar em `onDocumentChanged`, tentam posicionar a seleção
     * num parágrafo ainda sem estrutura de linhas (o crash `nextSplitWidget`,
     * que trava a carga do arquivo). Ver `joinCollabRoom`.
     */
    const collabDocSettledRef = useRef<null | (() => void)>(null);
    /**
     * Quantas operações REMOTAS a blindagem descartou nesta sessão.
     *
     * A blindagem existe para o editor não morrer com uma operação inaplicável
     * (ver `applyRemoteAction` em `joinCollabRoom`), mas cada descarte deixa este
     * navegador com um documento INCOMPLETO: falta nele o que a outra pessoa
     * escreveu. Gravar esse documento no Nextcloud apagaria o texto dela — então o
     * salvamento é recusado enquanto este contador não for zero.
     */
    const collabDroppedRemoteOpsRef = useRef(0);
    const onCollabPeersChangeRef = useRef(onCollabPeersChange);
    const onCollabStatusChangeRef = useRef(onCollabStatusChange);
    const onCollabSavedRef = useRef(onCollabSaved);
    onCollabPeersChangeRef.current = onCollabPeersChange;
    onCollabStatusChangeRef.current = onCollabStatusChange;
    onCollabSavedRef.current = onCollabSaved;

    const setCollabStatus = (status: CollabStatus) => {
      if (collabStatusRef.current === status) return;
      collabStatusRef.current = status;
      collabLog('estado da co-edição', { status });
      onCollabStatusChangeRef.current?.(status);
    };
    const contextMenuInitRef = useRef(false);
    const contextMenuModuleRef = useRef<any>(null);
    const contextMenuRecoveryTimersRef = useRef<number[]>([]);
    const createdRef = useRef(false);
    const pendingActionsRef = useRef<(() => void)[]>([]);
    const pinnedRulerCleanupRef = useRef<(() => void) | null>(null);
    const resizeObserverRef = useRef<(() => void) | null>(null);
    const lastContextMenuPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const sentenceAnalysisTimerRef = useRef<number | null>(null);
    const sentenceAnalysisIdleRef = useRef<number | null>(null);
    const sentenceAnalysisAbortRef = useRef<AbortController | null>(null);
    const sentenceAnalysisRequestIdRef = useRef(0);
    const forcedPasteModeRef = useRef<'smart' | 'source' | 'merge' | 'text' | 'clean' | null>(null);
    const richPasteWatchdogRef = useRef<number | null>(null);
    // Refs para callbacks de status bar — handleCreated roda uma única vez e
    // capturaria versões antigas das props sem eles.
    // Assinantes externos do selectionChange (faixa de opções, etc.). Ver o
    // comentário de `addSelectionChangeListener` na interface do ref.
    const selectionChangeListenersRef = useRef<Set<() => void>>(new Set());
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onViewChangeRef = useRef(onViewChange);
    onSelectionChangeRef.current = onSelectionChange;
    onViewChangeRef.current = onViewChange;
    const [isCreated, setIsCreated] = useState(false);
    /** Recado curto do próprio editor (colagem que caiu para texto, etc.). */
    const [editorNotice, setEditorNotice] = useState<string | null>(null);
    const editorNoticeTimerRef = useRef<number | null>(null);

    /**
     * Fala com quem está editando SEM depender de contexto de toast: o editor
     * é montado em seis lugares diferentes (módulo, widget, nuvem, modelo,
     * link público, bancada) e nem todos têm provider de toast por perto.
     */
    const showEditorNotice = (text: string) => {
      setEditorNotice(text);
      if (editorNoticeTimerRef.current !== null) window.clearTimeout(editorNoticeTimerRef.current);
      editorNoticeTimerRef.current = window.setTimeout(() => {
        editorNoticeTimerRef.current = null;
        setEditorNotice(null);
      }, 9000);
    };
    const [syncfusionHeaders, setSyncfusionHeaders] = useState<object[]>(() => buildSyncfusionHeaders(null));

    const toSentenceCase = (value: string) => {
      const lower = value.toLocaleLowerCase('pt-BR');
      return lower.replace(/(^|[.!?]\s+)([\p{L}])/gu, (match, prefix: string, char: string) => `${prefix}${char.toLocaleUpperCase('pt-BR')}`);
    };

    const toTitleCase = (value: string) =>
      value
        .toLocaleLowerCase('pt-BR')
        .replace(/\b([\p{L}][\p{L}'’-]*)/gu, (word: string) => word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1));

    const toToggleCase = (value: string) =>
      Array.from(value).map((char) => {
        const lower = char.toLocaleLowerCase('pt-BR');
        const upper = char.toLocaleUpperCase('pt-BR');
        if (char === lower && char !== upper) return upper;
        if (char === upper && char !== lower) return lower;
        return char;
      }).join('');

    const transformCaseValue = (value: string, mode: 'sentence' | 'lower' | 'upper' | 'title' | 'toggle') => {
      switch (mode) {
        case 'sentence':
          return toSentenceCase(value);
        case 'lower':
          return value.toLocaleLowerCase('pt-BR');
        case 'upper':
          return value.toLocaleUpperCase('pt-BR');
        case 'title':
          return toTitleCase(value);
        case 'toggle':
          return toToggleCase(value);
        default:
          return value;
      }
    };

    const transformSfdtTextNodes = (node: unknown, mode: 'sentence' | 'lower' | 'upper' | 'title' | 'toggle'): boolean => {
      let changed = false;
      if (!node) return false;
      if (Array.isArray(node)) {
        node.forEach((item) => {
          if (transformSfdtTextNodes(item, mode)) changed = true;
        });
        return changed;
      }
      if (typeof node !== 'object') return false;

      Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
        const normalizedKey = key.toLowerCase();
        if ((normalizedKey === 'text' || normalizedKey === 'txt' || normalizedKey === 't' || normalizedKey === 'tlp') && typeof value === 'string') {
          const next = transformCaseValue(value, mode);
          if (next !== value) {
            (node as Record<string, unknown>)[key] = next;
            changed = true;
          }
          return;
        }
        if (transformSfdtTextNodes(value, mode)) changed = true;
      });

      return changed;
    };

    // Captura posição do clique direito para reposicionar o menu após filtrar itens.
    useEffect(() => {
      const capturePos = (e: MouseEvent) => {
        lastContextMenuPosRef.current = { x: e.clientX, y: e.clientY };
      };
      document.addEventListener('contextmenu', capturePos, true);
      return () => {
        document.removeEventListener('contextmenu', capturePos, true);
      };
    }, []);

    useEffect(() => {
      if (!isSupabaseFunctionsServiceUrl(SYNCFUSION_SERVICE_URL)) {
        setSyncfusionHeaders([]);
        return;
      }

      let active = true;

      const applySessionHeaders = async () => {
        try {
          const { data } = await supabase.auth.getSession();
          if (!active) return;
          setSyncfusionHeaders(buildSyncfusionHeaders(data.session?.access_token ?? null));
        } catch {
          if (!active) return;
          setSyncfusionHeaders(buildSyncfusionHeaders(null));
        }
      };

      void applySessionHeaders();

      const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!active) return;
        setSyncfusionHeaders(buildSyncfusionHeaders(session?.access_token ?? null));
      });

      return () => {
        active = false;
        authListener.subscription.unsubscribe();
      };
    }, []);

    // Cleanup da revisão contextual no unmount
    useEffect(() => {
      return () => {
        if (sentenceAnalysisTimerRef.current !== null) {
          window.clearTimeout(sentenceAnalysisTimerRef.current);
          sentenceAnalysisTimerRef.current = null;
        }
        cancelIdleWork(sentenceAnalysisIdleRef.current);
        sentenceAnalysisIdleRef.current = null;
        sentenceAnalysisAbortRef.current?.abort();
        sentenceAnalysisAbortRef.current = null;
        sentenceAnalysisRequestIdRef.current += 1;
        const editor: any = containerRef.current?.documentEditor as any;
        if (editor) clearInjectedContextualErrors(editor, false);
        pinnedRulerCleanupRef.current?.();
        pinnedRulerCleanupRef.current = null;
        resizeObserverRef.current?.();
        resizeObserverRef.current = null;
        // Fechar a aba sem sair da sala deixaria o servidor achando que ainda
        // há alguém editando (e adiaria a gravação no Nextcloud).
        void collabConnectionRef.current?.stop();
        collabConnectionRef.current = null;
        collabHandlerRef.current = null;
        collabRoomRef.current = null;
        collabOwnConnectionIdsRef.current.clear();
      };
    }, []);

    const enqueueOrRun = (action: () => void) => {
      if (createdRef.current && containerRef.current?.documentEditor) {
        action();
        return;
      }
      pendingActionsRef.current.push(action);
    };

    const flushPendingActions = () => {
      if (!createdRef.current) return;
      if (!containerRef.current?.documentEditor) return;
      const actions = pendingActionsRef.current.splice(0, pendingActionsRef.current.length);
      for (const a of actions) {
        try {
          a();
        } catch {
          // ignore
        }
      }
    };

    const insertTextWithInheritedFormatting = (ed: any, text: string): boolean => {
      const payload = String(text || '');
      if (!payload.trim() || !ed?.editor || typeof ed.editor.insertText !== 'function') return false;

      try {
        ed.focusIn?.();
        const sel: any = ed.selection;
        const cf: any = sel?.characterFormat;
        const pf: any = sel?.paragraphFormat;
        const inherit = {
          fontFamily: cf?.fontFamily,
          fontSize: cf?.fontSize,
          bold: cf?.bold,
          italic: cf?.italic,
          underline: cf?.underline,
          fontColor: cf?.fontColor,
          textAlignment: pf?.textAlignment,
          firstLineIndent: pf?.firstLineIndent,
          leftIndent: pf?.leftIndent,
          rightIndent: pf?.rightIndent,
          lineSpacing: pf?.lineSpacing,
          lineSpacingType: pf?.lineSpacingType,
          beforeSpacing: pf?.beforeSpacing,
          afterSpacing: pf?.afterSpacing,
        };
        const startOffset = String(sel?.startOffset || '');

        try { ed.editorHistory?.beginUndoAction?.(); } catch { // ignore
        }
        ed.editor.insertText(payload);

        const endOffset = String(sel?.endOffset || '');
        if (sel && startOffset && endOffset && startOffset !== endOffset) {
          sel.select(startOffset, endOffset);
          const scf: any = sel.characterFormat;
          const spf: any = sel.paragraphFormat;
          if (scf) {
            if (typeof inherit.fontFamily === 'string' && inherit.fontFamily) scf.fontFamily = inherit.fontFamily;
            if (typeof inherit.fontSize === 'number' && inherit.fontSize > 0) scf.fontSize = inherit.fontSize;
            if (typeof inherit.bold === 'boolean') scf.bold = inherit.bold;
            if (typeof inherit.italic === 'boolean') scf.italic = inherit.italic;
            if (typeof inherit.underline === 'string') scf.underline = inherit.underline;
            if (typeof inherit.fontColor === 'string' && inherit.fontColor) scf.fontColor = inherit.fontColor;
          }
          if (spf) {
            if (typeof inherit.textAlignment === 'string' && inherit.textAlignment) spf.textAlignment = inherit.textAlignment;
            if (typeof inherit.firstLineIndent === 'number') spf.firstLineIndent = inherit.firstLineIndent;
            if (typeof inherit.leftIndent === 'number') spf.leftIndent = inherit.leftIndent;
            if (typeof inherit.rightIndent === 'number') spf.rightIndent = inherit.rightIndent;
            if (typeof inherit.lineSpacingType === 'string' && inherit.lineSpacingType) spf.lineSpacingType = inherit.lineSpacingType;
            if (typeof inherit.lineSpacing === 'number' && inherit.lineSpacing > 0) spf.lineSpacing = inherit.lineSpacing;
            if (typeof inherit.beforeSpacing === 'number') spf.beforeSpacing = inherit.beforeSpacing;
            if (typeof inherit.afterSpacing === 'number') spf.afterSpacing = inherit.afterSpacing;
          }
          sel.select(endOffset, endOffset);
        }
        try { ed.editorHistory?.endUndoAction?.(); } catch { // ignore
        }
        return true;
      } catch {
        return false;
      }
    };

    const pasteFromClipboardWithMode = async (mode: 'source' | 'merge' | 'text' | 'clean'): Promise<boolean> => {
      const ed: any = containerRef.current?.documentEditor as any;
      if (!ed) return false;

      let html = '';
      let plainText = '';

      try {
        plainText = await navigator.clipboard.readText();
      } catch {
        plainText = '';
      }

      try {
        if (typeof navigator.clipboard.read === 'function') {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            if (!html && item.types.includes('text/html')) {
              const blob = await item.getType('text/html');
              html = await blob.text();
            }
            if (!plainText && item.types.includes('text/plain')) {
              const blob = await item.getType('text/plain');
              plainText = await blob.text();
            }
          }
        }
      } catch {
        // ignore
      }

      try {
        if (mode === 'source') {
          const payload = String(html || '').trim();
          if (payload && typeof ed.editor?.paste === 'function') {
            ed.focusIn?.();
            ed.editor.paste(payload);
            return true;
          }
          return insertTextWithInheritedFormatting(ed, normalizePastedParagraphs(plainText));
        }

        if (mode === 'text') {
          return insertTextWithInheritedFormatting(ed, normalizePlainTextOnly(plainText));
        }

        if (mode === 'clean') {
          const cleanedHtml = stripOfficeMarkup(html);
          const cleanedText = extractStructuredTextFromHtml(cleanedHtml) || normalizePastedParagraphs(plainText);
          return insertTextWithInheritedFormatting(ed, cleanedText);
        }

        const mergedText = normalizePastedParagraphs(plainText) || extractStructuredTextFromHtml(html);
        return insertTextWithInheritedFormatting(ed, mergedText);
      } catch {
        return false;
      }
    };

    /** Versão do documento na visão do módulo de co-edição do Syncfusion. */
    const collabHandlerVersion = (): number => {
      const version = Number((collabHandlerRef.current as any)?.version);
      return Number.isFinite(version) ? version : 0;
    };

    /**
     * Depois de uma queda de conexão: busca no servidor as operações que este
     * cliente perdeu e aplica na ordem. Sem isto o editor volta com um documento
     * defasado e a próxima letra digitada entra na posição errada.
     *
     * Devolve `true` só quando TODAS as operações perdidas entraram. A versão do
     * handler avança operação por operação, e PARA na primeira que não puder ser
     * aplicada: dizer ao servidor "estou na versão N" sem ter o conteúdo da
     * versão N é o que faria o salvamento gravar um documento sem a edição da
     * outra pessoa — apagando o trabalho dela.
     */
    const recoverMissedCollabActions = async (): Promise<boolean> => {
      const room = collabRoomRef.current;
      const handler: any = collabHandlerRef.current;
      if (!room || !handler) return false;

      try {
        const actions = await fetchMissedActions({
          roomName: room.roomName,
          version: collabHandlerVersion(),
        });

        let applied = 0;
        let syncedVersion = collabHandlerVersion();
        let complete = true;

        for (const action of actions) {
          const actionVersion = Number((action as { version?: number } | null)?.version);
          const author = String((action as { connectionId?: string } | null)?.connectionId || '');

          // As nossas já estão aplicadas localmente desde antes da queda.
          if (author && collabOwnConnectionIdsRef.current.has(author)) {
            if (Number.isFinite(actionVersion)) syncedVersion = Math.max(syncedVersion, actionVersion);
            continue;
          }

          const droppedBefore = collabDroppedRemoteOpsRef.current;
          try {
            handler.applyRemoteAction('action', action);
          } catch (err) {
            collabLog('falha ao reaplicar edição perdida', {
              room: room.roomName,
              error: String((err as Error)?.name || err),
            });
            complete = false;
            break;
          }
          // A blindagem de `applyRemoteAction` engole o erro para não derrubar o
          // editor; é por este contador que se sabe que a operação NÃO entrou.
          if (collabDroppedRemoteOpsRef.current !== droppedBefore) {
            complete = false;
            break;
          }

          applied += 1;
          if (Number.isFinite(actionVersion)) syncedVersion = Math.max(syncedVersion, actionVersion);
        }

        handler.updateVersion?.(syncedVersion);

        collabLog('edições recuperadas após reconexão', {
          room: room.roomName,
          recebidas: actions.length,
          aplicadas: applied,
          completo: complete,
        });

        if (!complete) setCollabStatus('disconnected');
        return complete;
      } catch (err) {
        collabLog('não foi possível recuperar as edições perdidas', {
          room: room.roomName,
          error: String((err as Error)?.name || err),
        });
        // Sem recuperar, este editor NÃO está em dia com os outros — e a tela
        // não pode sugerir que está.
        setCollabStatus('disconnected');
        return false;
      }
    };

    /**
     * O servidor recusou uma chamada do módulo de co-edição.
     *
     * Detalhe que fazia a sessão morrer em silêncio: depois de uma falha o
     * `CollaborativeEditingHandler` deixa `acknowledgmentPending` preenchido para
     * sempre e PARA de enviar qualquer operação seguinte. Uma única recusa (o 401
     * por falta de token, por exemplo) congelava a co-edição pelo resto da
     * sessão, sem nenhum aviso na tela.
     */
    const handleCollabServiceFailure = (args: any) => {
      const url = String(args?.url || '');
      if (!collabRoomRef.current || !url.startsWith(collabApiUrl())) return;

      const status = String(args?.status || '');
      const endpoint = url.slice(collabApiUrl().length);
      collabLog('o servidor recusou uma chamada de co-edição', { endpoint, status });

      if (collabRetryRef.current >= 3) {
        setCollabStatus('disconnected');
        return;
      }

      const attempt = (collabRetryRef.current += 1);
      void (async () => {
        // 401 costuma ser token vencido: renova antes de insistir.
        if (status === '401' || status === '403') await renewAccessToken();
        await new Promise((resolve) => { window.setTimeout(resolve, 400 * attempt); });

        const handler: any = collabHandlerRef.current;
        if (!handler || !collabRoomRef.current) return;
        try {
          handler.acknowledgmentPending = undefined;
          handler.sendLocalOperation?.();
        } catch {
          setCollabStatus('disconnected');
        }
      })();
    };

    /**
     * Entra de fato na sala: abre o documento pelo serviço, liga o módulo de
     * co-edição do Syncfusion e conecta o SignalR. Separado de
     * `startCollaboration` para que qualquer falha aqui deixe o estado limpo
     * (e não preso em "entrando…") — ver o `catch` de lá.
     */
    const joinCollabRoom = async (
      editor: any,
      { path, fileName, userName, userId }: {
        path: string;
        fileName: string;
        userName: string;
        userId: string | null;
      },
    ) => {
      const roomName = await roomNameForPath(path);
      const document = await importCollabDocument({ roomName, filePath: path, fileName });

      editor.enableCollaborativeEditing = true;
      editor.currentUser = userName;
      // `dataBind()` faz o EJ2 criar AGORA os módulos exigidos pelas
      // propriedades. Sem esta linha o módulo de co-edição só nasceria no
      // próximo `setImmediate` — e a leitura logo abaixo pegaria `undefined`.
      editor.dataBind?.();

      const handler = editor.collaborativeEditingHandlerModule;
      if (!handler) {
        throw new Error('O módulo de co-edição do Syncfusion não carregou.');
      }

      // O `CollaborativeEditingHandler` monta o próprio XMLHttpRequest para
      // UpdateAction/GetActionsFromServer e só acrescenta o que estiver em
      // `documentEditor.headers`. O serviço de co-edição exige token do CRM:
      // sem este remendo, TODA operação voltava 401 e nada sincronizava.
      // Trocamos só o método desta instância — os headers globais do editor
      // continuam valendo para o servidor de documentos, que é outro host.
      if (!handler.__juriusAuthPatched) {
        const originalSetHeaders = typeof handler.setCustomAjaxHeaders === 'function'
          ? handler.setCustomAjaxHeaders.bind(handler)
          : null;
        handler.setCustomAjaxHeaders = (request: XMLHttpRequest) => {
          try {
            originalSetHeaders?.(request);
          } catch {
            // headers globais são acessórios aqui
          }
          const token = currentAccessToken();
          if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
        };
        handler.__juriusAuthPatched = true;
      }

      // BLINDAGEM do crash `nextSplitWidget`.
      //
      // O `CollaborativeEditingHandler` NÃO aplica a operação remota na hora: ele
      // a agenda em `executeAfterLayout`. Quando o layout assenta (inclusive o do
      // próprio `editor.open()`), o Syncfusion REINVOCA `applyRemoteAction` a
      // partir de `onDocumentChanged`. Se essa operação apontar para uma posição
      // que não existe no documento carregado — uma edição já embutida no SFDT
      // que o servidor devolveu, ou de uma versão defasada — o `Selection.select`
      // lê `undefined.nextSplitWidget` e ESTOURA. Como o disparo é deferido, o
      // `try/catch` de quem chamou `applyRemoteAction` não alcança: o erro vira
      // `Uncaught (in promise)` e congela a tela em "carregando".
      //
      // Envolvendo o método NA INSTÂNCIA, tanto a chamada síncrona quanto a
      // reinvocação deferida passam por aqui — uma operação inaplicável é
      // descartada e a sessão continua, em vez de derrubar o editor inteiro.
      if (!handler.__juriusApplyGuardPatched) {
        const originalApplyRemoteAction = typeof handler.applyRemoteAction === 'function'
          ? handler.applyRemoteAction.bind(handler)
          : null;
        if (originalApplyRemoteAction) {
          handler.applyRemoteAction = (action: string, data: unknown) => {
            try {
              return originalApplyRemoteAction(action, data);
            } catch (err) {
              // Só operação de EDIÇÃO deixa o documento incompleto. `connectionId`
              // e `removeUser` são recados de presença: descartá-los não muda uma
              // letra do texto e não pode bloquear o salvamento.
              if (action === 'action') collabDroppedRemoteOpsRef.current += 1;
              collabLog('operação remota inaplicável descartada', {
                action,
                error: String((err as Error)?.name || err),
                descartadas: collabDroppedRemoteOpsRef.current,
              });
              return undefined;
            }
          };
        }
        handler.__juriusApplyGuardPatched = true;
      }

      // Sessão nova, contagem nova: o que foi descartado na sala anterior não tem
      // nada a ver com o documento que está sendo aberto agora.
      collabDroppedRemoteOpsRef.current = 0;

      // A ordem importa: informar sala/versão ANTES de abrir, senão a primeira
      // edição sai com a versão errada e o servidor a trata como atrasada.
      handler.updateRoomInfo(roomName, document.version, collabApiUrl());

      // `editor.open()` dispara um layout ASSÍNCRONO. Se conectarmos e começarmos
      // a aplicar operações remotas antes dele terminar, elas entram na fila de
      // layout do Syncfusion e, ao rodar, quebram a seleção contra um parágrafo
      // ainda sem linhas (`nextSplitWidget` undefined) — o crash que impedia o
      // arquivo de carregar. Esperamos o `documentChange` assentar; o timeout é a
      // rede de segurança para um .docx que não dispare o evento.
      const opened = new Promise<void>((resolve) => {
        collabDocSettledRef.current = resolve;
        window.setTimeout(() => {
          if (collabDocSettledRef.current === resolve) {
            collabDocSettledRef.current = null;
            resolve();
          }
        }, 4000);
      });
      editor.open(document.sfdt);
      await opened;

      collabRoomRef.current = { roomName, filePath: path, fileName };
      collabHandlerRef.current = handler;

      collabConnectionRef.current = await connectToCollabRoom({
        roomName,
        member: { userName, userId: userId ?? null },
        callbacks: {
          onData: (action, data) => {
            if (action === 'connectionId') {
              const id = String(data ?? '');
              if (id) collabOwnConnectionIdsRef.current.add(id);
            } else if (action === 'action') {
              const author = String((data as { connectionId?: string } | null)?.connectionId || '');
              // Operação nossa de volta = o servidor recebeu e distribuiu.
              if (author && collabOwnConnectionIdsRef.current.has(author)) {
                collabRetryRef.current = 0;
              }
            }

            try {
              handler.applyRemoteAction(action, data);
            } catch (err) {
              // Uma operação que não encaixa não pode derrubar a sessão, mas
              // TAMBÉM não pode passar em silêncio: o documento acabou de
              // divergir do dos outros.
              collabLog('falha ao aplicar edição recebida', {
                room: roomName,
                action,
                error: String((err as Error)?.name || err),
              });
              console.error('Falha ao aplicar a edição recebida:', err);
            }
          },
          onPeersChange: (peers) => onCollabPeersChangeRef.current?.(peers),
          onStatusChange: (status) => setCollabStatus(status),
          onReconnected: () => { void recoverMissedCollabActions(); },
          onSaved: (outcome) => onCollabSavedRef.current?.(outcome),
        },
      });
    };

    useImperativeHandle(ref, () => ({
      startCollaboration: async ({ path, fileName, userName, userId }) => {
        if (!isCollabEnabled()) {
          throw new Error('Co-edição não configurada (VITE_SYNCFUSION_COLLAB_URL ausente).');
        }
        const container = containerRef.current;
        const editor: any = container?.documentEditor as any;
        if (!editor) throw new Error('O editor ainda não está pronto.');

        // Trocar de documento sem sair da sala anterior deixaria as operações
        // deste arquivo indo para a sala errada.
        await collabConnectionRef.current?.stop();
        collabConnectionRef.current = null;
        collabHandlerRef.current = null;
        collabRoomRef.current = null;
        collabRetryRef.current = 0;
        setCollabStatus('connecting');

        try {
          await joinCollabRoom(editor, { path, fileName, userName, userId: userId ?? null });
        } catch (error) {
          // A sala não subiu. NÃO pode ficar em "entrando…" para sempre: quem
          // chamou vai abrir o documento pelo caminho normal, e a tela precisa
          // refletir que NÃO há co-edição — nem prometendo, nem alarmando.
          editor.enableCollaborativeEditing = false;
          editor.dataBind?.();
          collabRoomRef.current = null;
          collabHandlerRef.current = null;
          setCollabStatus('off');
          throw error;
        }
      },


      stopCollaboration: async () => {
        const connection = collabConnectionRef.current;
        collabConnectionRef.current = null;
        collabHandlerRef.current = null;
        collabRoomRef.current = null;
        collabRetryRef.current = 0;
        const editor: any = containerRef.current?.documentEditor as any;
        if (editor) {
          editor.enableCollaborativeEditing = false;
          editor.dataBind?.();
        }
        onCollabPeersChangeRef.current?.([]);
        setCollabStatus('off');
        await connection?.stop();
      },

      isCollaborating: () => Boolean(collabConnectionRef.current && collabRoomRef.current),

      flushCollaboration: async () => {
        const room = collabRoomRef.current;
        if (!room) throw new Error('Não há sessão de co-edição para gravar.');
        if (collabStatusRef.current === 'disconnected') {
          throw new Error('A coedição está desconectada — o servidor não recebeu as últimas edições.');
        }

        const handler: any = collabHandlerRef.current;
        const editor: any = containerRef.current?.documentEditor as any;
        if (!handler || !editor) throw new Error('O editor ainda não está pronto para gravar.');

        // O QUE ESTA JANELA GRAVA É O DOCUMENTO DESTA TELA. Se alguma operação
        // remota foi descartada, falta aqui o que a outra pessoa escreveu — e
        // gravar assim apagaria o texto dela no Nextcloud. Recusar é a única saída
        // honesta: nada foi perdido, o servidor continua com tudo.
        const assertDocumentIsComplete = () => {
          if (collabDroppedRemoteOpsRef.current === 0) return;
          throw new Error(
            'Esta janela não recebeu todas as edições em conjunto, então gravar agora ' +
            'apagaria o texto de quem está editando com você. Feche e reabra o documento ' +
            'para sincronizar — nada do que foi escrito se perdeu.',
          );
        };

        const waitForAcknowledgements = async () => {
          const deadline = Date.now() + 10_000;
          while (
            handler.acknowledgmentPending != null ||
            (Array.isArray(handler.pendingOps) && handler.pendingOps.length > 0)
          ) {
            if (collabStatusRef.current === 'disconnected') {
              throw new Error(
                'A coedição desconectou antes de confirmar todas as alterações.',
              );
            }
            if (Date.now() >= deadline) {
              throw new Error(
                'O servidor ainda não confirmou todas as alterações. Tente salvar novamente.',
              );
            }
            await new Promise((resolve) => { window.setTimeout(resolve, 50); });
          }
        };

        // Se uma operação remota entrar entre serializar e o servidor tirar a
        // foto atômica do Redis, SaveToSource responde 409. Recuperamos o que
        // faltou, serializamos outra vez e tentamos uma única vez com a versão
        // nova — nunca gravamos um snapshot defasado.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await waitForAcknowledgements();
          assertDocumentIsComplete();
          await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
          });

          const sfdt = String(editor.serialize?.() || '');
          if (!sfdt) throw new Error('Não foi possível preparar o documento para gravação.');

          // A versão é lida DEPOIS de serializar, e é a que o servidor confere
          // contra a versão atômica da sala: uma operação que entrar daqui em
          // diante faz o servidor responder 409 em vez de gravar por cima dela.
          const version = collabHandlerVersion();

          try {
            return await flushCollabRoom({
              roomName: room.roomName,
              filePath: room.filePath,
              sfdt,
              version,
            });
          } catch (error) {
            if (!(error instanceof CollabSaveConflictError) || attempt > 0) throw error;
            // Chegou edição nova durante o preparo. Só vale tentar de novo depois
            // de recuperar TUDO o que faltava: com o documento incompleto, a
            // segunda tentativa gravaria por cima do texto do outro.
            if (!(await recoverMissedCollabActions())) {
              throw new Error(
                'Chegaram novas edições e esta janela não conseguiu sincronizá-las. ' +
                'Reabra o documento e salve de novo — nada foi perdido.',
              );
            }
          }
        }

        throw new Error('Não foi possível obter uma versão estável do documento para gravar.');
      },

      notifyCollabTyping: () => {
        collabConnectionRef.current?.notifyTyping();
      },

      syncCollabCaretFlags: (peers: CaretFlagPeer[]) => {
        syncCollabCaretFlags(collabHandlerRef.current, peers);
      },

      getSfdt: () => {
        const editor = containerRef.current?.documentEditor;
        if (!editor) return '';
        try {
          return editor.serialize();
        } catch (err) {
          console.error('Error serializing SFDT:', err);
          return '';
        }
      },

      loadSfdt: (sfdt: string) => {
        if (!sfdt) return;
        enqueueOrRun(() => {
          const editor = containerRef.current?.documentEditor;
          if (!editor) return;
          try {
            editor.open(sfdt);
            // Após abrir: layout + foco + re-registrar menu de contexto
            setTimeout(() => {
              if (typeof (editor as any).resize === 'function') (editor as any).resize();
              if (pageFit && typeof editor.fitPage === 'function') {
                editor.fitPage(pageFit as any);
              }
            }, 50);
            scheduleContextMenuRecovery();
          } catch (err) {
            console.error('Erro ao carregar SFDT:', err);
          }
        });
      },

      convertSfdtToFragment: (sfdt: string) => {
        const payload = (sfdt || '').trim();
        if (!payload) return Promise.resolve('');
        return new Promise<string>((resolve) => {
          enqueueOrRun(() => {
            const editor: any = containerRef.current?.documentEditor as any;
            if (!editor) {
              resolve('');
              return;
            }
            try {
              editor.open(payload);
              const selection = editor.selection;
              selection?.selectAll?.();
              const frag = String(selection?.sfdt || '').trim();
              editor.openBlank?.();
              resolve(frag);
            } catch {
              try {
                editor.openBlank?.();
              } catch {
                // ignore
              }
              resolve('');
            }
          });
        });
      },

      loadDocx: async (arrayBuffer: ArrayBuffer, fileName = 'document.docx') => {
        if (!arrayBuffer) return;

        const openDocx = async () => {
          const editor = containerRef.current?.documentEditor as any;
          if (!editor) return;
          applySyncfusionServiceUrl(editor);

          const blob = new Blob([arrayBuffer], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          });
          const file = new File([blob], fileName, { type: blob.type });
          await editor.open(file);
          // Após carregar DOCX: o Syncfusion pode recriar o menu em múltiplos
          // ticks. A recuperação acompanha toda essa janela.
          scheduleContextMenuRecovery();
        };

        if (createdRef.current && containerRef.current?.documentEditor) {
          try {
            await openDocx();
          } catch (err) {
            console.error('Erro ao carregar DOCX:', err);
            throw buildDocxImportError(err);
          }
          return;
        }

        return new Promise<void>((resolve, reject) => {
          enqueueOrRun(() => {
            (async () => {
              try {
                await openDocx();
                resolve();
              } catch (err) {
                console.error('Erro ao carregar DOCX:', err);
                reject(buildDocxImportError(err));
              }
            })();
          });
        });
      },

      loadDocxViaImport: async (arrayBuffer: ArrayBuffer, fileName = 'document.docx') => {
        if (!arrayBuffer) return;

        const openDocx = async () => {
          const editor = containerRef.current?.documentEditor;
          if (!editor) return;
          applySyncfusionServiceUrl(editor);
          const blob = new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
          const file = new File([blob], fileName, { type: blob.type });

          await new Promise<void>((resolve, reject) => {
            try {
              editor.open(file);
              window.setTimeout(() => {
                scheduleContextMenuRecovery();
                resolve();
              }, 150);
            } catch (error) {
              reject(buildDocxImportError(error));
            }
          });
        };

        try {
          await openDocx();
        } catch (err) {
          console.error('Erro ao carregar DOCX via import:', err);
          throw buildDocxImportError(err);
        }
      },

      exportDocx: async (fileName = 'documento.docx') => {
        const editor = containerRef.current?.documentEditor;
        if (!editor) throw new Error('Editor não disponível');

        return new Promise<Blob>((resolve, reject) => {
          try {
            editor.saveAsBlob('Docx').then((blob: Blob) => {
              resolve(blob);
            }).catch(reject);
          } catch (err) {
            reject(err);
          }
        });
      },

      exportPdf: async (fileName = 'documento.pdf') => {
        const editor = containerRef.current?.documentEditor;
        if (!editor) throw new Error('Editor não inicializado');

        return new Promise<Blob>((resolve, reject) => {
          try {
            applySyncfusionServiceUrl(editor as any);
            try {
              if (typeof (editor as any).resize === 'function') {
                (editor as any).resize();
              }
              if (pageFit && typeof (editor as any).fitPage === 'function') {
                (editor as any).fitPage(pageFit as any);
              }
            } catch {
              // ignore
            }
            editor.saveAsBlob('Pdf' as any).then((blob: Blob) => {
              resolve(blob);
            }).catch(reject);
          } catch (err) {
            reject(err);
          }
        });
      },

      insertText: (text: string) => {
        const editor = containerRef.current?.documentEditor;
        if (!editor) return;
        editor.editor.insertText(text);
      },

      getText: () => {
        const editor = containerRef.current?.documentEditor;
        if (!editor) return '';
        const selection = editor.selection;
        if (!selection) return '';
        selection.selectAll();
        const text = selection.text || '';
        selection.moveToDocumentStart();
        return text;
      },

      focus: () => {
        const editor = containerRef.current?.documentEditor;
        if (!editor) return;
        
        try {
          if ((editor as any).isReadOnly) {
            (editor as any).isReadOnly = false;
          }

          editor.focusIn();
          
          const element = containerRef.current?.element;
          if (element) {
            const editableEl = element.querySelector('[contenteditable="true"]') as HTMLElement;
            if (editableEl) {
              editableEl.focus();
              const clickEvent = new MouseEvent('mousedown', {
                view: window,
                bubbles: true,
                cancelable: true
              });
              editableEl.dispatchEvent(clickEvent);
            }

            const viewer = element.querySelector('.e-de-ctn') as HTMLElement | null;
            if (viewer) {
              const st = viewer.scrollTop;
              viewer.scrollTop = st + 1;
              setTimeout(() => { viewer.scrollTop = st; }, 10);
            }
          }

          if ((editor as any).view && typeof (editor as any).view.updateLayout === 'function') {
            (editor as any).view.updateLayout();
          }
        } catch {
          // ignore
        }
      },

      setBold: (bold: boolean) => {
        const editor = containerRef.current?.documentEditor;
        if (!editor) return;
        try {
          const characterFormat = editor.selection?.characterFormat;
          if (characterFormat) characterFormat.bold = !!bold;
        } catch {
          // ignore
        }
      },

      getCurrentFont: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return {};
        try {
          const characterFormat: any = editor.selection?.characterFormat;
          const fontFamily = characterFormat?.fontFamily;
          const fontSize = characterFormat?.fontSize;
          return {
            fontFamily: typeof fontFamily === 'string' ? fontFamily : undefined,
            fontSize: typeof fontSize === 'number' ? fontSize : undefined,
          };
        } catch {
          return {};
        }
      },

      applyCurrentFont: (fontFamily?: string, fontSize?: number) => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return;
        try {
          const characterFormat: any = editor.selection?.characterFormat;
          if (!characterFormat) return;
          if (fontFamily) characterFormat.fontFamily = fontFamily;
          if (typeof fontSize === 'number' && Number.isFinite(fontSize) && fontSize > 0) characterFormat.fontSize = fontSize;
        } catch {
          // ignore
        }
      },

      moveToDocumentStart: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return;
        try {
          editor.selection?.moveToDocumentStart?.();
        } catch {
          // ignore
        }
      },

      hasContent: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return false;
        try {
          const selection = editor.selection;
          if (!selection) return false;
          const startOffset = String(selection.startOffset || '');
          const endOffset = String(selection.endOffset || '');
          selection.selectAll();
          const hasText = (selection.text || '').trim().length > 0;
          if (startOffset && endOffset && typeof selection.select === 'function') {
            selection.select(startOffset, endOffset);
          } else {
            selection.moveToDocumentStart();
          }
          return hasText;
        } catch {
          return false;
        }
      },

      clear: () => {
        const editor = containerRef.current?.documentEditor;
        if (!editor) return;
        editor.openBlank();
      },

      getSelectedText: () => {
        const editor = containerRef.current?.documentEditor;
        if (!editor) return '';
        return editor.selection?.text || '';
      },

      addSelectionChangeListener: (handler: () => void) => {
        selectionChangeListenersRef.current.add(handler);
        return () => { selectionChangeListenersRef.current.delete(handler); };
      },

      applyParagraphFormat: (firstLineIndent = 113.4, leftIndent = 0) => {
        const editor = containerRef.current?.documentEditor;
        if (!editor) return;
        const paragraphFormat = editor.selection?.paragraphFormat;
        if (paragraphFormat) {
          paragraphFormat.firstLineIndent = firstLineIndent;
          paragraphFormat.leftIndent = leftIndent;
          paragraphFormat.textAlignment = 'Justify';
        }
      },

      applyCitationFormat: () => {
        const editor = containerRef.current?.documentEditor;
        if (!editor) return;
        const paragraphFormat = editor.selection?.paragraphFormat;
        if (paragraphFormat) {
          paragraphFormat.firstLineIndent = 0;
          paragraphFormat.leftIndent = 170;
          paragraphFormat.textAlignment = 'Left';
        }
        const characterFormat = editor.selection?.characterFormat;
        if (characterFormat) {
          characterFormat.italic = true;
          characterFormat.fontSize = 11;
        }
      },

      copySelection: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        const selection: any = editor?.selection;
        try {
          if (selection && typeof selection.copy === 'function') {
            selection.copy();
            return true;
          }
          const internalEditor: any = editor?.editor;
          if (internalEditor && typeof internalEditor.copy === 'function') {
            internalEditor.copy();
            return true;
          }
          return true;
        } catch {
          return false;
        }
      },

      paste: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        const selection: any = editor?.selection;
        try {
          if (selection && typeof selection.paste === 'function') {
            selection.paste();
            return true;
          }
          const internalEditor: any = editor?.editor;
          if (internalEditor && typeof internalEditor.paste === 'function') {
            internalEditor.paste();
            return true;
          }
          return true;
        } catch {
          return false;
        }
      },

      pasteWithSourceFormatting: async () => pasteFromClipboardWithMode('source'),

      pasteWithMergedFormatting: async () => pasteFromClipboardWithMode('merge'),

      pasteAsPlainText: async () => pasteFromClipboardWithMode('text'),

      pasteCleanedFromWord: async () => pasteFromClipboardWithMode('clean'),

      copyAll: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        const selection: any = editor?.selection;
        try {
          if (selection && typeof selection.selectAll === 'function' && typeof selection.copy === 'function') {
            selection.selectAll();
            selection.copy();
            selection.moveToDocumentStart?.();
            return true;
          }
          const internalEditor: any = editor?.editor;
          if (internalEditor && typeof internalEditor.selectAll === 'function' && typeof internalEditor.copy === 'function') {
            internalEditor.selectAll();
            internalEditor.copy();
            selection?.moveToDocumentStart?.();
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },

      getSelectionSfdt: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return '';
        try {
          const selection = editor.selection;
          const sfdt = selection?.sfdt;
          if (typeof sfdt === 'string' && sfdt.trim()) return sfdt;
          if (selection && typeof selection.copy === 'function') {
            selection.copy();
            const clipboardData = (editor as any).editorModule?.copiedData;
            if (clipboardData && typeof clipboardData === 'string') {
              return clipboardData;
            }
          }
          return '';
        } catch {
          return '';
        }
      },

      pasteSfdt: (sfdt: string) => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return false;
        try {
          const payload = (sfdt || '').trim();
          if (!payload) return false;
          if (editor.editor && typeof editor.editor.insertSfdt === 'function') {
            editor.editor.insertSfdt(payload);
            return true;
          }
          if (editor.editor && typeof editor.editor.paste === 'function') {
            editor.editor.paste(payload);
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },

      applyMinimalMargins: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return;
        try {
          editor.selection?.selectAll?.();
          const sectionFormat = editor.selection?.sectionFormat;
          if (sectionFormat) {
            if (removeMargins) {
              // Editor de blocos: forçar dimensões A4 e margens mínimas para visual realista dentro do modal
              sectionFormat.pageWidth = 595.3; // 210mm
              sectionFormat.pageHeight = 841.9; // 297mm
              sectionFormat.topMargin = 10;
              sectionFormat.bottomMargin = 10;
              sectionFormat.leftMargin = 18;
              sectionFormat.rightMargin = 18;
            } else {
              // Editor principal: A4 com margens maiores para edição completa
              sectionFormat.pageWidth = 595.3;
              sectionFormat.pageHeight = 841.9;
              sectionFormat.topMargin = 15;
              sectionFormat.bottomMargin = 15;
              sectionFormat.leftMargin = 25;
              sectionFormat.rightMargin = 25;
            }
          }
          editor.selection?.moveToDocumentStart?.();
          if (typeof editor.fitPage === 'function') {
            editor.fitPage('FitPageWidth');
          }
          if (typeof editor.resize === 'function') {
            editor.resize();
          }
        } catch {
          // ignore
        }
      },

      findText: (searchText, options) => {
        const editor: any = containerRef.current?.documentEditor as any;
        const search: any = editor?.search ?? editor?.searchModule;
        if (!search?.searchResults) return { count: 0, current: 0 };
        try {
          search.searchResults.clear?.();
          const value = String(searchText || '');
          if (!value.trim()) return { count: 0, current: 0 };
          const findOption = options?.matchCase
            ? (options?.wholeWord ? 'CaseSensitiveWholeWord' : 'CaseSensitive')
            : (options?.wholeWord ? 'WholeWord' : 'None');
          search.findAll?.(value, findOption);
          const count = Number(search.searchResults.length || 0);
          const index = Number(search.searchResults.index ?? -1);
          return { count, current: count > 0 ? Math.max(0, index) + 1 : 0 };
        } catch {
          return { count: 0, current: 0 };
        }
      },

      navigateSearch: (direction) => {
        const editor: any = containerRef.current?.documentEditor as any;
        const results: any = (editor?.search ?? editor?.searchModule)?.searchResults;
        const count = Number(results?.length || 0);
        if (!results || count === 0) return { count: 0, current: 0 };
        try {
          const index = Number(results.index ?? 0);
          results.index = direction === 'next'
            ? (index + 1) % count
            : (index - 1 + count) % count;
          return { count, current: Number(results.index ?? 0) + 1 };
        } catch {
          return { count, current: 0 };
        }
      },

      replaceCurrentSearch: (replaceText) => {
        const editor: any = containerRef.current?.documentEditor as any;
        const results: any = (editor?.search ?? editor?.searchModule)?.searchResults;
        if (!results || Number(results.length || 0) === 0) return false;
        try {
          results.replace?.(String(replaceText ?? ''));
          return true;
        } catch {
          return false;
        }
      },

      clearSearch: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        try {
          (editor?.search ?? editor?.searchModule)?.searchResults?.clear?.();
        } catch {
          // ignore
        }
      },

      replaceAll: (searchText: string, replaceText: string, options) => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return false;
        try {
          const s = (searchText || '').toString();
          const r = (replaceText ?? '').toString();
          if (!s.trim()) return false;
          const search = editor.search ?? (editor as any).searchModule;
          if (!search) return false;
          const findOption = options?.matchCase
            ? (options?.wholeWord ? 'CaseSensitiveWholeWord' : 'CaseSensitive')
            : (options?.wholeWord ? 'WholeWord' : 'None');
          // API pública do EJ2: findAll popula searchResults e replaceAll do
          // SearchResults troca todas as ocorrências preservando a formatação.
          // (search.replaceAll direto é método interno com outra assinatura e
          // lança exceção quando chamado com (texto, substituto).)
          if (search.searchResults && typeof search.findAll === 'function') {
            search.searchResults.clear?.();
            search.findAll(s, findOption);
            const count = Number(search.searchResults.length || 0);
            const replaced = count > 0;
            if (replaced) search.searchResults.replaceAll(r);
            try { search.searchResults.clear?.(); } catch { /* ignore */ }
            return replaced;
          }
          if (typeof search.replaceAll === 'function') {
            search.replaceAll(s, r);
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },

      transformSelectionCase: (mode: 'sentence' | 'lower' | 'upper' | 'title' | 'toggle') => {
        const editor: any = containerRef.current?.documentEditor as any;
        const selection: any = editor?.selection;
        if (!editor || !selection) return false;

        try {
          const selectedText = String(selection.text || '');
          if (!selectedText.trim()) return false;

          const selectionSfdt = String(selection.sfdt || '').trim();
          if (selectionSfdt) {
            try {
              const parsed = JSON.parse(selectionSfdt);
              const changed = transformSfdtTextNodes(parsed, mode);
              if (changed && editor.editor && typeof editor.editor.insertSfdt === 'function') {
                editor.editor.insertSfdt(JSON.stringify(parsed));
                return true;
              }
            } catch {
              // fallback below
            }
          }

          const nextText = transformCaseValue(selectedText, mode);
          if (nextText === selectedText) return false;
          if (editor.editor && typeof editor.editor.insertText === 'function') {
            editor.editor.insertText(nextText);
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },

      refresh: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return;
        try {
          if (typeof editor.resize === 'function') editor.resize();
          if (editor.view && typeof editor.view.updateLayout === 'function') {
            editor.view.updateLayout();
          }
          const element = containerRef.current?.element;
          if (element) {
            const viewer = element.querySelector('.e-de-ctn') as HTMLElement | null;
            if (viewer) {
              const st = viewer.scrollTop;
              viewer.scrollTop = st + 1;
              setTimeout(() => { viewer.scrollTop = st; }, 10);
            }
          }
        } catch {
          // ignore
        }
      },

      getEditor: () => containerRef.current?.documentEditor ?? null,

      getContainer: () => containerRef.current ?? null,

      setShowRuler: (show: boolean) => {
        const container = containerRef.current as any;
        if (!container) return;
        try {
          forceRulerVisibility(container, !!show);
          container.documentEditorSettings = {
            ...(container.documentEditorSettings || {}),
            showRuler: !!show,
          };
          container.dataBind?.();
          container.documentEditor?.resize?.();
          if (show) {
            try {
              patchRulerForCentimeters(container.documentEditor);
            } catch {
              // ignore
            }
            try {
              container.documentEditor?.rulerHelper?.updateRuler?.(container.documentEditor, true);
            } catch {
              // ignore
            }
          }
          forceRulerVisibility(container, !!show);
        } catch {
          // ignore
        }
      },

      setShowNavigationPane: (show: boolean) => {
        const container = containerRef.current as any;
        if (!container) return;
        try {
          container.documentEditorSettings = {
            ...(container.documentEditorSettings || {}),
            showNavigationPane: !!show,
          };
          container.dataBind?.();
          container.documentEditor?.resize?.();
        } catch {
          // ignore
        }
      },

      setTrackChanges: (enabled: boolean) => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return;
        try {
          editor.enableTrackChanges = !!enabled;
        } catch {
          // ignore
        }
      },

      printDocument: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return;
        try {
          editor.print();
        } catch (err) {
          console.error('Erro ao imprimir:', err);
        }
      },

      getZoom: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        const factor = Number(editor?.zoomFactor);
        return Number.isFinite(factor) && factor > 0 ? factor : 1;
      },

      setZoom: (factor: number) => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return;
        try {
          const clamped = Math.min(3, Math.max(0.25, Number(factor) || 1));
          editor.zoomFactor = clamped;
        } catch {
          // ignore
        }
      },

      getLayoutType: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        return editor?.layoutType === 'Continuous' ? 'Continuous' : 'Pages';
      },

      setLayoutType: (layout: 'Pages' | 'Continuous') => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return;
        try {
          editor.layoutType = layout;
        } catch {
          // ignore
        }
      },

      getPageInfo: () => {
        const editor: any = containerRef.current?.documentEditor as any;
        const current = Number(editor?.selection?.startPage);
        const total = Number(editor?.pageCount);
        return {
          current: Number.isFinite(current) && current > 0 ? current : 1,
          total: Number.isFinite(total) && total > 0 ? total : 1,
        };
      },

      getWordCount: () => {
        // Percorre o modelo interno (pages → bodyWidgets → blocos → linhas →
        // elementos) em modo somente-leitura. NUNCA usar getText() aqui: ele
        // faz selectAll e moveria o cursor do usuário a cada contagem.
        const editor: any = containerRef.current?.documentEditor as any;
        try {
          const pages = editor?.documentHelper?.pages;
          if (!Array.isArray(pages)) return 0;

          const blockText = (block: any): string => {
            let text = '';
            for (const child of block?.childWidgets || []) {
              if (Array.isArray(child?.children)) {
                // LineWidget: concatena os runs de texto da linha
                for (const el of child.children) {
                  if (typeof el?.text === 'string') text += el.text;
                }
                text += ' ';
              } else {
                // Tabela/linha/célula: desce recursivamente
                text += `${blockText(child)} `;
              }
            }
            return text;
          };

          let words = 0;
          for (const page of pages) {
            for (const body of page?.bodyWidgets || []) {
              for (const block of body?.childWidgets || []) {
                const matches = blockText(block).match(/\S+/g);
                if (matches) words += matches.length;
              }
            }
          }
          return words;
        } catch {
          return 0;
        }
      },

      getParagraphs: () => {
        // Mesma travessia somente-leitura do getWordCount: nada de selectAll,
        // que moveria o cursor do usuário a cada revisão.
        const editor: any = containerRef.current?.documentEditor as any;
        const paragraphs: Array<{ index: number; text: string }> = [];

        try {
          const pages = editor?.documentHelper?.pages;
          if (!Array.isArray(pages)) return paragraphs;

          const lineText = (line: any): string => {
            let text = '';
            for (const el of line?.children || []) {
              // Marcadores de campo (\x13..\x15) e caixas de lista não são texto.
              // Marcador de lista (ListTextElementBox) tem `listLevel`; testar
              // pelo nome da classe quebraria no bundle minificado.
              if (typeof el?.text === 'string' && !el?.listLevel) {
                text += el.text;
              }
            }
            return text;
          };

          const pushBlock = (block: any) => {
            if (!block) return;

            // Tabela/linha/célula: desce até os parágrafos de dentro.
            const isParagraph = Array.isArray(block.childWidgets)
              && block.childWidgets.some((child: any) => Array.isArray(child?.children));
            if (!isParagraph) {
              for (const child of block?.childWidgets || []) pushBlock(child);
              return;
            }

            let text = '';
            for (const line of block.childWidgets || []) {
              if (Array.isArray(line?.children)) text += lineText(line);
            }
            text = text.replace(/[\u0000-\u001F]/g, '').replace(/\u00A0/g, ' ');

            // Parágrafo quebrado entre páginas volta a ser um só: senão a
            // frase seria cortada no meio e a gramática analisaria pedaços.
            if (block.previousSplitWidget && paragraphs.length > 0) {
              paragraphs[paragraphs.length - 1].text += text;
              return;
            }
            paragraphs.push({ index: paragraphs.length, text });
          };

          for (const page of pages) {
            for (const body of page?.bodyWidgets || []) {
              for (const block of body?.childWidgets || []) pushBlock(block);
            }
          }
        } catch (err) {
          console.warn('[SyncfusionEditor] getParagraphs erro:', err);
        }

        return paragraphs;
      },

      selectOccurrence: (searchText, occurrence) => {
        const editor: any = containerRef.current?.documentEditor as any;
        return focusSearchOccurrence(editor, searchText, occurrence) !== null;
      },

      replaceOccurrence: (searchText, occurrence, replaceText) => {
        const editor: any = containerRef.current?.documentEditor as any;
        const results = focusSearchOccurrence(editor, searchText, occurrence);
        if (!results) return false;
        try {
          results.replace(String(replaceText ?? ''));
          results.clear?.();
          return true;
        } catch (err) {
          console.warn('[SyncfusionEditor] replaceOccurrence erro:', err);
          return false;
        }
      },

      deleteRange: (startAnchor, endAnchor, options) => {
        const editor: any = containerRef.current?.documentEditor as any;
        return removeEditorRange(editor, String(startAnchor || ''), endAnchor, options || {});
      },

      deleteOccurrence: (searchText, occurrence = 'last') => {
        const editor: any = containerRef.current?.documentEditor as any;
        const value = String(searchText || '');
        if (!editor || !value.trim()) return false;

        const offsets = collectOccurrenceOffsets(editor, value);
        if (!offsets.length) return false;

        const index = typeof occurrence === 'number'
          ? Math.min(Math.max(occurrence, 0), offsets.length - 1)
          : occurrence === 'first'
            ? 0
            : offsets.length - 1;

        const selection = editor.selection;
        const editorModule = editor.editorModule ?? editor.editor;
        if (!selection || typeof editorModule?.delete !== 'function') return false;

        try {
          selection.select(offsets[index].start, offsets[index].end);
          if (!String(selection.text || '').trim()) return false;
          try { editor.editorHistory?.beginUndoAction?.(); } catch { /* ignore */ }
          editorModule.delete();
          collapseEmptyParagraphsAtCursor(editor);
          try { editor.editorHistory?.endUndoAction?.(); } catch { /* ignore */ }
          return true;
        } catch (err) {
          console.warn('[SyncfusionEditor] deleteOccurrence erro:', err);
          try { editor.editorHistory?.endUndoAction?.(); } catch { /* ignore */ }
          return false;
        }
      },
    }));

    useEffect(() => {
      const editor: any = containerRef.current?.documentEditor as any;
      if (!editor) return;
      try {
        const nextName = typeof currentUserName === 'string' && currentUserName.trim() ? currentUserName.trim() : 'Usuário';
        editor.currentUser = nextName;
      } catch {
        // ignore
      }
    }, [currentUserName]);

    /**
     * Agenda a revisão contextual da frase do cursor.
     *
     * Três compromissos, nesta ordem:
     *
     *   FLUIDEZ  — nada de estado React nem de reLayout por tecla digitada. O
     *              trabalho pesado (ler o parágrafo, montar a frase, injetar o
     *              sublinhado) roda em `requestIdleCallback`, fora do frame da
     *              digitação, e só depois de a pessoa parar de digitar.
     *   ECONOMIA — a chamada de modelo só acontece quando o dicionário local já
     *              marcou uma palavra dessa frase (`evaluateContextGate`). Em
     *              texto correto, o custo é exatamente zero.
     *   DISCRIÇÃO — o resultado aparece como o sublinhado vermelho de sempre,
     *              com a correção no menu do botão direito. Nenhum aviso na tela.
     */
    const scheduleContextualSentenceAnalysis = () => {
      const requestId = ++sentenceAnalysisRequestIdRef.current;
      if (sentenceAnalysisTimerRef.current !== null) {
        window.clearTimeout(sentenceAnalysisTimerRef.current);
        sentenceAnalysisTimerRef.current = null;
      }
      cancelIdleWork(sentenceAnalysisIdleRef.current);
      sentenceAnalysisIdleRef.current = null;
      sentenceAnalysisAbortRef.current?.abort();
      sentenceAnalysisAbortRef.current = null;

      const editor: any = containerRef.current?.documentEditor as any;
      if (!editor || readOnly || !aiService.isEnabled()) return;

      // O texto mudou: o diagnóstico anterior aponta para um trecho que talvez
      // já não exista. Solta os spans SEM relayout — o próprio ato de digitar
      // já repinta a linha, e um reLayout por tecla é justamente o que travava.
      clearInjectedContextualErrors(editor, false);

      sentenceAnalysisTimerRef.current = window.setTimeout(() => {
        sentenceAnalysisTimerRef.current = null;
        sentenceAnalysisIdleRef.current = scheduleIdleWork(() => {
          sentenceAnalysisIdleRef.current = null;
          if (requestId !== sentenceAnalysisRequestIdRef.current) return;
          runContextualSentenceAnalysis(editor, requestId);
        });
      }, SENTENCE_ANALYSIS_IDLE_MS);
    };

    /** Roda já em tempo ocioso: pode ler o parágrafo e montar a frase. */
    const runContextualSentenceAnalysis = (editor: any, requestId: number) => {
      const sentence = getCurrentSentenceForAnalysis(editor);
      if (!sentence) return;

      const key = contextualSentenceKey(sentence);
      const cached = contextualSentenceIssueCache.get(key);
      if (cached) {
        // Reabrir a mesma frase (voltar o cursor, refazer um trecho) não custa
        // nada: o veredicto anterior — inclusive "está correta" — vale de novo.
        applyContextualIssues(editor, requestId, key, sentence, cached);
        return;
      }

      const spellChecker = editor?.spellCheckerModule ?? editor?.spellChecker;
      const errorColl = spellChecker?.errorWordCollection;
      if (!errorColl || typeof errorColl.containsKey !== 'function') return;

      // Consulta em mapa, palavra por palavra da frase: é o sinal local que
      // autoriza (ou não) gastar uma chamada.
      const suspects = collectSuspectWords(sentence, (word) => {
        const normalized = typeof spellChecker.manageSpecialCharacters === 'function'
          ? spellChecker.manageSpecialCharacters(word, undefined, true)
          : word;
        return Boolean(normalized) && errorColl.containsKey(normalized);
      });

      const verdict = evaluateContextGate({
        sentence,
        suspects,
        isResolvedLocally: hasHighConfidenceCorrection,
      });
      if (!verdict.allow) return;

      registerProofTokens(verdict.estimatedTokens);
      const controller = new AbortController();
      sentenceAnalysisAbortRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), SENTENCE_ANALYSIS_TIMEOUT_MS);

      void aiService.analyzeSpellingSentence({
        sentence: verdict.context,
        signal: controller.signal,
      }).then((issues) => {
        contextualSentenceIssueCache.set(key, issues);
        if (contextualSentenceIssueCache.size > 120) {
          const oldestKey = contextualSentenceIssueCache.keys().next().value;
          if (oldestKey) contextualSentenceIssueCache.delete(oldestKey);
        }
        applyContextualIssues(editor, requestId, key, sentence, issues);
      }).catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn('[SyncfusionEditor] revisão contextual da frase falhou:', error);
        }
      }).finally(() => {
        window.clearTimeout(timeout);
        if (sentenceAnalysisAbortRef.current === controller) {
          sentenceAnalysisAbortRef.current = null;
        }
      });
    };

    /** Injeta o sublinhado, sempre em tempo ocioso e só se a frase não mudou. */
    const applyContextualIssues = (
      editor: any,
      requestId: number,
      key: string,
      sentence: string,
      issues: ContextualSentenceSpellingIssue[],
    ) => {
      if (requestId !== sentenceAnalysisRequestIdRef.current) return;
      if (issues.length === 0) return;

      scheduleIdleWork(() => {
        if (requestId !== sentenceAnalysisRequestIdRef.current) return;
        if (contextualSentenceKey(getCurrentSentenceForAnalysis(editor)) !== key) return;
        injectContextualSentenceErrors(editor, sentence, issues);
      });
    };

    const handleContentChange = (args?: { operations?: unknown[] }) => {
      // Co-edição: cada alteração vira operação e sobe para o servidor, que a
      // distribui para quem mais estiver no documento. É isto que faz o texto
      // aparecer na tela do outro enquanto se digita.
      const operations = args?.operations;
      if (collabHandlerRef.current && Array.isArray(operations) && operations.length > 0) {
        try {
          collabHandlerRef.current.sendActionToServer(operations);
          collabLog('operação enviada', {
            room: collabRoomRef.current?.roomName,
            operacoes: operations.length,
          });
          // "Está digitando" sai pela SALA, e só quando há mais alguém nela.
          collabConnectionRef.current?.notifyTyping();
        } catch (err) {
          collabLog('falha ao enviar a operação', {
            room: collabRoomRef.current?.roomName,
            error: String((err as Error)?.name || err),
          });
          console.error('Falha ao enviar a edição para a sala de co-edição:', err);
        }
      }
      onContentChange?.();
      // Revisão contextual do trecho do cursor: entra apenas quando o
      // dicionário local já apontou uma palavra ali.
      scheduleContextualSentenceAnalysis();
    };

    const handleDocumentChange = () => {
      const editor: any = containerRef.current?.documentEditor as any;

      // EJ2 32.1.21 destrói as pilhas ao trocar de documento, mas conserva
      // ponteiros transitórios para os BaseHistoryInfo já destruídos. Com a
      // coedição ligada, o próximo fireContentChange tenta serializar esse
      // lastOperation sem owner e quebra em `editorHistoryModule`.
      resetSyncfusionHistoryAfterDocumentLoad(editor);

      // Um `open()` da co-edição está esperando o layout assentar: libera-o antes
      // de qualquer outra coisa, para só então conectar e receber operações.
      const settle = collabDocSettledRef.current;
      if (settle) {
        collabDocSettledRef.current = null;
        settle();
      }

      onDocumentChange?.();

      if (!editor) return;

      // editor.open() restaura partes do menu em momentos diferentes conforme
      // o tamanho do arquivo. Revalidamos módulo, instância e handlers durante
      // toda a janela de estabilização, sem depender de um único timeout.
      scheduleContextMenuRecovery();

      window.setTimeout(() => {
        try {
          if (removeMargins) {
            const sectionFormat = editor.selection?.sectionFormat;
            if (sectionFormat) {
              sectionFormat.topMargin = 10;
              sectionFormat.bottomMargin = 10;
              sectionFormat.leftMargin = 10;
              sectionFormat.rightMargin = 10;
            }
          }

          if (pageFit && typeof editor.fitPage === 'function') {
            editor.fitPage(pageFit);
          }
        } catch {
          // ignore
        }
      }, 0);
    };

    const initContextMenu = (): boolean => {
      if (!enableCustomContextMenu || readOnly) return true;
      const editor = containerRef.current?.documentEditor as any;
      if (!editor?.contextMenu || !editor?.element?.id) return false;
      const contextMenu = editor.contextMenu as any;

      // Alguns carregamentos substituem o módulo; outros preservam o objeto,
      // mas recriam sua instância/handlers. Não usamos apenas um booleano React
      // para decidir se o menu existe: validamos o estado real do Syncfusion.
      if (contextMenuModuleRef.current !== contextMenu) {
        contextMenuModuleRef.current = contextMenu;
        contextMenuInitRef.current = false;
      }

      const expectedCustomIds = [
        'crm_insert_block',
        'crm_add_block',
        'crm_company_lookup',
        'crm_format_qualification',
      ];
      const currentCustomItems = Array.isArray(contextMenu.customMenuItems)
        ? contextMenu.customMenuItems
        : [];
      const hasCurrentCustomItems = expectedCustomIds.every((expectedId) =>
        currentCustomItems.some((item: any) => String(item?.id || '').endsWith(expectedId)),
      );

      // Recria apenas quando os itens realmente desapareceram; addCustomMenu
      // destrói/reconstrói a instância e geraria duplicatas se chamado às cegas.
      if (!hasCurrentCustomItems) {
        const menuItemsDef: MenuItemModel[] = [
          {
            text: 'Inserir bloco...',
            id: 'crm_insert_block',
            iconCss: 'e-icons e-de-ctnr-open',
          },
          {
            text: 'Adicionar bloco...',
            id: 'crm_add_block',
            iconCss: 'e-icons e-de-ctnr-save',
          },
          {
            text: 'Buscar empresa...',
            id: 'crm_company_lookup',
            iconCss: 'e-icons e-de-ctnr-find',
          },
          {
            text: 'Formatar com IA...',
            id: 'crm_format_qualification',
            iconCss: 'e-icons e-de-copypaste',
          },
        ];
        try {
          contextMenu.addCustomMenu(menuItemsDef, false, true);
          contextMenuInitRef.current = true;
        } catch {
          contextMenuInitRef.current = false;
          return false;
        }
      } else {
        contextMenuInitRef.current = true;
        if (!contextMenu.contextMenuInstance && typeof contextMenu.initContextMenu === 'function') {
          // O objeto sobreviveu, mas a instância DOM foi descartada durante open().
          try {
            contextMenu.initContextMenu(contextMenu.locale);
          } catch {
            return false;
          }
        }
      }

      // Handlers são re-registrados sempre — editor.open() pode resetá-los

      // Substituição direta (sem encadeamento) para evitar empilhamento em re-registros
      editor.customContextMenuSelect = (args: any) => {
        const prefix = editor?.element?.id || '';
        const clickedId = String(args?.id || '');

        if (clickedId === `${prefix}crm_insert_block`) {
          onRequestInsertBlock?.();
          return;
        }

        if (clickedId === `${prefix}crm_add_block`) {
          const selectedText = String(editor?.selection?.text || '');
          const hasSelection = !editor?.selection?.isEmpty && /\S/.test(selectedText);
          if (!hasSelection) return;
          const selectedSfdt = String(editor?.selection?.sfdt || '');
          onRequestCreateBlockFromSelection?.(selectedText, selectedSfdt);
          return;
        }

        if (clickedId === `${prefix}crm_company_lookup`) {
          onRequestCompanyLookup?.();
          return;
        }

        if (clickedId === `${prefix}crm_format_qualification`) {
          const selectedText = String(editor?.selection?.text || '');
          const hasSelection = !editor?.selection?.isEmpty && /\S/.test(selectedText);
          if (hasSelection) {
            onRequestFormatQualification?.(selectedText);
          }
          return;
        }
      };

      editor.customContextMenuBeforeOpen = (args: any) => {
        try {
          const ids: string[] = (args?.ids || []) as string[];

          // ── crm_add_block: habilitar só com seleção ──
          const addBlockId = ids.find((x) => String(x).includes('crm_add_block'));
          if (addBlockId) {
            const itemEl = document.getElementById(addBlockId);
            if (itemEl) {
              const selectedText = String(editor?.selection?.text || '');
              const hasSelection = !editor?.selection?.isEmpty && /\S/.test(selectedText);
              itemEl.style.display = 'block';
              if (hasSelection) {
                itemEl.classList.remove('e-disabled');
                (itemEl as any).setAttribute?.('aria-disabled', 'false');
              } else {
                itemEl.classList.add('e-disabled');
                (itemEl as any).setAttribute?.('aria-disabled', 'true');
              }
            }
          }

          // ── Filtro do menu quando em palavra com erro ortográfico ──
          // Estratégia POR POSIÇÃO (whitelist): sugestões reais ficam SEMPRE
          // antes do primeiro item de sistema (More Suggestion / Add to Dictionary /
          // Ignore Once/All / No Suggestions). Tudo a partir daí = esconder, exceto Copiar.
          // Usamos setTimeout(fn, 0) em vez de rAF para garantir que roda DEPOIS
          // que o Syncfusion terminou de posicionar o menu (evita sobrescrever).
          setTimeout(() => {
            const wrappers = document.querySelectorAll<HTMLElement>(
              '.e-de-contextmenu-wrapper, .e-contextmenu-wrapper, .e-contextmenu-container'
            );
            const visibleWrappers = Array.from(wrappers).filter(
              (w) => window.getComputedStyle(w).display !== 'none'
            );
            if (visibleWrappers.length === 0) return;

            const menuItems: HTMLElement[] = [];
            visibleWrappers.forEach((w) => {
              w.querySelectorAll<HTMLElement>('li.e-menu-item').forEach((li) =>
                menuItems.push(li)
              );
            });
            if (menuItems.length === 0) return;

            const normText = (el: HTMLElement) =>
              (el.textContent || '').toLowerCase().trim().replace(/\s+/g, ' ');

            // Identificar itens CRM customizados pelo id (nunca são sugestões de spell)
            const isCrmItem = (li: HTMLElement) =>
              (li.getAttribute('id') || '').includes('crm_');

            // Indicadores do PRIMEIRO item de sistema após as sugestões.
            // Qualquer um destes confirma contexto de erro ortográfico.
            const SYSTEM_BOUNDARY = [
              'more suggestion', 'mais sugest',
              'no suggestions', 'nenhuma sugest',
              'add to dictionary', 'adicionar ao dicion',
              'ignore once', 'ignorar uma vez',
              'ignore all', 'ignorar todas',
              'spelling', 'ortografia',
            ];

            let firstSystemIdx = -1;
            for (let i = 0; i < menuItems.length; i++) {
              const t = normText(menuItems[i]);
              if (SYSTEM_BOUNDARY.some((s) => t.includes(s))) {
                firstSystemIdx = i;
                break;
              }
            }
            if (firstSystemIdx === -1) return; // não é contexto de spell check → menu normal

            // Padrões de Copiar (case-insensitive, com/sem reticências)
            const isCopyText = (t: string) =>
              t === 'copy' || t === 'copy...' || t === 'copiar' || t === 'copiar...';

            // Cada item alterado é registrado ANTES de mudar, para que a
            // próxima abertura do menu comece do estado original.
            menuItems.forEach((li, idx) => {
              const t = normText(li);
              rememberSpellMenuItem(li);
              if (isCrmItem(li)) {
                // Itens CRM nunca são sugestões — sempre esconder no contexto spell
                li.style.display = 'none';
              } else if (idx < firstSystemIdx) {
                // sugestão de spell real
                li.style.display = '';
              } else if (isCopyText(t)) {
                li.style.display = '';
              } else {
                li.style.display = 'none';
              }
            });

            // Esconder separadores no modo spell-check
            visibleWrappers.forEach((w) => {
              w.querySelectorAll<HTMLElement>('li.e-separator').forEach((sep) => {
                rememberSpellMenuItem(sep);
                sep.style.display = 'none';
              });
            });

            // ── Reposicionar o menu para abrir PARA BAIXO a partir do clique ──
            // setTimeout garante que rodamos depois do posicionamento do Syncfusion.
            const pos = lastContextMenuPosRef.current;
            if (pos.y > 0) {
              visibleWrappers.forEach((w) => {
                // Forçar position:fixed para que top/left sejam relativos ao viewport
                rememberSpellMenuWrapper(w);
                w.style.position = 'fixed';
                w.style.top = `${pos.y}px`;
                if (pos.x > 0) w.style.left = `${pos.x}px`;
                // Verifica se cabe — se ultrapassar o viewport, sobe o suficiente
                const rect = w.getBoundingClientRect();
                const overflow = rect.bottom - (window.innerHeight - 10);
                if (overflow > 0) {
                  w.style.top = `${Math.max(10, pos.y - overflow)}px`;
                }
              });
            }
          }, 0);
        } catch {
          // ignore
        }
      };

      // O spell-checker também pode restaurar o handler nativo durante open().
      // A função detecta se o patch atual foi substituído e o reinstala.
      try { patchContextMenuForSpellCheck(editor); } catch { /* ignore */ }

      return Boolean(contextMenu.contextMenuInstance);
    };

    const scheduleContextMenuRecovery = () => {
      contextMenuRecoveryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      contextMenuRecoveryTimersRef.current = [0, 80, 220, 500, 900, 1500].map((delay) =>
        window.setTimeout(() => {
          const editor = containerRef.current?.documentEditor as any;
          if (!editor) return;
          try { initContextMenu(); } catch { /* tenta novamente no próximo tick */ }
          try { patchContextMenuForSpellCheck(editor); } catch { /* ignore */ }
          if (delay === 220) {
            try { editor.focusIn?.(); } catch { /* ignore */ }
          }
        }, delay),
      );
    };

    useEffect(() => {
      return () => {
        contextMenuRecoveryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
        contextMenuRecoveryTimersRef.current = [];
      };
    }, []);

    // Última linha de defesa: antes de cada clique direito, confirma de forma
    // síncrona que o menu e o patch pertencem à instância atual do documento.
    useEffect(() => {
      if (!isCreated || !enableCustomContextMenu || readOnly) return;
      const root = containerRef.current?.element;
      if (!root) return;

      const ensureContextMenu = () => {
        const editor = containerRef.current?.documentEditor as any;
        if (!editor) return;
        try { initContextMenu(); } catch { /* ignore */ }
        try { patchContextMenuForSpellCheck(editor); } catch { /* ignore */ }
      };

      root.addEventListener('contextmenu', ensureContextMenu, true);
      return () => root.removeEventListener('contextmenu', ensureContextMenu, true);
    }, [enableCustomContextMenu, isCreated, readOnly]);

    const handleCreated = () => {
      createdRef.current = true;
      setIsCreated(true);

      // Garante que existe um documento inicializado (evita crashes do Ruler/Selection quando sectionFormat ainda não existe)
      try {
        const editor: any = containerRef.current?.documentEditor as any;
        applySyncfusionServiceUrl(editor);
        editor?.openBlank?.();
        if (editor && typeof currentUserName === 'string' && currentUserName.trim()) {
          editor.currentUser = currentUserName.trim();
        }

        // Configurar corretor ortográfico (Hunspell pt-BR local — o serviço
        // web de demo não tem dicionário português e marcava tudo errado)
        try {
          if (editor?.spellChecker) {
            editor.spellChecker.languageID = 1046; // Português (Brasil)
            editor.spellChecker.allowSpellCheckAndSuggestion = true;
            // CHECK POR PÁGINA DESLIGADO — é o que fazia a página "sumir" no scroll.
            //
            // Com `enableOptimizedSpellCheck` (padrão do Syncfusion), `addVisiblePage`
            // NÃO desenha a página: ela só é pintada dentro do `.then()` do check da
            // página inteira. Como o handler de rolagem apaga o canvas ANTES disso
            // (`clearContent` → `updateScrollBars`), a faixa que acabou de entrar na
            // tela fica em branco até a resposta chegar — topo e rodapé sumindo,
            // exatamente o sintoma relatado. Medido na bancada `src/dev/scrollRepro.ts`:
            // tinta no canvas ao fim do handler = 0 com o modo otimizado e = valor
            // final sem ele, com o mesmo resultado depois de assentar.
            //
            // Sem o modo otimizado o Syncfusion volta a checar palavra a palavra —
            // que é como o nosso Hunspell local trabalha —, o sublinhado chega igual
            // (abertura do documento, digitação e `rescanSpelling`) e o desenho da
            // página deixa de esperar por corretor nenhum.
            editor.spellChecker.enableOptimizedSpellCheck = false;
            // Peças jurídicas têm muitas siglas/cabeçalhos em caixa alta (TST,
            // CLT, RECLAMATÓRIA…) — não marcar palavras 100% maiúsculas.
            editor.spellChecker.ignoreUppercase = true;
            attachLocalSpellChecker(editor);
          }
        } catch {
          // ignore se spell checker não disponível
        }

        // Patch do context menu: adicionar .catch() no caminho async de spell-check
        try {
          patchContextMenuForSpellCheck(editor);
        } catch {
          // ignore
        }

        // Eventos da status bar customizada (página atual / zoom / rolagem)
        try {
          if (editor) {
            // Despachante ÚNICO: o Syncfusion só guarda um handler aqui, então
            // ninguém mais pode atribuir `selectionChange` direto — use
            // `addSelectionChangeListener` no ref. Antes, a faixa de opções
            // sobrescrevia este handler e derrubava a detecção de seleção
            // (Assistente IA achava que o escopo era sempre o documento inteiro)
            // junto com a barra de status e a posição do cursor.
            editor.selectionChange = () => {
              onSelectionChangeRef.current?.();
              selectionChangeListenersRef.current.forEach((listener) => {
                try {
                  listener();
                } catch {
                  // um assinante com erro não pode derrubar os outros
                }
              });
            };
            editor.viewChange = () => onViewChangeRef.current?.();
          }
        } catch {
          // ignore
        }

        // Patch do ruler: mostrar valores em CM em vez de pontos
        try {
          patchRulerForCentimeters(editor);
        } catch {
          // ignore
        }

        pinnedRulerCleanupRef.current?.();
        pinnedRulerCleanupRef.current = pinHorizontalRulerToViewport(editor);

        // Força o editor a remedir a largura do container várias vezes após a criação.
        // O Syncfusion calcula a largura interna no created(); se o container ainda não
        // tinha a largura final naquele instante, a folha fica comprimida e não se recupera
        // sozinha. Vários ticks garantem que ele remeça quando o flex já estiver estável.
        const forceResize = () => {
          const ed: any = containerRef.current?.documentEditor as any;
          if (!ed) return;
          try {
            if (typeof ed.resize === 'function') ed.resize();
            if (pageFit && typeof ed.fitPage === 'function') ed.fitPage(pageFit as any);
          } catch {
            // ignore
          }
        };

    /* const insertTextWithInheritedFormatting = (ed: any, text: string): boolean => {
      const payload = String(text || '');
      if (!payload.trim() || !ed?.editor || typeof ed.editor.insertText !== 'function') return false;

      try {
        ed.focusIn?.();
        const sel: any = ed.selection;
        const cf: any = sel?.characterFormat;
        const pf: any = sel?.paragraphFormat;
        const inherit = {
          fontFamily: cf?.fontFamily,
          fontSize: cf?.fontSize,
          bold: cf?.bold,
          italic: cf?.italic,
          underline: cf?.underline,
          fontColor: cf?.fontColor,
          textAlignment: pf?.textAlignment,
          firstLineIndent: pf?.firstLineIndent,
          leftIndent: pf?.leftIndent,
          rightIndent: pf?.rightIndent,
          lineSpacing: pf?.lineSpacing,
          lineSpacingType: pf?.lineSpacingType,
          beforeSpacing: pf?.beforeSpacing,
          afterSpacing: pf?.afterSpacing,
        };
        const startOffset = String(sel?.startOffset || '');

        try { ed.editorHistory?.beginUndoAction?.(); } catch { // ignore
        }
        ed.editor.insertText(payload);

        const endOffset = String(sel?.endOffset || '');
        if (sel && startOffset && endOffset && startOffset !== endOffset) {
          sel.select(startOffset, endOffset);
          const scf: any = sel.characterFormat;
          const spf: any = sel.paragraphFormat;
          if (scf) {
            if (typeof inherit.fontFamily === 'string' && inherit.fontFamily) scf.fontFamily = inherit.fontFamily;
            if (typeof inherit.fontSize === 'number' && inherit.fontSize > 0) scf.fontSize = inherit.fontSize;
            if (typeof inherit.bold === 'boolean') scf.bold = inherit.bold;
            if (typeof inherit.italic === 'boolean') scf.italic = inherit.italic;
            if (typeof inherit.underline === 'string') scf.underline = inherit.underline;
            if (typeof inherit.fontColor === 'string' && inherit.fontColor) scf.fontColor = inherit.fontColor;
          }
          if (spf) {
            if (typeof inherit.textAlignment === 'string' && inherit.textAlignment) spf.textAlignment = inherit.textAlignment;
            if (typeof inherit.firstLineIndent === 'number') spf.firstLineIndent = inherit.firstLineIndent;
            if (typeof inherit.leftIndent === 'number') spf.leftIndent = inherit.leftIndent;
            if (typeof inherit.rightIndent === 'number') spf.rightIndent = inherit.rightIndent;
            if (typeof inherit.lineSpacingType === 'string' && inherit.lineSpacingType) spf.lineSpacingType = inherit.lineSpacingType;
            if (typeof inherit.lineSpacing === 'number' && inherit.lineSpacing > 0) spf.lineSpacing = inherit.lineSpacing;
            if (typeof inherit.beforeSpacing === 'number') spf.beforeSpacing = inherit.beforeSpacing;
            if (typeof inherit.afterSpacing === 'number') spf.afterSpacing = inherit.afterSpacing;
          }
          sel.select(endOffset, endOffset);
        }
        try { ed.editorHistory?.endUndoAction?.(); } catch { // ignore
        }
        return true;
      } catch {
        return false;
      }
    };

    const pasteFromClipboardWithMode = async (mode: 'source' | 'merge' | 'text' | 'clean'): Promise<boolean> => {
      const ed: any = containerRef.current?.documentEditor as any;
      if (!ed) return false;

      let html = '';
      let plainText = '';

      try {
        plainText = await navigator.clipboard.readText();
      } catch {
        plainText = '';
      }

      try {
        if (typeof navigator.clipboard.read === 'function') {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            if (!html && item.types.includes('text/html')) {
              const blob = await item.getType('text/html');
              html = await blob.text();
            }
            if (!plainText && item.types.includes('text/plain')) {
              const blob = await item.getType('text/plain');
              plainText = await blob.text();
            }
          }
        }
      } catch {
        // ignore and fall back to readText
      }

      try {
        if (mode === 'source') {
          const payload = String(html || '').trim();
          if (payload && typeof ed.editor?.paste === 'function') {
            ed.focusIn?.();
            ed.editor.paste(payload);
            return true;
          }
          return insertTextWithInheritedFormatting(ed, normalizePastedParagraphs(plainText));
        }

        if (mode === 'text') {
          return insertTextWithInheritedFormatting(ed, normalizePlainTextOnly(plainText));
        }

        if (mode === 'clean') {
          const cleanedHtml = stripOfficeMarkup(html);
          const cleanedText = extractStructuredTextFromHtml(cleanedHtml) || normalizePastedParagraphs(plainText);
          return insertTextWithInheritedFormatting(ed, cleanedText);
        }

        const mergedText = normalizePastedParagraphs(plainText) || extractStructuredTextFromHtml(html);
        return insertTextWithInheritedFormatting(ed, mergedText);
      } catch {
        return false;
      }
    };

    useEffect(() => {
      const editor: any = containerRef.current?.documentEditor as any;
      if (!editor) return;
      try {
        const nextName = typeof currentUserName === 'string' && currentUserName.trim() ? currentUserName.trim() : 'Usuário';
        editor.currentUser = nextName;
      } catch {
        // ignore
      }
    }, [currentUserName]); */
        [0, 60, 150, 350, 700].forEach((ms) =>
          window.setTimeout(() => window.requestAnimationFrame(forceResize), ms),
        );

        // Notifica o consumidor (ex.: ribbon customizado) que o editor está pronto
        try {
          onReady?.();
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }

      // ResizeObserver: observa o container E seus wrappers externos, para remedir a folha
      // sempre que o layout mudar (sidebar, fullscreen, ribbon, janela) — não só o elemento interno.
      //
      // `resize()` é caro: refaz o layout do documento inteiro. Como três
      // elementos são observados, o callback chegava até três vezes por
      // mudança, cada uma disparando um relayout completo. Aqui ele só roda
      // quando as dimensões MUDARAM de verdade, e no máximo uma vez por quadro
      // — nunca no meio de uma rolagem, que não altera dimensão nenhuma.
      const rootEl = containerRef.current?.element;
      if (rootEl && typeof ResizeObserver !== 'undefined') {
        let lastWidth = 0;
        let lastHeight = 0;
        let scheduled = 0;

        const observer = new ResizeObserver(() => {
          const width = rootEl.clientWidth;
          const height = rootEl.clientHeight;
          if (width === lastWidth && height === lastHeight) return;
          lastWidth = width;
          lastHeight = height;

          if (scheduled) window.cancelAnimationFrame(scheduled);
          scheduled = window.requestAnimationFrame(() => {
            scheduled = 0;
            const ed: any = containerRef.current?.documentEditor as any;
            if (!ed || typeof ed.resize !== 'function') return;
            ed.resize();
            if (pageFit && typeof ed.fitPage === 'function') {
              ed.fitPage(pageFit as any);
            }
          });
        });

        observer.observe(rootEl);
        if (rootEl.parentElement) observer.observe(rootEl.parentElement);
        if (rootEl.parentElement?.parentElement) observer.observe(rootEl.parentElement.parentElement);
        resizeObserverRef.current = () => {
          observer.disconnect();
          if (scheduled) window.cancelAnimationFrame(scheduled);
        };
      }

      // Alguns builds do Syncfusion iniciam o contextMenu alguns ticks depois
      if (initContextMenu()) return;
      let tries = 0;
      const maxTries = 20;
      const timer = window.setInterval(() => {
        tries += 1;
        if (initContextMenu() || tries >= maxTries) {
          window.clearInterval(timer);
        }
      }, 150);

      flushPendingActions();
    };

    useEffect(() => {
      if (!pageFit) return;
      const editor: any = containerRef.current?.documentEditor as any;
      if (!editor || typeof editor.fitPage !== 'function') return;
      try {
        editor.fitPage(pageFit);
      } catch {
        // ignore
      }
    }, [pageFit]);

    // Configurar documento ao inicializar
    useEffect(() => {
      const editor = containerRef.current?.documentEditor;
      if (editor) {
        // Configurar página A4 com margens padrão (em pontos: 1cm ≈ 28.35pt)
        const sectionFormat = editor.selection?.sectionFormat;
        if (sectionFormat) {
          // A4: 21cm x 29.7cm
          sectionFormat.pageWidth = 595.3; // 21cm em pontos
          sectionFormat.pageHeight = 841.9; // 29.7cm em pontos
          // Margens: 3cm superior/inferior, 3cm esquerda/direita
          sectionFormat.topMargin = 85; // ~3cm
          sectionFormat.bottomMargin = 85;
          sectionFormat.leftMargin = 85;
          sectionFormat.rightMargin = 85;
        }
      }
    }, []);

    useEffect(() => {
      if (!showPropertiesPane) return;
      const container = containerRef.current;
      const rootEl = (container as any)?.element as HTMLElement | undefined;
      if (!rootEl) return;

      const styleId = 'crm-syncfusion-contextmenu-hover-style';
      try {
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `
            .e-contextmenu-container li[id*="crm_insert_block"],
            .e-contextmenu-wrapper li[id*="crm_insert_block"] {
              background-color: #f97316 !important;
            }

            .e-contextmenu-container li[id*="crm_insert_block"] .e-menu-text,
            .e-contextmenu-wrapper li[id*="crm_insert_block"] .e-menu-text {
              color: #ffffff !important;
              font-weight: 600 !important;
            }

            .e-contextmenu-container li[id*="crm_insert_block"] .e-menu-icon,
            .e-contextmenu-wrapper li[id*="crm_insert_block"] .e-menu-icon {
              color: #ffffff !important;
            }

            .e-contextmenu-container li[id*="crm_insert_block"]:hover,
            .e-contextmenu-wrapper li[id*="crm_insert_block"]:hover {
              background-color: #ea580c !important;
            }

            .e-contextmenu-container .e-menu-item:hover,
            .e-contextmenu-wrapper .e-menu-item:hover {
              background-color: #ffedd5 !important;
            }

            .e-contextmenu-container .e-menu-item:hover .e-menu-text,
            .e-contextmenu-wrapper .e-menu-item:hover .e-menu-text {
              color: #9a3412 !important;
            }

            .e-contextmenu-container .e-menu-item:hover .e-menu-icon,
            .e-contextmenu-wrapper .e-menu-item:hover .e-menu-icon {
              color: #9a3412 !important;
            }
          `;
          document.head.appendChild(style);
        }
      } catch {
        // ignore
      }

      let isPinned = false;
      try {
        isPinned = window.localStorage.getItem(PROPERTIES_PANE_PINNED_KEY) === '1';
      } catch {
        isPinned = false;
      }

      const readWidth = () => {
        try {
          const raw = window.localStorage.getItem(PROPERTIES_PANE_WIDTH_KEY);
          const parsed = raw ? Number(raw) : NaN;
          return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PROPERTIES_PANE_WIDTH;
        } catch {
          return DEFAULT_PROPERTIES_PANE_WIDTH;
        }
      };

      const clampWidth = (w: number) => {
        const max = Math.min(MAX_PROPERTIES_PANE_WIDTH, Math.floor(window.innerWidth * 0.65));
        return Math.max(MIN_PROPERTIES_PANE_WIDTH, Math.min(max, w));
      };

      const selectors = [
        '.e-de-pane',
        '.e-de-pane-rtl',
        '.e-de-property-pane',
        '.e-de-ctnr-prop-pane',
        '.e-de-ctn-properties-pane',
      ];

      const findPane = (): HTMLElement | null => {
        for (const s of selectors) {
          const el = rootEl.querySelector(s);
          if (el instanceof HTMLElement) return el;
        }
        return null;
      };

      let handle: HTMLDivElement | null = null;
      let pane: HTMLElement | null = null;
      let textHeaderEl: HTMLElement | null = null;
      let pinButton: HTMLButtonElement | null = null;
      let armed = false;
      let dragging = false;
      let isCollapsed = !isPinned;
      let startX = 0;
      let startWidth = 0;
      const DRAG_THRESHOLD_PX = 3;

      const setButtonLabel = () => {
        if (!pinButton) return;
        if (isPinned) {
          pinButton.textContent = '⟵';
          pinButton.title = 'Recolher painel'
        } else {
          pinButton.textContent = '⟶';
          pinButton.title = 'Fixar painel aberto'
        }
      };

      const applyCollapsed = () => {
        if (!pane) return;
        isCollapsed = true;
        pane.style.width = `${PROPERTIES_PANE_COLLAPSED_WIDTH}px`;
        pane.style.minWidth = `${PROPERTIES_PANE_COLLAPSED_WIDTH}px`;
        pane.style.maxWidth = `${PROPERTIES_PANE_COLLAPSED_WIDTH}px`;
        pane.style.overflow = 'hidden';
        pane.setAttribute('data-prop-collapsed', '1');
      };

      const applyExpanded = (w?: number) => {
        if (!pane) return;
        isCollapsed = false;
        pane.style.maxWidth = '';
        pane.style.overflowY = 'auto';
        pane.style.overflowX = 'hidden';
        pane.removeAttribute('data-prop-collapsed');
        if (typeof w === 'number') applyWidth(w);
        else applyWidth(readWidth());
      };

      const applyWidth = (w: number) => {
        if (!pane) return;
        const next = clampWidth(w);
        pane.style.width = `${next}px`;
        pane.style.minWidth = `${MIN_PROPERTIES_PANE_WIDTH}px`;
        try {
          window.localStorage.setItem(PROPERTIES_PANE_WIDTH_KEY, String(next));
        } catch {
          // ignore
        }
      };

      const armDrag = (e: MouseEvent, preventDefault: boolean) => {
        if (!pane) return;
        armed = true;
        dragging = false;
        startX = e.clientX;
        startWidth = pane.getBoundingClientRect().width;
        if (preventDefault) e.preventDefault();
      };

      const onSplitterMouseDown = (e: MouseEvent) => {
        armDrag(e, true);
      };

      const onTextHeaderMouseDown = (e: MouseEvent) => {
        // Não bloquear o clique normal do header (troca de aba) — só vira drag se mover.
        armDrag(e, false);
      };

      const onMouseMove = (e: MouseEvent) => {
        if (!armed) return;
        const deltaAbs = Math.abs(startX - e.clientX);
        if (!dragging) {
          if (deltaAbs < DRAG_THRESHOLD_PX) return;
          dragging = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }
        const delta = startX - e.clientX;
        applyWidth(startWidth + delta);
        e.preventDefault();
      };

      const onMouseUp = () => {
        if (!armed) return;
        armed = false;
        if (!dragging) {
          dragging = false;
          return;
        }
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      const attachSplitter = () => {
        pane = findPane();
        if (!pane) return false;

        // Evitar duplicar
        if (pane.querySelector('[data-syncfusion-prop-splitter="true"]')) return true;

        if (!pinButton) {
          pinButton = document.createElement('button');
          pinButton.type = 'button';
          pinButton.setAttribute('data-syncfusion-prop-pin', 'true');
          pinButton.style.position = 'absolute';
          pinButton.style.top = '6px';
          pinButton.style.left = '8px';
          pinButton.style.width = '24px';
          pinButton.style.height = '24px';
          pinButton.style.borderRadius = '6px';
          pinButton.style.border = '1px solid rgba(226,232,240,1)';
          pinButton.style.background = 'rgba(255,255,255,0.95)';
          pinButton.style.color = '#475569';
          pinButton.style.fontSize = '14px';
          pinButton.style.lineHeight = '1';
          pinButton.style.cursor = 'pointer';
          pinButton.style.zIndex = '60';
          pinButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            isPinned = !isPinned;
            try {
              window.localStorage.setItem(PROPERTIES_PANE_PINNED_KEY, isPinned ? '1' : '0');
            } catch {
              // ignore
            }

            if (isPinned) {
              applyExpanded();
            } else {
              applyCollapsed();
            }
            setButtonLabel();
          });
        }

        setButtonLabel();

        if (isPinned) {
          applyExpanded(readWidth());
        } else {
          applyExpanded(readWidth());
          applyCollapsed();
        }

        handle = document.createElement('div');
        handle.setAttribute('data-syncfusion-prop-splitter', 'true');
        handle.style.position = 'absolute';
        handle.style.left = '0';
        handle.style.top = '0';
        handle.style.width = '6px';
        handle.style.height = '100%';
        handle.style.cursor = 'col-resize';
        handle.style.background = 'transparent';
        handle.style.zIndex = '50';

        // Área de “pegada” um pouco mais visível no hover
        handle.addEventListener('mouseenter', () => {
          if (handle) handle.style.background = 'rgba(251, 191, 36, 0.25)';
        });
        handle.addEventListener('mouseleave', () => {
          if (handle) handle.style.background = 'transparent';
        });

        if (getComputedStyle(pane).position === 'static') {
          pane.style.position = 'relative';
        }

        if (!pane.querySelector('[data-syncfusion-prop-pin="true"]')) {
          pane.appendChild(pinButton);
        }

        pane.addEventListener('mouseenter', () => {
          if (!pane) return;
          if (isPinned) return;
          if (!isCollapsed) return;
          applyExpanded();
        });

        pane.addEventListener('mouseleave', () => {
          if (!pane) return;
          if (isPinned) return;
          if (isCollapsed) return;
          applyCollapsed();
        });
        pane.appendChild(handle);

        handle.addEventListener('mousedown', onSplitterMouseDown);

        // Permitir arrastar também pelo cabeçalho "TEXT"
        const textCandidates = Array.from(
          pane.querySelectorAll<HTMLElement>('div,span,button,a')
        ).filter((el) => {
          const t = (el.textContent || '').trim();
          return t.length > 0 && (t.toLowerCase() === 'text' || t.toLowerCase() === 'texto');
        });

        textHeaderEl = textCandidates[0] || null;
        if (textHeaderEl && !textHeaderEl.hasAttribute('data-syncfusion-prop-text-drag')) {
          textHeaderEl.setAttribute('data-syncfusion-prop-text-drag', 'true');
          textHeaderEl.style.cursor = 'col-resize';
          textHeaderEl.addEventListener('mousedown', onTextHeaderMouseDown);
        }
        return true;
      };

      // Tenta imediato; se ainda não existir, observa o DOM
      attachSplitter();

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      const observer = new MutationObserver(() => {
        attachSplitter();
      });
      observer.observe(rootEl, { childList: true, subtree: true });

      return () => {
        observer.disconnect();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (handle) {
          handle.removeEventListener('mousedown', onSplitterMouseDown);
          if (handle.parentElement) handle.parentElement.removeChild(handle);
        }
        if (textHeaderEl) {
          textHeaderEl.removeEventListener('mousedown', onTextHeaderMouseDown);
        }
        if (pinButton) {
          try {
            pinButton.remove();
          } catch {
            // ignore
          }
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }, [showPropertiesPane]);

    useEffect(() => {
      if (readOnly || !isCreated) return;
      const editor: any = containerRef.current?.documentEditor as any;
      const documentHelper: any = editor?.documentHelper;
      // O Syncfusion anexa o alvo de input (editableDiv) em document.body — ou dentro
      // de um iframe —, NUNCA dentro do container do editor. Um listener no wrapper
      // não recebe o evento de paste; ele precisa ir no próprio editableDiv.
      const editableDiv: HTMLElement | null = documentHelper?.editableDiv ?? null;
      const nativeOnPaste: ((e: ClipboardEvent) => void) | undefined = documentHelper?.onPaste;
      if (!editableDiv || typeof nativeOnPaste !== 'function') return;

      let lastInternalCopy = '';
      const normalizeForCompare = (t: string) => t.replace(/\s+/g, ' ').trim();
      const shouldKeepRichFormatting = (html: string, clipboard?: DataTransfer | null) => {
        const rawHtml = String(html || '').trim();
        if (!rawHtml) return false;

        const types = Array.from(clipboard?.types || []).map((t) => String(t).toLowerCase());
        if (types.includes('text/rtf') || types.includes('application/rtf')) return true;

        const normalized = rawHtml.toLowerCase();
        return (
          normalized.includes('mso-') ||
          normalized.includes('urn:schemas-microsoft-com') ||
          normalized.includes('office:word') ||
          normalized.includes('<style') ||
          normalized.includes('<table') ||
          normalized.includes('<ul') ||
          normalized.includes('<ol') ||
          normalized.includes('<img') ||
          /<(span|p|div|font)[^>]*style=/.test(normalized)
        );
      };

      const handleCopy = () => {
        try {
          lastInternalCopy = normalizeForCompare(String(editor?.selection?.text || ''));
        } catch {
          lastInternalCopy = '';
        }
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        // Ctrl+Shift+V = colar mantendo a formatação de origem (pipeline nativo)
        if (e.ctrlKey && e.shiftKey && String(e.key).toLowerCase() === 'v') {
          forcedPasteModeRef.current = 'text';
        }
      };

      const handlePaste = (event: ClipboardEvent) => {
        const ed: any = containerRef.current?.documentEditor as any;
        const runNative = () => {
          try {
            nativeOnPaste.call(documentHelper, event);
          } catch {
            // ignore
          }
        };

        if (!ed?.editor || typeof ed.editor.insertText !== 'function') {
          runNative();
          return;
        }

        const clipboard = event.clipboardData;
        const html = clipboard?.getData('text/html') || '';
        const plainText = clipboard?.getData('text/plain') || '';
        const forcedPasteMode = forcedPasteModeRef.current;
        forcedPasteModeRef.current = null;

        if (forcedPasteMode === 'source') {
          runNative();
          return;
        }

        if (forcedPasteMode === 'text') {
          const text = normalizePlainTextOnly(plainText);
          if (!text.trim()) {
            runNative();
            return;
          }
          event.preventDefault();
          insertTextWithInheritedFormatting(ed, text);
          return;
        }

        if (forcedPasteMode === 'merge') {
          const text = normalizePastedParagraphs(plainText) || extractStructuredTextFromHtml(html);
          if (!text.trim()) {
            runNative();
            return;
          }
          event.preventDefault();
          insertTextWithInheritedFormatting(ed, text);
          return;
        }

        if (forcedPasteMode === 'clean') {
          const cleanedHtml = stripOfficeMarkup(html);
          const text = extractStructuredTextFromHtml(cleanedHtml) || normalizePastedParagraphs(plainText);
          if (!text.trim()) {
            runNative();
            return;
          }
          event.preventDefault();
          insertTextWithInheritedFormatting(ed, text);
          return;
        }

        // Conteúdo copiado do próprio editor: colagem nativa preserva a
        // formatação original do documento com fidelidade total.
        if (plainText && lastInternalCopy && normalizeForCompare(plainText) === lastInternalCopy) {
          runNative();
          return;
        }

        // Conteúdo rico do Word/RTF/HTML formatado deve seguir o pipeline nativo
        // do Syncfusion para preservar estilo, listas, tabelas e demais marcas.
        // O pipeline nativo é uma ida ao SERVIDOR — ver RICH_PASTE_MAX_BYTES.
        if (shouldKeepRichFormatting(html, clipboard)) {
          // Colar como texto, com a formatação do cursor. É o plano B tanto do
          // conteúdo grande demais quanto do servidor que não respondeu.
          const colarComoTexto = (motivo: string): boolean => {
            const fallbackText = extractStructuredTextFromHtml(html) || normalizePastedParagraphs(plainText);
            if (!fallbackText.trim()) return false;
            const inserido = insertTextWithInheritedFormatting(ed, fallbackText);
            if (inserido) showEditorNotice(motivo);
            return inserido;
          };

          // Quando existe RTF na área de transferência (é o caso do Word), é o
          // RTF que o Syncfusion manda — e ele costuma ser bem maior que o HTML.
          const rtf = clipboard?.getData('text/rtf') || clipboard?.getData('application/rtf') || '';
          const bytesQueVaoSubir = rtf ? rtf.length : html.length;

          if (bytesQueVaoSubir > RICH_PASTE_MAX_BYTES) {
            event.preventDefault();
            if (colarComoTexto(
              `Colado como texto: são ${formatMegabytes(bytesQueVaoSubir)} de conteúdo formatado, `
              + 'e a conversão desse tamanho trava o editor. O texto veio inteiro — a formatação, não.',
            )) return;
            // Sem texto para cair de volta, o caminho nativo ainda é melhor que nada.
          }

          runNative();

          // A partir daqui o Syncfusion está esperando o servidor SEM prazo.
          // O cão de guarda é quem devolve a tela se a resposta não vier.
          if (richPasteWatchdogRef.current !== null) window.clearTimeout(richPasteWatchdogRef.current);
          richPasteWatchdogRef.current = window.setTimeout(() => {
            richPasteWatchdogRef.current = null;
            const pendente: any = ed?.editor?.pasteRequestHandler?.xmlHttpRequest;
            if (!pendente || pendente.readyState === 4) return;
            // Abortar faz a própria biblioteca cair no onPasteFailure e baixar
            // o spinner; o forceHide cobre o caso de o abort não avisar.
            try { pendente.abort(); } catch { /* ignore */ }
            forceHideEditorSpinner(ed);
            if (!colarComoTexto(
              'O servidor de documentos não respondeu a tempo. Colei o conteúdo como texto, sem formatação.',
            )) {
              showEditorNotice('O servidor de documentos não respondeu a tempo e a colagem foi cancelada.');
            }
          }, RICH_PASTE_TIMEOUT_MS);
          return;
        }

        const text = extractStructuredTextFromHtml(html) || normalizePastedParagraphs(plainText);
        if (!text.trim()) {
          runNative();
          return;
        }

        // Conteúdo externo: inserir herdando fonte/tamanho/alinhamento/espaçamento
        // do ponto atual do cursor, com parágrafos reais.
        event.preventDefault();
        try {
          ed.focusIn?.();
          const sel: any = ed.selection;
          const cf: any = sel?.characterFormat;
          const pf: any = sel?.paragraphFormat;
          // Captura a formatação vigente no cursor ANTES de inserir — o insertText
          // multi-parágrafo do Syncfusion não a propaga de forma consistente para
          // os parágrafos criados pelos '\n'.
          const inherit = {
            fontFamily: cf?.fontFamily,
            fontSize: cf?.fontSize,
            bold: cf?.bold,
            italic: cf?.italic,
            underline: cf?.underline,
            fontColor: cf?.fontColor,
            textAlignment: pf?.textAlignment,
            firstLineIndent: pf?.firstLineIndent,
            leftIndent: pf?.leftIndent,
            rightIndent: pf?.rightIndent,
            lineSpacing: pf?.lineSpacing,
            lineSpacingType: pf?.lineSpacingType,
            beforeSpacing: pf?.beforeSpacing,
            afterSpacing: pf?.afterSpacing,
          };
          const startOffset = String(sel?.startOffset || '');

          try { ed.editorHistory?.beginUndoAction?.(); } catch { /* ignore */ }
          ed.editor.insertText(text);

          // Reaplica a formatação do cursor em todo o intervalo inserido para
          // garantir uniformidade entre os parágrafos colados.
          const endOffset = String(sel?.endOffset || '');
          if (sel && startOffset && endOffset && startOffset !== endOffset) {
            sel.select(startOffset, endOffset);
            const scf: any = sel.characterFormat;
            const spf: any = sel.paragraphFormat;
            if (scf) {
              if (typeof inherit.fontFamily === 'string' && inherit.fontFamily) scf.fontFamily = inherit.fontFamily;
              if (typeof inherit.fontSize === 'number' && inherit.fontSize > 0) scf.fontSize = inherit.fontSize;
              if (typeof inherit.bold === 'boolean') scf.bold = inherit.bold;
              if (typeof inherit.italic === 'boolean') scf.italic = inherit.italic;
              if (typeof inherit.underline === 'string') scf.underline = inherit.underline;
              if (typeof inherit.fontColor === 'string' && inherit.fontColor) scf.fontColor = inherit.fontColor;
            }
            if (spf) {
              if (typeof inherit.textAlignment === 'string' && inherit.textAlignment) spf.textAlignment = inherit.textAlignment;
              if (typeof inherit.firstLineIndent === 'number') spf.firstLineIndent = inherit.firstLineIndent;
              if (typeof inherit.leftIndent === 'number') spf.leftIndent = inherit.leftIndent;
              if (typeof inherit.rightIndent === 'number') spf.rightIndent = inherit.rightIndent;
              if (typeof inherit.lineSpacingType === 'string' && inherit.lineSpacingType) spf.lineSpacingType = inherit.lineSpacingType;
              if (typeof inherit.lineSpacing === 'number' && inherit.lineSpacing > 0) spf.lineSpacing = inherit.lineSpacing;
              if (typeof inherit.beforeSpacing === 'number') spf.beforeSpacing = inherit.beforeSpacing;
              if (typeof inherit.afterSpacing === 'number') spf.afterSpacing = inherit.afterSpacing;
            }
            sel.select(endOffset, endOffset);
          }
          try { ed.editorHistory?.endUndoAction?.(); } catch { /* ignore */ }
        } catch {
          // ignore
        }
      };

      // O handler nativo foi registrado primeiro no mesmo elemento e rodaria antes
      // do nosso — removê-lo e delegar via runNative() apenas quando apropriado.
      editableDiv.removeEventListener('paste', nativeOnPaste as EventListener);
      editableDiv.addEventListener('paste', handlePaste);
      editableDiv.addEventListener('copy', handleCopy);
      editableDiv.addEventListener('cut', handleCopy);
      editableDiv.addEventListener('keydown', handleKeyDown, true);

      return () => {
        editableDiv.removeEventListener('paste', handlePaste);
        editableDiv.removeEventListener('copy', handleCopy);
        editableDiv.removeEventListener('cut', handleCopy);
        editableDiv.removeEventListener('keydown', handleKeyDown, true);
        editableDiv.addEventListener('paste', nativeOnPaste as EventListener);
      };
    }, [readOnly, isCreated]);

    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <DocumentEditorContainerComponent
          ref={containerRef}
          id={id}
          height={height}
          serviceUrl={SYNCFUSION_SERVICE_URL}
          headers={syncfusionHeaders}
          enableToolbar={enableToolbar}
          toolbarItems={(toolbarItems ?? TOOLBAR_ITEMS) as any}
          showPropertiesPane={showPropertiesPane}
          enableLocalPaste={false}
          enableSpellCheck={true}
          beforeXmlHttpRequestSend={(args: any) => {
            if (syncfusionHeaders.length === 0) return;
            args.headers = Array.isArray(args.headers) ? [...args.headers, ...syncfusionHeaders] : [...syncfusionHeaders];
          }}
          serviceFailure={handleCollabServiceFailure}
          created={handleCreated}
          documentEditorSettings={{
            showRuler: !!(showRuler && isCreated),
            showNavigationPane: !!(showNavigationPane && isCreated),
          }}
          layoutType={layoutType}
          contentChange={handleContentChange}
          documentChange={handleDocumentChange}
          locale="pt-BR"
          style={{ display: 'block', width: '100%', height: '100%' }}
        />

        {/* A revisão contextual não tem UI própria de propósito: o resultado
            chega como sublinhado vermelho e correção no menu do botão direito,
            igual ao corretor do Word. Sem aviso de análise em andamento. */}

      </div>
    );
  }
);

SyncfusionEditor.displayName = 'SyncfusionEditor';

export default SyncfusionEditor;
