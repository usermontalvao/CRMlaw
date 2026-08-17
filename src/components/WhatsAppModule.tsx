import React, { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, Send, Loader2, MessageCircle, Phone, User as UserIcon,
  CheckCheck, Check, AlertCircle, Link2, ArrowRightLeft, X,
  Paperclip, Mic, FileText, Image as ImageIcon, CornerUpLeft,
  Pencil, UserCheck, Unlink, IdCard, Scale, Calendar,
  Clock, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, Plus, Ban, ShieldOff, CheckCircle2, RotateCcw, RefreshCw,
  StickyNote, Trash2, CalendarClock, MessageSquare, Filter, Maximize2,
  UserPlus, UserMinus, PenLine, HandCoins, ListTodo, FilePlus,
  Sparkles, Tag, Tags, Bot, Clapperboard,
  Shield, ShieldCheck, Eye, EyeOff,
  BarChart2, TrendingUp, Users, AlertTriangle, Clock3, CheckCircle, Inbox,
  Mail, MapPin, Play, Pause, Bell, BellOff, Info, MoreVertical, BellRing,
  Target,
  LockKeyhole,
  GitBranch,
  Activity,
  AppWindow,
} from 'lucide-react';
import { useStaffPush } from './whatsapp/hooks/useStaffPush';
import { useThreadDragDrop } from './whatsapp/hooks/useThreadDragDrop';
import { muteStore } from '../services/whatsapp/muteStore';
import { notifyScope } from '../services/whatsapp/notifyScope';
import { whatsappService, normalizePhone, renderTemplate, agentPermissions, summarizeOverview, DEFAULT_AGENT_PREFS, type StaffOption, type AgentPrefs, type ScheduleDeadline, type ClientDocRequest, type ClientOverview, type ClientSchedule, type ClientPendings, type WhatsAppInternalNote, type ClientTrackedSignatureStatus } from '../services/whatsapp.service';
import type { WhatsAppScheduledMessage } from '../types/whatsapp.types';
import {
  formatTime, initials, prettyPhone, formatBytes, dayLabel, lastSeenLabel, presenceInfo,
  typeLabel, conversationPreviewLabel, firstName, agentLabel, greetingByHour, buildGreeting,
  convStatus, slaSignal, slaInternalSignal, abandonedSignal, transferAlert,
  maskSensitive, maskName, maskPhoneFull, fmtAudioTime, prettyDoc, dueInfo, fmtDateTime,
  fmtNoteDate, conversationName, matchesConversationSearch, agentRoleLabel,
} from './whatsapp/format';
import {
  WaDialog, WaDialogBody, waInput, waLabel, waBtnPrimary, waBtnGhost, waBtnDanger,
} from './whatsapp/ui';
import { TransferModal, BlockContactModal, CloseConversationModal, LegalHoldModal } from './whatsapp/conversationModals';
import { TemplatePickerModal, ScheduleMessageModal } from './whatsapp/messageModals';
import { ForwardMessageModal } from './whatsapp/forwardMessageModal';
import { stripAgentSignature } from './whatsapp/waRichText';
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
import { WA_LABELS, resolveLabelMeta, inferFunnelStage, funnelLabelsFromChannelStages } from './whatsapp/funnel';
import { ClientLinkPanel } from './whatsapp/clientLinkPanel';
import { PreCadastroModal } from './whatsapp/preCadastroModal';
import { ConversationSummaryBanner } from './whatsapp/conversationSummaryBanner';
import { ConversationMuteModal } from './whatsapp/conversationMuteModal';
import { InternalNotesSection } from './whatsapp/internalNotes';
import { AttachmentPreviewModal } from './whatsapp/attachmentPreviewModal';
import { ConversationStageSelect } from './whatsapp/conversationLabels';
import { ContactIdentity, AttendanceSummary } from './whatsapp/detailsPanelHeader';
import { ConversationArchiveButton } from './whatsapp/conversationArchive';
import { QuickActions } from './whatsapp/quickActions';
import { useWaViewers } from './whatsapp/hooks/useWaViewers';
import { viewersLabel } from '../services/whatsapp/inboxPresenceState';
import { imagesFromClipboard } from '../utils/clipboardImages';
import { applyWaFormat, formatFromKey, type WaFormat } from './whatsapp/composerFormat';
import {
  ChannelSwitcher, ChannelDownBanner, ChannelDownAlert, ReconnectHoldSiren,
} from './whatsapp/channelSwitcher';
import { GifPicker } from './whatsapp/gifPicker';
import { giphyService } from '../services/giphy.service';
import { sendReconnectHoldsThroughChannel } from '../services/whatsapp/resilientSend';
import { ConversationFunnelBoard } from './whatsapp/conversationFunnelBoard';
import { nextLeadChannelFilter } from './whatsapp/channelFilterSync';
import { hiddenByStatusFilter, searchRank } from './whatsapp/inboxStatusScope';
import { collapseContactThreads, contactKey, siblingThreadIds } from './whatsapp/contactThreads';
import {
  INBOX_FILTER_KEYS, readFilter, writeFilter, canSanitize,
  sanitizeChannelFilter, sanitizeDeptFilter, sanitizeLabelFilter,
} from './whatsapp/inboxFilters';
import { executeFunnelStageActions } from './whatsapp/funnelStageActions';
import { nextInQueue, rankQueue, DEFAULT_QUEUE_POLICY } from './whatsapp/attendanceRouting';
import {
  scheduleFromRows, elapsedMinutesFor, elapsedMinutesForChannels, businessHoursStatus,
  DEFAULT_BUSINESS_SCHEDULE, type BusinessSchedule,
} from './whatsapp/businessTime';
// Fuso do escritório (configurável) — a mesma âncora que a agenda usa. Só entra
// quando o canal não declara o próprio.
import { getOfficeTimeZone } from '../utils/officeTime';
import { BUSINESS_HOURS_CHANGED_EVENT } from '../services/whatsapp/admin';
import { QueuePanel } from './whatsapp/queuePanel';
// Etiqueta comum de propósito: já é filtrável na inbox, aparece no funil e não
// exigiu coluna nova. A regra que a respeita mora junto dela, em `campaign.ts`.
import { isOptOutMessage, DO_NOT_DISTURB_LABEL } from './whatsapp/campaign';
import ChannelAccessManager from './whatsapp/ChannelAccessManager';
import ChannelFunnelManager from './whatsapp/ChannelFunnelManager';
import { ThreadScheduledGhosts, ScheduledMessagesPanel, MyScheduledList, useMyScheduled } from './whatsapp/scheduledMessages';
import { AiApprovalBanner } from './whatsapp/aiApprovalBanner';
import { AttendanceDashboard } from './whatsapp/attendanceDashboard';
import { ClientFillLinksPanel } from './whatsapp/clientFillLinksPanel';
import { AiMemoryPanel } from './whatsapp/aiMemoryPanel';
import { AiAgentBanner } from './whatsapp/aiAgentBanner';
import { waAiListChip } from '../utils/waAiFollowupDisplay';
import { AiHandoffSummaryCard, AiHandoffSummaryStrip, useAiHandoffSummary } from './whatsapp/aiHandoffSummary';
import { PresenceText, DateDivider } from './whatsapp/conversationListItem';
import { DockedDetailsToggle } from './whatsapp/DockedDetailsToggle';
import { ConversationList } from './whatsapp/conversationList';
import { ThreadSkeleton } from './whatsapp/skeletons';
import { resolveInboxKey, isTypingTarget } from './whatsapp/inboxKeyboard';
import { WaLightbox } from './whatsapp/lightbox';
import { WaNotifyBell } from './whatsapp/notifyBell';
import { useWaIsMobile, useWaIsPanelDocked, utcOffsetMinutesOf } from './whatsapp/hooks';
import { useResizableLayout } from './whatsapp/hooks/useResizableLayout';
import { useWaInboxPosition, readStoredConversationId } from './whatsapp/hooks/useWaInboxPosition';
import { useClientOverview } from './whatsapp/hooks/useClientOverview';
import { useWaRealtime } from './whatsapp/hooks/useWaRealtime';
import { useWaComposer } from './whatsapp/hooks/useWaComposer';
import { useWaMessages } from './whatsapp/hooks/useWaMessages';
import { useWaThread, type MessageUnit } from './whatsapp/hooks/useWaThread';
import { useWaConversationActions } from './whatsapp/hooks/useWaConversationActions';
import { useWaTemplates } from './whatsapp/hooks/useWaTemplates';
import { useWaOperationalModals } from './whatsapp/hooks/useWaOperationalModals';
import { useWaAiActions } from './whatsapp/hooks/useWaAiActions';
import { useConfirm, ConfirmDialog } from './whatsapp/useConfirm';
import { useWaComposerSpellcheck } from './whatsapp/useWaComposerSpellcheck';
import ComposerSpellcheckOverlay from './whatsapp/ComposerSpellcheckOverlay';
import ComposerSpellcheckContextMenu, { type ComposerSpellcheckMenuState } from './whatsapp/ComposerSpellcheckContextMenu';
import { findWhatsAppSpellIssueAtOffset, type WhatsAppSpellcheckHit } from './whatsapp/composerSpellcheck';
import { processService, type ProcessMovement } from '../services/process.service';
import type { CalendarEvent, CalendarEventType } from '../types/calendar.types';
import type { Requirement, RequirementStatus } from '../types/requirement.types';
import type {
  WhatsAppConversation, WhatsAppMessage, WhatsAppChannel, WhatsAppDepartment,
  WhatsAppClientLite, WhatsAppPresence, WhatsAppDirection, WhatsAppChannelFunnelStage, WhatsAppBusinessHoursRow,
  WhatsAppDeleteScope,
} from '../types/whatsapp.types';
import { playWaActionSound } from '../utils/waActionSounds';
import type { Process, ProcessStatus, ProcessPracticeArea } from '../types/process.types';
import { useAuth } from '../contexts/AuthContext';
import { useSecurityPin } from '../contexts/SecurityPinContext';
import { useToastContext } from '../contexts/ToastContext';
import { AtendimentoAppInvite } from './whatsapp/atendimentoAppInvite';
import { openAtendimentoApp } from '../utils/atendimentoApp';
import { isWhatsAppAppLocation } from '../utils/whatsappAppRoute';
import { signatureService } from '../services/signature.service';
import { WaWorkspaceRenderer } from './WaWorkspace';
import { ClientCloudDocsLink } from './CloudFolderModal';
import { Modal, ModalBody } from './ui/Modal';
import { buildPublicFillUrl } from '../utils/publicAppUrl';
import type { Lead } from '../types/lead.types';
import {
  settingsService, funnelLabelsFromConfig, WHATSAPP_MODULE_DEFAULTS,
  type FunnelLabel, type WhatsAppModuleConfig, type WhatsAppChannelDepartmentRouting,
} from '../services/settings.service';

/**
 * `true` quando a viewport é estreita demais para mostrar lista + thread lado a
 * lado (abaixo do breakpoint `md` do Tailwind = 768px). Usado para alternar o
 * módulo para um painel por vez em celulares.
 */

type FilterTab = 'all' | 'unread' | 'mine' | 'scheduled';


// ── Confirmação leve (sem PIN) para ações reversíveis do módulo ──
// O app reserva o fluxo com PIN (useDeleteConfirm) para exclusões críticas;
// aqui usamos um confirm simples para "devolver à fila", "cancelar", etc.
// `ConfirmOpts`/`ConfirmFn` agora vivem em ./whatsapp/types (compartilhados).


