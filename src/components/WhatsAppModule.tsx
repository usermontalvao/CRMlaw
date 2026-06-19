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
} from 'lucide-react';
import { isNotifySoundMuted, setNotifySoundMuted, playNotificationSound } from '../utils/notificationSound';
import { isStaffPushSupported, isStaffPushEnabled, enableStaffPush, disableStaffPush } from '../utils/staffPush';
import { muteStore } from '../services/whatsapp/muteStore';
import { whatsappService, normalizePhone, renderTemplate, agentPermissions, summarizeOverview, type StaffOption, type AgentPrefs, type ScheduleDeadline, type ClientDocRequest, type ClientOverview, type ClientSchedule, type ClientPendings, type WhatsAppInternalNote, type ClientTrackedSignatureStatus } from '../services/whatsapp.service';
import type { WhatsAppTemplate, WhatsAppScheduledMessage } from '../types/whatsapp.types';
import {
  formatTime, initials, prettyPhone, formatBytes, dayLabel, lastSeenLabel, presenceInfo,
  typeLabel, conversationPreviewLabel, firstName, agentLabel, greetingByHour, buildGreeting,
  buildAcceptPresentation, convStatus, slaSignal, slaInternalSignal, abandonedSignal, transferAlert,
  maskSensitive, maskName, maskPhoneFull, fmtAudioTime, prettyDoc, dueInfo, fmtDateTime,
  fmtNoteDate,
} from './whatsapp/format';
import {
  WaDialog, WaDialogBody, waInput, waLabel, waBtnPrimary, waBtnGhost, waBtnDanger,
} from './whatsapp/ui';
import { TransferModal, BlockContactModal, CloseConversationModal } from './whatsapp/conversationModals';
import { TemplatePickerModal, ScheduleMessageModal } from './whatsapp/messageModals';
import { ConversationSummaryModal, ConversationTimelineModal } from './whatsapp/infoModals';
import { RequestDocumentModal } from './whatsapp/RequestDocumentModal';
import { ClientPickerModal, NewConversationModal } from './whatsapp/clientPickerModals';
import { CreateDeadlineFromMessageModal, CreateTaskFromMessageModal } from './whatsapp/createFromMessageModals';
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
import { aiService } from '../services/ai.service';
import { signatureService } from '../services/signature.service';
import { type WaModal, WaWorkspaceRenderer } from './WaWorkspace';
import { ClientCloudDocsLink } from './CloudFolderModal';
import { Modal, ModalBody } from './ui/Modal';
import { documentTemplateService } from '../services/documentTemplate.service';
import { templateFillPermalinkService } from '../services/templateFillPermalink.service';
import { buildPublicFillUrl } from '../utils/publicAppUrl';
import type { DocumentTemplate } from '../types/document.types';

/**
 * `true` quando a viewport é estreita demais para mostrar lista + thread lado a
 * lado (abaixo do breakpoint `md` do Tailwind = 768px). Usado para alternar o
 * módulo para um painel por vez em celulares.
 */
function useWaMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, [query]);
  return matches;
}
/** Estreito demais para lista + thread lado a lado (abaixo do `md` = 768px). */
function useWaIsMobile() { return useWaMediaQuery('(max-width: 767px)'); }
/** Largo o bastante para encaixar o painel do contato fixo (a partir do `xl` = 1280px). */
function useWaIsPanelDocked() { return useWaMediaQuery('(min-width: 1280px)'); }

/** Retorna dia da semana e minutos desde meia-noite no timezone IANA informado. */
function getCurrentTimeInTz(timezone: string): { dow: number; curMins: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = parts.find(p => p.type === 'weekday')?.value ?? '';
    const hour = +(parts.find(p => p.type === 'hour')?.value ?? '0') % 24;
    const minute = +(parts.find(p => p.type === 'minute')?.value ?? '0');
    return { dow: dayMap[weekday] ?? new Date().getDay(), curMins: hour * 60 + minute };
  } catch {
    const now = new Date();
    return { dow: now.getDay(), curMins: now.getHours() * 60 + now.getMinutes() };
  }
}

type FilterTab = 'all' | 'unread' | 'mine';

// Fase M: etiquetas pré-definidas para escritório jurídico
export const WA_LABELS: { key: string; color: string; bg: string }[] = [
  { key: 'Urgente',             color: '#dc2626', bg: '#fee2e2' },
  { key: 'Aguardando doc.',     color: '#d97706', bg: '#fef3c7' },
  { key: 'Proposta enviada',    color: '#2563eb', bg: '#dbeafe' },
  { key: 'Audiência próxima',   color: '#7c3aed', bg: '#ede9fe' },
  { key: 'Pagamento pendente',  color: '#ea580c', bg: '#ffedd5' },
  { key: 'Novo cliente',        color: '#059669', bg: '#d1fae5' },
  { key: 'Em negociação',       color: '#0891b2', bg: '#cffafe' },
];

// ── Confirmação leve (sem PIN) para ações reversíveis do módulo ──
// O app reserva o fluxo com PIN (useDeleteConfirm) para exclusões críticas;
// aqui usamos um confirm simples para "devolver à fila", "cancelar", etc.
type ConfirmOpts = { message: string; title?: string; confirmLabel?: string; tone?: 'danger' | 'default' };
type ConfirmFn = (opts: ConfirmOpts) => Promise<boolean>;

function useConfirm(): { confirm: ConfirmFn; pending: (ConfirmOpts & { resolve: (v: boolean) => void }) | null; resolve: (v: boolean) => void } {
  const [pending, setPending] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback<ConfirmFn>((opts) => new Promise<boolean>(res => setPending({ ...opts, resolve: res })), []);
  const resolve = useCallback((v: boolean) => setPending(p => { p?.resolve(v); return null; }), []);
  return { confirm, pending, resolve };
}

// ── Shell de diálogo estilo WhatsApp (Fase Q: padronização visual) ──
// Header em teal (#008069), card arredondado, overlay com blur, ESC/clique-fora
// fecham, trava o scroll do body e entra com micro-animação. Todos os modais do
// módulo usam este shell para parecer uma aplicação profissional e consistente.
// Alturas-base (scaleY) das barras do equalizador de gravação — perfil de onda
// estático que a animação waEq faz "respirar"; dá o visual de áudio do WhatsApp.
const WA_REC_BARS = [0.35, 0.6, 0.9, 0.5, 0.75, 1, 0.45, 0.7, 0.55, 0.85, 0.4, 0.65, 0.95, 0.5, 0.8, 0.6, 0.45, 0.9, 0.55, 0.7, 0.5, 0.85, 0.4, 0.6];

