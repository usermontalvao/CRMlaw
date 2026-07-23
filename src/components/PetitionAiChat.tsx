// Widget de chat IA do Editor de Petições
// Assistente flutuante que conversa sobre o documento aberto e propõe ações
// que o usuário aprova por checkbox antes de aplicar:
//  - 'replace': correção cirúrgica por busca/substituição de trecho exato
//    (preserva a formatação do documento);
//  - 'insert': texto novo redigido pela IA (só quando não há modelo);
//  - 'insert_block': insere um modelo da base INTEGRALMENTE — o SFDT original
//    do bloco, com texto e formatação intactos — trocando apenas os dados do
//    caso concreto via replacements.
//
// A base de conhecimento é consultada por busca LOCAL (petitionKbSearch):
// só os trechos relevantes vão no prompt (o melhor modelo vai integral), e a
// IA pode pedir uma nova busca quando precisar de um modelo específico.
// Quando falta informação factual, a IA pergunta TUDO de uma vez e o usuário
// responde num formulário único (opções + complemento em texto).

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
} from 'lucide-react';
import {
  aiService,
  type PetitionChatAction,
  type PetitionChatQuestion,
} from '../services/ai.service';
import { PetitionKbSearcher, type KbEntry } from '../services/petitionKbSearch';
import { insertPetitionTextSmart } from '../utils/petitionSmartInsert';
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
    : char.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
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

