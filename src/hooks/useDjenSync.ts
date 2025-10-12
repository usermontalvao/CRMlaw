import { useEffect, useRef } from 'react';
import { processDjenSyncService } from '../services/processDjenSync.service';

/**
 * Hook para sincronização automática com DJEN
 * Executa a cada 1 hora
 */
export function useDjenSync() {
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Função de sincronização
    const runSync = async () => {
      try {
        console.log('=== SINCRONIZAÇÃO AUTOMÁTICA DJEN ===');
        console.log('Iniciando sincronização de processos pendentes...');
        
        const result = await processDjenSyncService.syncPendingProcesses();
        
        console.log('Sincronização concluída:');
        console.log(`- Total processado: ${result.total}`);
        console.log(`- Sincronizados: ${result.synced}`);
        console.log(`- Atualizados: ${result.updated}`);
        console.log(`- Erros: ${result.errors}`);
        console.log('=== FIM SINCRONIZAÇÃO ===');
      } catch (error) {
        console.error('Erro na sincronização automática:', error);
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
