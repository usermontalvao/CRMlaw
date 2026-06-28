import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, Send, Loader2, MessageCircle, Phone, User as UserIcon,
  CheckCheck, Check, AlertCircle, Link2, ArrowRightLeft, X,
  Paperclip, Mic, FileText, Image as ImageIcon, CornerUpLeft,
  Pencil, Download, UserCheck, Unlink, IdCard, Scale, Calendar,
  Clock, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, Plus, Ban, ShieldOff, CheckCircle2, RotateCcw,
  StickyNote, Trash2, History, CalendarClock, MessageSquare, Filter, Maximize2,
  UserPlus, UserMinus, PenLine, HandCoins, ListTodo, FilePlus,
  Sparkles, Tag, Tags, Bot,
  Shield, ShieldCheck, Eye, EyeOff,
  BarChart2, TrendingUp, Users, AlertTriangle, Clock3, CheckCircle, Inbox,
  Mail, MapPin, Play, Pause, Bell, BellOff, Info, MoreVertical, BellRing,
  Target,
} from 'lucide-react';
import { useStaffPush } from './whatsapp/hooks/useStaffPush';
import { useThreadDragDrop } from './whatsapp/hooks/useThreadDragDrop';
import { muteStore } from '../services/whatsapp/muteStore';
import { whatsappService, normalizePhone, renderTemplate, agentPermissions, summarizeOverview, type StaffOption, type AgentPrefs, type ScheduleDeadline, type ClientDocRequest, type ClientOverview, type ClientSchedule, type ClientPendings, type WhatsAppInternalNote, type ClientTrackedSignatureStatus } from '../services/whatsapp.service';
import type { WhatsAppScheduledMessage } from '../types/whatsapp.types';
import {
  formatTime, initials, prettyPhone, formatBytes, dayLabel, lastSeenLabel, presenceInfo,
  typeLabel, conversationPreviewLabel, firstName, agentLabel, greetingByHour, buildGreeting,
  convStatus, slaSignal, slaInternalSignal, abandonedSignal, transferAlert,
  maskSensitive, maskName, maskPhoneFull, fmtAudioTime, prettyDoc, dueInfo, fmtDateTime,
  fmtNoteDate,
} from './whatsapp/format';
import {
  WaDialog, WaDialogBody, waInput, waLabel, waBtnPrimary, waBtnGhost, waBtnDanger,
} from './whatsapp/ui';
import { TransferModal, BlockContactModal, CloseConversationModal, LegalHoldModal } from './whatsapp/conversationModals';
import { TemplatePickerModal, ScheduleMessageModal } from './whatsapp/messageModals';
import { ConversationSummaryModal, ConversationTimelineModal } from './whatsapp/infoModals';
import { RequestDocumentModal } from './whatsapp/RequestDocumentModal';
import { ClientPickerModal, NewConversationModal } from './whatsapp/clientPickerModals';
import { CreateDeadlineFromMessageModal, CreateTaskFromMessageModal } from './whatsapp/createFromMessageModals';
import {
  CasosPanel, ClientAgendaPanel, ClientPendingsPanel, ClientSignaturesPanel, ClientAgreementsPanel,
  PROC_STATUS, PROC_AREA, REQ_STATUS_BADGE, REQ_STATUS_LABEL,
} from './whatsapp/clientPanels';
import type { ConfirmOpts, ConfirmFn, WaOpenWorkspaceFn } from './whatsapp/types';
import { MessageBubble, ImageAlbum } from './whatsapp/messageBubble';
import { Avatar } from './whatsapp/avatar';
import { WA_LABELS, resolveLabelMeta, inferFunnelStage } from './whatsapp/funnel';
import { ClientLinkPanel } from './whatsapp/clientLinkPanel';
import { ConversationSummaryBanner } from './whatsapp/conversationSummaryBanner';
import { InternalNotesSection } from './whatsapp/internalNotes';
import { AttachmentPreviewModal } from './whatsapp/attachmentPreviewModal';
import { ConversationLabelsPanel } from './whatsapp/conversationLabels';
import { ConversationFunnelBoard } from './whatsapp/conversationFunnelBoard';
import { ThreadScheduledGhosts, ScheduledMessagesPanel } from './whatsapp/scheduledMessages';
import { AiApprovalBanner } from './whatsapp/aiApprovalBanner';
import { AttendanceDashboard } from './whatsapp/attendanceDashboard';
import { ClientFillLinksPanel } from './whatsapp/clientFillLinksPanel';
import { ConversationListItem, PresenceText, DateDivider } from './whatsapp/conversationListItem';
import { WaLightbox } from './whatsapp/lightbox';
import { WaNotifyBell } from './whatsapp/notifyBell';
import { useWaIsMobile, useWaIsPanelDocked, getCurrentTimeInTz } from './whatsapp/hooks';
import { useResizableLayout } from './whatsapp/hooks/useResizableLayout';
import { useClientOverview } from './whatsapp/hooks/useClientOverview';
import { useWaRealtime } from './whatsapp/hooks/useWaRealtime';
import { useWaComposer } from './whatsapp/hooks/useWaComposer';
import { useWaMessages } from './whatsapp/hooks/useWaMessages';
import { useWaThread } from './whatsapp/hooks/useWaThread';
import { useWaConversationActions } from './whatsapp/hooks/useWaConversationActions';
import { useWaTemplates } from './whatsapp/hooks/useWaTemplates';
import { useWaOperationalModals } from './whatsapp/hooks/useWaOperationalModals';
import { useWaAiActions } from './whatsapp/hooks/useWaAiActions';
import { useConfirm, ConfirmDialog } from './whatsapp/useConfirm';
import { processService, type ProcessMovement } from '../services/process.service';
import type { CalendarEvent, CalendarEventType } from '../types/calendar.types';
import type { Requirement, RequirementStatus } from '../types/requirement.types';
import type {
  WhatsAppConversation, WhatsAppMessage, WhatsAppChannel, WhatsAppDepartment,
  WhatsAppClientLite, WhatsAppPresence, WhatsAppDirection,
} from '../types/whatsapp.types';
import type { Process, ProcessStatus, ProcessPracticeArea } from '../types/process.types';
import { useAuth } from '../contexts/AuthContext';
import { useToastContext } from '../contexts/ToastContext';
import { useNavigation } from '../contexts/NavigationContext';
import { signatureService } from '../services/signature.service';
import { WaWorkspaceRenderer } from './WaWorkspace';
import { ClientCloudDocsLink } from './CloudFolderModal';
import { Modal, ModalBody } from './ui/Modal';
import { buildPublicFillUrl } from '../utils/publicAppUrl';
import type { Lead } from '../types/lead.types';
import { settingsService, funnelLabelsFromConfig, type FunnelLabel } from '../services/settings.service';

/**
 * `true` quando a viewport é estreita demais para mostrar lista + thread lado a
 * lado (abaixo do breakpoint `md` do Tailwind = 768px). Usado para alternar o
 * módulo para um painel por vez em celulares.
 */

type FilterTab = 'all' | 'unread' | 'mine';


// ── Confirmação leve (sem PIN) para ações reversíveis do módulo ──
// O app reserva o fluxo com PIN (useDeleteConfirm) para exclusões críticas;
// aqui usamos um confirm simples para "devolver à fila", "cancelar", etc.
// `ConfirmOpts`/`ConfirmFn` agora vivem em ./whatsapp/types (compartilhados).


// ── Shell de diálogo estilo WhatsApp (Fase Q: padronização visual) ──
// Header em teal (#008069), card arredondado, overlay com blur, ESC/clique-fora
// fecham, trava o scroll do body e entra com micro-animação. Todos os modais do
// módulo usam este shell para parecer uma aplicação profissional e consistente.
// Alturas-base (scaleY) das barras do equalizador de gravação — perfil de onda
// estático que a animação waEq faz "respirar"; dá o visual de áudio do WhatsApp.
const WA_REC_BARS = [0.35, 0.6, 0.9, 0.5, 0.75, 1, 0.45, 0.7, 0.55, 0.85, 0.4, 0.65, 0.95, 0.5, 0.8, 0.6, 0.45, 0.9, 0.55, 0.7, 0.5, 0.85, 0.4, 0.6];




interface WhatsAppModuleProps {
  /** Deep-link: conversa a abrir ao entrar no módulo (ex.: clique na notificação). */
  openConversationId?: string;
  /** Avisa o App para limpar o param de navegação após consumi-lo. */
  onParamConsumed?: () => void;
  /** Converte um lead em cliente (delega ao fluxo global do App). */
  onConvertLead?: (lead: Lead) => void;
  /**
   * `'embedded'` = modo lite dentro do widget flutuante: força painel único
   * (lista OU conversa), sem painel de contato fixo, e oculta o chrome largo
   * (Funil de Leads e Dashboard). `'full'` (default) = página completa.
   */
  variant?: 'full' | 'embedded';
  /** Reporta o total de conversas não-lidas (alimenta o badge da aba no widget). */
  onUnreadChange?: (total: number) => void;
  /** Reporta a conversa aberta (deep-link ao maximizar o widget). */
  onActiveConversationChange?: (id: string | null) => void;
}

