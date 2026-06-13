import { supabase } from '../config/supabase';
import type {
  Requirement,
  CreateRequirementDTO,
  UpdateRequirementDTO,
  RequirementFilters,
  RequirementStatus,
  RequirementStatusHistoryEntry,
} from '../types/requirement.types';
import { normalizeSearchText } from '../utils/search';

// ─── Cache ────────────────────────────────────────────────────────────────────
// Cache em memória por chave de filtros server-side (eq exactos).
// Filtros client-side (protocol, beneficiary, cpf via ilike) são aplicados
// sobre os dados em cache, evitando round-trips por digitação de busca.
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

interface RequirementCacheEntry {
  data: Requirement[];
  timestamp: number;
}
// ─────────────────────────────────────────────────────────────────────────────

class RequirementService {
  private tableName = 'requirements';
  private statusHistoryTableName = 'requirement_status_history';

  private _cache = new Map<string, RequirementCacheEntry>();

  private getCacheKey(serverFilters: Record<string, unknown>): string {
    return JSON.stringify(serverFilters);
  }

  private isCacheValid(key: string): boolean {
    const entry = this._cache.get(key);
    return !!entry && Date.now() - entry.timestamp < CACHE_DURATION;
  }

  /** Invalida todo o cache. Chamado em qualquer mutação. */
  invalidateCache(): void {
    this._cache.clear();
  }

  // ── Criptografia de senha INSS (AES-GCM via edge function inss-crypto) ──────

  async encryptInssPassword(plaintext: string): Promise<string | null> {
    try {
      const { data, error } = await supabase.functions.invoke('inss-crypto', {
        body: { action: 'encrypt', plaintext },
      });
      if (error || !data?.result) return null;
      return data.result as string;
    } catch {
      return null;
    }
  }

  async decryptInssPassword(ciphertext: string): Promise<string | null> {
    try {
      const { data, error } = await supabase.functions.invoke('inss-crypto', {
        body: { action: 'decrypt', ciphertext },
      });
      if (error || !data?.result) return null;
      return data.result as string;
    } catch {
      return null;
    }
  }

  /**
   * Lista requerimentos com filtros opcionais.
   *
   * Filtros server-side (status, benefit_type, client_id) determinam a chave de cache.
   * Filtros client-side (protocol, beneficiary, cpf) são aplicados sobre o cache,
   * permitindo buscas instantâneas sem round-trip ao Supabase.
   */
  async listRequirements(filters?: RequirementFilters): Promise<Requirement[]> {
    // Separar filtros: server-side (eq) vs client-side (ilike)
    const { protocol, beneficiary, cpf, ...serverFilters } = filters ?? {};
    const cacheKey = this.getCacheKey(serverFilters);

    let rows: Requirement[];

    if (this.isCacheValid(cacheKey)) {
      rows = this._cache.get(cacheKey)!.data;
    } else {
      // Exclui inss_password (plain-text legado) da query de lista para não vazar em massa.
      // inss_password_enc permanece para que a UI detecte se há senha configurada.
      const SAFE_COLS = 'id, protocol, beneficiary, cpf, benefit_type, status, entry_date, analysis_started_at, exigency_due_date, pericia_medica_at, pericia_social_at, phone, inss_password_enc, observations, notes, client_id, archived, created_at, updated_at';
      let query = supabase
        .from(this.tableName)
        .select(SAFE_COLS)
        .order('created_at', { ascending: false });

      if (serverFilters.status) {
        query = query.eq('status', serverFilters.status as string);
      }

      if (serverFilters.benefit_type) {
        query = query.eq('benefit_type', serverFilters.benefit_type as string);
      }

      if (serverFilters.client_id) {
        query = query.eq('client_id', serverFilters.client_id as string);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Erro ao listar requerimentos:', error);
        throw new Error(error.message);
      }

      rows = (data ?? []) as Requirement[];
      this._cache.set(cacheKey, { data: rows, timestamp: Date.now() });
    }

    // ── Filtros client-side (ilike → includes normalizado) ────────────────────
    let result = rows;

    if (protocol) {
      const term = normalizeSearchText(protocol);
      if (term) {
        result = result.filter((r) =>
          normalizeSearchText(r.protocol ?? '').includes(term)
        );
      }
    }

    if (beneficiary) {
      const term = normalizeSearchText(beneficiary);
      if (term) {
        result = result.filter((r) =>
          normalizeSearchText(r.beneficiary ?? '').includes(term)
        );
      }
    }

    if (cpf) {
      const term = normalizeSearchText(cpf);
      if (term) {
        result = result.filter((r) =>
          normalizeSearchText(r.cpf ?? '').includes(term)
        );
      }
    }

    return result;
  }

