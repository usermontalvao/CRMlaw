// Faixa de opÃ§Ãµes (ribbon) estilo Word para o editor de petiÃ§Ãµes.
// Opera sobre a instÃ¢ncia do Syncfusion DocumentEditor exposta pelo SyncfusionEditor
// atravÃ©s do ref (getEditor / getContainer / setShowRuler).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Subscript,
  Superscript,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Indent,
  Outdent,
  Undo2,
  Redo2,
  Scissors,
  Copy,
  ClipboardPaste,
  Eraser,
  Baseline,
  Highlighter,
  Search,
  Image as ImageIcon,
  Table as TableIcon,
  Link as LinkIcon,
  PanelTop,
  PanelBottom,
  Hash,
  SpellCheck,
  ChevronDown,
  ChevronUp,
  FilePlus2,
  FolderOpen,
  Save as SaveIcon,
  Download,
  Printer,
  SeparatorHorizontal,
  SeparatorVertical,
  Bookmark,
  ListTree,
  StickyNote,
  MessageSquarePlus,
  History,
} from 'lucide-react';
import type { SyncfusionEditorRef } from './SyncfusionEditor';

type RibbonTab = 'inicio' | 'inserir' | 'layout' | 'revisao' | 'exibir';

interface FmtState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  superscript: boolean;
  subscript: boolean;
  fontFamily: string;
  fontSize: number | '';
  fontColor: string;
  alignment: '' | 'Left' | 'Center' | 'Right' | 'Justify';
  styleName: string;
}

const EMPTY_FMT: FmtState = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  superscript: false,
  subscript: false,
  fontFamily: '',
  fontSize: '',
  fontColor: '#000000',
  alignment: '',
  styleName: 'Normal',
};

interface CustomStylePreset {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  textAlignment: '' | 'Left' | 'Center' | 'Right' | 'Justify';
  leftIndent: number;
  rightIndent: number;
  firstLineIndent: number;
  beforeSpacing: number;
  afterSpacing: number;
  lineSpacing: number;
  lineSpacingType: string;
  tabStops: Array<{
    position: number;
    deletePosition: number;
    tabJustification: string;
    tabLeader: string;
  }>;
  listMode: 'none' | 'bullet' | 'number';
  listText: string;
  numberFormat: string;
}

