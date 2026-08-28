import React, { useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, Send, Loader2, MessageCircle, Phone, PhoneCall, Video, User as UserIcon,
  CheckCheck, Check, AlertCircle, Link2, ArrowRightLeft, X,
  Paperclip, Mic, FileText, Image as ImageIcon, CornerUpLeft, UserRound,
  Pencil, UserCheck, Unlink, IdCard, Scale, Calendar,
  Clock, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, Plus, Ban, ShieldOff, CheckCircle2, RotateCcw,
  StickyNote, Trash2, CalendarClock, MessageSquare, Filter, Maximize2,
  UserPlus, UserMinus, PenLine, HandCoins, ListTodo, FilePlus,
  Sparkles, Tag, Tags, Bot, Clapperboard, Smile, FolderOpen,
  Shield, ShieldCheck, Eye, EyeOff, Timer, TimerOff,
  BarChart2, TrendingUp, Users, Clock3, CheckCircle, Inbox,
  MapPin, Play, Pause, Bell, BellOff, Info, MoreVertical, BellRing,
  Target,
  LockKeyhole,
  GitBranch,
  Activity,
  AppWindow,
} from 'lucide-react';
import { useStaffPush } from './whatsapp/hooks/useStaffPush';
import { useWaCalls } from '../hooks/useWaCalls';
import { CallHistoryList } from './whatsapp/CallHistoryList';
import { InboxTabs, InboxViewSwitch, InboxWaitingMenu } from './whatsapp/InboxTabs';
import { useCallHistory } from './whatsapp/hooks/useCallHistory';
import { useThreadDragDrop } from './whatsapp/hooks/useThreadDragDrop';
import { muteStore } from '../services/whatsapp/muteStore';
import { notifyScope } from '../services/whatsapp/notifyScope';
import { whatsappService, normalizePhone, renderTemplate, agentPermissions, summarizeOverview, DEFAULT_AGENT_PREFS, type StaffOption, type AgentPrefs, type ScheduleDeadline, type ClientDocRequest, type ClientOverview, type ClientSchedule, type ClientPendings, type WhatsAppInternalNote, type ClientTrackedSignatureStatus } from '../services/whatsapp.service';
import { swrWa, lidoDaMemoriaWa, guardaNaMemoriaWa } from '../services/whatsapp/sessionCache';
import type { WhatsAppScheduledMessage } from '../types/whatsapp.types';
import {
  formatTime, initials, prettyPhone, formatBytes, dayLabel, lastSeenLabel, presenceInfo,
  typeLabel, conversationPreviewLabel, firstName, agentLabel, greetingByHour, buildGreeting,
  convStatus, slaSignal, slaInternalSignal, abandonedSignal, transferAlert,
  maskSensitive, maskName, maskPhoneFull, fmtAudioTime, prettyDoc, dueInfo, fmtDateTime,
  fmtNoteDate, conversationName, matchesConversationSearch, agentRoleLabel, intervencaoLabel, autoCloseLabel,
} from './whatsapp/format';
import { autoCloseClock, autoCloseIdleLabel } from './whatsapp/autoCloseClock';
import {
  WaDialog, WaDialogBody, waInput, waLabel, waBtnPrimary, waBtnGhost, waBtnDanger,
} from './whatsapp/ui';
import { TransferModal, BlockContactModal, CloseConversationModal, LegalHoldModal } from './whatsapp/conversationModals';
import { TemplatePickerModal, ScheduleMessageModal } from './whatsapp/messageModals';
import { ForwardMessageModal } from './whatsapp/forwardMessageModal';
import { stripAgentSignature } from './whatsapp/waRichText';
import { ConversationSummaryModal, ConversationTimelineModal } from './whatsapp/infoModals';
import { RequestDocumentModal } from './whatsapp/RequestDocumentModal';
import { ClientPickerModal } from './whatsapp/clientPickerModals';
import { parseContactMessage } from './whatsapp/contactCard';
import { SendContactModal } from './whatsapp/sendContactModal';
import { NewConversationPanel } from './whatsapp/newConversationPanel';
import { CreateDeadlineFromMessageModal, CreateTaskFromMessageModal } from './whatsapp/createFromMessageModals';
import {
  CasosPanel, ClientAgendaPanel, ClientPendingsPanel, ClientSignaturesPanel, ClientSignedDocsPanel,
  ClientAgreementsPanel,
  PROC_STATUS, PROC_AREA, REQ_STATUS_BADGE, REQ_STATUS_LABEL,
} from './whatsapp/clientPanels';
import type { ConfirmOpts, ConfirmFn, WaOpenWorkspaceFn } from './whatsapp/types';
import { MessageBubble, ImageAlbum } from './whatsapp/messageBubble';
import { Avatar } from './whatsapp/avatar';
import { WA_LABELS, resolveLabelMeta, inferFunnelStage, funnelLabelsFromChannelStages, stageAfterDocumentsReady } from './whatsapp/funnel';
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
import { autoCapitalizarDigitacao } from './whatsapp/composerAutoCapitalize';
import {
  ChannelSwitcher, ChannelDownBanner, ChannelHealthChip, ReconnectHoldSiren, channelName,
} from './whatsapp/channelSwitcher';
import { GifPicker } from './whatsapp/gifPicker';
import { MediaLibraryPicker } from './whatsapp/mediaLibraryPicker';
import { EmojiPicker } from './whatsapp/emojiPicker';
import { ACTOR_ESCRITORIO, aplicarReacao } from '../utils/waReactions';
import { sendReconnectHoldsThroughChannel } from '../services/whatsapp/resilientSend';
import { ConversationFunnelBoard } from './whatsapp/conversationFunnelBoard';
import { nextLeadChannelFilter } from './whatsapp/channelFilterSync';
import { hiddenByStatusFilter, searchRank, type InboxStatusFilter, type WaitingFilter } from './whatsapp/inboxStatusScope';
import { returnScopeForConversation, type InboxScopeTab } from './whatsapp/inboxReturnScope';
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
// A política de SLA (os patamares) mora no canal; este módulo só a resolve.
import { slaPolicyForChannels, queueThresholdsFor } from './whatsapp/slaPolicy';
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
import { ThreadScheduledGhosts, ScheduledMessagesPanel, MyScheduledList, useMyScheduled, useScheduledSentMarks } from './whatsapp/scheduledMessages';
import { AiApprovalBanner } from './whatsapp/aiApprovalBanner';
import { SupervisionBar } from './whatsapp/supervisionBar';
import { AttendanceDashboard } from './whatsapp/attendanceDashboard';
import { ClientFillLinksPanel } from './whatsapp/clientFillLinksPanel';
import { AiMemoryPanel } from './whatsapp/aiMemoryPanel';
import { AiAgentBanner } from './whatsapp/aiAgentBanner';
import { waAiListChip } from '../utils/waAiFollowupDisplay';
import { AiHandoffSummaryCard, AiHandoffSummaryStrip, useAiHandoffSummary } from './whatsapp/aiHandoffSummary';
import { PresenceText, DateDivider, ChannelDivider } from './whatsapp/conversationListItem';
import { DockedDetailsToggle } from './whatsapp/DockedDetailsToggle';
import { ConversationList } from './whatsapp/conversationList';
import { ThreadSkeleton } from './whatsapp/skeletons';
import { resolveInboxKey, isTypingTarget } from './whatsapp/inboxKeyboard';
import { WaLightbox } from './whatsapp/lightbox';
import { WaAudioDeviceButton } from './whatsapp/audioDeviceSettings';
import { WaNotifyBell } from './whatsapp/notifyBell';
import { useWaIsMobile, useWaIsPanelDocked, utcOffsetMinutesOf } from './whatsapp/hooks';
import { useResizableLayout } from './whatsapp/hooks/useResizableLayout';
import { useWaInboxPosition, readStoredConversationId } from './whatsapp/hooks/useWaInboxPosition';
import { useClientOverview } from './whatsapp/hooks/useClientOverview';
import { useWaRealtime } from './whatsapp/hooks/useWaRealtime';
import { useWaComposer } from './whatsapp/hooks/useWaComposer';
import { useWaSupervision } from './whatsapp/hooks/useWaSupervision';
import { useWaMessages } from './whatsapp/hooks/useWaMessages';
import { useWaThread, type MessageUnit } from './whatsapp/hooks/useWaThread';
import { useConversationCalls } from './whatsapp/hooks/useConversationCalls';
import { conversationActivityAt } from './whatsapp/threadCalls';
import { ThreadCallEntry } from './whatsapp/threadCallEntry';
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
  WhatsAppDeleteScope, WhatsAppMediaLibraryItem,
} from '../types/whatsapp.types';
import { playWaActionSound } from '../utils/waActionSounds';
import { copiarTexto } from '../utils/copyText';
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
import { NextcloudClientWindow, ClientNextcloudDocsLink } from './whatsapp/nextcloudClientWindow';
import { nextcloudService, getNextcloudErrorMessage } from '../services/nextcloud.service';
import { escapeLayerCount } from '../hooks/useEscapeLayer';
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

type FilterTab = 'all' | 'unread' | 'mine' | 'scheduled' | 'calls';


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
  /**
   * Texto que já entra escrito no compositor da conversa do deep-link.
   *
   * Existe para os botões que ANTES abriam `wa.me/...?text=`: o modelo de
   * mensagem do requerimento e o convite de assinatura chegavam prontos no
   * WhatsApp Web, e continuam chegando prontos aqui. Sem isto, trocar o link
   * externo pela conversa interna cobraria do atendente redigitar o texto que o
   * sistema já tinha montado.
   */
  openConversationDraft?: string;
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
  /**
   * Reporta a conversa aberta — o id para o deep-link ao maximizar o widget, e
   * a identidade para quem precisa DESENHAR essa conversa de fora do módulo.
   *
   * A identidade veio junto por causa do widget minimizado: a barra flutuante
   * mostra o rosto e o nome da conversa que ficou guardada, e o módulo está
   * desmontado nessa hora. Sem isto, a barra teria de ir buscar sozinha um dado
   * que quem estava com a conversa na tela já tinha na mão.
   */
  onActiveConversationChange?: (
    id: string | null,
    contato?: { nome: string; avatarUrl: string | null } | null,
  ) => void;
  /**
   * Fechar a janela que hospeda o módulo — o último degrau do Esc.
   *
   * Só faz sentido embutido: no widget, um Esc volta da conversa para a lista e
   * o seguinte fecha a janela. Em tela cheia não existe janela para fechar, e
   * por isso quem não passa esta função simplesmente não tem o degrau.
   */
  onEscapeExit?: () => void;
}

