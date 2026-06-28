// Banner de resumo do cliente no topo da thread + cartões hover (HoverDetail).
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  UserCheck, FileText, X, FilePlus, Scale, History, MapPin, User as UserIcon,
  Calendar, CalendarClock, Pencil, Clock, Check, Eye, PenLine,
} from 'lucide-react';
import { summarizeOverview, type ClientOverview } from '../../services/whatsapp.service';
import { dueInfo, lastSeenLabel, fmtDateTime } from './format';
import { PROC_STATUS, PROC_AREA, REQ_STATUS_BADGE, REQ_STATUS_LABEL } from './clientPanels';
import type { WaOpenWorkspaceFn } from './types';
import type { Requirement } from '../../types/requirement.types';

const HD_WIDTH_PX: Record<string, number> = { 'w-72': 288, 'w-80': 320, 'w-96': 384 };

// O painel é renderizado em portal (document.body) com posição fixa calculada a
// partir do gatilho. Isso evita que ele seja cortado/escape pelo `overflow-hidden`
// do widget flutuante (abria "abaixo do widget"); ele se ancora ao gatilho,
// fixa a largura ao viewport e inverte para cima quando não há espaço abaixo.
const HoverDetail: React.FC<{ trigger: React.ReactNode; width?: string; children: React.ReactNode }> = ({ trigger, width = 'w-72', children }) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null);

  const open = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(HD_WIDTH_PX[width] ?? 288, vw - margin * 2);
    const left = Math.max(margin, Math.min(r.left, vw - w - margin));
    const spaceBelow = vh - r.bottom - margin * 2;
    const spaceAbove = r.top - margin * 2;
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      setPos({ left, bottom: vh - r.top + 6, maxH: Math.max(140, spaceAbove) });
    } else {
      setPos({ left, top: r.bottom + 6, maxH: Math.max(140, spaceBelow) });
    }
  }, [width]);

  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPos(null), 120);
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  return (
    <span ref={anchorRef} className="relative inline-flex items-center gap-1 cursor-default"
      onMouseEnter={open} onMouseLeave={scheduleClose}>
      {trigger}
      {pos && createPortal(
        <span onMouseEnter={cancelClose} onMouseLeave={scheduleClose}
          className={`fixed z-[10000] ${width} max-w-[calc(100vw-16px)] text-[12px]`}
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}>
          <span className="block rounded-xl border border-[#e7e5df] bg-white p-3 shadow-xl text-slate-600 normal-case tracking-normal font-normal overflow-auto"
            style={{ maxHeight: pos.maxH }}>
            {children}
          </span>
        </span>,
        document.body
      )}
    </span>
  );
};

const DOC_REQ_STATUS_LABEL: Record<string, string> = { pending: 'Aguardando', partial: 'Parcial', complete: 'Concluído', cancelled: 'Cancelado' };

export const ConversationSummaryBanner: React.FC<{ overview: ClientOverview | null; docStatus?: 'awaiting' | 'ready' | null; clientId?: string | null; embedded?: boolean; onOpenWorkspace?: WaOpenWorkspaceFn; onDismissDocReady?: () => void; onDismissTemplateFill?: (linkId: string) => void }> = ({ overview, docStatus, clientId, embedded, onOpenWorkspace, onDismissDocReady, onDismissTemplateFill }) => {
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
    <div className={`flex items-center gap-y-1 flex-wrap bg-amber-50/70 border-b border-amber-100 text-[12px] text-slate-600 ${embedded ? 'gap-x-3 px-3 py-1.5' : 'gap-x-4 px-5 py-2'}`}>
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
            <button onClick={() => onDismissTemplateFill(trackedFill.id)}
              title="Parar de acompanhar este link e interromper os lembretes automáticos"
              className="ml-1 inline-flex items-center gap-0.5 pl-1 pr-1.5 py-0.5 rounded-full bg-white/80 border border-black/10 text-[10px] font-semibold text-slate-600 hover:bg-rose-600 hover:text-white hover:border-rose-600 transition">
              <X size={11} strokeWidth={2.75} /> Parar
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
            {embedded ? (
              <><strong className="text-slate-700">{deadlines.length}</strong> {deadlines.length > 1 ? 'prazos' : 'prazo'}</>
            ) : (
              <>Próx. prazo: <strong className="text-slate-700 truncate max-w-[180px]">{s.nextDeadline.title}</strong></>
            )}
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
            {embedded ? (
              <><strong className="text-slate-700">{events.length}</strong> {events.length > 1 ? 'compromissos' : 'compromisso'}</>
            ) : (
              <>
                <strong className="text-slate-700 truncate max-w-[160px]">{s.nextEvent.title}</strong>
                <span className="text-slate-400">{new Date(s.nextEvent.start_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
              </>
            )}
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
