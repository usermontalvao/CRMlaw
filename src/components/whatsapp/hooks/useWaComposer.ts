// Domínio "compositor" do módulo WhatsApp: tudo que pertence à barra de envio e
// ao ciclo de vida de uma mensagem que SAI da equipe — rascunho (por conversa),
// resposta/edição, envio otimista de texto/mídia/áudio, gravação, retry/resend,
// auto-assumir ao responder e supressão do aviso de ausência. Extraído do
// WhatsAppModule para concentrar o trecho mais acoplado do envio num único
// lugar, preservando os contratos usados pelo JSX do módulo.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  whatsappService,
  type AgentPrefs,
  type StaffOption,
} from '../../../services/whatsapp.service';
import { agentLabel, conversationPreviewLabel } from '../format';
import { createSendQueue, type SendQueue } from '../sendQueue';
import { isReconnectPendingError, enqueueReconnectHold } from '../../../services/whatsapp/resilientSend';
import { playWaActionSound } from '../../../utils/waActionSounds';
import { openPreferredMicrophone } from '../../../utils/audioDevices';
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
  /** Volume do microfone agora (0–1) — as barras da gravação leem daqui. */
  recLevel: number;
  attachStaged: File[] | null;
  setAttachStaged: React.Dispatch<React.SetStateAction<File[] | null>>;
  /** Texto que estava no compositor quando o anexo foi escolhido — vira legenda. */
  stagedCaption: string;
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
  /** Desiste do anexo: a legenda escrita volta a ser o texto do compositor. */
  cancelStagedSend: (caption: string) => void;
  sendGif: (file: File) => Promise<void>;
}