  async getRequirementById(id: string): Promise<Requirement | null> {
    // Inclui inss_password (plain-text legado) apenas no fetch individual (detalhe),
    // nunca na query de lista, para não vazar em massa.
    const SAFE_COLS = 'id, protocol, beneficiary, cpf, benefit_type, status, entry_date, analysis_started_at, exigency_due_date, pericia_medica_at, pericia_social_at, phone, inss_password, inss_password_enc, observations, notes, client_id, archived, created_at, updated_at';
    const { data, error } = await supabase
      .from(this.tableName)
      .select(SAFE_COLS)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Erro ao buscar requerimento:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async createRequirement(payload: CreateRequirementDTO): Promise<Requirement> {
    const nextPayload: Record<string, any> = { ...payload };
    if (payload.status === 'em_analise' && nextPayload.analysis_started_at === undefined) {
      nextPayload.analysis_started_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        ...nextPayload,
        status: nextPayload.status ?? 'aguardando_confeccao',
        protocol: nextPayload.protocol || null,
        exigency_due_date: nextPayload.exigency_due_date ?? null,
        pericia_medica_at: nextPayload.pericia_medica_at ?? null,
        pericia_social_at: nextPayload.pericia_social_at ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar requerimento:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    return data;
  }

  async updateRequirement(id: string, payload: UpdateRequirementDTO): Promise<Requirement> {
    const nextPayload: Record<string, any> = { ...payload };
    if (payload.status === 'em_analise' && nextPayload.analysis_started_at === undefined) {
      nextPayload.analysis_started_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .update({
        ...nextPayload,
        exigency_due_date: nextPayload.exigency_due_date ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar requerimento:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    return data;
  }

  async updateStatus(id: string, status: RequirementStatus): Promise<Requirement> {
    const payload: Record<string, any> = { status, updated_at: new Date().toISOString() };
    if (status === 'em_analise') {
      payload.analysis_started_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar status do requerimento:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    return data;
  }

  async archiveRequirement(id: string, archived: boolean): Promise<Requirement> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update({ archived, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao arquivar requerimento:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    return data;
  }

  async deleteRequirement(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Erro ao deletar requerimento:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
  }

  async listStatusHistory(requirementId: string): Promise<RequirementStatusHistoryEntry[]> {
    const { data, error } = await supabase
      .from(this.statusHistoryTableName)
      .select('*')
      .eq('requirement_id', requirementId)
      .order('changed_at', { ascending: false });

    if (error) {
      console.error('Erro ao listar histórico de status do requerimento:', error);
      throw new Error(error.message);
    }

    return (data ?? []) as RequirementStatusHistoryEntry[];
  }

  /** Ajuste manual da data de um registro de histórico de status. */
  async updateHistoryEntryDate(
    entryId: string,
    newChangedAt: string,
    requirementId: string,
    toStatus: string,
  ): Promise<void> {
    const { error } = await supabase
      .from(this.statusHistoryTableName)
      .update({ changed_at: newChangedAt })
      .eq('id', entryId);

    if (error) throw new Error(error.message);

    // Se a transição foi para em_analise, sincroniza analysis_started_at no requerimento
    if (toStatus === 'em_analise') {
      await supabase
        .from(this.tableName)
        .update({ analysis_started_at: newChangedAt, updated_at: new Date().toISOString() })
        .eq('id', requirementId);
    }
  }
}

export const requirementService = new RequirementService();
