// A janela do React para o aviso de chamada perdida.
//
// Mesmo papel do `useWaCalls`: o estado real vive fora do React (ver
// `missedCallStore`) porque ele precisa sobreviver à troca de módulo e ao
// recarregamento da página. Aqui só se assina o store e se repassam as ações.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { missedCallsStore } from '../services/wacalls/missedCallStore';
import type { MissedCall } from '../services/wacalls/missedCalls';

export interface UseMissedCalls {
  /** As perdidas que ainda merecem tela, da mais recente para a mais antiga. */
  calls: MissedCall[];
  /** "Já vi estas" — some da tela e não volta na próxima releitura. */
  dismiss: (callIds: readonly string[]) => void;
  /** "Já vi todas" — limpa o cartão e zera o distintivo da aba de Ligações. */
  dismissAll: () => void;
}

export function useMissedCalls(): UseMissedCalls {
  const snapshot = useSyncExternalStore(missedCallsStore.subscribe, missedCallsStore.getSnapshot);

  // Uma única ligação das fontes por aba (a função é idempotente).
  useEffect(() => { missedCallsStore.init(); }, []);

  const dismiss = useCallback((callIds: readonly string[]) => missedCallsStore.dismiss(callIds), []);
  const dismissAll = useCallback(() => missedCallsStore.dismissAll(), []);

  return { calls: snapshot.calls, dismiss, dismissAll };
}