const WhatsAppModule: React.FC<WhatsAppModuleProps> = ({ openConversationId, openConversationDraft, onParamConsumed, onConvertLead, variant = 'full', onActiveConversationChange, onEscapeExit }) => {
  const embedded = variant === 'embedded';
  // Dentro do widget, o verde do WhatsApp cede ao laranja da casa. O botão de
  // enviar é o elemento mais chamativo do painel: um verde de outro produto
  // logo abaixo de uma conversa que já é creme e laranja denuncia a colagem.
  // No módulo cheio nada muda — lá o ambiente É o do aplicativo.
  const btnEnviarCor = embedded
    ? 'bg-[#f27a23] hover:bg-[#e06b1f]'
    : 'bg-[#00a884] hover:bg-[#008f72]';
  // Cabeçalho e compositor: as duas barras que emolduram a conversa. O
  // #f0f2f5 é cinza-AZULADO — combina com o bege do aplicativo e briga com o
  // creme do painel, que é quente. Dentro do widget a conversa ficava
  // ensanduichada entre duas faixas de outra temperatura; era boa parte do
  // "estranho". Embutido, a moldura usa o mesmo quase-branco quente da zona de
  // controle da lista.
  const molduraBg = embedded ? 'bg-[#fdfcfb]' : 'bg-[#f0f2f5]';
  const { user } = useAuth();
  const { ensurePermission, requirePin } = useSecurityPin();
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
    swrWa(user?.id, 'moduleConfig', () => settingsService.getWhatsAppModuleConfig(), setModuleConfig);
  }, [user?.id]);
  // Reflete no atendimento qualquer ajuste de funil feito na gaveta de Leads.
  useEffect(() => { if (leadsPanelOpen) { setLeadsEverOpened(true); void reloadFunnelLabels(); } }, [leadsPanelOpen, reloadFunnelLabels]);
  // Já nasce com a última lista que esta aba viu. O widget monta e desmonta o
  // módulo a cada abertura; sem isto, toda vez a caixa de entrada começava
  // vazia e só aparecia depois da ida ao banco.
  const [conversations, setConversations] = useState<WhatsAppConversation[]>(
    () => lidoDaMemoriaWa<WhatsAppConversation[]>(user?.id, 'conversations') ?? [],
  );
  // Reabre na conversa em que o atendente parou. Só no módulo cheio: no widget
  // embutido a inbox é efêmera e abrir sozinha uma conversa seria intrusivo.
  const [selectedId, setSelectedId] = useState<string | null>(() => readStoredConversationId(!embedded));
  // Texto do deep-link esperando a conversa entrar na tela (ver o efeito que o
  // consome, logo abaixo do `useWaComposer`).
  const draftPendente = useRef<{ conversationId: string; texto: string } | null>(null);
  // Conversa pedida de fora que ainda pode não estar na lista (ver a limpeza de
  // seleção mais abaixo, e o efeito do deep-link).
  const deepLinkPendente = useRef<string | null>(null);
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
  // Biblioteca de mídias salvas (vídeo/áudio/PDF cadastrados para reenvio).
  const [mediaLibOpen, setMediaLibOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
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
  // Antes de a lista de canais chegar, `channels` é `[]` — e `[]` fazia o chip
  // do cabeçalho afirmar "Offline". Não estava carregando: estava dizendo que o
  // WhatsApp do escritório está fora, o que é uma frase diferente e errada. Um
  // segundo depois virava "Online". A mesma regra do `loadingConvs`: só se diz
  // "carregando" quando não há NADA na mão — com a lista da abertura anterior em
  // cache, o estado de espera seria um piscar sobre conteúdo bom.
  const [channelsLoading, setChannelsLoading] = useState(
    () => lidoDaMemoriaWa<WhatsAppChannel[]>(user?.id, 'channels') === undefined,
  );
  // Pendências persistidas do atendente logado. É propositalmente global ao
  // módulo (não pertence à conversa aberta): a sirene precisa sobreviver quando
  // ele troca de cliente, fecha a thread ou recarrega a página.
  const [reconnectAlerts, setReconnectAlerts] = useState<WhatsAppScheduledMessage[]>([]);
  const [departments, setDepartments] = useState<WhatsAppDepartment[]>([]);
  const [departmentMembers, setDepartmentMembers] = useState<Record<string, string[]>>({});
  // Matriz canal→membros. Sustenta as listas de destino das ações do funil: sem
  // ela, o editor ofereceria como destino gente que não enxerga o canal.
  const [channelMembers, setChannelMembers] = useState<Array<{ channel_id: string; user_id: string }>>([]);
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
    // Só os três ESCOPOS de conversa voltam. "Agendadas" e "Ligações" são
    // consultas — reabrir a inbox numa delas esconderia a fila de atendimento
    // de quem só queria conferir uma coisa ontem e fechou a aba.
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
  // Chamadas de voz (WaCalls). Só o botão do cabeçalho vive aqui; o modal da
  // chamada e o convite de chamada recebida são do host global (WaCallsHost),
  // para a ligação não cair quando esta tela desmonta.
  const waCalls = useWaCalls();
  useEffect(() => { void muteStore.init(); }, []);
  const [muteModalOpen, setMuteModalOpen] = useState(false);
  useEffect(() => { setMuteModalOpen(false); }, [selectedId]);
  // "Carregando" só quando não há NADA para mostrar. Com a lista da abertura
  // anterior na mão, o esqueleto seria um piscar sobre conteúdo bom.
  const [loadingConvs, setLoadingConvs] = useState(
    () => lidoDaMemoriaWa<WhatsAppConversation[]>(user?.id, 'conversations') === undefined,
  );
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
  // Número de um cartão de contato RECEBIDO indo para o cadastro de um cliente.
  const [contactLinkTarget, setContactLinkTarget] = useState<{ phone: string; name: string } | null>(null);
  const [contactLinking, setContactLinking] = useState(false);
  // Enviar um contato da agenda do escritório como CARTÃO (vCard).
  const [sendContactOpen, setSendContactOpen] = useState(false);
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
  const [statusFilter, setStatusFilter] = useState<InboxStatusFilter>(() => {
    const v = localStorage.getItem('wa_status_filter');
    return v === 'all' || v === 'open' || v === 'waiting_you' || v === 'waiting_client'
      || v === 'waiting_internal' || v === 'reopened' || v === 'closed' ? v : 'open';
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
  /**
   * A raiz do módulo. Serve para saber se um gesto de teclado veio de DENTRO
   * daqui: no widget flutuante, o CRM inteiro está atrás, e um atalho global
   * não pode agir quando quem está com o foco é a tela de trás.
   */
  const rootRef = useRef<HTMLDivElement>(null);
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

  // ── Modo supervisão ──────────────────────────────────────────────────────
  //
  // Quem sou eu NESTA conversa (dono, fila, destino de transferência,
  // colaborador emprestado, supervisor do canal, administrador) e o que isso me
  // deixa fazer. A trava é do banco; isto decide o que a tela oferece — para
  // não mostrar botão que só responderia 403, e para "acompanhar" não mexer no
  // atendimento de ninguém. Ver `useWaSupervision`.
  const supervisao = useWaSupervision({ selected, channels, departmentMembers });
  const podeMarcarLida = supervisao.acoes.marcarLida;
  // O efeito de marcar como lida roda em troca de conversa e em visibilitychange,
  // e ler `supervisao` direto dele o faria reassinar a cada quadro. A ref carrega
  // o valor mais recente sem entrar na lista de dependências.
  const supervisaoRef = useRef(supervisao);
  supervisaoRef.current = supervisao;
  // Atalho para o JSX: o que ESTA pessoa pode fazer nesta conversa, já apertado
  // pelo modo de supervisão escolhido. Botão proibido não é desabilitado — ele
  // não entra na barra: um botão cinza que nunca destrava vira ruído
  // permanente, e a faixa do Modo supervisão já explica por que sumiu.
  const acoes = supervisao.acoes;
  // A faixa de estado da IA (topo da thread) e o painel "Memória da IA" (coluna
  // lateral) leem o mesmo estado do backend por caminhos separados. Este
  // contador é o que os mantém de acordo: quem age avisa, e o outro relê. Sem
  // ele, pausar em cima deixava a gaveta anunciando "Ativa" por até um minuto.
  const [iaVersao, setIaVersao] = useState(0);
  const iaMudou = useCallback(() => setIaVersao(v => v + 1), []);
  // Uma leitura só do handoff da IA, consumida em dois lugares: a faixa fina da
  // thread e o cartão do painel. Ver aiHandoffSummary.tsx.
  const handoffSummary = useAiHandoffSummary({
    conversationId: selected?.id ?? '',
    currentUserId: user?.id ?? null,
    assignedUserId: selected?.assigned_user_id ?? null,
    onChanged: iaMudou,
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
    docStatusByClient,
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
      // Fica para a próxima abertura do widget — ver `sessionCache`.
      guardaNaMemoriaWa(user?.id, 'conversations', rows);
    } catch {/* */} finally { if (req === convReqRef.current) setLoadingConvs(false); }
  }, [user?.id]);

  const runFunnelStageActions = useCallback(async (
    conversation: WhatsAppConversation,
    stageKey: string,
  ) => {
    const stage = conversation.instance_id
      ? channelFunnelStages[conversation.instance_id]?.find(item => item.stage_key === stageKey)
      : null;
    if (!stage?.entry_actions?.length) return;
    const canal = channels.find(item => item.id === conversation.instance_id) || null;
    const result = await executeFunnelStageActions({
      conversation,
      actions: stage.entry_actions,
      departments,
      staff,
      departmentMembers,
      channelMemberIds: channelMembers
        .filter(row => row.channel_id === conversation.instance_id)
        .map(row => row.user_id),
      channelVisibility: canal?.visibility_mode ?? null,
      channelName: canal?.name || canal?.instance_name || null,
      stageLabel: stage.label,
    });
    await loadConversations();
    if (result.completed.length > 0) {
      toast.success('Ações da etapa executadas', result.completed.join(' · '));
    }
    if (result.errors.length > 0) {
      toast.warning('Etapa alterada com ações pendentes', result.errors.join(' · '));
    }
  }, [channelFunnelStages, channels, departments, staff, departmentMembers, channelMembers, loadConversations, toast]);

  /**
   * Documentos prontos → a conversa sai sozinha de "Aguardando documentos".
   *
   * Pedir documento já empurrava a conversa PARA a etapa de espera; nada a
   * tirava de lá. O resultado aparecia como contradição na tela: o resumo da
   * conversa anunciando "Documentos prontos" e, na mesma linha da lista, a
   * etapa ainda dizendo que se espera documento. Quem lê a fila pela coluna
   * acabava cobrando arquivo que já tinha chegado.
   *
   * Reage à MUDANÇA, não ao retrato: só avança o cliente que estava esperando
   * e passou a ter tudo. Sem isso, abrir o painel arrastaria de uma vez todos
   * os cartões antigos parados na coluna — e ainda dispararia as ações de
   * entrada da etapa seguinte para cada um deles.
   *
   * A troca é condicional no banco (`updateLabelsIfStillTagged`): o mesmo
   * evento chega a todos os painéis abertos do escritório ao mesmo tempo, e
   * quem move é um só.
   */
  const avancarEtapaPorDocumentos = useCallback(async (
    conv: WhatsAppConversation,
    movimento: { from: FunnelLabel; to: FunnelLabel },
  ): Promise<boolean> => {
    const funil = funnelLabelsForChannel(conv.instance_id);
    const chavesDoFunil = new Set(funil.map(l => l.key));
    // Etapa é única: sai a etiqueta de funil antiga, ficam as tags livres.
    const next = [...(conv.labels ?? []).filter(l => !chavesDoFunil.has(l)), movimento.to.key];
    let moveu = false;
    try {
      moveu = await whatsappService.updateLabelsIfStillTagged(conv.id, movimento.from.key, next);
    } catch { return false; }
    if (!moveu) return false; // outro painel (ou um atendente) chegou primeiro
    setConversations(prev => prev.map(c => (c.id === conv.id ? { ...c, labels: next } : c)));
    toast.info('Documentos prontos',
      `${conversationName(conv)} avançou para “${movimento.to.stageLabel}”.`);
    // Entrar por automação vale o mesmo que arrastar no quadro: as ações de
    // entrada da etapa rodam aqui também — e só para quem de fato moveu.
    try { await runFunnelStageActions({ ...conv, labels: next }, movimento.to.stageKey); }
    catch { /* best-effort: a etapa já mudou */ }
    return true;
  }, [funnelLabelsForChannel, setConversations, runFunnelStageActions, toast]);

  const docStatusAnteriorRef = useRef<Record<string, 'awaiting' | 'ready'> | null>(null);
  const avancoDeDocsEmCursoRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const anterior = docStatusAnteriorRef.current;
    docStatusAnteriorRef.current = docStatusByClient;
    if (!anterior) return; // primeira leitura é retrato, não acontecimento
    const ficaramProntos = Object.keys(docStatusByClient).filter(
      id => docStatusByClient[id] === 'ready' && anterior[id] && anterior[id] !== 'ready',
    );
    if (ficaramProntos.length === 0) return;
    const alvos = new Set(ficaramProntos);
    for (const conv of conversations) {
      if (!conv.client_id || !alvos.has(conv.client_id)) continue;
      if (conv.status === 'closed' || conv.is_blocked) continue;
      if (avancoDeDocsEmCursoRef.current.has(conv.id)) continue;
      const movimento = stageAfterDocumentsReady(conv.labels, funnelLabelsForChannel(conv.instance_id));
      if (!movimento) continue;
      avancoDeDocsEmCursoRef.current.add(conv.id);
      void avancarEtapaPorDocumentos(conv, movimento).then(moveu => {
        // Não moveu (falha de rede, ou outro painel na frente): libera para a
        // próxima vez que os documentos desta conversa ficarem prontos.
        if (!moveu) avancoDeDocsEmCursoRef.current.delete(conv.id);
      });
    }
  }, [docStatusByClient, conversations, funnelLabelsForChannel, avancarEtapaPorDocumentos]);

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
    swrWa(user?.id, 'businessHours', () => whatsappService.listAllBusinessHours(), (rows) => {
      setBusinessHoursByChannel(rows);
      setBusinessHoursLoaded(true);
    });
  }, [user?.id]);

  const loadChannels = useCallback(() => {
    swrWa(user?.id, 'channels', () => whatsappService.listChannels(), (next) => {
      setChannels(next);
      setChannelsLoading(false);
    });
  }, [user?.id]);

  const loadReconnectAlerts = useCallback(() => {
    if (!user?.id) { setReconnectAlerts([]); return; }
    whatsappService.listMyReconnectAlerts().then(setReconnectAlerts).catch(() => {});
  }, [user?.id]);

  // Bootstrap dos dados auxiliares (uma vez).
  //
  // Tudo aqui é CADASTRO: setor, equipe, canal, roteamento, horário comercial.
  // Muda nas Configurações, uma vez por mês; era buscado quarenta vezes por dia,
  // uma por abertura do widget, e a caixa de entrada esperava a fila inteira
  // chegar de São Paulo. Agora cada um pinta com o que a aba já sabia e se
  // corrige sozinho quando a resposta chega — ver `swrWa`.
  //
  // O fluxo reativo (realtime de conversa/mensagem/IA) vive em useWaRealtime.
  useEffect(() => {
    loadConversations();
    loadChannels();
    swrWa(user?.id, 'departments', () => whatsappService.listDepartments(), setDepartments);
    swrWa(user?.id, 'channelRouting', () => settingsService.getWhatsAppChannelDepartmentRouting(), setChannelRouting);
    swrWa(user?.id, 'staff', () => whatsappService.listStaff(), setStaff);
    swrWa(user?.id, 'agentPrefs', () => whatsappService.getMyAgentPrefs(), setAgentPrefs);
    // Matriz setor→membros: a distribuição da fila precisa dela para não
    // mandar conversa de um setor para quem não pertence a ele.
    swrWa(user?.id, 'departmentMembers', () => whatsappService.listAllDepartmentMembers(), setDepartmentMembers);
    swrWa(user?.id, 'channelMembers', () => whatsappService.listChannelMembers(), setChannelMembers);
    loadBusinessHours();
  }, [loadConversations, loadBusinessHours, loadChannels, user?.id]);

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
    onPickFiles, handleDroppedFiles, confirmStagedSend, cancelStagedSend, sendGif, sendSavedMedia,
  } = useWaComposer({
    selectedId, selected, user, agentPrefs, moduleConfig, staffById, aiSession,
    messages, setMessages, setConversations, refreshMessages,
    // "Responder sem assumir": no Modo supervisão, mandar uma mensagem não pode
    // transformar quem só quis ajudar no responsável pelo atendimento.
    autoAssumir: supervisao.modo !== 'responder',
  });

  // As LIGAÇÕES desta conversa. Elas entram na thread como qualquer outra
  // unidade, no lugar do horário em que tocaram: a ligação é parte da mesma
  // conversa, e lê-la fora dela deixava um buraco de horas no meio do
  // atendimento — "mandei os documentos" … silêncio … "então ficou combinado".
  // O telefone entra junto do id porque uma chamada só ganha `conversation_id`
  // quando o CRM reconheceu o número enquanto ela tocava.
  const threadCalls = useConversationCalls(
    selectedId,
    useMemo(() => [selected?.contact_phone], [selected?.contact_phone]),
  );

  // Camada visual da thread: merge de mensagens reais + otimistas, agrupamento de
  // imagens em álbuns, galeria/lightbox e todo o auto-scroll. Consome `pending` do
  // compositor, por isso vive depois dele.
  const {
    allMessages, msgById, nextAudioId, messageUnits, diasDaThread,
    lightbox, setLightbox, lightboxImages,
    threadContentRef, setThreadEl, onThreadScroll,
    scrolledUp, newBelow, scrollToBottom, jumpToMessage,
  } = useWaThread(selectedId, messages, pending, threadCalls);

  // Onde a thread TROCA de canal. O histórico do escritório funde numa conversa
  // só a mesma pessoa que escreveu para números diferentes (ver contactThreads):
  // o atendente inicia pelo Comercial, o cliente responde no Atendimento, e as
  // bolhas ficam lado a lado sem dizer por onde saíram. Aqui marca-se, por índice
  // de unidade, o canal que ABRE cada trecho — e só quando a thread de fato reúne
  // mais de um canal, para não poluir a conversa de canal único (a maioria).
  // As ligações são ignoradas na comparação: elas não pertencem a um número do
  // WhatsApp e não devem quebrar a corrida de bolhas de um mesmo canal.
  const channelDividers = useMemo(() => {
    const marks = new Map<number, { name: string; color: string }>();
    const channelIdOf = (u: MessageUnit): string | null => {
      if (u.kind === 'call') return null;
      const m = u.kind === 'album' ? u.items[0] : u.m;
      return conversationsById.get(m.conversation_id)?.instance_id ?? null;
    };
    const distinct = new Set<string>();
    for (const u of messageUnits) {
      const id = channelIdOf(u);
      if (id) distinct.add(id);
    }
    if (distinct.size < 2) return marks;
    let last: string | null = null;
    for (let i = 0; i < messageUnits.length; i += 1) {
      const id = channelIdOf(messageUnits[i]);
      if (!id) continue; // ligação ou mensagem sem canal conhecido: não corta o trecho
      if (id !== last) {
        const ch = channelById.get(id);
        marks.set(i, { name: ch ? channelName(ch) : 'Outro canal', color: ch?.color || '#94a3b8' });
        last = id;
      }
    }
    return marks;
  }, [messageUnits, conversationsById, channelById]);

  // ── Ir até UMA mensagem da conversa ──────────────────────────────────
  // Quem clica numa agendada concluída não quer "a conversa": quer o ponto dela
  // — a mensagem que aquele agendamento virou. O alvo fica guardado até a
  // thread carregar; se ele estiver acima da janela inicial, o histórico é
  // paginado para trás até aparecer.
  const [jumpTarget, setJumpTarget] = useState<{ conversationId: string; messageId: string } | null>(null);
  const jumpPagesRef = useRef(0);

  /** Abre a conversa e, quando há mensagem alvo, para nela em vez de no fim. */
  const openConversationAt = useCallback((conversationId: string, messageId?: string | null) => {
    setSelectedId(conversationId);
    jumpPagesRef.current = 0;
    setJumpTarget(messageId ? { conversationId, messageId } : null);
  }, []);

  useEffect(() => {
    if (!jumpTarget) return;
    // Trocar de conversa no meio do caminho cancela a viagem.
    if (jumpTarget.conversationId !== selectedId) { setJumpTarget(null); return; }
    if (loadingMsgs || loadingMore) return;
    // Quadros de folga: a leva de mensagens que acabou de chegar ainda não virou
    // DOM no instante em que este efeito roda, e no clique que ABRE a conversa a
    // thread inteira está montando. Insistir por alguns quadros antes de decidir
    // é o que faz um clique só bastar — desistir no primeiro quadro deixava o
    // alvo para o próximo clique, quando a conversa já estava na tela.
    // Só a PRIMEIRA tentativa espera a thread montar; depois de paginar o DOM já
    // existe e insistir dez quadros a cada bloco só atrasaria a viagem.
    const maxTentativas = jumpPagesRef.current === 0 ? 10 : 2;
    let quadro = 0;
    let tentativas = 0;
    const tentar = () => {
      if (jumpToMessage(jumpTarget.messageId)) { setJumpTarget(null); return; }
      if (tentativas < maxTentativas) { tentativas += 1; quadro = requestAnimationFrame(tentar); return; }
      // Não está na janela carregada. Pagina para trás — com teto, para uma
      // mensagem apagada (ou de outra conversa) não varrer o histórico inteiro.
      if (hasMoreMsgs && jumpPagesRef.current < 12) {
        jumpPagesRef.current += 1;
        void loadMoreMsgs();
        return;
      }
      setJumpTarget(null);
    };
    quadro = requestAnimationFrame(tentar);
    return () => cancelAnimationFrame(quadro);
  }, [jumpTarget, selectedId, allMessages, loadingMsgs, loadingMore, hasMoreMsgs, loadMoreMsgs, jumpToMessage]);

  // Marca interna "saiu de um agendamento" das mensagens desta conversa.
  const scheduledSentMarks = useScheduledSentMarks(selectedId);

  // Último valor visto pelo compositor — base de comparação da digitação.
  const valorDigitadoRef = useRef('');
  // O campo de mensagem é NÃO CONTROLADO de propósito.
  //
  // Com `value={draft}`, cada tecla só aparecia na tela depois do render do
  // módulo inteiro — e digitando rápido o React chegava a reescrever o campo com
  // um valor já vencido: as letras saíam trocadas, e era esse texto trocado que
  // ia embora no Enter. Agora, ENQUANTO SE DIGITA, o DOM é a fonte da verdade e
  // o estado corre atrás; o React só escreve no campo quando o rascunho muda por
  // FORA da digitação (troca de conversa, template, emoji, correção ortográfica,
  // formatação, envio, edição).
  //
  // `useLayoutEffect` e não `useEffect`: as reposições de cursor
  // (`aplicarFormato`, `replaceComposerSpelling`) acontecem num
  // `requestAnimationFrame` depois do setDraft. Efeito passivo pode rodar DEPOIS
  // desse rAF, e aí a escrita do valor jogaria o cursor para o fim — quebrando
  // encadear negrito+itálico e a troca de palavra do corretor.
  useLayoutEffect(() => {
    const el = draftRef.current;
    valorDigitadoRef.current = draft;
    if (!el || el.value === draft) return;
    el.value = draft;
  }, [draft]);

  /**
   * Digitação do compositor: aplica a MAIÚSCULA AUTOMÁTICA do começo de frase e
   * só então repassa ao estado.
   *
   * O navegador no computador ignora `autocapitalize` (é regra de teclado de
   * celular), então a mesma mensagem saía "bom dia" pelo desktop e "Bom dia"
   * pelo telefone. A correção é feita na tecla, sobre a letra recém-digitada —
   * ver `composerAutoCapitalize`.
   *
   * O valor anterior vem de um ref porque o campo é NÃO CONTROLADO: `draft` no
   * estado pode estar um passo atrás do que já está escrito na tela. O ref é
   * atualizado também pelo efeito acima, para que uma mudança de fora
   * (template, emoji, troca de conversa) não confunda a comparação da próxima
   * tecla.
   */
  const handleDraftChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const digitado = el.value;
    const cursor = el.selectionStart ?? digitado.length;
    const corrigido = autoCapitalizarDigitacao(valorDigitadoRef.current, digitado, cursor);
    if (corrigido) {
      // Escreve direto no DOM: sem isso a minúscula ficaria na tela até o
      // próximo render. O texto tem o mesmo tamanho (só a caixa muda), então o
      // cursor volta exatamente para onde estava.
      el.value = corrigido;
      el.setSelectionRange(cursor, cursor);
    }
    valorDigitadoRef.current = corrigido ?? digitado;
    setDraft(corrigido ?? digitado);
  }, [setDraft]);

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

  /**
   * Põe o emoji onde o cursor está — e não no fim do texto.
   *
   * O campo é NÃO CONTROLADO (ver o `useLayoutEffect` acima), então a posição
   * do cursor é lida do próprio DOM: entre abrir o painel e escolher o emoji, o
   * rascunho no estado pode estar um passo atrás do que está escrito na tela.
   * A reposição do cursor vem depois do render, pelo mesmo motivo da
   * formatação — senão o próximo emoji cairia no fim.
   */
  const inserirEmoji = useCallback((emoji: string) => {
    const ta = draftRef.current;
    const texto = ta ? ta.value : draft;
    const inicio = ta ? ta.selectionStart : texto.length;
    const fim = ta ? ta.selectionEnd : texto.length;
    setDraft(texto.slice(0, inicio) + emoji + texto.slice(fim));
    requestAnimationFrame(() => {
      const el = draftRef.current;
      if (!el) return;
      el.focus();
      const cursor = inicio + emoji.length;
      el.setSelectionRange(cursor, cursor);
    });
  }, [draft, setDraft]);

  /**
   * Envia uma mídia da BIBLIOTECA. A legenda é o que já estava escrito no
   * compositor — e só na falta dele entra a legenda padrão do cadastro.
   *
   * O texto é lido do DOM, não do estado: o campo é NÃO CONTROLADO, então o que
   * está na tela pode estar um passo à frente de `draft` (ver o `useLayoutEffect`
   * acima). Ler o estado aqui mandaria a legenda faltando a última letra.
   */
  const enviarMidiaSalva = useCallback((item: WhatsAppMediaLibraryItem) => {
    const escrito = (draftRef.current?.value ?? draft).trim();
    void sendSavedMedia(item, escrito || item.caption || '');
    if (escrito) setDraft('');
  }, [draft, sendSavedMedia, setDraft]);

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
  // Só fora de uma tela física pequena — no celular o foco automático abriria
  // o teclado por cima da conversa antes de o atendente ler qualquer coisa. O
  // widget usa layout "mobile" por ser estreito, mas continua no desktop: nele
  // o foco é justamente o comportamento esperado. No módulo cheio também não
  // roubamos o foco quando o clique veio de outro campo (busca, por exemplo);
  // no widget, selecionar uma conversa encerra a busca e o compositor vence.
  // `conversations` fica fora das dependências de propósito: ele muda a cada
  // evento de realtime, e reagir a isso roubaria o foco do atendente no meio de
  // uma frase toda vez que qualquer conversa recebesse mensagem.
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  useEffect(() => {
    if (!selectedId || rawIsMobile) return;
    if (conversationsRef.current.find(c => c.id === selectedId)?.is_blocked) return;
    const active = document.activeElement;
    if (!embedded && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return;
    // Espera o commit da thread: focar antes faz o navegador rolar a lista.
    const id = window.setTimeout(() => draftRef.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(id);
  }, [selectedId, rawIsMobile, embedded]);

  /**
   * O CURSOR VOLTA PARA O COMPOSITOR quando o anexo termina.
   *
   * Mandar uma imagem custava um clique a mais do que devia: o preview do anexo
   * (ou o seletor de GIF, ou a biblioteca de mídias) leva o foco embora, e ao
   * fechar ele fica no `body` — a próxima frase digitada não ia para lugar
   * nenhum, e o atendente precisava clicar de novo no campo. Com a conversa
   * aberta, o compositor é o lugar do cursor.
   *
   * Só na TRANSIÇÃO de fechamento: um efeito que devolvesse o foco a todo
   * render brigaria com quem está selecionando texto na conversa — focar um
   * campo limpa a seleção do documento, e o Ctrl+A daqui de cima ficaria
   * inútil.
   */
  const composerOverlayOpen = !!attachStaged || gifOpen || mediaLibOpen || emojiOpen || attachMenuOpen;
  const composerOverlayAnteriorRef = useRef(composerOverlayOpen);
  useEffect(() => {
    const fechou = composerOverlayAnteriorRef.current && !composerOverlayOpen;
    composerOverlayAnteriorRef.current = composerOverlayOpen;
    if (!fechou || !selectedId || rawIsMobile) return;
    if (conversationsRef.current.find(c => c.id === selectedId)?.is_blocked) return;
    // Fechou o anexo para responder a um modal que subiu por cima (confirmação,
    // workspace do CRM): o teclado é dele.
    if (document.querySelector('[role="dialog"]')) return;
    const id = window.setTimeout(() => draftRef.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(id);
  }, [composerOverlayOpen, selectedId, rawIsMobile]);

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
    // "Apenas acompanhar" NÃO marca como lida. Este era o atropelo mais
    // silencioso da supervisão: abrir a conversa de um colega para conferir
    // zerava o contador dele, e a pendência sumia da tela de quem tinha de
    // agir — sem que nenhum dos dois soubesse por quê.
    if (!supervisaoRef.current.acoes.marcarLida) return;
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
  }, [selectedId, lastInboundId, podeMarcarLida]);

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
    if (conversations.some(c => c.id === selectedId)) { deepLinkPendente.current = null; return; }
    // Conversa RECÉM-CRIADA por um clique de fora ("Conversar no WhatsApp" na
    // ficha do cliente) ainda não está nesta lista — ela nasceu há um instante,
    // no servidor. Sem esta trégua, a limpeza acima desfazia a abertura no
    // quadro seguinte ao clique, e o widget mostrava a inbox no lugar da
    // conversa. A trégua dura só até a recarga responder: se a conversa não
    // vier nem lá, a seleção é desfeita como sempre foi.
    if (deepLinkPendente.current === selectedId) return;
    setSelectedId(null);
  }, [loadingConvs, conversations, selectedId]);

  // Deep-link: ao clicar na notificação de mensagem nova (fora do módulo), o App
  // navega para cá com a conversa-alvo. Seleciona e limpa o param para não reabrir.
  useEffect(() => {
    if (!openConversationId) return;
    const alvo = openConversationId;
    setSelectedId(alvo);
    const texto = openConversationDraft?.trim();
    if (texto) draftPendente.current = { conversationId: alvo, texto };
    // A lista pode não conhecer esta conversa ainda (acabou de ser criada pelo
    // clique). Recarrega — e segura a limpeza de seleção até a resposta chegar.
    deepLinkPendente.current = alvo;
    void loadConversations().finally(() => {
      if (deepLinkPendente.current === alvo) deepLinkPendente.current = null;
    });
    onParamConsumed?.();
  }, [openConversationId, openConversationDraft, onParamConsumed, loadConversations]);

  /**
   * Escreve no compositor o texto que veio junto com o deep-link.
   *
   * Em efeito SEPARADO, e depois do `useWaComposer` de propósito: ao trocar de
   * conversa o compositor restaura o rascunho daquela thread (ou o vazio), e
   * esse efeito mora dentro do hook — declarado antes, ele roda antes. Escrever
   * no mesmo efeito da seleção seria escrever para ser apagado meio ciclo
   * depois.
   *
   * Rascunho que já existia na thread ganha do texto pronto: o que o atendente
   * deixou escrito pela metade é trabalho dele, e o modelo pode ser remontado
   * com um clique.
   */
  useEffect(() => {
    const pendente = draftPendente.current;
    if (!pendente || pendente.conversationId !== selectedId) return;
    draftPendente.current = null;
    setDraft(atual => (atual.trim() ? atual : pendente.texto));
  }, [selectedId, setDraft]);

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

  // O TEXTO QUE A FILA OBEDECE — atrás do que está sendo digitado.
  //
  // Cada tecla na busca refaz três varreduras da fila inteira: a lista, os
  // contadores das abas e os dois números da ampulheta, cada uma passando por
  // todas as conversas e ainda agrupando por pessoa. Com a fila cheia isso
  // acontecia ENTRE a tecla e a letra aparecer na tela, e digitar um nome saía
  // aos solavancos — o campo é o lugar do módulo onde a lentidão mais se sente,
  // porque é o único em que se digita esperando resposta imediata.
  //
  // `useDeferredValue` separa as duas velocidades: a letra aparece na hora, e a
  // fila se refaz logo atrás, em prioridade baixa e interrompível — se a próxima
  // tecla chegar antes do fim, o React abandona o trabalho a meio caminho e
  // recomeça com o texto novo, em vez de terminar uma lista que já nasceu velha.
  // Mesmo recurso que a agenda já usa na busca dela.
  //
  // O TECLADO NÃO USA ESTE VALOR: Esc limpar a busca tem de responder à tecla
  // que a pessoa acabou de apertar, não à fila de um quadro atrás.
  const deferredSearch = useDeferredValue(search);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const searching = q.length > 0;
    const ordenadas = conversations
      .filter(c => {
        // Fase 0: conversa sem nenhuma mensagem (last_message_at nulo) é rascunho de
        // "Nova conversa" aberta mas sem primeiro envio — não polui a inbox. Fica
        // visível apenas enquanto está aberta na thread; ao sair sem enviar, some.
        if (!c.last_message_at && !c.last_call_at && c.id !== selectedId) return false;
        if (filter === 'unread' && c.unread_count === 0) return false;
        if (filter === 'mine' && c.assigned_user_id !== user?.id) return false;
        // A dimensão de status (e a concessão que a busca faz nela) mora em
        // `inboxStatusScope`, compartilhada com os contadores das abas.
        if (hiddenByStatusFilter({
          filter: statusFilter, closed: c.status === 'closed',
          reopened: !!c.reopened_at, liveKey: convStatus(c).key, searching,
          selected: c.id === selectedId,
        })) return false;
        if (channelFilter !== 'all' && c.instance_id !== channelFilter) return false;
        if (deptFilter === 'none' && c.department_id) return false;
        if (deptFilter !== 'all' && deptFilter !== 'none' && c.department_id !== deptFilter) return false;
        if (labelFilter && inferFunnelStage(c.labels, funnelLabelsForChannel(c.instance_id))?.stageKey !== labelFilter) return false;
        if (!q) return true;
        return matchesConversationSearch(c, q);
      })
      // Ordem igual ao WhatsApp: atividade mais recente sempre no topo, sem
      // reordenar por status/urgência (a triagem fica nos filtros e badges de SLA).
      // ATIVIDADE, não mensagem: a ligação que você acabou de fazer sobe a
      // conversa, como no celular — antes ela ficava parada no meio da lista
      // com a hora do último texto.
      // A única exceção é a encerrada que a busca trouxe do arquivo: ela desce
      // para o fim, para o resultado não empurrar a fila de hoje tela abaixo.
      .sort((a, b) => {
        const ra = searchRank({ closed: a.status === 'closed', searching });
        const rb = searchRank({ closed: b.status === 'closed', searching });
        if (ra !== rb) return ra - rb;
        const ta = conversationActivityAt(a);
        const tb = conversationActivityAt(b);
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
  }, [conversations, deferredSearch, filter, channelFilter, deptFilter, statusFilter, labelFilter, selectedId, user?.id, funnelLabelsForChannel]);

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
    if (deferredSearch.trim() && statusFilter !== 'closed') {
      for (const c of filtered) if (c.status === 'closed') next.add(c.id);
    }
    const prev = archivedIdsRef.current;
    if (next.size === prev.size && [...next].every(id => prev.has(id))) return prev;
    archivedIdsRef.current = next;
    return next;
  }, [filtered, deferredSearch, statusFilter]);

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

  // O escopo de fila em que a pessoa estava ANTES de entrar numa aba de
  // consulta. Vive num ref porque só é lido na volta: virar estado faria a
  // inbox redesenhar a cada troca de aba para guardar uma lembrança.
  const lastQueueScope = useRef<InboxScopeTab>(filter === 'all' || filter === 'unread' ? filter : 'mine');
  useEffect(() => {
    if (filter === 'all' || filter === 'unread' || filter === 'mine') lastQueueScope.current = filter;
  }, [filter]);

  /**
   * Abrir a conversa a partir da aba de LIGAÇÕES — e devolver a lateral à fila.
   *
   * A aba de ligações responde a uma pergunta ("quem ligou?"); o clique em
   * "abrir a conversa" é o fim dela. Ficar com o histórico de chamadas na
   * lateral e uma thread aberta ao lado deixava as duas metades da tela
   * falando de assuntos diferentes — e quem respondia à pessoa escrevia sem a
   * fila à vista. Por isso, aqui, ao contrário das agendadas, abrir TROCA de
   * aba: para onde, é `returnScopeForConversation` quem decide.
   */
  const openConversationFromCalls = useCallback((id: string) => {
    setSelectedId(id);
    const conv = conversations.find(c => c.id === id);
    // Só a ABA muda. O filtro de status fica onde a pessoa o deixou: ele é
    // gravado no navegador, e alargá-lo aqui deixava a fila do dia com o
    // arquivo inteiro dentro em todas as sessões seguintes. A conversa
    // encerrada que se acabou de abrir aparece por ser a aberta, sem que
    // nenhuma outra encerrada venha junto (ver `inboxStatusScope`).
    const destino = returnScopeForConversation({
      previous: lastQueueScope.current,
      mine: !!conv && conv.assigned_user_id === user?.id,
    });
    setFilter(destino.tab);
  }, [conversations, user?.id]);

  // ── Teclado da inbox ─────────────────────────────────────────────────
  // Andar pela fila sem tirar as mãos do teclado: ↑/↓ trocam de conversa,
  // Alt+↑/↓ fazem o mesmo sem sair do compositor e Ctrl/Cmd+K vai para a busca.
  // A decisão de qual tecla é nossa mora em `inboxKeyboard` (pura e testada);
  // aqui só se lê o estado do DOM e se executa o resultado.
  const searchRef = useRef<HTMLInputElement>(null);
  const filteredIds = useMemo(() => filtered.map(c => c.id), [filtered]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // NO MODO EMBUTIDO, SÓ O ESC. As setas continuam sendo da página que
      // hospeda o widget — ali elas rolam a tela de trás, e duas instâncias
      // montadas ao mesmo tempo brigariam pela mesma tecla. O Esc não tem esse
      // problema: ele age sobre a pilha do que ESTE módulo abriu, e quando não
      // há mais nada por cima ele devolve o gesto ao hospedeiro (`exitSurface`),
      // em vez de disputá-lo.
      if (embedded && e.key !== 'Escape') return;
      const alvo = document.activeElement;
      const action = resolveInboxKey(e, {
        visibleIds: filteredIds,
        selectedId,
        typing: isTypingTarget(alvo),
        inSearch: alvo === searchRef.current,
        hasSearch: search.trim().length > 0,
        // Enquanto houver QUALQUER camada aberta por cima (modal, ficha,
        // janela de arquivos), a tecla é dela — o Esc desce uma camada por vez
        // e nunca leva a conversa junto. `escapeLayerCount` é o registro dessas
        // camadas; a busca no DOM cobre as caixas antigas que ainda não o usam.
        dialogOpen: escapeLayerCount() > 0 || !!document.querySelector('[role="dialog"]'),
        recording,
        overlayOpen: attachMenuOpen || gifOpen || mediaLibOpen || emojiOpen || slashActive,
        composing: !!editing || !!replyTo,
        hasDraft: draft.trim().length > 0,
        canExitSurface: embedded && !!onEscapeExit,
      });
      if (!action) return;
      e.preventDefault();
      // ── Esc: desfaz o topo da pilha (ver `escapeAction`) ──
      if (action.kind === 'cancelRecording') { stopRecording(false); return; }
      if (action.kind === 'closeOverlay') {
        setAttachMenuOpen(false); setGifOpen(false); setMediaLibOpen(false);
        // O menu de modelos não tem estado próprio: ele aparece enquanto o
        // rascunho começa com "/", então fechá-lo é apagar a barra.
        if (slashActive) setDraft('');
        return;
      }
      if (action.kind === 'cancelCompose') { setEditing(null); setReplyTo(null); return; }
      if (action.kind === 'exitSurface') { onEscapeExit?.(); return; }
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
    // O ouvinte lê estado direto, então precisa ser refeito quando esse estado
    // muda — senão a escada do Esc decide com um retrato velho. O caso que
    // dói é o RASCUNHO: com `hasDraft` desatualizado, o Esc fecharia a conversa
    // (ou a janela) de quem está no meio de uma frase. Recriar um ouvinte de
    // `keydown` é barato; decidir errado, não.
  }, [
    filteredIds, selectedId, search, embedded, onEscapeExit,
    draft, editing, replyTo, recording, attachMenuOpen, gifOpen, mediaLibOpen, emojiOpen, slashActive,
  ]);

  /**
   * Ctrl/⌘+A com a conversa aberta seleciona A CONVERSA, não a página.
   *
   * O padrão do navegador é "selecionar tudo o que está no documento" — e num
   * CRM isso é a barra lateral, o cabeçalho, a lista de conversas e o painel de
   * detalhes junto com as mensagens. Quem faz esse gesto dentro de um
   * atendimento quer copiar o atendimento; o resto da tela é moldura.
   *
   * Vive num efeito PRÓPRIO, e não na escada de atalhos acima, porque aquela
   * devolve as teclas ao hospedeiro no modo embutido (`embedded`). Aqui é o
   * contrário: é justamente no widget que o Ctrl+A padrão faz o pior estrago,
   * selecionando o CRM inteiro que está atrás da janelinha.
   *
   * O campo de texto continua sendo dono do gesto: dentro do compositor ou da
   * busca, Ctrl+A seleciona o que está escrito ali, como sempre.
   */
  useEffect(() => {
    const onSelectAll = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key !== 'a' && e.key !== 'A') return;
      if (!selectedId) return;
      const conteudo = threadContentRef.current;
      if (!conteudo) return;
      const alvo = document.activeElement;
      if (isTypingTarget(alvo)) return;
      // Um modal por cima tem o próprio conteúdo para selecionar.
      if (document.querySelector('[role="dialog"]')) return;
      // Foco em algo que não é nosso (a tela de trás, no widget): o gesto é de
      // quem está com o foco. Sem foco nenhum (`body`), a conversa aberta é a
      // única coisa em cena que faz sentido selecionar.
      const raiz = rootRef.current;
      if (alvo && alvo !== document.body && raiz && !raiz.contains(alvo)) return;
      const selecao = window.getSelection();
      if (!selecao) return;
      const faixa = document.createRange();
      faixa.selectNodeContents(conteudo);
      selecao.removeAllRanges();
      selecao.addRange(faixa);
      e.preventDefault();
    };
    window.addEventListener('keydown', onSelectAll);
    return () => window.removeEventListener('keydown', onSelectAll);
  }, [selectedId, threadContentRef]);

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
  // O histórico de ligações. Carregado com a inbox, e não ao abrir a aba, para
  // que o distintivo de perdidas já esteja aceso quando a pessoa chega — um
  // aviso que só aparece depois do clique não avisa ninguém.
  const callHistory = useCallHistory();
  const callsUnseen = callHistory.unseen;
  // Abrir a aba É ter visto, como no celular: o distintivo zera na hora. Roda
  // também a cada releitura enquanto a aba fica aberta — uma chamada que chega
  // com a lista à vista não precisa de aviso do que já está na frente da
  // pessoa. Sair da aba congela a marca, e a próxima perdida volta a avisar.
  const { markSeen: markCallsSeen } = callHistory;
  useEffect(() => {
    if (filter === 'calls') markCallsSeen();
  }, [filter, markCallsSeen]);

  // Contadores das abas (Fase A): refletem exatamente o que a lista mostraria em
  // cada escopo, aplicando os MESMOS filtros de fila (status/canal/depto/etiqueta/
  // busca) e variando só a dimensão da aba. Antes só excluíam rascunhos, então uma
  // conversa encerrada e atribuída ainda contava em "Minhas" mesmo sumindo da lista
  // sob o filtro "Abertas" (badge "Minhas (1)" com lista vazia).
  const tabCounts = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const searching = q.length > 0;
    const base = conversations.filter(c => {
      if (!c.last_message_at && !c.last_call_at && c.id !== selectedId) return false;
      // MESMA regra da lista, pela mesma função: quando a busca traz encerradas
      // do arquivo, elas precisam contar aqui também. Enquanto isto ficou de
      // fora, as abas mostravam "Todas (0)" com três conversas na tela.
      if (hiddenByStatusFilter({
        filter: statusFilter, closed: c.status === 'closed',
        reopened: !!c.reopened_at, liveKey: convStatus(c).key, searching,
        selected: c.id === selectedId,
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
  }, [conversations, deferredSearch, channelFilter, deptFilter, statusFilter, labelFilter, selectedId, user?.id, funnelLabelsForChannel]);

  // Quem está esperando — os dois números do menu da ampulheta.
  //
  // Varia só a dimensão da ESPERA: o escopo aberto (Todas/Não lidas/Minhas) e
  // os filtros de fila continuam valendo, exatamente como nos contadores das
  // abas. É o que faz o número ser verdade: abrir o menu em "Minhas" e ler "4"
  // tem de dar quatro linhas na lista depois do clique. A dimensão de STATUS é
  // a única ignorada aqui — ela é justamente o que o clique vai trocar, e
  // considerá-la zeraria o lado que não está ligado no momento.
  //
  // Encerrada e bloqueada não entram por consequência, sem regra extra:
  // `convStatus` dá a elas as chaves 'closed' e 'blocked', não as de espera.
  const waitingCounts = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    // Dentro de uma vista (Agendadas/Ligações) não há escopo à vista; vale o
    // último em que a pessoa esteve, que é para onde o clique devolve a lista.
    const escopo = filter === 'all' || filter === 'unread' || filter === 'mine' ? filter : lastQueueScope.current;
    const base = conversations.filter(c => {
      if (!c.last_message_at && !c.last_call_at && c.id !== selectedId) return false;
      if (escopo === 'unread' && c.unread_count === 0) return false;
      if (escopo === 'mine' && c.assigned_user_id !== user?.id) return false;
      if (channelFilter !== 'all' && c.instance_id !== channelFilter) return false;
      if (deptFilter === 'none' && c.department_id) return false;
      if (deptFilter !== 'all' && deptFilter !== 'none' && c.department_id !== deptFilter) return false;
      if (labelFilter && inferFunnelStage(c.labels, funnelLabelsForChannel(c.instance_id))?.stageKey !== labelFilter) return false;
      if (q && !matchesConversationSearch(c, q)) return false;
      return true;
    });
    // Mesma regra da lista e das abas: conta PESSOAS, não linhas.
    const porPessoa = collapseContactThreads(base, selectedId);
    return {
      waiting_you: porPessoa.filter(c => convStatus(c).key === 'waiting_you').length,
      waiting_client: porPessoa.filter(c => convStatus(c).key === 'waiting_client').length,
    };
  }, [conversations, deferredSearch, filter, channelFilter, deptFilter, labelFilter, selectedId, user?.id, funnelLabelsForChannel]);

  const activeWaiting: WaitingFilter | null =
    statusFilter === 'waiting_you' || statusFilter === 'waiting_client' ? statusFilter : null;

  const pickWaiting = useCallback((waiting: WaitingFilter | null) => {
    // Desligar devolve "Abertas", e não "Todos os status": este é o escopo de
    // trabalho da inbox, e cair em "todos" traria o arquivo inteiro junto —
    // desligar um filtro não pode acabar mostrando MAIS coisa do que antes.
    setStatusFilter(waiting ?? 'open');
    // Dentro de uma vista o filtro não teria onde agir: devolve as conversas,
    // no escopo em que a pessoa estava. É a mesma saída que clicar numa aba dá.
    if (filter === 'scheduled' || filter === 'calls') setFilter(lastQueueScope.current);
  }, [filter]);

  const connectedChannels = useMemo(() => channels.filter(c => c.status === 'connected'), [channels]);

  // Badge da aba "WHATSAPP" do widget: usa a MESMA fonte de verdade da tab
  // "Não lidas" da inbox (`tabCounts.unread` = QUANTIDADE de conversas com não
  // lidas, sob os mesmos filtros de fila), e não a soma bruta de mensagens.
  // Assim o número do topo nunca diverge do que a lista mostra.
  // O badge do widget NÃO vem daqui. Vinha, e mentia: `tabCounts.unread` é o
  // recorte da lista com os filtros de fila aplicados, então digitar na busca
  // fazia o número do launcher cair. Hoje ele é lido do banco por
  // `conversationsApi.countUnreadContacts()` — uma verdade só, que não depende
  // de o módulo estar montado nem do que está filtrado na tela.

  // Reporta a conversa aberta: o id (deep-link ao maximizar) e a identidade
  // (rosto e nome que a barra flutuante mostra com o widget minimizado).
  useEffect(() => {
    onActiveConversationChange?.(
      selectedId,
      selected ? { nome: conversationName(selected), avatarUrl: selected.contact_avatar_url } : null,
    );
  }, [selectedId, selected, onActiveConversationChange]);

  // Ações operacionais/governança da conversa aberta (accept/assume/release/
  // reopen/unblock, silenciar, limpar, toggles de ausência e guarda jurídica).
  // Os fluxos amarrados a modais (transfer/block/close) permanecem no módulo.
  const {
    handleReopen, handleUnblock, handleAccept, handleAssume, handleRelease,
    muteSelected, unmuteSelected, handleClearConversation,
    handleToggleAbsenceSuppressed, handleToggleAutoCloseSuppressed, handleToggleLegalHold,
    legalHoldModalOpen, confirmLegalHold, closeLegalHoldModal,
  } = useWaConversationActions({
    selected, user, agentPrefs, moduleConfig, staffById, aiSession, confirm,
    setConversations, refreshMessages, muteConversationIds: threadIds,
    closeMuteModal: () => setMuteModalOpen(false),
    setMessages, setPending, setReplyTo, setEditing, setHasMoreMsgs, oldestTsRef,
  });

  // Ligar para o contato da conversa aberta. O número é o da própria conversa —
  // o atendente nunca redigita. A tradução para o formato do WaCalls é feita
  // uma única vez, em `services/wacalls/phone.ts`, e o número guardado no CRM
  // não é tocado.
  const handleCall = useCallback(() => {
    if (!selected) return;
    void waCalls.placeCall(
      selected.contact_phone,
      {
        conversationId: selected.id,
        clientId: selected.client_id ?? null,
        name: conversationName(selected),
        avatarUrl: selected.contact_avatar_url ?? null,
      },
      // Reserva: o `remote_jid`. Numa conversa que nasceu por LID, o
      // `contact_phone` guarda os dígitos do apelido interno — e o jid pode ser
      // o `@s.whatsapp.net` com o número de verdade. Quem escolhe entre os dois
      // (e recusa os dois quando nenhum é telefone) é `resolveCallablePhone`.
      [{ source: 'jid', value: selected.remote_jid }],
    );
  }, [selected, waCalls]);

  // O mesmo destino, com a câmera desde o começo. Porta separada de propósito:
  // a permissão da câmera é pedida ANTES de o telefone do contato tocar, e quem
  // clicou em vídeo não pode cair numa chamada de voz sem perceber.
  const handleVideoCall = useCallback(() => {
    if (!selected) return;
    void waCalls.placeVideoCall(
      selected.contact_phone,
      {
        conversationId: selected.id,
        clientId: selected.client_id ?? null,
        name: conversationName(selected),
        avatarUrl: selected.contact_avatar_url ?? null,
      },
      [{ source: 'jid', value: selected.remote_jid }],
    );
  }, [selected, waCalls]);

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
    sweeping,
    handleConversationOpened,
    onTransferDone, onBlockDone, onCloseDone, onRequestDocCreated, onWorkspaceSaved,
  } = useWaOperationalModals({
    selected, funnelLabels: selectedFunnelLabels, setConversations, setSelectedId,
    loadConversations, reloadOverview, setOverview,
    classifyOnClose: handleAiClassify,
    onStageEntered: runFunnelStageActions,
  });
  const openNewConversation = useCallback(() => {
    if (ensurePermission({ module: 'whatsapp', action: 'create' })) setNewConvOpen(true);
  }, [ensurePermission, setNewConvOpen]);
  const openTransfer = useCallback(() => {
    if (ensurePermission({ module: 'whatsapp', action: 'edit' })) setTransferOpen(true);
  }, [ensurePermission, setTransferOpen]);
  const openCloseConversation = useCallback(() => {
    if (ensurePermission({ module: 'whatsapp', action: 'edit' })) setCloseOpen(true);
  }, [ensurePermission, setCloseOpen]);
  const openBlockConversation = useCallback(() => {
    if (ensurePermission({ module: 'whatsapp', action: 'edit' })) setBlockOpen(true);
  }, [ensurePermission, setBlockOpen]);
  const openDocumentRequest = useCallback(() => {
    if (ensurePermission({ module: 'whatsapp', action: 'create' })) setDocRequestOpen(true);
  }, [ensurePermission, setDocRequestOpen]);

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

  // ── A janela de arquivos do cliente (Nextcloud) ──
  // Uma só por vez, e ela SOBREVIVE à troca de conversa fechando: o que está
  // aberto pertence a um cliente, e continuar mostrando a pasta do anterior
  // sobre a conversa nova seria pior do que fechar.
  const [nextcloudWindow, setNextcloudWindow] = useState<{ clientId: string; clientName: string | null; path: string | null } | null>(null);
  const abrirNextcloud = useCallback((path?: string | null) => {
    if (!selected?.client_id) return;
    setNextcloudWindow({
      clientId: selected.client_id,
      clientName: selected.client_name || selected.contact_name || null,
      path: path ?? null,
    });
  }, [selected?.client_id, selected?.client_name, selected?.contact_name]);
  useEffect(() => {
    setNextcloudWindow(atual => (atual && atual.clientId !== selected?.client_id ? null : atual));
  }, [selected?.client_id]);

  /**
   * Arrastou um arquivo da janela do Nextcloud para dentro da conversa.
   *
   * O arrasto não carrega bytes (o arquivo está no servidor, não no disco):
   * chega o caminho, e é aqui que ele vira um `File` e entra no MESMO fluxo de
   * anexo do compositor — com o preview e a legenda de sempre.
   */
  const handleNextcloudDrop = useCallback(async (payload: { files: Array<{ path: string; name: string; mime: string }> }) => {
    try {
      const baixados = await Promise.all(payload.files.map(async item => {
        const blob = await nextcloudService.readFile(item.path);
        return new File([blob], item.name, { type: blob.type || item.mime || 'application/octet-stream' });
      }));
      handleDroppedFiles(baixados);
    } catch (err) {
      toast.error('Arquivo do Nextcloud', getNextcloudErrorMessage(err, 'ler o arquivo para enviar'));
    }
    // `handleDroppedFiles` e `toast` são estáveis o bastante para o ciclo desta tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag and drop de arquivos na thread → useThreadDragDrop (estado do overlay +
  // handlers). O envio em si (sendFile, staging, retry/resend) vive em useWaComposer.
  const { dragOver, dragProps } = useThreadDragDrop(!!selected && !editing, handleDroppedFiles, handleNextcloudDrop);

  // ── Trocar o canal por onde se fala com este contato ──
  // Não move a conversa: cada número do escritório tem a SUA thread com o
  // contato (é assim do lado do WhatsApp também). `openConversation` reabre a
  // existente ou cria a que faltava, e a thread aberta passa a ser aquela.
  const [switchingChannelId, setSwitchingChannelId] = useState<string | null>(null);
  const selectedChannel = selected?.instance_id ? channelById.get(selected.instance_id) ?? null : null;
  const channelDown = !!selectedChannel && selectedChannel.status !== 'connected' && !selected?.is_blocked;
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

  /**
   * "Conversar" do cartão de contato — abre a thread daquele número.
   *
   * É o clique do cartão inteiro, e é o que se espera de um contato recebido:
   * o cliente manda o número do perito, e falar com o perito não pode custar
   * copiar o número, abrir "Nova conversa" e colar. `openConversation` é
   * idempotente — quem já tem thread com aquele número cai nela, ninguém
   * duplica conversa por clicar num cartão.
   *
   * O CANAL é o desta conversa, não uma escolha nova: o contato chegou por
   * aqui, e é por aqui que o escritório responde. Só quando o cartão é aberto
   * fora de uma conversa (a bolha existe no workspace 360) é que cai no
   * primeiro canal conectado.
   */
  const openContactChat = useCallback(async (phone: string, name: string) => {
    const channelId = selected?.instance_id || connectedChannels[0]?.id;
    if (!channelId) {
      toast.warning('Sem canal conectado', 'Conecte um canal para abrir a conversa.');
      return;
    }
    try {
      const { conversation_id } = await whatsappService.openConversation({
        phone,
        channelId,
        contactName: name || null,
        departmentId: channelRoutingById.get(channelId)?.default_department_id || null,
      });
      await handleConversationOpened(conversation_id);
    } catch (e: any) {
      toast.error('Não foi possível abrir a conversa', e?.message);
    }
  }, [selected?.instance_id, connectedChannels, channelRoutingById, handleConversationOpened, toast]);

  /**
   * "Ver e resolver" da sirene — leva ao lugar onde a pendência TEM botão.
   *
   * Antes isto só selecionava a conversa, e a mensagem retida não mora na
   * thread: quem tem "Tentar enviar agora" é a aba Agendadas. Com a conversa já
   * aberta na tela, o clique não fazia absolutamente nada visível — o atendente
   * ficava batendo num botão morto com a mensagem parada.
   */
  const openReconnectAlert = useCallback((conversationId: string) => {
    setFilter('scheduled');
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
    react: (m: WhatsAppMessage, emoji: string) => void;
    copy: (m: WhatsAppMessage, texto: string) => void;
    /** Ações do cartão de contato recebido (ver `contactMessageCard.tsx`). */
    openContactChat: (phone: string, name: string) => void;
    callContactPhone: (phone: string, name: string) => void;
    linkContactPhone: (phone: string, name: string) => void;
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
    react: (m, emoji) => { void reactToMessage(m, emoji); },
    copy: (_m, texto) => { void copyMessageText(texto); },
    // Ligar para um número do cartão de contato. Vai pela MESMA porta da
    // ligação do cabeçalho: quem decide se aquilo é um número discável é
    // `resolveCallablePhone`, não a bolha.
    openContactChat: (phone, name) => { void openContactChat(phone, name); },
    callContactPhone: (phone, name) => {
      void waCalls.placeCall(phone, {
        conversationId: null, clientId: null, name, avatarUrl: null,
      });
    },
    linkContactPhone: (phone, name) => setContactLinkTarget({ phone, name }),
  };

  /**
   * Copia para a área de transferência o texto que a bolha JÁ preparou.
   *
   * O texto chega pronto de propósito: quem sabe o que está escrito na tela é a
   * bolha (ela é que esconde a assinatura, lê as marcas e — no modo privado —
   * mascara). Aqui só resta entregar e dizer se deu certo. No modo privado o
   * conteúdo real nem passa por este caminho, então nem o toast pode vazá-lo:
   * ele anuncia o fato, nunca o texto.
   */
  const copyMessageText = async (texto: string) => {
    if (await copiarTexto(texto)) {
      toast.success('Mensagem copiada');
      return;
    }
    playWaActionSound('error');
    toast.error('Não foi possível copiar', 'O navegador bloqueou o acesso à área de transferência.');
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
    if (!ensurePermission({ module: 'whatsapp', action: 'delete' })) return;
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
   * Reage a uma mensagem — ou desfaz a reação, quando `emoji` vem vazio.
   *
   * A pastilha aparece antes da resposta do servidor: reagir é gesto de meio
   * segundo, e esperar a Evolution ida e volta para o emoji surgir faz o clique
   * parecer perdido (e convida ao segundo clique, que desfaria). Se o envio
   * falhar, a lista volta a ser exatamente a de antes.
   *
   * Quem manda no formato da lista é o servidor: o que ele devolve substitui o
   * palpite local, inclusive quando o contato reagiu no mesmo instante.
   */
  const reactToMessage = async (m: WhatsAppMessage, emoji: string) => {
    const antes = m.reactions ?? [];
    const otimista = aplicarReacao(antes, {
      emoji,
      from: 'out',
      actor: ACTOR_ESCRITORIO,
      name: (user ? agentLabel(staffById.get(user.id)) : null) || null,
      at: new Date().toISOString(),
    });
    setMessages(prev => prev.map(x => x.id === m.id ? { ...x, reactions: otimista } : x));
    try {
      const reactions = await whatsappService.reactToMessage(m.id, emoji);
      setMessages(prev => prev.map(x => x.id === m.id ? { ...x, reactions } : x));
    } catch (err: any) {
      setMessages(prev => prev.map(x => x.id === m.id ? { ...x, reactions: antes } : x));
      playWaActionSound('error');
      toast.error('Não foi possível reagir', err?.message);
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
    // O cartão de contato segue como CARTÃO, não como texto com o número
    // dentro: quem recebe salva na agenda com um toque em vez de copiar
    // dígito por dígito. `parseContactMessage` lê de volta o mesmo texto que o
    // webhook grava (ver `contactCard.ts`).
    const contatosDoCartao = m.type === 'contact'
      ? parseContactMessage(m.content).flatMap(e => e.phones.map(phone => ({ name: e.name, phone })))
      : [];
    const results = await Promise.allSettled(targets.map(target => {
      if (m.type === 'contact') {
        if (contatosDoCartao.length === 0) return Promise.reject(new Error('o cartão veio sem número de telefone'));
        return whatsappService.sendContact({ conversationId: target.id, contacts: contatosDoCartao });
      }
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
    onReact: (m: WhatsAppMessage, emoji: string) => bubbleImplRef.current.react(m, emoji),
    onCopy: (m: WhatsAppMessage, texto: string) => bubbleImplRef.current.copy(m, texto),
    onOpenContactChat: (phone: string, name: string) => bubbleImplRef.current.openContactChat(phone, name),
    onCallContactPhone: (phone: string, name: string) => bubbleImplRef.current.callContactPhone(phone, name),
    onLinkContactPhone: (phone: string, name: string) => bubbleImplRef.current.linkContactPhone(phone, name),
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
      lastCallAt: c.last_call_at,
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
   * Contador do encerramento automático da conversa aberta.
   *
   * Pega carona no mesmo tique de um minuto da fila: o encerramento é medido em
   * horas, e um contador de segundos re-renderizaria a thread inteira para
   * mudar um dígito que ninguém está olhando.
   *
   * O expediente não entra: ele segura a despedida, não o encerramento — a
   * conversa que vence às 22h fecha às 22h, e só o aviso ao cliente espera a
   * abertura. O contador, portanto, vale igual a qualquer hora.
   */
  const autoCloseInfo = useMemo(
    () => (selected
      ? autoCloseClock(selected, selectedChannel, queueTick)
      : { key: 'off' as const }),
    [selected, selectedChannel, queueTick],
  );

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

  /**
   * Patamares de SLA de cada canal — a contraparte do relógio acima.
   *
   * O relógio diz QUANTO tempo passou; isto diz A PARTIR DE QUANDO isso é
   * atraso. Os dois têm de sair do mesmo canal, senão o plantão 24h é medido
   * com o prazo do comercial. Enquanto os canais não chegam, o resolvedor
   * devolve o padrão (15/60), que é o mesmo `DEFAULT` das colunas no banco.
   */
  const slaPolicyFor = useMemo(
    () => slaPolicyForChannels(Object.fromEntries(channels.map(ch => [ch.id, ch]))),
    [channels],
  );

  const queuePolicy = useMemo(
    () => ({ ...DEFAULT_QUEUE_POLICY, elapsedMinutes, thresholdsFor: queueThresholdsFor(slaPolicyFor) }),
    [elapsedMinutes, slaPolicyFor],
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
      {/* Um chip só para as duas quedas possíveis — e, quando é canal, com o
          nome dele. Ver ChannelHealthChip para por que estavam misturadas. */}
      <ChannelHealthChip channels={channels} realtimeDown={realtimeStatus === 'down'} compact={embedded}
        loading={channelsLoading} />
      <WaNotifyBell pushState={pushState} onTogglePush={toggleStaffPush} />
      {/* Microfone e alto-falante ficam AQUI, à vista, e não em Configurações:
          o driver errado só se descobre no meio de uma ligação, e nesse momento
          sair do módulo para procurar um ajuste é o mesmo que desistir. */}
      <WaAudioDeviceButton />
      {/* "Próximo da fila" fica sempre à mão: é ação de atendimento, feita
          dezenas de vezes por dia, não configuração. */}
      {!embedded && nextUp && (
        <button onClick={takeNextInQueue}
          title={`Próximo da fila: ${nextUp.label}`}
          aria-label={`Próximo da fila: ${nextUp.label}`}
          className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
            nextUp.bucket === 'transferencia_travada' || nextUp.bucket === 'sla_estourado'
              ? 'bg-[#fdecea] text-[#c5221f] hover:bg-[#fbdedb]'
              : nextUp.bucket === 'urgente' || nextUp.bucket === 'sla_atencao'
                ? 'bg-[#fdf1e0] text-[#a15c07] hover:bg-[#fbe6cc]'
                : 'text-slate-500 hover:bg-[#f1f0ec] hover:text-slate-700'
          }`}>
          <ListTodo size={16} />
        </button>
      )}
      {/* Gestão (fila, dashboard, acessos, funis) atrás de um único botão. Em
          fila, esses quatro ícones estouravam a largura da coluna e sumiam
          cortados na borda — e nenhum deles é ação de minuto a minuto. */}
      {!embedded && (
        <div className="relative">
          <button onClick={() => setMoreMenuOpen(o => !o)} aria-expanded={moreMenuOpen}
            title="Gestão do atendimento"
            className={`relative flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
              moreMenuOpen ? 'bg-[#eceae5] text-slate-800' : 'text-slate-500 hover:bg-[#f1f0ec] hover:text-slate-700'
            }`}>
            <MoreVertical size={16} />
            {queueAlerts > 0 && (
              <span title={`${queueAlerts} na fila precisando de ação`}
                className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">
                {queueAlerts}
              </span>
            )}
          </button>
          {moreMenuOpen && (
            <>
              <button type="button" aria-label="Fechar menu"
                className="fixed inset-0 z-40 cursor-default bg-transparent"
                onClick={() => setMoreMenuOpen(false)} />
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
      {/* A única cor cheia da barra: uma barra de ferramentas com quatro botões
          coloridos não tem ação principal nenhuma. */}
      <button onClick={openNewConversation} title="Nova conversa"
        className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#f27a23] text-white shadow-[0_1px_2px_rgba(242,122,35,.4)] hover:bg-[#e06b1f] transition-colors active:scale-95">
        <Plus size={17} />
      </button>
    </div>
  );

  return (
    <div ref={rootRef} className="relative flex flex-col h-full min-h-0 bg-[#faf9f7]">
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
        className={`relative flex-shrink-0 flex-col border-r border-[#e7e5df] bg-white min-h-0 ${isMobile ? (selectedId ? 'hidden' : 'flex w-full') : 'flex'}`}>
        {/* ZONA DE CONTROLE. Busca, filtros e abas ficam sobre um creme quase
            branco, e a lista sobre o branco: sem essa separação, o topo e o
            conteúdo eram a mesma superfície e o olho não sabia onde acabava a
            ferramenta e onde começava o trabalho. */}
        <div className={`border-b border-[#e7e5df] bg-[#fdfcfb] ${embedded ? 'px-3 pt-2.5 pb-2' : 'px-4 pt-4 pb-3'}`}>
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
                className={`w-full pl-9 text-[13px] text-slate-800 placeholder-slate-400 rounded-full bg-[#f4f3f0] border border-transparent outline-none transition focus:bg-white focus:border-[#e0ddd5] focus:shadow-[0_1px_3px_rgba(15,23,42,.07)] ${embedded ? 'py-1.5 pr-3' : 'py-2 pr-12'}`} />
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
                  className={`flex-shrink-0 inline-flex items-center gap-1 h-8 px-2 rounded-lg text-[12.5px] font-semibold transition-colors ${filtersOpen || active ? 'bg-[#fdf1e0] text-[#a15c07] hover:bg-[#fbe6cc]' : 'text-slate-500 hover:bg-[#f1f0ec] hover:text-slate-700'}`}>
                  <Filter size={16} />
                  {active > 0 && <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#f27a23] text-white text-[10px] font-bold">{active}</span>}
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
              <option value="waiting_you">Aguardando sua resposta</option>
              <option value="waiting_client">Aguardando o cliente</option>
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

          {/* Uma linha, dois grupos separados por um fio: à esquerda o que
              FILTRA a lista (com o nome escrito), à direita o que TROCA a lista
              por outra coisa. Ver o cabeçalho de `InboxTabs.tsx` — a mistura
              dos dois numa fila só de ícones era o que impedia os nomes. */}
          <div className={`flex items-center gap-2 ${embedded ? 'mt-2' : 'mt-2.5'}`}>
            <InboxTabs active={filter} onChange={setFilter} counts={tabCounts} className="min-w-0 flex-1" />
            {/* Do lado dos FILTROS, antes do fio: a espera recorta a mesma
                lista, não a substitui. */}
            <InboxWaitingMenu active={activeWaiting} counts={waitingCounts} onPick={pickWaiting} />
            <span aria-hidden className="w-px h-3.5 bg-[#e2ded4] shrink-0" />
            <InboxViewSwitch
              active={filter}
              onChange={setFilter}
              scheduledPending={myScheduledPending.length}
              scheduledFailed={scheduledFailed}
              callsUnseen={callsUnseen}
            />
          </div>
        </div>

        <div ref={setListEl} onScroll={onListScroll} className="flex-1 overflow-y-auto overscroll-contain min-h-0">
          {filter === 'calls' ? (
          <CallHistoryList
            calls={callHistory.calls}
            loading={callHistory.loading}
            error={callHistory.error}
            onReload={callHistory.reload}
            privateMode={privateMode}
            /* Abrir a conversa TROCA de aba — ao contrário das agendadas.
               Lá a lista é uma fila que se percorre item a item, e trocar de
               aba faria perder o lugar; aqui o clique é a resposta à pergunta
               "quem ligou?", e a lateral volta para a fila de atendimento
               junto com a thread que abriu. Ver `inboxReturnScope`. */
            onOpenConversation={openConversationFromCalls}
            /* Ligar de novo pela MESMA porta de todas as outras ligações do
               módulo: quem decide se aquilo é um número discável é
               `resolveCallablePhone`, nunca a lista. */
            onCall={(phone, name, conversationId) => {
              void waCalls.placeCall(phone, { conversationId, clientId: null, name, avatarUrl: null });
            }}
          />
          ) : filter === 'scheduled' ? (
          <MyScheduledList
            items={myScheduled}
            privateMode={privateMode}
            confirm={confirm}
            onReload={reloadMyScheduled}
            /* Abrir a conversa NÃO troca de aba: voltar para "Todas" trocava a fila
               de agendadas pela lista inteira e quem estava conferindo os
               agendamentos perdia o lugar a cada clique. `selected` sai de
               `conversations` (sem filtro), então a thread abre do mesmo jeito
               com a aba de agendadas de pé.
               Uma concluída leva ao PONTO da conversa em que a mensagem saiu —
               é a pergunta que essa metade da lista faz. */
            onOpenConversation={openConversationAt}
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
            sweeping={sweeping}
            funnelLabelsForChannel={funnelLabelsForChannel}
            elapsedMinutes={elapsedMinutes}
            slaPolicyFor={slaPolicyFor}
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

        {/* "Nova conversa" cobre ESTA coluna, e não o meio da tela: escolher com
            quem falar é a mesma tarefa de escolher uma conversa, e a agenda
            quer a altura inteira. Ver o cabeçalho de `newConversationPanel`. */}
        {newConvOpen && (
          <NewConversationPanel
            channels={connectedChannels}
            channelRouting={channelRouting}
            onClose={() => setNewConvOpen(false)}
            onOpened={handleConversationOpened}
          />
        )}
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
            <header className={`flex items-center gap-2 sm:gap-3 border-b border-black/[0.06] ${molduraBg} ${embedded ? 'px-2.5 py-2' : 'px-2.5 sm:px-5 py-2.5'}`}>
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
                  {(() => { const sla = slaSignal(selected, elapsedMinutes, slaPolicyFor); return sla ? (
                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: sla.color }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: sla.color }} /> {sla.label}
                    </span>
                  ) : null; })()}
                  {(() => { const ta = transferAlert(selected, elapsedMinutes, slaPolicyFor); return ta ? (
                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: ta.color }}>
                      <ArrowRightLeft size={11} /> {ta.label}
                    </span>
                  ) : null; })()}
                  {/* Contador do encerramento automático. Só aparece quando o
                      prazo está de fato correndo: com a resposta do nosso lado
                      não há contagem, e um badge dizendo isso viraria ruído em
                      toda conversa que acabou de chegar. O motivo fica no painel
                      lateral, onde se liga e desliga a regra. */}
                  {autoCloseInfo.key !== 'off' && autoCloseInfo.key !== 'suppressed' && autoCloseInfo.key !== 'waiting_us' && (
                    <span
                      className="inline-flex items-center gap-1 font-semibold"
                      style={{ color: autoCloseInfo.urgent ? '#d97706' : '#64748b' }}
                      title={`Sem nenhuma mensagem há ${autoCloseIdleLabel(autoCloseInfo.idleMinutes)}.`}
                    >
                      <Timer size={11} /> {autoCloseInfo.label}
                    </span>
                  )}
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
                {/* Ligar pelo WhatsApp (voz, via WaCalls). Fica FORA do grupo que
                    some no mobile: telefonar é ação de primeira linha em
                    qualquer largura. Indisponibilidade não esconde o botão — o
                    clique explica o motivo em toast, que é o que o atendente
                    precisa saber (serviço fora, nenhum número conectado). */}
                {!selected.is_blocked && (
                  <button
                    onClick={handleCall}
                    /* `dialing` é o intervalo entre o clique e a chamada existir
                       (microfone + POST). Sem ele o botão só apagava quando a
                       chamada aparecia — e cada clique nesse meio-tempo fazia o
                       telefone do contato tocar de novo. */
                    disabled={!!waCalls.myCall || waCalls.dialing}
                    title={waCalls.myCall
                      ? 'Você já está em uma chamada'
                      : waCalls.dialing
                        ? 'Chamando…'
                        : (waCalls.ready && !waCalls.canCall
                          ? 'Chamadas de voz indisponíveis no momento'
                          : `Ligar para ${conversationName(selected)}`)}
                    aria-label="Ligar por voz"
                    className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      waCalls.ready && !waCalls.canCall && !waCalls.dialing
                        ? 'bg-[#f3f2ef] text-slate-400 hover:bg-slate-200'
                        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    <PhoneCall size={16} />
                  </button>
                )}
                {/* Chamada de VÍDEO. Fica ao lado da de voz porque é o mesmo
                    gesto com outra intenção; o navegador que não codifica H.264
                    mostra o botão desabilitado com o motivo, em vez de escondê-lo
                    e deixar o atendente procurando. */}
                {!selected.is_blocked && (
                  <button
                    onClick={handleVideoCall}
                    disabled={!!waCalls.myCall || waCalls.dialing || !waCalls.videoSupported}
                    title={!waCalls.videoSupported
                      ? 'Este navegador não faz chamada de vídeo'
                      : waCalls.myCall
                        ? 'Você já está em uma chamada'
                        : waCalls.dialing
                          ? 'Chamando…'
                          : (waCalls.ready && !waCalls.canCall
                            ? 'Chamadas indisponíveis no momento'
                            : `Chamada de vídeo com ${conversationName(selected)}`)}
                    aria-label="Ligar por vídeo"
                    className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      waCalls.ready && !waCalls.canCall && !waCalls.dialing
                        ? 'bg-[#f3f2ef] text-slate-400 hover:bg-slate-200'
                        : 'bg-sky-50 text-sky-700 hover:bg-sky-100'
                    }`}
                  >
                    <Video size={16} />
                  </button>
                )}
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
                {acoes.assumir && !selected.is_blocked && selected.status !== 'closed' && !selected.awaiting_accept && selected.assigned_user_id !== user?.id && (
                  <button onClick={handleAssume} title={selected.assigned_user_id ? 'Assumir este atendimento' : 'Assumir da fila'}
                    className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#f3f2ef] hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 flex items-center justify-center transition">
                    <UserPlus size={16} />
                  </button>
                )}
                {acoes.devolverFila && !selected.is_blocked && selected.status !== 'closed' && selected.assigned_user_id === user?.id && (
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
                {perms.canTransfer && acoes.transferir && (
                  <button onClick={openTransfer} title="Transferir conversa"
                    className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#f3f2ef] hover:bg-amber-50 text-slate-600 hover:text-amber-700 flex items-center justify-center transition">
                    <ArrowRightLeft size={16} />
                  </button>
                )}
                {selected.status === 'closed' ? (acoes.reabrir && (
                  <button onClick={handleReopen} title="Reabrir conversa"
                    className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#f3f2ef] hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 flex items-center justify-center transition">
                    <RotateCcw size={16} />
                  </button>
                )) : (acoes.encerrar && (
                  <button onClick={openCloseConversation} title="Encerrar atendimento"
                    className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#f3f2ef] hover:bg-amber-50 text-slate-600 hover:text-amber-700 flex items-center justify-center transition">
                    <CheckCircle2 size={16} />
                  </button>
                ))}
                {/* A lixeira saiu daqui. "Limpar conversa" apaga o histórico
                    inteiro e não tem volta — não é vizinha de Transferir e
                    Encerrar, que são o trabalho de todo dia. Ela vive no painel
                    de detalhes, logo abaixo de "Baixar tudo da conversa": quem
                    vai apagar quase sempre quer o arquivo antes, e essa ordem
                    põe o backup no caminho da mão. */}
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
                      <button onClick={openCloseConversation} title="Encerrar atendimento"
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
                        <button type="button" aria-label="Fechar menu da conversa"
                          className="fixed inset-0 z-40 cursor-default bg-transparent"
                          onClick={() => setHeaderMenuOpen(false)} />
                        <div role="menu" className="absolute right-0 top-11 z-50 w-56 rounded-xl bg-white shadow-xl border border-[#e7e5df] py-1.5 overflow-hidden">
                          {!panelDocked && (
                            <button className={item} onClick={run(() => setMobilePanelOpen(true))}><Info size={16} className="text-slate-400" /> Detalhes do contato</button>
                          )}
                          {acoes.assumir && !selected.is_blocked && selected.status !== 'closed' && !selected.awaiting_accept && selected.assigned_user_id !== user?.id && (
                            <button className={item} onClick={run(handleAssume)}><UserPlus size={16} className="text-emerald-500" /> {selected.assigned_user_id ? 'Assumir atendimento' : 'Assumir da fila'}</button>
                          )}
                          {acoes.devolverFila && !selected.is_blocked && selected.status !== 'closed' && selected.assigned_user_id === user?.id && (
                            <button className={item} onClick={run(handleRelease)}><UserMinus size={16} className="text-amber-500" /> Devolver à fila</button>
                          )}
                          <button className={item} onClick={run(() => selectedContactMuted ? unmuteSelected() : setMuteModalOpen(true))}>
                            {selectedContactMuted ? <Bell size={16} className="text-amber-500" /> : <BellOff size={16} className="text-slate-400" />} {selectedContactMuted ? 'Reativar notificações' : 'Silenciar contato…'}
                          </button>
                          {perms.canTransfer && acoes.transferir && (
                            <button className={item} onClick={run(openTransfer)}><ArrowRightLeft size={16} className="text-slate-400" /> Transferir conversa</button>
                          )}
                          {selected.status === 'closed' ? (acoes.reabrir && (
                            <button className={item} onClick={run(handleReopen)}><RotateCcw size={16} className="text-emerald-500" /> Reabrir conversa</button>
                          )) : (acoes.encerrar && (
                            <button className={item} onClick={run(openCloseConversation)}><CheckCircle2 size={16} className="text-emerald-500" /> Encerrar atendimento</button>
                          ))}
                          {/* "Limpar conversa" não está aqui: é destrutiva e
                              mora no painel de detalhes, abaixo do arquivo da
                              conversa (o item acima abre esse painel). */}
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
            {/* Você está na conversa de outra pessoa. A faixa só aparece quando
                é supervisão de verdade — na própria conversa, na da fila e na
                que foi transferida para você não há passo a mais. */}
            <SupervisionBar
              modos={supervisao.modos}
              modo={supervisao.modo}
              onModo={supervisao.setModo}
              responsavelNome={
                selected.assigned_user_id
                  ? (staffById.get(selected.assigned_user_id)?.name ?? null)
                  : null
              }
              ehAdmin={supervisao.escopo.isAdmin}
            />

            {/* O indicador de estado da IA desta conversa — "IA atendendo",
                "IA pausada", "Falha na IA", "Atendimento humano" — e os únicos
                controles de IA que cabem num atendimento: pausar, retomar e
                assumir. Configuração (prompt, modelo, canais, limites) não
                entra aqui: é de administrador e vive em Configurações. */}
            <AiAgentBanner
              conversationId={selected.id}
              assignedUserId={selected.assigned_user_id}
              awaitingAccept={!!selected.awaiting_accept}
              responsavelNome={
                selected.assigned_user_id
                  ? (staffById.get(selected.assigned_user_id)?.name ?? null)
                  : null
              }
              podeControlar={acoes.controlarIa}
              podeAssumir={acoes.assumir && !selected.is_blocked}
              onAssume={handleAssume}
              confirm={confirm}
              versao={iaVersao}
              onMudou={iaMudou}
            />
            {/* Fase O: banner de aprovação de resposta IA pendente.
                Aprovar MANDA a mensagem ao cliente, então o botão segue o mesmo
                verbo do compositor (`acoes.responder`) — o supervisor em
                "apenas acompanhar" falava com o cliente por aqui sem poder
                escrever uma linha lá embaixo. A trava é da Edge Function
                (`wa_can_reply_conv`); esconder é para não oferecer um 403. */}
            {acoes.responder && aiSession?.status === 'pending_approval' && aiSession.pending_ai_reply && (
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
            {/* DENTRO DO WIDGET, A CONVERSA TEM O CHÃO DO PAINEL.
                Em tela cheia o módulo mantém o bege com os rabiscos — é o
                ambiente do WhatsApp e quem atende o dia inteiro o reconhece de
                longe. Mas no painel flutuante ele divide a mesma janela com o
                chat da equipe, que é creme liso: trocar de aba trocava o chão
                debaixo do pé. Embutido, os dois lados usam a mesma superfície;
                o que distingue um do outro é o conteúdo, não o papel de parede. */}
            <div ref={setThreadEl} onScroll={onThreadScroll} className={`${embedded ? 'wa-thread-bg-liso' : 'wa-thread-bg'} flex-1 overflow-y-auto overscroll-contain min-h-0`}>
              <div ref={threadContentRef} className="mx-auto w-full max-w-[1180px] px-3 sm:px-6 py-4">
              {loadingMsgs ? (
                <ThreadSkeleton />
              ) : (() => {
                // Desenha UMA unidade (bolha ou álbum). O índice é o global em
                // `messageUnits`: o agrupamento visual olha a unidade anterior e a
                // seguinte, e essas vizinhas atravessam a fronteira das seções.
                const renderUnit = (u: MessageUnit, unitIndex: number) => {
                  // A ligação é uma unidade da thread, mas não é uma mensagem:
                  // nada do agrupamento visual (mesmo remetente, cinco minutos,
                  // resposta citada) se aplica a ela. Sai antes.
                  // Divisor do canal que abre este trecho (só em thread multicanal).
                  const chDivider = channelDividers.get(unitIndex);
                  const withChannel = (node: React.ReactNode) => chDivider
                    ? (<React.Fragment key={`ch-${unitIndex}`}>
                        <ChannelDivider name={chDivider.name} color={chDivider.color} />
                        {node}
                      </React.Fragment>)
                    : node;
                  if (u.kind === 'call') {
                    return (
                      <ThreadCallEntry
                        key={`call-${u.call.id}`}
                        call={u.call}
                        privateMode={privateMode}
                        onCallBack={waCalls.canCall && !waCalls.myCall ? handleCall : undefined}
                      />
                    );
                  }
                  const head = u.kind === 'album' ? u.items[0] : u.m;
                  const tail = u.kind === 'album' ? u.items[u.items.length - 1] : u.m;
                  const previousUnit = unitIndex > 0 ? messageUnits[unitIndex - 1] : null;
                  const nextUnit = unitIndex < messageUnits.length - 1 ? messageUnits[unitIndex + 1] : null;
                  // Uma chamada no meio QUEBRA o grupo, e é o que se quer: duas
                  // mensagens separadas por uma ligação de seis minutos não são
                  // uma rajada, e desenhá-las coladas contaria a história errada.
                  const previousTail = previousUnit && previousUnit.kind !== 'call'
                    ? (previousUnit.kind === 'album' ? previousUnit.items[previousUnit.items.length - 1] : previousUnit.m)
                    : null;
                  const nextHead = nextUnit && nextUnit.kind !== 'call'
                    ? (nextUnit.kind === 'album' ? nextUnit.items[0] : nextUnit.m)
                    : null;
                  const belongsToSameGroup = (left: WhatsAppMessage | null, right: WhatsAppMessage | null) => {
                    if (!left || !right) return false;
                    if (left.direction !== right.direction || (left.sender_user_id || null) !== (right.sender_user_id || null)) return false;
                    if (new Date(left.wa_timestamp).toDateString() !== new Date(right.wa_timestamp).toDateString()) return false;
                    return Math.abs(new Date(right.wa_timestamp).getTime() - new Date(left.wa_timestamp).getTime()) <= 5 * 60_000;
                  };
                  const groupStart = !belongsToSameGroup(previousTail, head);
                  const groupEnd = !belongsToSameGroup(tail, nextHead);
                  // Mensagem que sai sem `sender_user_id` não tem pessoa atrás
                  // dela. Quando o carimbo diz que foi o agente, a bolha passa a
                  // dizer "IA" — antes ela chegava idêntica à de um atendente
                  // sem cargo, e o histórico não separava o que o agente
                  // escreveu do que uma pessoa escreveu.
                  const senderName = groupStart && head.direction === 'out'
                    ? (head.sender_user_id
                      ? (agentLabel(staffById.get(head.sender_user_id)) || staffByUser.get(head.sender_user_id) || null)
                      : intervencaoLabel(head.sender_role))
                    : null;
                  const key = u.kind === 'album' ? `album-${head._tempId || head.id}` : (head._tempId || head.id);
                  return withChannel(u.kind === 'album' ? (
                    // O álbum recebe as MESMAS ações da bolha: cada miniatura
                    // ganha menu, clique direito, reação e exclusão sobre a
                    // imagem clicada (ver `AlbumThumb`).
                    <ImageAlbum key={key} items={u.items} out={head.direction === 'out'} senderName={senderName} groupStart={groupStart} onOpenImage={setLightbox}
                      privateMode={privateMode} canCreateFollowups actions={bubbleHandlers}
                      scheduledAt={u.items.map(i => scheduledSentMarks.get(i.id)).find(Boolean) ?? null} />
                  ) : (
                    <MessageBubble
                      key={key}
                      m={u.m}
                      repliedTo={u.m.reply_to_id ? msgById.get(u.m.reply_to_id) || null : null}
                      senderName={senderName}
                      senderRole={u.m.direction === 'out' && u.m.sender_user_id
                        // Intervenção ganha o rótulo do PAPEL, não o cargo do
                        // perfil: aqui o que importa não é "Advogado", é que
                        // quem respondeu não era o responsável pelo caso.
                        ? (intervencaoLabel(u.m.sender_role) ?? agentRoleLabel(staffById.get(u.m.sender_user_id)))
                        : null}
                      groupStart={groupStart}
                      groupEnd={groupEnd}
                      privateMode={privateMode}
                      canCreateFollowups
                      onOpenImage={setLightbox}
                      nextAudioId={u.m.type === 'audio' ? nextAudioId.get(u.m.id) ?? null : null}
                      scheduledAt={scheduledSentMarks.get(u.m.id) ?? null}
                      uploadProgress={u.m._tempId ? uploadProgress.get(u.m._tempId) : undefined}
                      {...bubbleHandlers}
                    />
                  ));
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
              <div className={`px-3 pt-2 ${molduraBg}`}>
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

            {/* Canal fora do ar: faixa colada ao compositor, sem dispensar,
                enquanto o canal não voltar. Mensagem que não sai sem ninguém
                perceber é o defeito que não pode acontecer — mas o aviso avisa,
                não tranca: o resto do módulo continua utilizável. */}
            {channelDown && selectedChannel && (
              <ChannelDownBanner channel={selectedChannel} alternatives={channelAlternatives}
                busyId={switchingChannelId} onSwitch={switchConversationChannel} />
            )}

            {/* Composer (ou aviso de bloqueio) */}
            {/* "Apenas acompanhar": a barra de escrita sai, e no lugar dela fica
                o que fazer para poder responder. Deixar o compositor de pé e
                recusar no envio seria pior — a pessoa escreve a resposta
                inteira para só então descobrir que não podia mandá-la. */}
            {acoes.supervisionando && !acoes.responder && !selected.is_blocked ? (
              <div className="px-4 py-3 border-t border-[#e7e5df] bg-indigo-50/70 flex items-center gap-3">
                <Eye size={16} className="text-indigo-500 flex-shrink-0" />
                <p className="flex-1 text-[12.5px] text-indigo-800">
                  Você está acompanhando este atendimento. Para escrever, escolha
                  <strong> Responder sem assumir</strong> ou <strong>Assumir atendimento</strong> na faixa acima.
                </p>
              </div>
            ) : selected.is_blocked ? (
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
            <div className={`relative px-2.5 sm:px-3 py-2 border-t border-black/[0.06] ${molduraBg}`}>
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
                    className={`flex-shrink-0 w-10 h-10 rounded-full ${btnEnviarCor} text-white flex items-center justify-center transition`}>
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
                    {/* PEGA-CLIQUES, não cortina. `<button>` e não `<div>` de
                        propósito: a correção global de modais do `index.css`
                        casa por SUBSTRING de classe (`div` + `fixed` +
                        `inset-0`) e pinta o elemento de preto 60% com
                        `blur(8px)` e `!important` — era isso que escurecia e
                        desfocava o CRM inteiro atrás do menu. O seletor exige
                        `div`, então o botão passa incólume, e de quebra o
                        fechar-ao-tocar-fora vira alcançável pelo teclado. */}
                    {gifOpen && (
                      <button type="button" aria-label="Fechar seletor de GIF"
                        className="fixed inset-0 z-20 cursor-default bg-transparent"
                        onClick={() => setGifOpen(false)} />
                    )}
                    {/* `onPick` não espera nada: o download do arquivo mora
                        dentro de `sendGif`, DEPOIS de a bolha já estar na tela.
                        Baixar antes era o que fazia o seletor fechar e a
                        conversa ficar parada por segundos. */}
                    {gifOpen && (
                      <GifPicker onClose={() => setGifOpen(false)}
                        onPick={item => { setGifOpen(false); void sendGif(item); }} />
                    )}
                    {/* Biblioteca de mídias: o vídeo/áudio/PDF que sai todo dia,
                        cadastrado uma vez. Mesmo pega-cliques do seletor de GIF
                        (ver o comentário acima sobre `button` e não `div`). */}
                    {mediaLibOpen && (
                      <button type="button" aria-label="Fechar biblioteca de mídias"
                        className="fixed inset-0 z-20 cursor-default bg-transparent"
                        onClick={() => setMediaLibOpen(false)} />
                    )}
                    {mediaLibOpen && (
                      <MediaLibraryPicker embedded={embedded}
                        onClose={() => setMediaLibOpen(false)}
                        onPick={item => { setMediaLibOpen(false); enviarMidiaSalva(item); }} />
                    )}
                    {attachMenuOpen && (
                      <button type="button" aria-label="Fechar menu de anexos"
                        className="fixed inset-0 z-20 cursor-default bg-transparent"
                        onClick={() => setAttachMenuOpen(false)} />
                    )}
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
                            {/* Mídias cadastradas: o mesmo vídeo de sempre sai
                                sem procurar arquivo no computador nem esperar
                                upload — o arquivo já está no servidor. */}
                            <button className={row} onClick={run(() => setMediaLibOpen(true))}><span className={`${dot} bg-amber-100 text-amber-700`}><FolderOpen size={17} /></span> Mídia salva</button>
                            {/* Contato salvo = a agenda dos clientes, enviada
                                como CARTÃO e não como número no meio de uma
                                frase: quem recebe salva com um toque, em vez de
                                copiar dígito por dígito. É AQUI que mandar um
                                contato mora — junto de imagem, documento e GIF
                                —, e não pendurado num cartão recebido. */}
                            <button className={row} onClick={run(() => setSendContactOpen(true))}><span className={`${dot} bg-amber-100 text-amber-700`}><UserRound size={17} /></span> Contato salvo</button>
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
                {/* Emojis. Fora do menu "+" de propósito — e valendo também na
                    EDIÇÃO, onde o menu de anexos não existe: quem está
                    corrigindo a mensagem é justamente quem quer acrescentar o
                    emoji que faltou. O painel fica aberto depois da escolha,
                    porque quase nunca se manda um só. */}
                {emojiOpen && (
                  <button type="button" aria-label="Fechar seletor de emojis"
                    className="fixed inset-0 z-20 cursor-default bg-transparent"
                    onClick={() => setEmojiOpen(false)} />
                )}
                {emojiOpen && (
                  <EmojiPicker className="absolute left-2.5 sm:left-3 bottom-full mb-2 z-30 w-[320px] max-w-[calc(100%-1.25rem)]"
                    onPick={inserirEmoji}
                    onClose={() => setEmojiOpen(false)} />
                )}
                <div className="flex items-end gap-2">
                  {!editing && (
                    <button onClick={() => setAttachMenuOpen(o => !o)} title="Anexos e ações" aria-haspopup="menu" aria-expanded={attachMenuOpen}
                      className="flex-shrink-0 w-10 h-10 rounded-full text-[#54656f] flex items-center justify-center hover:bg-black/[0.06] transition">
                      <Plus size={22} className={`transition-transform duration-200 ${attachMenuOpen ? 'rotate-45' : ''}`} />
                    </button>
                  )}
                  <button onClick={() => { setEmojiOpen(o => !o); setAttachMenuOpen(false); }}
                    title="Emojis" aria-label="Emojis" aria-expanded={emojiOpen}
                    className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition hover:bg-black/[0.06] ${
                      emojiOpen ? (embedded ? 'text-[#f27a23]' : 'text-[#00a884]') : 'text-[#54656f]'}`}>
                    <Smile size={21} />
                  </button>
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
                    <textarea ref={draftRef} defaultValue={draft} onChange={handleDraftChange}
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
                      className={`flex-shrink-0 w-10 h-10 rounded-full ${btnEnviarCor} text-white flex items-center justify-center hover:scale-105 disabled:opacity-40 transition active:scale-90 ${sending ? '' : embedded ? 'wa-send-ready wa-send-ready-casa' : 'wa-send-ready'}`}>
                      {sending ? <Loader2 size={16} className="animate-spin" /> : editing ? <Check size={18} /> : <Send size={16} />}
                    </button>
                  ) : (
                    <button title="Gravar áudio" onClick={startRecording}
                      className={`flex-shrink-0 w-10 h-10 rounded-full text-[#54656f] flex items-center justify-center hover:bg-black/[0.06] ${embedded ? 'hover:text-[#f27a23]' : 'hover:text-[#00a884]'} transition active:scale-90`}>
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
            onTransfer={openTransfer}
            onTemplates={() => setTemplateOpen(true)}
            onTimeline={() => setTimelineOpen(true)}
            onSummary={selected.client_id ? () => setSummaryOpen(true) : undefined}
            onExport={messages.length > 0 ? handleExportConversation : undefined}
            onBlock={perms.canBlock ? openBlockConversation : undefined}
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

          {/* Limpar a conversa (apaga as mensagens; a conversa continua).
              Desceu da barra do cabeçalho para cá, logo abaixo do arquivo: é
              destrutiva e sem volta, e ficar a um pixel de "Encerrar" fazia dela
              um clique de rotina. Aqui, o passo anterior na coluna é justamente
              baixar tudo — a ordem sugere o backup antes do apagar. */}
          {perms.canBlock && messages.length > 0 && (
            <div className="space-y-1.5">
              <button
                onClick={handleClearConversation}
                title="Apaga as mensagens desta conversa para o escritório. A conversa e o contato continuam."
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#f3f2ef] py-2 text-[11.5px] font-semibold text-slate-600 transition hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={13} />
                Limpar conversa
              </button>
              <p className="px-0.5 text-[10px] leading-snug text-slate-400">
                Apaga o histórico de mensagens. Não tem volta — baixe o arquivo antes.
              </p>
            </div>
          )}

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
            podeControlar={acoes.controlarIa}
            versao={iaVersao}
            onMudou={iaMudou}
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
                { label: 'Pedir doc.', icon: <FilePlus size={15} />, motivo: 'pedir documentos', on: openDocumentRequest },
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
          {/* O acervo do cliente no Nextcloud, numa janela que não tira a
              conversa da tela. O "Documentos no Cloud" acima continua de pé até
              haver decisão sobre o Cloud interno. */}
          {selected.client_id && <ClientNextcloudDocsLink clientId={selected.client_id} onOpen={() => abrirNextcloud()} />}
          {selected.client_id && <ClientFillLinksPanel links={overview?.templateFillLinks ?? null} signatures={overview?.signatures ?? null} onStopTracking={stopTemplateFillTracking} />}
          {/* Assinaturas aparecem MESMO sem cliente vinculado: sem cadastro, elas
              vêm pelo telefone do contato (ver `listSignaturesByContactPhone`).
              Documento enviado para assinar é acompanhamento de atendimento, não
              privilégio de quem já virou cadastro. */}
          <ClientSignaturesPanel signatures={overview?.signatures ?? null} links={overview?.templateFillLinks ?? null} onStopTracking={stopTemplateFillTracking} onStopSignatureTracking={stopSignatureTracking} />
          {/* O que já foi assinado, pronto para baixar. Fica logo abaixo das
              pendentes e some no mesmo gesto que apaga a faixa do topo. */}
          <ClientSignedDocsPanel signatures={overview?.signatures ?? null} onStopSignatureTracking={stopSignatureTracking} />

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
            {/* Encerramento por inatividade: tira SÓ esta conversa da regra do canal.
                Só aparece onde a regra existe — num canal com o encerramento
                desligado, o botão prometeria desligar algo que já está desligado. */}
            {selectedChannel?.auto_close_enabled && (
              <>
                <button onClick={handleToggleAutoCloseSuppressed}
                  className={`w-full flex items-center justify-center gap-1 py-1.5 rounded-md text-[10.5px] font-semibold transition ${
                    selected.auto_close_suppressed
                      ? 'bg-sky-100 text-sky-800 border border-sky-300'
                      : 'bg-[#f3f2ef] text-slate-500 hover:bg-sky-50 hover:text-sky-700'
                  }`}>
                  {selected.auto_close_suppressed ? <TimerOff size={12} /> : <Timer size={12} />}
                  {selected.auto_close_suppressed ? 'Sem encerrar sozinha' : 'Não encerrar por inatividade'}
                </button>
                {/* O contador, e não a regra: "encerra depois de 4 horas" é o
                    que o canal promete; o atendente precisa saber quanto falta
                    NESTA conversa, e há quanto tempo ela está parada — que é o
                    relógio que decide. */}
                <p className={`text-[10px] px-0.5 ${autoCloseInfo.key !== 'off' && autoCloseInfo.key !== 'suppressed' && autoCloseInfo.key !== 'waiting_us' && autoCloseInfo.urgent ? 'text-amber-700 font-semibold' : 'text-slate-400'}`}>
                  {autoCloseInfo.key === 'suppressed'
                    ? 'Esta conversa fica de fora do encerramento automático até o atendimento ser encerrado.'
                    : autoCloseInfo.key === 'waiting_us'
                      ? `A contagem está parada: a resposta é nossa. O prazo de ${autoCloseLabel(selectedChannel.auto_close_minutes)} só começa a correr depois que respondermos.`
                      : autoCloseInfo.key === 'off'
                        ? `O canal encerra sozinho depois de ${autoCloseLabel(selectedChannel.auto_close_minutes)} sem nenhuma mensagem.`
                        : `${autoCloseInfo.label[0].toUpperCase()}${autoCloseInfo.label.slice(1)} — parada há ${autoCloseIdleLabel(autoCloseInfo.idleMinutes)}. Qualquer mensagem reinicia a contagem.`}
                </p>
              </>
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
            initialChannelMembers={channelMembers.length ? channelMembers : undefined}
            initialDepartmentMembers={Object.keys(departmentMembers).length ? departmentMembers : undefined}
            moduleConfig={moduleConfig}
            requirePin={requirePin}
            /* A memória de aba tem de andar junto: quem edita um canal aqui
               atualiza a tela na hora, e se a lista guardada continuasse a
               antiga, a próxima abertura do widget pintaria com ela por um
               instante — a edição "voltando atrás" na frente de quem a fez. */
            onChannelsChange={next => {
              setChannels(next);
              guardaNaMemoriaWa(user?.id, 'channels', next);
              void reloadFunnelLabels();
            }}
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
        onOpenNextcloudFolder={abrirNextcloud}
      />

      {/* Janela flutuante de arquivos do cliente — fica por cima, mas nunca
          bloqueia: a conversa continua clicável atrás dela. */}
      {nextcloudWindow && (
        <NextcloudClientWindow
          clientId={nextcloudWindow.clientId}
          clientName={nextcloudWindow.clientName}
          initialPath={nextcloudWindow.path}
          onClose={() => setNextcloudWindow(null)}
          onSendToConversation={selected ? handleDroppedFiles : undefined}
        />
      )}

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

      {/* Número de um cartão de contato recebido → cadastro de um cliente.
          O picker é o MESMO do vínculo da conversa, e é ele que já avisa quando
          o número pertence a outra ficha antes de mexer em qualquer coisa. */}
      {contactLinkTarget && (
        <ClientPickerModal
          phone={contactLinkTarget.phone}
          onClose={() => { if (!contactLinking) setContactLinkTarget(null); }}
          onPick={cliente => {
            const alvo = contactLinkTarget;
            if (!alvo) return;
            setContactLinking(true);
            void whatsappService.addPhoneToClient(cliente.id, alvo.phone)
              .then(({ added, field, replaced }) => {
                const campo = field === 'mobile' ? 'Celular' : 'Telefone';
                if (added && replaced) {
                  toast.success(`${campo} de ${cliente.full_name} atualizado.`,
                    `${prettyPhone(replaced)} foi substituído e está no histórico da ficha.`);
                } else if (added) {
                  toast.success(`${prettyPhone(alvo.phone)} entrou no cadastro de ${cliente.full_name}.`,
                    `Campo ${campo}.`);
                } else {
                  toast.info(`${cliente.full_name} já tinha este número.`);
                }
                setContactLinkTarget(null);
                // A ficha mudou: a lista relê nome/vínculo das conversas.
                loadConversations();
              })
              .catch((e: any) => toast.error('Falha ao vincular o número', e?.message))
              .finally(() => setContactLinking(false));
          }}
        />
      )}

      {/* Enviar um contato da agenda como cartão (vCard). */}
      {sendContactOpen && selected && (
        <SendContactModal
          conversationId={selected.id}
          targetName={conversationName(selected)}
          onClose={() => setSendContactOpen(false)}
          onSent={() => { toast.success('Contato enviado.'); void refreshMessages(selected.id); }}
          onError={message => toast.error('Contato não enviado', message)}
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
