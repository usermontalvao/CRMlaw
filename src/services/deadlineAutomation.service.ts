import { supabase } from '../config/supabase';
import type {
  CreateDeadlineAutomationDTO,
  DeadlineAutomation,
  DeadlineAutomationRun,
  UpdateDeadlineAutomationDTO,
} from '../types/deadlineAutomation.types';

/**
 * Regras de automação de prazo e seu histórico de execução.
 *
 * A escrita é barrada por RLS (só admin/sócio). O service não repete essa
 * checagem: a UI esconde os botões, mas a garantia é do banco — validar de novo
 * aqui só criaria uma segunda fonte de verdade para divergir da primeira.
 */
class DeadlineAutomationService {
  private tableName = 'deadline_automations';
  private runsTable = 'deadline_automation_runs';

  async listAutomations(): Promise<DeadlineAutomation[]> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao listar automações de prazo:', error);
      throw new Error(error.message);
    }

    return (data ?? []) as DeadlineAutomation[];
  }

  async getAutomationById(id: string): Promise<DeadlineAutomation | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.error('Erro ao buscar automação:', error);
      throw new Error(error.message);
    }

    return data as DeadlineAutomation;
  }

  async createAutomation(payload: CreateDeadlineAutomationDTO): Promise<DeadlineAutomation> {
    if (!payload.name?.trim()) {
      throw new Error('Dê um nome à automação.');
    }
    if (!payload.title_template?.trim()) {
      throw new Error('Informe o título do prazo que será criado.');
    }

    const { data: userData } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        ...payload,
        name: payload.name.trim(),
        created_by: userData?.user?.id ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar automação:', error);
      throw new Error(error.message);
    }

    return data as DeadlineAutomation;
  }

  async updateAutomation(
    id: string,
    payload: UpdateDeadlineAutomationDTO,
  ): Promise<DeadlineAutomation> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar automação:', error);
      throw new Error(error.message);
    }

    return data as DeadlineAutomation;
  }

  async deleteAutomation(id: string): Promise<void> {
    const { error } = await supabase.from(this.tableName).delete().eq('id', id);

    if (error) {
      console.error('Erro ao excluir automação:', error);
      throw new Error(error.message);
    }
  }

  /**
   * Histórico de execuções. Sem `automationId`, traz o log de todas as regras —
   * que é a visão que a equipe usa para responder "de onde veio este prazo?".
   */
  async listRuns(automationId?: string, limit = 200): Promise<DeadlineAutomationRun[]> {
    let query = supabase
      .from(this.runsTable)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (automationId) query = query.eq('automation_id', automationId);

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao listar execuções de automação:', error);
      throw new Error(error.message);
    }

    return (data ?? []) as DeadlineAutomationRun[];
  }

  /**
   * Roda a automação sem escrever nada — nem prazo, nem ledger — e devolve o que
   * aconteceria hoje. É o botão "Testar" da tela: deixa o admin ver o resultado
   * antes de ligar a regra, sem sujar o histórico.
   */
  async dryRun(automationId?: string): Promise<DryRunResult> {
    const { data, error } = await supabase.functions.invoke('deadline-automations', {
      body: { dry_run: true, ...(automationId ? { automation_id: automationId } : {}) },
    });

    if (error) {
      console.error('Erro ao simular automações:', error);
      throw new Error(error.message);
    }

    return data as DryRunResult;
  }
}

export interface DryRunResult {
  success: boolean;
  dry_run: boolean;
  hoje: string;
  criados: number;
  simulados: number;
  ja_processados: number;
  erros: number;
  resultados: {
    automation_id: string;
    automation: string;
    dia_fonte: string;
    candidatos: number;
    criados: number;
    simulados: number;
    ja_processados: number;
    erros: number;
    preview: { requirement_id: string; prazo: Record<string, unknown> }[];
  }[];
}

export const deadlineAutomationService = new DeadlineAutomationService();
