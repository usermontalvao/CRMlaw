import { supabase } from '../config/supabase';
import { djenService } from './djen.service';
import { djenLocalService } from './djenLocal.service';
import { profileService } from './profile.service';
import type {
  MonitoredProcess,
  ProcessMovement,
  ProcessParty,
  ProcessPhase,
  ProcessHealthStatus,
  ProcessDiscoveryResult,
  SyncProgress,
  ProcessStats,
  PHASE_KEYWORDS,
  ATTENTION_KEYWORDS,
  CRITICAL_KEYWORDS,
} from '../types/processMonitor.types';
import type { DjenComunicacao, DjenComunicacaoLocal } from '../types/djen.types';

class ProcessMonitorService {
  private tableName = 'monitored_processes';
  private movementsTable = 'process_movements';
  private partiesTable = 'process_parties';

  /**
   * Descobre processos no DJEN pelo nome do advogado
   */
  async discoverProcesses(
    lawyerName: string,
    daysBack: number = 365,
    onProgress?: (progress: SyncProgress) => void
  ): Promise<ProcessDiscoveryResult[]> {
    const results: ProcessDiscoveryResult[] = [];
    const processMap = new Map<string, ProcessDiscoveryResult>();

    onProgress?.({
      status: 'searching',
      message: `Buscando processos para ${lawyerName}...`,
      current: 0,
      total: 0,
      found: 0,
      new: 0,
    });

    try {
      const response = await djenService.consultarTodasComunicacoes({
        nomeAdvogado: lawyerName,
        dataDisponibilizacaoInicio: djenService.getDataDiasAtras(daysBack),
        dataDisponibilizacaoFim: djenService.getDataHoje(),
        meio: 'D',
        itensPorPagina: 100,
        pagina: 1,
      });

      onProgress?.({
        status: 'analyzing',
        message: `Analisando ${response.items?.length || 0} comunicações...`,
        current: 0,
        total: response.items?.length || 0,
        found: 0,
        new: 0,
      });

      // Agrupar por número de processo
      for (const item of response.items || []) {
        const processNumber = item.numero_processo?.replace(/\D/g, '') || '';
        if (!processNumber) continue;

        if (!processMap.has(processNumber)) {
          // Extrair partes dos destinatários
          const poloAtivo: string[] = [];
          const poloPassivo: string[] = [];

          // Extrair dos destinatários
          for (const dest of item.destinatarios || []) {
            const nome = dest.nome?.trim();
            if (!nome) continue;
            
            const polo = (dest.polo || '').toLowerCase();
            if (polo.includes('ativo') || polo.includes('autor') || polo.includes('requerente') || polo.includes('exequente')) {
              if (!poloAtivo.includes(nome)) poloAtivo.push(nome);
            } else if (polo.includes('passivo') || polo.includes('réu') || polo.includes('reu') || polo.includes('requerido') || polo.includes('executado')) {
              if (!poloPassivo.includes(nome)) poloPassivo.push(nome);
            }
          }

          // Tentar extrair do texto da comunicação se não encontrou partes
          if (poloAtivo.length === 0 && poloPassivo.length === 0 && item.texto) {
            const partesExtraidas = this.extractPartiesFromText(item.texto);
            poloAtivo.push(...partesExtraidas.autores);
            poloPassivo.push(...partesExtraidas.reus);
          }

          processMap.set(processNumber, {
            process_number: processNumber,
            court: item.siglaTribunal || '',
            class_name: item.nomeClasse || '',
            parties: {
              polo_ativo: poloAtivo,
              polo_passivo: poloPassivo,
            },
            movements_count: 1,
            first_movement_date: item.data_disponibilizacao,
            last_movement_date: item.data_disponibilizacao,
            already_registered: false,
          });
        } else {
          const existing = processMap.get(processNumber)!;
          existing.movements_count++;

          // Atualizar datas
          if (item.data_disponibilizacao < existing.first_movement_date) {
            existing.first_movement_date = item.data_disponibilizacao;
          }
          if (item.data_disponibilizacao > existing.last_movement_date) {
            existing.last_movement_date = item.data_disponibilizacao;
          }

          // Adicionar partes não duplicadas dos destinatários
          for (const dest of item.destinatarios || []) {
            const nome = dest.nome?.trim();
            if (!nome) continue;
            
            const polo = (dest.polo || '').toLowerCase();
            if ((polo.includes('ativo') || polo.includes('autor') || polo.includes('requerente')) && !existing.parties.polo_ativo.includes(nome)) {
              existing.parties.polo_ativo.push(nome);
            } else if ((polo.includes('passivo') || polo.includes('réu') || polo.includes('reu') || polo.includes('requerido')) && !existing.parties.polo_passivo.includes(nome)) {
              existing.parties.polo_passivo.push(nome);
            }
          }

          // Tentar extrair do texto se ainda não tem partes
          if (existing.parties.polo_ativo.length === 0 && existing.parties.polo_passivo.length === 0 && item.texto) {
            const partesExtraidas = this.extractPartiesFromText(item.texto);
            for (const autor of partesExtraidas.autores) {
              if (!existing.parties.polo_ativo.includes(autor)) existing.parties.polo_ativo.push(autor);
            }
            for (const reu of partesExtraidas.reus) {
              if (!existing.parties.polo_passivo.includes(reu)) existing.parties.polo_passivo.push(reu);
            }
          }
        }
      }

      // Verificar quais já estão cadastrados
      const processNumbers = Array.from(processMap.keys());
      const { data: existingProcesses } = await supabase
        .from(this.tableName)
        .select('process_number')
        .in('process_number', processNumbers);

      const existingSet = new Set((existingProcesses || []).map(p => p.process_number));

      for (const [num, result] of processMap) {
        result.already_registered = existingSet.has(num);
        results.push(result);
      }

      // Ordenar por data mais recente
      results.sort((a, b) => b.last_movement_date.localeCompare(a.last_movement_date));

      onProgress?.({
        status: 'complete',
        message: `Encontrados ${results.length} processos únicos`,
        current: results.length,
        total: results.length,
        found: results.length,
        new: results.filter(r => !r.already_registered).length,
      });

      return results;
    } catch (error: any) {
      onProgress?.({
        status: 'error',
        message: error.message || 'Erro ao buscar processos',
        current: 0,
        total: 0,
        found: 0,
        new: 0,
      });
      throw error;
    }
  }