const WhatsAppModule: React.FC<WhatsAppModuleProps> = ({ openConversationId, onParamConsumed, onConvertLead, variant = 'full', onUnreadChange, onActiveConversationChange }) => {
  const embedded = variant === 'embedded';
  const { user } = useAuth();
  const toast = useToastContext();
  const { navigateTo } = useNavigation();
  const { confirm, pending: confirmPending, resolve: resolveConfirm } = useConfirm();
  // Gaveta de Leads embutida: funil comercial/jurídico revelado a partir do topo
  // do módulo, empurrando o atendimento para ~70% da altura quando aberta.
  const [leadsPanelOpen, setLeadsPanelOpen] = useState(false);
  // Mantém o funil montado após a 1ª abertura para que o slide de fechamento
  // mostre o conteúdo (não esvazia no meio da animação).
  const [leadsEverOpened, setLeadsEverOpened] = useState(false);
  // Canal selecionado na gaveta (= conta de WhatsApp conectada). Vazio = todos.
  const [leadChannelFilter, setLeadChannelFilter] = useState('');
  // Etiquetas do funil (fonte única vinda de Configurações → Leads). Espelham o
  // estágio do funil de cada conversa. Recarregadas ao abrir a gaveta de Leads
  // (onde a config pode ter sido alterada) e no mount.
  const [funnelLabels, setFunnelLabels] = useState<FunnelLabel[]>([]);
  const reloadFunnelLabels = useCallback(() => {
    settingsService.getLeadModuleConfig()
      .then(cfg => setFunnelLabels(funnelLabelsFromConfig(cfg)))
      .catch(() => {});
  }, []);
  useEffect(() => { reloadFunnelLabels(); }, [reloadFunnelLabels]);
  // Reflete no atendimento qualquer ajuste de funil feito na gaveta de Leads.
  useEffect(() => { if (leadsPanelOpen) { setLeadsEverOpened(true); reloadFunnelLabels(); } }, [leadsPanelOpen, reloadFunnelLabels]);
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Responsividade: abaixo de `md` (768px) a lista e a thread não cabem lado a
  // lado, então alternamos para um painel por vez (estilo WhatsApp mobile).
  // No modo embutido (widget estreito) forçamos esse mesmo painel único — os
  // hooks são baseados em window.matchMedia e dariam "desktop" dentro do widget.
  const rawIsMobile = useWaIsMobile();
  const isMobile = embedded || rawIsMobile;
  // Abaixo do `xl` o painel do contato não cabe fixo: vira gaveta sobreposta.
  // No embutido nunca fica fixo (não há largura).
  const rawPanelDocked = useWaIsPanelDocked();
  const panelDocked = embedded ? false : rawPanelDocked;
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  // Menu "⋮" do cabeçalho da thread (agrupa as ações em telas estreitas).
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  // Menu "+" do composer (documento, modelo, agendar) — mantém a barra enxuta.
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // Menu do sino: unifica som das notificações + push do navegador num só ícone.
  // Web Push do staff: avisa o atendente mesmo com o navegador fechado.
  const { pushState, toggleStaffPush } = useStaffPush();
  // Filtros da inbox recolhidos por padrão (expansível); economiza altura no topo.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Fecha a gaveta ao trocar de conversa ou quando o painel volta a ser fixo.
  useEffect(() => { setMobilePanelOpen(false); setHeaderMenuOpen(false); setAttachMenuOpen(false); }, [selectedId]);
  useEffect(() => { if (panelDocked) setMobilePanelOpen(false); }, [panelDocked]);
  const [channels, setChannels] = useState<WhatsAppChannel[]>([]);
  const [departments, setDepartments] = useState<WhatsAppDepartment[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [agentPrefs, setAgentPrefs] = useState<AgentPrefs>({ auto_greeting: true, short_name: null, role_label: null });
  const [search, setSearch] = useState('');
  // Fase 5: a inbox abre em "Minhas" por padrão (escopo do próprio atendente).
  // A escolha persiste localmente — quem trabalha em "Todas" não reabre em Minhas.
  const [filter, setFilter] = useState<FilterTab>(() => {
    // No widget embutido a inbox é pessoal: sempre abre em "Minhas", ignorando
    // a preferência persistida do módulo cheio (quem trabalha em "Todas" lá não
    // arrasta esse escopo para o widget).
    if (embedded) return 'mine';
    const v = localStorage.getItem('wa_filter');
    return v === 'all' || v === 'unread' || v === 'mine' ? v : 'mine';
  });
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  // O som das notificações vive agora dentro de <WaNotifyBell/> (estado de UI local).
  // Silenciamento por conversa (no banco, por usuário). Re-renderiza ao mudar o store.
  useSyncExternalStore(muteStore.subscribe, muteStore.getSnapshot);
  useEffect(() => { void muteStore.init(); }, []);
  const [muteMenuOpen, setMuteMenuOpen] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  // Fase H: ação jurídica a partir de mensagem
  const [deadlineSource, setDeadlineSource] = useState<WhatsAppMessage | null>(null);
  const [taskSource, setTaskSource] = useState<WhatsAppMessage | null>(null);
  // Fase I/360: estado dos modais operacionais + workspace → useWaOperationalModals (abaixo).
  // Fase M: filtro por etiqueta + resumo automático por IA
  const [labelFilter, setLabelFilter] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Fase J: sessão de IA da conversa selecionada → gerida por useWaRealtime (abaixo).
  // Fase K: IA da conversa (sugerir/classificar/extrair) + exportação → useWaAiActions (abaixo).
  // Fase L: modo privado (mascaramento visual) e exportação
  const [privateMode, setPrivateMode] = useState(false);
  // Fase M: dashboard de atendimento
  const [showDashboard, setShowDashboard] = useState(false);
  // Fase N: aviso de fora do horário de atendimento
  const [outsideHours, setOutsideHours] = useState<{ message: string } | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Fase 3: por padrão a lista mostra apenas conversas ativas (status "Abertas");
  // encerradas saem da fila e só aparecem no filtro próprio "Encerradas" — ou
  // quando o cliente volta a falar e a conversa é reaberta (status → open).
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'waiting_you' | 'waiting_internal' | 'reopened' | 'closed'>(() => {
    const v = localStorage.getItem('wa_status_filter');
    return v === 'all' || v === 'open' || v === 'waiting_you' || v === 'waiting_internal' || v === 'reopened' || v === 'closed' ? v : 'open';
  });
  // Larguras das colunas com persistência local + divisórias arrastáveis (Fase 10.1).
  const { panelWidth, listWidth, startPanelResize, startListResize } = useResizableLayout();
  // Persistência local dos filtros da inbox (Fase 3/5): o escopo escolhido pelo
  // atendente sobrevive ao recarregar — sem reimpor o padrão a cada abertura.
  useEffect(() => { if (!embedded) localStorage.setItem('wa_filter', filter); }, [filter, embedded]);
  useEffect(() => { localStorage.setItem('wa_status_filter', statusFilter); }, [statusFilter]);

  const imgInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const avatarTriedRef = useRef<Set<string>>(new Set());

  const channelById = useMemo(() => new Map(channels.map(c => [c.id, c])), [channels]);
  const deptById = useMemo(() => new Map(departments.map(d => [d.id, d])), [departments]);
  const staffByUser = useMemo(() => new Map(staff.map(s => [s.user_id, s.name])), [staff]);
  const staffById = useMemo(() => new Map(staff.map(s => [s.user_id, s])), [staff]);
  // Papel operacional do usuário logado → permissões da UI (Fase 9).
  const myRole = user ? (staffById.get(user.id)?.role ?? null) : null;
  const perms = useMemo(() => agentPermissions(myRole), [myRole]);

  const selected = useMemo(
    () => conversations.find(c => c.id === selectedId) || null,
    [conversations, selectedId],
  );

  const selectedClientId = selected?.client_id ?? null;

  // Pacote 360 do cliente + status de documentos/assinaturas por cliente (com
  // realtime). Banner-resumo e painéis laterais consomem deste estado.
  const {
    overview, setOverview, reloadOverview,
    effectiveDocStatus, trackedSignatureStatus, effectiveConversationStatus,
    dismissDocReady, stopTemplateFillTracking, stopSignatureTracking,
  } = useClientOverview(selectedClientId, conversations);

  // Move uma conversa para uma ETAPA do funil (etapa única: remove etiquetas de
  // funil anteriores, mantém tags livres). Usado por automações como "ao pedir
  // documento → Aguardando Documentos". No-op se a etapa não existe no funil.
  const loadConversations = useCallback(async () => {
    try {
      setConversations(await whatsappService.listConversations());
    } catch {/* */} finally { setLoadingConvs(false); }
  }, []);

  // Camada de dados da thread: janela de mensagens da conversa aberta, com
  // carregamento inicial, paginação e refresh em tempo real. Vive aqui (antes de
  // useWaRealtime/useWaComposer) porque é a fonte de `refreshMessages`.
  const {
    messages, setMessages,
    loadingMsgs, hasMoreMsgs, setHasMoreMsgs, loadingMore,
    oldestTsRef,
    loadMessages, loadMoreMsgs, refreshMessages,
  } = useWaMessages(selectedId);

  // Bootstrap dos dados auxiliares (uma vez). O fluxo reativo (realtime de
  // conversa/mensagem/IA) vive em useWaRealtime.
  useEffect(() => {
    loadConversations();
    whatsappService.listChannels().then(setChannels).catch(() => {});
    whatsappService.listDepartments().then(setDepartments).catch(() => {});
    whatsappService.listStaff().then(setStaff).catch(() => {});
    whatsappService.getMyAgentPrefs().then(setAgentPrefs).catch(() => {});
  }, [loadConversations]);

  const { aiSession, setAiSession } = useWaRealtime({
    selectedId, loadConversations, refreshMessages,
    setConversations, setMessages, setSelectedId,
  });

  // Compositor de mensagens (rascunho por conversa, resposta/edição, envio
  // otimista de texto/mídia/áudio, gravação, retry/resend + fluxos automáticos
  // de assumir/saudar/suprimir ausência). Concentra o trecho mais acoplado do
  // envio; o módulo só costura os dados que o compositor precisa.
  const {
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
  } = useWaComposer({
    selectedId, selected, user, agentPrefs, staffById, aiSession,
    messages, setMessages, setConversations, refreshMessages,
  });

  // Camada visual da thread: merge de mensagens reais + otimistas, agrupamento de
  // imagens em álbuns, galeria/lightbox e todo o auto-scroll. Consome `pending` do
  // compositor, por isso vive depois dele.
  const {
    allMessages, msgById, messageUnits,
    lightbox, setLightbox, lightboxImages,
    threadContentRef, setThreadEl, onThreadScroll,
  } = useWaThread(selectedId, messages, pending);

  // Auto-crescimento do campo de mensagem: cresce com o texto até um teto e
  // então rola. Roda a cada mudança do rascunho, então também encolhe de volta
  // quando o draft é limpo (envio/edição/escape).
  const COMPOSER_MAX_H = 192; // px (≈ max-h-48); acima disso, rola
  useEffect(() => {
    const el = draftRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, COMPOSER_MAX_H) + 'px';
  }, [draft]);

  // Domínio de modelos/atalho "/" do compositor: carrega templates ativos + kits,
  // faz o matching do slash, monta o contexto de variáveis e aplica no rascunho.
  const {
    reloadTemplates, templateCtx,
    slashMatch, slashResults, slashActive, slashIdx, setSlashIndex,
    applyTemplate,
  } = useWaTemplates({
    selected, selectedId, user, staffById, draft, editing, setDraft,
  });

  // Ao abrir uma conversa, marca como lida e zera o contador de não-lidas. A carga
  // da thread (mensagens/paginação) vive em useWaMessages.
  useEffect(() => {
    if (!selectedId) return;
    whatsappService.markRead(selectedId).then(() => {
      setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, unread_count: 0 } : c));
    }).catch(() => {});
  }, [selectedId]);

  // Deep-link: ao clicar na notificação de mensagem nova (fora do módulo), o App
  // navega para cá com a conversa-alvo. Seleciona e limpa o param para não reabrir.
  useEffect(() => {
    if (!openConversationId) return;
    setSelectedId(openConversationId);
    onParamConsumed?.();
  }, [openConversationId, onParamConsumed]);

  // Fase N: verifica horário de atendimento ao trocar de canal/conversa (timezone-aware).
  useEffect(() => {
    const instanceId = selected?.instance_id;
    if (!instanceId) { setOutsideHours(null); return; }
    const ch = channels.find(c => c.id === instanceId);
    let cancelled = false;
    whatsappService.listBusinessHours(instanceId).then(rows => {
      if (cancelled) return;
      const tz = ch?.timezone || 'America/Cuiaba';
      const { dow, curMins } = getCurrentTimeInTz(tz);
      const row = rows.find(r => r.day_of_week === dow);
      if (!row || !row.is_active) {
        setOutsideHours({ message: ch?.absence_message || 'Canal fora do horário de atendimento.' });
        return;
      }
      const [sh, sm] = row.start_time.split(':').map(Number);
      const [eh, em] = row.end_time.split(':').map(Number);
      const startMins = sh * 60 + sm;
      const endMins = eh * 60 + em;
      if (curMins < startMins || curMins >= endMins) {
        setOutsideHours({ message: ch?.absence_message || `Atendimento: ${row.start_time}–${row.end_time}.` });
      } else {
        setOutsideHours(null);
      }
    }).catch(() => { if (!cancelled) setOutsideHours(null); });
    return () => { cancelled = true; };
  }, [selected?.instance_id, selected?.id, channels]);

  // Ao abrir uma conversa sem foto, busca a foto de perfil na Evolution (1x por conversa).
  useEffect(() => {
    if (!selected || selected.contact_avatar_url) return;
    if (avatarTriedRef.current.has(selected.id)) return;
    avatarTriedRef.current.add(selected.id);
    whatsappService.refreshAvatar(selected.id)
      .then(({ path }) => { if (path) loadConversations(); })
      .catch(() => {});
  }, [selected, loadConversations]);

  // O recálculo periódico da presença ("online" expira virando "visto por último")
  // vive agora dentro de <PresenceText/>, que tem o próprio tick de 15s — evita
  // re-renderizar o módulo inteiro (lista + thread) só para atualizar o relógio.

  // Mantém a presença do contato fluindo: pede à Evolution ao abrir e renova em
  // ritmo curto (sem subscribe nativo, é o que mantém online/visto-por-último
  // atualizando rápido — o WhatsApp só reenvia a presença quando provocamos).
  useEffect(() => {
    if (!selectedId) return;
    whatsappService.subscribePresence(selectedId);
    const id = window.setInterval(() => whatsappService.subscribePresence(selectedId), 15_000);
    return () => window.clearInterval(id);
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations
      .filter(c => {
        // Fase 0: conversa sem nenhuma mensagem (last_message_at nulo) é rascunho de
        // "Nova conversa" aberta mas sem primeiro envio — não polui a inbox. Fica
        // visível apenas enquanto está aberta na thread; ao sair sem enviar, some.
        if (!c.last_message_at && c.id !== selectedId) return false;
        if (filter === 'unread' && c.unread_count === 0) return false;
        if (filter === 'mine' && c.assigned_user_id !== user?.id) return false;
        if (statusFilter === 'open' && c.status === 'closed') return false;
        if (statusFilter === 'closed' && c.status !== 'closed') return false;
        if (statusFilter === 'waiting_you' && convStatus(c).key !== 'waiting_you') return false;
        if (statusFilter === 'waiting_internal' && convStatus(c).key !== 'waiting_internal') return false;
        if (statusFilter === 'reopened' && (c.status === 'closed' || !c.reopened_at)) return false;
        if (channelFilter !== 'all' && c.instance_id !== channelFilter) return false;
        if (deptFilter === 'none' && c.department_id) return false;
        if (deptFilter !== 'all' && deptFilter !== 'none' && c.department_id !== deptFilter) return false;
        if (labelFilter && !(c.labels ?? []).includes(labelFilter)) return false;
        if (!q) return true;
        return (c.contact_name || '').toLowerCase().includes(q) || c.contact_phone.includes(q);
      })
      // Ordem igual ao WhatsApp: mensagem mais recente sempre no topo, sem
      // reordenar por status/urgência (a triagem fica nos filtros e badges de SLA).
      .sort((a, b) => {
        const ta = a.last_message_at || a.created_at;
        const tb = b.last_message_at || b.created_at;
        return tb < ta ? -1 : tb > ta ? 1 : 0;
      });
  }, [conversations, search, filter, channelFilter, deptFilter, statusFilter, labelFilter, selectedId, user?.id]);

  // Não-lidas ignoram conversas bloqueadas: elas saem da fila normal.
  const unreadTotal = useMemo(
    () => conversations.reduce((s, c) => s + (c.is_blocked ? 0 : (c.unread_count || 0)), 0),
    [conversations],
  );

  // Contadores das abas (Fase A): refletem exatamente o que a lista mostraria em
  // cada escopo, aplicando os MESMOS filtros de fila (status/canal/depto/etiqueta/
  // busca) e variando só a dimensão da aba. Antes só excluíam rascunhos, então uma
  // conversa encerrada e atribuída ainda contava em "Minhas" mesmo sumindo da lista
  // sob o filtro "Abertas" (badge "Minhas (1)" com lista vazia).
  const tabCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = conversations.filter(c => {
      if (!c.last_message_at && c.id !== selectedId) return false;
      if (statusFilter === 'open' && c.status === 'closed') return false;
      if (statusFilter === 'closed' && c.status !== 'closed') return false;
      if (statusFilter === 'waiting_you' && convStatus(c).key !== 'waiting_you') return false;
      if (statusFilter === 'waiting_internal' && convStatus(c).key !== 'waiting_internal') return false;
      if (statusFilter === 'reopened' && (c.status === 'closed' || !c.reopened_at)) return false;
      if (channelFilter !== 'all' && c.instance_id !== channelFilter) return false;
      if (deptFilter === 'none' && c.department_id) return false;
      if (deptFilter !== 'all' && deptFilter !== 'none' && c.department_id !== deptFilter) return false;
      if (labelFilter && !(c.labels ?? []).includes(labelFilter)) return false;
      if (q && !((c.contact_name || '').toLowerCase().includes(q) || c.contact_phone.includes(q))) return false;
      return true;
    });
    return {
      all: base.length,
      unread: base.filter(c => !c.is_blocked && c.unread_count > 0).length,
      mine: base.filter(c => c.assigned_user_id === user?.id).length,
    };
  }, [conversations, search, channelFilter, deptFilter, statusFilter, labelFilter, selectedId, user?.id]);

  const anyConnected = channels.some(c => c.status === 'connected');
  const connectedChannels = useMemo(() => channels.filter(c => c.status === 'connected'), [channels]);

  // Badge da aba "WHATSAPP" do widget: usa a MESMA fonte de verdade da tab
  // "Não lidas" da inbox (`tabCounts.unread` = QUANTIDADE de conversas com não
  // lidas, sob os mesmos filtros de fila), e não a soma bruta de mensagens.
  // Assim o número do topo nunca diverge do que a lista mostra.
  useEffect(() => { onUnreadChange?.(tabCounts.unread); }, [tabCounts.unread, onUnreadChange]);

  // Reporta a conversa aberta (deep-link ao maximizar o widget).
  useEffect(() => { onActiveConversationChange?.(selectedId); }, [selectedId, onActiveConversationChange]);

  // Ações operacionais/governança da conversa aberta (accept/assume/release/
  // reopen/unblock, silenciar, limpar, toggles de ausência e guarda jurídica).
  // Os fluxos amarrados a modais (transfer/block/close) permanecem no módulo.
  const {
    handleReopen, handleUnblock, handleAccept, handleAssume, handleRelease,
    muteSelected, unmuteSelected, handleClearConversation,
    handleToggleAbsenceSuppressed, handleToggleLegalHold,
    legalHoldModalOpen, confirmLegalHold, closeLegalHoldModal,
  } = useWaConversationActions({
    selected, user, agentPrefs, staffById, aiSession, confirm,
    setConversations, refreshMessages,
    closeMuteMenu: () => setMuteMenuOpen(false),
    setMessages, setPending, setReplyTo, setEditing, setHasMoreMsgs, oldestTsRef,
  });

  // IA da conversa selecionada: sugerir resposta, classificar assunto, extrair
  // dados — e exportar o histórico. Fonte de handleAiClassify (injetado abaixo
  // no useWaOperationalModals ao encerrar a conversa).
  const {
    suggesting, extracting, extractedData,
    handleSuggestReply, handleAiClassify, handleExtractData, handleExportConversation,
  } = useWaAiActions({
    selectedId, selected, messages, overview, setDraft, loadConversations,
  });

  // Fluxos dos modais operacionais (transfer/block/close/nova conversa/pedir doc)
  // + workspace 360: estado de abertura e callbacks de conclusão que costuram a
  // lista de conversas, o overview e o funil. A classificação por IA ao encerrar
  // (handleAiClassify) é injetada — segue vivendo no módulo (domínio de IA).
  const {
    transferOpen, setTransferOpen,
    newConvOpen, setNewConvOpen,
    blockOpen, setBlockOpen,
    closeOpen, setCloseOpen,
    docRequestOpen, setDocRequestOpen,
    workspace, openWa, closeWa,
    handleConversationOpened,
    onTransferDone, onBlockDone, onCloseDone, onRequestDocCreated, onWorkspaceSaved,
  } = useWaOperationalModals({
    selected, funnelLabels, setConversations, setSelectedId,
    loadConversations, reloadOverview, setOverview,
    classifyOnClose: handleAiClassify,
  });

  // Drag and drop de arquivos na thread → useThreadDragDrop (estado do overlay +
  // handlers). O envio em si (sendFile, staging, retry/resend) vive em useWaComposer.
  const { dragOver, dragProps } = useThreadDragDrop(!!selected && !editing, handleDroppedFiles);

  // Handlers das bolhas com identidade ESTÁVEL: um ref guarda sempre a última
  // implementação (que fecha sobre estado atual), e o objeto exposto à árvore
  // nunca muda — assim o React.memo das bolhas só re-renderiza quando a própria
  // mensagem muda, não a cada render do módulo.
  const bubbleImplRef = useRef<{
    reply: (m: WhatsAppMessage) => void; edit: (m: WhatsAppMessage) => void;
    retry: (m: WhatsAppMessage) => void; discard: (m: WhatsAppMessage) => void;
    resend: (m: WhatsAppMessage) => void; cancel: (m: WhatsAppMessage) => void;
    createDeadline: (m: WhatsAppMessage) => void; createTask: (m: WhatsAppMessage) => void;
  }>(null!);
  bubbleImplRef.current = {
    reply: (m) => { setReplyTo(m); setEditing(null); },
    edit: beginEdit,
    retry: retryPending,
    discard: discardPending,
    resend: (m) => { void resendExisting(m); },
    cancel: (m) => { if (m._tempId) cancelUpload(m._tempId); },
    createDeadline: (m) => setDeadlineSource(m),
    createTask: (m) => setTaskSource(m),
  };
  const bubbleHandlers = useMemo(() => ({
    onReply: (m: WhatsAppMessage) => bubbleImplRef.current.reply(m),
    onEdit: (m: WhatsAppMessage) => bubbleImplRef.current.edit(m),
    onRetry: (m: WhatsAppMessage) => bubbleImplRef.current.retry(m),
    onDiscard: (m: WhatsAppMessage) => bubbleImplRef.current.discard(m),
    onResend: (m: WhatsAppMessage) => bubbleImplRef.current.resend(m),
    onCancel: (m: WhatsAppMessage) => bubbleImplRef.current.cancel(m),
    onCreateDeadline: (m: WhatsAppMessage) => bubbleImplRef.current.createDeadline(m),
    onCreateTask: (m: WhatsAppMessage) => bubbleImplRef.current.createTask(m),
  }), []);

  // Cluster de ações do cabeçalho da lista (status online + sino de notificações
  // + nova conversa). Extraído para reposicionar no modo embutido: lá vai para a
  // linha da busca, eliminando a linha de título "WhatsApp" redundante (o widget
  // já mostra "Mensagens" + aba). Só uma instância é montada por vez.
  const listHeaderActions = (
    <div className="flex items-center gap-2 shrink-0">
      <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: anyConnected ? '#16a34a' : '#9ca3af' }} />
        {anyConnected ? 'Online' : 'Offline'}
      </span>
      <WaNotifyBell pushState={pushState} onTogglePush={toggleStaffPush} />
      {!embedded && (
        <button onClick={() => setShowDashboard(true)} title="Dashboard de atendimento"
          className="flex items-center justify-center w-7 h-7 rounded-full bg-[#f3f2ef] text-slate-600 hover:bg-slate-200 transition">
          <BarChart2 size={15} />
        </button>
      )}
      <button onClick={() => setNewConvOpen(true)} title="Nova conversa"
        className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-600 text-white hover:bg-amber-700 transition active:scale-90 hover:rotate-90 duration-200">
        <Plus size={16} />
      </button>
    </div>
  );

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-[#faf9f7]">
      {/* ── Painel de Leads embutido (funil comercial/jurídico) ──
          A altura segue o CONTEÚDO (sem espaço em branco). A revelação anima por
          max-height (clip, sem reflow do funil); o atendimento é empurrado para
          baixo mas continua visível. Oculto no modo embutido (sem largura). */}
      {!embedded && (<>
      <div
        className={`flex-shrink-0 overflow-hidden bg-[#f5f5f3] transition-[max-height] duration-300 ease-out ${
          leadsPanelOpen ? 'max-h-[480px] border-b border-[#e7e5df]' : 'max-h-0'
        }`}
        aria-hidden={!leadsPanelOpen}
      >
        <div className="max-h-[480px] overflow-y-auto px-3 sm:px-5 py-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Target size={16} className="text-amber-600" />
            <h2 className="text-[14px] font-bold text-slate-800">Funil de Leads</h2>
            <span className="text-[11.5px] text-slate-400">Progressão por etapas do atendimento</span>
            {/* Canal = conta de WhatsApp conectada (filtra por instância). */}
            <label className="inline-flex items-center gap-1.5 ml-auto">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Canal</span>
              <select value={leadChannelFilter} onChange={e => setLeadChannelFilter(e.target.value)}
                className="text-[12px] pl-2 pr-6 py-1 rounded-lg bg-white border border-[#e7e5df] focus:border-amber-300 outline-none">
                <option value="">Todos os canais</option>
                {channels.map(c => (
                  <option key={c.id} value={c.id}>{c.name || c.instance_name}</option>
                ))}
              </select>
            </label>
          </div>
          {/* Quadro do funil por CONVERSA: cada conversa aparece na coluna da sua
              etapa atual. É o que faz a conversa "entrar no Novo" de verdade. */}
          {leadsEverOpened && (
            <ConversationFunnelBoard
              conversations={conversations}
              funnelLabels={funnelLabels}
              channelId={leadChannelFilter}
              onOpen={(id) => { setSelectedId(id); setLeadsPanelOpen(false); }}
              onMoved={(id, labels) => setConversations(prev => prev.map(c => c.id === id ? { ...c, labels } : c))}
            />
          )}
        </div>
      </div>

      {/* Lingueta ancorada no divisor — DESCE junto com o painel (fica logo após
          ele no fluxo; container de altura 0 para não empurrar o atendimento). */}
      <div className="relative z-30 h-0">
        <button
          type="button"
          onClick={() => setLeadsPanelOpen(o => !o)}
          aria-expanded={leadsPanelOpen}
          title={leadsPanelOpen ? 'Recolher funil de Leads' : 'Abrir funil de Leads'}
          className="group absolute left-1/2 -translate-x-1/2 top-0 inline-flex items-center gap-1.5 h-[22px] pl-2.5 pr-2 rounded-b-lg bg-white border border-t-0 border-[#e7e5df] shadow-sm hover:bg-amber-50 transition-colors"
        >
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 group-hover:text-amber-700 transition-colors">
            <Target size={11} />
            Leads
          </span>
          <ChevronDown size={13} className={`text-slate-400 group-hover:text-amber-700 transition-transform duration-300 ${leadsPanelOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      </>)}

      {/* ── Conteúdo principal do módulo (atendimento) ── */}
      <div className="flex flex-1 min-h-0">
      {/* ── Lista de conversas ── */}
      <aside style={isMobile ? undefined : { width: listWidth }}
        className={`flex-shrink-0 flex-col border-r border-[#e7e5df] bg-white min-h-0 ${isMobile ? (selectedId ? 'hidden' : 'flex w-full') : 'flex'}`}>
        <div className={`border-b border-[#e7e5df] ${embedded ? 'px-3 pt-2.5 pb-2' : 'px-4 pt-4 pb-3'}`}>
          {!embedded && (
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <MessageCircle size={18} className="text-amber-600" />
                <h2 className="font-bold text-slate-800 text-[15px]">WhatsApp</h2>
              </div>
              {listHeaderActions}
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar conversa…"
                className={`w-full pl-9 pr-3 text-[13px] rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none ${embedded ? 'py-1.5' : 'py-2'}`} />
            </div>
            {(() => {
              const active = (channelFilter !== 'all' ? 1 : 0) + (deptFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (labelFilter !== '' ? 1 : 0);
              return (
                <button onClick={() => setFiltersOpen(o => !o)} title={filtersOpen ? 'Ocultar filtros' : 'Mostrar filtros'} aria-expanded={filtersOpen}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[12.5px] font-semibold transition ${filtersOpen || active ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-[#f3f2ef] text-slate-600 hover:bg-slate-200'}`}>
                  <Filter size={15} />
                  {active > 0 && <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-amber-600 text-white text-[10px] font-bold">{active}</span>}
                  <ChevronDown size={14} className={`transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
                </button>
              );
            })()}
            {/* No modo embutido as ações (online/sino/nova conversa) vêm para esta
                linha, eliminando a linha de título "WhatsApp" redundante. */}
            {embedded && listHeaderActions}
          </div>

          {filtersOpen && (
          <div className="grid grid-cols-2 gap-2 mt-2.5">
            <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)}
              className="min-w-0 text-[12px] pl-2 pr-6 py-1.5 rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none">
              <option value="all">Todos os canais</option>
              {channels.map(c => <option key={c.id} value={c.id}>{c.name || c.instance_name}</option>)}
            </select>
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
              className="min-w-0 text-[12px] pl-2 pr-6 py-1.5 rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none">
              <option value="all">Todos os setores</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              <option value="none">Sem setor</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
              className="min-w-0 text-[12px] pl-2 pr-6 py-1.5 rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none">
              <option value="all">Todos os status</option>
              <option value="open">Abertas</option>
              <option value="waiting_you">Aguardando você</option>
              <option value="waiting_internal">Aguardando setor</option>
              <option value="reopened">Reabertas</option>
              <option value="closed">Encerradas</option>
            </select>
            <select value={labelFilter} onChange={e => setLabelFilter(e.target.value)}
              className="min-w-0 text-[12px] pl-2 pr-6 py-1.5 rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none">
              <option value="">Todas as etiquetas</option>
              {funnelLabels.map(l => <option key={l.key} value={l.key}>{l.stageLabel} › {l.key}</option>)}
            </select>
          </div>
          )}

          {/* Abas de situação (restauradas): Todas / Não lidas / Minhas */}
          <div className={`flex items-center gap-1 ${embedded ? 'mt-2' : 'mt-2.5'}`}>
            {([
              ['all', `Todas (${tabCounts.all})`],
              ['unread', `Não lidas (${tabCounts.unread})`],
              ['mine', `Minhas (${tabCounts.mine})`],
            ] as [FilterTab, string][])
              .map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)}
                  className={`px-3 py-1 rounded-full text-[12px] font-semibold transition ${filter === key ? 'bg-amber-600 text-white' : 'text-slate-500 hover:bg-[#f3f2ef]'}`}>
                  {label}
                </button>
              ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loadingConvs ? (
            <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-slate-400">
              Nenhuma conversa{search || filter !== 'all' || channelFilter !== 'all' || deptFilter !== 'all' ? ' para este filtro' : ' ainda'}.
            </div>
          ) : filtered.map(c => {
            const st = effectiveConversationStatus(c);
            // "Rascunho:" só nas conversas NÃO abertas (ao trocar/fechar). Na
            // conversa ativa não aparece — você já está vendo o composer.
            const draftPreview = c.id === selectedId ? '' : (draftMap[c.id] ?? '').trim();
            return (
              <ConversationListItem
                key={c.id}
                c={c}
                active={c.id === selectedId}
                channel={c.instance_id ? (channelById.get(c.instance_id) ?? null) : null}
                dept={c.department_id ? (deptById.get(c.department_id) ?? null) : null}
                privateMode={privateMode}
                statusKey={st.key}
                statusLabel={st.label}
                statusCls={st.cls}
                docStatus={effectiveDocStatus(c.client_id)}
                muted={muteStore.isMuted(c.id)}
                draftPreview={draftPreview}
                funnelLabels={funnelLabels}
                onSelect={setSelectedId}
              />
            );
          })}
        </div>
      </aside>

      {/* Divisória arrastável lista ↔ thread (Fase 10.1) */}
      <div onMouseDown={startListResize} title="Arraste para redimensionar"
        className="hidden md:block w-1.5 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-amber-300/60 active:bg-amber-400/70 transition-colors" />

      {/* ── Thread ── */}
      <section className={`relative flex-1 flex-col min-h-0 min-w-0 ${isMobile && !selectedId ? 'hidden' : 'flex'}`}
        {...dragProps}>
        {dragOver && selected && (
          <div className="wa-drop-pulse absolute inset-0 z-30 m-3 rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50/85 backdrop-blur-sm flex flex-col items-center justify-center gap-2 pointer-events-none">
            <Paperclip size={32} className="text-amber-600" />
            <p className="text-[15px] font-bold text-amber-800">Solte para enviar</p>
            <p className="text-[12.5px] text-amber-700/80">Imagens, vídeos, áudios, PDFs e documentos · até 100 MB</p>
          </div>
        )}
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
            <MessageCircle size={40} className="opacity-30 wa-empty-float" />
            <p className="text-[14px]">Selecione uma conversa para começar.</p>
          </div>
        ) : (
          <>
            <header className={`flex items-center gap-2 sm:gap-3 border-b border-[#e7e5df] bg-white ${embedded ? 'px-2.5 py-2' : 'px-2.5 sm:px-5 py-3'}`}>
              {isMobile && (
                <button onClick={() => setSelectedId(null)} title="Voltar à lista"
                  className="flex-shrink-0 -ml-1 w-9 h-9 rounded-lg text-slate-600 hover:bg-[#f3f2ef] flex items-center justify-center transition">
                  <ChevronLeft size={22} />
                </button>
              )}
              <Avatar url={selected.contact_avatar_url} name={selected.contact_name} phone={selected.contact_phone} size={36}
                onClick={selected.contact_avatar_url ? () => setLightbox(selected.contact_avatar_url) : undefined} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold text-slate-800 truncate">{privateMode ? maskName(selected.contact_name) : (selected.contact_name || prettyPhone(selected.contact_phone))}</p>
                <div className="flex items-center flex-nowrap gap-2 min-w-0 overflow-hidden whitespace-nowrap text-[11.5px] text-slate-400">
                  <PresenceText conv={selected} privateMode={privateMode} />
                  {selected.assigned_user_id && <span>· {staffByUser.get(selected.assigned_user_id) || 'Atribuído'}</span>}
                  {selected.department_id && deptById.get(selected.department_id) && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: (deptById.get(selected.department_id)!.color || '#16a34a') + '22', color: deptById.get(selected.department_id)!.color || '#16a34a' }}>
                      {deptById.get(selected.department_id)!.name}
                    </span>
                  )}
                  {(() => {
                    const st = effectiveConversationStatus(selected);
                    const tracked = trackedSignatureStatus(selected.client_id);
                    return (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.cls}`}>
                        {st.label}
                        {tracked && (
                          <button
                            onClick={() => tracked.signature_request_id
                              ? stopSignatureTracking(tracked.signature_request_id)
                              : stopTemplateFillTracking(tracked.link_id)}
                            title="Fechar acompanhamento"
                            className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-white/60 hover:bg-slate-700 hover:text-white transition"
                          >
                            <X size={10} strokeWidth={2.75} />
                          </button>
                        )}
                      </span>
                    );
                  })()}
                  {(() => { const sla = slaSignal(selected); return sla ? (
                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: sla.color }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: sla.color }} /> {sla.label}
                    </span>
                  ) : null; })()}
                  {(() => { const ta = transferAlert(selected); return ta ? (
                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: ta.color }}>
                      <ArrowRightLeft size={11} /> {ta.label}
                    </span>
                  ) : null; })()}
                </div>
              </div>
              {/* Ações em ícone com tooltip — não quebram o layout (Fase 10.1) */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {selected.awaiting_accept && (selected.assigned_user_id === user?.id || !selected.assigned_user_id) && (
                  <button onClick={handleAccept} title="Assumir este atendimento"
                    className={`${isMobile ? 'hidden' : 'inline-flex'} items-center gap-1.5 px-3 h-9 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-[12.5px] font-semibold transition`}>
                    <CheckCircle2 size={15} /> Aceitar
                  </button>
                )}
                {/* Ações inline — só no módulo cheio largo; no widget embutido (estreito,
                    mas viewport desktop) e no mobile, viram o menu "⋮". Usar o flag
                    `isMobile` (consciente do contêiner) em vez de breakpoint de viewport. */}
                <div className={`${isMobile ? 'hidden' : 'flex'} items-center gap-1.5`}>
                {/* Comandos de fila (atribuição direta, sem transferência) */}
                {!selected.is_blocked && selected.status !== 'closed' && !selected.awaiting_accept && selected.assigned_user_id !== user?.id && (
                  <button onClick={handleAssume} title={selected.assigned_user_id ? 'Assumir este atendimento' : 'Assumir da fila'}
                    className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#f3f2ef] hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 flex items-center justify-center transition">
                    <UserPlus size={16} />
                  </button>
                )}
                {!selected.is_blocked && selected.status !== 'closed' && selected.assigned_user_id === user?.id && (
                  <button onClick={handleRelease} title="Devolver à fila"
                    className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#f3f2ef] hover:bg-amber-50 text-slate-600 hover:text-amber-700 flex items-center justify-center transition">
                    <UserMinus size={16} />
                  </button>
                )}
                {/* Silenciar conversa (notificações), estilo WhatsApp */}
                {(() => {
                  const muted = muteStore.isMuted(selected.id);
                  const until = muteStore.mutedUntil(selected.id);
                  const untilLabel = muted
                    ? (until == null ? 'silenciada' : `silenciada até ${new Date(until).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`)
                    : '';
                  return (
                    <div className="relative flex-shrink-0">
                      <button
                        onClick={() => muted ? unmuteSelected() : setMuteMenuOpen(o => !o)}
                        title={muted ? `${untilLabel} — clique para reativar o som` : 'Silenciar conversa'}
                        aria-pressed={muted}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center transition ${muted ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-[#f3f2ef] text-slate-600 hover:bg-amber-50 hover:text-amber-700'}`}>
                        {muted ? <BellOff size={16} /> : <Bell size={16} />}
                      </button>
                      {muteMenuOpen && !muted && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setMuteMenuOpen(false)} />
                          <div className="absolute right-0 top-11 z-50 w-48 rounded-xl bg-white shadow-lg border border-[#e7e5df] py-1.5">
                            <div className="px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Silenciar notificações</div>
                            <button onClick={() => muteSelected(8 * 60 * 60 * 1000, '8 horas')}
                              className="w-full text-left px-3 py-2 text-[13px] text-slate-700 hover:bg-amber-50 transition">8 horas</button>
                            <button onClick={() => muteSelected(7 * 24 * 60 * 60 * 1000, '1 semana')}
                              className="w-full text-left px-3 py-2 text-[13px] text-slate-700 hover:bg-amber-50 transition">1 semana</button>
                            <button onClick={() => muteSelected(null, 'sempre')}
                              className="w-full text-left px-3 py-2 text-[13px] text-slate-700 hover:bg-amber-50 transition">Sempre</button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
                {perms.canTransfer && (
                  <button onClick={() => setTransferOpen(true)} title="Transferir conversa"
                    className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#f3f2ef] hover:bg-amber-50 text-slate-600 hover:text-amber-700 flex items-center justify-center transition">
                    <ArrowRightLeft size={16} />
                  </button>
                )}
                {selected.status === 'closed' ? (
                  <button onClick={handleReopen} title="Reabrir conversa"
                    className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#f3f2ef] hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 flex items-center justify-center transition">
                    <RotateCcw size={16} />
                  </button>
                ) : (
                  <button onClick={() => setCloseOpen(true)} title="Encerrar atendimento"
                    className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#f3f2ef] hover:bg-amber-50 text-slate-600 hover:text-amber-700 flex items-center justify-center transition">
                    <CheckCircle2 size={16} />
                  </button>
                )}
                {/* Limpar conversa (apaga as mensagens; mantém a conversa) */}
                {perms.canBlock && messages.length > 0 && (
                  <button onClick={handleClearConversation} title="Limpar conversa"
                    className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#f3f2ef] hover:bg-red-50 text-slate-600 hover:text-red-600 flex items-center justify-center transition">
                    <Trash2 size={16} />
                  </button>
                )}
                {!panelDocked && (
                  <button onClick={() => setMobilePanelOpen(true)} title="Detalhes do contato"
                    className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#f3f2ef] hover:bg-amber-50 text-slate-600 hover:text-amber-700 flex items-center justify-center transition">
                    <Info size={16} />
                  </button>
                )}
                <button onClick={() => setSelectedId(null)} title="Sair da conversa"
                  className={`flex-shrink-0 w-9 h-9 rounded-lg bg-[#f3f2ef] hover:bg-slate-200 text-slate-600 items-center justify-center transition ${isMobile ? 'hidden' : 'flex'}`}>
                  <X size={16} />
                </button>
                </div>{/* /ações inline */}

                {/* Ação principal contextual no mobile (ao lado do "⋮"): apenas UMA —
                    Aceitar/Assumir enquanto a conversa não é minha; Encerrar depois. */}
                {!selected.is_blocked && (() => {
                  const canAccept = selected.awaiting_accept && (selected.assigned_user_id === user?.id || !selected.assigned_user_id);
                  const canAssume = !selected.awaiting_accept && selected.status !== 'closed' && selected.assigned_user_id !== user?.id;
                  const isMineOpen = !selected.awaiting_accept && selected.status !== 'closed' && selected.assigned_user_id === user?.id;
                  if (canAccept || canAssume) {
                    return (
                      <button onClick={canAccept ? handleAccept : handleAssume} title="Aceitar atendimento"
                        className={`${isMobile ? 'flex' : 'hidden'} flex-shrink-0 w-9 h-9 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 items-center justify-center transition`}>
                        <Check size={18} strokeWidth={2.75} />
                      </button>
                    );
                  }
                  if (isMineOpen) {
                    return (
                      <button onClick={() => setCloseOpen(true)} title="Encerrar atendimento"
                        className={`${isMobile ? 'flex' : 'hidden'} flex-shrink-0 w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 items-center justify-center transition`}>
                        <CheckCircle2 size={18} />
                      </button>
                    );
                  }
                  return null;
                })()}

                {/* Menu "⋮" — agrupa as ações no widget embutido e no mobile */}
                <div className={`${isMobile ? 'block' : 'hidden'} relative flex-shrink-0`}>
                  <button onClick={() => setHeaderMenuOpen(o => !o)} title="Mais ações" aria-haspopup="menu" aria-expanded={headerMenuOpen}
                    className="w-9 h-9 rounded-lg bg-[#f3f2ef] text-slate-600 hover:bg-slate-200 flex items-center justify-center transition">
                    <MoreVertical size={18} />
                  </button>
                  {headerMenuOpen && (() => {
                    const muted = muteStore.isMuted(selected.id);
                    const item = 'w-full flex items-center gap-2.5 px-3 py-2.5 text-[13.5px] text-slate-700 hover:bg-amber-50 transition text-left';
                    const run = (fn: () => void) => () => { setHeaderMenuOpen(false); fn(); };
                    return (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setHeaderMenuOpen(false)} />
                        <div role="menu" className="absolute right-0 top-11 z-50 w-56 rounded-xl bg-white shadow-xl border border-[#e7e5df] py-1.5 overflow-hidden">
                          {!panelDocked && (
                            <button className={item} onClick={run(() => setMobilePanelOpen(true))}><Info size={16} className="text-slate-400" /> Detalhes do contato</button>
                          )}
                          {!selected.is_blocked && selected.status !== 'closed' && !selected.awaiting_accept && selected.assigned_user_id !== user?.id && (
                            <button className={item} onClick={run(handleAssume)}><UserPlus size={16} className="text-emerald-500" /> {selected.assigned_user_id ? 'Assumir atendimento' : 'Assumir da fila'}</button>
                          )}
                          {!selected.is_blocked && selected.status !== 'closed' && selected.assigned_user_id === user?.id && (
                            <button className={item} onClick={run(handleRelease)}><UserMinus size={16} className="text-amber-500" /> Devolver à fila</button>
                          )}
                          <button className={item} onClick={run(() => muted ? unmuteSelected() : muteSelected(null, 'sempre'))}>
                            {muted ? <Bell size={16} className="text-amber-500" /> : <BellOff size={16} className="text-slate-400" />} {muted ? 'Reativar som' : 'Silenciar conversa'}
                          </button>
                          {perms.canTransfer && (
                            <button className={item} onClick={run(() => setTransferOpen(true))}><ArrowRightLeft size={16} className="text-slate-400" /> Transferir conversa</button>
                          )}
                          {selected.status === 'closed' ? (
                            <button className={item} onClick={run(handleReopen)}><RotateCcw size={16} className="text-emerald-500" /> Reabrir conversa</button>
                          ) : (
                            <button className={item} onClick={run(() => setCloseOpen(true))}><CheckCircle2 size={16} className="text-emerald-500" /> Encerrar atendimento</button>
                          )}
                          {perms.canBlock && messages.length > 0 && (
                            <button className={`${item} text-red-600 hover:bg-red-50`} onClick={run(handleClearConversation)}><Trash2 size={16} /> Limpar conversa</button>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </header>

            {selected.client_id && <ConversationSummaryBanner embedded={embedded} overview={overview} docStatus={effectiveDocStatus(selected.client_id)} clientId={selected.client_id} onOpenWorkspace={openWa} onDismissDocReady={() => dismissDocReady(selected.client_id!)} onDismissTemplateFill={stopTemplateFillTracking} />}

            {/* Fase J: banner de sessão de IA ativa */}
            {aiSession?.status === 'active' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 16px', background: '#ede9fe', borderBottom: '1px solid #ddd6fe' }}>
                <Bot size={15} style={{ color: '#7c3aed', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#5b21b6' }}>Assistente IA em atendimento</span>
                  <span style={{ fontSize: '11.5px', color: '#6d28d9', marginLeft: '8px' }}>
                    {aiSession.turn_count} turno{aiSession.turn_count !== 1 ? 's' : ''} · passo {aiSession.current_step}
                    {Object.keys(aiSession.collected_data || {}).length > 0 && ` · ${Object.keys(aiSession.collected_data).length} dado${Object.keys(aiSession.collected_data).length !== 1 ? 's' : ''} coletado${Object.keys(aiSession.collected_data).length !== 1 ? 's' : ''}`}
                  </span>
                </div>
                <button
                  onClick={handleAssume}
                  style={{ flexShrink: 0, padding: '4px 10px', borderRadius: '7px', background: '#7c3aed', color: '#fff', border: 'none', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer' }}>
                  Assumir atendimento
                </button>
              </div>
            )}
            {/* Fase O: banner de aprovação de resposta IA pendente */}
            {aiSession?.status === 'pending_approval' && aiSession.pending_ai_reply && (
              <AiApprovalBanner
                session={aiSession}
                onDone={async () => {
                  const s = await whatsappService.getAiSession(selectedId!);
                  setAiSession(s);
                }}
              />
            )}
            {aiSession && aiSession.status === 'handed_off' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 16px', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
                <Bot size={13} style={{ color: '#16a34a', flexShrink: 0 }} />
                <span style={{ fontSize: '11.5px', color: '#15803d', fontWeight: 600 }}>IA concluída — dados coletados disponíveis nas notas internas.</span>
              </div>
            )}

            <div ref={setThreadEl} onScroll={onThreadScroll} className="flex-1 overflow-y-auto min-h-0" style={{ background: '#F8F9FA' }}>
              <div ref={threadContentRef} className="px-3 sm:px-5 py-4 space-y-1.5">
              {loadingMsgs ? (
                <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
              ) : (() => {
                let prevDay = '';
                return (<>
                  {/* Botão de paginação: carrega bloco anterior de mensagens (Fase D) */}
                  {hasMoreMsgs && (
                    <div className="flex justify-center pb-2">
                      <button onClick={loadMoreMsgs} disabled={loadingMore}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11.5px] font-semibold text-slate-500 bg-white shadow-sm border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition">
                        {loadingMore ? <Loader2 size={12} className="animate-spin" /> : <ChevronUp size={12} />}
                        {loadingMore ? 'Carregando…' : 'Carregar mensagens anteriores'}
                      </button>
                    </div>
                  )}
                  {/* Álbuns/bolhas a partir do agrupamento memoizado (messageUnits) */}
                  {messageUnits.map(u => {
                      const head = u.kind === 'album' ? u.items[0] : u.m;
                      const day = new Date(head.wa_timestamp).toDateString();
                      const showDivider = day !== prevDay;
                      prevDay = day;
                      const senderName = head.direction === 'out' && head.sender_user_id ? (agentLabel(staffById.get(head.sender_user_id)) || staffByUser.get(head.sender_user_id) || null) : null;
                      return (
                        <React.Fragment key={u.kind === 'album' ? `album-${head._tempId || head.id}` : (head._tempId || head.id)}>
                          {showDivider && <DateDivider label={dayLabel(head.wa_timestamp)} />}
                          {u.kind === 'album' ? (
                            <ImageAlbum items={u.items} out={head.direction === 'out'} senderName={senderName} onOpenImage={setLightbox} />
                          ) : (
                            <MessageBubble
                              m={u.m}
                              repliedTo={u.m.reply_to_id ? msgById.get(u.m.reply_to_id) || null : null}
                              senderName={senderName}
                              senderRole={u.m.direction === 'out' && u.m.sender_user_id ? (staffById.get(u.m.sender_user_id)?.role || null) : null}
                              privateMode={privateMode}
                              canCreateFollowups={!!selected?.client_id}
                              onOpenImage={setLightbox}
                              uploadProgress={u.m._tempId ? uploadProgress.get(u.m._tempId) : undefined}
                              {...bubbleHandlers}
                            />
                          )}
                        </React.Fragment>
                      );
                  })}
                  <ThreadScheduledGhosts conversationId={selected.id} privateMode={privateMode} confirm={confirm} />
                </>);
              })()}
              </div>
            </div>

            {/* Banner de reply / edição */}
            {(replyTo || editing) && !selected.is_blocked && (
              <div className="px-4 pt-2 bg-white">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border-l-2 border-amber-500">
                  {editing ? <Pencil size={14} className="text-amber-600 flex-shrink-0" /> : <CornerUpLeft size={14} className="text-amber-600 flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold text-amber-700">{editing ? 'Editando mensagem' : `Respondendo${(replyTo!.direction === 'out') ? ' você' : ''}`}</p>
                    <p className="text-[12px] text-slate-600 truncate">{(editing || replyTo)!.content || typeLabel((editing || replyTo)!.type)}</p>
                  </div>
                  <button onClick={() => { setReplyTo(null); setEditing(null); if (editing) setDraft(''); }} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                </div>
              </div>
            )}

            {/* Aviso de conversa encerrada (Fase 3) */}
            {!selected.is_blocked && selected.status === 'closed' && (
              <div className="px-4 pt-2 bg-white">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 border-l-2 border-slate-400">
                  <CheckCircle2 size={14} className="text-slate-500 flex-shrink-0" />
                  <p className="flex-1 text-[12px] text-slate-600">
                    Atendimento encerrado{selected.closure_reason ? ` — ${selected.closure_reason}` : ''}. Reabre sozinho se o cliente voltar a falar.
                  </p>
                  <button onClick={handleReopen}
                    className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 hover:underline">
                    <RotateCcw size={12} /> Reabrir
                  </button>
                </div>
              </div>
            )}

            {/* Fase N: aviso de fora do horário — oculto quando pausado nesta conversa */}
            {outsideHours && !selected.is_blocked && !selected.absence_suppressed && (
              <div className="px-4 py-2 border-t border-amber-200 bg-amber-50 flex items-center gap-2">
                <Clock size={14} className="text-amber-600 flex-shrink-0" />
                <p className="flex-1 text-[12px] text-amber-800">{outsideHours.message}</p>
                <button onClick={() => setOutsideHours(null)}
                  className="flex-shrink-0 text-amber-400 hover:text-amber-700 text-[12px]">✕</button>
              </div>
            )}

            {/* Composer (ou aviso de bloqueio) */}
            {selected.is_blocked ? (
              <div className="px-4 py-3 border-t border-[#e7e5df] bg-red-50/60 flex items-center gap-3">
                <Ban size={16} className="text-red-500 flex-shrink-0" />
                <p className="flex-1 text-[12.5px] text-red-700">
                  Contato bloqueado{selected.blocked_reason ? ` — ${selected.blocked_reason}` : ''}. Desbloqueie para enviar mensagens.
                </p>
                <button onClick={handleUnblock}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-600 text-[12.5px] font-semibold hover:bg-red-100 transition">
                  <ShieldOff size={14} /> Desbloquear
                </button>
              </div>
            ) : (
            <div className="relative px-2.5 sm:px-4 py-3 border-t border-[#e7e5df] bg-white">
              {recording ? (
                <div className="flex items-center gap-2.5">
                  {/* Keyframes do equalizador (escopo local, estilo WhatsApp) */}
                  <style>{`@keyframes waEq{0%,100%{transform:scaleY(0.25)}50%{transform:scaleY(1)}}`}</style>
                  {/* Lixeira = cancelar e descartar a gravação */}
                  <button onClick={() => stopRecording(false)} title="Cancelar gravação"
                    className="flex-shrink-0 w-9 h-9 rounded-full text-red-500 hover:bg-red-50 flex items-center justify-center transition">
                    <Trash2 size={18} />
                  </button>
                  {/* Pílula com ponto pulsante + onda animada + cronômetro */}
                  <div className="flex-1 min-w-0 flex items-center gap-2.5 px-3.5 h-10 rounded-full bg-[#f3f2ef]">
                    <span className="flex-shrink-0 w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
                    <div className="flex-1 min-w-0 flex items-center justify-center gap-[3px] h-5 overflow-hidden">
                      {WA_REC_BARS.map((h, i) => (
                        <span key={i} className="w-[3px] flex-shrink-0 rounded-full bg-red-400/80"
                          style={{ height: '100%', transformOrigin: 'center', transform: `scaleY(${h})`, animation: 'waEq 0.9s ease-in-out infinite', animationDelay: `${i * 70}ms` }} />
                      ))}
                    </div>
                    <span className="flex-shrink-0 text-[13px] font-semibold text-red-600 tabular-nums">
                      {String(Math.floor(recSeconds / 60)).padStart(2, '0')}:{String(recSeconds % 60).padStart(2, '0')}
                    </span>
                  </div>
                  {/* Enviar o áudio */}
                  <button onClick={() => stopRecording(true)} title="Enviar áudio"
                    className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-600 text-white flex items-center justify-center hover:bg-amber-700 transition">
                    <Send size={16} />
                  </button>
                </div>
              ) : (
                <>
                {!editing && (
                  <>
                    <input ref={imgInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={e => onPickFiles(e, 'media')} />
                    <input ref={docInputRef} type="file" className="hidden" onChange={e => onPickFiles(e, 'document')} />
                    {/* Backdrop p/ fechar o widget flutuante ao tocar fora */}
                    {attachMenuOpen && <div className="fixed inset-0 z-20" onClick={() => setAttachMenuOpen(false)} />}
                    {/* Widget flutuante de ações (anexos/IA), à direita — a barra de digitação fica só com texto + áudio */}
                    <div className="absolute right-2.5 sm:right-4 bottom-full mb-2 z-30 flex flex-col items-end gap-2">
                      {attachMenuOpen && (() => {
                        const row = 'w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-[13.5px] font-medium text-slate-700 hover:bg-amber-50 transition disabled:opacity-50';
                        const dot = 'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0';
                        const run = (fn: () => void) => () => { setAttachMenuOpen(false); fn(); };
                        return (
                          <div className="w-60 rounded-2xl bg-white shadow-[0_12px_40px_-8px_rgba(15,23,42,0.25)] ring-1 ring-black/5 p-1.5 origin-bottom-right animate-[waPop_120ms_ease-out]">
                            <style>{`@keyframes waPop{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}`}</style>
                            <button className={row} onClick={run(() => imgInputRef.current?.click())}><span className={`${dot} bg-amber-100 text-amber-700`}><ImageIcon size={17} /></span> Imagem ou vídeo</button>
                            <button className={row} onClick={run(() => docInputRef.current?.click())}><span className={`${dot} bg-amber-100 text-amber-700`}><Paperclip size={17} /></span> Documento</button>
                            <button className={row} onClick={run(() => setTemplateOpen(true))}><span className={`${dot} bg-amber-100 text-amber-700`}><MessageSquare size={17} /></span> Modelo de mensagem</button>
                            {perms.canSchedule && (
                              <button className={row} onClick={run(() => setScheduleOpen(true))}><span className={`${dot} bg-amber-100 text-amber-700`}><CalendarClock size={17} /></span> Agendar mensagem</button>
                            )}
                            {messages.length > 0 && (
                              <button className={row} disabled={suggesting} onClick={run(handleSuggestReply)}><span className={`${dot} bg-violet-100 text-violet-600`}>{suggesting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={17} />}</span> Sugerir com IA</button>
                            )}
                          </div>
                        );
                      })()}
                      <button onClick={() => setAttachMenuOpen(o => !o)} title="Anexos e ações" aria-haspopup="menu" aria-expanded={attachMenuOpen}
                        className="w-10 h-10 rounded-full bg-amber-600 text-white shadow-lg shadow-amber-600/25 flex items-center justify-center hover:bg-amber-700 transition">
                        <Plus size={20} className={`transition-transform duration-200 ${attachMenuOpen ? 'rotate-45' : ''}`} />
                      </button>
                    </div>
                  </>
                )}
                <div className="flex items-end gap-2">
                  <div className="relative flex-1">
                    {/* Menu do atalho "/" — modelos de mensagem (estilo WhatsApp) */}
                    {slashActive && (
                      <div className="absolute bottom-full left-0 right-0 mb-2 z-30 rounded-xl border border-[#e7e5df] bg-white shadow-xl overflow-hidden">
                        <div className="px-3 py-1.5 bg-[#f0f2f5] text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          <MessageSquare size={11} /> Modelos {slashMatch![1] ? `· /${slashMatch![1]}` : '· digite para filtrar'}
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          {slashResults.map((t, i) => (
                            <button key={t.id} onMouseEnter={() => setSlashIndex(i)} onClick={() => applyTemplate(t)}
                              className={`w-full text-left px-3 py-2 transition ${i === slashIdx ? 'bg-[#00a884]/10' : 'hover:bg-slate-50'}`}>
                              <p className="text-[12.5px] font-semibold text-slate-700"><span className="text-[#00a884]">/</span>{t.name}</p>
                              <p className="text-[11.5px] text-slate-500 line-clamp-1 whitespace-pre-wrap break-words">
                                {t.kind === 'kit'
                                  ? `Kit de preenchimento e assinatura · gera link único /#/preencher/...`
                                  : renderTemplate(t.body, templateCtx)}
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <textarea ref={draftRef} value={draft} onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => {
                        if (slashActive) {
                          if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => Math.min(i + 1, slashResults.length - 1)); return; }
                          if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => Math.max(i - 1, 0)); return; }
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyTemplate(slashResults[slashIdx]); return; }
                          if (e.key === 'Escape') { e.preventDefault(); setDraft(''); return; }
                        }
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                        if (e.key === 'Escape') { setEditing(null); setReplyTo(null); }
                      }}
                      rows={1} placeholder={editing ? 'Editar mensagem…' : 'Digite uma mensagem…'}
                      className="w-full resize-none max-h-48 min-h-[40px] leading-5 px-3.5 py-2.5 text-[13.5px] rounded-xl bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none" />
                  </div>
                  {draft.trim() || editing ? (
                    <button onClick={handleSend} disabled={sending || !draft.trim()}
                      className={`flex-shrink-0 w-10 h-10 rounded-full bg-amber-600 text-white flex items-center justify-center hover:bg-amber-700 hover:scale-105 disabled:opacity-40 transition active:scale-90 ${sending ? '' : 'wa-send-ready'}`}>
                      {sending ? <Loader2 size={16} className="animate-spin" /> : editing ? <Check size={18} /> : <Send size={16} />}
                    </button>
                  ) : (
                    <button title="Gravar áudio" onClick={startRecording}
                      className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-600 text-white flex items-center justify-center hover:bg-amber-700 hover:scale-105 transition active:scale-90">
                      <Mic size={18} />
                    </button>
                  )}
                </div>
                </>
              )}
            </div>
            )}
          </>
        )}
      </section>

      {/* ── Painel do contato ── */}
      {selected && (
        <div onMouseDown={startPanelResize} title="Arraste para redimensionar"
          className="hidden xl:block w-1.5 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-amber-300/60 active:bg-amber-400/70 transition-colors" />
      )}
      {/* Fundo escurecido da gaveta (apenas quando o painel não está fixo) */}
      {selected && !panelDocked && mobilePanelOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" onClick={() => setMobilePanelOpen(false)} />
      )}
      {selected && (
        <aside style={panelDocked ? { width: panelWidth } : undefined}
          className={`flex-shrink-0 flex flex-col gap-3 overflow-y-auto min-h-0 border-l border-[#e7e5df] bg-white p-3.5 pb-24 ${
            panelDocked
              ? ''
              : `fixed top-0 right-0 bottom-0 z-50 w-[88%] max-w-[360px] shadow-2xl transition-transform duration-200 ${mobilePanelOpen ? 'translate-x-0' : 'translate-x-full'}`
          }`}>
          {/* Botão de fechar (apenas no modo gaveta, fora do desktop) */}
          {!panelDocked && (
            <div className="flex justify-end -mb-1">
              <button onClick={() => setMobilePanelOpen(false)} title="Fechar detalhes"
                className="w-8 h-8 rounded-lg text-slate-500 hover:bg-[#f3f2ef] flex items-center justify-center transition">
                <X size={18} />
              </button>
            </div>
          )}
          {/* Header compacto: avatar + nome + telefone numa linha */}
          <div className="flex items-center gap-2.5 pb-3 border-b border-[#f1f0ec]">
            <Avatar url={selected.contact_avatar_url} name={selected.contact_name} phone={selected.contact_phone} size={40}
              onClick={selected.contact_avatar_url ? () => setLightbox(selected.contact_avatar_url) : undefined} />
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-slate-800 truncate leading-tight">{privateMode ? maskName(selected.contact_name) : (selected.contact_name || 'Contato')}</p>
              <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                <Phone size={11} className="text-slate-300 flex-shrink-0" /> {privateMode ? maskPhoneFull() : prettyPhone(selected.contact_phone)}
              </p>
            </div>
          </div>

          {/* Atendimento: Responsável; Setor + Etiqueta lado a lado; transferir */}
          <div className="space-y-1.5">
            <div className="min-w-0">
              <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Responsável</p>
              <p className="text-[12px] font-semibold text-slate-700 truncate">{selected.assigned_user_id ? (staffByUser.get(selected.assigned_user_id) || '—') : 'Ninguém'}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 items-start">
              <div className="min-w-0">
                <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Setor</p>
                <p className="text-[12px] font-semibold text-slate-700 truncate">{selected.department_id ? (deptById.get(selected.department_id)?.name || '—') : 'Nenhum'}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Etiquetas</p>
                <ConversationLabelsPanel
                  conversation={selected}
                  funnelLabels={funnelLabels}
                  onChanged={conv => setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, labels: conv.labels } : c))}
                />
              </div>
            </div>
            <button onClick={() => setTransferOpen(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 py-1 rounded-md border border-[#e7e5df] text-[11px] font-semibold text-slate-500 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200 transition">
              <ArrowRightLeft size={12} /> Transferir conversa
            </button>
          </div>

          {/* Ações da conversa (movidas do cabeçalho para não poluir a barra) */}
          <div className="space-y-1.5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Ações</p>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => setTimelineOpen(true)} title="Histórico da conversa"
                className="flex items-center justify-center gap-1 py-1.5 rounded-md bg-[#f3f2ef] text-slate-500 hover:bg-slate-200 text-[10.5px] font-semibold transition">
                <History size={13} /> Histórico
              </button>
              <button onClick={() => setTemplateOpen(true)} title="Usar modelo de mensagem"
                className="flex items-center justify-center gap-1 py-1.5 rounded-md bg-[#f3f2ef] text-slate-500 hover:bg-slate-200 text-[10.5px] font-semibold transition">
                <MessageSquare size={13} /> Modelos
              </button>
              {selected.client_id && (
                <button onClick={() => setSummaryOpen(true)} title="Resumo por IA"
                  className="flex items-center justify-center gap-1 py-1.5 rounded-md bg-[#f3f2ef] text-slate-500 hover:bg-violet-50 hover:text-violet-600 text-[10.5px] font-semibold transition">
                  <Sparkles size={13} /> Resumo IA
                </button>
              )}
              {messages.length > 0 && (
                <button onClick={handleExportConversation} title="Exportar histórico (.txt)"
                  className="flex items-center justify-center gap-1 py-1.5 rounded-md bg-[#f3f2ef] text-slate-500 hover:bg-slate-200 text-[10.5px] font-semibold transition">
                  <Download size={13} /> Exportar
                </button>
              )}
              {selected.is_blocked ? (
                perms.canBlock && (
                  <button onClick={handleUnblock} title="Desbloquear contato"
                    className="flex items-center justify-center gap-1 py-1.5 rounded-md bg-red-50 text-red-600 hover:bg-red-100 text-[10.5px] font-semibold transition">
                    <ShieldOff size={13} /> Desbloquear
                  </button>
                )
              ) : (
                perms.canBlock && (
                  <button onClick={() => setBlockOpen(true)} title="Bloquear contato"
                    className="flex items-center justify-center gap-1 py-1.5 rounded-md bg-[#f3f2ef] text-slate-500 hover:bg-red-50 hover:text-red-600 text-[10.5px] font-semibold transition">
                    <Ban size={13} /> Bloquear
                  </button>
                )
              )}
            </div>
          </div>

          {/* Assunto detectado pela IA (somente leitura; preenchido ao encerrar o atendimento) */}
          {selected.contact_reason && (
            <div className="space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Sparkles size={10} className="text-violet-500" /> Assunto (IA)
              </p>
              <p className="text-[12.5px] text-slate-700 break-words">{selected.contact_reason}</p>
            </div>
          )}

          {/* Fase K: extração de dados por IA */}
          {messages.length >= 2 && (
            <div className="space-y-1.5">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                Dados extraídos
                <button onClick={handleExtractData} disabled={extracting} title="Extrair dados estruturados da conversa com IA"
                  className="ml-auto inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold text-violet-600 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 transition">
                  {extracting ? <Loader2 size={8} className="animate-spin" /> : <Sparkles size={8} />} Extrair
                </button>
              </p>
              {extractedData && (
                Object.keys(extractedData).length === 0 ? (
                  <p className="text-[11.5px] text-slate-400">Nenhum dado estruturado identificado.</p>
                ) : (
                  <div className="rounded-lg border border-violet-100 bg-violet-50/40 px-2.5 py-2 space-y-1">
                    {Object.entries(extractedData).map(([k, v]) => (
                      <div key={k} className="flex gap-1.5 text-[11.5px]">
                        <span className="font-semibold text-slate-500 capitalize min-w-[60px]">{k}:</span>
                        <span className="text-slate-700 break-words">{v}</span>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          )}

          {/* Fase K: checklist de pendências do playbook IA */}
          {aiSession?.status === 'active' && aiSession.playbook_id && (() => {
            const collected = aiSession.collected_data || {};
            const missing = Object.keys(collected).length === 0 ? [] : [];
            // Show what's been collected so far
            const keys = Object.keys(collected);
            if (keys.length === 0) return null;
            return (
              <div className="space-y-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <Bot size={10} /> IA coletou
                </p>
                <div className="rounded-lg border border-violet-100 bg-violet-50/30 px-2.5 py-2 space-y-1">
                  {keys.map(k => (
                    <div key={k} className="flex gap-1.5 items-start text-[11px]">
                      <Check size={10} className="text-violet-500 mt-0.5 flex-shrink-0" />
                      <span className="text-slate-700 break-words"><span className="font-semibold capitalize">{k}:</span> {collected[k]}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Perfil/cliente sempre visível — vincular, desvincular, editar e ver cadastro acessíveis */}
          <ClientLinkPanel
            conversation={selected}
            onChanged={loadConversations}
            onOpenWorkspace={openWa}
          />

          {/* Notas internas sempre visíveis — adicionar comentário rápido para a equipe */}
          <InternalNotesSection conversationId={selected.id} staffByUser={staffByUser} currentUserId={user?.id ?? null} confirm={confirm} />

          <ScheduledMessagesPanel conversationId={selected.id} canSchedule={perms.canSchedule} confirm={confirm} />

          {/* 360: Ações do cliente — tudo vinculado ao cliente desta conversa */}
          {selected.client_id && (
            <div className="space-y-1.5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Ações rápidas</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { label: 'Lançamento', icon: <HandCoins size={15} />, on: () => openWa({ type: 'financial_create', clientId: selected.client_id!, clientName: selected.contact_name || undefined }) },
                { label: 'Prazo', icon: <Clock size={15} />, on: () => openWa({ type: 'deadline_create', clientId: selected.client_id! }) },
                { label: 'Agenda', icon: <Calendar size={15} />, on: () => openWa({ type: 'calendar_create', clientId: selected.client_id! }) },
                { label: 'Documento', icon: <FileText size={15} />, on: () => openWa({ type: 'document_generate', clientId: selected.client_id!, clientName: selected.contact_name || undefined, processCode: (overview?.processes ?? [])[0]?.process_code }) },
                { label: 'Pedir doc.', icon: <FilePlus size={15} />, on: () => setDocRequestOpen(true) },
              ].map(a => (
                <button key={a.label} onClick={a.on}
                  className="flex flex-col items-center gap-1 px-1 py-1.5 rounded-lg border border-[#e7e5df] text-slate-600 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700 transition">
                  <span className="text-amber-600">{a.icon}</span>
                  <span className="text-[10px] font-semibold leading-none">{a.label}</span>
                </button>
              ))}
            </div>
            </div>
          )}

          {/* 360: Casos (processos + requerimentos) com ações inline */}
          {selected.client_id && (
            <CasosPanel
              clientId={selected.client_id}
              clientName={selected.contact_name || undefined}
              processes={overview?.processes ?? null}
              pendings={overview?.pendings ?? null}
              onOpenWorkspace={openWa}
            />
          )}

          {/* 360: Prazos (lista; criar pela barra de ações do cliente) */}
          {selected.client_id && <ClientAgendaPanel schedule={overview?.schedule ?? null} />}

          {selected.client_id && <ClientPendingsPanel pendings={overview?.pendings ?? null} confirm={confirm} onChanged={reloadOverview} />}
          {selected.client_id && <ClientCloudDocsLink clientId={selected.client_id} clientName={selected.contact_name || undefined} />}
          {selected.client_id && <ClientFillLinksPanel links={overview?.templateFillLinks ?? null} signatures={overview?.signatures ?? null} onStopTracking={stopTemplateFillTracking} />}
          {selected.client_id && <ClientSignaturesPanel signatures={overview?.signatures ?? null} links={overview?.templateFillLinks ?? null} onStopTracking={stopTemplateFillTracking} onStopSignatureTracking={stopSignatureTracking} />}

          {/* 360: Financeiro — acordos clicáveis abrem detalhes em modal */}
          {selected.client_id && (
            <ClientAgreementsPanel
              agreements={overview?.agreements ?? null}
              onOpenWorkspace={openWa}
            />
          )}

          {/* Fase L: Governança — rodapé compacto */}
          <div className="space-y-1.5 pt-2 border-t border-[#f1f0ec]">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Governança</p>
            <div className="grid grid-cols-2 gap-1.5">
              {/* Modo privado: mascara CPF/telefone no conteúdo visível */}
              <button onClick={() => setPrivateMode(v => !v)}
                className={`flex items-center justify-center gap-1 py-1.5 rounded-md text-[10.5px] font-semibold transition ${
                  privateMode
                    ? 'bg-slate-800 text-white'
                    : 'bg-[#f3f2ef] text-slate-500 hover:bg-slate-200'
                }`}>
                {privateMode ? <EyeOff size={12} /> : <Eye size={12} />}
                {privateMode ? 'Privado ativo' : 'Modo privado'}
              </button>
              {/* Guarda jurídica: impede purga pela política de retenção */}
              <button onClick={handleToggleLegalHold}
                className={`flex items-center justify-center gap-1 py-1.5 rounded-md text-[10.5px] font-semibold transition ${
                  selected.legal_hold
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-[#f3f2ef] text-slate-500 hover:bg-amber-50 hover:text-amber-700'
                }`}>
                {selected.legal_hold ? <ShieldCheck size={12} /> : <Shield size={12} />}
                {selected.legal_hold ? 'Guarda ativa' : 'Guarda jur.'}
              </button>
            </div>
            {selected.legal_hold && selected.legal_hold_reason && (
              <p className="text-[10px] text-amber-700 px-0.5">{selected.legal_hold_reason}</p>
            )}
            {/* Aviso fora do horário: pausa a auto-mensagem comercial só nesta conversa */}
            <button onClick={handleToggleAbsenceSuppressed}
              className={`w-full flex items-center justify-center gap-1 py-1.5 rounded-md text-[10.5px] font-semibold transition ${
                selected.absence_suppressed
                  ? 'bg-violet-100 text-violet-800 border border-violet-300'
                  : 'bg-[#f3f2ef] text-slate-500 hover:bg-violet-50 hover:text-violet-700'
              }`}>
              {selected.absence_suppressed ? <ShieldOff size={12} /> : <Clock3 size={12} />}
              {selected.absence_suppressed ? 'Aviso de horário pausado' : 'Pausar aviso de horário'}
            </button>
            {selected.absence_suppressed && (
              <p className="text-[10px] text-violet-700 px-0.5">A mensagem fora do horário não será enviada até encerrar este atendimento.</p>
            )}
          </div>
        </aside>
      )}
      {/* ── fim do conteúdo principal do atendimento ── */}
      </div>

      {transferOpen && selected && (
        <TransferModal
          conversation={selected}
          departments={departments}
          staff={staff}
          onClose={() => setTransferOpen(false)}
          onDone={onTransferDone}
        />
      )}

      {newConvOpen && (
        <NewConversationModal
          channels={connectedChannels}
          onClose={() => setNewConvOpen(false)}
          onOpened={handleConversationOpened}
        />
      )}

      {timelineOpen && selected && (
        <ConversationTimelineModal
          conversation={selected}
          staffByUser={staffByUser}
          onClose={() => setTimelineOpen(false)}
        />
      )}

      {attachStaged && selected && (
        <AttachmentPreviewModal
          files={attachStaged}
          onClose={() => setAttachStaged(null)}
          onConfirm={confirmStagedSend}
        />
      )}

      {confirmPending && <ConfirmDialog opts={confirmPending} onResolve={resolveConfirm} />}

      {/* WhatsApp 360: workspace modal para criar/editar entidades do CRM sem sair da conversa */}
      <WaWorkspaceRenderer
        modal={workspace}
        onClose={closeWa}
        onSaved={onWorkspaceSaved}
      />

      {templateOpen && selected && (
        <TemplatePickerModal
          context={templateCtx}
          onClose={() => { setTemplateOpen(false); reloadTemplates(); }}
          onPick={(text) => { setDraft(d => d ? `${d} ${text}` : text); setTemplateOpen(false); reloadTemplates(); }}
        />
      )}

      {scheduleOpen && selected && (
        <ScheduleMessageModal
          conversation={selected}
          initialText={draft}
          onClose={() => setScheduleOpen(false)}
          onDone={() => { setScheduleOpen(false); setDraft(''); }}
        />
      )}

      {blockOpen && selected && (
        <BlockContactModal
          conversation={selected}
          onClose={() => setBlockOpen(false)}
          onDone={onBlockDone}
        />
      )}

      {closeOpen && selected && (
        <CloseConversationModal
          conversation={selected}
          agent={user ? staffById.get(user.id) : null}
          onClose={() => setCloseOpen(false)}
          onDone={onCloseDone}
        />
      )}

      {legalHoldModalOpen && selected && (
        <LegalHoldModal
          subtitle={selected.contact_name || prettyPhone(selected.contact_phone)}
          onClose={closeLegalHoldModal}
          onConfirm={confirmLegalHold}
        />
      )}

      {lightbox && (
        <WaLightbox image={lightbox} images={lightboxImages} onClose={() => setLightbox(null)} onNavigate={setLightbox} />
      )}

      {/* Fase M: dashboard de atendimento (oculto no modo embutido) */}
      {!embedded && showDashboard && (
        <AttendanceDashboard onClose={() => setShowDashboard(false)} />
      )}

      {/* Fase M: modal de resumo automático por IA */}
      {summaryOpen && selected && (
        <ConversationSummaryModal
          conversation={selected}
          staffByUser={staffByUser}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      {/* Fase I: modal de solicitação de documento */}
      {docRequestOpen && selected && selected.client_id && (
        <RequestDocumentModal
          conversationId={selected.id}
          clientId={selected.client_id}
          clientName={selected.contact_name}
          createdBy={user?.id ?? null}
          onClose={() => setDocRequestOpen(false)}
          onCreated={onRequestDocCreated}
        />
      )}

      {/* Fase H: modais de ação jurídica a partir de mensagem */}
      {deadlineSource && selected && (
        <CreateDeadlineFromMessageModal
          message={deadlineSource}
          clientId={selected.client_id!}
          processes={overview?.processes ?? []}
          onClose={() => setDeadlineSource(null)}
        />
      )}
      {taskSource && selected && (
        <CreateTaskFromMessageModal
          message={taskSource}
          clientId={selected.client_id!}
          processes={overview?.processes ?? []}
          onClose={() => setTaskSource(null)}
        />
      )}
    </div>
  );
};











export default WhatsAppModule;
