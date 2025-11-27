import { useEffect, useState } from 'react';
import { djenLocalService } from '../services/djenLocal.service';
import { djenService } from '../services/djen.service';
import { profileService } from '../services/profile.service';
import { processService } from '../services/process.service';
import { supabase } from '../config/supabase';

const CronEndpoint = () => {
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [stats, setStats] = useState({ found: 0, saved: 0 });

  useEffect(() => {
    // Extrair parâmetros da URL hash
    const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const action = urlParams.get('action');
    const token = urlParams.get('token');

    // Verificar se é uma requisição de cron DJEN
    if (action === 'djen-sync') {
      // Token simples para proteção
      if (token !== 'djen-sync-2024') {
        setStatus('error');
        setMessage('Token inválido');
        return;
      }

      runDjenSync();
    }
  }, []);

  const runDjenSync = async () => {
    setStatus('running');
    setMessage('Iniciando sincronização DJEN...');

    try {
      const syncStartTime = new Date().toISOString();
      let totalSaved = 0;
      let totalFound = 0;

      // Registrar início da execução
      const { data: syncLog } = await supabase
        .from('djen_sync_history')
        .insert({
          source: 'external_link',
          origin: 'manual_trigger',
          trigger_type: 'http_request',
          status: 'running',
          run_started_at: syncStartTime,
          message: 'Sincronização iniciada via link externo'
        })
        .select()
        .single();

      try {
        // Buscar perfis com nome DJEN configurado
        const profiles = await profileService.listMembers();
        const profilesWithDjen = profiles.filter(p => p.lawyer_full_name);

        // Buscar processos em andamento
        const processes = await processService.listProcesses();
        const activeProcesses = processes.filter(p => p.status === 'andamento').slice(0, 50);

        setMessage('Buscando intimações por advogado...');

        // Sincronizar por nome do advogado
        for (const profile of profilesWithDjen.slice(0, 3)) { // Limitar a 3 perfis
          if (!profile.lawyer_full_name) continue;

          console.log(`🔍 Buscando intimações para: ${profile.lawyer_full_name}`);

          const params = {
            nomeAdvogado: profile.lawyer_full_name,
            dataDisponibilizacaoInicio: djenService.getDataDiasAtras(7),
            dataDisponibilizacaoFim: djenService.getDataHoje(),
            meio: 'D' as const,
            itensPorPagina: 100 as const,
            pagina: 1
          };

          const response = await djenService.consultarTodasComunicacoes(params);
          
          if (response.items && response.items.length > 0) {
            totalFound += response.items.length;
            
            const result = await djenLocalService.saveComunicacoes(response.items, {
              clients: [],
              processes: activeProcesses
            });
            totalSaved += result.saved;
          }

          // Aguardar entre requisições
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        setMessage('Buscando intimações por processo...');

        // Sincronizar por processos cadastrados
        const processNumbers = activeProcesses
          .map(p => p.process_code?.trim())
          .filter((code): code is string => Boolean(code))
          .slice(0, 10); // Limitar a 10 processos

        if (processNumbers.length > 0) {
          const processResponse = await djenService.consultarPorProcessos(processNumbers, {
            dataDisponibilizacaoInicio: djenService.getDataDiasAtras(30),
            dataDisponibilizacaoFim: djenService.getDataHoje(),
            meio: 'D',
            itensPorPagina: 100,
            pagina: 1
          });

          if (processResponse.items && processResponse.items.length > 0) {
            totalFound += processResponse.items.length;
            
            const result = await djenLocalService.saveComunicacoes(processResponse.items, {
              clients: [],
              processes: activeProcesses
            });
            totalSaved += result.saved;
          }
        }

        // Atualizar log de sincronização
        const syncEndTime = new Date().toISOString();

        if (syncLog) {
          await supabase
            .from('djen_sync_history')
            .update({
              status: 'success',
              run_finished_at: syncEndTime,
              items_found: totalFound,
              items_saved: totalSaved,
              message: `Sincronização concluída: ${totalSaved} intimações salvas de ${totalFound} encontradas`
            })
            .eq('id', syncLog.id);
        }

        setStats({ found: totalFound, saved: totalSaved });
        setStatus('success');
        setMessage(`Sincronização concluída! ${totalSaved} intimações salvas de ${totalFound} encontradas.`);

      } catch (syncError: any) {
        console.error('❌ Erro durante sincronização:', syncError);
        
        // Atualizar log com erro
        if (syncLog) {
          await supabase
            .from('djen_sync_history')
            .update({
              status: 'error',
              run_finished_at: new Date().toISOString(),
              error_message: syncError.message,
              message: `Erro na sincronização: ${syncError.message}`
            })
            .eq('id', syncLog.id);
        }

        throw syncError;
      }

    } catch (error: any) {
      console.error('❌ Erro no cron DJEN:', error);
      setStatus('error');
      setMessage(`Erro: ${error.message}`);
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'running': return 'text-blue-600';
      case 'success': return 'text-green-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'running': return '🔄';
      case 'success': return '✅';
      case 'error': return '❌';
      default: return '⏳';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <div className="text-center">
          <div className="text-4xl mb-4">{getStatusIcon()}</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            Cron DJEN
          </h1>
          
          <div className={`text-lg font-medium mb-4 ${getStatusColor()}`}>
            {message || 'Aguardando...'}
          </div>

          {status === 'success' && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <div className="text-sm text-green-800">
                <div><strong>Encontradas:</strong> {stats.found} intimações</div>
                <div><strong>Salvas:</strong> {stats.saved} intimações</div>
              </div>
            </div>
          )}

          {status === 'running' && (
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          )}

          <div className="text-xs text-gray-500 mt-6">
            <div>Endpoint: <code>/cron/djen?token=djen-sync-2024</code></div>
            <div className="mt-2">
              Para usar: <code>{window.location.origin}/cron/djen?action=djen-sync&token=djen-sync-2024</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CronEndpoint;
