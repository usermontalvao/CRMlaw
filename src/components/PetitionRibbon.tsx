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
  Moon,
  Sun,
} from 'lucide-react';
import type { SyncfusionEditorRef } from './SyncfusionEditor';
import { profileService, type PetitionRibbonCustomStyle } from '../services/profile.service';

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
  beforeSpacing: number;
  afterSpacing: number;
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
  beforeSpacing: 0,
  afterSpacing: 0,
};

type CustomStylePreset = PetitionRibbonCustomStyle;

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
  /** Modo escuro: estado controlado pelo modulo (fonte unica de verdade). */
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
}

const PetitionRibbon: React.FC<PetitionRibbonProps> = ({
  editorRef,
  ready,
  topContent,
  darkMode = false,
  onToggleDarkMode,
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
  const [pasteMenuOpen, setPasteMenuOpen] = useState(false);
  const [caseMenuOpen, setCaseMenuOpen] = useState(false);
  const [pageNumberMenuOpen, setPageNumberMenuOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceSearch, setReplaceSearch] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [tableGridOpen, setTableGridOpen] = useState(false);
  const [tableHover, setTableHover] = useState({ r: 0, c: 0 });
  const [showRevisions, setShowRevisions] = useState(true);
  const [showHiddenMarks, setShowHiddenMarks] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [layoutMode, setLayoutMode] = useState<'Pages' | 'Continuous'>('Pages');
  const [isProtected, setIsProtected] = useState(false);
  const [formatPainterPreset, setFormatPainterPreset] = useState<CustomStylePreset | null>(null);
  const [formatPainterArmed, setFormatPainterArmed] = useState(false);
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
  const customStylesHydratedRef = useRef(false);
  const customStylesSavedRef = useRef<string>('');
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
    let cancelled = false;
    const loadCustomStyles = async () => {
      let fallbackLocal: CustomStylePreset[] = [];
      try {
        const raw = window.localStorage.getItem(CUSTOM_STYLES_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        fallbackLocal = Array.isArray(parsed) ? parsed : [];
      } catch {
        fallbackLocal = [];
      }

      try {
        const remoteStyles = await profileService.getMyPetitionRibbonCustomStyles();
        const nextStyles = Array.isArray(remoteStyles) ? remoteStyles : fallbackLocal;
        if (!cancelled) {
          setCustomStyles(nextStyles);
          customStylesSavedRef.current = JSON.stringify(nextStyles);
        }
      } catch {
        if (!cancelled) {
          setCustomStyles(fallbackLocal);
          customStylesSavedRef.current = JSON.stringify(fallbackLocal);
        }
      } finally {
        if (!cancelled) customStylesHydratedRef.current = true;
      }
    };

    void loadCustomStyles();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(CUSTOM_STYLES_STORAGE_KEY, JSON.stringify(customStyles));
    } catch {
      // ignore
    }
    if (!customStylesHydratedRef.current) return;
    const serialized = JSON.stringify(customStyles);
    if (serialized === customStylesSavedRef.current) return;

    const timer = window.setTimeout(() => {
      profileService
        .updateMyPetitionRibbonCustomStyles(customStyles)
        .then((saved) => {
          if (saved) {
            customStylesSavedRef.current = serialized;
          }
        })
        .catch(() => {
          // keep local fallback if sync fails
        });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [customStyles]);
  useEffect(() => {
    try {
      editorRef.current?.setShowRuler?.(showRuler);
    } catch {
      // ignore
    }
  }, [editorRef, showRuler]);
  // Garante que o CSS da faixa (incluindo o tema escuro) esteja aplicado e
  // atualizado sempre que o editor montar. A injeção no topo do módulo pode
  // não re-executar sob HMR/Fast Refresh, então reforçamos aqui.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('petition-ribbon-styles');
    if (!el) {
      el = document.createElement('style');
      el.id = 'petition-ribbon-styles';
      document.head.appendChild(el);
    }
    el.innerHTML = RIBBON_CSS;
  }, []);

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
        // Reflete "tem espaço?" (inclui o flag "auto") para o rótulo do menu
        // alternar entre Adicionar/Remover, como no Word (12 = valor > 0 qualquer).
        beforeSpacing: pf.spaceBeforeAuto === true ? 12 : (typeof pf.beforeSpacing === 'number' ? pf.beforeSpacing : 0),
        afterSpacing: pf.spaceAfterAuto === true ? 12 : (typeof pf.afterSpacing === 'number' ? pf.afterSpacing : 0),
      });
      if (typeof ed.zoomFactor === 'number') {
        setZoom(Math.round(ed.zoomFactor * 100));
      }
      if (typeof ed.enableTrackChanges === 'boolean') {
        setTrackChanges(ed.enableTrackChanges);
      }
      if (typeof ed.showRevisions === 'boolean') {
        setShowRevisions(ed.showRevisions);
      }
      if (typeof ed.showHiddenMarks === 'boolean') {
        setShowHiddenMarks(ed.showHiddenMarks);
      }
      if (typeof ed.showBookmarks === 'boolean') {
        setShowBookmarks(ed.showBookmarks);
      }
      if (ed.layoutType === 'Pages' || ed.layoutType === 'Continuous') {
        setLayoutMode(ed.layoutType);
      }
      setIsProtected(Boolean(String(ed.restrictEditing || '').trim()));
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
  const applySelectionCase = useCallback(
    (mode: 'sentence' | 'lower' | 'upper' | 'title' | 'toggle') => {
      const changed = editorRef.current?.transformSelectionCase?.(mode);
      if (changed) {
        syncFmt();
      }
      setCaseMenuOpen(false);
    },
    [editorRef, syncFmt],
  );
  const setAlign = (v: FmtState['alignment']) =>
    run((ed) => {
      if (ed.selection?.paragraphFormat) ed.selection.paragraphFormat.textAlignment = v;
    });
  const applyStyle = (name: string) =>
    run((ed) => {
      ed.editor?.applyStyle?.(name, true);
    });
  const captureSelectionStylePreset = useCallback(
    (nameFallback: string) => {
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
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: nameFallback,
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
      } satisfies CustomStylePreset;
    },
    [fmt, getEd],
  );
  const captureCurrentStyle = () => {
    const name = window.prompt('Nome do estilo personalizado:', '');
    if (!name?.trim()) return;
    const trimmed = name.trim();
    const nextStyle = captureSelectionStylePreset(trimmed);
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
  const toggleFormatPainter = () => {
    if (formatPainterArmed && formatPainterPreset) {
      applyCustomStyle(formatPainterPreset);
      setFormatPainterArmed(false);
      setFormatPainterPreset(null);
      return;
    }
    const preset = captureSelectionStylePreset('Pincel de formatação');
    setFormatPainterPreset(preset);
    setFormatPainterArmed(true);
    window.alert('Formato capturado. Selecione o texto de destino e clique no pincel novamente para aplicar.');
  };
  const runPasteMode = async (mode: 'source' | 'merge' | 'text' | 'clean') => {
    try {
      let ok = false;
      if (mode === 'source') ok = (await editorRef.current?.pasteWithSourceFormatting?.()) ?? false;
      else if (mode === 'merge') ok = (await editorRef.current?.pasteWithMergedFormatting?.()) ?? false;
      else if (mode === 'text') ok = (await editorRef.current?.pasteAsPlainText?.()) ?? false;
      else ok = (await editorRef.current?.pasteCleanedFromWord?.()) ?? false;

      if (!ok) {
        window.alert('Não foi possível colar com esse modo. Verifique a permissão da área de transferência.');
      }
    } catch {
      window.alert('Não foi possível acessar a área de transferência neste navegador.');
    } finally {
      setPasteMenuOpen(false);
      window.setTimeout(() => editorRef.current?.focus?.(), 0);
      syncFmt();
    }
  };
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
  const openListDialog = () => runAndReturnHome((ed) => ed.showListDialog?.());

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
  const insertPageNumberAt = (region: 'header' | 'footer', align: 'Left' | 'Center' | 'Right') =>
    runAndReturnHome((ed) => {
      if (region === 'header') ed.selection?.goToHeader?.();
      else ed.selection?.goToFooter?.();
      if (ed.selection?.paragraphFormat) {
        ed.selection.paragraphFormat.textAlignment = align;
      }
      ed.editor?.insertPageNumber?.();
      setPageNumberMenuOpen(false);
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
  // Alterna espaço de parágrafo antes/depois, como no Word (item "Adicionar/Remover
  // Espaço ... de Parágrafo"). Aplica a TODOS os parágrafos da seleção (o setter do
  // Syncfusion age sobre a seleção inteira). Sem espaço -> aplica 12pt; com espaço
  // (inclusive espaçamento "auto" de DOCX) -> zera. Zeramos também o flag "auto",
  // senão ele sobrepõe o valor numérico e nada muda (é o que fazia parecer bugado).
  const PARAGRAPH_SPACE_PT = 12;
  const paragraphHasSpace = (pf: any, which: 'before' | 'after'): boolean => {
    if (which === 'before') {
      return pf?.spaceBeforeAuto === true || (typeof pf?.beforeSpacing === 'number' && pf.beforeSpacing > 0);
    }
    return pf?.spaceAfterAuto === true || (typeof pf?.afterSpacing === 'number' && pf.afterSpacing > 0);
  };
  const toggleParagraphSpace = (which: 'before' | 'after') =>
    run((ed) => {
      const pf = ed.selection?.paragraphFormat;
      if (!pf) return;
      const has = paragraphHasSpace(pf, which);
      if (which === 'before') {
        pf.spaceBeforeAuto = false;
        pf.beforeSpacing = has ? 0 : PARAGRAPH_SPACE_PT;
      } else {
        pf.spaceAfterAuto = false;
        pf.afterSpacing = has ? 0 : PARAGRAPH_SPACE_PT;
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
  const replaceAll = () => {
    const search = replaceSearch.trim();
    if (!search) {
      window.alert('Informe o texto que deseja localizar.');
      return;
    }
    const changed = editorRef.current?.replaceAll?.(search, replaceValue) ?? false;
    if (!changed) {
      window.alert('Não foi possível substituir no editor atual.');
      return;
    }
    setReplaceOpen(false);
    returnToHomeTab();
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
  const toggleShowRevisions = () => {
    const next = !showRevisions;
    setShowRevisions(next);
    runAndReturnHome((ed) => {
      if (typeof ed.showRevisions === 'boolean') {
        ed.showRevisions = next;
      }
      ed.viewer?.showRevisions?.(next);
    }, false);
  };
  const acceptAllRevisions = () =>
    runAndReturnHome((ed) => {
      ed.revisions?.acceptAll?.();
    });
  const rejectAllRevisions = () =>
    runAndReturnHome((ed) => {
      ed.revisions?.rejectAll?.();
    });
  const navigateRevision = (direction: 'previous' | 'next') =>
    run((ed) => {
      if (direction === 'previous') ed.selection?.navigatePreviousRevision?.();
      else ed.selection?.navigateNextRevision?.();
    }, false);
  const toggleHiddenMarks = () => {
    const next = !showHiddenMarks;
    setShowHiddenMarks(next);
    runAndReturnHome((ed) => {
      ed.showHiddenMarks = next;
    }, false);
  };
  const toggleBookmarks = () => {
    const next = !showBookmarks;
    setShowBookmarks(next);
    runAndReturnHome((ed) => {
      ed.showBookmarks = next;
    }, false);
  };
  const setEditorLayoutMode = (mode: 'Pages' | 'Continuous') => {
    setLayoutMode(mode);
    runAndReturnHome((ed) => {
      ed.layoutType = mode;
      ed.resize?.();
    }, false);
  };
  const toggleRestrictEditing = async () => {
    const ed = getEd();
    if (!ed?.editor) return;
    try {
      const active = Boolean(String(ed.restrictEditing || '').trim());
      if (active) {
        const password = window.prompt('Digite a senha para liberar a edição:', '');
        if (password === null) return;
        if (typeof ed.editor.stopProtectionAsync === 'function') {
          await ed.editor.stopProtectionAsync(password);
        } else {
          ed.editor.stopProtection?.(password);
        }
        setIsProtected(false);
      } else {
        const password = window.prompt('Defina uma senha para restringir a edição:', '');
        if (!password) return;
        if (typeof ed.editor.enforceProtectionAsync === 'function') {
          await ed.editor.enforceProtectionAsync(password, 'ReadOnly');
        } else {
          ed.editor.enforceProtection?.(password, 'ReadOnly');
        }
        setIsProtected(true);
      }
      syncFmt();
      returnToHomeTab();
    } catch {
      window.alert('Não foi possível alterar a proteção do documento.');
    }
  };
  const setZoomFactor = (pct: number) =>
    runAndReturnHome((ed) => {
      ed.zoomFactor = pct / 100;
    }, false);
  const toggleDarkMode = () => {
    onToggleDarkMode?.();
    returnToHomeTab();
  };
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
  const applyColumnsPreset = (columns: number) =>
    runAndReturnHome((ed) => {
      ed.editor?.applyColumnFormat?.(Math.max(1, columns), true);
    });

  // Fecha popovers/menus ao clicar fora
  useEffect(() => {
    if (!colorOpen && !highlightOpen && !pasteMenuOpen && !caseMenuOpen && !pageNumberMenuOpen && !replaceOpen && !fileMenuOpen && !tableGridOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.('[data-ribbon-popover]')) {
        setColorOpen(false);
        setHighlightOpen(false);
        setPasteMenuOpen(false);
        setCaseMenuOpen(false);
        setPageNumberMenuOpen(false);
        setReplaceOpen(false);
        setFileMenuOpen(false);
        setTableGridOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [colorOpen, highlightOpen, pasteMenuOpen, caseMenuOpen, pageNumberMenuOpen, replaceOpen, fileMenuOpen, tableGridOpen]);

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
          setPasteMenuOpen(false);
          setCaseMenuOpen(false);
          setPageNumberMenuOpen(false);
          setReplaceOpen(false);
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
              <div className="pet-split-btn" data-ribbon-popover>
                <Btn title="Colar" onClick={() => run((ed) => ed.editor?.paste?.())}>
                  <ClipboardPaste size={18} />
                  <span className="lbl">Colar</span>
                </Btn>
                <button
                  type="button"
                  className="pet-iconbtn"
                  title="Opções de colagem"
                  onClick={() => {
                    if (isCollapsed) setHoverReveal(true);
                    setPasteMenuOpen((v) => !v);
                    setColorOpen(false);
                    setHighlightOpen(false);
                  }}
                  style={{ minWidth: 30 }}
                >
                  <ChevronDown size={14} />
                </button>
                {pasteMenuOpen && (
                  <div className="pet-popover" data-ribbon-popover style={{ width: 250, padding: 6 }}>
                    <div className="pet-menu-list">
                      <button type="button" className="pet-file-item" onClick={() => void runPasteMode('source')}>
                        Manter formatação original
                      </button>
                      <button type="button" className="pet-file-item" onClick={() => void runPasteMode('merge')}>
                        Mesclar com a formatação atual
                      </button>
                      <button type="button" className="pet-file-item" onClick={() => void runPasteMode('text')}>
                        Colar somente texto
                      </button>
                      <button type="button" className="pet-file-item" onClick={() => void runPasteMode('clean')}>
                        Limpar estilos problemáticos do Word
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="pet-stack">
                <Btn small title="Recortar" onClick={() => run((ed) => ed.editor?.cut?.())}>
                  <Scissors size={14} /> <span>Recortar</span>
                </Btn>
                <Btn small title="Copiar" onClick={() => run((ed) => ed.selection?.copy?.())}>
                  <Copy size={14} /> <span>Copiar</span>
                </Btn>
                <Btn small title="Pincel de formatação" onClick={toggleFormatPainter}>
                  <span style={formatPainterArmed ? { color: '#b5611f', fontWeight: 700 } : undefined}>Pincel</span>
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
                <div className="pet-split-btn" data-ribbon-popover>
                  <button
                    type="button"
                    className="pet-iconbtn"
                    title="Alterar maiúsculas e minúsculas"
                    onClick={() => {
                      if (isCollapsed) setHoverReveal(true);
                      setCaseMenuOpen((v) => !v);
                      setColorOpen(false);
                      setHighlightOpen(false);
                    }}
                    style={{ minWidth: 36, fontWeight: 600, letterSpacing: '-0.02em' }}
                  >
                    Aa
                  </button>
                  {caseMenuOpen && (
                    <div className="pet-popover" data-ribbon-popover style={{ width: 220, padding: 6 }}>
                      <div className="pet-menu-list">
                        <button type="button" className="pet-file-item" onClick={() => applySelectionCase('sentence')}>
                          Primeira letra da frase em maiúscula
                        </button>
                        <button type="button" className="pet-file-item" onClick={() => applySelectionCase('lower')}>
                          minúscula
                        </button>
                        <button type="button" className="pet-file-item" onClick={() => applySelectionCase('upper')}>
                          MAIÚSCULAS
                        </button>
                        <button type="button" className="pet-file-item" onClick={() => applySelectionCase('title')}>
                          Colocar Cada Palavra em Maiúscula
                        </button>
                        <button type="button" className="pet-file-item" onClick={() => applySelectionCase('toggle')}>
                          aLTERNAR mAIÚSC./mINÚSC.
                        </button>
                      </div>
                    </div>
                  )}
                </div>
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
                <IconBtn title="Lista multinível" onClick={openListDialog}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>1.1</span>
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
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'space-before') toggleParagraphSpace('before');
                    else if (v === 'space-after') toggleParagraphSpace('after');
                    else if (v) setLineSpacing(Number(v));
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
                  <option value="2.5">2,5</option>
                  <option value="3">3,0</option>
                  <option value="space-before">
                    {fmt.beforeSpacing > 0 ? 'Remover Espaço Antes de Parágrafo' : 'Adicionar Espaço Antes de Parágrafo'}
                  </option>
                  <option value="space-after">
                    {fmt.afterSpacing > 0 ? 'Remover Espaço Depois de Parágrafo' : 'Adicionar Espaço Depois de Parágrafo'}
                  </option>
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
                <div className="pet-split-btn" data-ribbon-popover>
                  <Btn
                    small
                    title="Substituir texto"
                    onClick={() => {
                      if (isCollapsed) setHoverReveal(true);
                      setReplaceOpen((v) => !v);
                    }}
                  >
                    <span>Substituir</span>
                  </Btn>
                  {replaceOpen && (
                    <div className="pet-popover" data-ribbon-popover style={{ width: 260 }}>
                      <div className="pet-replace-pop">
                        <input
                          type="text"
                          className="pet-input"
                          value={replaceSearch}
                          onChange={(e) => setReplaceSearch(e.target.value)}
                          placeholder="Localizar"
                        />
                        <input
                          type="text"
                          className="pet-input"
                          value={replaceValue}
                          onChange={(e) => setReplaceValue(e.target.value)}
                          placeholder="Substituir por"
                        />
                        <div className="pet-flow-row">
                          <Btn small title="Abrir localizar" onClick={() => openFind()}>
                            <span>Localizar</span>
                          </Btn>
                          <Btn small title="Substituir tudo" onClick={replaceAll}>
                            <span>Substituir Tudo</span>
                          </Btn>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
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
              <div className="pet-split-btn" data-ribbon-popover>
                <Btn
                  title={"Número de página"}
                  onClick={() => {
                    if (isCollapsed) setHoverReveal(true);
                    setPageNumberMenuOpen((v) => !v);
                  }}
                >
                  <Hash size={18} />
                  <span className="lbl">{"Nº Página"}</span>
                </Btn>
                {pageNumberMenuOpen && (
                  <div className="pet-popover" data-ribbon-popover style={{ width: 240 }}>
                    <div className="pet-replace-pop">
                      <button type="button" className="pet-file-item" onClick={() => insertPageNumberAt('header', 'Left')}>
                        Topo à esquerda
                      </button>
                      <button type="button" className="pet-file-item" onClick={() => insertPageNumberAt('header', 'Center')}>
                        Topo centralizado
                      </button>
                      <button type="button" className="pet-file-item" onClick={() => insertPageNumberAt('header', 'Right')}>
                        Topo à direita
                      </button>
                      <button type="button" className="pet-file-item" onClick={() => insertPageNumberAt('footer', 'Left')}>
                        Rodapé à esquerda
                      </button>
                      <button type="button" className="pet-file-item" onClick={() => insertPageNumberAt('footer', 'Center')}>
                        Rodapé centralizado
                      </button>
                      <button type="button" className="pet-file-item" onClick={() => insertPageNumberAt('footer', 'Right')}>
                        Rodapé à direita
                      </button>
                    </div>
                  </div>
                )}
              </div>
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
              <Btn title={"Inserir nota de fim"} onClick={() => runAndReturnHome((ed) => ed.editor?.insertEndnote?.())}>
                <StickyNote size={18} />
                <span className="lbl">{"Nota de Fim"}</span>
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
                <Btn small title="Bordas do parágrafo / tabela" onClick={() => runAndReturnHome((ed) => ed.showBordersAndShadingDialog?.())}>
                  <span>Bordas</span>
                </Btn>
              </div>
              <select
                className="pet-select"
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'space-before') toggleParagraphSpace('before');
                  else if (v === 'space-after') toggleParagraphSpace('after');
                  else if (v) setLineSpacing(Number(v));
                }}
                  title={"Espaçamento entre linhas"}
              >
                <option value="" disabled>
                  {"Espaçamento"}
                </option>
                <option value="1">Simples</option>
                <option value="1.15">1,15</option>
                <option value="1.5">1,5 linhas</option>
                <option value="2">Duplo</option>
                <option value="2.5">2,5</option>
                <option value="3">3,0</option>
                <option value="space-before">
                  {fmt.beforeSpacing > 0 ? 'Remover Espaço Antes de Parágrafo' : 'Adicionar Espaço Antes de Parágrafo'}
                </option>
                <option value="space-after">
                  {fmt.afterSpacing > 0 ? 'Remover Espaço Depois de Parágrafo' : 'Adicionar Espaço Depois de Parágrafo'}
                </option>
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
            <RibbonGroup label={"Colunas"}>
              <div className="pet-flow-row">
                <Btn small title="Uma coluna" onClick={() => applyColumnsPreset(1)}>
                  <span>1</span>
                </Btn>
                <Btn small title="Duas colunas" onClick={() => applyColumnsPreset(2)}>
                  <span>2</span>
                </Btn>
                <Btn small title="Três colunas" onClick={() => applyColumnsPreset(3)}>
                  <span>3</span>
                </Btn>
                <Btn small title="Mais opções de colunas" onClick={() => runAndReturnHome((ed) => ed.showColumnsDialog?.())}>
                  <span>Mais</span>
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
            <RibbonGroup label={"Marcações"} className="is-slim" bodyClassName="is-inline is-center">
              <div className="pet-stack">
                <label className="pet-check" title="Mostrar ou ocultar marcações de revisão">
                  <input type="checkbox" checked={showRevisions} onChange={toggleShowRevisions} />
                  <span>Mostrar</span>
                </label>
                <div className="pet-flow-row">
                  <Btn small title="Revisão anterior" onClick={() => navigateRevision('previous')}>
                    <span>Anterior</span>
                  </Btn>
                  <Btn small title="Próxima revisão" onClick={() => navigateRevision('next')}>
                    <span>Próxima</span>
                  </Btn>
                </div>
              </div>
            </RibbonGroup>
            <RibbonGroup label={"Aceitar / Rejeitar"} className="is-slim" bodyClassName="is-inline is-center">
              <div className="pet-stack">
                <Btn small title="Aceitar todas as alterações" onClick={acceptAllRevisions}>
                  <span>Aceitar Tudo</span>
                </Btn>
                <Btn small title="Rejeitar todas as alterações" onClick={rejectAllRevisions}>
                  <span>Rejeitar Tudo</span>
                </Btn>
              </div>
            </RibbonGroup>
            <RibbonGroup label={"Proteção"} className="is-slim" bodyClassName="is-inline is-center">
              <div className="pet-stack">
                <Btn small title="Restringir ou liberar edição com senha" onClick={() => void toggleRestrictEditing()}>
                  <span style={isProtected ? { color: '#b5611f', fontWeight: 700 } : undefined}>
                    {isProtected ? 'Liberar Edição' : 'Restringir Edição'}
                  </span>
                </Btn>
              </div>
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
              <label className="pet-check" title="Mostrar marcas ocultas, parágrafos e quebras">
                <input type="checkbox" checked={showHiddenMarks} onChange={toggleHiddenMarks} />
                <span>Marcas</span>
              </label>
              <label className="pet-check" title="Mostrar indicadores (bookmarks)">
                <input type="checkbox" checked={showBookmarks} onChange={toggleBookmarks} />
                <span>Indicadores</span>
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
            <RibbonGroup label="Modo">
              <div className="pet-flow-row">
                <Btn small title="Modo de páginas" onClick={() => setEditorLayoutMode('Pages')}>
                  <span style={layoutMode === 'Pages' ? { color: '#b5611f', fontWeight: 700 } : undefined}>Páginas</span>
                </Btn>
                <Btn small title="Modo contínuo" onClick={() => setEditorLayoutMode('Continuous')}>
                  <span style={layoutMode === 'Continuous' ? { color: '#b5611f', fontWeight: 700 } : undefined}>Contínuo</span>
                </Btn>
              </div>
            </RibbonGroup>
            <RibbonGroup label="Tema">
              <div className="pet-flow-row">
                <Btn
                  small
                  title={darkMode ? 'Voltar ao modo claro' : 'Modo escuro (igual ao Word)'}
                  onClick={toggleDarkMode}
                >
                  {darkMode ? <Sun size={15} /> : <Moon size={15} />}
                  <span style={darkMode ? { color: '#ff9d57', fontWeight: 700 } : undefined}>
                    {darkMode ? 'Modo claro' : 'Modo escuro'}
                  </span>
                </Btn>
              </div>
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
                <Btn small title="Ajustar largura" onClick={() => runAndReturnHome((ed) => ed.fitPage?.('FitPageWidth'), false)}>
                  <span>Largura</span>
                </Btn>
                <Btn small title="Página inteira" onClick={() => runAndReturnHome((ed) => ed.fitPage?.('FitOnePage'), false)}>
                  <span>Página</span>
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
.pet-ribbon-topslot{display:flex;align-items:center;padding:8px 14px;border-bottom:1px solid #ece8e0;background:linear-gradient(180deg,#ffffff 0%,#fbfaf8 100%);transition:opacity .14s ease,transform .14s ease,max-height .16s ease,padding .16s ease,border-color .16s ease;max-height:78px;overflow-x:auto;overflow-y:hidden;position:relative;z-index:3;}
.pet-ribbon-topslot-inner{display:flex;align-items:center;gap:10px;width:100%;min-width:0;}
.pet-top-group{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:nowrap;}
.pet-top-group.is-left{justify-content:flex-start;flex:1 1 460px;}
.pet-top-group.is-center{justify-content:center;flex:0 1 340px;}
.pet-top-group.is-right{justify-content:flex-end;flex:0 1 auto;min-width:0;margin-left:auto;padding-left:8px;}
.pet-top-grow{flex:1 1 auto;min-width:0;}
.pet-top-shrink{flex:0 1 auto;min-width:0;}
.pet-top-group > *{flex-shrink:0;}
.pet-top-group .pet-top-grow{flex-shrink:1;}
.pet-top-title-input{width:100%;min-width:210px;}
.pet-top-select{width:100%;min-width:210px;max-width:320px;}
.pet-top-cluster{display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid #ece8df;border-radius:14px;background:#fff;box-shadow:0 1px 0 rgba(255,255,255,.8) inset;}
.pet-top-cluster.is-utility{padding:4px;}
.pet-top-title-shell{display:flex;align-items:center;min-height:42px;padding:0 2px;border:1px solid #ece8df;border-radius:16px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.04), inset 0 1px 0 rgba(255,255,255,.85);}
.pet-top-title-shell:focus-within{border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.12);}
.pet-top-filter-shell{display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid #ece8df;border-radius:16px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.04), inset 0 1px 0 rgba(255,255,255,.85);}
.pet-top-client-chip{display:flex;align-items:center;gap:6px;min-width:0;max-width:280px;padding:4px 8px 4px 10px;border:1px solid #f5d28b;border-radius:14px;background:linear-gradient(180deg,#fff9ec 0%,#fff4d9 100%);font-size:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.72);}
.pet-top-meta-chip{padding:6px 10px;border:1px solid #ece8df;border-radius:12px;background:#f8fafc;font-size:11px;color:#64748b;box-shadow:inset 0 1px 0 rgba(255,255,255,.8);}
.pet-top-actionbar{display:flex;align-items:center;gap:6px;padding:4px;border:1px solid #ece8df;border-radius:14px;background:#fff;box-shadow:0 1px 0 rgba(255,255,255,.8) inset;}
.pet-top-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:none;border-radius:10px;background:transparent;color:#64748b;cursor:pointer;transition:background .15s ease,color .15s ease,transform .15s ease;}
.pet-top-icon-btn:hover{background:#f8f5ef;color:#b5611f;}
.pet-top-icon-btn.is-soft{background:#fbfaf8;}
.pet-top-icon-btn.is-chip{width:24px;height:24px;border-radius:8px;color:#b5611f;}
.pet-top-icon-btn.is-chip:hover{background:#f8deb0;color:#92400e;}
.pet-top-icon-btn.is-danger:hover{background:#fff1f2;color:#dc2626;}
.pet-top-text-btn,.pet-top-primary-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:none;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s ease,color .15s ease,box-shadow .15s ease;}
.pet-top-text-btn{background:transparent;color:#475569;}
.pet-top-text-btn:hover{background:#f8f5ef;color:#b5611f;}
.pet-top-primary-btn{background:#f59e0b;color:#fff;box-shadow:0 8px 18px rgba(245,158,11,.22);}
.pet-top-primary-btn:hover{background:#d97706;}
.pet-top-primary-btn:disabled{opacity:.55;cursor:not-allowed;box-shadow:none;}
.pet-ribbon-topslot::-webkit-scrollbar{height:6px;}
.pet-ribbon-topslot::-webkit-scrollbar-thumb{background:#d6d3cd;border-radius:6px;}
.pet-ribbon-tabs{display:flex;align-items:flex-end;gap:1px;padding:0 8px;height:30px;background:#f6f4f0;position:relative;z-index:2;transition:opacity .14s ease,transform .14s ease;}
.pet-file-wrap{position:relative;display:flex;align-items:flex-end;z-index:10;}
.pet-ribbon-file{padding:0 14px;height:26px;display:flex;align-items:center;font-size:12px;font-weight:600;color:#fff;background:#c0531f;border:none;border-radius:5px 5px 0 0;cursor:pointer;}
.pet-ribbon-file:hover{background:#a8481b;}
.pet-file-menu{position:absolute;top:30px;left:0;z-index:9999;min-width:210px;background:#fff;border:1px solid #e2e0da;border-radius:8px;box-shadow:0 14px 36px rgba(60,50,30,.24);padding:5px;}
.pet-file-item{display:flex;align-items:center;gap:9px;width:100%;padding:8px 10px;border:none;background:transparent;border-radius:5px;font-size:13px;color:#3a3a38;cursor:pointer;text-align:left;}
.pet-file-item:hover{background:#f3efe8;}
.pet-replace-pop{display:flex;flex-direction:column;gap:8px;}
.pet-input{width:100%;height:32px;padding:0 10px;border:1px solid #ddd7cd;border-radius:8px;background:#fff;font-size:12px;color:#334155;outline:none;}
.pet-input:focus{border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.12);}
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
.pet-ribbon.is-collapsed.is-revealed .pet-ribbon-topslot{max-height:78px;padding-top:8px;padding-bottom:8px;border-bottom-color:#ece8e0;opacity:1;transform:translateY(0);pointer-events:auto;}
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

/* ===== Modo escuro da faixa (ativado por body.petition-dark) ===== */
body.petition-dark .pet-ribbon{background:#2b2b2b;border-bottom-color:#3d3d3d;color:#dcdcdc;}
body.petition-dark .pet-ribbon-topslot{background:linear-gradient(180deg,#333333,#2b2b2b);border-bottom-color:#3d3d3d;}
body.petition-dark .pet-ribbon-tabs{background:#2b2b2b;}
body.petition-dark .pet-ribbon-tab{color:#c2c2c2;}
body.petition-dark .pet-ribbon-tab:hover{background:#3a3a3a;}
body.petition-dark .pet-ribbon-tab.is-active{background:#1f1f1f;color:#ff9d57;}
body.petition-dark .pet-ribbon-body{background:#1f1f1f;border-top-color:#3d3d3d;}
body.petition-dark .pet-ribbon.is-collapsed.is-revealed{background:#2b2b2b;border-bottom-color:#3d3d3d;}
body.petition-dark .pet-ribbon.is-collapsed .pet-ribbon-peek{background:linear-gradient(to bottom,rgba(192,83,31,.28),rgba(192,83,31,.06));border-bottom-color:rgba(192,83,31,.3);}
body.petition-dark .pet-group{border-right-color:#3a3a3a;}
body.petition-dark .pet-group-label{color:#8f8f8f;}
body.petition-dark .pet-iconbtn,body.petition-dark .pet-btn-lg,body.petition-dark .pet-btn-sm{color:#dcdcdc;}
body.petition-dark .pet-iconbtn:hover,body.petition-dark .pet-btn-lg:hover,body.petition-dark .pet-btn-sm:hover{background:#3a3a3a;border-color:#4a4a4a;}
body.petition-dark .pet-iconbtn.is-active{background:#4a3a2a;color:#ff9d57;}
body.petition-dark .pet-vsep{background:#3f3f3f;}
body.petition-dark .pet-select{background:#333333;border-color:#4a4a4a;color:#e6e6e6;}
body.petition-dark .pet-select:hover{border-color:#c0531f;}
body.petition-dark .pet-select option{background:#333333;color:#e6e6e6;}
body.petition-dark .pet-split{background:#333333;border-color:#4a4a4a;box-shadow:none;}
body.petition-dark .pet-split .pet-iconbtn:hover{background:#3f3f3f;}
body.petition-dark .pet-split-caret{border-left-color:#4a4a4a;color:#b5b5b5;}
body.petition-dark .pet-popover,body.petition-dark .pet-file-menu{background:#2f2f2f;border-color:#454545;box-shadow:0 12px 32px rgba(0,0,0,.5);}
body.petition-dark .pet-file-item{color:#dcdcdc;}
body.petition-dark .pet-file-item:hover{background:#3a3a3a;}
body.petition-dark .pet-file-sep{background:#454545;}
body.petition-dark .pet-input{background:#333333;border-color:#4a4a4a;color:#e6e6e6;}
body.petition-dark .pet-style{background:#333333;border-color:#454545;color:#e6e6e6;}
body.petition-dark .pet-style-custom{background:#38322a;}
body.petition-dark .pet-check{color:#cfcfcf;}
body.petition-dark .pet-zoom{color:#cfcfcf;}
body.petition-dark .pet-tablegrid-cell{background:#333333;border-color:#4a4a4a;}
body.petition-dark .pet-tablegrid-cell.on{background:#5a3a20;border-color:#c0531f;}
body.petition-dark .pet-ribbon{background:#2b2b2b;border-bottom-color:#3d3d3d;color:#e5e7eb;}
body.petition-dark .pet-ribbon-topslot{background:linear-gradient(180deg,#333333 0%,#2b2b2b 100%);border-bottom-color:#3d3d3d;}
body.petition-dark .pet-top-cluster,body.petition-dark .pet-top-title-shell,body.petition-dark .pet-top-filter-shell,body.petition-dark .pet-top-actionbar{background:#333333;border-color:#454545;box-shadow:inset 0 1px 0 rgba(255,255,255,.03);}
body.petition-dark .pet-top-title-input,body.petition-dark .pet-top-select{background:transparent;color:#eef2f7;}
body.petition-dark .pet-top-title-input::placeholder{color:#9ca3af;}
body.petition-dark .pet-top-icon-btn{color:#d0d6df;}
body.petition-dark .pet-top-icon-btn:hover{background:#3a3a3a;color:#ffb26b;}
body.petition-dark .pet-top-text-btn{color:#d8dee6;}
body.petition-dark .pet-top-text-btn:hover{background:#3a3a3a;color:#ffb26b;}
body.petition-dark .pet-top-primary-btn{background:#f59e0b;box-shadow:0 10px 20px rgba(245,158,11,.18);}
body.petition-dark .pet-top-primary-btn:hover{background:#ea8a00;}
body.petition-dark .pet-top-meta-chip{background:#333333;border-color:#454545;color:#c5ced9;box-shadow:none;}
body.petition-dark .pet-top-client-chip{background:linear-gradient(180deg,#4f3f22 0%,#403318 100%);border-color:#7f652f;color:#f5e7bf;box-shadow:none;}

@media (max-width:639px){
  .pet-ribbon-topslot{padding:4px 8px;}
  .pet-ribbon-topslot-inner{gap:6px;flex-wrap:nowrap;}
  .pet-top-group.is-center{display:none;}
  .pet-top-group.is-right{flex:0 0 auto;}
  .pet-top-group.is-left{flex:1 1 auto;min-width:0;gap:4px;}
  .pet-top-title-input{min-width:90px;}
  .pet-top-cluster,.pet-top-filter-shell,.pet-top-actionbar{padding:3px;}
  .pet-top-title-shell{min-height:38px;}
  .pet-top-icon-btn{width:28px;height:28px;}
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

if (typeof document !== 'undefined') {
  let el = document.getElementById('petition-ribbon-styles');
  if (!el) {
    el = document.createElement('style');
    el.id = 'petition-ribbon-styles';
    document.head.appendChild(el);
  }
  // Sempre atualiza o conteúdo (idempotente) para refletir mudanças no CSS
  // mesmo com o <style> já presente (HMR / re-render).
  el.innerHTML = RIBBON_CSS;
}

export default PetitionRibbon;
