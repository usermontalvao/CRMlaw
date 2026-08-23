import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DeadlineFormModal } from './DeadlineFormModal';
import { Modal, ModalBody, DeadlinesSkeleton } from './ui';
import {
  Plus,
  Loader2,
  Edit2,
  Trash2,
  Search,
  Eye,
  X,
  AlertCircle,
  CheckCircle,
  CheckCircle2,
  Check,
  Clock,
  XCircle,
  Calendar,
  FileSpreadsheet,
  Layers,
  Briefcase,
  AlertTriangle,
  Siren,
  BookmarkPlus,
  BookmarkX,
  UserCircle,
  LayoutGrid,
  List,
  BarChart3,
  PieChart,
  TrendingUp,
  Download,
  Filter,
  Users,
  FileText,
  Copy,
  MessageSquare,
  Send,
  SquareCheck,
  ChevronRight,
  Paperclip,
  ImageIcon,
  ChevronLeft,
  ChevronDown,
  RotateCcw,
  CalendarClock,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { matchesNormalizedSearch } from '../utils/search';
import { imagesFromClipboard, isPastedImage } from '../utils/clipboardImages';
import { supabase } from '../config/supabase';
import { deadlineService } from '../services/deadline.service';
import { processService } from '../services/process.service';
import { requirementService } from '../services/requirement.service';
import { clientService } from '../services/client.service';
import { profileService } from '../services/profile.service';
import { settingsService, type ModuleResponsibilityConfig } from '../services/settings.service';
import { ClientSearchSelect } from './ClientSearchSelect';
import { DeadlineScheduledPanel } from './DeadlineScheduledPanel';
import { toOfficeTimestamp } from '../utils/officeTime';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { userNotificationService } from '../services/userNotification.service';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { usePermissions } from '../hooks/usePermissions';
import { useMinLoading } from '../hooks/useMinLoading';
import type { Deadline, DeadlineStatus, DeadlinePriority, DeadlineType, DeadlineCancellation, DeadlineCancellationAttachment, DeadlineTimelineEvent, DeadlineClosure } from '../types/deadline.types';
import type { Process } from '../types/process.types';
import type { Requirement } from '../types/requirement.types';
import type { Profile } from '../services/profile.service';
import type { Client } from '../types/client.types';
import { formatDate as fmtDateGlobal, formatDateTime as fmtDateTimeGlobal } from '../utils/formatters';
import { LAYER, layerStack, zc } from '../styles/layers';

const STATUS_OPTIONS: {
  key: DeadlineStatus;
  label: string;
  badge: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 'pendente', label: 'Pendentes', badge: 'bg-blue-500 text-white', icon: Clock },
  { key: 'cumprido', label: 'Cumpridos', badge: 'bg-green-600 text-white', icon: CheckCircle2 },
  { key: 'vencido', label: 'Vencidos', badge: 'bg-red-600 text-white', icon: AlertCircle },
  { key: 'cancelado', label: 'Cancelados', badge: 'bg-red-600 text-white', icon: XCircle },
];

// Prazos que saíram da fila de tarefas: não exigem mais ação, só consulta.
// Ficam no histórico embaixo da lista, nunca no meio dos pendentes.
// 'excluido' entra aqui porque excluir passou a ser arquivar: o prazo apagado
// vai para o histórico, de onde dá para consultar e restaurar.
const ARCHIVED_STATUSES: DeadlineStatus[] = ['cumprido', 'vencido', 'cancelado', 'excluido'];

// Rótulo e cor da situação no histórico. Fica fora de STATUS_OPTIONS (que o
// escritório configura e alimenta as abas da fila) porque 'excluido' nunca é
// uma escolha do formulário — quem o aplica é o botão Excluir.
const HISTORY_STATUS_LABEL: Record<string, string> = {
  cumprido: 'Cumprido', vencido: 'Vencido', cancelado: 'Cancelado', excluido: 'Excluído',
};

const HISTORY_STATUS_STYLE: Record<string, string> = {
  cumprido: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  vencido: 'bg-red-50 text-red-700 border-red-200',
  cancelado: 'bg-red-50 text-red-600 border-red-200',
  // Cinza, não vermelho: exclusão não é falha do escritório, é um prazo que não
  // deveria existir. O vermelho fica reservado a quem perdeu ou cancelou.
  excluido: 'bg-slate-100 text-slate-500 border-slate-200',
};

// Teto por anexo do cancelamento — o bucket anexos_chat aceita 50 MB, mas print
// nenhum chega perto disso e o limite evita subir um vídeo por engano.
const MAX_CANCEL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const formatAttachmentSize = (bytes: number) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Anexos do motivo do cancelamento. O bucket é privado, então cada arquivo
 * precisa de URL assinada — geradas uma vez quando a lista aparece.
 *
 * Imagem abre na galeria interna (portal sobre o modal, com setas e teclado);
 * arquivo que não é imagem cai no download, que é o único destino útil.
 */
