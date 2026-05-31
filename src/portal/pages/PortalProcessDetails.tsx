import React, { useEffect, useState } from 'react';
import {
  ArrowLeft, Briefcase, Calendar, Clock, Gavel, Scale, MapPin,
  AlertCircle, Activity, CheckCircle2, Loader2, Info, ShieldCheck, Sparkles, ChevronRight,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { clientPortalService } from '../services/clientPortal.service';
import { EmptyState, formatDate, formatDateLong, formatRelative } from '../components/PortalUI';
import { statusMeta, TONE_CLASSES, JOURNEY } from '../lib/domain';

interface Movement { id?: string; nome?: string; data_hora?: string; data?: string; tribunal?: string; grau?: string; complemento?: string; }
interface Deadline { id: string; title: string; due_date: string; status: string; priority?: string; }
interface Publication { id?: string; data?: string; tipo?: string; orgao?: string; texto?: string; }
interface ProcessFull {
  id: string; process_code: string; status: string;
  practice_area?: string | null; court?: string | null;
  distributed_at?: string | null;
  hearing_scheduled?: boolean | null; hearing_date?: string | null; hearing_time?: string | null; hearing_mode?: string | null;
  responsible_lawyer?: string | null;
  movements?: Movement[]; deadlines?: Deadline[]; publications?: Publication[];
}

type Tab = 'resumo' | 'andamentos' | 'prazos';

/** O que o cliente precisa fazer (ou não) — reduz ansiedade e mensagens no WhatsApp. */
function nextAction(p: ProcessFull): { tone: 'ok' | 'attention'; text: string } {
  const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local
  const future = p.hearing_scheduled && p.hearing_date && p.hearing_date >= todayStr;
  if (future) {
    return {
      tone: 'attention',
      text: `Você tem uma audiência marcada para ${formatDate(p.hearing_date)}${p.hearing_time ? ` às ${p.hearing_time.slice(0,5)}` : ''}. Confirme sua presença com seu advogado.`,
    };
  }
  const pending = (p.deadlines || []).filter((d) => d.status === 'pendente').length;
  if (pending > 0) {
    return { tone: 'attention', text: 'Há prazos em aberto sendo cuidados pelo seu advogado. Acompanhe na aba Prazos.' };
  }
  return { tone: 'ok', text: 'Nenhuma ação é necessária da sua parte no momento. Seu advogado está cuidando de tudo.' };
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

  useEffect(() => {
    if (!session?.user?.id || !processId) return;
    let mounted = true;
    setLoading(true); setError(null);
    clientPortalService.getProcess(session.user.id, processId)
      .then((d) => { if (mounted) { if (!d) setError('Processo não encontrado.'); else setData(d as ProcessFull); } })
      .catch((e: Error) => mounted && setError(e.message))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [session?.user?.id, processId]);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>;
  if (error || !data) {
    return <div><BackBtn onClick={() => navigate('processos')} /><EmptyState icon={Scale} title="Não foi possível carregar" description={error || 'Processo não encontrado.'} /></div>;
  }

  const meta = statusMeta(data.status);
  const tone = TONE_CLASSES[meta.tone];
  const rawMovements = data.movements || [];
  const djens: Movement[] = (data.publications || []).map((p) => ({
    id: p.id,
    nome: p.tipo || 'Publicação Oficial',
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
  const action = nextAction(data);

  const handleExplainProcess = async () => {
    if (aiState === 'loading') return;
    if (aiText) { setAiState('done'); return; }
    setAiState('loading');
    const text = await clientPortalService.explainProcess({
      statusLabel: meta.label,
      area: data.practice_area,
      movements: rawMovements.map((m) => ({ nome: m.nome, data: m.data_hora || m.data, detalhe: m.complemento })),
      publications: (data.publications || []).map((p) => ({ data: p.data, tipo: p.tipo, orgao: p.orgao, texto: p.texto })),
    });
    if (text) { setAiText(text); setAiState('done'); }
    else setAiState('error');
  };

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'resumo', label: 'Resumo' },
    { id: 'andamentos', label: 'Andamentos', badge: movements.length },
    { id: 'prazos', label: 'Prazos', badge: pendingDeadlines },
  ];

  return (
    <div className="flex flex-col gap-4">
      <BackBtn onClick={() => navigate('processos')} />

      {/* ── CARD DE STATUS ── */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
        <div className={`h-1 w-full ${tone.bar}`} />
        <div className="p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600 ring-1 ring-orange-100">
                <Briefcase className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${tone.badge}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />{meta.label}
                </span>
                <p className="mt-2 font-mono text-xs font-semibold text-slate-600">{data.process_code}</p>
                <p className="text-xs text-slate-400">{[data.practice_area, data.court].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
          </div>

          {/* Explicação plana */}
          <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-slate-50 px-4 py-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <p className="text-sm leading-relaxed text-slate-600">{meta.explain}</p>
          </div>

          {/* Jornada macro (5 etapas — etapas anteriores são determinísticas) */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              {JOURNEY.map((st, i) => {
                const done = i < meta.stage;
                const current = i === meta.stage;
                return (
                  <React.Fragment key={st.key}>
                    <div className="flex flex-1 flex-col items-center gap-1.5">
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${
                        current ? 'bg-orange-500 text-white ring-4 ring-orange-100'
                        : done ? 'bg-emerald-500 text-white'
                        : 'bg-slate-200 text-slate-400'
                      }`}>
                        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                      </div>
                      <span className={`text-center text-[9px] font-semibold leading-tight sm:text-[10px] ${
                        current ? 'text-orange-700' : done ? 'text-emerald-600' : 'text-slate-400'
                      }`}>{st.label}</span>
                    </div>
                    {i < JOURNEY.length - 1 && (
                      <div className={`mb-4 h-0.5 flex-1 ${i < meta.stage ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── EXPLICAÇÃO DO PROCESSO POR IA ── */}
      {aiState !== 'done' ? (
        <button
          onClick={handleExplainProcess}
          disabled={aiState === 'loading'}
          className="group flex w-full items-center gap-3.5 rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-4 text-left transition active:scale-[0.99] hover:border-orange-300 disabled:opacity-70"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-sm">
            {aiState === 'loading' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-orange-900">
              {aiState === 'loading' ? 'Analisando seu processo...' : 'Quer saber como está seu processo?'}
            </p>
            <p className="text-xs text-orange-700">
              {aiState === 'error' ? 'Não consegui agora — toque para tentar novamente' : 'A IA explica tudo em linguagem simples'}
            </p>
          </div>
          {aiState !== 'loading' && <ChevronRight className="h-5 w-5 shrink-0 text-orange-400 transition group-hover:translate-x-0.5" />}
        </button>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50 px-4 py-3">
            <Sparkles className="h-4 w-4 text-orange-600" />
            <p className="text-sm font-bold text-orange-900">Como está seu processo</p>
            <span className="ml-auto rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase text-orange-700">IA</span>
          </div>
          <p className="px-4 py-4 text-sm leading-relaxed text-slate-700">{aiText}</p>
          <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
            Explicação gerada por inteligência artificial. Em caso de dúvida, fale com seu advogado.
          </p>
        </div>
      )}

      {/* ── O QUE VOCÊ PRECISA FAZER ── */}
      <div className={`flex items-start gap-3 rounded-2xl px-4 py-3.5 ${
        action.tone === 'attention' ? 'border border-amber-200 bg-amber-50' : 'border border-emerald-200 bg-emerald-50'
      }`}>
        {action.tone === 'attention'
          ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          : <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />}
        <div>
          <p className={`text-xs font-bold uppercase tracking-wider ${action.tone === 'attention' ? 'text-amber-700' : 'text-emerald-700'}`}>
            {action.tone === 'attention' ? 'Atenção' : 'Tudo certo'}
          </p>
          <p className={`mt-0.5 text-sm ${action.tone === 'attention' ? 'text-amber-900' : 'text-emerald-900'}`}>{action.text}</p>
        </div>
      </div>

      {/* Audiência — destaca só se for FUTURA; passada mostra como realizada */}
      {data.hearing_scheduled && data.hearing_date && (() => {
        const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local
        const isPast = data.hearing_date < todayStr;
        return (
          <div className={`flex items-center gap-3 rounded-2xl border p-4 shadow-sm ${isPast ? 'border-slate-200 bg-white' : 'border-amber-200 bg-white'}`}>
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${isPast ? 'bg-slate-400' : 'bg-amber-500'}`}>
              {isPast ? <CheckCircle2 className="h-5 w-5" /> : <Gavel className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <p className={`text-xs font-bold uppercase tracking-wider ${isPast ? 'text-slate-400' : 'text-amber-700'}`}>
                {isPast ? 'Audiência realizada' : 'Próxima audiência'}
              </p>
              <p className={`text-sm font-bold ${isPast ? 'text-slate-500' : 'text-slate-900'}`}>
                {formatDateLong(data.hearing_date)}{data.hearing_time && ` às ${data.hearing_time.slice(0,5)}`}
              </p>
              {data.hearing_mode && !isPast && (
                <p className="inline-flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3 w-3" /><span className="capitalize">{data.hearing_mode}</span></p>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── TABS ── */}
      <div className="flex gap-1 rounded-2xl bg-slate-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition ${
              tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 active:bg-white/50'
            }`}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${tab === t.id ? 'bg-orange-100 text-orange-700' : 'bg-slate-200 text-slate-500'}`}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      <div>
        {tab === 'resumo' && <ResumoTab data={data} movements={movements} responsibleLawyer={data.responsible_lawyer} />}
        {tab === 'andamentos' && <AndamentosTab movements={movements} statusLabel={meta.label} area={data.practice_area} />}
        {tab === 'prazos' && <PrazosTab deadlines={deadlines} />}
      </div>
    </div>
  );
};

const BackBtn: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button onClick={onClick} className="inline-flex items-center gap-1.5 self-start rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-slate-900 active:bg-slate-100">
    <ArrowLeft className="h-4 w-4" /> Voltar
  </button>
);

const ResumoTab: React.FC<{ data: ProcessFull; movements: Movement[]; responsibleLawyer?: string | null }> = ({ data, movements, responsibleLawyer }) => (
  <div className="flex flex-col gap-3">
    {/* Dados gerais */}
    <div className="grid grid-cols-2 gap-2.5">
      <InfoTile label="Distribuído em" value={data.distributed_at ? formatDate(data.distributed_at) : '—'} icon={Calendar} />
      <InfoTile label="Advogado" value={responsibleLawyer || '—'} icon={Gavel} />
    </div>

    {/* Última atualização */}
    {movements.length > 0 ? (
      <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 sm:p-5">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Últimas atualizações</p>
        <div className="relative ml-1 space-y-4 border-l-2 border-slate-100 pl-4">
          {movements.slice(0, 4).map((m, i) => (
            <div key={i} className="relative">
              <div className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-orange-400" />
              <p className="text-sm font-semibold leading-snug text-slate-900">{m.nome}</p>
              <p className="mt-0.5 text-xs text-slate-500">{formatRelative(m.data_hora || m.data)}</p>
            </div>
          ))}
        </div>
        {movements.length > 4 && <p className="mt-3 text-xs text-slate-400">+ {movements.length - 4} na aba Andamentos</p>}
      </div>
    ) : (
      <div className="rounded-2xl bg-white p-5 text-center ring-1 ring-slate-200/80">
        <Activity className="mx-auto h-6 w-6 text-slate-300" />
        <p className="mt-2 text-sm text-slate-500">Ainda não há atualizações registradas.</p>
      </div>
    )}
  </div>
);

const InfoTile: React.FC<{ label: string; value: string; icon: React.ComponentType<{ className?: string }> }> = ({ label, value, icon: Icon }) => (
  <div className="rounded-2xl bg-white p-3.5 ring-1 ring-slate-200/80">
    <div className="flex items-center gap-1.5 text-slate-400"><Icon className="h-3.5 w-3.5" /><span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span></div>
    <p className="mt-1 text-sm font-semibold text-slate-800 line-clamp-1">{value}</p>
  </div>
);

const sourceLabel = (s?: string) =>
  s === 'djen' ? 'Diário Oficial' : s === 'datajud' ? 'Tribunal' : s;

const MovementItem: React.FC<{
  m: Movement;
  timeline: Movement[];
  statusLabel: string;
  area?: string | null;
}> = ({ m, timeline, statusLabel, area }) => {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [explanation, setExplanation] = useState<string | null>(null);

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
    <div className="relative">
      <div className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-orange-400 shadow-sm" />
      <p className="text-sm font-semibold leading-snug text-slate-900">{m.nome}</p>
      {m.complemento && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-600">{m.complemento}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <span>{formatDate(m.data_hora || m.data, { withTime: true })}</span>
        {m.tribunal && <span>· {sourceLabel(m.tribunal)}</span>}
      </div>

      {/* Explicação por IA */}
      {state !== 'done' && (
        <button
          onClick={explain}
          disabled={state === 'loading'}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 py-1.5 text-[11px] font-bold text-orange-700 ring-1 ring-orange-100 transition hover:bg-orange-100 disabled:opacity-60"
        >
          {state === 'loading'
            ? <><Loader2 className="h-3 w-3 animate-spin" /> Explicando...</>
            : state === 'error'
            ? <><Sparkles className="h-3 w-3" /> Tentar novamente</>
            : <><Sparkles className="h-3 w-3" /> Explicar em linguagem simples</>}
        </button>
      )}

      {state === 'done' && explanation && (
        <div className="mt-2 rounded-xl border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-orange-600">Explicação</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-700">{explanation}</p>
            </div>
          </div>
          <p className="mt-2 border-t border-orange-100 pt-1.5 text-[10px] text-slate-400">
            Gerado por IA — pode conter imprecisões. Em caso de dúvida, fale com seu advogado.
          </p>
        </div>
      )}
    </div>
  );
};

const AndamentosTab: React.FC<{ movements: Movement[]; statusLabel: string; area?: string | null }> = ({ movements, statusLabel, area }) => {
  if (!movements.length) return <EmptyState icon={Activity} title="Sem andamentos" description="Nenhuma atualização registrada ainda." />;
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 sm:p-5">
      <div className="mb-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" />
        <p className="text-[11px] leading-relaxed text-slate-500">
          Não entendeu algum andamento? Toque em <strong className="text-orange-700">Explicar em linguagem simples</strong> e a IA traduz para você — considerando o contexto do processo.
        </p>
      </div>
      <div className="relative ml-1 space-y-5 border-l-2 border-slate-100 pl-4">
        {movements.map((m, i) => <MovementItem key={i} m={m} timeline={movements} statusLabel={statusLabel} area={area} />)}
      </div>
    </div>
  );
};

const PrazosTab: React.FC<{ deadlines: Deadline[] }> = ({ deadlines }) => {
  if (!deadlines.length) return <EmptyState icon={Clock} title="Sem prazos" description="Nenhum prazo cadastrado para este processo." />;
  return (
    <div className="flex flex-col gap-2.5">
      {deadlines.map((d) => {
        const overdue = d.status === 'pendente' && new Date(d.due_date) < new Date();
        const done = d.status === 'cumprido';
        return (
          <div key={d.id} className={`flex items-center gap-3.5 rounded-2xl p-4 ring-1 ${overdue ? 'bg-rose-50 ring-rose-200' : done ? 'bg-emerald-50 ring-emerald-200' : 'bg-white ring-slate-200/80'}`}>
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${overdue ? 'bg-rose-500 text-white' : done ? 'bg-emerald-500 text-white' : 'bg-amber-100 text-amber-700'}`}>
              {done ? <CheckCircle2 className="h-5 w-5" /> : overdue ? <AlertCircle className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-slate-900">{d.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {done ? 'Cumprido' : overdue ? 'Venceu em ' : 'Vence em '}
                {!done && <span className="font-semibold">{formatDateLong(d.due_date)}</span>}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PortalProcessDetails;