  /**
   * Registra um processo descoberto para monitoramento
   */
  async registerProcess(discovery: ProcessDiscoveryResult): Promise<MonitoredProcess> {
    // Buscar todas as comunicações deste processo para criar timeline
    const response = await djenService.consultarTodasComunicacoes({
      numeroProcesso: discovery.process_number,
      dataDisponibilizacaoInicio: '2020-01-01',
      dataDisponibilizacaoFim: djenService.getDataHoje(),
      meio: 'D',
      itensPorPagina: 100,
      pagina: 1,
    });

    // Analisar fase atual e status
    const movements = response.items || [];
    const currentPhase = this.analyzePhase(movements);
    const healthStatus = this.analyzeHealth(movements);
    const daysWithoutMovement = this.calculateDaysWithoutMovement(movements);

    // Criar processo monitorado
    const { data: process, error } = await supabase
      .from(this.tableName)
      .insert({
        process_number: discovery.process_number,
        process_number_formatted: this.formatProcessNumber(discovery.process_number),
        court: discovery.court,
        class_name: discovery.class_name,
        distribution_date: discovery.first_movement_date,
        current_phase: currentPhase,
        health_status: healthStatus,
        last_movement_date: discovery.last_movement_date,
        days_without_movement: daysWithoutMovement,
        total_movements: movements.length,
        pending_deadlines: 0,
        auto_synced: true,
        last_sync_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Registrar partes
    const parties: ProcessParty[] = [];
    for (const name of discovery.parties.polo_ativo) {
      const { data: party } = await supabase
        .from(this.partiesTable)
        .insert({
          process_id: process.id,
          name,
          role: 'autor',
          pole: 'ativo',
        })
        .select()
        .single();
      if (party) parties.push(party);
    }

    for (const name of discovery.parties.polo_passivo) {
      const { data: party } = await supabase
        .from(this.partiesTable)
        .insert({
          process_id: process.id,
          name,
          role: 'reu',
          pole: 'passivo',
        })
        .select()
        .single();
      if (party) parties.push(party);
    }

    // Registrar movimentações
    const processMovements: ProcessMovement[] = [];
    for (const mov of movements) {
      const movType = this.classifyMovementType(mov.texto || '');
      const requiresAction = this.checkRequiresAction(mov.texto || '');

      const { data: movement } = await supabase
        .from(this.movementsTable)
        .insert({
          process_id: process.id,
          date: mov.data_disponibilizacao,
          type: movType,
          title: mov.tipoComunicacao || 'Movimentação',
          description: mov.texto?.substring(0, 500) || '',
          source: 'djen',
          djen_hash: mov.hash,
          requires_action: requiresAction,
          completed: !requiresAction,
        })
        .select()
        .single();
      if (movement) processMovements.push(movement);
    }

    return {
      ...process,
      parties,
      movements: processMovements,
    };
  }

  /**
   * Lista todos os processos monitorados
   */
  async listMonitoredProcesses(): Promise<MonitoredProcess[]> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .order('last_movement_date', { ascending: false });

    if (error) throw new Error(error.message);

    // Buscar partes e movimentações separadamente
    const processes: MonitoredProcess[] = [];
    for (const p of data || []) {
      const { data: parties } = await supabase
        .from(this.partiesTable)
        .select('*')
        .eq('process_id', p.id);

      const { data: movements } = await supabase
        .from(this.movementsTable)
        .select('*')
        .eq('process_id', p.id)
        .order('date', { ascending: false });

      processes.push({
        ...p,
        parties: parties || [],
        movements: movements || [],
      });
    }

    return processes;
  }

  /**
   * Obtém detalhes de um processo específico
   */
  async getProcessDetails(id: string): Promise<MonitoredProcess | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }

