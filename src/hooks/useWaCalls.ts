// Acesso da UI ao estado das chamadas de voz e vídeo (Jurius Call).
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
  /**
   * Dá para discar agora? (rede de pé, serviço no ar, conta pareada e conectada
   * — e nenhuma discagem já a caminho, para o clique repetido não virar duas
   * ligações).
   */
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
  /**
   * Liga JÁ com a câmera. É uma porta separada de `placeCall` porque a decisão
   * é do operador no instante do clique: o botão de vídeo pede a câmera antes
   * de o telefone do contato tocar.
   */
  placeVideoCall: (
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
  /** Este navegador sabe fazer vídeo? (WebCodecs com H.264.) */
  videoSupported: boolean;
  /** Liga a câmera na chamada. Devolve `false` quando não deu. */
  startVideo: (callId: string) => Promise<boolean>;
  /** Desliga a nossa câmera; o outro lado pode continuar mandando a dele. */
  stopVideo: (callId: string) => Promise<void>;
  /** Quartos de volta que a nossa câmera está girando (a escolha fica guardada). */
  videoOrientation: number;
  /** Gira a nossa câmera mais um quarto de volta, para o outro lado. */
  rotateVideo: (callId?: string) => Promise<number>;
  /**
   * As imagens da chamada. Fora do snapshot de propósito: `MediaStream` nunca é
   * igual a si mesmo numa comparação, e no estado faria a tela repintar sem
   * parar. A tela pede na hora de montar o <video>.
   */
  videoStreams: (callId: string) => { local: MediaStream | null; remote: MediaStream | null } | null;
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
  const placeVideoCall = useCallback(
    (phone: string, contact?: WaCallContact | null, fallbacks?: readonly CallablePhoneCandidate[]) =>
      waCallsStore.placeCall({ phone, contact, fallbacks, video: true }),
    [],
  );
  const acceptCall = useCallback((callId: string) => waCallsStore.acceptCall(callId), []);
  const rejectCall = useCallback((callId: string) => waCallsStore.rejectCall(callId), []);
  const hangUp = useCallback((callId: string) => waCallsStore.hangUp(callId), []);
  const setMuted = useCallback((callId: string, muted: boolean) => waCallsStore.setMuted(callId, muted), []);
  const setRecording = useCallback((callId: string, on: boolean) => waCallsStore.setRecording(callId, on), []);
  const startVideo = useCallback((callId: string) => waCallsStore.startVideo(callId), []);
  const stopVideo = useCallback((callId: string) => waCallsStore.stopVideo(callId), []);
  const rotateVideo = useCallback((callId?: string) => waCallsStore.rotateVideo(callId), []);
  const videoStreams = useCallback((callId: string) => waCallsStore.videoStreams(callId), []);

  return {
    ...snapshot,
    canCall: snapshot.online && snapshot.available && !!snapshot.sessionId && !snapshot.dialing,
    myCall,
    incoming,
    placeCall,
    placeVideoCall,
    acceptCall,
    rejectCall,
    hangUp,
    setMuted,
    setRecording,
    videoSupported: waCallsStore.videoSupported(),
    startVideo,
    stopVideo,
    videoOrientation: waCallsStore.videoOrientation(),
    rotateVideo,
    videoStreams,
  };
}
