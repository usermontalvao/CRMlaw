import React, { useEffect, useMemo, useState } from 'react';
import {
  FileText, FileCheck, Plus, Clock, FolderPlus,
  Gavel, Loader2, PenTool, Trash2, DollarSign, AlertTriangle,
  Scale, ExternalLink, Search, Printer, CalendarPlus, StickyNote,
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

type Tab = 'data' | 'processes' | 'financial' | 'deadlines' | 'requirements' | 'documents' | 'overview';

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

// ─── Timeline event builder ───────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  description?: string;
  dotColor: string;
  future?: boolean;
}

function buildTimeline(
  processes: Process[],
  _tasks: unknown[],
  agreements: Agreement[],
  signatures: SignatureRequestWithSigners[],
  petitions: SavedPetition[],
  calEvents: CalendarEvent[] = [],
): TimelineEvent[] {
  const evts: TimelineEvent[] = [];
  const now = new Date();

  processes.forEach((p) => {
    evts.push({
      id: `process-open-${p.id}`,
      date: p.created_at,
      title: `Processo aberto${p.process_code ? `: ${p.process_code}` : ''}`,
      description: PRACTICE_AREA_LABEL[p.practice_area] ?? p.practice_area,
      dotColor: 'bg-blue-500',
    });
    if (p.hearing_date) {
      const isFuture = new Date(p.hearing_date) >= now;
      evts.push({
        id: `hearing-${p.id}`,
        date: p.hearing_date,
        title: `Audiência${p.process_code ? ` — ${p.process_code}` : ''}`,
        description: p.court ?? undefined,
        dotColor: isFuture ? 'bg-violet-500' : 'bg-violet-300',
        future: isFuture,
      });
    }
  });


  agreements.forEach((a) => {
    evts.push({
      id: `agreement-${a.id}`,
      date: a.created_at,
      title: `Acordo financeiro: ${a.title}`,
      description: formatCurrency(a.total_value),
      dotColor: 'bg-emerald-500',
    });
  });

  signatures.forEach((s) => {
    evts.push({
      id: `sig-${s.id}`,
      date: s.created_at,
      title: `Documento gerado: ${s.document_name ?? 'Documento'}`,
      dotColor: 'bg-slate-400',
    });
    if (s.signed_at) {
      evts.push({
        id: `sig-signed-${s.id}`,
        date: s.signed_at,
        title: `Documento assinado: ${s.document_name ?? 'Documento'}`,
        dotColor: 'bg-emerald-500',
      });
    }
  });

  petitions.forEach((p) => {
    evts.push({
      id: `petition-${p.id}`,
      date: p.created_at,
      title: `Petição: ${p.title ?? 'Sem título'}`,
      dotColor: 'bg-amber-500',
    });
  });

  const typeLabel: Record<string, string> = { hearing: 'Audiência', pericia: 'Perícia', meeting: 'Reunião', deadline: 'Prazo', requirement: 'Requerimento', payment: 'Pagamento' };
  const typeColor: Record<string, string> = { hearing: 'bg-violet-500', pericia: 'bg-blue-500', meeting: 'bg-slate-400', deadline: 'bg-rose-400', requirement: 'bg-amber-500', payment: 'bg-emerald-500' };
  calEvents.forEach((e) => {
    const isFuture = new Date(e.start_at) >= now;
    evts.push({
      id: `cal-${e.id}`,
      date: e.start_at,
      title: `${typeLabel[e.event_type] ?? e.event_type}: ${e.title}`,
      description: e.description ?? undefined,
      dotColor: typeColor[e.event_type] ?? 'bg-slate-400',
      future: isFuture,
    });
  });

  return evts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

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
        const valid = withUrls.filter(Boolean) as Array<{ path: string; url: string; label: string }>;
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

    void Promise.all([loadSignatures(), loadPetitions(), loadCloud(), loadDeadlines(), loadFinancial(), loadCalendar()]);
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
    () => processes.filter((p) => p.status !== 'arquivado'),
    [processes],
  );

  const activeRequirements = useMemo(
    () => requirements.filter((r) => r.status !== 'deferido' && r.status !== 'indeferido'),
    [requirements],
  );

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
      .filter((e) => (e.event_type === 'hearing' || e.event_type === 'pericia') && e.status === 'pendente' && new Date(e.start_at) >= now)
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())[0];
    if (fromCalendar) return { date: fromCalendar.start_at, label: EVENT_TYPE_LABEL[fromCalendar.event_type] ?? 'Compromisso', type: 'calendar' as const, id: fromCalendar.id };
    const fromProcess = processes
      .filter((p) => p.hearing_date && new Date(p.hearing_date) >= now)
      .sort((a, b) => new Date(a.hearing_date!).getTime() - new Date(b.hearing_date!).getTime())[0];
    if (fromProcess) return { date: fromProcess.hearing_date!, label: 'Audiência', type: 'process' as const, id: fromProcess.id };
    return null;
  }, [calendarEvents, processes]);

  // Compromissos futuros agrupados (sem eventos de pagamento — esses são financeiros)
  const upcomingEvents = useMemo(() => {
    const now = new Date();
    return calendarEvents
      .filter((e) => e.status === 'pendente' && new Date(e.start_at) >= now && e.event_type !== 'payment')
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  }, [calendarEvents]);

  const totalRevenue = useMemo(() => agreements.reduce((s, a) => s + a.total_value, 0), [agreements]);

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

  const timelineEvents = useMemo(
    () => buildTimeline(processes, [], agreements, signatureRequests, clientPetitions, calendarEvents),
    [processes, agreements, signatureRequests, clientPetitions, calendarEvents],
  );

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
    { id: 'documents', label: 'Documentos' },
    { id: 'overview', label: 'Histórico' },
  ];

  return (
    <div className="w-full space-y-4 text-xs sm:text-sm">

      {/* ── KPI Row + Selfie ── */}
      <div className="flex gap-3 items-start">
        {/* Foto de perfil */}
        {selfies.length > 0 && (() => {
          const profileSelfie = (pinnedPath ? selfies.find((s) => s.path === pinnedPath) : null) ?? selfies[0];
          return (
            <div className="flex-shrink-0 flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => setPreviewSelfie(profileSelfie)}
                className="group relative w-[88px] h-[110px] rounded-xl overflow-hidden border-2 border-white shadow-md ring-1 ring-slate-200 hover:ring-orange-300 transition focus:outline-none block"
                title="Ampliar foto"
              >
                <img src={profileSelfie.url} alt={client.full_name} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <svg className="w-6 h-6 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"/></svg>
                </div>
                <span className="absolute top-1.5 left-1.5 bg-emerald-500 text-white text-[8px] font-bold px-1 py-0.5 rounded shadow">ID</span>
                {selfies.length > 1 && (
                  <span className="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">+{selfies.length - 1}</span>
                )}
              </button>
              {selfies.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSelfiePickerOpen(true)}
                  className="text-[10px] font-semibold text-orange-600 hover:text-orange-700 transition"
                >
                  Gerenciar
                </button>
              )}
            </div>
          );
        })()}

        {/* KPI cards */}
        <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Casos ativos"
          value={relationsLoading ? '…' : activeProcesses.length + activeRequirements.length}
          sub={relationsLoading ? undefined : `${activeProcesses.length} processo(s) · ${activeRequirements.length} req.`}
          color="border-blue-100 bg-blue-50 text-blue-800"
          icon={Scale}
        />
        <KpiCard
          label="Receita total"
          value={financialLoading ? '…' : formatCurrency(totalRevenue)}
          sub={agreements.length > 0 ? `${agreements.length} acordo(s)` : 'Sem acordos'}
          color="border-emerald-100 bg-emerald-50 text-emerald-800"
          icon={DollarSign}
        />
        <KpiCard
          label="Prazos pendentes"
          value={deadlinesLoading ? '…' : pendingDeadlines.length + overdueDeadlines.length}
          sub={overdueDeadlines.length > 0 ? `${overdueDeadlines.length} vencido(s)` : upcomingDeadlines[0] ? `Próximo: ${formatDate(upcomingDeadlines[0].due_date)}` : 'Em dia'}
          color={overdueDeadlines.length > 0 ? 'border-rose-100 bg-rose-50 text-rose-800' : 'border-amber-100 bg-amber-50 text-amber-800'}
          icon={overdueDeadlines.length > 0 ? AlertTriangle : Gavel}
        />
        <KpiCard
          label="Próximo Compromisso"
          value={nextHearing ? formatDate(nextHearing.date) : '—'}
          sub={nextHearing ? nextHearing.label : 'Nenhuma agendada'}
          color="border-violet-100 bg-violet-50 text-violet-800"
          icon={Gavel}
        />
        </div>{/* end KPI grid */}
      </div>{/* end flex row */}

      {/* ── Preview modal (full-size) ── */}
      {previewSelfie && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setPreviewSelfie(null)}>
          <div className="relative max-w-xs w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPreviewSelfie(null)} className="absolute -top-3 -right-3 z-10 bg-white rounded-full p-1.5 shadow-lg hover:bg-slate-100 transition">
              <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
            <img src={previewSelfie.url} alt={client.full_name} className="w-full rounded-2xl shadow-2xl object-cover" style={{ maxHeight: '80vh' }} />
            <div className="mt-2 text-center">
              <p className="text-sm font-semibold text-white">{client.full_name}</p>
              <p className="text-xs text-white/60 mt-0.5">{previewSelfie.label}</p>
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

        const handleUnpin = async () => {
          setSettingPhoto(true);
          try {
            await clientService.setClientPhoto(client.id, null);
            setPinnedPath(null);
            (client as any).photo_path = null;
          } catch (err: any) { alert(err?.message ?? 'Erro ao remover foto'); }
          finally { setSettingPhoto(false); }
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setSelfiePickerOpen(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 flex flex-col overflow-hidden" style={{ maxHeight: '80vh' }} onClick={(e) => e.stopPropagation()}>

              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <p className="text-sm font-semibold text-slate-800">Fotos coletadas ({selfies.length})</p>
                <button onClick={() => setSelfiePickerOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {selfies.map((s) => {
                  const isProfile = pinnedPath ? pinnedPath === s.path : s.path === selfies[0].path;
                  return (
                    <div key={s.path} className={`flex items-center gap-3 px-4 py-3 ${isProfile ? 'bg-orange-50' : 'hover:bg-slate-50'} transition`}>
                      {/* Thumbnail — clique abre preview */}
                      <button
                        type="button"
                        onClick={() => setPreviewSelfie(s)}
                        className={`flex-shrink-0 w-12 h-14 rounded-lg overflow-hidden ring-2 ring-offset-1 transition hover:ring-orange-300 focus:outline-none ${isProfile ? 'ring-orange-400' : 'ring-slate-200'}`}
                      >
                        <img src={s.url} alt="" className="w-full h-full object-cover" />
                      </button>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-700 truncate leading-tight">{s.label}</p>
                        {isProfile && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-orange-600 mt-0.5">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                            Foto do perfil
                          </span>
                        )}
                      </div>

                      {/* Action */}
                      <div className="flex-shrink-0">
                        {isProfile ? (
                          <button
                            onClick={() => void handleUnpin()}
                            disabled={settingPhoto}
                            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 border border-slate-200 transition disabled:opacity-50"
                          >
                            {settingPhoto ? '…' : 'Remover'}
                          </button>
                        ) : (
                          <button
                            onClick={() => void handlePin(s.path)}
                            disabled={settingPhoto}
                            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 transition disabled:opacity-50"
                          >
                            {settingPhoto ? '…' : 'Usar no perfil'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between">
                <p className="text-[11px] text-slate-400">Clique na miniatura para ampliar</p>
                {pinnedPath && (
                  <button onClick={() => void handleUnpin()} disabled={settingPhoto} className="text-[11px] font-semibold text-red-400 hover:text-red-600 transition disabled:opacity-50">
                    Excluir do perfil
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Quick Actions ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex flex-wrap gap-2">
          {onCreateProcess && (
            <button
              onClick={onCreateProcess}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Novo Processo
            </button>
          )}
          {onCreateRequirement && (
            <button
              onClick={onCreateRequirement}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Novo Requerimento
            </button>
          )}
          {onCreateDeadline && (
            <button
              onClick={onCreateDeadline}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Novo Prazo
            </button>
          )}
          <button
            onClick={() => events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN, { clientId: client.id })}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-amber-200 bg-amber-50 text-sm font-semibold text-amber-700 hover:bg-amber-100 transition"
          >
            <PenTool className="w-3.5 h-3.5" /> Nova Petição
          </button>
          <button
            onClick={() => navigateTo('agenda', { mode: 'create', prefill: { client_id: client.id, client_name: client.full_name } } as any)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-violet-200 bg-violet-50 text-sm font-semibold text-violet-700 hover:bg-violet-100 transition"
          >
            <CalendarPlus className="w-3.5 h-3.5" /> Novo Compromisso
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
          >
            <Printer className="w-3.5 h-3.5" /> Exportar
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-100 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 px-5 py-3 text-sm font-semibold transition border-b-2 ${
                activeTab === tab.id
                  ? 'border-orange-500 text-orange-600 bg-orange-50/40'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  activeTab === tab.id ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'
                }`}>{tab.count}</span>
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

              {/* Status + tipo + cliente desde */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-semibold tracking-widest uppercase text-slate-400 mb-1.5">Status</p>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                    client.status === 'ativo' ? 'bg-emerald-100 text-emerald-700' :
                    client.status === 'inativo' ? 'bg-slate-200 text-slate-600' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {client.status.charAt(0).toUpperCase() + client.status.slice(1)}
                  </span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-semibold tracking-widest uppercase text-slate-400 mb-1.5">Tipo</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {client.client_type === 'pessoa_fisica' ? 'Pessoa Física' : 'Pessoa Jurídica'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-semibold tracking-widest uppercase text-slate-400 mb-1.5">Cliente desde</p>
                  <p className="text-sm font-semibold text-slate-900">{formatDate(client.created_at)}</p>
                </div>
              </div>

              {/* Dados pessoais */}
              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Dados Pessoais</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
                  <InfoItem label={client.client_type === 'pessoa_fisica' ? 'CPF' : 'CNPJ'} value={formattedDoc || '—'} />
                  {client.client_type === 'pessoa_fisica' && <InfoItem label="RG" value={client.rg} />}
                  {client.client_type === 'pessoa_fisica' && <InfoItem label="Nascimento" value={formatDate(client.birth_date)} />}
                  <InfoItem label="Nacionalidade" value={client.nationality} />
                  {client.client_type === 'pessoa_fisica' && <InfoItem label="Estado civil" value={client.marital_status} />}
                  <InfoItem label="Profissão" value={client.profession} />
                </div>
              </div>

              {/* Contato */}
              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Contato</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                  <InfoItem label="E-mail" value={client.email
                    ? <a href={`mailto:${client.email}`} className="text-blue-600 hover:underline">{client.email}</a>
                    : '—'}
                  />
                  <div>
                    <InfoItem label="Telefone / Celular" value={formattedPhone || '—'} />
                    {whatsappLink && (
                      <a href={whatsappLink} target="_blank" rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:underline">
                        Abrir no WhatsApp →
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Endereço */}
              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Endereço</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
                  <InfoItem label="Rua" value={client.address_street} />
                  <InfoItem label="Número" value={client.address_number} />
                  <InfoItem label="Bairro" value={client.address_neighborhood} />
                  <InfoItem label="Cidade" value={client.address_city} />
                  <InfoItem label="UF" value={client.address_state} />
                  <InfoItem label="CEP" value={client.address_zip_code} />
                </div>
              </div>

              {/* Compromissos da Agenda */}
              {(calendarLoading || upcomingEvents.length > 0) && (
                <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-widest text-violet-500">Próximos Compromissos</p>
                    <button
                      onClick={() => navigateTo('agenda', {})}
                      className="text-[11px] font-semibold text-violet-600 hover:underline flex items-center gap-1"
                    >
                      Ver agenda <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                  {calendarLoading ? (
                    <div className="flex items-center gap-2 text-slate-400 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando...</div>
                  ) : (
                    <div className="space-y-2">
                      {upcomingEvents.slice(0, 5).map((e) => {
                        const typeLabel: Record<string, string> = { hearing: 'Audiência', pericia: 'Perícia', meeting: 'Reunião', deadline: 'Prazo', requirement: 'Requerimento', payment: 'Pagamento' };
                        const typeColor: Record<string, string> = { hearing: 'bg-violet-100 text-violet-700', pericia: 'bg-blue-100 text-blue-700', meeting: 'bg-slate-100 text-slate-600', deadline: 'bg-rose-100 text-rose-700', requirement: 'bg-amber-100 text-amber-700', payment: 'bg-emerald-100 text-emerald-700' };
                        return (
                          <button
                            key={e.id}
                            onClick={() => navigateTo('agenda', { entityId: e.id })}
                            className="w-full text-left rounded-lg border border-violet-100 bg-white px-3 py-2.5 hover:border-orange-200 hover:bg-orange-50/30 transition group"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900 truncate">{e.title}</p>
                                <p className="text-xs text-slate-500 mt-0.5">{formatDateTime(e.start_at)}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${typeColor[e.event_type] ?? 'bg-slate-100 text-slate-600'}`}>
                                  {typeLabel[e.event_type] ?? e.event_type}
                                </span>
                                <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-orange-500 transition" />
                              </div>
                            </div>
                          </button>
                        );
                      })}
                      {upcomingEvents.length > 5 && (
                        <button onClick={() => navigateTo('agenda', {})} className="text-xs text-violet-600 font-semibold hover:underline">
                          + {upcomingEvents.length - 5} compromisso(s) a mais
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Notas */}
              {client.notes && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <StickyNote className="w-3.5 h-3.5 text-amber-600" />
                    <p className="text-xs font-bold uppercase tracking-widest text-amber-600">Observações</p>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{client.notes}</p>
                </div>
              )}

              {/* Alerta inadimplência */}
              {installmentsLoaded && overdueAmount > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-rose-800">Cliente com parcelas em atraso</p>
                    <p className="text-xs text-rose-600 mt-0.5">{formatCurrency(overdueAmount)} em aberto</p>
                  </div>
                  <button onClick={() => setActiveTab('financial')} className="text-xs font-semibold text-rose-700 hover:underline flex-shrink-0">
                    Ver Financeiro →
                  </button>
                </div>
              )}

              {/* Sistema */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Informações do Sistema</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
                  <InfoItem label="Cadastro" value={formatDateTime(client.created_at)} />
                  <InfoItem label="Última atualização" value={formatDateTime(client.updated_at)} />
                  <InfoItem label="ID interno" value={client.id.slice(0, 8).toUpperCase()} />
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              TAB: HISTÓRICO — Timeline
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'overview' && (
            <div className="space-y-3">
              {/* Busca no histórico */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Filtrar histórico..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-300"
                />
              </div>

              {(() => {
                const filtered = historySearch.trim()
                  ? timelineEvents.filter((e) =>
                      e.title.toLowerCase().includes(historySearch.toLowerCase()) ||
                      (e.description ?? '').toLowerCase().includes(historySearch.toLowerCase()),
                    )
                  : timelineEvents;

                if (filtered.length === 0)
                  return <SectionEmpty text={historySearch ? 'Nenhum resultado encontrado.' : 'Nenhuma atividade registrada.'} />;

                return (
                  <div className="relative">
                    <div className="absolute left-3.5 top-2 bottom-2 w-0.5 bg-slate-100" />
                    <div className="space-y-0">
                      {filtered.map((evt) => (
                        <div key={evt.id} className="relative flex gap-4 pb-5 last:pb-0">
                          <div className={`relative z-10 mt-0.5 w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center border-2 border-white shadow-sm ${evt.dotColor}`} />
                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-start justify-between gap-2">
                              <p className={`text-sm font-semibold ${evt.future ? 'text-violet-700' : 'text-slate-900'}`}>
                                {evt.future && <span className="text-[10px] font-bold uppercase tracking-wider mr-1.5 px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded">Futuro</span>}
                                {evt.title}
                              </p>
                              <p className="text-[11px] text-slate-400 whitespace-nowrap flex-shrink-0">{formatDate(evt.date)}</p>
                            </div>
                            {evt.description && <p className="text-xs text-slate-500 mt-0.5">{evt.description}</p>}
                          </div>
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
            <div className="space-y-3">
              {relationsLoading ? (
                <div className="flex items-center gap-2 text-slate-400 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
              ) : processes.length === 0 ? (
                <SectionEmpty text="Nenhum processo vinculado a este cliente." />
              ) : (
                processes.map((p) => (
                  <ModuleItem
                    key={p.id}
                    onOpen={() => navigateTo('processos', { entityId: p.id })}
                    badge={{ label: PROCESS_STATUS_LABEL[p.status] ?? p.status, color: PROCESS_STATUS_COLOR[p.status] ?? 'bg-slate-100 text-slate-600' }}
                  >
                    <p className="text-sm font-bold text-slate-900">{p.process_code || 'Código não informado'}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {PRACTICE_AREA_LABEL[p.practice_area] ?? p.practice_area}
                      {p.court && ` · ${p.court}`}
                      {p.responsible_lawyer && ` · Dr(a). ${p.responsible_lawyer}`}
                    </p>
                    {p.hearing_date && (
                      <p className="text-xs text-violet-600 mt-1 font-medium">
                        Audiência: {formatDate(p.hearing_date)}{p.hearing_mode ? ` (${p.hearing_mode})` : ''}
                      </p>
                    )}
                  </ModuleItem>
                ))
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
              TAB: DOCUMENTOS
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'documents' && (
            <div className="space-y-6">
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
                          <div key={r.id} className="rounded-xl border border-amber-100 bg-amber-50 p-3.5 flex items-center justify-between gap-3">
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
                          <div key={f.id} className="rounded-xl border border-slate-200 p-3.5 flex items-center justify-between gap-3">
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
