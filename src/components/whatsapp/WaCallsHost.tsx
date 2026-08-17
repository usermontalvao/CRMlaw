// Host global das chamadas de voz (WaCalls).
//
// Mesmo papel do `WhatsAppNotifyHost`: mora na raiz do app — no CRM completo e
// na janela /atendimento — para que uma chamada RECEBIDA apareça em qualquer
// tela, não só com o módulo WhatsApp aberto. É também o único lugar que liga a
// escuta de eventos (via `useWaCalls` → `waCallsStore.init`), o que garante uma
// única conexão SSE por aba.
//
// Nada de estado de chamada aqui dentro: o estado é do store, este componente
// só desenha e traduz os avisos em toasts.
import React, { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useToastContext } from '../../contexts/ToastContext';
import { useWaCalls } from '../../hooks/useWaCalls';
import { waCallsStore } from '../../services/wacalls/callStore';
import { ActiveCallModal, IncomingCallCard } from './callModals';

export const WaCallsHost: React.FC = () => {
  const toast = useToastContext();
  const { myCall, incoming, acceptCall, rejectCall, hangUp, setMuted } = useWaCalls();

  // A aba está indo embora: microfone, AudioContext e SSE liberados na saída.
  useEffect(() => () => waCallsStore.shutdown(), []);

  // Avisos do store (chamada recusada, não atendida, microfone bloqueado…)
  // viram toast do sistema — o mesmo canal de aviso do resto do CRM.
  useEffect(() => waCallsStore.onNotice(notice => {
    if (notice.kind === 'error') toast.error(notice.message, notice.description);
    else if (notice.kind === 'success') toast.success(notice.message, notice.description);
    else toast.info(notice.message, notice.description);
  }), [toast]);

  return (
    <>
      <AnimatePresence>
        {incoming && (
          <IncomingCallCard
            key={incoming.callId}
            call={incoming}
            onAccept={() => { void acceptCall(incoming.callId); }}
            onReject={() => { void rejectCall(incoming.callId); }}
          />
        )}
      </AnimatePresence>
      {myCall && (
        <ActiveCallModal
          key={myCall.callId}
          call={myCall}
          onHangUp={() => { void hangUp(myCall.callId); }}
          onToggleMute={() => setMuted(myCall.callId, !myCall.muted)}
        />
      )}
    </>
  );
};

export default WaCallsHost;
