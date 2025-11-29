import { supabase } from '../config/supabase';
import { djenService } from './djen.service';
import { processService } from './process.service';
import type { Process } from '../types/process.types';

class ProcessDjenSyncService {
  /**
   * Busca dados do DJEN para um processo
   * O DJEN retorna INTIMAÇÕES/COMUNICAÇÕES publicadas no Diário de Justiça
   * Não são andamentos processuais, mas sim publicações oficiais
   */
  async syncProcessWithDjen(process: Process): Promise<{
    success: boolean;
    updated: boolean;
    data?: any;
    intimationsCount?: number;
    error?: string;
  }> {
    try {
      const processNumber = process.process_code.replace(/\D/g, '');
      
      if (processNumber.length !== 20) {
        return { success: false, updated: false, error: 'Número inválido' };
      }

      // Extrair ano do processo
      const yearMatch = process.process_code.match(/\d{7}-\d{2}\.(\d{4})\./);
      const year = yearMatch ? yearMatch[1] : null;

      const searchParams: any = {
        numeroProcesso: processNumber,
        itensPorPagina: 100,
      };

      if (year) {
        searchParams.dataDisponibilizacaoInicio = `${year}-01-01`;
      }

      const response = await djenService.consultarComunicacoes(searchParams);

      if (response.items && response.items.length > 0) {
        const items = response.items;
        const firstItem = items[0];
        
        // Ordenar por data para pegar a mais recente e a mais antiga
        const sortedByDate = [...items].sort((a, b) => 
          new Date(b.datadisponibilizacao || 0).getTime() - new Date(a.datadisponibilizacao || 0).getTime()
        );
        
        const mostRecent = sortedByDate[0];
        const oldest = sortedByDate[sortedByDate.length - 1];
        
        // Atualizar processo com dados do DJEN
        const updates: any = {};
        let hasUpdates = false;

        // Atualizar vara/comarca se não tiver
        if (firstItem.nomeOrgao && !process.court) {
          updates.court = firstItem.nomeOrgao;
          hasUpdates = true;
        }

        // Atualizar área se não tiver
        if (firstItem.nomeClasse && !process.practice_area) {
          const area = this.mapClasseToArea(firstItem.nomeClasse);
          if (area) {
            updates.practice_area = area;
            hasUpdates = true;
          }
        }

        // Tentar extrair data de distribuição da primeira intimação
        if (!process.distributed_at && oldest.datadisponibilizacao) {
          updates.distributed_at = oldest.datadisponibilizacao.split('T')[0];
          hasUpdates = true;
        }

        // Marcar como sincronizado com contagem de intimações
        updates.djen_synced = true;
        updates.djen_last_sync = new Date().toISOString();
        updates.djen_has_data = true;

        await processService.updateProcess(process.id, updates);

        return {
          success: true,
          updated: hasUpdates,
          data: firstItem,
          intimationsCount: items.length,
        };
      } else {
        // Marcar tentativa de sincronização - sem intimações encontradas
        await processService.updateProcess(process.id, {
          djen_synced: true,
          djen_last_sync: new Date().toISOString(),
          djen_has_data: false,
        });

        return {
          success: true,
          updated: false,
          intimationsCount: 0,
          error: 'Nenhuma intimação encontrada no DJEN para este processo',
        };
      }
    } catch (error: any) {
      console.error('Erro ao sincronizar processo com DJEN:', error);
      return {
        success: false,
        updated: false,
        error: error.message,
      };
    }
  }

  /**
   * Sincroniza todos os processos que precisam de atualização
   */
  async syncPendingProcesses(): Promise<{
    total: number;
    synced: number;
    updated: number;
    errors: number;
  }> {
    try {
      // Buscar processos que precisam sincronizar
      // 1. Nunca sincronizados (djen_synced = false ou null)
      // 2. Sem dados e última sync há mais de 24h
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const { data: processes, error } = await supabase
        .from('processes')
        .select('*')
        .or(`djen_synced.is.null,and(djen_has_data.eq.false,djen_last_sync.lt.${oneDayAgo.toISOString()})`)
        .eq('status', 'andamento') // Apenas processos em andamento
        .limit(50); // Limitar para não sobrecarregar

      if (error) throw error;

      if (!processes || processes.length === 0) {
        return { total: 0, synced: 0, updated: 0, errors: 0 };
      }

      let synced = 0;
      let updated = 0;
      let errors = 0;

      for (const process of processes) {
        const result = await this.syncProcessWithDjen(process as Process);
        
        if (result.success) {
          synced++;
          if (result.updated) {
            updated++;
          }
        } else {
          errors++;
        }

        // Aguardar 1 segundo entre requisições para não sobrecarregar a API
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      return {
        total: processes.length,
        synced,
        updated,
        errors,
      };
    } catch (error) {
      console.error('Erro ao sincronizar processos pendentes:', error);
      throw error;
    }
  }

  /**
   * Extrai data de distribuição do número do processo
   */
  extractDistributedDate(processCode: string): string | null {
    // Formato: NNNNNNN-DD.AAAA.J.TT.OOOO
    //                  ^^  ^^^^
    // Exemplo: 0001121-19.2025.5.23.0003
    //                   19  2025
    const match = processCode.match(/\d{7}-(\d{2})\.(\d{4})\./);
    
    if (match) {
      const day = match[1];
      const year = match[2];
      
      // Assumir que é o mês atual ou janeiro se for ano futuro
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1;
      
      let month = currentMonth;
      
      // Se o ano do processo for diferente do atual, usar janeiro
      if (parseInt(year) !== currentYear) {
        month = 1;
      }
      
      const monthStr = month.toString().padStart(2, '0');
      
      return `${year}-${monthStr}-${day}`;
    }
    
    return null;
  }

  /**
   * Mapear classe do processo para área de atuação
   */
  private mapClasseToArea(nomeClasse?: string): string | undefined {
    if (!nomeClasse) return undefined;
    
    const classe = nomeClasse.toLowerCase();
    
    if (classe.includes('trabalh')) return 'trabalhista';
    if (classe.includes('cível') || classe.includes('civil')) return 'civel';
    if (classe.includes('família') || classe.includes('familia')) return 'familia';
    if (classe.includes('previdenc')) return 'previdenciario';
    if (classe.includes('consumidor')) return 'consumidor';
    
    return 'civel';
  }
}

export const processDjenSyncService = new ProcessDjenSyncService();
