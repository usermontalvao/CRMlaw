import React, { useEffect, useMemo, useState } from 'react';
import {
  FileText, FileCheck, Plus, Clock, FolderPlus,
  Gavel, Loader2, PenTool, Trash2, DollarSign, AlertTriangle,
  Scale, ExternalLink, Search, Printer, CalendarPlus, StickyNote,
  User, Mail, Phone, Calendar as CalendarIcon, ChevronRight, Building2, MessageCircle, Sparkles, Check,
  Star, X, Image as ImageIcon, MapPin, AlarmClock, ClipboardList, UserCheck, UserX,
} from 'lucide-react';
import { events, SYSTEM_EVENTS } from '../utils/events';
import { useNavigation } from '../contexts/NavigationContext';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';
import type { Requirement } from '../types/requirement.types';
import type { SignatureRequestWithSigners } from '../types/signature.types';
import type { Agreement, Installment, PaymentMethod } from '../types/financial.types';
import type { Deadline } from '../types/deadline.types';
import type { CalendarEvent } from '../types/calendar.types';
import { supabase } from '../config/supabase';
import { DocumentRequestsAdmin } from './DocumentRequestsAdmin';
import { signatureService } from '../services/signature.service';
import { clientService } from '../services/client.service';
import { pdfSignatureService } from '../services/pdfSignature.service';
import { petitionEditorService } from '../services/petitionEditor.service';
import { cloudService } from '../services/cloud.service';
import { deadlineService } from '../services/deadline.service';
import { financialService } from '../services/financial.service';
import { calendarService } from '../services/calendar.service';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import type { SavedPetition } from '../types/petitionEditor.types';
import type { CloudFolder } from '../types/cloud.types';

type Tab = 'data' | 'processes' | 'financial' | 'deadlines' | 'requirements' | 'documents' | 'assinaturas' | 'overview' | 'agenda';

interface ClientDetailsProps {
  client: Client;
  processes: Process[];
  requirements: Requirement[];
  relationsLoading?: boolean;
  onBack: () => void;
  onEdit: () => void;
  onCreateProcess?: () => void;
  onCreateRequirement?: () => void;
  onCreateDeadline?: () => void;
  missingFields?: string[];
  isOutdated?: boolean;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

const formatCpf = (v: string) => {
  const n = v.replace(/\D/g, '').slice(0, 11);
  if (n.length <= 3) return n;
  if (n.length <= 6) return `${n.slice(0, 3)}.${n.slice(3)}`;
  if (n.length <= 9) return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6)}`;
  return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9, 11)}`;
};