    const { data: parties } = await supabase
      .from(this.partiesTable)
      .select('*')
      .eq('process_id', id);

    const { data: movements } = await supabase
      .from(this.movementsTable)
      .select('*')
      .eq('process_id', id)
      .order('date', { ascending: false });

    return {
      ...data,
      parties: parties || [],
      movements: movements || [],
    };
  }

  /**
   * Sincroniza movimentações de um processo
   */
  async syncProcessMovements(processId: string): Promise<number> {
    const process = await this.getProcessDetails(processId);
    if (!process) throw new Error('Processo não encontrado');

    const response = await djenService.consultarTodasComunicacoes({
      numeroProcesso: process.process_number,
      dataDisponibilizacaoInicio: process.last_movement_date || '2020-01-01',
      dataDisponibilizacaoFim: djenService.getDataHoje(),
      meio: 'D',
      itensPorPagina: 100,
      pagina: 1,
    });

    const existingHashes = new Set(process.movements.map(m => m.djen_hash));
    let newCount = 0;

    for (const mov of response.items || []) {
      if (existingHashes.has(mov.hash)) continue;

      const movType = this.classifyMovementType(mov.texto || '');
      const requiresAction = this.checkRequiresAction(mov.texto || '');

      await supabase.from(this.movementsTable).insert({
        process_id: processId,
        date: mov.data_disponibilizacao,
        type: movType,
        title: mov.tipoComunicacao || 'Movimentação',
        description: mov.texto?.substring(0, 500) || '',
        source: 'djen',
        djen_hash: mov.hash,
        requires_action: requiresAction,
        completed: !requiresAction,
      });

      newCount++;
    }

    // Atualizar processo
    if (newCount > 0) {
      const allMovements = [...(response.items || [])];
      const currentPhase = this.analyzePhase(allMovements);
      const healthStatus = this.analyzeHealth(allMovements);
      const daysWithoutMovement = this.calculateDaysWithoutMovement(allMovements);
      const lastMovDate = allMovements.length > 0 
        ? allMovements.sort((a, b) => b.data_disponibilizacao.localeCompare(a.data_disponibilizacao))[0].data_disponibilizacao
        : process.last_movement_date;

      await supabase
        .from(this.tableName)
        .update({
          current_phase: currentPhase,
          health_status: healthStatus,
          last_movement_date: lastMovDate,
          days_without_movement: daysWithoutMovement,
          total_movements: process.total_movements + newCount,
          last_sync_at: new Date().toISOString(),
        })
        .eq('id', processId);
    }

    return newCount;
  }

  /**
   * Obtém estatísticas dos processos monitorados
   */
  async getStats(): Promise<ProcessStats> {
    const processes = await this.listMonitoredProcesses();

    const stats: ProcessStats = {
      total: processes.length,
      healthy: 0,
      attention: 0,
      critical: 0,
      archived: 0,
      suspended: 0,
      avgDaysWithoutMovement: 0,
      pendingDeadlines: 0,
      recentMovements: 0,
    };

    let totalDays = 0;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    for (const p of processes) {
      switch (p.health_status) {
        case 'healthy': stats.healthy++; break;
        case 'attention': stats.attention++; break;
        case 'critical': stats.critical++; break;
        case 'archived': stats.archived++; break;
        case 'suspended': stats.suspended++; break;
      }

      totalDays += p.days_without_movement || 0;
      stats.pendingDeadlines += p.pending_deadlines || 0;

      // Contar movimentações recentes
      for (const mov of p.movements || []) {
        if (new Date(mov.date) >= sevenDaysAgo) {
          stats.recentMovements++;
        }
      }
    }

    stats.avgDaysWithoutMovement = processes.length > 0 
      ? Math.round(totalDays / processes.length) 
      : 0;

    return stats;
  }

  /**
   * Remove um processo do monitoramento
   */
  async removeProcess(id: string): Promise<void> {
    await supabase.from(this.movementsTable).delete().eq('process_id', id);
    await supabase.from(this.partiesTable).delete().eq('process_id', id);
    await supabase.from(this.tableName).delete().eq('id', id);
  }

  /**
   * Atualiza o status de saúde de um processo
   */
  async updateProcessStatus(id: string, healthStatus: ProcessHealthStatus): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update({ health_status: healthStatus })
      .eq('id', id);
    
    if (error) throw new Error(error.message);
  }

  /**
   * Vincula um processo a um cliente do CRM
   */
  async linkProcessToClient(
    processId: string, 
    clientId: string, 
    clientName: string,
    clientPole: 'ativo' | 'passivo'
  ): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update({ 
        linked_client_id: clientId,
        linked_client_name: clientName,
        our_client_pole: clientPole
      })
      .eq('id', processId);
    
    if (error) throw new Error(error.message);
  }

  /**
   * Remove vínculo de cliente do processo
   */
  async unlinkProcessFromClient(processId: string): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update({ 
        linked_client_id: null,
        linked_client_name: null,
        our_client_pole: null
      })
      .eq('id', processId);
    
    if (error) throw new Error(error.message);
  }

  /**
   * Atualiza análise de IA do processo
   */
  async updateProcessAIAnalysis(
    processId: string, 
    analysis: {
      summary?: string;
      nextSteps?: string;
      riskAssessment?: 'low' | 'medium' | 'high';
    }
  ): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update({ 
        ai_summary: analysis.summary,
        ai_next_steps: analysis.nextSteps,
        ai_risk_assessment: analysis.riskAssessment
      })
      .eq('id', processId);
    
    if (error) throw new Error(error.message);
  }

  /**
   * Busca clientes que podem corresponder a uma parte do processo
   */
  async findMatchingClients(partyName: string): Promise<any[]> {
    // Normalizar nome para busca
    const normalizedName = partyName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    const { data, error } = await supabase
      .from('clients')
      .select('id, full_name, cpf_cnpj, email, phone')
      .or(`full_name.ilike.%${normalizedName}%`)
      .limit(5);

    if (error) {
      console.error('Erro ao buscar clientes:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Re-sincroniza partes de um processo buscando do DJEN
   */
  async resyncProcessParties(processId: string): Promise<void> {
    const process = await this.getProcessDetails(processId);
    if (!process) throw new Error('Processo não encontrado');

    // Buscar comunicações do processo
    const response = await djenService.consultarTodasComunicacoes({
      numeroProcesso: process.process_number,
      dataDisponibilizacaoInicio: '2020-01-01',
      dataDisponibilizacaoFim: djenService.getDataHoje(),
      meio: 'D',
      itensPorPagina: 100,
      pagina: 1,
    });

    const poloAtivo: string[] = [];
    const poloPassivo: string[] = [];

    // Extrair partes de todas as comunicações
    for (const item of response.items || []) {
      // Dos destinatários
      for (const dest of item.destinatarios || []) {
        const nome = dest.nome?.trim();
        if (!nome) continue;
        
        const polo = (dest.polo || '').toLowerCase();
        if ((polo.includes('ativo') || polo.includes('autor') || polo.includes('requerente')) && !poloAtivo.includes(nome)) {
          poloAtivo.push(nome);
        } else if ((polo.includes('passivo') || polo.includes('réu') || polo.includes('reu') || polo.includes('requerido')) && !poloPassivo.includes(nome)) {
          poloPassivo.push(nome);
        }
      }

      // Do texto
      if (item.texto) {
        const partesExtraidas = this.extractPartiesFromText(item.texto);
        for (const autor of partesExtraidas.autores) {
          if (!poloAtivo.includes(autor)) poloAtivo.push(autor);
        }
        for (const reu of partesExtraidas.reus) {
          if (!poloPassivo.includes(reu)) poloPassivo.push(reu);
        }
      }
    }

    // Remover partes antigas
    await supabase.from(this.partiesTable).delete().eq('process_id', processId);

    // Inserir novas partes
    for (const name of poloAtivo.slice(0, 5)) {
      await supabase.from(this.partiesTable).insert({
        process_id: processId,
        name,
        role: 'autor',
        pole: 'ativo',
      });
    }

    for (const name of poloPassivo.slice(0, 5)) {
      await supabase.from(this.partiesTable).insert({
        process_id: processId,
        name,
        role: 'reu',
        pole: 'passivo',
      });
    }
  }

  /**
   * Re-sincroniza partes de todos os processos
   */
  async resyncAllParties(onProgress?: (current: number, total: number) => void): Promise<void> {
    const processes = await this.listMonitoredProcesses();
    
    for (let i = 0; i < processes.length; i++) {
      try {
        await this.resyncProcessParties(processes[i].id);
        onProgress?.(i + 1, processes.length);
        // Delay para não sobrecarregar API
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`Erro ao sincronizar partes do processo ${processes[i].process_number}:`, err);
      }
    }
  }

  // === Métodos auxiliares ===

  private analyzePhase(movements: DjenComunicacao[]): ProcessPhase {
    // Ordenar do mais recente para o mais antigo
    const sorted = [...movements].sort((a, b) => 
      b.data_disponibilizacao.localeCompare(a.data_disponibilizacao)
    );

    const phaseKeywords: Record<ProcessPhase, string[]> = {
      distribuicao: ['distribuído', 'distribuição', 'sorteio', 'autuação'],
      citacao: ['citação', 'citado', 'citar', 'mandado de citação'],
      contestacao: ['contestação', 'defesa', 'resposta do réu'],
      instrucao: ['instrução', 'prova', 'perícia', 'audiência de instrução', 'testemunha'],
      sentenca: ['sentença', 'julgamento', 'procedente', 'improcedente'],
      recurso: ['recurso', 'apelação', 'agravo', 'embargos'],
      transito_julgado: ['trânsito em julgado', 'transitado', 'certidão de trânsito'],
      cumprimento: ['cumprimento de sentença', 'execução', 'penhora', 'leilão'],
      arquivamento: ['arquivado', 'arquivamento', 'baixa definitiva'],
    };

    // Verificar da fase mais avançada para a mais inicial
    const phaseOrder: ProcessPhase[] = [
      'arquivamento', 'cumprimento', 'transito_julgado', 'recurso',
      'sentenca', 'instrucao', 'contestacao', 'citacao', 'distribuicao'
    ];

    for (const phase of phaseOrder) {
      const keywords = phaseKeywords[phase];
      for (const mov of sorted) {
        const texto = (mov.texto || '').toLowerCase();
        if (keywords.some(kw => texto.includes(kw.toLowerCase()))) {
          return phase;
        }
      }
    }

    return 'distribuicao';
  }

  private analyzeHealth(movements: DjenComunicacao[]): ProcessHealthStatus {
    if (movements.length === 0) return 'healthy';

    const sorted = [...movements].sort((a, b) => 
      b.data_disponibilizacao.localeCompare(a.data_disponibilizacao)
    );

    // Analisar as últimas 3 movimentações para contexto
    const recentTexts = sorted.slice(0, 3).map(m => (m.texto || '').toLowerCase()).join(' ');

    // Verificar arquivamento (prioridade máxima)
    const archivedKeywords = [
      'arquivado', 'arquivamento', 'baixa definitiva', 'baixado',
      'processo extinto', 'extinção do processo', 'transitado em julgado',
      'trânsito em julgado', 'encerrado', 'arquive-se'
    ];
    if (archivedKeywords.some(kw => recentTexts.includes(kw))) {
      return 'archived';
    }

    // Verificar suspensão
    const suspendedKeywords = ['suspenso', 'sobrestado', 'suspensão'];
    if (suspendedKeywords.some(kw => recentTexts.includes(kw))) {
      return 'suspended';
    }

    // Verificar crítico (situações graves)
    const criticalKeywords = [
      'revelia decretada', 'preclusão consumada', 'multa aplicada', 
      'deserção', 'intempestivo', 'não comparecimento', 'pena de confissão'
    ];
    if (criticalKeywords.some(kw => recentTexts.includes(kw))) {
      return 'critical';
    }

    // Por padrão, processo está normal
    return 'healthy';
  }

  private calculateDaysWithoutMovement(movements: DjenComunicacao[]): number {
    if (movements.length === 0) return 0;

    const sorted = [...movements].sort((a, b) => 
      b.data_disponibilizacao.localeCompare(a.data_disponibilizacao)
    );

    const lastDate = new Date(sorted[0].data_disponibilizacao);
    const today = new Date();
    const diffTime = today.getTime() - lastDate.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  private classifyMovementType(texto: string): string {
    const lower = texto.toLowerCase();

    if (lower.includes('sentença')) return 'sentenca';
    if (lower.includes('decisão') || lower.includes('despacho')) return 'decisao';
    if (lower.includes('intimação') || lower.includes('intimado')) return 'intimacao';
    if (lower.includes('petição') || lower.includes('juntada')) return 'peticao';
    if (lower.includes('audiência')) return 'audiencia';
    if (lower.includes('recurso') || lower.includes('apelação')) return 'recurso';
    if (lower.includes('citação') || lower.includes('citado')) return 'citacao';
    if (lower.includes('julgamento')) return 'julgamento';

    return 'outros';
  }

  /**
   * Extrai nomes das partes do texto da comunicação
   */
  private extractPartiesFromText(texto: string): { autores: string[], reus: string[] } {
    const autores: string[] = [];
    const reus: string[] = [];

    if (!texto) return { autores, reus };

    // Extrair autores
    const autorPattern = /(?:AUTOR(?:A)?|REQUERENTE|EXEQUENTE|RECLAMANTE)\s*[:\-]?\s*([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ][A-Za-záàâãéèêíïóôõöúçñ\s]{3,50})/gi;
    let match;
    while ((match = autorPattern.exec(texto)) !== null) {
      const nome = match[1].trim();
      if (nome.length > 3 && nome.length < 60 && !autores.includes(nome)) {
        autores.push(nome);
      }
    }

    // Extrair réus
    const reuPattern = /(?:RÉU|RÉ|REQUERIDO(?:A)?|EXECUTADO(?:A)?|RECLAMADO(?:A)?)\s*[:\-]?\s*([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ][A-Za-záàâãéèêíïóôõöúçñ\s]{3,50})/gi;
    while ((match = reuPattern.exec(texto)) !== null) {
      const nome = match[1].trim();
      if (nome.length > 3 && nome.length < 60 && !reus.includes(nome)) {
        reus.push(nome);
      }
    }

    // Padrão "X vs Y" ou "X x Y"
    const vsPattern = /([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ][A-Za-záàâãéèêíïóôõöúçñ\s]{3,40})\s+(?:VS?\.?|X|CONTRA)\s+([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ][A-Za-záàâãéèêíïóôõöúçñ\s]{3,40})/gi;
    while ((match = vsPattern.exec(texto)) !== null) {
      const autor = match[1].trim();
      const reu = match[2].trim();
      if (autor.length > 3 && autor.length < 50 && !autores.includes(autor)) {
        autores.push(autor);
      }
      if (reu.length > 3 && reu.length < 50 && !reus.includes(reu)) {
        reus.push(reu);
      }
    }

    return { autores: autores.slice(0, 3), reus: reus.slice(0, 3) };
  }

  private checkRequiresAction(texto: string): boolean {
    const lower = texto.toLowerCase();
    const actionKeywords = [
      'prazo', 'manifestar', 'apresentar', 'juntar', 
      'comparecer', 'cumprir', 'intimado para'
    ];
    return actionKeywords.some(kw => lower.includes(kw));
  }

  private formatProcessNumber(num: string): string {
    // Formato CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO
    const clean = num.replace(/\D/g, '');
    if (clean.length !== 20) return num;

    return `${clean.slice(0, 7)}-${clean.slice(7, 9)}.${clean.slice(9, 13)}.${clean.slice(13, 14)}.${clean.slice(14, 16)}.${clean.slice(16, 20)}`;
  }
}

export const processMonitorService = new ProcessMonitorService();
