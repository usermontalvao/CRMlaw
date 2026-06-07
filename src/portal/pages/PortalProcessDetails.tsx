import React, { useEffect, useState } from 'react';
import {
  ArrowLeft, Calendar, Clock, Gavel, Scale, MapPin,
  AlertCircle, Activity, CheckCircle2, Loader2, ShieldCheck, ChevronRight, ChevronDown, Sparkles, MessageCircle,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { clientPortalService } from '../services/clientPortal.service';
import { EmptyState, formatDate, formatDateLong, formatRelative } from '../components/PortalUI';
import { statusMeta, TONE_CLASSES, JOURNEY, inferStatusFromMovements } from '../lib/domain';

interface Movement { id?: string; nome?: string; data_hora?: string; data?: string; tribunal?: string; grau?: string; complemento?: string; complementos?: any; }
interface Deadline { id: string; title: string; due_date: string; status: string; priority?: string; }
interface Publication { id?: string; data?: string; tipo?: string; orgao?: string; texto?: string; }

interface TimelineEntry {
  date: string;
  source: 'datajud' | 'djen' | 'prazo' | 'calendario';
  title: string;
  description?: string;
  marco?: boolean;
  rawText?: string;
}
interface Appointment {
  id: string;
  title: string;
  event_type: string;
  event_mode?: string | null;
  start_at: string;
  end_at?: string | null;
  status: string;
  description?: string | null;
}
interface ProcessFull {
  id: string; process_code: string; status: string;
  updated_at?: string | null;
  practice_area?: string | null; court?: string | null;
  distributed_at?: string | null;
  hearing_scheduled?: boolean | null; hearing_date?: string | null; hearing_time?: string | null; hearing_mode?: string | null;
  responsible_lawyer?: string | null;
  notes?: string | null;
  movements?: Movement[]; deadlines?: Deadline[]; publications?: Publication[];
  appointments?: Appointment[];
}

type Tab = 'resumo' | 'andamentos' | 'prazos' | 'compromissos' | 'timeline';

/** Extrai um texto legivel dos complementos tabelados do DataJud (array de objetos ou string). */
function extractComplemento(m: Movement): string | undefined {
  if (m.complemento) return m.complemento;
  const c = m.complementos;
  if (!c) return undefined;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    const parts = c
      .map((item: any) => {
        if (typeof item === 'string') return item;
        // formato DataJud: { nome, descricao, valor }
        const nome = item?.nome || item?.descricao || '';
        const valor = item?.valor ?? item?.complemento ?? '';
        return [nome, valor].filter(Boolean).join(': ');
      })
      .filter(Boolean);
    return parts.length ? parts.join(' | ') : undefined;
  }
  return undefined;
}

const MARCO_KEYWORDS_TL = [
  'procedente', 'improcedente', 'senten\u00E7a', 'senten', 'ac\u00F3rd\u00E3o', 'acordao',
  'homolog', 'acordo', 'tr\u00E2nsito', 'transito', 'cumprimento', 'execu\u00E7\u00E3o', 'execucao',
  'liquida\u00E7\u00E3o', 'liquidacao', 'recurso', 'apela\u00E7\u00E3o', 'apelacao', 'agravo', 'embargos',
  'arquiv', 'extin\u00E7\u00E3o', 'extincao', 'cita\u00E7\u00E3o', 'citacao',
  'distribui\u00E7\u00E3o', 'distribuicao', 'audi\u00EAncia', 'audiencia',
  'pagamento', 'penhora', 'alvar\u00E1', 'alvara', 'tutela', 'liminar',
];
const isMarcoTl = (nome: string) => {
  const n = (nome || '').toLowerCase();
  return MARCO_KEYWORDS_TL.some((k) => n.includes(k));
};

