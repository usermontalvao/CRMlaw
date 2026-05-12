import { supabase } from '../config/supabase';
import type {
  DjenComunicacaoLocal,
  CreateDjenComunicacaoDTO,
  UpdateDjenComunicacaoDTO,
  DjenComunicacao,
} from '../types/djen.types';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';

class DjenLocalService {
  private tableName = 'djen_comunicacoes';
  private advogadosTable = 'djen_advogados';
  private destinatariosTable = 'djen_destinatarios';

  /**
   * Lista comunicações salvas localmente
   */
  async listComunicacoes(filters?: {
    lida?: boolean;
    client_id?: string;
    process_id?: string;
    data_inicio?: string;
    data_fim?: string;
  }): Promise<DjenComunicacaoLocal[]> {
    let query = supabase
      .from(this.tableName)
      .select(
        `*,
        djen_destinatarios (id, nome, polo),
        djen_advogados (id, nome, numero_oab, uf_oab)`
      )
      .eq('ativo', true)
      .order('data_disponibilizacao', { ascending: false });

    if (filters?.lida !== undefined) {
      query = query.eq('lida', filters.lida);
    }

    if (filters?.client_id) {
      query = query.eq('client_id', filters.client_id);
    }

    if (filters?.process_id) {
      query = query.eq('process_id', filters.process_id);
    }

    if (filters?.data_inicio) {
      query = query.gte('data_disponibilizacao', filters.data_inicio);
    }

    if (filters?.data_fim) {
      query = query.lte('data_disponibilizacao', filters.data_fim);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao listar comunicações locais:', error);
      throw new Error(error.message);
    }

    return data ?? [];
  }