const CancellationAttachments: React.FC<{ attachments: DeadlineCancellationAttachment[] }> = ({ attachments }) => {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setUrls({});
    void Promise.all(
      attachments.map(async (att) => [att.path, await deadlineService.getCancellationAttachmentUrl(att.path)] as const),
    ).then((pares) => {
      if (!active) return;
      const mapa: Record<string, string> = {};
      pares.forEach(([path, url]) => { if (url) mapa[path] = url; });
      setUrls(mapa);
    });
    return () => { active = false; };
  }, [attachments]);

  // Só imagens entram na galeria — a navegação por setas é entre elas.
  const images = useMemo(
    () => attachments.filter((att) => (att.mime || '').startsWith('image/')),
    [attachments],
  );

  useEffect(() => {
    if (viewerIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setViewerIndex(null); }
      else if (e.key === 'ArrowRight') setViewerIndex((i) => (i === null ? i : Math.min(i + 1, images.length - 1)));
      else if (e.key === 'ArrowLeft') setViewerIndex((i) => (i === null ? i : Math.max(i - 1, 0)));
    };
    // Captura: o Modal fecha no Escape e fecharia junto com a galeria.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [viewerIndex, images.length]);

  if (!attachments.length) return null;

  const current = viewerIndex !== null ? images[viewerIndex] : null;

  return (
    <>
      <div className="flex flex-wrap gap-2 mt-2.5">
        {attachments.map((att) => {
          const url = urls[att.path];
          const isImage = (att.mime || '').startsWith('image/');
          const galleryIndex = isImage ? images.findIndex((img) => img.path === att.path) : -1;

          if (isImage) {
            return (
              <button
                key={att.path}
                type="button"
                disabled={!url}
                onClick={() => setViewerIndex(galleryIndex)}
                title={att.name}
                className="group relative w-24 h-24 rounded-lg border border-red-200 overflow-hidden bg-white hover:ring-2 hover:ring-red-300 transition disabled:opacity-60"
              >
                {url
                  ? <img src={url} alt={att.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                  : <span className="flex items-center justify-center w-full h-full"><Loader2 className="w-4 h-4 animate-spin text-red-300" /></span>}
                <span className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
                  <Eye className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition" />
                </span>
              </button>
            );
          }

          return (
            <a
              key={att.path}
              href={url || undefined}
              target="_blank"
              rel="noreferrer"
              title={att.name}
              className={`w-24 h-24 rounded-lg border border-red-200 overflow-hidden bg-white hover:ring-2 hover:ring-red-300 transition flex flex-col items-center justify-center gap-1 px-1 ${url ? '' : 'pointer-events-none opacity-60'}`}
            >
              <FileText className="w-5 h-5 text-red-400" />
              <span className="text-[9px] text-red-600 text-center leading-tight line-clamp-2 break-all">{att.name}</span>
            </a>
          );
        })}
      </div>

      {/* Galeria */}
      {current && createPortal(
        <div
          className={`fixed inset-0 ${zc.MODAL_NESTED} bg-black/90 flex flex-col`}
          style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
          onClick={() => setViewerIndex(null)}
        >
          {/* Barra superior */}
          <div
            className="flex items-center justify-between gap-3 px-4 py-3 text-white/90"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{current.name}</p>
              <p className="text-[11px] text-white/50">
                {images.length > 1 ? `${(viewerIndex ?? 0) + 1} de ${images.length} · ` : ''}
                {formatAttachmentSize(current.size)}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <a
                href={urls[current.path] || undefined}
                download={current.name}
                target="_blank"
                rel="noreferrer"
                className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                title="Baixar"
              >
                <Download className="w-4 h-4" />
              </a>
              <button
                type="button"
                onClick={() => setViewerIndex(null)}
                className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                title="Fechar (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Imagem */}
          <div className="flex-1 flex items-center justify-center px-4 pb-2 min-h-0" onClick={() => setViewerIndex(null)}>
            {images.length > 1 && (
              <button
                type="button"
                disabled={viewerIndex === 0}
                onClick={(e) => { e.stopPropagation(); setViewerIndex((i) => Math.max((i ?? 0) - 1, 0)); }}
                className="absolute left-3 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition disabled:opacity-20 disabled:cursor-default"
                title="Anterior (←)"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}

            <img
              src={urls[current.path]}
              alt={current.name}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full object-contain rounded-xl shadow-[0_30px_70px_rgba(0,0,0,.7)]"
            />

            {images.length > 1 && (
              <button
                type="button"
                disabled={viewerIndex === images.length - 1}
                onClick={(e) => { e.stopPropagation(); setViewerIndex((i) => Math.min((i ?? 0) + 1, images.length - 1)); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition disabled:opacity-20 disabled:cursor-default"
                title="Próxima (→)"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </div>

          {/* Miniaturas */}
          {images.length > 1 && (
            <div className="flex items-center justify-center gap-2 px-4 py-3 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
              {images.map((img, idx) => (
                <button
                  key={img.path}
                  type="button"
                  onClick={() => setViewerIndex(idx)}
                  className={`w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 transition ${
                    idx === viewerIndex ? 'ring-2 ring-white' : 'opacity-50 hover:opacity-100'
                  }`}
                  title={img.name}
                >
                  <img src={urls[img.path]} alt={img.name} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
};

// Atalhos do modal de cancelamento — os motivos que mais aparecem no dia a dia.
const CANCEL_REASON_SUGGESTIONS = [
  'Prazo duplicado',
  'Intimação não se aplica ao escritório',
  'Processo encerrado',
  'Cliente desistiu',
  'Substituído por outro prazo',
];

const isArchivedDeadline = (deadline: Deadline) => ARCHIVED_STATUSES.includes(deadline.status);
// Data em que o prazo foi encerrado. A exclusão vem primeiro: um prazo cumprido
// e depois excluído foi encerrado quando saiu, não quando foi cumprido.
const getArchivedAt = (deadline: Deadline) =>
  deadline.deleted_at || deadline.completed_at || deadline.updated_at;


const PRIORITY_OPTIONS: {
  key: DeadlinePriority;
  label: string;
  badge: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 'urgente', label: 'Urgente', badge: 'bg-red-600 text-white', icon: AlertTriangle },
  { key: 'alta', label: 'Alta', badge: 'bg-orange-500 text-white', icon: AlertCircle },
  { key: 'media', label: 'Média', badge: 'bg-yellow-500 text-white', icon: Clock },
  { key: 'baixa', label: 'Baixa', badge: 'bg-slate-400 text-white', icon: Clock },
];

const MAP_BUCKETS: {
  key: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
  predicate: (days: number) => boolean;
}[] = [
  {
    key: 'awaiting_drafting',
    label: 'Processos e Requerimentos Administrativos',
    description: 'Casos que precisam de petição inicial. Verifique os requisitos antes de seguir.',
    icon: Briefcase,
    colorClass: 'text-blue-600',
    predicate: () => false,
  },
  {
    key: 'critical',
    label: 'Atrasados / Hoje',
    description: 'Prioridade máxima: execute imediatamente para evitar prejuízos.',
    icon: AlertTriangle,
    colorClass: 'text-red-600',
    predicate: (days) => days <= 0,
  },
  {
    key: 'soon',
    label: 'Próximos 2 Dias',
    description: 'Planeje ações para hoje e amanhã antes que o prazo expire.',
    icon: Clock,
    colorClass: 'text-orange-600',
    predicate: (days) => days > 0 && days <= 2,
  },
  {
    key: 'week',
    label: 'Próximos 3-7 Dias',
    description: 'Organize a semana garantindo que nada fique para a última hora.',
    icon: Calendar,
    colorClass: 'text-amber-600',
    predicate: (days) => days >= 3 && days <= 7,
  },
  {
    key: 'future',
    label: 'Planejamento Futuro (> 7 dias)',
    description: 'Registre lembretes e materiais necessários com antecedência.',
    icon: Calendar,
    colorClass: 'text-slate-600',
    predicate: (days) => days > 7,
  },
];

const TYPE_OPTIONS: {
  key: DeadlineType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 'processo', label: 'Processo', icon: Layers },
  { key: 'requerimento', label: 'Requerimento', icon: Briefcase },
  { key: 'geral', label: 'Geral', icon: Calendar },
];

type DeadlineFormData = {
  title: string;
  description: string;
  due_date: string;
  status: DeadlineStatus;
  priority: DeadlinePriority;
  type: DeadlineType;
  process_id: string;
  requirement_id: string;
  client_id: string;
  responsible_id: string;
  notify_days_before: string;
  /** Data (YYYY-MM-DD) a partir da qual o prazo entra na fila. Vazio = agora. */
  visible_from: string;
};

type SavedFilter = {
  id: string;
  name: string;
  search: string;
  type: DeadlineType | '';
  priority: DeadlinePriority | '';
  status: DeadlineStatus | 'todos';
  responsibleId: string;
};

type SmartAlert = {
  id: string;
  title: string;
  description: string;
  tone: 'danger' | 'warning' | 'info' | 'success';
  actionLabel?: string;
  onAction?: () => void;
  icon: React.ReactNode;
};

const SAVED_FILTERS_KEY = 'deadlines_saved_filters';
const UNASSIGNED_FILTER_VALUE = '__unassigned__';

const ALERT_TONE_STYLES: Record<SmartAlert['tone'], { bg: string; border: string; text: string; button: string; buttonText: string }> = {
  danger: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-900',
    button: 'bg-red-600 hover:bg-red-700 text-white',
    buttonText: 'text-red-700',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-900',
    button: 'bg-amber-500 hover:bg-amber-600 text-white',
    buttonText: 'text-amber-700',
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-900',
    button: 'bg-blue-600 hover:bg-blue-700 text-white',
    buttonText: 'text-blue-700',
  },
  success: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-900',
    button: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    buttonText: 'text-emerald-700',
  },
};

const emptyForm: DeadlineFormData = {
  title: '',
  description: '',
  due_date: '',
  status: 'pendente',
  priority: 'media',
  type: 'processo',
  process_id: '',
  requirement_id: '',
  client_id: '',
  responsible_id: '',
  notify_days_before: '2',
  visible_from: '',
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Não informado';
  return fmtDateGlobal(value);
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Não informado';
  return fmtDateTimeGlobal(value);
};

// ── Linha do tempo do prazo (audit_log) ──────────────────────────────────────
// Os rótulos espelham as ações que o gatilho fn_audit_log_trigger grava.
const TIMELINE_ACTION_LABELS: Record<string, string> = {
  insert: 'Prazo criado',
  update: 'Prazo editado',
  delete: 'Prazo excluído',
  deadline_completed: 'Prazo cumprido',
  deadline_cancelled: 'Prazo cancelado',
  deadline_deleted: 'Prazo excluído',
  deadline_restored: 'Prazo restaurado',
  deadline_reopened: 'Prazo reaberto',
  deadline_due_date_changed: 'Vencimento alterado',
  deadline_responsible_changed: 'Responsável alterado',
  deadline_status_changed: 'Status alterado',
};

const TIMELINE_ACTION_TONE: Record<string, { dot: string; text: string }> = {
  deadline_completed: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  deadline_cancelled: { dot: 'bg-red-500', text: 'text-red-700' },
  deadline_reopened: { dot: 'bg-amber-500', text: 'text-amber-700' },
  deadline_restored: { dot: 'bg-amber-500', text: 'text-amber-700' },
  deadline_deleted: { dot: 'bg-slate-400', text: 'text-slate-600' },
  delete: { dot: 'bg-red-500', text: 'text-red-700' },
};

// O Postgres pode devolver "2026-08-07 19:00:53+00"; o formatador só lê ISO.
const toIsoInstant = (value: string) => (value.includes('T') ? value : value.replace(' ', 'T'));

const CLOSING_ACTIONS = ['deadline_completed', 'deadline_cancelled', 'deadline_deleted'];

// "Pedro Rodrigues Montalvao Neto" → "Pedro Neto": na coluna do histórico o nome
// inteiro só cabe truncado. O completo fica no title de quem passa o mouse.
const shortPersonName = (name?: string | null) => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Usuário';
  if (parts.length <= 2) return parts.join(' ');
  return `${parts[0]} ${parts[parts.length - 1]}`;
};

const DeadlineTimeline: React.FC<{ events: DeadlineTimelineEvent[]; loading: boolean }> = ({ events, loading }) => {
  if (loading) {
    return (
      <p className="text-[12px] text-slate-400 flex items-center gap-2">
        <Loader2 className="w-3 h-3 animate-spin" /> Carregando histórico…
      </p>
    );
  }

  if (!events.length) {
    return <p className="text-[12px] text-slate-400">Nenhum registro de alteração para este prazo.</p>;
  }

  return (
    <ol className="space-y-2.5">
      {events.map((event) => {
        const tone = TIMELINE_ACTION_TONE[event.action];
        const label = TIMELINE_ACTION_LABELS[event.action] || event.action;
        return (
          <li key={event.id} className="flex items-start gap-2.5">
            <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${tone?.dot || 'bg-slate-300'}`} />
            <div className="min-w-0">
              <p className={`text-[13px] font-medium ${tone?.text || 'text-slate-700 dark:text-slate-200'}`}>
                {label}
                {event.action === 'deadline_status_changed' && event.status_from && event.status_to && (
                  <span className="font-normal text-slate-500"> · {event.status_from} → {event.status_to}</span>
                )}
              </p>
              <p className="text-[11px] text-slate-400 tabular-nums">
                {event.user_name || 'Usuário'} · {formatDateTime(toIsoInstant(event.created_at))}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
};

// Calcula data de vencimento baseado em dias úteis (exclui finais de semana)
// Prazos processuais começam no dia subsequente à publicação
type TipoPrazo = 'processual' | 'material';

const calcularDataVencimento = (dataPublicacao: string, diasPrazo: number, tipo: TipoPrazo): string => {
  const data = new Date(dataPublicacao + 'T12:00:00');
  
  // Começa no dia subsequente (regra processual)
  data.setDate(data.getDate() + 1);
  
  let diasContados = 0;
  
  while (diasContados < diasPrazo) {
    const diaSemana = data.getDay();
    const isFinalSemana = diaSemana === 0 || diaSemana === 6;

    if (tipo === 'processual') {
      if (!isFinalSemana) {
        diasContados++;
      }
    } else {
      diasContados++;
    }

    if (diasContados < diasPrazo) {
      data.setDate(data.getDate() + 1);
    }
  }

  if (tipo === 'processual') {
    while (data.getDay() === 0 || data.getDay() === 6) {
      data.setDate(data.getDate() + 1);
    }
  }
  
  return data.toISOString().split('T')[0];
};

const toDateInputValue = (value?: string | null) => {
  if (!value) return '';
  // Extrai apenas a parte da data (YYYY-MM-DD) sem conversão de timezone
  if (value.includes('T')) return value.split('T')[0];
  // Se já está no formato YYYY-MM-DD, retorna direto
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return value;
};

const parseDateOnly = (value: string): Date | null => {
  if (!value) return null;
  const datePart = value.includes('T') ? value.split('T')[0] : value;
  const parts = datePart.split('-').map((part) => Number.parseInt(part, 10));
  if (parts.length === 3 && parts.every((num) => Number.isFinite(num))) {
    const [year, month, day] = parts;
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const getDaysUntilDue = (dueDate: string): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = parseDateOnly(dueDate);
  if (!due) return 0;

  const dueStart = due.getTime();
  const todayStart = today.getTime();
  const diffTime = dueStart - todayStart;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

const isDueSoon = (dueDate: string): boolean => {
  const days = getDaysUntilDue(dueDate);
  return days >= 0 && days <= 2;
};

import { events, SYSTEM_EVENTS } from '../utils/events';
import { useSyncTick } from '../lib/syncBus';

interface DeadlinesModuleProps {
  forceCreate?: boolean;
  entityId?: string;
  onParamConsumed?: () => void;
  prefillData?: {
    title?: string;
    description?: string;
    client_id?: string;
    process_id?: string;
    process_code?: string;
    client_name?: string;
  };
  calendarMonth?: number;
  calendarYear?: number;
  onCalendarChange?: (month: number, year: number) => void;
}

const DeadlinesModule: React.FC<DeadlinesModuleProps> = ({ forceCreate, entityId, onParamConsumed, prefillData, calendarMonth: propCalendarMonth, calendarYear: propCalendarYear, onCalendarChange }) => {
  const { confirmDelete, notifyDeleted } = useDeleteConfirm();
  const { user } = useAuth();
  const { navigateTo } = useNavigation();
  const { isAdmin, loading: permissionsLoading } = usePermissions();

  const [statusOptions, setStatusOptions] = useState(STATUS_OPTIONS);
  const [priorityOptions, setPriorityOptions] = useState(PRIORITY_OPTIONS);
  const [typeOptions, setTypeOptions] = useState(TYPE_OPTIONS);
  const [defaultDeadlineStatus, setDefaultDeadlineStatus] = useState<string | null>(null);
  const [defaultDeadlinePriority, setDefaultDeadlinePriority] = useState<string | null>(null);
  const statusFilterOptions = statusOptions.filter(s => s.key !== 'cumprido');
  // Referências estáveis para as props do DeadlineFormModal — evita reset do form
  const statusOptionsProp   = useMemo(() => statusOptions.map(s   => ({ key: s.key,                    label: s.label })), [statusOptions]);
  const priorityOptionsProp = useMemo(() => priorityOptions.map(p => ({ key: p.key,                    label: p.label })), [priorityOptions]);
  const typeOptionsProp     = useMemo(() => typeOptions.map(t     => ({ key: t.key as DeadlineType,     label: t.label })), [typeOptions]);
  const [soonDaysThreshold, setSoonDaysThreshold] = useState(2);
  const [weekDaysThreshold, setWeekDaysThreshold] = useState(7);
  const [defaultNotifyDays, setDefaultNotifyDays] = useState(2);
  const [defaultDeadlineDays, setDefaultDeadlineDays] = useState(0);

  const resolvedBuckets = useMemo(() => MAP_BUCKETS.map(b => {
    if (b.key === 'soon') return {
      ...b,
      label: `Próximos ${soonDaysThreshold} Dia${soonDaysThreshold === 1 ? '' : 's'}`,
      predicate: (days: number) => days > 0 && days <= soonDaysThreshold,
    };
    if (b.key === 'week') return {
      ...b,
      label: `Próximos ${soonDaysThreshold + 1}-${weekDaysThreshold} Dias`,
      predicate: (days: number) => days > soonDaysThreshold && days <= weekDaysThreshold,
    };
    return b;
  }), [soonDaysThreshold, weekDaysThreshold]);

  const checkIsDueSoon = useCallback((dueDate: string) => {
    const days = getDaysUntilDue(dueDate);
    return days >= 0 && days <= soonDaysThreshold;
  }, [soonDaysThreshold]);

  useEffect(() => {
    settingsService.getResponsibilityConfig().then(cfgs => {
      const cfg = cfgs.find(c => c.module === 'deadlines');
      if (cfg) setResponsibilityConfig(cfg);
    }).catch(() => {});
    settingsService.getPreferences().then(prefs => {
      if (prefs.default_deadline_days && prefs.default_deadline_days > 0) {
        setDefaultDeadlineDays(prefs.default_deadline_days);
      }
    }).catch(() => {});
    settingsService.getDeadlineModuleConfig().then(cfg => {
      setSoonDaysThreshold(cfg.soon_days_threshold ?? 2);
      setWeekDaysThreshold(cfg.week_days_threshold ?? 7);
      setDefaultNotifyDays(cfg.default_notify_days ?? 2);
      if (cfg.statuses.length > 0) {
        const relabeled = STATUS_OPTIONS
          .filter(local => { const sv = cfg.statuses.find(s => s.key === (local.key as string)); return !sv || sv.active !== false; })
          .map(local => { const sv = cfg.statuses.find(s => s.key === (local.key as string)); return sv ? { ...local, label: sv.label, badge: sv.badge ?? local.badge } : local; });
        const newItems = cfg.statuses.filter(s => !STATUS_OPTIONS.some(l => l.key === s.key) && s.active !== false);
        const neutralized = newItems.map(s => ({
          key: s.key as DeadlineStatus,
          label: s.label,
          badge: s.badge ?? 'bg-gray-100 text-gray-700',
          icon: Clock,
        }));
        setStatusOptions([...relabeled, ...neutralized]);
        const defStatus = cfg.statuses.find(s => s.isDefault && s.active !== false);
        if (defStatus) setDefaultDeadlineStatus(defStatus.key);
      }
      if (cfg.priorities.length > 0) {
        const relabeled = PRIORITY_OPTIONS
          .filter(local => { const sv = cfg.priorities.find(p => p.key === (local.key as string)); return !sv || sv.active !== false; })
          .map(local => { const sv = cfg.priorities.find(p => p.key === (local.key as string)); return sv ? { ...local, label: sv.label, badge: sv.badge ?? local.badge } : local; });
        const newItems = cfg.priorities.filter(p => !PRIORITY_OPTIONS.some(l => l.key === p.key) && p.active !== false);
        const neutralized = newItems.map(p => ({
          key: p.key as DeadlinePriority,
          label: p.label,
          badge: p.badge ?? 'bg-gray-100 text-gray-700',
          icon: Clock,
        }));
        setPriorityOptions([...relabeled, ...neutralized]);
        const defPriority = cfg.priorities.find(p => p.isDefault && p.active !== false);
        if (defPriority) setDefaultDeadlinePriority(defPriority.key);
      }
      if (cfg.types.length > 0) {
        setTypeOptions(cfg.types.filter(t => t.active !== false).map(t => {
          const local = TYPE_OPTIONS.find(to => to.key === (t.key as DeadlineType));
          return local ? { ...local, label: t.label } : { key: t.key as DeadlineType, label: t.label, icon: TYPE_OPTIONS[0].icon };
        }));
      }
    }).catch(() => {});
  }, []);

  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  // Excluídos moram fora de `deadlines` de propósito: só o Histórico os enxerga.
  const [deletedDeadlines, setDeletedDeadlines] = useState<Deadline[]>([]);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinLoading(loading);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<DeadlineFormData>(emptyForm);
  const [selectedDeadline, setSelectedDeadline] = useState<Deadline | null>(null);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterType, setFilterType] = useState<DeadlineType | ''>('');
  const [filterPriority, setFilterPriority] = useState<DeadlinePriority | ''>('');
  const [filterResponsible, setFilterResponsible] = useState('');
  const [activeStatusTab, setActiveStatusTab] = useState<DeadlineStatus | 'todos'>('todos');
  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'map' | 'details' | 'workload' | 'scheduled'>('list');
  const [selectedDeadlineForView, setSelectedDeadlineForView] = useState<Deadline | null>(null);
  const [showViewDeadlineModal, setShowViewDeadlineModal] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  // Cancelamento com motivo obrigatório
  const [cancelTarget, setCancelTarget] = useState<{ ids: string[]; label: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSaving, setCancelSaving] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Prints colados (Ctrl+V), arrastados ou escolhidos no seletor de arquivos.
  const [cancelFiles, setCancelFiles] = useState<{ id: string; file: File; preview: string | null }[]>([]);
  const [cancelDragOver, setCancelDragOver] = useState(false);
  const cancelFileInputRef = useRef<HTMLInputElement>(null);
  const [viewCancellation, setViewCancellation] = useState<DeadlineCancellation | null>(null);
  const [viewTimeline, setViewTimeline] = useState<DeadlineTimelineEvent[]>([]);
  const [viewTimelineLoading, setViewTimelineLoading] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [selectedSavedFilterId, setSelectedSavedFilterId] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [processSearchTerm, setProcessSearchTerm] = useState('');
  const [requirementSearchTerm, setRequirementSearchTerm] = useState('');
  const [showProcessSuggestions, setShowProcessSuggestions] = useState(false);
  const [showRequirementSuggestions, setShowRequirementSuggestions] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [members, setMembers] = useState<Profile[]>([]);
  /**
   * Quantos prazos estão dormindo. Vira o contador do botão "Agendados" — sem
   * ele, o que foi agendado sai de vista por completo e some da cabeça de quem
   * agendou, que é justamente o risco de esconder prazo.
   */
  const [scheduledCount, setScheduledCount] = useState(0);
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [responsibilityConfig, setResponsibilityConfig] = useState<ModuleResponsibilityConfig | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [internalCalendarMonth, setInternalCalendarMonth] = useState(propCalendarMonth || new Date().getMonth());
  const [internalCalendarYear, setInternalCalendarYear] = useState(propCalendarYear || new Date().getFullYear());
  
  // Estados para calculadora de prazo
  const [dataPublicacao, setDataPublicacao] = useState('');
  const [diasPrazo, setDiasPrazo] = useState('');
  const [tipoPrazoCalculadora, setTipoPrazoCalculadora] = useState<TipoPrazo>('processual');
  const calculadoraAtiva = Boolean(dataPublicacao && diasPrazo);

  const hasFilterCriteria = Boolean(
    filterSearch.trim() ||
      filterType ||
      filterPriority ||
      filterResponsible ||
      activeStatusTab !== 'todos',
  );
  
  // Estados para relatórios
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportPeriod, setReportPeriod] = useState<'week' | 'month' | 'quarter' | 'year' | 'custom'>('month');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');

  // Estados para operações em lote
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Estados para comentários
  type DeadlineComment = { id: string; content: string; user_name: string; created_at: string; user_id: string | null; parent_id: string | null };
  const [comments, setComments] = useState<DeadlineComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [savingComment, setSavingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [showCommentsFor, setShowCommentsFor] = useState<string | null>(null);

  // Estados do histórico
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatus, setHistoryStatus] = useState<DeadlineStatus | ''>('');
  const [historyMonth, setHistoryMonth] = useState<number | ''>('');
  const [historyYear, setHistoryYear] = useState<number | ''>('');
  const [historyType, setHistoryType] = useState<DeadlineType | ''>('');
  const [historyPriority, setHistoryPriority] = useState<DeadlinePriority | ''>('');
  const [historyResponsible, setHistoryResponsible] = useState('');
  // "Baixado por" guarda o user_id da auth, não o id do membro: quem fecha o
  // prazo vem do audit_log, que registra auth.uid().
  const [historyClosedBy, setHistoryClosedBy] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyFiltersExpanded, setHistoryFiltersExpanded] = useState(false);
  const HISTORY_PAGE_SIZE = 10;

  // Quem cumpriu/cancelou cada prazo arquivado, indexado por id do prazo.
  const [closuresByDeadline, setClosuresByDeadline] = useState<Map<string, DeadlineClosure>>(new Map());

  const applyFilterPreset = useCallback(
    (preset: {
      search?: string;
      type?: DeadlineType | '';
      priority?: DeadlinePriority | '';
      responsibleId?: string;
      status?: DeadlineStatus | 'todos';
    }) => {
      setCurrentPage(1);
      if (preset.search !== undefined) setFilterSearch(preset.search);
      if (preset.type !== undefined) setFilterType(preset.type);
      if (preset.priority !== undefined) setFilterPriority(preset.priority);
      if (preset.responsibleId !== undefined) setFilterResponsible(preset.responsibleId);
      if (preset.status !== undefined) setActiveStatusTab(preset.status);
    },
    [],
  );

  const handleSaveCurrentFilter = useCallback(() => {
    if (!hasFilterCriteria) {
      alert('Defina algum filtro antes de salvar.');
      return;
    }
    const name = prompt('Nome do filtro salvo:');
    if (!name || !name.trim()) return;
    const newFilter: SavedFilter = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      search: filterSearch,
      type: filterType,
      priority: filterPriority,
      status: activeStatusTab,
      responsibleId: filterResponsible,
    };
    setSavedFilters((prev) => [newFilter, ...prev].slice(0, 10));
    setSelectedSavedFilterId(newFilter.id);
  }, [hasFilterCriteria, filterSearch, filterType, filterPriority, filterResponsible, activeStatusTab]);

  const handleSavedFilterChange = useCallback(
    (id: string) => {
      setSelectedSavedFilterId(id);
      if (!id) return;
      const filter = savedFilters.find((f) => f.id === id);
      if (filter) {
        applyFilterPreset(filter);
      }
    },
    [savedFilters, applyFilterPreset],
  );

  const handleDeleteSavedFilter = useCallback(
    async (id: string) => {
      const filter = savedFilters.find((f) => f.id === id);
      const confirmed = await confirmDelete({
        title: 'Remover filtro salvo',
        entityName: filter?.name || undefined,
        message: 'Tem certeza que deseja remover este filtro salvo?',
        confirmLabel: 'Remover',
      });
      if (!confirmed) return;
      notifyDeleted(filter?.name || undefined);
      setSavedFilters((prev) => prev.filter((f) => f.id !== id));
      if (selectedSavedFilterId === id) {
        setSelectedSavedFilterId('');
      }
    },
    [selectedSavedFilterId, savedFilters, confirmDelete, notifyDeleted],
  );

  // ── Operações em lote ─────────────────────────────────────────────────────
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => prev.size === ids.length ? new Set() : new Set(ids));
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (!selectedIds.size) return;
    const confirmed = await confirmDelete({
      title: `Excluir ${selectedIds.size} prazo(s)`,
      message: `Os ${selectedIds.size} prazo(s) selecionado(s) saem da fila e vão para o Histórico de Prazos, de onde podem ser restaurados.`,
      confirmLabel: 'Excluir todos',
      permission: { module: 'prazos', action: 'delete' },
    });
    if (!confirmed) return;
    setBulkActionLoading(true);
    try {
      await Promise.all([...selectedIds].map((id) => deadlineService.deleteDeadline(id)));
      notifyDeleted();
      const carimbo = new Date().toISOString();
      const excluidos = deadlines
        .filter((d) => selectedIds.has(d.id))
        .map((d) => ({ ...d, status: 'excluido' as DeadlineStatus, deleted_at: carimbo }));
      setDeadlines((prev) => prev.filter((d) => !selectedIds.has(d.id)));
      setDeletedDeadlines((prev) => [...excluidos, ...prev.filter((d) => !selectedIds.has(d.id))]);
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.message || 'Erro ao excluir prazos.');
    } finally {
      setBulkActionLoading(false);
    }
  }, [selectedIds, confirmDelete, notifyDeleted, deadlines]);

  // ── Cancelamento com motivo ──────────────────────────────────────────────
  // Nenhum caminho da UI cancela direto: todos passam por este modal, para que
  // o prazo nunca vá para o histórico sem justificativa registrada.
  const clearCancelFiles = useCallback(() => {
    setCancelFiles((prev) => {
      prev.forEach((item) => { if (item.preview) URL.revokeObjectURL(item.preview); });
      return [];
    });
  }, []);

  const requestCancelDeadline = useCallback((ids: string[], label: string) => {
    if (!ids.length) return;
    setCancelReason('');
    setCancelError(null);
    clearCancelFiles();
    setCancelTarget({ ids, label });
  }, [clearCancelFiles]);

  const closeCancelModal = useCallback(() => {
    setCancelTarget(null);
    setCancelReason('');
    setCancelError(null);
    setCancelDragOver(false);
    clearCancelFiles();
  }, [clearCancelFiles]);

  // Aceita print colado, arquivo arrastado e escolha manual — o mesmo caminho
  // para os três, com miniatura só para imagem.
  const addCancelFiles = useCallback((files: File[]) => {
    const novos = files.filter((f) => f.size > 0);
    if (!novos.length) return;
    const grandes = novos.filter((f) => f.size > MAX_CANCEL_ATTACHMENT_BYTES);
    if (grandes.length) {
      setCancelError(`Arquivo acima de 25 MB: ${grandes.map((f) => f.name).join(', ')}`);
    }
    const aceitos = novos.filter((f) => f.size <= MAX_CANCEL_ATTACHMENT_BYTES);
    if (!aceitos.length) return;
    setCancelFiles((prev) => [
      ...prev,
      ...aceitos.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: isPastedImage(file.type) ? URL.createObjectURL(file) : null,
      })),
    ]);
  }, []);

  const removeCancelFile = useCallback((id: string) => {
    setCancelFiles((prev) => {
      const alvo = prev.find((item) => item.id === id);
      if (alvo?.preview) URL.revokeObjectURL(alvo.preview);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  // Ctrl+V em qualquer ponto do modal aberto — não só dentro do textarea, que é
  // onde a colagem falharia se o foco estivesse num botão.
  useEffect(() => {
    if (!cancelTarget) return;
    const onPaste = (event: ClipboardEvent) => {
      const imagens = imagesFromClipboard(event.clipboardData);
      if (!imagens.length) return;
      // Só engole a colagem quando veio imagem: texto colado segue normal.
      event.preventDefault();
      addCancelFiles(imagens);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [cancelTarget, addCancelFiles]);

  const handleCancelDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setCancelDragOver(false);
    addCancelFiles(Array.from(event.dataTransfer?.files || []));
  }, [addCancelFiles]);

  const handleBulkStatusChange = useCallback(async (status: DeadlineStatus) => {
    if (!selectedIds.size) return;
    if (status === 'cancelado') {
      const ids = [...selectedIds];
      requestCancelDeadline(ids, `${ids.length} prazo(s) selecionado(s)`);
      return;
    }
    setBulkActionLoading(true);
    try {
      await Promise.all([...selectedIds].map((id) => deadlineService.updateStatus(id, status)));
      setDeadlines((prev) => prev.map((d) => selectedIds.has(d.id) ? { ...d, status } : d));
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar status em lote.');
    } finally {
      setBulkActionLoading(false);
    }
  }, [selectedIds, requestCancelDeadline]);

  const handleBulkResponsibleChange = useCallback(async (responsibleId: string) => {
    if (!selectedIds.size || !responsibleId) return;
    setBulkActionLoading(true);
    try {
      await Promise.all([...selectedIds].map((id) => deadlineService.updateDeadline(id, { responsible_id: responsibleId })));
      setDeadlines((prev) => prev.map((d) => selectedIds.has(d.id) ? { ...d, responsible_id: responsibleId } : d));
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar responsável em lote.');
    } finally {
      setBulkActionLoading(false);
    }
  }, [selectedIds]);

  // ── Duplicar prazo ────────────────────────────────────────────────────────
  const handleCloneDeadline = useCallback(async (deadline: Deadline) => {
    try {
      setSaving(true);
      const clone = await deadlineService.createDeadline({
        title: `[CÓPIA] ${deadline.title}`,
        description: deadline.description,
        due_date: deadline.due_date,
        status: 'pendente',
        priority: deadline.priority,
        type: deadline.type,
        process_id: deadline.process_id,
        requirement_id: deadline.requirement_id,
        client_id: deadline.client_id,
        responsible_id: deadline.responsible_id || '',
        notify_days_before: deadline.notify_days_before,
      });
      setDeadlines((prev) => [clone, ...prev]);
    } catch (err: any) {
      setError(err.message || 'Erro ao duplicar prazo.');
    } finally {
      setSaving(false);
    }
  }, []);


  // ── Comentários ───────────────────────────────────────────────────────────
  const resolveUserNames = useCallback(async (userIds: string[]): Promise<Map<string, string>> => {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const { data } = await supabase
      .from('profiles')
      .select('user_id, name')
      .in('user_id', ids);
    return new Map((data || []).map((p: any) => [p.user_id, p.name]));
  }, []);

  const loadComments = useCallback(async (deadlineId: string) => {
    setCommentsLoading(true);
    setComments([]);
    try {
      const { data, error: err } = await supabase
        .from('deadline_comments')
        .select('id, content, created_at, user_id, parent_id')
        .eq('deadline_id', deadlineId)
        .order('created_at', { ascending: true });
      if (err) throw err;
      const rows = data || [];
      // Resolve nomes primeiro pelos membros já em memória; só consulta o banco p/ os faltantes
      const localMap = new Map(members.map((mem) => [mem.user_id, mem.name]));
      const missing = rows
        .map((r: any) => r.user_id)
        .filter((uid: string) => uid && !localMap.has(uid));
      const fetchedMap = missing.length > 0 ? await resolveUserNames(missing) : new Map();
      const nameOf = (uid: string) => localMap.get(uid) || fetchedMap.get(uid) || 'Usuário';
      setComments(rows.map((c: any) => ({
        id: c.id,
        content: c.content,
        user_name: nameOf(c.user_id),
        created_at: c.created_at,
        user_id: c.user_id,
        parent_id: c.parent_id ?? null,
      })));
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [resolveUserNames, members]);

  const handleAddComment = useCallback(async (deadlineId: string) => {
    const text = commentText.trim();
    if (!text) return;
    setSavingComment(true);
    const parentId = replyingTo?.id ?? null;
    // ── Otimista: o comentário aparece na hora ───────────────────────
    const tempId = `temp-${Date.now()}`;
    const optimistic: DeadlineComment = {
      id: tempId,
      content: text,
      user_name: currentUser?.name || 'Você',
      created_at: new Date().toISOString(),
      user_id: user?.id ?? null,
      parent_id: parentId,
    };
    setComments((prev) => [...prev, optimistic]);
    setCommentText('');
    setReplyingTo(null);
    setMentionQuery(null);
    try {
      const { data, error: err } = await supabase
        .from('deadline_comments')
        .insert({ deadline_id: deadlineId, content: text, user_id: user?.id, parent_id: parentId })
        .select('id, content, created_at, user_id, parent_id')
        .single();
      if (err) throw err;
      // Substitui o temporário pelo registro real
      setComments((prev) => prev.map((c) => c.id === tempId ? {
        id: data.id,
        content: data.content,
        user_name: currentUser?.name || 'Você',
        created_at: data.created_at,
        user_id: data.user_id,
        parent_id: data.parent_id ?? null,
      } : c));

      // ── Processar @menções ──────────────────────────────────────────
      const mentionRegex = /@([A-Za-zÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ]+)*)/g;
      const mentioned = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = mentionRegex.exec(text)) !== null) {
        mentioned.add(m[1].toLowerCase().trim());
      }
      if (mentioned.size > 0) {
        const authorName = currentUser?.name || 'Um colega';
        const deadlineTitle = deadlines.find((d) => d.id === deadlineId)?.title || 'Prazo';
        const targets = members.filter((mem) => {
          if (!mem.user_id || mem.user_id === user?.id) return false;
          const memName = (mem.name || '').toLowerCase().trim();
          const memFirst = memName.split(/\s+/)[0];
          return [...mentioned].some((q) => memName === q || memName.includes(q) || q.includes(memFirst));
        });
        for (const target of targets) {
          userNotificationService.createNotification({
            user_id: target.user_id,
            type: 'mention',
            title: `${authorName} mencionou você em um comentário`,
            message: text.length > 120 ? text.slice(0, 120) + '...' : text,
            deadline_id: deadlineId,
            metadata: { deadline_id: deadlineId, comment_id: data.id, author_id: user?.id, author_name: authorName },
          }).catch((e) => console.error('Erro ao notificar menção:', e));

          supabase.functions.invoke('notify-comment-mention', {
            body: {
              deadline_id: deadlineId,
              mentioned_profile_id: target.id,
              author_name: authorName,
              comment_text: text,
            },
          }).catch((e) => console.error('Erro ao enviar email de menção:', e));
        }
      }
    } catch (err: any) {
      // Falhou: remove o comentário otimista e devolve o texto ao input
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setCommentText(text);
      setError(err.message || 'Erro ao salvar comentário.');
    } finally {
      setSavingComment(false);
    }
  }, [commentText, user?.id, currentUser?.name, members, deadlines, replyingTo]);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    setDeletingCommentId(commentId);
    try {
      const { error: err } = await supabase.from('deadline_comments').delete().eq('id', commentId);
      if (err) throw err;
      setComments((prev) => prev.filter((c) => c.id !== commentId && c.parent_id !== commentId));
    } catch (err: any) {
      setError(err.message || 'Erro ao excluir comentário.');
    } finally {
      setDeletingCommentId(null);
    }
  }, []);

  const handleCommentChange = useCallback((value: string) => {
    setCommentText(value);
    const match = value.match(/@([\p{L}]*)$/u);
    setMentionQuery(match ? match[1].toLowerCase() : null);
  }, []);

  const pickMention = useCallback((memberName: string) => {
    setCommentText((prev) => prev.replace(/@[\p{L}]*$/u, `@${memberName} `));
    setMentionQuery(null);
  }, []);

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    return members
      .filter((mem) => (mem.name || '').toLowerCase().includes(mentionQuery))
      .slice(0, 6);
  }, [mentionQuery, members]);

  // Filtros secundários (busca, tipo, prioridade, responsável) — exclui a aba de status.
  // Centraliza a regra para que lista, cartões de estatística e alertas usem exatamente
  // o mesmo critério e nunca exibam números divergentes.
  const matchesSecondaryFilters = useCallback(
    (deadline: Deadline) => {
      if (filterSearch.trim() && !matchesNormalizedSearch(filterSearch, [deadline.title, deadline.description || ''])) {
        return false;
      }
      if (filterType && deadline.type !== filterType) return false;
      if (filterPriority && deadline.priority !== filterPriority) return false;
      if (filterResponsible === UNASSIGNED_FILTER_VALUE) {
        if (deadline.responsible_id) return false;
      } else if (filterResponsible && deadline.responsible_id !== filterResponsible) {
        return false;
      }
      return true;
    },
    [filterSearch, filterType, filterPriority, filterResponsible],
  );

  const filteredDeadlines = useMemo(() => {
    let filtered = deadlines.filter(matchesSecondaryFilters);

    if (activeStatusTab !== 'todos') {
      filtered = filtered.filter((deadline) => deadline.status === activeStatusTab);
    } else {
      // A fila mostra só o que ainda pede ação — cumpridos, vencidos e cancelados
      // vão para o histórico no rodapé do módulo.
      filtered = filtered.filter((deadline) => !isArchivedDeadline(deadline));
    }

    return filtered.slice().sort((a, b) => {
      if (a.status === 'vencido' && b.status !== 'vencido') return -1;
      if (a.status !== 'vencido' && b.status === 'vencido') return 1;
      if (a.status === 'pendente' && b.status !== 'pendente') return -1;
      if (a.status !== 'pendente' && b.status === 'pendente') return 1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    });
  }, [deadlines, activeStatusTab, matchesSecondaryFilters]);

  // O kanban mostra uma coluna por status e por isso ignora o recorte da fila.
  const kanbanDeadlines = useMemo(
    () => deadlines.filter(matchesSecondaryFilters),
    [deadlines, matchesSecondaryFilters],
  );

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filteredDeadlines.length / pageSize));

  const paginatedDeadlines = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredDeadlines.slice(start, start + pageSize);
  }, [filteredDeadlines, currentPage]);

  const statusCounts = useMemo(() => {
    const counts: Record<DeadlineStatus | 'todos', number> = {
      todos: deadlines.length,
      pendente: 0,
      cumprido: 0,
      vencido: 0,
      cancelado: 0,
      // Sempre zero: `deadlines` não guarda excluído (ele vive em
      // deletedDeadlines). A chave existe só para o contador cobrir o tipo.
      excluido: 0,
    };

    deadlines.forEach((deadline) => {
      counts[deadline.status]++;
    });

    return counts;
  }, [deadlines]);

  const pendingDeadlines = useMemo(
    () => deadlines.filter((deadline) => deadline.status === 'pendente'),
    [deadlines],
  );

  const upcomingDeadlines = useMemo(() => {
    return deadlines
      .filter((d) => d.status === 'pendente')
      .filter((d) => {
        const days = getDaysUntilDue(d.due_date);
        return days >= 0 && days <= 7;
      })
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  }, [deadlines]);

  const overdueDeadlines = useMemo(() => {
    return deadlines
      .filter(matchesSecondaryFilters)
      .filter((d) => d.status === 'pendente')
      .filter((d) => getDaysUntilDue(d.due_date) < 0)
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  }, [deadlines, matchesSecondaryFilters]);

  const criticalDeadlines = useMemo(() => {
    return deadlines
      .filter(matchesSecondaryFilters)
      .filter((d) => d.status === 'pendente')
      .filter((d) => getDaysUntilDue(d.due_date) === 1)
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  }, [deadlines, matchesSecondaryFilters]);

  const unassignedPending = useMemo(() => deadlines.filter(matchesSecondaryFilters).filter((d) => d.status === 'pendente' && !d.responsible_id), [deadlines, matchesSecondaryFilters]);

  const smartAlerts = useMemo<SmartAlert[]>(() => {
    const alerts: SmartAlert[] = [];
    if (overdueDeadlines.length) {
      alerts.push({
        id: 'overdue',
        title: 'Prazos vencidos',
        description: `${overdueDeadlines.length} prazo(s) pendente(s) estão atrasados e precisam de ação imediata.`,
        tone: 'danger',
        actionLabel: 'Ver vencidos',
        onAction: () => applyFilterPreset({ status: 'vencido' }),
        icon: <AlertCircle className="w-5 h-5 text-red-600" />,
      });
    }
    if (criticalDeadlines.length) {
      alerts.push({
        id: 'soon',
        title: 'Prazos vencendo em até 2 dias',
        description: `${criticalDeadlines.length} prazo(s) expiram nas próximas 48h.`,
        tone: 'warning',
        actionLabel: 'Filtrar urgentes',
        onAction: () => applyFilterPreset({ status: 'pendente', priority: 'urgente' }),
        icon: <Siren className="w-5 h-5 text-amber-600" />,
      });
    }
    if (unassignedPending.length) {
      alerts.push({
        id: 'unassigned',
        title: 'Prazos sem responsável',
        description: `${unassignedPending.length} prazo(s) aguardam designação.`,
        tone: 'info',
        actionLabel: 'Ver não atribuídos',
        onAction: () => applyFilterPreset({ responsibleId: UNASSIGNED_FILTER_VALUE }),
        icon: <Users className="w-5 h-5 text-blue-600" />,
      });
    }
    return alerts;
  }, [overdueDeadlines.length, criticalDeadlines.length, unassignedPending.length, applyFilterPreset]);

  // Base do histórico: cumpridos, vencidos, cancelados e excluídos, do mais
  // recente para o mais antigo. É o único lugar em que os excluídos reaparecem.
  const archivedDeadlines = useMemo(() => {
    return [...deadlines.filter(isArchivedDeadline), ...deletedDeadlines]
      .sort((a, b) => new Date(getArchivedAt(b)).getTime() - new Date(getArchivedAt(a)).getTime());
  }, [deadlines, deletedDeadlines]);

  const dueTodayDeadlines = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return deadlines.filter((deadline) => {
      const dueDate = new Date(deadline.due_date);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate.getTime() === today.getTime() && deadline.status === 'pendente';
    });
  }, [deadlines]);

  const isPastMonth = useMemo(() => {
    const today = new Date();
    const currentDate = new Date(today.getFullYear(), today.getMonth(), 1);
    const selectedDate = new Date(internalCalendarYear, internalCalendarMonth, 1);
    return selectedDate < currentDate;
  }, [internalCalendarMonth, internalCalendarYear]);

  const monthlyDeadlines = useMemo(() => {
    return deadlines.filter((deadline) => {
      if (!matchesSecondaryFilters(deadline)) return false;
      if (isPastMonth) {
        if (deadline.status !== 'cumprido' || !deadline.completed_at) return false;
        const completed = new Date(deadline.completed_at);
        return completed.getMonth() === internalCalendarMonth && completed.getFullYear() === internalCalendarYear;
      }

      // Se o prazo foi concluído, considerar o mês da conclusão
      if (deadline.status === 'cumprido' && deadline.completed_at) {
        const completed = new Date(deadline.completed_at);
        return completed.getMonth() === internalCalendarMonth && completed.getFullYear() === internalCalendarYear;
      }

      // Para prazos pendentes, vencidos ou cancelados, considerar o mês de vencimento
      const due = parseDateOnly(deadline.due_date);
      if (!due) return false;
      return due.getMonth() === internalCalendarMonth && due.getFullYear() === internalCalendarYear;
    });
  }, [deadlines, internalCalendarMonth, internalCalendarYear, isPastMonth, matchesSecondaryFilters]);

  // Todos os prazos pendentes (qualquer mês) que passam pelo filtro de responsável/busca
  const allPending = useMemo(
    () => deadlines.filter((d) => d.status === 'pendente' && matchesSecondaryFilters(d)),
    [deadlines, matchesSecondaryFilters],
  );

  const monthlyPending = useMemo(
    () => monthlyDeadlines.filter((deadline) => deadline.status === 'pendente'),
    [monthlyDeadlines],
  );

  const monthlyCompleted = useMemo(() => {
    return deadlines.filter((deadline) => {
      if (deadline.status !== 'cumprido' || !deadline.completed_at) return false;
      if (!matchesSecondaryFilters(deadline)) return false;
      const completed = new Date(deadline.completed_at);
      return completed.getMonth() === internalCalendarMonth && completed.getFullYear() === internalCalendarYear;
    });
  }, [deadlines, internalCalendarMonth, internalCalendarYear, matchesSecondaryFilters]);

  const monthlyArchived = useMemo(() => {
    return archivedDeadlines.filter((deadline) => {
      if (!matchesSecondaryFilters(deadline)) return false;
      const archivedAt = new Date(getArchivedAt(deadline));
      return archivedAt.getMonth() === internalCalendarMonth && archivedAt.getFullYear() === internalCalendarYear;
    });
  }, [archivedDeadlines, internalCalendarMonth, internalCalendarYear, matchesSecondaryFilters]);

  const monthlyDueToday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return monthlyDeadlines.filter((deadline) => {
      if (deadline.status !== 'pendente') return false;
      const due = parseDateOnly(deadline.due_date);
      if (!due) return false;
      due.setHours(0, 0, 0, 0);
      return due.getTime() === today.getTime();
    });
  }, [monthlyDeadlines]);

  const monthlyOverdue = useMemo(
    () =>
      monthlyDeadlines.filter(
        (deadline) => deadline.status === 'pendente' && getDaysUntilDue(deadline.due_date) < 0,
      ),
    [monthlyDeadlines],
  );

  // Atenção = todos os pendentes vencidos (qualquer mês) + vence hoje
  const allAttentionCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return deadlines.filter((d) => {
      if (d.status !== 'pendente') return false;
      if (!matchesSecondaryFilters(d)) return false;
      return getDaysUntilDue(d.due_date) <= 0;
    }).length;
  }, [deadlines, matchesSecondaryFilters]);

  const monthlyAttentionCount = useMemo(
    () => monthlyDueToday.length + monthlyOverdue.length,
    [monthlyDueToday, monthlyOverdue],
  );

  const currentMonthLabel = useMemo(
    () => new Date(internalCalendarYear, internalCalendarMonth).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    [internalCalendarMonth, internalCalendarYear],
  );

  const memberMap = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

  // ── Histórico filtrado ────────────────────────────────────────────────────
  const filteredHistory = useMemo(() => {
    let base = isPastMonth ? monthlyArchived : archivedDeadlines;

    if (historyStatus) base = base.filter((d) => d.status === historyStatus);
    if (historySearch.trim()) {
      const term = historySearch.trim().toLowerCase();
      base = base.filter((d) =>
        d.title.toLowerCase().includes(term) ||
        (d.description || '').toLowerCase().includes(term) ||
        (d.client_id ? (clientMap.get(d.client_id)?.full_name || '').toLowerCase().includes(term) : false)
      );
    }
    if (historyMonth !== '') {
      base = base.filter((d) => new Date(getArchivedAt(d)).getMonth() === historyMonth);
    }
    if (historyYear !== '') {
      base = base.filter((d) => new Date(getArchivedAt(d)).getFullYear() === historyYear);
    }
    if (historyType) base = base.filter((d) => d.type === historyType);
    if (historyPriority) base = base.filter((d) => d.priority === historyPriority);
    if (historyResponsible) base = base.filter((d) => d.responsible_id === historyResponsible);
    // Responsável é quem o prazo estava designado; baixado por é quem executou.
    if (historyClosedBy) base = base.filter((d) => closuresByDeadline.get(d.id)?.user_id === historyClosedBy);
    return base;
  }, [isPastMonth, monthlyArchived, archivedDeadlines, historyStatus, historySearch, historyMonth, historyYear, historyType, historyPriority, historyResponsible, historyClosedBy, closuresByDeadline, clientMap]);

  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
  const paginatedHistory = filteredHistory.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);

  const historyYears = useMemo(() => {
    const years = new Set(archivedDeadlines.map((d) => new Date(getArchivedAt(d)).getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  }, [archivedDeadlines]);

  // ── Quem deu a baixa em cada prazo do histórico ───────────────────────────
  // Uma chamada para o conjunto inteiro, não uma por linha. A chave é a lista
  // de ids ordenada: reordenar ou refiltrar o histórico não dispara nova busca.
  const historyBaseIds = useMemo(() => {
    const base = isPastMonth ? monthlyArchived : archivedDeadlines;
    return base.map((d) => d.id).sort();
  }, [isPastMonth, monthlyArchived, archivedDeadlines]);
  const historyBaseIdsKey = historyBaseIds.join(',');

  useEffect(() => {
    if (!historyBaseIds.length) {
      setClosuresByDeadline(new Map());
      return;
    }
    let active = true;
    void deadlineService.getClosures(historyBaseIds).then((rows) => {
      if (!active) return;
      setClosuresByDeadline(new Map(rows.map((row) => [row.deadline_id, row])));
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyBaseIdsKey]);

  // Só entra na lista quem realmente aparece como autor de alguma baixa —
  // um seletor com o escritório inteiro teria opção que nunca filtra nada.
  const historyClosers = useMemo(() => {
    const porUsuario = new Map<string, string>();
    closuresByDeadline.forEach((closure) => {
      if (closure.user_id) porUsuario.set(closure.user_id, closure.user_name || 'Usuário');
    });
    return Array.from(porUsuario, ([userId, name]) => ({ userId, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [closuresByDeadline]);

  // ── Exportar lista filtrada ───────────────────────────────────────────────
  const handleExportFiltered = useCallback(() => {
    if (!filteredDeadlines.length) {
      alert('Nenhum prazo na lista filtrada para exportar.');
      return;
    }
    const data = filteredDeadlines.map((d) => ({
      'Título': d.title,
      'Vencimento': formatDate(d.due_date),
      'Status': getStatusLabel(d.status),
      'Prioridade': getPriorityLabel(d.priority),
      'Tipo': getTypeLabel(d.type),
      'Cliente': d.client_id ? (clientMap.get(d.client_id)?.full_name || '-') : '-',
      'Responsável': d.responsible_id ? (memberMap.get(d.responsible_id)?.name || '-') : '-',
      'Dias p/ vencimento': getDaysUntilDue(d.due_date),
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 35 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 30 }, { wch: 20 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Prazos Filtrados');
    XLSX.writeFile(wb, `prazos_filtrados_${new Date().toISOString().split('T')[0]}.xlsx`);
  }, [filteredDeadlines, clientMap, memberMap]);

  // Estatísticas para relatórios
  const reportStats = useMemo(() => {
    const getDateRange = () => {
      const today = new Date();
      let start: Date;
      let end: Date = new Date();
      
      switch (reportPeriod) {
        case 'week':
          start = new Date(today);
          start.setDate(today.getDate() - 7);
          break;
        case 'month':
          start = new Date(today.getFullYear(), today.getMonth(), 1);
          end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          break;
        case 'quarter':
          const quarter = Math.floor(today.getMonth() / 3);
          start = new Date(today.getFullYear(), quarter * 3, 1);
          end = new Date(today.getFullYear(), quarter * 3 + 3, 0);
          break;
        case 'year':
          start = new Date(today.getFullYear(), 0, 1);
          end = new Date(today.getFullYear(), 11, 31);
          break;
        case 'custom':
          start = reportStartDate ? new Date(reportStartDate) : new Date(today.getFullYear(), today.getMonth(), 1);
          end = reportEndDate ? new Date(reportEndDate) : new Date();
          break;
        default:
          start = new Date(today.getFullYear(), today.getMonth(), 1);
      }
      
      return { start, end };
    };
    
    const { start, end } = getDateRange();
    
    const periodDeadlines = deadlines.filter(d => {
      const dueDate = new Date(d.due_date);
      return dueDate >= start && dueDate <= end;
    });
    
    const byStatus: Record<string, number> = {};
    statusOptions.forEach(s => { byStatus[s.key] = periodDeadlines.filter(d => d.status === s.key).length; });

    const byPriority: Record<string, number> = {};
    priorityOptions.forEach(p => { byPriority[p.key] = periodDeadlines.filter(d => d.priority === p.key).length; });

    const byType: Record<string, number> = {};
    typeOptions.forEach(t => { byType[t.key] = periodDeadlines.filter(d => d.type === t.key).length; });
    
    // Por responsável
    const byResponsible: Record<string, number> = {};
    periodDeadlines.forEach(d => {
      const name = d.responsible_id ? (memberMap.get(d.responsible_id)?.name || 'Não atribuído') : 'Não atribuído';
      byResponsible[name] = (byResponsible[name] || 0) + 1;
    });
    
    // Por cliente (top 10)
    const byClient: Record<string, number> = {};
    periodDeadlines.forEach(d => {
      const name = d.client_id ? (clientMap.get(d.client_id)?.full_name || 'Sem cliente') : 'Sem cliente';
      byClient[name] = (byClient[name] || 0) + 1;
    });
    
    // Taxa de cumprimento
    const total = periodDeadlines.length;
    const completed = byStatus['cumprido'] ?? 0;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    // Média de dias para cumprir (dos cumpridos)
    const completedDeadlinesInPeriod = periodDeadlines.filter(d => d.status === 'cumprido' && d.completed_at);
    let avgDaysToComplete = 0;
    if (completedDeadlinesInPeriod.length > 0) {
      const totalDays = completedDeadlinesInPeriod.reduce((acc, d) => {
        const created = new Date(d.created_at);
        const completed = new Date(d.completed_at!);
        return acc + Math.ceil((completed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      }, 0);
      avgDaysToComplete = Math.round(totalDays / completedDeadlinesInPeriod.length);
    }
    
    return {
      total,
      byStatus,
      byPriority,
      byType,
      byResponsible,
      byClient,
      completionRate,
      avgDaysToComplete,
      periodStart: start,
      periodEnd: end,
    };
  }, [deadlines, reportPeriod, reportStartDate, reportEndDate, memberMap, clientMap, statusOptions, priorityOptions, typeOptions]);

  const deadlinesSyncTick = useSyncTick('deadlines');

  useEffect(() => {
    const fetchDeadlines = async () => {
      try {
        setLoading(true);
        setError(null);
        // Os excluídos vêm em uma lista à parte, e não misturados em `deadlines`:
        // assim a fila, o kanban, o calendário, os contadores e o relatório
        // continuam falando só dos prazos vivos, sem cada um ter de lembrar de
        // descartar o excluído. Quem os junta é o Histórico, e só ele.
        // Os agendados também vêm à parte, pela mesma razão: `deadlines` é a
        // fila de trabalho, e prazo dormindo não é trabalho de hoje.
        const [data, apagados, agendados] = await Promise.all([
          deadlineService.listDeadlines(),
          deadlineService.listDeadlines({ deleted: 'excluidos' }).catch(() => [] as Deadline[]),
          deadlineService.listScheduledDeadlines().catch(() => [] as Deadline[]),
        ]);
        setDeadlines(data);
        setDeletedDeadlines(apagados);
        setScheduledCount(agendados.length);
      } catch (err: any) {
        setError(err.message || 'Não foi possível carregar os prazos.');
      } finally {
        setLoading(false);
      }
    };

    fetchDeadlines();
  }, [deadlinesSyncTick]);

  useEffect(() => {
    let active = true;

    const loadProcesses = async () => {
      try {
        const data = await processService.listProcesses();
        if (!active) return;
        setProcesses(data);
      } catch (err) {
        console.error(err);
      }
    };

    loadProcesses();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadRequirements = async () => {
      try {
        const data = await requirementService.listRequirements();
        if (!active) return;
        setRequirements(data);
      } catch (err) {
        console.error(err);
      }
    };

    loadRequirements();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadMembers = async () => {
      try {
        // Usar settingsService.listUsers() que filtra is_active = true
        const data = await settingsService.listUsers();
        if (!active) return;
        setMembers(data);
      } catch (err) {
        console.error(err);
      }
    };

    loadMembers();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(SAVED_FILTERS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setSavedFilters(parsed);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar filtros salvos de prazos.', err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(savedFilters));
    } catch (err) {
      console.error('Erro ao persistir filtros salvos de prazos.', err);
    }
  }, [savedFilters]);

  useEffect(() => {
    const match = savedFilters.find(
      (filter) =>
        filter.search === filterSearch &&
        filter.type === filterType &&
        filter.priority === filterPriority &&
        filter.responsibleId === filterResponsible &&
        filter.status === activeStatusTab,
    );
    setSelectedSavedFilterId(match?.id ?? '');
  }, [filterSearch, filterType, filterPriority, filterResponsible, activeStatusTab, savedFilters]);

  useEffect(() => {
    let active = true;

    const loadProfile = async () => {
      try {
        const profile = await profileService.getMyProfile();
        if (!active) return;
        setCurrentUser(profile);
      } catch (err) {
        console.error('Não foi possível carregar o perfil do usuário para o relatório.', err);
      }
    };

    loadProfile();

    return () => {
      active = false;
    };
  }, []);

  // Filtro padrão: todo usuário (inclusive admin) vê apenas seus próprios prazos.
  // Para ver os prazos de toda a equipe, basta selecionar "Todos" no filtro de responsável.
  useEffect(() => {
    if (permissionsLoading || !currentUser) return;
    if (currentUser.id) {
      setFilterResponsible(currentUser.id);
    }
  }, [permissionsLoading, isAdmin, currentUser]);

  useEffect(() => {
    let active = true;
    setClientsLoading(true);

    const handler = setTimeout(async () => {
      try {
        const term = clientSearchTerm.trim();
        const data = await clientService.listClients(term ? { search: term } : undefined);
        if (!active) return;
        setClients(data);
      } catch (err) {
        if (active) {
          console.error(err);
        }
      } finally {
        if (active) {
          setClientsLoading(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(handler);
    };
  }, [clientSearchTerm]);


  useEffect(() => {
    if (forceCreate && !isModalOpen) {
      setSelectedDeadline(null);
      
      // Aplica dados prefill se fornecidos
      if (prefillData) {
        setFormData({
          ...emptyForm,
          status: (defaultDeadlineStatus && statusOptions.some(s => s.key === defaultDeadlineStatus)
            ? defaultDeadlineStatus : emptyForm.status) as DeadlineStatus,
          priority: (defaultDeadlinePriority && priorityOptions.some(p => p.key === defaultDeadlinePriority)
            ? defaultDeadlinePriority : emptyForm.priority) as DeadlinePriority,
          title: prefillData.title || emptyForm.title,
          description: prefillData.description || emptyForm.description,
          client_id: prefillData.client_id || emptyForm.client_id,
          process_id: prefillData.process_id || emptyForm.process_id,
        });
        
        // Se tem nome do cliente, atualiza o clientSearchTerm
        if (prefillData.client_name) {
          setClientSearchTerm(prefillData.client_name);
        }
        
        // Se tem código do processo, atualiza o processSearchTerm
        if (prefillData.process_code) {
          setProcessSearchTerm(prefillData.process_code);
        }
      } else {
        const defaultDueDate = defaultDeadlineDays > 0
          ? (() => { const d = new Date(); d.setDate(d.getDate() + defaultDeadlineDays); return d.toISOString().slice(0, 10); })()
          : '';
        setFormData({ ...emptyForm, notify_days_before: String(defaultNotifyDays), due_date: defaultDueDate });
      }

      setIsModalOpen(true);
      if (onParamConsumed) {
        onParamConsumed();
      }
    }
  }, [forceCreate, isModalOpen, onParamConsumed, prefillData]);

  useEffect(() => {
    if (!entityId) return;
    const local = deadlines.find(d => d.id === entityId);
    if (local) {
      setSelectedDeadlineForView(local);
      setShowViewDeadlineModal(true);
      onParamConsumed?.();
      return;
    }
    // Não está na lista (ex.: usuário mencionado não é o responsável) — busca direto
    let active = true;
    (async () => {
      const fetched = await deadlineService.getDeadlineById(entityId);
      if (active && fetched) {
        setSelectedDeadlineForView(fetched);
        setShowViewDeadlineModal(true);
        onParamConsumed?.();
      }
    })();
    return () => { active = false; };
  }, [entityId, deadlines, onParamConsumed]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleReload = async () => {
    try {
      setLoading(true);
      const data = await deadlineService.listDeadlines();
      setDeadlines(data);
      if (selectedDeadlineForView) {
        const updated = data.find((item) => item.id === selectedDeadlineForView.id);
        if (updated) {
          setSelectedDeadlineForView(updated);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Não foi possível atualizar a lista de prazos.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (deadline?: Deadline) => {
    if (deadline) {
      setSelectedDeadline(deadline);
      setFormData({
        title: deadline.title,
        description: deadline.description || '',
        due_date: toDateInputValue(deadline.due_date),
        status: deadline.status,
        priority: deadline.priority,
        type: deadline.type,
        process_id: deadline.process_id || '',
        requirement_id: deadline.requirement_id || '',
        client_id: deadline.client_id || '',
        responsible_id: deadline.responsible_id || '',
        notify_days_before: String(deadline.notify_days_before ?? defaultNotifyDays),
        visible_from: toDateInputValue(deadline.visible_from),
      });

      if (deadline.process_id) {
        const process = processes.find((p) => p.id === deadline.process_id);
        if (process) {
          setProcessSearchTerm(process.process_code ?? '');
        }
      }

      if (deadline.requirement_id) {
        const requirement = requirements.find((r) => r.id === deadline.requirement_id);
        if (requirement) {
          setRequirementSearchTerm(requirement.protocol ?? '');
        }
      }
      setDataPublicacao(deadline.publication_date ? toDateInputValue(deadline.publication_date) : '');
      setDiasPrazo(deadline.deadline_days != null ? String(deadline.deadline_days) : '');
      setTipoPrazoCalculadora((deadline.counting_type as TipoPrazo) || 'processual');
    } else {
      setSelectedDeadline(null);
      let defaultResponsibleId = '';
      if (responsibilityConfig?.default_mode === 'creator' && currentUser?.id) {
        defaultResponsibleId = currentUser.id;
      } else if (responsibilityConfig?.default_mode === 'single' && responsibilityConfig.single_member_id) {
        defaultResponsibleId = responsibilityConfig.single_member_id;
      }
      const defaultDueDate = defaultDeadlineDays > 0
        ? (() => { const d = new Date(); d.setDate(d.getDate() + defaultDeadlineDays); return d.toISOString().slice(0, 10); })()
        : '';
      setFormData({
        ...emptyForm,
        status: (defaultDeadlineStatus && statusOptions.some(s => s.key === defaultDeadlineStatus)
          ? defaultDeadlineStatus : emptyForm.status) as DeadlineStatus,
        priority: (defaultDeadlinePriority && priorityOptions.some(p => p.key === defaultDeadlinePriority)
          ? defaultDeadlinePriority : emptyForm.priority) as DeadlinePriority,
        responsible_id: defaultResponsibleId,
        notify_days_before: String(defaultNotifyDays),
        due_date: defaultDueDate,
      });
      setProcessSearchTerm('');
      setRequirementSearchTerm('');
      setDataPublicacao('');
      setDiasPrazo('');
      setTipoPrazoCalculadora('processual');
    }

    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (saving) return;
    setIsModalOpen(false);
    setSelectedDeadline(null);
    setFormData(emptyForm);
    setProcessSearchTerm('');
    setRequirementSearchTerm('');
    setShowProcessSuggestions(false);
    setShowRequirementSuggestions(false);
    setDataPublicacao('');
    setDiasPrazo('');
  };

  const handleFormChange = (field: keyof typeof formData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!formData.title.trim()) {
      setError('Informe o título do prazo.');
      return;
    }

    if (!formData.due_date) {
      setError('Informe a data de vencimento.');
      return;
    }

    if (!formData.client_id) {
      setError('Selecione o cliente relacionado ao prazo.');
      return;
    }

    if (!formData.responsible_id) {
      setError('Selecione o responsável pelo prazo.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      // Cancelar pelo formulário também exige motivo: salva o resto mantendo o
      // status atual e abre o modal de cancelamento logo depois.
      const wantsCancel = !!selectedDeadline && formData.status === 'cancelado' && selectedDeadline.status !== 'cancelado';

      const payloadBase = {
        title: formData.title.trim(),
        description: formData.description?.trim() || null,
        due_date: new Date(formData.due_date).toISOString(),
        status: wantsCancel && selectedDeadline ? selectedDeadline.status : formData.status,
        priority: formData.priority,
        type: formData.type,
        process_id: formData.process_id || null,
        requirement_id: formData.requirement_id || null,
        client_id: formData.client_id || null,
        responsible_id: formData.responsible_id,
        notify_days_before: formData.notify_days_before ? parseInt(formData.notify_days_before, 10) : defaultNotifyDays,
        publication_date: dataPublicacao || null,
        deadline_days: diasPrazo ? parseInt(diasPrazo, 10) : null,
        counting_type: tipoPrazoCalculadora || null,
        // Meia-noite do fuso do escritório — ver o comentário em DeadlineFormModal.
        visible_from: formData.visible_from ? toOfficeTimestamp(`${formData.visible_from}T00:00`) : null,
      };

      const editingDeadline = selectedDeadline;
      let updatedDeadline: Deadline | null = null;

      if (editingDeadline) {
        const responsibleChanged = payloadBase.responsible_id && payloadBase.responsible_id !== editingDeadline.responsible_id;
        await deadlineService.updateDeadline(editingDeadline.id, payloadBase);
        updatedDeadline = await deadlineService.getDeadlineById(editingDeadline.id);
        if (updatedDeadline) {
          setDeadlines((prev) => prev.map((item) => (item.id === updatedDeadline!.id ? updatedDeadline! : item)));
          setSelectedDeadline(updatedDeadline);
          if (selectedDeadlineForView?.id === updatedDeadline.id) {
            setSelectedDeadlineForView(updatedDeadline);
          }

          // 🔔 Notificação de sistema + email se o responsável mudou
          const newRespAuthId = payloadBase.responsible_id ? memberMap.get(payloadBase.responsible_id)?.user_id : null;
          if (responsibleChanged && user?.id && newRespAuthId && newRespAuthId !== user.id) {
            try {
              const assignerName = currentUser?.name || 'Alguém';
              const daysUntilDue = Math.ceil((new Date(payloadBase.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              const isUrgent = daysUntilDue <= 3 || payloadBase.priority === 'urgente' || payloadBase.priority === 'alta';
              const deadlineTypeLabels: Record<string, string> = { geral: 'Geral', processo: 'Processo', requerimento: 'Requerimento' };
              const deadlineTypeLabel = deadlineTypeLabels[payloadBase.type] || payloadBase.type || 'Prazo';
              const priorityLabels: Record<string, string> = { urgente: 'Urgente', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
              const priorityLabel = priorityLabels[payloadBase.priority] || '';
              const daysLabel = daysUntilDue <= 0 ? 'Vencido!' : daysUntilDue === 1 ? 'Vence amanhã' : `Vence em ${daysUntilDue} dia(s)`;
              await userNotificationService.createNotification({
                title: isUrgent ? `⚠️ Prazo ${deadlineTypeLabel} — ${priorityLabel}` : `📅 Prazo ${deadlineTypeLabel} Atribuído`,
                message: `${assignerName} atribuiu um prazo a você\n"${payloadBase.title}" • ${daysLabel}`,
                type: 'deadline_assigned',
                user_id: newRespAuthId,
                deadline_id: editingDeadline.id,
                metadata: { priority: payloadBase.priority, type: payloadBase.type, days_until_due: daysUntilDue },
              });
            } catch {}
            supabase.functions.invoke('notify-deadline-assigned', {
              body: { deadline_id: editingDeadline.id, assigned_by_id: user.id },
            }).catch((err) => console.error('Erro ao enviar email de prazo:', err));
          }
        } else {
          await handleReload();
        }
      } else {
        const newDeadline = await deadlineService.createDeadline(payloadBase as any);
        
        // 🔔 Criar notificação para novo prazo
        const responsibleAuthId = payloadBase.responsible_id ? memberMap.get(payloadBase.responsible_id)?.user_id : null;
        if (user?.id && newDeadline && responsibleAuthId && responsibleAuthId !== user.id) {
          try {
            const assignerName = currentUser?.name || 'Alguém';
            const daysUntilDue = Math.ceil((new Date(payloadBase.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            const isUrgent = daysUntilDue <= 3 || payloadBase.priority === 'urgente' || payloadBase.priority === 'alta';
            const deadlineTypeLabels: Record<string, string> = { geral: 'Geral', processo: 'Processo', requerimento: 'Requerimento' };
            const deadlineTypeLabel = deadlineTypeLabels[payloadBase.type] || payloadBase.type || 'Prazo';
            const priorityLabels: Record<string, string> = { urgente: 'Urgente', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
            const priorityLabel = priorityLabels[payloadBase.priority] || '';
            const daysLabel = daysUntilDue <= 0 ? 'Vencido!' : daysUntilDue === 1 ? 'Vence amanhã' : `Vence em ${daysUntilDue} dia(s)`;

            await userNotificationService.createNotification({
              title: isUrgent ? `⚠️ Prazo ${deadlineTypeLabel} — ${priorityLabel}` : `📅 Prazo ${deadlineTypeLabel} Atribuído`,
              message: `${assignerName} atribuiu um prazo a você\n"${payloadBase.title}" • ${daysLabel}`,
              type: 'deadline_assigned',
              user_id: responsibleAuthId,
              deadline_id: newDeadline.id,
              metadata: {
                priority: payloadBase.priority,
                type: payloadBase.type,
                days_until_due: daysUntilDue,
              },
            });
          } catch {}

          // 📧 Enviar email de notificação (não-bloqueante)
          supabase.functions.invoke('notify-deadline-assigned', {
            body: { deadline_id: newDeadline.id, assigned_by_id: user.id },
          }).catch((err) => console.error('Erro ao enviar email de prazo:', err));
        }
        
        await handleReload();
      }

      setIsModalOpen(false);
      if (!updatedDeadline) {
        setSelectedDeadline(null);
      }
      setFormData(emptyForm);
      setProcessSearchTerm('');
      setRequirementSearchTerm('');
      setDataPublicacao('');
      setDiasPrazo('');

      if (wantsCancel && editingDeadline) {
        requestCancelDeadline([editingDeadline.id], payloadBase.title);
      }
    } catch (err: any) {
      setError(err.message || 'Não foi possível salvar o prazo.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDeadline = async (id: string) => {
    const deadline = deadlines.find((d) => d.id === id);
    const confirmed = await confirmDelete({
      title: 'Excluir prazo',
      entityName: deadline?.title || undefined,
      message: 'O prazo sai da fila de tarefas e vai para o Histórico de Prazos, de onde pode ser consultado e restaurado.',
      confirmLabel: 'Excluir',
      permission: { module: 'prazos', action: 'delete' },
    });
    if (!confirmed) return;

    try {
      await deadlineService.deleteDeadline(id);
      notifyDeleted(deadline?.title || undefined);
      // Troca de lista na hora: sai da fila e entra no histórico, sem esperar a
      // releitura do servidor. O carimbo local espelha o que o banco gravou.
      setDeadlines((prev) => prev.filter((item) => item.id !== id));
      if (deadline) {
        const excluido = { ...deadline, status: 'excluido' as DeadlineStatus, deleted_at: new Date().toISOString() };
        setDeletedDeadlines((prev) => [excluido, ...prev.filter((item) => item.id !== id)]);
      }
      if (selectedDeadlineForView?.id === id) {
        handleBackToList();
      }
    } catch (err: any) {
      setError(err.message || 'Não foi possível remover o prazo.');
    }
  };

  /**
   * Devolve o prazo do histórico para a fila. Usa o mesmo botão que reabre um
   * cumprido — para quem opera é a mesma ideia: "volta a valer".
   */
  const handleRestoreDeadline = async (id: string) => {
    try {
      const restaurado = await deadlineService.restoreDeadline(id);
      setDeletedDeadlines((prev) => prev.filter((item) => item.id !== id));
      setDeadlines((prev) => [...prev.filter((item) => item.id !== id), restaurado]);
      if (selectedDeadlineForView?.id === id) setSelectedDeadlineForView(restaurado);
    } catch (err: any) {
      setError(err.message || 'Não foi possível restaurar o prazo.');
    }
  };

  const handleViewDeadline = (deadline: Deadline) => {
    setSelectedDeadlineForView(deadline);
    setShowViewDeadlineModal(true);
  };

  // Força o carregamento dos comentários sempre que o modal abre,
  // independente de como foi aberto (clique, notificação, deep-link).
  useEffect(() => {
    const id = selectedDeadlineForView?.id;
    if ((showViewDeadlineModal || viewMode === 'details') && id) {
      setShowCommentsFor(id);
      void loadComments(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showViewDeadlineModal, viewMode, selectedDeadlineForView?.id]);

  // Motivo do cancelamento: só busca quando o prazo aberto está cancelado.
  useEffect(() => {
    const deadline = selectedDeadlineForView;
    const isOpen = showViewDeadlineModal || viewMode === 'details';
    if (!isOpen || !deadline || deadline.status !== 'cancelado') {
      setViewCancellation(null);
      return;
    }
    let active = true;
    setViewCancellation(null);
    void deadlineService.getCancellation(deadline.id).then((row) => {
      if (active) setViewCancellation(row);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showViewDeadlineModal, viewMode, selectedDeadlineForView?.id, selectedDeadlineForView?.status]);

  // Linha do tempo do prazo: quem cumpriu, quem cancelou, quem mudou a data.
  // Recarrega quando o status muda para que a baixa feita com o modal aberto
  // apareça sem precisar fechar e abrir de novo.
  useEffect(() => {
    const deadline = selectedDeadlineForView;
    const isOpen = showViewDeadlineModal || viewMode === 'details';
    if (!isOpen || !deadline) {
      setViewTimeline([]);
      return;
    }
    let active = true;
    setViewTimelineLoading(true);
    void deadlineService.getTimeline(deadline.id).then((rows) => {
      if (!active) return;
      setViewTimeline(rows);
      setViewTimelineLoading(false);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showViewDeadlineModal, viewMode, selectedDeadlineForView?.id, selectedDeadlineForView?.status]);

  const handleCloseViewDeadlineModal = () => {
    setShowViewDeadlineModal(false);
    setSelectedDeadlineForView(null);
  };

  const handleBackToList = () => {
    setSelectedDeadlineForView(null);
    setViewMode('list');
  };

  const handleStatusChange = async (deadlineId: string, newStatus: DeadlineStatus) => {
    if (newStatus === 'cancelado') {
      const target = deadlines.find((d) => d.id === deadlineId);
      requestCancelDeadline([deadlineId], target?.title || 'este prazo');
      return;
    }
    try {
      setStatusUpdatingId(deadlineId);
      const deadline = deadlines.find((d) => d.id === deadlineId);

      await deadlineService.updateStatus(deadlineId, newStatus);
      
      // Se o prazo for de exigência e foi marcado como cumprido, atualizar o requerimento para em_analise
      if (
        deadline &&
        deadline.type === 'requerimento' &&
        deadline.requirement_id &&
        newStatus === 'cumprido'
      ) {
        try {
          await requirementService.updateStatus(deadline.requirement_id, 'em_analise');
        } catch (reqErr) {
          console.error('Erro ao atualizar status do requerimento:', reqErr);
        }
      }
      
      // Se o prazo for de exigência e foi reaberto (cumprido → pendente), voltar requerimento para em_exigencia
      if (
        deadline &&
        deadline.type === 'requerimento' &&
        deadline.requirement_id &&
        deadline.status === 'cumprido' &&
        newStatus === 'pendente'
      ) {
        try {
          await requirementService.updateStatus(deadline.requirement_id, 'em_exigencia');
        } catch (reqErr) {
          console.error('Erro ao atualizar status do requerimento:', reqErr);
        }
      }
      
      await handleReload();
    } catch (err: any) {
      setError(err.message || 'Não foi possível atualizar o status.');
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const handleConfirmCancel = useCallback(async () => {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (!reason) {
      setCancelError('Descreva o motivo do cancelamento.');
      return;
    }
    setCancelSaving(true);
    setCancelError(null);
    try {
      // Os prints sobem uma vez só e o mesmo descritor vai para todos os prazos
      // do lote — é o mesmo motivo, não faz sentido duplicar o arquivo.
      const uploaded: DeadlineCancellationAttachment[] = [];
      for (const item of cancelFiles) {
        uploaded.push(await deadlineService.uploadCancellationAttachment(cancelTarget.ids[0], item.file));
      }
      for (const id of cancelTarget.ids) {
        await deadlineService.cancelDeadline(id, reason, user?.id ?? null, uploaded);
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        cancelTarget.ids.forEach((id) => next.delete(id));
        return next;
      });
      if (selectedDeadlineForView && cancelTarget.ids.includes(selectedDeadlineForView.id)) {
        setSelectedDeadlineForView((prev) => (prev ? { ...prev, status: 'cancelado' } : prev));
      }
      closeCancelModal();
      await handleReload();
    } catch (err: any) {
      setCancelError(err.message || 'Não foi possível cancelar o prazo.');
    } finally {
      setCancelSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelTarget, cancelReason, cancelFiles, user?.id, selectedDeadlineForView, closeCancelModal]);

  const getStatusConfig = (status: DeadlineStatus) => statusOptions.find((s) => s.key === status);
  const getPriorityConfig = (priority: DeadlinePriority) => priorityOptions.find((p) => p.key === priority);
  const getTypeConfig = (type: DeadlineType) => typeOptions.find((t) => t.key === type);
  // 'excluido' não está em statusOptions (que o escritório configura e vira as
  // abas da fila), então o rótulo e a cor dele vêm do mapa do histórico — sem
  // isso a tela mostraria a chave crua, "excluido", sem acento.
  const getStatusBadge = (status: DeadlineStatus) => {
    const config = getStatusConfig(status);
    return config ? config.badge : HISTORY_STATUS_STYLE[status] || 'bg-slate-100 text-slate-600';
  };

  const getStatusLabel = (status: DeadlineStatus) => {
    const config = getStatusConfig(status);
    return config ? config.label : HISTORY_STATUS_LABEL[status] || status;
  };

  const getPriorityBadge = (priority: DeadlinePriority) => {
    const config = getPriorityConfig(priority);
    return config ? config.badge : 'bg-slate-100 text-slate-600';
  };

  const getPriorityLabel = (priority: DeadlinePriority) => {
    const config = getPriorityConfig(priority);
    return config ? config.label : priority;
  };

  const getTypeLabel = (type: DeadlineType) => {
    const config = getTypeConfig(type);
    return config ? config.label : type;
  };

  const handleExportExcel = async () => {
    if (!deadlines.length) {
      alert('Não há prazos disponíveis para exportar.');
      return;
    }

    try {
      setExportingExcel(true);

      const excelData = deadlines.map((deadline) => ({
        'Título': deadline.title,
        'Descrição': deadline.description || '',
        'Data de Vencimento': formatDate(deadline.due_date),
        'Status': getStatusLabel(deadline.status),
        'Prioridade': getPriorityLabel(deadline.priority),
        'Tipo': getTypeLabel(deadline.type),
        'Dias para Vencimento': getDaysUntilDue(deadline.due_date),
        'Notificar (dias antes)': deadline.notify_days_before ?? 3,
        'Criado em': deadline.created_at ? new Date(deadline.created_at).toLocaleDateString('pt-BR') : '',
        'Atualizado em': deadline.updated_at ? new Date(deadline.updated_at).toLocaleDateString('pt-BR') : '',
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);

      const colWidths = [
        { wch: 30 }, // Título
        { wch: 40 }, // Descrição
        { wch: 18 }, // Data de Vencimento
        { wch: 15 }, // Status
        { wch: 12 }, // Prioridade
        { wch: 15 }, // Tipo
        { wch: 20 }, // Dias para Vencimento
        { wch: 20 }, // Notificar
        { wch: 12 }, // Criado em
        { wch: 12 }, // Atualizado em
      ];
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, 'Prazos');

      const now = new Date();
      const dateSlug = now.toISOString().split('T')[0];
      const filename = `prazos_${dateSlug}.xlsx`;

      XLSX.writeFile(wb, filename);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Não foi possível exportar os dados para Excel.');
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportReport = () => {
    const { periodStart, periodEnd } = reportStats;
    
    // Criar workbook com múltiplas abas
    const wb = XLSX.utils.book_new();
    
    // Aba 1: Resumo
    const resumoData = [
      ['RELATÓRIO DE PRAZOS'],
      [''],
      ['Período:', `${periodStart.toLocaleDateString('pt-BR')} a ${periodEnd.toLocaleDateString('pt-BR')}`],
      ['Gerado em:', new Date().toLocaleString('pt-BR')],
      [''],
      ['RESUMO GERAL'],
      ['Total de Prazos:', reportStats.total],
      ['Taxa de Cumprimento:', `${reportStats.completionRate}%`],
      ['Média de Dias para Cumprir:', reportStats.avgDaysToComplete],
      [''],
      ['POR STATUS'],
      ...statusOptions.map(s => [s.label, reportStats.byStatus[s.key] ?? 0]),
      [''],
      ['POR PRIORIDADE'],
      ...priorityOptions.map(p => [p.label, reportStats.byPriority[p.key] ?? 0]),
      [''],
      ['POR TIPO'],
      ...typeOptions.map(t => [t.label, reportStats.byType[t.key] ?? 0]),
    ];
    const wsResumo = XLSX.utils.aoa_to_sheet(resumoData);
    wsResumo['!cols'] = [{ wch: 30 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');
    
    // Aba 2: Por Responsável
    const responsavelData = [
      ['Responsável', 'Quantidade'],
      ...Object.entries(reportStats.byResponsible).sort((a, b) => b[1] - a[1]),
    ];
    const wsResponsavel = XLSX.utils.aoa_to_sheet(responsavelData);
    wsResponsavel['!cols'] = [{ wch: 30 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsResponsavel, 'Por Responsável');
    
    // Aba 3: Por Cliente
    const clienteData = [
      ['Cliente', 'Quantidade'],
      ...Object.entries(reportStats.byClient).sort((a, b) => b[1] - a[1]).slice(0, 20),
    ];
    const wsCliente = XLSX.utils.aoa_to_sheet(clienteData);
    wsCliente['!cols'] = [{ wch: 40 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsCliente, 'Por Cliente');
    
    // Aba 4: Detalhamento
    const periodDeadlines = deadlines.filter(d => {
      const dueDate = new Date(d.due_date);
      return dueDate >= periodStart && dueDate <= periodEnd;
    });
    
    const detalheData = periodDeadlines.map(d => ({
      'Título': d.title,
      'Vencimento': formatDate(d.due_date),
      'Status': getStatusLabel(d.status),
      'Prioridade': getPriorityLabel(d.priority),
      'Tipo': getTypeLabel(d.type),
      'Cliente': d.client_id ? (clientMap.get(d.client_id)?.full_name || '-') : '-',
      'Responsável': d.responsible_id ? (memberMap.get(d.responsible_id)?.name || '-') : '-',
    }));
    const wsDetalhe = XLSX.utils.json_to_sheet(detalheData);
    wsDetalhe['!cols'] = [
      { wch: 30 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
      { wch: 15 },
      { wch: 30 },
      { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDetalhe, 'Detalhamento');
    
    // Salvar arquivo
    const dateSlug = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `relatorio_prazos_${dateSlug}.xlsx`);
  };

  const handleExportPdf = async () => {
    if (!deadlines.length) {
      alert('Não há prazos disponíveis para exportar.');
      return;
    }

    try {
      setExportingPdf(true);

      let effectiveUser = currentUser;
      if (!effectiveUser) {
        try {
          effectiveUser = await profileService.getMyProfile();
          setCurrentUser(effectiveUser);
        } catch (err) {
          console.error('Não foi possível carregar o perfil do usuário antes da exportação.', err);
        }
      }

      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      // Cores
      const blue = rgb(0.13, 0.4, 0.7);
      const green = rgb(0.1, 0.55, 0.4);
      const orange = rgb(0.85, 0.5, 0.15);
      const red = rgb(0.75, 0.2, 0.2);
      const darkText = rgb(0.15, 0.15, 0.15);
      const grayText = rgb(0.4, 0.4, 0.4);
      const lightGray = rgb(0.94, 0.94, 0.96);
      const white = rgb(1, 1, 1);

      // Página A4
      let page = pdfDoc.addPage([595.28, 841.89]);
      let { width, height } = page.getSize();
      const margin = 40;
      const usableWidth = width - margin * 2;
      let y = height - margin;

      const createNewPage = () => {
        page = pdfDoc.addPage([595.28, 841.89]);
        ({ width, height } = page.getSize());
        y = height - margin;
      };

      const checkSpace = (needed: number) => {
        if (y - needed < margin + 30) {
          createNewPage();
        }
      };

      const text = (
        str: string,
        x: number,
        yPos: number,
        size = 10,
        bold = false,
        color = darkText,
        maxW?: number,
      ) => {
        let display = str || '';
        if (maxW) {
          const avgChar = size * 0.52;
          const maxChars = Math.floor(maxW / avgChar);
          if (display.length > maxChars) {
            display = display.substring(0, maxChars - 2) + '..';
          }
        }
        page.drawText(display, {
          x,
          y: yPos,
          size,
          font: bold ? boldFont : font,
          color,
        });
      };

      const rect = (x: number, yPos: number, w: number, h: number, color: ReturnType<typeof rgb>) => {
        page.drawRectangle({ x, y: yPos, width: w, height: h, color });
      };

      const { periodStart, periodEnd, total, completionRate, avgDaysToComplete, byStatus, byPriority, byType } = reportStats;
      const periodDeadlines = deadlines
        .filter((d) => {
          const dueDate = new Date(d.due_date);
          return dueDate >= periodStart && dueDate <= periodEnd;
        })
        .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

      const exportTimestamp = new Date();
      const exportedBy = effectiveUser?.name?.trim().length ? effectiveUser.name : 'Usuário do sistema';
      const exportedEmail = effectiveUser?.email?.trim().length ? effectiveUser.email : 'E-mail não informado';
      const exportedRole = effectiveUser?.role?.trim().length ? effectiveUser.role : 'Não informado';
      const exportLogId = `${exportTimestamp.getTime()}-${effectiveUser?.id ?? 'anon'}`;
      const periodLabel = `${periodStart.toLocaleDateString('pt-BR')} a ${periodEnd.toLocaleDateString('pt-BR')}`;

      // ===== HEADER =====
      const headerHeight = 110;
      rect(0, height - headerHeight, width, headerHeight, blue);
      text('RELATÓRIO DE PRAZOS', margin, height - 38, 20, true, white);
      text(`Período: ${periodLabel}`, margin, height - 58, 10, false, rgb(0.85, 0.9, 1));
      text(`Gerado em: ${exportTimestamp.toLocaleString('pt-BR')}`, margin, height - 74, 9, false, rgb(0.7, 0.8, 0.95));
      text(`Exportado por: ${exportedBy}`, margin, height - 90, 9, false, rgb(0.7, 0.8, 0.95));
      y = height - headerHeight - 20;

      // ===== RESUMO (4 CARDS) =====
      const cardW = (usableWidth - 24) / 4;
      const cardH = 50;
      checkSpace(cardH + 20);
      const cardColors = [blue, green, orange, red];
      const cardLabels = ['Total', 'Cumpridos', 'Média dias', 'Vencidos'];
      const cardValues = [String(total), `${completionRate}%`, String(avgDaysToComplete || 0), String(byStatus.vencido)];

      for (let i = 0; i < 4; i++) {
        const cx = margin + i * (cardW + 8);
        const cy = y - cardH;
        rect(cx, cy, cardW, cardH, cardColors[i]);
        text(cardValues[i], cx + 10, cy + 28, 18, true, white);
        text(cardLabels[i], cx + 10, cy + 10, 9, false, rgb(0.9, 0.95, 1));
      }
      y -= cardH + 20;

      // ===== SEÇÕES DE LISTA =====
      const addList = (title: string, items: [string, number][]) => {
        const rowH = 16;
        const neededH = 28 + items.length * rowH + 10;
        checkSpace(neededH);

        // Título
        rect(margin, y - 20, usableWidth, 22, lightGray);
        text(title, margin + 8, y - 14, 11, true, blue);
        y -= 30;

        if (!items.length) {
          text('Nenhum dado disponível.', margin + 8, y, 10, false, grayText);
          y -= 20;
          return;
        }

        // Itens em lista vertical simples
        items.forEach(([label, value]) => {
          checkSpace(rowH + 5);
          text(label, margin + 8, y, 10, false, darkText, usableWidth - 60);
          text(String(value), margin + usableWidth - 40, y, 10, true, blue);
          y -= rowH;
        });
        y -= 10;
      };

      addList('Por Status', Object.entries(byStatus).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v]));
      addList('Por Prioridade', Object.entries(byPriority).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v]));
      addList('Por Tipo', Object.entries(byType).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v]));

      const responsibleEntries = Object.entries(reportStats.byResponsible).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (responsibleEntries.length) {
        addList('Top 5 Responsáveis', responsibleEntries as [string, number][]);
      }

      const clientEntries = Object.entries(reportStats.byClient).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (clientEntries.length) {
        addList('Top 5 Clientes', clientEntries as [string, number][]);
      }

      // ===== DETALHAMENTO DOS PRAZOS =====
      if (periodDeadlines.length) {
        checkSpace(80);
        rect(margin, y - 20, usableWidth, 22, lightGray);
        text('DETALHAMENTO DOS PRAZOS', margin + 8, y - 14, 11, true, blue);
        y -= 32;

        const cardHeight = 32;

        periodDeadlines.forEach((deadline, idx) => {
          const extraHeight = 18; // for meta line
          const totalHeight = cardHeight + extraHeight;
          if (y - totalHeight < margin + 30) {
            createNewPage();
            rect(margin, y - 20, usableWidth, 22, lightGray);
            text('DETALHAMENTO DOS PRAZOS (cont.)', margin + 8, y - 14, 11, true, blue);
            y -= 32;
          }

          const cardY = y - cardHeight;
          if (idx % 2 === 0) {
            rect(margin, cardY - 6, usableWidth, totalHeight, lightGray);
          }

          const clientName = deadline.client_id ? clientMap.get(deadline.client_id)?.full_name : null;
          const responsibleName = deadline.responsible_id ? memberMap.get(deadline.responsible_id)?.name : null;
          const titleStr = clientName ? `${deadline.title} (${clientName})` : deadline.title;
          text(titleStr, margin + 10, cardY + 12, 10, true, darkText, usableWidth - 20);

          const metaLine = [
            `Vencimento: ${formatDate(deadline.due_date)}`,
            `Status: ${getStatusLabel(deadline.status)}`,
            `Prioridade: ${getPriorityLabel(deadline.priority)}`,
            `Tipo: ${getTypeLabel(deadline.type)}`,
            `Responsável: ${responsibleName ?? 'Não atribuído'}`,
          ].join('   |   ');

          text(metaLine, margin + 10, cardY - 2, 9, false, grayText, usableWidth - 20);

          y -= totalHeight + 6;
        });
      }

      const pages = pdfDoc.getPages();
      pages.forEach((pg, index) => {
        const { width: pageWidth } = pg.getSize();
        const footerMargin = 40;
        pg.drawLine({
          start: { x: footerMargin, y: 40 },
          end: { x: pageWidth - footerMargin, y: 40 },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        });

        pg.drawText('Sistema de Gestão de Prazos', {
          x: footerMargin,
          y: 27,
          size: 8,
          font,
          color: grayText,
        });

        pg.drawText(`Página ${index + 1} de ${pages.length}`, {
          x: pageWidth - footerMargin - 60,
          y: 27,
          size: 8,
          font,
          color: grayText,
        });

        pg.drawText(`Exportado por: ${exportedBy}`, {
          x: footerMargin,
          y: 17,
          size: 7.5,
          font,
          color: grayText,
        });

        pg.drawText(`Email: ${exportedEmail}`, {
          x: footerMargin,
          y: 9,
          size: 7.5,
          font,
          color: grayText,
        });

        pg.drawText(`Data/Hora: ${exportTimestamp.toLocaleString('pt-BR')}`, {
          x: footerMargin + 220,
          y: 17,
          size: 7.5,
          font,
          color: grayText,
        });

        pg.drawText(`Log: ${exportLogId}`, {
          x: footerMargin + 220,
          y: 9,
          size: 7.5,
          font,
          color: grayText,
        });
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const dateSlug = new Date().toISOString().split('T')[0];
      saveAs(blob, `relatorio_prazos_${dateSlug}.pdf`);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Não foi possível exportar o relatório em PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  const filteredProcesses = useMemo(() => {
    const scopedProcesses = formData.client_id
      ? processes.filter((p) => p.client_id === formData.client_id)
      : processes;

    if (!processSearchTerm.trim()) return scopedProcesses.slice(0, 10);
    const term = processSearchTerm.trim().toLowerCase();
    return scopedProcesses
      .filter((p) => {
        const processCode = (p.process_code ?? '').toLowerCase();
        const court = (p.court ?? '').toLowerCase();
        return processCode.includes(term) || court.includes(term);
      })
      .slice(0, 10);
  }, [processes, processSearchTerm, formData.client_id]);

  const filteredRequirements = useMemo(() => {
    const scopedRequirements = formData.client_id
      ? requirements.filter((r) => r.client_id === formData.client_id)
      : requirements;

    if (!requirementSearchTerm.trim()) return scopedRequirements.slice(0, 10);
    const term = requirementSearchTerm.trim().toLowerCase();
    return scopedRequirements
      .filter((r) => {
        const protocol = (r.protocol ?? '').toLowerCase();
        const beneficiary = (r.beneficiary ?? '').toLowerCase();
        return protocol.includes(term) || beneficiary.includes(term);
      })
      .slice(0, 10);
  }, [requirements, requirementSearchTerm, formData.client_id]);

  const filteredClients = useMemo(() => {
    if (!clientSearchTerm.trim()) return clients.slice(0, 10);
    const term = clientSearchTerm.trim().toLowerCase();
    return clients
      .filter((client) => {
        const name = (client.full_name || '').toLowerCase();
        const cpf = (client.cpf_cnpj || '').replace(/\D/g, '');
        return name.includes(term) || cpf.includes(term);
      })
      .slice(0, 10);
  }, [clients, clientSearchTerm]);

  // Modal de Relatórios
  const reportModal = (
    <Modal
      open={showReportModal}
      onClose={() => setShowReportModal(false)}
      title="Relatório de Prazos"
      eyebrow="Relatório"
      size="xl"
      zIndex={LAYER.MODAL}
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => setShowReportModal(false)} className="px-4 py-2 text-sm text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition">Fechar</button>
          <button type="button" onClick={handleExportPdf} disabled={exportingPdf} className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
            {exportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Exportar PDF
          </button>
          <button type="button" onClick={handleExportReport} className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition">
            <Download className="w-4 h-4" /> Exportar Excel
          </button>
        </div>
      }
    >
      <ModalBody className="px-5 py-4">
          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          {/* Seletor de Período */}
          <div className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4">
            <label className="text-sm font-semibold text-slate-700 mb-3 block">Período do Relatório</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                { key: 'week', label: 'Última Semana' },
                { key: 'month', label: 'Este Mês' },
                { key: 'quarter', label: 'Este Trimestre' },
                { key: 'year', label: 'Este Ano' },
                { key: 'custom', label: 'Personalizado' },
              ].map((period) => (
                <button
                  key={period.key}
                  type="button"
                  onClick={() => setReportPeriod(period.key as typeof reportPeriod)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    reportPeriod === period.key
                      ? 'bg-indigo-600 text-white'
                      : 'bg-[#f8f7f5] text-slate-600 border border-[#e7e5df] hover:border-indigo-300'
                  }`}
                >
                  {period.label}
                </button>
              ))}
            </div>
            
            {reportPeriod === 'custom' && (
              <div className="flex gap-3 mt-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-500">Data Inicial</label>
                  <input
                    type="date"
                    value={reportStartDate}
                    onChange={(e) => setReportStartDate(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-[#e7e5df] rounded-lg text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-500">Data Final</label>
                  <input
                    type="date"
                    value={reportEndDate}
                    onChange={(e) => setReportEndDate(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-[#e7e5df] rounded-lg text-sm"
                  />
                </div>
              </div>
            )}
            
            <p className="text-xs text-slate-500 mt-2">
              Período: {reportStats.periodStart.toLocaleDateString('pt-BR')} a {reportStats.periodEnd.toLocaleDateString('pt-BR')}
            </p>
          </div>

          {/* Cards de Resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
              <p className="text-3xl font-bold">{reportStats.total}</p>
              <p className="text-xs text-blue-100">Total de Prazos</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl p-4 text-white">
              <p className="text-3xl font-bold">{reportStats.completionRate}%</p>
              <p className="text-xs text-emerald-100">Taxa de Cumprimento</p>
            </div>
            <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl p-4 text-white">
              <p className="text-3xl font-bold">{reportStats.avgDaysToComplete}</p>
              <p className="text-xs text-amber-100">Média Dias p/ Cumprir</p>
            </div>
            <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-4 text-white">
              <p className="text-3xl font-bold">{reportStats.byStatus['vencido'] ?? 0}</p>
              <p className="text-xs text-red-100">Vencidos no Período</p>
            </div>
          </div>

          {/* Gráficos em Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Por Status */}
            <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-4">
              <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-slate-400" />
                Por Status
              </h4>
              <div className="space-y-2">
                {statusOptions.map((s) => {
                  const value = reportStats.byStatus[s.key] ?? 0;
                  const color = s.badge.split(' ')[0];
                  return (
                    <div key={s.key} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded ${color}`} />
                      <span className="text-xs text-slate-600 flex-1">{s.label}</span>
                      <span className="text-sm font-semibold text-slate-800">{value}</span>
                      <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full ${color}`} style={{ width: `${reportStats.total > 0 ? (value / reportStats.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Por Prioridade */}
            <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-4">
              <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-slate-400" />
                Por Prioridade
              </h4>
              <div className="space-y-2">
                {priorityOptions.map((p) => {
                  const value = reportStats.byPriority[p.key] ?? 0;
                  const color = p.badge.split(' ')[0];
                  return (
                    <div key={p.key} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded ${color}`} />
                      <span className="text-xs text-slate-600 flex-1">{p.label}</span>
                      <span className="text-sm font-semibold text-slate-800">{value}</span>
                      <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full ${color}`} style={{ width: `${reportStats.total > 0 ? (value / reportStats.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Por Tipo */}
            <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-4">
              <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Layers className="w-4 h-4 text-slate-400" />
                Por Tipo
              </h4>
              <div className="space-y-2">
                {typeOptions.map((t, idx) => {
                  const TYPE_COLORS = ['bg-slate-500', 'bg-indigo-500', 'bg-purple-500', 'bg-teal-500', 'bg-cyan-500', 'bg-rose-500'];
                  const value = reportStats.byType[t.key] ?? 0;
                  const color = TYPE_COLORS[idx % TYPE_COLORS.length];
                  return (
                    <div key={t.key} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded ${color}`} />
                      <span className="text-xs text-slate-600 flex-1">{t.label}</span>
                      <span className="text-sm font-semibold text-slate-800">{value}</span>
                      <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full ${color}`} style={{ width: `${reportStats.total > 0 ? (value / reportStats.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Por Responsável */}
            <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-4">
              <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" />
                Por Responsável (Top 5)
              </h4>
              <div className="space-y-2">
                {Object.entries(reportStats.byResponsible)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([name, value]) => (
                    <div key={name} className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-indigo-600">
                          {name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <span className="text-xs text-slate-600 flex-1 truncate">{name}</span>
                      <span className="text-sm font-semibold text-slate-800">{value}</span>
                    </div>
                  ))}
                {Object.keys(reportStats.byResponsible).length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-2">Nenhum dado disponível</p>
                )}
              </div>
            </div>
          </div>

          {/* Top Clientes */}
          <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-4">
            <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-slate-400" />
              Clientes com Mais Prazos (Top 10)
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {Object.entries(reportStats.byClient)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([name, value]) => (
                  <div key={name} className="bg-slate-50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-slate-800">{value}</p>
                    <p className="text-[10px] text-slate-500 truncate" title={name}>{name}</p>
                  </div>
                ))}
              {Object.keys(reportStats.byClient).length === 0 && (
                <p className="text-xs text-slate-400 col-span-5 text-center py-4">Nenhum dado disponível</p>
              )}
            </div>
          </div>

      </ModalBody>
    </Modal>
  );

  const getMemberInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return (parts[0][0] || '?').toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };
  const getMemberHue = (name: string) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) { h = (h << 5) - h + name.charCodeAt(i); h |= 0; }
    return Math.abs(h) % 360;
  };

  const renderCommentText = (text: string): React.ReactNode => {
    const names = members
      .map((mem) => (mem.name || '').trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (names.length === 0) return text;
    const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`@(${escaped.join('|')})`, 'gi');
    const parts: React.ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      const matchedName = match[1];
      const mentionedMember = members.find(
        (mem) => (mem.name || '').trim().toLowerCase() === matchedName.toLowerCase(),
      );
      parts.push(
        <button
          key={key++}
          type="button"
          disabled={!mentionedMember?.user_id}
          onClick={() => {
            if (!mentionedMember?.user_id) return;
            handleCloseViewDeadlineModal();
            navigateTo('perfil', { userId: mentionedMember.user_id } as any);
          }}
          className={`font-semibold text-orange-600 bg-orange-50 rounded px-1 py-0.5 ${
            mentionedMember?.user_id ? 'hover:bg-orange-100 hover:underline cursor-pointer' : 'cursor-default'
          }`}
        >
          @{matchedName}
        </button>,
      );
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.length > 0 ? parts : text;
  };

  const renderComment = (c: DeadlineComment, isReply: boolean) => {
    const hue = getMemberHue(c.user_name || '?');
    const canDelete = isAdmin || (!!c.user_id && c.user_id === user?.id);
    return (
      <div key={c.id} className="flex gap-2.5 group">
        <div
          className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
          style={{
            width: isReply ? 24 : 28,
            height: isReply ? 24 : 28,
            fontSize: isReply ? 10 : 11,
            background: `hsl(${hue}, 50%, 90%)`,
            color: `hsl(${hue}, 45%, 30%)`,
          }}
        >
          {(c.user_name[0] || '?').toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="bg-slate-50 rounded-xl px-3 py-2">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-semibold text-slate-700">{c.user_name}</span>
              <span className="text-[10px] text-slate-400">{formatDateTime(c.created_at)}</span>
            </div>
            <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{renderCommentText(c.content)}</p>
          </div>
          <div className="flex items-center gap-3 mt-1 ml-1">
            {!isReply && (
              <button
                type="button"
                onClick={() => setReplyingTo({ id: c.id, name: c.user_name })}
                className="text-[11px] font-semibold text-slate-400 hover:text-orange-600 transition"
              >
                Responder
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => void handleDeleteComment(c.id)}
                disabled={deletingCommentId === c.id}
                className="text-[11px] font-semibold text-slate-400 hover:text-red-600 transition opacity-0 group-hover:opacity-100 disabled:opacity-40"
              >
                {deletingCommentId === c.id ? 'Excluindo...' : 'Excluir'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const cancelDeadlineModal = (
    <Modal
      open={!!cancelTarget}
      onClose={() => { if (!cancelSaving) closeCancelModal(); }}
      title="Cancelar prazo"
      eyebrow={cancelTarget?.label}
      icon={<XCircle className="w-5 h-5" />}
      size="md"
      zIndex={layerStack(0)}
      accentBarClassName="bg-red-500"
      iconContainerClassName="bg-red-500 text-white"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <button
            type="button"
            onClick={closeCancelModal}
            disabled={cancelSaving}
            className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={() => void handleConfirmCancel()}
            disabled={cancelSaving || !cancelReason.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {cancelSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            {cancelSaving && cancelFiles.length > 0 ? 'Enviando anexos...' : 'Confirmar cancelamento'}
          </button>
        </div>
      }
    >
      <ModalBody
        className="px-5 py-4 space-y-4"
        onDragOver={(e: React.DragEvent) => { e.preventDefault(); setCancelDragOver(true); }}
        onDragLeave={() => setCancelDragOver(false)}
        onDrop={handleCancelDrop}
      >
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900/50 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-[13px] text-red-700 dark:text-red-300 leading-relaxed">
            O prazo sai da fila de tarefas e passa para o histórico. O motivo fica registrado e aparece
            sempre que alguém abrir este prazo.
          </p>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
            Motivo do cancelamento <span className="text-red-500">*</span>
          </label>
          <textarea
            value={cancelReason}
            onChange={(e) => { setCancelReason(e.target.value); if (cancelError) setCancelError(null); }}
            rows={4}
            autoFocus
            placeholder="Ex.: prazo duplicado da intimação do dia 12/05, já cumprido no prazo original."
            className="w-full px-3 py-2 text-[13px] border border-[#e7e5df] dark:border-zinc-700 rounded-lg bg-[#f8f7f5] dark:bg-zinc-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 resize-none"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {CANCEL_REASON_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => { setCancelReason(suggestion); setCancelError(null); }}
                className="px-2.5 py-1 text-[11px] font-medium rounded-full border border-[#e7e5df] dark:border-zinc-700 text-slate-500 dark:text-slate-400 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition"
              >
                {suggestion}
              </button>
            ))}
          </div>
          {cancelError && <p className="mt-2 text-xs font-medium text-red-600">{cancelError}</p>}
        </div>

        {/* Prints e arquivos */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Prints e arquivos {cancelFiles.length > 0 && <span className="text-slate-400">({cancelFiles.length})</span>}
            </label>
            <button
              type="button"
              onClick={() => cancelFileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg border border-[#e7e5df] dark:border-zinc-700 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition"
            >
              <Paperclip className="w-3 h-3" /> Anexar
            </button>
            <input
              ref={cancelFileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => { addCancelFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
            />
          </div>

          <div
            onClick={() => { if (!cancelFiles.length) cancelFileInputRef.current?.click(); }}
            className={`rounded-lg border border-dashed px-3 py-3 transition ${
              cancelDragOver
                ? 'border-red-400 bg-red-50/70'
                : 'border-[#e7e5df] dark:border-zinc-700 bg-[#f8f7f5] dark:bg-zinc-800/50'
            } ${cancelFiles.length ? '' : 'cursor-pointer'}`}
          >
            {cancelFiles.length === 0 ? (
              <p className="text-[12px] text-slate-400 flex items-center gap-2">
                <ImageIcon className="w-3.5 h-3.5" />
                Cole um print com <b className="text-slate-500">Ctrl+V</b> (⌘+V no Mac), arraste o arquivo aqui ou clique para escolher.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {cancelFiles.map((item) => (
                  <div key={item.id} className="relative group">
                    {item.preview ? (
                      <img
                        src={item.preview}
                        alt={item.file.name}
                        className="w-20 h-20 object-cover rounded-lg border border-[#e7e5df] dark:border-zinc-700"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-lg border border-[#e7e5df] dark:border-zinc-700 bg-white dark:bg-zinc-800 flex flex-col items-center justify-center gap-1 px-1">
                        <FileText className="w-5 h-5 text-slate-400" />
                        <span className="text-[9px] text-slate-500 text-center leading-tight line-clamp-2 break-all">{item.file.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeCancelFile(item.id)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center shadow hover:bg-red-700 transition"
                      title="Remover"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ModalBody>
    </Modal>
  );

  const viewDeadlineModal = (() => {
    const d = selectedDeadlineForView;
    if (!d) return null;
      const daysLeft = getDaysUntilDue(d.due_date);
      const isCumprido = d.status === 'cumprido';
      const isCancelado = d.status === 'cancelado';
      // Prazo cancelado não corre mais: nada de "X dias atrasado" nem contagem regressiva.
      const isOverdue = !isCumprido && !isCancelado && daysLeft < 0;
      const isUrgent = !isCumprido && !isCancelado && daysLeft >= 0 && daysLeft <= 3;
      const accentColor =
        d.priority === 'urgente' ? 'bg-red-500' :
        d.priority === 'alta' ? 'bg-orange-500' :
        d.priority === 'media' ? 'bg-amber-400' : 'bg-blue-500';

      // Para prazos cumpridos, calcula se foi dentro ou fora do prazo com base no completed_at
      const completedOnTime = (() => {
        if (!isCumprido) return false;
        const due = parseDateOnly(d.due_date);
        if (!due) return daysLeft >= 0;
        const completed = d.completed_at ? parseDateOnly(d.completed_at) : null;
        if (!completed) return daysLeft >= 0;
        return completed.getTime() <= due.getTime();
      })();

      const countdownBg = isCumprido
        ? completedOnTime ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
        : isOverdue ? 'bg-red-50 border-red-200'
        : isUrgent ? 'bg-orange-50 border-orange-200'
        : 'bg-slate-50 border-[#e7e5df]';
      const countdownColor = isCumprido
        ? completedOnTime ? 'text-emerald-600' : 'text-amber-600'
        : isOverdue ? 'text-red-600'
        : isUrgent ? 'text-orange-600'
        : 'text-slate-800';
      const countdownLabel = isOverdue ? 'dias atrasado' : daysLeft === 0 ? 'vence hoje' : 'dias restantes';

      // Quem deu a baixa: evento de fechamento mais recente do log de auditoria
      // (a linha do tempo já vem do mais novo para o mais antigo).
      const closingEvent = viewTimeline.find((event) => CLOSING_ACTIONS.includes(event.action)) || null;

      return (
        <Modal
          open={showViewDeadlineModal && !!selectedDeadlineForView}
          onClose={handleCloseViewDeadlineModal}
          title={d.title}
          eyebrow={getTypeLabel(d.type)}
          icon={<Clock className="w-5 h-5" />}
          size="lg"
          zIndex={LAYER.MODAL}
          headerActions={
            <div className="flex items-center gap-2">
              {d.status === 'pendente' && (
                <>
                  <button onClick={() => { void handleStatusChange(d.id, 'cumprido'); handleCloseViewDeadlineModal(); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Marcar cumprido
                  </button>
                  <button onClick={() => requestCancelDeadline([d.id], d.title)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition">
                    <XCircle className="w-3.5 h-3.5" /> Cancelar prazo
                  </button>
                </>
              )}
              <button onClick={() => { handleCloseViewDeadlineModal(); handleOpenModal(d); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition">
                <Edit2 className="w-3.5 h-3.5" /> Editar
              </button>
            </div>
          }
          footer={
            <div className="flex items-center justify-between gap-3 w-full">
              <div className="flex items-center gap-2 flex-wrap">
                {isAdmin && (
                  <button onClick={() => void handleCloneDeadline(d)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#f8f7f5] border border-[#e7e5df] text-slate-600 hover:bg-slate-50 transition">
                    <Copy className="w-3.5 h-3.5" /> Duplicar
                  </button>
                )}
                {/* Prazo já excluído não se exclui de novo: o que ele oferece é
                    a volta para a fila. */}
                {d.status === 'excluido' ? (
                  <button onClick={() => { void handleRestoreDeadline(d.id); handleCloseViewDeadlineModal(); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#f8f7f5] border border-amber-200 text-amber-700 hover:bg-amber-50 transition">
                    <RotateCcw className="w-3.5 h-3.5" /> Restaurar prazo
                  </button>
                ) : (
                  <button onClick={() => { handleDeleteDeadline(d.id); handleCloseViewDeadlineModal(); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#f8f7f5] border border-red-200 text-red-600 hover:bg-red-50 transition">
                    <Trash2 className="w-3.5 h-3.5" /> Excluir
                  </button>
                )}
              </div>
              <button onClick={handleCloseViewDeadlineModal} className="px-4 py-1.5 text-sm text-slate-500 hover:text-slate-700 transition">Fechar</button>
            </div>
          }
        >
          <ModalBody className="px-5 py-4 space-y-4" style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>

            {/* Grade de informações — 2 colunas, estilo Perfex */}
            <div className="rounded-lg border border-[#e7e5df] dark:border-zinc-700 overflow-hidden text-[13px]">
              <div className="grid grid-cols-2 divide-x divide-[#e7e5df] dark:divide-zinc-700">

                {/* col esquerda */}
                <div className="divide-y divide-[#e7e5df] dark:divide-zinc-700">
                  <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">Vencimento</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{formatDate(d.due_date)}</span>
                  </div>
                  <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">Status</span>
                    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full ${getStatusBadge(d.status)}`}>
                      {getStatusLabel(d.status)}
                    </span>
                  </div>
                  <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">Cliente</span>
                    {d.client_id ? (
                      <button
                        type="button"
                        onClick={() => { handleCloseViewDeadlineModal(); navigateTo('clientes', { mode: 'details', entityId: d.client_id } as any); }}
                        className="text-amber-600 dark:text-amber-400 hover:underline font-medium truncate max-w-[160px] text-right"
                      >
                        {clientMap.get(d.client_id)?.full_name || '—'}
                      </button>
                    ) : <span className="text-slate-400">—</span>}
                  </div>
                  {(d.process_id || d.requirement_id) && (
                    <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400 shrink-0">{d.process_id ? 'Processo' : 'Req.'}</span>
                      <button
                        type="button"
                        onClick={() => { handleCloseViewDeadlineModal(); if (d.process_id) navigateTo('processos', { entityId: d.process_id } as any); else navigateTo('requerimentos', { entityId: d.requirement_id } as any); }}
                        className="font-mono font-semibold text-amber-600 dark:text-amber-400 hover:underline truncate max-w-[160px] text-right"
                      >
                        {d.process_id
                          ? processes.find(p => p.id === d.process_id)?.process_code || '—'
                          : requirements.find(r => r.id === d.requirement_id)?.protocol || '—'}
                      </button>
                    </div>
                  )}
                </div>

                {/* col direita */}
                <div className="divide-y divide-[#e7e5df] dark:divide-zinc-700">
                  <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">Prazo</span>
                    {isCancelado ? (
                      <span className="font-semibold text-red-600">Cancelado</span>
                    ) : isCumprido ? (
                      <span className={`font-semibold ${completedOnTime ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {completedOnTime ? '✓ No prazo' : '✓ Fora do prazo'}
                      </span>
                    ) : (
                      <span className={`font-bold ${isOverdue ? 'text-red-600' : isUrgent ? 'text-orange-500' : 'text-slate-700 dark:text-slate-200'}`}>
                        {Math.abs(daysLeft)} {countdownLabel}
                      </span>
                    )}
                  </div>
                  <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">Prioridade</span>
                    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full ${getPriorityBadge(d.priority)}`}>
                      {getPriorityLabel(d.priority)}
                    </span>
                  </div>
                  <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">Responsável</span>
                    <span className="font-medium text-slate-700 dark:text-slate-200 truncate max-w-[160px] text-right">
                      {d.responsible_id ? memberMap.get(d.responsible_id)?.name || '—' : '—'}
                    </span>
                  </div>
                  {d.created_at && (
                    <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400 shrink-0">Criado em</span>
                      <span className="text-slate-500 dark:text-slate-400 text-[12px]">
                        {new Date(d.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* Motivo do cancelamento */}
            {isCancelado && (
              <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900/50 px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <XCircle className="w-3.5 h-3.5 text-red-500" />
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">Motivo do cancelamento</p>
                </div>
                <p className="text-[13px] text-red-800 dark:text-red-200 leading-relaxed whitespace-pre-wrap">
                  {viewCancellation?.reason || 'Motivo não registrado.'}
                </p>
                {viewCancellation?.attachments?.length ? (
                  <CancellationAttachments attachments={viewCancellation.attachments} />
                ) : null}
                {viewCancellation && (
                  <p className="text-[11px] text-red-500/80 dark:text-red-400/70 mt-1.5">
                    {formatDateTime(viewCancellation.created_at)}
                    {viewCancellation.cancelled_by
                      ? ` · ${members.find((m) => m.user_id === viewCancellation.cancelled_by)?.name || 'Usuário'}`
                      : ''}
                  </p>
                )}
              </div>
            )}

            {/* Registro da baixa — quem cumpriu, em que dia e a que horas.
                Vem do log de auditoria; o completed_at do prazo é o reserva para
                as baixas anteriores ao gatilho de auditoria. */}
            {isCumprido && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900/50 px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Registro da baixa</p>
                </div>
                {closingEvent ? (
                  <p className="text-[13px] text-emerald-800 dark:text-emerald-200">
                    Cumprido por <span className="font-semibold">{closingEvent.user_name || 'Usuário'}</span>
                    {' em '}
                    <span className="font-semibold tabular-nums">{formatDateTime(toIsoInstant(closingEvent.created_at))}</span>
                  </p>
                ) : viewTimelineLoading ? (
                  <p className="text-[13px] text-emerald-700/70 flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" /> Buscando quem deu a baixa…
                  </p>
                ) : (
                  <p className="text-[13px] text-emerald-800 dark:text-emerald-200">
                    Cumprido em <span className="font-semibold tabular-nums">{formatDateTime(d.completed_at)}</span>
                    <span className="block text-[11px] text-emerald-600/80 mt-0.5">Autor não registrado — baixa anterior ao log de auditoria.</span>
                  </p>
                )}
              </div>
            )}

            {/* Descrição */}
            {d.description && (
              <div className="border-t border-[#e7e5df] dark:border-zinc-700 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Descrição</p>
                <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">{d.description}</p>
              </div>
            )}

            {/* Linha do tempo do prazo */}
            <div className="border-t border-[#e7e5df] dark:border-zinc-700 pt-3">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-slate-400" />
                <h4 className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Histórico de alterações</h4>
                {viewTimeline.length > 0 && (
                  <span className="text-[11px] bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full font-medium">{viewTimeline.length}</span>
                )}
              </div>
              <DeadlineTimeline events={viewTimeline} loading={viewTimelineLoading} />
            </div>

            {/* Comentários */}
            <div className="border-t border-[#e7e5df] dark:border-zinc-700 pt-3">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="w-4 h-4 text-slate-400" />
                <h4 className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Comentários</h4>
                {comments.length > 0 && (
                  <span className="text-[11px] bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full font-medium">{comments.length}</span>
                )}
              </div>
              {commentsLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-400 mb-3"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
              ) : comments.length === 0 ? (
                <p className="text-[13px] text-slate-400 italic mb-3">Nenhum comentário ainda.</p>
              ) : (
                <div className="space-y-2 max-h-44 overflow-y-auto mb-3 pr-1">
                  {comments.filter((c) => !c.parent_id).map((c) => {
                    const replies = comments.filter((r) => r.parent_id === c.id);
                    return (
                      <div key={c.id} className="space-y-2">
                        {renderComment(c, false)}
                        {replies.length > 0 && (
                          <div className="ml-6 pl-3 border-l-2 border-slate-100 dark:border-zinc-700 space-y-2">
                            {replies.map((r) => renderComment(r, true))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {replyingTo && (
                <div className="flex items-center justify-between gap-2 mb-2 px-3 py-1.5 bg-orange-50 border border-orange-100 rounded-lg">
                  <span className="text-xs text-orange-700">
                    Respondendo a <b>{replyingTo.name}</b>
                  </span>
                  <button type="button" onClick={() => setReplyingTo(null)} className="text-orange-500 hover:text-orange-700">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="flex gap-2 relative">
                {mentionSuggestions.length > 0 && (
                  <div className="absolute bottom-12 left-0 right-12 bg-white dark:bg-zinc-800 border border-[#e7e5df] dark:border-zinc-700 rounded-xl shadow-lg overflow-hidden z-10 max-h-52 overflow-y-auto">
                    <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Mencionar</p>
                    {mentionSuggestions.map((mem) => {
                      const hue = getMemberHue(mem.name || '');
                      return (
                        <button
                          key={mem.id}
                          type="button"
                          onClick={() => pickMention(mem.name || '')}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-orange-50 dark:hover:bg-zinc-700 transition"
                        >
                          <div
                            className="relative w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 overflow-hidden"
                            style={{ background: `hsl(${hue}, 50%, 90%)`, color: `hsl(${hue}, 45%, 30%)` }}
                          >
                            {getMemberInitials(mem.name || '')}
                            {(mem as any).avatar_url && (
                              <img src={(mem as any).avatar_url} alt="" className="absolute w-7 h-7 rounded-full object-cover" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{mem.name}</p>
                            {mem.role && <p className="text-[10px] text-slate-400 truncate">{mem.role}</p>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => handleCommentChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && mentionSuggestions.length === 0) { e.preventDefault(); void handleAddComment(d.id); } if (e.key === 'Escape') { setMentionQuery(null); setReplyingTo(null); } }}
                  placeholder={replyingTo ? `Responder a ${replyingTo.name}...` : 'Escreva um comentário... use @ para mencionar'}
                  className="flex-1 h-[34px] px-3 text-[13px] border border-[#e7e5df] dark:border-zinc-600 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 dark:bg-zinc-800 dark:text-slate-200"
                />
                <button
                  onClick={() => void handleAddComment(d.id)}
                  disabled={savingComment || !commentText.trim()}
                  className="inline-flex items-center justify-center w-[34px] h-[34px] rounded-lg bg-orange-500 hover:bg-orange-600 text-white transition disabled:opacity-40"
                >
                  {savingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>

          </ModalBody>
        </Modal>
      );
  })();

  const inputStyle = 'w-full h-10 px-3 py-2 rounded-lg text-sm bg-white border border-[#e7e5df] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-colors';
  const labelStyle = 'block text-xs font-semibold text-slate-500 mb-1.5';

  const deadlineModal = (
    <DeadlineFormModal
      open={isModalOpen}
      onClose={handleCloseModal}
      onSaved={async () => {
        await handleReload();
        setIsModalOpen(false);
        setSelectedDeadline(null);
      }}
      selectedDeadline={selectedDeadline}
      members={members}
      processes={processes}
      clients={clients}
      requirements={requirements}
      statusOptions={statusOptionsProp}
      priorityOptions={priorityOptionsProp}
      typeOptions={typeOptionsProp}
    />
  );

  if (viewMode === 'details' && selectedDeadlineForView) {
    const statusConfig = getStatusConfig(selectedDeadlineForView.status);
    const priorityConfig = getPriorityConfig(selectedDeadlineForView.priority);
    const typeConfig = getTypeConfig(selectedDeadlineForView.type);
    const daysUntil = getDaysUntilDue(selectedDeadlineForView.due_date);
    const linkedProcess = selectedDeadlineForView.process_id
      ? processes.find((p) => p.id === selectedDeadlineForView.process_id)
      : null;
    const linkedRequirement = selectedDeadlineForView.requirement_id
      ? requirements.find((r) => r.id === selectedDeadlineForView.requirement_id)
      : null;
    const linkedClient = selectedDeadlineForView.client_id
      ? clientMap.get(selectedDeadlineForView.client_id)
      : null;
    const responsibleProfile = selectedDeadlineForView.responsible_id
      ? memberMap.get(selectedDeadlineForView.responsible_id)
      : null;

    return (
      <div className="space-y-6">
        <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">Detalhes do Prazo</h3>
              <p className="text-sm text-slate-600 mt-1">Informações completas sobre o prazo.</p>
            </div>
            <button
              onClick={handleBackToList}
              className="text-slate-600 hover:text-slate-900 font-medium text-sm flex items-center gap-2"
            >
              ← Voltar para lista
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Título</label>
              <p className="text-base text-slate-900 mt-1 font-semibold">{selectedDeadlineForView.title}</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Data de Vencimento</label>
              <p className="text-base text-slate-900 mt-1">{formatDate(selectedDeadlineForView.due_date)}</p>
              {selectedDeadlineForView.status === 'cancelado' ? (
                <p className="text-xs text-red-600 mt-1 font-semibold">Prazo cancelado</p>
              ) : selectedDeadlineForView.status === 'cumprido' ? (
                (() => {
                  const onTime = (() => {
                    const due = parseDateOnly(selectedDeadlineForView.due_date);
                    const completed = selectedDeadlineForView.completed_at ? parseDateOnly(selectedDeadlineForView.completed_at) : null;
                    if (!due) return daysUntil >= 0;
                    return completed ? completed.getTime() <= due.getTime() : daysUntil >= 0;
                  })();
                  return onTime
                    ? <p className="text-xs text-emerald-600 mt-1 font-semibold">✓ Cumprido dentro do prazo</p>
                    : <p className="text-xs text-amber-600 mt-1 font-semibold">✓ Cumprido fora do prazo</p>;
                })()
              ) : daysUntil >= 0 ? (
                <p className="text-xs text-slate-500 mt-1">Faltam {daysUntil} dia(s)</p>
              ) : (
                <p className="text-xs text-red-600 mt-1 font-semibold">Vencido há {Math.abs(daysUntil)} dia(s)</p>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Status</label>
              <p className="mt-1">
                <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(selectedDeadlineForView.status)}`}>
                  {statusConfig && <statusConfig.icon className="w-3 h-3" />}
                  {getStatusLabel(selectedDeadlineForView.status)}
                </span>
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Prioridade</label>
              <p className="mt-1">
                <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${getPriorityBadge(selectedDeadlineForView.priority)}`}>
                  {priorityConfig && <priorityConfig.icon className="w-3 h-3" />}
                  {getPriorityLabel(selectedDeadlineForView.priority)}
                </span>
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Tipo</label>
              <p className="mt-1">
                <span className="inline-flex items-center gap-2 text-sm text-slate-900">
                  {typeConfig && <typeConfig.icon className="w-4 h-4" />}
                  {getTypeLabel(selectedDeadlineForView.type)}
                </span>
              </p>
            </div>

            {linkedProcess && (
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Processo Vinculado</label>
                <p className="text-base text-slate-900 mt-1 font-mono">{linkedProcess.process_code}</p>
              </div>
            )}

            {linkedRequirement && (
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Requerimento Vinculado</label>
                <p className="text-base text-slate-900 mt-1">
                  {linkedRequirement.protocol} - {linkedRequirement.beneficiary}
                </p>
              </div>
            )}

            {linkedClient && (
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Cliente</label>
                <p className="text-base text-slate-900 mt-1">{linkedClient.full_name}</p>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Responsável</label>
              <p className="text-base text-slate-900 mt-1 flex items-center gap-2">
                <UserCircle className="w-4 h-4 text-slate-500" />
                {responsibleProfile ? responsibleProfile.name : 'Não definido'}
              </p>
            </div>

            {selectedDeadlineForView.status === 'cancelado' && (
              <div className="md:col-span-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                <label className="text-xs font-semibold text-red-600 uppercase flex items-center gap-1.5">
                  <XCircle className="w-3.5 h-3.5" /> Motivo do cancelamento
                </label>
                <p className="text-base text-red-800 mt-1 whitespace-pre-wrap">
                  {viewCancellation?.reason || 'Motivo não registrado.'}
                </p>
                {viewCancellation?.attachments?.length ? (
                  <CancellationAttachments attachments={viewCancellation.attachments} />
                ) : null}
                {viewCancellation && (
                  <p className="text-xs text-red-500/80 mt-1">
                    {formatDateTime(viewCancellation.created_at)}
                    {viewCancellation.cancelled_by
                      ? ` · ${members.find((m) => m.user_id === viewCancellation.cancelled_by)?.name || 'Usuário'}`
                      : ''}
                  </p>
                )}
              </div>
            )}

            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Descrição</label>
              <p className="text-base text-slate-900 mt-1 whitespace-pre-wrap">
                {selectedDeadlineForView.description || 'Nenhuma descrição'}
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Notificar (dias antes)</label>
              <p className="text-base text-slate-900 mt-1">{selectedDeadlineForView.notify_days_before ?? 2} dias</p>
            </div>

            {selectedDeadlineForView.completed_at && (
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Cumprido em</label>
                <p className="text-base text-slate-900 mt-1">{formatDateTime(selectedDeadlineForView.completed_at)}</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3 mt-8 pt-6 border-t border-[#e7e5df]">
            <button
              onClick={() => handleOpenModal(selectedDeadlineForView)}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2.5 rounded-lg transition"
            >
              <Edit2 className="w-4 h-4" />
              Editar Prazo
            </button>
            {selectedDeadlineForView.status === 'pendente' && (
              <button
                onClick={() => handleStatusChange(selectedDeadlineForView.id, 'cumprido')}
                className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2.5 rounded-lg transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                Marcar como Cumprido
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => void handleCloneDeadline(selectedDeadlineForView)}
                className="inline-flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium px-4 py-2.5 rounded-lg transition"
              >
                <Copy className="w-4 h-4" />
                Duplicar Prazo
              </button>
            )}
            <button
              onClick={() => {
                handleDeleteDeadline(selectedDeadlineForView.id);
                handleBackToList();
              }}
              className="inline-flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 font-medium px-4 py-2.5 rounded-lg transition"
            >
              <Trash2 className="w-4 h-4" />
              Excluir Prazo
            </button>
          </div>

          {/* ── Comentários ─────────────────────────────────────────────── */}
          <div className="mt-8 pt-6 border-t border-[#e7e5df]">
            <button
              onClick={() => {
                if (showCommentsFor === selectedDeadlineForView.id) {
                  setShowCommentsFor(null);
                } else {
                  setShowCommentsFor(selectedDeadlineForView.id);
                  void loadComments(selectedDeadlineForView.id);
                }
              }}
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-blue-600 transition"
            >
              <MessageSquare className="w-4 h-4" />
              Comentários
              {showCommentsFor === selectedDeadlineForView.id ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              )}
            </button>

            {showCommentsFor === selectedDeadlineForView.id && (
              <div className="mt-4 space-y-3">
                {commentsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
                ) : comments.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">Nenhum comentário ainda. Seja o primeiro!</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {comments.map((c) => (
                      <div key={c.id} className="bg-slate-50 rounded-xl px-4 py-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-slate-700">{c.user_name}</span>
                          <span className="text-[10px] text-slate-400">{formatDateTime(c.created_at)}</span>
                        </div>
                        <p className="text-sm text-slate-800 whitespace-pre-wrap">{renderCommentText(c.content)}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleAddComment(selectedDeadlineForView.id); } }}
                    placeholder="Escreva um comentário..."
                    className="flex-1 px-3 py-2 text-sm border border-[#e7e5df] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  <button
                    onClick={() => void handleAddComment(selectedDeadlineForView.id)}
                    disabled={savingComment || !commentText.trim()}
                    className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-40"
                  >
                    {savingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {deadlineModal}
        {cancelDeadlineModal}
      </div>
    );
  }

  return (
    <div className="@container space-y-4">

      {/* Indicadores do mês — cada um filtra a fila pelo status correspondente.
          Leitura sóbria: rótulo em cima, número embaixo, cor só no ícone e no
          traço lateral do card ativo. */}
      <div className="grid grid-cols-2 @sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Total do mês',
            value: monthlyDeadlines.length,
            icon: Calendar,
            active: activeStatusTab === 'todos',
            onClick: () => setActiveStatusTab('todos'),
            accent: 'bg-slate-400',
            iconTone: 'bg-slate-100 text-slate-500',
            valueTone: 'text-slate-900',
          },
          {
            label: 'Pendentes',
            value: allPending.length,
            icon: Clock,
            active: activeStatusTab === 'pendente',
            onClick: () => setActiveStatusTab('pendente'),
            accent: 'bg-blue-500',
            iconTone: 'bg-blue-50 text-blue-600',
            valueTone: 'text-slate-900',
          },
          {
            label: 'Atenção',
            value: allAttentionCount,
            icon: AlertCircle,
            active: activeStatusTab === 'vencido',
            onClick: () => setActiveStatusTab('vencido'),
            accent: allAttentionCount > 0 ? 'bg-red-500' : 'bg-slate-300',
            iconTone: allAttentionCount > 0 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-400',
            // O número em vermelho já chama atenção suficiente; nada pisca.
            valueTone: allAttentionCount > 0 ? 'text-red-600' : 'text-slate-400',
          },
          {
            label: 'Concluídos',
            value: monthlyCompleted.length,
            icon: CheckCircle,
            active: activeStatusTab === 'cumprido',
            onClick: () => setActiveStatusTab('cumprido'),
            accent: 'bg-emerald-500',
            iconTone: 'bg-emerald-50 text-emerald-600',
            valueTone: 'text-slate-900',
          },
        ].map(({ label, value, icon: Icon, active, onClick, accent, iconTone, valueTone }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`group relative flex flex-col gap-2.5 p-4 pl-5 rounded-xl border text-left overflow-hidden transition-colors ${
              active
                ? 'bg-[#f8f7f5] border-slate-300 shadow-sm'
                : 'bg-[#f8f7f5] border-[#e7e5df] hover:border-slate-300'
            }`}
          >
            {/* Traço lateral: marca o card ativo sem inverter o fundo inteiro. */}
            <span
              aria-hidden
              className={`absolute left-0 top-0 bottom-0 w-1 transition-opacity ${accent} ${active ? 'opacity-100' : 'opacity-0'}`}
            />
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${iconTone}`}>
                <Icon className="w-3.5 h-3.5" />
              </span>
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide truncate">{label}</span>
            </div>
            <p className={`text-2xl font-semibold tabular-nums leading-none ${valueTone}`}>{value}</p>
          </button>
        ))}
      </div>

      {/* Alertas inteligentes - Compacto */}
      {smartAlerts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {smartAlerts.map((alert) => {
            const tone = ALERT_TONE_STYLES[alert.tone];
            return (
              <button
                key={alert.id}
                onClick={alert.onAction}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border ${tone.border} ${tone.bg} ${tone.text} hover:shadow-sm transition-all`}
              >
                {alert.icon}
                <span>{alert.title}: {alert.description.match(/\d+/)?.[0] || ''}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Toolbar — três grupos: visões, período e busca/ações. Um divisor só
          entre eles, tudo na mesma altura (h-9), para a linha não virar ruído. */}
      <div className="bg-[#f8f7f5] rounded-xl border border-[#e7e5df] shadow-sm overflow-hidden">
        {/* Linha principal */}
        <div className="flex items-center gap-2 px-3 py-2">
          {/* Views */}
          <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            {[
              { key: 'list', icon: List, label: 'Lista', action: () => setViewMode('list'), active: viewMode === 'list', badge: 0 },
              { key: 'kanban', icon: LayoutGrid, label: 'Kanban', action: () => setViewMode('kanban'), active: viewMode === 'kanban', badge: 0 },
              { key: 'calendar', icon: Calendar, label: 'Calendário', action: () => setCalendarExpanded(!calendarExpanded), active: calendarExpanded, badge: 0 },
              { key: 'workload', icon: Users, label: 'Carga', action: () => setViewMode(viewMode === 'workload' ? 'list' : 'workload'), active: viewMode === 'workload', badge: 0 },
              // Agendados mora aqui com as outras visões, só de ícone. O número
              // no canto é o que impede o prazo dormindo de sumir da cabeça de
              // quem agendou. Só admin.
              ...(isAdmin ? [{
                key: 'scheduled', icon: CalendarClock, label: 'Agendados',
                action: () => setViewMode(viewMode === 'scheduled' ? 'list' : 'scheduled'),
                active: viewMode === 'scheduled', badge: scheduledCount,
              }] : []),
            ].map(({ key, icon: Icon, label, action, active, badge }) => (
              <button key={key} onClick={action} title={label} aria-label={label} aria-pressed={active}
                className={`relative w-8 h-8 flex items-center justify-center rounded-md transition-colors ${active ? 'bg-[#f8f7f5] text-slate-900 shadow-sm ring-1 ring-black/[0.04]' : 'text-slate-400 hover:text-slate-700'}`}>
                <Icon className="w-4 h-4" />
                {badge > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-slate-700 text-white text-[9px] font-semibold leading-[15px] text-center tabular-nums">
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-slate-200 mx-1" />

          {/* Mês */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => { const m = internalCalendarMonth === 0 ? 11 : internalCalendarMonth - 1; const y = internalCalendarMonth === 0 ? internalCalendarYear - 1 : internalCalendarYear; setInternalCalendarMonth(m); setInternalCalendarYear(y); onCalendarChange?.(m, y); }}
              title="Mês anterior"
              aria-label="Mês anterior"
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {/* first-letter, não capitalize: "agosto de 2026" viraria "Agosto De 2026". */}
            <span className="text-sm font-semibold text-slate-800 first-letter:uppercase min-w-[8.5rem] text-center select-none tabular-nums">
              {new Date(internalCalendarYear, internalCalendarMonth).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
            </span>
            <button
              onClick={() => { const m = internalCalendarMonth === 11 ? 0 : internalCalendarMonth + 1; const y = internalCalendarMonth === 11 ? internalCalendarYear + 1 : internalCalendarYear; setInternalCalendarMonth(m); setInternalCalendarYear(y); onCalendarChange?.(m, y); }}
              title="Próximo mês"
              aria-label="Próximo mês"
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="w-px h-5 bg-slate-200 mx-1" />

          {/* Busca */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              placeholder="Buscar prazo..."
              aria-label="Buscar prazo"
              className="w-full h-9 pl-8 pr-3 bg-white border border-[#e7e5df] rounded-lg text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-colors"
            />
          </div>

          {/* Filtros */}
          <button
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            aria-expanded={filtersExpanded}
            className={`flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-medium transition-colors ${
              filtersExpanded || filterType || filterPriority || filterResponsible
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-[#e7e5df] text-slate-600 hover:border-slate-300'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filtros</span>
            {(filterType || filterPriority || filterResponsible) && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
            )}
          </button>

          <div className="flex-1" />

          {/* Ações secundárias */}
          <div className="flex items-center gap-0.5">
            <button onClick={handleExportFiltered} title="Exportar lista filtrada" aria-label="Exportar lista filtrada"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
              <Download className="w-4 h-4" />
            </button>
            <button onClick={() => setShowReportModal(true)} title="Relatórios" aria-label="Relatórios"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
              <BarChart3 className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => handleOpenModal()}
            className="ml-1 flex items-center gap-1.5 h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Prazo
          </button>
        </div>

        {/* Painel de filtros */}
        {filtersExpanded && (
          <div className="border-t border-slate-100 px-3 py-2.5 flex flex-wrap items-center gap-2 bg-slate-50/60">
            <select value={filterType} onChange={(e) => setFilterType(e.target.value as DeadlineType | '')}
              className="h-8 px-2 pr-7 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] text-slate-700 focus:outline-none cursor-pointer">
              <option value="">Tipo</option>
              <option value="processo">Processo</option>
              <option value="requerimento">Requerimento</option>
              <option value="geral">Geral</option>
            </select>
            <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value as DeadlinePriority | '')}
              className="h-8 px-2 pr-7 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] text-slate-700 focus:outline-none cursor-pointer">
              <option value="">Prioridade</option>
              <option value="urgente">Urgente</option>
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>
            <select value={filterResponsible} onChange={(e) => setFilterResponsible(e.target.value)}
              className="h-8 px-2 pr-7 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] text-slate-700 focus:outline-none cursor-pointer">
              <option value="">Todos</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {(filterType || filterPriority || filterResponsible) && (
              <button onClick={() => { setFilterType(''); setFilterPriority(''); setFilterResponsible(''); }}
                className="h-8 px-3 text-xs text-red-600 border border-red-200 bg-[#f8f7f5] rounded-lg hover:bg-red-50 transition">
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* Calendário Mensal de Prazos - Retrátil */}
      {calendarExpanded && (
      <div className="bg-[#f8f7f5] rounded-xl border border-[#e7e5df] shadow-sm overflow-hidden">
        <div className="p-4">
            {/* Navegação do mês */}
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => {
                  if (internalCalendarMonth === 0) {
                    const newMonth = 11;
                    const newYear = internalCalendarYear - 1;
                    setInternalCalendarMonth(newMonth);
                    setInternalCalendarYear(newYear);
                    onCalendarChange?.(newMonth, newYear);
                  } else {
                    const newMonth = internalCalendarMonth - 1;
                    setInternalCalendarMonth(newMonth);
                    onCalendarChange?.(newMonth, internalCalendarYear);
                  }
                }}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800 first-letter:uppercase">
                  {new Date(internalCalendarYear, internalCalendarMonth).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                </span>
                {(internalCalendarMonth !== new Date().getMonth() || internalCalendarYear !== new Date().getFullYear()) && (
                  <button
                    onClick={() => {
                      const currentMonth = new Date().getMonth();
                      const currentYear = new Date().getFullYear();
                      setInternalCalendarMonth(currentMonth);
                      setInternalCalendarYear(currentYear);
                      onCalendarChange?.(currentMonth, currentYear);
                    }}
                    className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Hoje
                  </button>
                )}
              </div>
              
              <button
                onClick={() => {
                  if (internalCalendarMonth === 11) {
                    const newMonth = 0;
                    const newYear = internalCalendarYear + 1;
                    setInternalCalendarMonth(newMonth);
                    setInternalCalendarYear(newYear);
                    onCalendarChange?.(newMonth, newYear);
                  } else {
                    const newMonth = internalCalendarMonth + 1;
                    setInternalCalendarMonth(newMonth);
                    onCalendarChange?.(newMonth, internalCalendarYear);
                  }
                }}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            
            {/* Dias da semana */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day, i) => (
                <div key={day} className={`text-center text-[10px] font-medium py-1 ${
                  i === 0 || i === 6 ? 'text-red-400' : 'text-slate-500'
                }`}>
                  {day}
                </div>
              ))}
            </div>
        
            {/* Dias do mês */}
            <div className="grid grid-cols-7 gap-1">
              {(() => {
                const today = new Date();
                const year = internalCalendarYear;
                const month = internalCalendarMonth;
                const firstDay = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const cells = [];
                
                for (let i = 0; i < firstDay; i++) {
                  cells.push(<div key={`empty-${i}`} className="h-8" />);
                }
                
                for (let day = 1; day <= daysInMonth; day++) {
                  const date = new Date(year, month, day);
                  const isToday = date.toDateString() === today.toDateString();
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  
                  const dayStr = String(day).padStart(2, '0');
                  const monthStr = String(month + 1).padStart(2, '0');
                  const dateStr = `${year}-${monthStr}-${dayStr}`;
                  
                  const dayDeadlines = pendingDeadlines.filter(d => {
                    const dueDateStr = d.due_date?.split('T')[0];
                    return dueDateStr === dateStr;
                  });
                  const count = dayDeadlines.length;
                  const hasUrgent = dayDeadlines.some(d => d.priority === 'urgente' || d.priority === 'alta');
                  const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
                  
                  cells.push(
                    <div
                      key={day}
                      onClick={() => {
                        setFormData((prev) => ({ ...emptyForm, due_date: dateStr, responsible_id: prev.responsible_id }));
                        setSelectedDeadline(null);
                        setIsModalOpen(true);
                      }}
                      className={`relative h-8 flex items-center justify-center rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        isToday
                          ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                          : count > 0 && hasUrgent
                          ? 'bg-red-100 text-red-700 hover:bg-red-200'
                          : count > 0
                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                          : isWeekend
                          ? 'text-red-300 bg-red-50/50 hover:bg-red-100'
                          : isPast
                          ? 'text-slate-300 hover:bg-slate-50'
                          : 'text-slate-600 hover:bg-blue-50 hover:text-blue-700'
                      }`}
                      title={count > 0 ? `${count} prazo(s) · clique para criar novo` : 'Clique para criar prazo neste dia'}
                    >
                      {day}
                      {count > 0 && (
                        <span className={`absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center ${
                          hasUrgent ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'
                        }`}>
                          {count}
                        </span>
                      )}
                    </div>
                  );
                }
                
                return cells;
              })()}
            </div>
        
            {/* Legenda */}
            <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-slate-100">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-amber-100 border border-amber-300" />
                <span className="text-[10px] text-slate-500">Com prazo</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-red-100 border border-red-300" />
                <span className="text-[10px] text-slate-500">Urgente</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-red-50 border border-red-200" />
                <span className="text-[10px] text-slate-500">Fim de semana</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Conteúdo Principal baseado no viewMode */}
      {viewMode === 'scheduled' && isAdmin ? (
        <DeadlineScheduledPanel isAdmin={isAdmin} members={members} onEdit={handleOpenModal} />
      ) : viewMode === 'kanban' ? (
        <div className="grid grid-cols-1 @md:grid-cols-2 @xl:grid-cols-3 gap-4">
          {statusFilterOptions.map((statusOption) => {
            const StatusIcon = statusOption.icon;
            // O kanban tem uma coluna por status, então parte da lista completa —
            // a fila (filteredDeadlines) já deixa cumpridos/vencidos/cancelados de fora.
            const statusDeadlines = kanbanDeadlines.filter((d) => d.status === statusOption.key);
            // A cor identifica a coluna num traço e no ícone; a barra cheia e
            // saturada de antes competia com os cards que ela deveria emoldurar.
            const columnColors: Record<string, { accent: string; icon: string }> = {
              pendente: { accent: 'bg-blue-500', icon: 'text-blue-500' },
              vencido: { accent: 'bg-red-500', icon: 'text-red-500' },
              cumprido: { accent: 'bg-emerald-500', icon: 'text-emerald-500' },
              cancelado: { accent: 'bg-red-600', icon: 'text-red-600' },
            };
            const colors = columnColors[statusOption.key] || columnColors.pendente;

            return (
              <div key={statusOption.key} className="bg-[#f8f7f5] border border-[#e7e5df] rounded-xl overflow-hidden shadow-sm">
                {/* Header da coluna */}
                <div className="relative px-4 py-2.5 flex items-center justify-between border-b border-slate-100">
                  <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-1 ${colors.accent}`} />
                  <div className="flex items-center gap-2">
                    <StatusIcon className={`w-4 h-4 ${colors.icon}`} />
                    <h4 className="text-sm font-semibold text-slate-800">{statusOption.label}</h4>
                  </div>
                  <span className="bg-slate-100 text-slate-500 text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full">
                    {statusDeadlines.length}
                  </span>
                </div>
                
                {/* Cards — o corpo da coluna é levemente mais escuro que o card,
                    senão os dois usariam o mesmo off-white e o card sumiria. */}
                <div className="p-3 space-y-2 max-h-[500px] overflow-y-auto bg-slate-50/70">
                  {statusDeadlines.map((deadline) => {
                    const daysUntil = getDaysUntilDue(deadline.due_date);
                    const dueSoon = checkIsDueSoon(deadline.due_date);
                    const priorityConfig = getPriorityConfig(deadline.priority);
                    const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;

                    return (
                      <div
                        key={deadline.id}
                        className={`bg-[#f8f7f5] border border-[#e7e5df] rounded-lg p-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all cursor-pointer border-l-4 ${
                          dueSoon || daysUntil < 0
                            ? 'border-l-red-500'
                            : deadline.priority === 'urgente'
                            ? 'border-l-red-500'
                            : deadline.priority === 'alta'
                            ? 'border-l-orange-500'
                            : deadline.priority === 'media'
                            ? 'border-l-amber-500'
                            : 'border-l-slate-300'
                        }`}
                        onClick={() => handleViewDeadline(deadline)}
                      >
                        {/* Título e prioridade */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h5 className="text-sm font-semibold text-slate-800 line-clamp-2">{deadline.title}</h5>
                          {priorityConfig && (
                            // Rótulo inteiro: "URG"/"MÉD" abreviava o que já cabia.
                            <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${getPriorityBadge(deadline.priority)}`}>
                              {priorityConfig.label}
                            </span>
                          )}
                        </div>
                        
                        {/* Cliente */}
                        {clientItem && (
                          <p className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                            <UserCircle className="w-3 h-3" />
                            <span className="truncate">{clientItem.full_name}</span>
                          </p>
                        )}
                        
                        {/* Data e dias */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                          <span className="text-[10px] text-slate-400 tabular-nums">{formatDate(deadline.due_date)}</span>
                          {deadline.status === 'cancelado' ? (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">Cancelado</span>
                          ) : deadline.status === 'cumprido' ? (
                            (() => {
                              const onTime = (() => { const due = parseDateOnly(deadline.due_date); const comp = deadline.completed_at ? parseDateOnly(deadline.completed_at) : null; if (!due) return daysUntil >= 0; return comp ? comp.getTime() <= due.getTime() : daysUntil >= 0; })();
                              return (
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${onTime ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {onTime ? '✓ No prazo' : '✓ Com atraso'}
                                </span>
                              );
                            })()
                          ) : daysUntil >= 0 ? (
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded tabular-nums ${
                              dueSoon ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                            }`}>
                              {daysUntil === 0 ? 'Hoje' : daysUntil === 1 ? 'Amanhã' : `${daysUntil} dias`}
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded tabular-nums bg-red-500 text-white">
                              {Math.abs(daysUntil)} {Math.abs(daysUntil) === 1 ? 'dia' : 'dias'} em atraso
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  
                  {statusDeadlines.length === 0 && (
                    <div className="text-center py-8">
                      <StatusIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs text-slate-400">Nenhum prazo</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === 'map' ? (
        <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-6">
          <div className="flex flex-col @md:flex-row @md:items-center @md:justify-between gap-4 mb-6">
            <div>
              <h4 className="text-lg font-semibold text-slate-900">Mapa de Prazos: plano de ação</h4>
              <p className="text-sm text-slate-600">
                Utilize este quadro como caminho de execução. Priorize blocos da esquerda para a direita.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Siren className="w-3 h-3 text-red-600" />
              <span>Indica prazos que expiram em até 2 dias.</span>
            </div>
          </div>

          <div className="grid grid-cols-1 @xl:grid-cols-2 gap-6">
            {resolvedBuckets.map((bucket) => {
              const BucketIcon = bucket.icon;
              const bucketDeadlines = pendingDeadlines
                .map((deadline) => ({
                  ...deadline,
                  daysUntil: getDaysUntilDue(deadline.due_date),
                }))
                .filter((deadline) => bucket.predicate(deadline.daysUntil))
                .sort((a, b) => {
                  const priorityOrder: Record<DeadlinePriority, number> = {
                    urgente: 0,
                    alta: 1,
                    media: 2,
                    baixa: 3,
                  };
                  const comparePriority = priorityOrder[a.priority] - priorityOrder[b.priority];
                  if (comparePriority !== 0) return comparePriority;
                  return a.daysUntil - b.daysUntil;
                });

              const awaitingProcesses = bucket.key === 'awaiting_drafting'
                ? processes.filter((processItem) => processItem.status === 'aguardando_confeccao')
                : [];
              const awaitingRequirements = bucket.key === 'awaiting_drafting'
                ? requirements.filter((requirementItem) => requirementItem.status === 'aguardando_confeccao')
                : [];
              const totalItems = bucket.key === 'awaiting_drafting'
                ? awaitingProcesses.length + awaitingRequirements.length
                : bucketDeadlines.length;

              return (
                <div key={bucket.key} className="border border-[#e7e5df] rounded-xl p-5 bg-slate-50/60">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <BucketIcon className={`w-4 h-4 ${bucket.colorClass}`} />
                        <h5 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">{bucket.label}</h5>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 max-w-lg">{bucket.description}</p>
                    </div>
                    <span className="text-xs font-semibold text-slate-500">{totalItems}</span>
                  </div>

                  {bucket.key === 'awaiting_drafting' ? (
                    awaitingProcesses.length === 0 && awaitingRequirements.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-8">Nenhum processo ou requerimento aguardando confecção.</p>
                    ) : (
                      <div className="space-y-3">
                        {awaitingProcesses.map((processItem) => {
                          const clientItem = clientMap.get(processItem.client_id);
                          const displayCode = processItem.process_code?.length ? processItem.process_code : 'Sem número definido';
                          return (
                            <div
                              key={processItem.id}
                              className="rounded-lg border border-blue-200 bg-white p-4 hover:shadow-lg transition"
                            >
                              <div className="flex items-start justify-between">
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 uppercase">
                                  Processo
                                </span>
                                <span className="text-sm font-medium text-slate-600">{displayCode}</span>
                              </div>
                              <div className="mt-3 space-y-1 text-sm text-slate-600">
                                {clientItem && (
                                  <div>
                                    <span className="font-semibold text-slate-900">Cliente:</span> {clientItem.full_name}
                                  </div>
                                )}
                                <p className="text-xs text-slate-500">
                                  Prepare a petição inicial e atualize o processo para liberar o protocolo e criação de prazos.
                                </p>
                              </div>
                            </div>
                          );
                        })}
                        {awaitingRequirements.map((requirementItem) => {
                          const displayProtocol = requirementItem.protocol?.length ? requirementItem.protocol : 'Sem protocolo gerado';
                          return (
                            <div
                              key={requirementItem.id}
                              className="rounded-lg border border-sky-200 bg-white p-4 hover:shadow-lg transition"
                            >
                              <div className="flex items-start justify-between">
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-100 text-sky-700 uppercase">
                                  Requerimento
                                </span>
                                <span className="text-sm font-medium text-slate-600">{displayProtocol}</span>
                              </div>
                              <div className="mt-3 space-y-1 text-sm text-slate-600">
                                <div>
                                  <span className="font-semibold text-slate-900">Beneficiário:</span> {requirementItem.beneficiary}
                                </div>
                                <p className="text-xs text-slate-500">
                                  Organize documentos e protocole o requerimento administrativo antes de prosseguir.
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                  ) : totalItems === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-8">Nenhum prazo neste momento.</p>
                  ) : (
                    <div className="space-y-3">
                      {bucketDeadlines.map((deadline) => {
                        const priorityConfig = getPriorityConfig(deadline.priority);
                        const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
                        const responsibleItem = deadline.responsible_id ? memberMap.get(deadline.responsible_id) : null;
                        const dueSoon = checkIsDueSoon(deadline.due_date);

                        return (
                          <div
                            key={deadline.id}
                            className={`rounded-lg border bg-[#f8f7f5] p-4 hover:shadow-md transition cursor-pointer ${
                              dueSoon ? 'border-red-300' : 'border-[#e7e5df]'
                            }`}
                            onClick={() => handleViewDeadline(deadline)}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <h6 className="text-sm font-semibold text-slate-900">{deadline.title}</h6>
                                  {priorityConfig && (
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${getPriorityBadge(deadline.priority)}`}>
                                      {priorityConfig.label}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-600 mt-1 flex flex-wrap gap-3">
                                  {clientItem && (
                                    <span className="flex items-center gap-1">
                                      <UserCircle className="w-3 h-3" />
                                      {clientItem.full_name}
                                    </span>
                                  )}
                                  {responsibleItem && <span>Responsável: {responsibleItem.name}</span>}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1 text-xs">
                                <span className="text-slate-500">{formatDate(deadline.due_date)}</span>
                                <span className={`flex items-center gap-1 font-semibold ${
                                  deadline.status === 'cumprido' ? 'text-emerald-600' : dueSoon ? 'text-red-600' : 'text-slate-600'
                                }`}>
                                  {dueSoon && deadline.status !== 'cumprido' && <Siren className="w-3 h-3" />}
                                  {deadline.status === 'cumprido'
                                    ? '✓ Cumprido'
                                    : deadline.daysUntil >= 0 ? `${deadline.daysUntil} dia(s)` : 'Vencido'}
                                </span>
                              </div>
                            </div>
                            {deadline.description && (
                              <p className="text-xs text-slate-500 mt-2 line-clamp-2">{deadline.description}</p>
                            )}
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
      ) : (!isPastMonth && viewMode !== 'workload' && showSkeleton) ? (
        <DeadlinesSkeleton rows={8} />
      ) : (!isPastMonth && viewMode !== 'workload' && filteredDeadlines.length === 0) ? (
        <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-12 text-center">
          <p className="text-slate-600">Nenhum prazo encontrado.</p>
        </div>
      ) : (!isPastMonth && viewMode !== 'workload') ? (
        <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] overflow-hidden">
          {/* Mobile Cards */}
          <div className="block @md:hidden divide-y divide-[#e7e5df]">
            {paginatedDeadlines.map((deadline) => {
              const priorityConfig = getPriorityConfig(deadline.priority);
              const typeConfig = getTypeConfig(deadline.type);
              const daysUntil = getDaysUntilDue(deadline.due_date);
              const dueSoon = isDueSoon(deadline.due_date);
              const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
              const responsibleItem = deadline.responsible_id ? memberMap.get(deadline.responsible_id) : null;

              return (
                <div key={deadline.id} className={`p-3 sm:p-4 ${dueSoon && deadline.status === 'pendente' ? 'bg-red-50/70' : ''}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-gray-900 truncate">{deadline.title}</h3>
                      {deadline.description && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{deadline.description}</p>
                      )}
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${getPriorityBadge(deadline.priority)}`}>
                      {priorityConfig && <priorityConfig.icon className="w-3 h-3" />}
                      {getPriorityLabel(deadline.priority)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                    <div>
                      <span className="text-slate-500">Vencimento:</span>
                      <p className="font-medium text-gray-900">{formatDate(deadline.due_date)}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Situação:</span>
                      {deadline.status === 'cancelado' ? (
                        <p className="font-medium text-red-600">Cancelado</p>
                      ) : deadline.status === 'cumprido' ? (
                        (() => {
                          const onTime = (() => {
                            const due = parseDateOnly(deadline.due_date);
                            const completed = deadline.completed_at ? parseDateOnly(deadline.completed_at) : null;
                            if (!due || !completed) return daysUntil >= 0;
                            return completed.getTime() <= due.getTime();
                          })();
                          return <p className={`font-medium ${onTime ? 'text-emerald-600' : 'text-amber-600'}`}>{onTime ? '✓ No prazo' : '✓ Com atraso'}</p>;
                        })()
                      ) : daysUntil >= 0 ? (
                        <p className={`font-medium ${dueSoon ? 'text-red-600' : 'text-gray-900'}`}>
                          {daysUntil} dia(s)
                        </p>
                      ) : (
                        <p className="font-medium text-red-600">Vencido</p>
                      )}
                    </div>
                    <div>
                      <span className="text-slate-500">Cliente:</span>
                      <p className="font-medium text-gray-900 truncate">{clientItem ? clientItem.full_name : 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Tipo:</span>
                      <p className="font-medium text-gray-900">{getTypeLabel(deadline.type)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleViewDeadline(deadline)}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-blue-50 text-blue-700 px-3 py-2 rounded-lg text-xs font-medium"
                    >
                      <Eye className="w-3 h-3" />
                      Ver
                    </button>
                    <button
                      onClick={() => handleOpenModal(deadline)}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-amber-50 text-amber-700 px-3 py-2 rounded-lg text-xs font-medium"
                    >
                      <Edit2 className="w-3 h-3" />
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeleteDeadline(deadline.id)}
                      className="px-3 py-2 bg-red-50 text-red-700 rounded-lg"
                      title="Excluir"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table - Layout conforme imagem */}
          <div className="hidden @md:block">
            <table className="w-full">
              {selectedIds.size > 0 && (
                <thead>
                  <tr>
                    <td colSpan={7} className="px-4 py-2 bg-blue-50 border-b border-blue-200">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-semibold text-blue-700">{selectedIds.size} selecionado(s)</span>
                        <div className="flex items-center gap-2">
                          <select
                            disabled={bulkActionLoading}
                            defaultValue=""
                            onChange={(e) => { if (e.target.value) void handleBulkStatusChange(e.target.value as DeadlineStatus); e.target.value = ''; }}
                            className="h-8 px-2 text-xs border border-blue-200 rounded-lg bg-[#f8f7f5] text-slate-700 focus:outline-none cursor-pointer"
                          >
                            <option value="" disabled>Alterar status...</option>
                            {statusOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                          <select
                            disabled={bulkActionLoading}
                            defaultValue=""
                            onChange={(e) => { if (e.target.value) void handleBulkResponsibleChange(e.target.value); e.target.value = ''; }}
                            className="h-8 px-2 text-xs border border-blue-200 rounded-lg bg-[#f8f7f5] text-slate-700 focus:outline-none cursor-pointer"
                          >
                            <option value="" disabled>Alterar responsável...</option>
                            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                          <button
                            onClick={() => void handleBulkDelete()}
                            disabled={bulkActionLoading}
                            className="inline-flex items-center gap-1 h-8 px-3 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition disabled:opacity-50"
                          >
                            {bulkActionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            Excluir
                          </button>
                          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-500 hover:text-slate-700 underline">Limpar</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                </thead>
              )}
              <thead className="border-b border-[#e7e5df] bg-slate-50/60">
                <tr>
                  <th className="pl-4 pr-2 py-2.5 w-8">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os prazos da página"
                      checked={paginatedDeadlines.length > 0 && paginatedDeadlines.every((d) => selectedIds.has(d.id))}
                      onChange={() => handleSelectAll(paginatedDeadlines.map((d) => d.id))}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Prazo</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Vencimento</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Dias</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Cliente / Prioridade</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedDeadlines.map((deadline) => {
                  const isUpdating = statusUpdatingId === deadline.id;
                  const priorityConfig = getPriorityConfig(deadline.priority);
                  const daysUntil = getDaysUntilDue(deadline.due_date);
                  const dueSoon = isDueSoon(deadline.due_date);
                  const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
                  const linkedProcess = deadline.process_id ? processes.find(p => p.id === deadline.process_id) : null;

                  return (
                    <tr
                      key={deadline.id}
                      className={`group relative hover:bg-slate-50 transition-colors ${
                        selectedIds.has(deadline.id) ? 'bg-blue-50/50' :
                        dueSoon && deadline.status === 'pendente' ? 'bg-red-50/30' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="pl-4 pr-2 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(deadline.id)}
                          onChange={() => handleToggleSelect(deadline.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                      {/* Coluna PRAZO */}
                      <td className="px-4 py-3 max-w-[22rem]">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => handleViewDeadline(deadline)}
                            title={deadline.title}
                            className="block w-full text-left text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline truncate"
                          >
                            {deadline.title}
                          </button>
                          {/* Subtítulo: o processo vinculado quando existe; senão o tipo do prazo. */}
                          <p className="text-xs text-slate-400 mt-0.5 truncate">
                            {linkedProcess?.process_code
                              ? `Processo ${linkedProcess.process_code}`
                              : getTypeLabel(deadline.type)}
                          </p>
                        </div>
                      </td>
                      
                      {/* Coluna VENCIMENTO */}
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-700 tabular-nums whitespace-nowrap">{formatDate(deadline.due_date)}</span>
                      </td>
                      
                      {/* Coluna DIAS */}
                      <td className="px-4 py-3">
                        {deadline.status === 'cancelado' ? (
                          // A coluna de status já diz "Cancelado" — repetir aqui só polui.
                          <span className="text-xs text-slate-400">—</span>
                        ) : deadline.status === 'cumprido' ? (
                          (() => {
                            const onTime = (() => {
                              const due = parseDateOnly(deadline.due_date);
                              const completed = deadline.completed_at ? parseDateOnly(deadline.completed_at) : null;
                              if (!due || !completed) return daysUntil >= 0;
                              return completed.getTime() <= due.getTime();
                            })();
                            return (
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${onTime ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {onTime ? '✓ No prazo' : '✓ Com atraso'}
                              </span>
                            );
                          })()
                        ) : daysUntil >= 0 ? (
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap tabular-nums ${
                            dueSoon ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {daysUntil === 0 ? 'Vence hoje' : `${daysUntil} ${daysUntil === 1 ? 'dia' : 'dias'}`}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap tabular-nums bg-red-500 text-white">
                            {Math.abs(daysUntil)} {Math.abs(daysUntil) === 1 ? 'dia' : 'dias'} em atraso
                          </span>
                        )}
                      </td>
                      
                      {/* Coluna CLIENTE / PRIORIDADE */}
                      <td className="px-4 py-3 max-w-[16rem]">
                        <div className="flex flex-col items-start gap-1 min-w-0">
                          <span className="text-sm text-slate-800 truncate max-w-full" title={clientItem?.full_name}>
                            {clientItem ? clientItem.full_name : '—'}
                          </span>
                          {/* Badge vem das configurações do módulo, igual ao card e ao kanban. */}
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${getPriorityBadge(deadline.priority)}`}>
                            {priorityConfig && <priorityConfig.icon className="w-2.5 h-2.5" />}
                            {getPriorityLabel(deadline.priority)}
                          </span>
                        </div>
                      </td>
                      
                      {/* Coluna STATUS — badge configurável que também troca o status. */}
                      <td className="px-4 py-3">
                        <span
                          className={`relative inline-flex items-center rounded-md text-xs font-semibold transition focus-within:ring-2 focus-within:ring-blue-500/30 ${getStatusBadge(deadline.status)} ${isUpdating ? 'opacity-50' : ''}`}
                        >
                          <select
                            value={deadline.status}
                            onChange={(e) => handleStatusChange(deadline.id, e.target.value as DeadlineStatus)}
                            disabled={isUpdating}
                            aria-label={`Status: ${getStatusLabel(deadline.status)}`}
                            className="appearance-none bg-transparent text-current font-semibold pl-3 pr-7 py-1.5 rounded-md border-0 focus:outline-none cursor-pointer disabled:cursor-not-allowed"
                          >
                            {statusOptions.map((opt) => (
                              <option key={opt.key} value={opt.key} className="text-slate-700 bg-white font-medium">
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          {isUpdating ? (
                            <Loader2 className="absolute right-2 w-3 h-3 animate-spin pointer-events-none" />
                          ) : (
                            <ChevronDown className="absolute right-2 w-3 h-3 opacity-70 pointer-events-none" />
                          )}
                        </span>
                      </td>
                      
                      {/* Coluna AÇÕES — discretas em repouso, nítidas ao passar o
                          mouse ou ao chegar pelo teclado. */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-0.5 opacity-50 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleViewDeadline(deadline)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                            title="Ver"
                            aria-label="Ver prazo"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleOpenModal(deadline)}
                            className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors"
                            title="Editar"
                            aria-label="Editar prazo"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => void handleCloneDeadline(deadline)}
                              className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors"
                              title="Duplicar prazo"
                              aria-label="Duplicar prazo"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteDeadline(deadline.id)}
                            className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                            title="Excluir"
                            aria-label="Excluir prazo"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ── Visão de carga por responsável ─────────────────────────────── */}
      {viewMode === 'workload' && (
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h4 className="text-base font-bold text-slate-900">Carga por Responsável</h4>
              <p className="text-xs text-slate-400">prazos pendentes e vencidos em aberto</p>
            </div>
          </div>

          {members.length === 0 ? (
            <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-12 text-center">
              <p className="text-sm text-slate-400">Nenhum membro encontrado.</p>
            </div>
          ) : (() => {
            const workloadRows = members.map((member) => {
              const memberDeadlines = deadlines.filter((d) =>
                d.responsible_id === member.id && (d.status === 'pendente' || d.status === 'vencido')
              );
              const overdue = memberDeadlines.filter((d) => d.status === 'vencido' || getDaysUntilDue(d.due_date) < 0).length;
              const urgent = memberDeadlines.filter((d) => d.priority === 'urgente' || d.priority === 'alta').length;
              const total = memberDeadlines.length;
              return { member, total, overdue, urgent };
            }).sort((a, b) => b.total - a.total);

            const maxTotal = Math.max(...workloadRows.map((r) => r.total), 1);

            return (
              <div className="grid grid-cols-1 @md:grid-cols-2 gap-3">
                {workloadRows.map(({ member, total, overdue, urgent }) => {
                  const initials = member.name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() || '?';
                  const pct = Math.round((total / maxTotal) * 100);
                  const barColor = overdue > 0 ? 'bg-red-500' : urgent > 0 ? 'bg-orange-400' : 'bg-blue-500';
                  const cardBorder = overdue > 0 ? 'border-red-200' : 'border-[#e7e5df]';

                  return (
                    <div key={member.id} className={`bg-[#f8f7f5] rounded-xl border ${cardBorder} p-4 hover:shadow-sm transition`}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                          overdue > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{member.name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-xs text-slate-500 font-medium">{total} prazo{total !== 1 ? 's' : ''}</span>
                            {overdue > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                                <AlertTriangle className="w-2.5 h-2.5" /> {overdue} vencido{overdue !== 1 ? 's' : ''}
                              </span>
                            )}
                            {urgent > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-semibold">
                                {urgent} urgente{urgent !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-xl font-semibold tabular-nums text-slate-300 flex-shrink-0">{total}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {!isPastMonth && viewMode !== 'workload' && !(viewMode === 'scheduled' && isAdmin) && filteredDeadlines.length > pageSize && (
        <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-4 flex items-center justify-between">
          <button
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="px-3 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Anterior
          </button>
          <div className="text-sm text-slate-600">
            Página {currentPage} de {totalPages}
          </div>
          <button
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Próxima
          </button>
        </div>
      )}

      {deadlineModal}
      {viewDeadlineModal}
      {cancelDeadlineModal}
      {reportModal}

      {/* ── Histórico de Prazos (cumpridos / vencidos / cancelados) ─────── */}
      <div className="bg-[#f8f7f5] rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04]">

        {/* Header */}
        <div className="px-5 py-3.5 flex items-center justify-between gap-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <h4 className="text-sm font-bold text-slate-800">Histórico de Prazos</h4>
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{filteredHistory.length}</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Status */}
            <select
              value={historyStatus}
              onChange={(e) => { setHistoryStatus(e.target.value as DeadlineStatus | ''); setHistoryPage(1); }}
              className="h-7 px-2 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none cursor-pointer text-slate-600"
            >
              <option value="">Todos</option>
              {ARCHIVED_STATUSES.map((key) => (
                <option key={key} value={key}>
                  {HISTORY_STATUS_LABEL[key] || statusOptions.find((s) => s.key === key)?.label || key}
                </option>
              ))}
            </select>

            {/* Busca inline */}
            <div className="relative hidden @sm:block">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(1); }}
                placeholder="Buscar..."
                className="h-7 pl-7 pr-3 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none focus:ring-1 focus:ring-emerald-400/40 w-36"
              />
            </div>

            {/* Mês */}
            <select
              value={historyMonth === '' ? '' : String(historyMonth)}
              onChange={(e) => { setHistoryMonth(e.target.value === '' ? '' : Number(e.target.value)); setHistoryPage(1); }}
              className="h-7 px-2 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none cursor-pointer text-slate-600"
            >
              <option value="">Mês</option>
              {['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m, i) => (
                <option key={i} value={i}>{m}</option>
              ))}
            </select>

            {/* Ano */}
            <select
              value={historyYear === '' ? '' : String(historyYear)}
              onChange={(e) => { setHistoryYear(e.target.value === '' ? '' : Number(e.target.value)); setHistoryPage(1); }}
              className="h-7 px-2 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none cursor-pointer text-slate-600"
            >
              <option value="">Ano</option>
              {historyYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>

            {/* Mais filtros toggle */}
            <button
              onClick={() => setHistoryFiltersExpanded(!historyFiltersExpanded)}
              className={`h-7 px-2.5 text-xs border rounded-lg font-medium transition flex items-center gap-1 ${
                historyFiltersExpanded || historyType || historyPriority || historyResponsible || historyClosedBy
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'border-[#e7e5df] text-slate-500 hover:bg-slate-50'
              }`}
            >
              <Filter className="w-3 h-3" />
              Filtros
              {(historyType || historyPriority || historyResponsible || historyClosedBy) && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
            </button>

            {/* Limpar */}
            {(historySearch || historyStatus || historyMonth !== '' || historyYear !== '' || historyType || historyPriority || historyResponsible || historyClosedBy) && (
              <button
                onClick={() => { setHistorySearch(''); setHistoryStatus(''); setHistoryMonth(''); setHistoryYear(''); setHistoryType(''); setHistoryPriority(''); setHistoryResponsible(''); setHistoryClosedBy(''); setHistoryPage(1); }}
                className="h-7 px-2 text-xs text-red-500 hover:text-red-700 transition"
              >
                Limpar
              </button>
            )}
          </div>
        </div>

        {/* Filtros extras */}
        {historyFiltersExpanded && (
          <div className="px-5 py-2 border-b border-slate-100 bg-slate-50/60 flex flex-wrap gap-2">
            <select value={historyType} onChange={(e) => { setHistoryType(e.target.value as DeadlineType | ''); setHistoryPage(1); }}
              className="h-7 px-2 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none cursor-pointer text-slate-600">
              <option value="">Tipo</option>
              <option value="processo">Processo</option>
              <option value="requerimento">Requerimento</option>
              <option value="geral">Geral</option>
            </select>
            <select value={historyPriority} onChange={(e) => { setHistoryPriority(e.target.value as DeadlinePriority | ''); setHistoryPage(1); }}
              className="h-7 px-2 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none cursor-pointer text-slate-600">
              <option value="">Prioridade</option>
              <option value="urgente">Urgente</option>
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>
            <select value={historyResponsible} onChange={(e) => { setHistoryResponsible(e.target.value); setHistoryPage(1); }}
              title="Responsável designado no cadastro do prazo"
              className="h-7 px-2 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none cursor-pointer text-slate-600">
              <option value="">Responsável</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select value={historyClosedBy} onChange={(e) => { setHistoryClosedBy(e.target.value); setHistoryPage(1); }}
              title="Quem efetivamente cumpriu ou cancelou o prazo"
              className="h-7 px-2 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none cursor-pointer text-slate-600">
              <option value="">Baixado por</option>
              {historyClosers.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
            </select>
          </div>
        )}

        {/* Tabela */}
        {filteredHistory.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-400">Nenhum prazo no histórico.</p>
          </div>
        ) : (
          <>
            {/* Header da tabela */}
            <div className="hidden @sm:grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-4 px-5 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <span>Prazo / Cliente</span>
              <span className="w-24 text-center">Situação</span>
              <span className="w-24 text-center">Vencimento</span>
              <span className="w-24 text-center">Encerrado em</span>
              <span className="w-28 text-center">Responsável</span>
              <span className="w-28 text-center">Baixado por</span>
              <span className="w-16 text-right">Ações</span>
            </div>

            <div className="divide-y divide-slate-100">
              {paginatedHistory.map((deadline) => {
                const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
                const responsibleItem = deadline.responsible_id ? memberMap.get(deadline.responsible_id) : null;
                const priorityDot: Record<string, string> = {
                  urgente: 'bg-red-500', alta: 'bg-orange-400', media: 'bg-amber-400', baixa: 'bg-slate-300',
                };
                const closure = closuresByDeadline.get(deadline.id);
                const foiExcluido = deadline.status === 'excluido';
                return (
                  <div key={deadline.id} className="grid grid-cols-1 @sm:grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-4 items-center px-5 py-3 hover:bg-slate-50/70 transition group">
                    {/* Prazo */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityDot[deadline.priority] || 'bg-slate-300'}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{deadline.title}</p>
                        {clientItem && <p className="text-xs text-slate-400 truncate">{clientItem.full_name}</p>}
                      </div>
                    </div>
                    {/* Situação */}
                    <div className="w-24 flex justify-center">
                      <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${HISTORY_STATUS_STYLE[deadline.status] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {HISTORY_STATUS_LABEL[deadline.status] || deadline.status}
                      </span>
                    </div>
                    {/* Vencimento */}
                    <div className="w-24 text-center">
                      <p className="text-xs text-slate-600 font-medium">{formatDate(deadline.due_date)}</p>
                    </div>
                    {/* Encerrado em */}
                    <div className="w-24 text-center">
                      <p className={`text-xs font-semibold ${deadline.status === 'cumprido' ? 'text-emerald-600' : 'text-slate-500'}`}>
                        {formatDate(getArchivedAt(deadline))}
                      </p>
                    </div>
                    {/* Responsável */}
                    <div className="w-28 text-center">
                      <p className="text-xs text-slate-500 truncate">{responsibleItem?.name || '—'}</p>
                    </div>
                    {/* Baixado por — do log de auditoria, não do cadastro */}
                    <div className="w-28 text-center">
                      {closure ? (
                        <p className="text-xs text-slate-600 truncate" title={`${closure.user_name || 'Usuário'} · ${formatDateTime(toIsoInstant(closure.created_at))}`}>
                          {shortPersonName(closure.user_name)}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-300">—</p>
                      )}
                    </div>
                    {/* Ações */}
                    <div className="w-16 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => handleViewDeadline(deadline)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition" title="Ver">
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {/* Mesmo botão, dois nomes: reabrir um cumprido e restaurar
                          um excluído são a mesma ideia — o prazo volta a valer. */}
                      <button
                        onClick={() => (foiExcluido ? void handleRestoreDeadline(deadline.id) : handleStatusChange(deadline.id, 'pendente'))}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition"
                        title={foiExcluido ? 'Restaurar' : 'Reabrir'}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Paginação */}
            {historyTotalPages > 1 && (
              <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/40">
                <p className="text-xs text-slate-400">
                  {(historyPage - 1) * HISTORY_PAGE_SIZE + 1}–{Math.min(historyPage * HISTORY_PAGE_SIZE, filteredHistory.length)} de {filteredHistory.length}
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} disabled={historyPage === 1}
                    className="h-7 px-3 text-xs font-medium bg-[#f8f7f5] border border-[#e7e5df] rounded-lg hover:bg-slate-50 disabled:opacity-40 transition">
                    Anterior
                  </button>
                  <span className="text-xs text-slate-500 px-2">{historyPage} / {historyTotalPages}</span>
                  <button onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))} disabled={historyPage === historyTotalPages}
                    className="h-7 px-3 text-xs font-medium bg-[#f8f7f5] border border-[#e7e5df] rounded-lg hover:bg-slate-50 disabled:opacity-40 transition">
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DeadlinesModule;
