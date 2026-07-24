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
  Sparkles,
  X,
  Send,
  Check,
  CheckCheck,
  Loader2,
  Trash2,
  AlertTriangle,
  Wand2,
  ListChecks,
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
} from 'lucide-react';
import {
  aiService,
  type PetitionChatAction,
  type PetitionChatQuestion,
} from '../services/ai.service';
import { PetitionKbSearcher, type KbEntry } from '../services/petitionKbSearch';
import { insertPetitionTextSmart } from '../utils/petitionSmartInsert';
import AiMarkdown from './petition/AiMarkdown';
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
}

const QUICK_PROMPTS: Array<{ icon: React.ReactNode; label: string; desc: string; prompt: string }> = [
  {
    icon: <ListChecks className="w-4 h-4" />,
    label: 'Revisar e apontar',
    desc: 'Erros, riscos e pedidos faltantes',
    prompt: 'Revise o documento e faça apontamentos: erros, inconsistências, argumentos frágeis e pedidos que possam estar faltando. Não altere nada ainda, só liste os apontamentos.',
  },
  {
    icon: <SpellCheck className="w-4 h-4" />,
    label: 'Corrigir texto',
    desc: 'Ortografia, gramática e pontuação',
    prompt: 'Corrija ortografia, gramática, concordância e pontuação do documento. Proponha cada correção como uma ação separada para eu escolher quais aplicar.',
  },
  {
    icon: <Wand2 className="w-4 h-4" />,
    label: 'Melhorar seleção',
    desc: 'Redação mais técnica e clara',
    prompt: 'Melhore a redação do trecho selecionado, deixando-o mais técnico e claro, preservando o sentido jurídico.',
  },
  {
    icon: <ListPlus className="w-4 h-4" />,
    label: 'Adicionar tópico',
    desc: 'Novo fundamento ou pedido',
    prompt: 'Adicione ao final do documento um tópico sobre ',
  },
];

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
  --ai-accent:#2563eb; --ai-accent-hover:#1d4ed8; --ai-accent-soft:#eff4ff; --ai-accent-border:#c7d7fe;
  --ai-user-bubble:#1f2937; --ai-user-text:#ffffff;
  --ai-ok:#059669; --ai-ok-soft:#ecfdf5; --ai-ok-border:#a7f3d0;
  --ai-del:#dc2626; --ai-del-soft:#fef2f2; --ai-del-border:#fecaca;
  --ai-warn:#b45309; --ai-warn-soft:#fffbeb; --ai-warn-border:#fde68a;
}
body.petition-dark .pet-ai{
  --ai-surface:#262626; --ai-surface-2:#2f2f2f; --ai-surface-3:#383838;
  --ai-border:#3d3d3d; --ai-border-strong:#4a4a4a;
  --ai-text:#e5e5e5; --ai-text-2:#a3a3a3; --ai-text-3:#737373;
  --ai-accent:#60a5fa; --ai-accent-hover:#93c5fd; --ai-accent-soft:#1e2a44; --ai-accent-border:#31436b;
  --ai-user-bubble:#3b4252; --ai-user-text:#f1f5f9;
  --ai-ok:#34d399; --ai-ok-soft:#0d2b22; --ai-ok-border:#14532d;
  --ai-del:#f87171; --ai-del-soft:#2f1a1a; --ai-del-border:#7f1d1d;
  --ai-warn:#fbbf24; --ai-warn-soft:#2e2308; --ai-warn-border:#78350f;
}
.pet-ai-scroll::-webkit-scrollbar{width:8px;}
.pet-ai-scroll::-webkit-scrollbar-thumb{background:var(--ai-border-strong);border-radius:8px;}
.pet-ai-scroll::-webkit-scrollbar-track{background:transparent;}
`;

const PANEL_SIZE_KEY = 'petitionAiChat.size';
const MIN_W = 380;
const MIN_H = 440;

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
  return { w: 480, h: 700 };
};

const PetitionAiChat: React.FC<PetitionAiChatProps> = ({
  editorRef,
  onDocumentChanged,
  kbEntries,
  clientContext,
  insertBlockSfdt,
  disabled = false,
  disabledReason,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage: 'thinking' | 'searching' | 'streaming'; detail?: string }>({ stage: 'thinking' });
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
  const [panelSize, setPanelSize] = useState(loadPanelSize);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Índice de busca local: reconstruído só quando os blocos mudam. Buscar aqui
  // não consome nenhum token — é o mecanismo de recuperação da base.
  const kbSearcher = useMemo(() => new PetitionKbSearcher(kbEntries || []), [kbEntries]);

  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isSending]);

  useEffect(() => {
    if (isOpen) {
      window.setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  // Cancela a geração em andamento se o componente desmontar.
  useEffect(() => () => abortRef.current?.abort(), []);

  const clampedSize = useCallback((size: { w: number; h: number }) => ({
    w: Math.min(Math.max(size.w, MIN_W), Math.max(MIN_W, window.innerWidth - 48)),
    h: Math.min(Math.max(size.h, MIN_H), Math.max(MIN_H, window.innerHeight - 120)),
  }), []);

  // ── Redimensionamento pela alça do canto superior esquerdo ─────────────────
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
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

      if (action.type === 'replace') {
        const search = String(action.search || '');
        const ok = replaceTolerant(search, String(action.replace ?? ''));
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
        let text = String(entry.content || '').trim();
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
      const text = String(action.text || '');
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
      const { documentText, selectedText } = captureEditorContext();

      const result = await aiService.petitionAssistantChatStream({
        history: historyMessages
          .filter((m) => !m.isError && m.content.trim())
          .map((m) => ({ role: m.role, content: m.content })),
        documentText,
        selectedText,
        clientContext,
        // Busca local: o melhor modelo vai com texto integral (permite
        // insert_block); os demais vão como trechos curtos.
        searchKb: kbSearcher.size > 0
          ? (query) => kbSearcher.search(query, 5, { fullTopN: 2, fullMaxChars: 9000 })
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
  }, [isSending, disabled, captureEditorContext, kbSearcher, clientContext]);

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

  const handleQuickPrompt = (prompt: string) => {
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
    if (action.type === 'insert_block') {
      const entry = action.blockId ? kbSearcher.getEntry(action.blockId) : undefined;
      return entry ? `Inserir modelo: ${entry.title}` : 'Inserir modelo da base';
    }
    return action.position === 'end' ? 'Inserir ao final do documento' : 'Inserir no cursor';
  };

  const actionTypeIcon = (action: ChatActionState) => {
    if (action.type === 'replace') return <SpellCheck className="w-3.5 h-3.5" />;
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

  const renderActionBody = (action: ChatActionState) => {
    if (action.type === 'replace') return renderReplaceDiff(action);

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

    return <InsertPreview text={String(action.text || '')} />;
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

  return (
    <>
      <style>{AI_THEME_CSS}</style>

      {/* Botão flutuante */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          // bottom-20: deixa livre o canto inferior direito, ocupado pelo widget global "Mensagens" (fixed z-[9999])
          className="pet-ai absolute bottom-20 right-5 z-[55] group flex items-center gap-2 pl-2.5 pr-3.5 py-2 rounded-full bg-[var(--ai-surface)] text-[var(--ai-text)] border border-[var(--ai-border-strong)] shadow-lg shadow-black/10 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all"
          title="Assistente IA da petição"
        >
          <span className="w-7 h-7 rounded-full bg-[var(--ai-accent)] flex items-center justify-center group-hover:scale-105 transition-transform">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </span>
          <span className="text-[12.5px] font-semibold hidden sm:block">Assistente</span>
        </button>
      )}

      {/* Painel do chat */}
      {isOpen && (
        <div
          className="pet-ai ai-chat-panel absolute bottom-20 right-4 z-[70] flex flex-col bg-[var(--ai-surface)] rounded-2xl overflow-hidden border border-[var(--ai-border)] shadow-[0_24px_64px_-16px_rgba(15,23,42,0.35)]"
          style={{
            width: `min(${panelSize.w}px, calc(100% - 2rem))`,
            height: `min(${panelSize.h}px, calc(100% - 6rem))`,
          }}
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
          <header className="shrink-0 flex items-center justify-between px-4 py-2.5 bg-[var(--ai-surface)] border-b border-[var(--ai-border)]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--ai-accent-soft)] border border-[var(--ai-accent-border)] flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-[var(--ai-accent)]" />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-[var(--ai-text)] leading-tight">Assistente IA</div>
                <div className="text-[11px] text-[var(--ai-text-2)] leading-tight mt-0.5">
                  {kbSearcher.size > 0 ? `${kbSearcher.size} modelos do escritório na base` : 'Pronto para ajudar com o documento'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
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
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Mensagens */}
          <div className="pet-ai-scroll flex-1 overflow-y-auto px-3.5 py-3.5 space-y-3.5 bg-[var(--ai-surface-2)]">
            {messages.length === 0 && (
              <div className="min-h-full flex flex-col items-center justify-center px-1.5 py-4 text-center">
                <div className="w-11 h-11 rounded-xl bg-[var(--ai-accent-soft)] border border-[var(--ai-accent-border)] flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-[var(--ai-accent)]" />
                </div>
                <div className="mt-3 text-[14.5px] font-semibold text-[var(--ai-text)] leading-tight">Como posso ajudar?</div>
                <p className="mt-1 text-[11.5px] text-[var(--ai-text-2)] leading-relaxed max-w-[300px]">
                  Reviso, corrijo e crio tópicos com os modelos do escritório. Você aprova cada alteração antes de aplicar.
                </p>

                {/* Sugestões */}
                <div className="mt-4 w-full space-y-1.5">
                  {QUICK_PROMPTS.map((qp) => (
                    <button
                      key={qp.label}
                      type="button"
                      disabled={isSending || disabled}
                      onClick={() => handleQuickPrompt(qp.prompt)}
                      className="group w-full flex items-center gap-3 rounded-xl border border-[var(--ai-border)] bg-[var(--ai-surface)] px-3 py-2.5 text-left hover:border-[var(--ai-accent-border)] hover:bg-[var(--ai-accent-soft)]/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="inline-flex w-7 h-7 shrink-0 rounded-lg bg-[var(--ai-surface-2)] text-[var(--ai-text-2)] items-center justify-center group-hover:bg-[var(--ai-accent)] group-hover:text-white transition-all">
                        {qp.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-semibold text-[var(--ai-text)] leading-tight">{qp.label}</span>
                        <span className="block mt-0.5 text-[10.5px] text-[var(--ai-text-2)] leading-snug truncate">{qp.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
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
                  <div className={`shrink-0 mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center border ${
                    msg.isError
                      ? 'bg-[var(--ai-del-soft)] border-[var(--ai-del-border)]'
                      : 'bg-[var(--ai-accent-soft)] border-[var(--ai-accent-border)]'
                  }`}>
                    {msg.isError
                      ? <AlertTriangle className="w-3.5 h-3.5 text-[var(--ai-del)]" />
                      : <Sparkles className="w-3.5 h-3.5 text-[var(--ai-accent)]" />}
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
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp.label}
                  type="button"
                  disabled={isSending || disabled}
                  onClick={() => handleQuickPrompt(qp.prompt)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-[var(--ai-border)] bg-[var(--ai-surface)] text-[11.5px] font-medium text-[var(--ai-text-2)] hover:border-[var(--ai-accent-border)] hover:text-[var(--ai-accent)] hover:bg-[var(--ai-accent-soft)]/50 transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
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
            <div className="flex items-end gap-2">
              <div className="flex-1 rounded-xl bg-[var(--ai-surface-2)] border border-transparent focus-within:bg-[var(--ai-surface)] focus-within:border-[var(--ai-accent)] transition-all px-3 py-2">
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
                  placeholder="Peça uma revisão, correção, tópico..."
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
            <div className="mt-1.5 text-center text-[10px] text-[var(--ai-text-3)] select-none">
              A IA propõe — você aprova antes de aplicar
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PetitionAiChat;
