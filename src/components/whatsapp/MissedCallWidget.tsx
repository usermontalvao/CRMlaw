// O AVISO DE CHAMADA PERDIDA — o cartão que fica na tela, em qualquer módulo.
//
// A ligação perdida já virava linha no histórico e distintivo na aba de
// Ligações, e as duas coisas exigem que alguém ABRA a inbox para descobrir que
// perdeu uma chamada. Quem estava no processo, na agenda ou no editor não
// descobria; e um toast, que some em cinco segundos, some justamente enquanto a
// pessoa está falando com outro cliente. Por isso este cartão FICA — como a
// notificação de chamada perdida do celular, que espera você olhar.
//
// TRÊS COISAS ORIENTAM O DESENHO:
//
//  1. QUEM LIGOU, EM PRIMEIRO LUGAR. Rosto e nome grandes; a hora ao lado. Um
//     aviso que obriga a abrir outra tela para saber de quem é não adiantou
//     nada. Quem ligou três vezes é UMA linha com "3 chamadas" (ver
//     `missedCalls.ts`).
//  2. AS DUAS AÇÕES NA LINHA. Ligar de volta e abrir a conversa são o que se
//     quer fazer olhando para uma chamada perdida — e fazer qualquer uma das
//     duas JÁ é ter visto o aviso, então a linha sai da tela sozinha.
//  3. NASCE NO ALTO E AO CENTRO — o mesmo lugar do convite de chamada
//     recebida, e sem disputa: o aviso de perdida se cala enquanto o telefone
//     toca. É onde os olhos já estão e o único ponto do alto que não briga com
//     a coluna de avisos de mensagem nova (canto superior direito). Dali é
//     arrastável, encolhe numa faixa e lembra onde foi deixado — porque ele
//     fica na tela por muito tempo.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, MessageSquare, PhoneMissed, Phone, X } from 'lucide-react';
import { Avatar } from './avatar';
import { callHistoryIdentity } from './callHistory';
import { topCenterPosition } from './callWidgetPlacement';
import { useDraggablePosition } from './callModals';
import { normalizePhone, resolveAvatarUrl } from '../../services/whatsapp/shared';
import { useContactProbes } from './contactProbes';
import {
  MISSED_CALL_VISIBLE_GROUPS,
  formatMissedCallTime,
  groupMissedCalls,
  missedCallRepeatLabel,
  missedCallsHeadline,
  type MissedCall,
} from '../../services/wacalls/missedCalls';

/** Abaixo do painel da chamada em curso (2147483100): uma linha aberta vem antes. */
const Z_MISSED = 2147483050;
const POSITION_KEY = 'wa:missedCallPos';
const COLLAPSED_KEY = 'wa:missedCallCollapsed';
const CARD_SIZE = { width: 352, height: 260 };

/**
 * O rosto de quem ligou.
 *
 * Duas origens, porque as duas fontes do aviso são diferentes: a chamada que
 * tocou nesta aba traz a URL já assinada; a que veio do registro traz o
 * CAMINHO no bucket, que só vira imagem depois de assinado. Sem foto nenhuma,
 * as iniciais — nunca um espaço vazio.
 */
const MissedAvatar: React.FC<{
  call: MissedCall;
  name: string;
  size: number;
  /** Foto PÚBLICA do WhatsApp, para quem não tem cadastro nenhum aqui. */
  fallbackUrl?: string | null;
}> = ({ call, name, size, fallbackUrl }) => {
  const [url, setUrl] = useState<string | null>(call.avatarUrl);
  useEffect(() => {
    setUrl(call.avatarUrl);
    if (call.avatarUrl || !call.avatarPath) return;
    let vivo = true;
    resolveAvatarUrl(call.avatarPath).then(u => { if (vivo) setUrl(u); }).catch(() => { /* iniciais */ });
    return () => { vivo = false; };
  }, [call.avatarUrl, call.avatarPath]);
  return <Avatar url={url || fallbackUrl || null} name={name} phone={call.phone} size={size} />;
};

