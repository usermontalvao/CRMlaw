/**
 * PortalRequirementDetails — Detalhes de um Requerimento Administrativo (INSS).
 *
 * Melhorias:
 * - IA para análise contextual do requerimento
 * - Processos vinculados (principal ou MS) exibidos com destaque
 * - Compromissos com riscado inteligente:
 *   • passados → riscado/cinza
 *   • indeferido sem processo → riscado/cancelado em todos
 *   • pendentes → normal
 */
import React, { useEffect, useState } from 'react';
import {
  ArrowLeft, Scale, Loader2, AlertCircle, ShieldCheck,
  Calendar, Clock, CheckCircle2, MapPin, Briefcase, ExternalLink, Sparkles, ChevronRight,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { clientPortalService } from '../services/clientPortal.service';
import { EmptyState, formatDateLong } from '../components/PortalUI';
import {
  requirementMeta, BENEFIT_TYPE_LABELS, TONE_CLASSES,
  REQUIREMENT_JOURNEY, statusMeta,
} from '../lib/domain';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Appointment {
  id: string;
  title: string;
  event_type: string;
  event_mode?: string | null;
  start_at: string;
  status: string;
  description?: string | null;
}

interface LinkedProcess {
  id: string;
  process_code: string;
  status: string;
  practice_area?: string | null;
  court?: string | null;
  requirement_role?: string | null; // 'principal' | 'ms'
  distributed_at?: string | null;
}

interface StatusHistoryEntry {
  from_status: string | null;
  to_status: string;
  changed_at: string;
  changed_by_name?: string | null;
}

interface RequirementFull {
  id: string;
  protocol?: string | null;
  beneficiary: string;
  benefit_type: string;
  status: string;
  entry_date?: string | null;
  exigency_due_date?: string | null;
  pericia_medica_at?: string | null;
  pericia_social_at?: string | null;
  observations?: string | null;
  archived?: boolean;
  updated_at: string;
  appointments?: Appointment[];
  linked_processes?: LinkedProcess[];
  status_history?: StatusHistoryEntry[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtShort(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

/** Se o requerimento foi indeferido MAS tem processos vinculados, a mensagem muda. */
function buildStatusBlock(data: RequirementFull, meta: ReturnType<typeof requirementMeta>) {
  const linked = data.linked_processes || [];
  const hasLinkedProcess = linked.length > 0;
  const isIndeferido = data.status === 'indeferido';

  if (isIndeferido && hasLinkedProcess) {
    return {
      tone: 'attention' as const,
      label: 'Negado — mas com recurso judicial',
      text: 'O INSS negou este pedido, porém seu advogado abriu uma ação judicial para garantir o seu direito. Acompanhe o andamento do processo abaixo.',
    };
  }
  return { tone: meta.urgent ? 'attention' as const : 'ok' as const, label: meta.urgent ? 'Requer atenção' : 'Tudo certo', text: meta.explain };
}

// ── Componente principal ─────────────────────────────────────────────────────

export const PortalRequirementDetails: React.FC<{ requirementId: string }> = ({ requirementId }) => {
  const { session } = useClientAuth();
  const { navigate } = usePortalRouter();
  const [data, setData] = useState<RequirementFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiGeneratedAt, setAiGeneratedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!session?.user?.id || !requirementId) return;
    let mounted = true;
    setLoading(true); setError(null);
    clientPortalService.getRequirement(session.user.id, requirementId)
      .then(d => {
        if (mounted) {
          if (!d) setError('Requerimento não encontrado.');
          else setData(d as RequirementFull);
        }
      })
      .catch((e: Error) => mounted && setError(e.message))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [session?.user?.id, requirementId]);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (error || !data) return (
    <div>
      <BackBtn onClick={() => navigate('casos')} />
      <EmptyState icon={Scale} title="Não foi possível carregar" description={error || 'Requerimento não encontrado.'} />
    </div>
  );

  const meta = requirementMeta(data.status);
  const tone = TONE_CLASSES[meta.tone];
  const benefitLabel = BENEFIT_TYPE_LABELS[data.benefit_type] || data.benefit_type;
  const linked = data.linked_processes || [];
  const isIndeferido = data.status === 'indeferido';

  // Lógica de riscado nos compromissos:
  // – se indeferido → risca TODOS (perícias do INSS não ocorrem mais)
  // – sempre risca passados
  const cancelFutureApts = isIndeferido;
  // Data do indeferimento (updated_at é atualizado quando o status muda)
  const denialDate = isIndeferido ? new Date(data.updated_at) : null;

  const appointments = (data.appointments || []).sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
  );

  const statusBlock = buildStatusBlock(data, meta);

  const handleExplain = async () => {
    if (aiState === 'loading') return;
    if (aiText) { setAiState('done'); return; }
    setAiState('loading');
    const text = await clientPortalService.explainRequirement({
      benefitLabel,
      statusLabel: meta.label,
      entryDate: data.entry_date,
      exigencyDueDate: data.exigency_due_date,
      pericaMedicaAt: data.pericia_medica_at,
      pericaSocialAt: data.pericia_social_at,
      observations: data.observations,
      appointments: appointments.map(a => ({ title: a.title, event_type: a.event_type, start_at: a.start_at, event_mode: a.event_mode })),
      linkedProcesses: linked.map(p => ({
        process_code: p.process_code,
        status: statusMeta(p.status).label,
        practice_area: p.practice_area,
        requirement_role: p.requirement_role,
      })),
    });
    if (text) { setAiText(text); setAiState('done'); setAiGeneratedAt(new Date()); }
    else setAiState('error');
  };

  return (
    <div className="flex flex-col gap-5">
      <BackBtn onClick={() => navigate('casos')} />

      {/* ── CABEÇALHO ── */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
            <span className={`text-sm font-semibold ${tone.text}`}>{meta.label}</span>
            {data.archived && (
              <span className="ml-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Encerrado
              </span>
            )}
          </div>
          <h1 className="mt-3 text-lg font-semibold leading-snug text-slate-900 sm:text-xl">{benefitLabel}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isIndeferido && linked.length > 0
              ? 'O INSS negou este pedido, porém foi aberta uma ação judicial — acompanhe abaixo.'
              : meta.explain}
          </p>
          {data.protocol && (
            <p className="mt-1 font-mono text-xs tabular-nums text-slate-400">Protocolo: {data.protocol}</p>
          )}
        </div>

        {/* Jornada */}
        <div className="border-t border-slate-100 px-5 py-5 sm:px-6">
          <RequirementJourney stage={meta.stage} />
        </div>

        {/* Análise por IA — dentro do card, abaixo da jornada */}
        <div className="border-t border-slate-100 px-5 pb-5 sm:px-6">
          <ReqAiSummary state={aiState} text={aiText} generatedAt={aiGeneratedAt} onGenerate={handleExplain} />
        </div>
      </section>

      {/* ── STATUS CONTEXTUAL ── */}
      <section className={`rounded-xl border border-l-[3px] bg-white p-4 sm:p-5 ${
        statusBlock.tone === 'attention'
          ? 'border-amber-200 border-l-amber-500'
          : 'border-emerald-200 border-l-emerald-500'
      }`}>
        <div className="flex items-start gap-3">
          {statusBlock.tone === 'attention'
            ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            : <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{statusBlock.label}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-slate-700">{statusBlock.text}</p>
          </div>
        </div>
      </section>

      {/* ── PROCESSOS VINCULADOS ── */}
      {linked.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Ação judicial vinculada
          </p>
          {linked.map(p => {
            const pmeta = statusMeta(p.status);
            const ptone = TONE_CLASSES[pmeta.tone];
            const roleLabel = p.requirement_role === 'ms'
              ? 'Mandado de Segurança'
              : 'Processo nascido deste requerimento';
            return (
              <button
                key={p.id}
                onClick={() => navigate('casos', `proc:${p.id}`)}
                className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                  <Briefcase className="h-4 w-4 text-slate-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{roleLabel}</p>
                  <p className="font-mono text-[13px] font-semibold tabular-nums text-slate-900">{p.process_code}</p>
                  {(p.practice_area || p.court) && (
                    <p className="truncate text-[11px] capitalize text-slate-400">{[p.practice_area, p.court].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${ptone.dot}`} />
                  <span className={`text-xs font-medium ${ptone.text}`}>{pmeta.label}</span>
                  <ExternalLink className="ml-1 h-3.5 w-3.5 text-slate-300 transition group-hover:text-slate-500" />
                </div>
              </button>
            );
          })}
        </section>
      )}


      {/* ── DATAS RELEVANTES ── */}
      {(() => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const isFuture = (iso?: string | null) => !!iso && new Date(iso) >= today;
        return (
          <dl className="grid grid-cols-1 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <InfoRow label="Data de entrada" value={fmt(data.entry_date)} icon={Calendar} />
            {data.exigency_due_date && (
              <InfoRow label="Prazo da exigência" value={fmt(data.exigency_due_date)} icon={Clock} highlight={isFuture(data.exigency_due_date)} />
            )}
            {data.pericia_medica_at && (
              <InfoRow label="Perícia médica" value={fmt(data.pericia_medica_at)} icon={Calendar} highlight={isFuture(data.pericia_medica_at)} past={!isFuture(data.pericia_medica_at)} />
            )}
            {data.pericia_social_at && (
              <InfoRow label="Perícia social" value={fmt(data.pericia_social_at)} icon={Calendar} highlight={isFuture(data.pericia_social_at)} past={!isFuture(data.pericia_social_at)} />
            )}
            {!data.exigency_due_date && !data.pericia_medica_at && !data.pericia_social_at && (
              <InfoRow label="Última atualização" value={fmt(data.updated_at)} icon={Clock} />
            )}
          </dl>
        );
      })()}

      {/* ── OBSERVAÇÕES ── */}
      {data.observations && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Observações do escritório</p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{data.observations}</p>
        </section>
      )}

      {/* ── COMPROMISSOS ── */}
      {appointments.length > 0 && (
        <section className="flex flex-col gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Compromissos vinculados</p>
          {appointments.map(a => (
            <AppointmentCard
              key={a.id}
              apt={a}
              cancelFutureApts={cancelFutureApts}
              denialDate={denialDate}
            />
          ))}
        </section>
      )}

      {/* ── HISTÓRICO DE MOVIMENTAÇÕES ── */}
      {(data.status_history || []).length > 0 && (
        <StatusHistory entries={data.status_history!} />
      )}
    </div>
  );
};

// ── Sub-componentes ───────────────────────────────────────────────────────────

const BackBtn: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button onClick={onClick} className="inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900">
    <ArrowLeft className="h-4 w-4" /> Voltar
  </button>
);

const InfoRow: React.FC<{
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
  past?: boolean;
}> = ({ label, value, icon: Icon, highlight, past }) => (
  <div className={`p-4 ${past ? 'opacity-50' : ''}`}>
    <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
      <Icon className="h-3.5 w-3.5" />{label}
    </dt>
    <dd className={`mt-1 text-sm font-semibold ${past ? 'text-slate-400 line-through' : highlight ? 'text-amber-700' : 'text-slate-800'}`}>{value}</dd>
  </div>
);

const RequirementJourney: React.FC<{ stage: number }> = ({ stage }) => {
  const isTerminal = stage >= REQUIREMENT_JOURNEY.length - 1;
  return (
    <div className="flex items-start">
      {REQUIREMENT_JOURNEY.map((st, i) => {
        const done = i < stage || (isTerminal && i === stage);
        const current = !isTerminal && i === stage;
        return (
          <React.Fragment key={st.key}>
            <div className="flex flex-1 flex-col items-center gap-2">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold transition ${
                current ? 'bg-orange-500 text-white ring-2 ring-orange-300 ring-offset-1'
                : done  ? 'bg-orange-500 text-white'
                :         'bg-white text-slate-300 ring-1 ring-slate-200'
              }`}>
                {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span className={`text-center text-[10px] font-medium leading-tight ${
                current ? 'text-orange-600' : done ? 'text-slate-600' : 'text-slate-400'
              }`}>{st.label}</span>
            </div>
            {i < REQUIREMENT_JOURNEY.length - 1 && (
              <div className={`mt-3 h-0.5 flex-1 rounded-full transition-all ${
                i < stage ? 'bg-orange-500' : 'bg-slate-200'
              }`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ── Botão IA (design idêntico ao PortalProcessDetails) ────────────────────────

const REQ_STATUS_LABELS: Record<string, string> = {
  aguardando_confeccao: 'Aguardando Confecção',
  em_analise:           'Em Análise',
  em_exigencia:         'Exigência Pendente',
  aguardando_pericia:   'Aguardando Perícia',
  deferido:             'Deferido',
  indeferido:           'Indeferido',
  ajuizado:             'Ajuizado',
};

const ReqAiSummary: React.FC<{
  state: 'idle' | 'loading' | 'done' | 'error';
  text: string | null;
  generatedAt: Date | null;
  onGenerate: () => void;
}> = ({ state, text, generatedAt, onGenerate }) => {
  if (state === 'done' && text) {
    const timeLabel = generatedAt
      ? generatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : null;
    return (
      <div className="pt-1">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-orange-500" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-600">Análise por IA</p>
          </div>
          {timeLabel && <span className="text-[11px] text-slate-400">Gerada às {timeLabel}</span>}
        </div>
        <p className="text-sm leading-relaxed text-slate-700">{text}</p>
        <p className="mt-2 text-[11px] text-slate-400">Pode cometer erros — consulte seu advogado em caso de dúvida.</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <div className="flex items-center gap-1.5 text-slate-500">
        <Sparkles className="h-3.5 w-3.5 text-orange-400" />
        <span className="text-[13px]">Entenda este caso em linguagem simples</span>
      </div>
      <button
        onClick={onGenerate}
        disabled={state === 'loading'}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
      >
        {state === 'loading'
          ? <><Loader2 className="h-3 w-3 animate-spin" /> Analisando…</>
          : state === 'error'
          ? 'Tentar de novo'
          : 'Analisar com IA'}
      </button>
    </div>
  );
};

// ── Histórico de movimentações ────────────────────────────────────────────────

const StatusHistory: React.FC<{ entries: StatusHistoryEntry[] }> = ({ entries }) => (
  <section className="flex flex-col gap-3">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Histórico de alterações</p>
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <ol className="relative ml-1 space-y-4 border-l border-slate-200 pl-4">
        {entries.map((e, i) => {
          const fromLabel = e.from_status ? (REQ_STATUS_LABELS[e.from_status] ?? e.from_status) : '—';
          const toLabel   = REQ_STATUS_LABELS[e.to_status] ?? e.to_status;
          const d         = new Date(e.changed_at);
          const dateStr   = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
          const timeStr   = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          return (
            <li key={i} className="relative">
              <span className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border-2 border-white ${i === 0 ? 'bg-orange-500' : 'bg-slate-300'}`} />
              <p className="text-sm font-medium text-slate-900">
                <span className="text-slate-500">{fromLabel}</span>
                {' → '}
                <span>{toLabel}</span>
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                {e.changed_by_name && <span className="font-medium text-slate-500">{e.changed_by_name}</span>}
                {e.changed_by_name && <span className="text-slate-300">·</span>}
                <span className="tabular-nums">{dateStr}, {timeStr}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  </section>
);

const EVENT_TYPE_LABELS: Record<string, string> = {
  hearing: 'Audiência', meeting: 'Reunião', pericia: 'Perícia',
  deadline: 'Prazo', payment: 'Recebimento', requirement: 'Exigência',
};

const AppointmentCard: React.FC<{
  apt: Appointment;
  cancelFutureApts: boolean;
  denialDate?: Date | null;
}> = ({ apt, cancelFutureApts, denialDate }) => {
  const d = new Date(apt.start_at);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isPast = d < today;
  const isCancelled = isPast || cancelFutureApts;
  const hasTime = apt.start_at.includes('T');
  const time = hasTime ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
  const modeLabel = apt.event_mode === 'online' ? 'Online' : apt.event_mode === 'presencial' ? 'Presencial' : null;
  const typeLabel = EVENT_TYPE_LABELS[apt.event_type] || apt.event_type;

  // "Realizado" → compromisso foi antes do indeferimento (ou simplesmente já passou)
  // "Cancelado" → compromisso é posterior ao indeferimento (foi cortado pela negativa)
  const isBeforeDenial = denialDate ? d <= denialDate : isPast;
  const statusLabel = isBeforeDenial ? 'Realizado' : 'Cancelado';

  return (
    <div className={`flex items-start gap-3.5 rounded-xl border bg-white p-4 transition ${
      isCancelled
        ? 'border-slate-200 opacity-60'
        : 'border-l-[3px] border-l-orange-500 border-slate-200'
    }`}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
        isCancelled ? 'bg-slate-100 text-slate-400' : 'bg-orange-50 text-orange-600'
      }`}>
        <Calendar className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm font-semibold text-slate-900 ${isCancelled ? 'line-through' : ''}`}>
            {apt.title}
          </p>
          <span className="text-[11px] font-medium text-slate-400">{typeLabel}</span>
        </div>
        <p className={`mt-0.5 tabular-nums text-xs ${isCancelled ? 'text-slate-400 line-through' : 'text-slate-500'}`}>
          {formatDateLong(apt.start_at)}{time ? ` · ${time}` : ''}
        </p>
        {modeLabel && (
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
            <MapPin className="h-3 w-3" />{modeLabel}
          </span>
        )}
      </div>
      {isCancelled && (
        <span className="shrink-0 text-[11px] font-medium text-slate-400">
          {statusLabel}
        </span>
      )}
    </div>
  );
};

export default PortalRequirementDetails;