function buildTimeline(data: ProcessFull, rawMovements: Movement[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const m of rawMovements) {
    const d = m.data_hora || m.data;
    if (!d) continue;
    const comp = extractComplemento(m);
    entries.push({
      date: d,
      source: 'datajud',
      title: m.nome || 'Andamento',
      description: comp ? comp.slice(0, 180) : undefined,
      marco: isMarcoTl(m.nome || ''),
    });
  }

  for (const p of data.publications || []) {
    // Suporta dois formatos:
    // 1. djen_comunicacoes (apos migration): campos data, tipo, orgao, texto
    // 2. process_notifications (antes da migration): campos movement_date, title, description, source
    const pAny = p as any;
    const date = p.data || pAny.movement_date || pAny.created_at;
    if (!date) continue;
    // Ignora notificacoes de andamento DataJud (ja presentes em rawMovements)
    if (pAny.source === 'datajud') continue;
    entries.push({
      date,
      source: 'djen',
      title: p.tipo || pAny.title || pAny.type || 'Publica\u00E7\u00E3o oficial',
      description: p.orgao || pAny.description || undefined,
      rawText: p.texto || undefined,
      marco: false,
    });
  }

  for (const a of data.appointments || []) {
    const tlabels: Record<string, string> = {
      hearing: 'Audi\u00EAncia', pericia: 'Per\u00EDcia', meeting: 'Reuni\u00E3o', deadline: 'Prazo',
    };
    entries.push({
      date: a.start_at,
      source: 'calendario',
      title: tlabels[a.event_type] || a.event_type,
      description: a.title || undefined,
      marco: a.event_type === 'hearing' || a.event_type === 'pericia',
    });
  }

  for (const d of data.deadlines || []) {
    if (!d.due_date) continue;
    entries.push({
      date: d.due_date,
      source: 'prazo',
      title: d.status === 'cumprido' ? 'Prazo cumprido' : 'Prazo',
      description: d.title || undefined,
      marco: false,
    });
  }

  return entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

const APT_TYPE_LABELS: Record<string, { noun: string; fem: boolean }> = {
  hearing:  { noun: 'audi\u00EAncia',  fem: true  },
  pericia:  { noun: 'per\u00EDcia',    fem: true  },
  meeting:  { noun: 'encontro',   fem: false },
  deadline: { noun: 'prazo',      fem: false },
};

/** O que o cliente precisa fazer  -  usa o appointments unificado (calendar + hearing_date). */
function nextAction(p: ProcessFull, upcomingApts: Appointment[]): { tone: 'ok' | 'attention'; label: string; text: string } {
  if (upcomingApts.length > 0) {
    const next = upcomingApts[0];
    const d = new Date(next.start_at);
    const hasTime = next.start_at.includes('T');
    const time = hasTime ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
    const { noun, fem } = APT_TYPE_LABELS[next.event_type] ?? { noun: 'compromisso', fem: false };
    return {
      tone: 'attention',
      label: 'Requer aten\u00E7\u00E3o',
      text: `Voc\u00EA tem ${fem ? 'uma' : 'um'} ${noun} marcad${fem ? 'a' : 'o'} para ${formatDateLong(next.start_at)}${time ? ` \u00E0s ${time}` : ''}. Confirme sua presen\u00E7a com seu advogado.`,
    };
  }
  const pending = (p.deadlines || []).filter((d) => d.status === 'pendente').length;
  if (pending > 0) {
    return { tone: 'attention', label: 'Em acompanhamento', text: 'H\u00E1 prazos em aberto sendo cuidados pelo seu advogado. Acompanhe na aba Prazos.' };
  }
  return { tone: 'ok', label: 'Nada pendente', text: 'Nenhuma a\u00E7\u00E3o \u00E9 necess\u00E1ria da sua parte no momento. Seu advogado est\u00E1 cuidando de tudo.' };
}

export const PortalProcessDetails: React.FC<{ processId: string }> = ({ processId }) => {
  const { session } = useClientAuth();
  const { navigate } = usePortalRouter();
  const [data, setData] = useState<ProcessFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('resumo');
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiGeneratedAt, setAiGeneratedAt] = useState<Date | null>(null);
  const [aiFromCache, setAiFromCache] = useState(false);
  const [officePhone, setOfficePhone] = useState<string | null>(null);

  useEffect(() => {
    clientPortalService.getOfficeContact().then(contact => {
      if (contact?.phone) {
        const raw = contact.phone.replace(/\D/g, '');
        const digits = raw.startsWith('55') ? raw : `55${raw}`;
        // Minimo: 55 (codigo BR) + DDD (2) + numero (8 fixo / 9 movel) = 12 ou 13 digitos
        if (digits.length >= 12) setOfficePhone(digits);
      }
    });
  }, []);

  useEffect(() => {
    if (!session?.user?.id || !processId) return;
    let mounted = true;
    setLoading(true); setError(null);
    clientPortalService.getProcess(session.user.id, processId)
      .then((d) => { if (mounted) { if (!d) setError('Processo n\u00E3o encontrado.'); else setData(d as ProcessFull); } })
      .catch((e: Error) => mounted && setError(e.message))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [session?.user?.id, processId]);

  useEffect(() => {
    if (!session?.user?.id || !processId || !data) return;
    let mounted = true;
    clientPortalService.getAiCache(session.user.id, 'process', processId, 7, data.updated_at).then(cached => {
      if (!mounted) return;
      if (!cached) {
        setAiText(null);
        setAiGeneratedAt(null);
        setAiFromCache(false);
        setAiState('idle');
        return;
      }
      setAiText(cached.text);
      setAiGeneratedAt(cached.generatedAt);
      setAiFromCache(true);
      setAiState('done');
    });
    return () => { mounted = false; };
  }, [session?.user?.id, processId, data]);

  if (loading) return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white">
      <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-900">Aguarde</p>
        <p className="text-sm text-slate-500">Estamos buscando os dados do processo...</p>
      </div>
    </div>
  );
  if (error || !data) {
    return <div><BackBtn onClick={() => navigate('casos')} /><EmptyState icon={Scale} title="N&atilde;o foi poss&iacute;vel carregar" description={error || 'Processo n\u00E3o encontrado.'} /></div>;
  }

  // Infere o status real a partir dos nomes dos movimentos.
  // O DataJud pode registrar "remessa ao arquivo" durante uma execucao ativa,
  // fazendo o sync sobrescrever cumprimento por arquivado incorretamente.
  const rawMovements = data.movements || [];
  const inferredStatus = inferStatusFromMovements(
    rawMovements.map((m) => m.nome || ''),
    data.status,
  );
  const effectiveStatus = inferredStatus ?? data.status;
  const meta = statusMeta(effectiveStatus);
  const tone = TONE_CLASSES[meta.tone];

  // Fallback para data de distribuicao quando o campo esta vazio no banco.
  // Usa o movimento mais antigo do DataJud como aproximacao.
  const distributedAt = data.distributed_at ?? rawMovements.reduce<string | null>((earliest, m) => {
    const d = m.data_hora || m.data;
    if (!d) return earliest;
    if (!earliest || new Date(d) < new Date(earliest)) return d;
    return earliest;
  }, null);
  const djens: Movement[] = (data.publications || []).map((p) => ({
    id: p.id,
    nome: p.tipo || 'Publica\u00E7\u00E3o oficial',
    data_hora: p.data,
    data: p.data,
    tribunal: 'djen',
    complemento: p.texto,
  }));
  const movements = [...rawMovements, ...djens].sort(
    (a, b) => new Date(b.data_hora || b.data || 0).getTime() - new Date(a.data_hora || a.data || 0).getTime()
  );
  const deadlines = data.deadlines || [];
  const pendingDeadlines = deadlines.filter((d) => d.status === 'pendente').length;
  const appointments = (data.appointments || []).sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
  );
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcomingApts = appointments.filter(a => new Date(a.start_at) >= today);
  const action = nextAction(data, upcomingApts);
  const timeline = buildTimeline(data, rawMovements);

  const handleExplainProcess = async (forceRefresh = false) => {
    if (aiState === 'loading') return;
    if (aiText && !forceRefresh) { setAiState('done'); return; }
    setAiState('loading');
    if (forceRefresh) {
      setAiText(null);
      setAiGeneratedAt(null);
      setAiFromCache(false);
    }

    // Extrair notas do advogado (JSON serializado)
    let lawyerNotes: string | undefined;
    try {
      const parsed = JSON.parse(data.notes || '[]') as { text?: string; author_name?: string; created_at?: string }[];
      if (parsed.length > 0) {
        lawyerNotes = parsed
          .map((n) => `[${n.author_name || 'Advogado'} - ${n.created_at ? new Date(n.created_at).toLocaleDateString('pt-BR') : ''}]: ${n.text || ''}`)
          .join('\n');
      }
    } catch {}

    const text = await clientPortalService.explainProcess({
      statusKey: effectiveStatus,
      statusLabel: meta.label,
      statusUpdatedAt: data.updated_at,
      processCode: data.process_code,
      court: data.court,
      distributedAt: distributedAt,
      responsibleLawyer: data.responsible_lawyer,
      area: data.practice_area,
      lawyerNotes,
      movements: rawMovements.map((m) => ({ nome: m.nome, data: m.data_hora || m.data, detalhe: extractComplemento(m) })),
      publications: (data.publications || []).map((p) => {
        const pAny = p as any;
        return {
          data:  p.data  || pAny.movement_date || pAny.created_at,
          tipo:  p.tipo  || pAny.title || pAny.type,
          orgao: p.orgao || pAny.nome_orgao,
          texto: p.texto || pAny.description,
        };
      }).filter((p) => !!p.data && (pAny => !pAny.source || pAny.source !== 'datajud')(p as any)),
      appointments: appointments.map((a) => ({ title: a.title, event_type: a.event_type, start_at: a.start_at, event_mode: a.event_mode })),
      deadlines: deadlines.map((d) => ({ title: d.title, due_date: d.due_date, status: d.status, priority: d.priority })),
      timeline,
    });
    if (text) {
      const now = new Date();
      setAiText(text); setAiState('done'); setAiGeneratedAt(now); setAiFromCache(false);
      clientPortalService.saveAiCache(session!.user.id, 'process', processId, text);
    } else setAiState('error');
  };

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'resumo', label: 'Resumo' },
    { id: 'andamentos', label: 'Andamentos', badge: movements.length },
    { id: 'timeline', label: 'Linha do Tempo', badge: timeline.length },
    { id: 'prazos', label: 'Prazos', badge: pendingDeadlines },
    ...(appointments.length > 0 ? [{ id: 'compromissos' as Tab, label: 'Compromissos', badge: appointments.length }] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <BackBtn onClick={() => navigate('casos')} />

      {/* -- CABECALHO + SITUACAO -- */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
            <span className={`text-sm font-semibold ${tone.text}`}>{meta.label}</span>
          </div>
          <h1 className="mt-3 text-lg font-semibold leading-snug text-slate-900 sm:text-xl">{meta.explain}</h1>
          <p className="mt-2 font-mono text-xs tabular-nums text-slate-400">{data.process_code}</p>
          {[data.practice_area, data.court].filter(Boolean).length > 0 && (
            <p className="mt-0.5 text-xs capitalize text-slate-400">{[data.practice_area, data.court].filter(Boolean).join(' . ')}</p>
          )}
        </div>

        {/* Jornada macro  -  stepper sobrio */}
        <div className="border-t border-slate-100 px-5 py-5 sm:px-6">
          <Journey stage={meta.stage} />
        </div>

        {/* Analise por IA  -  linha compacta dentro do card */}
        <div className="border-t border-slate-100 px-5 pb-5 sm:px-6">
          <AiSummary state={aiState} text={aiText} generatedAt={aiGeneratedAt} fromCache={aiFromCache} onGenerate={handleExplainProcess} />
        </div>
      </section>

      {/* -- FALE COM SEU ADVOGADO -- */}
      {officePhone && (() => {
        const nome = session?.client?.nome ?? '';
        const vara = data.court ? `, vara ${data.court},` : '';
        const msg = `Ol\u00E1 Dr.(a), me chamo ${nome}. Tenho o processo ${data.process_code}${vara} que est\u00E1 com status "${meta.label}". Fiquei com uma d\u00FAvida e gostaria de conversar.`;
        return (
          <a
            href={`https://wa.me/${officePhone}?text=${encodeURIComponent(msg)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3.5 transition active:bg-green-100"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#25D366] text-white shadow-[0_4px_12px_rgba(37,211,102,0.30)]">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-slate-900">Ficou com d&uacute;vida?</p>
              <p className="text-[11px] text-slate-500">Fale com seu advogado pelo WhatsApp</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
          </a>
        );
      })()}

      {/* -- O QUE VOCE PRECISA FAZER -- */}
      <section className={`rounded-xl border border-slate-200 border-l-[3px] bg-white p-4 sm:p-5 ${action.tone === 'attention' ? 'border-l-amber-400' : 'border-l-emerald-400'}`}>
        <div className="flex items-start gap-3">
          {action.tone === 'attention'
            ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            : <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{action.label}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-slate-700">{action.text}</p>
          </div>
        </div>
      </section>

      {/* Proximo compromisso (unificado: calendar_events + hearing_date do processo) */}
      {upcomingApts.length > 0 && (() => {
        const next = upcomingApts[0];
        const d = new Date(next.start_at);
        const hasTime = next.start_at.includes('T');
        const time = hasTime ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
        const { noun, fem } = APT_TYPE_LABELS[next.event_type] ?? { noun: 'compromisso', fem: false };
        const modeLabel = next.event_mode === 'online' ? 'Online' : next.event_mode === 'presencial' ? 'Presencial' : null;
        return (
          <section className="flex items-center gap-3.5 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Gavel className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Pr&oacute;xim{fem ? 'a' : 'o'} {noun}
              </p>
              <p className="text-sm font-semibold text-slate-900">
                {formatDateLong(next.start_at)}{time ? ` . ${time}` : ''}
              </p>
              {modeLabel && (
                <p className="mt-0.5 inline-flex items-center gap-1 text-xs capitalize text-slate-500">
                  <MapPin className="h-3 w-3" />{modeLabel}
                </p>
              )}
            </div>
          </section>
        );
      })()}

      {/* -- TABS (underline sobrio) -- */}
      <div className="flex gap-6 border-b border-slate-200">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative -mb-px flex items-center gap-1.5 border-b-2 pb-3 pt-1 text-sm font-medium transition ${
                on ? 'border-orange-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span className={`tabular-nums rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${on ? 'bg-orange-50 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>{t.badge}</span>
              )}
            </button>
          );
        })}
      </div>

      <div>
        {tab === 'resumo' && <ResumoTab data={data} movements={movements} responsibleLawyer={data.responsible_lawyer} distributedAt={distributedAt} onSeeAll={() => setTab('andamentos')} />}
        {tab === 'andamentos' && <AndamentosTab movements={movements} statusLabel={meta.label} area={data.practice_area} />}
        {tab === 'timeline' && <TimelineTab timeline={timeline} />}
        {tab === 'prazos' && <PrazosTab deadlines={deadlines} />}
        {tab === 'compromissos' && <AppointmentsTab appointments={appointments} />}
      </div>
    </div>
  );
};

