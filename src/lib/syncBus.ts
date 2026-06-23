/**
 * syncBus — event bus leve para invalidar dados entre módulos abertos simultaneamente.
 *
 * Uso em services (após mutation):
 *   import { syncBus } from '@/lib/syncBus';
 *   syncBus.emit('clients');
 *
 * Uso em módulos (para re-fetch automático):
 *   import { useSyncRefresh } from '@/lib/syncBus';
 *   useSyncRefresh('clients', loadData);
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type SyncEntity =
  | 'clients'
  | 'processes'
  | 'requirements'
  | 'financial'
  | 'calendar'
  | 'deadlines'
  | 'documents'
  | 'signatures'
  | 'leads'
  | 'tasks'
  | 'intimations'
  | 'chat'
  | 'feed';

const EVENT = 'crm:data-changed';

export const syncBus = {
  emit(entity: SyncEntity) {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { entity } }));
  },
};

/**
 * Chama `callback` sempre que a entidade especificada for modificada.
 * Use quando o módulo tem uma função de load estável (useCallback).
 */
export function useSyncRefresh(entity: SyncEntity | SyncEntity[], callback: () => void) {
  useEffect(() => {
    const entities = Array.isArray(entity) ? entity : [entity];
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ entity: SyncEntity }>;
      if (entities.includes(ce.detail.entity)) callback();
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [entity, callback]);
}

/**
 * Retorna um contador que incrementa sempre que a entidade mudar.
 * Use como dependência em useEffect para re-executar o fetch:
 *
 *   const syncTick = useSyncTick('processes');
 *   useEffect(() => { fetchProcesses(); }, [syncTick]);
 */
export function useSyncTick(entity: SyncEntity | SyncEntity[]): number {
  const [tick, setTick] = useState(0);
  const entityRef = useRef(entity);
  entityRef.current = entity;

  const handler = useCallback((e: Event) => {
    const ce = e as CustomEvent<{ entity: SyncEntity }>;
    const entities = Array.isArray(entityRef.current) ? entityRef.current : [entityRef.current];
    if (entities.includes(ce.detail.entity)) setTick(t => t + 1);
  }, []);

  useEffect(() => {
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [handler]);

  return tick;
}
