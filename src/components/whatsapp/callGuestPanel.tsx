// A CARA DO SEGUNDO ATENDENTE — chamar alguém, transferir, e o convite chegando.
//
// Três peças, e as três existem por causa de uma limitação que a tela não pode
// esconder (ver o cabeçalho de `services/wacalls/callBridge`): quem atendeu é a
// PONTE de áudio de todo mundo. Fechar a janela derruba a ligação para os dois.
// Por isso o painel avisa em letras, e não em nota de rodapé.
//
// Linguagem visual: a mesma do painel da chamada (neutros quentes, verde para
// entrar, vermelho para sair) — quem está com o cliente na linha não deve ter
// de aprender uma segunda gramática de botões no meio da conversa.
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Mic, MicOff, PhoneOff, UserPlus, Users, X, ArrowRightLeft, AlertTriangle } from 'lucide-react';
import { Avatar } from './avatar';
import { prettyPhone } from './format';
import {
  ANCHOR_WARNING, emptyInviteReason, guestStatusLabel, invitableOperators,
  inviteExplanation, inviteHeadline,
  type CallInviteMode, type InvitableOperator,
} from '../../services/wacalls/callGuests';
import type { CallGuest, CallInvite } from '../../services/wacalls/callBridge';

/** Iniciais para o rosto de quem não tem foto no cadastro. */
const iniciais = (nome: string | null): string => {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
};

/**
 * A parte do painel da chamada que trata de gente: quem já está na ligação e o
 * botão para chamar mais alguém.
 *
 * Mora DENTRO da janelinha da chamada de propósito — chamar um colega é uma
 * decisão que se toma olhando para a ligação em curso, não numa tela à parte.
 */
