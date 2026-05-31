// Syncfusion Document Editor Component
// Wrapper para o DocumentEditorContainerComponent com funcionalidades de petição

import React, { useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import type { MenuItemModel } from '@syncfusion/ej2-navigations';
import { L10n, setCulture } from '@syncfusion/ej2-base';
import * as EJ2_PT_LOCALE from '@syncfusion/ej2-locale/src/pt.json';
import {
  DocumentEditorContainerComponent,
  Toolbar,
} from '@syncfusion/ej2-react-documenteditor';
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

// Prune entradas expiradas na inicialização do módulo
pruneExpiredEntries();

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

const applySyncfusionServiceUrl = (editor: any) => {
  if (!editor) return;
  try {
    editor.serviceUrl = SYNCFUSION_SERVICE_URL;
  } catch {
    // ignore
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
  // Force editor to refresh its layout and repaint
  refresh: () => void;
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
    },
    ref
  ) => {
    const containerRef = useRef<DocumentEditorContainerComponent | null>(null);
    const contextMenuInitRef = useRef(false);
    const createdRef = useRef(false);
    const pendingActionsRef = useRef<(() => void)[]>([]);
    const lastContextMenuPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const scannerRef = useRef<{ trigger: () => void; cancel: () => void } | null>(null);
    const [isCreated, setIsCreated] = useState(false);
    const [scanResult, setScanResult] = useState<ScanResult>({ issues: [], totalOccurrences: 0 });

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
          if (editor.search && typeof editor.search.replaceAll === 'function') {
            editor.search.replaceAll(s, r);
            return true;
          }
          const searchModule = (editor as any).searchModule;
          if (searchModule && typeof searchModule.replaceAll === 'function') {
            searchModule.replaceAll(s, r);
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
    }));

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

        // Configurar corretor ortográfico
        try {
          if (editor?.spellChecker) {
            editor.spellChecker.languageID = 1046; // Português (Brasil)
            editor.spellChecker.allowSpellCheckAndSuggestion = true;
            editor.spellChecker.doOptimizedSpellCheck = true;
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

        // Forçar resize inicial
        setTimeout(() => {
          if (typeof editor?.resize === 'function') editor.resize();
          if (pageFit && typeof editor?.fitPage === 'function') {
            editor.fitPage(pageFit as any);
          }
        }, 100);
      } catch {
        // ignore
      }

      // Adicionar ResizeObserver para garantir que o editor se ajuste ao container
      const rootEl = containerRef.current?.element;
      if (rootEl && typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => {
          const editor: any = containerRef.current?.documentEditor as any;
          if (editor && typeof editor.resize === 'function') {
            editor.resize();
            if (pageFit && typeof editor.fitPage === 'function') {
              editor.fitPage(pageFit as any);
            }
          }
        });
        observer.observe(rootEl);
        // Guardar no ref para limpar depois se necessário, mas como o componente é desmontado, o DOM limpa
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
        '.e-de-ctnr-properties-pane',
        '.e-de-ctnr-propertiespane',
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
    }, []);

    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <DocumentEditorContainerComponent
          ref={containerRef}
          id={id}
          height={height}
          serviceUrl={SYNCFUSION_SERVICE_URL}
          enableToolbar={enableToolbar}
          toolbarItems={(toolbarItems ?? TOOLBAR_ITEMS) as any}
          showPropertiesPane={showPropertiesPane}
          enableLocalPaste={false}
          enableSpellCheck={true}
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
