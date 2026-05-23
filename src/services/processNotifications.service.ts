// ── processNotifications.service.ts ──────────────────────────────────────────
// Gerencia process_notifications.
// Fonte: DataJud (cache do cron + ao vivo). DJEN gerenciado separadamente.

import { supabase } from '../config/supabase';
import { categorizarMovimento, fetchDatajudMovimentos, getTribunalAlias } from './datajud.service';

export type NotifSource = 'datajud' | 'djen';
export type NotifType =
  | 'sentenca' | 'decisao' | 'despacho' | 'citacao'
  | 'recurso' | 'intimacao' | 'audiencia' | 'outro';

export interface ProcessNotification {
  id: string;
  process_id: string | null;
  process_code: string;
  client_name: string | null;
  source: NotifSource;
  type: NotifType;
  title: string;
  description: string | null;
  movement_date: string | null;
  read_at: string | null;
  created_at: string;
}

export interface SyncProgress {
  current: number;
  total: number;
  processCode: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const CAT_MAP: Record<string, NotifType> = {
  sentenca: 'sentenca', decisao: 'decisao', despacho: 'despacho',
  citacao: 'citacao', recurso: 'recurso', audiencia: 'audiencia',
  arquivamento: 'outro', outro: 'outro',
};

function movToType(codigo: number, nome: string): NotifType {
  return CAT_MAP[categorizarMovimento(codigo, nome)] ?? 'outro';
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Insere apenas linhas NOVAS usando upsert + ignoreDuplicates.
 *
 * Por que upsert e não INSERT simples?
 * ─ INSERT simples falha toda a batch quando UM item já existe (constraint),
 *   impedindo que os genuinamente novos sejam inseridos.
 * ─ A deduplicação manual via fingerprint tinha bug de fuso: DataJud retorna
 *   timestamps em horário de Brasília (-03:00), mas o Postgres os devolve em
 *   UTC (+00:00). As strings eram diferentes e a dedupe falhava silenciosamente,
 *   causando conflito na batch e bloqueando tudo.
 *
 * Com upsert + ignoreDuplicates o Postgres compara TIMESTAMPTZ corretamente
 * (converte ambos a UTC antes de comparar) e garante ON CONFLICT DO NOTHING —
 * read_at das linhas existentes nunca é tocado.
 */
async function insertOnlyNew(
  table: string,
  rows: any[],
  _source: NotifSource,
): Promise<{ inserted: number; errors: string[] }> {
  if (!rows.length) return { inserted: 0, errors: [] };

  const errors: string[] = [];
  let inserted = 0;
  const BATCH = 100;

  for (let i = 0; i < rows.length; i += BATCH) {
    const { error, data } = await supabase
      .from(table)
      .upsert(rows.slice(i, i + BATCH), {
        onConflict: 'process_id,source,movement_date,title',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) errors.push(error.message);
    else inserted += (data ?? []).length;
  }
  return { inserted, errors };
}

/**
 * Normaliza um timestamp para o início da HORA UTC (precisão de hora).
 *
 * Por que hora e não dia?
 * ─ Normalizar para meia-noite (dia) causava falsos-positivos: dois eventos
 *   diferentes com o mesmo título no mesmo dia (ex: dois "Despacho" às 10h e
 *   às 14h) eram tratados como duplicatas e o segundo era descartado.
 * ─ Normalizar para hora ainda resolve o problema original: o DataJud às vezes
 *   retorna o mesmo evento com segundos/milissegundos diferentes entre chamadas
 *   (ex: 10:30:01 e 10:30:47 → ambos viram 10:00:00 → dedup correto).
 * ─ Dois eventos genuinamente diferentes precisariam acontecer na mesma hora
 *   com o mesmo título para colidirem — cenário muito improvável.
 */
function toHourUtc(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 13)}:00:00Z`;
}

/** Converte movimentos DataJud → linhas para process_notifications. */
function movsToRows(
  movimentos: any[],
  processId: string,
  processCode: string,
  clientName: string | null,
): any[] {
  return movimentos
    .filter(m => m?.dataHora && m?.nome)
    .map(m => ({
      process_id:    processId,
      process_code:  processCode,
      client_name:   clientName,
      source:        'datajud',
      type:          movToType(m.codigo ?? 0, m.nome),
      title:         m.nome,
      description:   m.orgaoJulgador?.nomeOrgao ?? null,
      movement_date: toHourUtc(m.dataHora),
    }));
}

// ── service ───────────────────────────────────────────────────────────────────

class ProcessNotificationsService {
  private table = 'process_notifications';

  /** Retorna apenas notificações DataJud (sem DJEN) ordenadas por data.
   *  Limite alto para não cortar a lista (PostgREST default = 1000). */
  async getAll(): Promise<ProcessNotification[]> {
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('source', 'datajud')
      .order('movement_date', { ascending: false })
      .limit(10000);
    if (error) throw new Error(error.message);
    return (data ?? []) as ProcessNotification[];
  }

  /** Conta DataJud não lidas. */
  async countUnread(): Promise<number> {
    const { count } = await supabase
      .from(this.table)
      .select('*', { count: 'exact', head: true })
      .eq('source', 'datajud')
      .is('read_at', null);
    return count ?? 0;
  }

  async markAsRead(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await supabase.from(this.table).update({ read_at: new Date().toISOString() }).in('id', ids);
  }

  async markAllAsRead(): Promise<void> {
    await supabase
      .from(this.table)
      .update({ read_at: new Date().toISOString() })
      .eq('source', 'datajud')
      .is('read_at', null);
  }

  // ── 1. Lê do datajud_cache (cron já preencheu) ────────────────────────────
  async syncFromDatajudCache(): Promise<{ inserted: number; errors: string[] }> {
    const { data: procs, error } = await supabase
      .from('processes')
      .select('id, client_id, process_code, datajud_cache')
      .not('datajud_cache', 'is', null)
      .neq('status', 'arquivado');

    if (error || !procs?.length) return { inserted: 0, errors: error ? [error.message] : [] };

    // Join manual client_id → full_name
    const clientIds = [...new Set(procs.map((p: any) => p.client_id).filter(Boolean))];
    const clientMap: Record<string, string> = {};
    if (clientIds.length) {
      const { data: cls } = await supabase.from('clients').select('id, full_name').in('id', clientIds);
      (cls ?? []).forEach((c: any) => { clientMap[c.id] = c.full_name; });
    }

    const rows: any[] = [];
    for (const p of procs as any[]) {
      const raw = p.datajud_cache;
      if (!raw) continue;
      const processo = raw?.movimentos ? raw : raw?.processo ?? raw;
      if (!Array.isArray(processo?.movimentos)) continue;
      rows.push(...movsToRows(processo.movimentos, p.id, p.process_code, clientMap[p.client_id] ?? null));
    }

    return insertOnlyNew(this.table, rows, 'datajud');
  }

  // ── 2. Chama DataJud ao vivo para processos com código CNJ válido ─────────
  /**
   * @param forceAll  true  → re-busca TODOS os processos com CNJ válido
   *                         (usado pelo botão manual: sempre atualiza)
   *                  false → só busca processos sem cache ou com cache > STALE_HOURS
   *                         (usado por syncs automáticos em background)
   */
  async syncFromDatajudLive(
    onProgress?: (p: SyncProgress) => void,
    forceAll = true,
  ): Promise<{ inserted: number; errors: string[]; skipped: number }> {

    const STALE_HOURS = 4;
    const staleThreshold = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000).toISOString();

    // forceAll: busca todos os processos não-arquivados com código CNJ (qualquer)
    // !forceAll: só os sem cache ou com cache desatualizado
    let query = supabase
      .from('processes')
      .select('id, client_id, process_code, datajud_synced_at')
      .neq('status', 'arquivado')
      .order('datajud_synced_at', { ascending: true, nullsFirst: true });

    if (!forceAll) {
      query = query.or(`datajud_cache.is.null,datajud_synced_at.lt.${staleThreshold}`);
    }

    const { data: procs, error } = await query;

    if (error || !procs?.length) return { inserted: 0, errors: error ? [error.message] : [], skipped: 0 };

    // Filtra código CNJ válido (20 dígitos com tribunal reconhecido)
    const valid = (procs as any[]).filter(p => {
      const digits = (p.process_code ?? '').replace(/\D/g, '');
      return digits.length === 20 && getTribunalAlias(p.process_code) !== null;
    });

    const skipped = (procs as any[]).length - valid.length;

    if (!valid.length) return { inserted: 0, errors: [], skipped };

    // Join manual client_id → full_name
    const clientIds = [...new Set(valid.map((p: any) => p.client_id).filter(Boolean))];
    const clientMap: Record<string, string> = {};
    if (clientIds.length) {
      const { data: cls } = await supabase.from('clients').select('id, full_name').in('id', clientIds);
      (cls ?? []).forEach((c: any) => { clientMap[c.id] = c.full_name; });
    }

    const allRows: any[] = [];
    const errors: string[] = [];
    const total = valid.length;
    let completed = 0;
    const CONCURRENCY = 3; // 3 chamadas simultâneas

    // Processa em chunks de CONCURRENCY
    for (let i = 0; i < valid.length; i += CONCURRENCY) {
      const chunk = valid.slice(i, i + CONCURRENCY);

      await Promise.all(chunk.map(async (p: any) => {
        onProgress?.({ current: ++completed, total, processCode: p.process_code });
        try {
          const result = await fetchDatajudMovimentos(p.process_code);
          const movs = result.processo?.movimentos ?? [];
          const rows = movs.length
            ? movsToRows(movs, p.id, p.process_code, clientMap[p.client_id] ?? null)
            : [];

          if (rows.length) {
            allRows.push(...rows);
            await supabase
              .from('processes')
              .update({ datajud_cache: result.processo, datajud_synced_at: new Date().toISOString() })
              .eq('id', p.id);
          } else {
            await supabase
              .from('processes')
              .update({ datajud_synced_at: new Date().toISOString() })
              .eq('id', p.id);
          }
        } catch (e: any) {
          errors.push(`${p.process_code}: ${e?.message ?? 'erro'}`);
        }
      }));

      // Pequena pausa entre chunks para não sobrecarregar a API
      if (i + CONCURRENCY < valid.length) await sleep(400);
    }

    const res = await insertOnlyNew(this.table, allRows, 'datajud');
    return { inserted: res.inserted, errors: [...errors, ...res.errors], skipped };
  }
}

export const processNotificationsService = new ProcessNotificationsService();
