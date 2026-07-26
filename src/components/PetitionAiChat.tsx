// Assistente IA do Editor de Petições — painel flutuante redimensionável.
//
// Fluxo: a resposta é STREAMADA ao vivo (markdown renderizado por AiMarkdown,
// com botão "Parar"); as ações estruturadas chegam num bloco final parseado
// pelo serviço e viram cards que o usuário aprova por checkbox antes de aplicar:
//  - 'replace': correção cirúrgica por busca/substituição de trecho exato
//    (preserva a formatação do documento) — card mostra diff por palavras;
//  - 'insert': texto novo redigido pela IA (só quando não há modelo);
//  - 'insert_block': insere um modelo da base INTEGRALMENTE — o SFDT original
//    do bloco, com texto e formatação intactos — trocando apenas os dados do
//    caso concreto via replacements.
//
// A base de conhecimento é consultada por busca LOCAL (petitionKbSearch):
// só os trechos relevantes vão no prompt, e a IA pode pedir novas buscas.
// Quando falta informação factual, a IA pergunta TUDO de uma vez e o usuário
// responde num formulário único (opções + complemento em texto).
//
// Tema: variáveis CSS locais (--ai-*) com par claro/escuro via body.petition-dark.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Send,
  Check,
  CheckCheck,
  Loader2,
  Trash2,
  AlertTriangle,
  SpellCheck,
  ListPlus,
  HelpCircle,
  BookOpen,
  Square,
  CheckSquare,
  FileText,
  StopCircle,
  RotateCcw,
  ChevronDown,
  Maximize2,
  Minimize2,
  ShieldCheck,
  MousePointer2,
  ArrowUpRight,
  Eraser,
  Sparkles,
  Target,
  Cloud,
  CloudOff,
  Settings2,
  Pencil,
} from 'lucide-react';
import {
  aiService,
  type PetitionChatAction,
  type PetitionChatBriefing,
  type PetitionChatQuestion,
} from '../services/ai.service';
import { PetitionKbSearcher, type KbEntry } from '../services/petitionKbSearch';
import { searchPetitionArchive } from '../services/petitionArchiveKb';
import { insertPetitionTextSmart } from '../utils/petitionSmartInsert';
import {
  normalizeAiInsertText,
  rangeAnchors,
  spansParagraphs,
  splitDeletionChunks,
} from '../utils/petitionAiText';
import AiMarkdown from './petition/AiMarkdown';
import PetitionAiBriefing from './petition/PetitionAiBriefing';
import {
  SKILL_GROUP_LABEL,
  visibleSkills,
  type PetitionSkill,
  type SkillGroup,
} from './petition/petitionAiSkills';
import type { SyncfusionEditorRef } from './SyncfusionEditor';

type ActionStatus = 'pending' | 'applied' | 'failed';

interface ChatActionState extends PetitionChatAction {
  status: ActionStatus;
  /** Marcada para aplicação em lote (checkbox). */
  selected: boolean;
  /** Motivo da falha (ex.: trecho não encontrado no documento). */
  error?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatActionState[];
  questions?: PetitionChatQuestion[];
  /** Buscas locais feitas na base de conhecimento para esta resposta. */
  searches?: string[];
  /** Arquivos do acervo (Nextcloud) que embasaram esta resposta. */
  archiveSources?: string[];
  isError?: boolean;
  /** Resposta ainda sendo streamada. */
  streaming?: boolean;
  /** Geração interrompida pelo usuário (texto parcial). */
  aborted?: boolean;
  /** Mensagem do usuário a reenviar no "Tentar novamente". */
  retryText?: string;
}

/** Rascunho de resposta do formulário de perguntas de uma mensagem. */
interface QuestionDraft {
  selections: Record<number, string>;
  note: string;
}

interface PetitionAiChatProps {
  editorRef: React.RefObject<SyncfusionEditorRef | null>;
  /** Notifica o módulo que o documento mudou (marca como não salvo). */
  onDocumentChanged?: () => void;
  /** Base de conhecimento: blocos-modelo ativos do tipo de documento atual. */
  kbEntries?: KbEntry[];
  /** Resumo dos dados do cliente/petição vinculados, enviado no prompt. */
  clientContext?: string;
  /**
   * Insere um SFDT de bloco no documento preservando a formatação original
   * (converte para fragmento no editor oculto e cola no principal). O módulo
   * posiciona o cursor conforme "position" imediatamente antes de colar.
   */
  insertBlockSfdt?: (sfdt: string, position: 'cursor' | 'end') => Promise<boolean>;
  disabled?: boolean;
  disabledReason?: string;
  /** Seleção atual, usada para tornar o escopo das ações visível antes do envio. */
  selectedText?: string;
  /** Contagem do editor, usada para indicar se há conteúdo analisável. */
  documentWordCount?: number;
  /** Sinal robusto para documentos cujo contador ainda não terminou de indexar. */
  documentHasContent?: boolean;
  /** Total de páginas, usado como fallback enquanto a contagem de palavras carrega. */
  documentPageCount?: number;
  /** Área jurídica da petição aberta — pré-seleciona o briefing. */
  suggestedArea?: string;
  /** Tipo do documento aberto no editor — pré-seleciona o briefing. */
  suggestedDocumentType?: string;
}

// O catálogo de habilidades vive em ./petition/petitionAiSkills — inclui todas
// as ações rápidas originais e as novas (remoção de duplicações, antecipação da
// defesa, fundamentação, prazos, cálculos, estratégia, consulta ao acervo...).
type QuickPrompt = PetitionSkill;

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeForSearch = (value: string) => String(value || '').replace(/\r\n?/g, '\n');

const normalizeComparableChar = (char: string) => (
  /\s/.test(char)
    ? ' '
    : char.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
);

const resolveExactSearchText = (documentText: string, requestedSearch: string): string | null => {
  const rawDoc = normalizeForSearch(documentText);
  const rawSearch = normalizeForSearch(requestedSearch).trim();
  if (!rawSearch) return null;
  if (rawDoc.includes(rawSearch)) return rawSearch;

  const normalizeWithMap = (value: string) => {
    let normalized = '';
    const map: number[] = [];
    let previousWasSpace = false;

    for (let i = 0; i < value.length; i++) {
      const next = normalizeComparableChar(value[i]);
      if (next === ' ') {
        if (previousWasSpace) continue;
        previousWasSpace = true;
      } else {
        previousWasSpace = false;
      }
      normalized += next;
      map.push(i);
    }

    return { normalized: normalized.trim(), map };
  };

  const doc = normalizeWithMap(rawDoc);
  const query = normalizeWithMap(rawSearch).normalized;
  if (!query) return null;

  const idx = doc.normalized.indexOf(query);
  if (idx < 0) return null;

  const start = doc.map[idx] ?? 0;
  const end = (doc.map[idx + query.length - 1] ?? start) + 1;
  const exact = rawDoc.slice(start, end).trim();
  return exact || null;
};

/** Seguro para split/join direto na string SFDT (JSON) sem quebrar o escape. */
const isJsonSafeText = (value: string) => {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 32) return false; // caracteres de controle quebram o JSON
  }
  return !value.includes('\\') && !value.includes('"');
};

/**
 * Diff simples por palavras: apara prefixo/sufixo comuns e devolve o miolo
 * alterado. Suficiente para as correções cirúrgicas do 'replace'.
 */
const diffWords = (oldText: string, newText: string) => {
  const a = oldText.split(/(\s+)/);
  const b = newText.split(/(\s+)/);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  return {
    prefix: a.slice(0, start).join(''),
    removed: a.slice(start, endA).join(''),
    added: b.slice(start, endB).join(''),
    suffix: a.slice(endA).join(''),
  };
};

/**
 * Janela do documento em volta do trecho selecionado.
 *
 * Com escopo de seleção, mandar a peça inteira faz o modelo "resolver o
 * documento" em vez de resolver o trecho — além de custar tokens à toa. Aqui
 * vai só o contexto imediatamente antes e depois, com o resto marcado como
 * omitido para o modelo não achar que a peça acabou ali.
 */
const buildSelectionWindow = (documentText: string, selection: string, margin = 1600): string => {
  const doc = normalizeForSearch(documentText);
  const needle = String(selection || '').trim();
  if (!doc || !needle) return doc;

  const exact = resolveExactSearchText(doc, needle);
  const index = exact ? doc.indexOf(exact) : -1;
  if (index < 0) {
    // Seleção não localizada (documento mudou): manda um resumo curto do começo
    // em vez da peça toda — o escopo continua sendo o trecho.
    return `${doc.slice(0, margin)}${doc.length > margin ? '\n[...restante do documento omitido: a tarefa é sobre o trecho selecionado...]' : ''}`;
  }

  const start = Math.max(0, index - margin);
  const end = Math.min(doc.length, index + (exact?.length || needle.length) + margin);
  return [
    start > 0 ? '[...início do documento omitido...]' : '',
    doc.slice(start, end),
    end < doc.length ? '[...restante do documento omitido...]' : '',
  ].filter(Boolean).join('\n');
};

const clampContext = (text: string, side: 'start' | 'end', max = 48) => {
  if (text.length <= max) return text;
  return side === 'start' ? `…${text.slice(-max)}` : `${text.slice(0, max)}…`;
};

// ── Tema local (claro/escuro via body.petition-dark) ─────────────────────────