/**
 * Concentra o estado e a lógica do compositor de mensagens da conversa aberta.
 * Mantém o rascunho por conversa (espelhado em `draftMap` para a lista),
 * coordena os envios otimistas e os fluxos automáticos (assumir/suprimir
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
    // Não é sucesso: o cliente ainda NÃO recebeu. A sirene global, alimentada
    // pela linha persistida acima, continua na tela até o envio se resolver.
    toast.warning(
      'Mensagem não enviada',
      'O canal está indisponível. A mensagem ficou retida; troque de canal ou aguarde a reconexão.',
    );
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
  // Texto que já estava escrito quando o anexo foi escolhido. Ele NÃO se perde:
  // entra no preview como legenda e, se o anexo for descartado, volta ao
  // compositor como texto (ver stageAttachments / cancelStagedSend).
  const [stagedCaption, setStagedCaption] = useState('');
  const [replyTo, setReplyTo] = useState<WhatsAppMessage | null>(null);
  const [editing, setEditing] = useState<WhatsAppMessage | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  /**
   * Volume do microfone AGORA, de 0 a 1 — o que faz as barras da gravação
   * subirem e descerem com a voz.
   *
   * Antes o equalizador era uma animação de CSS em laço: as barras dançavam
   * igual com o microfone mudo, com a mão em cima dele ou com a permissão
   * negada. Bonito e mentiroso — o único elemento da tela que poderia responder
   * "o microfone está te ouvindo?" respondia "sim" sempre, inclusive quando a
   * resposta era não. Agora é medição real: silêncio deixa as barras deitadas.
   */
  const [recLevel, setRecLevel] = useState(0);

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
    // `prev` e não `prev !== null`: id vazio não é conversa. Vinha um "" da
    // seleção guardada no localStorage, e ele passava pela checagem de null —
    // o rascunho ia para `conversation_id=eq.`, que o Postgres não converte
    // para uuid. O 400 caía no catch abaixo e ninguém via.
    if (prev) {
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
  // Marca o descarte da gravação em curso.
  //
  // Existe porque `stop()` NÃO para no ato: ele ainda dispara um último
  // `ondataavailable` com o que estava no buffer, e só depois o `onstop`. Zerar
  // a lista de pedaços na hora do clique — que era o que se fazia — não adiantava
  // nada: o pedaço final chegava logo em seguida, entrava na lista recém-limpa, e
  // o `onstop` montava um blob com ele. Resultado: a lixeira enviava um áudio
  // curto em vez de descartar. Uma flag lida nos DOIS retornos é o que fecha a
  // janela entre o clique e o fim real da gravação.
  const recCancelledRef = useRef(false);
  // Medição de volume: contexto próprio + laço de animação, desmontados no fim
  // da gravação. Ficam em refs porque o `onstop` do MediaRecorder precisa
  // alcançá-los, e ele não vê o estado do React.
  const recAudioCtxRef = useRef<AudioContext | null>(null);
  const recRafRef = useRef<number | null>(null);

  // Reset do compositor ao trocar de conversa. Resposta e edição são do momento
  // e morrem aqui; a fila otimista, NÃO — ela é a mensagem em si.
  //
  // Antes a fila era esvaziada na troca, e isso apagava mensagem em voo: quem
  // enviava e já pulava para o próximo contato (o ritmo normal de quem atende
  // uma fila) perdia a bolha de vista. Se o envio falhasse enquanto se estava em
  // outra conversa, só sobrava um toast — o item falho, com o botão de tentar de
  // novo, tinha sido descartado junto. A mensagem simplesmente não ia, e nada na
  // tela dizia isso depois que o toast sumia. O progresso de upload e o registro
  // de uploads cancelados seguem a mesma lógica: pertencem ao envio, não à tela.
  // Quem separa uma conversa da outra na hora de desenhar é `conversation_id`
  // (ver useWaThread) — a fila é do compositor, mas cada item sabe de quem é.
  useEffect(() => {
    setReplyTo(null); setEditing(null);
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

  /**
   * Fecha o ciclo de um envio bem-sucedido: liga a bolha otimista à mensagem do
   * servidor e, quando o envio reabriu uma conversa encerrada, corrige a tela na
   * hora — sem esperar o realtime. O servidor é quem decide a reabertura (só vale
   * para envio humano); aqui apenas espelhamos o que ele já gravou.
   */
  const settleSend = useCallback((
    conversationId: string,
    tempId: string,
    result: { message_id: string; evolution_message_id: string | null; reopened: boolean },
  ) => {
    bindPendingToServerMessage(tempId, result.message_id, result.evolution_message_id);
    if (!result.reopened) return;
    const at = new Date().toISOString();
    setConversations(prev => prev.map(c => (c.id === conversationId
      ? {
          ...c,
          status: 'open',
          reopened_at: at,
          awaiting_accept: false,
          transfer_pending_since: null,
          // Mesma regra do servidor: quem escreveu assume só se não havia dono.
          assigned_user_id: c.assigned_user_id ?? user?.id ?? null,
        }
      : c)));
  }, [bindPendingToServerMessage, setConversations, user?.id]);

  // Id temporário ÚNICO para a mensagem otimista. Sempre com sufixo aleatório:
  // dois envios no mesmo milissegundo (áudios rápidos, mensagens em sequência)
  // não podem colidir, ou a reconciliação otimista→servidor casaria o item errado.
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

  // Marcas válidas só enquanto a rajada de envios dura: o que a PRIMEIRA
  // mensagem já resolveu (assumir o atendimento, pausar o aviso de ausência) as
  // seguintes não precisam refazer. Cada envio enfileirado carrega um retrato da
  // conversa tirado no momento do gesto, e esse retrato não enxerga o que a
  // mensagem anterior mudou — sem estas marcas, três linhas seguidas numa
  // conversa sem dono virariam três chamadas de "assumir".
  const burstFlagsRef = useRef<Set<string>>(new Set());

  // Fila de saída: as mensagens saem na ordem em que foram disparadas, mas o
  // compositor não espera nenhuma delas para aceitar a próxima.
  const sendQueueRef = useRef<SendQueue | null>(null);
  if (!sendQueueRef.current) sendQueueRef.current = createSendQueue(() => burstFlagsRef.current.clear());
  const sendQueue = sendQueueRef.current;

  // Trava SÍNCRONA contra reenvio, usada na EDIÇÃO (que continua sendo uma de
  // cada vez). O estado `sending` atualiza de forma assíncrona, então dois
  // disparos quase simultâneos (dois Enter, key-repeat, ou Enter + clique)
  // passavam ambos pela checagem antes do setSending(true). No envio normal quem
  // barra o disparo repetido é o esvaziamento síncrono de `draftValRef`.
  const sendingRef = useRef(false);

  const handleSend = async () => {
    // O texto sai do REF, não do estado: dois disparos no mesmo tick (Enter com
    // key-repeat, Enter + clique) leriam o mesmo `draft`, porque o setDraft('')
    // do primeiro ainda não teria repintado — e a mensagem iria duas vezes.
    // Esvaziar o ref na hora é o que fecha essa janela agora que a fila
    // substituiu a trava única de envio.
    const rawText = draftValRef.current.trim();
    if (!rawText || !selected) return;

    if (editing) {
      // Edição continua uma de cada vez: ela reescreve uma mensagem que já está
      // na tela, e enfileirar duas versões do mesmo texto não faria sentido.
      if (sending || sendingRef.current) return;
      sendingRef.current = true;
      draftValRef.current = '';
      const target = editing;
      const convId = selected.id;
      // Mesma regra do envio: a bolha já mostra o texto novo e o compositor
      // fecha na hora; se a edição falhar no servidor, a bolha volta ao que era.
      setMessages(prev => prev.map(m => m.id === target.id ? { ...m, content: rawText, edited_at: new Date().toISOString() } : m));
      setEditing(null); setDraft(''); setSending(true);
      try {
        await whatsappService.editMessage(target.id, rawText);
        void refreshMessages(convId);
      } catch (err: any) {
        setMessages(prev => prev.map(m => m.id === target.id
          ? { ...m, content: target.content, edited_at: target.edited_at } : m));
        toast.error('Falha ao editar', err.message);
      } finally { setSending(false); sendingRef.current = false; }
      return;
    }

    draftValRef.current = ''; // trava síncrona: o próximo disparo não acha texto

    const conversation = selected;
    const me = user ? staffById.get(user.id) : null;

    // Decididos no gesto (e não lá dentro da fila) para que a segunda mensagem
    // da rajada já saiba que a primeira vai cuidar disso.
    const assumeKey = `assume:${conversation.id}`;
    const needsAssume = !conversation.assigned_user_id && !conversation.is_blocked && !!user?.id
      && !burstFlagsRef.current.has(assumeKey);
    if (needsAssume) burstFlagsRef.current.add(assumeKey);
    const absenceKey = `absence:${conversation.id}`;
    const needsAbsenceRelease = conversation.absence_suppressed === false
      && !burstFlagsRef.current.has(absenceKey);
    if (needsAbsenceRelease) burstFlagsRef.current.add(absenceKey);

    // Prefixo de identificação do agente: *Dr. Pedro:*\n antes do texto.
    // Usa agentLabel para incluir Dr./Dra. em advogados automaticamente.
    // Só em envios manuais pelo compositor — mensagens automáticas ficam sem prefixo.
    const agentDisplayName = agentLabel(me, agentPrefs.short_name);
    const text = agentDisplayName ? `*${agentDisplayName}:*\n${rawText}` : rawText;

    // ── O que o atendente vê acontece AGORA, no mesmo frame do Enter ──────
    // Assumir a conversa é uma ida à rede; enquanto estava aqui em cima, o texto
    // ficava preso no compositor esperando o servidor. Agora a bolha aparece e o
    // input esvazia primeiro; a rede (assumir → mensagem) roda em seguida.
    const sentAt = new Date().toISOString();
    const tempId = newTempId();
    const replyId = replyTo?.id;
    const optimistic = buildOptimistic(conversation.id, tempId, sentAt, {
      type: 'text', content: text, reply_to_id: replyId ?? null, _local: 'sending',
    });
    retryRef.current.set(tempId, { kind: 'text', text, replyId });
    setPending(prev => [...prev, optimistic]);
    bumpConversationPreview(conversation.id, rawText, sentAt);
    setDraft(''); setReplyTo(null);
    // Toca junto com a bolha aparecendo, não quando o servidor confirma: o som é
    // o par do gesto (o Enter), e atrasá-lo até a rede responder o transformaria
    // num aviso solto, chegando quando a pessoa já está escrevendo a próxima.
    playWaActionSound('send');
    // Lugar na fila reservado AGORA: é esta ordem — a que o atendente viu as
    // bolhas aparecerem — que o cliente vai ver do outro lado.
    const turn = sendQueue.take();
    try {
      await turn.wait;
      // Auto-assumir: responder uma conversa SEM dono (na fila) assume o atendimento
      // automaticamente para você — antes da 1ª mensagem sair. Conversa já minha
      // ou de outro atendente não é tocada (takeover explícito continua no botão Assumir).
      if (needsAssume) {
        try {
          await whatsappService.assumeConversation(conversation.id);
        } catch (e: any) {
          // Falhou: a marca sai, para a próxima mensagem da rajada tentar de novo.
          burstFlagsRef.current.delete(assumeKey);
          throw new Error(`Não foi possível assumir o atendimento: ${e.message}`);
        }
        // Fase J: aborta sessão de IA quando o humano assume.
        if (aiSession?.status === 'active') await whatsappService.abortAiSession(conversation.id).catch(() => {});
        setConversations(prev => prev.map(c => c.id === conversation.id
          ? { ...c, assigned_user_id: user!.id, awaiting_accept: false, transfer_pending_since: null } : c));
      }

      // Ao responder, pausa o aviso de horário (ausência) nesta conversa: o atendente
      // está atendendo, então o cliente não deve mais receber o auto-aviso "fora do
      // horário". Reativado automaticamente quando o atendimento é encerrado.
      if (needsAbsenceRelease) {
        whatsappService.setAbsenceSuppressed(conversation.id, true).catch(() => {});
        setConversations(prev => prev.map(c => c.id === conversation.id ? { ...c, absence_suppressed: true } : c));
      }

      // Só a mensagem digitada sai daqui: nenhuma saudação automática é enviada
      // antes dela. Saudação continua disponível como variável `{{saudacao}}` nos
      // modelos manuais, e as automações (ausência, IA, transferência) seguem
      // com seus próprios fluxos.
      settleSend(conversation.id, tempId, await whatsappService.sendText({ conversationId: conversation.id, text, replyToId: replyId }));
      retryRef.current.delete(tempId);
      void refreshMessages(conversation.id);
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
    } finally { turn.release(); }
  };

  // ── Envio de mídia (imagem/vídeo/áudio/documento) ──
  // A legenda SEMPRE vem de quem chama (do preview de anexos ou do descritor de
  // retry). Antes ela era lida do compositor aqui dentro — o que fazia o texto
  // digitado sumir sem virar legenda quando o preview era confirmado com o campo
  // já esvaziado. Agora o texto é transferido para a legenda no momento em que o
  // anexo é escolhido (ver stageAttachments).
  const sendFile = async (file: File, kind: 'image' | 'video' | 'audio' | 'document', captionRaw: string) => {
    if (!selected) return;
    const caption = captionRaw.trim();
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
    setReplyTo(null);
    // Lugar na fila reservado no gesto; o upload abaixo corre em paralelo com o
    // dos outros anexos e com o texto seguinte — só o disparo espera a vez.
    const turn = sendQueue.take();

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
      await turn.wait;
      settleSend(selected.id, tempId, await whatsappService.sendMedia({
        conversationId: selected.id, type: kind, text: caption || undefined,
        storagePath: up.storagePath, mimeType: up.mimeType, fileName: up.fileName, replyToId: replyId,
      }));
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
      turn.release();
      if (previewUrl) setTimeout(() => URL.revokeObjectURL(previewUrl), 30_000);
    }
  };

  // Envia um GIF escolhido no seletor. Vai como vídeo marcado `asGif`: o
  // WhatsApp converte GIF para mp4 de qualquer jeito, e sem a marca a conversa
  // recebe um vídeo com play parado em vez da animação em laço.
  //
  // Não passa pelo preview com legenda: escolher o GIF na grade JÁ é a escolha,
  // e uma segunda confirmação só atrasaria o que se espera ser instantâneo.
  const sendGif = useCallback(async (file: File) => {
    if (!selected) return;
    const conversationId = selected.id;
    const sentAt = new Date().toISOString();
    const tempId = newTempId();
    const previewUrl = URL.createObjectURL(file);
    const optimistic = buildOptimistic(conversationId, tempId, sentAt, {
      type: 'video', is_animated: true,
      media_url: previewUrl, media_mime: file.type, media_size: file.size, file_name: file.name,
      _local: 'uploading',
    });
    setPending(prev => [...prev, optimistic]);
    bumpConversationPreview(conversationId, conversationPreviewLabel('video'), sentAt);
    const turn = sendQueue.take();
    try {
      const up = await whatsappService.uploadMedia(file, { conversationId });
      setPending(prev => prev.map(p => p._tempId === tempId ? { ...p, _local: 'sending' } : p));
      await turn.wait;
      settleSend(conversationId, tempId, await whatsappService.sendMedia({
        conversationId, type: 'video', storagePath: up.storagePath,
        mimeType: up.mimeType, fileName: up.fileName, asGif: true,
      }));
      void refreshMessages(conversationId);
    } catch (err: any) {
      markPendingFailed(tempId);
      toast.error('GIF não enviado', err?.message || 'Falha ao enviar pelo WhatsApp.');
    } finally {
      turn.release();
      setTimeout(() => URL.revokeObjectURL(previewUrl), 60_000);
    }
  }, [selected, sendQueue, bumpConversationPreview, settleSend, markPendingFailed, refreshMessages, toast]);

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
    const turn = sendQueue.take();
    try {
      await turn.wait;
      settleSend(selected.id, tempId, await whatsappService.sendText({ conversationId: selected.id, text, replyToId: replyId }));
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
    } finally { turn.release(); }
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
    const turn = sendQueue.take();
    try {
      await turn.wait;
      settleSend(selected.id, tempId, await whatsappService.sendMedia({
        conversationId: selected.id, type: kind, text: m.content || undefined,
        storagePath: m.storage_path, mimeType: m.media_mime || 'application/octet-stream', fileName: m.file_name || undefined,
      }));
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
    } finally { turn.release(); }
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
    if (!ok.length) return;
    // O que já estava escrito ACOMPANHA o anexo: entra no preview como legenda e
    // sai do compositor, como no WhatsApp. Antes o texto ficava para trás e era
    // apagado no envio do arquivo — quem escrevia a explicação e só depois
    // anexava o documento via o texto simplesmente sumir.
    setStagedCaption(draftValRef.current);
    draftValRef.current = '';
    setDraft('');
    setAttachStaged(ok);
  };

  // Confirma o envio dos anexos do preview: a legenda vai com o 1º arquivo
  // (padrão WhatsApp para álbum); os demais seguem sem legenda.
  const confirmStagedSend = (caption: string, files: File[]) => {
    setAttachStaged(null);
    setStagedCaption('');
    files.forEach((f, i) => sendFile(f, kindForFile(f), i === 0 ? caption : ''));
  };

  // Desistiu do anexo (fechou o preview ou tirou a última imagem da tira): a
  // legenda volta a ser o texto do compositor — o caminho de volta do que
  // stageAttachments levou. Sem isto, cancelar o anexo apagaria a frase escrita.
  const cancelStagedSend = (caption: string) => {
    setAttachStaged(null);
    setStagedCaption('');
    if (!caption) return;
    // Concatena se algo novo foi digitado no compositor enquanto o preview
    // estava aberto (raro, mas nada do que se escreveu pode se perder aqui).
    const atual = draftValRef.current;
    const restaurado = atual ? `${caption}\n${atual}` : caption;
    draftValRef.current = restaurado;
    setDraft(restaurado);
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

  /**
   * Liga o medidor de volume ao mesmo stream que está sendo gravado.
   *
   * Mede em RMS (a média quadrática das amostras), não pelo pico: pico salta com
   * qualquer estalo e faz a barra piscar sozinha; RMS é a energia percebida, que
   * é o que o olho espera ver acompanhando a voz.
   *
   * A escala é a de sempre em áudio — logarítmica. Voz de fala normal fica perto
   * de 0,05 em amplitude linear, e num gráfico linear isso vira uma barra
   * praticamente parada no chão. A curva abaixo espalha justamente a faixa entre
   * o silêncio e a fala, que é a única que importa aqui.
   *
   * Falhar aqui não cancela a gravação: sem medidor as barras ficam paradas, e
   * gravar sem animação é muito melhor do que não gravar.
   */
  const startLevelMeter = (stream: MediaStream) => {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ac = new AC();
      recAudioCtxRef.current = ac;
      const source = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      // 1024 amostras ≈ 21ms a 48kHz: janela curta o bastante para a barra
      // acompanhar a sílaba, longa o bastante para não tremer no ruído de fundo.
      analyser.fftSize = 1024;
      source.connect(analyser);
      // Nada é conectado ao destination de propósito: ligar o microfone na saída
      // devolveria a própria voz pelo alto-falante, com microfonia.

      const buffer = new Float32Array(analyser.fftSize);
      const medir = () => {
        analyser.getFloatTimeDomainData(buffer);
        let soma = 0;
        for (let i = 0; i < buffer.length; i++) soma += buffer[i] * buffer[i];
        const rms = Math.sqrt(soma / buffer.length);
        // -60 dB (praticamente silêncio) → 0; 0 dB → 1.
        const db = 20 * Math.log10(Math.max(rms, 1e-7));
        const alvo = Math.min(1, Math.max(0, (db + 60) / 60));
        // Sobe rápido e desce devagar, como todo medidor de áudio: a barra pega o
        // ataque da voz e não desaba no meio da palavra, entre uma sílaba e outra.
        setRecLevel(anterior => (alvo > anterior ? alvo : anterior * 0.82 + alvo * 0.18));
        recRafRef.current = requestAnimationFrame(medir);
      };
      recRafRef.current = requestAnimationFrame(medir);
    } catch {
      /* sem medidor: as barras ficam paradas e a gravação segue normal */
    }
  };

  /** Desliga o medidor. Idempotente — chamado do stop e do desmonte. */
  const stopLevelMeter = () => {
    if (recRafRef.current !== null) { cancelAnimationFrame(recRafRef.current); recRafRef.current = null; }
    const ac = recAudioCtxRef.current;
    recAudioCtxRef.current = null;
    // `close()` é o que solta o processamento de áudio; sem ele, cada gravação
    // deixa um AudioContext vivo e o navegador corta no limite por aba.
    if (ac) void ac.close().catch(() => {});
    setRecLevel(0);
  };

  const startRecording = async () => {
    if (!selected || recording) return;
    try {
      // O MESMO microfone das ligações — ver `utils/audioDevices`.
      const stream = await openPreferredMicrophone();
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recChunksRef.current = [];
      recCancelledRef.current = false;
      // O pedaço final chega DEPOIS do clique na lixeira: descartado aqui, ele
      // nem entra na lista.
      rec.ondataavailable = e => {
        if (recCancelledRef.current) return;
        if (e.data.size > 0) recChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        stopLevelMeter();
        if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
        // Descartada: solta o microfone e vai embora sem montar blob nenhum.
        if (recCancelledRef.current) { recChunksRef.current = []; return; }
        const blob = new Blob(recChunksRef.current, { type: rec.mimeType || 'audio/webm' });
        recChunksRef.current = [];
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
      startLevelMeter(stream);
      playWaActionSound('rec-start');
      recTimerRef.current = window.setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch {
      toast.error('Não foi possível acessar o microfone');
    }
  };

  const stopRecording = (send: boolean) => {
    const rec = mediaRecRef.current;
    if (!rec) return;
    // A flag é levantada ANTES do stop(): é ela, e não o esvaziamento da lista,
    // que impede o último pedaço de virar um áudio enviado sem querer.
    recCancelledRef.current = !send;
    setRecording(false);
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    if (rec.state !== 'inactive') rec.stop();
    mediaRecRef.current = null;
    playWaActionSound(send ? 'rec-stop' : 'rec-cancel');
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
    const turn = sendQueue.take();
    try {
      const up = await whatsappService.uploadMedia(blob, { conversationId: selected.id, fileName: 'audio.webm' });
      uploaded = up;
      setPending(prev => prev.map(p => p._tempId === tempId ? { ...p, _local: 'sending' } : p));
      await turn.wait;
      settleSend(selected.id, tempId, await whatsappService.sendAudio({
        conversationId: selected.id, storagePath: up.storagePath, mimeType: up.mimeType,
        fileName: up.fileName, replyToId: replyId,
      }));
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
      turn.release();
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
    recording, recSeconds, recLevel,
    attachStaged, setAttachStaged, stagedCaption,
    handleSend, beginEdit,
    retryPending, discardPending, cancelUpload, resendExisting,
    startRecording, stopRecording,
    onPickFiles, handleDroppedFiles, confirmStagedSend, cancelStagedSend,
    sendGif,
  };
}
