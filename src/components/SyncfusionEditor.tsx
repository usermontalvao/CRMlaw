// Syncfusion Document Editor Component
// Wrapper para o DocumentEditorContainerComponent com funcionalidades de petição

import React, { useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import type { MenuItemModel } from '@syncfusion/ej2-navigations';
import {
  DocumentEditorContainerComponent,
  Toolbar,
} from '@syncfusion/ej2-react-documenteditor';

// Inject required modules
DocumentEditorContainerComponent.Inject(Toolbar);

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

// Service URL from environment
const SYNCFUSION_SERVICE_URL = import.meta.env.VITE_SYNC_FUSION || 'https://ej2services.syncfusion.com/production/web-services/api/documenteditor/';

export interface SyncfusionEditorRef {
  // Get document content as SFDT (Syncfusion Document Text format)
  getSfdt: () => string;
  // Load SFDT content into editor
  loadSfdt: (sfdt: string) => void;
  convertSfdtToFragment: (sfdt: string) => Promise<string>;
  // Load DOCX file from ArrayBuffer
  loadDocx: (arrayBuffer: ArrayBuffer, fileName?: string) => Promise<void>;
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
    const [isCreated, setIsCreated] = useState(false);

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
            // Após abrir, forçar layout
            setTimeout(() => {
              if (typeof (editor as any).resize === 'function') (editor as any).resize();
              if (pageFit && typeof editor.fitPage === 'function') {
                editor.fitPage(pageFit as any);
              }
            }, 50);
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
          const blob = new Blob([arrayBuffer], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          });
          const file = new File([blob], fileName, { type: blob.type });
          await editor.open(file);
        };

        if (createdRef.current && containerRef.current?.documentEditor) {
          try {
            await openDocx();
          } catch (err) {
            console.error('Erro ao carregar DOCX:', err);
            throw err;
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
                reject(err);
              }
            })();
          });
        });
      },

      exportDocx: async (fileName = 'documento.docx') => {
        const editor = containerRef.current?.documentEditor;
        if (!editor) throw new Error('Editor não inicializado');

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
    };

    const handleDocumentChange = () => {
      onDocumentChange?.();

      const editor: any = containerRef.current?.documentEditor as any;
      if (!editor) return;

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
      if (contextMenuInitRef.current) return true;
      const editor = containerRef.current?.documentEditor as any;
      if (!editor?.contextMenu || !editor?.element?.id) return false;

      const menuItems: MenuItemModel[] = [
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
      ];

      // Mantém os itens padrão e adiciona nossos itens (o 3º parâmetro ajuda a posicionar como grupo)
      editor.contextMenu.addCustomMenu(menuItems, false, true);
      contextMenuInitRef.current = true;

      const prevSelect = editor.customContextMenuSelect;
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

        if (typeof prevSelect === 'function') prevSelect(args);
      };

      const prevBeforeOpen = editor.customContextMenuBeforeOpen;
      editor.customContextMenuBeforeOpen = (args: any) => {
        if (typeof prevBeforeOpen === 'function') prevBeforeOpen(args);
        try {
          const ids: string[] = (args?.ids || []) as string[];
          const targetId = ids.find((x) => String(x).includes('crm_add_block'));
          if (!targetId) return;

          const itemEl = document.getElementById(targetId);
          if (!itemEl) return;

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
        editor?.openBlank?.();
        
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
      <DocumentEditorContainerComponent
        ref={containerRef}
        id={id}
        height={height}
        serviceUrl={SYNCFUSION_SERVICE_URL}
        enableToolbar={enableToolbar}
        toolbarItems={(toolbarItems ?? TOOLBAR_ITEMS) as any}
        showPropertiesPane={showPropertiesPane}
        enableLocalPaste={false}
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
    );
  }
);

SyncfusionEditor.displayName = 'SyncfusionEditor';

export default SyncfusionEditor;