// ── Shell de diálogo estilo WhatsApp (Fase Q: padronização visual) ──
// Header em teal (#008069), card arredondado, overlay com blur, ESC/clique-fora
// fecham, trava o scroll do body e entra com micro-animação. Todos os modais do
// módulo usam este shell para parecer uma aplicação profissional e consistente.
// Pesos das barras do equalizador de gravação. Multiplicam o volume MEDIDO no
// microfone (`recLevel`), e é só isso que eles fazem: dão à onda um contorno
// irregular, de forma que ela não suba e desça como um bloco só.
//
// Antes estas alturas eram a animação inteira — as barras dançavam sozinhas por
// CSS, com o mesmo desenho em qualquer situação. Elas continuavam dançando com o
// microfone mudo, com a mão em cima dele e com a permissão negada, o que fazia o
// único indicador de "está me ouvindo?" mentir justamente quando a resposta era
// não. Agora o CSS só interpola entre um quadro e o seguinte; quem manda na
// altura é o som que está entrando.
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
  const { requirePin } = useSecurityPin();
  const toast = useToastContext();
  // Sem `useNavigation` de propósito: nada aqui dentro navega para outro módulo,
  // e a dependência do NavigationProvider impediria este módulo de montar no app
  // dedicado /atendimento, que não tem sistema de módulos.

  // Já estamos DENTRO do app dedicado? Então nada de convidar a abri-lo.
  const dentroDoApp = isWhatsAppAppLocation();
  const { confirm, pending: confirmPending, resolve: resolveConfirm } = useConfirm();
  // Gaveta de Leads embutida: funil comercial/jurídico revelado a partir do topo
  // do módulo, empurrando o atendimento para ~70% da altura quando aberta.
  const [leadsPanelOpen, setLeadsPanelOpen] = useState(false);
  // Mantém o funil montado após a 1ª abertura para que o slide de fechamento
  // mostre o conteúdo (não esvazia no meio da animação).
  const [leadsEverOpened, setLeadsEverOpened] = useState(false);
  // Canal selecionado na gaveta. Como cada canal tem seu próprio fluxo, o
  // quadro sempre representa exatamente um canal por vez.
  const [leadChannelFilter, setLeadChannelFilter] = useState(
    () => (embedded ? '' : readFilter(INBOX_FILTER_KEYS.leadChannel) || ''),
  );
  // O funil global é somente o modelo-base/fallback. Canais com configuração
  // própria usam sua lista de etapas e etiquetas em toda a experiência.
  const [baseFunnelLabels, setBaseFunnelLabels] = useState<FunnelLabel[]>([]);
  const [channelFunnelLabels, setChannelFunnelLabels] = useState<Record<string, FunnelLabel[]>>({});
  const [channelFunnelStages, setChannelFunnelStages] = useState<Record<string, WhatsAppChannelFunnelStage[]>>({});
  const [moduleConfig, setModuleConfig] = useState<WhatsAppModuleConfig>({ ...WHATSAPP_MODULE_DEFAULTS });
  const reloadFunnelLabels = useCallback(async () => {
    const cfg = await settingsService.getLeadModuleConfig().catch(() => null);
    if (cfg) setBaseFunnelLabels(funnelLabelsFromConfig(cfg));
    const rows = await whatsappService.listChannelFunnelStages().catch(() => []);
    const grouped: Record<string, WhatsAppChannelFunnelStage[]> = {};
    for (const row of rows) {
      if (!grouped[row.channel_id]) grouped[row.channel_id] = [];
      grouped[row.channel_id].push(row);
    }
    setChannelFunnelStages(grouped);
    setChannelFunnelLabels(Object.fromEntries(
      Object.entries(grouped).map(([channelId, stages]) => [channelId, funnelLabelsFromChannelStages(stages)]),
    ));
  }, []);
  useEffect(() => { void reloadFunnelLabels(); }, [reloadFunnelLabels]);
  useEffect(() => {
    settingsService.getWhatsAppModuleConfig().then(setModuleConfig).catch(() => {});
  }, []);
  // Reflete no atendimento qualquer ajuste de funil feito na gaveta de Leads.
  useEffect(() => { if (leadsPanelOpen) { setLeadsEverOpened(true); void reloadFunnelLabels(); } }, [leadsPanelOpen, reloadFunnelLabels]);
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  // Reabre na conversa em que o atendente parou. Só no módulo cheio: no widget
  // embutido a inbox é efêmera e abrir sozinha uma conversa seria intrusivo.
  const [selectedId, setSelectedId] = useState<string | null>(() => readStoredConversationId(!embedded));
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
  // O painel 360º pode ser recolhido por completo no desktop. A preferência é
  // local ao navegador para que o atendente recupere o espaço da conversa sem
  // precisar fechar novamente a cada acesso ao módulo.
  const [detailsPanelCollapsed, setDetailsPanelCollapsed] = useState(
    () => !embedded && localStorage.getItem('wa_details_panel_collapsed') === '1',
  );
  // Menu "⋮" do cabeçalho da thread (agrupa as ações em telas estreitas).
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  // Menu "+" do composer (documento, modelo, agendar) — mantém a barra enxuta.
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  // Menu do sino: unifica som das notificações + push do navegador num só ícone.
  // Web Push do staff: avisa o atendente mesmo com o navegador fechado.
  const { pushState, toggleStaffPush } = useStaffPush();
  // Filtros da inbox recolhidos por padrão (expansível); economiza altura no topo.
  // Se o atendente deixou o painel aberto, ele reabre assim — junto com os
  // filtros que ele escolheu.
  const [filtersOpen, setFiltersOpen] = useState(
    () => !embedded && readFilter(INBOX_FILTER_KEYS.panelOpen) === '1',
  );
  // Fecha a gaveta ao trocar de conversa ou quando o painel volta a ser fixo.
  useEffect(() => { setMobilePanelOpen(false); setHeaderMenuOpen(false); setAttachMenuOpen(false); setMoreMenuOpen(false); }, [selectedId]);
  useEffect(() => { if (panelDocked) setMobilePanelOpen(false); }, [panelDocked]);
  useEffect(() => {
    if (!embedded) localStorage.setItem('wa_details_panel_collapsed', detailsPanelCollapsed ? '1' : '0');
  }, [detailsPanelCollapsed, embedded]);
  const [channels, setChannels] = useState<WhatsAppChannel[]>([]);
  // Pendências persistidas do atendente logado. É propositalmente global ao
  // módulo (não pertence à conversa aberta): a sirene precisa sobreviver quando
  // ele troca de cliente, fecha a thread ou recarrega a página.
  const [reconnectAlerts, setReconnectAlerts] = useState<WhatsAppScheduledMessage[]>([]);
  const [departments, setDepartments] = useState<WhatsAppDepartment[]>([]);
  const [departmentMembers, setDepartmentMembers] = useState<Record<string, string[]>>({});
  const [businessHoursByChannel, setBusinessHoursByChannel] = useState<Record<string, WhatsAppBusinessHoursRow[]>>({});
  // Distingue "ainda não sei o expediente" de "não há expediente cadastrado":
  // são conclusões opostas sobre o SLA e sobre a mensagem de ausência.
  const [businessHoursLoaded, setBusinessHoursLoaded] = useState(false);
  /**
   * Agenda de expediente de CADA canal, no fuso cadastrado nele. A inbox mistura
   * canais na mesma lista: medir tudo pelo expediente de um único número faria o
   * SLA do plantão 24h ser lido com o relógio do comercial (e vice-versa).
   * Canal sem nenhuma linha ativa não entra — quem consome trata a ausência.
   */
  const schedulesByChannel = useMemo(() => {
    const out: Record<string, BusinessSchedule> = {};
    for (const ch of channels) {
      const rows = businessHoursByChannel[ch.id];
      if (!rows?.length) continue;
      const schedule = scheduleFromRows(rows, utcOffsetMinutesOf(ch.timezone || getOfficeTimeZone()));
      if (schedule.days.length > 0) out[ch.id] = schedule;
    }
    return out;
  }, [channels, businessHoursByChannel]);
  const [channelRouting, setChannelRouting] = useState<WhatsAppChannelDepartmentRouting[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [agentPrefs, setAgentPrefs] = useState<AgentPrefs>(DEFAULT_AGENT_PREFS);
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
  // Canal e setor voltam como o atendente deixou. Os valores salvos ainda serão
  // conferidos contra o que existe hoje (efeito mais abaixo), porque um canal ou
  // setor pode ter sido removido desde a última sessão.
  const [channelFilter, setChannelFilter] = useState<string>(
    () => (embedded ? 'all' : readFilter(INBOX_FILTER_KEYS.channel) || 'all'),
  );
  const [deptFilter, setDeptFilter] = useState<string>(
    () => (embedded ? 'all' : readFilter(INBOX_FILTER_KEYS.dept) || 'all'),
  );
  // O som das notificações vive agora dentro de <WaNotifyBell/> (estado de UI local).
  // Silenciamento por contato (no banco, por usuário). Re-renderiza ao mudar o store.
  // O snapshot alimenta o memo de `mutedIds` (silenciar/reativar precisa
  // repintar as linhas afetadas mesmo com a lista memoizada).
  const muteSnapshot = useSyncExternalStore(muteStore.subscribe, muteStore.getSnapshot);
  useEffect(() => { void muteStore.init(); }, []);
  const [muteModalOpen, setMuteModalOpen] = useState(false);
  useEffect(() => { setMuteModalOpen(false); }, [selectedId]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  // Fase H: ação jurídica a partir de mensagem
  const [deadlineSource, setDeadlineSource] = useState<WhatsAppMessage | null>(null);
  const [taskSource, setTaskSource] = useState<WhatsAppMessage | null>(null);
  // Ação pedida numa conversa que ainda não tem cadastro: fica guardada aqui
  // enquanto o pré-cadastro é criado, e roda em seguida. Ver `comCadastro`.
  const [preCadastroAsk, setPreCadastroAsk] = useState<
    { motivo: string; seguir: (clientId: string, clientName: string) => void } | null
  >(null);
  // Encaminhar mensagem: origem escolhida no menu da bolha + envio em curso.
  const [forwardSource, setForwardSource] = useState<WhatsAppMessage | null>(null);
  const [forwarding, setForwarding] = useState(false);
  // Fase I/360: estado dos modais operacionais + workspace → useWaOperationalModals (abaixo).
  // Fase M: filtro por etiqueta + resumo automático por IA
  const [labelFilter, setLabelFilter] = useState(
    () => (embedded ? '' : readFilter(INBOX_FILTER_KEYS.label) || ''),
  );
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Fase J: sessão de IA da conversa selecionada → gerida por useWaRealtime (abaixo).
  // Fase K: IA da conversa (sugerir/classificar/extrair) + exportação → useWaAiActions (abaixo).
  // Fase L: modo privado (mascaramento visual) e exportação
  const [privateMode, setPrivateMode] = useState(false);
  // Fase M: dashboard de atendimento
  const [showDashboard, setShowDashboard] = useState(false);
  const [channelAccessOpen, setChannelAccessOpen] = useState(false);
  const [channelFunnelsOpen, setChannelFunnelsOpen] = useState(false);
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
  // Memória de posição da inbox (conversa aberta + rolagem da lista).
  const { setListEl, onListScroll } = useWaInboxPosition(selectedId, !embedded);
  // Persistência local dos filtros da inbox (Fase 3/5): o escopo escolhido pelo
  // atendente sobrevive ao recarregar — sem reimpor o padrão a cada abertura.
  useEffect(() => { if (!embedded) localStorage.setItem('wa_filter', filter); }, [filter, embedded]);
  useEffect(() => { localStorage.setItem('wa_status_filter', statusFilter); }, [statusFilter]);
  // Canal, setor, etiqueta, canal do funil e o próprio painel de filtros seguem
  // a mesma regra: no widget embutido a inbox é efêmera e não herda o escopo.
  useEffect(() => { if (!embedded) writeFilter(INBOX_FILTER_KEYS.channel, channelFilter); }, [channelFilter, embedded]);
  useEffect(() => { if (!embedded) writeFilter(INBOX_FILTER_KEYS.dept, deptFilter); }, [deptFilter, embedded]);
  useEffect(() => { if (!embedded) writeFilter(INBOX_FILTER_KEYS.label, labelFilter); }, [labelFilter, embedded]);
  useEffect(() => { if (!embedded) writeFilter(INBOX_FILTER_KEYS.leadChannel, leadChannelFilter); }, [leadChannelFilter, embedded]);
  useEffect(() => { if (!embedded) writeFilter(INBOX_FILTER_KEYS.panelOpen, filtersOpen ? '1' : '0'); }, [filtersOpen, embedded]);

  const imgInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const [composerScrollTop, setComposerScrollTop] = useState(0);
  const [composerScrollbarWidth, setComposerScrollbarWidth] = useState(0);
  const [composerSpellMenu, setComposerSpellMenu] = useState<ComposerSpellcheckMenuState | null>(null);
  const avatarTriedRef = useRef<Set<string>>(new Set());

  const channelById = useMemo(() => new Map(channels.map(c => [c.id, c])), [channels]);
  const conversationsById = useMemo(
    () => new Map(conversations.map(c => [c.id, c])),
    [conversations],
  );

  const deptById = useMemo(() => new Map(departments.map(d => [d.id, d])), [departments]);
  const channelRoutingById = useMemo(() => new Map(channelRouting.map(item => [item.channel_id, item])), [channelRouting]);
  const staffByUser = useMemo(() => new Map(staff.map(s => [s.user_id, s.name])), [staff]);
  const staffById = useMemo(() => new Map(staff.map(s => [s.user_id, s])), [staff]);
  // Papel operacional do usuário logado → permissões da UI (Fase 9).
  const myRole = user ? (staffById.get(user.id)?.role ?? null) : null;
  const perms = useMemo(() => agentPermissions(myRole), [myRole]);
  const canManageChannelAccess = (myRole || '').trim().toLocaleLowerCase('pt-BR') === 'administrador';

  const selected = useMemo(
    () => conversations.find(c => c.id === selectedId) || null,
    [conversations, selectedId],
  );
  // Uma leitura só do handoff da IA, consumida em dois lugares: a faixa fina da
  // thread e o cartão do painel. Ver aiHandoffSummary.tsx.
  const handoffSummary = useAiHandoffSummary({
    conversationId: selected?.id ?? '',
    currentUserId: user?.id ?? null,
    assignedUserId: selected?.assigned_user_id ?? null,
  });
  // Linhas da MESMA pessoa. O escritório tem mais de um número, e quem escreve
  // para dois deles ganha uma conversa em cada — mas continua sendo um contato só,
  // com um histórico só. A thread aberta é a união dessas linhas; a resposta segue
  // saindo pelo canal da conversa selecionada.
  const threadIds = useMemo(
    () => siblingThreadIds(selected, conversations),
    [selected, conversations],
  );
  const selectedContactMuted = useMemo(
    () => threadIds.length > 0 && threadIds.every(id => muteStore.isMuted(id)),
    [threadIds, muteSnapshot],
  );
  const selectedContactMutedUntil = useMemo<string | null | undefined>(() => {
    if (!selectedContactMuted) return undefined;
    const values = threadIds.map(id => muteStore.mutedUntil(id));
    if (values.every(value => value === null)) return null;
    const finite = values.filter((value): value is string => typeof value === 'string');
    return finite.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
  }, [selectedContactMuted, threadIds, muteSnapshot]);
  // Conta ao notificador global (que vive no App) o que está à vista aqui. É o
  // que permite três avisos diferentes para a mesma mensagem: conversa aberta,
  // outra conversa da lista, ou outra tela do CRM. Sem isso, o notificador só
  // sabia "está no módulo?" — e por isso calava tudo enquanto o módulo estava
  // aberto, inclusive mensagem de conversa que ninguém estava lendo.
  // O id é por instância: o widget flutuante e uma janela flutuante do módulo
  // podem estar abertos ao mesmo tempo, e fechar um não pode apagar o registro
  // do outro.
  const notifySurfaceId = useId();
  useEffect(() => {
    notifyScope.publish(notifySurfaceId, { kind: embedded ? 'embedded' : 'full', threadIds });
    return () => notifyScope.clear(notifySurfaceId);
  }, [notifySurfaceId, embedded, threadIds]);
  const funnelLabelsForChannel = useCallback((channelId: string | null | undefined) => {
    if (!channelId) return baseFunnelLabels;
    const custom = channelFunnelLabels[channelId];
    return custom?.length ? custom : baseFunnelLabels;
  }, [baseFunnelLabels, channelFunnelLabels]);
  const selectedFunnelLabels = useMemo(
    () => funnelLabelsForChannel(selected?.instance_id),
    [selected?.instance_id, funnelLabelsForChannel],
  );
  const labelFilterOptions = useMemo(() => {
    const source = channelFilter === 'all'
      ? channels.flatMap(channel => funnelLabelsForChannel(channel.id))
      : funnelLabelsForChannel(channelFilter);
    const seen = new Set<string>();
    return source.filter(label => {
      if (seen.has(label.stageKey)) return false;
      seen.add(label.stageKey);
      return true;
    });
  }, [channelFilter, channels, funnelLabelsForChannel]);
  const funnelChannels = useMemo(() => channels.filter(channel => channel.funnel_enabled !== false), [channels]);
  const funnelChannelIds = useMemo(() => funnelChannels.map(channel => channel.id), [funnelChannels]);

  // Confere os filtros restaurados contra o que existe HOJE. Um canal/setor
  // removido (ou uma etiqueta que saiu do funil) viraria um filtro invisível que
  // esvazia a lista sem dizer o motivo; nesses casos volta para "todos".
  useEffect(() => {
    if (!canSanitize(channels)) return;
    setChannelFilter(current => sanitizeChannelFilter(current, channels.map(c => c.id)));
  }, [channels]);
  useEffect(() => {
    if (!canSanitize(departments)) return;
    setDeptFilter(current => sanitizeDeptFilter(current, departments.map(d => d.id)));
  }, [departments]);
  useEffect(() => {
    if (!canSanitize(labelFilterOptions)) return;
    setLabelFilter(current => sanitizeLabelFilter(current, labelFilterOptions.map(l => l.stageKey)));
  }, [labelFilterOptions]);
  // Inbox e quadro de Leads compartilham o mesmo recorte de canal. O filtro
  // "Todos" continua válido apenas para a inbox, porque cada quadro possui um
  // funil diferente; ao escolher um canal específico em qualquer seletor, o
  // outro acompanha imediatamente.
  useEffect(() => {
    setLeadChannelFilter(current => nextLeadChannelFilter(current, channelFilter, funnelChannelIds));
  }, [channelFilter, funnelChannelIds]);

  const selectLeadChannel = useCallback((channelId: string) => {
    setLeadChannelFilter(channelId);
    if (channelId) setChannelFilter(channelId);
  }, []);
  const selectedAllowedDepartments = useMemo(() => {
    if (!selected?.instance_id) return departments;
    const routing = channelRoutingById.get(selected.instance_id);
    if (!routing?.allowed_department_ids?.length) return departments;
    return departments.filter(d => routing.allowed_department_ids.includes(d.id));
  }, [selected?.instance_id, channelRoutingById, departments]);

  const selectedClientId = selected?.client_id ?? null;

  // Quem já passou por esta conversa. Alimenta a sugestão de advogado no modal
  // de transferência: o cliente que já explicou o caso para a Dra. Ana prefere
  // a Dra. Ana ocupada a um advogado livre que vai pedir tudo de novo.
  const [conversationAgentIds, setConversationAgentIds] = useState<string[]>([]);
  useEffect(() => {
    if (!selected) { setConversationAgentIds([]); return; }
    let cancelled = false;
    whatsappService.getConversationAgents(selected)
      .then(ids => { if (!cancelled) setConversationAgentIds(ids); })
      .catch(() => { if (!cancelled) setConversationAgentIds([]); });
    return () => { cancelled = true; };
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pacote 360 do cliente + status de documentos/assinaturas por cliente (com
  // realtime). Banner-resumo e painéis laterais consomem deste estado.
  const {
    overview, setOverview, reloadOverview,
    effectiveDocStatus, trackedSignatureStatus, effectiveConversationStatus,
    dismissDocReady, stopTemplateFillTracking, stopSignatureTracking,
  } = useClientOverview(selectedClientId, conversations, selected?.contact_phone ?? null);

  // Move uma conversa para uma ETAPA do funil (etapa única: remove etiquetas de
  // funil anteriores, mantém tags livres). Usado por automações como "ao pedir
  // documento → Aguardando Documentos". No-op se a etapa não existe no funil.
  // A inbox é recarregada de vários lugares ao mesmo tempo — abertura, realtime
  // de conversa nova, ações de funil, reposição a cada 15s enquanto o canal está
  // fora. Duas chamadas em voo não terminam necessariamente na ordem em que
  // saíram, e a que chega por último é a que fica: bastava a mais ANTIGA demorar
  // um pouco mais para a lista voltar a um retrato velho, sem a mensagem que
  // acabara de chegar, até o próximo evento desencalhar. O contador descarta
  // qualquer resposta que já tenha sido ultrapassada por outra mais recente.
  const convReqRef = useRef(0);
  const loadConversations = useCallback(async () => {
    const req = (convReqRef.current += 1);
    try {
      const rows = await whatsappService.listConversations();
      if (req !== convReqRef.current) return;
      setConversations(rows);
    } catch {/* */} finally { if (req === convReqRef.current) setLoadingConvs(false); }
  }, []);

  const runFunnelStageActions = useCallback(async (
    conversation: WhatsAppConversation,
    stageKey: string,
  ) => {
    const stage = conversation.instance_id
      ? channelFunnelStages[conversation.instance_id]?.find(item => item.stage_key === stageKey)
      : null;
    if (!stage?.entry_actions?.length) return;
    const result = await executeFunnelStageActions({
      conversation,
      actions: stage.entry_actions,
      departments,
      staff,
    });
    await loadConversations();
    if (result.completed.length > 0) {
      toast.success('Ações da etapa executadas', result.completed.join(' · '));
    }
    if (result.errors.length > 0) {
      toast.warning('Etapa alterada com ações pendentes', result.errors.join(' · '));
    }
  }, [channelFunnelStages, departments, staff, loadConversations, toast]);

  // Camada de dados da thread: janela de mensagens da conversa aberta, com
  // carregamento inicial, paginação e refresh em tempo real. Vive aqui (antes de
  // useWaRealtime/useWaComposer) porque é a fonte de `refreshMessages`.
  const {
    messages, setMessages,
    loadingMsgs, hasMoreMsgs, setHasMoreMsgs, loadingMore,
    oldestTsRef,
    loadMessages, loadMoreMsgs, refreshMessages,
  } = useWaMessages(selectedId, threadIds);

  // Horário de atendimento de todos os canais numa consulta só: é o que faz o
  // SLA contar expediente (e não madrugada) e o que decide a mensagem de
  // ausência da conversa aberta. Uma consulta por conversa, como era antes,
  // repetia a mesma resposta a cada troca de thread.
  const loadBusinessHours = useCallback(() => {
    whatsappService.listAllBusinessHours()
      .then(rows => { setBusinessHoursByChannel(rows); setBusinessHoursLoaded(true); })
      .catch(() => {});
  }, []);

  const loadChannels = useCallback(() => {
    whatsappService.listChannels().then(setChannels).catch(() => {});
  }, []);

  const loadReconnectAlerts = useCallback(() => {
    if (!user?.id) { setReconnectAlerts([]); return; }
    whatsappService.listMyReconnectAlerts().then(setReconnectAlerts).catch(() => {});
  }, [user?.id]);

  // Bootstrap dos dados auxiliares (uma vez). O fluxo reativo (realtime de
  // conversa/mensagem/IA) vive em useWaRealtime.
  useEffect(() => {
    loadConversations();
    loadChannels();
    whatsappService.listDepartments().then(setDepartments).catch(() => {});
    settingsService.getWhatsAppChannelDepartmentRouting().then(setChannelRouting).catch(() => {});
    whatsappService.listStaff().then(setStaff).catch(() => {});
    whatsappService.getMyAgentPrefs().then(setAgentPrefs).catch(() => {});
    // Matriz setor→membros: a distribuição da fila precisa dela para não
    // mandar conversa de um setor para quem não pertence a ele.
    whatsappService.listAllDepartmentMembers().then(setDepartmentMembers).catch(() => {});
    loadBusinessHours();
  }, [loadConversations, loadBusinessHours, loadChannels]);

  // Estado do canal é dado operacional, não configuração estática. Se um
  // número cair enquanto a tela está aberta, o modal preventivo precisa reagir
  // antes do próximo envio; quando voltar, a UI libera a conversa de imediato.
  useEffect(() => whatsappService.subscribeChannels(loadChannels), [loadChannels]);

  // A sirene é pessoal (`created_by = usuário atual`) e reage a inserts/updates
  // do scheduler. Foco/online são uma segunda rede de segurança para eventos
  // perdidos enquanto o notebook dormia ou o socket estava fora.
  useEffect(() => {
    loadReconnectAlerts();
    if (!user?.id) return undefined;
    const unsubscribe = whatsappService.subscribeMyReconnectAlerts(user.id, loadReconnectAlerts);
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') loadReconnectAlerts();
    };
    window.addEventListener('focus', refreshVisible);
    window.addEventListener('online', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', refreshVisible);
      window.removeEventListener('online', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [user?.id, loadReconnectAlerts]);

  // Recarrega o expediente quando ele é salvo nas configurações do canal (a tela
  // de integração fica em outro módulo; sem este aviso, o SLA e a mensagem de
  // ausência continuariam com o horário antigo até um recarregamento da página).
  useEffect(() => {
    const onChanged = () => { loadBusinessHours(); };
    window.addEventListener(BUSINESS_HOURS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(BUSINESS_HOURS_CHANGED_EVENT, onChanged);
  }, [loadBusinessHours]);

  // Presença da equipe: quem está com qual conversa aberta agora. Anuncia onde
  // eu estou e devolve onde os outros estão — a base do aviso de colisão.
  const { hereWithMe, busyConversationIds } = useWaViewers(
    selectedId,
    user?.id ? { id: user.id, name: staffByUser.get(user.id) || 'Atendente' } : null,
  );

  const { aiSession, setAiSession, realtimeStatus } = useWaRealtime({
    selectedId, threadIds, loadConversations, refreshMessages,
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
    recording, recSeconds, recLevel,
    attachStaged, stagedCaption,
    handleSend, beginEdit,
    retryPending, discardPending, cancelUpload, resendExisting,
    startRecording, stopRecording,
    onPickFiles, handleDroppedFiles, confirmStagedSend, cancelStagedSend, sendGif,
  } = useWaComposer({
    selectedId, selected, user, agentPrefs, moduleConfig, staffById, aiSession,
    messages, setMessages, setConversations, refreshMessages,
  });

  // Camada visual da thread: merge de mensagens reais + otimistas, agrupamento de
  // imagens em álbuns, galeria/lightbox e todo o auto-scroll. Consome `pending` do
  // compositor, por isso vive depois dele.
  const {
    allMessages, msgById, nextAudioId, messageUnits, diasDaThread,
    lightbox, setLightbox, lightboxImages,
    threadContentRef, setThreadEl, onThreadScroll,
    scrolledUp, newBelow, scrollToBottom,
  } = useWaThread(selectedId, messages, pending);

  // Auto-crescimento do campo de mensagem: cresce com o texto até um teto e
  // então rola. Roda a cada mudança do rascunho, então também encolhe de volta
  // quando o draft é limpo (envio/edição/escape).
  //
  // A medição é cara: zerar a altura e ler `scrollHeight` obriga o navegador a
  // recalcular o layout da página inteira (lista + thread) de forma síncrona —
  // a cada tecla. Medimos num rAF (coalesce teclas da mesma moldura) e só
  // escrevemos quando a altura muda de fato, o que corta a maior parte dos
  // reflows durante a digitação.
  const COMPOSER_MAX_H = 192; // px (≈ max-h-48); acima disso, rola
  const composerHRef = useRef<number>(0);
  useEffect(() => {
    const el = draftRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      const prev = el.style.height;
      el.style.height = 'auto';
      const next = Math.min(el.scrollHeight, COMPOSER_MAX_H);
      if (next === composerHRef.current && prev) el.style.height = prev;
      else {
        composerHRef.current = next;
        el.style.height = `${next}px`;
      }
      setComposerScrollbarWidth(Math.max(0, el.offsetWidth - el.clientWidth - 2));
      if (el.scrollHeight <= el.clientHeight) setComposerScrollTop(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [draft]);

  // Domínio de modelos/atalho "/" do compositor: carrega templates ativos + kits,
  // faz o matching do slash, monta o contexto de variáveis e aplica no rascunho.
  const {
    reloadTemplates, templateCtx,
    slashMatch, slashResults, slashActive, slashIdx, setSlashIndex,
    applyTemplate,
  } = useWaTemplates({
    selected, selectedId, user, staffById, moduleConfig, draft, editing, setDraft,
  });

  // O corretor nativo continua habilitado, mas a revisão local garante o aviso
  // mesmo quando o Chrome está com o spellcheck desligado. O mesmo Hunspell
  // pt-BR do editor jurídico roda após uma pequena pausa e desenha somente o
  // ondulado vermelho em cima do campo, como nos compositores modernos.
  const composerSpellcheck = useWaComposerSpellcheck(draft, !recording && !slashActive);

  // ── Formatação do texto selecionado (negrito/itálico/riscado/mono) ──
  // O WhatsApp não tem editor rico: a formatação é o próprio texto, marcado
  // com *, _, ~ e ```. A barra só existe enquanto há trecho selecionado.
  const [textSel, setTextSel] = useState<{ start: number; end: number } | null>(null);

  const syncTextSel = useCallback(() => {
    const ta = draftRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    setTextSel(e > s ? { start: s, end: e } : null);
  }, []);

  const aplicarFormato = useCallback((fmt: WaFormat) => {
    const ta = draftRef.current;
    if (!ta) return;
    // Lê a seleção do próprio DOM: entre o clique e aqui ela pode ter mudado,
    // e formatar o intervalo errado estragaria a mensagem em silêncio.
    const r = applyWaFormat(ta.value, ta.selectionStart, ta.selectionEnd, fmt);
    if (!r.changed) return;
    setDraft(r.text);
    // O texto novo só existe no DOM depois do render; a seleção é reposta
    // depois, senão o cursor cai no fim e o encadeamento (negrito → itálico)
    // não funciona.
    requestAnimationFrame(() => {
      const el = draftRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(r.selectionStart, r.selectionEnd);
      setTextSel({ start: r.selectionStart, end: r.selectionEnd });
    });
  }, [setDraft]);

  useEffect(() => { if (!draft) setTextSel(null); }, [draft]);
  const closeComposerSpellMenu = useCallback(() => setComposerSpellMenu(null), []);
  const openComposerSpellMenu = useCallback((event: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const hit = findWhatsAppSpellIssueAtOffset(draft, composerSpellcheck.issues, textarea.selectionStart);
    if (!hit) return;
    event.preventDefault();
    textarea.setSelectionRange(hit.start, hit.end);
    setComposerSpellMenu({ ...hit, x: event.clientX, y: event.clientY });
  }, [composerSpellcheck.issues, draft]);
  const replaceComposerSpelling = useCallback((hit: WhatsAppSpellcheckHit, replacement: string) => {
    setDraft(current => {
      const currentWord = current.slice(hit.start, hit.end);
      if (currentWord.toLocaleLowerCase('pt-BR') !== hit.issue.word.toLocaleLowerCase('pt-BR')) return current;
      return current.slice(0, hit.start) + replacement + current.slice(hit.end);
    });
    setComposerSpellMenu(null);
    window.requestAnimationFrame(() => {
      const textarea = draftRef.current;
      if (!textarea) return;
      const caret = hit.start + replacement.length;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  }, [setDraft]);

  // Abrir uma conversa já deixa o cursor no compositor: no WhatsApp você clica no
  // contato e digita. Sem isso era preciso um segundo clique na barra.
  // Só no desktop — no celular o foco automático abriria o teclado por cima da
  // conversa antes de o atendente ler qualquer coisa. Também não rouba o foco
  // quando a conversa não aceita escrita (bloqueada) ou quando o clique veio de
  // dentro de um campo (busca da inbox, por exemplo).
  // `conversations` fica fora das dependências de propósito: ele muda a cada
  // evento de realtime, e reagir a isso roubaria o foco do atendente no meio de
  // uma frase toda vez que qualquer conversa recebesse mensagem.
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  useEffect(() => {
    if (!selectedId || isMobile) return;
    if (conversationsRef.current.find(c => c.id === selectedId)?.is_blocked) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    // Espera o commit da thread: focar antes faz o navegador rolar a lista.
    const id = window.setTimeout(() => draftRef.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(id);
  }, [selectedId, isMobile]);

  // Marca como lida ao abrir a conversa E a cada mensagem que chega com ela
  // aberta. A segunda metade é o que faltava: o contador de não-lidas vem do
  // banco pelo realtime, então cada mensagem recebida somava no badge da própria
  // conversa que estava na tela — o atendente lia as três mensagens e a linha
  // ativa continuava anunciando "3" até ele sair da conversa e voltar.
  // Só marca com a aba visível: de uma aba escondida ninguém leu nada, e zerar
  // ali apagaria justamente o aviso que faz a pessoa voltar.
  const lastInboundId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].direction === 'in') return messages[i].id;
    }
    return null;
  }, [messages]);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const marcarLida = () => {
      if (document.visibilityState !== 'visible') return;
      whatsappService.markRead(selectedId).then(() => {
        if (cancelled) return;
        setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, unread_count: 0 } : c));
      }).catch(() => {});
    };
    marcarLida();
    // Voltar para a aba com a conversa aberta também conta como ler.
    document.addEventListener('visibilitychange', marcarLida);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', marcarLida); };
  }, [selectedId, lastInboundId]);

  // Marcar como não lida e SAIR da conversa. Sair não é detalhe: enquanto ela
  // estiver aberta, o efeito acima a marcaria como lida de novo na primeira
  // mensagem que chegasse — e o atendente veria a pendência que acabou de criar
  // desaparecer sozinha. Fechar a thread também é o gesto certo: "não lida"
  // quer dizer "vou cuidar disto depois", e depois começa saindo daqui.
  const handleMarkUnread = useCallback(async () => {
    if (!selectedId) return;
    const alvo = selectedId;
    try {
      await whatsappService.markUnread(alvo);
      setConversations(prev => prev.map(c => c.id === alvo ? { ...c, unread_count: 1 } : c));
      setSelectedId(null);
      toast.success('Marcada como não lida', 'Ela volta para a fila de pendentes.');
    } catch (err: any) {
      toast.error('Não foi possível marcar como não lida', err?.message);
    }
  }, [selectedId, toast]);

  // A conversa restaurada da sessão anterior pode não existir mais (excluída,
  // ou fora do recorte de canais deste usuário): limpa a seleção em vez de
  // deixar a thread num vazio sem explicação.
  useEffect(() => {
    if (loadingConvs || !selectedId || conversations.length === 0) return;
    if (!conversations.some(c => c.id === selectedId)) setSelectedId(null);
  }, [loadingConvs, conversations, selectedId]);

  // Deep-link: ao clicar na notificação de mensagem nova (fora do módulo), o App
  // navega para cá com a conversa-alvo. Seleciona e limpa o param para não reabrir.
  useEffect(() => {
    if (!openConversationId) return;
    setSelectedId(openConversationId);
    onParamConsumed?.();
  }, [openConversationId, onParamConsumed]);

  // Fase N: aviso de fora do horário de atendimento do canal da conversa aberta.
  // A regra de "está aberto?" mora em `businessTime` (a mesma que mede o SLA);
  // aqui só se escolhe qual mensagem mostrar.
  useEffect(() => {
    const instanceId = selected?.instance_id;
    if (!instanceId) { setOutsideHours(null); return; }
    // Antes de saber o expediente, não afirma nada: anunciar "estamos fechados"
    // e desdizer meio segundo depois é pior do que esperar a resposta.
    if (!businessHoursLoaded) return;
    const ch = channels.find(c => c.id === instanceId);
    // O texto do canal só entra na faixa se ele estiver REALMENTE saindo para o
    // cliente. Com `absence_enabled` desligado a faixa mostrava, mesmo assim, a
    // mensagem automática — anunciando ao atendente um aviso que ninguém
    // recebeu (14/08/2026, canal "Comercial"). Fora do horário a faixa continua
    // aparecendo, porque isso é verdade e o atendente precisa saber; o que
    // muda é o texto, que passa a ser o genérico do horário.
    const textoDoCanal = ch?.absence_enabled ? (ch.absence_message || '') : '';
    const schedule = schedulesByChannel[instanceId];
    // Canal sem expediente cadastrado (nem uma linha ativa) segue tratado como
    // fechado, como antes — configurar horário é o que "abre" o canal.
    if (!schedule) {
      setOutsideHours({ message: textoDoCanal || moduleConfig.outside_hours_fallback_message });
      return;
    }
    const status = businessHoursStatus(Date.now(), schedule);
    if (status.open) { setOutsideHours(null); return; }
    if (status.windows.length === 0) {
      setOutsideHours({ message: textoDoCanal || moduleConfig.outside_hours_fallback_message });
      return;
    }
    setOutsideHours({
      message: textoDoCanal || renderTemplate(moduleConfig.outside_hours_schedule_template, {
        extraVars: {
          inicio: status.windows[0].start,
          fim: status.windows[status.windows.length - 1].end,
        },
      }),
    });
  }, [
    selected?.instance_id, selected?.id, channels, schedulesByChannel, businessHoursLoaded,
    moduleConfig.outside_hours_fallback_message, moduleConfig.outside_hours_schedule_template,
  ]);

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
    const searching = q.length > 0;
    const ordenadas = conversations
      .filter(c => {
        // Fase 0: conversa sem nenhuma mensagem (last_message_at nulo) é rascunho de
        // "Nova conversa" aberta mas sem primeiro envio — não polui a inbox. Fica
        // visível apenas enquanto está aberta na thread; ao sair sem enviar, some.
        if (!c.last_message_at && c.id !== selectedId) return false;
        if (filter === 'unread' && c.unread_count === 0) return false;
        if (filter === 'mine' && c.assigned_user_id !== user?.id) return false;
        // A dimensão de status (e a concessão que a busca faz nela) mora em
        // `inboxStatusScope`, compartilhada com os contadores das abas.
        if (hiddenByStatusFilter({
          filter: statusFilter, closed: c.status === 'closed',
          reopened: !!c.reopened_at, liveKey: convStatus(c).key, searching,
        })) return false;
        if (channelFilter !== 'all' && c.instance_id !== channelFilter) return false;
        if (deptFilter === 'none' && c.department_id) return false;
        if (deptFilter !== 'all' && deptFilter !== 'none' && c.department_id !== deptFilter) return false;
        if (labelFilter && inferFunnelStage(c.labels, funnelLabelsForChannel(c.instance_id))?.stageKey !== labelFilter) return false;
        if (!q) return true;
        return matchesConversationSearch(c, q);
      })
      // Ordem igual ao WhatsApp: mensagem mais recente sempre no topo, sem
      // reordenar por status/urgência (a triagem fica nos filtros e badges de SLA).
      // A única exceção é a encerrada que a busca trouxe do arquivo: ela desce
      // para o fim, para o resultado não empurrar a fila de hoje tela abaixo.
      .sort((a, b) => {
        const ra = searchRank({ closed: a.status === 'closed', searching });
        const rb = searchRank({ closed: b.status === 'closed', searching });
        if (ra !== rb) return ra - rb;
        const ta = a.last_message_at || a.created_at;
        const tb = b.last_message_at || b.created_at;
        return tb < ta ? -1 : tb > ta ? 1 : 0;
      });
    // Uma linha por PESSOA — na FILA. O mesmo contato em dois números do
    // escritório rendia duas linhas idênticas, nome igual e foto igual, lidas
    // como duplicata; a thread já mostra o histórico das duas juntas, e aqui a
    // lista passa a falar a mesma língua. A conversa aberta é sempre a
    // sobrevivente do grupo dela, para o clique não trocar a thread debaixo de
    // quem está lendo.
    //
    // Vale na busca também: procurar por uma pessoa e receber duas linhas dela é
    // o mesmo defeito da fila. O arquivo não se perde por isso — o histórico das
    // linhas encerradas já vem dentro da thread da conversa viva, e o filtro
    // "Encerradas" continua listando cada uma delas separadamente.
    return collapseContactThreads(ordenadas, selectedId);
  }, [conversations, search, filter, channelFilter, deptFilter, statusFilter, labelFilter, selectedId, user?.id, funnelLabelsForChannel]);

  // As encerradas que a BUSCA trouxe do arquivo. A lista as usa para duas coisas:
  // desenhar a divisória "Encerradas" onde o grupo começa e pintar essas linhas
  // em preto e branco. Ver uma conversa encerrada no meio da fila, com as mesmas
  // cores das ativas, parece defeito; separada e sem cor, lê-se como o que é —
  // arquivo, ali porque foi procurado.
  //
  // Não vale sob o filtro "Encerradas": lá o arquivo é o assunto, e cinzentar a
  // lista inteira só a faria parecer quebrada.
  const archivedIdsRef = useRef<Set<string>>(new Set());
  const archivedIds = useMemo(() => {
    const next = new Set<string>();
    if (search.trim() && statusFilter !== 'closed') {
      for (const c of filtered) if (c.status === 'closed') next.add(c.id);
    }
    const prev = archivedIdsRef.current;
    if (next.size === prev.size && [...next].every(id => prev.has(id))) return prev;
    archivedIdsRef.current = next;
    return next;
  }, [filtered, search, statusFilter]);

  // Abrir a conversa encerra a busca. Procurar é o caminho até a pessoa, não um
  // modo em que se fica: com o texto no campo, a lista continuava mostrando só
  // aquele nome, e a fila (o que chegou, o que espera resposta) sumia da vista
  // até alguém lembrar de limpar o campo à mão. Quem quiser procurar outra
  // pessoa começa uma busca nova — Ctrl+K já está a uma tecla de distância.
  //
  // Só na lista: `setSelectedId` continua cru nos outros caminhos (deep-link de
  // notificação, aba de agendadas), onde não há busca em jogo.
  const selectFromList = useCallback((id: string) => {
    setSelectedId(id);
    setSearch('');
  }, []);

  // ── Teclado da inbox ─────────────────────────────────────────────────
  // Andar pela fila sem tirar as mãos do teclado: ↑/↓ trocam de conversa,
  // Alt+↑/↓ fazem o mesmo sem sair do compositor e Ctrl/Cmd+K vai para a busca.
  // A decisão de qual tecla é nossa mora em `inboxKeyboard` (pura e testada);
  // aqui só se lê o estado do DOM e se executa o resultado.
  const searchRef = useRef<HTMLInputElement>(null);
  const filteredIds = useMemo(() => filtered.map(c => c.id), [filtered]);
  useEffect(() => {
    // Só na inbox de tela cheia. No modo embutido (widget dentro de outra tela)
    // a seta pertence à página que hospeda o widget, e duas instâncias montadas
    // ao mesmo tempo brigariam pela mesma tecla.
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      const alvo = document.activeElement;
      const action = resolveInboxKey(e, {
        visibleIds: filteredIds,
        selectedId,
        typing: isTypingTarget(alvo),
        inSearch: alvo === searchRef.current,
        hasSearch: search.trim().length > 0,
        dialogOpen: !!document.querySelector('[role="dialog"]'),
        recording,
        overlayOpen: attachMenuOpen || gifOpen || slashActive,
        composing: !!editing || !!replyTo,
        hasDraft: draft.trim().length > 0,
      });
      if (!action) return;
      e.preventDefault();
      // ── Esc: desfaz o topo da pilha (ver `escapeAction`) ──
      if (action.kind === 'cancelRecording') { stopRecording(false); return; }
      if (action.kind === 'closeOverlay') {
        setAttachMenuOpen(false); setGifOpen(false);
        // O menu de modelos não tem estado próprio: ele aparece enquanto o
        // rascunho começa com "/", então fechá-lo é apagar a barra.
        if (slashActive) setDraft('');
        return;
      }
      if (action.kind === 'cancelCompose') { setEditing(null); setReplyTo(null); return; }
      if (action.kind === 'closeConversation') {
        setSelectedId(null);
        // Devolve o foco à lista: sem isso o próximo Esc (ou a próxima seta)
        // cairia num compositor que já não está na tela.
        requestAnimationFrame(() => searchRef.current?.blur());
        return;
      }
      if (action.kind === 'select') {
        setSelectedId(action.conversationId);
        // A linha escolhida pode estar fora da janela visível — e, com
        // `content-visibility`, sequer pintada. `block: 'nearest'` traz só o
        // necessário, sem jogar a lista inteira de lugar.
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(`[data-conv-id="${CSS.escape(action.conversationId)}"]`)
            ?.scrollIntoView({ block: 'nearest' });
        });
        return;
      }
      if (action.kind === 'focusSearch') { searchRef.current?.focus(); searchRef.current?.select(); return; }
      if (action.kind === 'clearSearch') { setSearch(''); return; }
      searchRef.current?.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filteredIds, selectedId, search, embedded]);

  // ── Props estáveis da lista ──────────────────────────────────────────
  // A lista está atrás de um React.memo (ver conversationList.tsx). Estas três
  // props mudariam de identidade a cada tecla/evento e derrubariam o memo, então
  // cada uma devolve a MESMA referência enquanto o conteúdo não muda.

  // Rascunhos das outras conversas. O da conversa aberta é excluído de propósito:
  // ele nunca aparece na lista (você está vendo o compositor), mas o `draftMap`
  // é regravado a cada ~600ms de digitação — sem esse recorte, digitar
  // re-renderizaria a lista inteira duas vezes por segundo.
  const listDraftsRef = useRef<Record<string, string>>({});
  const listDrafts = useMemo(() => {
    const next: Record<string, string> = {};
    for (const [id, value] of Object.entries(draftMap)) {
      if (id === selectedId) continue;
      const trimmed = (value ?? '').trim();
      if (trimmed) next[id] = trimmed;
    }
    const prev = listDraftsRef.current;
    const keys = Object.keys(next);
    const same = keys.length === Object.keys(prev).length && keys.every(k => prev[k] === next[k]);
    if (same) return prev;
    listDraftsRef.current = next;
    return next;
  }, [draftMap, selectedId]);

  // Silenciadas: um Set estável em vez de consultar o store por linha.
  const mutedIdsRef = useRef<Set<string>>(new Set());
  const mutedIds = useMemo(() => {
    const next = new Set(conversations.filter(c => muteStore.isMuted(c.id)).map(c => c.id));
    const prev = mutedIdsRef.current;
    if (next.size === prev.size && [...next].every(id => prev.has(id))) return prev;
    mutedIdsRef.current = next;
    return next;
  }, [conversations, muteSnapshot]);

  // ── Estado da IA por conversa (etiqueta da lista) ──
  // Uma consulta para a inbox inteira, refeita quando o conjunto de conversas
  // muda e a cada minuto — o que anda sozinho aqui é a conta regressiva da
  // retomada, e ela é medida em minutos.
  const [aiStates, setAiStates] = useState<Map<string, { aiActive: boolean; nextFollowupAt: string | null; attemptsDone: number; maxAttempts: number; kind: string | null }>>(new Map());
  const conversationIdsKey = useMemo(() => conversations.map(c => c.id).sort().join(','), [conversations]);
  useEffect(() => {
    const ids = conversationIdsKey ? conversationIdsKey.split(',') : [];
    if (ids.length === 0) { setAiStates(new Map()); return; }
    let active = true;
    const carregar = () => {
      whatsappService.listAiConversationStates(ids)
        .then(map => { if (active) setAiStates(map); })
        .catch(() => { /* a lista funciona sem o chip da IA */ });
    };
    carregar();
    const id = window.setInterval(carregar, 60_000);
    return () => { active = false; window.clearInterval(id); };
  }, [conversationIdsKey]);

  const aiChipFor = useCallback((conversationId: string) => {
    const st = aiStates.get(conversationId);
    if (!st) return null;
    return waAiListChip({
      aiActive: st.aiActive,
      kind: st.kind,
      nextFollowupAt: st.nextFollowupAt,
      attemptsDone: st.attemptsDone,
      maxAttempts: st.maxAttempts,
    });
  }, [aiStates]);

  // Envios que falharam, contados por conversa. A fila otimista atravessa a troca
  // de conversa (ver useWaComposer), então uma mensagem que não saiu enquanto o
  // atendente já estava em outro contato continua existindo — este mapa é o que
  // a faz aparecer na lista, em vez de ficar esperando dentro de uma thread que
  // ninguém tem motivo para reabrir. Mesmo cuidado de identidade das props
  // acima: `pending` muda a cada transição de envio, e a contagem quase nunca.
  const failedSendsRef = useRef<Map<string, number>>(new Map());
  const failedSends = useMemo(() => {
    const next = new Map<string, number>();
    for (const p of pending) {
      if (p._local !== 'failed') continue;
      next.set(p.conversation_id, (next.get(p.conversation_id) ?? 0) + 1);
    }
    const prev = failedSendsRef.current;
    const same = next.size === prev.size && [...next].every(([id, n]) => prev.get(id) === n);
    if (same) return prev;
    failedSendsRef.current = next;
    return next;
  }, [pending]);

  const listEmptyMessage = useMemo(
    () => `Nenhuma conversa${search || filter !== 'all' || channelFilter !== 'all' || deptFilter !== 'all' ? ' para este filtro' : ' ainda'}.`,
    [search, filter, channelFilter, deptFilter],
  );

  // Não-lidas ignoram conversas bloqueadas: elas saem da fila normal.
  const unreadTotal = useMemo(
    () => conversations.reduce((s, c) => s + (c.is_blocked ? 0 : (c.unread_count || 0)), 0),
    [conversations],
  );

  // Agendadas do próprio atendente, em qualquer conversa. Fica FORA do memo das
  // abas abaixo de propósito: não é um recorte da lista de conversas, é outra
  // consulta — e os filtros de fila (canal/setor/etiqueta/busca) não se aplicam.
  const { items: myScheduled, pending: myScheduledPending, failed: scheduledFailed, reload: reloadMyScheduled } = useMyScheduled(user?.id);

  // Contadores das abas (Fase A): refletem exatamente o que a lista mostraria em
  // cada escopo, aplicando os MESMOS filtros de fila (status/canal/depto/etiqueta/
  // busca) e variando só a dimensão da aba. Antes só excluíam rascunhos, então uma
  // conversa encerrada e atribuída ainda contava em "Minhas" mesmo sumindo da lista
  // sob o filtro "Abertas" (badge "Minhas (1)" com lista vazia).
  const tabCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const searching = q.length > 0;
    const base = conversations.filter(c => {
      if (!c.last_message_at && c.id !== selectedId) return false;
      // MESMA regra da lista, pela mesma função: quando a busca traz encerradas
      // do arquivo, elas precisam contar aqui também. Enquanto isto ficou de
      // fora, as abas mostravam "Todas (0)" com três conversas na tela.
      if (hiddenByStatusFilter({
        filter: statusFilter, closed: c.status === 'closed',
        reopened: !!c.reopened_at, liveKey: convStatus(c).key, searching,
      })) return false;
      if (channelFilter !== 'all' && c.instance_id !== channelFilter) return false;
      if (deptFilter === 'none' && c.department_id) return false;
      if (deptFilter !== 'all' && deptFilter !== 'none' && c.department_id !== deptFilter) return false;
      if (labelFilter && inferFunnelStage(c.labels, funnelLabelsForChannel(c.instance_id))?.stageKey !== labelFilter) return false;
      if (q && !matchesConversationSearch(c, q)) return false;
      return true;
    });
    // Mesma regra da lista: a aba conta PESSOAS, não linhas.
    const porPessoa = collapseContactThreads(base, selectedId);
    return {
      all: porPessoa.length,
      unread: porPessoa.filter(c => !c.is_blocked && c.unread_count > 0).length,
      mine: porPessoa.filter(c => c.assigned_user_id === user?.id).length,
    };
  }, [conversations, search, channelFilter, deptFilter, statusFilter, labelFilter, selectedId, user?.id, funnelLabelsForChannel]);

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
    selected, user, agentPrefs, moduleConfig, staffById, aiSession, confirm,
    setConversations, refreshMessages, muteConversationIds: threadIds,
    closeMuteModal: () => setMuteModalOpen(false),
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
    selected, funnelLabels: selectedFunnelLabels, setConversations, setSelectedId,
    loadConversations, reloadOverview, setOverview,
    classifyOnClose: handleAiClassify,
    onStageEntered: runFunnelStageActions,
  });

  /**
   * Roda uma ação que precisa de um cadastro por trás — prazo, compromisso,
   * documento, lançamento.
   *
   * Metade das conversas do dia é com gente que ainda não é cliente, e era
   * exatamente nessas que os botões ficavam apagados: para marcar uma reunião
   * com alguém que ligou hoje era preciso sair do atendimento, abrir o módulo
   * de Clientes e inventar um cadastro. Agora a ação segue em frente; o que ela
   * pede antes é o mínimo que qualquer agenda pede — um nome e um telefone.
   *
   * Com cadastro (cliente ou pré-cadastro), executa direto.
   */
  const comCadastro = useCallback(
    (motivo: string, seguir: (clientId: string, clientName: string) => void) => {
      if (!selected) return;
      if (selected.client_id) {
        seguir(selected.client_id, selected.client_name || selected.contact_name || '');
        return;
      }
      setPreCadastroAsk({ motivo, seguir });
    },
    [selected],
  );

  // Drag and drop de arquivos na thread → useThreadDragDrop (estado do overlay +
  // handlers). O envio em si (sendFile, staging, retry/resend) vive em useWaComposer.
  const { dragOver, dragProps } = useThreadDragDrop(!!selected && !editing, handleDroppedFiles);

  // ── Trocar o canal por onde se fala com este contato ──
  // Não move a conversa: cada número do escritório tem a SUA thread com o
  // contato (é assim do lado do WhatsApp também). `openConversation` reabre a
  // existente ou cria a que faltava, e a thread aberta passa a ser aquela.
  const [switchingChannelId, setSwitchingChannelId] = useState<string | null>(null);
  const selectedChannel = selected?.instance_id ? channelById.get(selected.instance_id) ?? null : null;
  // O alerta de canal fora reaparece a cada conversa aberta: dispensar vale para
  // aquela conversa, não para o problema (que continua até o canal voltar).
  const [channelAlertOk, setChannelAlertOk] = useState<Set<string>>(new Set());
  const channelDown = !!selectedChannel && selectedChannel.status !== 'connected' && !selected?.is_blocked;
  const showChannelAlert = channelDown && !!selected && !channelAlertOk.has(selected.id);
  const channelAlternatives = useMemo(
    () => connectedChannels.filter(c => c.id !== selectedChannel?.id),
    [connectedChannels, selectedChannel?.id],
  );
  const switchConversationChannel = useCallback(async (channelId: string) => {
    if (!selected || channelId === selected.instance_id) return;
    const alvo = channelById.get(channelId);
    if (!selected.contact_phone) {
      toast.warning('Conversa sem telefone', 'Não dá para abrir este contato em outro canal.');
      return;
    }
    setSwitchingChannelId(channelId);
    try {
      const { conversation_id } = await whatsappService.openConversation({
        phone: selected.contact_phone,
        channelId,
        clientId: selected.client_id ?? null,
        contactName: selected.contact_name ?? null,
        departmentId: channelRoutingById.get(channelId)?.default_department_id || null,
      });
      // A troca não pode abandonar o que já ficou preso na thread anterior.
      // Somente as retenções do usuário logado são movidas e reenviadas, na
      // ordem em que ele as escreveu; mensagens de colegas permanecem com eles.
      const resent = await sendReconnectHoldsThroughChannel({
        sourceConversationId: selected.id,
        targetConversationId: conversation_id,
        targetChannelId: channelId,
      });
      await handleConversationOpened(conversation_id);
      loadReconnectAlerts();
      const channelLabel = alvo?.name || alvo?.instance_name || 'outro canal';
      if (resent.total === 0) {
        toast.success('Canal trocado', `Agora falando pelo ${channelLabel}.`);
      } else if (resent.failed === 0) {
        toast.success(
          'Canal trocado e mensagens enviadas',
          `${resent.sent === 1 ? 'A mensagem presa foi enviada' : `${resent.sent} mensagens presas foram enviadas`} pelo ${channelLabel}.`,
        );
      } else {
        toast.warning(
          'Canal trocado com pendência',
          `${resent.sent} enviada${resent.sent === 1 ? '' : 's'}; ${resent.failed} ainda não enviada${resent.failed === 1 ? '' : 's'}. A sirene continuará ativa.`,
        );
      }
    } catch (e: any) {
      toast.error('Não foi possível trocar de canal', e?.message);
    } finally {
      setSwitchingChannelId(null);
    }
  }, [selected, channelById, channelRoutingById, handleConversationOpened, loadReconnectAlerts, toast]);

  const openReconnectAlert = useCallback((conversationId: string) => {
    void handleConversationOpened(conversationId);
  }, [handleConversationOpened]);

  // Print da tela colado com Ctrl+V / Cmd+V vira anexo, pelo mesmo caminho do
  // arrastar-e-soltar (abre o preview com legenda).
  //
  // O listener é do DOCUMENTO, não do <textarea>: depois de tirar o print quase
  // ninguém volta o cursor para o campo de digitação antes de colar — clica na
  // conversa, na lista, em qualquer lugar. Preso ao textarea, o Ctrl+V só
  // funcionava com o foco exatamente ali e falhava calado em todo o resto da
  // tela. É assim que o WhatsApp Web se comporta.
  //
  // O estado vai por ref e o listener é montado UMA vez: `handleDroppedFiles`
  // nasce novo a cada render, e como este módulo re-renderiza a cada tecla
  // digitada no compositor, um efeito dependente dele ficaria removendo e
  // registrando o listener letra por letra.
  const pasteStateRef = useRef({ selected, editing, attachStaged, handleDroppedFiles });
  pasteStateRef.current = { selected, editing, attachStaged, handleDroppedFiles };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const st = pasteStateRef.current;
      // Sem conversa aberta não há destino; em edição só cabe texto; e com o
      // preview aberto a colagem pertence à legenda, não a um anexo novo.
      if (!st.selected || st.editing || st.attachStaged) return;
      const imagens = imagesFromClipboard(e.clipboardData);
      if (imagens.length === 0) return; // colagem de texto segue o fluxo normal
      e.preventDefault();
      st.handleDroppedFiles(imagens);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  // Handlers das bolhas com identidade ESTÁVEL: um ref guarda sempre a última
  // implementação (que fecha sobre estado atual), e o objeto exposto à árvore
  // nunca muda — assim o React.memo das bolhas só re-renderiza quando a própria
  // mensagem muda, não a cada render do módulo.
  const bubbleImplRef = useRef<{
    reply: (m: WhatsAppMessage) => void; edit: (m: WhatsAppMessage) => void;
    retry: (m: WhatsAppMessage) => void; discard: (m: WhatsAppMessage) => void;
    resend: (m: WhatsAppMessage) => void; cancel: (m: WhatsAppMessage) => void;
    createDeadline: (m: WhatsAppMessage) => void; createTask: (m: WhatsAppMessage) => void;
    forward: (m: WhatsAppMessage) => void;
    remove: (m: WhatsAppMessage, scope: WhatsAppDeleteScope) => void;
  }>(null!);
  bubbleImplRef.current = {
    reply: (m) => { setReplyTo(m); setEditing(null); },
    edit: beginEdit,
    retry: retryPending,
    discard: discardPending,
    resend: (m) => { void resendExisting(m); },
    cancel: (m) => { if (m._tempId) cancelUpload(m._tempId); },
    // "Criar prazo/tarefa" a partir da mensagem passa pela mesma porta das
    // ações rápidas: sem cadastro, pede o pré-cadastro e segue.
    createDeadline: (m) => comCadastro('cadastrar um prazo', () => setDeadlineSource(m)),
    createTask: (m) => comCadastro('abrir uma tarefa', () => setTaskSource(m)),
    forward: (m) => setForwardSource(m),
    remove: (m, scope) => { void deleteMessage(m, scope); },
  };

  /**
   * Apaga a mensagem, nos dois alcances do WhatsApp.
   *
   * Confirma antes porque não há desfazer: 'everyone' vai ao aparelho do contato
   * e não volta, e 'me' é a única exclusão que o histórico do escritório registra
   * (a linha fica, mas o conteúdo sai da tela de todo mundo).
   *
   * A tela é atualizada de forma otimista e revertida se o servidor recusar. E a
   * recusa mais provável é uma só: o WhatsApp não deixa revogar mensagem antiga.
   * Nesse caso não basta dizer "não deu" — o toast oferece o caminho que ainda
   * existe, que é apagar só aqui, sem obrigar a pessoa a reabrir o menu e
   * descobrir sozinha qual das duas opções ainda funciona.
   */
  const deleteMessage = async (m: WhatsAppMessage, scope: WhatsAppDeleteScope) => {
    const paraTodos = scope === 'everyone';
    const ok = await confirm({
      title: paraTodos ? 'Apagar para todos?' : 'Apagar só aqui?',
      message: paraTodos
        ? 'A mensagem some da conversa também no aparelho do contato. O WhatsApp só permite isso por um tempo limitado após o envio.'
        : 'A mensagem some da conversa aqui no CRM para toda a equipe. No aparelho do contato ela continua.',
      confirmLabel: 'Apagar',
      tone: 'danger',
    });
    if (!ok) return;

    const antes = { deleted_at: m.deleted_at, deleted_scope: m.deleted_scope, deleted_by: m.deleted_by };
    const agora = new Date().toISOString();
    setMessages(prev => prev.map(x => x.id === m.id
      ? { ...x, deleted_at: agora, deleted_scope: scope, deleted_by: user?.id ?? null } : x));
    try {
      await whatsappService.deleteMessage(m.id, scope);
      playWaActionSound('delete');
      void refreshMessages(selectedId!);
    } catch (err: any) {
      setMessages(prev => prev.map(x => x.id === m.id ? { ...x, ...antes } : x));
      playWaActionSound('error');
      if (paraTodos) {
        toast.error('Não foi possível apagar para todos',
          `${err?.message || 'O WhatsApp recusou a exclusão.'} Você ainda pode apagar só aqui, pelo menu da mensagem.`);
      } else {
        toast.error('Não foi possível apagar a mensagem', err?.message);
      }
    }
  };
  /**
   * Encaminha a mensagem para outras conversas. Mídia vai pelo CAMINHO DO
   * STORAGE (`sendMedia({ storagePath })`), sem baixar e subir o arquivo de
   * novo — é o mesmo objeto que já está lá. Cada destino é independente: um
   * número fora do ar não pode derrubar os outros envios, então o resultado é
   * contado no fim.
   */
  const forwardMessage = async (m: WhatsAppMessage, targets: WhatsAppConversation[]) => {
    if (targets.length === 0) return;
    setForwarding(true);
    // Texto que sai daqui já leva a assinatura do atendente; encaminhar sem
    // tirá-la colaria a assinatura antiga no meio da mensagem nova.
    const text = m.content ? (m.direction === 'out' ? stripAgentSignature(m.content) : m.content) : '';
    const results = await Promise.allSettled(targets.map(target => {
      if (m.type === 'text') return whatsappService.sendText({ conversationId: target.id, text });
      if (!m.storage_path) return Promise.reject(new Error('arquivo indisponível'));
      return whatsappService.sendMedia({
        conversationId: target.id,
        type: (m.type === 'sticker' ? 'image' : m.type) as 'image' | 'video' | 'audio' | 'document',
        text: text || undefined,
        storagePath: m.storage_path,
        mimeType: m.media_mime || 'application/octet-stream',
        fileName: m.file_name || undefined,
      });
    }));
    setForwarding(false);
    const failed = results.filter(r => r.status === 'rejected').length;
    const ok = results.length - failed;
    if (ok > 0) toast.success(`Mensagem encaminhada para ${ok} ${ok === 1 ? 'conversa' : 'conversas'}.`);
    if (failed > 0) {
      const reason = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      toast.error(`Falha ao encaminhar para ${failed} ${failed === 1 ? 'conversa' : 'conversas'}`, reason?.reason?.message);
    }
    if (ok > 0) {
      setForwardSource(null);
      loadConversations();
    }
  };

  const bubbleHandlers = useMemo(() => ({
    onReply: (m: WhatsAppMessage) => bubbleImplRef.current.reply(m),
    onEdit: (m: WhatsAppMessage) => bubbleImplRef.current.edit(m),
    onForward: (m: WhatsAppMessage) => bubbleImplRef.current.forward(m),
    onRetry: (m: WhatsAppMessage) => bubbleImplRef.current.retry(m),
    onDiscard: (m: WhatsAppMessage) => bubbleImplRef.current.discard(m),
    onResend: (m: WhatsAppMessage) => bubbleImplRef.current.resend(m),
    onCancel: (m: WhatsAppMessage) => bubbleImplRef.current.cancel(m),
    onCreateDeadline: (m: WhatsAppMessage) => bubbleImplRef.current.createDeadline(m),
    onCreateTask: (m: WhatsAppMessage) => bubbleImplRef.current.createTask(m),
    onDelete: (m: WhatsAppMessage, scope: WhatsAppDeleteScope) => bubbleImplRef.current.remove(m, scope),
  }), []);

  // Cluster de ações do cabeçalho da lista (status online + sino de notificações
  // + nova conversa). Extraído para reposicionar no modo embutido: lá vai para a
  // linha da busca, eliminando a linha de título "WhatsApp" redundante (o widget
  // já mostra "Mensagens" + aba). Só uma instância é montada por vez.
  // "Próximo da fila": em vez de o atendente escolher a conversa que estiver
  // mais visível, a fila responde qual é a mais urgente AGORA — transferência
  // sem aceite estourada > SLA estourado > urgente > espera longa. Só oferece o
  // que está sem dono: puxar a conversa de um colega é atropelo, não
  // produtividade.
  const queueCandidates = useMemo(
    () => conversations.map(c => ({
      id: c.id,
      status: c.status,
      isBlocked: c.is_blocked,
      assignedUserId: c.assigned_user_id,
      departmentId: c.department_id,
      awaitingAccept: c.awaiting_accept,
      transferPendingSince: c.transfer_pending_since,
      lastMessageDirection: c.last_message_direction,
      lastCustomerMessageAt: c.last_customer_message_at,
      lastMessageAt: c.last_message_at,
      labels: c.labels,
      // Sem o canal, a fila não teria como medir cada conversa no expediente
      // do número em que ela chegou.
      channelId: c.instance_id,
    })),
    [conversations],
  );
  // Recalcula a cada minuto: a urgência é função do relógio, não de um evento.
  const [queueTick, setQueueTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setQueueTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  /**
   * Medição de tempo da fila e dos badges.
   *
   * Enquanto os horários não chegam do banco, mede pelo expediente PADRÃO do
   * escritório (seg–sex 8h–18h) em vez do relógio de parede: é o que a migration
   * semeia para todo canal, então o número já nasce certo em vez de aparecer
   * "parada há 62h" por um instante e encolher sozinho quando a agenda carrega.
   * Depois de carregado, canal sem horário cadastrado volta ao relógio de
   * parede — o comportamento histórico.
   */
  const elapsedMinutes = useMemo(
    () => (businessHoursLoaded
      ? elapsedMinutesForChannels(schedulesByChannel, null)
      : elapsedMinutesFor(DEFAULT_BUSINESS_SCHEDULE)),
    [businessHoursLoaded, schedulesByChannel],
  );

  const queuePolicy = useMemo(
    () => ({ ...DEFAULT_QUEUE_POLICY, elapsedMinutes }),
    [elapsedMinutes],
  );

  const nextUp = useMemo(
    () => nextInQueue(queueCandidates, queueTick, { policy: queuePolicy }),
    [queueCandidates, queueTick, queuePolicy],
  );
  // Badge vermelho no ícone da fila: só conta o que é falha de processo (o
  // destino nunca aceitou, o cliente estourou o SLA), não volume normal — um
  // alerta que acende todo dia deixa de ser alerta.
  // Pedido de descadastro na última mensagem do cliente. A detecção só olha o
  // que já está na tela (nenhuma escrita automática): marcar sozinho um cliente
  // como "não perturbe" a partir de um "pare" ambíguo silenciaria alguém que só
  // queria interromper uma explicação.
  const [optOutDismissed, setOptOutDismissed] = useState<string | null>(null);
  const optOutRequest = useMemo(() => {
    if (!selected || selected.is_blocked || optOutDismissed === selected.id) return false;
    if ((selected.labels ?? []).includes(DO_NOT_DISTURB_LABEL)) return false;
    const lastInbound = [...messages].reverse().find(m => m.direction === 'in');
    if (!lastInbound) return false;
    return isOptOutMessage(lastInbound.content ?? lastInbound.transcription_text);
  }, [selected, messages, optOutDismissed]);

  const markDoNotDisturb = useCallback(async () => {
    if (!selected) return;
    const labels = Array.from(new Set([...(selected.labels ?? []), DO_NOT_DISTURB_LABEL]));
    try {
      await whatsappService.updateLabels(selected.id, labels);
      setConversations(prev => prev.map(c => (c.id === selected.id ? { ...c, labels } : c)));
      toast.success('Marcado como “Não perturbe”', 'Este contato fica fora dos disparos de campanha.');
    } catch (e: any) {
      toast.error('Não foi possível marcar', e?.message);
    }
  }, [selected, toast]);

  const [queuePanelOpen, setQueuePanelOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const queueAlerts = useMemo(
    () => rankQueue(queueCandidates, queueTick, queuePolicy)
      .filter(p => p.bucket === 'transferencia_travada' || p.bucket === 'sla_estourado').length,
    [queueCandidates, queueTick, queuePolicy],
  );
  const takeNextInQueue = useCallback(() => {
    if (!nextUp) return;
    setSelectedId(nextUp.id);
    // Só mexe nos filtros do atendente se a conversa escolhida não estivesse
    // visível — abrir a thread e deixar a lista mostrando outra coisa é
    // desorientador, mas trocar o escopo dele sem necessidade também é.
    if (!filtered.some(c => c.id === nextUp.id)) {
      setFilter('all');
      setStatusFilter('open');
    }
  }, [nextUp, filtered]);

  const listHeaderActions = (
    <div className="flex items-center gap-2 shrink-0">
      {/* Canal fora = a inbox parou de receber eventos e está sendo reposta por
          HTTP. Dizer isso evita a leitura de "o sistema travou". */}
      {realtimeStatus === 'down' ? (
        <span title="Sem conexão em tempo real — atualizando por sincronização periódica"
          className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
          <RefreshCw size={11} className="animate-spin" />
          Reconectando…
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: anyConnected ? '#16a34a' : '#9ca3af' }} />
          {anyConnected ? 'Online' : 'Offline'}
        </span>
      )}
      <WaNotifyBell pushState={pushState} onTogglePush={toggleStaffPush} />
      {/* "Próximo da fila" fica sempre à mão: é ação de atendimento, feita
          dezenas de vezes por dia, não configuração. */}
      {!embedded && nextUp && (
        <button onClick={takeNextInQueue}
          title={`Próximo da fila: ${nextUp.label}`}
          aria-label={`Próximo da fila: ${nextUp.label}`}
          className={`flex items-center justify-center w-7 h-7 rounded-full transition ${
            nextUp.bucket === 'transferencia_travada' || nextUp.bucket === 'sla_estourado'
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : nextUp.bucket === 'urgente' || nextUp.bucket === 'sla_atencao'
                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                : 'bg-[#f3f2ef] text-slate-600 hover:bg-slate-200'
          }`}>
          <ListTodo size={15} />
        </button>
      )}
      {/* Gestão (fila, dashboard, acessos, funis) atrás de um único botão. Em
          fila, esses quatro ícones estouravam a largura da coluna e sumiam
          cortados na borda — e nenhum deles é ação de minuto a minuto. */}
      {!embedded && (
        <div className="relative">
          <button onClick={() => setMoreMenuOpen(o => !o)} aria-expanded={moreMenuOpen}
            title="Gestão do atendimento"
            className={`relative flex items-center justify-center w-7 h-7 rounded-full transition ${
              moreMenuOpen ? 'bg-slate-200 text-slate-700' : 'bg-[#f3f2ef] text-slate-600 hover:bg-slate-200'
            }`}>
            <MoreVertical size={15} />
            {queueAlerts > 0 && (
              <span title={`${queueAlerts} na fila precisando de ação`}
                className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">
                {queueAlerts}
              </span>
            )}
          </button>
          {moreMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-xl border border-[#e7e5df] bg-white shadow-lg py-1">
                <button onClick={() => { setMoreMenuOpen(false); setQueuePanelOpen(true); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-[#faf9f7] transition">
                  <Activity size={15} className={queueAlerts > 0 ? 'text-red-600' : 'text-slate-400'} />
                  Fila de atendimento
                  {queueAlerts > 0 && (
                    <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-red-100 text-red-700 text-[10px] font-bold flex items-center justify-center">
                      {queueAlerts}
                    </span>
                  )}
                </button>
                <button onClick={() => { setMoreMenuOpen(false); setShowDashboard(true); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-[#faf9f7] transition">
                  <BarChart2 size={15} className="text-slate-400" /> Dashboard
                </button>
                {/* Caminho PERMANENTE para o app dedicado: a régua de convite
                    some depois de dispensada ou instalada, e sem isto não
                    sobraria nenhum lugar para reabrir o app. */}
                {!dentroDoApp && (
                  <button onClick={() => { setMoreMenuOpen(false); openAtendimentoApp(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-[#faf9f7] transition">
                    <AppWindow size={15} className="text-slate-400" /> Abrir como aplicativo
                  </button>
                )}
                {canManageChannelAccess && <>
                  <div className="my-1 border-t border-[#f1f0ec]" />
                  <button onClick={() => { setMoreMenuOpen(false); setChannelAccessOpen(true); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-[#faf9f7] transition">
                    <LockKeyhole size={15} className="text-slate-400" /> Quem vê cada canal
                  </button>
                  <button onClick={() => { setMoreMenuOpen(false); setChannelFunnelsOpen(true); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-[#faf9f7] transition">
                    <GitBranch size={15} className="text-slate-400" /> Funil de cada canal
                  </button>
                </>}
              </div>
            </>
          )}
        </div>
      )}
      <button onClick={() => setNewConvOpen(true)} title="Nova conversa"
        className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-600 text-white hover:bg-amber-700 transition active:scale-90 hover:rotate-90 duration-200">
        <Plus size={16} />
      </button>
    </div>
  );

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-[#faf9f7]">
      <ReconnectHoldSiren
        items={reconnectAlerts}
        conversationsById={conversationsById}
        channelsById={channelById}
        privateMode={privateMode}
        onOpen={openReconnectAlert}
      />
      {/* Convite ao app dedicado — só no CRM (dentro do próprio app não faz
          sentido) e só na página cheia (no widget não há largura para isto). */}
      {!embedded && !dentroDoApp && <AtendimentoAppInvite />}
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
              <select value={leadChannelFilter} onChange={e => selectLeadChannel(e.target.value)}
                aria-label="Canal do funil de Leads"
                className="text-[12px] pl-2 pr-6 py-1 rounded-lg bg-white border border-[#e7e5df] focus:border-amber-300 outline-none">
                {funnelChannels.length === 0 && <option value="">Nenhum canal com funil ativo</option>}
                {funnelChannels.map(c => (
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
              funnelLabels={funnelLabelsForChannel(leadChannelFilter)}
              channelId={leadChannelFilter}
              onOpen={(id) => { setSelectedId(id); setLeadsPanelOpen(false); }}
              onMoved={(id, labels) => setConversations(prev => prev.map(c => c.id === id ? { ...c, labels } : c))}
              onStageEntered={runFunnelStageActions}
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
      <div className="relative flex flex-1 min-h-0">
      {/* ── Lista de conversas ── */}
      <aside style={isMobile ? undefined : { width: listWidth }}
        data-testid="whatsapp-conversation-list"
        className={`flex-shrink-0 flex-col border-r border-[#e7e5df] bg-white min-h-0 ${isMobile ? (selectedId ? 'hidden' : 'flex w-full') : 'flex'}`}>
        <div className={`border-b border-[#e7e5df] ${embedded ? 'px-3 pt-2.5 pb-2' : 'px-4 pt-4 pb-3'}`}>
          {!embedded && (
            <div className="flex items-center justify-between gap-2 mb-3">
              {/* O título cede espaço antes das ações: se algo tiver que
                  encolher, é a palavra "WhatsApp", nunca os botões. */}
              <div className="flex items-center gap-2 min-w-0">
                <MessageCircle size={18} className="text-amber-600 shrink-0" />
                <h2 className="font-bold text-slate-800 text-[15px] truncate">WhatsApp</h2>
              </div>
              {listHeaderActions}
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar conversa…" title="Buscar conversa (Ctrl+K) · ↑ ↓ trocam de conversa"
                className={`w-full pl-9 text-[13px] rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none ${embedded ? 'py-1.5 pr-3' : 'py-2 pr-12'}`} />
              {/* Atalho anunciado no próprio campo: atalho que ninguém descobre
                  não existe. Some quando há texto (o dedo já está no teclado) e
                  no modo embutido, onde não há largura sobrando. */}
              {!embedded && !search && (
                <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 select-none rounded border border-slate-200 bg-white px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-400 sm:block">
                  Ctrl K
                </kbd>
              )}
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
              aria-label="Canal da inbox"
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
              <option value="">Todas as etapas</option>
              {labelFilterOptions.map(l => <option key={l.stageKey} value={l.stageKey}>{l.stageLabel}</option>)}
            </select>
          </div>
          )}

          {/* Abas de situação (restauradas): Todas / Não lidas / Minhas / Agendadas */}
          <div className={`flex items-center gap-1 flex-wrap ${embedded ? 'mt-2' : 'mt-2.5'}`}>
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
            {/* Uma agendada que falhou some de vista: ninguém volta na conversa
                para conferir. Por isso a aba grita em vermelho enquanto houver
                falha, mesmo que o atendente esteja em outra aba. */}
            <button onClick={() => setFilter('scheduled')}
              title={scheduledFailed > 0 ? `${scheduledFailed} não foram entregues` : undefined}
              className={`px-3 py-1 rounded-full text-[12px] font-semibold transition inline-flex items-center gap-1.5 ${
                filter === 'scheduled'
                  ? (scheduledFailed > 0 ? 'bg-red-600 text-white' : 'bg-amber-600 text-white')
                  : (scheduledFailed > 0 ? 'text-red-600 hover:bg-red-50' : 'text-slate-500 hover:bg-[#f3f2ef]')
              }`}>
              {scheduledFailed > 0 && <AlertTriangle size={12} />}
              {/* O distintivo conta só a FILA: o histórico de enviadas mora na
                  mesma aba, mas não é pendência de ninguém. */}
              Agendadas{myScheduledPending.length ? ` (${myScheduledPending.length})` : ''}
            </button>
          </div>
        </div>

        <div ref={setListEl} onScroll={onListScroll} className="flex-1 overflow-y-auto overscroll-contain min-h-0">
          {filter === 'scheduled' ? (
          <MyScheduledList
            items={myScheduled}
            privateMode={privateMode}
            confirm={confirm}
            onReload={reloadMyScheduled}
            /* Abrir a conversa NÃO troca de aba: voltar para "Todas" trocava a fila
               de agendadas pela lista inteira e quem estava conferindo os
               agendamentos perdia o lugar a cada clique. `selected` sai de
               `conversations` (sem filtro), então a thread abre do mesmo jeito
               com a aba de agendadas de pé. */
            onOpenConversation={setSelectedId}
          />
          ) : (
          <ConversationList
            conversations={filtered}
            selectedId={selectedId}
            loading={loadingConvs}
            privateMode={privateMode}
            emptyMessage={listEmptyMessage}
            channelById={channelById}
            deptById={deptById}
            drafts={listDrafts}
            mutedIds={mutedIds}
            failedSends={failedSends}
            archivedIds={archivedIds}
            showChannelName={channels.length > 1}
            busyConversationIds={busyConversationIds}
            funnelLabelsForChannel={funnelLabelsForChannel}
            elapsedMinutes={elapsedMinutes}
            conversationStatus={effectiveConversationStatus}
            docStatusFor={effectiveDocStatus}
            aiChipFor={aiChipFor}
            trackedSignatureFor={trackedSignatureStatus}
            onSelect={selectFromList}
            onStopSignatureTracking={stopSignatureTracking}
            onStopTemplateFillTracking={stopTemplateFillTracking}
          />
          )}
        </div>
      </aside>

      {/* Divisória arrastável lista ↔ thread (Fase 10.1) */}
      <div onPointerDown={startListResize} title="Arraste para redimensionar" role="separator" aria-orientation="vertical"
        className="hidden md:block w-1.5 flex-shrink-0 cursor-col-resize touch-none bg-transparent hover:bg-amber-300/60 active:bg-amber-400/70 transition-colors" />

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
            <header className={`flex items-center gap-2 sm:gap-3 border-b border-black/[0.06] bg-[#f0f2f5] ${embedded ? 'px-2.5 py-2' : 'px-2.5 sm:px-5 py-2.5'}`}>
              {isMobile && (
                <button onClick={() => setSelectedId(null)} title="Voltar à lista"
                  className="flex-shrink-0 -ml-1 w-9 h-9 rounded-lg text-slate-600 hover:bg-[#f3f2ef] flex items-center justify-center transition">
                  <ChevronLeft size={22} />
                </button>
              )}
              <Avatar url={selected.contact_avatar_url} name={conversationName(selected)} phone={selected.contact_phone} size={36}
                onClick={selected.contact_avatar_url ? () => setLightbox(selected.contact_avatar_url) : undefined} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold text-slate-800 truncate">{privateMode ? maskName(conversationName(selected)) : conversationName(selected)}</p>
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
                  {(() => { const sla = slaSignal(selected, elapsedMinutes); return sla ? (
                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: sla.color }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: sla.color }} /> {sla.label}
                    </span>
                  ) : null; })()}
                  {(() => { const ta = transferAlert(selected, elapsedMinutes); return ta ? (
                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: ta.color }}>
                      <ArrowRightLeft size={11} /> {ta.label}
                    </span>
                  ) : null; })()}
                </div>
              </div>
              {/* Canal da conversa: por qual número se está falando, com o estado
                  da conexão à vista e a troca a um clique. Fica FORA da linha de
                  subtítulo (que tem overflow-hidden e cortaria o menu). */}
              {channels.length > 0 && (
                <ChannelSwitcher channels={channels} currentId={selected.instance_id}
                  busyId={switchingChannelId} compact={isMobile} onSwitch={switchConversationChannel} />
              )}
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
                {/* Silenciar contato (notificações), estilo WhatsApp */}
                {(() => {
                  const untilLabel = selectedContactMuted
                    ? (selectedContactMutedUntil == null ? 'silenciado sem prazo' : `silenciado até ${new Date(selectedContactMutedUntil).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`)
                    : '';
                  return (
                    <div className="relative flex-shrink-0">
                      <button
                        onClick={() => selectedContactMuted ? unmuteSelected() : setMuteModalOpen(true)}
                        title={selectedContactMuted ? `${untilLabel} — clique para reativar as notificações` : 'Silenciar notificações deste contato'}
                        aria-pressed={selectedContactMuted}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center transition ${selectedContactMuted ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-[#f3f2ef] text-slate-600 hover:bg-amber-50 hover:text-amber-700'}`}>
                        {selectedContactMuted ? <BellOff size={16} /> : <Bell size={16} />}
                      </button>
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
                          <button className={item} onClick={run(() => selectedContactMuted ? unmuteSelected() : setMuteModalOpen(true))}>
                            {selectedContactMuted ? <Bell size={16} className="text-amber-500" /> : <BellOff size={16} className="text-slate-400" />} {selectedContactMuted ? 'Reativar notificações' : 'Silenciar contato…'}
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

            {/* Colisão de atendimento. Numa inbox compartilhada, dois atendentes
                abrem a mesma conversa sem saber um do outro: ou o cliente recebe
                duas respostas — às vezes divergentes, na frente dele —, ou cada
                um supõe que o outro pegou e ninguém responde. Uma faixa fina,
                logo abaixo do cabeçalho, resolve com informação: fica no caminho
                dos olhos antes de a mão chegar ao compositor, e não empurra
                nada de lugar quando some. */}
            {hereWithMe.length > 0 && (
              <div className="wa-collision flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5">
                <Users size={13} className="flex-shrink-0 text-amber-600" />
                <span className="truncate text-[11.5px] font-semibold text-amber-800">
                  {viewersLabel(hereWithMe)}
                </span>
                <span className="ml-auto flex-shrink-0 text-[10.5px] text-amber-600">
                  cuidado para não responder em dobro
                </span>
              </div>
            )}

            {/* Sem cliente vinculado o resumo continua existindo pelo que veio do
                telefone do contato — é ali que aparece a faixa de "cliente
                assinou". O próprio banner some quando não há nada a dizer. */}
            <ConversationSummaryBanner embedded={embedded} overview={overview} docStatus={selected.client_id ? effectiveDocStatus(selected.client_id) : null} clientId={selected.client_id} onOpenWorkspace={openWa} onDismissDocReady={() => selected.client_id && dismissDocReady(selected.client_id)} onDismissTemplateFill={stopTemplateFillTracking} onStopSignatureTracking={stopSignatureTracking} />

            {/* O resumo por extenso mora na coluna lateral: com o roteiro de
                triagem inteiro, a faixa larga que ficava aqui tomava meia tela
                e empurrava as mensagens para fora da vista. Sobra a linha que
                avisa que ele existe — e leva até ele. */}
            <AiHandoffSummaryStrip
              data={handoffSummary}
              onOpenPanel={() => {
                if (panelDocked) setDetailsPanelCollapsed(false);
                else setMobilePanelOpen(true);
              }}
            />

            {/* A faixa do agente. O contador antigo ("N turnos · passo N") saiu:
                era do playbook da tentativa anterior e ficava em zero para
                sempre, servindo de prova falsa de que o agente estava parado.
                O estado de verdade vem de getAiConversationState. */}
            <AiAgentBanner conversationId={selected.id} onAssume={handleAssume} />
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

            {/* O invólucro existe para ancorar o botão de voltar ao fim: ele
                precisa flutuar sobre a conversa sem rolar junto com ela. */}
            <div className="relative flex flex-1 min-h-0 flex-col">
            {/* `overscroll-contain`: chegar ao fim da conversa não pode empurrar
                a rolagem para o que estiver atrás (a página do CRM, o painel).
                Era o pulo seco no fim de cada thread. */}
            <div ref={setThreadEl} onScroll={onThreadScroll} className="wa-thread-bg flex-1 overflow-y-auto overscroll-contain min-h-0">
              <div ref={threadContentRef} className="mx-auto w-full max-w-[1180px] px-3 sm:px-6 py-4">
              {loadingMsgs ? (
                <ThreadSkeleton />
              ) : (() => {
                // Desenha UMA unidade (bolha ou álbum). O índice é o global em
                // `messageUnits`: o agrupamento visual olha a unidade anterior e a
                // seguinte, e essas vizinhas atravessam a fronteira das seções.
                const renderUnit = (u: MessageUnit, unitIndex: number) => {
                  const head = u.kind === 'album' ? u.items[0] : u.m;
                  const tail = u.kind === 'album' ? u.items[u.items.length - 1] : u.m;
                  const previousUnit = unitIndex > 0 ? messageUnits[unitIndex - 1] : null;
                  const nextUnit = unitIndex < messageUnits.length - 1 ? messageUnits[unitIndex + 1] : null;
                  const previousTail = previousUnit
                    ? (previousUnit.kind === 'album' ? previousUnit.items[previousUnit.items.length - 1] : previousUnit.m)
                    : null;
                  const nextHead = nextUnit ? (nextUnit.kind === 'album' ? nextUnit.items[0] : nextUnit.m) : null;
                  const belongsToSameGroup = (left: WhatsAppMessage | null, right: WhatsAppMessage | null) => {
                    if (!left || !right) return false;
                    if (left.direction !== right.direction || (left.sender_user_id || null) !== (right.sender_user_id || null)) return false;
                    if (new Date(left.wa_timestamp).toDateString() !== new Date(right.wa_timestamp).toDateString()) return false;
                    return Math.abs(new Date(right.wa_timestamp).getTime() - new Date(left.wa_timestamp).getTime()) <= 5 * 60_000;
                  };
                  const groupStart = !belongsToSameGroup(previousTail, head);
                  const groupEnd = !belongsToSameGroup(tail, nextHead);
                  const senderName = groupStart && head.direction === 'out' && head.sender_user_id
                    ? (agentLabel(staffById.get(head.sender_user_id)) || staffByUser.get(head.sender_user_id) || null)
                    : null;
                  const key = u.kind === 'album' ? `album-${head._tempId || head.id}` : (head._tempId || head.id);
                  return u.kind === 'album' ? (
                    <ImageAlbum key={key} items={u.items} out={head.direction === 'out'} senderName={senderName} groupStart={groupStart} onOpenImage={setLightbox} />
                  ) : (
                    <MessageBubble
                      key={key}
                      m={u.m}
                      repliedTo={u.m.reply_to_id ? msgById.get(u.m.reply_to_id) || null : null}
                      senderName={senderName}
                      senderRole={u.m.direction === 'out' && u.m.sender_user_id ? agentRoleLabel(staffById.get(u.m.sender_user_id)) : null}
                      groupStart={groupStart}
                      groupEnd={groupEnd}
                      privateMode={privateMode}
                      canCreateFollowups
                      onOpenImage={setLightbox}
                      nextAudioId={u.m.type === 'audio' ? nextAudioId.get(u.m.id) ?? null : null}
                      uploadProgress={u.m._tempId ? uploadProgress.get(u.m._tempId) : undefined}
                      {...bubbleHandlers}
                    />
                  );
                };
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
                  {/* UMA SEÇÃO POR DIA. O <div> não é enfeite: é o que dá ao
                      divisor grudento um fim para ser empurrado. Sem ele, todos os
                      divisores paravam na mesma altura e se sobrepunham. */}
                  {diasDaThread.map(dia => (
                    <div key={dia.chave}>
                      <DateDivider label={dayLabel(dia.tsInicial)} />
                      {messageUnits.slice(dia.inicio, dia.fim).map((u, i) => renderUnit(u, dia.inicio + i))}
                    </div>
                  ))}
                  <ThreadScheduledGhosts conversationId={selected.id} privateMode={privateMode} confirm={confirm} />
                </>);
              })()}
              </div>
            </div>

            {/* Voltar ao fim. Sem isto, quem sobe para reler o histórico só volta
                arrastando a barra — e não fica sabendo do que chegou no caminho.
                O número conta apenas mensagens RECEBIDAS: as próprias já levam
                quem enviou até o fim. */}
            {scrolledUp && (
              <button
                onClick={scrollToBottom}
                title={newBelow > 0 ? `${newBelow} nova(s) mensagem(ns)` : 'Ir para o fim da conversa'}
                aria-label={newBelow > 0
                  ? `Ir para o fim da conversa, ${newBelow} mensagem(ns) nova(s)`
                  : 'Ir para o fim da conversa'}
                className="wa-jump absolute bottom-4 right-4 z-[3] flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.06] bg-white text-slate-500 shadow-md hover:text-slate-800"
              >
                <ChevronDown size={20} />
                {newBelow > 0 && (
                  <span className="wa-badge-pop absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-bold text-white">
                    {newBelow > 99 ? '99+' : newBelow}
                  </span>
                )}
              </button>
            )}
            </div>

            {/* Banner de reply / edição */}
            {(replyTo || editing) && !selected.is_blocked && (
              <div className="px-3 pt-2 bg-[#f0f2f5]">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border-l-[3px] border-[#00a884] shadow-sm">
                  {editing ? <Pencil size={14} className="text-[#008069] flex-shrink-0" /> : <CornerUpLeft size={14} className="text-[#008069] flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold text-[#008069]">{editing ? 'Editando mensagem' : `Respondendo${(replyTo!.direction === 'out') ? ' você' : ''}`}</p>
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
                    Atendimento encerrado{selected.closure_reason ? ` — ${selected.closure_reason}` : ''}. Reabre sozinho se o cliente voltar a falar ou assim que você enviar uma mensagem por aqui.
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

            {/* Pedido de descadastro. Continuar disparando campanha para quem
                pediu para sair é o caminho mais rápido para ser denunciado como
                spam — e o WhatsApp derruba o número do escritório, não a
                campanha. Detectamos e propomos a marcação; quem decide é a
                equipe, porque "pare" no meio de um atendimento nem sempre é
                descadastro. */}
            {optOutRequest && (
              <div className="px-4 py-2 border-t border-violet-200 bg-violet-50 flex items-center gap-2">
                <BellOff size={14} className="text-violet-600 flex-shrink-0" />
                <p className="flex-1 text-[12px] text-violet-900">
                  O cliente parece ter pedido para não receber mais mensagens de campanha.
                </p>
                <button onClick={markDoNotDisturb}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-violet-200 text-violet-700 text-[12px] font-semibold hover:bg-violet-100 transition">
                  Marcar “{DO_NOT_DISTURB_LABEL}”
                </button>
                <button onClick={() => setOptOutDismissed(selected.id)}
                  title="Não é descadastro"
                  className="flex-shrink-0 text-violet-400 hover:text-violet-700 text-[12px]">✕</button>
              </div>
            )}

            {/* Canal fora do ar: o alerta escurece a tela ao abrir a conversa; a
                faixa fica de lembrete depois de dispensado. Mensagem que não sai
                sem ninguém perceber é o defeito que não pode acontecer. */}
            {showChannelAlert && selectedChannel && (
              <ChannelDownAlert channel={selectedChannel} alternatives={channelAlternatives}
                busyId={switchingChannelId} onSwitch={switchConversationChannel}
                onDismiss={() => setChannelAlertOk(prev => new Set(prev).add(selected.id))} />
            )}
            {channelDown && selectedChannel && (
              <ChannelDownBanner channel={selectedChannel} alternatives={channelAlternatives}
                busyId={switchingChannelId} onSwitch={switchConversationChannel} />
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
            <div className="relative px-2.5 sm:px-3 py-2 border-t border-black/[0.06] bg-[#f0f2f5]">
              {recording ? (
                <div className="flex items-center gap-2.5">
                  {/* Lixeira = cancelar e descartar a gravação (ou Esc) */}
                  <button onClick={() => stopRecording(false)} title="Cancelar gravação (Esc)"
                    className="flex-shrink-0 w-9 h-9 rounded-full text-red-500 hover:bg-red-50 flex items-center justify-center transition">
                    <Trash2 size={18} />
                  </button>
                  {/* Pílula com ponto pulsante + onda do microfone + cronômetro */}
                  <div className="flex-1 min-w-0 flex items-center gap-2.5 px-3.5 h-10 rounded-full bg-white">
                    <span className="flex-shrink-0 w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
                    <div className="flex-1 min-w-0 flex items-center justify-center gap-[3px] h-5 overflow-hidden">
                      {WA_REC_BARS.map((peso, i) => (
                        // 0.12 é o piso: a barra nunca some de todo, senão o
                        // silêncio pareceria "gravação travada" em vez de
                        // "gravando, sem som". O peso só torce o contorno.
                        <span key={i} className="w-[3px] flex-shrink-0 rounded-full bg-red-400/80"
                          style={{
                            height: '100%',
                            transformOrigin: 'center',
                            transform: `scaleY(${Math.max(0.12, recLevel * peso)})`,
                            // Curto o bastante para acompanhar a fala, longo o
                            // bastante para o quadro a quadro não tremer.
                            transition: 'transform 90ms linear',
                          }} />
                      ))}
                    </div>
                    <span className="flex-shrink-0 text-[13px] font-semibold text-red-600 tabular-nums">
                      {String(Math.floor(recSeconds / 60)).padStart(2, '0')}:{String(recSeconds % 60).padStart(2, '0')}
                    </span>
                  </div>
                  {/* Enviar o áudio */}
                  <button onClick={() => stopRecording(true)} title="Enviar áudio (Enter)"
                    className="flex-shrink-0 w-10 h-10 rounded-full bg-[#00a884] text-white flex items-center justify-center hover:bg-[#008f72] transition">
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
                    {gifOpen && <div className="fixed inset-0 z-20" onClick={() => setGifOpen(false)} />}
                    {gifOpen && (
                      <GifPicker onClose={() => setGifOpen(false)}
                        onPick={async item => {
                          setGifOpen(false);
                          try {
                            void sendGif(await giphyService.baixar(item));
                          } catch (e: any) {
                            toast.error('GIF não enviado', e?.message || 'Falha ao baixar o GIF.');
                          }
                        }} />
                    )}
                    {attachMenuOpen && <div className="fixed inset-0 z-20" onClick={() => setAttachMenuOpen(false)} />}
                    {/* Menu de anexos acima do botão "+" integrado ao compositor. */}
                    {attachMenuOpen && (() => {
                        const row = 'w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-[13.5px] font-medium text-slate-700 hover:bg-amber-50 transition disabled:opacity-50';
                        const dot = 'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0';
                        const run = (fn: () => void) => () => { setAttachMenuOpen(false); fn(); };
                        return (
                          <div className="absolute left-2.5 sm:left-3 bottom-full mb-2 z-30 w-60 rounded-2xl bg-white shadow-[0_12px_40px_-8px_rgba(15,23,42,0.25)] ring-1 ring-black/5 p-1.5 origin-bottom-left animate-[waPop_120ms_ease-out]">
                            <style>{`@keyframes waPop{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}`}</style>
                            <button className={row} onClick={run(() => imgInputRef.current?.click())}><span className={`${dot} bg-amber-100 text-amber-700`}><ImageIcon size={17} /></span> Imagem ou vídeo</button>
                            <button className={row} onClick={run(() => docInputRef.current?.click())}><span className={`${dot} bg-amber-100 text-amber-700`}><Paperclip size={17} /></span> Documento</button>
                            <button className={row} onClick={run(() => setGifOpen(true))}><span className={`${dot} bg-amber-100 text-amber-700`}><Clapperboard size={17} /></span> GIF</button>
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
                  </>
                )}
                <div className="flex items-end gap-2">
                  {!editing && (
                    <button onClick={() => setAttachMenuOpen(o => !o)} title="Anexos e ações" aria-haspopup="menu" aria-expanded={attachMenuOpen}
                      className="flex-shrink-0 w-10 h-10 rounded-full text-[#54656f] flex items-center justify-center hover:bg-black/[0.06] transition">
                      <Plus size={22} className={`transition-transform duration-200 ${attachMenuOpen ? 'rotate-45' : ''}`} />
                    </button>
                  )}
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
                    {/* Barra de formatação: aparece com texto selecionado.
                        `onMouseDown` com preventDefault é o que segura o foco no
                        campo — sem isso o clique no botão tira a seleção antes
                        de o handler rodar, e não haveria o que formatar. */}
                    {textSel && !slashActive && !recording && (
                      <div className="absolute bottom-full left-0 mb-2 z-30 flex items-center gap-0.5 p-1 rounded-xl bg-[#233138] shadow-xl ring-1 ring-black/10"
                        onMouseDown={e => e.preventDefault()}>
                        {([
                          ['bold', 'Negrito', 'Ctrl+B', <b key="b">B</b>],
                          ['italic', 'Itálico', 'Ctrl+I', <i key="i" className="font-serif">I</i>],
                          ['strike', 'Riscado', 'Ctrl+Shift+X', <s key="s">S</s>],
                          ['mono', 'Monoespaçado', null, <span key="m" className="font-mono text-[12px]">{'</>'}</span>],
                        ] as Array<[WaFormat, string, string | null, React.ReactNode]>).map(([fmt, nome, atalho, icone]) => (
                          <button key={fmt} onClick={() => aplicarFormato(fmt)}
                            title={atalho ? `${nome} (${atalho})` : nome}
                            className="w-8 h-8 rounded-lg text-white/75 hover:text-white hover:bg-white/15 transition flex items-center justify-center text-[14px]">
                            {icone}
                          </button>
                        ))}
                      </div>
                    )}
                    {!slashActive && (
                      <ComposerSpellcheckOverlay text={draft} issues={composerSpellcheck.issues}
                        scrollTop={composerScrollTop} scrollbarWidth={composerScrollbarWidth} />
                    )}
                    <textarea ref={draftRef} value={draft} onChange={e => setDraft(e.target.value)}
                      onScroll={e => setComposerScrollTop(e.currentTarget.scrollTop)}
                      onContextMenu={openComposerSpellMenu}
                      onSelect={syncTextSel}
                      onBlur={() => setTextSel(null)}
                      onKeyDown={e => {
                        const fmt = formatFromKey(e.key, e.ctrlKey || e.metaKey, e.shiftKey);
                        if (fmt) { e.preventDefault(); aplicarFormato(fmt); return; }
                        if (slashActive) {
                          if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => Math.min(i + 1, slashResults.length - 1)); return; }
                          if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => Math.max(i - 1, 0)); return; }
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyTemplate(slashResults[slashIdx]); return; }
                          if (e.key === 'Escape') { e.preventDefault(); setDraft(''); return; }
                        }
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                        if (e.key === 'Escape') { setEditing(null); setReplyTo(null); }
                      }}
                      spellCheck lang="pt-BR" autoCorrect="on" autoCapitalize="sentences"
                      data-testid="whatsapp-message-input"
                      rows={1} placeholder={editing ? 'Editar mensagem…' : 'Digite uma mensagem…'}
                      className="relative z-0 w-full resize-none max-h-48 min-h-[40px] leading-5 px-3.5 py-2.5 text-[14px] rounded-xl bg-white border border-transparent focus:border-[#00a884]/35 outline-none shadow-[0_1px_1px_rgba(11,20,26,0.04)]" />
                    <ComposerSpellcheckContextMenu menu={composerSpellMenu}
                      onReplace={replaceComposerSpelling} onClose={closeComposerSpellMenu} />
                  </div>
                  {draft.trim() || editing ? (
                    /* `sending` aqui é só a EDIÇÃO (uma de cada vez). Envio normal
                       nunca desabilita o botão: as mensagens entram numa fila
                       interna e saem na ordem digitada, então dá para escrever a
                       próxima enquanto a anterior ainda está carregando. */
                    <button onClick={handleSend} disabled={sending || !draft.trim()}
                      className={`flex-shrink-0 w-10 h-10 rounded-full bg-[#00a884] text-white flex items-center justify-center hover:bg-[#008f72] hover:scale-105 disabled:opacity-40 transition active:scale-90 ${sending ? '' : 'wa-send-ready'}`}>
                      {sending ? <Loader2 size={16} className="animate-spin" /> : editing ? <Check size={18} /> : <Send size={16} />}
                    </button>
                  ) : (
                    <button title="Gravar áudio" onClick={startRecording}
                      className="flex-shrink-0 w-10 h-10 rounded-full text-[#54656f] flex items-center justify-center hover:bg-black/[0.06] hover:text-[#00a884] transition active:scale-90">
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
      {selected && panelDocked && !detailsPanelCollapsed && (
        <div onPointerDown={startPanelResize} title="Arraste para redimensionar" role="separator" aria-orientation="vertical"
          className="relative hidden xl:block w-1.5 flex-shrink-0 cursor-col-resize touch-none bg-transparent hover:bg-amber-300/60 active:bg-amber-400/70 transition-colors">
          <DockedDetailsToggle collapsed={false} onToggle={() => setDetailsPanelCollapsed(true)} />
        </div>
      )}
      {selected && panelDocked && detailsPanelCollapsed && (
        <DockedDetailsToggle collapsed onToggle={() => setDetailsPanelCollapsed(false)} />
      )}
      {/* Fundo escurecido da gaveta (apenas quando o painel não está fixo) */}
      {selected && !panelDocked && mobilePanelOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" onClick={() => setMobilePanelOpen(false)} />
      )}
      {selected && (
        <aside style={panelDocked ? { width: detailsPanelCollapsed ? 0 : panelWidth } : undefined}
          data-testid="whatsapp-details-panel"
          aria-hidden={panelDocked && detailsPanelCollapsed}
          className={`flex-shrink-0 flex flex-col min-h-0 bg-white transition-[width,opacity,padding] duration-200 ${
            panelDocked
              ? detailsPanelCollapsed
                ? 'gap-0 overflow-hidden border-l-0 p-0 opacity-0 pointer-events-none'
                : 'gap-3 overflow-y-auto border-l border-[#e7e5df] p-3.5 pb-24 opacity-100'
              : `gap-3 overflow-y-auto border-l border-[#e7e5df] p-3.5 pb-24 fixed top-0 right-0 bottom-0 z-50 w-[88%] max-w-[360px] shadow-2xl transition-transform duration-200 ${mobilePanelOpen ? 'translate-x-0' : 'translate-x-full'}`
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
          {/* Identidade: foto grande, nome e telefone copiável. */}
          <ContactIdentity
            conversation={selected}
            privateMode={privateMode}
            onOpenPhoto={selected.contact_avatar_url ? () => setLightbox(selected.contact_avatar_url) : undefined}
          />

          {/* Estado do atendimento: quem cuida, em que setor, em que etapa.
              Vem logo depois de "quem é" porque é a segunda pergunta que se faz
              ao abrir uma conversa — e antes das ações, que dependem da resposta
              (não se transfere sem saber de quem é). */}
          <AttendanceSummary
            assignee={selected.assigned_user_id ? (staffByUser.get(selected.assigned_user_id) || '—') : 'Ninguém'}
            department={selected.department_id ? (deptById.get(selected.department_id)?.name || '—') : 'Nenhum'}
            stageControl={(
              <ConversationStageSelect
                conversation={selected}
                funnelLabels={selectedFunnelLabels}
                onChanged={conv => setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, labels: conv.labels } : c))}
                onStageEntered={runFunnelStageActions}
              />
            )}
          />

          {/* O recado da IA para quem assumiu: por que a conversa chegou aqui e
              o que já foi apurado. Fica no alto, junto do "de quem é", porque é
              a primeira coisa a ler antes de responder. */}
          <AiHandoffSummaryCard data={handoffSummary} />

          {/* Ações rápidas. Subiram para cá: são o que se usa a cada atendimento,
              e estavam abaixo das etiquetas — metadado que se mexe de vez em
              quando. Numa coluna, altura é atenção; o que se usa mais fica mais
              alto. A hierarquia interna (agir / consultar / bloquear) mora no
              próprio componente. */}
          <QuickActions
            blocked={selected.is_blocked}
            onMarkUnread={handleMarkUnread}
            onTransfer={() => setTransferOpen(true)}
            onTemplates={() => setTemplateOpen(true)}
            onTimeline={() => setTimelineOpen(true)}
            onSummary={selected.client_id ? () => setSummaryOpen(true) : undefined}
            onExport={messages.length > 0 ? handleExportConversation : undefined}
            onBlock={perms.canBlock ? () => setBlockOpen(true) : undefined}
            onUnblock={perms.canBlock ? handleUnblock : undefined}
            muted={selectedContactMuted}
            mutedUntil={selectedContactMutedUntil}
            onMute={() => setMuteModalOpen(true)}
            onUnmute={() => { void unmuteSelected(); }}
          />

          {/* Levar a conversa inteira embora: o .txt de "Exportar" acima só tem
              o texto, e a maior parte do que chega por WhatsApp num escritório é
              anexo — áudio do cliente, foto do documento, PDF da decisão. */}
          <ConversationArchiveButton
            conversationIds={threadIds.length > 0 ? threadIds : [selected.id]}
            contactName={conversationName(selected)}
          />

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

          {/* Memória da IA: só aparece quando o canal tem agente. Ver aiMemoryPanel.tsx. */}
          <AiMemoryPanel
            conversationId={selected.id}
            currentUserId={user?.id ?? null}
            assignedUserId={selected.assigned_user_id}
            confirm={confirm}
          />

          {/* 360: Ações do cliente — o trabalho que sai desta conversa.
              Elas ficavam DESABILITADAS sem cadastro, e essa era a reclamação:
              justamente com quem ainda não é cliente é que se marca a primeira
              reunião. Agora todas clicam. Sem cadastro, a ação pede antes o
              pré-cadastro (nome de exibição + telefone) e continua de onde
              parou — ninguém precisa sair do atendimento para abrir o módulo de
              Clientes e inventar uma ficha. */}
          <div className="space-y-1.5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Ações rápidas</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { label: 'Lançamento', icon: <HandCoins size={15} />, motivo: 'fazer um lançamento', on: (clientId: string, clientName: string) => openWa({ type: 'financial_create', clientId, clientName: clientName || undefined }) },
                { label: 'Prazo', icon: <Clock size={15} />, motivo: 'cadastrar um prazo', on: (clientId: string) => openWa({ type: 'deadline_create', clientId }) },
                { label: 'Agenda', icon: <Calendar size={15} />, motivo: 'marcar um compromisso', on: (clientId: string) => openWa({ type: 'calendar_create', clientId }) },
                { label: 'Documento', icon: <FileText size={15} />, motivo: 'gerar um documento', on: (clientId: string, clientName: string) => openWa({ type: 'document_generate', clientId, clientName: clientName || undefined, processCode: (overview?.processes ?? [])[0]?.process_code }) },
                { label: 'Pedir doc.', icon: <FilePlus size={15} />, motivo: 'pedir documentos', on: () => setDocRequestOpen(true) },
              ].map(a => (
                <button key={a.label} onClick={() => comCadastro(a.motivo, a.on)}
                  title={selected.client_id ? a.label : `${a.label} — pede um pré-cadastro rápido antes`}
                  className="flex flex-col items-center gap-1 px-1 py-1.5 rounded-lg border border-[#e7e5df] text-slate-600 transition hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700">
                  <span className="text-amber-600">{a.icon}</span>
                  <span className="text-[10px] font-semibold leading-none">{a.label}</span>
                </button>
              ))}
            </div>
            {!selected.client_id && (
              <p className="text-[10px] leading-snug text-slate-400">
                Sem cadastro ainda: a primeira ação pede um pré-cadastro (nome e telefone). Ele não entra na lista de clientes.
              </p>
            )}
          </div>

          {/* 360: Casos (processos + requerimentos) com ações inline */}
          {selected.client_id && (
            <CasosPanel
              clientId={selected.client_id}
              clientName={selected.client_name || selected.contact_name || undefined}
              processes={overview?.processes ?? null}
              pendings={overview?.pendings ?? null}
              onOpenWorkspace={openWa}
            />
          )}

          {/* 360: Prazos (lista; criar pela barra de ações do cliente) */}
          {selected.client_id && <ClientAgendaPanel schedule={overview?.schedule ?? null} />}

          {selected.client_id && <ClientPendingsPanel pendings={overview?.pendings ?? null} confirm={confirm} onChanged={reloadOverview} />}
          {selected.client_id && <ClientCloudDocsLink clientId={selected.client_id} clientName={selected.client_name || selected.contact_name || undefined} />}
          {selected.client_id && <ClientFillLinksPanel links={overview?.templateFillLinks ?? null} signatures={overview?.signatures ?? null} onStopTracking={stopTemplateFillTracking} />}
          {/* Assinaturas aparecem MESMO sem cliente vinculado: sem cadastro, elas
              vêm pelo telefone do contato (ver `listSignaturesByContactPhone`).
              Documento enviado para assinar é acompanhamento de atendimento, não
              privilégio de quem já virou cadastro. */}
          <ClientSignaturesPanel signatures={overview?.signatures ?? null} links={overview?.templateFillLinks ?? null} onStopTracking={stopTemplateFillTracking} onStopSignatureTracking={stopSignatureTracking} />

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

      {channelAccessOpen && (
        <Modal
          open={channelAccessOpen}
          onClose={() => setChannelAccessOpen(false)}
          size="xl"
          eyebrow="WhatsApp · Gestão"
          title="Acessos aos canais"
          subtitle="A mesma visibilidade vale para a inbox, novas conversas e o funil de Leads."
          icon={<LockKeyhole size={18} />}
        >
          <ChannelAccessManager
            channels={channels}
            staff={staff}
            requirePin={requirePin}
            onChannelsChange={setChannels}
            onFeedback={(type, message) => type === 'success'
              ? toast.success('Acessos atualizados', message)
              : toast.error('Erro ao salvar acessos', message)}
          />
        </Modal>
      )}

      {muteModalOpen && selected && !selectedContactMuted && (
        <ConversationMuteModal
          contactName={conversationName(selected)}
          onClose={() => setMuteModalOpen(false)}
          onMute={(durationMs, label) => { void muteSelected(durationMs, label); }}
        />
      )}

      {channelFunnelsOpen && (
        <Modal
          open={channelFunnelsOpen}
          onClose={() => setChannelFunnelsOpen(false)}
          size="xl"
          eyebrow="WhatsApp · Gestão"
          title="Funis por canal"
          subtitle="Cada número segue seu próprio fluxo; o quadro de Leads acompanha o canal selecionado."
          icon={<GitBranch size={18} />}
        >
          <ChannelFunnelManager
            channels={channels}
            departments={departments}
            staff={staff}
            moduleConfig={moduleConfig}
            requirePin={requirePin}
            onChannelsChange={next => { setChannels(next); void reloadFunnelLabels(); }}
            onFeedback={(type, message) => type === 'success'
              ? toast.success('Funil atualizado', message)
              : toast.error('Erro ao salvar funil', message)}
          />
        </Modal>
      )}

      {transferOpen && selected && (
        <TransferModal
          conversation={selected}
          departments={selectedAllowedDepartments}
          staff={staff}
          moduleConfig={moduleConfig}
          conversations={conversations}
          currentUserId={user?.id ?? null}
          previousAgentIds={conversationAgentIds}
          onClose={() => setTransferOpen(false)}
          onDone={onTransferDone}
        />
      )}

      {newConvOpen && (
        <NewConversationModal
          channels={connectedChannels}
          channelRouting={channelRouting}
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
          initialCaption={stagedCaption}
          onClose={cancelStagedSend}
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
          moduleConfig={moduleConfig}
          onClose={() => setCloseOpen(false)}
          onDone={onCloseDone}
        />
      )}

      {legalHoldModalOpen && selected && (
        <LegalHoldModal
          subtitle={conversationName(selected)}
          onClose={closeLegalHoldModal}
          onConfirm={confirmLegalHold}
        />
      )}

      {lightbox && (
        <WaLightbox image={lightbox} images={lightboxImages} onClose={() => setLightbox(null)} />
      )}

      {/* Fase M: dashboard de atendimento (oculto no modo embutido) */}
      {!embedded && showDashboard && (
        <AttendanceDashboard onClose={() => setShowDashboard(false)} />
      )}

      {!embedded && queuePanelOpen && (
        <QueuePanel
          conversations={conversations}
          staff={staff}
          departmentMembers={departmentMembers}
          capacity={moduleConfig.agent_capacity ?? 0}
          currentUserId={user?.id ?? null}
          policy={queuePolicy}
          onOpenConversation={setSelectedId}
          onChanged={loadConversations}
          onClose={() => setQueuePanelOpen(false)}
        />
      )}

      {/* Fase M: modal de resumo automático por IA */}
      {summaryOpen && selected && (
        <ConversationSummaryModal
          conversation={selected}
          staffByUser={staffByUser}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      {/* Pré-cadastro pedido por uma ação rápida. Ao criar, a conversa já sai
          vinculada e a ação continua — o clique não se perde no caminho. */}
      {preCadastroAsk && selected && (
        <PreCadastroModal
          conversationId={selected.id}
          phone={selected.contact_phone}
          suggestedName={selected.contact_name}
          reason={`Para ${preCadastroAsk.motivo}, precisamos saber de quem é.`}
          onClose={() => setPreCadastroAsk(null)}
          onCreated={(clientId, clientName) => {
            const pendente = preCadastroAsk;
            setPreCadastroAsk(null);
            // O vínculo já está no banco; refletir aqui na hora evita que a
            // ação abra sem dono enquanto a lista não recarrega.
            setConversations(prev => prev.map(c =>
              c.id === selected.id ? { ...c, client_id: clientId, client_name: clientName } : c));
            void loadConversations();
            pendente?.seguir(clientId, clientName);
          }}
        />
      )}

      {/* Fase I: modal de solicitação de documento */}
      {docRequestOpen && selected && selected.client_id && (
        <RequestDocumentModal
          conversationId={selected.id}
          clientId={selected.client_id}
          clientName={selected.client_name || selected.contact_name || ''}
          createdBy={user?.id ?? null}
          moduleConfig={moduleConfig}
          onClose={() => setDocRequestOpen(false)}
          onCreated={onRequestDocCreated}
        />
      )}

      {/* Fase H: modais de ação jurídica a partir de mensagem */}
      {deadlineSource && selected?.client_id && (
        <CreateDeadlineFromMessageModal
          message={deadlineSource}
          clientId={selected.client_id}
          clientName={selected.client_name || selected.contact_name || ''}
          processes={overview?.processes ?? []}
          onClose={() => setDeadlineSource(null)}
        />
      )}
      {taskSource && selected?.client_id && (
        <CreateTaskFromMessageModal
          message={taskSource}
          clientId={selected.client_id}
          clientName={selected.client_name || selected.contact_name || ''}
          processes={overview?.processes ?? []}
          onClose={() => setTaskSource(null)}
        />
      )}

      {forwardSource && (
        <ForwardMessageModal
          message={forwardSource}
          conversations={conversations}
          currentConversationId={selected?.id ?? null}
          sending={forwarding}
          onClose={() => { if (!forwarding) setForwardSource(null); }}
          onConfirm={targets => { void forwardMessage(forwardSource, targets); }}
        />
      )}
    </div>
  );
};











export default WhatsAppModule;
