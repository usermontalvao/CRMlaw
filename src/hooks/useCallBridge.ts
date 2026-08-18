// A janela do React para a ponte entre navegadores (ver `callBridge`).
//
// Mesmo padrão do `useWaCalls` e do `useMissedCalls`: o estado real vive fora
// do React porque ele precisa sobreviver à troca de módulo — quem entrou numa
// ligação como segundo atendente continua nela ao abrir o processo do cliente.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { callBridge, type CallBridgeSnapshot } from '../services/wacalls/callBridge';
import { operatorPresence, type OperatorPresence } from '../services/wacalls/operatorPresence';
import type { CallInviteMode } from '../services/wacalls/callGuests';

export interface UseCallBridge extends CallBridgeSnapshot {
  accept: () => void;
  decline: () => void;
  leave: () => void;
  setGuestMuted: (muted: boolean) => void;
  convidar: (params: {
    callId: string;
    toUserId: string;
    toName: string | null;
    mode: CallInviteMode;
    contactName: string | null;
    phone: string;
    conversationId: string | null;
    clientId: string | null;
  }) => void;
  removeGuest: (callId: string, userId: string) => void;
}

export function useCallBridge(): UseCallBridge {
  const snapshot = useSyncExternalStore(callBridge.subscribe, callBridge.getSnapshot);

  useEffect(() => { callBridge.init(); }, []);

  return {
    ...snapshot,
    accept: useCallback(() => { void callBridge.accept(); }, []),
    decline: useCallback(() => callBridge.decline(), []),
    leave: useCallback(() => callBridge.leave(), []),
    setGuestMuted: useCallback((muted: boolean) => callBridge.setGuestMuted(muted), []),
    convidar: useCallback((params: Parameters<typeof callBridge.invite>[0]) => {
      void callBridge.invite(params);
    }, []),
    removeGuest: useCallback((callId: string, userId: string) => callBridge.removeGuest(callId, userId), []),
  };
}

/**
 * Quem está com o CRM aberto agora, uma linha por pessoa.
 *
 * Existe como hook próprio porque a presença muda por conta própria (colega
 * chegou, colega entrou em ligação) e a lista de convite precisa acompanhar sem
 * o operador fechar e abrir o painel.
 */
export function useOnlineOperators(): OperatorPresence[] {
  const [lista, setLista] = useState<OperatorPresence[]>(() => operatorPresence.onlineOperators());
  useEffect(() => {
    operatorPresence.init();
    setLista(operatorPresence.onlineOperators());
    return operatorPresence.subscribe(() => setLista(operatorPresence.onlineOperators()));
  }, []);
  return lista;
}