const formatCnpj = (v: string) => {
  const n = v.replace(/\D/g, '').slice(0, 14);
  if (n.length <= 2) return n;
  if (n.length <= 5) return `${n.slice(0, 2)}.${n.slice(2)}`;
  if (n.length <= 8) return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5)}`;
  if (n.length <= 12) return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8)}`;
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12, 14)}`;
};

const formatPhone = (v: string) => {
  const n = v.replace(/\D/g, '').slice(0, 11);
  if (n.length <= 2) return n;
  if (n.length <= 7) return `(${n.slice(0, 2)}) ${n.slice(2)}`;
  if (n.length <= 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return `(${n.slice(0, 2)}) ${n.slice(2, 3)} ${n.slice(3, 7)}-${n.slice(7, 11)}`;
};

const formatDate = (d?: string | null) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
};

const formatDateTime = (d?: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  return `${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

// ─── Label maps ──────────────────────────────────────────────────────────────

const PROCESS_STATUS_LABEL: Record<string, string> = {
  nao_protocolado: 'Não Protocolado',
  distribuido: 'Distribuído',
  aguardando_confeccao: 'Aguardando Confecção',
  citacao: 'Citação',
  conciliacao: 'Conciliação',
  contestacao: 'Contestação',
  instrucao: 'Instrução',
  andamento: 'Em Andamento',
  sentenca: 'Sentença',
  recurso: 'Recurso',
  cumprimento: 'Cumprimento',
  arquivado: 'Arquivado',
};

const PROCESS_STATUS_COLOR: Record<string, string> = {
  nao_protocolado: 'bg-slate-100 text-slate-600',
  distribuido: 'bg-blue-100 text-blue-700',
  aguardando_confeccao: 'bg-amber-100 text-amber-700',
  citacao: 'bg-orange-100 text-orange-700',
  conciliacao: 'bg-teal-100 text-teal-700',
  contestacao: 'bg-rose-100 text-rose-700',
  instrucao: 'bg-purple-100 text-purple-700',
  andamento: 'bg-sky-100 text-sky-700',
  sentenca: 'bg-indigo-100 text-indigo-700',
  recurso: 'bg-pink-100 text-pink-700',
  cumprimento: 'bg-lime-100 text-lime-700',
  arquivado: 'bg-slate-100 text-slate-500',
};

const PRACTICE_AREA_LABEL: Record<string, string> = {
  trabalhista: 'Trabalhista',
  familia: 'Família',
  consumidor: 'Consumidor',
  previdenciario: 'Previdenciário',
  civel: 'Cível',
};

const PRIORITY_COLOR: Record<string, string> = {
  high: 'bg-rose-100 text-rose-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-100 text-slate-600',
};

const PRIORITY_LABEL: Record<string, string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

const AGREEMENT_STATUS_COLOR: Record<string, string> = {
  pendente: 'bg-amber-100 text-amber-700',
  ativo: 'bg-emerald-100 text-emerald-700',
  concluido: 'bg-blue-100 text-blue-700',
  cancelado: 'bg-slate-100 text-slate-500',
};

const AGREEMENT_STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  ativo: 'Ativo',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

const INSTALLMENT_STATUS_COLOR: Record<string, string> = {
  pendente: 'bg-amber-100 text-amber-700',
  pago: 'bg-emerald-100 text-emerald-700',
  vencido: 'bg-rose-100 text-rose-700',
  cancelado: 'bg-slate-100 text-slate-500',
};

// ─── Structured timeline ──────────────────────────────────────────────────────

interface TLeaf {
  id: string;
  date: string;
  label: string;
  title: string;
  actor?: string;
  future?: boolean;
  badgeBg: string;
  badgeText: string;
  dot: string;
  entityId?: string;       // ID real para navegação
  module?: string;         // módulo destino
  navParams?: Record<string, unknown>;
}

interface TRoot {
  id: string;
  type: 'process' | 'requirement' | 'general';
  date: string;
  title: string;
  subtitle?: string;
  statusLabel?: string;
  statusColor?: string;
  actor?: string;
  leaves: TLeaf[];
  entityId?: string;       // ID real para navegação
  module?: string;
}

const REQ_STATUS_LABEL: Record<string, string> = {
  aguardando_confeccao: 'Aguardando Confecção',
  em_analise:           'Em Análise',
  em_exigencia:         'Em Exigência',
  aguardando_pericia:   'Aguardando Perícia',
  deferido:             'Deferido',
  indeferido:           'Indeferido',
  ajuizado:             'Ajuizado',
};

const REQ_STATUS_COLOR: Record<string, string> = {
  aguardando_confeccao: 'bg-slate-100 text-slate-600',
  em_analise:           'bg-blue-100 text-blue-700',
  em_exigencia:         'bg-amber-100 text-amber-700',
  aguardando_pericia:   'bg-violet-100 text-violet-700',
  deferido:             'bg-emerald-100 text-emerald-700',
  indeferido:           'bg-rose-100 text-rose-700',
  ajuizado:             'bg-orange-100 text-orange-700',
};

const BENEFIT_LABEL: Record<string, string> = {
  bpc_loas: 'BPC/LOAS', bpc_loas_deficiencia: 'BPC Deficiência', bpc_loas_idoso: 'BPC Idoso',
  aposentadoria_tempo: 'Aposent. por Tempo', aposentadoria_idade: 'Aposent. por Idade',
  aposentadoria_invalidez: 'Aposent. por Invalidez', auxilio_acidente: 'Auxílio-Acidente',
  auxilio_doenca: 'Auxílio-Doença', pensao_morte: 'Pensão por Morte',
  salario_maternidade: 'Salário-Maternidade', outro: 'Outro',
};

const CAL_TYPE_LABEL: Record<string, string> = {
  hearing: 'Audiência', pericia: 'Perícia', meeting: 'Reunião',
  deadline: 'Prazo', requirement: 'Requerimento', payment: 'Pagamento',
};

function buildStructuredTimeline(
  processes: Process[],
  requirements: import('../types/requirement.types').Requirement[],
  agreements: Agreement[],
  signatures: SignatureRequestWithSigners[],
  petitions: SavedPetition[],
  calEvents: CalendarEvent[],
): TRoot[] {
  const now = new Date();
  const roots: TRoot[] = [];

  // ── Processos ──────────────────────────────────────────────────────────────
  processes.forEach((p) => {
    const leaves: TLeaf[] = [];

    // Audiência vinculada ao processo
    if (p.hearing_date) {
      const isFuture = new Date(p.hearing_date) >= now;
      leaves.push({
        id: `hearing-${p.id}`,
        date: p.hearing_date,
        label: 'Audiência',
        title: [p.hearing_mode === 'online' ? 'Online' : p.hearing_mode === 'presencial' ? 'Presencial' : null, p.hearing_time ? p.hearing_time.slice(0,5) : null].filter(Boolean).join(' · ') || 'Audiência agendada',
        actor: p.responsible_lawyer ?? undefined,
        future: isFuture,
        badgeBg: 'bg-violet-100', badgeText: 'text-violet-700', dot: isFuture ? 'bg-violet-500' : 'bg-violet-300',
        entityId: p.id, module: 'processos',
      });
    }

    // Petições vinculadas ao processo
    petitions.filter((pet) => pet.process_id === p.id).forEach((pet) => {
      leaves.push({
        id: `petition-${pet.id}`,
        date: pet.created_at,
        label: 'Petição',
        title: pet.title ?? 'Sem título',
        badgeBg: 'bg-amber-100', badgeText: 'text-amber-700', dot: 'bg-amber-400',
        entityId: pet.id, module: 'peticoes',
      });
    });

    // Assinaturas vinculadas ao processo
    signatures.filter((s) => s.process_id === p.id).forEach((s) => {
      const signerName = (s.signers ?? [])[0]?.name ?? undefined;
      leaves.push({
        id: `sig-${s.id}`,
        date: s.created_at,
        label: 'Documento',
        title: s.document_name ?? 'Documento',
        actor: signerName,
        badgeBg: 'bg-slate-100', badgeText: 'text-slate-600', dot: 'bg-slate-400',
        entityId: s.id, module: 'assinaturas',
      });
      if (s.signed_at) {
        leaves.push({
          id: `sig-signed-${s.id}`,
          date: s.signed_at,
          label: 'Assinatura',
          title: s.document_name ?? 'Documento',
          actor: signerName,
          badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-700', dot: 'bg-emerald-500',
          entityId: s.id, module: 'assinaturas',
        });
      }
    });

    // Eventos de agenda vinculados ao processo
    calEvents.filter((e) => e.process_id === p.id).forEach((e) => {
      const isFuture = new Date(e.start_at) >= now;
      leaves.push({
        id: `cal-${e.id}`,
        date: e.start_at,
        label: CAL_TYPE_LABEL[e.event_type] ?? 'Agenda',
        title: e.title,
        future: isFuture,
        badgeBg: 'bg-violet-100', badgeText: 'text-violet-700', dot: 'bg-violet-400',
        entityId: e.id, module: 'agenda',
      });
    });

    leaves.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    roots.push({
      id: `process-${p.id}`,
      type: 'process',
      date: p.created_at,
      title: p.process_code || 'Processo',
      subtitle: [PRACTICE_AREA_LABEL[p.practice_area] ?? p.practice_area, p.court].filter(Boolean).join(' · ') || undefined,
      statusLabel: PROCESS_STATUS_LABEL[p.status],
      statusColor: PROCESS_STATUS_COLOR[p.status],
      actor: p.responsible_lawyer ?? undefined,
      leaves,
      entityId: p.id, module: 'processos',
    });
  });

  // ── Requerimentos ──────────────────────────────────────────────────────────
  requirements.forEach((r) => {
    const leaves: TLeaf[] = [];

    // Assinaturas vinculadas ao requerimento
    signatures.filter((s) => s.requirement_id === r.id).forEach((s) => {
      const signerName = (s.signers ?? [])[0]?.name ?? undefined;
      leaves.push({
        id: `sig-r-${s.id}`,
        date: s.created_at,
        label: 'Documento',
        title: s.document_name ?? 'Documento',
        actor: signerName,
        badgeBg: 'bg-slate-100', badgeText: 'text-slate-600', dot: 'bg-slate-400',
        entityId: s.id, module: 'assinaturas',
      });
      if (s.signed_at) {
        leaves.push({
          id: `sig-r-signed-${s.id}`,
          date: s.signed_at,
          label: 'Assinatura',
          title: s.document_name ?? 'Documento',
          actor: signerName,
          badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-700', dot: 'bg-emerald-500',
          entityId: s.id, module: 'assinaturas',
        });
      }
    });

    // Eventos de agenda vinculados ao requerimento
    calEvents.filter((e) => e.requirement_id === r.id).forEach((e) => {
      const isFuture = new Date(e.start_at) >= now;
      leaves.push({
        id: `cal-r-${e.id}`,
        date: e.start_at,
        label: CAL_TYPE_LABEL[e.event_type] ?? 'Agenda',
        title: e.title,
        future: isFuture,
        badgeBg: 'bg-violet-100', badgeText: 'text-violet-700', dot: 'bg-violet-400',
        entityId: e.id, module: 'agenda',
      });
    });

    leaves.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    roots.push({
      id: `req-${r.id}`,
      type: 'requirement',
      date: r.created_at,
      title: r.protocol ? `Protocolo ${r.protocol}` : 'Requerimento',
      subtitle: BENEFIT_LABEL[r.benefit_type] ?? r.benefit_type,
      statusLabel: REQ_STATUS_LABEL[r.status],
      statusColor: REQ_STATUS_COLOR[r.status],
      leaves,
      entityId: r.id, module: 'requerimentos',
    });
  });

  // ── Itens sem vínculo (acordos, petições/assinaturas/agenda soltas) ────────
  const linkedSigIds = new Set([
    ...signatures.filter((s) => s.process_id || s.requirement_id).map((s) => s.id),
  ]);
  const linkedPetIds = new Set(petitions.filter((p) => p.process_id).map((p) => p.id));
  const linkedCalIds = new Set(calEvents.filter((e) => e.process_id || e.requirement_id).map((e) => e.id));

  const generalLeaves: TLeaf[] = [];

  agreements.forEach((a) => {
    generalLeaves.push({
      id: `agreement-${a.id}`,
      date: a.created_at,
      label: 'Financeiro',
      title: `${a.title} · ${formatCurrency(a.total_value)}`,
      badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-700', dot: 'bg-emerald-500',
      entityId: a.id, module: 'financeiro',
    });
  });

  petitions.filter((p) => !linkedPetIds.has(p.id)).forEach((p) => {
    generalLeaves.push({
      id: `petition-${p.id}`,
      date: p.created_at,
      label: 'Petição',
      title: p.title ?? 'Sem título',
      badgeBg: 'bg-amber-100', badgeText: 'text-amber-700', dot: 'bg-amber-400',
      entityId: p.id, module: 'peticoes',
    });
  });

  signatures.filter((s) => !linkedSigIds.has(s.id)).forEach((s) => {
    const signerName = (s.signers ?? [])[0]?.name ?? undefined;
    generalLeaves.push({
      id: `sig-${s.id}`,
      date: s.created_at,
      label: 'Documento',
      title: s.document_name ?? 'Documento',
      actor: signerName,
      badgeBg: 'bg-slate-100', badgeText: 'text-slate-600', dot: 'bg-slate-400',
      entityId: s.id, module: 'assinaturas',
    });
    if (s.signed_at) {
      generalLeaves.push({
        id: `sig-signed-${s.id}`,
        date: s.signed_at,
        label: 'Assinatura',
        title: s.document_name ?? 'Documento',
        actor: signerName,
        badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-700', dot: 'bg-emerald-500',
        entityId: s.id, module: 'assinaturas',
      });
    }
  });

  calEvents.filter((e) => !linkedCalIds.has(e.id)).forEach((e) => {
    const isFuture = new Date(e.start_at) >= now;
    generalLeaves.push({
      id: `cal-${e.id}`,
      date: e.start_at,
      label: CAL_TYPE_LABEL[e.event_type] ?? 'Agenda',
      title: e.title,
      future: isFuture,
      badgeBg: 'bg-violet-100', badgeText: 'text-violet-700', dot: 'bg-violet-400',
      entityId: e.id, module: 'agenda',
    });
  });

  if (generalLeaves.length > 0) {
    generalLeaves.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    roots.push({
      id: 'general',
      type: 'general',
      date: generalLeaves[0].date,
      title: 'Atividades Gerais',
      subtitle: 'Petições, documentos e eventos sem processo vinculado',
      leaves: generalLeaves,
    });
  }

  // Ordenar raízes pela data mais recente (raiz ou folha mais nova)
  roots.sort((a, b) => {
    const aDate = a.leaves[0] ? Math.max(new Date(a.date).getTime(), new Date(a.leaves[0].date).getTime()) : new Date(a.date).getTime();
    const bDate = b.leaves[0] ? Math.max(new Date(b.date).getTime(), new Date(b.leaves[0].date).getTime()) : new Date(b.date).getTime();
    return bDate - aDate;
  });

  return roots;
}

// compat: keep old buildTimeline for useMemo (unused after refactor)
function buildTimeline() { return []; }

// ─── Sub-components ───────────────────────────────────────────────────────────

const KpiCard = ({
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  color: string;
  icon: React.ElementType;
}) => (
  <div className={`rounded-2xl border p-4 flex flex-col gap-1 ${color}`}>
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-semibold tracking-[0.18em] uppercase opacity-70">{label}</span>
      <Icon className="w-4 h-4 opacity-60" />
    </div>
    <p className="text-2xl font-bold">{value}</p>
    {sub && <p className="text-[11px] opacity-70">{sub}</p>}
  </div>
);

const SectionEmpty = ({ text }: { text: string }) => (
  <p className="text-slate-400 text-sm py-4 text-center">{text}</p>
);

const ModuleItem = ({
  children,
  onOpen,
  badge,
  urgent,
  muted,
}: {
  children: React.ReactNode;
  onOpen: () => void;
  badge?: { label: string; color: string };
  urgent?: boolean;
  muted?: boolean;
}) => (
  <div className={`rounded-xl border p-4 flex items-start justify-between gap-3 transition group ${
    urgent ? 'border-rose-200 bg-rose-50' : muted ? 'border-slate-100 bg-slate-50 opacity-70' : 'border-slate-200 bg-white hover:border-orange-200 hover:bg-orange-50/30'
  }`}>
    <div className="min-w-0 flex-1">{children}</div>
    <div className="flex items-center gap-2 flex-shrink-0">
      {badge && (
        <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${badge.color}`}>{badge.label}</span>
      )}
      <button
        onClick={onOpen}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-orange-600 hover:bg-orange-50 border border-transparent hover:border-orange-200 transition opacity-60 group-hover:opacity-100"
        title="Abrir no módulo"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Abrir</span>
      </button>
    </div>
  </div>
);

const InfoItem = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <div>
    <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-slate-400">{label}</p>
    <p className="text-sm font-semibold text-slate-900 mt-0.5">{value ?? 'Não informado'}</p>
  </div>
);

const MiniField = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <div>
    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">{label}</p>
    <p className="text-xs font-medium text-slate-800">{value ?? <span className="text-slate-400">—</span>}</p>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

const ClientDetails: React.FC<ClientDetailsProps> = ({
  client,
  processes,
  requirements,
  relationsLoading,
  onBack,
  onEdit,
  onCreateProcess,
  onCreateRequirement,
  onCreateDeadline,
  missingFields = [],
  isOutdated = false,
}) => {
  const { confirmDelete } = useDeleteConfirm();
  const { navigateTo } = useNavigation();
  const [activeTab, setActiveTab] = useState<Tab>('data');
  const [historySearch, setHistorySearch] = useState('');

  // ── Signatures
  const [signatureRequests, setSignatureRequests] = useState<SignatureRequestWithSigners[]>([]);
  const [signatureLoading, setSignatureLoading] = useState(false);

  // ── Selfies from facial signatures
  interface SelfieEntry { path: string; url: string; label: string; }
  const [selfies, setSelfies] = useState<SelfieEntry[]>([]);
  const [pinnedPath, setPinnedPath] = useState<string | null>(client.photo_path ?? null);
  const [previewSelfie, setPreviewSelfie] = useState<SelfieEntry | null>(null);
  const [selfiePickerOpen, setSelfiePickerOpen] = useState(false);
  const [settingPhoto, setSettingPhoto] = useState(false);
  const [syncingSignatureData, setSyncingSignatureData] = useState(false);
  const [signatureSyncDismissed, setSignatureSyncDismissed] = useState(false);
  const [, forceRefresh] = useState(0);

  // ── Petitions
  const [clientPetitions, setClientPetitions] = useState<SavedPetition[]>([]);
  const [petitionsLoading, setPetitionsLoading] = useState(false);

  // ── Cloud
  const [clientCloudFolders, setClientCloudFolders] = useState<CloudFolder[]>([]);
  const [cloudFoldersLoading, setCloudFoldersLoading] = useState(false);

  // ── Deadlines
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [deadlinesLoading, setDeadlinesLoading] = useState(false);

  // ── Calendar events (bruto = todos; filtrado por client/process/requirement via useMemo)
  const [allCalendarEvents, setAllCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // ── Financial
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [installmentsMap, setInstallmentsMap] = useState<Record<string, Installment[]>>({});
  const [installmentsLoading, setInstallmentsLoading] = useState(false);
  const [installmentsLoaded, setInstallmentsLoaded] = useState(false);

  // ── Profile update requests (portal)
  interface ProfileReq { id: string; changes: Record<string, string>; status: string; rejection_reason?: string | null; requested_at: string; }
  const [profileReqs, setProfileReqs] = useState<ProfileReq[]>([]);
  const [profileReqLoading, setProfileReqLoading] = useState(false);
  const [profileReqProcessing, setProfileReqProcessing] = useState<string | null>(null);
  const [rejectInputId, setRejectInputId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // ── Pay installment (dar baixa)
  const [payingInstallmentId, setPayingInstallmentId] = useState<string | null>(null);
  const [payForm, setPayForm] = useState<{ date: string; method: PaymentMethod; value: number }>({
    date: new Date().toISOString().split('T')[0],
    method: 'pix',
    value: 0,
  });
  const [paySubmitting, setPaySubmitting] = useState(false);

  // ── Load all data on mount
  useEffect(() => {
    let active = true;

    const loadSignatures = async () => {
      setSignatureLoading(true);
      try {
        const r = await signatureService.listRequestsWithSigners({ client_id: client.id });
        if (!active) return;
        setSignatureRequests(r);

        // Collect ALL unique facial image paths across signed requests + signers
        const seen = new Set<string>();
        const entries: Array<{ path: string; label: string }> = [];

        const signedRequests = [...r]
          .filter((req) => req.status === 'signed')
          .sort((a, b) => new Date(b.signed_at || b.updated_at).getTime() - new Date(a.signed_at || a.updated_at).getTime());

        for (const req of signedRequests) {
          const dateLabel = req.signed_at
            ? new Date(req.signed_at).toLocaleDateString('pt-BR')
            : req.document_name || 'Documento';

          // Signer-level photos first
          for (const signer of req.signers ?? []) {
            if (signer.facial_image_path && signer.status === 'signed' && !seen.has(signer.facial_image_path)) {
              seen.add(signer.facial_image_path);
              entries.push({ path: signer.facial_image_path, label: `${signer.name || 'Signatário'} · ${dateLabel}` });
            }
          }
          // Request-level fallback
          if (req.facial_image_path && !seen.has(req.facial_image_path)) {
            seen.add(req.facial_image_path);
            entries.push({ path: req.facial_image_path, label: `${req.document_name || 'Documento'} · ${dateLabel}` });
          }
        }

        if (entries.length === 0) return;

        // Generate signed URLs for all
        const withUrls = await Promise.all(
          entries.map(async (e) => {
            try {
              const url = await signatureService.getSignedImageUrl(e.path, 3600);
              return { ...e, url };
            } catch { return null; }
          })
        );
        const excludedSet = new Set<string>(
          Array.isArray((client as any).excluded_photo_paths) ? (client as any).excluded_photo_paths : [],
        );
        const valid = (withUrls.filter(Boolean) as Array<{ path: string; url: string; label: string }>)
          .filter((e) => !excludedSet.has(e.path));
        if (!active || valid.length === 0) return;

        setSelfies(valid);
        // Respect already-pinned photo; if none, default to first (most recent)
        if (!client.photo_path) setPinnedPath(null);
      } catch { if (active) setSignatureRequests([]); }
      finally { if (active) setSignatureLoading(false); }
    };

    const loadPetitions = async () => {
      setPetitionsLoading(true);
      try {
        const all = await petitionEditorService.listPetitions();
        if (active) setClientPetitions(all.filter((p) => p.client_id === client.id));
      } catch { if (active) setClientPetitions([]); }
      finally { if (active) setPetitionsLoading(false); }
    };

    const loadCloud = async () => {
      setCloudFoldersLoading(true);
      try {
        const f = await cloudService.listClientRootFolders(client.id, true);
        if (active) setClientCloudFolders(f);
      } catch { if (active) setClientCloudFolders([]); }
      finally { if (active) setCloudFoldersLoading(false); }
    };

    const loadDeadlines = async () => {
      setDeadlinesLoading(true);
      try {
        const d = await deadlineService.listDeadlines({ client_id: client.id });
        if (active) setDeadlines(d);
      } catch { if (active) setDeadlines([]); }
      finally { if (active) setDeadlinesLoading(false); }
    };

    const loadCalendar = async () => {
      setCalendarLoading(true);
      try {
        const all = await calendarService.listEvents();
        if (active) setAllCalendarEvents(all);
      } catch { if (active) setAllCalendarEvents([]); }
      finally { if (active) setCalendarLoading(false); }
    };

    const loadFinancial = async () => {
      setFinancialLoading(true);
      try {
        const a = await financialService.listAgreements({ client_id: client.id });
        if (active) setAgreements(a);
      } catch { if (active) setAgreements([]); }
      finally { if (active) setFinancialLoading(false); }
    };

    const loadProfileReqs = async () => {
      setProfileReqLoading(true);
      try {
        const { data } = await supabase.rpc('admin_list_profile_update_requests', { p_client_id: client.id, p_status: null });
        if (active) setProfileReqs(Array.isArray(data) ? data : []);
      } catch { /* silent */ }
      finally { if (active) setProfileReqLoading(false); }
    };

    void Promise.all([loadSignatures(), loadPetitions(), loadCloud(), loadDeadlines(), loadFinancial(), loadCalendar(), loadProfileReqs()]);
    return () => { active = false; };
  }, [client.id]);

  // ── Load installments lazily when Financial tab is opened
  useEffect(() => {
    if (activeTab !== 'financial' || installmentsLoaded || agreements.length === 0) return;
    let active = true;
    setInstallmentsLoading(true);
    Promise.all(agreements.map((a) => financialService.listInstallments(a.id).then((inst) => ({ id: a.id, inst }))))
      .then((results) => {
        if (!active) return;
        const map: Record<string, Installment[]> = {};
        results.forEach(({ id, inst }) => { map[id] = inst; });
        setInstallmentsMap(map);
        setInstallmentsLoaded(true);
      })
      .catch(() => { if (active) setInstallmentsLoaded(true); })
      .finally(() => { if (active) setInstallmentsLoading(false); });
    return () => { active = false; };
  }, [activeTab, agreements, installmentsLoaded]);

  // ── Derived data
  const pendingDeadlines = useMemo(
    () => deadlines.filter((d) => d.status === 'pendente'),
    [deadlines],
  );
  const overdueDeadlines = useMemo(
    () => deadlines.filter((d) => d.status === 'vencido'),
    [deadlines],
  );
  const upcomingDeadlines = useMemo(() => {
    const now = new Date();
    return pendingDeadlines
      .filter((d) => new Date(d.due_date) >= now)
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  }, [pendingDeadlines]);

  const activeProcesses = useMemo(
    () => processes,
    [processes],
  );

  const activeRequirements = useMemo(
    () => requirements,
    [requirements],
  );

  const handleApproveProfileReq = async (id: string) => {
    setProfileReqProcessing(id);
    try {
      await supabase.rpc('admin_approve_profile_update', { p_request_id: id });
      const { data } = await supabase.rpc('admin_list_profile_update_requests', { p_client_id: client.id, p_status: null });
      setProfileReqs(Array.isArray(data) ? data : []);
      events.emit(SYSTEM_EVENTS.CLIENT_UPDATED, { id: client.id });
    } catch { /* silent */ }
    finally { setProfileReqProcessing(null); }
  };

  const handleRejectProfileReq = async (id: string) => {
    setProfileReqProcessing(id);
    try {
      await supabase.rpc('admin_reject_profile_update', { p_request_id: id, p_reason: rejectReason || 'Solicitação não aprovada.' });
      const { data } = await supabase.rpc('admin_list_profile_update_requests', { p_client_id: client.id, p_status: null });
      setProfileReqs(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setProfileReqProcessing(null); setRejectInputId(null); setRejectReason(''); }
  };

  // Eventos da agenda vinculados a este cliente (por client_id, process_id ou requirement_id)
  const calendarEvents = useMemo(() => {
    const processIds = new Set(processes.map((p) => p.id));
    const reqIds = new Set(requirements.map((r) => r.id));
    return allCalendarEvents.filter(
      (e) =>
        e.client_id === client.id ||
        (e.process_id != null && processIds.has(e.process_id)) ||
        (e.requirement_id != null && reqIds.has(e.requirement_id)),
    );
  }, [allCalendarEvents, client.id, processes, requirements]);

  const EVENT_TYPE_LABEL: Record<string, string> = { hearing: 'Audiência', pericia: 'Perícia', meeting: 'Reunião', deadline: 'Prazo', requirement: 'Requerimento', payment: 'Pagamento' };

  // Próximo compromisso (audiência ou perícia)
  const nextHearing = useMemo(() => {
    const now = new Date();
    const fromCalendar = calendarEvents
      .filter((e) => e.status === 'pendente' && e.event_type !== 'payment' && new Date(e.start_at) >= now)
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())[0];
    if (fromCalendar) {
      const d = new Date(fromCalendar.start_at);
      const isExactMidnight = d.getHours() === 0 && d.getMinutes() === 0;
      const timeStr = !isNaN(d.getTime()) && fromCalendar.start_at.includes('T') && !isExactMidnight
        ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : null;
      return { date: fromCalendar.start_at, label: EVENT_TYPE_LABEL[fromCalendar.event_type] ?? 'Compromisso', time: timeStr, type: 'calendar' as const, id: fromCalendar.id };
    }
    const fromProcess = processes
      .filter((p) => p.hearing_date && new Date(p.hearing_date) >= now)
      .sort((a, b) => new Date(a.hearing_date!).getTime() - new Date(b.hearing_date!).getTime())[0];
    if (fromProcess) {
      const timeStr = (fromProcess as any).hearing_time
        ? String((fromProcess as any).hearing_time).slice(0, 5)
        : null;
      return { date: fromProcess.hearing_date!, label: 'Audiência', time: timeStr, type: 'process' as const, id: fromProcess.id };
    }
    return null;
  }, [calendarEvents, processes]);

  // Compromissos futuros agrupados (sem eventos de pagamento — esses são financeiros)
  const upcomingEvents = useMemo(() => {
    const now = new Date();
    return calendarEvents
      .filter((e) => e.status === 'pendente' && new Date(e.start_at) >= now && e.event_type !== 'payment')
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  }, [calendarEvents]);

  // Receita = honorários efetivamente recebidos (paid_value × feeRatio das parcelas pagas)
  const totalRevenue = useMemo(() => {
    let sum = 0;
    agreements.forEach((agreement) => {
      const insts = installmentsMap[agreement.id] || [];
      insts.filter((i) => i.status === 'pago').forEach((inst) => {
        const paid = inst.paid_value ?? inst.value ?? 0;
        const feeRatio =
          agreement.total_value > 0 && agreement.fee_value > 0
            ? agreement.fee_value / agreement.total_value
            : 1;
        sum += paid * feeRatio;
      });
    });
    return sum;
  }, [agreements, installmentsMap]);

  const paidAmount = useMemo(() => {
    let sum = 0;
    Object.values(installmentsMap).forEach((insts) => {
      insts.filter((i) => i.status === 'pago').forEach((i) => { sum += i.paid_value ?? i.value; });
    });
    return sum;
  }, [installmentsMap]);

  const overdueAmount = useMemo(() => {
    let sum = 0;
    Object.values(installmentsMap).forEach((insts) => {
      insts.filter((i) => i.status === 'vencido').forEach((i) => { sum += i.value; });
    });
    return sum;
  }, [installmentsMap]);

  const signedDocuments = useMemo(
    () => signatureRequests.filter((r) => r.status === 'signed' || Boolean(r.signed_at) || (r.signers ?? []).some((s) => s.signed_document_path)),
    [signatureRequests],
  );

  const generatedDocuments = useMemo(() => {
    const signedIds = new Set(signedDocuments.map((r) => r.id));
    return signatureRequests.filter((r) => !signedIds.has(r.id));
  }, [signatureRequests, signedDocuments]);

  const structuredTimeline = useMemo(
    () => buildStructuredTimeline(processes, requirements, agreements, signatureRequests, clientPetitions, calendarEvents),
    [processes, requirements, agreements, signatureRequests, clientPetitions, calendarEvents],
  );

  // ── Navigate from timeline items
  const handleTimelineNavigate = (module?: string, entityId?: string) => {
    if (!module || !entityId) return;
    if (module === 'processos') {
      events.emit(SYSTEM_EVENTS.NAVIGATE_REQUEST, { module: 'processos', params: { entityId } });
    } else if (module === 'requerimentos') {
      navigateTo('requerimentos', { entityId } as any);
    } else if (module === 'assinaturas') {
      events.emit(SYSTEM_EVENTS.NAVIGATE_REQUEST, { module: 'assinaturas', params: { mode: 'details', requestId: entityId } });
    } else if (module === 'agenda') {
      navigateTo('agenda', { entityId } as any);
    } else if (module === 'financeiro') {
      navigateTo('financeiro', { entityId } as any);
    } else if (module === 'peticoes') {
      events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN, { entityId });
    }
  };

  // ── Dar baixa em parcela
  const handlePayInstallment = async (installment: Installment) => {
    setPaySubmitting(true);
    try {
      const updated = await financialService.payInstallment(installment.id, {
        payment_date: payForm.date,
        payment_method: payForm.method,
        paid_value: payForm.value,
      });
      setInstallmentsMap((prev) => ({
        ...prev,
        [installment.agreement_id]: (prev[installment.agreement_id] ?? []).map((i) =>
          i.id === installment.id ? updated : i,
        ),
      }));
      setPayingInstallmentId(null);
    } catch (err) {
      console.error('Erro ao dar baixa:', err);
    } finally {
      setPaySubmitting(false);
    }
  };

  // ── Export (clean print window)
  const handleExport = async () => {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;

    const rawDoc = client.cpf_cnpj || '';
    const docLabel = client.client_type === 'pessoa_fisica' ? 'CPF' : 'CNPJ';
    const docFormatted = client.client_type === 'pessoa_fisica' ? formatCpf(rawDoc) : formatCnpj(rawDoc);
    const phone = client.phone || client.mobile || '';
    const now = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    // Foto de perfil para o PDF — converte para base64 para garantir impressão offline
    const profileSelfie = (pinnedPath ? selfies.find((s) => s.path === pinnedPath) : null) ?? selfies[0] ?? null;
    let photoBase64 = '';
    if (profileSelfie?.url) {
      try {
        const resp = await fetch(profileSelfie.url);
        const blob = await resp.blob();
        photoBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch { /* foto opcional — ignora se falhar */ }
    }

    const processRows = processes.map((p) => `
      <tr>
        <td>${p.process_code || '—'}</td>
        <td>${PRACTICE_AREA_LABEL[p.practice_area] ?? p.practice_area}</td>
        <td>${PROCESS_STATUS_LABEL[p.status] ?? p.status}</td>
        <td>${p.court || '—'}</td>
        <td>${p.hearing_date ? formatDate(p.hearing_date) : '—'}</td>
      </tr>`).join('');

    const deadlineRows = deadlines.filter((d) => d.status !== 'cancelado').map((d) => {
      const statusColor = d.status === 'vencido' ? '#dc2626' : d.status === 'cumprido' ? '#16a34a' : '#d97706';
      return `<tr>
        <td>${d.title}</td>
        <td>${formatDate(d.due_date)}</td>
        <td style="color:${statusColor};font-weight:600">${d.status}</td>
        <td>${d.priority}</td>
      </tr>`;
    }).join('');

    const reqRows = requirements.map((r) => `
      <tr>
        <td>${r.protocol || '—'}</td>
        <td>${r.beneficiary || '—'}</td>
        <td>${r.benefit_type?.replace(/_/g, ' ') || '—'}</td>
        <td>${r.status?.replace(/_/g, ' ') || '—'}</td>
      </tr>`).join('');

    // Load installments for export if not yet loaded
    let exportInstallmentsMap = installmentsMap;
    if (!installmentsLoaded && agreements.length > 0) {
      try {
        const results = await Promise.all(
          agreements.map((a) => financialService.listInstallments(a.id).then((inst) => ({ id: a.id, inst }))),
        );
        const map: Record<string, Installment[]> = {};
        results.forEach(({ id, inst }) => { map[id] = inst; });
        exportInstallmentsMap = map;
        setInstallmentsMap(map);
        setInstallmentsLoaded(true);
      } catch { /* use empty map */ }
    }

    const finRows = agreements.map((a) => {
      const insts = exportInstallmentsMap[a.id] ?? [];
      const paid = insts.filter((i) => i.status === 'pago');
      const pending = insts.filter((i) => i.status === 'pendente');
      const overdue = insts.filter((i) => i.status === 'vencido');
      const paidTotal = paid.reduce((s, i) => s + (i.paid_value ?? i.value), 0);
      const pendingTotal = pending.reduce((s, i) => s + i.value, 0);
      const overdueTotal = overdue.reduce((s, i) => s + i.value, 0);
      const instDetail = insts.length > 0
        ? `<br/><small style="color:#64748b">${paid.length}/${insts.length} pagas &nbsp;·&nbsp; `
          + `<span style="color:#16a34a">Pago: ${formatCurrency(paidTotal)}</span>`
          + (pendingTotal > 0 ? ` &nbsp;·&nbsp; <span style="color:#d97706">Pendente: ${formatCurrency(pendingTotal)}</span>` : '')
          + (overdueTotal > 0 ? ` &nbsp;·&nbsp; <span style="color:#dc2626">Em atraso: ${formatCurrency(overdueTotal)}</span>` : '')
          + '</small>'
        : '';
      return `<tr>
        <td>${a.title}${instDetail}</td>
        <td>${formatDate(a.agreement_date)}</td>
        <td>${formatCurrency(a.total_value)}</td>
        <td>${AGREEMENT_STATUS_LABEL[a.status] ?? a.status}</td>
      </tr>`;
    }).join('');

    const nextHearingRow = nextHearing
      ? `<p><strong>Próximo compromisso:</strong> ${formatDate(nextHearing.date)} — ${nextHearing.label}</p>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Ficha do Cliente — ${client.full_name}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1e293b; background: #fff; padding: 32px 40px; }
  h1 { font-size: 22px; font-weight: 700; color: #1e293b; }
  .subtitle { font-size: 12px; color: #64748b; margin-top: 2px; }
  .header { border-bottom: 2px solid #f97316; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; gap: 20px; }
  .header-left { display: flex; align-items: center; gap: 16px; }
  .header-photo { width: 80px; height: 100px; object-fit: cover; border-radius: 8px; border: 2px solid #f97316; flex-shrink: 0; }
  .header-photo-placeholder { width: 80px; height: 100px; border-radius: 8px; border: 2px solid #e2e8f0; background: #f8fafc; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .header-logo { font-size: 11px; color: #94a3b8; text-align: right; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
  .badge-ativo { background: #d1fae5; color: #065f46; }
  .badge-inativo { background: #f1f5f9; color: #475569; }
  section { margin-bottom: 24px; }
  section h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: #94a3b8; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; margin-bottom: 12px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 32px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px 32px; }
  .field label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; display: block; margin-bottom: 2px; }
  .field span { font-size: 12px; font-weight: 600; color: #1e293b; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; text-align: left; padding: 6px 8px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
  td { font-size: 11px; color: #334155; padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
  tr:last-child td { border-bottom: none; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .kpi { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
  .kpi .kpi-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: #94a3b8; margin-bottom: 4px; }
  .kpi .kpi-value { font-size: 18px; font-weight: 700; color: #1e293b; }
  .kpi .kpi-sub { font-size: 10px; color: #94a3b8; margin-top: 2px; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #f1f5f9; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; }
  .empty { font-size: 11px; color: #94a3b8; font-style: italic; padding: 8px 0; }
  @media print {
    body { padding: 16px 20px; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      ${photoBase64
        ? `<img class="header-photo" src="${photoBase64}" alt="${client.full_name}" />`
        : ''}
      <div>
        <h1>${client.full_name}</h1>
        <div class="subtitle">
          <span class="badge badge-${client.status}">${client.status.charAt(0).toUpperCase() + client.status.slice(1)}</span>
          &nbsp;·&nbsp; ${client.client_type === 'pessoa_fisica' ? 'Pessoa Física' : 'Pessoa Jurídica'}
          &nbsp;·&nbsp; Cliente desde ${formatDate(client.created_at)}
          ${photoBase64 ? '&nbsp;·&nbsp; <span style="color:#16a34a;font-weight:600">✓ ID verificada</span>' : ''}
        </div>
      </div>
    </div>
    <div class="header-logo">Gerado em ${now}<br/><strong>jurius.com.br</strong></div>
  </div>

  <div class="kpis">
    <div class="kpi">
      <div class="kpi-label">Processos ativos</div>
      <div class="kpi-value">${activeProcesses.length}</div>
      <div class="kpi-sub">${processes.length} no total</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Receita total</div>
      <div class="kpi-value">${formatCurrency(totalRevenue)}</div>
      <div class="kpi-sub">${agreements.length} acordo(s)</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Prazos pendentes</div>
      <div class="kpi-value">${pendingDeadlines.length + overdueDeadlines.length}</div>
      <div class="kpi-sub">${overdueDeadlines.length > 0 ? `${overdueDeadlines.length} vencido(s)` : 'Em dia'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Próximo compromisso</div>
      <div class="kpi-value">${nextHearing ? formatDate(nextHearing.date) : '—'}</div>
      <div class="kpi-sub">${nextHearing ? nextHearing.label : 'Nenhum agendado'}</div>
    </div>
  </div>

  <section>
    <h2>Dados Pessoais</h2>
    <div class="grid3">
      <div class="field"><label>${docLabel}</label><span>${docFormatted || '—'}</span></div>
      ${client.rg ? `<div class="field"><label>RG</label><span>${client.rg}</span></div>` : ''}
      ${client.birth_date ? `<div class="field"><label>Nascimento</label><span>${formatDate(client.birth_date)}</span></div>` : ''}
      ${client.nationality ? `<div class="field"><label>Nacionalidade</label><span>${client.nationality}</span></div>` : ''}
      ${client.marital_status ? `<div class="field"><label>Estado Civil</label><span>${client.marital_status}</span></div>` : ''}
      ${client.profession ? `<div class="field"><label>Profissão</label><span>${client.profession}</span></div>` : ''}
    </div>
  </section>

  <section>
    <h2>Contato</h2>
    <div class="grid2">
      <div class="field"><label>E-mail</label><span>${client.email || '—'}</span></div>
      <div class="field"><label>Telefone / Celular</label><span>${phone ? formatPhone(phone) : '—'}</span></div>
    </div>
    ${(client.address_street || client.address_city) ? `
    <div style="margin-top:10px" class="grid3">
      ${client.address_street ? `<div class="field"><label>Rua</label><span>${client.address_street}${client.address_number ? ', ' + client.address_number : ''}</span></div>` : ''}
      ${client.address_neighborhood ? `<div class="field"><label>Bairro</label><span>${client.address_neighborhood}</span></div>` : ''}
      ${client.address_city ? `<div class="field"><label>Cidade / UF</label><span>${client.address_city}${client.address_state ? ' — ' + client.address_state : ''}</span></div>` : ''}
      ${client.address_zip_code ? `<div class="field"><label>CEP</label><span>${client.address_zip_code}</span></div>` : ''}
    </div>` : ''}
  </section>

  <section>
    <h2>Processos (${processes.length})</h2>
    ${processes.length === 0 ? '<p class="empty">Nenhum processo vinculado.</p>' : `
    <table>
      <thead><tr><th>Número</th><th>Área</th><th>Status</th><th>Vara / Tribunal</th><th>Audiência</th></tr></thead>
      <tbody>${processRows}</tbody>
    </table>`}
  </section>

  <section>
    <h2>Financeiro (${agreements.length} acordo(s))</h2>
    ${agreements.length === 0 ? '<p class="empty">Nenhum acordo financeiro.</p>' : `
    <table>
      <thead><tr><th>Acordo</th><th>Data</th><th>Valor Total</th><th>Status</th></tr></thead>
      <tbody>${finRows}</tbody>
    </table>`}
  </section>

  <section>
    <h2>Prazos (${deadlines.length})</h2>
    ${deadlines.length === 0 ? '<p class="empty">Nenhum prazo registrado.</p>' : `
    <table>
      <thead><tr><th>Título</th><th>Vencimento</th><th>Status</th><th>Prioridade</th></tr></thead>
      <tbody>${deadlineRows}</tbody>
    </table>`}
  </section>

  <section>
    <h2>Requerimentos Administrativos (${requirements.length})</h2>
    ${requirements.length === 0 ? '<p class="empty">Nenhum requerimento vinculado.</p>' : `
    <table>
      <thead><tr><th>Protocolo</th><th>Beneficiário</th><th>Benefício</th><th>Status</th></tr></thead>
      <tbody>${reqRows}</tbody>
    </table>`}
  </section>

  ${client.notes ? `<section>
    <h2>Observações</h2>
    <p style="font-size:12px;color:#475569;line-height:1.6;white-space:pre-wrap">${client.notes}</p>
  </section>` : ''}

  <div class="footer">
    <span>Ficha gerada automaticamente pelo sistema jurius.com.br</span>
    <span>${now}</span>
  </div>

  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

    win.document.write(html);
    win.document.close();
  };

  // ── Header info
  const primaryPhone = client.phone || client.mobile || '';
  const formattedPhone = primaryPhone ? formatPhone(primaryPhone) : '';
  const whatsappLink = primaryPhone ? `https://wa.me/${primaryPhone.replace(/\D/g, '')}` : null;
  const rawCpfCnpj = client.cpf_cnpj || '';
  const formattedDoc = client.client_type === 'pessoa_fisica' ? formatCpf(rawCpfCnpj) : formatCnpj(rawCpfCnpj);

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'data', label: 'Dados' },
    { id: 'processes', label: 'Processos', count: processes.length },
    { id: 'financial', label: 'Financeiro', count: agreements.length },
    { id: 'deadlines', label: 'Prazos', count: deadlines.length },
    { id: 'requirements', label: 'Requerimentos', count: requirements.length },
    { id: 'agenda', label: 'Compromissos', count: calendarEvents.length },
    { id: 'assinaturas', label: 'Assinaturas', count: signatureRequests.length },
    { id: 'documents', label: 'Documentos' },
    { id: 'overview', label: 'Histórico' },
  ];

  return (
    <div className="w-full space-y-4 text-xs sm:text-sm">

      {/* ══════════════════════════════════════════════════════════════════
          IDENTITY CARD — Foto + Nome + Meta + KPIs integrados
      ══════════════════════════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">

        {/* Identidade compacta: avatar + info + KPIs numa linha só */}
        <div className="flex items-center gap-4 px-5 py-4">

          {/* Avatar compacto */}
          {selfies.length > 0 ? (() => {
            const profileSelfie = (pinnedPath ? selfies.find((s) => s.path === pinnedPath) : null) ?? selfies[0];
            return (
              <button
                type="button"
                onClick={() => setPreviewSelfie(profileSelfie)}
                className="group relative w-12 h-12 rounded-full overflow-hidden ring-2 ring-slate-200 hover:ring-orange-300 shadow-sm flex-shrink-0 transition focus:outline-none"
                title="Ampliar foto"
              >
                <img src={profileSelfie.url} alt={client.full_name} className="w-full h-full object-cover" />
                <span className="absolute bottom-0 left-0 right-0 bg-emerald-500 text-white text-[7px] font-bold text-center leading-none py-[3px] tracking-wider">ID</span>
              </button>
            );
          })() : (() => {
            const isPj = client.client_type === 'pessoa_juridica';
            const stringHue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i); return Math.abs(h) % 360; };
            const initials = (() => { const parts = client.full_name.trim().split(/\s+/).filter(Boolean); if (!parts.length) return '?'; if (parts.length === 1) return (parts[0][0] || '?').toUpperCase(); return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase(); })();
            const hue = stringHue(client.full_name);
            return (
              <div
                className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center font-bold text-base ring-2 ring-inset shadow-sm"
                style={isPj ? { background: '#f1f5f9', color: '#64748b' } : { background: `hsl(${hue}, 55%, 94%)`, color: `hsl(${hue}, 50%, 32%)` }}
              >
                {isPj ? <Building2 className="w-5 h-5" strokeWidth={1.5} /> : initials}
              </div>
            );
          })()}

          {/* Info principal */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => { if (formattedDoc) { void navigator.clipboard.writeText(formattedDoc); } }}
                className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 transition rounded-md px-2 py-1"
                title="Clique para copiar"
              >
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{client.client_type === 'pessoa_fisica' ? 'CPF' : 'CNPJ'}</span>
                <span className="font-semibold text-slate-800 tabular-nums text-xs">{formattedDoc || '—'}</span>
              </button>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                client.status === 'ativo' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' :
                client.status === 'inativo' ? 'bg-slate-100 text-slate-500 ring-1 ring-slate-200' :
                'bg-red-50 text-red-700 ring-1 ring-red-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${client.status === 'ativo' ? 'bg-emerald-500' : client.status === 'inativo' ? 'bg-slate-400' : 'bg-red-500'}`} />
                {client.status === 'ativo' ? 'Ativo' : client.status === 'inativo' ? 'Inativo' : 'Arquivado'}
              </span>
              <span className="text-[11px] text-slate-400">{client.client_type === 'pessoa_fisica' ? 'Pessoa Física' : 'Pessoa Jurídica'}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500">
              {client.created_at && (
                <span className="inline-flex items-center gap-1"><CalendarIcon className="w-3 h-3 text-slate-400" />Cliente desde <strong className="text-slate-600 font-medium">{formatDate(client.created_at)}</strong></span>
              )}
              {client.email && (
                <><span className="text-slate-300">·</span>
                <a href={`mailto:${client.email}`} className="inline-flex items-center gap-1 hover:text-orange-500 transition truncate max-w-[180px]">
                  <Mail className="w-3 h-3 text-slate-400 flex-shrink-0" />{client.email}
                </a></>
              )}
              {primaryPhone && (
                <><span className="text-slate-300">·</span>
                <span className="inline-flex items-center gap-1">
                  <Phone className="w-3 h-3 text-slate-400" />
                  <a href={`tel:${primaryPhone}`} className="hover:text-orange-500 transition">{primaryPhone}</a>
                  <a href={`https://wa.me/55${primaryPhone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition" title="WhatsApp">
                    <MessageCircle className="w-2.5 h-2.5" />
                  </a>
                </span></>
              )}
            </div>
          </div>

          {/* KPIs compactos — lado direito */}
          {(() => {
            // Data formatada do próximo compromisso
            const hearingDateObj = nextHearing ? new Date(nextHearing.date) : null;
            const hearingDateStr = hearingDateObj && !isNaN(hearingDateObj.getTime())
              ? hearingDateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
              : null;

            return (
              <div className="flex items-stretch divide-x divide-slate-100 flex-shrink-0 border-l border-slate-100">
                <div className="px-5 flex flex-col justify-center min-w-[72px]">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Casos</p>
                  <p className="text-xl font-bold text-slate-900 tabular-nums leading-none">{relationsLoading ? '…' : activeProcesses.length + activeRequirements.length}</p>
                  <p className="text-[9px] text-slate-400 mt-1">{activeProcesses.length}p · {activeRequirements.length}r</p>
                </div>
                <div className="px-5 flex flex-col justify-center min-w-[100px]">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Honorários</p>
                  <p className={`text-sm font-bold tabular-nums leading-none ${totalRevenue > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{financialLoading ? '…' : formatCurrency(totalRevenue)}</p>
                  <p className="text-[9px] text-slate-400 mt-1">{totalRevenue > 0 ? 'recebido' : 'sem baixa'}</p>
                </div>
                <div className="px-5 flex flex-col justify-center min-w-[72px]">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Prazos</p>
                  <p className={`text-xl font-bold tabular-nums leading-none ${overdueDeadlines.length > 0 ? 'text-rose-600' : 'text-slate-900'}`}>{deadlinesLoading ? '…' : pendingDeadlines.length + overdueDeadlines.length}</p>
                  <p className="text-[9px] mt-1">{overdueDeadlines.length > 0 ? <span className="text-rose-500 font-semibold">{overdueDeadlines.length} vencido{overdueDeadlines.length !== 1 ? 's' : ''}</span> : <span className="text-slate-400">Em dia</span>}</p>
                </div>
                <div className="px-5 flex flex-col justify-center min-w-[130px]">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Próx. Compromisso</p>
                  {nextHearing ? (
                    <button
                      type="button"
                      onClick={() => navigateTo('agenda', { entityId: nextHearing.id } as any)}
                      className="text-left group mt-0.5"
                      title="Abrir na Agenda"
                    >
                      <p className="text-sm font-bold text-slate-900 leading-tight tabular-nums group-hover:text-orange-600 transition-colors">
                        {hearingDateStr}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {nextHearing.time && <span className="font-semibold text-slate-600">{nextHearing.time} · </span>}
                        {nextHearing.label}
                      </p>
                    </button>
                  ) : (
                    <p className="text-sm text-slate-300">—</p>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          AUTO-IMPORT — Dados detectados em assinaturas digitais
      ══════════════════════════════════════════════════════════════════ */}
      {!signatureSyncDismissed && (() => {
        // Detecta emails gerados pelo próprio sistema (não são emails reais do usuário)
        const isSystemEmail = (raw?: string | null): boolean => {
          if (!raw) return true;
          const e = raw.trim().toLowerCase();
          if (!e || !e.includes('@')) return true;
          if (/@crm\.local$/i.test(e)) return true;        // placeholders internos
          if (/^public[+@-]/i.test(e)) return true;        // links públicos
          if (/@example\./i.test(e)) return true;          // exemplos
          if (/^noreply@/i.test(e) || /^no-reply@/i.test(e)) return true;
          return false;
        };

        const allSigners = signatureRequests.flatMap((r) => r.signers ?? []);
        const signedSigners = allSigners
          .filter((s) => s.status === 'signed')
          .sort((a, b) => new Date(b.signed_at ?? 0).getTime() - new Date(a.signed_at ?? 0).getTime());

        // Procura o melhor email real entre TODOS os signers (não só o mais recente)
        // Prioridade: auth_email (usado pra logar) > email do cadastro do signer
        let bestEmail = '';
        for (const s of signedSigners) {
          if (!bestEmail && s.auth_email && !isSystemEmail(s.auth_email)) bestEmail = s.auth_email.trim();
          if (!bestEmail && s.email && !isSystemEmail(s.email)) bestEmail = s.email.trim();
          if (bestEmail) break;
        }

        const latest = signedSigners[0];
        if (!latest && !bestEmail) return null;

        const clientEmail = (client.email || '').trim();
        const clientPhone = (client.phone || client.mobile || '').trim();
        const clientCpfDigits = (client.cpf_cnpj || '').replace(/\D/g, '');

        const sigPhone = (latest?.phone || '').trim();
        const sigCpfDigits = (latest?.cpf || '').replace(/\D/g, '');

        const suggestEmail = !clientEmail && !!bestEmail;
        const suggestPhone = !clientPhone && !!sigPhone;
        const suggestCpf = clientCpfDigits.length < 11 && sigCpfDigits.length === 11;

        const sigEmail = bestEmail; // alias pra usar no botão

        if (!suggestEmail && !suggestPhone && !suggestCpf) return null;

        const handleImportAll = async () => {
          setSyncingSignatureData(true);
          try {
            const updates: any = {};
            if (suggestEmail) updates.email = sigEmail;
            if (suggestPhone) updates.phone = sigPhone;
            if (suggestCpf) updates.cpf_cnpj = sigCpfDigits;
            await clientService.updateClient(client.id, updates);
            // mutate prop in-place + force refresh (matches existing pattern for photo_path)
            Object.assign(client, updates);
            forceRefresh((x) => x + 1);
          } catch (err: any) {
            alert(err?.message ?? 'Erro ao importar dados');
          } finally {
            setSyncingSignatureData(false);
          }
        };

        const handleImportField = async (field: 'email' | 'phone' | 'cpf_cnpj', value: string) => {
          setSyncingSignatureData(true);
          try {
            await clientService.updateClient(client.id, { [field]: value } as any);
            (client as any)[field] = value;
            forceRefresh((x) => x + 1);
          } catch (err: any) {
            alert(err?.message ?? 'Erro ao importar');
          } finally {
            setSyncingSignatureData(false);
          }
        };

        return (
          <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/70 via-white to-white shadow-sm">
            <div className="flex items-start gap-3 p-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-blue-900">Dados detectados na assinatura digital</p>
                    <p className="text-[11px] text-blue-700/70 mt-0.5">
                      Encontramos informações fornecidas pelo cliente ao assinar
                      {latest.signed_at && (
                        <> em <strong className="font-semibold">{formatDate(latest.signed_at)}</strong></>
                      )}. Importe direto para o cadastro.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={handleImportAll}
                      disabled={syncingSignatureData}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition disabled:opacity-60"
                    >
                      {syncingSignatureData ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      Importar tudo
                    </button>
                    <button
                      type="button"
                      onClick={() => setSignatureSyncDismissed(true)}
                      className="text-blue-500 hover:text-blue-700 hover:bg-blue-100 rounded p-1 transition text-sm"
                      title="Dispensar"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestEmail && (
                    <button
                      type="button"
                      onClick={() => handleImportField('email', sigEmail)}
                      disabled={syncingSignatureData}
                      className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-blue-200 bg-white hover:bg-blue-50 transition text-xs shadow-sm disabled:opacity-60"
                      title="Importar apenas este campo"
                    >
                      <Mail className="w-3 h-3 text-blue-500" />
                      <span className="text-slate-500">Email:</span>
                      <strong className="text-slate-900 font-semibold">{sigEmail}</strong>
                      <span className="text-blue-600 opacity-0 group-hover:opacity-100 transition text-[10px] font-semibold ml-1">Usar →</span>
                    </button>
                  )}
                  {suggestPhone && (
                    <button
                      type="button"
                      onClick={() => handleImportField('phone', sigPhone)}
                      disabled={syncingSignatureData}
                      className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-blue-200 bg-white hover:bg-blue-50 transition text-xs shadow-sm disabled:opacity-60"
                      title="Importar apenas este campo"
                    >
                      <Phone className="w-3 h-3 text-blue-500" />
                      <span className="text-slate-500">Telefone:</span>
                      <strong className="text-slate-900 font-semibold tabular-nums">{sigPhone}</strong>
                      <span className="text-blue-600 opacity-0 group-hover:opacity-100 transition text-[10px] font-semibold ml-1">Usar →</span>
                    </button>
                  )}
                  {suggestCpf && (
                    <button
                      type="button"
                      onClick={() => handleImportField('cpf_cnpj', sigCpfDigits)}
                      disabled={syncingSignatureData}
                      className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-blue-200 bg-white hover:bg-blue-50 transition text-xs shadow-sm disabled:opacity-60"
                      title="Importar apenas este campo"
                    >
                      <User className="w-3 h-3 text-blue-500" />
                      <span className="text-slate-500">CPF:</span>
                      <strong className="text-slate-900 font-semibold tabular-nums">
                        {`${sigCpfDigits.slice(0,3)}.${sigCpfDigits.slice(3,6)}.${sigCpfDigits.slice(6,9)}-${sigCpfDigits.slice(9)}`}
                      </strong>
                      <span className="text-blue-600 opacity-0 group-hover:opacity-100 transition text-[10px] font-semibold ml-1">Usar →</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Preview modal (full-size) ── */}
      {previewSelfie && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90" onClick={() => setPreviewSelfie(null)}>
          <div className="relative" style={{ maxHeight: '90vh', maxWidth: '380px', width: '100%', margin: '0 16px' }} onClick={(e) => e.stopPropagation()}>

            {/* Fechar */}
            <button
              onClick={() => setPreviewSelfie(null)}
              className="absolute top-3 right-3 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition"
            >
              <X className="w-4 h-4 stroke-2" />
            </button>

            {/* Foto */}
            <img
              src={previewSelfie.url}
              alt={client.full_name}
              className="w-full rounded-2xl object-cover"
              style={{ maxHeight: '90vh' }}
            />

            {/* Info sobreposto */}
            <div className="absolute bottom-0 left-0 right-0 rounded-b-2xl px-4 py-4 bg-gradient-to-t from-black/80 to-transparent">
              <p className="text-white font-semibold text-sm leading-tight">{client.full_name}</p>
              <p className="text-white/60 text-xs mt-0.5">{previewSelfie.label}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Foto manager modal ── */}
      {selfiePickerOpen && selfies.length > 0 && (() => {
        const handlePin = async (path: string) => {
          setSettingPhoto(true);
          try {
            await clientService.setClientPhoto(client.id, path);
            setPinnedPath(path);
            (client as any).photo_path = path;
          } catch (err: any) { alert(err?.message ?? 'Erro ao salvar foto'); }
          finally { setSettingPhoto(false); }
        };


        const handleExclude = async (path: string, label: string) => {
          if (!window.confirm(`Excluir esta foto do perfil de ${client.full_name}?\n\n"${label}"\n\nA imagem deixa de aparecer em todos os módulos. A prova jurídica na assinatura original é preservada.`)) {
            return;
          }
          setSettingPhoto(true);
          try {
            const nextExcluded = await clientService.excludeClientPhoto(client.id, path);
            (client as any).excluded_photo_paths = nextExcluded;
            if (pinnedPath === path) {
              setPinnedPath(null);
              (client as any).photo_path = null;
            }
            setSelfies((prev) => {
              const remaining = prev.filter((s) => s.path !== path);
              if (remaining.length === 0) setSelfiePickerOpen(false);
              return remaining;
            });
          } catch (err: any) {
            alert(err?.message ?? 'Erro ao excluir foto');
          } finally {
            setSettingPhoto(false);
          }
        };

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" onClick={() => setSelfiePickerOpen(false)}>
            <div className="bg-white w-full sm:max-w-lg flex flex-col overflow-hidden rounded-t-3xl sm:rounded-2xl shadow-2xl" style={{ maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>

              {/* Handle bar (mobile) */}
              <div className="flex justify-center pt-3 pb-1 sm:hidden">
                <div className="w-10 h-1 rounded-full bg-slate-200" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-4 pb-5">
                <div>
                  <p className="text-lg font-bold text-slate-900 leading-tight">Fotos coletadas</p>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {selfies.length} foto{selfies.length !== 1 ? 's' : ''} de assinaturas digitais
                  </p>
                </div>
                <button
                  onClick={() => setSelfiePickerOpen(false)}
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition shadow-sm"
                >
                  <X className="w-4 h-4 stroke-2" />
                </button>
              </div>

              {/* Grid */}
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                <div className="grid grid-cols-2 gap-3">
                  {selfies.map((s) => {
                    const isProfile = pinnedPath ? pinnedPath === s.path : s.path === selfies[0].path;
                    return (
                      <div
                        key={s.path}
                        className={`relative rounded-2xl overflow-hidden border-2 transition ${
                          isProfile ? 'border-orange-400' : 'border-transparent'
                        }`}
                      >
                        {/* Foto */}
                        <button
                          type="button"
                          onClick={() => setPreviewSelfie(s)}
                          className="block w-full aspect-[3/4] overflow-hidden focus:outline-none group"
                        >
                          <img src={s.url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                          <span className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                        </button>

                        {/* Badge perfil */}
                        {isProfile && (
                          <span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-orange-500 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shadow">
                            <Star className="w-2.5 h-2.5 fill-white" />
                            Perfil
                          </span>
                        )}

                        {/* Label + ações */}
                        <div className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5 pt-6">
                          <p className="text-white text-[11px] font-medium leading-tight line-clamp-2 drop-shadow mb-2">{s.label}</p>
                          <div className="flex items-center gap-1.5">
                            {!isProfile && (
                              <button
                                onClick={() => void handlePin(s.path)}
                                disabled={settingPhoto}
                                className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg text-white bg-orange-500/90 hover:bg-orange-500 backdrop-blur-sm transition disabled:opacity-50"
                                title="Definir como foto do perfil"
                              >
                                {settingPhoto ? <Loader2 className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />}
                                Definir
                              </button>
                            )}
                            <button
                              onClick={() => void handleExclude(s.path, s.label)}
                              disabled={settingPhoto}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white/20 hover:bg-red-500/80 text-white backdrop-blur-sm transition disabled:opacity-50"
                              title="Remover esta foto (preserva a prova jurídica)"
                            >
                              {settingPhoto ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-slate-100">
                <p className="text-[11px] text-slate-400 text-center">
                  Toque na foto para ampliar · As fotos são prova jurídica e não podem ser deletadas
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════════════════
          QUICK ACTIONS — agrupado e harmonizado
      ══════════════════════════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3">
        <div className="flex flex-wrap items-center gap-1.5">

          {/* Grupo: Criar item jurídico */}
          {(onCreateProcess || onCreateRequirement || onCreateDeadline) && (
            <>
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 px-2 select-none">Criar</span>
              {onCreateProcess && (
                <button
                  onClick={onCreateProcess}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition"
                >
                  <Plus className="w-3 h-3" /> Processo
                </button>
              )}
              {onCreateRequirement && (
                <button
                  onClick={onCreateRequirement}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition"
                >
                  <Plus className="w-3 h-3" /> Requerimento
                </button>
              )}
              {onCreateDeadline && (
                <button
                  onClick={onCreateDeadline}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition"
                >
                  <Plus className="w-3 h-3" /> Prazo
                </button>
              )}
            </>
          )}

          {/* Divisor */}
          <span className="h-6 w-px bg-slate-200 mx-2" />

          {/* Grupo: Ações destacadas (cores reservadas pra elas) */}
          <button
            onClick={() => events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN, { clientId: client.id })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-700 hover:bg-amber-100 hover:border-amber-300 transition"
          >
            <PenTool className="w-3 h-3" /> Petição
          </button>
          <button
            onClick={() => navigateTo('agenda', { mode: 'create', prefill: { client_id: client.id, client_name: client.full_name } } as any)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-200 bg-violet-50 text-xs font-semibold text-violet-700 hover:bg-violet-100 hover:border-violet-300 transition"
          >
            <CalendarPlus className="w-3 h-3" /> Compromisso
          </button>

          {/* Push to right */}
          <span className="flex-1" />

          {/* Utility */}
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition"
            title="Exportar ficha do cliente"
          >
            <Printer className="w-3 h-3" /> Exportar
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          TABS — underline limpo, sem wash de cor no fundo
      ══════════════════════════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-200 overflow-x-auto bg-slate-50/40">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 px-5 py-3 text-sm font-semibold transition relative ${
                activeTab === tab.id
                  ? 'text-orange-600'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums ${
                    activeTab === tab.id ? 'bg-orange-100 text-orange-700' : 'bg-slate-200 text-slate-500'
                  }`}>{tab.count}</span>
                )}
              </span>
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-orange-500 rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">

          {/* ═══════════════════════════════════════════════════════════════════
              TAB: DADOS (padrão)
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'data' && (
            <div className="space-y-4">
              {(missingFields.length > 0 || isOutdated) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-2 text-amber-700 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {missingFields.length > 0 && <span>{missingFields.length} campo(s) pendente(s). </span>}
                  {isOutdated && <span>Dados desatualizados.</span>}
                  <button onClick={onEdit} className="ml-auto text-xs font-semibold underline">Editar</button>
                </div>
              )}

              {/* ── Solicitações de atualização cadastral do portal ── */}
              {!profileReqLoading && profileReqs.filter((r) => r.status === 'pending').map((req) => {
                const FIELD_LABELS: Record<string, string> = {
                  full_name: 'Nome completo', email: 'E-mail', phone: 'Telefone',
                  birth_date: 'Nascimento', marital_status: 'Estado civil',
                  profession: 'Profissão', nationality: 'Nacionalidade',
                  address_street: 'Rua', address_number: 'Número',
                  address_neighborhood: 'Bairro', address_city: 'Cidade',
                  address_state: 'UF', address_zip_code: 'CEP',
                };
                const MARITAL_LABELS: Record<string, string> = {
                  solteiro: 'Solteiro(a)', casado: 'Casado(a)', divorciado: 'Divorciado(a)',
                  viuvo: 'Viúvo(a)', uniao_estavel: 'União Estável',
                };
                const displayValue = (k: string, v: string) => {
                  if (k === 'marital_status') return MARITAL_LABELS[v] || v;
                  if (k === 'birth_date') return new Date(v).toLocaleDateString('pt-BR');
                  if (k === 'phone') {
                    const d = v.replace(/\D/g, '');
                    if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
                    if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
                  }
                  return v;
                };
                return (
                <div key={req.id} className="rounded-xl border border-orange-200 bg-orange-50/60 px-4 py-3 space-y-2.5">
                  {/* Header compacto */}
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-3.5 h-3.5 shrink-0 text-orange-500" />
                    <p className="text-xs font-semibold text-slate-800 flex-1">Atualização cadastral solicitada via Portal</p>
                    <span className="text-[10px] text-slate-400">{new Date(req.requested_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
                  </div>

                  {/* Campos em linha */}
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(req.changes).map(([k, v]) => v && (
                      <span key={k} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] ring-1 ring-orange-100">
                        <span className="font-medium text-slate-500">{FIELD_LABELS[k] || k}:</span>
                        <span className="font-semibold text-slate-800">{displayValue(k, String(v))}</span>
                      </span>
                    ))}
                  </div>

                  {/* Ações compactas */}
                  {rejectInputId === req.id ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Motivo (opcional)"
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-200"
                      />
                      <button onClick={() => { setRejectInputId(null); setRejectReason(''); }}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                        Cancelar
                      </button>
                      <button disabled={!!profileReqProcessing} onClick={() => handleRejectProfileReq(req.id)}
                        className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-600 disabled:opacity-60">
                        {profileReqProcessing === req.id ? '...' : 'Confirmar'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button disabled={!!profileReqProcessing}
                        onClick={() => { setRejectInputId(req.id); setRejectReason(''); }}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">
                        <UserX className="w-3 h-3" /> Rejeitar
                      </button>
                      <button disabled={!!profileReqProcessing}
                        onClick={() => handleApproveProfileReq(req.id)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-orange-600 disabled:opacity-60">
                        {profileReqProcessing === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
                        Aprovar e aplicar
                      </button>
                    </div>
                  )}
                </div>
                );
              })}

              {/* Layout 2 colunas: esquerda dados pessoais+contato / direita endereço+alertas */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-0">

                {/* ── Col esquerda ── */}
                <div className="space-y-0 divide-y divide-slate-100">
                  {/* Status + tipo */}
                  <div className="pb-3 flex items-center gap-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      client.status === 'ativo' ? 'bg-emerald-100 text-emerald-700' :
                      client.status === 'inativo' ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${client.status === 'ativo' ? 'bg-emerald-500' : client.status === 'inativo' ? 'bg-slate-400' : 'bg-amber-500'}`} />
                      {client.status.charAt(0).toUpperCase() + client.status.slice(1)}
                    </span>
                    <span className="text-xs text-slate-500">{client.client_type === 'pessoa_fisica' ? 'Pessoa Física' : 'Pessoa Jurídica'}</span>
                    <span className="text-xs text-slate-400">· desde {formatDate(client.created_at)}</span>
                  </div>

                  {/* Documentos */}
                  <div className="py-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                    <MiniField label={client.client_type === 'pessoa_fisica' ? 'CPF' : 'CNPJ'} value={formattedDoc || '—'} />
                    {client.client_type === 'pessoa_fisica' && <MiniField label="RG" value={client.rg} />}
                    {client.client_type === 'pessoa_fisica' && <MiniField label="Nascimento" value={formatDate(client.birth_date)} />}
                    {client.client_type === 'pessoa_fisica' && <MiniField label="Estado civil" value={client.marital_status} />}
                    <MiniField label="Nacionalidade" value={client.nationality} />
                    <MiniField label="Profissão" value={client.profession} />
                  </div>

                  {/* Contato */}
                  <div className="py-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">E-mail</p>
                      {client.email
                        ? <a href={`mailto:${client.email}`} className="text-xs font-medium text-orange-500 hover:underline truncate block">{client.email}</a>
                        : <span className="text-xs text-slate-400">—</span>}
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Telefone</p>
                      <p className="text-xs font-medium text-slate-800">{formattedPhone || '—'}</p>
                      {whatsappLink && (
                        <a href={whatsappLink} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] font-semibold text-emerald-600 hover:underline">WhatsApp →</a>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Col direita ── */}
                <div className="space-y-0 divide-y divide-slate-100">
                  {/* Endereço */}
                  <div className="pb-3 grid grid-cols-3 gap-x-3 gap-y-2.5">
                    <div className="col-span-2"><MiniField label="Rua" value={client.address_street} /></div>
                    <MiniField label="Número" value={client.address_number} />
                    <MiniField label="Bairro" value={client.address_neighborhood} />
                    <MiniField label="Cidade" value={client.address_city} />
                    <MiniField label="UF" value={client.address_state} />
                    <MiniField label="CEP" value={client.address_zip_code} />
                  </div>

                  {/* Alertas + notas + próximos eventos (compacto) */}
                  <div className="pt-3 space-y-2">
                    {installmentsLoaded && overdueAmount > 0 && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
                        <p className="text-xs text-rose-700 font-medium flex-1">{formatCurrency(overdueAmount)} em atraso</p>
                        <button onClick={() => setActiveTab('financial')} className="text-[10px] font-bold text-rose-600 hover:underline">Ver →</button>
                      </div>
                    )}
                    {client.notes && (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
                        <StickyNote className="w-3 h-3 text-amber-500 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-slate-700 line-clamp-3">{client.notes}</p>
                      </div>
                    )}
                    {upcomingEvents.length > 0 && (
                      <button
                        type="button"
                        onClick={() => navigateTo('agenda', { entityId: upcomingEvents[0].id } as any)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 border border-violet-100 hover:border-violet-300 hover:bg-violet-100 transition text-left group"
                      >
                        <CalendarIcon className="w-3 h-3 text-violet-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-800 truncate group-hover:text-violet-700 transition-colors">{upcomingEvents[0].title}</p>
                          <p className="text-[10px] text-slate-500">{formatDateTime(upcomingEvents[0].start_at)}</p>
                        </div>
                        {upcomingEvents.length > 1
                          ? <span className="text-[10px] text-violet-600 font-semibold flex-shrink-0">+{upcomingEvents.length - 1}</span>
                          : <ChevronRight className="w-3 h-3 text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                        }
                      </button>
                    )}
                    {/* Info sistema (discreto) */}
                    <p className="text-[9px] text-slate-300 pt-1">
                      ID {client.id.slice(0, 8).toUpperCase()} · Atualizado {formatDate(client.updated_at)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              TAB: HISTÓRICO — Timeline
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'overview' && (
            <div className="space-y-2">
              {/* Busca */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Buscar no histórico..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-300"
                />
              </div>

              {structuredTimeline.length === 0 ? (
                <SectionEmpty text="Nenhuma atividade registrada." />
              ) : (() => {
                const q = historySearch.trim().toLowerCase();
                const roots = q
                  ? structuredTimeline
                      .map((r) => ({
                        ...r,
                        leaves: r.leaves.filter((l) =>
                          l.title.toLowerCase().includes(q) ||
                          l.label.toLowerCase().includes(q) ||
                          (l.actor ?? '').toLowerCase().includes(q)
                        ),
                      }))
                      .filter((r) =>
                        r.title.toLowerCase().includes(q) ||
                        (r.subtitle ?? '').toLowerCase().includes(q) ||
                        (r.actor ?? '').toLowerCase().includes(q) ||
                        r.leaves.length > 0
                      )
                  : structuredTimeline;

                if (roots.length === 0)
                  return <SectionEmpty text="Nenhum resultado encontrado." />;

                return (
                  <div className="relative">
                    {/* Linha vertical principal */}
                    <div className="absolute left-[18px] top-4 bottom-4 w-0.5 bg-slate-100 z-0" />

                    <div className="space-y-6">
                      {roots.map((root) => (
                        <div key={root.id} className="relative">
                          {/* ── Raiz ── */}
                          <div className="flex items-start gap-3 group/root">
                            {/* Ícone raiz */}
                            <div className={`relative z-10 flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center shadow-sm border-2 border-white ${
                              root.type === 'process' ? 'bg-blue-500' :
                              root.type === 'requirement' ? 'bg-orange-500' : 'bg-slate-400'
                            }`}>
                              {root.type === 'process'
                                ? <Scale className="w-4 h-4 text-white" />
                                : root.type === 'requirement'
                                  ? <ClipboardList className="w-4 h-4 text-white" />
                                  : <Star className="w-4 h-4 text-white" />}
                            </div>

                            {/* Info raiz */}
                            <div className="flex-1 min-w-0 pt-0.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-bold text-slate-900 font-mono tracking-tight">{root.title}</p>
                                    {root.statusLabel && (
                                      <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${root.statusColor}`}>
                                        {root.statusLabel}
                                      </span>
                                    )}
                                  </div>
                                  {root.subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{root.subtitle}</p>}
                                  {root.actor && (
                                    <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                                      <User className="w-3 h-3" />{root.actor}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                                  <span className="text-[10px] text-slate-400 whitespace-nowrap tabular-nums">
                                    {new Date(root.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                                  </span>
                                  {root.module && root.entityId && (
                                    <button
                                      onClick={() => handleTimelineNavigate(root.module, root.entityId)}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-slate-400 hover:text-orange-600 hover:bg-orange-50 border border-transparent hover:border-orange-200 transition opacity-0 group-hover/root:opacity-100"
                                      title="Abrir no módulo"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                      Abrir
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* ── Folhas (atividades da raiz) ── */}
                          {root.leaves.length > 0 && (
                            <div className="ml-[18px] mt-2 pl-6 border-l-2 border-slate-100 space-y-1.5">
                              {root.leaves.map((leaf) => (
                                <div
                                  key={leaf.id}
                                  onClick={() => leaf.module && leaf.entityId && handleTimelineNavigate(leaf.module, leaf.entityId)}
                                  className={`group/leaf flex items-start gap-2.5 rounded-lg px-3 py-2 transition ${
                                    leaf.future
                                      ? 'bg-violet-50 border border-violet-100'
                                      : 'bg-slate-50 border border-slate-100 hover:border-orange-200 hover:bg-orange-50/30'
                                  } ${leaf.module && leaf.entityId ? 'cursor-pointer' : ''}`}
                                >
                                  <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${leaf.dot}`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="text-xs font-semibold text-slate-800 truncate group-hover/leaf:text-orange-700 transition">{leaf.title}</p>
                                        {leaf.actor && (
                                          <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                                            <User className="w-2.5 h-2.5" />{leaf.actor}
                                          </p>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        <span className="text-[9px] text-slate-400 tabular-nums">
                                          {new Date(leaf.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                                        </span>
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${leaf.badgeBg} ${leaf.badgeText}`}>
                                          {leaf.future ? '⏱ ' : ''}{leaf.label}
                                        </span>
                                        {leaf.module && leaf.entityId && (
                                          <ExternalLink className="w-3 h-3 text-slate-300 group-hover/leaf:text-orange-400 transition flex-shrink-0" />
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              TAB: PROCESSOS
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'processes' && (
            <div className="space-y-2">
              {relationsLoading ? (
                <div className="flex items-center gap-2 text-slate-400 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
              ) : processes.length === 0 ? (
                <SectionEmpty text="Nenhum processo vinculado a este cliente." />
              ) : (
                processes.map((p) => {
                  const statusColor = PROCESS_STATUS_COLOR[p.status] ?? 'bg-slate-100 text-slate-600';
                  const statusLabel = PROCESS_STATUS_LABEL[p.status] ?? p.status;
                  const practiceLabel = PRACTICE_AREA_LABEL[p.practice_area] ?? p.practice_area;
                  const accentColor: Record<string, string> = {
                    andamento: 'border-l-emerald-400', distribuido: 'border-l-amber-400',
                    recurso: 'border-l-yellow-400', sentenca: 'border-l-purple-400',
                    arquivado: 'border-l-slate-300', cumprimento: 'border-l-lime-400',
                    conciliacao: 'border-l-teal-400', contestacao: 'border-l-orange-400',
                    instrucao: 'border-l-indigo-400', citacao: 'border-l-cyan-400',
                    nao_protocolado: 'border-l-slate-300', aguardando_confeccao: 'border-l-blue-400',
                  };
                  const accent = accentColor[p.status] ?? 'border-l-slate-300';
                  const isMuted = p.status === 'arquivado';
                  const hearingFuture = p.hearing_date ? new Date(p.hearing_date) >= new Date() : false;
                  return (
                    <div
                      key={p.id}
                      className={`rounded-xl border border-l-4 bg-white px-4 py-3.5 flex items-start gap-4 group transition hover:shadow-sm ${accent} ${isMuted ? 'border-slate-100 opacity-60' : 'border-slate-200 hover:border-orange-200'}`}
                    >
                      {/* Conteúdo principal */}
                      <div className="flex-1 min-w-0">
                        {/* Número */}
                        <p className={`text-sm font-bold font-mono tracking-tight leading-snug ${isMuted ? 'text-slate-500' : 'text-slate-900'}`}>
                          {p.process_code || <span className="text-slate-400 font-sans font-normal italic">Sem número</span>}
                        </p>
                        {/* Badges + meta inline */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${statusColor}`}>{statusLabel}</span>
                          {practiceLabel && <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-500">{practiceLabel}</span>}
                          {p.court && <span className="text-[11px] text-slate-400 flex items-center gap-1"><MapPin className="w-3 h-3" />{p.court}</span>}
                          {p.responsible_lawyer && <span className="text-[11px] text-slate-400 flex items-center gap-1"><User className="w-3 h-3" />{p.responsible_lawyer}</span>}
                        </div>
                        {/* Audiência — linha discreta abaixo */}
                        {p.hearing_date && (
                          <p className={`mt-2 text-[11px] flex items-center gap-1.5 ${hearingFuture ? 'text-violet-600 font-semibold' : 'text-slate-400'}`}>
                            <CalendarIcon className="w-3 h-3 flex-shrink-0" />
                            Audiência · {formatDate(p.hearing_date)}
                            {p.hearing_time && ` · ${p.hearing_time.slice(0, 5)}`}
                            {p.hearing_mode === 'online' ? ' · Online' : p.hearing_mode === 'presencial' ? ' · Presencial' : ''}
                            {!hearingFuture && <span className="text-[10px] font-normal text-slate-300">(passada)</span>}
                          </p>
                        )}
                      </div>
                      {/* Abrir */}
                      <button
                        onClick={() => events.emit(SYSTEM_EVENTS.NAVIGATE_REQUEST, { module: 'processos', params: { entityId: p.id } })}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-400 hover:text-orange-600 hover:bg-orange-50 transition"
                        title="Abrir processo"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Abrir
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              TAB: FINANCEIRO
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'financial' && (
            <div className="space-y-4">
              {financialLoading ? (
                <div className="flex items-center gap-2 text-slate-400 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
              ) : agreements.length === 0 ? (
                <SectionEmpty text="Nenhum acordo financeiro vinculado a este cliente." />
              ) : (
                <>
                  {/* Banner inadimplência */}
                  {installmentsLoaded && overdueAmount > 0 && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-center gap-3">
                      <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-bold text-rose-800">Inadimplente</p>
                        <p className="text-xs text-rose-600">{formatCurrency(overdueAmount)} em parcelas vencidas</p>
                      </div>
                    </div>
                  )}

                  {/* Summary row */}
                  {installmentsLoaded && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">Recebido</p>
                        <p className="text-base font-bold text-emerald-700 mt-1">{formatCurrency(paidAmount)}</p>
                      </div>
                      <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-600">Pendente</p>
                        <p className="text-base font-bold text-amber-700 mt-1">{formatCurrency(Math.max(0, totalRevenue - paidAmount - overdueAmount))}</p>
                      </div>
                      <div className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-rose-600">Em atraso</p>
                        <p className="text-base font-bold text-rose-700 mt-1">{formatCurrency(overdueAmount)}</p>
                      </div>
                    </div>
                  )}

                  {/* Agreements list */}
                  {agreements.map((a) => {
                    const insts = installmentsMap[a.id] ?? [];
                    const paid = insts.filter((i) => i.status === 'pago').length;
                    const overdue = insts.filter((i) => i.status === 'vencido').length;

                    return (
                      <div key={a.id} className="rounded-xl border border-slate-200 overflow-hidden group hover:border-orange-200 transition">
                        <div className="p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-slate-900">{a.title}</p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {formatDate(a.agreement_date)} · {formatCurrency(a.total_value)}
                                {a.fee_type === 'percentage' && a.fee_percentage ? ` · ${a.fee_percentage}% honorários` : ''}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={`px-2.5 py-1 text-[11px] font-semibold rounded-full ${AGREEMENT_STATUS_COLOR[a.status] ?? 'bg-slate-100 text-slate-600'}`}>
                                {AGREEMENT_STATUS_LABEL[a.status] ?? a.status}
                              </span>
                              <button
                                onClick={() => navigateTo('financeiro', { entityId: a.id })}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-orange-600 hover:bg-orange-50 border border-transparent hover:border-orange-200 transition opacity-60 group-hover:opacity-100"
                                title="Abrir no módulo Financeiro"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Abrir</span>
                              </button>
                            </div>
                          </div>

                          {installmentsLoading && !installmentsLoaded ? (
                            <div className="mt-3 flex items-center gap-1.5 text-slate-400 text-xs"><Loader2 className="w-3 h-3 animate-spin" /> Carregando parcelas...</div>
                          ) : insts.length > 0 ? (
                            <div className="mt-3 space-y-3">
                              {/* Progress bar */}
                              <div>
                                <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                                  <span>{paid}/{insts.length} parcelas pagas</span>
                                  {overdue > 0 && <span className="text-rose-600 font-semibold">{overdue} em atraso</span>}
                                </div>
                                <div className="flex gap-0.5">
                                  {insts.map((i) => (
                                    <div
                                      key={i.id}
                                      title={`Parcela ${i.installment_number}: ${i.status} · ${formatCurrency(i.value)} · venc. ${formatDate(i.due_date)}`}
                                      className={`h-2 flex-1 rounded-sm ${
                                        i.status === 'pago' ? 'bg-emerald-400' :
                                        i.status === 'vencido' ? 'bg-rose-400' :
                                        i.status === 'cancelado' ? 'bg-slate-200' :
                                        'bg-amber-200'
                                      }`}
                                    />
                                  ))}
                                </div>
                              </div>

                              {/* Installment rows */}
                              <div className="space-y-1">
                                {insts.map((inst) => {
                                  const isPaying = payingInstallmentId === inst.id;
                                  const canPay = inst.status === 'pendente' || inst.status === 'vencido';
                                  return (
                                    <div key={inst.id} className={`rounded-lg border px-3 py-2 text-xs ${
                                      inst.status === 'pago' ? 'border-emerald-100 bg-emerald-50' :
                                      inst.status === 'vencido' ? 'border-rose-100 bg-rose-50' :
                                      'border-slate-100 bg-white'
                                    }`}>
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
                                            inst.status === 'pago' ? 'bg-emerald-100 text-emerald-700' :
                                            inst.status === 'vencido' ? 'bg-rose-100 text-rose-700' :
                                            'bg-slate-100 text-slate-500'
                                          }`}>{inst.installment_number}</span>
                                          <span className="font-semibold text-slate-700">{formatCurrency(inst.value)}</span>
                                          <span className="text-slate-400">venc. {formatDate(inst.due_date)}</span>
                                          {inst.status === 'pago' && inst.payment_date && (
                                            <span className="text-emerald-600">pago em {formatDate(inst.payment_date)}</span>
                                          )}
                                          {inst.status === 'vencido' && (
                                            <span className="text-rose-600 font-semibold">Em atraso</span>
                                          )}
                                        </div>
                                        {canPay && !isPaying && (
                                          <button
                                            onClick={() => {
                                              setPayingInstallmentId(inst.id);
                                              setPayForm({ date: new Date().toISOString().split('T')[0], method: 'pix', value: inst.value });
                                            }}
                                            className="flex-shrink-0 px-2.5 py-1 rounded-lg border border-emerald-200 bg-white text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 transition"
                                          >
                                            Dar baixa
                                          </button>
                                        )}
                                        {isPaying && (
                                          <button
                                            onClick={() => setPayingInstallmentId(null)}
                                            className="flex-shrink-0 text-slate-400 hover:text-slate-600 text-[11px]"
                                          >
                                            Cancelar
                                          </button>
                                        )}
                                      </div>

                                      {/* Inline pay form */}
                                      {isPaying && (
                                        <div className="mt-2 pt-2 border-t border-slate-100 space-y-2">
                                          <div className="grid grid-cols-3 gap-2">
                                            <div>
                                              <label className="block text-[10px] font-semibold text-slate-400 mb-1">Data pagamento</label>
                                              <input
                                                type="date"
                                                value={payForm.date}
                                                onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))}
                                                className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-300"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-[10px] font-semibold text-slate-400 mb-1">Forma</label>
                                              <select
                                                value={payForm.method}
                                                onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value as PaymentMethod }))}
                                                className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-300"
                                              >
                                                <option value="pix">PIX</option>
                                                <option value="transferencia">Transferência</option>
                                                <option value="dinheiro">Dinheiro</option>
                                                <option value="cheque">Cheque</option>
                                                <option value="cartao_credito">Cartão de Crédito</option>
                                                <option value="cartao_debito">Cartão de Débito</option>
                                              </select>
                                            </div>
                                            <div>
                                              <label className="block text-[10px] font-semibold text-slate-400 mb-1">Valor recebido</label>
                                              <input
                                                type="number"
                                                step="0.01"
                                                value={payForm.value}
                                                onChange={(e) => setPayForm((f) => ({ ...f, value: parseFloat(e.target.value) || 0 }))}
                                                className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-300"
                                              />
                                            </div>
                                          </div>
                                          <button
                                            disabled={paySubmitting}
                                            onClick={() => handlePayInstallment(inst)}
                                            className="w-full py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition"
                                          >
                                            {paySubmitting ? 'Registrando...' : 'Confirmar Baixa'}
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : installmentsLoaded ? (
                            <p className="mt-2 text-xs text-slate-400">Sem parcelas registradas</p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              TAB: PRAZOS
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'deadlines' && (
            <div className="space-y-3">
              {deadlinesLoading ? (
                <div className="flex items-center gap-2 text-slate-400 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Carregando prazos...</div>
              ) : deadlines.length === 0 ? (
                <SectionEmpty text="Nenhum prazo vinculado a este cliente." />
              ) : (
                <>
                  {overdueDeadlines.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-rose-500">Vencidos ({overdueDeadlines.length})</p>
                      {overdueDeadlines.map((d) => (
                        <ModuleItem
                          key={d.id}
                          urgent
                          onOpen={() => navigateTo('prazos', { entityId: d.id })}
                          badge={{ label: 'Vencido', color: 'bg-rose-100 text-rose-700' }}
                        >
                          <p className="text-sm font-bold text-rose-800">{d.title}</p>
                          <p className="text-xs text-rose-600 mt-0.5">Venceu em {formatDate(d.due_date)}</p>
                          {d.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{d.description}</p>}
                        </ModuleItem>
                      ))}
                    </div>
                  )}

                  {upcomingDeadlines.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Pendentes ({upcomingDeadlines.length})</p>
                      {upcomingDeadlines.map((d) => {
                        const daysLeft = Math.ceil((new Date(d.due_date).getTime() - Date.now()) / 86400000);
                        const isUrgent = daysLeft <= 7;
                        return (
                          <ModuleItem
                            key={d.id}
                            onOpen={() => navigateTo('prazos', { entityId: d.id })}
                            badge={{
                              label: d.priority === 'urgente' ? 'Urgente' : d.priority === 'alta' ? 'Alta' : d.priority === 'media' ? 'Média' : 'Baixa',
                              color: d.priority === 'urgente' || d.priority === 'alta' ? 'bg-rose-100 text-rose-700' : d.priority === 'media' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600',
                            }}
                          >
                            <p className="text-sm font-semibold text-slate-900">{d.title}</p>
                            <p className={`text-xs mt-0.5 font-medium ${isUrgent ? 'text-amber-600' : 'text-slate-500'}`}>
                              {isUrgent ? `⚠ ${daysLeft}d restantes — ` : ''}{formatDate(d.due_date)}
                            </p>
                          </ModuleItem>
                        );
                      })}
                    </div>
                  )}

                  {deadlines.filter((d) => d.status === 'cumprido').length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Cumpridos</p>
                      {deadlines.filter((d) => d.status === 'cumprido').map((d) => (
                        <ModuleItem
                          key={d.id}
                          muted
                          onOpen={() => navigateTo('prazos', { entityId: d.id })}
                          badge={{ label: 'Cumprido', color: 'bg-emerald-100 text-emerald-700' }}
                        >
                          <p className="text-sm font-semibold text-slate-500 line-through">{d.title}</p>
                          <p className="text-xs text-slate-400">{formatDate(d.due_date)}</p>
                        </ModuleItem>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              TAB: REQUERIMENTOS ADMINISTRATIVOS
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'requirements' && (
            <div className="space-y-3">
              {relationsLoading ? (
                <div className="flex items-center gap-2 text-slate-400 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
              ) : requirements.length === 0 ? (
                <SectionEmpty text="Nenhum requerimento administrativo vinculado a este cliente." />
              ) : (
                requirements.map((r) => {
                  const linkedEvents = calendarEvents.filter((e) => e.requirement_id === r.id);
                  const nextPericia = linkedEvents
                    .filter((e) => e.event_type === 'pericia' && e.status === 'pendente' && new Date(e.start_at) >= new Date())
                    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())[0];

                  return (
                    <ModuleItem
                      key={r.id}
                      onOpen={() => navigateTo('requerimentos', { entityId: r.id })}
                      badge={{
                        label: r.status ? r.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Pendente',
                        color: r.status === 'deferido' ? 'bg-emerald-100 text-emerald-700' :
                               r.status === 'indeferido' ? 'bg-rose-100 text-rose-700' :
                               r.status === 'ajuizado' ? 'bg-blue-100 text-blue-700' :
                               'bg-amber-100 text-amber-700',
                      }}
                    >
                      <p className="text-sm font-bold text-slate-900">{r.protocol ?? 'Sem protocolo'}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {r.beneficiary} · {r.benefit_type?.replace(/_/g, ' ')}
                      </p>
                      {/* Perícias do tipo do requerimento */}
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                        {r.pericia_medica_at && (
                          <p className="text-xs font-medium text-blue-700">
                            Perícia médica: {formatDate(r.pericia_medica_at)}
                          </p>
                        )}
                        {r.pericia_social_at && (
                          <p className="text-xs font-medium text-blue-700">
                            Perícia social: {formatDate(r.pericia_social_at)}
                          </p>
                        )}
                        {/* Próxima perícia agendada na agenda */}
                        {nextPericia && (
                          <button
                            onClick={(ev) => { ev.stopPropagation(); navigateTo('agenda', { entityId: nextPericia.id }); }}
                            className="text-xs font-semibold text-violet-600 hover:underline flex items-center gap-0.5"
                          >
                            <Gavel className="w-3 h-3" />
                            {nextPericia.title}: {formatDate(nextPericia.start_at)}
                          </button>
                        )}
                        {/* Exigência */}
                        {r.exigency_due_date && r.status === 'em_exigencia' && (
                          <p className="text-xs font-medium text-rose-600">
                            Exigência vence: {formatDate(r.exigency_due_date)}
                          </p>
                        )}
                      </div>
                    </ModuleItem>
                  );
                })
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              TAB: COMPROMISSOS (AGENDA)
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'agenda' && (() => {
            const now = new Date();

            const TYPE_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string; accent: string }> = {
              hearing:     { label: 'Audiência',     bg: 'bg-violet-100', text: 'text-violet-700', dot: 'bg-violet-500',  accent: 'border-l-violet-400'  },
              pericia:     { label: 'Perícia',       bg: 'bg-cyan-100',   text: 'text-cyan-700',   dot: 'bg-cyan-500',    accent: 'border-l-cyan-400'    },
              meeting:     { label: 'Reunião',       bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-500',    accent: 'border-l-blue-400'    },
              deadline:    { label: 'Prazo',         bg: 'bg-rose-100',   text: 'text-rose-700',   dot: 'bg-rose-500',    accent: 'border-l-rose-400'    },
              requirement: { label: 'Requerimento',  bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500',   accent: 'border-l-amber-400'   },
              payment:     { label: 'Pagamento',     bg: 'bg-emerald-100',text: 'text-emerald-700',dot: 'bg-emerald-500', accent: 'border-l-emerald-400' },
              personal:    { label: 'Pessoal',       bg: 'bg-slate-100',  text: 'text-slate-600',  dot: 'bg-slate-400',   accent: 'border-l-slate-300'   },
            };

            const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
              pendente:  { label: 'Pendente',  cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
              concluido: { label: 'Concluído', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
              cancelado: { label: 'Cancelado', cls: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200' },
            };

            // ── Itens unificados: agenda + audiências de processo + perícias de requerimento ──
            type UnifiedItem =
              | { kind: 'calendar'; event: CalendarEvent; date: Date }
              | { kind: 'process'; process: Process; date: Date; timeStr: string | null }
              | { kind: 'pericia'; req: Requirement; periciaType: 'medica' | 'social'; date: Date };

            const unified: UnifiedItem[] = [];

            // Eventos reais da agenda
            calendarEvents.forEach((e) => {
              const d = new Date(e.start_at);
              if (!isNaN(d.getTime())) unified.push({ kind: 'calendar', event: e, date: d });
            });

            // Audiências de processo (hearing_date) que ainda não têm evento de agenda vinculado
            const calProcessIds = new Set(calendarEvents.map((e) => e.process_id).filter(Boolean));
            processes.forEach((p) => {
              if (!p.hearing_date) return;
              if (calProcessIds.has(p.id)) return; // já coberto por evento de agenda
              const d = new Date(p.hearing_date);
              if (isNaN(d.getTime())) return;
              const timeStr = (p as any).hearing_time ? String((p as any).hearing_time).slice(0, 5) : null;
              unified.push({ kind: 'process', process: p, date: d, timeStr });
            });

            // Perícias de requerimento que ainda não têm evento de agenda vinculado
            const calReqIds = new Set(calendarEvents.map((e) => e.requirement_id).filter(Boolean));
            requirements.forEach((r) => {
              if (calReqIds.has(r.id)) return;
              if (r.pericia_medica_at) {
                const d = new Date(r.pericia_medica_at);
                if (!isNaN(d.getTime())) unified.push({ kind: 'pericia', req: r, periciaType: 'medica', date: d });
              }
              if (r.pericia_social_at) {
                const d = new Date(r.pericia_social_at);
                if (!isNaN(d.getTime())) unified.push({ kind: 'pericia', req: r, periciaType: 'social', date: d });
              }
            });

            unified.sort((a, b) => a.date.getTime() - b.date.getTime());

            const upcoming = unified.filter((u) => {
              if (u.kind === 'calendar') return u.event.status === 'pendente' && u.date >= now;
              return u.date >= now;
            });
            const past = unified.filter((u) => {
              if (u.kind === 'calendar') return u.event.status !== 'pendente' || u.date < now;
              return u.date < now;
            }).reverse();

            const Row = ({ u }: { u: UnifiedItem }) => {
              const isFuture = u.kind === 'calendar'
                ? u.event.status === 'pendente' && u.date >= now
                : u.date >= now;

              let tc = TYPE_CONFIG.hearing as { label: string; bg: string; text: string; dot: string; accent: string };
              let label = '';
              let title = '';
              let subtitle = '';
              let statusBadge = '';
              let onClick = () => {};
              let timeStr: string | null = null;
              let hasTime = false;

              if (u.kind === 'calendar') {
                tc = TYPE_CONFIG[u.event.event_type] ?? { label: u.event.event_type, bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400', accent: 'border-l-slate-300' };
                label = tc.label;
                title = u.event.title;
                subtitle = u.event.description ?? '';
                onClick = () => navigateTo('agenda', { entityId: u.event.id } as any);
                hasTime = u.event.start_at.includes('T');
                const isMidnight = u.date.getHours() === 0 && u.date.getMinutes() === 0;
                timeStr = hasTime && !isMidnight ? u.date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
              } else if (u.kind === 'process') {
                tc = TYPE_CONFIG.hearing;
                label = 'Audiência';
                title = u.process.process_code || 'Processo sem número';
                subtitle = [PRACTICE_AREA_LABEL[u.process.practice_area] ?? u.process.practice_area, u.process.court].filter(Boolean).join(' · ');
                onClick = () => events.emit(SYSTEM_EVENTS.NAVIGATE_REQUEST, { module: 'processos', params: { entityId: u.process.id } });
                timeStr = u.timeStr;
              } else {
                tc = TYPE_CONFIG.pericia;
                label = u.periciaType === 'medica' ? 'Perícia Médica' : 'Perícia Social';
                title = u.req.beneficiary || u.req.protocol || 'Requerimento';
                subtitle = BENEFIT_LABEL[u.req.benefit_type] ?? u.req.benefit_type ?? '';
                onClick = () => navigateTo('requerimentos', { entityId: u.req.id } as any);
                hasTime = u.kind === 'pericia' && (u.periciaType === 'medica' ? (u.req.pericia_medica_at ?? '').includes('T') : (u.req.pericia_social_at ?? '').includes('T'));
                timeStr = hasTime ? u.date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
              }

              const statusCls = u.kind === 'calendar' ? STATUS_CONFIG[u.event.status] : null;

              return (
                <button
                  type="button"
                  onClick={onClick}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border-l-4 transition group ${tc.accent} ${
                    isFuture
                      ? 'bg-white border border-slate-200 hover:border-orange-200 hover:shadow-sm'
                      : 'bg-slate-50 border border-slate-100 opacity-60 hover:opacity-80'
                  }`}
                >
                  {/* Tipo */}
                  <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-md ${tc.bg} ${tc.text} whitespace-nowrap`}>{label}</span>

                  {/* Título + subtítulo */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate group-hover:text-orange-600 transition-colors ${isFuture ? 'text-slate-900' : 'text-slate-500'}`}>{title}</p>
                    {subtitle && <p className="text-[11px] text-slate-400 truncate mt-0.5">{subtitle}</p>}
                  </div>

                  {/* Data + hora + status */}
                  <div className="flex-shrink-0 text-right space-y-0.5">
                    {statusCls && (
                      <p><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusCls.cls}`}>{statusCls.label}</span></p>
                    )}
                    <p className={`text-xs font-semibold tabular-nums ${isFuture ? 'text-slate-700' : 'text-slate-400'}`}>
                      {u.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </p>
                    {timeStr && (
                      <p className={`text-[11px] tabular-nums font-medium ${isFuture ? 'text-slate-500' : 'text-slate-300'}`}>{timeStr}</p>
                    )}
                  </div>
                </button>
              );
            };

            return (
              <div className="space-y-5">
                {calendarLoading || relationsLoading ? (
                  <div className="flex items-center gap-2 text-slate-400 py-6"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
                ) : unified.length === 0 ? (
                  <div className="text-center py-10">
                    <CalendarIcon className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">Nenhum compromisso vinculado a este cliente.</p>
                  </div>
                ) : (
                  <>
                    {upcoming.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Próximos ({upcoming.length})</p>
                        <div className="space-y-2">{upcoming.map((u, i) => <Row key={i} u={u} />)}</div>
                      </div>
                    )}
                    {past.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Passados / Concluídos ({past.length})</p>
                        <div className="space-y-2">{past.map((u, i) => <Row key={i} u={u} />)}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          {/* ═══════════════════════════════════════════════════════════════════
              TAB: ASSINATURAS
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'assinaturas' && (() => {
            const SIG_STATUS: Record<string, { label: string; cls: string; strip: string }> = {
              pending:   { label: 'Pendente',  cls: 'bg-amber-100 text-amber-700',   strip: 'bg-amber-400' },
              signed:    { label: 'Assinado',  cls: 'bg-emerald-100 text-emerald-700', strip: 'bg-emerald-400' },
              expired:   { label: 'Expirado',  cls: 'bg-red-100 text-red-600',       strip: 'bg-red-400' },
              cancelled: { label: 'Cancelado', cls: 'bg-slate-100 text-slate-500',   strip: 'bg-slate-300' },
            };
            return (
              <div className="space-y-3">
                {/* CTA criar */}
                <div className="flex justify-end">
                  <button
                    onClick={() => events.emit(SYSTEM_EVENTS.NAVIGATE_REQUEST, { module: 'assinaturas', params: { prefill: { client_id: client.id } } })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" /> Nova assinatura
                  </button>
                </div>

                {signatureLoading ? (
                  <div className="flex items-center gap-2 text-slate-400 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
                ) : signatureRequests.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center">
                    <PenTool className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">Nenhuma assinatura digital vinculada a este cliente.</p>
                    <button
                      onClick={() => events.emit(SYSTEM_EVENTS.NAVIGATE_REQUEST, { module: 'assinaturas', params: { prefill: { client_id: client.id } } })}
                      className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-violet-600 hover:text-violet-800 hover:bg-violet-50 border border-violet-200 transition"
                    >
                      <Plus className="w-3.5 h-3.5" /> Criar primeira assinatura
                    </button>
                  </div>
                ) : (
                  signatureRequests.map((r) => {
                    const sc = SIG_STATUS[r.status] ?? SIG_STATUS.pending;
                    const signers = r.signers ?? [];
                    const signersSigned = signers.filter(s => s.status === 'signed').length;
                    return (
                      <div key={r.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden hover:border-violet-200 hover:shadow-md transition-all duration-200 group">
                        <div className={`h-[3px] w-full ${sc.strip}`} />
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-slate-900 truncate">{r.document_name ?? 'Documento'}</p>
                              {r.process_number && (
                                <p className="text-[11px] text-slate-400 mt-0.5 font-mono">{r.process_number}</p>
                              )}
                              <p className="text-[11px] text-slate-400 mt-0.5">{formatDate(r.created_at)}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={`px-2.5 py-1 text-[10px] font-bold rounded-full ${sc.cls}`}>{sc.label}</span>
                              <button
                                onClick={() => events.emit(SYSTEM_EVENTS.NAVIGATE_REQUEST, { module: 'assinaturas', params: { mode: 'details', requestId: r.id } })}
                                className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-slate-500 hover:text-violet-600 hover:bg-violet-50 border border-transparent hover:border-violet-200 transition"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                Abrir
                              </button>
                            </div>
                          </div>
                          {/* Progresso de signatários */}
                          {signers.length > 0 && (
                            <div className="mt-3">
                              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1.5">
                                <span className="flex items-center gap-1"><User className="w-3 h-3" /> Signatários</span>
                                <span className="font-semibold tabular-nums">{signersSigned}/{signers.length}</span>
                              </div>
                              <div className="flex gap-0.5">
                                {signers.map(s => (
                                  <div
                                    key={s.id}
                                    title={`${s.name ?? 'Signatário'}: ${s.status}`}
                                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                                      s.status === 'signed' ? 'bg-emerald-400' : s.status === 'cancelled' ? 'bg-slate-200' : 'bg-amber-200'
                                    }`}
                                  />
                                ))}
                              </div>
                              {/* Nomes dos signatários */}
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {signers.map(s => (
                                  <span key={s.id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                    s.status === 'signed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-50 text-slate-500 border border-slate-200'
                                  }`}>
                                    {s.status === 'signed' && <Check className="w-2.5 h-2.5" />}
                                    {s.name ?? 'Signatário'}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })()}

          {/* ═══════════════════════════════════════════════════════════════════
              TAB: DOCUMENTOS
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'documents' && (
            <div className="space-y-6">
              {/* Solicitações de documentos — sempre no topo */}
              <DocumentRequestsAdmin client={client} />

              {signatureLoading || petitionsLoading || cloudFoldersLoading ? (
                <div className="flex items-center gap-2 text-slate-400 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Carregando documentos...</div>
              ) : (
                <>
                  {/* Assinados — seção em destaque */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <FileCheck className="w-4 h-4 text-emerald-600" />
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Contratos / Docs Assinados</p>
                      {signedDocuments.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">{signedDocuments.length}</span>
                      )}
                    </div>
                    {signedDocuments.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 py-4 text-center text-slate-400 text-sm">
                        Nenhum documento assinado registrado
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {signedDocuments.map((r) => {
                          const signer = (r.signers ?? []).find((s) => Boolean(s.signed_document_path)) ?? null;
                          const signedAt = r.signed_at ?? signer?.signed_at ?? null;
                          return (
                            <div key={r.id} className="rounded-xl border border-emerald-100 bg-emerald-50 p-3.5 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900 truncate">{r.document_name ?? 'Documento'}</p>
                                <p className="text-xs text-emerald-700 mt-0.5">
                                  <FileCheck className="w-3 h-3 inline mr-1" />
                                  Assinado{signedAt ? ` em ${formatDateTime(signedAt)}` : ''}
                                </p>
                              </div>
                              {signer?.signed_document_path && (
                                <button
                                  onClick={async () => {
                                    const url = await pdfSignatureService.getSignedPdfUrl(signer.signed_document_path!);
                                    if (url) window.open(url, '_blank');
                                  }}
                                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-white text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                                >
                                  <FileText className="w-3.5 h-3.5" /> Ver PDF
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Gerados — aguardando assinatura */}
                  {generatedDocuments.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-500" />
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Aguardando Assinatura</p>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">{generatedDocuments.length}</span>
                      </div>
                      <div className="space-y-2">
                        {generatedDocuments.map((r) => (
                          <div
                            key={r.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => { onBack(); navigateTo('assinaturas', { mode: 'details', requestId: r.id } as any); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { onBack(); navigateTo('assinaturas', { mode: 'details', requestId: r.id } as any); } }}
                            className="rounded-xl border border-amber-100 bg-amber-50 p-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-amber-100 hover:border-amber-200 transition-colors"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900 truncate">{r.document_name ?? 'Documento'}</p>
                              <p className="text-xs text-slate-500 mt-0.5">Gerado em {formatDateTime(r.created_at)}</p>
                            </div>
                            <span className="flex-shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-amber-100 text-amber-700">
                              Pendente
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Petições */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <PenTool className="w-4 h-4 text-amber-600" />
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Petições</p>
                      {clientPetitions.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">{clientPetitions.length}</span>
                      )}
                    </div>
                    {clientPetitions.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 py-4 text-center text-slate-400 text-sm">
                        Nenhuma petição vinculada
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {clientPetitions.map((p) => (
                          <div key={p.id} className="rounded-xl border border-slate-200 p-3.5 flex items-center justify-between gap-3 group">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900 truncate">{p.title ?? 'Sem título'}</p>
                              <p className="text-xs text-slate-400 mt-0.5">Atualizada em {formatDateTime(p.updated_at)}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                onClick={() => events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN, { clientId: client.id, petitionId: p.id })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                <PenTool className="w-3.5 h-3.5" /> Abrir
                              </button>
                              <button
                                onClick={async () => {
                                  const ok = await confirmDelete({ title: 'Excluir petição', entityName: p.title ?? '', message: `Deseja excluir "${p.title}"?`, confirmLabel: 'Excluir' });
                                  if (!ok) return;
                                  await petitionEditorService.deletePetition(p.id);
                                  setClientPetitions((prev) => prev.filter((x) => x.id !== p.id));
                                }}
                                className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Cloud */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <FolderPlus className="w-4 h-4 text-sky-500" />
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Pastas do Cloud</p>
                      {clientCloudFolders.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-700">{clientCloudFolders.length}</span>
                      )}
                    </div>
                    {clientCloudFolders.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 py-4 text-center text-slate-400 text-sm">
                        Nenhuma pasta vinculada
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {clientCloudFolders.map((f) => (
                          <div
                            key={f.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => { onBack(); navigateTo('cloud', { folderId: f.id } as any); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { onBack(); navigateTo('cloud', { folderId: f.id } as any); } }}
                            className="rounded-xl border border-slate-200 p-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors"
                          >
                            <div className="min-w-0 flex items-center gap-2.5">
                              <FolderPlus className="w-4 h-4 text-amber-500 flex-shrink-0" />
                              <div>
                                <p className="text-sm font-semibold text-slate-900">{f.name}</p>
                                <p className="text-xs text-slate-400">Atualizada em {formatDateTime(f.updated_at)}</p>
                              </div>
                            </div>
                            <span className={`flex-shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-full ${f.archived_at ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {f.archived_at ? 'Arquivada' : 'Ativa'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default ClientDetails;
