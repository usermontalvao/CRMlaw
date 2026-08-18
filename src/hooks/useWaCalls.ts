// Acesso da UI ao estado das chamadas de voz (WaCalls).
//
// O estado real vive no `waCallsStore` (fora do React) para sobreviver a
// desmontagens: o modal de chamada pode fechar, o módulo pode trocar de tela, e
// a ligação continua de pé. Este hook é só a janela do React para ele — mesma
// mecânica do `muteStore` no módulo WhatsApp.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { waCallsStore, type WaCallsSnapshot } from '../services/wacalls/callStore';
import type { CallablePhoneCandidate } from '../services/wacalls/phone';
import type { WaCall, WaCallContact } from '../services/wacalls/types';

export interface UseWaCalls extends WaCallsSnapshot {
  /** Dá para discar agora? (rede de pé, serviço no ar e conta pareada e conectada) */
  canCall: boolean;
  /** A chamada cujo áudio é DESTA aba. Uma por operador, por ora. */
  myCall: WaCall | null;
  /** Chamada recebida ainda não atendida por ninguém. */
  incoming: WaCall | null;
  /**
   * Liga. `fallbacks` são os outros lugares onde o número pode estar, em
   * ordem de prioridade — a tela oferece o que sabe e quem decide (inclusive
   * recusar tudo, quando só há LID) é `resolveCallablePhone`.
   */
  placeCall: (
    phone: string,
    contact?: WaCallContact | null,
    fallbacks?: readonly CallablePhoneCandidate[],
  ) => Promise<string | null>;
  acceptCall: (callId: string) => Promise<void>;
  rejectCall: (callId: string) => Promise<void>;
  hangUp: (callId: string) => Promise<void>;
  setMuted: (callId: string, muted: boolean) => void;
  /** Liga/desliga a gravação da chamada (uma por chamada). */
  setRecording: (callId: string, on: boolean) => void;
}

export function useWaCalls(): UseWaCalls {
  const snapshot = useSyncExternalStore(waCallsStore.subscribe, waCallsStore.getSnapshot);

  // Uma única carga por aba (a função é idempotente e guarda a promessa).
  useEffect(() => { void waCallsStore.init(); }, []);

  const myCall = useMemo(
    () => snapshot.calls.find(c => c.mine) ?? null,
    [snapshot.calls],
  );
  // `route.show === false` é o convite que NÃO é para esta mesa (contato
  // bloqueado); `route === null` é o convite ainda sendo roteado, que aparece
  // calado. Ver `services/wacalls/callRouting`.
  const incoming = useMemo(
    () => snapshot.calls.find(
      c => c.direction === 'inbound' && !c.mine && c.phase === 'RINGING' && c.route?.show !== false,
    ) ?? null,
    [snapshot.calls],
  );

  const placeCall = useCallback(
    (phone: string, contact?: WaCallContact | null, fallbacks?: readonly CallablePhoneCandidate[]) =>
      waCallsStore.placeCall({ phone, contact, fallbacks }),
    [],
  );
  const acceptCall = useCallback((callId: string) => waCallsStore.acceptCall(callId), []);
  const rejectCall = useCallback((callId: string) => waCallsStore.rejectCall(callId), []);
  const hangUp = useCallback((callId: string) => waCallsStore.hangUp(callId), []);
  const setMuted = useCallback((callId: string, muted: boolean) => waCallsStore.setMuted(callId, muted), []);
  const setRecording = useCallback((callId: string, on: boolean) => waCallsStore.setRecording(callId, on), []);

  return {
    ...snapshot,
    canCall: snapshot.online && snapshot.available && !!snapshot.sessionId,
    myCall,
    incoming,
    placeCall,
    acceptCall,
    rejectCall,
    hangUp,
    setMuted,
    setRecording,
  };
}
