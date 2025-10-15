import { supabase } from '../config/supabase';
import type { IntimationAnalysis } from '../types/ai.types';

export interface IntimationAIAnalysisDB {
  id: string;
  intimation_id: string;
  summary: string | null;
  urgency: 'baixa' | 'media' | 'alta' | 'critica';
  document_type: string | null;
  deadline_days: number | null;
  deadline_due_date: string | null;
  deadline_description: string | null;
  deadline_confidence: 'baixa' | 'media' | 'alta' | null;
  suggested_actions: string[];
  key_points: string[];
  analyzed_at: string;
  analyzed_by: string | null;
  model_used: string;
  created_at: string;
  updated_at: string;
}

class IntimationAnalysisService {
  /**
   * Salva ou atualiza análise de IA de uma intimação
   */
  async saveAnalysis(
    intimationId: string,
    analysis: IntimationAnalysis,
    userId?: string
  ): Promise<IntimationAIAnalysisDB> {
    const data = {
      intimation_id: intimationId,
      summary: analysis.summary,
      urgency: analysis.urgency,
      document_type: analysis.documentType || null,
      deadline_days: analysis.deadline?.days || null,
      deadline_due_date: analysis.deadline?.dueDate || null,
      deadline_description: analysis.deadline?.description || null,
      deadline_confidence: analysis.deadline?.confidence || null,
      suggested_actions: analysis.suggestedActions || [],
      key_points: analysis.keyPoints || [],
      analyzed_by: userId || null,
      analyzed_at: new Date().toISOString(),
    };

    const { data: result, error } = await supabase
      .from('intimation_ai_analysis')
      .upsert(data, { onConflict: 'intimation_id' })
      .select()
      .single();

    if (error) {
      throw new Error(`Erro ao salvar análise: ${error.message}`);
    }

    return result;
  }

  /**
   * Busca análise de uma intimação específica
   */
  async getAnalysis(intimationId: string): Promise<IntimationAIAnalysisDB | null> {
    const { data, error } = await supabase
      .from('intimation_ai_analysis')
      .select('*')
      .eq('intimation_id', intimationId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Não encontrado
        return null;
      }
      throw new Error(`Erro ao buscar análise: ${error.message}`);
    }

    return data;
  }

  /**
   * Busca análises de múltiplas intimações
   */
  async getAnalysesByIntimationIds(
    intimationIds: string[]
  ): Promise<Map<string, IntimationAIAnalysisDB>> {
    if (intimationIds.length === 0) {
      return new Map();
    }

    const { data, error } = await supabase
      .from('intimation_ai_analysis')
      .select('*')
      .in('intimation_id', intimationIds);

    if (error) {
      throw new Error(`Erro ao buscar análises: ${error.message}`);
    }

    const map = new Map<string, IntimationAIAnalysisDB>();
    data?.forEach((analysis) => {
      map.set(analysis.intimation_id, analysis);
    });

    return map;
  }

  /**
   * Lista todas as análises com filtros opcionais
   */
  async listAnalyses(filters?: {
    urgency?: 'baixa' | 'media' | 'alta' | 'critica';
    limit?: number;
  }): Promise<IntimationAIAnalysisDB[]> {
    let query = supabase
      .from('intimation_ai_analysis')
      .select('*')
      .order('analyzed_at', { ascending: false });

    if (filters?.urgency) {
      query = query.eq('urgency', filters.urgency);
    }

    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Erro ao listar análises: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Deleta análise de uma intimação
   */
  async deleteAnalysis(intimationId: string): Promise<void> {
    const { error } = await supabase
      .from('intimation_ai_analysis')
      .delete()
      .eq('intimation_id', intimationId);

    if (error) {
      throw new Error(`Erro ao deletar análise: ${error.message}`);
    }
  }

  /**
   * Converte análise do banco para formato usado pela aplicação
   */
  convertToIntimationAnalysis(dbAnalysis: IntimationAIAnalysisDB): IntimationAnalysis {
    return {
      summary: dbAnalysis.summary || '',
      urgency: dbAnalysis.urgency,
      documentType: dbAnalysis.document_type || '',
      deadline: dbAnalysis.deadline_days && dbAnalysis.deadline_due_date
        ? {
            days: dbAnalysis.deadline_days,
            dueDate: dbAnalysis.deadline_due_date,
            description: dbAnalysis.deadline_description || '',
            confidence: dbAnalysis.deadline_confidence || 'baixa',
          }
        : null,
      suggestedActions: dbAnalysis.suggested_actions || [],
      keyPoints: dbAnalysis.key_points || [],
    };
  }
}

export const intimationAnalysisService = new IntimationAnalysisService();
