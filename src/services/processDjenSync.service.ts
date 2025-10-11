import { supabase } from '../config/supabase';
import { djenService } from './djen.service';
import { processService } from './process.service';
import type { Process } from '../types/process.types';

class ProcessDjenSyncService {
  /**
   * Busca dados do DJEN para um processo
   */
  async syncProcessWithDjen(process: Process): Promise<{
    success: boolean;
    updated: boolean;
    data?: any;
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
        const firstItem = response.items[0];
        
        // Atualizar processo com dados do DJEN
        const updates: any = {};
        let hasUpdates = false;

        if (firstItem.nomeOrgao && !process.court) {
          updates.court = firstItem.nomeOrgao;
          hasUpdates = true;
        }

        if (firstItem.nomeClasse && !process.practice_area) {
          const area = this.mapClasseToArea(firstItem.nomeClasse);
          if (area) {
            updates.practice_area = area;
            hasUpdates = true;
          }
        }

        // Marcar como sincronizado
        updates.djen_synced = true;
        updates.djen_last_sync = new Date().toISOString();
        updates.djen_has_data = true;

        if (hasUpdates) {
          await processService.updateProcess(process.id, updates);
        }

        return {
          success: true,
          updated: hasUpdates,
          data: firstItem,
        };
      } else {
        // Marcar tentativa de sincronização
        await processService.updateProcess(process.id, {
          djen_last_sync: new Date().toISOString(),
          djen_has_data: false,
        });

        return {
          success: true,
          updated: false,
          error: 'Sem dados no DJEN',
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
