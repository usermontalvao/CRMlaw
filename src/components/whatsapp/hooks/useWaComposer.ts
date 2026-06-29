// Domínio "compositor" do módulo WhatsApp: tudo que pertence à barra de envio e
// ao ciclo de vida de uma mensagem que SAI da equipe — rascunho (por conversa),
// resposta/edição, envio otimista de texto/mídia/áudio, gravação, retry/resend,
// auto-assumir ao responder, saudação automática e supressão do aviso de
// ausência. Extraído do WhatsAppModule para concentrar o trecho mais acoplado do
// envio num único lugar, preservando os contratos usados pelo JSX do módulo.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  whatsappService,
  type AgentPrefs,
  type StaffOption,
} from '../../../services/whatsapp.service';
import { agentLabel, buildGreeting, conversationPreviewLabel, greetingByHour, prettyPhone } from '../format';
import { renderTemplate } from '../../../services/whatsapp.service';
import { isReconnectPendingError, enqueueReconnectHold, sendTextResilient } from '../../../services/whatsapp/resilientSend';
import { useToastContext } from '../../../contexts/ToastContext';
import type {
  WhatsAppConversation, WhatsAppMessage, WhatsAppAiSession,
} from '../../../types/whatsapp.types';
import type { WhatsAppModuleConfig } from '../../../services/settings.service';

// Limite operacional alinhado ao teto comum da Evolution/WhatsApp.
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

interface WaComposerArgs {
  selectedId: string | null;
  selected: WhatsAppConversation | null;
  user: { id: string } | null;
  agentPrefs: AgentPrefs;
  moduleConfig: WhatsAppModuleConfig;
  staffById: Map<string, StaffOption>;
  aiSession: WhatsAppAiSession | null;
  messages: WhatsAppMessage[];
  setMessages: React.Dispatch<React.SetStateAction<WhatsAppMessage[]>>;
  setConversations: React.Dispatch<React.SetStateAction<WhatsAppConversation[]>>;
  refreshMessages: (convId: string) => Promise<void>;
}

export interface WaComposerApi {
  // Estado do compositor (consumido pelo JSX do módulo).
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  draftMap: Record<string, string>;
  replyTo: WhatsAppMessage | null;
  setReplyTo: React.Dispatch<React.SetStateAction<WhatsAppMessage | null>>;
  editing: WhatsAppMessage | null;
  setEditing: React.Dispatch<React.SetStateAction<WhatsAppMessage | null>>;
  sending: boolean;
  pending: WhatsAppMessage[];
  setPending: React.Dispatch<React.SetStateAction<WhatsAppMessage[]>>;
  uploadProgress: Map<string, number>;
  recording: boolean;
  recSeconds: number;
  attachStaged: File[] | null;
  setAttachStaged: React.Dispatch<React.SetStateAction<File[] | null>>;
  // Ações.
  handleSend: () => Promise<void>;
  beginEdit: (m: WhatsAppMessage) => void;
  retryPending: (m: WhatsAppMessage) => void;
  discardPending: (m: WhatsAppMessage) => void;
  cancelUpload: (tempId: string) => void;
  resendExisting: (m: WhatsAppMessage) => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: (send: boolean) => void;
  onPickFiles: (e: React.ChangeEvent<HTMLInputElement>, kind: 'media' | 'document') => void;
  handleDroppedFiles: (files: File[]) => void;
  confirmStagedSend: (caption: string, files: File[]) => void;
}

/**
 * Concentra o estado e a lógica do compositor de mensagens da conversa aberta.
 * Mantém o rascunho por conversa (espelhado em `draftMap` para a lista),
 * coordena os envios otimistas e os fluxos automáticos (assumir/saudar/suprimir
 * ausência) e expõe à camada de UI exatamente os contratos que o JSX já usava.
 */