const ClientFillLinksPanel: React.FC<{
  links: import('../services/whatsapp/shared').ClientTemplateFillLink[] | null;
  signatures: import('../types/signature.types').SignatureRequestWithSigners[] | null;
  onStopTracking?: (linkId: string) => void;
}> = ({ links, signatures, onStopTracking }) => {
  const toast = useToastContext();
  const list = (links ?? []).filter((l) => {
    if (l.followup_stopped || l.status === 'cancelled' || l.status === 'expired') return false;
    const req = (signatures ?? []).find(s => s.id === l.signature_request_id);
    if (!req) return true;
    if (req.status === 'signed' || req.status === 'refused' || req.signed_at) return false;
    if ((req.signers ?? []).some(sg => !!sg.signed_at || !!sg.refused_at)) return false;
    return true;
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  if (list.length === 0) return null;

  const copyText = async (key: string, label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast.success(label);
      setTimeout(() => setCopiedKey(curr => (curr === key ? null : curr)), 1800);
    } catch (e: any) {
      toast.error('Não foi possível copiar o link', e?.message);
    }
  };

  const now = Date.now();

  return (
    <div className="space-y-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
        <FileText size={10} /> Acompanhamento do kit
        <span className="ml-auto px-1.5 py-px rounded-full bg-sky-100 text-sky-700 text-[9px] font-bold">{list.length}</span>
      </p>
      <div className="rounded-xl border border-[#e7e5df] divide-y divide-[#f1f0ec] overflow-hidden">
        {list.map((link) => {
          const req = (signatures ?? []).find(s => s.id === link.signature_request_id) ?? null;
          const signer = req?.signers?.find(sg => sg.status !== 'signed' && !sg.refused_at) ?? req?.signers?.[0] ?? null;
          const fillUrl = buildPublicFillUrl(link.public_token);
          const signUrl = signer?.public_token ? signatureService.generatePublicSigningUrl(signer.public_token) : null;
          const activeOnPage = !!link.last_seen_at && (now - new Date(link.last_seen_at).getTime() <= 30_000);

          let stageLabel = 'Link enviado';
          let stageTone = 'bg-slate-100 text-slate-600';
          let stageDetail = `Enviado ${formatTime(link.created_at)}`;
          let stageIcon: 'check' | 'eye' | 'x' | 'clock' = 'clock';

          if (signer?.signed_at || req?.status === 'signed') {
            stageLabel = 'Assinado';
            stageTone = 'bg-emerald-100 text-emerald-700';
            stageDetail = `Assinado ${formatTime(signer?.signed_at || req?.signed_at || link.submitted_at || link.created_at)}`;
            stageIcon = 'check';
          } else if (signer?.refused_at || req?.status === 'refused') {
            stageLabel = 'Recusado';
            stageTone = 'bg-rose-100 text-rose-700';
            stageDetail = `Recusado ${formatTime(signer?.refused_at || link.submitted_at || link.created_at)}`;
            stageIcon = 'x';
          } else if (signer?.last_seen_at && (now - new Date(signer.last_seen_at).getTime() <= 30_000)) {
            stageLabel = 'Página de assinatura aberta';
            stageTone = 'bg-sky-100 text-sky-700';
            stageDetail = 'Está na tela de assinatura agora';
            stageIcon = 'eye';
          } else if (signer?.viewed_at || signer?.opened_at) {
            stageLabel = 'Saiu sem assinar';
            stageTone = 'bg-orange-100 text-orange-700';
            stageDetail = `Abriu e saiu sem assinar — ${lastSeenLabel(signer.last_seen_at || signer.opened_at || signer.viewed_at || link.created_at)}`;
            stageIcon = 'eye';
          } else if (link.submitted_at || req) {
            stageLabel = 'Preenchido';
            stageTone = 'bg-amber-100 text-amber-700';
            stageDetail = `Preencheu e foi para assinatura ${formatTime(link.submitted_at || req?.created_at || link.created_at)}`;
            stageIcon = 'clock';
          } else if (activeOnPage) {
            stageLabel = 'Na tela agora';
            stageTone = 'bg-violet-100 text-violet-700';
            stageDetail = 'Ativo no formulário agora';
            stageIcon = 'eye';
          } else if (link.last_seen_at) {
            // Já saiu da tela — mostra "visto por último" em vez de travar em "aberta".
            stageLabel = 'Saiu da página';
            stageTone = 'bg-blue-100 text-blue-700';
            stageDetail = `Abriu o formulário ${formatTime(link.opened_at || link.last_seen_at)} — ${lastSeenLabel(link.last_seen_at)}`;
            stageIcon = 'eye';
          } else if (link.opened_at) {
            stageLabel = 'Página aberta';
            stageTone = 'bg-blue-100 text-blue-700';
            stageDetail = `Abriu o formulário ${formatTime(link.opened_at)}`;
            stageIcon = 'eye';
          }

          return (
            <div key={link.id} className="px-3 py-2.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-slate-800 truncate">{link.template_name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{stageDetail}</p>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-px rounded text-[9.5px] font-semibold ${stageTone}`}>
                    {stageIcon === 'check' ? <CheckCircle size={9} /> : stageIcon === 'eye' ? <Eye size={9} /> : stageIcon === 'x' ? <X size={9} /> : <Clock size={9} />}
                    {stageLabel}
                  </span>
                  {onStopTracking && (
                    <button
                      onClick={() => onStopTracking(link.id)}
                      title="Parar de acompanhar"
                      className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-600 hover:text-white transition"
                    >
                      <X size={11} strokeWidth={2.75} />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] text-slate-400 w-14 flex-shrink-0">Preencher</span>
                  <input readOnly value={fillUrl} className="flex-1 min-w-0 px-2 py-1 rounded-md border border-[#e7e5df] bg-slate-50 text-[10.5px] text-slate-500" />
                  <button
                    onClick={() => copyText(`fill:${link.id}`, 'Link de preenchimento copiado.', fillUrl)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 transition"
                  >
                    {copiedKey === `fill:${link.id}` ? <Check size={11} /> : <Link2 size={11} />}
                    {copiedKey === `fill:${link.id}` ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                {signUrl && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10.5px] text-slate-400 w-14 flex-shrink-0">Assinar</span>
                    <input readOnly value={signUrl} className="flex-1 min-w-0 px-2 py-1 rounded-md border border-[#e7e5df] bg-amber-50 text-[10.5px] text-amber-700" />
                    <button
                      onClick={() => copyText(`sign:${link.id}`, 'Link de assinatura copiado.', signUrl)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 transition"
                    >
                      {copiedKey === `sign:${link.id}` ? <Check size={11} /> : <Link2 size={11} />}
                      {copiedKey === `sign:${link.id}` ? 'Copiado' : 'Reenviar'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ConfirmDialog: React.FC<{ opts: ConfirmOpts; onResolve: (v: boolean) => void }> = ({ opts, onResolve }) => {
  const danger = opts.tone === 'danger';
  return (
    <WaDialog
      title={opts.title || 'Confirmar'}
      onClose={() => onResolve(false)}
      size="sm"
      zIndex={60}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => onResolve(false)} className={waBtnGhost}>Cancelar</button>
          <button onClick={() => onResolve(true)} className={danger ? waBtnDanger : waBtnPrimary}>
            {opts.confirmLabel || 'Confirmar'}
          </button>
        </div>
      }
    >
      <WaDialogBody>
        <p className="text-[13.5px] text-slate-600 leading-snug">{opts.message}</p>
      </WaDialogBody>
    </WaDialog>
  );
};

/**
 * Linha de presença do cabeçalho (online/digitando/visto por último). Possui o
 * próprio tick de 15s para reavaliar o tempo relativo — assim o relógio vive
 * neste componente isolado em vez de re-renderizar o módulo inteiro a cada 15s.
 */
const PresenceText: React.FC<{
  conv: { presence: WhatsAppPresence; presence_updated_at: string | null; last_seen_at: string | null; contact_phone: string };
  privateMode: boolean;
}> = React.memo(({ conv, privateMode }) => {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick(t => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const pr = presenceInfo(conv);
  if (!pr) return <span>{privateMode ? maskPhoneFull() : prettyPhone(conv.contact_phone)}</span>;
  if (!pr.live) return <span className="text-slate-500">{pr.text}</span>;
  // "digitando…/gravando…" ganha os três pontinhos animados; "online" mantém o
  // ponto verde fixo.
  const isTyping = pr.text !== 'online';
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-green-600">
      {isTyping
        ? <span className="wa-typing" aria-hidden="true"><span /><span /><span /></span>
        : <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
      {pr.text}
    </span>
  );
});
PresenceText.displayName = 'PresenceText';

const DateDivider: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex justify-center my-2.5">
    <span className="px-3 py-1 rounded-full bg-white/90 text-slate-500 text-[11px] font-semibold shadow-sm">{label}</span>
  </div>
);

// Avatar real do contato com fallback para iniciais (foto ausente ou URL expirada).
const Avatar: React.FC<{ url: string | null; name: string | null; phone: string; size: number; onClick?: () => void }> = ({ url, name, phone, size, onClick }) => {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [url]);
  const show = !!url && !broken;
  const clickable = show && !!onClick;
  return (
    <div onClick={clickable ? onClick : undefined} title={clickable ? 'Ver foto' : undefined}
      className={`rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold overflow-hidden${clickable ? ' cursor-pointer hover:ring-2 hover:ring-amber-300 transition' : ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>
      {show
        ? <img src={url!} alt={name || phone} onError={() => setBroken(true)} className="w-full h-full object-cover" />
        : initials(name, phone)}
    </div>
  );
};

// Item da lista de conversas (memoizado). Os sinais de SLA/transferência/abandono
// são funções puras de `c`, então o item os calcula sozinho; só `status`/`docStatus`
// (que dependem de estado do módulo) chegam prontos como primitivos. Com props
// estáveis, o React.memo só re-renderiza a linha cuja conversa de fato mudou —
// não a lista inteira a cada evento de realtime.
const ConversationListItem: React.FC<{
  c: WhatsAppConversation;
  active: boolean;
  channel: WhatsAppChannel | null;
  dept: WhatsAppDepartment | null;
  privateMode: boolean;
  statusKey: string;
  statusLabel: string;
  statusCls: string;
  docStatus: 'awaiting' | 'ready' | null;
  muted: boolean;
  draftPreview: string;
  onSelect: (id: string) => void;
}> = React.memo(({ c, active, channel: ch, dept, privateMode, statusKey, statusLabel, statusCls, docStatus: ds, muted, draftPreview, onSelect }) => {
  const sla = slaSignal(c);
  const slaInt = slaInternalSignal(c);
  const ta = transferAlert(c);
  const ab = abandonedSignal(c);
  const urgentBorder = sla?.color === '#dc2626' ? 'border-l-[3px] border-l-red-400'
    : sla?.color === '#d97706' ? 'border-l-[3px] border-l-amber-400'
    : slaInt?.color === '#dc2626' ? 'border-l-[3px] border-l-red-400'
    : slaInt?.color === '#d97706' ? 'border-l-[3px] border-l-amber-400'
    : '';
  return (
    <button onClick={() => onSelect(c.id)}
      className={`wa-conv w-full flex items-center gap-3 px-4 py-3 text-left border-b border-[#f1f0ec] transition ${urgentBorder} ${active ? 'wa-conv-active bg-amber-50' : 'hover:bg-[#f9f8f6]'} ${c.is_blocked ? 'opacity-60' : ''}`}>
      <div className="relative flex-shrink-0">
        <Avatar url={c.contact_avatar_url} name={c.contact_name} phone={c.contact_phone} size={40} />
        {ch && <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white" style={{ background: ch.color || '#ea6c00' }} title={ch.name || ch.instance_name} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13.5px] font-semibold text-slate-800 truncate flex items-center gap-1">
            {c.is_blocked && <Ban size={12} className="text-red-500 flex-shrink-0" />}
            <span className="truncate">{privateMode ? maskName(c.contact_name) : (c.contact_name || prettyPhone(c.contact_phone))}</span>
          </span>
          <span className="flex items-center gap-1 flex-shrink-0">
            {muted && <BellOff size={11} className="text-slate-400 flex-shrink-0" />}
            {sla
              ? <span className="inline-flex items-center gap-0.5 text-[9.5px] font-bold" style={{ color: sla.color }}>
                  <Clock size={9} />{sla.label}
                </span>
              : <span className="text-[10.5px] text-slate-400">{formatTime(c.last_message_at)}</span>}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          {draftPreview ? (
            <span className="flex items-center gap-1 min-w-0 text-[12px] truncate">
              <Pencil size={11} className="flex-shrink-0 text-amber-600" />
              <span className="flex-shrink-0 font-semibold text-amber-600">Rascunho:</span>
              <span className="truncate text-slate-500">{privateMode ? '••••••••' : draftPreview}</span>
            </span>
          ) : (
            <span className="text-[12px] text-slate-500 truncate">
              {c.last_message_direction === 'out' ? 'Você: ' : ''}{privateMode ? '••••••••' : (c.last_message_preview || '—')}
            </span>
          )}
          {!c.is_blocked && c.unread_count > 0 && (
            <span className="wa-badge-pop wa-badge-glow flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-600 text-white text-[10px] font-bold flex items-center justify-center">{c.unread_count}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold ${statusCls}`}>
            {statusKey === 'blocked' && <Ban size={9} />}{statusLabel}
          </span>
          {ds && (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold ${ds === 'awaiting' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
              <FileText size={9} /> {ds === 'awaiting' ? 'Aguardando docs' : 'Docs prontos'}
            </span>
          )}
          {dept && (
            <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] font-semibold" style={{ background: (dept.color || '#16a34a') + '22', color: dept.color || '#16a34a' }}>
              {dept.name}
            </span>
          )}
          {slaInt && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold"
              style={{ background: slaInt.color + '22', color: slaInt.color }}>
              <Clock size={9} /> {slaInt.label}
            </span>
          )}
          {!c.is_blocked && c.status !== 'closed' && !c.assigned_user_id && !c.awaiting_accept && !c.department_id && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-slate-100 text-slate-500">
              <UserPlus size={9} /> Na fila
            </span>
          )}
          {ta && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold"
              style={{ background: ta.color + '22', color: ta.color }}>
              <ArrowRightLeft size={9} /> {ta.label}
            </span>
          )}
          {ab && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold"
              style={{ background: '#7c3aed22', color: '#7c3aed' }}>
              <Clock size={9} /> {ab.label}
            </span>
          )}
          {(c.labels ?? []).slice(0, 2).map(lbl => {
            const meta = WA_LABELS.find(x => x.key === lbl);
            return meta ? (
              <span key={lbl} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold"
                style={{ background: meta.bg, color: meta.color }}>
                <Tag size={8} />{lbl}
              </span>
            ) : null;
          })}
        </div>
      </div>
    </button>
  );
});
ConversationListItem.displayName = 'ConversationListItem';

const MSG_PAGE = 60; // mensagens por bloco de paginação

type SlashKitItem = {
  kind: 'kit';
  id: string;
  name: string;
  description: string | undefined;
  slug: string;
};

type SlashResultItem =
  | { kind: 'template'; id: string; name: string; description?: string; body: string; template: WhatsAppTemplate }
  | SlashKitItem;

interface WhatsAppModuleProps {
  /** Deep-link: conversa a abrir ao entrar no módulo (ex.: clique na notificação). */
  openConversationId?: string;
  /** Avisa o App para limpar o param de navegação após consumi-lo. */
  onParamConsumed?: () => void;
}

const WhatsAppModule: React.FC<WhatsAppModuleProps> = ({ openConversationId, onParamConsumed }) => {
  const { user } = useAuth();
  const toast = useToastContext();
  const { navigateTo } = useNavigation();
  const { confirm, pending: confirmPending, resolve: resolveConfirm } = useConfirm();
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [pending, setPending] = useState<WhatsAppMessage[]>([]);
  // Descritores para "tentar de novo": guardam o necessário para reenviar uma
  // mensagem que falhou (texto, ou mídia com o File original). Limpos no sucesso.
  const retryRef = useRef<Map<string, { kind: 'text'; text: string; replyId?: string }
    | { kind: 'media'; file: File; mediaKind: 'image' | 'video' | 'audio' | 'document'; caption: string; replyId?: string }>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Responsividade: abaixo de `md` (768px) a lista e a thread não cabem lado a
  // lado, então alternamos para um painel por vez (estilo WhatsApp mobile).
  const isMobile = useWaIsMobile();
  // Abaixo do `xl` o painel do contato não cabe fixo: vira gaveta sobreposta.
  const panelDocked = useWaIsPanelDocked();
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  // Menu "⋮" do cabeçalho da thread (agrupa as ações em telas estreitas).
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  // Menu "+" do composer (documento, modelo, agendar) — mantém a barra enxuta.
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // Menu do sino: unifica som das notificações + push do navegador num só ícone.
  const [notifyMenuOpen, setNotifyMenuOpen] = useState(false);
  const notifyBtnRef = useRef<HTMLButtonElement>(null);
  // Web Push do staff: avisa o atendente mesmo com o navegador fechado.
  const [pushState, setPushState] = useState<'unknown' | 'unsupported' | 'off' | 'on' | 'busy'>('unknown');
  useEffect(() => {
    if (!isStaffPushSupported()) { setPushState('unsupported'); return; }
    isStaffPushEnabled().then(on => setPushState(on ? 'on' : 'off')).catch(() => setPushState('off'));
  }, []);
  const toggleStaffPush = useCallback(async () => {
    const wasOn = await isStaffPushEnabled();
    setPushState('busy');
    if (wasOn) {
      await disableStaffPush();
      setPushState('off');
      toast.info('Notificações push desativadas');
      return;
    }
    const r = await enableStaffPush();
    if (r === 'enabled') {
      setPushState('on');
      toast.success('Notificações ativadas — você será avisado mesmo com o navegador fechado');
    } else {
      setPushState('off');
      if (r === 'denied') toast.error('Permissão de notificação negada no navegador');
      else if (r === 'unsupported') toast.error('Este navegador não suporta notificações push');
      else toast.error('Não foi possível ativar as notificações push');
    }
  }, [toast]);
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
    const v = localStorage.getItem('wa_filter');
    return v === 'all' || v === 'unread' || v === 'mine' ? v : 'mine';
  });
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  // Som das notificações (mensagem nova fora do módulo). Persistido em localStorage.
  const [soundMuted, setSoundMuted] = useState(() => isNotifySoundMuted());
  // Silenciamento por conversa (no banco, por usuário). Re-renderiza ao mudar o store.
  useSyncExternalStore(muteStore.subscribe, muteStore.getSnapshot);
  useEffect(() => { void muteStore.init(); }, []);
  const [muteMenuOpen, setMuteMenuOpen] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [hasMoreMsgs, setHasMoreMsgs] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const oldestTsRef = useRef<string | null>(null);
  // Mapa de progresso de upload (0-100) por tempId; alimentado por timer simulado.
  const [uploadProgress, setUploadProgress] = useState<Map<string, number>>(new Map());
  const cancelledUploads = useRef<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Fase H: ação jurídica a partir de mensagem
  const [deadlineSource, setDeadlineSource] = useState<WhatsAppMessage | null>(null);
  const [taskSource, setTaskSource] = useState<WhatsAppMessage | null>(null);
  // Fase I: integrações com outros módulos a partir da conversa
  const [docRequestOpen, setDocRequestOpen] = useState(false);
  // Fase M: filtro por etiqueta + resumo automático por IA
  const [labelFilter, setLabelFilter] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Fase J: sessão de IA da conversa selecionada
  const [aiSession, setAiSession] = useState<import('../types/whatsapp.types').WhatsAppAiSession | null>(null);
  // Fase K: sugestão de resposta e extração de dados
  const [suggesting, setSuggesting] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [extractedData, setExtractedData] = useState<Record<string, string> | null>(null);
  const [extracting, setExtracting] = useState(false);
  // Fase L: modo privado (mascaramento visual) e exportação
  const [privateMode, setPrivateMode] = useState(false);
  // Fase M: dashboard de atendimento
  const [showDashboard, setShowDashboard] = useState(false);
  // Fase N: aviso de fora do horário de atendimento
  const [outsideHours, setOutsideHours] = useState<{ message: string } | null>(null);
  // WhatsApp 360: workspace modal (abre entidades do CRM sem sair da conversa)
  const [workspace, setWorkspace] = useState<WaModal | null>(null);
  const openWa = useCallback((modal: WaModal) => setWorkspace(modal), []);
  const closeWa = useCallback(() => setWorkspace(null), []);
  const [transferOpen, setTransferOpen] = useState(false);
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Templates carregados uma vez para o atalho "/" no compositor (estilo WhatsApp).
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [kitTemplates, setKitTemplates] = useState<SlashKitItem[]>([]);
  const reloadTemplates = useCallback(() => {
    whatsappService.listTemplates({ activeOnly: true }).then(setTemplates).catch(() => {});
  }, []);
  useEffect(() => { reloadTemplates(); }, [reloadTemplates]);
  useEffect(() => {
    const isRequirementsMsTemplate = (template: DocumentTemplate) => {
      const norm = (value?: string) => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
      return norm(template.name).startsWith('MODELO MS (REQUERIMENTOS)') || norm(template.description).includes('[REQUERIMENTOS_MS]');
    };

    let alive = true;
    documentTemplateService.listTemplates()
      .then(async (allTemplates) => {
        const visibleTemplates = allTemplates.filter(t => !isRequirementsMsTemplate(t));
        const permalinkChecks = await Promise.all(
          visibleTemplates.map(async (template) => {
            try {
              const permalinks = await templateFillPermalinkService.listPermalinks(template.id);
              const active = permalinks.find((p: any) => p.is_active) ?? permalinks[0];
              if (!active?.slug) return null;
              return {
                kind: 'kit' as const,
                id: template.id,
                name: template.name,
                description: template.description,
                slug: active.slug,
              };
            } catch {
              return null;
            }
          }),
        );
        if (alive) setKitTemplates(permalinkChecks.filter((t): t is NonNullable<typeof t> => !!t));
      })
      .catch(() => { if (alive) setKitTemplates([]); });
    return () => { alive = false; };
  }, []);
  const [slashIndex, setSlashIndex] = useState(0); // item destacado no dropdown do "/"
  // Anexos selecionados aguardando preview/legenda antes do envio (Fase 0.1+).
  const [attachStaged, setAttachStaged] = useState<File[] | null>(null);
  // Fase 3: por padrão a lista mostra apenas conversas ativas (status "Abertas");
  // encerradas saem da fila e só aparecem no filtro próprio "Encerradas" — ou
  // quando o cliente volta a falar e a conversa é reaberta (status → open).
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'waiting_you' | 'waiting_internal' | 'reopened' | 'closed'>(() => {
    const v = localStorage.getItem('wa_status_filter');
    return v === 'all' || v === 'open' || v === 'waiting_you' || v === 'waiting_internal' || v === 'reopened' || v === 'closed' ? v : 'open';
  });
  const [replyTo, setReplyTo] = useState<WhatsAppMessage | null>(null);
  const [editing, setEditing] = useState<WhatsAppMessage | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Larguras das colunas com persistência local (Fase 10.1).
  const [panelWidth, setPanelWidth] = useState(() => {
    const v = Number(localStorage.getItem('wa_panel_w'));
    return v >= 260 && v <= 560 ? v : 300;
  });
  const [listWidth, setListWidth] = useState(() => {
    const v = Number(localStorage.getItem('wa_list_w'));
    return v >= 280 && v <= 520 ? v : 340;
  });
  useEffect(() => { localStorage.setItem('wa_panel_w', String(panelWidth)); }, [panelWidth]);
  useEffect(() => { localStorage.setItem('wa_list_w', String(listWidth)); }, [listWidth]);
  // Persistência local dos filtros da inbox (Fase 3/5): o escopo escolhido pelo
  // atendente sobrevive ao recarregar — sem reimpor o padrão a cada abertura.
  useEffect(() => { localStorage.setItem('wa_filter', filter); }, [filter]);
  useEffect(() => { localStorage.setItem('wa_status_filter', statusFilter); }, [statusFilter]);
  // Drag and drop de arquivos na thread (estilo WhatsApp Web). `dragDepth` conta
  // enter/leave para não piscar o overlay ao cruzar elementos filhos.
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  // Redimensiona o painel lateral arrastando a borda (entre 260 e 560px).
  const startPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent) => {
      // Painel fica à direita: arrastar p/ a esquerda aumenta a largura.
      setPanelWidth(Math.min(560, Math.max(260, startW + (startX - ev.clientX))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panelWidth]);

  // Divisória arrastável entre a lista de conversas e a thread (Fase 10.1).
  const startListResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = listWidth;
    const onMove = (ev: MouseEvent) => {
      // Lista fica à esquerda: arrastar p/ a direita aumenta a largura.
      setListWidth(Math.min(520, Math.max(280, startW + (ev.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [listWidth]);

  const threadRef = useRef<HTMLDivElement>(null);
  const threadContentRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

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
  const avatarTriedRef = useRef<Set<string>>(new Set());
  const atBottomRef = useRef(true);
  const lastConvRef = useRef<string | null>(null);
  // Marca se já fixamos a thread no fim para a conversa atual (após as mensagens
  // realmente carregarem). Evita "abrir no topo" quando o 1º paint vem vazio.
  const didInitialScrollRef = useRef(false);

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

  // Contexto para expandir variáveis dos modelos ({{cliente.nome}}, {{saudacao}}…).
  const templateCtx = useMemo(() => ({
    clientName: selected?.contact_name ?? null,
    clientPhone: selected ? prettyPhone(selected.contact_phone) : null,
    agentName: agentLabel(user ? staffById.get(user.id) : null),
    greeting: greetingByHour(),
  }), [selected, user, staffById]);

  // Atalho "/" do compositor (estilo WhatsApp): quando o texto é só "/algo" (sem
  // espaço), abre um menu de modelos filtrados pelo nome; selecionar insere o corpo.
  // Permite espaços na busca ("/kit tr" → continua filtrando) — só fecha o menu
  // se o usuário pular de linha (mensagem multilinha de verdade, não comando).
  const slashMatch = !editing ? /^\/([^\n]*)$/.exec(draft) : null;
  const slashQuery = slashMatch?.[1].toLowerCase() ?? '';
  const slashResults = slashMatch
    ? [
        ...templates.map((t) => ({
          kind: 'template' as const,
          id: t.id,
          name: t.name,
          description: t.category || undefined,
          body: t.body,
          template: t,
        })),
        ...kitTemplates,
      ].filter((item) => item.name.toLowerCase().includes(slashQuery)).slice(0, 6)
    : [];
  const slashActive = slashResults.length > 0;
  const slashIdx = Math.min(slashIndex, Math.max(0, slashResults.length - 1));
  // Trava anti-duplicação do mint de kit: o menu fica clicável durante o await
  // (mint ~200ms), então duplo-clique / clique+Enter geravam DOIS links. Ignora
  // chamada concorrente (inFlight) e repetição do mesmo kit dentro de 1,5s.
  const kitMintRef = useRef<{ inFlight: boolean; lastSlug: string; lastAt: number }>({ inFlight: false, lastSlug: '', lastAt: 0 });
  const applyTemplate = useCallback(async (item: SlashResultItem) => {
    if (item.kind === 'kit') {
      const guard = kitMintRef.current;
      const nowTs = Date.now();
      if (guard.inFlight) return;
      if (guard.lastSlug === item.slug && nowTs - guard.lastAt < 1500) return;
      guard.inFlight = true;
      try {
        const result = await templateFillPermalinkService.mintToken(item.slug, {
          clientId: selected?.client_id ?? null,
          conversationId: selectedId,
        });
        if (!result.success || !result.token) {
          throw new Error(result.error || 'Não foi possível gerar o link de preenchimento.');
        }
        guard.lastSlug = item.slug;
        guard.lastAt = Date.now();
        const url = buildPublicFillUrl(result.token);
        setDraft(`Segue o link para preencher e assinar seus documentos:\n\n${url}`);
        setSlashIndex(0);
      } catch (e: any) {
        toast.error('Falha ao gerar link do kit', e?.message || 'Não foi possível gerar o link de preenchimento.');
      } finally {
        guard.inFlight = false;
      }
      return;
    }
    setDraft(renderTemplate(item.body, templateCtx));
    setSlashIndex(0);
  }, [selected?.client_id, selectedId, templateCtx, toast]);

  // Pacote 360 do cliente carregado uma vez ao abrir a conversa (Fase 10).
  // Banner-resumo e painéis laterais consomem deste estado — sem refetch por bloco.
  const [overview, setOverview] = useState<ClientOverview | null>(null);
  const selectedClientId = selected?.client_id ?? null;
  // Recarrega o pacote 360 sob demanda (ex.: após criar uma solicitação de documento).
  const reloadOverview = useCallback(() => {
    if (!selectedClientId) { setOverview(null); return; }
    whatsappService.getClientOverview(selectedClientId)
      .then(setOverview)
      .catch(() => setOverview({ processes: [], schedule: { deadlines: [], events: [] }, pendings: { requirements: [], documents: [] }, templateFillLinks: [], signatures: [], agreements: [] }));
  }, [selectedClientId]);
  useEffect(() => {
    if (!selectedClientId) { setOverview(null); return; }
    let alive = true;
    setOverview(null);
    whatsappService.getClientOverview(selectedClientId)
      .then(o => { if (alive) setOverview(o); })
      .catch(() => { if (alive) setOverview({ processes: [], schedule: { deadlines: [], events: [] }, pendings: { requirements: [], documents: [] }, templateFillLinks: [], signatures: [], agreements: [] }); });
    return () => { alive = false; };
  }, [selectedClientId]);

  // ── Status de documentos por cliente (chips de lista/cabeçalho), em tempo real ──
  // Resolve o "não está realtime": quando a IA dá baixa em um item, lista, cabeçalho
  // e painel de pendências reagem na hora.
  const [docStatusByClient, setDocStatusByClient] = useState<Record<string, 'awaiting' | 'ready'>>({});
  const [trackedSignatureStatusByClient, setTrackedSignatureStatusByClient] = useState<Record<string, ClientTrackedSignatureStatus>>({});
  const convClientIds = useMemo(
    () => Array.from(new Set(conversations.map(c => c.client_id).filter(Boolean) as string[])),
    [conversations],
  );
  const loadDocStatus = useCallback(() => {
    if (convClientIds.length === 0) { setDocStatusByClient({}); return; }
    whatsappService.getDocStatusByClients(convClientIds).then(setDocStatusByClient).catch(() => {});
  }, [convClientIds]);
  useEffect(() => { loadDocStatus(); }, [loadDocStatus]);
  useEffect(() => {
    const unsub = whatsappService.subscribeDocRequests(() => { loadDocStatus(); reloadOverview(); });
    return unsub;
  }, [loadDocStatus, reloadOverview]);
  const loadTrackedSignatureStatus = useCallback(() => {
    if (convClientIds.length === 0) { setTrackedSignatureStatusByClient({}); return; }
    whatsappService.getTrackedSignatureStatusByClients(convClientIds).then(setTrackedSignatureStatusByClient).catch(() => {});
  }, [convClientIds]);
  const stopTemplateFillTracking = useCallback(async (linkId: string) => {
    try {
      await whatsappService.stopTemplateFillTracking(linkId);
      loadTrackedSignatureStatus();
      reloadOverview();
      toast.success('Acompanhamento do kit encerrado.');
    } catch (e: any) {
      toast.error('Falha ao encerrar acompanhamento', e?.message);
    }
  }, [loadTrackedSignatureStatus, reloadOverview, toast]);
  const stopSignatureTracking = useCallback(async (requestId: string) => {
    try {
      await whatsappService.stopSignatureTracking(requestId);
      setOverview(prev => prev ? {
        ...prev,
        signatures: prev.signatures.map(sig => sig.id === requestId ? ({ ...sig, wa_tracking_stopped: true } as any) : sig),
      } : prev);
      loadTrackedSignatureStatus();
      reloadOverview();
      toast.success('Acompanhamento da assinatura encerrado.');
    } catch (e: any) {
      toast.error('Falha ao encerrar acompanhamento', e?.message);
    }
  }, [loadTrackedSignatureStatus, reloadOverview, toast]);
  useEffect(() => { loadTrackedSignatureStatus(); }, [loadTrackedSignatureStatus]);
  useEffect(() => {
    const unsub = whatsappService.subscribeSignatures(() => { loadTrackedSignatureStatus(); reloadOverview(); });
    return unsub;
  }, [loadTrackedSignatureStatus, reloadOverview]);
  // A "presença ativa" (live) é calculada por janela de 45s no momento do fetch.
  // O heartbeat (a cada 20s) chega via realtime e mantém o badge fresco enquanto
  // o cliente está na tela; quando ele sai, os heartbeats param e não há mais
  // evento. Este tick reavalia periodicamente para o "Assinatura aberta" expirar
  // sozinho em vez de ficar grudado. Só roda quando há conversas com cliente.
  useEffect(() => {
    if (convClientIds.length === 0) return;
    const id = window.setInterval(() => loadTrackedSignatureStatus(), 12_000);
    return () => window.clearInterval(id);
  }, [convClientIds.length, loadTrackedSignatureStatus]);

  // ── Dispensar o aviso "Documentos prontos" por cliente (só visual; não toca nos
  // document_requests). Persiste em localStorage. Só o estado 'ready' é dispensável —
  // 'awaiting' é alerta ativo. A dispensa é limpa automaticamente quando o status
  // deixa de ser 'ready' (novo ciclo de documentos volta a aparecer).
  const DISMISS_KEY = 'wa_dismissed_doc_ready';
  const [dismissedDocReady, setDismissedDocReady] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); }
  });
  const persistDismissed = (s: Set<string>) => {
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...s])); } catch { /* storage indisponível */ }
  };
  const dismissDocReady = useCallback((clientId: string) => {
    setDismissedDocReady(prev => { const n = new Set(prev); n.add(clientId); persistDismissed(n); return n; });
    // Avisa outros painéis (ex.: DocumentRequestsTracker) para limpar os concluídos deste cliente.
    window.dispatchEvent(new CustomEvent('wa-doc-ready-dismissed', { detail: clientId }));
  }, []);
  // Poda: só remove a dispensa quando o cliente AINDA está no mapa mas deixou de
  // ser 'ready' (novo ciclo de documentos). Durante o reload o mapa fica vazio —
  // não podar nesse caso, senão o aviso dispensado reaparece (bug do "voltou").
  useEffect(() => {
    if (Object.keys(docStatusByClient).length === 0) return; // ainda carregando
    setDismissedDocReady(prev => {
      let changed = false; const n = new Set(prev);
      for (const id of prev) { if ((id in docStatusByClient) && docStatusByClient[id] !== 'ready') { n.delete(id); changed = true; } }
      if (changed) persistDismissed(n);
      return changed ? n : prev;
    });
  }, [docStatusByClient]);
  // Status efetivo para exibição: oculta 'ready' já dispensado.
  const effectiveDocStatus = useCallback((clientId: string | null | undefined): 'awaiting' | 'ready' | null => {
    if (!clientId) return null;
    const st = docStatusByClient[clientId];
    if (!st) return null;
    if (st === 'ready' && dismissedDocReady.has(clientId)) return null;
    return st;
  }, [docStatusByClient, dismissedDocReady]);
  const trackedSignatureStatus = useCallback((clientId: string | null | undefined): ClientTrackedSignatureStatus | null => {
    if (!clientId) return null;
    return trackedSignatureStatusByClient[clientId] || null;
  }, [trackedSignatureStatusByClient]);
  const effectiveConversationStatus = useCallback((c: {
    client_id?: string | null;
    is_blocked: boolean;
    status: string;
    last_message_direction: WhatsAppDirection | null;
    assigned_user_id?: string | null;
    department_id?: string | null;
    awaiting_accept?: boolean;
  }) => {
    const base = convStatus(c);
    // Estados terminais/duros nunca são sobrescritos pelo tracking.
    if (base.key === 'blocked' || base.key === 'closed') return base;
    const tracked = trackedSignatureStatus(c.client_id);
    if (tracked) {
      // Estado "forte": presença ativa AGORA (live) OU assinatura já existindo
      // (aguardando/visualizada/aberta). Prevalece sobre tudo — inclusive
      // "Aguardando você"/"Aguardando setor": a etapa da assinatura é o que
      // importa operacionalmente, e é isso que o usuário quer enxergar.
      const strong = tracked.live || tracked.kind.startsWith('signature_');
      if (strong) return { key: 'waiting_client' as const, label: tracked.label, cls: tracked.cls };
      // Estado "fraco" de kit pré-assinatura ("Link enviado"/"Página aberta"):
      // não mascara uma mensagem pendente do cliente — só cobre aguardando
      // cliente/aberta.
      if (base.key !== 'waiting_you' && base.key !== 'waiting_internal') {
        return { key: 'waiting_client' as const, label: tracked.label, cls: tracked.cls };
      }
    }
    return base;
  }, [trackedSignatureStatus]);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await whatsappService.listConversations());
    } catch {/* */} finally { setLoadingConvs(false); }
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    setLoadingMsgs(true);
    try {
      const msgs = await whatsappService.listMessages(convId, { limit: MSG_PAGE });
      setMessages(msgs);
      setHasMoreMsgs(msgs.length === MSG_PAGE);
      oldestTsRef.current = msgs[0]?.wa_timestamp ?? null;
    } catch {/* */} finally { setLoadingMsgs(false); }
  }, []);

  const loadMoreMsgs = useCallback(async () => {
    if (!selectedId || !oldestTsRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const older = await whatsappService.listMessages(selectedId, { limit: MSG_PAGE, before: oldestTsRef.current });
      if (older.length === 0) { setHasMoreMsgs(false); return; }
      oldestTsRef.current = older[0]?.wa_timestamp ?? oldestTsRef.current;
      setMessages(prev => [...older, ...prev]);
      setHasMoreMsgs(older.length === MSG_PAGE);
    } catch {/* */} finally { setLoadingMore(false); }
  }, [selectedId, loadingMore]);

  // Atualização silenciosa da thread (sem spinner) para eventos em tempo real:
  // mantém a conversa fluida, sem piscar nem perder a posição de rolagem.
  // Faz MERGE: recarrega só a página mais recente e a costura por cima do que já
  // está em memória, preservando o histórico antigo que o usuário paginou (rolou
  // para cima). Sem isso, cada mensagem recebida descartava as mensagens antigas
  // já carregadas e embaralhava o scroll de quem está lendo o histórico.
  const refreshMessages = useCallback(async (convId: string) => {
    try {
      const latest = await whatsappService.listMessages(convId, { limit: MSG_PAGE });
      setMessages(prev => {
        if (prev.length === 0 || latest.length === 0) return latest;
        // `latest` é o bloco contíguo mais novo (asc). Tudo estritamente anterior
        // ao seu início vem do que já estava paginado; a janela recente é
        // substituída por `latest` (reflete edições/exclusões/novos status).
        const cutoff = latest[0].wa_timestamp;
        const older = prev.filter(m => m.wa_timestamp < cutoff);
        return [...older, ...latest];
      });
    } catch {/* */}
  }, []);

  useEffect(() => {
    loadConversations();
    whatsappService.listChannels().then(setChannels).catch(() => {});
    whatsappService.listDepartments().then(setDepartments).catch(() => {});
    whatsappService.listStaff().then(setStaff).catch(() => {});
    whatsappService.getMyAgentPrefs().then(setAgentPrefs).catch(() => {});
    const unsub = whatsappService.subscribe({
      // Mescla a conversa que mudou no lugar (presença, preview, contador,
      // ordem) — sem recarregar a lista nem tocar na thread aberta.
      onConversationChange: (payload) => {
        const row = payload.new as Partial<WhatsAppConversation> | undefined;
        if (payload.eventType === 'DELETE' || !row?.id) { loadConversations(); return; }
        setConversations(prev => {
          const idx = prev.findIndex(c => c.id === row.id);
          if (idx === -1) { loadConversations(); return prev; } // conversa nova → busca completa (avatar etc.)
          const next = [...prev];
          // Preserva a URL assinada do avatar (campo só do client, não vem no payload).
          next[idx] = { ...prev[idx], ...row, contact_avatar_url: prev[idx].contact_avatar_url } as WhatsAppConversation;
          next.sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''));
          return next;
        });
      },
      // Mensagem nova/alterada: atualiza só a thread aberta, em silêncio.
      // Para UPDATE de status (delivered/read), faz merge cirúrgico sem reload completo.
      onMessageChange: (payload) => {
        const convId = (payload.new as any)?.conversation_id ?? (payload.old as any)?.conversation_id;
        if (!convId) return;
        if (payload.eventType === 'UPDATE') {
          const row = payload.new as Partial<WhatsAppMessage>;
          if (row?.id && row?.status) {
            setMessages(prev => {
              const idx = prev.findIndex(m => m.id === row.id);
              if (idx === -1) return prev;
              const next = [...prev];
              next[idx] = { ...next[idx], status: row.status! };
              return next;
            });
            return;
          }
        }
        setSelectedId(curr => { if (curr && convId === curr) refreshMessages(curr); return curr; });
      },
    });
    return unsub;
  }, [loadConversations, refreshMessages]);

  useEffect(() => {
    setPending([]); setReplyTo(null); setEditing(null);
    setHasMoreMsgs(false); setLoadingMore(false); oldestTsRef.current = null;
    setUploadProgress(new Map()); cancelledUploads.current.clear();
    if (!selectedId) { setMessages([]); return; }
    loadMessages(selectedId);
    whatsappService.markRead(selectedId).then(() => {
      setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, unread_count: 0 } : c));
    }).catch(() => {});
  }, [selectedId, loadMessages]);

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

  // Fase J: sessão de IA — carrega e assina realtime quando a conversa muda.
  useEffect(() => {
    if (!selectedId) { setAiSession(null); return; }
    whatsappService.getAiSession(selectedId).then(s => setAiSession(s)).catch(() => {});
    const unsub = whatsappService.subscribeAiSession(selectedId, s => setAiSession(s));
    return unsub;
  }, [selectedId]);
  // Fase K: limpar dados extraídos ao trocar de conversa.
  useEffect(() => { setExtractedData(null); }, [selectedId]);

  // Mescla mensagens reais + otimistas (que ainda não voltaram do servidor).
  const allMessages = useMemo(() => {
    const extra = pending.filter(p => !messages.some(b =>
      (!!p._serverId && b.id === p._serverId)
      || (!!p.evolution_message_id && !!b.evolution_message_id && b.evolution_message_id === p.evolution_message_id),
    ));
    return [...messages, ...extra].sort((a, b) => a.wa_timestamp.localeCompare(b.wa_timestamp));
  }, [messages, pending]);

  const msgById = useMemo(() => new Map(allMessages.map(m => [m.id, m])), [allMessages]);

  // Agrupa imagens consecutivas do mesmo remetente em álbuns (estilo WhatsApp).
  // Memoizado em allMessages para (a) não reprocessar a cada render e (b) manter
  // a identidade dos arrays de itens estável — pré-requisito para o React.memo
  // das bolhas/álbuns surtir efeito.
  const messageUnits = useMemo(() => {
    const groupable = (x: WhatsAppMessage) => x.type === 'image' && !x.reply_to_id
      && x._local !== 'failed' && x.status !== 'failed' && x._local !== 'uploading' && x._local !== 'sending';
    const units: ({ kind: 'album'; items: WhatsAppMessage[] } | { kind: 'single'; m: WhatsAppMessage })[] = [];
    for (let i = 0; i < allMessages.length; i++) {
      const m = allMessages[i];
      if (groupable(m)) {
        const run = [m]; let j = i + 1;
        while (j < allMessages.length) {
          const n = allMessages[j];
          if (!groupable(n) || n.direction !== m.direction || (n.sender_user_id || null) !== (m.sender_user_id || null)) break;
          if (Math.abs(new Date(n.wa_timestamp).getTime() - new Date(allMessages[j - 1].wa_timestamp).getTime()) > 60000) break;
          run.push(n); j++;
        }
        if (run.length >= 2) { units.push({ kind: 'album', items: run }); i = j - 1; continue; }
      }
      units.push({ kind: 'single', m });
    }
    return units;
  }, [allMessages]);

  // Galeria do lightbox: URLs das imagens da conversa, em ordem — permite navegar
  // (slider ‹ ›) entre todas as imagens ao ampliar uma.
  const lightboxImages = useMemo(
    () => allMessages.filter(m => m.type === 'image' && m.media_url).map(m => m.media_url as string),
    [allMessages],
  );
  // Navegação por teclado no lightbox (← → Esc).
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLightbox(null); return; }
      const idx = lightboxImages.indexOf(lightbox);
      if (idx < 0) return;
      if (e.key === 'ArrowRight') setLightbox(lightboxImages[Math.min(idx + 1, lightboxImages.length - 1)]);
      else if (e.key === 'ArrowLeft') setLightbox(lightboxImages[Math.max(idx - 1, 0)]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, lightboxImages]);

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

  // Auto-scroll: salto instantâneo ao abrir/trocar conversa; suave em mensagem
  // nova só quando o usuário já está no fim (não puxa quem está lendo histórico).
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const isSwitch = lastConvRef.current !== selectedId;
    if (isSwitch) {
      // Render da troca: `messages` ainda é da conversa anterior (o clear só aplica
      // no próximo render). Salta pro fim, zera o "pronto" e NÃO marca como feito
      // aqui — a fixação real acontece quando as mensagens DESTA conversa chegam.
      lastConvRef.current = selectedId;
      didInitialScrollRef.current = false;
      atBottomRef.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    // Enquanto não fixamos o fim desta conversa, salta para baixo a cada leva de
    // mensagens (o 1º paint vem vazio); só marca como pronto quando há conteúdo.
    // Garante abrir SEMPRE na mensagem mais recente, sem scroll suave a partir do topo.
    if (!didInitialScrollRef.current) {
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
      if (allMessages.length > 0) didInitialScrollRef.current = true;
      return;
    }
    // Já fixado no fim: mensagem nova só puxa o scroll se o usuário está no fim.
    if (atBottomRef.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [allMessages, selectedId]);

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

  // Mantém o fim "grudado" enquanto o conteúdo cresce depois de renderizado —
  // imagens/áudio têm altura desconhecida no 1º paint e esticam a thread depois,
  // o que empurrava a última mensagem pra fora de vista ao abrir a conversa.
  useEffect(() => {
    const el = threadRef.current;
    const content = threadContentRef.current;
    if (!el || !content || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [selectedId]);

  const onThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

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

  // Abre a conversa recém-criada/reaberta na inbox (recarrega para trazer avatar etc.).
  const handleConversationOpened = useCallback(async (conversationId: string) => {
    setNewConvOpen(false);
    await loadConversations();
    setSelectedId(conversationId);
  }, [loadConversations]);

  const handleReopen = useCallback(async () => {
    if (!selected) return;
    try {
      await whatsappService.reopenConversation(selected.id);
      setConversations(prev => prev.map(c => c.id === selected.id
        ? { ...c, status: 'open', reopened_at: new Date().toISOString(), closed_at: null } : c));
    } catch (e: any) { toast.error('Falha ao reabrir', e.message); }
  }, [selected, toast]);

  const handleUnblock = useCallback(async () => {
    if (!selected) return;
    if (!await confirm({ title: 'Desbloquear contato', message: 'Ele voltará ao fluxo normal de atendimento.', confirmLabel: 'Desbloquear' })) return;
    try {
      await whatsappService.unblockContact(selected.id);
      setConversations(prev => prev.map(c => c.id === selected.id
        ? { ...c, is_blocked: false, blocked_at: null, blocked_by: null, blocked_reason: null } : c));
    } catch (e: any) { toast.error('Falha ao desbloquear', e.message); }
  }, [selected, confirm, toast]);

  // 360: abrir o módulo de Assinaturas já com o cliente em prefill (sem poluir as notas).
  // 360: criar acordo financeiro inline
  const handleNavigateFinanceiro = useCallback(() => {
    if (!selected?.client_id) return;
    openWa({ type: 'financial_create', clientId: selected.client_id, clientName: selected.contact_name || undefined });
  }, [selected, openWa]);

  // Aceitar a transferência pendente: assume o atendimento, apresenta o novo
  // responsável ao cliente e limpa o alerta.
  const handleAccept = useCallback(async () => {
    if (!selected) return;
    try {
      await whatsappService.acceptTransfer(selected.id);
      // Apresentação automática do responsável ao cliente (best-effort).
      const me = user ? staffById.get(user.id) : null;
      if (me && !selected.is_blocked) {
        try {
          const text = buildAcceptPresentation({ ...me, name: agentPrefs.short_name || me.name });
          await whatsappService.sendText({ conversationId: selected.id, text });
          await refreshMessages(selected.id);
        } catch { /* apresentação é best-effort; o aceite já valeu */ }
      }
      setConversations(prev => prev.map(c => c.id === selected.id
        ? { ...c, awaiting_accept: false, transfer_pending_since: null,
            assigned_user_id: c.assigned_user_id || (user?.id ?? null) } : c));
    } catch (e: any) { toast.error('Falha ao aceitar', e.message); }
  }, [selected, user, agentPrefs, staffById, refreshMessages, toast]);

  // Assumir o atendimento direto da fila (sem transferência): vira responsável.
  const handleAssume = useCallback(async () => {
    if (!selected || !user?.id) return;
    try {
      await whatsappService.assumeConversation(selected.id);
      // Fase J: abortar sessão de IA quando agente humano assume
      if (aiSession?.status === 'active') {
        await whatsappService.abortAiSession(selected.id).catch(() => {});
      }
      setConversations(prev => prev.map(c => c.id === selected.id
        ? { ...c, assigned_user_id: user.id, awaiting_accept: false, transfer_pending_since: null } : c));
    } catch (e: any) { toast.error('Falha ao assumir', e.message); }
  }, [selected, user?.id, toast, aiSession]);

  // Devolver a conversa para a fila do setor: remove o responsável.
  const handleRelease = useCallback(async () => {
    if (!selected) return;
    if (!await confirm({ title: 'Devolver à fila', message: 'Você deixará de ser o responsável por este atendimento.', confirmLabel: 'Devolver' })) return;
    try {
      await whatsappService.releaseToQueue(selected.id);
      setConversations(prev => prev.map(c => c.id === selected.id
        ? { ...c, assigned_user_id: null, awaiting_accept: false, transfer_pending_since: null } : c));
    } catch (e: any) { toast.error('Falha ao devolver à fila', e.message); }
  }, [selected, confirm, toast]);

  // ── Silenciar / reativar conversa (notificações), por usuário ──
  const muteSelected = useCallback(async (durationMs: number | null, label: string) => {
    if (!selected) return;
    setMuteMenuOpen(false);
    const until = durationMs === null ? null : new Date(Date.now() + durationMs).toISOString();
    muteStore.setLocal(selected.id, until); // otimista
    try {
      await whatsappService.muteConversation(selected.id, until);
      toast.success(durationMs === null ? 'Conversa silenciada' : `Silenciada por ${label}`);
    } catch (e: any) {
      muteStore.setLocal(selected.id, undefined); // reverte
      toast.error('Não foi possível silenciar', e.message);
    }
  }, [selected, toast]);

  const unmuteSelected = useCallback(async () => {
    if (!selected) return;
    const prev = muteStore.mutedUntil(selected.id);
    muteStore.setLocal(selected.id, undefined); // otimista
    try {
      await whatsappService.unmuteConversation(selected.id);
      toast.success('Som reativado');
    } catch (e: any) {
      muteStore.setLocal(selected.id, prev); // reverte
      toast.error('Falha ao reativar o som', e.message);
    }
  }, [selected, toast]);

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
  }, []);

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
        const greeting = buildGreeting({ ...me, name: agentPrefs.short_name || me.name }, agentPrefs.role_label);
        await whatsappService.sendText({ conversationId: selected.id, text: greeting });
        await refreshMessages(selected.id);
      } catch { /* saudação é best-effort; não impede a mensagem principal */ }
    }

    // Prefixo de identificação do agente: *Dr. Pedro:*\n antes do texto.
    // Usa agentLabel para incluir Dr./Dra. em advogados automaticamente.
    // Só em envios manuais pelo compositor — saudações e mensagens automáticas ficam sem prefixo.
    const agentDisplayName = agentLabel(me, agentPrefs.short_name);
    const text = agentDisplayName ? `*${agentDisplayName}:*\n${rawText}` : rawText;

    const sentAt = new Date().toISOString();
    const tempId = `tmp-${Date.now()}`;
    const optimistic: WhatsAppMessage = {
      id: tempId, conversation_id: selected.id, evolution_message_id: null,
      direction: 'out', type: 'text', content: text, media_url: null, media_mime: null,
      storage_path: null, media_size: null, media_sha256: null, file_name: null,
      transcription_text: null, transcription_status: null,
      reply_to_id: replyTo?.id ?? null, edited_at: null,
      status: 'sent', sender_user_id: user?.id ?? null,
      wa_timestamp: sentAt, created_at: sentAt,
      _local: 'sending', _tempId: tempId,
    };
    const replyId = replyTo?.id;
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
      setPending(prev => prev.map(p => p._tempId === tempId ? { ...p, _local: 'failed', status: 'failed' } : p));
      toast.error('Mensagem não enviada', err?.message || 'Falha ao enviar pelo WhatsApp.');
    } finally { setSending(false); sendingRef.current = false; }
  };

  // ── Fase K: helpers de texto para chamadas de IA ────────────────────────────
  const buildRecentText = (limit = 15) =>
    [...messages].slice(-limit)
      .map(m => `${m.direction === 'out' ? 'Agente' : 'Cliente'}: ${(m.content || m.transcription_text || '[mídia]').slice(0, 300)}`)
      .join('\n');

  const buildClientContext = () => {
    if (!overview) return selected?.contact_name ? `Cliente: ${selected.contact_name}` : 'Sem dados do cliente disponíveis.';
    const lines: string[] = [];
    if (selected?.contact_name) lines.push(`Cliente: ${selected.contact_name}`);
    if (overview.processes?.length) {
      lines.push(`Processos ativos: ${overview.processes.length}`);
      const urgent = overview.processes.filter((p: any) => p.priority === 'urgente');
      if (urgent.length) lines.push(`Urgentes: ${urgent.length}`);
    }
    const pendSig = overview.signatures?.filter((s: any) => s.status === 'pending').length ?? 0;
    if (pendSig > 0) lines.push(`Assinaturas pendentes: ${pendSig}`);
    return lines.join(' | ') || 'Cliente vinculado, sem dados adicionais.';
  };

  const handleSuggestReply = async () => {
    if (!selected || suggesting || messages.length < 1) return;
    setSuggesting(true);
    try {
      const suggestion = await aiService.suggestReply(buildRecentText(), buildClientContext());
      if (suggestion) setDraft(suggestion);
      else toast.error('IA', 'Não foi possível gerar sugestão.');
    } catch {
      toast.error('IA', 'Erro ao sugerir resposta.');
    } finally { setSuggesting(false); }
  };

  const handleAiClassify = async () => {
    if (!selected || classifying || messages.length < 1) return;
    setClassifying(true);
    try {
      const subject = await aiService.classifySubject(buildRecentText(10));
      if (subject) {
        await whatsappService.setContactReason(selected.id, subject);
        loadConversations();
      } else {
        toast.error('IA', 'Não foi possível classificar o assunto.');
      }
    } catch {
      toast.error('IA', 'Erro ao classificar assunto.');
    } finally { setClassifying(false); }
  };

  const handleExtractData = async () => {
    if (!selected || extracting || messages.length < 2) return;
    setExtracting(true);
    try {
      const data = await aiService.extractContactData(buildRecentText(20));
      setExtractedData(Object.keys(data).length > 0 ? data : {});
    } catch {
      toast.error('IA', 'Erro ao extrair dados.');
    } finally { setExtracting(false); }
  };

  // ── Fase L: exportação e guarda jurídica ────────────────────────────────────
  const handleExportConversation = () => {
    if (!selected || messages.length === 0) return;
    const header = [
      `Conversa WhatsApp — ${selected.contact_name || prettyPhone(selected.contact_phone)}`,
      `Exportado em: ${new Date().toLocaleString('pt-BR')}`,
      selected.contact_reason ? `Assunto: ${selected.contact_reason}` : null,
      '─'.repeat(60),
    ].filter(Boolean).join('\n');

    const body = messages.map(m => {
      const who = m.direction === 'out' ? 'Equipe' : (selected.contact_name || selected.contact_phone);
      const when = m.wa_timestamp
        ? new Date(m.wa_timestamp).toLocaleString('pt-BR')
        : new Date(m.created_at).toLocaleString('pt-BR');
      const text = m.content || m.transcription_text
        ? (m.content || `[transcrição: ${m.transcription_text}]`)
        : `[${m.type}]`;
      return `[${when}] ${who}: ${text}`;
    }).join('\n');

    const blob = new Blob([`${header}\n\n${body}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversa-${(selected.contact_name || selected.contact_phone).replace(/\s+/g, '_')}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Limpa a conversa (apaga as mensagens da thread; a conversa fica na lista).
  // Destrutivo e vale para toda a equipe → confirmação de perigo. Bloqueado sob
  // guarda jurídica (preserva evidência, igual à política de retenção).
  const handleClearConversation = async () => {
    if (!selected) return;
    if (selected.legal_hold) {
      toast.error('Conversa sob guarda jurídica', 'Remova a guarda antes de limpar a conversa.');
      return;
    }
    if (!await confirm({
      title: 'Limpar conversa',
      message: 'Todas as mensagens desta conversa serão apagadas para toda a equipe. A conversa continua na lista. Esta ação não pode ser desfeita.',
      confirmLabel: 'Limpar conversa',
      tone: 'danger',
    })) return;
    try {
      await whatsappService.clearConversation(selected.id);
      setMessages([]); setPending([]); setReplyTo(null); setEditing(null);
      setHasMoreMsgs(false); oldestTsRef.current = null;
      setConversations(prev => prev.map(c =>
        c.id === selected.id ? { ...c, last_message_preview: null, unread_count: 0 } : c
      ));
      toast.success('Conversa limpa.');
    } catch (e: any) {
      toast.error('Falha ao limpar conversa', e.message);
    }
  };

  // Pausa/retoma a mensagem automática de ausência (fora do horário comercial)
  // SÓ para esta conversa. Pensado para um atendimento que segue fora do horário:
  // pausa o aviso comercial até encerrar; ao encerrar, o closeConversation limpa o
  // flag e a limitação volta sozinha no próximo contato.
  const handleToggleAbsenceSuppressed = async () => {
    if (!selected) return;
    const next = !selected.absence_suppressed;
    try {
      await whatsappService.setAbsenceSuppressed(selected.id, next);
      setConversations(prev => prev.map(c =>
        c.id === selected.id ? { ...c, absence_suppressed: next } : c
      ));
      toast.success(next
        ? 'Aviso fora do horário pausado para esta conversa.'
        : 'Aviso fora do horário reativado.');
    } catch (e: any) {
      toast.error('Falha ao atualizar aviso de horário', e.message);
    }
  };

  const handleToggleLegalHold = async () => {
    if (!selected) return;
    const newHold = !selected.legal_hold;
    const reason = newHold
      ? prompt('Motivo da guarda jurídica (opcional):') ?? undefined
      : undefined;
    try {
      await whatsappService.setLegalHold(selected.id, newHold, reason);
      setConversations(prev => prev.map(c =>
        c.id === selected.id
          ? { ...c, legal_hold: newHold, legal_hold_reason: reason ?? null }
          : c
      ));
      toast.success(newHold ? 'Guarda jurídica ativada.' : 'Guarda jurídica removida.');
    } catch (e: any) {
      toast.error('Falha ao atualizar guarda jurídica', e.message);
    }
  };

  // ── Envio de mídia (imagem/vídeo/áudio/documento) ──
  const sendFile = async (file: File, kind: 'image' | 'video' | 'audio' | 'document', captionOverride?: string) => {
    if (!selected) return;
    const caption = captionOverride !== undefined ? captionOverride.trim() : draft.trim();
    const sentAt = new Date().toISOString();
    const tempId = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const previewUrl = kind !== 'document' ? URL.createObjectURL(file) : null;
    const optimistic: WhatsAppMessage = {
      id: tempId, conversation_id: selected.id, evolution_message_id: null,
      direction: 'out', type: kind, content: caption || null,
      media_url: previewUrl, media_mime: file.type, storage_path: null,
      media_size: file.size, media_sha256: null, file_name: file.name,
      transcription_text: null, transcription_status: null,
      reply_to_id: replyTo?.id ?? null, edited_at: null,
      status: 'sent', sender_user_id: user?.id ?? null,
      wa_timestamp: sentAt, created_at: sentAt,
      _local: 'uploading', _tempId: tempId,
    };
    const replyId = replyTo?.id;
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
      setPending(prev => prev.map(p => p._tempId === tempId ? { ...p, _local: 'failed', status: 'failed' } : p));
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
    const tempId = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimistic: WhatsAppMessage = {
      id: tempId, conversation_id: selected.id, evolution_message_id: null,
      direction: 'out', type: 'text', content: text, media_url: null, media_mime: null,
      storage_path: null, media_size: null, media_sha256: null, file_name: null,
      transcription_text: null, transcription_status: null,
      reply_to_id: replyId ?? null, edited_at: null,
      status: 'sent', sender_user_id: user?.id ?? null,
      wa_timestamp: sentAt, created_at: sentAt, _local: 'sending', _tempId: tempId,
    };
    retryRef.current.set(tempId, { kind: 'text', text, replyId });
    setPending(prev => [...prev, optimistic]);
    bumpConversationPreview(selected.id, text, sentAt);
    try {
      const { message_id, evolution_message_id } = await whatsappService.sendText({ conversationId: selected.id, text, replyToId: replyId });
      bindPendingToServerMessage(tempId, message_id, evolution_message_id);
      retryRef.current.delete(tempId);
      void refreshMessages(selected.id);
    } catch (err: any) {
      setPending(prev => prev.map(p => p._tempId === tempId ? { ...p, _local: 'failed', status: 'failed' } : p));
      toast.error('Mensagem não enviada', err?.message || 'Falha ao reenviar pelo WhatsApp.');
    }
  };

  // Reenvio rápido de um arquivo já enviado: reaproveita o objeto no storage
  // (sem novo upload) e dispara de novo pela conversa atual.
  const resendExisting = async (m: WhatsAppMessage) => {
    if (!selected || !m.storage_path || m.type === 'text') return;
    const sentAt = new Date().toISOString();
    const tempId = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      setPending(prev => prev.map(p => p._tempId === tempId ? { ...p, _local: 'failed', status: 'failed' } : p));
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

  // ── Drag and drop de arquivos na thread ──
  // Limite operacional alinhado ao teto comum da Evolution/WhatsApp.
  const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

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

  const onThreadDragEnter = (e: React.DragEvent) => {
    if (!selected || editing) return;
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  };

  const onThreadDragOver = (e: React.DragEvent) => {
    if (!dragOver) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onThreadDragLeave = (e: React.DragEvent) => {
    if (!dragOver) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  };

  const onThreadDrop = (e: React.DragEvent) => {
    if (!selected || editing) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragOver(false);
    handleDroppedFiles(Array.from(e.dataTransfer?.files || []));
  };

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
        if (blob.size > 0) void sendAudioBlob(blob);
      };
      mediaRecRef.current = rec;
      rec.start();
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
    const tempId = `tmp-${Date.now()}`;
    const previewUrl = URL.createObjectURL(blob);
    const optimistic: WhatsAppMessage = {
      id: tempId, conversation_id: selected.id, evolution_message_id: null,
      direction: 'out', type: 'audio', content: null,
      media_url: previewUrl, media_mime: blob.type, storage_path: null,
      media_size: blob.size, media_sha256: null, file_name: 'audio.webm',
      transcription_text: null, transcription_status: null,
      reply_to_id: replyTo?.id ?? null, edited_at: null,
      status: 'sent', sender_user_id: user?.id ?? null,
      wa_timestamp: sentAt, created_at: sentAt,
      _local: 'uploading', _tempId: tempId,
    };
    const replyId = replyTo?.id;
    setPending(prev => [...prev, optimistic]); setReplyTo(null);
    bumpConversationPreview(selected.id, conversationPreviewLabel('audio'), sentAt);
    try {
      const up = await whatsappService.uploadMedia(blob, { conversationId: selected.id, fileName: 'audio.webm' });
      setPending(prev => prev.map(p => p._tempId === tempId ? { ...p, _local: 'sending' } : p));
      const { message_id, evolution_message_id } = await whatsappService.sendAudio({
        conversationId: selected.id, storagePath: up.storagePath, mimeType: up.mimeType,
        fileName: up.fileName, replyToId: replyId,
      });
      bindPendingToServerMessage(tempId, message_id, evolution_message_id);
      void refreshMessages(selected.id);
    } catch (err: any) {
      setPending(prev => prev.map(p => p._tempId === tempId ? { ...p, _local: 'failed', status: 'failed' } : p));
      toast.error('Falha ao enviar áudio', err.message);
    } finally {
      setTimeout(() => URL.revokeObjectURL(previewUrl), 60_000);
    }
  };

  const beginEdit = (m: WhatsAppMessage) => {
    setEditing(m); setReplyTo(null); setDraft(m.content || '');
  };

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

  return (
    <div className="flex h-full min-h-0 bg-[#faf9f7]">
      {/* ── Lista de conversas ── */}
      <aside style={isMobile ? undefined : { width: listWidth }}
        className={`flex-shrink-0 flex-col border-r border-[#e7e5df] bg-white min-h-0 ${isMobile ? (selectedId ? 'hidden' : 'flex w-full') : 'flex'}`}>
        <div className="px-4 pt-4 pb-3 border-b border-[#e7e5df]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MessageCircle size={18} className="text-amber-600" />
              <h2 className="text-[15px] font-bold text-slate-800">WhatsApp</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: anyConnected ? '#16a34a' : '#9ca3af' }} />
                {anyConnected ? 'Online' : 'Offline'}
              </span>
              {(() => {
                // Sino unificado: agrupa "som das notificações" e "push do navegador"
                // num único ícone com menu. O ícone reflete o estado geral — toca
                // (BellRing) com push ligado, sino simples só com som, e BellOff
                // quando tudo está desligado.
                const pushSupported = pushState !== 'unsupported' && pushState !== 'unknown';
                const pushOn = pushState === 'on';
                const soundOn = !soundMuted;
                const active = soundOn || pushOn;
                const Icon = pushOn ? BellRing : soundOn ? Bell : BellOff;
                const toggleSound = () => {
                  const next = !soundMuted;
                  setSoundMuted(next);
                  setNotifySoundMuted(next);
                  if (!next) { playNotificationSound(); toast.success('Som das notificações ativado'); }
                  else toast.info('Som das notificações silenciado');
                };
                const row = 'w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-slate-700 hover:bg-amber-50 transition text-left';
                const pill = (on: boolean) => `ml-auto text-[10.5px] font-bold px-1.5 py-0.5 rounded-full ${on ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'}`;
                // Coords do dropdown ancoradas ao botão (canto superior-direito
                // alinhado). Renderizado em portal/fixed para não ser recortado por
                // ancestrais com overflow (o painel da lista é estreito).
                const r = notifyBtnRef.current?.getBoundingClientRect();
                const menuTop = r ? r.bottom + 6 : 0;
                const menuRight = r ? Math.max(8, window.innerWidth - r.right) : 8;
                return (
                  <>
                    <button
                      ref={notifyBtnRef}
                      onClick={() => setNotifyMenuOpen(o => !o)}
                      title="Notificações"
                      aria-haspopup="menu" aria-expanded={notifyMenuOpen}
                      className={`flex items-center justify-center w-7 h-7 rounded-full transition ${active ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-[#f3f2ef] text-slate-400 hover:bg-slate-200'}`}>
                      <Icon size={15} />
                    </button>
                    {notifyMenuOpen && createPortal(
                      <>
                        <div className="fixed inset-0 z-[70]" onClick={() => setNotifyMenuOpen(false)} />
                        <div role="menu" style={{ position: 'fixed', top: menuTop, right: menuRight }}
                          className="z-[71] w-[min(17rem,calc(100vw-1rem))] rounded-xl bg-white shadow-xl border border-[#e7e5df] py-1.5 overflow-hidden">
                          <p className="px-3 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Notificações</p>
                          <button className={row} onClick={toggleSound}>
                            {soundOn ? <Bell size={16} className="text-amber-500 shrink-0" /> : <BellOff size={16} className="text-slate-400 shrink-0" />}
                            <span className="min-w-0">
                              <span className="block leading-tight">Som das notificações</span>
                              <span className="block text-[11px] text-slate-400">Toca ao chegar mensagem nas suas conversas</span>
                            </span>
                            <span className={pill(soundOn)}>{soundOn ? 'ON' : 'OFF'}</span>
                          </button>
                          {pushSupported && (
                            <button className={row} onClick={toggleStaffPush} disabled={pushState === 'busy'}>
                              {pushState === 'busy' ? <Loader2 size={16} className="animate-spin text-slate-400 shrink-0" /> : pushOn ? <BellRing size={16} className="text-amber-500 shrink-0" /> : <BellOff size={16} className="text-slate-400 shrink-0" />}
                              <span className="min-w-0">
                                <span className="block leading-tight">Notificações no navegador</span>
                                <span className="block text-[11px] text-slate-400">Avisa mesmo com a aba fechada</span>
                              </span>
                              <span className={pill(pushOn)}>{pushOn ? 'ON' : 'OFF'}</span>
                            </button>
                          )}
                        </div>
                      </>,
                      document.body,
                    )}
                  </>
                );
              })()}
              <button onClick={() => setShowDashboard(true)} title="Dashboard de atendimento"
                className="flex items-center justify-center w-7 h-7 rounded-full bg-[#f3f2ef] text-slate-600 hover:bg-slate-200 transition">
                <BarChart2 size={15} />
              </button>
              <button onClick={() => setNewConvOpen(true)} title="Nova conversa"
                className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-600 text-white hover:bg-amber-700 transition active:scale-90 hover:rotate-90 duration-200">
                <Plus size={16} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar conversa…"
                className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none" />
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
              {WA_LABELS.map(l => <option key={l.key} value={l.key}>{l.key}</option>)}
            </select>
          </div>
          )}

          {/* Abas de situação (restauradas): Todas / Não lidas / Minhas */}
          <div className="flex items-center gap-1 mt-2.5">
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
        onDragEnter={onThreadDragEnter} onDragOver={onThreadDragOver}
        onDragLeave={onThreadDragLeave} onDrop={onThreadDrop}>
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
            <header className="flex items-center gap-2 sm:gap-3 px-2.5 sm:px-5 py-3 border-b border-[#e7e5df] bg-white">
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
                    className="hidden sm:inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-[12.5px] font-semibold transition">
                    <CheckCircle2 size={15} /> Aceitar
                  </button>
                )}
                {/* Ações inline — apenas em telas largas (≥640px); abaixo disso viram o menu "⋮" */}
                <div className="hidden sm:flex items-center gap-1.5">
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
                        className="sm:hidden flex-shrink-0 w-9 h-9 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 flex items-center justify-center transition">
                        <Check size={18} strokeWidth={2.75} />
                      </button>
                    );
                  }
                  if (isMineOpen) {
                    return (
                      <button onClick={() => setCloseOpen(true)} title="Encerrar atendimento"
                        className="sm:hidden flex-shrink-0 w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center justify-center transition">
                        <CheckCircle2 size={18} />
                      </button>
                    );
                  }
                  return null;
                })()}

                {/* Menu "⋮" — agrupa as ações em telas estreitas (<640px) */}
                <div className="sm:hidden relative flex-shrink-0">
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

            {selected.client_id && <ConversationSummaryBanner overview={overview} docStatus={effectiveDocStatus(selected.client_id)} clientId={selected.client_id} onOpenWorkspace={openWa} onDismissDocReady={() => dismissDocReady(selected.client_id!)} onDismissTemplateFill={stopTemplateFillTracking} />}

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

            <div ref={threadRef} onScroll={onThreadScroll} className="flex-1 overflow-y-auto min-h-0" style={{ background: '#f3f2ef' }}>
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

      {transferOpen && selected && (
        <TransferModal
          conversation={selected}
          departments={departments}
          staff={staff}
          onClose={() => setTransferOpen(false)}
          onDone={async () => { setTransferOpen(false); setSelectedId(null); await loadConversations(); }}
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
        onSaved={(type) => {
          // Atualiza só o domínio afetado, mantendo scroll e seleção da conversa
          if (['process', 'requirement', 'deadline', 'calendar', 'financial', 'client', 'document'].includes(type)) {
            if (selected?.client_id) {
              whatsappService.getClientOverview(selected.client_id).then(ov => ov && setOverview(ov)).catch(() => {});
            }
          }
          closeWa();
        }}
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
          onDone={(reason) => {
            setBlockOpen(false);
            setConversations(prev => prev.map(c => c.id === selected.id
              ? { ...c, is_blocked: true, blocked_at: new Date().toISOString(), blocked_reason: reason } : c));
          }}
        />
      )}

      {closeOpen && selected && (
        <CloseConversationModal
          conversation={selected}
          agent={user ? staffById.get(user.id) : null}
          onClose={() => setCloseOpen(false)}
          onDone={async () => {
            setCloseOpen(false);
            // IA analisa a conversa encerrada e registra o motivo do contato (2º plano,
            // não bloqueia o fechamento). O closure ainda enxerga a conversa atual.
            handleAiClassify().catch(() => { /* best-effort */ });
            setSelectedId(null);
            await loadConversations();
          }}
        />
      )}

      {lightbox && (() => {
        const idx = lightboxImages.indexOf(lightbox);
        const hasGallery = idx >= 0 && lightboxImages.length > 1;
        return (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightbox(null)} className="absolute top-5 right-5 text-white/80 hover:text-white"><X size={26} /></button>
          {hasGallery && (
            <>
              <button
                onClick={e => { e.stopPropagation(); setLightbox(lightboxImages[Math.max(idx - 1, 0)]); }}
                disabled={idx === 0}
                className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center ring-1 ring-white/20 transition disabled:opacity-30 disabled:cursor-default"
                title="Imagem anterior">
                <ChevronLeft size={28} />
              </button>
              <button
                onClick={e => { e.stopPropagation(); setLightbox(lightboxImages[Math.min(idx + 1, lightboxImages.length - 1)]); }}
                disabled={idx === lightboxImages.length - 1}
                className="absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center ring-1 ring-white/20 transition disabled:opacity-30 disabled:cursor-default"
                title="Próxima imagem">
                <ChevronRight size={28} />
              </button>
              <span className="absolute top-6 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white text-[12px] font-semibold ring-1 ring-white/20">
                {idx + 1} / {lightboxImages.length}
              </span>
            </>
          )}
        </div>
        );
      })()}

      {/* Fase M: dashboard de atendimento */}
      {showDashboard && (
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
          onCreated={reloadOverview}
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

// ── Bolha de mensagem ──
// Handlers recebem a própria mensagem (em vez de fechar sobre ela no call-site),
// para que o pai passe identidades estáveis e o React.memo abaixo seja efetivo:
// só re-renderiza a bolha cuja mensagem mudou, não a thread inteira.
const MessageBubble: React.FC<{
  m: WhatsAppMessage;
  repliedTo: WhatsAppMessage | null;
  senderName: string | null;
  senderRole?: string | null;
  privateMode?: boolean;
  canCreateFollowups?: boolean;
  onReply: (m: WhatsAppMessage) => void;
  onEdit: (m: WhatsAppMessage) => void;
  onOpenImage: (url: string) => void;
  onRetry: (m: WhatsAppMessage) => void;
  onDiscard: (m: WhatsAppMessage) => void;
  onResend: (m: WhatsAppMessage) => void;
  uploadProgress?: number;
  onCancel: (m: WhatsAppMessage) => void;
  onCreateDeadline: (m: WhatsAppMessage) => void;
  onCreateTask: (m: WhatsAppMessage) => void;
}> = React.memo(({ m, repliedTo, senderName, senderRole, privateMode, canCreateFollowups, onReply, onEdit, onOpenImage, onRetry, onDiscard, onResend, uploadProgress, onCancel, onCreateDeadline, onCreateTask }) => {
  const out = m.direction === 'out';
  const failed = m._local === 'failed' || m.status === 'failed';
  const busy = m._local === 'uploading' || m._local === 'sending';
  // Reenvio rápido: só faz sentido para mídia já entregue (com objeto no storage).
  const canResend = out && !busy && !failed && m.type !== 'text' && !!m.storage_path;
  // Imagem/vídeo sem legenda/reply/nome → bolha sem moldura (igual WhatsApp):
  // a mídia "sangra" até a borda e a hora fica sobreposta num canto.
  const mediaOnly = (m.type === 'image' || m.type === 'video') && !!m.media_url && !m.content && !repliedTo && !senderName;

  return (
    <div className={`group flex items-end gap-1.5 ${out ? 'justify-end' : 'justify-start'}`}>
      {/* Ações (hover) */}
      {out && (
        <div className="wa-msg-actions flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition self-center">
          {m.type === 'text' && m.evolution_message_id && (
            <button title="Editar" onClick={() => onEdit(m)} className="text-slate-400 hover:text-amber-600"><Pencil size={13} /></button>
          )}
          {canResend && (
            <button title="Reenviar arquivo" onClick={() => onResend(m)} className="text-slate-400 hover:text-amber-600"><RotateCcw size={13} /></button>
          )}
          {canCreateFollowups && !m._tempId && <button title="Criar prazo" onClick={() => onCreateDeadline(m)} className="text-slate-400 hover:text-amber-600"><Calendar size={13} /></button>}
          {canCreateFollowups && !m._tempId && <button title="Criar tarefa" onClick={() => onCreateTask(m)} className="text-slate-400 hover:text-amber-600"><ListTodo size={13} /></button>}
          <button title="Responder" onClick={() => onReply(m)} className="text-slate-400 hover:text-amber-600"><CornerUpLeft size={13} /></button>
        </div>
      )}

      <div className={`wa-bubble wa-bubble-in ${out ? 'origin-bottom-right' : 'origin-bottom-left'} relative text-[13.5px] leading-snug text-slate-800 rounded-2xl ${m.type === 'audio' ? '' : 'shadow-sm'} ${out ? 'rounded-br-sm' : 'rounded-bl-sm'} ${mediaOnly ? 'max-w-[280px] p-0 overflow-hidden bg-black/5' : `max-w-[70%] px-3 py-2 ${out ? 'bg-[#d9fdd3]' : 'bg-white'}`}`}>
        {senderName && (
          <span className="flex items-center gap-1 text-[11px] font-bold mb-0.5 text-emerald-700">
            {senderName}
            {senderRole && (
              <span className="px-1 py-px rounded text-[9px] font-semibold uppercase tracking-wide bg-emerald-100 text-emerald-700">{senderRole}</span>
            )}
          </span>
        )}

        {repliedTo && (
          <div className={`mb-1 px-2 py-1 rounded-md border-l-2 text-[12px] border-emerald-500 ${out ? 'bg-black/[0.04]' : 'bg-slate-100'}`}>
            <span className="block font-semibold text-emerald-700">{repliedTo.direction === 'out' ? 'Você' : 'Contato'}</span>
            <span className="block truncate text-slate-500">{repliedTo.content || typeLabel(repliedTo.type)}</span>
          </div>
        )}

        <MediaContent m={m} out={out} onOpenImage={onOpenImage} />

        {m.content && m.type !== 'text' && (
          <span className="block mt-1 whitespace-pre-wrap break-words">
            {privateMode ? maskSensitive(m.content) : m.content}
          </span>
        )}
        {m.content && m.type === 'text' && (
          <span className="whitespace-pre-wrap break-words">
            {(() => {
              const raw = out ? m.content.replace(/^\*[^*]+:\*\n/, '') : m.content;
              return privateMode ? maskSensitive(raw) : raw;
            })()}
          </span>
        )}

        <span className={mediaOnly
          ? 'absolute bottom-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/45 text-white text-[10px]'
          : 'flex items-center gap-1 justify-end mt-1 text-[10px] text-slate-500'}>
          {m.edited_at && <span className="italic opacity-80">editado</span>}
          {busy && <Loader2 size={11} className="animate-spin" />}
          {formatTime(m.wa_timestamp)}
          {out && !busy && (failed
            ? <AlertCircle size={12} className="text-red-500" />
            : m.status === 'read'
              ? <CheckCheck size={12} className={mediaOnly ? 'text-sky-300' : 'text-sky-500'} />
            : m.status === 'delivered'
              ? <CheckCheck size={12} className="opacity-50" />
            : <Check size={12} className="opacity-50" />)}
        </span>

        {/* Barra de progresso de upload + botão cancelar (Fase D) */}
        {m._local === 'uploading' && uploadProgress !== undefined && (
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 h-1 rounded-full bg-emerald-600/20 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-[width] duration-300"
                style={{ width: `${uploadProgress}%` }} />
            </div>
            <span className="text-[10px] text-slate-500 tabular-nums">{uploadProgress}%</span>
            {m._tempId && (
              <button onClick={() => onCancel(m)} title="Cancelar envio"
                className="text-slate-500 hover:text-slate-700 transition leading-none">
                <X size={12} />
              </button>
            )}
          </div>
        )}

        {/* Falha no envio: tentar de novo ou descartar da fila */}
        {failed && m._tempId && (
          <span className="flex items-center gap-2 justify-end mt-1 text-[11px] font-semibold">
            <span className="text-red-600">Não enviado</span>
            <button onClick={() => onRetry(m)} className="underline hover:no-underline text-emerald-700">Tentar de novo</button>
            <button onClick={() => onDiscard(m)} className="text-slate-500 hover:text-slate-700">Descartar</button>
          </span>
        )}
      </div>

      {!out && (
        <div className="wa-msg-actions flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition self-center">
          <button title="Responder" onClick={() => onReply(m)} className="text-slate-400 hover:text-amber-600"><CornerUpLeft size={13} /></button>
          {canCreateFollowups && !m._tempId && <button title="Criar prazo" onClick={() => onCreateDeadline(m)} className="text-slate-400 hover:text-amber-600"><Calendar size={13} /></button>}
          {canCreateFollowups && !m._tempId && <button title="Criar tarefa" onClick={() => onCreateTask(m)} className="text-slate-400 hover:text-amber-600"><ListTodo size={13} /></button>}
        </div>
      )}
    </div>
  );
});
MessageBubble.displayName = 'MessageBubble';

// ── Player de áudio estilo WhatsApp (play/pause + onda clicável + tempo/velocidade) ──
const WA_AUDIO_BARS = Array.from({ length: 30 }, (_, i) => 25 + ((i * 41 + i * i * 7) % 75));
const WaAudioPlayer: React.FC<{ src: string }> = ({ src }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  const toggle = () => { const a = audioRef.current; if (!a) return; if (a.paused) void a.play(); else a.pause(); };
  const cycleRate = () => { const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(next); if (audioRef.current) audioRef.current.playbackRate = next; };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current; if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = pct * duration; setCurrent(a.currentTime);
  };
  const progress = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2.5 select-none" style={{ minWidth: '200px', maxWidth: '250px' }}>
      <audio ref={audioRef} src={src} preload="metadata"
        onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }} className="hidden" />
      <button type="button" onClick={toggle} title={playing ? 'Pausar' : 'Reproduzir'}
        className="shrink-0 w-9 h-9 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-sm active:scale-95 transition">
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-end gap-[2px] h-6 cursor-pointer" onClick={seek} title="Avançar / retroceder">
          {WA_AUDIO_BARS.map((h, i) => {
            const filled = (i / WA_AUDIO_BARS.length) * 100 <= progress;
            return <div key={i} className="flex-1 rounded-full" style={{ height: `${h}%`, background: filled ? '#059669' : 'rgba(0,0,0,0.18)' }} />;
          })}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[10px] text-slate-500 tabular-nums font-semibold">{playing || current > 0 ? fmtAudioTime(current) : fmtAudioTime(duration)}</span>
          <button type="button" onClick={cycleRate} title="Velocidade"
            className="text-[9px] font-bold text-slate-500 bg-black/[0.06] hover:bg-black/[0.12] rounded px-1 py-0.5 transition leading-none">{rate}x</button>
        </div>
      </div>
    </div>
  );
};