export const MissedCallWidget: React.FC<{
  calls: MissedCall[];
  /** Dá para discar agora? (serviço no ar e conta conectada) */
  canCall: boolean;
  onCallBack: (call: MissedCall) => void;
  onOpenConversation?: (conversationId: string) => void;
  /** "Já vi esta linha" — chega com todas as chamadas do grupo. */
  onDismiss: (callIds: string[]) => void;
  onDismissAll: () => void;
}> = ({ calls, canCall, onCallBack, onOpenConversation, onDismiss, onDismissAll }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const { pos, dragging, handlers } = useDraggablePosition(cardRef, {
    storageKey: POSITION_KEY, fallbackSize: CARD_SIZE, place: topCenterPosition,
  });
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  // O relógio da linha ("há 5 min") precisa envelhecer sozinho: o cartão fica
  // na tela por muito tempo e ninguém recarrega a página para vê-lo mudar.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Quem não tem rosto vindo do CRM ganha a foto pública do WhatsApp — a
  // mesma sondagem (com cache) que a agenda usa. Sem cadastro, o cartão fica
  // com o número e a cara da pessoa, em vez de um número sozinho.
  const semRosto = calls.filter(c => !c.avatarUrl && !c.avatarPath && c.phone).map(c => c.phone);
  const fotosPublicas = useContactProbes(semRosto);

  const trocarEncolhido = (valor: boolean) => {
    setCollapsed(valor);
    try { localStorage.setItem(COLLAPSED_KEY, valor ? '1' : '0'); } catch { /* sem persistência */ }
  };

  if (typeof document === 'undefined' || calls.length === 0) return null;

  const grupos = groupMissedCalls(calls);
  const visiveis = grupos.slice(0, MISSED_CALL_VISIBLE_GROUPS);
  const escondidos = grupos.length - visiveis.length;

  return createPortal(
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      role="status"
      aria-label={missedCallsHeadline(calls.length)}
      className="fixed w-[min(92vw,22rem)] overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-[0_18px_50px_-14px_rgba(15,23,42,0.45)]"
      style={{ left: pos.x, top: pos.y, zIndex: Z_MISSED }}
    >
      <div
        {...handlers}
        className={`flex items-center gap-2 bg-rose-50 px-3 py-2 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <PhoneMissed size={15} className="shrink-0 text-rose-600" />
        <p className="flex-1 select-none text-[12px] font-bold uppercase tracking-wide text-rose-700">
          {missedCallsHeadline(calls.length)}
        </p>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => trocarEncolhido(!collapsed)}
          title={collapsed ? 'Mostrar quem ligou' : 'Encolher (o aviso continua)'}
          className="rounded-lg p-1 text-rose-400 transition hover:bg-white hover:text-rose-600"
        >
          {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onDismissAll}
          title="Já vi — dispensar"
          className="rounded-lg p-1 text-rose-400 transition hover:bg-white hover:text-rose-600"
        >
          <X size={15} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <ul className="divide-y divide-[#f1f0ec]">
              {visiveis.map(grupo => {
                const { call, count, callIds } = grupo;
                const identidade = callHistoryIdentity({
                  id: call.callId,
                  direction: 'inbound',
                  outcome: 'missed',
                  phone: call.phone,
                  peerLid: call.lid,
                  contactName: call.name,
                  startedAt: new Date(call.startedAt).toISOString(),
                });
                const repetiu = missedCallRepeatLabel(count);
                return (
                  <li key={grupo.key} className="flex items-center gap-2.5 px-3 py-2.5">
                    <MissedAvatar
                      call={call}
                      name={identidade.unknown ? '' : identidade.title}
                      size={38}
                      fallbackUrl={fotosPublicas.get(normalizePhone(call.phone))?.avatarUrl ?? null}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-[13.5px] font-bold ${
                        identidade.unknown ? 'italic text-slate-400' : 'text-slate-800'
                      }`}>
                        {identidade.title}
                      </p>
                      <p className="flex items-center gap-1.5 truncate text-[11.5px] text-slate-500">
                        <span>{formatMissedCallTime(call.startedAt, now)}</span>
                        {repetiu && <span className="font-semibold text-rose-600">· {repetiu}</span>}
                      </p>
                    </div>
                    {/* Ligar de volta e abrir a conversa: fazer qualquer uma das
                        duas É ter visto o aviso, então a linha sai junto. */}
                    {identidade.callable && (
                      <button
                        onClick={() => { onCallBack(call); onDismiss(callIds); }}
                        disabled={!canCall}
                        title={canCall ? 'Ligar de volta' : 'O serviço de chamadas está indisponível'}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-40"
                      >
                        <Phone size={15} />
                      </button>
                    )}
                    {call.conversationId && onOpenConversation && (
                      <button
                        onClick={() => { onOpenConversation(call.conversationId!); onDismiss(callIds); }}
                        title="Abrir a conversa"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f3f2ef] text-slate-600 transition hover:bg-slate-200"
                      >
                        <MessageSquare size={15} />
                      </button>
                    )}
                    <button
                      onClick={() => onDismiss(callIds)}
                      title="Já vi esta"
                      className="flex h-8 w-7 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-[#f3f2ef] hover:text-slate-500"
                    >
                      <X size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
            {escondidos > 0 && (
              <p className="border-t border-[#f1f0ec] px-3 py-2 text-[11.5px] text-slate-400">
                e mais {escondidos} {escondidos === 1 ? 'contato' : 'contatos'} — a lista completa está na aba Ligações.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>,
    document.body,
  );
};

export default MissedCallWidget;