const PetitionAiChat: React.FC<PetitionAiChatProps> = ({
  editorRef,
  onDocumentChanged,
  kbEntries,
  insertBlockSfdt,
  disabled = false,
  disabledReason,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null);
  const [progressText, setProgressText] = useState('Analisando o documento...');
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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
        if (!ok) {
          return { status: 'failed', error: 'O editor não conseguiu aplicar a substituição.' };
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

  const sendMessage = useCallback(async (rawText?: string) => {
    const text = String(rawText ?? input).trim();
    if (!text || isSending || disabled) return;

    const userMessage: ChatMessage = { id: newId(), role: 'user', content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setIsSending(true);
    setProgressText('Analisando o documento...');

    try {
      const { documentText, selectedText } = captureEditorContext();

      const result = await aiService.petitionAssistantChat({
        history: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        documentText,
        selectedText,
        // Busca local: o melhor modelo vai com texto integral (permite
        // insert_block); os demais vão como trechos curtos.
        searchKb: kbSearcher.size > 0
          ? (query) => kbSearcher.search(query, 5, { fullTopN: 2, fullMaxChars: 9000 })
          : undefined,
        onProgress: (stage, detail) => {
          setProgressText(
            stage === 'searching'
              ? `Consultando modelos do escritório${detail ? ` ("${detail.slice(0, 40)}")` : ''}...`
              : 'Analisando o documento...'
          );
        },
      });

      setMessages((prev) => [...prev, {
        id: newId(),
        role: 'assistant',
        content: result.reply,
        questions: result.questions.length ? result.questions : undefined,
        searches: result.searches.length ? result.searches : undefined,
        actions: result.actions.map((a) => ({ ...a, status: 'pending' as ActionStatus, selected: true })),
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: newId(),
        role: 'assistant',
        content: err instanceof Error ? err.message : 'Erro ao falar com o assistente. Tente novamente.',
        isError: true,
      }]);
    } finally {
      setIsSending(false);
      window.setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [input, isSending, disabled, messages, captureEditorContext, kbSearcher]);

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

  const renderActionBody = (action: ChatActionState) => {
    if (action.type === 'replace') {
      return (
        <div className="mt-2 space-y-1 text-[11.5px] leading-relaxed">
          <div className="rounded-lg bg-red-50 border border-red-100/80 px-2.5 py-1.5 text-red-700/80 line-through decoration-red-300 break-words">
            {String(action.search || '').slice(0, 160)}
          </div>
          <div className="rounded-lg bg-emerald-50 border border-emerald-100/80 px-2.5 py-1.5 text-emerald-800 break-words">
            {String(action.replace || '').slice(0, 160)}
          </div>
        </div>
      );
    }

    if (action.type === 'insert_block') {
      const entry = action.blockId ? kbSearcher.getEntry(action.blockId) : undefined;
      const reps = action.replacements || [];
      return (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="break-words font-medium text-slate-700 text-[12px]">{entry?.title || 'Modelo da base'}</span>
            <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-violet-50 border border-violet-100 text-violet-600 text-[10px] font-semibold">
              formatação integral
            </span>
          </div>
          {reps.length > 0 ? (
            <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-1.5 space-y-1">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Somente estas alterações</div>
              {reps.slice(0, 6).map((rep, i) => (
                <div key={i} className="flex items-baseline gap-1.5 text-[11.5px]">
                  <span className="text-red-600/70 line-through decoration-red-300 break-all">{rep.search.slice(0, 60)}</span>
                  <span className="text-slate-300 shrink-0">→</span>
                  <span className="text-emerald-700 break-words">{rep.replace.slice(0, 80)}</span>
                </div>
              ))}
              {reps.length > 6 && <div className="text-[11px] text-slate-400">+{reps.length - 6} alterações</div>}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400">Sem alterações — modelo inserido como está.</div>
          )}
        </div>
      );
    }

    return (
      <div className="mt-2 rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-slate-600 break-words line-clamp-4 whitespace-pre-wrap">
        {String(action.text || '').slice(0, 320)}
      </div>
    );
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
                  ? 'border-emerald-200 bg-emerald-50/60'
                  : isFailed
                    ? 'border-red-200 bg-red-50/60 cursor-pointer'
                    : action.selected
                      ? 'border-orange-200 bg-gradient-to-br from-orange-50/90 to-amber-50/40 shadow-sm shadow-orange-500/5 cursor-pointer'
                      : 'border-slate-200 bg-white opacity-55 hover:opacity-90 cursor-pointer'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {/* Checkbox de aprovação */}
                {isApplied ? (
                  <span className="shrink-0 mt-0.5 w-5 h-5 rounded-md bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                    <Check className="w-3.5 h-3.5" strokeWidth={3} />
                  </span>
                ) : (
                  <span className={`shrink-0 mt-0.5 transition-colors ${action.selected ? 'text-orange-500' : 'text-slate-300 group-hover/action:text-slate-400'}`}>
                    {action.selected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 w-6 h-6 rounded-lg flex items-center justify-center ${
                      isApplied ? 'bg-emerald-100 text-emerald-600' : action.selected ? 'bg-orange-100 text-orange-500' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {actionTypeIcon(action)}
                    </span>
                    <div className="font-semibold text-slate-700 truncate flex-1">{actionSummary(action)}</div>
                    {isApplied && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 font-semibold text-[10px] uppercase tracking-wide">Aplicado</span>
                    )}
                  </div>
                  {renderActionBody(action)}
                  {isFailed && action.error && (
                    <div className="mt-1.5 flex items-center gap-1 text-red-600 font-medium text-[11.5px]">
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
                className="shrink-0 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[11.5px] font-semibold text-slate-500 hover:border-orange-200 hover:text-orange-600 hover:bg-orange-50/50 transition disabled:opacity-50"
              >
                {allSelected ? 'Desmarcar' : 'Marcar todas'}
              </button>
            )}
            <button
              type="button"
              disabled={selecionadas.length === 0 || isApplying}
              onClick={() => void applySelectedActions(msg.id)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white text-[12px] font-semibold shadow-md shadow-orange-500/25 hover:shadow-lg hover:shadow-orange-500/30 hover:brightness-[1.03] active:scale-[0.98] transition-all disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed"
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
      <div className={`mt-3 rounded-xl border p-3 space-y-3 ${isActive ? 'border-sky-100 bg-gradient-to-br from-sky-50/90 to-white' : 'border-slate-200 bg-slate-50/70'}`}>
        <div className={`flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide ${isActive ? 'text-sky-600' : 'text-slate-400'}`}>
          <span className={`w-5 h-5 rounded-md flex items-center justify-center ${isActive ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-400'}`}>
            <HelpCircle className="w-3 h-3" />
          </span>
          {isActive ? 'Preciso de informações' : 'Perguntas respondidas'}
        </div>

        {msg.questions.map((q, idx) => {
          const selected = draft.selections[idx] || '';
          const hasOptions = Boolean(q.options && q.options.length > 0);
          const isTypedAnswer = Boolean(selected) && !(q.options || []).includes(selected);
          return (
            <div key={idx}>
              <div className={`text-[12.5px] font-medium ${isActive ? 'text-slate-700' : 'text-slate-500'}`}>
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
                            ? 'border-sky-500 bg-sky-500 text-white shadow-sm shadow-sky-500/25'
                            : isActive
                              ? 'border-sky-200 bg-white text-sky-700 hover:border-sky-400 hover:bg-sky-50'
                              : 'border-slate-200 bg-white text-slate-400'
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
                  className="mt-1.5 w-full rounded-lg border border-sky-100 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 placeholder:text-slate-300 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 transition"
                />
              )}
              {!isActive && selected && (
                <div className="mt-1 text-[11.5px] text-slate-500 italic">Resposta: {selected}</div>
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
              className="w-full rounded-lg border border-sky-100 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 placeholder:text-slate-300 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 transition"
            />
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => submitQuestionAnswers(msg)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 text-white text-[12px] font-semibold shadow-md shadow-sky-600/20 hover:bg-sky-700 active:scale-[0.98] transition-all disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              Enviar respostas ({answeredCount}/{msg.questions.length})
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Botão flutuante */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          // bottom-20: deixa livre o canto inferior direito, ocupado pelo widget global "Mensagens" (fixed z-[9999])
          className="absolute bottom-20 right-5 z-[55] group flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-2xl bg-slate-900 text-white shadow-xl shadow-slate-900/25 ring-1 ring-white/10 hover:shadow-2xl hover:shadow-slate-900/30 hover:-translate-y-0.5 active:translate-y-0 transition-all"
          title="Assistente IA da petição"
        >
          <span className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-md shadow-orange-500/40 group-hover:scale-105 transition-transform">
            <Sparkles className="w-4 h-4 text-white" />
          </span>
          <span className="text-[13px] font-semibold hidden sm:flex flex-col items-start leading-tight">
            Assistente IA
            <span className="text-[10px] font-medium text-slate-400">da petição</span>
          </span>
        </button>
      )}

      {/* Painel do chat */}
      {isOpen && (
        <div className="ai-chat-panel absolute bottom-20 right-4 z-[70] w-[min(430px,calc(100%-2rem))] h-[min(640px,calc(100%-6rem))] flex flex-col bg-white rounded-2xl overflow-hidden ring-1 ring-slate-900/10 shadow-[0_24px_64px_-16px_rgba(15,23,42,0.4)]">
          {/* Header */}
          <header className="relative shrink-0 px-4 py-3 bg-slate-900 overflow-hidden">
            {/* Brilhos decorativos */}
            <div className="pointer-events-none absolute -top-12 -right-4 w-40 h-40 rounded-full bg-orange-500/25 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-14 left-16 w-36 h-36 rounded-full bg-amber-400/15 blur-3xl" />

            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/30">
                  <Sparkles className="w-[18px] h-[18px] text-white" />
                </div>
                <div>
                  <div className="text-[13.5px] font-semibold text-white leading-tight">Assistente IA</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400 leading-tight mt-0.5">
                    <span className="relative flex w-1.5 h-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-emerald-400" />
                    </span>
                    {kbSearcher.size > 0 ? `Online · ${kbSearcher.size} modelos na base` : 'Online · pronto para ajudar'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-0.5">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setMessages([]); setQuestionDrafts({}); }}
                    className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition"
                    title="Limpar conversa"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition"
                  title="Fechar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </header>

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto px-3 py-3.5 space-y-3.5 bg-gradient-to-b from-slate-50 to-slate-100/60">
            {messages.length === 0 && (
              <div className="min-h-full flex flex-col items-center justify-center px-1.5 py-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/25">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <div className="mt-3 text-[15px] font-semibold text-slate-800 leading-tight">Como posso ajudar?</div>
                <p className="mt-1 text-[11.5px] text-slate-500 leading-relaxed max-w-[280px]">
                  Reviso, corrijo e crio tópicos com os modelos do escritório. Você aprova cada alteração antes de aplicar.
                </p>

                {/* Sugestões em cards */}
                <div className="mt-4 grid grid-cols-2 gap-2 w-full">
                  {QUICK_PROMPTS.map((qp) => (
                    <button
                      key={qp.label}
                      type="button"
                      disabled={isSending || disabled}
                      onClick={() => handleQuickPrompt(qp.prompt)}
                      className="group flex flex-col rounded-xl border border-slate-200/80 bg-white p-2.5 text-left hover:border-orange-300 hover:shadow-md hover:shadow-orange-500/5 hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                    >
                      <span className="inline-flex w-7 h-7 shrink-0 rounded-lg bg-orange-50 text-orange-500 items-center justify-center group-hover:bg-gradient-to-br group-hover:from-orange-500 group-hover:to-amber-500 group-hover:text-white group-hover:shadow-sm transition-all">
                        {qp.icon}
                      </span>
                      <div className="mt-2 text-[11.5px] font-semibold text-slate-700 leading-tight">{qp.label}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400 leading-snug line-clamp-2">{qp.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              msg.role === 'user' ? (
                <div key={msg.id} className="ai-chat-msg flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-lg bg-slate-900 text-white px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap shadow-sm">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="ai-chat-msg flex items-start gap-2">
                  <div className={`shrink-0 mt-0.5 w-7 h-7 rounded-xl flex items-center justify-center shadow-sm ${
                    msg.isError ? 'bg-red-100' : 'bg-gradient-to-br from-orange-500 to-amber-500 shadow-orange-500/20'
                  }`}>
                    {msg.isError
                      ? <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                      : <Sparkles className="w-3.5 h-3.5 text-white" />}
                  </div>
                  <div className={`max-w-[86%] min-w-0 flex-1 rounded-2xl rounded-tl-md px-4 py-3 text-[13px] leading-relaxed ${
                    msg.isError
                      ? 'bg-red-50 text-red-700 ring-1 ring-red-100'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200/70 shadow-[0_2px_12px_-6px_rgba(15,23,42,0.12)]'
                  }`}>
                    <span className="whitespace-pre-wrap">{msg.content}</span>

                    {/* Fonte: buscas feitas na base de conhecimento */}
                    {msg.searches && msg.searches.length > 0 && (
                      <div className="mt-2.5 inline-flex items-center gap-1.5 max-w-full px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 text-[10.5px] text-slate-400">
                        <BookOpen className="w-3 h-3 shrink-0" />
                        <span className="truncate">Base consultada: {msg.searches.map((s) => `"${s.slice(0, 32)}"`).join(', ')}</span>
                      </div>
                    )}

                    {renderQuestions(msg)}
                    {renderActions(msg)}
                  </div>
                </div>
              )
            ))}

            {isSending && (
              <div className="ai-chat-msg flex items-start gap-2">
                <div className="shrink-0 mt-0.5 w-7 h-7 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-sm shadow-orange-500/20">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="rounded-2xl rounded-tl-md bg-white px-4 py-3 ring-1 ring-slate-200/70 shadow-[0_2px_12px_-6px_rgba(15,23,42,0.12)] inline-flex items-center gap-2.5">
                  <span className="flex items-center gap-1">
                    <span className="ai-typing-dot inline-block w-1.5 h-1.5 rounded-full bg-orange-400" />
                    <span className="ai-typing-dot inline-block w-1.5 h-1.5 rounded-full bg-orange-400" />
                    <span className="ai-typing-dot inline-block w-1.5 h-1.5 rounded-full bg-orange-400" />
                  </span>
                  <span className="text-[12px] text-slate-500">{progressText}</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chips rápidos (só com conversa em andamento; no vazio viram cards) */}
          {messages.length > 0 && (
            <div className="px-3 pt-2 pb-1 flex gap-1.5 overflow-x-auto shrink-0 bg-white border-t border-slate-100 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp.label}
                  type="button"
                  disabled={isSending || disabled}
                  onClick={() => handleQuickPrompt(qp.prompt)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-slate-200 bg-white text-[11.5px] font-medium text-slate-600 hover:border-orange-300 hover:text-orange-600 hover:bg-orange-50 transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {qp.icon}
                  {qp.label}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className={`px-3 pb-2.5 bg-white shrink-0 ${messages.length > 0 ? 'pt-1.5' : 'pt-2.5 border-t border-slate-100'}`}>
            {disabled && (
              <div className="mb-1.5 text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                {disabledReason || 'Assistente indisponível no momento.'}
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1 rounded-2xl bg-slate-100 focus-within:bg-white ring-1 ring-transparent focus-within:ring-orange-300 focus-within:shadow-[0_0_0_4px_rgba(249,115,22,0.08)] transition-all px-3.5 py-2">
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
                  className="w-full bg-transparent resize-none outline-none text-[13px] text-slate-800 placeholder:text-slate-400 py-0.5 disabled:cursor-not-allowed"
                />
              </div>
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!input.trim() || isSending || disabled}
                className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/30 hover:shadow-xl hover:shadow-orange-500/35 hover:brightness-[1.04] active:scale-95 transition-all disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed"
                title="Enviar (Enter)"
              >
                {isSending ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Send className="w-[18px] h-[18px]" />}
              </button>
            </div>
            <div className="mt-1.5 text-center text-[10px] text-slate-300 select-none">
              A IA propõe — você aprova antes de aplicar
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PetitionAiChat;
