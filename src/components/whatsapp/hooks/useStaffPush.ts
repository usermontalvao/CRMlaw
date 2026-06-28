import { useCallback, useEffect, useState } from 'react';
import { isStaffPushSupported, isStaffPushEnabled, enableStaffPush, disableStaffPush } from '../../../utils/staffPush';
import { useToastContext } from '../../../contexts/ToastContext';

export type StaffPushState = 'unknown' | 'unsupported' | 'off' | 'on' | 'busy';

/**
 * Web Push do staff: avisa o atendente mesmo com o navegador/aba fechado.
 * Encapsula a detecção de suporte, o estado atual e o toggle (com toasts),
 * tirando esse efeito colateral do módulo principal.
 */
export function useStaffPush() {
  const toast = useToastContext();
  const [pushState, setPushState] = useState<StaffPushState>('unknown');

  useEffect(() => {
    if (!isStaffPushSupported()) { setPushState('unsupported'); return; }
    isStaffPushEnabled().then(on => setPushState(on ? 'on' : 'off')).catch(() => setPushState('off'));
  }, []);

  const toggleStaffPush = useCallback(async () => {
    const wasOn = await isStaffPushEnabled();
    setPushState('busy');
    if (wasOn) {
      await disableStaffPush();
      setPushState('off');
      toast.info('Notificações push desativadas');
      return;
    }
    const r = await enableStaffPush();
    if (r === 'enabled') {
      setPushState('on');
      toast.success('Notificações ativadas — você será avisado mesmo com o navegador fechado');
    } else {
      setPushState('off');
      if (r === 'denied') toast.error('Permissão de notificação negada no navegador');
      else if (r === 'unsupported') toast.error('Este navegador não suporta notificações push');
      else toast.error('Não foi possível ativar as notificações push');
    }
  }, [toast]);

  return { pushState, toggleStaffPush };
}
