import { supabase } from '../config/supabase';
import { processService } from './process.service';
import type { ProcessStatus } from '../types/process.types';

export interface DJePublication {
  numeroProcesso: string;
  dataDisponibilizacao: string;
  conteudo: string;
  nomeDiario: string;
  [key: string]: any;
}

export interface Intimation {
  id: string;
  process_id: string;
  diary_name: string;
  publication_date: string;
  content: string;
  raw_data: any;
  status: 'pending' | 'read' | 'archived';
  created_at: string;
  updated_at: string;
}

class DJeService {
  private baseUrl = 'https://comunica.pje.jus.br/consulta';

  /**
   * Fetch publications from DJe/PJe API
   */
  async fetchPublications(
    numeroProcesso: string,
    dataInicio: string,
    dataFim: string
  ): Promise<DJePublication[]> {
    try {
      const url = `${this.baseUrl}?dataDisponibilizacaoInicio=${dataInicio}&dataDisponibilizacaoFim=${dataFim}&numeroProcesso=${numeroProcesso}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Erro ao consultar DJe: ${response.statusText}`);
      }

      const data = await response.json();
      return data.publicacoes || [];
    } catch (error) {
      console.error('Erro ao buscar publicações:', error);
      throw error;
    }
  }

  /**
   * Analyze content and determine if process status should be updated
   */
  private analyzeContent(content: string): ProcessStatus | null {
    const lowerContent = content.toLowerCase();
    
    // Priority order: more specific statuses first
    if (lowerContent.includes('arquivado') || lowerContent.includes('arquivamento')) {
      return 'arquivado';
    }
    if (lowerContent.includes('cumprimento') || lowerContent.includes('execução')) {
      return 'cumprimento';
    }
    if (lowerContent.includes('sentença') || lowerContent.includes('julgado')) {
      return 'sentenca';
    }
    if (lowerContent.includes('andamento') || lowerContent.includes('em curso')) {
      return 'andamento';
    }
    
    return null;
  }

  /**
   * Update process status based on intimation content
   */
  private async updateProcessStatus(processId: string, content: string): Promise<void> {
    const newStatus = this.analyzeContent(content);
    
    if (newStatus) {
      // Use processService so cache is invalidated and UI reloads show the new status.
      await processService.updateStatus(processId, newStatus);
      
      console.log(`✅ Processo ${processId} atualizado para status: ${newStatus}`);
    }
  }

  /**
   * Sync intimations for a single process
   */
  async syncProcessIntimations(processId: string, numeroProcesso: string): Promise<number> {
    try {
      // Get last check date from tracking
      const { data: tracking } = await supabase
        .from('process_tracking')
        .select('last_check_date')
        .eq('process_id', processId)
        .single();

      // If no tracking exists, start from process creation date
      const { data: process } = await supabase
        .from('processes')
        .select('created_at')
        .eq('id', processId)
        .single();

      const dataInicio = tracking?.last_check_date || process?.created_at?.split('T')[0] || new Date().toISOString().split('T')[0];
      const dataFim = new Date().toISOString().split('T')[0];

      // Fetch publications from DJe
      const publications = await this.fetchPublications(numeroProcesso, dataInicio, dataFim);

      let newCount = 0;
      for (const pub of publications) {
        // Check if intimation already exists
        const { data: existing } = await supabase
          .from('intimations')
          .select('id')
          .eq('process_id', processId)
          .eq('publication_date', pub.dataDisponibilizacao)
          .eq('diary_name', pub.nomeDiario)
          .maybeSingle();

        if (!existing) {
          // Insert new intimation
          await supabase.from('intimations').insert({
            process_id: processId,
            diary_name: pub.nomeDiario,
            publication_date: pub.dataDisponibilizacao,
            content: pub.conteudo,
            raw_data: pub,
            status: 'pending',
          });

          // Analyze and update process status
          await this.updateProcessStatus(processId, pub.conteudo);
          
          newCount++;
        }
      }

      // Update tracking record
      await supabase
        .from('process_tracking')
        .upsert({
          process_id: processId,
          last_check_date: dataFim,
          next_check_date: new Date(Date.now() + 86400000).toISOString().split('T')[0], // +1 day
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'process_id' });

      return newCount;
    } catch (error) {
      console.error(`Erro ao sincronizar processo ${numeroProcesso}:`, error);
      throw error;
    }
  }

  /**
   * Sync all active processes
   */
  async syncAllActiveProcesses(): Promise<{ total: number; synced: number; errors: number }> {
    const { data: processes } = await supabase
      .from('processes')
      .select('id, process_code')
      .not('process_code', 'is', null);

    if (!processes || processes.length === 0) {
      return { total: 0, synced: 0, errors: 0 };
    }

    let synced = 0;
    let errors = 0;

    for (const process of processes) {
      try {
        const newIntimations = await this.syncProcessIntimations(process.id, process.process_code);
        if (newIntimations > 0) {
          synced++;
        }
      } catch (error) {
        console.error(`❌ Erro ao sincronizar processo ${process.process_code}:`, error);
        errors++;
      }
    }

    return { total: processes.length, synced, errors };
  }

  /**
   * List intimations with filters
   */
  async listIntimations(filters?: {
    process_id?: string;
    status?: 'pending' | 'read' | 'archived';
    date_from?: string;
    date_to?: string;
  }): Promise<Intimation[]> {
    let query = supabase
      .from('intimations')
      .select('*')
      .order('publication_date', { ascending: false });

    if (filters?.process_id) {
      query = query.eq('process_id', filters.process_id);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.date_from) {
      query = query.gte('publication_date', filters.date_from);
    }
    if (filters?.date_to) {
      query = query.lte('publication_date', filters.date_to);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao listar intimações:', error);
      throw new Error(error.message);
    }

    return data || [];
  }

  /**
   * Update intimation status
   */
  async updateIntimationStatus(
    intimationId: string,
    status: 'pending' | 'read' | 'archived'
  ): Promise<void> {
    const { error } = await supabase
      .from('intimations')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', intimationId);

    if (error) {
      console.error('Erro ao atualizar intimação:', error);
      throw new Error(error.message);
    }
  }

  /**
   * Get intimation by ID
   */
  async getIntimationById(id: string): Promise<Intimation | null> {
    const { data, error } = await supabase
      .from('intimations')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Erro ao buscar intimação:', error);
      return null;
    }

    return data;
  }

  /**
   * Get pending intimations count
   */
  async getPendingCount(): Promise<number> {
    const { count, error } = await supabase
      .from('intimations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (error) {
      console.error('Erro ao contar intimações pendentes:', error);
      return 0;
    }

    return count || 0;
  }
}

export const djeService = new DJeService();
