// Painéis "Client-360" exibidos no aside da conversa do WhatsApp.
// Componentes puramente apresentacionais (props-driven) extraídos do antigo
// god-module `WhatsAppModule.tsx` para reduzir acoplamento e tamanho do arquivo.
// Não dependem da closure do orquestrador — só de props, serviços e dos mapas
// de status reexportados aqui.
import React, { useState, useEffect, useMemo } from 'react';
import {
  Loader2, Clock, ChevronUp, ChevronDown, Plus, Scale, Calendar, Pencil,
  AlertCircle, FileText, CheckCircle2, X, Ban, PenLine, Check, Link2, HandCoins,
} from 'lucide-react';
import { processService, type ProcessMovement } from '../../services/process.service';
import { whatsappService, type ClientPendings, type ClientSchedule } from '../../services/whatsapp.service';
import { signatureService } from '../../services/signature.service';
import { useToastContext } from '../../contexts/ToastContext';
import { dueInfo } from './format';
import type { ConfirmFn, WaOpenWorkspaceFn } from './types';
import type { Process, ProcessStatus, ProcessPracticeArea } from '../../types/process.types';
import type { Requirement, RequirementStatus } from '../../types/requirement.types';
import type { CalendarEventType } from '../../types/calendar.types';

export const PROC_STATUS: Record<ProcessStatus, { label: string; badge: string }> = {
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
export const PROC_AREA: Record<ProcessPracticeArea, string> = {
  trabalhista: 'Trabalhista', familia: 'Família', consumidor: 'Consumidor',
  previdenciario: 'Previdenciário', civel: 'Cível',
};

/** Linha do tempo compacta do processo (Seção 9): movimentações DataJud locais.
 *  `movements` pode vir pré-carregado em lote pelo painel (evita N+1); só busca
 *  sozinho quando não recebe a lista pronta (uso isolado/fallback). */
export const ProcessTimelineMini: React.FC<{ processId: string; movements?: ProcessMovement[] }> = ({ processId, movements }) => {
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

export const REQ_STATUS_BADGE: Record<string, string> = {
  aguardando_confeccao: 'bg-blue-100 text-blue-700',
  em_analise: 'bg-sky-100 text-sky-700',
  em_exigencia: 'bg-orange-100 text-orange-700',
  aguardando_pericia: 'bg-violet-100 text-violet-700',
  deferido: 'bg-emerald-100 text-emerald-700',
  indeferido: 'bg-red-100 text-red-700',
  ajuizado: 'bg-amber-100 text-amber-700',
};
export const REQ_STATUS_LABEL: Record<string, string> = {
  aguardando_confeccao: 'Aguard. confecção',
  em_analise: 'Em análise',
  em_exigencia: 'Em exigência',
  aguardando_pericia: 'Aguard. perícia',
  deferido: 'Deferido',
  indeferido: 'Indeferido',
  ajuizado: 'Ajuizado',
};

export const CasosPanel: React.FC<{
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
export const ClientProcessesPanel: React.FC<{ processes: Process[] | null }> = ({ processes: procs }) => {
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
export const EVENT_TYPE_LABEL: Record<CalendarEventType, string> = {
  deadline: 'Prazo', hearing: 'Audiência', requirement: 'Requerimento',
  payment: 'Pagamento', meeting: 'Reunião', pericia: 'Perícia', personal: 'Pessoal',
};

/** Classifica um vencimento (data ISO/yyyy-mm-dd) em alerta visual. */
export const TONE: Record<'red' | 'amber' | 'slate', string> = {
  red: 'text-red-600 bg-red-50 border-red-200',
  amber: 'text-amber-700 bg-amber-50 border-amber-200',
  slate: 'text-slate-500 bg-white border-[#e7e5df]',
};

export const ClientAgendaPanel: React.FC<{ schedule: ClientSchedule | null }> = ({ schedule: data }) => {
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
export const REQ_STATUS: Record<RequirementStatus, { label: string; badge: string }> = {
  aguardando_confeccao: { label: 'Aguardando confecção', badge: 'bg-slate-100 text-slate-600' },
  em_analise: { label: 'Em análise', badge: 'bg-blue-100 text-blue-700' },
  em_exigencia: { label: 'Em exigência', badge: 'bg-red-100 text-red-700' },
  aguardando_pericia: { label: 'Aguardando perícia', badge: 'bg-amber-100 text-amber-700' },
  deferido: { label: 'Deferido', badge: 'bg-emerald-100 text-emerald-700' },
  indeferido: { label: 'Indeferido', badge: 'bg-slate-100 text-slate-500' },
  ajuizado: { label: 'Ajuizado', badge: 'bg-indigo-100 text-indigo-700' },
};
export const DOC_STATUS_LABEL: Record<string, string> = { pending: 'Aguardando envio', partial: 'Envio parcial' };

export const ClientPendingsPanel: React.FC<{ pendings: ClientPendings | null; confirm?: ConfirmFn; onChanged?: () => void }> = ({ pendings: data, confirm, onChanged }) => {
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
export const ClientSignaturesPanel: React.FC<{
  signatures: import('../../types/signature.types').SignatureRequestWithSigners[] | null;
  links?: import('../../services/whatsapp/shared').ClientTemplateFillLink[] | null;
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
export const ClientAgreementsPanel: React.FC<{
  agreements: import('../../types/financial.types').Agreement[] | null;
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
