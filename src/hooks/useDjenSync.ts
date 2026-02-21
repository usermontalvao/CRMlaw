import { useEffect, useRef } from 'react';
import { processDjenSyncService } from '../services/processDjenSync.service';

/**
 * Hook para sincronização automática com DJEN
 * Executa a cada 1 hora
 */
export function useDjenSync() {
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    console.log('🚀 [DJEN SYNC] Hook inicializado - primeira sync em 5 segundos...');
    // Função de sincronização
    const runSync = async () => {
      try {
        console.log('🔄 [DJEN SYNC] Iniciando sincronização automática...');
        const result = await processDjenSyncService.syncPendingProcesses();
        console.log('✅ [DJEN SYNC] Sincronização concluída:', result);
      } catch (error) {
        console.error('❌ [DJEN SYNC] Erro na sincronização automática:', error);
      }
    };

    // Executar imediatamente ao carregar (após 5 segundos)
    const initialTimeout = setTimeout(() => {
      runSync();
    }, 5000);

    // Executar a cada 1 hora
    syncIntervalRef.current = setInterval(() => {
      runSync();
    }, 60 * 60 * 1000); // 1 hora

    // Cleanup
    return () => {
      if (initialTimeout) clearTimeout(initialTimeout);
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, []);
}
