// A cara das chamadas de voz: o convite de chamada recebida e o painel da
// chamada em andamento.
//
// Linguagem visual do módulo (neutros quentes, cantos generosos, framer-motion
// nas entradas). Duas escolhas de cor fogem do âmbar habitual e são
// deliberadas: verde para atender/ligar e vermelho para recusar/desligar — num
// telefone, essas duas cores JÁ significam isso para qualquer pessoa, e hesitar
// meio segundo com o cliente na linha é pior do que a coerência de paleta.
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { Avatar } from './avatar';
import { prettyPhone } from './format';
import { callElapsedSeconds, formatCallTimer, phaseLabel } from '../../services/wacalls/callOutcome';
import type { WaCall } from '../../services/wacalls/types';

/** Nome na tela: cadastro/contato quando o CRM reconhece o número; senão, o número. */
export const callDisplayName = (call: WaCall): string => call.contact?.name || prettyPhone(call.phone);

/** Cronômetro vivo. Só corre depois que a chamada foi atendida. */
const CallTimer: React.FC<{ connectedAt: number | null }> = ({ connectedAt }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!connectedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [connectedAt]);
  return <span className="tabular-nums">{formatCallTimer(callElapsedSeconds(connectedAt, now))}</span>;
};

/**
 * Chamada recebida — o cartão que aparece sozinho, em qualquer tela do CRM.
 *
 * Fica no alto e à direita, o mesmo canto dos avisos de mensagem nova, e por
 * cima deles (z acima): uma linha tocando não pode ficar atrás de um toast.
 */
export const IncomingCallCard: React.FC<{
  call: WaCall;
  onAccept: () => void;
  onReject: () => void;
}> = ({ call, onAccept, onReject }) => createPortal(
  <motion.div
    initial={{ opacity: 0, y: -12, scale: 0.97 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: -12, scale: 0.97 }}
    transition={{ type: 'spring', stiffness: 320, damping: 26 }}
    role="alertdialog"
    aria-label="Chamada de WhatsApp recebida"
    className="fixed right-4 top-4 z-[95] w-[min(94vw,22rem)] overflow-hidden rounded-2xl border border-[#e7e5df] bg-white shadow-2xl"
  >
    <div className="flex items-center gap-2 bg-emerald-600 px-4 py-2 text-white">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
      </span>
      <p className="text-[12px] font-bold uppercase tracking-wide">Chamada WhatsApp</p>
    </div>
    <div className="flex items-center gap-3 px-4 py-3.5">
      <Avatar url={call.contact?.avatarUrl ?? null} name={call.contact?.name ?? null} phone={call.phone} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] font-bold text-slate-800">{callDisplayName(call)}</p>
        {/* Número desconhecido já É o título; repeti-lo abaixo só ocupava linha. */}
        {call.contact?.name && <p className="truncate text-[12px] text-slate-500">{prettyPhone(call.phone)}</p>}
      </div>
    </div>
    <div className="flex gap-2 border-t border-[#f1f0ec] p-3">
      <button
        onClick={onReject}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#e2e0d9] bg-white px-3 py-2.5 text-[13px] font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
      >
        <PhoneOff size={16} /> Recusar
      </button>
      <button
        onClick={onAccept}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-emerald-700"
      >
        <Phone size={16} /> Atender
      </button>
    </div>
  </motion.div>,
  document.body,
);

/** O painel da chamada em curso (ou da que acabou de terminar). */
export const ActiveCallModal: React.FC<{
  call: WaCall;
  onHangUp: () => void;
  onToggleMute: () => void;
}> = ({ call, onHangUp, onToggleMute }) => {
  const finished = call.phase === 'ENDED' || call.phase === 'FAILED';
  const status = call.error && call.phase === 'FAILED' ? call.error : phaseLabel(call.phase, call.direction);

  return createPortal(
    <div className="fixed inset-0 z-[94] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]" />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        role="dialog"
        aria-label="Chamada em andamento"
        className="relative w-[min(94vw,20rem)] overflow-hidden rounded-2xl border border-[#e7e5df] bg-white shadow-2xl"
      >
        <div className={`h-1 w-full ${finished ? 'bg-slate-300' : 'bg-emerald-500'}`} />
        <div className="flex flex-col items-center gap-1 px-6 pb-5 pt-7 text-center">
          <div className="relative">
            <Avatar url={call.contact?.avatarUrl ?? null} name={call.contact?.name ?? null} phone={call.phone} size={76} />
            {call.phase === 'ACTIVE' && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white">
                <Phone size={11} className="text-white" />
              </span>
            )}
          </div>
          <p className="mt-2.5 max-w-full truncate text-[16px] font-bold text-slate-800">{callDisplayName(call)}</p>
          {call.contact?.name && <p className="text-[12px] text-slate-400">{prettyPhone(call.phone)}</p>}
          <p className={`mt-2 text-[13px] font-semibold ${finished ? 'text-slate-500' : 'text-emerald-600'}`}>{status}</p>
          <p className="mt-1 text-[22px] font-bold tracking-tight text-slate-700">
            <CallTimer connectedAt={call.connectedAt} />
          </p>
        </div>
        {!finished && (
          <div className="flex items-start justify-center gap-10 border-t border-[#f1f0ec] px-6 py-4">
            <button onClick={onToggleMute} className="group flex flex-col items-center gap-1.5" aria-pressed={call.muted}>
              <span className={`flex h-12 w-12 items-center justify-center rounded-full transition ${
                call.muted ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-[#f3f2ef] text-slate-600 hover:bg-slate-200'
              }`}>
                {call.muted ? <MicOff size={20} /> : <Mic size={20} />}
              </span>
              <span className="text-[11px] font-semibold text-slate-500">{call.muted ? 'Reativar' : 'Silenciar'}</span>
            </button>
            <button onClick={onHangUp} className="group flex flex-col items-center gap-1.5" disabled={call.phase === 'ENDING'}>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow-sm transition hover:bg-red-700 group-disabled:opacity-60">
                <PhoneOff size={20} />
              </span>
              <span className="text-[11px] font-semibold text-slate-500">Encerrar</span>
            </button>
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
};
