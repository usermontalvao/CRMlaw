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
  ): Promise<{ saved: number; skipped: number }> {
    let saved = 0;
    let skipped = 0;

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

      let foundProcess = (trimmed && processMapByOriginal.get(trimmed)) ||
        (normalized && processMapByNormalized.get(normalized));

      if (!foundProcess && trimmed) {
        const { data, error } = await supabase
          .from('processes')
          .select('id, client_id, process_code')
          .eq('process_code', trimmed)
          .maybeSingle();

        if (!error && data) {
          foundProcess = data as Process;
        }
      }

      if (!foundProcess && trimmed) {
        const { data, error } = await supabase
          .from('processes')
          .select('id, client_id, process_code')
          .ilike('process_code', `%${trimmed}%`)
          .limit(1);

        if (!error && data && data.length > 0) {
          foundProcess = data[0] as Process;
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

      return { processId: null, clientId: null };
    };

    const getClientMatch = async (names: string[]): Promise<string | null> => {
      for (const rawName of names) {
        const normalized = normalizeName(rawName);
        if (!normalized) continue;

        const cached = clientMapByName.get(normalized);
        if (cached) {
          return cached.id;
        }

        const { data, error } = await supabase
          .from('clients')
          .select('id, full_name')
          .ilike('full_name', `%${rawName.trim()}%`)
          .limit(1);

        if (!error && data && data.length > 0) {
          clientMapByName.set(normalized, data[0] as Client);
          return data[0].id;
        }
      }

      return null;
    };

    for (const comunicacao of comunicacoes) {
      try {
        const existing = await this.getComunicacaoByHash(comunicacao.hash);
        if (existing) {
          skipped++;
          continue;
        }

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
        };

        const processMatch = await getProcessMatch(comunicacao.numero_processo);
        if (processMatch.processId) {
          payload.process_id = processMatch.processId;
        }

        let matchedClientId = processMatch.clientId;

        if (!matchedClientId) {
          const candidateNames = comunicacao.destinatarios?.map((dest) => dest.nome).filter(Boolean) ?? [];
          if (candidateNames.length > 0) {
            matchedClientId = await getClientMatch(candidateNames as string[]);
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

    return { saved, skipped };
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
   * Vincula comunicação a um cliente
   */
  async vincularCliente(id: string, clientId: string): Promise<DjenComunicacaoLocal> {
    return this.updateComunicacao(id, { client_id: clientId });
  }

  /**
   * Vincula comunicação a um processo
   */
  async vincularProcesso(id: string, processId: string): Promise<DjenComunicacaoLocal> {
    return this.updateComunicacao(id, { process_id: processId });
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
}

export const djenLocalService = new DjenLocalService();