// ----

const BackBtn: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button onClick={onClick} className="inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900">
    <ArrowLeft className="h-4 w-4" /> Voltar
  </button>
);

/** Stepper com trilho laranja mostrando o progresso da jornada. */
const Journey: React.FC<{ stage: number }> = ({ stage }) => {
  const isTerminal = stage >= JOURNEY.length - 1;
  return (
    <div className="flex items-start">
      {JOURNEY.map((st, i) => {
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
            {i < JOURNEY.length - 1 && (
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

const TL_SOURCE: Record<string, { label: string; cls: string }> = {
  datajud:    { label: 'DataJud',   cls: 'bg-slate-100 text-slate-600' },
  djen:       { label: 'Di\u00E1rio',    cls: 'bg-violet-100 text-violet-700' },
  prazo:      { label: 'Prazo',     cls: 'bg-amber-100 text-amber-700' },
  calendario: { label: 'Agenda',    cls: 'bg-emerald-100 text-emerald-700' },
};

const TimelineList: React.FC<{ entries: TimelineEntry[] }> = ({ entries }) => {
  const [showRawIdx, setShowRawIdx] = useState<number | null>(null);
  if (!entries.length) return null;
  return (
    <ol className="relative ml-1 border-l border-slate-200 pl-4">
      {entries.map((e, i) => {
        const src = TL_SOURCE[e.source] ?? TL_SOURCE.datajud;
        const isLast = i === entries.length - 1;
        const hasRaw = !!e.rawText;
        const rawOpen = showRawIdx === i;
        return (
          <li key={i} className={`relative ${isLast ? 'pb-0' : 'pb-4'}`}>
            <span className={`absolute -left-[21px] top-[5px] h-2.5 w-2.5 rounded-full border-2 border-white ${e.marco ? 'bg-orange-500' : 'bg-slate-300'}`} />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${src.cls}`}>{src.label}</span>
              <span className="text-[11px] tabular-nums text-slate-400">{formatDate(e.date)}</span>
              {e.marco && <span className="text-[10px] font-semibold text-orange-600">*</span>}
            </div>
            <p className={`mt-0.5 text-[13px] font-medium leading-snug ${e.marco ? 'text-slate-900' : 'text-slate-700'}`}>{e.title}</p>
            {e.description && <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{e.description}</p>}
            {hasRaw && (
              <button
                onClick={() => setShowRawIdx(rawOpen ? null : i)}
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-violet-600"
              >
                <ChevronDown className={`h-3 w-3 transition ${rawOpen ? 'rotate-180' : ''}`} />
                {rawOpen ? 'Ocultar publica\u00E7\u00E3o' : 'Ver publica\u00E7\u00E3o'}
              </button>
            )}
            {hasRaw && rawOpen && (
              <p className="mt-1.5 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">{e.rawText}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
};

const AiSummary: React.FC<{
  state: 'idle' | 'loading' | 'done' | 'error';
  text: string | null;
  generatedAt: Date | null;
  fromCache: boolean;
  onGenerate: () => void;
}> = ({ state, text, generatedAt, fromCache, onGenerate }) => {
  if (state === 'done' && text) {
    const ageLabel = generatedAt ? formatAiAge(generatedAt) : null;
    return (
      <div className="pt-1">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-orange-500" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-600">An&aacute;lise por IA</p>
            {ageLabel && <span className="text-[11px] text-slate-400">. {ageLabel}</span>}
          </div>
          {fromCache && (
            <button onClick={onGenerate}
              className="text-[11px] font-medium text-slate-400 underline-offset-2 hover:text-orange-600 hover:underline">
              Atualizar
            </button>
          )}
        </div>
        <p className="text-sm leading-relaxed text-slate-700">{text}</p>
        <p className="mt-2 text-[11px] text-slate-400">Pode cometer erros  -  consulte seu advogado em caso de d&uacute;vida.</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <div className="flex items-center gap-1.5 text-slate-500">
        <Sparkles className="h-3.5 w-3.5 text-orange-400" />
        <span className="text-[13px]">Entenda este processo em linguagem simples</span>
      </div>
      <button
        onClick={onGenerate}
        disabled={state === 'loading'}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
      >
        {state === 'loading'
          ? <><Loader2 className="h-3 w-3 animate-spin" /> Analisando...</>
          : state === 'error'
          ? 'Tentar de novo'
          : 'Analisar com IA'}
      </button>
    </div>
  );
};

function formatAiAge(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `h\u00E1 ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `h\u00E1 ${hours}h`;
  const days = Math.floor(hours / 24);
  return `h\u00E1 ${days} dia${days > 1 ? 's' : ''}`;
}

const ResumoTab: React.FC<{ data: ProcessFull; movements: Movement[]; responsibleLawyer?: string | null; distributedAt: string | null; onSeeAll: () => void }> = ({ data, movements, responsibleLawyer, distributedAt, onSeeAll }) => (
  <div className="flex flex-col gap-3">
    {/* Dados gerais  -  lista de definicao limpa */}
    <dl className="grid grid-cols-1 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2 sm:divide-y-0 sm:divide-x">
      <InfoRow label="Distribu&iacute;do em" value={distributedAt ? formatDate(distributedAt) : ' - '} icon={Calendar} />
      <InfoRow label="Advogado respons&aacute;vel" value={responsibleLawyer || ' - '} icon={Gavel} />
    </dl>

    {/* Ultimas atualizacoes (curado: 4 mais recentes) */}
    {movements.length > 0 ? (
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">&Uacute;ltimas atualiza&ccedil;&otilde;es</p>
        <ol className="relative ml-1 space-y-4 border-l border-slate-200 pl-4">
          {movements.slice(0, 4).map((m, i) => (
            <li key={i} className="relative">
              <span className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border-2 border-white ${i === 0 ? 'bg-orange-500' : 'bg-slate-300'}`} />
              <p className="text-sm font-medium leading-snug text-slate-900">{m.nome}</p>
              <p className="mt-0.5 text-xs tabular-nums text-slate-400">{formatRelative(m.data_hora || m.data)}</p>
            </li>
          ))}
        </ol>
        {movements.length > 4 && (
          <button onClick={onSeeAll} className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-slate-600 transition hover:text-slate-900">
            Ver todos os {movements.length} andamentos <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    ) : (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <Activity className="mx-auto h-6 w-6 text-slate-300" />
        <p className="mt-2 text-sm text-slate-500">Ainda n&atilde;o h&aacute; atualiza&ccedil;&otilde;es registradas.</p>
      </div>
    )}
  </div>
);

const InfoRow: React.FC<{ label: string; value: string; icon: React.ComponentType<{ className?: string }> }> = ({ label, value, icon: Icon }) => (
  <div className="p-4">
    <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400"><Icon className="h-3.5 w-3.5" />{label}</dt>
    <dd className="mt-1 text-sm font-medium text-slate-800">{value}</dd>
  </div>
);

const sourceLabel = (s?: string) =>
  s === 'djen' ? 'Di\u00E1rio Oficial' : s === 'datajud' ? 'Tribunal' : s;

const MovementItem: React.FC<{
  m: Movement;
  timeline: Movement[];
  statusLabel: string;
  area?: string | null;
}> = ({ m, timeline, statusLabel, area }) => {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [explanation, setExplanation] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const explain = async () => {
    if (state === 'loading') return;
    if (explanation) { setState('done'); return; }
    setState('loading');
    const text = await clientPortalService.explainMovement({
      target: { nome: m.nome, complemento: m.complemento, data: m.data_hora || m.data },
      timeline: timeline.map((x) => ({ nome: x.nome, data: x.data_hora || x.data })),
      statusLabel,
      area,
    });
    if (text) { setExplanation(text); setState('done'); }
    else setState('error');
  };

  return (
    <li className="relative">
      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border-2 border-white bg-slate-300" />
      <p className="text-sm font-medium leading-snug text-slate-900">{m.nome}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-slate-400">
        <span>{formatDate(m.data_hora || m.data, { withTime: true })}</span>
        {m.tribunal && <><span className="text-slate-300">.</span><span className="normal-nums">{sourceLabel(m.tribunal)}</span></>}
      </div>

      {/* Publicacao sem texto  -  aviso discreto */}
      {m.tribunal === 'djen' && !m.complemento && (
        <p className="mt-1.5 text-[11px] text-slate-400">Texto da publica&ccedil;&atilde;o n&atilde;o dispon&iacute;vel.</p>
      )}

      {/* Texto tecnico recolhido por padrao */}
      {m.complemento && (
        <div className="mt-2">
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 transition hover:text-slate-800"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition ${showRaw ? 'rotate-180' : ''}`} />
            {showRaw ? 'Ocultar texto oficial' : 'Ver texto oficial'}
          </button>
          {showRaw && (
            <p className="mt-1.5 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">{m.complemento}</p>
          )}
        </div>
      )}

      {/* Explicacao por IA  -  nao exibe para publicacoes DataJud sem texto */}
      {(m.tribunal !== 'djen' || !!m.complemento) && (
        <div className="mt-2">
          {state !== 'done' && (
            <button
              onClick={explain}
              disabled={state === 'loading'}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-orange-700 underline-offset-2 transition hover:underline disabled:opacity-60"
            >
              {state === 'loading' ? <><Loader2 className="h-3 w-3 animate-spin" /> Explicando...</> : state === 'error' ? 'N\u00E3o consegui  -  tentar de novo' : 'Entender este andamento'}
            </button>
          )}
          {state === 'done' && explanation && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Em linguagem simples</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-700">{explanation}</p>
            </div>
          )}
        </div>
      )}
    </li>
  );
};

const AndamentosTab: React.FC<{ movements: Movement[]; statusLabel: string; area?: string | null }> = ({ movements, statusLabel, area }) => {
  if (!movements.length) return <EmptyState icon={Activity} title="Sem andamentos" description="Nenhuma atualiza&ccedil;&atilde;o registrada ainda." />;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <ol className="relative ml-1 space-y-5 border-l border-slate-200 pl-4">
        {movements.map((m, i) => <MovementItem key={i} m={m} timeline={movements} statusLabel={statusLabel} area={area} />)}
      </ol>
    </div>
  );
};

const PrazosTab: React.FC<{ deadlines: Deadline[] }> = ({ deadlines }) => {
  if (!deadlines.length) return <EmptyState icon={Clock} title="Sem prazos registrados" description="Os prazos processuais s&atilde;o monitorados pelo seu advogado. Quando houver algo relevante para voc&ecirc; acompanhar, aparecer&aacute; aqui." />;
  return (
    <div className="flex flex-col gap-2.5">
      {deadlines.map((d) => {
        const overdue = d.status === 'pendente' && new Date(d.due_date) < new Date();
        const done = d.status === 'cumprido';
        return (
          <div key={d.id} className={`flex items-center gap-3.5 rounded-xl border bg-white p-4 ${overdue ? 'border-l-[3px] border-l-rose-400 border-slate-200' : done ? 'border-slate-200' : 'border-l-[3px] border-l-amber-400 border-slate-200'}`}>
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${overdue ? 'bg-rose-50 text-rose-600' : done ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
              {done ? <CheckCircle2 className="h-4 w-4" /> : overdue ? <AlertCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug text-slate-900">{d.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {done ? 'Cumprido' : overdue ? 'Venceu em ' : 'Vence em '}
                {!done && <span className="font-medium tabular-nums">{formatDateLong(d.due_date)}</span>}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// -- Labels de tipo de evento (mesmo padrao do CalendarModule) ----
const EVENT_TYPE_LABELS: Record<string, string> = {
  hearing:     'Audi\u00EAncia',
  meeting:     'Reuni\u00E3o',
  pericia:     'Per\u00EDcia',
  deadline:    'Prazo',
  payment:     'Recebimento',
  requirement: 'Exig\u00EAncia',
  personal:    'Pessoal',
};

const AppointmentsTab: React.FC<{ appointments: Appointment[] }> = ({ appointments }) => {
  if (!appointments.length) return <EmptyState icon={Calendar} title="Sem compromissos" description="Nenhum compromisso vinculado a este processo." />;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  return (
    <div className="flex flex-col gap-2.5">
      {appointments.map((a) => {
        const d = new Date(a.start_at);
        const isPast = d < today;
        const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const hasTime = a.start_at.includes('T');
        const typeLabel = EVENT_TYPE_LABELS[a.event_type] || a.event_type;
        const modeLabel = a.event_mode === 'online' ? 'Online' : a.event_mode === 'presencial' ? 'Presencial' : null;

        return (
          <div key={a.id} className={`flex items-start gap-3.5 rounded-xl border bg-white p-4 transition ${
            isPast ? 'border-slate-200 opacity-70' : 'border-l-[3px] border-l-orange-500 border-slate-200'
          }`}>
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isPast ? 'bg-slate-100 text-slate-400' : 'bg-orange-50 text-orange-600'}`}>
              <Calendar className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-slate-900 truncate">{a.title}</p>
                <span className="text-[11px] font-medium text-slate-400">{typeLabel}</span>
              </div>
              <p className="mt-0.5 tabular-nums text-xs text-slate-500">
                {formatDateLong(a.start_at)}{hasTime ? ` . ${time}` : ''}
              </p>
              {modeLabel && (
                <span className={`mt-1 inline-flex items-center gap-1 text-[11px] font-medium ${a.event_mode === 'online' ? 'text-slate-500' : 'text-slate-500'}`}>
                  <MapPin className="h-3 w-3" />{modeLabel}
                </span>
              )}
              {a.description && (
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{a.description}</p>
              )}
            </div>
            {isPast && <span className="shrink-0 text-[11px] text-slate-400">Realizado</span>}
          </div>
        );
      })}
    </div>
  );
};

const TimelineTab: React.FC<{ timeline: TimelineEntry[] }> = ({ timeline }) => {
  if (!timeline.length) return <EmptyState icon={Activity} title="Sem eventos" description="Nenhum evento registrado neste processo." />;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <TimelineList entries={timeline} />
    </div>
  );
};

export default PortalProcessDetails;