export function useWaComposer({
  selectedId, selected, user, agentPrefs, moduleConfig, staffById, aiSession,
  messages, setMessages, setConversations, refreshMessages,
}: WaComposerArgs): WaComposerApi {
  const toast = useToastContext();

  // Detecção e retenção por reconexão vivem agora no módulo compartilhado
  // resilientSend (mesmo contrato usado por modais e ações operacionais). Aqui só
  // adicionamos o feedback visual ao reter, preservando o comportamento anterior.
  const isAutoQueueError = isReconnectPendingError;

  const enqueueAutoRetry = useCallback(async (input: {
    text?: string;
    type?: 'text' | 'image' | 'audio' | 'video' | 'document';
    storagePath?: string;
    mimeType?: string;
    fileName?: string;
  }) => {
    if (!selected) return false;
    await enqueueReconnectHold({
      conversationId: selected.id,
      channelId: selected.instance_id,
      text: input.text,
      type: input.type || 'text',
      storagePath: input.storagePath,
      mimeType: input.mimeType,
      fileName: input.fileName,
    });
    toast.success('Mensagem na fila', 'Ela será enviada automaticamente quando o canal reconectar.');
    return true;
  }, [selected, toast]);

  const [pending, setPending] = useState<WhatsAppMessage[]>([]);
  // Descritores para "tentar de novo": guardam o necessário para reenviar uma
  // mensagem que falhou (texto, ou mídia com o File original). Limpos no sucesso.
  const retryRef = useRef<Map<string, { kind: 'text'; text: string; replyId?: string }
    | { kind: 'media'; file: File; mediaKind: 'image' | 'video' | 'audio' | 'document'; caption: string; replyId?: string }>>(new Map());
  // Mapa de progresso de upload (0-100) por tempId; alimentado por timer simulado.
  const [uploadProgress, setUploadProgress] = useState<Map<string, number>>(new Map());
  const cancelledUploads = useRef<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Anexos selecionados aguardando preview/legenda antes do envio (Fase 0.1+).
  const [attachStaged, setAttachStaged] = useState<File[] | null>(null);
  const [replyTo, setReplyTo] = useState<WhatsAppMessage | null>(null);
  const [editing, setEditing] = useState<WhatsAppMessage | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);

  // Rascunho POR CONVERSA: o texto digitado pertence à conversa, não ao módulo.
  // Sem isto, ao trocar de conversa o rascunho permanece e pode ser enviado para
  // a pessoa errada. Ao alternar, guardamos o rascunho da conversa que sai e
  // restauramos o da que entra (ou vazio), zerando edição/resposta em andamento.
  const draftsRef = useRef<Record<string, string>>({});
  const prevSelIdRef = useRef<string | null>(null);
  const draftValRef = useRef('');
  draftValRef.current = draft; // sempre o valor atual, sem depender de closure
  // Espelho reativo dos rascunhos para exibir "Rascunho:" na lista. Só muda na
  // troca de conversa (não a cada tecla), então as linhas não-ativas não
  // re-renderizam à toa; a linha ativa usa o `draft` ao vivo.
  const [draftMap, setDraftMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const prev = prevSelIdRef.current;
    if (prev === selectedId) return;
    if (prev !== null) {
      const v = draftValRef.current;
      draftsRef.current[prev] = v;
      setDraftMap(m => (m[prev] === v ? m : { ...m, [prev]: v }));
      void whatsappService.saveDraft(prev, v).catch(() => {}); // persiste o que saiu
    }
    setDraft(selectedId ? (draftsRef.current[selectedId] ?? '') : '');
    setEditing(null);
    setReplyTo(null);
    prevSelIdRef.current = selectedId;
  }, [selectedId]);

  // Carrega os rascunhos persistidos (Supabase) uma vez. Se já houver conversa
  // aberta com editor vazio, hidrata-a (caso os dados cheguem após a seleção).
  useEffect(() => {
    let cancelled = false;
    whatsappService.listDrafts().then(map => {
      if (cancelled) return;
      draftsRef.current = { ...map, ...draftsRef.current };
      setDraftMap(prev => ({ ...map, ...prev }));
      const sel = prevSelIdRef.current;
      if (sel && map[sel] && !draftValRef.current) setDraft(map[sel]);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Persiste o rascunho da conversa ABERTA com debounce (cobre recarregar a
  // página sem trocar de conversa, e o esvaziamento após enviar → apaga a linha).
  useEffect(() => {
    if (!selectedId) return;
    const id = selectedId;
    const t = window.setTimeout(() => {
      draftsRef.current[id] = draft;
      setDraftMap(m => (m[id] === draft ? m : { ...m, [id]: draft }));
      void whatsappService.saveDraft(id, draft).catch(() => {});
    }, 600);
    return () => window.clearTimeout(t);
  }, [draft, selectedId]);

  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);

  // Reset do compositor ao trocar de conversa: limpa fila otimista, resposta/
  // edição e o progresso de upload (o reset de paginação/mensagens fica no módulo).
  useEffect(() => {
    setPending([]); setReplyTo(null); setEditing(null);
    setUploadProgress(new Map()); cancelledUploads.current.clear();
  }, [selectedId]);

  // Concilia a fila otimista contra as mensagens já persistidas: remove o
  // pending cujo eco voltou do servidor (por id de linha ou id da Evolution).
  useEffect(() => {
    if (messages.length === 0) return;
    setPending(prev => {
      const persistedRowIds = new Set(messages.map(m => m.id));
      const persistedEvolutionIds = new Set(messages.map(m => m.evolution_message_id).filter((id): id is string => !!id));
      const next = prev.filter(p =>
        !(p._serverId && persistedRowIds.has(p._serverId))
        && !(p.evolution_message_id && persistedEvolutionIds.has(p.evolution_message_id)),
      );
      return next.length === prev.length ? prev : next;
    });
  }, [messages]);

  // ── Envio otimista de texto / edição ──
  const bumpConversationPreview = useCallback((conversationId: string, preview: string, at: string) => {
    setConversations(prev => {
      const idx = prev.findIndex(c => c.id === conversationId);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        last_message_at: at,
        last_message_direction: 'out',
        last_message_preview: preview,
      };
      next.sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''));
      return next;
    });
  }, [setConversations]);

  const bindPendingToServerMessage = useCallback((tempId: string, messageId: string, evolutionMessageId: string | null) => {
    setPending(prev => prev.map(p => (
      p._tempId === tempId
        ? {
            ...p,
            _serverId: messageId,
            evolution_message_id: evolutionMessageId,
            _local: p._local === 'uploading' ? 'sending' : p._local,
          }
        : p
    )));
  }, []);

  // Id temporário ÚNICO para a mensagem otimista. Sempre com sufixo aleatório:
  // dois envios no mesmo milissegundo (saudação + mensagem, áudios rápidos) não
  // podem colidir, ou a reconciliação otimista→servidor casaria o item errado.
  const newTempId = () => `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Fábrica única da mensagem otimista (mensagem que SAI, ainda não confirmada
  // pelo servidor). Centraliza os ~20 campos default num só lugar — antes cada
  // fluxo de envio reconstruía o objeto à mão, e um campo novo no tipo silenciava
  // a divergência entre as cópias. Cada chamador só informa o que varia.
  const buildOptimistic = (
    conversationId: string,
    tempId: string,
    sentAt: string,
    over: Partial<WhatsAppMessage> & Pick<WhatsAppMessage, 'type' | '_local'>,
  ): WhatsAppMessage => ({
    id: tempId, conversation_id: conversationId, evolution_message_id: null,
    direction: 'out', content: null, media_url: null, media_mime: null,
    storage_path: null, media_size: null, media_sha256: null, file_name: null,
    transcription_text: null, transcription_status: null,
    reply_to_id: null, edited_at: null,
    status: 'sent', sender_user_id: user?.id ?? null,
    wa_timestamp: sentAt, created_at: sentAt,
    _tempId: tempId,
    ...over,
  });

  // Marca um item otimista como falho na fila (estado consumido pela bolha para
  // exibir "tentar de novo"/"descartar"). Mesma transição em todos os fluxos.
  const markPendingFailed = useCallback((tempId: string) => {
    setPending(prev => prev.map(p => p._tempId === tempId ? { ...p, _local: 'failed', status: 'failed' } : p));
  }, []);

  // Trava SÍNCRONA contra reenvio. O estado `sending` atualiza de forma assíncrona,
  // então dois disparos quase simultâneos (dois Enter, key-repeat, ou Enter + clique)
  // passavam ambos pela checagem antes do setSending(true) e rodavam handleSend duas
  // vezes — enviando a saudação automática E a mensagem em duplicidade. O ref barra na hora.
  const sendingRef = useRef(false);

  const handleSend = async () => {
    const rawText = draft.trim();
    if (!rawText || !selected || sending || sendingRef.current) return;
    sendingRef.current = true;

    if (editing) {
      const target = editing;
      setSending(true);
      try {
        await whatsappService.editMessage(target.id, rawText);
        setMessages(prev => prev.map(m => m.id === target.id ? { ...m, content: rawText, edited_at: new Date().toISOString() } : m));
        setEditing(null); setDraft('');
        void refreshMessages(selected.id);
      } catch (err: any) {
        toast.error('Falha ao editar', err.message);
      } finally { setSending(false); sendingRef.current = false; }
      return;
    }

    // Auto-assumir: responder uma conversa SEM dono (na fila) assume o atendimento
    // automaticamente para você — antes mesmo da 1ª mensagem sair. Conversa já minha
    // ou de outro atendente não é tocada (takeover explícito continua no botão Assumir).
    let justAssumed = false;
    if (!selected.assigned_user_id && !selected.is_blocked && user?.id) {
      try {
        await whatsappService.assumeConversation(selected.id);
        // Fase J: aborta sessão de IA quando o humano assume.
        if (aiSession?.status === 'active') await whatsappService.abortAiSession(selected.id).catch(() => {});
        setConversations(prev => prev.map(c => c.id === selected.id
          ? { ...c, assigned_user_id: user.id, awaiting_accept: false, transfer_pending_since: null } : c));
        justAssumed = true;
      } catch (e: any) {
        toast.error('Falha ao assumir', e.message);
        sendingRef.current = false;
        return;
      }
    }

    // Ao responder, pausa o aviso de horário (ausência) nesta conversa: o atendente
    // está atendendo, então o cliente não deve mais receber o auto-aviso "fora do
    // horário". Reativado automaticamente quando o atendimento é encerrado.
    if (selected.absence_suppressed === false) {
      whatsappService.setAbsenceSuppressed(selected.id, true).catch(() => {});
      setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, absence_suppressed: true } : c));
    }

    // Saudação inicial automática (Fase 1): apresenta o responsável ao cliente ANTES
    // da 1ª mensagem — no primeiro atendimento humano (sem nenhum envio ainda) OU ao
    // assumir agora uma conversa que estava na fila (ex.: reaberta pelo cliente).
    const hasOutbound = messages.some(m => m.direction === 'out') || pending.some(p => p.direction === 'out');
    const me = user ? staffById.get(user.id) : null;
    if ((justAssumed || !hasOutbound) && agentPrefs.auto_greeting && me) {
      try {
        const greeting = renderTemplate(moduleConfig.auto_greeting_template, {
          clientName: selected.contact_name ?? null,
          clientPhone: prettyPhone(selected.contact_phone),
          agentName: agentPrefs.short_name || me.name,
          greeting: greetingByHour(),
        }) || buildGreeting({ ...me, name: agentPrefs.short_name || me.name }, agentPrefs.role_label);
        // Resiliente: se o canal estiver fora, a saudação é retida (reenvio
        // automático) em vez de se perder antes da mensagem principal.
        await sendTextResilient({ conversationId: selected.id, channelId: selected.instance_id, text: greeting });
        await refreshMessages(selected.id);
      } catch { /* saudação é best-effort; não impede a mensagem principal */ }
    }

    // Prefixo de identificação do agente: *Dr. Pedro:*\n antes do texto.
    // Usa agentLabel para incluir Dr./Dra. em advogados automaticamente.
    // Só em envios manuais pelo compositor — saudações e mensagens automáticas ficam sem prefixo.
    const agentDisplayName = agentLabel(me, agentPrefs.short_name);
    const text = agentDisplayName ? `*${agentDisplayName}:*\n${rawText}` : rawText;

    const sentAt = new Date().toISOString();
    const tempId = newTempId();
    const replyId = replyTo?.id;
    const optimistic = buildOptimistic(selected.id, tempId, sentAt, {
      type: 'text', content: text, reply_to_id: replyId ?? null, _local: 'sending',
    });
    retryRef.current.set(tempId, { kind: 'text', text, replyId });
    setPending(prev => [...prev, optimistic]);
    bumpConversationPreview(selected.id, rawText, sentAt);
    setDraft(''); setReplyTo(null); setSending(true);
    try {
      const { message_id, evolution_message_id } = await whatsappService.sendText({ conversationId: selected.id, text, replyToId: replyId });
      bindPendingToServerMessage(tempId, message_id, evolution_message_id);
      retryRef.current.delete(tempId);
      void refreshMessages(selected.id);
    } catch (err: any) {
      if (isAutoQueueError(err)) {
        try {
          await enqueueAutoRetry({ text, type: 'text' });
          retryRef.current.delete(tempId);
          setPending(prev => prev.filter(p => p._tempId !== tempId));
          return;
        } catch {/* cai no fluxo normal de falha */}
      }
      markPendingFailed(tempId);
      toast.error('Mensagem não enviada', err?.message || 'Falha ao enviar pelo WhatsApp.');
    } finally { setSending(false); sendingRef.current = false; }
  };

  // ── Envio de mídia (imagem/vídeo/áudio/documento) ──
  const sendFile = async (file: File, kind: 'image' | 'video' | 'audio' | 'document', captionOverride?: string) => {
    if (!selected) return;
    const caption = captionOverride !== undefined ? captionOverride.trim() : draft.trim();
    const sentAt = new Date().toISOString();
    const tempId = newTempId();
    let uploaded: Awaited<ReturnType<typeof whatsappService.uploadMedia>> | null = null;
    const previewUrl = kind !== 'document' ? URL.createObjectURL(file) : null;
    const replyId = replyTo?.id;
    const optimistic = buildOptimistic(selected.id, tempId, sentAt, {
      type: kind, content: caption || null,
      media_url: previewUrl, media_mime: file.type, media_size: file.size, file_name: file.name,
      reply_to_id: replyId ?? null, _local: 'uploading',
    });
    retryRef.current.set(tempId, { kind: 'media', file, mediaKind: kind, caption, replyId });
    setPending(prev => [...prev, optimistic]);
    bumpConversationPreview(selected.id, conversationPreviewLabel(kind, caption, file.name), sentAt);
    setDraft(''); setReplyTo(null);

    // Timer que simula progresso de 0 → 85% durante o upload (UX padrão — sem XHR nativo).
    let pct = 0;
    setUploadProgress(prev => { const m = new Map(prev); m.set(tempId, 0); return m; });
    const progressTimer = setInterval(() => {
      pct = Math.min(pct + Math.random() * 18 + 4, 85);
      setUploadProgress(prev => { const m = new Map(prev); m.set(tempId, Math.round(pct)); return m; });
    }, 350);

    const clearProgress = () => {
      clearInterval(progressTimer);
      setUploadProgress(prev => { const m = new Map(prev); m.delete(tempId); return m; });
    };

    try {
      const up = await whatsappService.uploadMedia(file, { conversationId: selected.id });
      uploaded = up;
      clearProgress();
      // Upload concluído mas usuário cancelou enquanto aguardava — descarta silenciosamente.
      if (cancelledUploads.current.has(tempId)) {
        cancelledUploads.current.delete(tempId);
        setPending(prev => prev.filter(p => p._tempId !== tempId));
        return;
      }
      setPending(prev => prev.map(p => p._tempId === tempId ? { ...p, _local: 'sending' } : p));
      const { message_id, evolution_message_id } = await whatsappService.sendMedia({
        conversationId: selected.id, type: kind, text: caption || undefined,
        storagePath: up.storagePath, mimeType: up.mimeType, fileName: up.fileName, replyToId: replyId,
      });
      bindPendingToServerMessage(tempId, message_id, evolution_message_id);
      retryRef.current.delete(tempId);
      void refreshMessages(selected.id);
    } catch (err: any) {
      clearProgress();
      if (cancelledUploads.current.has(tempId)) {
        cancelledUploads.current.delete(tempId);
        setPending(prev => prev.filter(p => p._tempId !== tempId));
        return;
      }
      const queued = isAutoQueueError(err) && retryRef.current.has(tempId);
      if (queued) {
        try {
          await enqueueAutoRetry({
            text: caption || undefined,
            type: kind,
            storagePath: uploaded?.storagePath,
            mimeType: uploaded?.mimeType || file.type || 'application/octet-stream',
            fileName: uploaded?.fileName || file.name,
          });
          retryRef.current.delete(tempId);
          setPending(prev => prev.filter(p => p._tempId !== tempId));
          return;
        } catch {/* cai no fluxo normal */}
      }
      markPendingFailed(tempId);
      toast.error('Arquivo não enviado', err?.message || 'Falha ao enviar o anexo pelo WhatsApp.');
    } finally {
      if (previewUrl) setTimeout(() => URL.revokeObjectURL(previewUrl), 30_000);
    }
  };

  // Reenvia uma mensagem que falhou (texto ou mídia), reusando o que foi guardado.
  const retryPending = (m: WhatsAppMessage) => {
    const tempId = m._tempId;
    if (!tempId) return;
    const desc = retryRef.current.get(tempId);
    if (!desc) return;
    retryRef.current.delete(tempId);
    setPending(prev => prev.filter(p => p._tempId !== tempId)); // remove o item falho
    if (desc.kind === 'text') void resendText(desc.text, desc.replyId);
    else void sendFile(desc.file, desc.mediaKind, desc.caption);
  };

  // Descarta uma mensagem falha da fila (não foi entregue ao cliente).
  const discardPending = (m: WhatsAppMessage) => {
    if (!m._tempId) return;
    retryRef.current.delete(m._tempId);
    setPending(prev => prev.filter(p => p._tempId !== m._tempId));
  };

  // Cancela um upload em andamento: marca o tempId para descarte quando o fetch concluir.
  const cancelUpload = (tempId: string) => {
    cancelledUploads.current.add(tempId);
    retryRef.current.delete(tempId);
    // Remove da fila imediatamente (otimista); se o upload já completou, sendFile
    // descarta o resultado ao checar cancelledUploads.
    setPending(prev => prev.filter(p => p._tempId !== tempId));
    setUploadProgress(prev => { const m = new Map(prev); m.delete(tempId); return m; });
  };

  // Reenvio de texto sem a lógica de saudação/edição do composer (usado no retry).
  const resendText = async (text: string, replyId?: string) => {
    if (!selected) return;
    const sentAt = new Date().toISOString();
    const tempId = newTempId();
    const optimistic = buildOptimistic(selected.id, tempId, sentAt, {
      type: 'text', content: text, reply_to_id: replyId ?? null, _local: 'sending',
    });
    retryRef.current.set(tempId, { kind: 'text', text, replyId });
    setPending(prev => [...prev, optimistic]);
    bumpConversationPreview(selected.id, text, sentAt);
    try {
      const { message_id, evolution_message_id } = await whatsappService.sendText({ conversationId: selected.id, text, replyToId: replyId });
      bindPendingToServerMessage(tempId, message_id, evolution_message_id);
      retryRef.current.delete(tempId);
      void refreshMessages(selected.id);
    } catch (err: any) {
      if (isAutoQueueError(err)) {
        try {
          await enqueueAutoRetry({ text, type: 'text' });
          retryRef.current.delete(tempId);
          setPending(prev => prev.filter(p => p._tempId !== tempId));
          return;
        } catch {/* cai no fluxo normal */}
      }
      markPendingFailed(tempId);
      toast.error('Mensagem não enviada', err?.message || 'Falha ao reenviar pelo WhatsApp.');
    }
  };

  // Reenvio rápido de um arquivo já enviado: reaproveita o objeto no storage
  // (sem novo upload) e dispara de novo pela conversa atual.
  const resendExisting = async (m: WhatsAppMessage) => {
    if (!selected || !m.storage_path || m.type === 'text') return;
    const sentAt = new Date().toISOString();
    const tempId = newTempId();
    const kind = (m.type === 'sticker' ? 'image' : m.type) as 'image' | 'video' | 'audio' | 'document';
    const optimistic: WhatsAppMessage = {
      ...m, id: tempId, evolution_message_id: null, reply_to_id: null,
      status: 'sent', wa_timestamp: sentAt, created_at: sentAt, _local: 'sending', _tempId: tempId,
    };
    setPending(prev => [...prev, optimistic]);
    bumpConversationPreview(selected.id, conversationPreviewLabel(kind, m.content || '', m.file_name || ''), sentAt);
    try {
      const { message_id, evolution_message_id } = await whatsappService.sendMedia({
        conversationId: selected.id, type: kind, text: m.content || undefined,
        storagePath: m.storage_path, mimeType: m.media_mime || 'application/octet-stream', fileName: m.file_name || undefined,
      });
      bindPendingToServerMessage(tempId, message_id, evolution_message_id);
      void refreshMessages(selected.id);
    } catch (err: any) {
      if (isAutoQueueError(err)) {
        try {
          await enqueueAutoRetry({
            text: m.content || undefined,
            type: kind,
            storagePath: m.storage_path,
            mimeType: m.media_mime || 'application/octet-stream',
            fileName: m.file_name || undefined,
          });
          setPending(prev => prev.filter(p => p._tempId !== tempId));
          return;
        } catch {/* cai no fluxo normal */}
      }
      markPendingFailed(tempId);
      toast.error('Arquivo não enviado', err?.message || 'Falha ao reenviar o anexo pelo WhatsApp.');
    }
  };

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>, _kind: 'media' | 'document') => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    stageAttachments(files);
  };

  // Encaminha os arquivos para o preview com legenda (em vez de enviar na hora).
  // Valida tamanho/vazio aqui para não levar arquivo inválido ao preview.
  const stageAttachments = (files: File[]) => {
    if (!selected || files.length === 0) return;
    const tooBig = files.filter(f => f.size > MAX_FILE_BYTES);
    const empty = files.filter(f => f.size === 0);
    const ok = files.filter(f => f.size > 0 && f.size <= MAX_FILE_BYTES);
    if (tooBig.length || empty.length) {
      const names = [...tooBig, ...empty].map(f => f.name || 'arquivo').join(', ');
      toast.warning(tooBig.length ? 'Arquivo acima de 100 MB' : 'Arquivo vazio ou inválido', names);
    }
    if (ok.length) setAttachStaged(ok);
  };

  // Confirma o envio dos anexos do preview: a legenda vai com o 1º arquivo
  // (padrão WhatsApp para álbum); os demais seguem sem legenda.
  const confirmStagedSend = (caption: string, files: File[]) => {
    setAttachStaged(null);
    files.forEach((f, i) => sendFile(f, kindForFile(f), i === 0 ? caption : ''));
  };

  // Classifica o arquivo solto pelo MIME; sem tipo claro, segue como documento.
  const kindForFile = (file: File): 'image' | 'video' | 'audio' | 'document' => {
    const t = (file.type || '').toLowerCase();
    if (t.startsWith('image/')) return 'image';
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('audio/')) return 'audio';
    return 'document';
  };

  // Arquivos soltos vão para o mesmo preview com legenda (múltiplos suportados).
  const handleDroppedFiles = (files: File[]) => stageAttachments(files);

  // ── Gravação de áudio ──
  const startRecording = async () => {
    if (!selected || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recChunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
        const blob = new Blob(recChunksRef.current, { type: rec.mimeType || 'audio/webm' });
        // Blob minúsculo = só o cabeçalho do container, sem áudio real (captura
        // falhou). Avisa em vez de enviar um áudio mudo.
        if (blob.size < 1024) { toast.error('Gravação vazia', 'Nenhum áudio foi capturado. Tente novamente.'); return; }
        void sendAudioBlob(blob);
      };
      mediaRecRef.current = rec;
      // timeslice: emite chunks a cada 250ms. Sem isso, o flush único no stop()
      // às vezes entrega blob vazio/minúsculo no Chromium (áudio "não capturado").
      rec.start(250);
      setRecording(true); setRecSeconds(0);
      recTimerRef.current = window.setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch {
      toast.error('Não foi possível acessar o microfone');
    }
  };

  const stopRecording = (send: boolean) => {
    const rec = mediaRecRef.current;
    if (!rec) return;
    if (!send) { recChunksRef.current = []; }
    setRecording(false);
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    if (rec.state !== 'inactive') rec.stop();
    mediaRecRef.current = null;
  };

  const sendAudioBlob = async (blob: Blob) => {
    if (!selected) return;
    const sentAt = new Date().toISOString();
    const tempId = newTempId();
    let uploaded: Awaited<ReturnType<typeof whatsappService.uploadMedia>> | null = null;
    const previewUrl = URL.createObjectURL(blob);
    const replyId = replyTo?.id;
    const optimistic = buildOptimistic(selected.id, tempId, sentAt, {
      type: 'audio',
      media_url: previewUrl, media_mime: blob.type, media_size: blob.size, file_name: 'audio.webm',
      reply_to_id: replyId ?? null, _local: 'uploading',
    });
    setPending(prev => [...prev, optimistic]); setReplyTo(null);
    bumpConversationPreview(selected.id, conversationPreviewLabel('audio'), sentAt);
    try {
      const up = await whatsappService.uploadMedia(blob, { conversationId: selected.id, fileName: 'audio.webm' });
      uploaded = up;
      setPending(prev => prev.map(p => p._tempId === tempId ? { ...p, _local: 'sending' } : p));
      const { message_id, evolution_message_id } = await whatsappService.sendAudio({
        conversationId: selected.id, storagePath: up.storagePath, mimeType: up.mimeType,
        fileName: up.fileName, replyToId: replyId,
      });
      bindPendingToServerMessage(tempId, message_id, evolution_message_id);
      void refreshMessages(selected.id);
    } catch (err: any) {
      if (isAutoQueueError(err)) {
        try {
          await enqueueAutoRetry({
            type: 'audio',
            storagePath: uploaded?.storagePath,
            mimeType: uploaded?.mimeType || blob.type || 'audio/webm',
            fileName: uploaded?.fileName || 'audio.webm',
          });
          setPending(prev => prev.filter(p => p._tempId !== tempId));
          return;
        } catch {/* cai no fluxo normal */}
      }
      markPendingFailed(tempId);
      toast.error('Falha ao enviar áudio', err.message);
    } finally {
      setTimeout(() => URL.revokeObjectURL(previewUrl), 60_000);
    }
  };

  const beginEdit = (m: WhatsAppMessage) => {
    setEditing(m); setReplyTo(null); setDraft(m.content || '');
  };

  return {
    draft, setDraft, draftMap,
    replyTo, setReplyTo,
    editing, setEditing,
    sending,
    pending, setPending,
    uploadProgress,
    recording, recSeconds,
    attachStaged, setAttachStaged,
    handleSend, beginEdit,
    retryPending, discardPending, cancelUpload, resendExisting,
    startRecording, stopRecording,
    onPickFiles, handleDroppedFiles, confirmStagedSend,
  };
}