// ── Conteúdo de mídia por tipo ──
const MediaContent: React.FC<{ m: WhatsAppMessage; out: boolean; onOpenImage: (url: string) => void }> = ({ m, out, onOpenImage }) => {
  if (m.type === 'text') return null;
  const url = m.media_url;

  if (m.type === 'image') {
    return url
      ? <img src={url} alt={m.content || 'imagem'} onClick={() => onOpenImage(url)}
          className="rounded-lg max-w-[260px] max-h-[300px] object-cover cursor-pointer" />
      : <MediaPlaceholder label={typeLabel('image')} />;
  }

  if (m.type === 'video') {
    return url
      ? <video src={url} controls className="rounded-lg max-w-[260px] max-h-[300px]" />
      : <MediaPlaceholder label={typeLabel('video')} />;
  }

  if (m.type === 'audio') {
    return (
      <div className="min-w-[220px]">
        {url ? <WaAudioPlayer src={url} />
          : <MediaPlaceholder label={typeLabel('audio')} />}
        {m.transcription_status === 'pending' && (
          <span className="flex items-center gap-1 mt-1 text-[11px] italic text-slate-400"><Loader2 size={11} className="animate-spin" /> Transcrevendo…</span>
        )}
        {m.transcription_status === 'done' && m.transcription_text && (
          <p className="mt-1 text-[12px] italic text-slate-500">“{m.transcription_text}”</p>
        )}
        {m.transcription_status === 'failed' && (
          <span className="block mt-1 text-[11px] italic text-slate-400">Transcrição indisponível</span>
        )}
      </div>
    );
  }

  // documento
  return (
    <a href={url || undefined} target="_blank" rel="noreferrer" download={m.file_name || undefined}
      className={`flex items-center gap-2.5 min-w-[200px] px-2 py-1.5 rounded-lg ${out ? 'bg-black/[0.05] hover:bg-black/[0.08]' : 'bg-slate-100 hover:bg-slate-200'} transition`}>
      <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-white text-emerald-600 shadow-sm"><FileText size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold truncate text-slate-800">{m.file_name || 'Documento'}</span>
        <span className="block text-[11px] text-slate-400">{formatBytes(m.media_size)}</span>
      </span>
      {url && <Download size={16} className="text-slate-400" />}
    </a>
  );
};

