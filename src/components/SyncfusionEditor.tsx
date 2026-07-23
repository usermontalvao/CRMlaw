// Syncfusion Document Editor Component
// Wrapper para o DocumentEditorContainerComponent com funcionalidades de petição

import React, { useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import type { MenuItemModel } from '@syncfusion/ej2-navigations';
import { L10n, registerLicense, setCulture } from '@syncfusion/ej2-base';
import * as EJ2_PT_LOCALE from '@syncfusion/ej2-locale/src/pt.json';
import {
  DocumentEditorContainerComponent,
  Toolbar,
} from '@syncfusion/ej2-react-documenteditor';
import '../styles/syncfusion-editor.css';
import {
  getCachedSuggestions,
  setCachedSuggestions,
  schedulePrefetch,
  pruneExpiredEntries,
} from './spell-check-cache';
import {
  createDebouncedScanner,
  autoFixIssues,
  type ScanResult,
} from './editor-issues-scanner';
import { attachLocalSpellChecker } from './local-spell-checker';
import { supabase } from '../config/supabase';

// Prune entradas expiradas na inicialização do módulo
pruneExpiredEntries();

const syncfusionLicenseKey = String(import.meta.env.VITE_SYNCFUSION_LICENSE_KEY || '').trim();
if (syncfusionLicenseKey) {
  registerLicense(syncfusionLicenseKey);
}

// Inject required modules
DocumentEditorContainerComponent.Inject(Toolbar);

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

const SYNCFUSION_SERVICE_URL =
  String(import.meta.env.VITE_SYNC_FUSION || '').trim() ||
  'https://document.syncfusion.com/web-services/docx-editor/api/documenteditor/';

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
      'Não foi possível importar o DOCX porque o serviço de conversão bloqueou a requisição (CORS/rede). Configure `VITE_SYNC_FUSION` com um endpoint próprio do DocumentEditor acessível pelo navegador.'
    );
  }

  if (message.includes('504') || message.includes('gateway timeout') || message.includes('timeout')) {
    return new Error(
      'O serviço de conversão DOCX do Syncfusion demorou demais para responder. Tente novamente ou configure `VITE_SYNC_FUSION` com um endpoint próprio mais estável.'
    );
  }

  if (message.includes('404') || raw.includes('404')) {
    return new Error(
      'O proxy de importação do Syncfusion não foi encontrado. Verifique se a Edge Function `syncfusion-import` está publicada no Supabase ou configure `VITE_SYNC_FUSION` com um endpoint válido.'
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

const applySyncfusionServiceUrl = (editor: any) => {
  if (!editor) return;
  try {
    editor.serviceUrl = SYNCFUSION_SERVICE_URL;
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

  // Só patchear uma vez
  if ((ctxModule as any).__spellPatchApplied) return;
  (ctxModule as any).__spellPatchApplied = true;

  if (typeof ctxModule.onContextMenuInternal !== 'function') return;

  // Helper: injeta sugestões de spell no DOM do menu já aberto.
  // Word: a palavra com erro. Suggestions: array de strings.
  const injectSpellSuggestions = (suggestions: string[], word: string) => {
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
        li.setAttribute('role', 'menuitem');
        li.innerHTML = '<span class="e-menu-icon"></span><span class="e-menu-text" style="font-style:italic;color:#888">Nenhuma sugestão</span>';
        items.push(li);
      } else {
        for (const sug of suggestions.slice(0, 5)) {
          const li = document.createElement('li');
          li.className = 'e-menu-item';
          li.setAttribute('data-spell-suggestion', '1');
          li.setAttribute('role', 'menuitem');
          li.setAttribute('tabindex', '-1');
          const escaped = sug.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
          li.innerHTML = `<span class="e-menu-icon"></span><span class="e-menu-text" style="font-weight:600">${escaped}</span>`;

          // Click: substituir a palavra errada pela sugestão
          li.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            try {
              // Selecionar a palavra e substituir
              const sel = editor.selection;
              if (sel) {
                // Tentar usar a API do spell checker para substituir
                const info = spellChecker?.currentContextInfo;
                if (info?.element && typeof spellChecker?.manageReplace === 'function') {
                  spellChecker.manageReplace(sug, info.element);
                } else if (typeof editor.editor?.insertText === 'function') {
                  // Selecionar palavra atual e substituir
                  sel.selectCurrentWord?.();
                  editor.editor.insertText(sug);
                }
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
        }
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

  // Helper: injeta skeleton de loading enquanto sugestões são buscadas da API
  const injectLoadingSkeleton = () => {
    try {
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

      // Remover sugestões/skeletons antigos
      ul.querySelectorAll('[data-spell-suggestion]').forEach((el) => el.remove());

      // Injetar keyframes uma vez
      if (!document.getElementById('spell-skeleton-keyframes')) {
        const style = document.createElement('style');
        style.id = 'spell-skeleton-keyframes';
        style.textContent = `
          @keyframes spellShimmer {
            0% { background-position: -200px 0; }
            100% { background-position: 200px 0; }
          }
          .spell-skeleton-bar {
            display: inline-block;
            height: 12px;
            border-radius: 3px;
            background: linear-gradient(90deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%);
            background-size: 400px 100%;
            animation: spellShimmer 1.2s ease-in-out infinite;
          }
        `;
        document.head.appendChild(style);
      }

      // Criar 3 linhas de skeleton com larguras variadas
      const widths = [80, 100, 70];
      const items: HTMLElement[] = [];
      for (const w of widths) {
        const li = document.createElement('li');
        li.className = 'e-menu-item e-disabled';
        li.setAttribute('data-spell-suggestion', '1');
        li.setAttribute('role', 'menuitem');
        li.innerHTML = `<span class="e-menu-icon"></span><span class="e-menu-text"><span class="spell-skeleton-bar" style="width:${w}px"></span></span>`;
        items.push(li);
      }
      // Separador
      const sep = document.createElement('li');
      sep.className = 'e-separator e-menu-item';
      sep.setAttribute('data-spell-suggestion', '1');
      items.push(sep);

      // Inserir no topo
      for (let i = items.length - 1; i >= 0; i--) {
        ul.insertBefore(items[i], ul.firstChild);
      }
    } catch (err) {
      console.warn('[SyncfusionEditor] injectLoadingSkeleton erro:', err);
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
          return (json.Suggestions || []) as string[];
        } catch {
          return [];
        }
      })
      .catch(() => []);
  };

  // Helper: detecta se o clique foi em palavra errada e busca sugestões
  const tryFetchSpellSuggestions = () => {
    try {
      if (!spellChecker || !editor.isSpellCheck) return;
      if (!spellChecker.allowSpellCheckAndSuggestion) return;

      const info = typeof spellChecker.findCurretText === 'function' ? spellChecker.findCurretText() : null;
      if (!info?.text) return;
      const word = typeof spellChecker.manageSpecialCharacters === 'function'
        ? spellChecker.manageSpecialCharacters(info.text, undefined, true)
        : info.text;
      if (!word) return;

      // Só é palavra errada se está no errorWordCollection
      const errorColl = spellChecker.errorWordCollection;
      if (!errorColl || typeof errorColl.containsKey !== 'function' || !errorColl.containsKey(word)) return;

      spellChecker.currentContextInfo = info;

      // === Camada 1: cache do Syncfusion (mesma sessão) ===
      const sfCache = spellChecker.errorSuggestions;
      if (sfCache?.containsKey?.(word)) {
        injectSpellSuggestions((sfCache.get(word) || []).slice(), word);
        return;
      }

      // === Camada 2: nosso cache (memória + localStorage) ===
      const cached = getCachedSuggestions(word);
      if (cached !== null) {
        // Hidrata cache do Syncfusion também para evitar re-busca posterior
        try { sfCache?.add?.(word, cached.slice()); } catch { /* ignore */ }
        injectSpellSuggestions(cached.slice(), word);
        return;
      }

      // === Camada 3: API (XHR) — mostra skeleton enquanto carrega ===
      injectLoadingSkeleton();
      fetchSuggestionsFromAPI(word).then((suggestions) => {
        setCachedSuggestions(word, suggestions);
        try { sfCache?.add?.(word, suggestions.slice()); } catch { /* ignore */ }
        injectSpellSuggestions(suggestions, word);
      });
    } catch (err) {
      console.warn('[SyncfusionEditor] tryFetchSpellSuggestions erro:', err);
    }
  };

  // Pre-fetch em background: quando o spell-check encontra erros novos, agenda
  // busca de sugestões antes mesmo do usuário clicar. Hook no spellChecker.handleSpellCheck.
  const setupPrefetch = () => {
    if (!spellChecker || (spellChecker as any).__prefetchHooked) return;
    (spellChecker as any).__prefetchHooked = true;

    // Hook em addInvalidElementsToCollection (chamado quando spell-check marca palavra como erro)
    const origAdd = spellChecker.addInvalidElementsToCollection;
    if (typeof origAdd === 'function') {
      spellChecker.addInvalidElementsToCollection = function (...args: any[]) {
        const result = origAdd.apply(this, args);
        try {
          // args[0] geralmente é a info da palavra; tentar extrair texto
          const errArg = args[0];
          const errText = typeof errArg === 'string' ? errArg : errArg?.text || errArg?.Text;
          if (errText && typeof errText === 'string' && errText.length > 1) {
            schedulePrefetch(errText, () => fetchSuggestionsFromAPI(errText));
          }
        } catch { /* ignore */ }
        return result;
      };
    }
  };
  setupPrefetch();

  ctxModule.onContextMenuInternal = function patchedOnContextMenu(event: any) {
    try {
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
  replaceAll: (searchText: string, replaceText: string) => boolean;
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
    },
    ref
  ) => {
    const containerRef = useRef<DocumentEditorContainerComponent | null>(null);
    const contextMenuInitRef = useRef(false);
    const createdRef = useRef(false);
    const pendingActionsRef = useRef<(() => void)[]>([]);
    const lastContextMenuPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const scannerRef = useRef<{ trigger: () => void; cancel: () => void } | null>(null);
    const forcedPasteModeRef = useRef<'smart' | 'source' | 'merge' | 'text' | 'clean' | null>(null);
    const [isCreated, setIsCreated] = useState(false);
    const [scanResult, setScanResult] = useState<ScanResult>({ issues: [], totalOccurrences: 0 });
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

    // Cleanup do scanner no unmount
    useEffect(() => {
      return () => {
        scannerRef.current?.cancel();
        scannerRef.current = null;
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

    useImperativeHandle(ref, () => ({
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
            setTimeout(() => {
              try { initContextMenu(); } catch { /* ignore */ }
              try { (editor as any).focusIn?.(); } catch { /* ignore */ }
            }, 300);
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
          // Após carregar DOCX: re-registrar menu de contexto e restaurar foco
          setTimeout(() => {
            try { initContextMenu(); } catch { /* ignore */ }
            try { editor.focusIn?.(); } catch { /* ignore */ }
          }, 300);
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
              window.setTimeout(() => resolve(), 150);
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
        const editor = containerRef.current?.documentEditor;
        if (!editor) return false;
        try {
          const selection = editor.selection;
          if (!selection) return false;
          selection.selectAll();
          const hasText = (selection.text || '').trim().length > 0;
          selection.moveToDocumentStart();
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

      replaceAll: (searchText: string, replaceText: string) => {
        const editor: any = containerRef.current?.documentEditor as any;
        if (!editor) return false;
        try {
          const s = (searchText || '').toString();
          const r = (replaceText ?? '').toString();
          if (!s.trim()) return false;
          const search = editor.search ?? (editor as any).searchModule;
          if (!search) return false;
          // API pública do EJ2: findAll popula searchResults e replaceAll do
          // SearchResults troca todas as ocorrências preservando a formatação.
          // (search.replaceAll direto é método interno com outra assinatura e
          // lança exceção quando chamado com (texto, substituto).)
          if (search.searchResults && typeof search.findAll === 'function') {
            search.findAll(s);
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

    const handleContentChange = () => {
      onContentChange?.();
      // Dispara scanner de issues (espaços duplos, etc.) com debounce
      scannerRef.current?.trigger();
    };

    // Aplica todas as correções de issues (espaços duplos, etc.)
    const fixAllIssues = () => {
      const editor: any = containerRef.current?.documentEditor as any;
      if (!editor) return 0;
      const fixed = autoFixIssues(editor, scanResult.issues);
      // Re-escanear para atualizar UI
      scannerRef.current?.trigger();
      return fixed;
    };

    const handleDocumentChange = () => {
      onDocumentChange?.();

      const editor: any = containerRef.current?.documentEditor as any;
      if (!editor) return;

      // Re-registra handlers e restaura foco após document load.
      // O Syncfusion reseta customContextMenuSelect / customContextMenuBeforeOpen
      // quando editor.open() é chamado — sem foco o clique direito não abre.
      window.setTimeout(() => {
        try { initContextMenu(); } catch { /* ignore */ }
        try { patchContextMenuForSpellCheck(editor); } catch { /* ignore */ }
        try { editor.focusIn?.(); } catch { /* ignore */ }
      }, 250);

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

      // Adiciona os itens apenas uma vez (addCustomMenu gera duplicatas se chamado de novo)
      if (!contextMenuInitRef.current) {
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
        editor.contextMenu.addCustomMenu(menuItemsDef, false, true);
        contextMenuInitRef.current = true;
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

            menuItems.forEach((li, idx) => {
              const t = normText(li);
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
                sep.style.display = 'none';
              });
            });

            // ── Reposicionar o menu para abrir PARA BAIXO a partir do clique ──
            // setTimeout garante que rodamos depois do posicionamento do Syncfusion.
            const pos = lastContextMenuPosRef.current;
            if (pos.y > 0) {
              visibleWrappers.forEach((w) => {
                // Forçar position:fixed para que top/left sejam relativos ao viewport
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

      return true;
    };

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
            editor.spellChecker.doOptimizedSpellCheck = true;
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

        // Inicializa scanner de issues (espaços duplos, espaço antes de pontuação)
        try {
          scannerRef.current = createDebouncedScanner(editor, (result) => {
            setScanResult(result);
          }, 1500);
        } catch {
          // ignore
        }

        // Patch do ruler: mostrar valores em CM em vez de pontos
        try {
          patchRulerForCentimeters(editor);
        } catch {
          // ignore
        }

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
      const rootEl = containerRef.current?.element;
      if (rootEl && typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => {
          const ed: any = containerRef.current?.documentEditor as any;
          if (ed && typeof ed.resize === 'function') {
            ed.resize();
            if (pageFit && typeof ed.fitPage === 'function') {
              ed.fitPage(pageFit as any);
            }
          }
        });
        observer.observe(rootEl);
        if (rootEl.parentElement) observer.observe(rootEl.parentElement);
        if (rootEl.parentElement?.parentElement) observer.observe(rootEl.parentElement.parentElement);
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
        if (shouldKeepRichFormatting(html, clipboard)) {
          runNative();
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

        {/* Badge de issues — espaços duplos, espaço antes de pontuação, etc. */}
        {scanResult.totalOccurrences > 0 && (
          <button
            onClick={fixAllIssues}
            title={scanResult.issues.map((i) => i.label).join(' · ')}
            style={{
              position: 'absolute',
              bottom: 16,
              right: 24,
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              borderRadius: 999,
              border: '1px solid rgba(245, 158, 11, 0.4)',
              background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)',
              color: '#9a3412',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.15)',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 6px 16px rgba(245, 158, 11, 0.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(245, 158, 11, 0.15)';
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 18,
                height: 18,
                lineHeight: '18px',
                textAlign: 'center',
                borderRadius: '50%',
                background: '#f59e0b',
                color: 'white',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {scanResult.totalOccurrences}
            </span>
            <span>
              {scanResult.totalOccurrences === 1
                ? 'issue de formatação · corrigir'
                : 'issues de formatação · corrigir todas'}
            </span>
          </button>
        )}
      </div>
    );
  }
);

SyncfusionEditor.displayName = 'SyncfusionEditor';

export default SyncfusionEditor;
