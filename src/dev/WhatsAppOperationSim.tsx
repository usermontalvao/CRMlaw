// DEV-ONLY: bancada de operação do WhatsApp (?waoperationsim=1).
//
// Roda um dia inteiro de atendimento com vários atendentes, encaminhamento
// para advogado e campanha de reativação — usando as MESMAS regras do app
// (attendanceRouting, transferPolicy, campaign). Serve para responder
// perguntas que só apareceriam em produção: "a recepção aguenta 20 contatos
// por hora?", "quantos atendimentos morrem esperando aceite do advogado?",
// "o que muda se a distribuição for automática em vez de manual?".
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Pause, SkipForward, RotateCcw, Users, Inbox, Clock3, AlertTriangle,
  CheckCircle2, ArrowRightLeft, Megaphone, Timer, UserX, Gauge,
} from 'lucide-react';
import {
  createWorld, stepWorld, runMinutes, snapshot,
  DEFAULT_SIM_CONFIG, type SimConfig, type SimState, type SimEventTone,
} from './waOperationSim';

const TONE_STYLE: Record<SimEventTone, string> = {
  info: 'text-slate-500',
  ok: 'text-emerald-600',
  warn: 'text-amber-600',
  danger: 'text-red-600',
  campaign: 'text-violet-600',
};

const BUCKET_STYLE: Record<string, string> = {
  transferencia_travada: 'bg-red-100 text-red-700',
  sla_estourado: 'bg-red-50 text-red-600',
  urgente: 'bg-orange-100 text-orange-700',
  sla_atencao: 'bg-amber-100 text-amber-700',
  fila_setor: 'bg-sky-100 text-sky-700',
  aguardando_voce: 'bg-slate-100 text-slate-600',
  normal: 'bg-slate-100 text-slate-500',
};

const Stat: React.FC<{
  icon: React.ReactNode; label: string; value: React.ReactNode;
  sub?: string; tone?: 'default' | 'danger' | 'warning' | 'success' | 'violet';
}> = ({ icon, label, value, sub, tone = 'default' }) => {
  const toneMap = {
    default: 'bg-white text-slate-700 border-[#e7e5df]',
    danger: 'bg-red-50 text-red-700 border-red-100',
    warning: 'bg-amber-50 text-amber-800 border-amber-100',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
  };
  return (
    <div className={`rounded-xl border p-3 ${toneMap[tone]}`}>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider opacity-70">
        {icon} {label}
      </div>
      <div className="text-[22px] font-bold leading-none">{value}</div>
      {sub && <div className="mt-1 text-[10.5px] opacity-60">{sub}</div>}
    </div>
  );
};