  /**
   * Busca comunicação por hash
   */
  async getComunicacaoByHash(hash: string): Promise<DjenComunicacaoLocal | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('hash', hash)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Erro ao buscar comunicação por hash:', error);
      throw new Error(error.message);
    }

    return data;
  }

  /**
   * Salva comunicação do DJEN localmente
   */
  async saveComunicacao(payload: CreateDjenComunicacaoDTO): Promise<DjenComunicacaoLocal> {
    // Verifica se já existe
    const existing = await this.getComunicacaoByHash(payload.hash);
    if (existing) {
      // Se já existe, atualiza os vínculos se foram fornecidos (mesmo que sejam null)
      const hasClientUpdate = 'client_id' in payload;
      const hasProcessUpdate = 'process_id' in payload;
      
      if (hasClientUpdate || hasProcessUpdate) {
        const updatePayload: UpdateDjenComunicacaoDTO = {};
        if (hasClientUpdate) updatePayload.client_id = payload.client_id;
        if (hasProcessUpdate) updatePayload.process_id = payload.process_id;
        
        return await this.updateComunicacao(existing.id, updatePayload);
      }
      return existing;
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('Erro ao salvar comunicação:', error);
      throw new Error(error.message);
    }

    return data;
  }

  /**
   * Salva múltiplas comunicações (importação em lote)
   */
  async saveComunicacoes(
    comunicacoes: DjenComunicacao[],
    options?: {
      clients?: Client[];
      processes?: Process[];
    },
  ): Promise<{ saved: number; skipped: number; linked: number }> {
    let saved = 0;
    let skipped = 0;
    let linked = 0;

    console.log(`📦 saveComunicacoes: ${comunicacoes.length} comunicações, clients=${options?.clients?.length || 0}, processes=${options?.processes?.length || 0}`);

    const normalizeName = (value: string) =>
      value
        ? value
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .toUpperCase()
            .replace(/\s+/g, ' ')
            .trim()
        : '';

    const normalizeProcessNumber = (value: string) => (value ? value.replace(/\D/g, '') : '');

    const extractCandidateNamesFromText = (value: string): string[] => {
      if (!value) return [];

      const candidates: string[] = [];
      const patterns: RegExp[] = [
        /(REQUERENTE|REQUERIDO|AUTOR|R[EÉ]U|EXEQUENTE|EXECUTADO|IMPETRANTE|IMPETRADO)\s*[:\-]\s*([^\n;\r]+)/gi,
      ];

      for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(value)) !== null) {
          const raw = (match[2] || '')
            .replace(/\s+/g, ' ')
            .trim();

          if (!raw) continue;

          raw
            .split(/\s+(?:E|E\/OU)\s+|\s*[,;]\s*/i)
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((part) => {
              if (part.length >= 5) {
                candidates.push(part);
              }
            });
        }
      }

      return Array.from(new Set(candidates)).slice(0, 10);
    };

    const clientMapByName = new Map<string, Client>();
    options?.clients?.forEach((client) => {
      const normalized = normalizeName(client.full_name ?? '');
      if (normalized && !clientMapByName.has(normalized)) {
        clientMapByName.set(normalized, client);
      }
    });

    const processMapByOriginal = new Map<string, Process>();
    const processMapByNormalized = new Map<string, Process>();
    options?.processes?.forEach((process) => {
      const original = process.process_code?.trim();
      if (original && !processMapByOriginal.has(original)) {
        processMapByOriginal.set(original, process);
      }
      const normalized = normalizeProcessNumber(process.process_code ?? '');
      if (normalized && !processMapByNormalized.has(normalized)) {
        processMapByNormalized.set(normalized, process);
      }
    });

    const getProcessMatch = async (numero?: string | null) => {
      if (!numero) {
        return { processId: null as string | null, clientId: null as string | null };
      }

      const trimmed = numero.trim();
      const normalized = normalizeProcessNumber(trimmed);

      console.log(`🔎 getProcessMatch: trimmed="${trimmed}" normalized="${normalized}"`);
      console.log(`🔎 processMapByOriginal.size=${processMapByOriginal.size}, processMapByNormalized.size=${processMapByNormalized.size}`);

      let foundProcess = (trimmed && processMapByOriginal.get(trimmed)) ||
        (normalized && processMapByNormalized.get(normalized));

      if (foundProcess) {
        console.log(`✅ getProcessMatch: encontrado em cache (process_id=${foundProcess.id})`);
      } else {
        console.log(`🔍 getProcessMatch: não encontrado em cache, buscando no Supabase...`);
      }

      if (!foundProcess && trimmed) {
        const { data, error } = await supabase
          .from('processes')
          .select('id, client_id, process_code')
          .eq('process_code', trimmed)
          .maybeSingle();

        console.log(`🔍 Supabase (exato): data=${data ? 'found' : 'null'}, error=${error || 'null'}`);

        if (!error && data) {
          foundProcess = data as Process;
          console.log(`✅ getProcessMatch: encontrado no Supabase (exato)`);
        }
      }

      if (!foundProcess && trimmed) {
        const { data, error } = await supabase
          .from('processes')
          .select('id, client_id, process_code')
          .ilike('process_code', `%${trimmed}%`)
          .limit(1);

        console.log(`🔍 Supabase (ilike): data=${data?.length || 0} rows, error=${error || 'null'}`);

        if (!error && data && data.length > 0) {
          foundProcess = data[0] as Process;
          console.log(`✅ getProcessMatch: encontrado no Supabase (ilike)`);
        }
      }

      if (foundProcess) {
        if (foundProcess.process_code) {
          const originalKey = foundProcess.process_code.trim();
          if (originalKey && !processMapByOriginal.has(originalKey)) {
            processMapByOriginal.set(originalKey, foundProcess);
          }
          const normalizedKey = normalizeProcessNumber(foundProcess.process_code);
          if (normalizedKey && !processMapByNormalized.has(normalizedKey)) {
            processMapByNormalized.set(normalizedKey, foundProcess);
          }
        }

        return {
          processId: foundProcess.id,
          clientId: foundProcess.client_id ?? null,
        };
      }

      console.log(`❌ getProcessMatch: nenhum processo encontrado`);
      return { processId: null, clientId: null };
    };

    const getClientMatch = async (names: string[]): Promise<string | null> => {
      for (const rawName of names) {
        const normalized = normalizeName(rawName);
        if (!normalized) continue;

        console.log(`👤 getClientMatch: trying raw="${rawName}" normalized="${normalized}"`);

        const cached = clientMapByName.get(normalized);
        if (cached) {
          console.log(`✅ getClientMatch: encontrado em cache (client_id=${cached.id})`);
          return cached.id;
        }

        console.log(`🔍 getClientMatch: não encontrado em cache, buscando no Supabase...`);
        // Busca todos os clientes e filtra client-side com normalização de acentos.
        // ILIKE do PostgreSQL não é accent-insensitive: "fabiola" ≠ "Fabíola".
        const { data, error } = await supabase
          .from('clients')
          .select('id, full_name');

        console.log(`👤 Supabase: data=${data?.length || 0} rows, error=${error || 'null'}`);

        if (!error && data && data.length > 0) {
          const match = (data as Array<{ id: string; full_name: string }>).find(
            (c) => normalizeName(c.full_name) === normalized || normalizeName(c.full_name).includes(normalized)
          );
          if (match) {
            clientMapByName.set(normalized, match as unknown as Client);
            console.log(`✅ getClientMatch: encontrado no Supabase normalizado (client_id=${match.id})`);
            return match.id;
          }
        }
      }

      console.log(`❌ getClientMatch: nenhum cliente encontrado`);
      return null;
    };

    for (const comunicacao of comunicacoes) {
      try {
        const existing = await this.getComunicacaoByHash(comunicacao.hash);
        if (existing) {
          const needsLink = !existing.process_id || !existing.client_id;
          if (!needsLink) {
            skipped++;
            continue;
          }

          console.log(`🔗 Auto-link: intimação existente sem vínculo [${existing.id}] process_id=${existing.process_id} client_id=${existing.client_id}`);

          const updatePayload: UpdateDjenComunicacaoDTO = {};

          if (!existing.process_id) {
            const processMatch = await getProcessMatch(comunicacao.numero_processo);
            console.log(`🔍 Process match para [${comunicacao.numero_processo}]:`, processMatch);
            if (processMatch.processId) {
              updatePayload.process_id = processMatch.processId;
              if (!existing.client_id && processMatch.clientId) {
                updatePayload.client_id = processMatch.clientId;
              }
            }
          }

          if (!existing.client_id && !updatePayload.client_id) {
            const candidateNames = (
              comunicacao.destinatarios?.map((dest) => dest.nome).filter(Boolean) as string[] | undefined
            ) ?? [];

            const fromText = extractCandidateNamesFromText(comunicacao.texto || '');
            const mergedCandidates = Array.from(new Set([...candidateNames, ...fromText]));
            console.log(`👤 Client match candidates:`, mergedCandidates.slice(0, 5));
            if (mergedCandidates.length > 0) {
              const matchedClientId = await getClientMatch(mergedCandidates);
              console.log(`👤 Client match result:`, matchedClientId);
              if (matchedClientId) {
                updatePayload.client_id = matchedClientId;
              }
            }
          }

          if (Object.keys(updatePayload).length > 0) {
            console.log(`💾 Atualizando intimação [${existing.id}] com payload:`, updatePayload);
            await this.updateComunicacao(existing.id, updatePayload);
            linked++;
            console.log(`✅ Intimação [${existing.id}] vinculada com sucesso!`);
          } else {
            console.log(`⚠️ Intimação [${existing.id}] sem match para vincular.`);
            skipped++;
          }

          continue;
        }

        // Extrai polos das partes
        const poloAtivo = comunicacao.destinatarios
          ?.filter(d => d.polo && (d.polo.toLowerCase().includes('ativo') || d.polo.toLowerCase().includes('autor') || d.polo.toLowerCase().includes('requerente')))
          .map(d => d.nome)
          .join(', ') || null;
        
        const poloPassivo = comunicacao.destinatarios
          ?.filter(d => d.polo && (d.polo.toLowerCase().includes('passivo') || d.polo.toLowerCase().includes('réu') || d.polo.toLowerCase().includes('requerido')))
          .map(d => d.nome)
          .join(', ') || null;

        const payload: CreateDjenComunicacaoDTO = {
          djen_id: comunicacao.id,
          hash: comunicacao.hash,
          numero_comunicacao: comunicacao.numeroComunicacao || null,
          numero_processo: comunicacao.numero_processo,
          numero_processo_mascara: comunicacao.numeroprocessocommascara || null,
          codigo_classe: comunicacao.codigoClasse || null,
          nome_classe: comunicacao.nomeClasse || null,
          sigla_tribunal: comunicacao.siglaTribunal,
          nome_orgao: comunicacao.nomeOrgao || null,
          texto: comunicacao.texto,
          tipo_comunicacao: comunicacao.tipoComunicacao || null,
          tipo_documento: comunicacao.tipoDocumento || null,
          meio: comunicacao.meio,
          meio_completo: comunicacao.meiocompleto || null,
          link: comunicacao.link || null,
          data_disponibilizacao: comunicacao.data_disponibilizacao,
          polo_ativo: poloAtivo,
          polo_passivo: poloPassivo,
          lida: false, // Nova intimação = não lida
        };

        const processMatch = await getProcessMatch(comunicacao.numero_processo);
        if (processMatch.processId) {
          payload.process_id = processMatch.processId;
        }

        let matchedClientId = processMatch.clientId;

        if (!matchedClientId) {
          const candidateNames = (
            comunicacao.destinatarios?.map((dest) => dest.nome).filter(Boolean) as string[] | undefined
          ) ?? [];
          const fromText = extractCandidateNamesFromText(comunicacao.texto || '');
          const mergedCandidates = Array.from(new Set([...candidateNames, ...fromText]));
          if (mergedCandidates.length > 0) {
            matchedClientId = await getClientMatch(mergedCandidates);
          }
        }

        if (matchedClientId) {
          payload.client_id = matchedClientId;
        }

        const savedComunicacao = await this.saveComunicacao(payload);

        // Salvar advogados
        for (const destAdv of comunicacao.destinatarioadvogados) {
          await supabase.from(this.advogadosTable).insert({
            comunicacao_id: savedComunicacao.id,
            nome: destAdv.advogado.nome,
            numero_oab: destAdv.advogado.numero_oab,
            uf_oab: destAdv.advogado.uf_oab,
            tipo_inscricao: destAdv.advogado.tipo_inscricao || null,
            email: destAdv.advogado.email || null,
          });
        }

        // Salvar destinatários
        for (const dest of comunicacao.destinatarios) {
          await supabase.from(this.destinatariosTable).insert({
            comunicacao_id: savedComunicacao.id,
            nome: dest.nome,
            polo: dest.polo || null,
            cpf_cnpj: dest.cpf_cnpj || null,
          });
        }

        saved++;
      } catch (error) {
        console.error(`Erro ao salvar comunicação ${comunicacao.hash}:`, error);
        skipped++;
      }
    }

    // Após salvar, propaga vínculos para intimações do mesmo processo
    if (saved > 0 || linked > 0) {
      await this.propagarVinculosDoMesmoProcesso();
    }

    return { saved, skipped, linked };
  }

  /**
   * Propaga vínculos de process_id e client_id para comunicações do mesmo número de processo
   * Útil quando múltiplas intimações do mesmo processo são recebidas
   */
  async propagarVinculosDoMesmoProcesso(): Promise<void> {
    try {
      // Busca todas as comunicações ativas
      const { data: comunicacoes, error } = await supabase
        .from(this.tableName)
        .select('id, numero_processo, process_id, client_id')
        .eq('ativo', true);

      if (error || !comunicacoes) {
        console.error('Erro ao buscar comunicações para propagação:', error);
        return;
      }

      // Agrupa por número de processo
      const grupos = new Map<string, typeof comunicacoes>();
      for (const com of comunicacoes) {
        if (!com.numero_processo) continue;
        
        const normalized = com.numero_processo.replace(/\D/g, '');
        if (!normalized) continue;

        if (!grupos.has(normalized)) {
          grupos.set(normalized, []);
        }
        grupos.get(normalized)!.push(com);
      }

      // Para cada grupo de processo, propaga vínculos
      for (const [processNum, grupo] of grupos.entries()) {
        if (grupo.length <= 1) continue; // Só 1 intimação, não precisa propagar

        // Encontra o vínculo mais completo do grupo
        let bestProcessId: string | null = null;
        let bestClientId: string | null = null;

        for (const com of grupo) {
          if (com.process_id && !bestProcessId) {
            bestProcessId = com.process_id;
          }
          if (com.client_id && !bestClientId) {
            bestClientId = com.client_id;
          }
          if (bestProcessId && bestClientId) break;
        }

        // Se encontrou vínculos, propaga para todas as intimações do mesmo processo
        if (bestProcessId || bestClientId) {
          for (const com of grupo) {
            const needsUpdate = 
              (bestProcessId && com.process_id !== bestProcessId) ||
              (bestClientId && com.client_id !== bestClientId);

            if (needsUpdate) {
              const updatePayload: UpdateDjenComunicacaoDTO = {};
              if (bestProcessId && com.process_id !== bestProcessId) {
                updatePayload.process_id = bestProcessId;
              }
              if (bestClientId && com.client_id !== bestClientId) {
                updatePayload.client_id = bestClientId;
              }

              await supabase
                .from(this.tableName)
                .update(updatePayload)
                .eq('id', com.id);
            }
          }
        }
      }

      console.log(`✓ Vínculos propagados com sucesso para ${grupos.size} grupo(s) de processos`);
    } catch (error) {
      console.error('Erro ao propagar vínculos:', error);
    }
  }

  /**
   * Atualiza comunicação
   */
  async updateComunicacao(
    id: string,
    payload: UpdateDjenComunicacaoDTO,
  ): Promise<DjenComunicacaoLocal> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar comunicação:', error);
      throw new Error(error.message);
    }

    return data;
  }

  /**
   * Marca comunicação como lida
   */
  async marcarComoLida(id: string): Promise<DjenComunicacaoLocal> {
    return this.updateComunicacao(id, {
      lida: true,
      lida_em: new Date().toISOString(),
    });
  }

  /**
   * Remove todas as intimações locais
   */
  async clearAll(): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .not('id', 'is', null);

    if (error) {
      console.error('Erro ao limpar intimações locais:', error);
      throw new Error(error.message);
    }
  }

  async deleteByIds(ids: string[]): Promise<number> {
    if (!ids.length) {
      return 0;
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .delete()
      .in('id', ids)
      .select('id');

    if (error) {
      console.error('Erro ao remover intimações selecionadas:', error);
      throw new Error(error.message);
    }

    return data?.length || 0;
  }

  async deleteRead(): Promise<number> {
    const { data, error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('lida', true)
      .select('id');

    if (error) {
      console.error('Erro ao remover intimações lidas:', error);
      throw new Error(error.message);
    }

    return data?.length || 0;
  }

  /**
   * Vincula comunicação a um cliente
   */
  async vincularCliente(id: string, clientId: string): Promise<DjenComunicacaoLocal> {
    return this.updateComunicacao(id, { client_id: clientId, lida: false });
  }

  /**
   * Vincula comunicação a um processo
   */
  async vincularProcesso(id: string, processId: string): Promise<DjenComunicacaoLocal> {
    return this.updateComunicacao(id, { process_id: processId, lida: false });
  }
  /**
   * Agrupa comunicações por cliente
   */
  async agruparPorCliente(): Promise<Map<string, DjenComunicacaoLocal[]>> {
    const comunicacoes = await this.listComunicacoes();
    const grouped = new Map<string, DjenComunicacaoLocal[]>();

    comunicacoes.forEach((comunicacao) => {
      if (!comunicacao.client_id) return;

      const existing = grouped.get(comunicacao.client_id) || [];
      existing.push(comunicacao);
      grouped.set(comunicacao.client_id, existing);
    });

    return grouped;
  }

  /**
   * Conta comunicações não lidas
   */
  async contarNaoLidas(): Promise<number> {
    const { count, error } = await supabase
      .from(this.tableName)
      .select('*', { count: 'exact', head: true })
      .eq('ativo', true)
      .eq('lida', false);

    if (error) {
      console.error('Erro ao contar não lidas:', error);
      return 0;
    }

    return count ?? 0;
  }

  /**
   * Apaga intimações de uma data específica
   * @param date Data no formato YYYY-MM-DD
   */
  async deleteIntimationsByDate(date: string): Promise<{ deleted: number }> {
    const { data, error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('data_disponibilizacao', date)
      .select('id');

    if (error) {
      console.error('Erro ao apagar intimações por data:', error);
      throw new Error(error.message);
    }

    return { deleted: data?.length || 0 };
  }

  /**
   * Remove intimações antigas (mais de X dias)
   * @param days Número de dias para manter (padrão: 30)
   */
  async cleanOldIntimations(days: number = 30): Promise<{ deleted: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffISO = cutoffDate.toISOString();

    const { data, error } = await supabase
      .from(this.tableName)
      .delete()
      .lt('data_disponibilizacao', cutoffISO)
      .select('id');

    if (error) {
      console.error('Erro ao limpar intimações antigas:', error);
      throw new Error(error.message);
    }

    const deleted = data?.length || 0;
    console.log(`🗑️ ${deleted} intimação(ões) antiga(s) removida(s) (mais de ${days} dias)`);
    
    return { deleted };
  }

  /**
   * Busca intimações arquivadas (antigas)
   * @param days Número de dias atrás para buscar
   */
  async getArchivedIntimations(days: number = 30): Promise<DjenComunicacaoLocal[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffISO = cutoffDate.toISOString();

    const { data, error } = await supabase
      .from(this.tableName)
      .select(
        `*,
        djen_destinatarios (id, nome, polo),
        djen_advogados (id, nome, numero_oab, uf_oab)`
      )
      .eq('ativo', true)
      .lt('data_disponibilizacao', cutoffISO)
      .order('data_disponibilizacao', { ascending: false });

    if (error) {
      console.error('Erro ao buscar intimações arquivadas:', error);
      throw new Error(error.message);
    }

    return data ?? [];
  }
}

export const djenLocalService = new DjenLocalService();