const FONT_FAMILIES = [
  'Times New Roman',
  'Arial',
  'Calibri',
  'Cambria',
  'Georgia',
  'Verdana',
  'Tahoma',
  'Courier New',
  'Garamond',
  'Trebuchet MS',
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

const FONT_COLORS = [
  '#000000', '#374151', '#6b7280', '#9ca3af', '#ffffff',
  '#b91c1c', '#dc2626', '#ea580c', '#d97706', '#ca8a04',
  '#16a34a', '#059669', '#0891b2', '#2563eb', '#1d4ed8',
  '#7c3aed', '#9333ea', '#c026d3', '#db2777', '#be123c',
];

// Mapeia uma cor para o enum de realce mais prÃ³ximo do Syncfusion
const HIGHLIGHTS: { label: string; value: string; swatch: string }[] = [
  { label: 'Amarelo', value: 'Yellow', swatch: '#fef08a' },
  { label: 'Verde', value: 'BrightGreen', swatch: '#bbf7d0' },
  { label: 'Ciano', value: 'Turquoise', swatch: '#a5f3fc' },
  { label: 'Rosa', value: 'Pink', swatch: '#fbcfe8' },
  { label: 'Azul', value: 'Blue', swatch: '#bfdbfe' },
  { label: 'Cinza', value: 'Gray25', swatch: '#e5e7eb' },
  { label: 'Sem cor', value: 'NoColor', swatch: 'transparent' },
];

const STYLES = ['Normal', 'Heading 1', 'Heading 2', 'Heading 3'];

const A4 = { w: 595.3, h: 841.9 };
const LETTER = { w: 612, h: 792 };
const RIBBON_COLLAPSED_STORAGE_KEY = 'petition-ribbon-collapsed-v1';
const CUSTOM_STYLES_STORAGE_KEY = 'petition-ribbon-custom-styles-v1';

const getReadablePreviewColor = (color: string) => {
  const raw = String(color || '').trim();
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return raw || '#1f2937';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.86 ? '#1f2937' : `#${hex}`;
};

const normalizeTabStops = (tabs: any[] | undefined) =>
  Array.isArray(tabs)
    ? tabs
        .map((tab) => ({
          position: typeof tab?.position === 'number' ? tab.position : 0,
          deletePosition: typeof tab?.deletePosition === 'number' ? tab.deletePosition : 0,
          tabJustification: typeof tab?.tabJustification === 'string' ? tab.tabJustification : 'Left',
          tabLeader: typeof tab?.tabLeader === 'string' ? tab.tabLeader : 'None',
        }))
        .filter((tab) => tab.position > 0 || tab.deletePosition > 0)
    : [];

interface PetitionRibbonProps {
  editorRef: React.RefObject<SyncfusionEditorRef | null>;
  ready: boolean;
  topContent?: React.ReactNode;
  /** Menu Arquivo â€” ligados Ã s aÃ§Ãµes do mÃ³dulo. */
  onNew?: () => void;
  onOpen?: () => void;
  onSave?: () => void;
  onExportDocx?: () => void;
}

const PetitionRibbon: React.FC<PetitionRibbonProps> = ({
  editorRef,
  ready,
  topContent,
  onNew,
  onOpen,
  onSave,
  onExportDocx,
}) => {
  const [tab, setTab] = useState<RibbonTab>('inicio');
  const [fmt, setFmt] = useState<FmtState>(EMPTY_FMT);
  const [zoom, setZoom] = useState(100);
  const [showRuler, setShowRulerState] = useState(true);
  const [showNavPane, setShowNavPane] = useState(false);
  const [trackChanges, setTrackChanges] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(RIBBON_COLLAPSED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [hoverReveal, setHoverReveal] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [tableGridOpen, setTableGridOpen] = useState(false);
  const [tableHover, setTableHover] = useState({ r: 0, c: 0 });
  const [customStyles, setCustomStyles] = useState<CustomStylePreset[]>(() => {
    try {
      const raw = window.localStorage.getItem(CUSTOM_STYLES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const lastColorRef = useRef('#dc2626');
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const isBodyVisible = !isCollapsed || hoverReveal;

  useEffect(() => {
    try {
      window.localStorage.setItem(RIBBON_COLLAPSED_STORAGE_KEY, isCollapsed ? '1' : '0');
    } catch {
      // ignore
    }
    if (!isCollapsed) setHoverReveal(false);
  }, [isCollapsed]);
  useEffect(() => {
    try {
      window.localStorage.setItem(CUSTOM_STYLES_STORAGE_KEY, JSON.stringify(customStyles));
    } catch {
      // ignore
    }
  }, [customStyles]);
  useEffect(() => {
    try {
      editorRef.current?.setShowRuler?.(showRuler);
    } catch {
      // ignore
    }
  }, [editorRef, showRuler]);

  const getEd = useCallback((): any => {
    try {
      return editorRef.current?.getEditor?.() ?? null;
    } catch {
      return null;
    }
  }, [editorRef]);

  // LÃª o estado de formataÃ§Ã£o atual da seleÃ§Ã£o
  const syncFmt = useCallback(() => {
    const ed = getEd();
    if (!ed?.selection) return;
    try {
      const cf = ed.selection.characterFormat || {};
      const pf = ed.selection.paragraphFormat || {};
      setFmt({
        bold: !!cf.bold,
        italic: !!cf.italic,
        underline: !!cf.underline && cf.underline !== 'None',
        strikethrough: !!cf.strikethrough && cf.strikethrough !== 'None',
        superscript: cf.baselineAlignment === 'Superscript',
        subscript: cf.baselineAlignment === 'Subscript',
        fontFamily: typeof cf.fontFamily === 'string' ? cf.fontFamily : '',
        fontSize: typeof cf.fontSize === 'number' && cf.fontSize > 0 ? cf.fontSize : '',
        fontColor: typeof cf.fontColor === 'string' && cf.fontColor ? cf.fontColor : '#000000',
        alignment: (pf.textAlignment as FmtState['alignment']) || '',
        styleName: typeof pf.styleName === 'string' && pf.styleName ? pf.styleName : 'Normal',
      });
      if (typeof ed.zoomFactor === 'number') {
        setZoom(Math.round(ed.zoomFactor * 100));
      }
    } catch {
      // ignore
    }
  }, [getEd]);

  // Conecta o listener de selectionChange quando o editor fica pronto
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    const attach = () => {
      const ed = getEd();
      if (!ed) {
        raf = window.requestAnimationFrame(attach);
        return;
      }
      try {
        ed.selectionChange = syncFmt;
      } catch {
        // ignore
      }
      syncFmt();
    };
    attach();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      const ed = getEd();
      try {
        if (ed && ed.selectionChange === syncFmt) ed.selectionChange = undefined;
      } catch {
        // ignore
      }
    };
  }, [ready, getEd, syncFmt]);

  // Executa uma aÃ§Ã£o sobre o editor e re-sincroniza o estado da faixa
  const run = useCallback(
    (fn: (ed: any) => void, refocus = true) => {
      const ed = getEd();
      if (!ed) return;
      try {
        fn(ed);
      } catch {
        // ignore
      }
      if (refocus) {
        try {
          ed.focusIn?.();
        } catch {
          // ignore
        }
      }
      syncFmt();
    },
    [getEd, syncFmt],
  );
  const returnToHomeTab = useCallback(() => {
    window.setTimeout(() => setTab('inicio'), 0);
  }, []);
  const runAndReturnHome = useCallback(
    (fn: (ed: any) => void, refocus = true) => {
      run(fn, refocus);
      returnToHomeTab();
    },
    [run, returnToHomeTab],
  );

  // ---- AÃ§Ãµes de fonte / parÃ¡grafo ----
  const setFontFamily = (v: string) =>
    run((ed) => {
      if (ed.selection?.characterFormat) ed.selection.characterFormat.fontFamily = v;
    });
  const setFontSize = (v: number) =>
    run((ed) => {
      if (ed.selection?.characterFormat) ed.selection.characterFormat.fontSize = v;
    });
  const bumpFont = (delta: number) =>
    run((ed) => {
      const cf = ed.selection?.characterFormat;
      if (!cf) return;
      const cur = typeof cf.fontSize === 'number' && cf.fontSize > 0 ? cf.fontSize : 12;
      cf.fontSize = Math.max(1, Math.min(409, cur + delta));
    });
  const setColor = (hex: string) =>
    run((ed) => {
      if (ed.selection?.characterFormat) ed.selection.characterFormat.fontColor = hex;
    });
  const setHighlight = (value: string) =>
    run((ed) => {
      if (ed.selection?.characterFormat) ed.selection.characterFormat.highlightColor = value;
    });
  const setAlign = (v: FmtState['alignment']) =>
    run((ed) => {
      if (ed.selection?.paragraphFormat) ed.selection.paragraphFormat.textAlignment = v;
    });
  const applyStyle = (name: string) =>
    run((ed) => {
      ed.editor?.applyStyle?.(name, true);
    });
  const captureCurrentStyle = () => {
    const name = window.prompt('Nome do estilo personalizado:', '');
    if (!name?.trim()) return;
    const trimmed = name.trim();
    const ed = getEd();
    const pf = ed?.selection?.paragraphFormat;
    const listLevel = pf?.listFormat?.listLevel;
    const listText = typeof pf?.listText === 'string' ? pf.listText : '';
    const numberFormat = typeof listLevel?.numberFormat === 'string' ? listLevel.numberFormat : '';
    const listMode: CustomStylePreset['listMode'] =
      listText
        ? numberFormat && numberFormat.includes('%')
          ? 'number'
          : 'bullet'
        : 'none';
    const nextStyle: CustomStylePreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
      fontFamily: fmt.fontFamily || 'Calibri',
      fontSize: typeof fmt.fontSize === 'number' && fmt.fontSize > 0 ? fmt.fontSize : 11,
      fontColor: fmt.fontColor || '#000000',
      bold: fmt.bold,
      italic: fmt.italic,
      underline: fmt.underline,
      textAlignment: fmt.alignment,
      leftIndent: typeof pf?.leftIndent === 'number' ? pf.leftIndent : 0,
      rightIndent: typeof pf?.rightIndent === 'number' ? pf.rightIndent : 0,
      firstLineIndent: typeof pf?.firstLineIndent === 'number' ? pf.firstLineIndent : 0,
      beforeSpacing: typeof pf?.beforeSpacing === 'number' ? pf.beforeSpacing : 0,
      afterSpacing: typeof pf?.afterSpacing === 'number' ? pf.afterSpacing : 0,
      lineSpacing: typeof pf?.lineSpacing === 'number' && pf.lineSpacing > 0 ? pf.lineSpacing : 1,
      lineSpacingType: typeof pf?.lineSpacingType === 'string' && pf.lineSpacingType ? pf.lineSpacingType : 'Multiple',
      tabStops: normalizeTabStops(ed?.editorModule?.getTabsInSelection?.() ?? pf?.tabs),
      listMode,
      listText,
      numberFormat,
    };
    setCustomStyles((prev) => {
      const withoutSameName = prev.filter((item) => item.name.toLowerCase() !== trimmed.toLowerCase());
      return [...withoutSameName, nextStyle];
    });
  };
  const applyCustomStyle = (style: CustomStylePreset) =>
    run((ed) => {
      const cf = ed.selection?.characterFormat;
      const pf = ed.selection?.paragraphFormat;
      if (cf) {
        cf.fontFamily = style.fontFamily;
        cf.fontSize = style.fontSize;
        cf.fontColor = style.fontColor;
        cf.bold = style.bold;
        cf.italic = style.italic;
        cf.underline = style.underline ? 'Single' : 'None';
      }
      if (pf && style.textAlignment) {
        pf.textAlignment = style.textAlignment;
      }
      if (pf) {
        pf.leftIndent = style.leftIndent;
        pf.rightIndent = style.rightIndent;
        pf.firstLineIndent = style.firstLineIndent;
        pf.beforeSpacing = style.beforeSpacing;
        pf.afterSpacing = style.afterSpacing;
        pf.lineSpacing = style.lineSpacing;
        pf.lineSpacingType = style.lineSpacingType;
      }
      if (Array.isArray(style.tabStops) && style.tabStops.length > 0) {
        ed.editorModule?.onApplyParagraphFormat?.(
          'tabStop',
          style.tabStops.map((tab) => ({
            position: tab.position,
            deletePosition: tab.deletePosition,
            tabJustification: tab.tabJustification,
            tabLeader: tab.tabLeader,
          })),
          false,
          false,
        );
      }
      if (style.listMode === 'bullet') {
        ed.editor?.applyBullet?.(style.listText || '•', 'Symbol');
      } else if (style.listMode === 'number') {
        ed.editor?.applyNumbering?.(style.numberFormat || '%1.', 'Arabic');
      }
    });
  const removeCustomStyle = (id: string) => {
    setCustomStyles((prev) => prev.filter((item) => item.id !== id));
  };

  // Lista com toggle-off: se o parÃ¡grafo jÃ¡ Ã© lista, remove; senÃ£o aplica.
  const isInList = (ed: any): boolean => {
    try {
      const pf = ed.selection?.paragraphFormat;
      const txt = pf?.listText;
      return typeof txt === 'string' && txt.length > 0;
    } catch {
      return false;
    }
  };
  const toggleBullet = () =>
    run((ed) => {
      if (isInList(ed)) ed.editor?.clearList?.();
      else ed.editor?.applyBullet?.('ï‚·', 'Symbol');
    });
  const toggleNumbering = () =>
    run((ed) => {
      if (isInList(ed)) ed.editor?.clearList?.();
      else ed.editor?.applyNumbering?.('%1.', 'Arabic');
    });

  // ---- InserÃ§Ãµes ----
  const insertTableGrid = (rows: number, cols: number) => {
    setTableGridOpen(false);
    runAndReturnHome((ed) => ed.editor?.insertTable?.(Math.max(1, rows), Math.max(1, cols)));
  };
  const insertPageBreak = () => runAndReturnHome((ed) => ed.editor?.insertPageBreak?.());
  const insertSectionBreak = () => runAndReturnHome((ed) => ed.editor?.insertSectionBreak?.());
  const insertBookmark = () => {
    const name = window.prompt('Nome do indicador (bookmark):', '');
    if (!name) return;
    runAndReturnHome((ed) => ed.editor?.insertBookmark?.(name));
  };
  const insertTOC = () => runAndReturnHome((ed) => ed.editor?.insertTableOfContents?.());
  const insertFootnote = () => runAndReturnHome((ed) => ed.editor?.insertFootnote?.());
  const insertComment = () => runAndReturnHome((ed) => ed.editor?.insertComment?.(''));
  const insertHyperlink = () => {
    const url = window.prompt('URL do link:', 'https://');
    if (!url) return;
    runAndReturnHome((ed) => {
      const text = ed.selection?.text || url;
      ed.editor?.insertHyperlink?.(url, text || url);
    });
  };
  const insertImageFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl) return;
      const img = new window.Image();
      img.onload = () => {
        const maxW = 400;
        const ratio = img.width > maxW ? maxW / img.width : 1;
        runAndReturnHome((ed) =>
          ed.editor?.insertImage?.(dataUrl, Math.round(img.width * ratio), Math.round(img.height * ratio)),
        );
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };
  const goToHeader = () => runAndReturnHome((ed) => ed.selection?.goToHeader?.());
  const goToFooter = () => runAndReturnHome((ed) => ed.selection?.goToFooter?.());
  const insertPageNumber = () =>
    runAndReturnHome((ed) => {
      ed.selection?.goToFooter?.();
      ed.editor?.insertPageNumber?.();
    });

  // ---- Layout ----
  const setMargins = (mm: number) =>
    runAndReturnHome((ed) => {
      const sf = ed.selection?.sectionFormat;
      if (!sf) return;
      const pt = (mm / 25.4) * 72;
      sf.leftMargin = pt;
      sf.rightMargin = pt;
      sf.topMargin = pt;
      sf.bottomMargin = pt;
    });
  const setOrientation = (landscape: boolean) =>
    runAndReturnHome((ed) => {
      const sf = ed.selection?.sectionFormat;
      if (!sf) return;
      const w = sf.pageWidth;
      const h = sf.pageHeight;
      if (landscape && w < h) {
        sf.pageWidth = h;
        sf.pageHeight = w;
      } else if (!landscape && w > h) {
        sf.pageWidth = h;
        sf.pageHeight = w;
      }
    });
  const setPageSize = (size: { w: number; h: number }) =>
    runAndReturnHome((ed) => {
      const sf = ed.selection?.sectionFormat;
      if (!sf) return;
      const landscape = sf.pageWidth > sf.pageHeight;
      sf.pageWidth = landscape ? size.h : size.w;
      sf.pageHeight = landscape ? size.w : size.h;
    });
  const setLineSpacing = (v: number) =>
    runAndReturnHome((ed) => {
      const pf = ed.selection?.paragraphFormat;
      if (!pf) return;
      pf.lineSpacingType = 'Multiple';
      pf.lineSpacing = v;
    });
  const bumpParagraphSpacing = (which: 'before' | 'after', delta: number) =>
    runAndReturnHome((ed) => {
      const pf = ed.selection?.paragraphFormat;
      if (!pf) return;
      if (which === 'before') {
        const cur = typeof pf.beforeSpacing === 'number' ? pf.beforeSpacing : 0;
        pf.beforeSpacing = Math.max(0, cur + delta);
      } else {
        const cur = typeof pf.afterSpacing === 'number' ? pf.afterSpacing : 0;
        pf.afterSpacing = Math.max(0, cur + delta);
      }
    });

  // ---- RevisÃ£o / Exibir ----
  const toggleSpellCheck = () =>
    runAndReturnHome((ed) => {
      if (ed.spellChecker) ed.spellChecker.enableSpellCheck = !ed.spellChecker.enableSpellCheck;
    });
  const openFind = (returnHome = false) => {
    const runner = returnHome ? runAndReturnHome : run;
    runner((ed) => ed.showOptionsPane?.());
  };
  const printDoc = () => {
    try {
      editorRef.current?.printDocument?.();
    } catch {
      // ignore
    }
  };
  const toggleTrackChanges = () => {
    const next = !trackChanges;
    setTrackChanges(next);
    try {
      editorRef.current?.setTrackChanges?.(next);
    } catch {
      // ignore
    }
    returnToHomeTab();
  };
  const setZoomFactor = (pct: number) =>
    runAndReturnHome((ed) => {
      ed.zoomFactor = pct / 100;
    }, false);
  const toggleRuler = () => {
    const next = !showRuler;
    setShowRulerState(next);
    try {
      editorRef.current?.setShowRuler?.(next);
    } catch {
      // ignore
    }
    returnToHomeTab();
  };
  const toggleNavPane = () => {
    const next = !showNavPane;
    setShowNavPane(next);
    try {
      editorRef.current?.setShowNavigationPane?.(next);
    } catch {
      // ignore
    }
    returnToHomeTab();
  };

  // Fecha popovers/menus ao clicar fora
  useEffect(() => {
    if (!colorOpen && !highlightOpen && !fileMenuOpen && !tableGridOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.('[data-ribbon-popover]')) {
        setColorOpen(false);
        setHighlightOpen(false);
        setFileMenuOpen(false);
        setTableGridOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [colorOpen, highlightOpen, fileMenuOpen, tableGridOpen]);

  return (
    <div
      className={`pet-ribbon ${isCollapsed ? 'is-collapsed' : ''} ${isBodyVisible ? 'is-revealed' : ''}`}
      data-ready={ready ? '1' : '0'}
      onMouseEnter={() => {
        if (isCollapsed) setHoverReveal(true);
      }}
      onMouseLeave={() => {
        if (isCollapsed) {
          setHoverReveal(false);
          setColorOpen(false);
          setHighlightOpen(false);
          setFileMenuOpen(false);
          setTableGridOpen(false);
        }
      }}
    >
      <div className="pet-ribbon-peek" aria-hidden="true" />
      {topContent ? <div className="pet-ribbon-topslot"><div className="pet-ribbon-topslot-inner">{topContent}</div></div> : null}
      {/* Abas */}
      <div className="pet-ribbon-tabs">
        <div className="pet-file-wrap" data-ribbon-popover>
          <button
            type="button"
            className="pet-ribbon-file"
            onClick={() => {
              if (isCollapsed) setHoverReveal(true);
              setFileMenuOpen((v) => !v);
            }}
            title="Menu Arquivo"
          >
            Arquivo
          </button>
          {fileMenuOpen && (
            <div className="pet-file-menu" data-ribbon-popover>
              <button type="button" className="pet-file-item" onClick={() => { setFileMenuOpen(false); onNew?.(); }}>
                <FilePlus2 size={15} /> Novo documento
              </button>
              <button type="button" className="pet-file-item" onClick={() => { setFileMenuOpen(false); onOpen?.(); }}>
                <FolderOpen size={15} /> Abrir / Importar DOCX
              </button>
              <button type="button" className="pet-file-item" onClick={() => { setFileMenuOpen(false); onSave?.(); }}>
                <SaveIcon size={15} /> Salvar
              </button>
              <div className="pet-file-sep" />
              <button type="button" className="pet-file-item" onClick={() => { setFileMenuOpen(false); onExportDocx?.(); }}>
                <Download size={15} /> Exportar DOCX
              </button>
              <button type="button" className="pet-file-item" onClick={() => { setFileMenuOpen(false); printDoc(); }}>
                <Printer size={15} /> Imprimir / PDF
              </button>
            </div>
          )}
        </div>
        {([
          ['inicio', 'Início'],
          ['inserir', 'Inserir'],
          ['layout', 'Layout'],
          ['revisao', 'Revisão'],
          ['exibir', 'Exibir'],
        ] as [RibbonTab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              if (isCollapsed) setHoverReveal(true);
            }}
            className={`pet-ribbon-tab ${tab === key ? 'is-active' : ''}`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="pet-ribbon-collapse"
          title={isCollapsed ? 'Fixar barra expandida' : 'Recolher barra'}
          onClick={() => {
            setIsCollapsed((v) => !v);
            setHoverReveal(false);
          }}
        >
          {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {/* Corpo da faixa */}
      <div className="pet-ribbon-body" data-tab={tab}>
        {tab === 'inicio' && (
          <>
            {/* Desfazer / Refazer */}
            <RibbonGroup label="Desfazer" className="is-slim" bodyClassName="is-inline is-center">
              <div className="pet-row">
                <IconBtn title="Desfazer (Ctrl+Z)" onClick={() => run((ed) => ed.editorHistory?.undo?.())}>
                  <Undo2 size={15} />
                </IconBtn>
                <IconBtn title="Refazer (Ctrl+Y)" onClick={() => run((ed) => ed.editorHistory?.redo?.())}>
                  <Redo2 size={15} />
                </IconBtn>
              </div>
            </RibbonGroup>

            {/* Área de transferência */}
            <RibbonGroup label={"Área de Transferência"} className="is-clipboard" bodyClassName="is-inline">
              <Btn title="Colar" onClick={() => run((ed) => ed.editor?.paste?.())}>
                <ClipboardPaste size={18} />
                <span className="lbl">Colar</span>
              </Btn>
              <div className="pet-stack">
                <Btn small title="Recortar" onClick={() => run((ed) => ed.editor?.cut?.())}>
                  <Scissors size={14} /> <span>Recortar</span>
                </Btn>
                <Btn small title="Copiar" onClick={() => run((ed) => ed.selection?.copy?.())}>
                  <Copy size={14} /> <span>Copiar</span>
                </Btn>
              </div>
            </RibbonGroup>

            {/* Fonte */}
            <RibbonGroup label="Fonte">
              <div className="pet-row">
                <select
                  className="pet-select pet-font"
                  value={FONT_FAMILIES.includes(fmt.fontFamily) ? fmt.fontFamily : ''}
                  onChange={(e) => setFontFamily(e.target.value)}
                  title="Fonte"
                >
                  <option value="" disabled>
                    {fmt.fontFamily || 'Fonte'}
                  </option>
                  {FONT_FAMILIES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <select
                  className="pet-select pet-size"
                  value={typeof fmt.fontSize === 'number' && FONT_SIZES.includes(fmt.fontSize) ? fmt.fontSize : ''}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  title="Tamanho"
                >
                  <option value="" disabled>
                    {fmt.fontSize || '-'}
                  </option>
                  {FONT_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <IconBtn title="Aumentar fonte" onClick={() => bumpFont(1)}>
                  <span className="pet-aplus">A+</span>
                </IconBtn>
                <IconBtn title="Diminuir fonte" onClick={() => bumpFont(-1)}>
                  <span className="pet-aminus">A-</span>
                </IconBtn>
              </div>
              <div className="pet-row">
                <IconBtn title="Negrito" active={fmt.bold} onClick={() => run((ed) => ed.editor?.toggleBold?.())}>
                  <Bold size={15} />
                </IconBtn>
                <IconBtn title={"Itálico"} active={fmt.italic} onClick={() => run((ed) => ed.editor?.toggleItalic?.())}>
                  <Italic size={15} />
                </IconBtn>
                <IconBtn
                  title="Sublinhado"
                  active={fmt.underline}
                  onClick={() => run((ed) => ed.editor?.toggleUnderline?.('Single'))}
                >
                  <Underline size={15} />
                </IconBtn>
                <IconBtn
                  title="Tachado"
                  active={fmt.strikethrough}
                  onClick={() => run((ed) => ed.editor?.toggleStrikethrough?.())}
                >
                  <Strikethrough size={15} />
                </IconBtn>
                <span className="pet-vsep" />
                <IconBtn
                  title="Sobrescrito"
                  active={fmt.superscript}
                  onClick={() => run((ed) => ed.editor?.toggleSuperscript?.())}
                >
                  <Superscript size={15} />
                </IconBtn>
                <IconBtn
                  title="Subscrito"
                  active={fmt.subscript}
                  onClick={() => run((ed) => ed.editor?.toggleSubscript?.())}
                >
                  <Subscript size={15} />
                </IconBtn>
                <span className="pet-vsep" />
                {/* Cor da fonte */}
                <div className={`pet-split ${colorOpen ? 'is-open' : ''}`} data-ribbon-popover>
                  <button
                    type="button"
                    className="pet-iconbtn pet-split-main"
                    title="Cor da fonte"
                    onClick={() => setColor(lastColorRef.current)}
                  >
                    <Baseline size={15} />
                    <span className="pet-color-bar" style={{ background: lastColorRef.current }} />
                  </button>
                  <button
                    type="button"
                    className="pet-iconbtn pet-split-caret"
                    title="Escolher cor"
                    onClick={() => {
                      setColorOpen((v) => !v);
                      setHighlightOpen(false);
                    }}
                  >
                    <ChevronDown size={11} />
                  </button>
                  {colorOpen && (
                    <div className="pet-popover" data-ribbon-popover>
                      <div className="pet-swatches">
                        {FONT_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className="pet-swatch"
                            style={{ background: c }}
                            title={c}
                            onClick={() => {
                              lastColorRef.current = c;
                              setColor(c);
                              setColorOpen(false);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {/* Realce */}
                <div className={`pet-split ${highlightOpen ? 'is-open' : ''}`} data-ribbon-popover>
                  <button
                    type="button"
                    className="pet-iconbtn pet-split-main"
                    title="Cor de realce"
                    onClick={() => setHighlight('Yellow')}
                  >
                    <Highlighter size={15} />
                  </button>
                  <button
                    type="button"
                    className="pet-iconbtn pet-split-caret"
                    title="Escolher realce"
                    onClick={() => {
                      setHighlightOpen((v) => !v);
                      setColorOpen(false);
                    }}
                  >
                    <ChevronDown size={11} />
                  </button>
                  {highlightOpen && (
                    <div className="pet-popover" data-ribbon-popover>
                      <div className="pet-swatches">
                        {HIGHLIGHTS.map((h) => (
                          <button
                            key={h.value}
                            type="button"
                            className="pet-swatch pet-swatch-lg"
                            style={{
                              background: h.swatch,
                              border: h.value === 'NoColor' ? '1px dashed #cbd5e1' : undefined,
                            }}
                            title={h.label}
                            onClick={() => {
                              setHighlight(h.value);
                              setHighlightOpen(false);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <IconBtn
                  title="Limpar formatacao"
                  onClick={() => run((ed) => ed.editor?.clearFormatting?.())}
                >
                  <Eraser size={15} />
                </IconBtn>
              </div>
            </RibbonGroup>

            {/* Paragrafo */}
            <RibbonGroup label="Paragrafo">
              <div className="pet-row">
                <IconBtn title="Marcadores (alterna)" onClick={toggleBullet}>
                  <List size={15} />
                </IconBtn>
                <IconBtn title="Numeracao (alterna)" onClick={toggleNumbering}>
                  <ListOrdered size={15} />
                </IconBtn>
                <span className="pet-vsep" />
                <IconBtn title="Diminuir recuo" onClick={() => run((ed) => ed.editor?.decreaseIndent?.())}>
                  <Outdent size={15} />
                </IconBtn>
                <IconBtn title="Aumentar recuo" onClick={() => run((ed) => ed.editor?.increaseIndent?.())}>
                  <Indent size={15} />
                </IconBtn>
              </div>
              <div className="pet-row">
                <IconBtn title="Alinhar a esquerda" active={fmt.alignment === 'Left'} onClick={() => setAlign('Left')}>
                  <AlignLeft size={15} />
                </IconBtn>
                <IconBtn title="Centralizar" active={fmt.alignment === 'Center'} onClick={() => setAlign('Center')}>
                  <AlignCenter size={15} />
                </IconBtn>
                <IconBtn title="Alinhar a direita" active={fmt.alignment === 'Right'} onClick={() => setAlign('Right')}>
                  <AlignRight size={15} />
                </IconBtn>
                <IconBtn title="Justificar" active={fmt.alignment === 'Justify'} onClick={() => setAlign('Justify')}>
                  <AlignJustify size={15} />
                </IconBtn>
                <span className="pet-vsep" />
                <select
                  className="pet-select pet-spacing"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) setLineSpacing(Number(e.target.value));
                    e.target.value = '';
                  }}
                  title={"Espaçamento entre linhas"}
                >
                  <option value="" disabled>
                    ↕
                  </option>
                  <option value="1">1,0</option>
                  <option value="1.15">1,15</option>
                  <option value="1.5">1,5</option>
                  <option value="2">2,0</option>
                </select>
              </div>
            </RibbonGroup>

            {/* Estilos */}
            <RibbonGroup label="Estilos">
              <div className="pet-styles">
                {STYLES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`pet-style ${fmt.styleName === s ? 'is-active' : ''}`}
                    onClick={() => applyStyle(s)}
                    title={s}
                  >
                    <span className="pet-style-name">{s === 'Normal' ? 'Normal' : s.replace('Heading', 'Título')}</span>
                    <span
                      className="pet-style-preview"
                      style={{
                        fontWeight: s === 'Normal' ? 400 : 700,
                        color: s === 'Normal' ? '#1f2937' : '#2f6fa8',
                        fontSize: s === 'Heading 1' ? 14 : 13,
                      }}
                    >
                      AaBbCc
                    </span>
                  </button>
                ))}
                {customStyles.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    className="pet-style pet-style-custom"
                    onClick={() => applyCustomStyle(style)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (window.confirm(`Remover o estilo "${style.name}"?`)) {
                        removeCustomStyle(style.id);
                      }
                    }}
                    title={`${style.name} (clique direito para remover)`}
                  >
                    <span className="pet-style-name">{style.name}</span>
                    <span
                      className="pet-style-preview"
                      style={{
                        fontFamily: style.fontFamily,
                        fontWeight: style.bold ? 700 : 400,
                        fontStyle: style.italic ? 'italic' : 'normal',
                        textDecoration: style.underline ? 'underline' : 'none',
                        color: getReadablePreviewColor(style.fontColor),
                        fontSize: Math.max(11, Math.min(15, style.fontSize)),
                      }}
                    >
                      AaBbCc
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="pet-style pet-style-add"
                  onClick={captureCurrentStyle}
                  title={"Salvar estilo da seleção atual"}
                >
                  <span className="pet-style-name">Novo</span>
                  <span className="pet-style-preview pet-style-add-preview">
                    <FilePlus2 size={14} />
                    Estilo
                  </span>
                </button>
              </div>
            </RibbonGroup>

            {/* Edição */}
            <RibbonGroup label={"Edição"} className="is-slim" bodyClassName="is-inline is-center">
              <div className="pet-stack">
                <Btn small title="Localizar / Substituir" onClick={openFind}>
                  <Search size={14} /> <span>Localizar</span>
                </Btn>
                <Btn small title="Selecionar tudo" onClick={() => run((ed) => ed.selection?.selectAll?.())}>
                  <span style={{ width: 14, textAlign: 'center' }}>+</span> <span>Selecionar</span>
                </Btn>
              </div>
            </RibbonGroup>
          </>
        )}

        {tab === 'inserir' && (
          <>
            <RibbonGroup label={"Ilustrações"}>
              <Btn title="Imagem" onClick={() => imageInputRef.current?.click()}>
                <ImageIcon size={18} />
                <span className="lbl">Imagem</span>
              </Btn>
              <div className="pet-split-btn" data-ribbon-popover>
                <Btn
                  title="Inserir tabela"
                  onClick={() => {
                    setTableGridOpen((v) => !v);
                    setTableHover({ r: 0, c: 0 });
                  }}
                >
                  <TableIcon size={18} />
                  <span className="lbl">Tabela ▾</span>
                </Btn>
                {tableGridOpen && (
                  <div className="pet-popover pet-tablegrid" data-ribbon-popover>
                    <div className="pet-tablegrid-cells">
                      {Array.from({ length: 8 }).map((_, r) =>
                        Array.from({ length: 8 }).map((__, c) => (
                          <button
                            key={`${r}-${c}`}
                            type="button"
                            className={`pet-tablegrid-cell ${r < tableHover.r && c < tableHover.c ? 'on' : ''}`}
                            onMouseEnter={() => setTableHover({ r: r + 1, c: c + 1 })}
                            onClick={() => insertTableGrid(tableHover.r, tableHover.c)}
                          />
                        )),
                      )}
                    </div>
                    <div className="pet-tablegrid-label">
                      {tableHover.r > 0 ? `${tableHover.c} x ${tableHover.r}` : 'Tabela'}
                    </div>
                  </div>
                )}
              </div>
            </RibbonGroup>
            <RibbonGroup label="Links">
              <Btn title="Inserir link" onClick={insertHyperlink}>
                <LinkIcon size={18} />
                <span className="lbl">Link</span>
              </Btn>
              <Btn title="Inserir indicador (bookmark)" onClick={insertBookmark}>
                <Bookmark size={18} />
                <span className="lbl">Indicador</span>
              </Btn>
            </RibbonGroup>
            <RibbonGroup label={"Cabeçalho e Rodapé"}>
              <Btn title={"Editar cabeçalho"} onClick={goToHeader}>
                <PanelTop size={18} />
                <span className="lbl">{"Cabeçalho"}</span>
              </Btn>
              <Btn title={"Editar rodapé"} onClick={goToFooter}>
                <PanelBottom size={18} />
                <span className="lbl">{"Rodapé"}</span>
              </Btn>
              <Btn title={"Número de página"} onClick={insertPageNumber}>
                <Hash size={18} />
                <span className="lbl">{"Nº Página"}</span>
              </Btn>
            </RibbonGroup>
            <RibbonGroup label={"Páginas"}>
              <Btn title={"Quebra de página (Ctrl+Enter)"} onClick={insertPageBreak}>
                <SeparatorHorizontal size={18} />
                <span className="lbl">Quebra Pag.</span>
              </Btn>
              <Btn title={"Quebra de seção"} onClick={insertSectionBreak}>
                <SeparatorVertical size={18} />
                <span className="lbl">Quebra Sec.</span>
              </Btn>
            </RibbonGroup>
            <RibbonGroup label={"Referências"}>
              <Btn title={"Inserir sumário"} onClick={insertTOC}>
                <ListTree size={18} />
                <span className="lbl">{"Sumário"}</span>
              </Btn>
              <Btn title={"Inserir nota de rodapé"} onClick={insertFootnote}>
                <StickyNote size={18} />
                <span className="lbl">{"Nota Rodapé"}</span>
              </Btn>
            </RibbonGroup>
          </>
        )}

        {tab === 'layout' && (
          <>
            <RibbonGroup label={"Configurar Página"}>
              <select
                className="pet-select"
                defaultValue="25"
                onChange={(e) => setMargins(Number(e.target.value))}
                title="Margens"
              >
                <option value="25">Margens: Normal</option>
                <option value="12.7">Estreita</option>
                <option value="19">Moderada</option>
                <option value="38">Larga</option>
              </select>
              <select
                className="pet-select"
                defaultValue="portrait"
                onChange={(e) => setOrientation(e.target.value === 'landscape')}
                title={"Orientação"}
              >
                <option value="portrait">Retrato</option>
                <option value="landscape">Paisagem</option>
              </select>
              <select
                className="pet-select"
                defaultValue="a4"
                onChange={(e) => setPageSize(e.target.value === 'letter' ? LETTER : A4)}
                title="Tamanho"
              >
                <option value="a4">A4</option>
                <option value="letter">Carta</option>
              </select>
            </RibbonGroup>
            <RibbonGroup label="Paragrafo">
              <div className="pet-stack">
                <Btn small title="Diminuir recuo" onClick={() => run((ed) => ed.editor?.decreaseIndent?.())}>
                  <Outdent size={14} /> <span>Diminuir recuo</span>
                </Btn>
                <Btn small title="Aumentar recuo" onClick={() => run((ed) => ed.editor?.increaseIndent?.())}>
                  <Indent size={14} /> <span>Aumentar recuo</span>
                </Btn>
              </div>
              <select
                className="pet-select"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) setLineSpacing(Number(e.target.value));
                }}
                  title={"Espaçamento entre linhas"}
              >
                <option value="" disabled>
                  {"Espaçamento"}
                </option>
                <option value="1">Simples</option>
                <option value="1.5">1,5 linhas</option>
                <option value="2">Duplo</option>
              </select>
            </RibbonGroup>
            <RibbonGroup label={"Espaçamento"}>
              <div className="pet-flow-row">
                <Btn small title={"Aumentar espaço antes"} onClick={() => bumpParagraphSpacing('before', 6)}>
                  <span>Antes +</span>
                </Btn>
                <Btn small title={"Remover espaço antes"} onClick={() => bumpParagraphSpacing('before', -6)}>
                  <span>Antes -</span>
                </Btn>
                <Btn small title={"Aumentar espaço depois"} onClick={() => bumpParagraphSpacing('after', 6)}>
                  <span>Depois +</span>
                </Btn>
                <Btn small title={"Remover espaço depois"} onClick={() => bumpParagraphSpacing('after', -6)}>
                  <span>Depois -</span>
                </Btn>
              </div>
            </RibbonGroup>
          </>
        )}

        {tab === 'revisao' && (
          <>
            <RibbonGroup label={"Revisão de Texto"}>
              <Btn title="Verificar ortografia" onClick={toggleSpellCheck}>
                <SpellCheck size={18} />
                <span className="lbl">Ortografia</span>
              </Btn>
            </RibbonGroup>
            <RibbonGroup label={"Comentários"}>
              <Btn title={"Novo comentário"} onClick={insertComment}>
                <MessageSquarePlus size={18} />
                <span className="lbl">{"Comentário"}</span>
              </Btn>
            </RibbonGroup>
            <RibbonGroup label={"Controle de Alterações"}>
              <Btn title={"Ativar/desativar controle de alterações"} onClick={toggleTrackChanges}>
                <History size={18} color={trackChanges ? '#b5611f' : undefined} />
                <span className="lbl" style={trackChanges ? { color: '#b5611f', fontWeight: 600 } : undefined}>
                  Controlar
                </span>
              </Btn>
            </RibbonGroup>
            <RibbonGroup label="Localizar">
              <Btn title="Localizar / Substituir" onClick={() => openFind(true)}>
                <Search size={18} />
                <span className="lbl">Localizar</span>
              </Btn>
            </RibbonGroup>
          </>
        )}

        {tab === 'exibir' && (
          <>
            <RibbonGroup label="Mostrar">
              <label className="pet-check" title={"Mostrar régua"}>
                <input type="checkbox" checked={showRuler} onChange={toggleRuler} />
                <span>{"Régua"}</span>
              </label>
              <label className="pet-check" title={"Painel de navegação (títulos)"}>
                <input type="checkbox" checked={showNavPane} onChange={toggleNavPane} />
                <span>{"Painel de Navegação"}</span>
              </label>
              <label className="pet-check" title="Recolhe a barra e mostra novamente quando o mouse vai para o topo">
                <input
                  type="checkbox"
                  checked={isCollapsed}
                  onChange={() => {
                    setIsCollapsed((v) => !v);
                    setHoverReveal(false);
                    returnToHomeTab();
                  }}
                />
                <span>Ocultar faixa automaticamente</span>
              </label>
            </RibbonGroup>
            <RibbonGroup label="Zoom">
              <div className="pet-row" style={{ gap: 4 }}>
                <IconBtn title="Diminuir zoom" onClick={() => setZoomFactor(Math.max(50, zoom - 10))}>
                  <span style={{ fontSize: 14 }}>-</span>
                </IconBtn>
                <span className="pet-zoom">{zoom}%</span>
                <IconBtn title="Aumentar zoom" onClick={() => setZoomFactor(Math.min(300, zoom + 10))}>
                  <span style={{ fontSize: 14 }}>+</span>
                </IconBtn>
                <span className="pet-vsep" />
                <Btn small title="100%" onClick={() => setZoomFactor(100)}>
                  <span>100%</span>
                </Btn>
              </div>
            </RibbonGroup>
            <RibbonGroup label="Imprimir">
              <Btn title="Imprimir / Salvar como PDF" onClick={printDoc}>
                <Printer size={18} />
                <span className="lbl">Imprimir</span>
              </Btn>
            </RibbonGroup>
          </>
        )}
      </div>

      {/* Botões de undo/redo flutuantes no canto direito da faixa de abas */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) insertImageFromFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
};

/* ---------- Subcomponentes de UI ---------- */

const RibbonGroup: React.FC<{
  label: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}> = ({ label, children, className, bodyClassName }) => (
  <div className={`pet-group ${className ?? ''}`.trim()}>
    <div className={`pet-group-body ${bodyClassName ?? ''}`.trim()}>{children}</div>
    <div className="pet-group-label">{label}</div>
  </div>
);

const IconBtn: React.FC<{
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ title, active, onClick, children }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={`pet-iconbtn ${active ? 'is-active' : ''}`}
  >
    {children}
  </button>
);

const Btn: React.FC<{
  title: string;
  small?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ title, small, onClick, children }) => (
  <button type="button" title={title} onClick={onClick} className={small ? 'pet-btn-sm' : 'pet-btn-lg'}>
    {children}
  </button>
);

/* ---------- Estilos da faixa (injetados uma vez) ---------- */
const RIBBON_CSS = `
.pet-ribbon{display:flex;flex-direction:column;background:#f6f4f0;border-bottom:1px solid #e6e3dd;flex-shrink:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#3a3a38;user-select:none;position:relative;z-index:40;overflow:visible;}
.pet-ribbon-peek{display:none;}
.pet-ribbon-topslot{display:flex;align-items:center;padding:6px 12px;border-bottom:1px solid #e7e3db;background:#fff;transition:opacity .14s ease,transform .14s ease,max-height .16s ease,padding .16s ease,border-color .16s ease;max-height:64px;overflow-x:auto;overflow-y:hidden;position:relative;z-index:3;}
.pet-ribbon-topslot-inner{display:flex;align-items:center;gap:12px;width:100%;min-width:0;}
.pet-top-group{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:nowrap;}
.pet-top-group.is-left{justify-content:flex-start;flex:1 1 340px;}
.pet-top-group.is-center{justify-content:center;flex:0 1 260px;}
.pet-top-group.is-right{justify-content:flex-end;flex:1 1 360px;min-width:0;margin-left:auto;padding-left:8px;}
.pet-top-grow{flex:1 1 auto;min-width:0;}
.pet-top-shrink{flex:0 1 auto;min-width:0;}
.pet-top-group > *{flex-shrink:0;}
.pet-top-group .pet-top-grow{flex-shrink:1;}
.pet-top-title-input{width:100%;min-width:170px;}
.pet-top-select{width:100%;min-width:180px;max-width:280px;}
.pet-ribbon-topslot::-webkit-scrollbar{height:6px;}
.pet-ribbon-topslot::-webkit-scrollbar-thumb{background:#d6d3cd;border-radius:6px;}
.pet-ribbon-tabs{display:flex;align-items:flex-end;gap:1px;padding:0 8px;height:30px;background:#f6f4f0;position:relative;z-index:2;transition:opacity .14s ease,transform .14s ease;}
.pet-file-wrap{position:relative;display:flex;align-items:flex-end;z-index:10;}
.pet-ribbon-file{padding:0 14px;height:26px;display:flex;align-items:center;font-size:12px;font-weight:600;color:#fff;background:#c0531f;border:none;border-radius:5px 5px 0 0;cursor:pointer;}
.pet-ribbon-file:hover{background:#a8481b;}
.pet-file-menu{position:absolute;top:30px;left:0;z-index:9999;min-width:210px;background:#fff;border:1px solid #e2e0da;border-radius:8px;box-shadow:0 14px 36px rgba(60,50,30,.24);padding:5px;}
.pet-file-item{display:flex;align-items:center;gap:9px;width:100%;padding:8px 10px;border:none;background:transparent;border-radius:5px;font-size:13px;color:#3a3a38;cursor:pointer;text-align:left;}
.pet-file-item:hover{background:#f3efe8;}
.pet-file-sep{height:1px;background:#eee9e1;margin:4px 2px;}
.pet-split-btn{position:relative;display:flex;z-index:6;}
.pet-tablegrid{top:calc(100% + 6px) !important;left:0;right:auto;min-width:max-content;}
.pet-tablegrid-cells{display:grid;grid-template-columns:repeat(8,16px);grid-auto-rows:16px;gap:2px;}
.pet-tablegrid-cell{width:16px;height:16px;border:1px solid #d2cec7;background:#fff;border-radius:2px;cursor:pointer;padding:0;}
.pet-tablegrid-cell.on{background:#e9d8c4;border-color:#c0531f;}
.pet-tablegrid-label{margin-top:6px;text-align:center;font-size:11px;color:#6f6b63;}
.pet-ribbon-tab{padding:0 14px;height:26px;display:flex;align-items:center;font-size:12px;color:#5a574f;background:transparent;border:none;cursor:pointer;border-radius:5px 5px 0 0;}
.pet-ribbon-tab:hover{background:#efece6;}
.pet-ribbon-tab.is-active{color:#c0531f;font-weight:600;background:#fbfaf8;}
.pet-ribbon-collapse{margin-left:auto;margin-bottom:2px;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;border-radius:4px;color:#6c675e;cursor:pointer;flex-shrink:0;}
.pet-ribbon-collapse:hover{background:#efece6;color:#3a3a38;}
.pet-ribbon-body{min-height:66px;max-height:88px;background:#fbfaf8;border-top:1px solid #e6e3dd;padding:3px 8px 2px;display:flex;align-items:stretch;gap:0;overflow:visible;opacity:1;transition:max-height .16s ease,padding .16s ease,border-color .16s ease,opacity .16s ease;position:relative;z-index:2;isolation:isolate;}
.pet-ribbon-body::-webkit-scrollbar{height:6px;}
.pet-ribbon-body::-webkit-scrollbar-thumb{background:#d6d3cd;border-radius:6px;}
.pet-ribbon.is-collapsed{border-bottom-color:transparent;min-height:8px;background:transparent;}
.pet-ribbon.is-collapsed .pet-ribbon-peek{display:block;height:8px;background:linear-gradient(to bottom,rgba(192,83,31,.18),rgba(192,83,31,.04));border-bottom:1px solid rgba(192,83,31,.18);}
.pet-ribbon.is-collapsed .pet-ribbon-topslot{max-height:0;padding-top:0;padding-bottom:0;border-bottom-color:transparent;opacity:0;transform:translateY(-8px);pointer-events:none;overflow:hidden;}
.pet-ribbon.is-collapsed .pet-ribbon-tabs{height:0;padding-top:0;padding-bottom:0;opacity:0;transform:translateY(-8px);overflow:hidden;pointer-events:none;}
.pet-ribbon.is-collapsed .pet-ribbon-body{min-height:0;max-height:0;padding-top:0;padding-bottom:0;border-top-color:transparent;opacity:0;overflow:hidden;pointer-events:none;}
.pet-ribbon.is-collapsed.is-revealed{border-bottom-color:#e6e3dd;background:#f6f4f0;}
.pet-ribbon.is-collapsed.is-revealed .pet-ribbon-peek{display:none;}
.pet-ribbon.is-collapsed.is-revealed .pet-ribbon-topslot{max-height:64px;padding-top:6px;padding-bottom:6px;border-bottom-color:#e7e3db;opacity:1;transform:translateY(0);pointer-events:auto;}
.pet-ribbon.is-collapsed.is-revealed .pet-ribbon-tabs{height:30px;padding-top:0;padding-bottom:0;opacity:1;transform:translateY(0);overflow:visible;pointer-events:auto;}
.pet-ribbon.is-collapsed.is-revealed .pet-ribbon-body{min-height:66px;max-height:88px;padding-top:3px;padding-bottom:2px;border-top-color:#e6e3dd;opacity:1;overflow-x:auto;pointer-events:auto;}

.pet-group{display:flex;flex-direction:column;padding:0 7px;border-right:1px solid #ececec;flex-shrink:0;position:relative;z-index:1;}
.pet-group:last-child{border-right:none;}
.pet-group:has(.pet-popover){z-index:30;}
.pet-group-body{display:flex;flex-direction:column;gap:4px;flex:1;justify-content:center;}
.pet-group-label{font-size:9px;color:#9a958c;text-align:center;padding-top:1px;line-height:1;}
.pet-group.is-slim{padding-left:4px;padding-right:4px;}
.pet-group.is-clipboard{padding-left:6px;padding-right:6px;}
.pet-group-body.is-inline{flex-direction:row;align-items:center;gap:4px;}
.pet-group-body.is-center{justify-content:center;}

.pet-row{display:flex;align-items:center;gap:2px;}
.pet-stack{display:flex;flex-direction:column;gap:2px;justify-content:center;}
.pet-flow-row{display:flex;align-items:center;gap:4px;flex-wrap:wrap;}
.pet-vsep{width:1px;height:16px;background:#e3e0da;margin:0 3px;flex-shrink:0;}

.pet-iconbtn{position:relative;min-width:24px;height:24px;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;border:1px solid transparent;background:transparent;border-radius:4px;color:#4a4843;cursor:pointer;padding:0 3px;}
.pet-iconbtn:hover{background:#efece6;border-color:#e1d7c8;}
.pet-iconbtn.is-active{background:#e9e0d3;color:#b5611f;}
.pet-aplus{font-size:13px;}.pet-aminus{font-size:11px;}
.pet-color-bar{position:absolute;bottom:3px;left:5px;right:5px;height:3px;border-radius:1px;background:#dc2626;box-shadow:0 0 0 1px rgba(0,0,0,.08);}

.pet-btn-lg{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:44px;min-height:34px;border:none;background:transparent;border-radius:4px;color:#4a4843;cursor:pointer;padding:2px 5px;font-size:10px;}
.pet-btn-lg:hover{background:#efece6;}
.pet-btn-lg .lbl{font-size:10px;line-height:1;white-space:nowrap;}
.pet-btn-sm{display:flex;align-items:center;gap:5px;border:none;background:transparent;border-radius:3px;color:#5a574f;cursor:pointer;padding:2px 5px;font-size:10px;text-align:left;}
.pet-btn-sm:hover{background:#efece6;}
.pet-btn-sm span{white-space:nowrap;}
.pet-group.is-clipboard .pet-btn-lg{min-width:40px;min-height:32px;padding:2px 4px;}
.pet-group.is-clipboard .pet-stack{min-width:78px;}
.pet-group.is-slim .pet-btn-sm{padding:2px 4px;}

.pet-select{height:23px;padding:0 6px;background:#fff;border:1px solid #d2cec7;border-radius:4px;font-size:11px;color:#3a3a38;cursor:pointer;outline:none;}
.pet-select:hover{border-color:#c0531f;}
.pet-font{width:140px;}
.pet-size{width:50px;}
.pet-spacing{width:42px;text-align:center;}

.pet-split{position:relative;display:flex;align-items:center;border:1px solid #ddd7cc;border-radius:6px;background:#fff;box-shadow:0 1px 0 rgba(255,255,255,.8) inset;z-index:8;}
.pet-split:hover{border-color:#d0b189;}
.pet-split.is-open{border-color:#c0531f;box-shadow:0 0 0 1px rgba(192,83,31,.16);}
.pet-split .pet-iconbtn{border-color:transparent;border-radius:0;background:transparent;}
.pet-split .pet-iconbtn:hover{background:#f6f1e9;border-color:transparent;}
.pet-split-main{min-width:26px;padding:0 3px;border-radius:5px 0 0 5px !important;}
.pet-split-caret{min-width:16px;padding:0;border-left:1px solid #ebe4d8;border-radius:0 5px 5px 0 !important;color:#6b675f;}
.pet-popover{position:absolute;top:calc(100% + 6px);left:0;z-index:9999;background:#fff;border:1px solid #e2e0da;border-radius:8px;box-shadow:0 12px 32px rgba(60,50,30,.22);padding:8px;}
.pet-swatches{display:grid;grid-template-columns:repeat(5,18px);gap:5px;}
.pet-swatch{width:18px;height:18px;border-radius:3px;border:1px solid rgba(0,0,0,.18);cursor:pointer;padding:0;box-shadow:0 0 0 1px rgba(255,255,255,.7) inset;}
.pet-swatch:hover{transform:scale(1.12);}
.pet-swatch[style*="#ffffff"]{background-image:linear-gradient(45deg,#f1f1f1 25%,transparent 25%,transparent 75%,#f1f1f1 75%,#f1f1f1),linear-gradient(45deg,#f1f1f1 25%,transparent 25%,transparent 75%,#f1f1f1 75%,#f1f1f1);background-position:0 0,4px 4px;background-size:8px 8px;}
.pet-swatch-lg{width:22px;height:22px;}
.pet-swatches:has(.pet-swatch-lg){grid-template-columns:repeat(4,22px);}

.pet-styles{display:flex;gap:5px;align-items:center;height:100%;}
.pet-style{display:flex;flex-direction:column;justify-content:center;gap:1px;width:78px;height:42px;padding:0 8px;background:#fff;border:1px solid #e0ddd6;border-radius:4px;cursor:pointer;text-align:left;}
.pet-style:hover{border-color:#d8b98a;}
.pet-style.is-active{border-color:#c0531f;box-shadow:0 0 0 1px #c0531f inset;}
.pet-style-custom{background:#fffdf9;}
.pet-style-add{border-style:dashed;color:#9a6a32;justify-content:center;align-items:center;text-align:center;}
.pet-style-add-preview{display:flex;align-items:center;justify-content:center;gap:4px;font-size:11px;font-weight:600;color:#9a6a32;}
.pet-style-name{font-size:8px;color:#9a958c;}
.pet-style-preview{line-height:1;}

.pet-check{display:flex;align-items:center;gap:7px;font-size:12px;color:#5a574f;cursor:pointer;}
.pet-check input{width:14px;height:14px;accent-color:#c0531f;cursor:pointer;}
.pet-zoom{font-size:12px;color:#5a574f;min-width:38px;text-align:center;}

.pet-ribbon-body[data-tab="inserir"],
.pet-ribbon-body[data-tab="layout"],
.pet-ribbon-body[data-tab="revisao"],
.pet-ribbon-body[data-tab="exibir"]{min-height:50px;max-height:72px;align-items:flex-start;}
.pet-ribbon-body[data-tab="inserir"] .pet-group-body,
.pet-ribbon-body[data-tab="layout"] .pet-group-body,
.pet-ribbon-body[data-tab="revisao"] .pet-group-body,
.pet-ribbon-body[data-tab="exibir"] .pet-group-body{flex-direction:row;align-items:center;gap:4px;}
.pet-ribbon-body[data-tab="inserir"] .pet-btn-lg,
.pet-ribbon-body[data-tab="layout"] .pet-btn-lg,
.pet-ribbon-body[data-tab="revisao"] .pet-btn-lg,
.pet-ribbon-body[data-tab="exibir"] .pet-btn-lg{min-width:50px;min-height:32px;padding:2px 5px;}
.pet-ribbon-body[data-tab="layout"] .pet-group-body .pet-stack,
.pet-ribbon-body[data-tab="revisao"] .pet-group-body .pet-stack,
.pet-ribbon-body[data-tab="exibir"] .pet-group-body .pet-stack{justify-content:flex-start;}
.pet-ribbon-body[data-tab="layout"] .pet-group,
.pet-ribbon-body[data-tab="inserir"] .pet-group,
.pet-ribbon-body[data-tab="revisao"] .pet-group,
.pet-ribbon-body[data-tab="exibir"] .pet-group{padding-top:1px;padding-bottom:1px;}
.pet-ribbon.is-collapsed.is-revealed .pet-ribbon-body[data-tab="inserir"],
.pet-ribbon.is-collapsed.is-revealed .pet-ribbon-body[data-tab="layout"],
.pet-ribbon.is-collapsed.is-revealed .pet-ribbon-body[data-tab="revisao"],
.pet-ribbon.is-collapsed.is-revealed .pet-ribbon-body[data-tab="exibir"]{min-height:50px;max-height:72px;}

@media (max-width:639px){
  .pet-ribbon-topslot{padding:4px 8px;}
  .pet-ribbon-topslot-inner{gap:6px;flex-wrap:nowrap;}
  .pet-top-group.is-center{display:none;}
  .pet-top-group.is-right{flex:0 0 auto;}
  .pet-top-group.is-left{flex:1 1 auto;min-width:0;gap:4px;}
  .pet-top-title-input{min-width:90px;}
  .pet-ribbon-tabs{overflow-x:auto;overflow-y:hidden;gap:0;padding:0 4px;scrollbar-width:none;}
  .pet-ribbon-tabs::-webkit-scrollbar{display:none;}
  .pet-ribbon-body{overflow-x:auto;overflow-y:hidden;scrollbar-width:none;}
  .pet-ribbon-body::-webkit-scrollbar{display:none;}
  .pet-ribbon-file{padding:0 10px;font-size:11px;}
  .pet-ribbon-tab{padding:0 10px;font-size:11px;white-space:nowrap;}
  .pet-font{width:100px;}
  .pet-size{width:44px;}
  .pet-style{width:64px;}
  .pet-styles{gap:3px;}
}
`;

if (typeof document !== 'undefined' && !document.getElementById('petition-ribbon-styles')) {
  const el = document.createElement('style');
  el.id = 'petition-ribbon-styles';
  el.innerHTML = RIBBON_CSS;
  document.head.appendChild(el);
}

export default PetitionRibbon;