const fmtMinutes = (m: number | null) => {
  if (m == null) return '—';
  if (m < 60) return `${Math.round(m)}min`;
  return `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`;
};
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function WhatsAppOperationSim() {
  const [config, setConfig] = useState<SimConfig>(DEFAULT_SIM_CONFIG);
  const [state, setState] = useState<SimState>(() => createWorld(DEFAULT_SIM_CONFIG));
  const [running, setRunning] = useState(false);
  /** Minutos simulados por tique de 250ms. */
  const [speed, setSpeed] = useState(4);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setState(prev => (prev.minute >= 12 * 60 ? prev : runMinutes(prev, speed)));
    }, 250);
    return () => window.clearInterval(id);
  }, [running, speed]);

  // Para sozinho ao fim do expediente simulado (12h corridas).
  useEffect(() => { if (state.minute >= 12 * 60 && running) setRunning(false); }, [state.minute, running]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.events.length]);

  const reset = useCallback((next: SimConfig) => {
    setRunning(false);
    setConfig(next);
    setState(createWorld(next));
  }, []);

  const snap = useMemo(() => snapshot(state), [state]);
  const recentEvents = useMemo(() => state.events.slice(-120), [state.events]);
  const finished = state.minute >= 12 * 60;

  return (
    <div className="min-h-screen bg-[#f4f3f0] p-4 lg:p-6">
      <div className="mx-auto max-w-[1400px] space-y-4">

        {/* ── Cabeçalho + controles ── */}
        <header className="flex flex-wrap items-center gap-3 rounded-xl border border-[#e7e5df] bg-white px-4 py-3">
          <div className="mr-auto">
            <h1 className="text-[16px] font-bold text-slate-800">Simulação de operação — WhatsApp</h1>
            <p className="text-[12px] text-slate-500">
              Mesmas regras do módulo: distribuição, fila por SLA, encaminhamento para advogado e campanha.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-[#f3f2ef] px-3 py-1.5">
            <Clock3 size={14} className="text-slate-500" />
            <span className="font-mono text-[15px] font-bold text-slate-700">{snap.clock}</span>
            <span className="text-[11px] text-slate-400">({state.minute}min)</span>
          </div>

          <button
            onClick={() => setRunning(r => !r)}
            disabled={finished}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition disabled:opacity-40 ${running ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
          >
            {running ? <Pause size={14} /> : <Play size={14} />} {running ? 'Pausar' : 'Rodar'}
          </button>
          <button
            onClick={() => setState(prev => stepWorld(prev))}
            disabled={finished}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#f3f2ef] px-3 py-2 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-40"
          >
            <SkipForward size={14} /> +1min
          </button>
          <button
            onClick={() => setState(prev => runMinutes(prev, 60))}
            disabled={finished}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#f3f2ef] px-3 py-2 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-40"
          >
            <SkipForward size={14} /> +1h
          </button>
          <button
            onClick={() => reset(config)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#f3f2ef] px-3 py-2 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-200"
          >
            <RotateCcw size={14} /> Reiniciar
          </button>
        </header>

        {/* ── Parâmetros do cenário ── */}
        <section className="rounded-xl border border-[#e7e5df] bg-white px-4 py-3">
          <p className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Cenário</p>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-[11.5px] font-semibold text-slate-600">
              <span className="mb-1 block">Contatos/hora: <strong className="text-slate-800">{config.arrivalsPerHour}</strong></span>
              <input type="range" min={2} max={40} value={config.arrivalsPerHour}
                onChange={e => reset({ ...config, arrivalsPerHour: Number(e.target.value) })}
                className="w-40 accent-amber-600" />
            </label>
            <label className="text-[11.5px] font-semibold text-slate-600">
              <span className="mb-1 block">Timeout de aceite: <strong className="text-slate-800">{config.transferAcceptTimeout}min</strong></span>
              <input type="range" min={3} max={60} value={config.transferAcceptTimeout}
                onChange={e => reset({ ...config, transferAcceptTimeout: Number(e.target.value) })}
                className="w-40 accent-amber-600" />
            </label>
            <label className="text-[11.5px] font-semibold text-slate-600">
              <span className="mb-1 block">Campanha às: <strong className="text-slate-800">
                {config.campaignAtMinute == null ? 'nunca' : `${Math.floor(config.campaignAtMinute / 60) + 8}h`}
              </strong></span>
              <input type="range" min={0} max={480} step={60} value={config.campaignAtMinute ?? 0}
                onChange={e => reset({ ...config, campaignAtMinute: Number(e.target.value) })}
                className="w-40 accent-violet-600" />
            </label>
            <label className="inline-flex items-center gap-2 text-[12px] font-semibold text-slate-600">
              <input type="checkbox" checked={config.autoDistribute}
                onChange={e => reset({ ...config, autoDistribute: e.target.checked })}
                className="accent-amber-600" />
              Distribuição automática
            </label>
            <label className="inline-flex items-center gap-2 text-[12px] font-semibold text-slate-600">
              <input type="checkbox" checked={config.autoReturnStalled}
                onChange={e => reset({ ...config, autoReturnStalled: e.target.checked })}
                className="accent-amber-600" />
              Devolver aceite travado à fila
            </label>
            <label className="inline-flex items-center gap-2 text-[12px] font-semibold text-slate-600">
              <Gauge size={14} className="text-slate-400" />
              Velocidade
              <select value={speed} onChange={e => setSpeed(Number(e.target.value))}
                className="rounded-lg border border-[#e7e5df] bg-white px-2 py-1 text-[12px] outline-none">
                <option value={1}>1×</option>
                <option value={4}>4×</option>
                <option value={15}>15×</option>
                <option value={60}>60×</option>
              </select>
            </label>
            <label className="text-[11.5px] font-semibold text-slate-600">
              <span className="mb-1 block">Semente</span>
              <input type="number" value={config.seed}
                onChange={e => reset({ ...config, seed: Number(e.target.value) })}
                className="w-28 rounded-lg border border-[#e7e5df] px-2 py-1 text-[12px] outline-none" />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Mudar qualquer parâmetro reinicia o dia. A mesma semente produz exatamente a mesma sequência.
          </p>
        </section>

        {/* ── KPIs ── */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <Stat icon={<Inbox size={12} />} label="Em aberto" value={snap.open} sub={`${snap.queued} sem responsável`} />
          <Stat icon={<CheckCircle2 size={12} />} label="Concluídos" value={snap.closed} tone="success" />
          <Stat icon={<Timer size={12} />} label="TMR" value={fmtMinutes(snap.avgFirstResponse)} sub="1ª resposta" />
          <Stat icon={<Clock3 size={12} />} label="TMA" value={fmtMinutes(snap.avgResolution)} sub="até concluir" />
          <Stat icon={<AlertTriangle size={12} />} label="SLA estourado" value={snap.slaBreached}
            tone={snap.slaBreached > 0 ? 'danger' : 'default'} sub=">60min p/ 1ª resposta" />
          <Stat icon={<UserX size={12} />} label="Desistências" value={snap.abandoned}
            tone={snap.abandoned > 0 ? 'danger' : 'default'} />
          <Stat icon={<ArrowRightLeft size={12} />} label="Encaminhamentos" value={snap.transfersMade}
            sub={`${snap.transfersAccepted} aceitos · ${snap.transfersExpired} estourados`}
            tone={snap.transfersExpired > 0 ? 'warning' : 'default'} />
          <Stat icon={<Megaphone size={12} />} label="Campanha" value={snap.campaign.sent}
            sub={`${snap.campaign.replied} respostas · ${snap.campaign.optedOut} opt-out`} tone="violet" />
        </section>

        <div className="grid gap-4 lg:grid-cols-3">

          {/* ── Atendentes ── */}
          <section className="rounded-xl border border-[#e7e5df] bg-white p-4">
            <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <Users size={12} /> Atendentes
            </p>
            <div className="space-y-3">
              {state.agents.map(agent => {
                const load = snap.loads[agent.userId] ?? 0;
                const occ = agent.capacity > 0 ? Math.min(1, load / agent.capacity) : 0;
                return (
                  <div key={agent.userId}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold text-slate-700">
                        {agent.name}
                        <span className="ml-1.5 text-[10.5px] font-normal text-slate-400">{agent.role}</span>
                      </span>
                      <span className={`text-[11.5px] font-bold ${occ >= 1 ? 'text-red-600' : occ > 0.7 ? 'text-amber-600' : 'text-slate-500'}`}>
                        {load}/{agent.capacity}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full transition-all ${occ >= 1 ? 'bg-red-500' : occ > 0.7 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${occ * 100}%` }} />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-slate-400">
                      <span>{agent.stats.received} recebidos</span>
                      <span>{agent.stats.answered} respostas</span>
                      <span>{agent.stats.closed} concluídos</span>
                      {agent.stats.transferredOut > 0 && <span>{agent.stats.transferredOut} encaminhados</span>}
                      {agent.stats.accepted > 0 && <span>{agent.stats.accepted} aceites</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Fila priorizada ── */}
          <section className="rounded-xl border border-[#e7e5df] bg-white p-4">
            <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <Inbox size={12} /> Fila — ordem de urgência
            </p>
            {snap.queue.length === 0 ? (
              <p className="py-8 text-center text-[12.5px] text-slate-400">Nada esperando agora.</p>
            ) : (
              <div className="space-y-1.5">
                {snap.queue.map((item, i) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg border border-[#f1f0ec] px-2.5 py-1.5">
                    <span className="w-4 shrink-0 text-[10px] font-bold text-slate-300">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-700">{item.name}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${BUCKET_STYLE[item.bucket] ?? BUCKET_STYLE.normal}`}>
                      {item.label}
                    </span>
                    <span className="w-16 shrink-0 truncate text-right text-[10.5px] text-slate-400">
                      {item.assignedTo ?? 'sem dono'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Campanha */}
            <p className="mb-2 mt-4 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <Megaphone size={12} /> Campanha de reativação
            </p>
            {!state.campaign.launched ? (
              <p className="text-[12px] text-slate-400">
                {config.campaignAtMinute == null ? 'Desligada neste cenário.' : 'Ainda não disparada.'}
              </p>
            ) : (
              <div className="space-y-1 text-[12px] text-slate-600">
                <div className="flex justify-between"><span>Planejados / enviados</span><strong>{snap.campaign.planned} / {snap.campaign.dispatched}</strong></div>
                <div className="flex justify-between"><span>Fora das regras</span><strong>{snap.campaign.skipped}</strong></div>
                <div className="flex justify-between"><span>Entrega</span><strong>{pct(snap.campaign.deliveryRate)}</strong></div>
                <div className="flex justify-between"><span>Leitura</span><strong>{pct(snap.campaign.readRate)}</strong></div>
                <div className="flex justify-between"><span>Resposta</span><strong>{pct(snap.campaign.replyRate)}</strong></div>
                <div className="flex justify-between"><span>Opt-out</span><strong className={snap.campaign.optOutRate > 0.05 ? 'text-red-600' : ''}>{pct(snap.campaign.optOutRate)}</strong></div>
                <div className="flex justify-between"><span>Conversão</span><strong className="text-emerald-600">{pct(snap.campaign.conversionRate)}</strong></div>
                {state.campaign.skipped.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-slate-400">Por que ficaram de fora</summary>
                    <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-[11px] text-slate-500">
                      {state.campaign.skipped.slice(0, 40).map(s => (
                        <li key={s.id}>· {s.reason}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </section>

          {/* ── Log ── */}
          <section className="flex max-h-[560px] flex-col rounded-xl border border-[#e7e5df] bg-white p-4">
            <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <Clock3 size={12} /> Diário da operação
            </p>
            <div ref={logRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {recentEvents.map((e, i) => (
                <div key={`${e.minute}-${i}`} className="flex gap-2 text-[11.5px] leading-snug">
                  <span className="shrink-0 font-mono text-[10.5px] text-slate-300">
                    {String(8 + Math.floor(e.minute / 60)).padStart(2, '0')}:{String(e.minute % 60).padStart(2, '0')}
                  </span>
                  <span className={TONE_STYLE[e.tone]}>{e.text}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {finished && (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
            Expediente simulado concluído (12h). Ajuste o cenário e rode de novo para comparar.
          </div>
        )}
      </div>
    </div>
  );
}