const AI_THEME_CSS = `
.pet-ai{
  --ai-surface:#ffffff; --ai-surface-2:#f6f7f9; --ai-surface-3:#eef0f3;
  --ai-border:#e3e6ea; --ai-border-strong:#d2d6dc;
  --ai-text:#1f2937; --ai-text-2:#6b7280; --ai-text-3:#9ca3af;
  --ai-accent:#e85d14; --ai-accent-hover:#c84a0b; --ai-accent-soft:#fff5eb; --ai-accent-border:#fed1ad;
  --ai-user-bubble:#1f2937; --ai-user-text:#ffffff;
  --ai-ok:#059669; --ai-ok-soft:#ecfdf5; --ai-ok-border:#a7f3d0;
  --ai-del:#dc2626; --ai-del-soft:#fef2f2; --ai-del-border:#fecaca;
  --ai-warn:#b45309; --ai-warn-soft:#fffbeb; --ai-warn-border:#fde68a;
}
body.petition-dark .pet-ai{
  --ai-surface:#262626; --ai-surface-2:#2f2f2f; --ai-surface-3:#383838;
  --ai-border:#3d3d3d; --ai-border-strong:#4a4a4a;
  --ai-text:#e5e5e5; --ai-text-2:#a3a3a3; --ai-text-3:#737373;
  --ai-accent:#fb923c; --ai-accent-hover:#fdba74; --ai-accent-soft:#3a210f; --ai-accent-border:#7c3d12;
  --ai-user-bubble:#3b4252; --ai-user-text:#f1f5f9;
  --ai-ok:#34d399; --ai-ok-soft:#0d2b22; --ai-ok-border:#14532d;
  --ai-del:#f87171; --ai-del-soft:#2f1a1a; --ai-del-border:#7f1d1d;
  --ai-warn:#fbbf24; --ai-warn-soft:#2e2308; --ai-warn-border:#78350f;
}
.pet-ai-scroll::-webkit-scrollbar{width:8px;}
.pet-ai-scroll::-webkit-scrollbar-thumb{background:var(--ai-border-strong);border-radius:8px;}
.pet-ai-scroll::-webkit-scrollbar-track{background:transparent;}
`;

const PANEL_SIZE_KEY = 'petitionAiChat.size.v2';
const MIN_W = 380;
const MIN_H = 420;
const DEFAULT_PANEL_SIZE = { w: 500, h: 520 };

// Acervo do Nextcloud como segunda base de conhecimento. Fica desligado até o
// escritório escolher a pasta: varrer o drive inteiro na primeira pergunta
// seria lento e imprevisível.
const ARCHIVE_KEY = 'petitionAiChat.archive.v1';

interface ArchiveSettings {
  enabled: boolean;
  root: string;
}

const loadArchiveSettings = (): ArchiveSettings => {
  try {
    const raw = window.localStorage.getItem(ARCHIVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: Boolean(parsed?.enabled),
        root: typeof parsed?.root === 'string' ? parsed.root : '',
      };
    }
  } catch { /* ignore */ }
  return { enabled: false, root: '' };
};

