import { supabase } from '../config/supabase';
import { syncBus } from '../lib/syncBus';
import type {
  Deadline,
  CreateDeadlineDTO,
  UpdateDeadlineDTO,
  DeadlineFilters,
  DeadlineStatus,
  DeadlineCancellation,
  DeadlineCancellationAttachment,
} from '../types/deadline.types';
import { dividirEmLotes } from '../utils/queryBatches';
import { matchesNormalizedSearch, normalizeSearchText } from '../utils/search';

// Prints do motivo do cancelamento — mesmo bucket privado dos anexos de chat/feed.
const CANCELLATION_BUCKET = 'anexos_chat';

// ─── Cache ────────────────────────────────────────────────────────────────────
// Cache em memória por chave de filtros server-side (eq + date ranges).
// O filtro client-side (search) é aplicado sobre os dados em cache.
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

interface DeadlineCacheEntry {
  data: Deadline[];
  timestamp: number;
}
// ─────────────────────────────────────────────────────────────────────────────

class DeadlineService {
  private tableName = 'deadlines';

  private _cache = new Map<string, DeadlineCacheEntry>();

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

  /**
   * Lista prazos com filtros opcionais.
   *
   * Todos os filtros de eq/range determinam a chave de cache.
   * O filtro `search` é aplicado client-side sobre os dados em cache.
   */
  async listDeadlines(filters?: DeadlineFilters): Promise<Deadline[]> {
    // Separar search (client-side) dos demais filtros (server-side)
    const { search, ...serverFilters } = filters ?? {};
    const cacheKey = this.getCacheKey(serverFilters);

    let rows: Deadline[];

    if (this.isCacheValid(cacheKey)) {
      rows = this._cache.get(cacheKey)!.data;
    } else {
      let query = supabase
        .from(this.tableName)
        .select('*')
        .order('due_date', { ascending: true });

      if (serverFilters.status) {
        query = query.eq('status', serverFilters.status as string);
      }

      if (serverFilters.priority) {
        query = query.eq('priority', serverFilters.priority as string);
      }

      if (serverFilters.type) {
        query = query.eq('type', serverFilters.type as string);
      }

      if (serverFilters.process_id) {
        query = query.eq('process_id', serverFilters.process_id as string);
      }

      if (serverFilters.requirement_id) {
        query = query.eq('requirement_id', serverFilters.requirement_id as string);
      }

      if (serverFilters.client_id) {
        query = query.eq('client_id', serverFilters.client_id as string);
      }

      if (serverFilters.responsible_id) {
        query = query.eq('responsible_id', serverFilters.responsible_id as string);
      }

      if (serverFilters.due_date_from) {
        query = query.gte('due_date', serverFilters.due_date_from as string);
      }

      if (serverFilters.due_date_to) {
        query = query.lte('due_date', serverFilters.due_date_to as string);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Erro ao listar prazos:', error);
        throw new Error(error.message);
      }

      rows = (data ?? []) as Deadline[];
      this._cache.set(cacheKey, { data: rows, timestamp: Date.now() });
    }

    // ── Filtro client-side ────────────────────────────────────────────────────
    if (search) {
      const normalizedSearch = normalizeSearchText(search);
      if (normalizedSearch) {
        return rows.filter((item) =>
          matchesNormalizedSearch(normalizedSearch, [item.title, item.description])
        );
      }
    }

    return rows;
  }