const MediaPlaceholder: React.FC<{ label: string }> = ({ label }) => (
  <span className="flex items-center gap-1.5 text-[12px] opacity-80"><Loader2 size={12} className="animate-spin" /> {label}</span>
);

// ── Álbum de imagens (estilo WhatsApp) — agrupa imagens enviadas juntas ──
// Mostra até 4 miniaturas num grid; "+N" no excedente. Legenda da 1ª imagem e
// hora/status da última, como no WhatsApp. Cada célula abre o lightbox.
const ImageAlbum: React.FC<{ items: WhatsAppMessage[]; out: boolean; senderName: string | null; onOpenImage: (url: string) => void }> = React.memo(({ items, out, senderName, onOpenImage }) => {
  const shown = items.slice(0, 4);
  const extra = items.length - shown.length;
  const last = items[items.length - 1];
  const caption = items.find(i => i.content)?.content || '';
  const busy = items.some(i => i._local === 'uploading' || i._local === 'sending');
  // Mídia sangra até a borda (igual WhatsApp): sem moldura verde. Nome do remetente
  // e legenda ficam sobrepostos; a hora vai num canto sobre a imagem.
  const ticks = !busy && out && (last.status === 'read'
    ? <CheckCheck size={12} className="text-sky-300" />
    : last.status === 'delivered' ? <CheckCheck size={12} className="opacity-50" /> : <Check size={12} className="opacity-50" />);
  return (
    <div className={`wa-msg-in group flex items-end gap-1.5 ${out ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[280px]">
        <div className={`relative grid gap-1 w-64 ${shown.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} rounded-2xl overflow-hidden shadow-sm`}>
          {shown.map((m, i) => {
            const overlay = i === shown.length - 1 && extra > 0;
            return (
              <button key={m._tempId || m.id} onClick={() => m.media_url && onOpenImage(m.media_url)}
                className="relative aspect-square overflow-hidden bg-black/10">
                {m.media_url
                  ? <img src={m.media_url} alt={m.content || 'imagem'} className="w-full h-full object-cover hover:opacity-95 transition" />
                  : <span className="w-full h-full flex items-center justify-center"><Loader2 size={16} className="animate-spin text-white/70" /></span>}
                {overlay && <span className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-[18px] font-bold">+{extra}</span>}
              </button>
            );
          })}
          {senderName && (
            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/45 text-white text-[10px] font-bold">{senderName}</span>
          )}
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/45 text-white text-[10px]">
            {busy && <Loader2 size={11} className="animate-spin" />}
            {formatTime(last.wa_timestamp)}
            {ticks}
          </span>
        </div>
        {caption && <p className="pt-1 text-[13px] leading-snug whitespace-pre-wrap break-words text-slate-800">{caption}</p>}
      </div>
    </div>
  );
});
ImageAlbum.displayName = 'ImageAlbum';

// ── Vínculo conversa ↔ cliente ──
// ── Seção recolhível (acordeão) para economizar espaço no painel ──
const CollapsibleSection: React.FC<{
  icon: React.ReactNode;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ icon, title, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-[#e7e5df] overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-[#f9f8f6] transition">
        <span className="text-amber-600 flex-shrink-0">{icon}</span>
        <span className="flex-1 text-left text-[12.5px] font-semibold text-slate-700">{title}</span>
        <ChevronRight size={15} className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="px-3 pb-3 border-t border-[#f1f0ec]">{children}</div>}
    </div>
  );
};

const ClientLinkPanel: React.FC<{
  conversation: WhatsAppConversation;
  onChanged: () => void;
  onOpenWorkspace: (modal: WaModal) => void;
  embedded?: boolean;
}> = ({ conversation, onChanged, onOpenWorkspace, embedded }) => {
  const toast = useToastContext();
  const [client, setClient] = useState<WhatsAppClientLite | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoChecking, setAutoChecking] = useState(false);
  const [candidates, setCandidates] = useState<WhatsAppClientLite[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Fase E: criação inline de contato
  const [createMode, setCreateMode] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  // Fase E: oferta de atualização de telefone após vincular
  const [phonePrompt, setPhonePrompt] = useState<{ clientId: string; name: string } | null>(null);
  const [addingPhone, setAddingPhone] = useState(false);
  // Fase F: histórico de conversas anteriores do cliente
  type PastConv = Pick<WhatsAppConversation, 'id' | 'contact_phone' | 'status' | 'last_message_at' | 'last_message_preview' | 'last_message_direction' | 'closed_at' | 'contact_reason'>;
  const [history, setHistory] = useState<PastConv[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setClient(null); setCandidates([]); setCreateMode(false);
    setHistory([]); setHistoryOpen(false);
    if (conversation.client_id) {
      setLoading(true);
      whatsappService.getClient(conversation.client_id)
        .then(c => { if (alive) setClient(c); })
        .finally(() => { if (alive) setLoading(false); });
      // Carrega histórico de conversas anteriores em paralelo (Fase F).
      whatsappService.listConversationsByClient(conversation.client_id, conversation.id)
        .then(h => { if (alive) setHistory(h); })
        .catch(() => {});
    } else {
      setPhonePrompt(null);
      // 1 match → vincula automático. Vários → lista para escolher (anti-ambiguidade).
      setAutoChecking(true);
      whatsappService.matchClientsByPhone(conversation.contact_phone)
        .then(list => {
          if (!alive) return;
          if (list.length === 1) return whatsappService.linkClient(conversation.id, list[0].id).then(onChanged);
          setCandidates(list);
        })
        .catch(() => {})
        .finally(() => { if (alive) setAutoChecking(false); });
    }
    return () => { alive = false; };
  }, [conversation.id, conversation.client_id, conversation.contact_phone, onChanged]);

  // Vincula e, se o telefone da conversa não estiver no cadastro, oferece adicioná-lo.
  const link = async (clientId: string | null, picked?: WhatsAppClientLite) => {
    setBusy(true);
    try {
      await whatsappService.linkClient(conversation.id, clientId);
      onChanged();
      if (clientId && picked) {
        const myPhone = normalizePhone(conversation.contact_phone);
        const existing = [picked.mobile, picked.phone].map(p => (p ? normalizePhone(p) : null));
        if (myPhone && !existing.includes(myPhone)) {
          setPhonePrompt({ clientId, name: picked.full_name });
        } else {
          setPhonePrompt(null);
        }
      }
    } catch (e: any) { toast.error('Falha ao vincular', e.message); }
    finally { setBusy(false); setPickerOpen(false); }
  };

  // Cria contato básico inline e vincula imediatamente à conversa.
  const handleCreateContact = async () => {
    setCreating(true);
    try {
      const newClient = await whatsappService.createQuickContact({
        fullName: newName,
        phone: conversation.contact_phone,
      });
      await whatsappService.linkClient(conversation.id, newClient.id);
      setCreateMode(false);
      onChanged();
      toast.success('Contato criado e vinculado.');
    } catch (e: any) { toast.error('Falha ao criar contato', e.message); }
    finally { setCreating(false); }
  };

  // Adiciona o telefone da conversa ao campo correto do cadastro do cliente.
  const handleAddPhone = async () => {
    if (!phonePrompt) return;
    setAddingPhone(true);
    try {
      const { added, field } = await whatsappService.addPhoneToClient(phonePrompt.clientId, conversation.contact_phone);
      setPhonePrompt(null);
      if (added) toast.success(`Telefone adicionado ao campo ${field === 'mobile' ? 'Celular' : 'Telefone'} do cadastro.`);
    } catch (e: any) { toast.error('Falha ao atualizar telefone', e.message); }
    finally { setAddingPhone(false); }
  };

  // Conversa já vinculada a um cliente.
  if (conversation.client_id) {
    // Rótulo amigável de status/tipo do cliente.
    const clientStatusLabel = (c: WhatsAppClientLite) => {
      const typeMap: Record<string, string> = { pessoa_fisica: 'Pessoa física', pessoa_juridica: 'Pessoa jurídica' };
      const statusMap: Record<string, string> = { ativo: 'Ativo', inativo: 'Inativo', lead: 'Lead', ex_cliente: 'Ex-cliente' };
      const parts = [c.client_type ? typeMap[c.client_type] ?? c.client_type : null, c.status ? statusMap[c.status] ?? c.status : null].filter(Boolean);
      return parts.join(' · ');
    };
    return (
      <div className="mt-2 space-y-2">
        {!embedded && <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Cliente</p>}
        <div className="rounded-xl border border-[#e7e5df] p-3">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-[12.5px]"><Loader2 size={14} className="animate-spin" /> Carregando…</div>
          ) : client ? (
            <>
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0"><UserCheck size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-slate-800 truncate">{client.full_name}</p>
                  {client.cpf_cnpj && <p className="text-[11.5px] text-slate-400 flex items-center gap-1"><IdCard size={12} /> {prettyDoc(client.cpf_cnpj)}</p>}
                </div>
              </div>

              {/* Fase P: informações de contato e localização expandidas */}
              <div className="mt-2.5 space-y-1">
                {(clientStatusLabel(client)) && (
                  <p className="text-[11px] text-slate-400 font-medium">{clientStatusLabel(client)}</p>
                )}
                {client.email && (
                  <a href={`mailto:${client.email}`} className="flex items-center gap-1.5 text-[12px] text-amber-700 hover:underline truncate">
                    <Mail size={11} className="flex-shrink-0" />
                    <span className="truncate">{client.email}</span>
                  </a>
                )}
                {client.mobile && normalizePhone(client.mobile) !== normalizePhone(conversation.contact_phone) && (
                  <p className="flex items-center gap-1.5 text-[12px] text-slate-500">
                    <Phone size={11} className="flex-shrink-0" />
                    <span>{prettyPhone(client.mobile)}</span>
                    <span className="text-[10px] text-slate-400">celular</span>
                  </p>
                )}
                {client.phone && normalizePhone(client.phone) !== normalizePhone(conversation.contact_phone) && (
                  <p className="flex items-center gap-1.5 text-[12px] text-slate-500">
                    <Phone size={11} className="flex-shrink-0" />
                    <span>{prettyPhone(client.phone)}</span>
                    <span className="text-[10px] text-slate-400">fixo</span>
                  </p>
                )}
                {(client.address_city || client.address_state) && (
                  <p className="flex items-center gap-1.5 text-[12px] text-slate-400">
                    <MapPin size={11} className="flex-shrink-0" />
                    {[client.address_city, client.address_state].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-[#f1f0ec] flex-wrap">
                <button onClick={() => onOpenWorkspace({ type: 'client_view', clientId: client.id })}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-amber-700">
                  <UserIcon size={11} /> Ver
                </button>
                <button onClick={() => onOpenWorkspace({ type: 'client_edit', clientId: client.id })}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-amber-700">
                  <Pencil size={11} /> Editar
                </button>
                <span className="text-slate-200">|</span>
                <button onClick={() => setPickerOpen(true)} disabled={busy} className="text-[12px] font-semibold text-amber-700 hover:underline disabled:opacity-50">Trocar</button>
                <button onClick={() => link(null)} disabled={busy} className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-400 hover:text-red-500 disabled:opacity-50"><Unlink size={12} /> Desvincular</button>
              </div>
              {/* Fase F: histórico de conversas anteriores */}
              {history.length > 0 && (
                <div className="mt-3 border-t border-[#f1f0ec] pt-3">
                  <button onClick={() => setHistoryOpen(o => !o)}
                    className="flex items-center gap-1 text-[11.5px] font-semibold text-slate-500 hover:text-slate-700 w-full">
                    {historyOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {history.length} conversa{history.length > 1 ? 's' : ''} anterior{history.length > 1 ? 'es' : ''}
                  </button>
                  {historyOpen && (
                    <div className="mt-2 space-y-1.5">
                      {history.map(h => (
                        <div key={h.id} className="rounded-lg bg-[#f9f8f6] px-3 py-2 text-[11.5px]">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className={`px-1.5 py-px rounded text-[9.5px] font-semibold ${h.status === 'closed' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'}`}>
                              {h.status === 'closed' ? 'Encerrada' : h.status === 'open' ? 'Aberta' : 'Pendente'}
                            </span>
                            <span className="text-slate-400 text-[10px]">{h.last_message_at ? formatTime(h.last_message_at) : '—'}</span>
                          </div>
                          {h.contact_reason && <p className="text-[11px] font-medium text-amber-700 truncate">{h.contact_reason}</p>}
                          <p className="text-slate-500 truncate">{h.last_message_preview || '—'}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-[12.5px] text-slate-400">Cliente não encontrado.</p>
          )}
        </div>
        {/* Fase E: banner de oferta de atualização de telefone */}
        {phonePrompt && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-[12px] font-semibold text-amber-800 mb-0.5">Adicionar número ao cadastro?</p>
            <p className="text-[11.5px] text-amber-700 mb-2">{prettyPhone(conversation.contact_phone)} não estava em {phonePrompt.name}.</p>
            <div className="flex items-center gap-2">
              <button onClick={handleAddPhone} disabled={addingPhone}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[11.5px] font-semibold hover:bg-amber-700 disabled:opacity-50">
                {addingPhone ? <Loader2 size={11} className="animate-spin" /> : <Phone size={11} />} Adicionar
              </button>
              <button onClick={() => setPhonePrompt(null)} className="text-[11.5px] font-semibold text-slate-500 hover:text-slate-700">Ignorar</button>
            </div>
          </div>
        )}
        {pickerOpen && <ClientPickerModal phone={conversation.contact_phone} onClose={() => setPickerOpen(false)} onPick={c => link(c.id, c)} />}
      </div>
    );
  }

  // Sem cliente: enquanto verifica o telefone, spinner; senão, busca manual ou criação inline.
  return (
    <div className="mt-2 space-y-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Cliente</p>
      {autoChecking ? (
        <div className="rounded-xl border border-[#e7e5df] p-4 flex items-center gap-2 text-slate-400 text-[12.5px]">
          <Loader2 size={14} className="animate-spin" /> Procurando cliente pelo telefone…
        </div>
      ) : candidates.length > 1 ? (
        <div className="rounded-xl border border-[#e7e5df] overflow-hidden">
          <p className="px-3 py-2 text-[11.5px] text-slate-500 bg-[#faf9f7] border-b border-[#f1f0ec]">
            <span className="font-semibold text-slate-700">{candidates.length} cadastros</span> com este telefone — escolha qual vincular
          </p>
          <div className="divide-y divide-[#f1f0ec]">
            {candidates.map(c => (
              <button key={c.id} onClick={() => link(c.id, c)} disabled={busy}
                className="group w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-amber-50 transition disabled:opacity-50">
                <span className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[11px] font-bold flex-shrink-0">{initials(c.full_name, '')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-slate-800 truncate">{c.full_name}</span>
                  <span className="block text-[11px] text-slate-400">{c.cpf_cnpj ? prettyDoc(c.cpf_cnpj) : 'sem CPF/CNPJ'}</span>
                </span>
                <Link2 size={14} className="text-slate-300 group-hover:text-amber-600 flex-shrink-0 transition" />
              </button>
            ))}
          </div>
          <button onClick={() => setPickerOpen(true)}
            className="w-full px-3 py-2 text-[12px] font-semibold text-amber-700 hover:bg-amber-50 border-t border-[#f1f0ec] transition">
            Buscar outro cliente
          </button>
        </div>
      ) : createMode ? (
        // Fase E: mini-formulário de criação inline
        <div className="rounded-xl border border-[#e7e5df] p-4 space-y-3">
          <p className="text-[12px] font-semibold text-slate-700">Novo contato</p>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome completo" autoFocus
            className="w-full px-3 py-2 text-[13px] rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none" />
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f3f2ef] text-[12.5px] text-slate-500">
            <Phone size={13} className="flex-shrink-0" /> {prettyPhone(conversation.contact_phone)}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreateMode(false)} className="px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-700">Cancelar</button>
            <button onClick={handleCreateContact} disabled={creating || !newName.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700 disabled:opacity-50">
              {creating ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Criar e vincular
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[#e0ded8] p-4 text-center">
          <UserIcon size={22} className="mx-auto text-slate-300 mb-2" />
          <p className="text-[12.5px] font-semibold text-slate-600">Sem cliente associado</p>
          <p className="text-[11.5px] text-slate-400 mt-1">Nenhum cadastro com este telefone. Vincule manualmente para ver processos, prazos e documentos aqui.</p>
          <div className="flex items-center justify-center gap-2 mt-3">
            <button onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f3f2ef] hover:bg-amber-50 text-slate-600 hover:text-amber-700 text-[12px] font-semibold transition">
              <Link2 size={13} /> Buscar cliente
            </button>
            <button onClick={() => { setNewName(conversation.contact_name || ''); setCreateMode(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f3f2ef] hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 text-[12px] font-semibold transition">
              <UserPlus size={13} /> Criar contato
            </button>
          </div>
        </div>
      )}
      {pickerOpen && <ClientPickerModal phone={conversation.contact_phone} onClose={() => setPickerOpen(false)} onPick={c => link(c.id, c)} />}
    </div>
  );
};

// ── Processos do cliente (Seção 8) ──
const PROC_STATUS: Record<ProcessStatus, { label: string; badge: string }> = {
  nao_protocolado: { label: 'Não protocolado', badge: 'bg-slate-100 text-slate-600' },
  distribuido: { label: 'Distribuído', badge: 'bg-amber-100 text-amber-700' },
  aguardando_confeccao: { label: 'Aguardando confecção', badge: 'bg-blue-100 text-blue-700' },
  citacao: { label: 'Citação', badge: 'bg-cyan-100 text-cyan-700' },
  conciliacao: { label: 'Conciliação', badge: 'bg-teal-100 text-teal-700' },
  contestacao: { label: 'Contestação', badge: 'bg-orange-100 text-orange-700' },
  instrucao: { label: 'Instrução', badge: 'bg-indigo-100 text-indigo-700' },
  andamento: { label: 'Em andamento', badge: 'bg-emerald-100 text-emerald-700' },
  sentenca: { label: 'Sentença', badge: 'bg-purple-100 text-purple-700' },
  recurso: { label: 'Recurso', badge: 'bg-yellow-100 text-yellow-700' },
  cumprimento: { label: 'Cumprimento', badge: 'bg-rose-100 text-rose-700' },
  arquivado: { label: 'Arquivado', badge: 'bg-slate-100 text-slate-500' },
};
const PROC_AREA: Record<ProcessPracticeArea, string> = {
  trabalhista: 'Trabalhista', familia: 'Família', consumidor: 'Consumidor',
  previdenciario: 'Previdenciário', civel: 'Cível',
};

/** Linha do tempo compacta do processo (Seção 9): movimentações DataJud locais.
 *  `movements` pode vir pré-carregado em lote pelo painel (evita N+1); só busca
 *  sozinho quando não recebe a lista pronta (uso isolado/fallback). */
const ProcessTimelineMini: React.FC<{ processId: string; movements?: ProcessMovement[] }> = ({ processId, movements }) => {
  const [movs, setMovs] = useState<ProcessMovement[] | null>(movements ?? null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (movements !== undefined) { setMovs(movements); return; } // lista veio do painel
    let alive = true;
    setMovs(null); setShowAll(false);
    processService.listProcessMovements(processId)
      .then(list => { if (alive) setMovs(list); })
      .catch(() => { if (alive) setMovs([]); });
    return () => { alive = false; };
  }, [processId, movements]);

  if (movs === null) {
    return <div className="mt-2 pl-1 flex items-center gap-2 text-[11px] text-slate-400"><Loader2 size={12} className="animate-spin" /> Carregando movimentações…</div>;
  }
  if (movs.length === 0) {
    return <p className="mt-2 pl-1 text-[11px] text-slate-400">Sem movimentações sincronizadas.</p>;
  }

  const visible = showAll ? movs : movs.slice(0, 4);
  return (
    <div className="mt-2.5 pl-1">
      <ol className="relative border-l border-[#e7e5df] ml-1 space-y-2.5">
        {visible.map(m => (
          <li key={m.id} className="pl-3 relative">
            <span className="absolute -left-[4.5px] top-1 w-2 h-2 rounded-full bg-amber-400" />
            <p className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
              <Clock size={10} className="text-slate-400" />
              {new Date(m.data_hora).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
            </p>
            <p className="text-[12px] text-slate-700 leading-snug">{m.nome}</p>
          </li>
        ))}
      </ol>
      {movs.length > 4 && (
        <button onClick={() => setShowAll(s => !s)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:underline">
          {showAll ? <><ChevronUp size={12} /> Ver menos</> : <><ChevronDown size={12} /> Ver mais {movs.length - 4} movimentações</>}
        </button>
      )}
    </div>
  );
};

// ── Painel de Casos 360: processos + requerimentos + ações workspace ──────────
type WaOpenWorkspaceFn = (modal: WaModal) => void;

const REQ_STATUS_BADGE: Record<string, string> = {
  aguardando_confeccao: 'bg-blue-100 text-blue-700',
  em_analise: 'bg-sky-100 text-sky-700',
  em_exigencia: 'bg-orange-100 text-orange-700',
  aguardando_pericia: 'bg-violet-100 text-violet-700',
  deferido: 'bg-emerald-100 text-emerald-700',
  indeferido: 'bg-red-100 text-red-700',
  ajuizado: 'bg-amber-100 text-amber-700',
};
const REQ_STATUS_LABEL: Record<string, string> = {
  aguardando_confeccao: 'Aguard. confecção',
  em_analise: 'Em análise',
  em_exigencia: 'Em exigência',
  aguardando_pericia: 'Aguard. perícia',
  deferido: 'Deferido',
  indeferido: 'Indeferido',
  ajuizado: 'Ajuizado',
};

const CasosPanel: React.FC<{
  clientId: string;
  clientName?: string;
  processes: Process[] | null;
  pendings: ClientPendings | null;
  onOpenWorkspace: WaOpenWorkspaceFn;
}> = ({ clientId, clientName, processes: procs, pendings, onOpenWorkspace }) => {
  const [openTimeline, setOpenTimeline] = useState<string | null>(null);
  const [movsByProc, setMovsByProc] = useState<Record<string, ProcessMovement[]> | null>(null);

  const procIds = useMemo(() => (procs || []).map(p => p.id), [procs]);
  useEffect(() => {
    if (procIds.length === 0) { setMovsByProc({}); return; }
    let alive = true;
    processService.listProcessMovementsBatch(procIds)
      .then(map => { if (alive) setMovsByProc(map); })
      .catch(() => { if (alive) setMovsByProc({}); });
    return () => { alive = false; };
  }, [procIds]);

  const requirements: Requirement[] = (pendings as any)?.requirements ?? [];
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const totalCount = (procs?.length ?? 0) + requirements.length;
  const loading = procs === null;

  return (
    <div className="mt-2 space-y-2">
      {/* Cabeçalho único: Casos (processos + requerimentos juntos) */}
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
          Casos {!loading ? `(${totalCount})` : ''}
        </p>
        <div className="flex items-center gap-1">
          <button onClick={() => onOpenWorkspace({ type: 'case_process_create', clientId, clientName })}
            title="Novo processo"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10.5px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 transition">
            <Plus size={11} /> Processo
          </button>
          <button onClick={() => onOpenWorkspace({ type: 'case_requirement_create', clientId, clientName })}
            title="Novo requerimento"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10.5px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 transition">
            <Plus size={11} /> Req.
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-[#e7e5df] p-2.5 flex items-center gap-2 text-slate-400 text-[12.5px]">
          <Loader2 size={14} className="animate-spin" /> Carregando casos…
        </div>
      ) : totalCount === 0 ? (
        <div className="rounded-lg border border-dashed border-[#e0ded8] p-2.5 text-[12px] text-slate-400 flex items-center gap-2">
          <Scale size={14} className="text-slate-300" /> Nenhum processo ou requerimento.
        </div>
      ) : (
        <div className="space-y-2">
          {/* Processos */}
          {[...(procs ?? [])].sort((a, b) => (b.priority === 'urgente' ? 1 : 0) - (a.priority === 'urgente' ? 1 : 0)).map(p => {
            const st = PROC_STATUS[p.status] || { label: p.status, badge: 'bg-slate-100 text-slate-600' };
            const urgent = p.priority === 'urgente';
            const hearing = p.hearing_scheduled && p.hearing_date ? new Date(p.hearing_date + 'T00:00:00') : null;
            const hearingFuture = hearing && hearing >= today;
            return (
              <div key={p.id} className={`rounded-lg border p-2.5 ${urgent ? 'border-red-200 bg-red-50/40' : 'border-[#e7e5df]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12px] font-semibold text-slate-700 truncate">{p.process_code || 'Sem número'}</span>
                  {urgent && <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-600">Urgente</span>}
                </div>
                {/* Status, tipo, Timeline e movimentações na MESMA linha */}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.badge}`}>{st.label}</span>
                  <span className="text-[11px] text-slate-400">{PROC_AREA[p.practice_area] || p.practice_area}</span>
                  <button onClick={() => onOpenWorkspace({ type: 'timeline_process', processId: p.id, processCode: p.process_code, clientName })}
                    className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-500 hover:text-amber-700 transition">
                    <Clock size={10} /> Timeline
                  </button>
                  <button onClick={() => setOpenTimeline(id => id === p.id ? null : p.id)}
                    className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold text-slate-500 hover:text-amber-700 transition">
                    {openTimeline === p.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />} movimentações
                  </button>
                </div>
                {hearingFuture && (
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                    <Calendar size={12} /> Audiência {hearing!.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                    {p.hearing_time ? ` às ${p.hearing_time.slice(0, 5)}` : ''}
                  </p>
                )}
                {openTimeline === p.id && <ProcessTimelineMini processId={p.id} movements={movsByProc?.[p.id]} />}
              </div>
            );
          })}

          {/* Requerimentos no mesmo bloco */}
          {requirements.map((r: Requirement) => (
            <div key={r.id} className="rounded-lg border border-[#e7e5df] p-2.5">
              <p className="text-[12.5px] font-semibold text-slate-700 truncate">{r.beneficiary}</p>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${REQ_STATUS_BADGE[r.status] || 'bg-slate-100 text-slate-500'}`}>
                  {REQ_STATUS_LABEL[r.status] || r.status}
                </span>
                <span className="text-[11px] text-slate-400">Requerimento</span>
                {r.protocol && <span className="text-[11px] text-slate-400 font-mono">{r.protocol}</span>}
                <button onClick={() => onOpenWorkspace({ type: 'case_requirement_edit', requirementId: r.id })}
                  className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-500 hover:text-amber-700 transition">
                  <Pencil size={10} /> Editar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Alias de compatibilidade para o painel antigo (usado via prop no aside)
const ClientProcessesPanel: React.FC<{ processes: Process[] | null }> = ({ processes: procs }) => {
  const [openTimeline, setOpenTimeline] = useState<string | null>(null);
  // Movimentações de todos os processos em UMA query (anti-N+1): a mini timeline
  // de cada processo consome a fatia já carregada em vez de buscar sozinha.
  const [movsByProc, setMovsByProc] = useState<Record<string, ProcessMovement[]> | null>(null);

  const procIds = useMemo(() => (procs || []).map(p => p.id), [procs]);
  useEffect(() => {
    if (procIds.length === 0) { setMovsByProc({}); return; }
    let alive = true;
    setMovsByProc(null);
    processService.listProcessMovementsBatch(procIds)
      .then(map => { if (alive) setMovsByProc(map); })
      .catch(() => { if (alive) setMovsByProc({}); });
    return () => { alive = false; };
  }, [procIds]);

  if (procs === null) {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Processos</p>
        <div className="rounded-xl border border-[#e7e5df] p-3 flex items-center gap-2 text-slate-400 text-[12.5px]">
          <Loader2 size={14} className="animate-spin" /> Carregando processos…
        </div>
      </div>
    );
  }
  if (procs.length === 0) {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Processos</p>
        <div className="rounded-xl border border-dashed border-[#e0ded8] p-3 text-[12px] text-slate-400 flex items-center gap-2">
          <Scale size={14} className="text-slate-300" /> Nenhum processo cadastrado.
        </div>
      </div>
    );
  }

  // Urgentes e audiências futuras primeiro.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sorted = [...procs].sort((a, b) => {
    const ua = a.priority === 'urgente' ? 1 : 0;
    const ub = b.priority === 'urgente' ? 1 : 0;
    return ub - ua;
  });

  return (
    <div className="mt-2 space-y-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
        Processos <span className="text-slate-300">({procs.length})</span>
      </p>
      <div className="space-y-2">
        {sorted.map(p => {
          const st = PROC_STATUS[p.status] || { label: p.status, badge: 'bg-slate-100 text-slate-600' };
          const urgent = p.priority === 'urgente';
          const hearing = p.hearing_scheduled && p.hearing_date ? new Date(p.hearing_date + 'T00:00:00') : null;
          const hearingFuture = hearing && hearing >= today;
          return (
            <div key={p.id}
              className={`rounded-xl border p-3 ${urgent ? 'border-red-200 bg-red-50/40' : 'border-[#e7e5df]'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[12px] font-semibold text-slate-700 truncate">
                  {p.process_code || 'Sem número'}
                </span>
                {urgent && (
                  <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-600">Urgente</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.badge}`}>{st.label}</span>
                <span className="text-[11px] text-slate-400">{PROC_AREA[p.practice_area] || p.practice_area}</span>
              </div>
              {hearingFuture && (
                <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                  <Calendar size={12} /> Audiência {hearing!.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                  {p.hearing_time ? ` às ${p.hearing_time.slice(0, 5)}` : ''}
                </p>
              )}
              <button onClick={() => setOpenTimeline(id => id === p.id ? null : p.id)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-amber-700 transition">
                <Clock size={12} />
                {openTimeline === p.id ? 'Ocultar linha do tempo' : 'Ver linha do tempo'}
                {openTimeline === p.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {openTimeline === p.id && <ProcessTimelineMini processId={p.id} movements={movsByProc?.[p.id]} />}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Agenda do cliente: prazos + compromissos (Seção 10) ──
const EVENT_TYPE_LABEL: Record<CalendarEventType, string> = {
  deadline: 'Prazo', hearing: 'Audiência', requirement: 'Requerimento',
  payment: 'Pagamento', meeting: 'Reunião', pericia: 'Perícia', personal: 'Pessoal',
};

/** Classifica um vencimento (data ISO/yyyy-mm-dd) em alerta visual. */
const TONE: Record<'red' | 'amber' | 'slate', string> = {
  red: 'text-red-600 bg-red-50 border-red-200',
  amber: 'text-amber-700 bg-amber-50 border-amber-200',
  slate: 'text-slate-500 bg-white border-[#e7e5df]',
};

const ClientAgendaPanel: React.FC<{ schedule: ClientSchedule | null }> = ({ schedule: data }) => {
  if (data === null) {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Agenda</p>
        <div className="rounded-xl border border-[#e7e5df] p-3 flex items-center gap-2 text-slate-400 text-[12.5px]">
          <Loader2 size={14} className="animate-spin" /> Carregando agenda…
        </div>
      </div>
    );
  }
  if (data.deadlines.length === 0 && data.events.length === 0) return null;

  const deadlines = data.deadlines.slice(0, 5);
  const events = data.events.slice(0, 5);

  return (
    <div className="mt-2 space-y-3">
      {deadlines.length > 0 && (
        <div className="space-y-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
            Prazos <span className="text-slate-300">({data.deadlines.length})</span>
          </p>
          <div className="space-y-1.5">
            {deadlines.map(d => {
              const di = dueInfo(d.due);
              return (
                <div key={d.id} className={`rounded-lg border px-2.5 py-2 ${TONE[di.tone]}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-slate-700 truncate">{d.title}</span>
                    <span className={`flex-shrink-0 inline-flex items-center gap-1 text-[10.5px] font-bold ${di.tone === 'slate' ? 'text-slate-400' : ''}`}>
                      {di.tone === 'red' && <AlertCircle size={11} />} {di.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="space-y-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
            Compromissos <span className="text-slate-300">({data.events.length})</span>
          </p>
          <div className="space-y-1.5">
            {events.map(e => {
              const dt = new Date(e.start_at);
              return (
                <div key={e.id} className="rounded-lg border border-[#e7e5df] px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-slate-700 truncate">{e.title}</span>
                    <span className="flex-shrink-0 inline-flex items-center gap-1 text-[10.5px] font-semibold text-amber-700">
                      <Calendar size={11} />
                      {dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} {dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <span className="text-[10.5px] text-slate-400">{EVENT_TYPE_LABEL[e.event_type] || e.event_type}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Pendências do cliente: requerimentos + documentos (Seção 11) ──
const REQ_STATUS: Record<RequirementStatus, { label: string; badge: string }> = {
  aguardando_confeccao: { label: 'Aguardando confecção', badge: 'bg-slate-100 text-slate-600' },
  em_analise: { label: 'Em análise', badge: 'bg-blue-100 text-blue-700' },
  em_exigencia: { label: 'Em exigência', badge: 'bg-red-100 text-red-700' },
  aguardando_pericia: { label: 'Aguardando perícia', badge: 'bg-amber-100 text-amber-700' },
  deferido: { label: 'Deferido', badge: 'bg-emerald-100 text-emerald-700' },
  indeferido: { label: 'Indeferido', badge: 'bg-slate-100 text-slate-500' },
  ajuizado: { label: 'Ajuizado', badge: 'bg-indigo-100 text-indigo-700' },
};
const DOC_STATUS_LABEL: Record<string, string> = { pending: 'Aguardando envio', partial: 'Envio parcial' };

const ClientPendingsPanel: React.FC<{ pendings: ClientPendings | null; confirm?: ConfirmFn; onChanged?: () => void }> = ({ pendings: data, confirm, onChanged }) => {
  const toast = useToastContext();
  const [canceling, setCanceling] = useState<string | null>(null);

  const cancelDocRequest = async (id: string, title: string) => {
    if (confirm && !await confirm({ title: 'Cancelar solicitação', message: `A solicitação "${title}" deixará de ser cobrada do cliente e sai das pendências.`, confirmLabel: 'Cancelar solicitação', tone: 'danger' })) return;
    setCanceling(id);
    try { await whatsappService.cancelDocumentRequest(id); onChanged?.(); }
    catch (e: any) { toast.error('Falha ao cancelar solicitação', e.message); }
    finally { setCanceling(null); }
  };

  if (data === null) {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Pendências</p>
        <div className="rounded-xl border border-[#e7e5df] p-3 flex items-center gap-2 text-slate-400 text-[12.5px]">
          <Loader2 size={14} className="animate-spin" /> Carregando pendências…
        </div>
      </div>
    );
  }
  if (data.requirements.length === 0 && data.documents.length === 0) return null;

  return (
    <div className="mt-2 space-y-3">
      {data.requirements.length > 0 && (
        <div className="space-y-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
            Requerimentos <span className="text-slate-300">({data.requirements.length})</span>
          </p>
          <div className="space-y-1.5">
            {data.requirements.slice(0, 5).map(r => {
              const st = REQ_STATUS[r.status] || { label: r.status, badge: 'bg-slate-100 text-slate-600' };
              const exig = r.status === 'em_exigencia' && r.exigency_due_date ? dueInfo(r.exigency_due_date) : null;
              return (
                <div key={r.id} className="rounded-lg border border-[#e7e5df] px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-slate-700 truncate">{r.beneficiary || r.protocol || 'Requerimento'}</span>
                    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.badge}`}>{st.label}</span>
                  </div>
                  {r.protocol && <span className="text-[10.5px] text-slate-400">Protocolo {r.protocol}</span>}
                  {exig && (
                    <p className={`mt-0.5 inline-flex items-center gap-1 text-[10.5px] font-bold ${exig.tone === 'red' ? 'text-red-600' : 'text-amber-700'}`}>
                      <AlertCircle size={10} /> Exigência {exig.label}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.documents.length > 0 && (
        <div className="space-y-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
            Documentos pendentes <span className="text-slate-300">({data.documents.length})</span>
          </p>
          <div className="space-y-1.5">
            {data.documents.slice(0, 5).map(d => {
              const di = d.due_date ? dueInfo(d.due_date) : null;
              const total = d.items.length;
              const done = d.items.filter(i => i.status === 'approved').length;
              return (
                <div key={d.id} className={`group rounded-lg border px-2.5 py-2 ${di && di.tone === 'red' ? TONE.red : 'border-[#e7e5df]'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-slate-700 truncate">{d.title}</span>
                    <span className="flex-shrink-0 inline-flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-500">
                        <FileText size={11} /> {total > 0 ? `${done}/${total}` : (DOC_STATUS_LABEL[d.status] || d.status)}
                      </span>
                      {confirm && (
                        <button onClick={() => cancelDocRequest(d.id, d.title)} disabled={canceling === d.id}
                          title="Cancelar solicitação" className="p-0.5 rounded text-slate-300 opacity-0 group-hover:opacity-100 hover:text-rose-500 transition disabled:opacity-50">
                          {canceling === d.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                        </button>
                      )}
                    </span>
                  </div>
                  {di && <span className={`text-[10.5px] font-semibold ${di.tone === 'red' ? 'text-red-600' : 'text-slate-400'}`}>{di.label}</span>}
                  {total > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {d.items.map(it => {
                        const ok = it.status === 'approved';
                        const sent = it.status === 'uploaded';
                        const rejected = it.status === 'rejected';
                        return (
                          <li key={it.id} className="flex items-center gap-1.5 text-[11.5px]">
                            {ok ? <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />
                              : sent ? <Clock size={12} className="text-sky-500 flex-shrink-0" />
                              : rejected ? <X size={12} className="text-rose-500 flex-shrink-0" />
                              : <span className="w-2 h-2 rounded-full border border-slate-300 flex-shrink-0 ml-[2px]" />}
                            <span className={`truncate ${ok ? 'line-through text-slate-400' : rejected ? 'text-rose-500' : 'text-slate-600'}`}>
                              {it.label}{!it.required && <span className="text-slate-300"> · opcional</span>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Assinaturas pendentes do cliente (Fase G) ──
const ClientSignaturesPanel: React.FC<{
  signatures: import('../types/signature.types').SignatureRequestWithSigners[] | null;
  links?: import('../services/whatsapp/shared').ClientTemplateFillLink[] | null;
  onStopTracking?: (linkId: string) => void;
  onStopSignatureTracking?: (requestId: string) => void;
}> = ({ signatures, links, onStopTracking, onStopSignatureTracking }) => {
  const toast = useToastContext();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const activeLinks = (links ?? []).filter(link => !link.followup_stopped && link.status !== 'cancelled' && link.status !== 'expired');
  const pending = (signatures ?? []).filter((s) => {
    if (s.status !== 'pending' || s.archived_at || s.deleted_at || (s as any).wa_tracking_stopped) return false;
    const linked = activeLinks.find(link => link.signature_request_id === s.id);
    return linked ? !linked.followup_stopped : true;
  });
  if (pending.length === 0) return null;

  // Copia o link público de assinatura (/#/assinar/<token>) do signatário — para
  // enviar ao cliente pelo WhatsApp, espelhando o link de documento.
  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(signatureService.generatePublicSigningUrl(token));
      setCopiedToken(token);
      toast.success('Link de assinatura copiado.');
      setTimeout(() => setCopiedToken(t => (t === token ? null : t)), 2000);
    } catch (e: any) {
      toast.error('Não foi possível copiar o link', e?.message);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
        <PenLine size={10} /> Assinaturas pendentes
        <span className="ml-auto px-1.5 py-px rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold">{pending.length}</span>
      </p>
      <div className="rounded-xl border border-[#e7e5df] divide-y divide-[#f1f0ec] overflow-hidden">
        {pending.map(s => {
          const exp = s.expires_at ? dueInfo(s.expires_at) : null;
          const linked = activeLinks.find(link => link.signature_request_id === s.id) ?? null;
          // Signatários ainda sem assinar e com link público disponível.
          const openSigners = (s.signers ?? []).filter(sg => sg.status !== 'signed' && !sg.refused_at && sg.public_token);
          return (
            <div key={s.id} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-slate-800 truncate">{s.document_name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[9.5px] font-semibold bg-amber-100 text-amber-700">
                      <Clock size={9} /> Aguardando assinatura
                    </span>
                    {exp && (
                      <span className={`text-[10.5px] font-semibold ${exp.tone === 'red' ? 'text-red-600' : exp.tone === 'amber' ? 'text-amber-600' : 'text-slate-400'}`}>
                        {exp.label}
                      </span>
                    )}
                  </div>
                </div>
                {(linked || onStopSignatureTracking) && (
                  <button
                    onClick={() => linked ? onStopTracking?.(linked.id) : onStopSignatureTracking?.(s.id)}
                    title="Parar de acompanhar"
                    className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-600 hover:text-white transition flex-shrink-0"
                  >
                    <X size={11} strokeWidth={2.75} />
                  </button>
                )}
              </div>
              {/* Links públicos por signatário — copiar e enviar ao cliente */}
              {openSigners.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {openSigners.map(sg => {
                    const copied = copiedToken === sg.public_token;
                    return (
                      <div key={sg.id} className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 truncate flex-1">{sg.name || sg.email || 'Signatário'}</span>
                        <button onClick={() => copyLink(sg.public_token!)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 transition flex-shrink-0">
                          {copied ? <Check size={11} /> : <Link2 size={11} />}
                          {copied ? 'Copiado' : 'Link'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Acordos/contratos financeiros ativos (Fase G) ──
const ClientAgreementsPanel: React.FC<{
  agreements: import('../types/financial.types').Agreement[] | null;
  onOpenWorkspace?: WaOpenWorkspaceFn;
}> = ({ agreements, onOpenWorkspace }) => {
  const list = agreements ?? [];
  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const STATUS_CLS: Record<string, string> = {
    ativo: 'bg-emerald-100 text-emerald-700', pendente: 'bg-amber-100 text-amber-700',
    concluido: 'bg-slate-100 text-slate-500', cancelado: 'bg-red-100 text-red-600',
  };
  const STATUS_LABEL: Record<string, string> = { ativo: 'Ativo', pendente: 'Pendente', concluido: 'Concluído', cancelado: 'Cancelado' };
  return (
    <div className="space-y-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
        <HandCoins size={10} /> Financeiro
      </p>
      {list.length === 0 ? (
        <p className="text-[12px] text-slate-400">Nenhum lançamento para este cliente.</p>
      ) : (
        <div className="rounded-xl border border-[#e7e5df] divide-y divide-[#f1f0ec] overflow-hidden">
          {list.map(a => (
            <button key={a.id} type="button"
              onClick={() => onOpenWorkspace?.({ type: 'financial_view', agreementId: a.id })}
              className="w-full text-left px-3 py-2.5 hover:bg-amber-50/60 transition">
              <div className="flex items-start justify-between gap-1">
                <p className="text-[12.5px] font-semibold text-slate-800 truncate flex-1">{a.title}</p>
                <span className={`flex-shrink-0 px-1.5 py-px rounded text-[9.5px] font-semibold ${STATUS_CLS[a.status] ?? 'bg-slate-100 text-slate-500'}`}>
                  {STATUS_LABEL[a.status] ?? a.status}
                </span>
              </div>
              <p className="text-[11.5px] text-slate-500 mt-0.5">
                {fmt(a.total_value)} · {a.installments_count > 1 ? `${a.installments_count}×${fmt(a.installment_value)}` : 'À vista'}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Resumo rápido do cliente/processo no topo da thread (Fase 6/10/G) ──
// Cada segmento abre um cartão de detalhes (fade) ao passar o mouse.
const HoverDetail: React.FC<{ trigger: React.ReactNode; width?: string; children: React.ReactNode }> = ({ trigger, width = 'w-72', children }) => (
  <span className="relative group/hd inline-flex items-center gap-1 cursor-default">
    {trigger}
    <span className={`pointer-events-none group-hover/hd:pointer-events-auto absolute left-0 top-full z-40 pt-2 ${width} origin-top-left scale-95 opacity-0 transition-all duration-150 group-hover/hd:scale-100 group-hover/hd:opacity-100`}>
      <span className="block rounded-xl border border-[#e7e5df] bg-white p-3 shadow-xl text-slate-600 normal-case tracking-normal font-normal">
        {children}
      </span>
    </span>
  </span>
);

const DOC_REQ_STATUS_LABEL: Record<string, string> = { pending: 'Aguardando', partial: 'Parcial', complete: 'Concluído', cancelled: 'Cancelado' };

const ConversationSummaryBanner: React.FC<{ overview: ClientOverview | null; docStatus?: 'awaiting' | 'ready' | null; clientId?: string | null; onOpenWorkspace?: WaOpenWorkspaceFn; onDismissDocReady?: () => void; onDismissTemplateFill?: (linkId: string) => void }> = ({ overview, docStatus, clientId, onOpenWorkspace, onDismissDocReady, onDismissTemplateFill }) => {
  if (!overview) return null;
  const s = summarizeOverview(overview);
  // Sem contexto relevante → não polui o topo da thread.
  if (s.processCount === 0 && !s.nextDeadline && !s.nextEvent && s.pendingCount === 0 && s.pendingSignatures === 0 && !docStatus) return null;

  const dl = s.nextDeadline ? dueInfo(s.nextDeadline.due) : null;
  const procs = [...overview.processes].sort((a, b) => (b.priority === 'urgente' ? 1 : 0) - (a.priority === 'urgente' ? 1 : 0));
  const deadlines = overview.schedule.deadlines;
  const events = overview.schedule.events;
  const reqs = overview.pendings.requirements;
  const docs = overview.pendings.documents;
  const activeTrackedFills = [...(overview.templateFillLinks || [])]
    .filter(l => !l.followup_stopped && l.status !== 'cancelled' && l.status !== 'expired');
  const trackedSignatureRequestIds = new Set(activeTrackedFills.map(link => link.signature_request_id).filter(Boolean));
  const activeSignatureRequests = overview.signatures.filter(sig =>
    sig.status === 'pending'
    && !sig.archived_at
    && !sig.deleted_at
    && !(sig as any).wa_tracking_stopped
    && trackedSignatureRequestIds.has(sig.id)
  );
  const openedSignatureCount = activeSignatureRequests.filter(sig =>
    (sig.signers ?? []).some(sg => sg.status === 'pending' && !!sg.last_seen_at && (Date.now() - new Date(sg.last_seen_at).getTime() <= 30_000) && !sg.refused_at)
  ).length;
  const pendingSignatureCount = activeSignatureRequests.filter(sig =>
    !(sig.signers ?? []).some(sg => sg.status === 'pending' && !!sg.last_seen_at && (Date.now() - new Date(sg.last_seen_at).getTime() <= 30_000) && !sg.refused_at)
  ).length;
  const trackedFill = activeTrackedFills
    .sort((a, b) => (b.last_seen_at || b.opened_at || b.submitted_at || b.created_at).localeCompare(a.last_seen_at || a.opened_at || a.submitted_at || a.created_at))[0];
  const trackedReq = trackedFill ? overview.signatures.find(sg => sg.id === trackedFill.signature_request_id) ?? null : null;
  const trackedSigner = trackedReq?.signers?.find(sg => sg.status !== 'signed' && !sg.refused_at) ?? trackedReq?.signers?.[0] ?? null;
  const trackedClosed = trackedReq?.status === 'signed'
    || trackedReq?.status === 'refused'
    || !!trackedReq?.signed_at
    || (trackedReq?.signers ?? []).some(sg => !!sg.signed_at || !!sg.refused_at);
  const trackedActive = !!trackedFill?.last_seen_at && (Date.now() - new Date(trackedFill.last_seen_at).getTime() <= 30_000);
  let fillLabel: string | null = null;
  let fillTone = 'bg-slate-100 text-slate-600';
  if (trackedFill && !trackedClosed) {
    if (trackedSigner?.signed_at || trackedReq?.status === 'signed') {
      fillLabel = 'Kit assinado';
      fillTone = 'bg-emerald-100 text-emerald-700';
    } else if (trackedSigner?.refused_at || trackedReq?.status === 'refused') {
      fillLabel = 'Kit recusado';
      fillTone = 'bg-rose-100 text-rose-700';
    } else if (trackedSigner?.last_seen_at && (Date.now() - new Date(trackedSigner.last_seen_at).getTime() <= 30_000)) {
      fillLabel = 'Página de assinatura aberta';
      fillTone = 'bg-sky-100 text-sky-700';
    } else if (trackedSigner?.viewed_at || trackedSigner?.opened_at) {
      fillLabel = 'Saiu sem assinar';
      fillTone = 'bg-orange-100 text-orange-700';
    } else if (trackedFill.submitted_at || trackedReq) {
      fillLabel = 'Kit preenchido';
      fillTone = 'bg-amber-100 text-amber-700';
    } else if (trackedActive) {
      fillLabel = 'Cliente na tela do kit';
      fillTone = 'bg-violet-100 text-violet-700';
    } else if (trackedFill.last_seen_at) {
      // Já saiu da tela — mostra "visto por último" em vez de travar em "aberta".
      fillLabel = `Saiu do kit — ${lastSeenLabel(trackedFill.last_seen_at)}`;
      fillTone = 'bg-blue-100 text-blue-700';
    } else if (trackedFill.opened_at) {
      fillLabel = 'Página do kit aberta';
      fillTone = 'bg-blue-100 text-blue-700';
    } else {
      fillLabel = 'Link do kit enviado';
      fillTone = 'bg-slate-100 text-slate-600';
    }
  }
  return (
    <div className="flex items-center gap-x-4 gap-y-1 flex-wrap px-5 py-2 bg-amber-50/70 border-b border-amber-100 text-[12px] text-slate-600">
      <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wide text-[10px] text-amber-800">
        <UserCheck size={12} /> Resumo
      </span>
      {docStatus && (
        <span className={`inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded text-[11px] font-semibold ${docStatus === 'awaiting' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
          <FileText size={12} /> {docStatus === 'awaiting' ? 'Aguardando documentos solicitados' : 'Documentos prontos'}
          {docStatus === 'ready' && onDismissDocReady && (
            <button onClick={onDismissDocReady} title="Fechar aviso"
              className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-emerald-200/70 text-emerald-700 hover:bg-emerald-600 hover:text-white transition">
              <X size={11} strokeWidth={2.75} />
            </button>
          )}
        </span>
      )}
      {trackedFill && fillLabel && (
        <span className={`inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded text-[11px] font-semibold ${fillTone}`}>
          <FilePlus size={12} /> {fillLabel}
          {onDismissTemplateFill && (
            <button onClick={() => onDismissTemplateFill(trackedFill.id)} title="Fechar aviso"
              className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-black/10 hover:bg-slate-600 hover:text-white transition">
              <X size={11} strokeWidth={2.75} />
            </button>
          )}
        </span>
      )}
      {s.processCount > 0 && (
        <HoverDetail trigger={
          <span className="inline-flex items-center gap-1">
            <Scale size={13} className="text-slate-400" />
            <strong className="text-slate-700">{s.processCount}</strong> processo{s.processCount > 1 ? 's' : ''}
            {s.urgentCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-600">{s.urgentCount} urgente{s.urgentCount > 1 ? 's' : ''}</span>
            )}
          </span>
        } width="w-96">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Processos ({procs.length})</p>
          <div className="space-y-2 max-h-80 overflow-auto -mr-1 pr-1">
            {procs.map(p => {
              const st = PROC_STATUS[p.status] || { label: p.status, badge: 'bg-slate-100 text-slate-600' };
              const urgent = p.priority === 'urgente';
              const hearing = p.hearing_scheduled && p.hearing_date ? new Date(p.hearing_date + 'T00:00:00') : null;
              const hearingFuture = hearing && hearing >= new Date(new Date().toDateString());
              const openTimeline = onOpenWorkspace
                ? () => onOpenWorkspace({ type: 'timeline_process', processId: p.id, processCode: p.process_code || 'Sem número' })
                : undefined;
              return (
                <button key={p.id} type="button" onClick={openTimeline} disabled={!openTimeline}
                  className={`w-full text-left rounded-lg border p-2.5 transition ${urgent ? 'border-red-200 bg-red-50/40' : 'border-[#eceae4] bg-[#faf9f7]'} ${openTimeline ? 'hover:border-amber-300 hover:bg-amber-50/60 cursor-pointer' : 'cursor-default'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12px] font-semibold text-slate-800 truncate inline-flex items-center gap-1">{p.process_code || 'Sem número'}{openTimeline && <History size={11} className="text-amber-500 flex-shrink-0" />}</span>
                    {urgent && <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-600">Urgente</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-semibold ${st.badge}`}>{st.label}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9.5px] font-medium bg-slate-100 text-slate-500">{PROC_AREA[p.practice_area] || p.practice_area}</span>
                  </div>
                  <div className="mt-1.5 space-y-1 text-[11px] text-slate-500">
                    {p.court && <p className="flex items-start gap-1.5"><MapPin size={11} className="mt-px flex-shrink-0 text-slate-400" /><span className="leading-snug">{p.court}</span></p>}
                    {p.responsible_lawyer && <p className="flex items-center gap-1.5"><UserIcon size={11} className="flex-shrink-0 text-slate-400" /> {p.responsible_lawyer}</p>}
                    {p.distributed_at && <p className="flex items-center gap-1.5"><Calendar size={11} className="flex-shrink-0 text-slate-400" /> Distribuído em {new Date(p.distributed_at).toLocaleDateString('pt-BR')}</p>}
                    {hearingFuture && (
                      <p className="flex items-center gap-1.5 font-semibold text-amber-700"><CalendarClock size={11} className="flex-shrink-0" /> Audiência {hearing!.toLocaleDateString('pt-BR')}{p.hearing_time ? ` às ${p.hearing_time.slice(0, 5)}` : ''}{p.hearing_mode ? ` · ${p.hearing_mode === 'online' ? 'Online' : 'Presencial'}` : ''}</p>
                    )}
                  </div>
                  {p.notes && <p className="mt-1.5 text-[11px] text-slate-400 leading-snug line-clamp-2 whitespace-pre-wrap">{p.notes}</p>}
                </button>
              );
            })}
          </div>
        </HoverDetail>
      )}
      {s.nextDeadline && (
        <HoverDetail trigger={
          <span className="inline-flex items-center gap-1">
            <Calendar size={13} className="text-slate-400" />
            Próx. prazo: <strong className="text-slate-700 truncate max-w-[180px]">{s.nextDeadline.title}</strong>
            {dl && <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${dl.tone === 'red' ? 'text-red-600 bg-red-50' : dl.tone === 'amber' ? 'text-amber-700 bg-amber-50' : 'text-slate-500 bg-slate-100'}`}>{dl.label}</span>}
          </span>
        } width="w-80">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Prazos abertos ({deadlines.length})</p>
          <div className="space-y-2 max-h-72 overflow-auto -mr-1 pr-1">
            {deadlines.map(d => {
              const di = dueInfo(d.due);
              const due = new Date(d.due + (d.due.length <= 10 ? 'T00:00:00' : ''));
              const openDeadline = !onOpenWorkspace ? undefined
                : d.kind === 'event' ? () => onOpenWorkspace({ type: 'calendar_view', eventId: d.id })
                : clientId ? () => onOpenWorkspace({ type: 'deadline_edit', deadlineId: d.id, clientId }) : undefined;
              return (
                <button key={d.id} type="button" onClick={openDeadline} disabled={!openDeadline}
                  className={`w-full text-left rounded-lg border border-[#eceae4] bg-[#faf9f7] p-2.5 transition ${openDeadline ? 'hover:border-amber-300 hover:bg-amber-50/60 cursor-pointer' : 'cursor-default'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[12px] font-medium text-slate-700 leading-snug inline-flex items-center gap-1">{d.title}{openDeadline && <Pencil size={10} className="text-amber-500 flex-shrink-0" />}</span>
                    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${di.tone === 'red' ? 'text-red-600 bg-red-50' : di.tone === 'amber' ? 'text-amber-700 bg-amber-50' : 'text-slate-500 bg-slate-100'}`}>{di.label}</span>
                  </div>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Calendar size={11} className="text-slate-400" />
                    {due.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </p>
                </button>
              );
            })}
          </div>
        </HoverDetail>
      )}
      {s.nextEvent && events[0] && (
        <HoverDetail trigger={
          <span className="inline-flex items-center gap-1">
            <Clock size={13} className="text-slate-400" />
            <strong className="text-slate-700 truncate max-w-[160px]">{s.nextEvent.title}</strong>
            <span className="text-slate-400">{new Date(s.nextEvent.start_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
          </span>
        }>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Próximo compromisso</p>
          <button type="button" disabled={!onOpenWorkspace}
            onClick={onOpenWorkspace ? () => onOpenWorkspace({ type: 'calendar_view', eventId: events[0].id }) : undefined}
            className={`block w-full text-left rounded-lg p-1.5 -mx-1.5 transition ${onOpenWorkspace ? 'hover:bg-amber-50/60 cursor-pointer' : 'cursor-default'}`}>
            <span className="text-[12.5px] font-semibold text-slate-800 leading-snug inline-flex items-center gap-1">{events[0].title}{onOpenWorkspace && <Pencil size={10} className="text-amber-500 flex-shrink-0" />}</span>
            <span className="mt-1 flex items-center gap-1 text-[11.5px] text-amber-700"><Clock size={11} /> {fmtDateTime(events[0].start_at)}</span>
            {events[0].description && <span className="block mt-1.5 text-[11.5px] text-slate-500 leading-snug whitespace-pre-wrap">{events[0].description}</span>}
          </button>
          {events.length > 1 && <p className="mt-2 text-[11px] text-slate-400">+{events.length - 1} compromisso{events.length - 1 > 1 ? 's' : ''} adiante</p>}
        </HoverDetail>
      )}
      {s.pendingCount > 0 && (
        <HoverDetail trigger={
          <span className="inline-flex items-center gap-1">
            <FileText size={13} className="text-slate-400" />
            <strong className="text-slate-700">{s.pendingCount}</strong> pendência{s.pendingCount > 1 ? 's' : ''}
          </span>
        } width="w-96">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Pendências ({s.pendingCount})</p>
          <div className="space-y-2 max-h-80 overflow-auto -mr-1 pr-1">
            {docs.map(d => {
              const missing = d.items.filter(i => i.status === 'pending' || i.status === 'rejected');
              return (
                <div key={`doc-${d.id}`} className="rounded-lg border border-[#eceae4] bg-[#faf9f7] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <FilePlus size={12} className="text-amber-500 flex-shrink-0" />
                      <span className="text-[12px] font-medium text-slate-700 truncate">{d.title}</span>
                    </span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      {d.due_date && <span className="text-[10px] text-slate-400">{new Date(d.due_date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>}
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-50 text-amber-700">{DOC_REQ_STATUS_LABEL[d.status] || d.status}</span>
                    </span>
                  </div>
                  {d.items.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {d.items.map(it => (
                        <span key={it.id} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${it.status === 'received' || it.status === 'approved' ? 'bg-emerald-50 text-emerald-700 line-through decoration-emerald-400/60' : it.status === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-white border border-[#e7e5df] text-slate-600'}`}>
                          {(it.status === 'received' || it.status === 'approved') && <Check size={9} />}
                          {it.label}{it.required ? '' : ' (opc.)'}
                        </span>
                      ))}
                    </div>
                  )}
                  {missing.length > 0 && <p className="mt-1.5 text-[10.5px] text-amber-600 font-medium">{missing.length} item{missing.length > 1 ? 's' : ''} aguardando o cliente</p>}
                </div>
              );
            })}
            {reqs.map((r: Requirement) => (
              <div key={`req-${r.id}`} className="rounded-lg border border-[#eceae4] bg-[#faf9f7] p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <Scale size={12} className="text-slate-400 flex-shrink-0" />
                    <span className="text-[12px] font-medium text-slate-700 truncate">{r.beneficiary}</span>
                  </span>
                  <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold ${REQ_STATUS_BADGE[r.status] || 'bg-slate-100 text-slate-500'}`}>{REQ_STATUS_LABEL[r.status] || r.status}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                  <span>Requerimento</span>
                  {r.protocol && <span className="font-mono">{r.protocol}</span>}
                </div>
              </div>
            ))}
          </div>
        </HoverDetail>
      )}
      {/* Fase G: assinaturas pendentes no banner */}
      {openedSignatureCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <Eye size={13} className="text-sky-600" />
          <strong className="text-sky-700">{openedSignatureCount}</strong> assinatura{openedSignatureCount > 1 ? 's' : ''} aberta{openedSignatureCount > 1 ? 's' : ''}
        </span>
      )}
      {pendingSignatureCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <PenLine size={13} className="text-amber-600" />
          <strong className="text-amber-700">{pendingSignatureCount}</strong> assinatura{pendingSignatureCount > 1 ? 's' : ''} pendente{pendingSignatureCount > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
};

// ── Notas internas da conversa (Fase 7) — só a equipe vê ──
const InternalNotesPanel: React.FC<{
  conversationId: string;
  staffByUser: Map<string, string>;
  currentUserId: string | null;
  confirm: ConfirmFn;
  embedded?: boolean;
  limit?: number;
  onExpand?: () => void;
}> = ({ conversationId, staffByUser, currentUserId, confirm, embedded, limit, onExpand }) => {
  const toast = useToastContext();
  const [notes, setNotes] = useState<WhatsAppInternalNote[] | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // Painel "Notas internas" = só notas MANUAIS da equipe. Oculta lançamentos
  // automáticos: IA/cron inserem sem autor (author_id null); trilha de "Documentos
  // solicitados"; e notas legadas de navegação de módulo. O histórico completo desses
  // eventos continua disponível na Timeline.
  const isAutomatic = (n: WhatsAppInternalNote) => {
    if (!n.author_id) return true;
    const b = n.body.trim();
    return /^📄\s*Documentos?\s+solicitad/i.test(b)
      || /abert[oa] a partir desta conversa|m[óo]dulo .* abert|iniciada desta conversa/i.test(b);
  };
  const visibleNotes = notes?.filter(n => !isAutomatic(n)) ?? null;

  const load = useCallback(() => {
    whatsappService.listNotes(conversationId).then(setNotes).catch(() => setNotes([]));
  }, [conversationId]);
  useEffect(() => { setNotes(null); load(); }, [conversationId, load]);

  const add = async () => {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    try { await whatsappService.addNote(conversationId, body); setDraft(''); load(); }
    catch (e: any) { toast.error('Falha ao salvar nota', e.message); }
    finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    if (!await confirm({ title: 'Excluir nota', message: 'Esta nota interna será removida.', confirmLabel: 'Excluir', tone: 'danger' })) return;
    try { await whatsappService.deleteNote(id); setNotes(n => (n || []).filter(x => x.id !== id)); }
    catch (e: any) { toast.error('Falha ao excluir', e.message); }
  };

  return (
    <div className="space-y-2">
      {!embedded && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <StickyNote size={12} /> Notas internas{(visibleNotes?.length ?? 0) > 0 ? ` (${visibleNotes!.length})` : ''}
          </p>
          {onExpand && (
            <button onClick={onExpand} title="Abrir em tela cheia"
              className="p-0.5 rounded text-slate-300 hover:text-amber-600 transition"><Maximize2 size={12} /></button>
          )}
        </div>
      )}
      <p className="text-[10.5px] text-slate-400 -mt-1">Só a equipe vê — não vai para o cliente.</p>
      <div className="flex items-start gap-2">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
          placeholder="Anote algo para a equipe…"
          className="flex-1 resize-none px-2.5 py-2 text-[12.5px] rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none" />
        <button onClick={add} disabled={saving || !draft.trim()} title="Adicionar nota (Ctrl+Enter)"
          className="flex-shrink-0 w-9 h-9 rounded-lg bg-amber-600 text-white flex items-center justify-center hover:bg-amber-700 disabled:opacity-50">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />}
        </button>
      </div>
      {notes === null ? (
        <div className="flex items-center gap-2 text-slate-400 text-[12px] py-1"><Loader2 size={13} className="animate-spin" /> Carregando…</div>
      ) : (visibleNotes ?? []).length === 0 ? (
        <p className="text-[11.5px] text-slate-400">Nenhuma nota ainda.</p>
      ) : (() => {
        const all = visibleNotes ?? [];
        const shown = limit ? all.slice(0, limit) : all;
        const hidden = all.length - shown.length;
        return (
          <div className="space-y-1.5">
            {shown.map(n => (
              <div key={n.id} className="rounded-lg border border-amber-100 bg-amber-50/50 px-2.5 py-2 group">
                <p className="text-[12.5px] text-slate-700 whitespace-pre-wrap break-words">{n.body}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10.5px] text-slate-400">
                    {(n.author_id && staffByUser.get(n.author_id)) || 'Equipe'} · {fmtNoteDate(n.created_at)}
                  </span>
                  {n.author_id === currentUserId && (
                    <button onClick={() => remove(n.id)} title="Excluir nota"
                      className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><Trash2 size={12} /></button>
                  )}
                </div>
              </div>
            ))}
            {hidden > 0 && (
              <button onClick={onExpand}
                className="w-full text-center py-1.5 text-[11.5px] font-semibold text-amber-600 hover:text-amber-700">
                Ver todas ({all.length}) →
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
};

// Sidebar: mostra só as notas recentes (compacto) e abre o histórico completo em
// modal — evita poluir a coluna lateral quando há muitas notas automáticas da IA.
const InternalNotesSection: React.FC<{
  conversationId: string;
  staffByUser: Map<string, string>;
  currentUserId: string | null;
  confirm: ConfirmFn;
}> = (props) => {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(0); // remonta o painel compacto ao fechar o modal (recarrega)
  return (
    <>
      <InternalNotesPanel key={v} {...props} limit={3} onExpand={() => setOpen(true)} />
      <Modal open={open} onClose={() => { setOpen(false); setV(x => x + 1); }} size="lg"
        title="Notas internas" icon={<StickyNote size={18} />}>
        <ModalBody>
          <InternalNotesPanel {...props} embedded />
        </ModalBody>
      </Modal>
    </>
  );
};

// ── Preview de anexos com legenda antes do envio ──
// Design WhatsApp Web: fundo escuro com preview grande, tira de miniaturas,
// legenda na base. URLs criadas via useEffect (não useMemo) para evitar
// revogação prematura em HMR ou dupla-renderização do StrictMode.
const AttachmentPreviewModal: React.FC<{
  files: File[];
  onClose: () => void;
  onConfirm: (caption: string, files: File[]) => void;
}> = ({ files, onClose, onConfirm }) => {
  const [items, setItems] = useState<File[]>(files);
  const [active, setActive] = useState(0);
  const [caption, setCaption] = useState('');
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const addInputRef = useRef<HTMLInputElement>(null);

  const MAX_BYTES = 100 * 1024 * 1024;
  const addMore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []).filter(f => f.size > 0 && f.size <= MAX_BYTES);
    e.target.value = '';
    if (picked.length) setItems(prev => { const next = [...prev, ...picked]; setActive(next.length - 1); return next; });
  };

  // Gera URLs de blob via efeito — mais robusto que useMemo em HMR/StrictMode.
  useEffect(() => {
    const created = items.map(f =>
      (f.type.startsWith('image/') || f.type.startsWith('video/')) ? URL.createObjectURL(f) : null);
    setUrls(created);
    return () => { created.forEach(u => u && URL.revokeObjectURL(u)); };
  }, [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setActive(a => Math.min(a + 1, items.length - 1));
      if (e.key === 'ArrowLeft') setActive(a => Math.max(a - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, items.length]);

  const removeAt = (i: number) => {
    const next = items.filter((_, idx) => idx !== i);
    if (next.length === 0) { onClose(); return; }
    setActive(a => Math.min(a, next.length - 1));
    setItems(next);
  };

  const cur = items[active];
  const curUrl = urls[active] ?? null;
  const isImg = cur?.type.startsWith('image/');
  const isVid = cur?.type.startsWith('video/');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-[520px] max-w-[96vw] flex flex-col rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 bg-[#0b141a]"
        style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>

        {/* Cabeçalho escuro */}
        <div className="flex items-center gap-3 px-4 py-3 bg-[#202c33]">
          <button onClick={onClose} className="text-white/60 hover:text-white transition flex-shrink-0">
            <X size={20} />
          </button>
          <span className="text-[13px] font-medium text-white/80 truncate flex-1">
            {cur?.name || '—'}
          </span>
          {items.length > 1 && <span className="text-[12px] text-white/40 flex-shrink-0">{active + 1}/{items.length}</span>}
        </div>

        {/* Preview principal */}
        <div className="flex-1 flex items-center justify-center bg-[#0b141a] min-h-0"
          style={{ minHeight: 280, maxHeight: 400 }}>
          {curUrl && isImg ? (
            <img src={curUrl} alt={cur?.name}
              className="max-w-full max-h-full object-contain select-none"
              style={{ maxHeight: 380 }} />
          ) : curUrl && isVid ? (
            <video src={curUrl} controls className="max-w-full max-h-full" style={{ maxHeight: 380 }} />
          ) : cur ? (
            <div className="flex flex-col items-center gap-3 px-8 py-10 text-center">
              <span className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center">
                <FileText size={32} className="text-white/60" />
              </span>
              <p className="text-white/80 text-[13px] font-medium">{cur.name}</p>
              <p className="text-white/40 text-[11px]">{formatBytes(cur.size)}</p>
            </div>
          ) : null}
        </div>

        <input ref={addInputRef} type="file" accept="image/*,video/*,*/*" multiple className="hidden" onChange={addMore} />

        {/* Tira de miniaturas — só quando há mais de 1 item (estilo WhatsApp) */}
        {items.length > 1 && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-[#1a1a1a] overflow-x-auto">
            {items.map((f, i) => {
              const u = urls[i];
              const isActive = i === active;
              return (
                <button key={i} onClick={() => setActive(i)}
                  className={`group/th relative flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-white/5 ring-2 transition ${isActive ? 'ring-[#00a884]' : 'ring-transparent opacity-70 hover:opacity-100'}`}>
                  {u && f.type.startsWith('image/') ? (
                    <img src={u} alt={f.name} className="w-full h-full object-cover" />
                  ) : u && f.type.startsWith('video/') ? (
                    <video src={u} className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full bg-white/10 flex items-center justify-center">
                      <FileText size={16} className="text-white/60" />
                    </span>
                  )}
                  <span onClick={e => { e.stopPropagation(); removeAt(i); }}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover/th:opacity-100 transition cursor-pointer">
                    <X size={9} />
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Rodapé: + adicionar · legenda · enviar (estilo WhatsApp) */}
        <div className="flex items-end gap-2 px-3 py-3 bg-[#202c33]">
          <button onClick={() => addInputRef.current?.click()} title="Adicionar mídia"
            className="flex-shrink-0 w-10 h-10 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white flex items-center justify-center transition">
            <Plus size={20} />
          </button>
          <textarea autoFocus value={caption} onChange={e => setCaption(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onConfirm(caption, items); } }}
            rows={1} placeholder={items.length > 1 ? `Legenda · ${items.length} itens…` : 'Adicionar uma legenda…'}
            className="flex-1 resize-none max-h-28 px-3.5 py-2.5 text-[13.5px] rounded-lg bg-white/10 text-white placeholder:text-white/40 border border-transparent focus:bg-white/15 outline-none" />
          <button onClick={() => onConfirm(caption, items)} title="Enviar"
            className="flex-shrink-0 w-11 h-11 rounded-full bg-[#00a884] text-white flex items-center justify-center hover:bg-[#017561] transition shadow-lg">
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};


// ── Fase M: painel de etiquetas da conversa ──
const ConversationLabelsPanel: React.FC<{
  conversation: WhatsAppConversation;
  onChanged: (conv: WhatsAppConversation) => void;
}> = ({ conversation, onChanged }) => {
  const toast = useToastContext();
  const [saving, setSaving] = useState(false);
  const current = conversation.labels ?? [];

  const toggle = async (key: string) => {
    const next = current.includes(key) ? current.filter(l => l !== key) : [...current, key];
    setSaving(true);
    try {
      await whatsappService.updateLabels(conversation.id, next);
      onChanged({ ...conversation, labels: next });
    } catch (e: any) { toast.error('Falha ao salvar etiqueta', e.message); }
    finally { setSaving(false); }
  };

  const available = WA_LABELS.filter(l => !current.includes(l.key));

  return (
    <div className="space-y-1.5">
      {/* Select compacto para adicionar etiqueta (não poluir com chips soltos) */}
      <select value="" onChange={e => toggle(e.target.value)} disabled={saving}
        className="w-full min-w-0 text-[12px] pl-2 pr-6 py-1.5 rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none disabled:opacity-60">
        <option value="">{saving ? 'Salvando…' : '🏷 Etiquetas — adicionar…'}</option>
        {available.map(l => <option key={l.key} value={l.key}>{l.key}</option>)}
      </select>
      {current.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {current.map(key => {
            const meta = WA_LABELS.find(x => x.key === key);
            if (!meta) return null;
            return (
              <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: meta.color, color: '#fff' }}>
                <Tag size={9} />{meta.key}
                <button onClick={() => toggle(key)} disabled={saving} className="hover:opacity-70 ml-0.5"><X size={10} /></button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Bolhas-fantasma das mensagens agendadas dentro da thread ──
const ThreadScheduledGhosts: React.FC<{ conversationId: string; privateMode: boolean; confirm: ConfirmFn }> = ({ conversationId, privateMode, confirm }) => {
  const toast = useToastContext();
  const [items, setItems] = useState<WhatsAppScheduledMessage[] | null>(null);
  const load = useCallback(() => {
    whatsappService.listScheduled(conversationId).then(setItems).catch(() => setItems([]));
  }, [conversationId]);
  useEffect(() => {
    setItems(null);
    load();
    const unsub = whatsappService.subscribeScheduled(conversationId, load);
    return () => unsub();
  }, [conversationId, load]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editWhen, setEditWhen] = useState('');
  const [busy, setBusy] = useState(false);

  const toLocalInput = (iso: string) => {
    const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const startEdit = (s: WhatsAppScheduledMessage) => { setEditingId(s.id); setEditText(s.body || ''); setEditWhen(toLocalInput(s.scheduled_at)); };
  const removeScheduled = async (id: string) => {
    if (!await confirm({ title: 'Excluir agendamento', message: 'A mensagem agendada não será enviada.', confirmLabel: 'Excluir', tone: 'danger' })) return;
    try { await whatsappService.cancelScheduled(id); load(); toast.success('Agendamento excluído.'); }
    catch (e: any) { toast.error('Falha ao excluir', e.message); }
  };
  const cancelEdit = () => { setEditingId(null); setEditText(''); setEditWhen(''); };
  const saveEdit = async (id: string) => {
    if (!editWhen) return;
    setBusy(true);
    try {
      await whatsappService.updateScheduled(id, { text: editText, scheduledAt: new Date(editWhen).toISOString() });
      cancelEdit(); load();
    } catch (e: any) { toast.error('Falha ao salvar', e.message); }
    finally { setBusy(false); }
  };

  const pending = (items || []).filter(s => s.status === 'pending');
  if (pending.length === 0) return null;
  return (
    <div className="space-y-1.5 mt-2">
      {pending.map(s => {
        const editing = editingId === s.id;
        return (
        <div key={s.id} className="flex justify-end">
          <div className="group max-w-[75%] rounded-2xl rounded-br-sm border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2">
            <div className="flex items-center gap-1.5 mb-0.5">
              <CalendarClock size={12} className="text-amber-600" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Agendada</span>
              <span className="text-[10px] text-slate-400">
                {new Date(s.scheduled_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
              {!editing && (
                <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={() => startEdit(s)} title="Editar agendamento"
                    className="p-0.5 rounded text-amber-400 hover:text-amber-600 transition">
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => removeScheduled(s.id)} title="Excluir agendamento"
                    className="p-0.5 rounded text-amber-400 hover:text-red-600 transition">
                    <X size={13} strokeWidth={2.5} />
                  </button>
                </span>
              )}
            </div>
            {editing ? (
              <div className="mt-1 space-y-1.5">
                <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={3}
                  className="w-full px-2.5 py-1.5 text-[12.5px] rounded-lg bg-white border border-amber-200 focus:border-amber-400 outline-none resize-none" />
                <input type="datetime-local" value={editWhen} onChange={e => setEditWhen(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-[12px] rounded-lg bg-white border border-amber-200 focus:border-amber-400 outline-none" />
                <div className="flex justify-end gap-1.5">
                  <button onClick={cancelEdit} className="px-2.5 py-1 text-[11.5px] font-semibold text-slate-500 hover:text-slate-700">Cancelar</button>
                  <button onClick={() => saveEdit(s.id)} disabled={busy || !editWhen}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[11.5px] font-semibold hover:bg-amber-700 disabled:opacity-50">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Salvar
                  </button>
                </div>
              </div>
            ) : (
              s.body && <p className="text-[13px] text-slate-700 whitespace-pre-wrap break-words">{privateMode ? maskSensitive(s.body) : s.body}</p>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
};

// ── Painel de mensagens agendadas no aside (Fase 8.1) ──
const SCHED_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Agendada', cls: 'bg-amber-100 text-amber-700' },
  sent: { label: 'Enviada', cls: 'bg-emerald-100 text-emerald-700' },
  canceled: { label: 'Cancelada', cls: 'bg-slate-100 text-slate-500' },
  failed: { label: 'Falha', cls: 'bg-red-100 text-red-600' },
};
const ScheduledMessagesPanel: React.FC<{ conversationId: string; canSchedule: boolean; confirm: ConfirmFn }> = ({ conversationId, confirm }) => {
  const toast = useToastContext();
  const [items, setItems] = useState<WhatsAppScheduledMessage[] | null>(null);

  const load = useCallback(() => {
    whatsappService.listScheduled(conversationId).then(setItems).catch(() => setItems([]));
  }, [conversationId]);

  useEffect(() => {
    setItems(null);
    load();
    const unsub = whatsappService.subscribeScheduled(conversationId, load);
    return () => unsub();
  }, [conversationId, load]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editWhen, setEditWhen] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const toLocalInput = (iso: string) => {
    const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const startEdit = (s: WhatsAppScheduledMessage) => {
    setEditingId(s.id); setEditText(s.body || ''); setEditWhen(toLocalInput(s.scheduled_at));
  };
  const cancelEdit = () => { setEditingId(null); setEditText(''); setEditWhen(''); };

  const saveEdit = async (s: WhatsAppScheduledMessage) => {
    if (!editWhen) return;
    setBusy(s.id);
    try {
      const scheduledAt = new Date(editWhen).toISOString();
      if (s.status === 'pending') {
        await whatsappService.updateScheduled(s.id, { text: editText, scheduledAt });
      } else {
        // Falhou/cancelada → reagenda voltando para 'pending'.
        await whatsappService.retryScheduled(s.id, { text: editText, scheduledAt });
      }
      cancelEdit(); load();
    } catch (e: any) { toast.error('Falha ao salvar', e.message); }
    finally { setBusy(null); }
  };

  const cancel = async (id: string) => {
    if (!await confirm({ title: 'Cancelar agendamento', message: 'A mensagem agendada não será enviada.', confirmLabel: 'Cancelar envio', tone: 'danger' })) return;
    try { await whatsappService.cancelScheduled(id); load(); }
    catch (e: any) { toast.error('Falha ao cancelar', e.message); }
  };

  const del = async (id: string) => {
    if (!await confirm({ title: 'Excluir agendamento', message: 'Remove a mensagem agendada do histórico. Não pode ser desfeito.', confirmLabel: 'Excluir', tone: 'danger' })) return;
    try { await whatsappService.deleteScheduled(id); load(); }
    catch (e: any) { toast.error('Falha ao excluir', e.message); }
  };

  const retryNow = async (id: string) => {
    setBusy(id);
    try { await whatsappService.retryScheduled(id); load(); }
    catch (e: any) { toast.error('Falha ao reenviar', e.message); }
    finally { setBusy(null); }
  };

  // Mensagens já enviadas não interessam aqui — viram histórico na thread.
  const visible = (items || []).filter(s => s.status !== 'sent');

  // Sem nada pendente/falho/cancelado → não ocupa espaço.
  if (visible.length === 0) return null;

  const iconBtn = 'p-1 rounded text-slate-300 transition';
  return (
    <div className="space-y-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
        <CalendarClock size={12} /> Mensagens agendadas
      </p>
      <div className="space-y-1.5">
        {visible.map(s => {
          const st = SCHED_STATUS[s.status] || { label: s.status, cls: 'bg-slate-100 text-slate-500' };
          const editing = editingId === s.id;
          return (
            <div key={s.id} className="rounded-lg border border-[#e7e5df] px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                <span className="text-[10.5px] text-slate-400 flex-1">
                  {new Date(s.scheduled_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
                {!editing && (
                  <span className="flex items-center gap-0.5">
                    {(s.status === 'pending' || s.status === 'failed' || s.status === 'canceled') && (
                      <button onClick={() => startEdit(s)} title={s.status === 'pending' ? 'Editar' : 'Editar e reagendar'} className={`${iconBtn} hover:text-amber-600`}><Pencil size={13} /></button>
                    )}
                    {s.status === 'failed' && (
                      <button onClick={() => retryNow(s.id)} disabled={busy === s.id} title="Tentar enviar agora" className={`${iconBtn} hover:text-emerald-600`}>
                        {busy === s.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                      </button>
                    )}
                    {s.status === 'pending' && (
                      <button onClick={() => cancel(s.id)} title="Cancelar agendamento" className={`${iconBtn} hover:text-amber-600`}><X size={13} /></button>
                    )}
                    <button onClick={() => del(s.id)} title="Excluir" className={`${iconBtn} hover:text-rose-500`}><Trash2 size={13} /></button>
                  </span>
                )}
              </div>

              {editing ? (
                <div className="mt-2 space-y-1.5">
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={3}
                    className="w-full px-2.5 py-1.5 text-[12px] rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none resize-none" />
                  <input type="datetime-local" value={editWhen} onChange={e => setEditWhen(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-[12px] rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none" />
                  <div className="flex justify-end gap-1.5">
                    <button onClick={cancelEdit} className="px-2.5 py-1 text-[11.5px] font-semibold text-slate-500 hover:text-slate-700">Cancelar</button>
                    <button onClick={() => saveEdit(s)} disabled={busy === s.id || !editWhen}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[11.5px] font-semibold hover:bg-amber-700 disabled:opacity-50">
                      {busy === s.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {s.status === 'pending' ? 'Salvar' : 'Reagendar'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {s.body && <p className="mt-1 text-[12px] text-slate-600 whitespace-pre-wrap break-words line-clamp-3">{s.body}</p>}
                  {s.status === 'failed' && s.error && <p className="mt-0.5 text-[10.5px] text-red-500">{s.error}</p>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Fase O: Banner de aprovação de resposta IA ───────────────────────────────

const AiApprovalBanner: React.FC<{
  session: import('../types/whatsapp.types').WhatsAppAiSession;
  onDone: () => void;
}> = ({ session, onDone }) => {
  const [editMode, setEditMode] = useState(false);
  const [editedText, setEditedText] = useState(session.pending_ai_reply ?? '');
  const [loading, setLoading] = useState<'approve' | 'edit' | 'reject' | null>(null);
  const toast = useToastContext();

  const act = async (action: 'approve' | 'edit' | 'reject') => {
    setLoading(action);
    try {
      const { supabase } = await import('../config/supabase');
      const { error } = await supabase.functions.invoke('whatsapp-ai-approve', {
        body: { session_id: session.id, action, edited_text: action === 'edit' ? editedText : undefined },
      });
      if (error) throw new Error(error.message);
      if (action === 'reject') toast.success('Resposta IA rejeitada — conversa devolvida para você');
      else toast.success(action === 'edit' ? 'Resposta editada e enviada' : 'Resposta IA aprovada e enviada');
      onDone();
    } catch (e) {
      toast.error('Erro', e instanceof Error ? e.message : 'Falha ao processar aprovação');
    } finally {
      setLoading(null);
    }
  };

  const isHandoff = session.pending_ai_next_step === -1;

  return (
    <div style={{ background: '#fef3c7', borderBottom: '1px solid #fde68a', padding: '10px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Bot size={14} style={{ color: '#d97706', flexShrink: 0 }} />
        <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#92400e' }}>
          {isHandoff ? 'IA quer encerrar o atendimento' : 'IA quer enviar mensagem — aguardando sua aprovação'}
        </span>
      </div>

      {editMode ? (
        <textarea
          value={editedText}
          onChange={e => setEditedText(e.target.value)}
          rows={3}
          style={{ width: '100%', fontSize: '12.5px', padding: '8px', borderRadius: '8px', border: '1px solid #fde68a', background: '#fffbeb', resize: 'vertical', outline: 'none', marginBottom: '8px' }}
        />
      ) : (
        <div style={{ fontSize: '12.5px', color: '#78350f', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {session.pending_ai_reply}
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {editMode ? (
          <>
            <button
              disabled={loading !== null || !editedText.trim()}
              onClick={() => act('edit')}
              style={{ padding: '5px 12px', borderRadius: '7px', background: '#d97706', color: '#fff', border: 'none', fontSize: '12px', fontWeight: 700, cursor: 'pointer', opacity: loading !== null ? 0.6 : 1 }}>
              {loading === 'edit' ? '…' : 'Enviar editada'}
            </button>
            <button onClick={() => setEditMode(false)} style={{ padding: '5px 12px', borderRadius: '7px', background: 'transparent', color: '#92400e', border: '1px solid #fde68a', fontSize: '12px', cursor: 'pointer' }}>
              Cancelar edição
            </button>
          </>
        ) : (
          <>
            <button
              disabled={loading !== null}
              onClick={() => act('approve')}
              style={{ padding: '5px 12px', borderRadius: '7px', background: '#16a34a', color: '#fff', border: 'none', fontSize: '12px', fontWeight: 700, cursor: 'pointer', opacity: loading !== null ? 0.6 : 1 }}>
              {loading === 'approve' ? '…' : '✓ Aprovar e enviar'}
            </button>
            <button
              disabled={loading !== null}
              onClick={() => setEditMode(true)}
              style={{ padding: '5px 12px', borderRadius: '7px', background: '#f59e0b', color: '#fff', border: 'none', fontSize: '12px', fontWeight: 700, cursor: 'pointer', opacity: loading !== null ? 0.6 : 1 }}>
              Editar
            </button>
            <button
              disabled={loading !== null}
              onClick={() => act('reject')}
              style={{ padding: '5px 12px', borderRadius: '7px', background: 'transparent', color: '#b45309', border: '1px solid #fde68a', fontSize: '12px', cursor: 'pointer', opacity: loading !== null ? 0.6 : 1 }}>
              {loading === 'reject' ? '…' : 'Rejeitar'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ── Fase M: Dashboard de atendimento ─────────────────────────────────────────

interface DashboardStats {
  by_status: Record<string, number> | null;
  by_agent: { agent_name: string; total: number; waiting_reply: number }[] | null;
  sla_breached: number;
  sla_warning: number;
  unassigned: number;
  opened_today: number;
  closed_today: number;
  messages_sent_today: number;
  avg_first_response_min: number | null;
}

const AttendanceDashboard: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { supabase } = await import('../config/supabase');
      const { data, error: rpcError } = await supabase.rpc('whatsapp_dashboard_stats');
      if (rpcError) throw new Error(rpcError.message);
      setStats(data as DashboardStats);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar métricas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const totalOpen = stats ? Object.entries(stats.by_status ?? {}).reduce((s, [, v]) => s + v, 0) : 0;

  const StatCard: React.FC<{
    icon: React.ReactNode; label: string; value: string | number;
    sub?: string; tone?: 'default' | 'danger' | 'warning' | 'success';
  }> = ({ icon, label, value, sub, tone = 'default' }) => {
    const toneMap = {
      default: 'bg-[#f9f8f6] text-slate-600',
      danger: 'bg-red-50 text-red-600',
      warning: 'bg-amber-50 text-amber-700',
      success: 'bg-emerald-50 text-emerald-700',
    };
    return (
      <div className={`rounded-xl p-4 ${toneMap[tone]}`}>
        <div className="flex items-center gap-2 mb-1 text-[11px] font-semibold uppercase tracking-wide opacity-70">
          {icon} {label}
        </div>
        <div className="text-[28px] font-bold leading-none">{value}</div>
        {sub && <div className="text-[11px] mt-1 opacity-60">{sub}</div>}
      </div>
    );
  };

  return (
    <WaDialog
      title="Dashboard de atendimento"
      subtitle={`Atualizado às ${lastRefresh.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
      icon={<BarChart2 size={18} />}
      onClose={onClose}
      size="lg"
      zIndex={60}
      headerActions={
        <button onClick={load} disabled={loading} title="Atualizar"
          className="shrink-0 rounded-full p-1.5 text-white/80 hover:bg-white/15 hover:text-white disabled:opacity-40 transition">
          <TrendingUp size={16} className={loading ? 'animate-pulse' : ''} />
        </button>
      }
    >
      <div className="p-5 space-y-5">
        {loading && !stats && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 size={22} className="animate-spin mr-2" /> Carregando métricas…
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg p-3 text-[13px]">
              <AlertTriangle size={15} /> {error}
            </div>
          )}

          {stats && (
            <>
              {/* Linha 1: volume */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">Volume</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard icon={<Inbox size={13} />} label="Abertas agora" value={totalOpen} />
                  <StatCard icon={<Users size={13} />} label="Sem responsável" value={stats.unassigned}
                    tone={stats.unassigned > 5 ? 'warning' : 'default'} />
                  <StatCard icon={<CheckCircle size={13} />} label="Encerradas hoje" value={stats.closed_today} tone="success" />
                  <StatCard icon={<TrendingUp size={13} />} label="Abertas hoje" value={stats.opened_today} />
                </div>
              </div>

              {/* Linha 2: SLA */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">SLA de resposta</p>
                <div className="grid grid-cols-3 gap-3">
                  <StatCard icon={<AlertTriangle size={13} />} label="Estouradas (>4h)" value={stats.sla_breached}
                    tone={stats.sla_breached > 0 ? 'danger' : 'default'}
                    sub={stats.sla_breached > 0 ? 'Requer atenção imediata' : 'Tudo dentro do prazo'} />
                  <StatCard icon={<Clock3 size={13} />} label="Atenção (2-4h)" value={stats.sla_warning}
                    tone={stats.sla_warning > 0 ? 'warning' : 'default'} />
                  <StatCard icon={<Clock3 size={13} />} label="TMR médio (7d)" value={
                    stats.avg_first_response_min != null
                      ? stats.avg_first_response_min < 60
                        ? `${Math.round(stats.avg_first_response_min)}min`
                        : `${Math.floor(stats.avg_first_response_min / 60)}h${String(Math.floor(stats.avg_first_response_min % 60)).padStart(2, '0')}`
                      : '—'
                  } sub="Tempo médio de 1ª resposta" />
                </div>
              </div>

              {/* Linha 3: mensagens */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">Produtividade</p>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard icon={<MessageCircle size={13} />} label="Mensagens enviadas hoje" value={stats.messages_sent_today} />
                  <StatCard icon={<CheckCircle size={13} />} label="Taxa de encerramento"
                    value={stats.opened_today > 0 ? `${Math.round((stats.closed_today / (stats.opened_today || 1)) * 100)}%` : '—'}
                    sub={`${stats.closed_today} enc. / ${stats.opened_today} abert.`} />
                </div>
              </div>

              {/* Por agente */}
              {stats.by_agent && stats.by_agent.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">Por agente (conversas abertas)</p>
                  <div className="rounded-xl border border-[#f1f0ec] overflow-hidden">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="bg-[#f9f8f6] text-slate-500 text-left">
                          <th className="px-3.5 py-2 font-semibold">Agente</th>
                          <th className="px-3.5 py-2 font-semibold text-right">Total</th>
                          <th className="px-3.5 py-2 font-semibold text-right">Aguardando resp.</th>
                          <th className="px-3.5 py-2 font-semibold text-right">Carga %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.by_agent.map((row, i) => {
                          const pct = totalOpen > 0 ? Math.round((row.total / totalOpen) * 100) : 0;
                          return (
                            <tr key={i} className="border-t border-[#f1f0ec] hover:bg-[#fafaf9]">
                              <td className="px-3.5 py-2 font-medium text-slate-700">{row.agent_name}</td>
                              <td className="px-3.5 py-2 text-right text-slate-600">{row.total}</td>
                              <td className="px-3.5 py-2 text-right">
                                <span className={row.waiting_reply > 0 ? 'text-amber-600 font-semibold' : 'text-slate-400'}>
                                  {row.waiting_reply}
                                </span>
                              </td>
                              <td className="px-3.5 py-2 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                    <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-slate-500 w-7 text-right">{pct}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Por status */}
              {stats.by_status && Object.keys(stats.by_status).length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">Por status (abertas)</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(stats.by_status).map(([status, cnt]) => (
                      <span key={status} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold bg-[#f3f2ef] text-slate-600">
                        {cnt} <span className="font-normal opacity-60">{status}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
      </div>
    </WaDialog>
  );
};

export default WhatsAppModule;