const saveArchiveSettings = (settings: ArchiveSettings) => {
  try { window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
};

const loadPanelSize = (): { w: number; h: number } => {
  try {
    const raw = window.localStorage.getItem(PANEL_SIZE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.w === 'number' && typeof parsed?.h === 'number') {
        return { w: parsed.w, h: parsed.h };
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_PANEL_SIZE;
};

const PetitionAiChat: React.FC<PetitionAiChatProps> = ({
  editorRef,
  onDocumentChanged,
  kbEntries,
  clientContext,
  insertBlockSfdt,
  disabled = false,
  disabledReason,
  selectedText = '',
  documentWordCount = 0,
  documentHasContent = false,
  documentPageCount = 1,
  suggestedArea,
  suggestedDocumentType,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage: 'thinking' | 'searching' | 'streaming'; detail?: string }>({ stage: 'thinking' });
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
  const [panelSize, setPanelSize] = useState(loadPanelSize);
  const [isExpanded, setIsExpanded] = useState(false);
  // Briefing da peça: contexto fixo da conversa, preenchido num formulário
  // local (custo zero de tokens) e reenviado em todas as mensagens.
  const [briefing, setBriefing] = useState<PetitionChatBriefing | null>(null);
  const [showBriefing, setShowBriefing] = useState(false);
  const [showAllSkills, setShowAllSkills] = useState(false);
  // Escopo da tarefa. 'auto' segue a seleção do editor; o advogado pode fixar.
  const [scopePreference, setScopePreference] = useState<'auto' | 'selection' | 'document'>('auto');
  // Seleção "grudenta": o editor perde a seleção quando o foco vai para o chat
  // (e quando qualquer rotina interna chama selectAll). Guardar a última
  // seleção real é o que impede o widget de voltar sozinho ao documento todo.
  const [stickySelection, setStickySelection] = useState('');
  const [archiveEnabled, setArchiveEnabled] = useState(loadArchiveSettings().enabled);
  const [archiveRoot, setArchiveRoot] = useState(loadArchiveSettings().root);
  const [showArchiveSettings, setShowArchiveSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Índice de busca local: reconstruído só quando os blocos mudam. Buscar aqui
  // não consome nenhum token — é o mecanismo de recuperação da base.
  const kbSearcher = useMemo(() => new PetitionKbSearcher(kbEntries || []), [kbEntries]);

  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
  const liveSelection = String(selectedText || '').replace(/\s+/g, ' ').trim();
  // Enquanto o advogado escreve no chat, o editor pode reportar seleção vazia;
  // a última seleção real continua valendo até ele trocar ou soltar o escopo.
  const normalizedSelection = liveSelection || stickySelection;
  const hasSelection = normalizedSelection.length > 0;
  const activeScope: 'selection' | 'document' = scopePreference === 'document'
    ? 'document'
    : scopePreference === 'selection' && hasSelection
      ? 'selection'
      : hasSelection ? 'selection' : 'document';
  const isSelectionScope = activeScope === 'selection' && hasSelection;
  const hasDocument = documentHasContent || documentWordCount > 0 || documentPageCount > 1;
  const selectionPreview = normalizedSelection.length > 92
    ? `${normalizedSelection.slice(0, 92)}…`
    : normalizedSelection;
  const documentContextSummary = documentWordCount > 0
    ? `${documentWordCount.toLocaleString('pt-BR')} palavras prontas`
    : hasDocument && documentPageCount > 1
      ? `${documentPageCount.toLocaleString('pt-BR')} páginas prontas`
      : 'Documento pronto';
  const visibleQuickPrompts = useMemo(() => visibleSkills({ hasDocument }), [hasDocument]);
  const skillsByGroup = useMemo(() => {
    const groups = new Map<SkillGroup, PetitionSkill[]>();
    for (const skill of visibleQuickPrompts) {
      const list = groups.get(skill.group) || [];
      list.push(skill);
      groups.set(skill.group, list);
    }
    return Array.from(groups.entries());
  }, [visibleQuickPrompts]);
  const primaryQuickPrompt = isSelectionScope
    ? visibleQuickPrompts.find((quickPrompt) => quickPrompt.label === 'Melhorar seleção')
    : hasDocument
      ? visibleQuickPrompts.find((quickPrompt) => quickPrompt.label === 'Auditoria completa')
      : visibleQuickPrompts.find((quickPrompt) => quickPrompt.label === 'Redigir novo tópico');
  const compactSecondaryIds = isSelectionScope
    ? ['auditoria', 'revisao-linguistica', 'reforcar-tese', 'novo-topico']
    : hasDocument
      ? ['revisao-linguistica', 'melhorar-selecao', 'novo-topico', 'conferir-pedidos']
      : ['estrutura-inicial', 'consultar-acervo'];
  const secondaryQuickPrompts = visibleQuickPrompts.filter((quickPrompt) => quickPrompt !== primaryQuickPrompt);
  const compactSecondaryQuickPrompts = compactSecondaryIds
    .map((skillId) => visibleQuickPrompts.find((quickPrompt) => quickPrompt.id === skillId))
    .filter((quickPrompt): quickPrompt is PetitionSkill => Boolean(quickPrompt && quickPrompt !== primaryQuickPrompt));
  const hiddenSkillsCount = Math.max(0, secondaryQuickPrompts.length - compactSecondaryQuickPrompts.length);

  // Seleção nova do editor vira a seleção ativa; seleção vazia NÃO apaga a
  // anterior (o editor a perde só por causa do foco no chat).
  useEffect(() => {
    if (liveSelection) setStickySelection(liveSelection);
  }, [liveSelection]);

  useEffect(() => {
    saveArchiveSettings({ enabled: archiveEnabled, root: archiveRoot });
  }, [archiveEnabled, archiveRoot]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isSending]);

  useEffect(() => {
    if (isOpen) {
      window.setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSending) setIsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isSending]);

  // Cancela a geração em andamento se o componente desmontar.
  useEffect(() => () => abortRef.current?.abort(), []);

  const clampedSize = useCallback((size: { w: number; h: number }) => ({
    w: Math.min(Math.max(size.w, MIN_W), Math.max(MIN_W, window.innerWidth - 48)),
    h: Math.min(Math.max(size.h, MIN_H), Math.max(MIN_H, window.innerHeight - 120)),
  }), []);

  // ── Redimensionamento pela alça do canto superior esquerdo ─────────────────
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsExpanded(false);
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = panelSize.w;
    const startH = panelSize.h;

    const onMove = (ev: PointerEvent) => {
      setPanelSize(clampedSize({
        w: startW + (startX - ev.clientX),
        h: startH + (startY - ev.clientY),
      }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setPanelSize((current) => {
        try { window.localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(current)); } catch { /* ignore */ }
        return current;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [panelSize, clampedSize]);

  /**
   * Captura texto do documento e seleção SEM perder a seleção do usuário:
   * getText() usa selectAll internamente, então guardamos os offsets antes
   * e restauramos depois.
   */
  const captureEditorContext = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return { documentText: '', selectedText: '' };

    let selectedText = '';
    let startOffset = '';
    let endOffset = '';
    try {
      const selection = editor.getEditor?.()?.selection;
      selectedText = String(selection?.text || '');
      startOffset = String(selection?.startOffset || '');
      endOffset = String(selection?.endOffset || '');
    } catch {
      // ignore
    }

    const documentText = normalizeForSearch(editor.getText() || '');

    try {
      const selection = editor.getEditor?.()?.selection;
      if (selection && startOffset && endOffset) {
        selection.select(startOffset, endOffset);
      }
    } catch {
      // ignore
    }

    return { documentText, selectedText };
  }, [editorRef]);

  /**
   * Executa uma ação no editor (efeito colateral) e retorna o resultado.
   * NUNCA chamar dentro de um updater de setState — os updaters devem ser
   * puros e as operações do editor disparam setState em outros componentes.
   */
  const executeAction = useCallback(async (action: ChatActionState): Promise<{ status: ActionStatus; error?: string }> => {
    const editor = editorRef.current;
    if (!editor) return { status: 'failed', error: 'Editor não disponível.' };

    try {
      const replaceTolerant = (search: string, replace: string): boolean => {
        const documentText = normalizeForSearch(editor.getText() || '');
        const exactSearch = resolveExactSearchText(documentText, search);
        return exactSearch ? editor.replaceAll(exactSearch, replace) : false;
      };

      /**
       * Aplica sobre um trecho que pode atravessar parágrafos.
       *
       * A busca do editor não passa pela marca de parágrafo — é exatamente por
       * isso que "remova este bloco duplicado" falhava. Aqui o trecho é
       * localizado por duas âncoras (primeira e última linha) e a seleção
       * cobre tudo entre elas.
       */
      const applyOverRange = (
        rawSearch: string,
        options: { replaceWith?: string; occurrence?: 'first' | 'last'; searchEnd?: string },
      ): boolean => {
        const anchors = rangeAnchors(rawSearch, options.searchEnd);
        if (!anchors || typeof editor.deleteRange !== 'function') return false;
        return editor.deleteRange(anchors.start, anchors.end, {
          replaceWith: options.replaceWith,
          occurrence: options.occurrence,
          // Margem sobre o trecho pedido: impede que uma âncora ambígua
          // arraste metade da petição junto.
          maxChars: Math.max(400, Math.round(rawSearch.length * 1.8) + 400),
        });
      };

      if (action.type === 'replace') {
        const search = String(action.search || '');
        const replacement = String(action.replace ?? '');
        // Trecho de um parágrafo só: caminho barato de sempre.
        let ok = !spansParagraphs(search) && !action.searchEnd
          ? replaceTolerant(search, replacement)
          : false;
        if (!ok) {
          ok = applyOverRange(search, {
            replaceWith: replacement,
            searchEnd: action.searchEnd,
            occurrence: action.occurrence,
          });
        }
        if (!ok) {
          return { status: 'failed', error: 'Trecho não encontrado no documento (pode ter sido alterado).' };
        }
        onDocumentChanged?.();
        return { status: 'applied' };
      }

      if (action.type === 'delete') {
        const search = String(action.search || '');
        const occurrence = action.occurrence || 'last';

        // 1. Intervalo completo (funciona mesmo com vários parágrafos).
        let ok = applyOverRange(search, { searchEnd: action.searchEnd, occurrence });

        // 2. Sem intervalo: apaga parágrafo por parágrafo, UMA ocorrência de
        //    cada — apagar todas removeria também a cópia que deve ficar.
        if (!ok && typeof editor.deleteOccurrence === 'function') {
          const chunks = splitDeletionChunks(search);
          let removed = 0;
          for (const chunk of chunks) {
            if (editor.deleteOccurrence(chunk, occurrence)) removed += 1;
          }
          ok = removed > 0;
          if (removed > 0 && removed < chunks.length) {
            onDocumentChanged?.();
            return {
              status: 'applied',
              error: `Removi ${removed} de ${chunks.length} trechos — confira o restante no documento.`,
            };
          }
        }

        if (!ok) {
          return { status: 'failed', error: 'Trecho não encontrado no documento (pode ter sido alterado).' };
        }
        onDocumentChanged?.();
        return { status: 'applied' };
      }

      if (action.type === 'insert_block') {
        const entry = action.blockId ? kbSearcher.getEntry(action.blockId) : undefined;
        if (!entry) {
          return { status: 'failed', error: 'Modelo não encontrado na base de conhecimento.' };
        }

        const reps = action.replacements || [];
        const sfdt = String(entry.sfdt || '').trim();
        const looksLikeSfdt = sfdt.startsWith('{') || sfdt.startsWith('[');

        if (looksLikeSfdt && insertBlockSfdt) {
          // Substituições feitas direto na string SFDT (mesma técnica dos
          // placeholders de cliente do módulo) — mantém formatação integral.
          let processed = sfdt;
          const leftovers: typeof reps = [];
          for (const rep of reps) {
            if (isJsonSafeText(rep.search) && isJsonSafeText(rep.replace) && processed.includes(rep.search)) {
              processed = processed.split(rep.search).join(rep.replace);
            } else {
              leftovers.push(rep);
            }
          }

          const ok = await insertBlockSfdt(processed, action.position === 'end' ? 'end' : 'cursor');
          if (ok) {
            // Substituições que não deram na string SFDT (texto quebrado em
            // vários runs de formatação): melhor esforço via busca do editor.
            for (const rep of leftovers) {
              try { replaceTolerant(rep.search, rep.replace); } catch { /* ignore */ }
            }
            onDocumentChanged?.();
            return { status: 'applied' };
          }
        }

        // Fallback: texto puro do modelo com as substituições aplicadas
        let text = normalizeAiInsertText(String(entry.content || ''));
        if (!text) return { status: 'failed', error: 'Modelo sem conteúdo utilizável.' };
        for (const rep of reps) {
          text = text.split(rep.search).join(rep.replace);
        }
        const hadContent = editor.hasContent();
        editor.focus();
        if (action.position === 'end') {
          const de = editor.getEditor?.();
          const docText = normalizeForSearch(editor.getText() || '');
          const smart = de ? insertPetitionTextSmart(de, docText, text) : false;
          if (!smart) {
            try { de?.selection?.moveToDocumentEnd?.(); } catch { /* ignore */ }
            editor.insertText(hadContent ? `\n${text}` : text);
          }
        } else {
          editor.insertText(text);
        }
        for (const rep of reps) {
          try { replaceTolerant(rep.search, rep.replace); } catch { /* ignore */ }
        }
        onDocumentChanged?.();
        return { status: 'applied' };
      }

      // type === 'insert'
      // Markdown fora e quebras de linha de volta: sem isto, uma estrutura
      // inteira entra no documento como um parágrafo único e ilegível.
      const text = normalizeAiInsertText(String(action.text || ''));
      if (!text) return { status: 'failed', error: 'Ação sem texto para inserir.' };
      const hadContent = editor.hasContent();
      editor.focus();
      if (action.position === 'end') {
        // Inserção inteligente: entra ANTES do fecho (data/assinatura) e
        // espelha a formatação de títulos/parágrafos do documento.
        const de = editor.getEditor?.();
        const docText = normalizeForSearch(editor.getText() || '');
        const smart = de ? insertPetitionTextSmart(de, docText, text) : false;
        if (!smart) {
          try { de?.selection?.moveToDocumentEnd?.(); } catch { /* ignore */ }
          editor.insertText(hadContent ? `\n${text}` : text);
        }
      } else {
        editor.insertText(text);
      }
      onDocumentChanged?.();
      return { status: 'applied' };
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : 'Erro ao aplicar a ação.' };
    }
  }, [editorRef, onDocumentChanged, kbSearcher, insertBlockSfdt]);

  const toggleActionSelected = useCallback((messageId: string, actionIndex: number) => {
    setMessages((prev) => prev.map((m) => (
      m.id === messageId && m.actions
        ? {
            ...m,
            actions: m.actions.map((a, i) => (
              i === actionIndex && a.status !== 'applied' ? { ...a, selected: !a.selected } : a
            )),
          }
        : m
    )));
  }, []);

  const setAllActionsSelected = useCallback((messageId: string, selected: boolean) => {
    setMessages((prev) => prev.map((m) => (
      m.id === messageId && m.actions
        ? { ...m, actions: m.actions.map((a) => (a.status === 'applied' ? a : { ...a, selected })) }
        : m
    )));
  }, []);

  /** Aplica as ações marcadas (checkbox) de uma mensagem, na ordem. */
  const applySelectedActions = useCallback(async (messageId: string) => {
    if (applyingMessageId) return;
    const msg = messages.find((m) => m.id === messageId);
    if (!msg?.actions) return;

    setApplyingMessageId(messageId);
    try {
      const results: ChatActionState[] = [];
      for (const action of msg.actions) {
        if (action.status === 'applied' || !action.selected) {
          results.push(action);
          continue;
        }
        const result = await executeAction(action);
        results.push({ ...action, ...result });
      }
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, actions: results } : m)));
    } finally {
      setApplyingMessageId(null);
    }
  }, [messages, executeAction, applyingMessageId]);

  /** Envia uma mensagem sobre uma base explícita (permite retry sem duplicar). */
  const sendMessageWith = useCallback(async (baseMessages: ChatMessage[], text: string) => {
    if (!text || isSending || disabled) return;

    const userMessage: ChatMessage = { id: newId(), role: 'user', content: text };
    const assistantId = newId();
    const historyMessages = [...baseMessages, userMessage];

    setMessages([...historyMessages, { id: assistantId, role: 'assistant', content: '', streaming: true }]);
    setInput('');
    setIsSending(true);
    setProgress({ stage: 'thinking' });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const captured = captureEditorContext();
      // A seleção viva do editor manda; se ele já a perdeu (foco no chat), vale
      // a última seleção real registrada pelo widget.
      const effectiveSelection = captured.selectedText.trim() || stickySelection;
      const useSelectionScope = activeScope === 'selection' && Boolean(effectiveSelection.trim());

      // Escopo de seleção: o documento entra apenas como JANELA em volta do
      // trecho. É isto que impede o assistente de trabalhar a peça inteira
      // quando o pedido era sobre um parágrafo.
      const documentText = useSelectionScope
        ? buildSelectionWindow(captured.documentText, effectiveSelection)
        : captured.documentText;

      const result = await aiService.petitionAssistantChatStream({
        history: historyMessages
          .filter((m) => !m.isError && m.content.trim())
          .map((m) => ({ role: m.role, content: m.content })),
        documentText,
        selectedText: effectiveSelection,
        scope: useSelectionScope ? 'selection' : 'document',
        briefing: briefing || undefined,
        clientContext,
        // Busca local: o melhor modelo vai com texto integral (permite
        // insert_block); os demais vão como trechos curtos.
        searchKb: kbSearcher.size > 0
          ? (query) => kbSearcher.search(query, 5, { fullTopN: 2, fullMaxChars: 9000 })
          : undefined,
        // Acervo do Nextcloud: peças reais do escritório como referência.
        searchArchive: archiveEnabled
          ? async (query) => {
              const found = await searchPetitionArchive(query, {
                root: archiveRoot,
                maxDocs: 3,
                signal: controller.signal,
              });
              return found.map((item) => ({
                path: item.path,
                title: item.title,
                folder: item.folder,
                snippet: item.snippet,
              }));
            }
          : undefined,
        signal: controller.signal,
        onProgress: (stage, detail) => setProgress({ stage, detail }),
        onReplyDelta: (visibleReply) => {
          setMessages((prev) => prev.map((m) => (
            m.id === assistantId ? { ...m, content: visibleReply } : m
          )));
        },
      });

      setMessages((prev) => prev.map((m) => (
        m.id === assistantId
          ? {
              ...m,
              streaming: false,
              content: result.reply,
              aborted: result.aborted,
              questions: !result.aborted && result.questions.length ? result.questions : undefined,
              searches: result.searches.length ? result.searches : undefined,
              archiveSources: result.archiveSources?.length ? result.archiveSources : undefined,
              actions: result.aborted
                ? undefined
                : result.actions.map((a) => ({ ...a, status: 'pending' as ActionStatus, selected: true })),
            }
          : m
      )));
    } catch (err) {
      setMessages((prev) => prev.map((m) => (
        m.id === assistantId
          ? {
              ...m,
              streaming: false,
              isError: true,
              content: err instanceof Error ? err.message : 'Erro ao falar com o assistente. Tente novamente.',
              retryText: text,
            }
          : m
      )));
    } finally {
      abortRef.current = null;
      setIsSending(false);
      window.setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [
    isSending,
    disabled,
    captureEditorContext,
    kbSearcher,
    clientContext,
    briefing,
    activeScope,
    stickySelection,
    archiveEnabled,
    archiveRoot,
  ]);

  const sendMessage = useCallback(async (rawText?: string) => {
    const text = String(rawText ?? input).trim();
    await sendMessageWith(messages, text);
  }, [input, messages, sendMessageWith]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Reenvia após erro: remove o par usuário+erro e envia de novo. */
  const retryMessage = useCallback((errorMessage: ChatMessage) => {
    const text = errorMessage.retryText;
    if (!text) return;
    const idx = messages.findIndex((m) => m.id === errorMessage.id);
    if (idx < 0) return;
    // Remove a mensagem de erro e a mensagem do usuário imediatamente anterior.
    const base = messages.slice(0, Math.max(0, idx - 1));
    void sendMessageWith(base, text);
  }, [messages, sendMessageWith]);

  const isQuickPromptDisabled = useCallback((quickPrompt: QuickPrompt) => (
    disabled
    || isSending
    || (quickPrompt.scope === 'selection' && !hasSelection)
    || (quickPrompt.requiresDocument === true && !hasDocument)
  ), [disabled, isSending, hasSelection, hasDocument]);

  const handleQuickPrompt = (quickPrompt: QuickPrompt) => {
    if (isQuickPromptDisabled(quickPrompt)) return;
    // Habilidade de trecho fixa o escopo na seleção; habilidade de documento
    // solta o escopo. Sem isso o rótulo diria uma coisa e o envio faria outra.
    if (quickPrompt.scope === 'selection') setScopePreference('selection');
    else if (quickPrompt.scope === 'document') setScopePreference('document');
    const { prompt } = quickPrompt;
    // Prompts terminados em espaço são "abertos": só preenchem o campo para o
    // usuário completar (ex.: "Adicionar tópico sobre ...").
    if (prompt.endsWith(' ')) {
      setInput(prompt);
      inputRef.current?.focus();
      return;
    }
    void sendMessage(prompt);
  };

  // ── Formulário de perguntas ────────────────────────────────────────────────

  const getDraft = (messageId: string): QuestionDraft =>
    questionDrafts[messageId] || { selections: {}, note: '' };

  const setDraftSelection = (messageId: string, questionIndex: number, option: string, isTyped = false) => {
    setQuestionDrafts((prev) => {
      const draft = prev[messageId] || { selections: {}, note: '' };
      const current = draft.selections[questionIndex];
      // Chip repete o clique para desmarcar; texto digitado substitui direto.
      const next = isTyped ? option : current === option ? '' : option;
      return {
        ...prev,
        [messageId]: {
          ...draft,
          selections: { ...draft.selections, [questionIndex]: next },
        },
      };
    });
  };

  const setDraftNote = (messageId: string, note: string) => {
    setQuestionDrafts((prev) => ({
      ...prev,
      [messageId]: { ...(prev[messageId] || { selections: {}, note: '' }), note },
    }));
  };

  /** Compila as respostas do formulário numa única mensagem e envia. */
  const submitQuestionAnswers = (msg: ChatMessage) => {
    if (!msg.questions) return;
    const draft = getDraft(msg.id);
    const parts: string[] = [];
    msg.questions.forEach((q, idx) => {
      const answer = (draft.selections[idx] || '').trim();
      if (answer) parts.push(`${q.question}\nResposta: ${answer}`);
    });
    if (draft.note.trim()) parts.push(`Informações adicionais: ${draft.note.trim()}`);
    if (parts.length === 0) return;
    void sendMessage(parts.join('\n\n'));
  };

  // ── Renderização das ações ────────────────────────────────────────────────

  const actionSummary = (action: ChatActionState) => {
    if (action.label) return action.label;
    if (action.type === 'replace') return 'Substituir trecho';
    if (action.type === 'delete') return 'Remover trecho do documento';
    if (action.type === 'insert_block') {
      const entry = action.blockId ? kbSearcher.getEntry(action.blockId) : undefined;
      return entry ? `Inserir modelo: ${entry.title}` : 'Inserir modelo da base';
    }
    return action.position === 'end' ? 'Inserir ao final do documento' : 'Inserir no cursor';
  };

  const actionTypeIcon = (action: ChatActionState) => {
    if (action.type === 'replace') return <SpellCheck className="w-3.5 h-3.5" />;
    if (action.type === 'delete') return <Eraser className="w-3.5 h-3.5" />;
    if (action.type === 'insert_block') return <FileText className="w-3.5 h-3.5" />;
    return <ListPlus className="w-3.5 h-3.5" />;
  };

  const renderReplaceDiff = (action: ChatActionState) => {
    const oldText = String(action.search || '');
    const newText = String(action.replace || '');
    const { prefix, removed, added, suffix } = diffWords(oldText, newText);
    const compact = removed.length + added.length <= Math.max(oldText.length, newText.length) * 0.6;

    if (compact && (removed || added)) {
      return (
        <div className="mt-2 rounded-lg bg-[var(--ai-surface-2)] border border-[var(--ai-border)] px-2.5 py-2 text-[12px] leading-relaxed break-words">
          <span className="text-[var(--ai-text-2)]">{clampContext(prefix, 'start')}</span>
          {removed && (
            <span className="mx-0.5 px-1 rounded bg-[var(--ai-del-soft)] text-[var(--ai-del)] line-through decoration-[var(--ai-del)]/50">
              {removed}
            </span>
          )}
          {added && (
            <span className="mx-0.5 px-1 rounded bg-[var(--ai-ok-soft)] text-[var(--ai-ok)] font-medium">
              {added}
            </span>
          )}
          <span className="text-[var(--ai-text-2)]">{clampContext(suffix, 'end')}</span>
        </div>
      );
    }

    // Trechos muito diferentes: dois blocos (antes/depois).
    return (
      <div className="mt-2 space-y-1 text-[12px] leading-relaxed">
        <div className="rounded-lg bg-[var(--ai-del-soft)] border border-[var(--ai-del-border)] px-2.5 py-1.5 text-[var(--ai-del)] line-through decoration-[var(--ai-del)]/40 break-words">
          {oldText.slice(0, 220)}{oldText.length > 220 ? '…' : ''}
        </div>
        <div className="rounded-lg bg-[var(--ai-ok-soft)] border border-[var(--ai-ok-border)] px-2.5 py-1.5 text-[var(--ai-ok)] break-words">
          {newText.slice(0, 260)}{newText.length > 260 ? '…' : ''}
        </div>
      </div>
    );
  };

  const InsertPreview: React.FC<{ text: string }> = ({ text }) => {
    const [expanded, setExpanded] = useState(false);
    const isLong = text.length > 320;
    return (
      <div className="mt-2 rounded-lg bg-[var(--ai-surface-2)] border border-[var(--ai-border)] px-2.5 py-2 text-[12px] leading-relaxed text-[var(--ai-text)]">
        <div className={`whitespace-pre-wrap break-words ${expanded ? '' : 'line-clamp-5'}`}>{text}</div>
        {isLong && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ai-accent)] hover:text-[var(--ai-accent-hover)]"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? 'Ver menos' : 'Ver texto completo'}
          </button>
        )}
      </div>
    );
  };

  const renderDeletePreview = (action: ChatActionState) => {
    const start = String(action.search || '').trim();
    const end = String(action.searchEnd || '').trim();
    const isRange = Boolean(end) && end !== start;

    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-[var(--ai-del-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ai-del)] ring-1 ring-[var(--ai-del-border)]">
            {isRange ? 'Remove o bloco inteiro' : 'Remove este trecho'}
          </span>
          {action.occurrence === 'last' && (
            <span className="text-[10px] text-[var(--ai-text-3)]">mantém a primeira ocorrência</span>
          )}
        </div>
        <div className="rounded-lg border border-[var(--ai-del-border)] bg-[var(--ai-del-soft)] px-2.5 py-1.5 text-[12px] leading-relaxed text-[var(--ai-del)] line-through decoration-[var(--ai-del)]/40 break-words">
          {start.slice(0, 200)}{start.length > 200 ? '…' : ''}
        </div>
        {isRange && (
          <>
            <div className="pl-1 text-[10.5px] text-[var(--ai-text-3)]">…até…</div>
            <div className="rounded-lg border border-[var(--ai-del-border)] bg-[var(--ai-del-soft)] px-2.5 py-1.5 text-[12px] leading-relaxed text-[var(--ai-del)] line-through decoration-[var(--ai-del)]/40 break-words">
              {end.slice(0, 200)}{end.length > 200 ? '…' : ''}
            </div>
          </>
        )}
      </div>
    );
  };

  const renderActionBody = (action: ChatActionState) => {
    if (action.type === 'replace') return renderReplaceDiff(action);
    if (action.type === 'delete') return renderDeletePreview(action);

    if (action.type === 'insert_block') {
      const entry = action.blockId ? kbSearcher.getEntry(action.blockId) : undefined;
      const reps = action.replacements || [];
      return (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="break-words font-medium text-[var(--ai-text)] text-[12px]">{entry?.title || 'Modelo da base'}</span>
            <span className="shrink-0 px-1.5 py-0.5 rounded bg-[var(--ai-accent-soft)] border border-[var(--ai-accent-border)] text-[var(--ai-accent)] text-[10px] font-semibold">
              formatação integral
            </span>
          </div>
          {reps.length > 0 ? (
            <div className="rounded-lg bg-[var(--ai-surface-2)] border border-[var(--ai-border)] px-2.5 py-1.5 space-y-1">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ai-text-3)]">Somente estas alterações</div>
              {reps.slice(0, 6).map((rep, i) => (
                <div key={i} className="flex items-baseline gap-1.5 text-[11.5px]">
                  <span className="text-[var(--ai-del)] line-through decoration-[var(--ai-del)]/40 break-all">{rep.search.slice(0, 60)}</span>
                  <span className="text-[var(--ai-text-3)] shrink-0">→</span>
                  <span className="text-[var(--ai-ok)] break-words">{rep.replace.slice(0, 80)}</span>
                </div>
              ))}
              {reps.length > 6 && <div className="text-[11px] text-[var(--ai-text-3)]">+{reps.length - 6} alterações</div>}
            </div>
          ) : (
            <div className="text-[11px] text-[var(--ai-text-3)]">Sem alterações — modelo inserido como está.</div>
          )}
        </div>
      );
    }

    return <InsertPreview text={normalizeAiInsertText(String(action.text || ''))} />;
  };

  const renderActions = (msg: ChatMessage) => {
    if (!msg.actions || msg.actions.length === 0) return null;

    const pendentes = msg.actions.filter((a) => a.status !== 'applied');
    const selecionadas = pendentes.filter((a) => a.selected);
    const allSelected = pendentes.length > 0 && selecionadas.length === pendentes.length;
    const isApplying = applyingMessageId === msg.id;

    return (
      <div className="mt-3 space-y-2">
        {msg.actions.map((action, idx) => {
          const isApplied = action.status === 'applied';
          const isFailed = action.status === 'failed';
          return (
            <div
              key={idx}
              onClick={() => !isApplied && !isApplying && toggleActionSelected(msg.id, idx)}
              className={`group/action rounded-xl border p-3 text-[12px] transition-all ${
                isApplied
                  ? 'border-[var(--ai-ok-border)] bg-[var(--ai-ok-soft)]'
                  : isFailed
                    ? 'border-[var(--ai-del-border)] bg-[var(--ai-del-soft)] cursor-pointer'
                    : action.selected
                      ? 'border-[var(--ai-accent-border)] bg-[var(--ai-accent-soft)]/60 cursor-pointer'
                      : 'border-[var(--ai-border)] bg-[var(--ai-surface)] opacity-60 hover:opacity-90 cursor-pointer'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {/* Checkbox de aprovação */}
                {isApplied ? (
                  <span className="shrink-0 mt-0.5 w-5 h-5 rounded-md bg-[var(--ai-ok)] text-white flex items-center justify-center">
                    <Check className="w-3.5 h-3.5" strokeWidth={3} />
                  </span>
                ) : (
                  <span className={`shrink-0 mt-0.5 transition-colors ${action.selected ? 'text-[var(--ai-accent)]' : 'text-[var(--ai-text-3)] group-hover/action:text-[var(--ai-text-2)]'}`}>
                    {action.selected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${
                      isApplied
                        ? 'bg-[var(--ai-ok-soft)] text-[var(--ai-ok)]'
                        : action.selected
                          ? 'bg-[var(--ai-accent-soft)] text-[var(--ai-accent)]'
                          : 'bg-[var(--ai-surface-2)] text-[var(--ai-text-3)]'
                    }`}>
                      {actionTypeIcon(action)}
                    </span>
                    <div className="font-semibold text-[var(--ai-text)] truncate flex-1">{actionSummary(action)}</div>
                    {isApplied && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded bg-[var(--ai-ok-soft)] border border-[var(--ai-ok-border)] text-[var(--ai-ok)] font-semibold text-[10px] uppercase tracking-wide">Aplicado</span>
                    )}
                  </div>
                  {renderActionBody(action)}
                  {isFailed && action.error && (
                    <div className="mt-1.5 flex items-center gap-1 text-[var(--ai-del)] font-medium text-[11.5px]">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {action.error}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {pendentes.length > 0 && (
          <div className="flex items-center gap-2 pt-0.5">
            {pendentes.length > 1 && (
              <button
                type="button"
                disabled={isApplying}
                onClick={() => setAllActionsSelected(msg.id, !allSelected)}
                className="shrink-0 px-3 py-2 rounded-lg border border-[var(--ai-border)] bg-[var(--ai-surface)] text-[11.5px] font-semibold text-[var(--ai-text-2)] hover:border-[var(--ai-accent-border)] hover:text-[var(--ai-accent)] transition disabled:opacity-50"
              >
                {allSelected ? 'Desmarcar' : 'Marcar todas'}
              </button>
            )}
            <button
              type="button"
              disabled={selecionadas.length === 0 || isApplying}
              onClick={() => void applySelectedActions(msg.id)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--ai-accent)] text-white text-[12px] font-semibold shadow-sm hover:bg-[var(--ai-accent-hover)] active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
              {isApplying ? 'Aplicando...' : `Aplicar ${selecionadas.length === 1 ? '1 alteração' : `${selecionadas.length} alterações`}`}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderQuestions = (msg: ChatMessage) => {
    if (!msg.questions || msg.questions.length === 0) return null;

    // Só o formulário da ÚLTIMA mensagem fica ativo: depois que o usuário
    // responde (ou muda de assunto), as perguntas antigas viram histórico.
    const isActive = msg.id === lastMessageId && !isSending && !disabled;
    const draft = getDraft(msg.id);
    const answeredCount = msg.questions.filter((_, idx) => (draft.selections[idx] || '').trim()).length;
    const canSubmit = answeredCount > 0 || draft.note.trim().length > 0;

    return (
      <div className={`mt-3 rounded-xl border p-3 space-y-3 ${isActive ? 'border-[var(--ai-accent-border)] bg-[var(--ai-accent-soft)]/50' : 'border-[var(--ai-border)] bg-[var(--ai-surface-2)]'}`}>
        <div className={`flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide ${isActive ? 'text-[var(--ai-accent)]' : 'text-[var(--ai-text-3)]'}`}>
          <HelpCircle className="w-3.5 h-3.5" />
          {isActive ? 'Preciso de informações' : 'Perguntas respondidas'}
        </div>

        {msg.questions.map((q, idx) => {
          const selected = draft.selections[idx] || '';
          const hasOptions = Boolean(q.options && q.options.length > 0);
          const isTypedAnswer = Boolean(selected) && !(q.options || []).includes(selected);
          return (
            <div key={idx}>
              <div className={`text-[12.5px] font-medium ${isActive ? 'text-[var(--ai-text)]' : 'text-[var(--ai-text-2)]'}`}>
                {q.question}
              </div>
              {hasOptions && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(q.options || []).map((option) => {
                    const isChosen = selected === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        disabled={!isActive}
                        onClick={() => setDraftSelection(msg.id, idx, option)}
                        className={`px-2.5 py-1 rounded-lg border text-[11.5px] font-medium transition disabled:cursor-default ${
                          isChosen
                            ? 'border-[var(--ai-accent)] bg-[var(--ai-accent)] text-white'
                            : isActive
                              ? 'border-[var(--ai-border-strong)] bg-[var(--ai-surface)] text-[var(--ai-text)] hover:border-[var(--ai-accent)]'
                              : 'border-[var(--ai-border)] bg-[var(--ai-surface)] text-[var(--ai-text-3)]'
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Resposta livre por pergunta (único caminho quando não há opções) */}
              {isActive && (
                <input
                  type="text"
                  value={isTypedAnswer ? selected : ''}
                  onChange={(e) => setDraftSelection(msg.id, idx, e.target.value, true)}
                  placeholder={hasOptions ? 'Outra resposta...' : 'Responder...'}
                  className="mt-1.5 w-full rounded-lg border border-[var(--ai-border)] bg-[var(--ai-surface)] px-2.5 py-1.5 text-[12px] text-[var(--ai-text)] placeholder:text-[var(--ai-text-3)] outline-none focus:border-[var(--ai-accent)] transition"
                />
              )}
              {!isActive && selected && (
                <div className="mt-1 text-[11.5px] text-[var(--ai-text-2)] italic">Resposta: {selected}</div>
              )}
            </div>
          );
        })}

        {isActive && (
          <>
            <input
              type="text"
              value={draft.note}
              onChange={(e) => setDraftNote(msg.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitQuestionAnswers(msg);
                }
              }}
              placeholder="Complemente com valores/detalhes (opcional)..."
              className="w-full rounded-lg border border-[var(--ai-border)] bg-[var(--ai-surface)] px-2.5 py-1.5 text-[12px] text-[var(--ai-text)] placeholder:text-[var(--ai-text-3)] outline-none focus:border-[var(--ai-accent)] transition"
            />
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => submitQuestionAnswers(msg)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--ai-accent)] text-white text-[12px] font-semibold shadow-sm hover:bg-[var(--ai-accent-hover)] active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              Enviar respostas ({answeredCount}/{msg.questions.length})
            </button>
          </>
        )}
      </div>
    );
  };

  const progressLabel = progress.stage === 'searching'
    ? `Consultando modelos do escritório${progress.detail ? `: «${progress.detail.slice(0, 40)}»` : ''}…`
    : progress.stage === 'streaming'
      ? 'Redigindo…'
      : 'Analisando o documento…';

  const toggleExpandedPanel = () => setIsExpanded((current) => !current);
  const activePanelSize = isExpanded
    ? {
        w: Math.min(680, window.innerWidth - 32),
        h: Math.min(760, window.innerHeight - 72),
      }
    : panelSize;

  return (
    <>
      <style>{AI_THEME_CSS}</style>

      {/* Botão flutuante */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="pet-ai absolute bottom-10 right-5 z-[55] group flex min-w-[58px] items-center gap-3 rounded-2xl border border-[var(--ai-border)] bg-[var(--ai-surface)] py-2 pl-2 pr-2 text-left text-[var(--ai-text)] shadow-[0_14px_34px_-14px_rgba(33,28,24,0.30)] transition-all hover:-translate-y-0.5 hover:border-[var(--ai-accent-border)] hover:shadow-[0_18px_38px_-14px_rgba(203,74,10,0.32)] active:translate-y-0 sm:min-w-[218px] sm:pr-3.5"
          title="Abrir Júri, assistente jurídico"
          aria-label="Abrir Júri, assistente jurídico"
          aria-expanded="false"
        >
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[linear-gradient(145deg,#fff8ef,#ffead7)] ring-1 ring-[#f5c79d]">
            <span className="absolute inset-x-1 bottom-0 h-3 rounded-full bg-orange-300/20 blur-md" aria-hidden />
            <img
              src="/brand/juri-mascot.png"
              alt=""
              className="relative h-[52px] w-[52px] translate-y-1 object-contain transition-transform duration-300 group-hover:scale-110"
              draggable={false}
            />
          </span>
          <span className="hidden min-w-0 flex-1 sm:block">
            <span className="flex items-center gap-1.5 text-[13px] font-bold leading-tight">
              Júri
              <span className="rounded-full bg-[var(--ai-accent-soft)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--ai-accent)]">IA</span>
            </span>
            <span className="mt-1 block truncate text-[10.5px] leading-tight text-[var(--ai-text-2)]">
              {isSelectionScope
                ? `${normalizedSelection.length} caracteres selecionados`
                : hasDocument
                  ? `${documentContextSummary} para revisão`
                  : 'Diga do que se trata e eu começo'}
            </span>
          </span>
          <ArrowUpRight className="hidden h-3.5 w-3.5 shrink-0 text-[var(--ai-text-3)] transition-colors group-hover:text-[var(--ai-accent)] sm:block" />
          {isSelectionScope && (
            <span className="absolute -left-1 -top-1 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-50" />
              <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-white bg-orange-500" />
            </span>
          )}
        </button>
      )}

      {/* Painel do chat */}
      {isOpen && (
        <div
          className="pet-ai ai-chat-panel absolute bottom-10 right-4 z-[70] flex flex-col overflow-hidden rounded-[20px] border border-[var(--ai-border)] bg-[var(--ai-surface)] shadow-[0_26px_76px_-24px_rgba(32,24,18,0.38)]"
          style={{
            width: `min(${activePanelSize.w}px, calc(100% - 2rem))`,
            height: `min(${activePanelSize.h}px, calc(100% - 4.5rem))`,
          }}
          role="dialog"
          aria-label="Júri, assistente jurídico"
        >
          {/* Alça de redimensionamento (canto superior esquerdo) */}
          <div
            onPointerDown={handleResizeStart}
            className="absolute top-0 left-0 w-5 h-5 z-10 cursor-nwse-resize group/resize"
            title="Arraste para redimensionar"
          >
            <span className="absolute top-1.5 left-1.5 w-2 h-2 border-t-2 border-l-2 border-[var(--ai-border-strong)] rounded-tl group-hover/resize:border-[var(--ai-accent)] transition-colors" />
          </div>

          {/* Header */}
          <header className="shrink-0 border-b border-[var(--ai-border)] bg-[var(--ai-surface)]">
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[linear-gradient(145deg,#fff8ef,#ffead7)] ring-1 ring-[#f5c79d]">
                  <img
                    src="/brand/juri-mascot.png"
                    alt=""
                    className="h-11 w-11 translate-y-1 object-contain"
                    draggable={false}
                  />
                  <span className={`absolute bottom-1 right-1 h-2 w-2 rounded-full border-2 border-white ${disabled ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13.5px] font-bold leading-tight text-[var(--ai-text)]">Júri</span>
                    <span className="rounded-full bg-[var(--ai-accent-soft)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--ai-accent)]">Assistente IA</span>
                  </div>
                  <div className="mt-0.5 truncate text-[10.5px] leading-tight text-[var(--ai-text-2)]">
                    {kbSearcher.size > 0
                      ? `${kbSearcher.size} ${kbSearcher.size === 1 ? 'modelo conectado' : 'modelos conectados'} à base`
                      : 'Revisão e redação jurídica contextual'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={toggleExpandedPanel}
                  className="p-2 text-[var(--ai-text-3)] hover:text-[var(--ai-text)] hover:bg-[var(--ai-surface-2)] rounded-lg transition"
                  title={isExpanded ? 'Voltar ao tamanho compacto' : 'Ampliar painel'}
                  aria-label={isExpanded ? 'Voltar ao tamanho compacto' : 'Ampliar painel'}
                >
                  {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setMessages([]); setQuestionDrafts({}); }}
                    className="p-2 text-[var(--ai-text-3)] hover:text-[var(--ai-text)] hover:bg-[var(--ai-surface-2)] rounded-lg transition"
                    title="Limpar conversa"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-2 text-[var(--ai-text-3)] hover:text-[var(--ai-text)] hover:bg-[var(--ai-surface-2)] rounded-lg transition"
                  title="Fechar (Esc)"
                  aria-label="Fechar assistente"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Barra de escopo: o que exatamente o assistente vai tratar. */}
            <div className="border-t border-[var(--ai-border)] bg-[var(--ai-surface-2)] px-3.5 py-1.5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${isSelectionScope ? 'bg-[var(--ai-accent-soft)] text-[var(--ai-accent)]' : 'bg-[var(--ai-surface)] text-[var(--ai-text-2)]'}`}>
                    {isSelectionScope ? <Target className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--ai-text-3)]">
                      {isSelectionScope ? 'Escopo: trecho selecionado' : 'Escopo: documento inteiro'}
                    </div>
                    <div className="truncate text-[10.5px] font-medium text-[var(--ai-text)]">
                      {isSelectionScope
                        ? `“${selectionPreview}”`
                        : hasDocument
                          ? `${documentContextSummary} para análise`
                          : 'Documento em branco — use a redação assistida'}
                    </div>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ai-border)] bg-[var(--ai-surface)] px-2 py-1 text-[9.5px] font-semibold text-[var(--ai-text-2)]">
                  <ShieldCheck className="h-3 w-3 text-emerald-600" />
                  Você aprova
                </span>
              </div>

              {/* Alternância explícita: seleção some do editor com facilidade,
                  então quem manda no escopo é esta escolha, não o foco. */}
              {hasSelection && (
                <div className="mt-1.5 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setScopePreference('selection')}
                    className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition ${isSelectionScope ? 'bg-[var(--ai-accent)] text-white shadow-sm' : 'bg-[var(--ai-surface)] text-[var(--ai-text-2)] ring-1 ring-[var(--ai-border)] hover:text-[var(--ai-text)]'}`}
                  >
                    Só o trecho ({normalizedSelection.length} car.)
                  </button>
                  <button
                    type="button"
                    onClick={() => setScopePreference('document')}
                    className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition ${!isSelectionScope ? 'bg-[var(--ai-accent)] text-white shadow-sm' : 'bg-[var(--ai-surface)] text-[var(--ai-text-2)] ring-1 ring-[var(--ai-border)] hover:text-[var(--ai-text)]'}`}
                  >
                    Documento inteiro
                  </button>
                  {stickySelection && !liveSelection && (
                    <button
                      type="button"
                      onClick={() => { setStickySelection(''); setScopePreference('auto'); }}
                      className="ml-auto rounded-lg px-1.5 py-1 text-[10px] text-[var(--ai-text-3)] transition hover:text-[var(--ai-del)]"
                      title="Esquecer o trecho memorizado"
                    >
                      limpar
                    </button>
                  )}
                </div>
              )}

              {/* Briefing e acervo: os dois contextos que o assistente carrega. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowBriefing((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9.5px] font-semibold transition ${briefing ? 'bg-[var(--ai-accent-soft)] text-[var(--ai-accent)] ring-1 ring-[var(--ai-accent-border)]' : 'bg-[var(--ai-surface)] text-[var(--ai-text-2)] ring-1 ring-[var(--ai-border)] hover:text-[var(--ai-text)]'}`}
                  title={briefing ? 'Editar o briefing da peça' : 'Definir área, tipo de peça e polo'}
                >
                  {briefing ? <Pencil className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                  {briefing
                    ? [briefing.documentType, briefing.area].filter(Boolean).join(' · ')
                    : 'Definir briefing da peça'}
                </button>

                <button
                  type="button"
                  onClick={() => setShowArchiveSettings((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9.5px] font-semibold transition ${archiveEnabled ? 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/30' : 'bg-[var(--ai-surface)] text-[var(--ai-text-2)] ring-1 ring-[var(--ai-border)] hover:text-[var(--ai-text)]'}`}
                  title="Acervo de petições do Nextcloud como base de conhecimento"
                >
                  {archiveEnabled ? <Cloud className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
                  {archiveEnabled ? `Acervo: ${archiveRoot || 'todas as pastas'}` : 'Acervo do Nextcloud'}
                </button>
              </div>

              {showArchiveSettings && (
                <div className="mt-1.5 rounded-lg border border-[var(--ai-border)] bg-[var(--ai-surface)] p-2 space-y-2">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={archiveEnabled}
                      onChange={(e) => setArchiveEnabled(e.target.checked)}
                      className="mt-0.5 accent-[var(--ai-accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold text-[var(--ai-text)]">
                        Usar as petições do Nextcloud como base
                      </span>
                      <span className="mt-0.5 block text-[9.5px] leading-snug text-[var(--ai-text-2)]">
                        O Júri procura peças reais do escritório por nome, lê só as mais próximas do assunto e usa como referência de estilo e tese. Nenhum dado de outro cliente é copiado.
                      </span>
                    </span>
                  </label>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--ai-text-3)]">
                      Pasta do acervo (opcional)
                    </div>
                    <input
                      type="text"
                      value={archiveRoot}
                      onChange={(e) => setArchiveRoot(e.target.value)}
                      placeholder="Ex.: Modelos/Petições — vazio = procurar em tudo"
                      className="mt-1 w-full rounded-lg border border-[var(--ai-border)] bg-[var(--ai-surface-2)] px-2 py-1.5 text-[11px] text-[var(--ai-text)] outline-none transition placeholder:text-[var(--ai-text-3)] focus:border-[var(--ai-accent)]"
                    />
                  </div>
                  <div className="flex items-center gap-1 text-[9.5px] text-[var(--ai-text-3)]">
                    <Settings2 className="h-3 w-3" />
                    Buscar em uma pasta específica é mais rápido e mais preciso.
                  </div>
                </div>
              )}
            </div>
          </header>

          {/* Mensagens */}
          <div className="pet-ai-scroll flex-1 overflow-y-auto space-y-3.5 bg-[var(--ai-surface-2)] px-3 py-3" aria-live="polite">
            {messages.length === 0 && (
              <div className="flex min-h-full flex-col px-0.5 py-0.5">
                <div className="flex items-center gap-3 px-1">
                  <div className="relative flex h-[62px] w-[62px] shrink-0 items-center justify-center">
                    <span className="absolute inset-2 rounded-full bg-orange-300/20 blur-xl" aria-hidden />
                    <img
                      src="/brand/juri-mascot.png"
                      alt="Júri, mascote do assistente jurídico"
                      className="relative h-[72px] w-[72px] object-contain drop-shadow-[0_9px_12px_rgba(92,43,12,0.14)]"
                      draggable={false}
                    />
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-[15px] font-bold leading-tight text-[var(--ai-text)]">
                      {isSelectionScope ? 'Aprimorar o trecho selecionado' : hasDocument ? 'Revisar esta petição' : 'Começar uma nova redação'}
                    </div>
                    <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--ai-text-2)]">
                      {isSelectionScope
                        ? 'Só o trecho será alterado; o restante da peça entra apenas como contexto de leitura.'
                        : hasDocument
                          ? 'Escolha uma análise. As mudanças sempre chegam em prévia.'
                          : 'Primeiro me diga do que se trata: com a área e o tipo de peça eu monto a estrutura certa.'}
                    </p>
                  </div>
                </div>

                {/* Documento em branco sem briefing: perguntar vem ANTES de
                    escrever. Estrutura genérica não ajuda ninguém. */}
                {(showBriefing || (!hasDocument && !briefing)) && (
                  <div className="mt-3">
                    <PetitionAiBriefing
                      value={briefing || undefined}
                      suggestedArea={suggestedArea}
                      suggestedDocumentType={suggestedDocumentType}
                      onCancel={briefing || hasDocument ? () => setShowBriefing(false) : undefined}
                      submitLabel={hasDocument ? 'Salvar briefing' : 'Montar a estrutura da peça'}
                      onSubmit={(next) => {
                        setBriefing(next);
                        setShowBriefing(false);
                        if (!hasDocument) {
                          void sendMessage(
                            [
                              `Vamos redigir: ${next.documentType} — área ${next.area}.`,
                              next.party ? `Nosso cliente é: ${next.party}.` : '',
                              next.highlights?.length ? `Pontos a contemplar: ${next.highlights.join('; ')}.` : '',
                              next.summary ? `Resumo do caso: ${next.summary}` : '',
                              'Monte a estrutura dessa peça com os tópicos próprios desta área e deste tipo, na ordem correta. Depois liste, numa lista única, exatamente quais informações do caso ainda faltam.',
                            ].filter(Boolean).join('\n'),
                          );
                        }
                      }}
                    />
                  </div>
                )}

                {briefing && !showBriefing && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--ai-accent-border)] bg-[var(--ai-accent-soft)]/50 px-2.5 py-1.5">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--ai-accent)]" />
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-[var(--ai-text)]">
                      {[briefing.documentType, briefing.area, briefing.party].filter(Boolean).join(' · ')}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowBriefing(true)}
                      className="shrink-0 text-[10px] font-semibold text-[var(--ai-accent)] hover:underline"
                    >
                      editar
                    </button>
                  </div>
                )}

                {primaryQuickPrompt && (
                  <button
                    type="button"
                    disabled={isQuickPromptDisabled(primaryQuickPrompt)}
                    onClick={() => handleQuickPrompt(primaryQuickPrompt)}
                    className="group mt-3 flex w-full items-center gap-3 rounded-xl border border-[var(--ai-accent-border)] bg-[var(--ai-accent-soft)]/70 px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:bg-[var(--ai-accent-soft)] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--ai-accent)] text-white shadow-sm">
                      {primaryQuickPrompt.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[12px] font-bold leading-tight text-[var(--ai-text)]">{primaryQuickPrompt.label}</span>
                        <span className="rounded-full bg-[var(--ai-surface)] px-1.5 py-0.5 text-[7.5px] font-bold uppercase tracking-[0.1em] text-[var(--ai-accent)] ring-1 ring-[var(--ai-accent-border)]">
                          Recomendado
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-[var(--ai-text-2)]">{primaryQuickPrompt.desc}</span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--ai-accent)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </button>
                )}

                {/* Ações secundárias visíveis somente quando fazem sentido. */}
                <div className={`mt-2 grid w-full gap-1.5 ${compactSecondaryQuickPrompts.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {compactSecondaryQuickPrompts.map((qp) => (
                    <button
                      key={qp.id}
                      type="button"
                      disabled={isQuickPromptDisabled(qp)}
                      onClick={() => handleQuickPrompt(qp)}
                      className="group flex min-h-[58px] w-full items-center gap-2 rounded-xl border border-[var(--ai-border)] bg-[var(--ai-surface)] px-2.5 py-2 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--ai-accent-border)] hover:bg-[var(--ai-accent-soft)]/35 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:border-[var(--ai-border)] disabled:hover:bg-[var(--ai-surface)] disabled:hover:shadow-none"
                      title={
                        qp.scope === 'selection' && !hasSelection
                          ? 'Selecione um trecho no documento para usar esta ação'
                          : qp.requiresDocument && !hasDocument
                            ? 'Insira ou abra um documento para usar esta ação'
                          : qp.desc
                      }
                    >
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--ai-surface-2)] text-[var(--ai-text-2)] transition-all group-hover:bg-[var(--ai-accent)] group-hover:text-white">
                        {qp.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10.5px] font-semibold leading-tight text-[var(--ai-text)]">{qp.label}</span>
                        <span className="mt-0.5 block truncate text-[9px] leading-snug text-[var(--ai-text-2)]">
                          {qp.scope === 'selection' && !hasSelection ? 'Selecione um trecho para liberar' : qp.desc}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>

                {/* Catálogo completo: as habilidades agrupadas por finalidade. */}
                {hiddenSkillsCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllSkills((v) => !v)}
                    className="mt-2 inline-flex items-center justify-center gap-1 self-center rounded-lg px-2 py-1 text-[10px] font-semibold text-[var(--ai-accent)] transition hover:bg-[var(--ai-accent-soft)]/50"
                  >
                    <ChevronDown className={`h-3 w-3 transition-transform ${showAllSkills ? 'rotate-180' : ''}`} />
                    {showAllSkills
                      ? 'Mostrar só as principais'
                      : `Ver todas as ${visibleQuickPrompts.length} habilidades`}
                  </button>
                )}

                {showAllSkills && (
                  <div className="mt-2 space-y-2">
                    {skillsByGroup.map(([group, skills]) => (
                      <div key={group}>
                        <div className="px-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--ai-text-3)]">
                          {SKILL_GROUP_LABEL[group]}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {skills.map((qp) => (
                            <button
                              key={qp.id}
                              type="button"
                              disabled={isQuickPromptDisabled(qp)}
                              onClick={() => handleQuickPrompt(qp)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ai-border)] bg-[var(--ai-surface)] px-2 py-1.5 text-[10.5px] font-medium text-[var(--ai-text)] transition hover:border-[var(--ai-accent-border)] hover:bg-[var(--ai-accent-soft)]/40 hover:text-[var(--ai-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                              title={
                                qp.scope === 'selection' && !hasSelection
                                  ? 'Selecione um trecho no documento para usar esta ação'
                                  : qp.desc
                              }
                            >
                              <span className="shrink-0 text-[var(--ai-text-3)]">{qp.icon}</span>
                              {qp.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!hasSelection && hasDocument && (
                  <div className="mt-2.5 flex items-center justify-center gap-1.5 text-[9.5px] text-[var(--ai-text-3)]">
                    <MousePointer2 className="h-3 w-3" />
                    Selecione um trecho no documento para trabalhar só nele.
                  </div>
                )}
              </div>
            )}

            {messages.map((msg) => (
              msg.role === 'user' ? (
                <div key={msg.id} className="ai-chat-msg flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--ai-user-bubble)] text-[var(--ai-user-text)] px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap shadow-sm">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="ai-chat-msg flex items-start gap-2">
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg border ${
                    msg.isError
                      ? 'bg-[var(--ai-del-soft)] border-[var(--ai-del-border)]'
                      : 'bg-[var(--ai-accent-soft)] border-[var(--ai-accent-border)]'
                  }`}>
                    {msg.isError
                      ? <AlertTriangle className="w-3.5 h-3.5 text-[var(--ai-del)]" />
                      : (
                        <img
                          src="/brand/juri-mascot.png"
                          alt=""
                          className="h-8 w-8 translate-y-0.5 object-contain"
                          draggable={false}
                        />
                      )}
                  </div>
                  <div className={`max-w-[88%] min-w-0 flex-1 rounded-2xl rounded-tl-md px-3.5 py-3 text-[13px] leading-relaxed border ${
                    msg.isError
                      ? 'bg-[var(--ai-del-soft)] text-[var(--ai-del)] border-[var(--ai-del-border)]'
                      : 'bg-[var(--ai-surface)] text-[var(--ai-text)] border-[var(--ai-border)] shadow-[0_2px_10px_-6px_rgba(15,23,42,0.12)]'
                  }`}>
                    {/* Indicador de progresso enquanto a resposta não começou */}
                    {msg.streaming && !msg.content && (
                      <span className="inline-flex items-center gap-2.5 text-[12px] text-[var(--ai-text-2)]">
                        <span className="flex items-center gap-1">
                          <span className="ai-typing-dot inline-block w-1.5 h-1.5 rounded-full bg-[var(--ai-accent)]" />
                          <span className="ai-typing-dot inline-block w-1.5 h-1.5 rounded-full bg-[var(--ai-accent)]" />
                          <span className="ai-typing-dot inline-block w-1.5 h-1.5 rounded-full bg-[var(--ai-accent)]" />
                        </span>
                        {progressLabel}
                      </span>
                    )}

                    {msg.isError
                      ? <span className="whitespace-pre-wrap">{msg.content}</span>
                      : msg.content && <AiMarkdown content={msg.content} streaming={msg.streaming} />}

                    {msg.aborted && (
                      <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--ai-warn-soft)] border border-[var(--ai-warn-border)] text-[10.5px] font-medium text-[var(--ai-warn)]">
                        <StopCircle className="w-3 h-3" />
                        Geração interrompida
                      </div>
                    )}

                    {msg.isError && msg.retryText && (
                      <button
                        type="button"
                        onClick={() => retryMessage(msg)}
                        className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--ai-del-border)] bg-[var(--ai-surface)] text-[11.5px] font-semibold text-[var(--ai-del)] hover:bg-[var(--ai-del-soft)] transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Tentar novamente
                      </button>
                    )}

                    {/* Fonte: buscas feitas na base de conhecimento */}
                    {msg.searches && msg.searches.length > 0 && (
                      <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--ai-text-3)]">
                          <BookOpen className="w-3 h-3" />
                          Base consultada:
                        </span>
                        {msg.searches.slice(0, 3).map((s, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded bg-[var(--ai-surface-2)] border border-[var(--ai-border)] text-[10px] text-[var(--ai-text-2)] max-w-[140px] truncate">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Peças reais do acervo que embasaram a resposta */}
                    {msg.archiveSources && msg.archiveSources.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--ai-text-3)]">
                          <Cloud className="w-3 h-3" />
                          Acervo consultado:
                        </span>
                        {msg.archiveSources.slice(0, 3).map((source, i) => (
                          <span
                            key={i}
                            title={source}
                            className="max-w-[180px] truncate rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700"
                          >
                            {source.split('/').pop()}
                          </span>
                        ))}
                        {msg.archiveSources.length > 3 && (
                          <span className="text-[10px] text-[var(--ai-text-3)]">+{msg.archiveSources.length - 3}</span>
                        )}
                      </div>
                    )}

                    {renderQuestions(msg)}
                    {renderActions(msg)}
                  </div>
                </div>
              )
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Chips rápidos (só com conversa em andamento; no vazio viram cards) */}
          {messages.length > 0 && (
            <div className="px-3 pt-2 pb-1 flex gap-1.5 overflow-x-auto shrink-0 bg-[var(--ai-surface)] border-t border-[var(--ai-border)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {visibleQuickPrompts.map((qp) => (
                <button
                  key={qp.id}
                  type="button"
                  disabled={isQuickPromptDisabled(qp)}
                  onClick={() => handleQuickPrompt(qp)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-[var(--ai-border)] bg-[var(--ai-surface)] text-[11.5px] font-medium text-[var(--ai-text-2)] hover:border-[var(--ai-accent-border)] hover:text-[var(--ai-accent)] hover:bg-[var(--ai-accent-soft)]/50 transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  title={
                    qp.scope === 'selection' && !hasSelection
                      ? 'Selecione um trecho no documento'
                      : qp.requiresDocument && !hasDocument
                        ? 'Abra ou escreva um documento'
                        : qp.desc
                  }
                >
                  {qp.icon}
                  {qp.label}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className={`px-3 pb-2.5 bg-[var(--ai-surface)] shrink-0 ${messages.length > 0 ? 'pt-1.5' : 'pt-2.5 border-t border-[var(--ai-border)]'}`}>
            {disabled && (
              <div className="mb-1.5 text-[11.5px] text-[var(--ai-warn)] bg-[var(--ai-warn-soft)] border border-[var(--ai-warn-border)] rounded-lg px-2.5 py-1.5">
                {disabledReason || 'Assistente indisponível no momento.'}
              </div>
            )}
            <div className="mb-1.5 flex items-center justify-between px-0.5">
              <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold text-[var(--ai-text-2)]">
                {isSelectionScope ? <Target className="h-3 w-3 text-[var(--ai-accent)]" /> : <FileText className="h-3 w-3" />}
                {isSelectionScope
                  ? 'Só o trecho selecionado será alterado'
                  : hasDocument
                    ? 'Documento inteiro como contexto'
                    : briefing
                      ? `${briefing.documentType} · ${briefing.area}`
                      : 'Defina o briefing para começar'}
              </span>
              <span className="text-[9px] text-[var(--ai-text-3)]">Enter envia · Shift+Enter quebra linha</span>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1 rounded-xl border border-transparent bg-[var(--ai-surface-2)] px-3 py-2 transition-all focus-within:border-[var(--ai-accent)] focus-within:bg-[var(--ai-surface)] focus-within:shadow-[0_0_0_3px_var(--ai-accent-soft)]">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                  rows={Math.min(4, Math.max(1, input.split('\n').length))}
                  placeholder={isSelectionScope
                    ? 'Diga o que deseja fazer com o trecho selecionado...'
                    : hasDocument
                      ? 'Peça uma análise, revisão, remoção ou novo tópico...'
                      : 'Descreva o caso ou preencha o briefing acima...'}
                  disabled={disabled}
                  className="w-full bg-transparent resize-none outline-none text-[13px] text-[var(--ai-text)] placeholder:text-[var(--ai-text-3)] py-0.5 disabled:cursor-not-allowed"
                />
              </div>
              {isSending ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="shrink-0 w-10 h-10 rounded-xl bg-[var(--ai-surface-2)] border border-[var(--ai-border-strong)] text-[var(--ai-text)] flex items-center justify-center hover:border-[var(--ai-del)] hover:text-[var(--ai-del)] active:scale-95 transition-all"
                  title="Parar geração"
                >
                  <StopCircle className="w-[18px] h-[18px]" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={!input.trim() || disabled}
                  className="shrink-0 w-10 h-10 rounded-xl bg-[var(--ai-accent)] text-white flex items-center justify-center shadow-sm hover:bg-[var(--ai-accent-hover)] active:scale-95 transition-all disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed"
                  title="Enviar (Enter)"
                >
                  <Send className="w-[18px] h-[18px]" />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex items-center justify-center gap-1 text-center text-[10px] text-[var(--ai-text-3)] select-none">
              <ShieldCheck className="h-3 w-3 text-emerald-600" />
              O Júri nunca altera o documento sem sua aprovação
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PetitionAiChat;