export const CallGuestsSection: React.FC<{
  guests: CallGuest[];
  operators: InvitableOperator[];
  me: string | null;
  /** Falso enquanto a chamada não está de pé: não se convida para o que não existe. */
  canInvite: boolean;
  onInvite: (userId: string, name: string | null, mode: CallInviteMode) => void;
  onRemove: (userId: string) => void;
}> = ({ guests, operators, me, canInvite, onInvite, onRemove }) => {
  const [abrindo, setAbrindo] = useState<CallInviteMode | null>(null);
  const dentro = guests.filter(g => g.status !== 'gone' && g.status !== 'declined').map(g => g.userId);
  const disponiveis = invitableOperators({ operators, me, alreadyIn: dentro });

  return (
    <div className="border-t border-[#f1f0ec] px-3 py-2.5">
      {guests.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {guests.map(guest => (
            <li key={guest.userId} className="flex items-center gap-2 rounded-lg bg-[#f7f6f3] px-2 py-1.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                {iniciais(guest.name)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-slate-600">
                {guestStatusLabel(guest.status, guest.name)}
              </span>
              {guest.status === 'live' && (
                <button
                  onClick={() => onRemove(guest.userId)}
                  title="Tirar da ligação"
                  className="rounded-md p-1 text-slate-400 transition hover:bg-white hover:text-red-600"
                >
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {abrindo === null ? (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAbrindo('assist')}
            disabled={!canInvite}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#f3f2ef] px-2 py-1.5 text-[11.5px] font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-45"
          >
            <UserPlus size={13} /> Chamar
          </button>
          <button
            onClick={() => setAbrindo('transfer')}
            disabled={!canInvite}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#f3f2ef] px-2 py-1.5 text-[11.5px] font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-45"
          >
            <ArrowRightLeft size={13} /> Transferir
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-[#e7e5df] bg-white p-1.5">
          <div className="mb-1 flex items-center gap-1.5 px-1">
            <Users size={12} className="text-slate-400" />
            <p className="flex-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">
              {abrindo === 'transfer' ? 'Transferir para' : 'Chamar para a ligação'}
            </p>
            <button onClick={() => setAbrindo(null)} className="rounded p-0.5 text-slate-400 hover:text-slate-600">
              <X size={12} />
            </button>
          </div>
          {disponiveis.length === 0 ? (
            // Lista vazia SEMPRE explica o motivo: "ninguém online" e "todos em
            // ligação" levam a decisões diferentes de quem está com o cliente.
            <p className="px-1.5 py-2 text-[11px] leading-snug text-slate-500">
              {emptyInviteReason({ operators, me, alreadyIn: dentro })}
            </p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {disponiveis.map(op => (
                <li key={op.userId}>
                  <button
                    onClick={() => { onInvite(op.userId, op.name, abrindo); setAbrindo(null); }}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition hover:bg-[#f7f6f3]"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">
                      {iniciais(op.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-700">
                      {op.name || 'Atendente sem nome no cadastro'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

/** O aviso de que esta janela segura a ligação de todo mundo. */
export const AnchorNotice: React.FC = () => (
  <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2">
    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
    <p className="text-[11px] font-semibold leading-snug text-amber-800">{ANCHOR_WARNING}</p>
  </div>
);

/**
 * O CONVITE CHEGANDO na tela de quem foi chamado.
 *
 * No alto e ao centro, como o cartão de chamada recebida — é uma ligação de
 * verdade esperando resposta, e não uma notificação que pode ficar para depois.
 */
export const CallInviteCard: React.FC<{
  invite: CallInvite;
  onAccept: () => void;
  onDecline: () => void;
}> = ({ invite, onAccept, onDecline }) => {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      role="dialog"
      aria-label="Convite para entrar em uma ligação"
      className="fixed left-1/2 top-4 w-[min(92vw,22rem)] -translate-x-1/2 overflow-hidden rounded-2xl border border-[#e7e5df] bg-white shadow-[0_20px_50px_-16px_rgba(15,23,42,0.5)]"
      style={{ zIndex: 2147483000 }}
    >
      <div className="flex items-center gap-2 border-b border-[#f1f0ec] bg-emerald-50 px-3 py-2">
        <UserPlus size={14} className="text-emerald-700" />
        <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">
          {invite.mode === 'transfer' ? 'Transferência de ligação' : 'Convite para ligação'}
        </p>
      </div>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <Avatar url={null} name={invite.contactName} phone={invite.phone} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-slate-800">
            {invite.contactName || (invite.phone ? prettyPhone(invite.phone) : 'Número não identificado')}
          </p>
          <p className="truncate text-[11.5px] font-semibold text-slate-500">
            {inviteHeadline(invite.mode, invite.fromName)}
          </p>
        </div>
      </div>
      <p className="px-4 pb-3 text-[11.5px] leading-snug text-slate-500">{inviteExplanation(invite.mode)}</p>
      <div className="flex items-center gap-2 border-t border-[#f1f0ec] px-3 py-2.5">
        <button
          onClick={onDecline}
          className="flex-1 rounded-lg bg-[#f3f2ef] px-3 py-2 text-[12px] font-bold text-slate-600 transition hover:bg-slate-200"
        >
          Agora não
        </button>
        <button
          onClick={onAccept}
          className="flex-[1.4] rounded-lg bg-emerald-600 px-3 py-2 text-[12px] font-bold text-white shadow-sm transition hover:bg-emerald-700"
        >
          {invite.mode === 'transfer' ? 'Assumir a ligação' : 'Entrar na ligação'}
        </button>
      </div>
    </motion.div>,
    document.body,
  );
};

/**
 * A pílula de quem ENTROU numa ligação de outra pessoa.
 *
 * Deliberadamente pequena: o convidado não é dono da chamada — ele não encerra
 * a ligação do cliente, só sai dela. Encerrar é de quem atendeu.
 */
export const GuestCallBar: React.FC<{
  invite: CallInvite;
  muted: boolean;
  onToggleMute: () => void;
  onLeave: () => void;
}> = ({ invite, muted, onToggleMute, onLeave }) => {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#e7e5df] bg-white px-3 py-1.5 shadow-[0_14px_36px_-14px_rgba(15,23,42,0.45)]"
      style={{ zIndex: 2147483000 }}
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
      <p className="max-w-[42vw] truncate text-[12px] font-bold text-slate-700">
        {invite.contactName || (invite.phone ? prettyPhone(invite.phone) : 'Ligação')}
      </p>
      <span className="text-[11px] font-semibold text-slate-400">
        {invite.mode === 'transfer' ? 'assumida' : `com ${invite.fromName || 'o colega'}`}
      </span>
      <button
        onClick={onToggleMute}
        title={muted ? 'Reativar o microfone' : 'Silenciar o microfone'}
        className={`rounded-full p-1.5 transition ${
          muted ? 'bg-amber-100 text-amber-700' : 'text-slate-500 hover:bg-[#f3f2ef]'
        }`}
      >
        {muted ? <MicOff size={14} /> : <Mic size={14} />}
      </button>
      <button
        onClick={onLeave}
        title="Sair da ligação"
        className="rounded-full bg-red-600 p-1.5 text-white transition hover:bg-red-700"
      >
        <PhoneOff size={14} />
      </button>
    </motion.div>,
    document.body,
  );
};
