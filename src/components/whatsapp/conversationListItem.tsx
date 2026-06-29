import React, { useEffect, useState } from 'react';
import {
  Clock, Pencil, Ban, BellOff, FileText, UserPlus, ArrowRightLeft, Tag, X,
} from 'lucide-react';
import type {
  WhatsAppConversation, WhatsAppChannel, WhatsAppDepartment, WhatsAppPresence,
} from '../../types/whatsapp.types';
import type { FunnelLabel } from '../../services/settings.service';
import {
  formatTime, prettyPhone, presenceInfo, maskName, maskPhoneFull,
  slaSignal, slaInternalSignal, abandonedSignal, transferAlert,
} from './format';
import { resolveLabelMeta } from './funnel';
import { Avatar } from './avatar';

/**
 * Linha de presença do cabeçalho (online/digitando/visto por último). Possui o
 * próprio tick de 15s para reavaliar o tempo relativo — assim o relógio vive
 * neste componente isolado em vez de re-renderizar o módulo inteiro a cada 15s.
 */
export const PresenceText: React.FC<{
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

export const DateDivider: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex justify-center my-2.5">
    <span className="px-3 py-1 rounded-full bg-white/90 text-slate-500 text-[11px] font-semibold shadow-sm">{label}</span>
  </div>
);

// Item da lista de conversas (memoizado). Os sinais de SLA/transferência/abandono
// são funções puras de `c`, então o item os calcula sozinho; só `status`/`docStatus`
// (que dependem de estado do módulo) chegam prontos como primitivos. Com props
// estáveis, o React.memo só re-renderiza a linha cuja conversa de fato mudou —
// não a lista inteira a cada evento de realtime.
export const ConversationListItem: React.FC<{
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
  funnelLabels: FunnelLabel[];
  onSelect: (id: string) => void;
  onDismissTracking?: () => void;
}> = React.memo(({ c, active, channel: ch, dept, privateMode, statusKey, statusLabel, statusCls, docStatus: ds, muted, draftPreview, funnelLabels, onSelect, onDismissTracking }) => {
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
            {onDismissTracking && (
              <button
                onClick={(e) => { e.stopPropagation(); onDismissTracking(); }}
                title="Fechar acompanhamento"
                className="inline-flex items-center justify-center h-3 w-3 rounded-full bg-white/60 hover:bg-slate-700 hover:text-white transition"
              >
                <X size={8} strokeWidth={2.75} />
              </button>
            )}
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
            const meta = resolveLabelMeta(lbl, funnelLabels);
            return (
              <span key={lbl} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold"
                style={{ background: meta.bg, color: meta.color }}>
                <Tag size={8} />{lbl}
              </span>
            );
          })}
        </div>
      </div>
    </button>
  );
});
ConversationListItem.displayName = 'ConversationListItem';