  async getDeadlineById(id: string): Promise<Deadline | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Erro ao buscar prazo:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async createDeadline(payload: CreateDeadlineDTO): Promise<Deadline> {
    if (!payload.responsible_id?.trim()) {
      throw new Error('Selecione o responsável pelo prazo.');
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        ...payload,
        status: payload.status ?? 'pendente',
        priority: payload.priority ?? 'media',
        client_id: payload.client_id ?? null,
        responsible_id: payload.responsible_id,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar prazo:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    syncBus.emit('deadlines');
    return data;
  }

  async updateDeadline(id: string, payload: UpdateDeadlineDTO): Promise<Deadline> {
    if (Object.prototype.hasOwnProperty.call(payload, 'responsible_id') && !payload.responsible_id?.trim()) {
      throw new Error('Selecione o responsável pelo prazo.');
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .update({
        ...payload,
        client_id: payload.client_id ?? null,
        responsible_id: payload.responsible_id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar prazo:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    syncBus.emit('deadlines');
    return data;
  }

  async updateStatus(id: string, status: DeadlineStatus): Promise<Deadline> {
    const updatePayload: Record<string, any> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'cumprido') {
      updatePayload.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar status do prazo:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    syncBus.emit('deadlines');
    return data;
  }

  /**
   * Cancela o prazo registrando o motivo em deadline_cancellations.
   * O motivo é gravado antes da troca de status: se o insert falhar,
   * o prazo continua na fila em vez de virar um cancelamento sem justificativa.
   */
  async cancelDeadline(
    id: string,
    reason: string,
    cancelledBy?: string | null,
    attachments: DeadlineCancellationAttachment[] = [],
  ): Promise<Deadline> {
    const trimmed = reason.trim();
    if (!trimmed) throw new Error('Informe o motivo do cancelamento.');

    const { error: reasonError } = await supabase
      .from('deadline_cancellations')
      .insert({ deadline_id: id, reason: trimmed, cancelled_by: cancelledBy ?? null, attachments });

    if (reasonError) {
      console.error('Erro ao registrar motivo do cancelamento:', reasonError);
      throw new Error(reasonError.message);
    }

    return this.updateStatus(id, 'cancelado');
  }

  /**
   * Sobe um print/arquivo do motivo do cancelamento e devolve o descritor.
   * O binário vai para o bucket privado anexos_chat; a tabela guarda só o caminho.
   */
  async uploadCancellationAttachment(deadlineId: string, file: File): Promise<DeadlineCancellationAttachment> {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'anexo';
    const path = `prazos/cancelamentos/${deadlineId}/${crypto.randomUUID()}_${safeName}`;

    const { error } = await supabase.storage
      .from(CANCELLATION_BUCKET)
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });

    if (error) {
      console.error('Erro ao enviar anexo do cancelamento:', error);
      throw new Error(`Falha ao enviar "${file.name}": ${error.message}`);
    }

    return { path, name: file.name, mime: file.type || 'application/octet-stream', size: file.size };
  }

  /** URL assinada para exibir/baixar um anexo do cancelamento. */
  async getCancellationAttachmentUrl(path: string, expiresIn = 60 * 10): Promise<string | null> {
    const { data, error } = await supabase.storage
      .from(CANCELLATION_BUCKET)
      .createSignedUrl(path, expiresIn);

    if (error) {
      console.error('Erro ao assinar anexo do cancelamento:', error);
      return null;
    }
    return data?.signedUrl ?? null;
  }

  /** Último motivo de cancelamento do prazo (null quando nunca foi cancelado). */
  async getCancellation(deadlineId: string): Promise<DeadlineCancellation | null> {
    const { data, error } = await supabase
      .from('deadline_cancellations')
      .select('id, deadline_id, reason, cancelled_by, created_at, attachments')
      .eq('deadline_id', deadlineId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar motivo do cancelamento:', error);
      return null;
    }

    return (data as DeadlineCancellation) ?? null;
  }

  async deleteDeadline(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Erro ao deletar prazo:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    syncBus.emit('deadlines');
  }

  async getUpcomingDeadlines(daysAhead: number = 7): Promise<Deadline[]> {
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + daysAhead);

    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('status', 'pendente')
      .gte('due_date', today.toISOString())
      .lte('due_date', futureDate.toISOString())
      .order('due_date', { ascending: true });

    if (error) {
      console.error('Erro ao buscar prazos próximos:', error);
      throw new Error(error.message);
    }

    return data ?? [];
  }

  /**
   * Guardião de prazos: dado um conjunto de intimações, retorna os IDs das que
   * JÁ possuem prazo vinculado (deadlines.intimation_id). Usado para bloquear
   * "marcar como lida" quando a IA detectou prazo e nenhum foi cadastrado.
   */
  async getIntimationIdsWithDeadlines(intimationIds: string[]): Promise<Set<string>> {
    if (intimationIds.length === 0) return new Set();

    // Em lotes: o `in.(...)` vai na URL e estoura o teto do servidor com algumas
    // centenas de ids — e aqui a falha é pior que uma tela vazia, porque quem
    // chama é o Guardião.
    const encontrados = new Set<string>();

    const respostas = await Promise.all(
      dividirEmLotes(intimationIds).map((lote) =>
        supabase.from(this.tableName).select('intimation_id').in('intimation_id', lote),
      ),
    );

    for (const { data, error } of respostas) {
      if (error) {
        console.error('Erro ao verificar prazos vinculados a intimações:', error);
        throw new Error(error.message);
      }
      for (const linha of data ?? []) encontrados.add(linha.intimation_id as string);
    }

    return encontrados;
  }

  /**
   * Guardião de prazos, vínculo fraco: prazos que podem ser de uma intimação sem
   * `intimation_id` gravado.
   *
   * Busca pelas duas âncoras — processo e cliente — porque o cadastro do
   * escritório é centrado no cliente: a maioria dos prazos não tem processo, e
   * boa parte das intimações também não. Duas consultas em vez de um `or(...)`
   * porque cada lado tem seu próprio lote e o filtro vai na URL.
   *
   * Traz tudo que não está cancelado e deixa o filtro fino para
   * `casamentoDePrazo` — a regra mora num módulo puro e testado, não espalhada
   * em cláusula de consulta.
   */
  async getDeadlineCandidates(ancoras: {
    processIds?: string[];
    clientIds?: string[];
  }): Promise<Deadline[]> {
    const processIds = Array.from(new Set((ancoras.processIds ?? []).filter(Boolean)));
    const clientIds = Array.from(new Set((ancoras.clientIds ?? []).filter(Boolean)));
    if (processIds.length === 0 && clientIds.length === 0) return [];

    const consultas = [
      ...dividirEmLotes(processIds).map((lote) =>
        supabase.from(this.tableName).select('*').in('process_id', lote).neq('status', 'cancelado'),
      ),
      ...dividirEmLotes(clientIds).map((lote) =>
        supabase.from(this.tableName).select('*').in('client_id', lote).neq('status', 'cancelado'),
      ),
    ];

    // Um prazo com processo E cliente na lista volta nas duas consultas.
    const porId = new Map<string, Deadline>();

    for (const { data, error } of await Promise.all(consultas)) {
      if (error) {
        console.error('Erro ao buscar prazos candidatos:', error);
        throw new Error(error.message);
      }
      for (const prazo of (data ?? []) as Deadline[]) porId.set(prazo.id, prazo);
    }

    return Array.from(porId.values());
  }

  /**
   * Promove o vínculo fraco a forte: grava `intimation_id` no prazo que o
   * operador confirmou ser o desta intimação. `confirmed_at` marca que quem
   * confirmou foi gente — o backfill deixa nulo.
   */
  async linkDeadlineToIntimation(deadlineId: string, intimationId: string): Promise<Deadline> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update({
        intimation_id: intimationId,
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', deadlineId)
      .select()
      .single();

    if (error) {
      console.error('Erro ao vincular prazo à intimação:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    syncBus.emit('deadlines');
    return data;
  }

  async getOverdueDeadlines(): Promise<Deadline[]> {
    const today = new Date().toISOString();

    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('status', 'pendente')
      .lt('due_date', today)
      .order('due_date', { ascending: true });

    if (error) {
      console.error('Erro ao buscar prazos vencidos:', error);
      throw new Error(error.message);
    }

    return data ?? [];
  }
}

export const deadlineService = new DeadlineService();
