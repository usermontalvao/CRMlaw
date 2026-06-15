// Camada 360 do cliente: busca/match, agenda, pendências e overview consolidado.
import { supabase } from '../../config/supabase';
import { normalizePhone } from './shared';
import { deadlineService } from '../deadline.service';
import { requirementService } from '../requirement.service';
import { processService } from '../process.service';
import { signatureService } from '../signature.service';
import { financialService } from '../financial.service';
import type { Deadline } from '../../types/deadline.types';
import type { CalendarEvent } from '../../types/calendar.types';
import type { Requirement } from '../../types/requirement.types';
import type { Process } from '../../types/process.types';
import type { SignatureRequestWithSigners } from '../../types/signature.types';
import type { Agreement } from '../../types/financial.types';
import type { WhatsAppClientLite } from '../../types/whatsapp.types';
import type { ClientSchedule, ScheduleDeadline, ClientPendings, ClientDocRequest, ClientOverview } from './shared';

export const client360Api = {
  /** Busca manual de cliente por nome, CPF/CNPJ ou telefone. */
  async searchClients(query: string): Promise<WhatsAppClientLite[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const { data, error } = await supabase.rpc('whatsapp_search_clients', { p_query: q });
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppClientLite[];
  },

  /** Candidatos cujo telefone casa com o do contato (normalizado no banco). */
  async matchClientsByPhone(phone: string): Promise<WhatsAppClientLite[]> {
    if (!phone) return [];
    const { data, error } = await supabase.rpc('whatsapp_match_client_by_phone', { p_phone: phone });
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppClientLite[];
  },

  async getClient(clientId: string): Promise<WhatsAppClientLite | null> {
    const { data } = await supabase
      .from('clients')
      .select('id, full_name, cpf_cnpj, phone, mobile, photo_path, email, status, client_type, address_city, address_state')
      .eq('id', clientId)
      .maybeSingle();
    return (data as WhatsAppClientLite) || null;
  },

  /** Cria um contato básico (nome + telefone) diretamente da conversa e devolve o registro. */
  async createQuickContact(params: { fullName: string; phone: string }): Promise<WhatsAppClientLite> {
    const name = params.fullName.trim();
    if (!name) throw new Error('Informe o nome do contato.');
    const norm = normalizePhone(params.phone);
    if (!norm) throw new Error('Telefone inválido.');
    const { data, error } = await supabase
      .from('clients')
      .insert({ full_name: name, mobile: norm, client_type: 'pessoa_fisica', status: 'ativo' })
      .select('id, full_name, cpf_cnpj, phone, mobile, photo_path, email, status, client_type, address_city, address_state')
      .single();
    if (error) throw new Error(error.message);
    return data as WhatsAppClientLite;
  },

  /**
   * Tenta adicionar o telefone da conversa ao cadastro do cliente.
   * Preenche `mobile` primeiro; se cheio, usa `phone`. Ignora se o número já existe.
   * Retorna `{ added: true, field }` quando gravou ou `{ added: false }` quando pulou.
   */
  async addPhoneToClient(clientId: string, phone: string): Promise<{ added: boolean; field: 'mobile' | 'phone' | null }> {
    const norm = normalizePhone(phone);
    if (!norm) return { added: false, field: null };
    const { data } = await supabase
      .from('clients')
      .select('mobile, phone')
      .eq('id', clientId)
      .single();
    const cur = data as { mobile: string | null; phone: string | null } | null;
    if (!cur) return { added: false, field: null };
    const existing = [cur.mobile, cur.phone].map(p => (p ? normalizePhone(p) : null));
    if (existing.includes(norm)) return { added: false, field: null };
    if (cur.mobile && cur.phone) return { added: false, field: null }; // ambos preenchidos
    const field: 'mobile' | 'phone' = !cur.mobile ? 'mobile' : 'phone';
    const { error } = await supabase.from('clients').update({ [field]: norm }).eq('id', clientId);
    if (error) throw new Error(error.message);
    return { added: true, field };
  },

  /**
   * Agenda do cliente para o painel: prazos + compromissos, em paralelo e
   * filtrados por client_id (um service call, sem N+1). Falha parcial é tolerada.
   */
  async getClientSchedule(clientId: string): Promise<ClientSchedule> {
    const [deadlinesRaw, evResp] = await Promise.all([
      deadlineService.listDeadlines({ client_id: clientId }).catch(() => [] as Deadline[]),
      supabase.rpc('get_client_calendar_events', { p_client_id: clientId }),
    ]);

    const allEvents = (evResp.data || []) as CalendarEvent[];

    // Prazos = tabela deadlines (abertos) + prazos que existem só como evento de
    // calendário (tipo 'deadline'), sem duplicar os já vindos da tabela.
    const tableDeadlines = (deadlinesRaw || []).filter(d => d.status === 'pendente' || d.status === 'vencido');
    const tableIds = new Set(tableDeadlines.map(d => d.id));
    const orphanCalDeadlines = allEvents.filter(e =>
      e.event_type === 'deadline' && e.status === 'pendente' && !(e.deadline_id && tableIds.has(e.deadline_id)));

    const deadlines: ScheduleDeadline[] = [
      ...tableDeadlines.map(d => ({ id: d.id, title: d.title, due: d.due_date })),
      ...orphanCalDeadlines.map(e => ({ id: e.id, title: e.title, due: e.start_at })),
    ].sort((a, b) => a.due.localeCompare(b.due));

    // Compromissos = eventos de calendário que não são prazos, daqui pra frente.
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const events = allEvents
      .filter(e => e.status === 'pendente' && e.event_type !== 'deadline' && new Date(e.start_at) >= startOfToday)
      .sort((a, b) => a.start_at.localeCompare(b.start_at));

    return { deadlines, events };
  },

  /**
   * Pendências do cliente: requerimentos em andamento + solicitações de
   * documento abertas. Em paralelo, filtrados por client_id (sem N+1).
   */
  async getClientPendings(clientId: string): Promise<ClientPendings> {
    const [reqsRaw, docsResp] = await Promise.all([
      requirementService.listRequirements({ client_id: clientId }).catch(() => [] as Requirement[]),
      supabase.from('document_requests')
        .select('id, title, due_date, status, document_request_items(id, label, required, status, sort_order)')
        .eq('client_id', clientId)
        .in('status', ['pending', 'partial'])
        .order('due_date', { ascending: true, nullsFirst: false }),
    ]);

    // Estados terminais do requerimento não são "em andamento".
    const TERMINAL = new Set(['deferido', 'indeferido', 'ajuizado']);
    const requirements = (reqsRaw || []).filter(r => !r.archived && !TERMINAL.has(r.status));
    const documents = ((docsResp.data || []) as any[]).map(d => ({
      id: d.id, title: d.title, due_date: d.due_date, status: d.status,
      items: ((d.document_request_items || []) as any[])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(i => ({ id: i.id, label: i.label, required: i.required, status: i.status })),
    })) as ClientDocRequest[];
    return { requirements, documents };
  },

  /**
   * Cria uma solicitação de documento real (tabela document_requests) a partir
   * da conversa do WhatsApp. Gera registro rastreável com prazo e status
   * 'pending' — aparece em getClientPendings e no portal do cliente (o trigger
   * de notificação dispara no banco). Cria um item por documento pedido.
   */
  async createDocumentRequest(params: {
    clientId: string;
    title: string;
    description?: string | null;
    dueDate?: string | null;
    createdBy?: string | null;
    processId?: string | null;
    items: { label: string; description?: string | null; required?: boolean }[];
  }): Promise<string> {
    const { clientId, title, description, dueDate, createdBy, processId, items } = params;
    const { data: req, error: re } = await supabase
      .from('document_requests')
      .insert({
        client_id: clientId,
        title: title.trim(),
        description: description?.trim() || null,
        due_date: dueDate || null,
        created_by: createdBy || null,
        process_id: processId || null,
      })
      .select('id')
      .single();
    if (re || !req) throw new Error(re?.message || 'Erro ao criar solicitação de documento');

    const validItems = items.filter(i => i.label.trim());
    if (validItems.length > 0) {
      const { error: ie } = await supabase.from('document_request_items').insert(
        validItems.map((it, i) => ({
          request_id: req.id,
          label: it.label.trim(),
          description: it.description?.trim() || null,
          required: it.required ?? true,
          sort_order: i,
        })),
      );
      if (ie) throw new Error(ie.message);
    }
    return req.id as string;
  },

  /**
   * Cancela uma solicitação de documento (status 'cancelled'). Some de
   * getClientPendings e do portal do cliente, sem apagar o histórico.
   */
  async cancelDocumentRequest(requestId: string): Promise<void> {
    const { error } = await supabase
      .from('document_requests')
      .update({ status: 'cancelled' })
      .eq('id', requestId);
    if (error) throw new Error(error.message);
  },

  /**
   * Status de documentos por cliente, para os chips de lista/cabeçalho do WhatsApp:
   * 'awaiting' (há solicitação aberta — pending/partial) tem prioridade sobre
   * 'ready' (só solicitações concluídas). Uma consulta para vários clientes.
   */
  async getDocStatusByClients(clientIds: string[]): Promise<Record<string, 'awaiting' | 'ready'>> {
    if (clientIds.length === 0) return {};
    const { data, error } = await supabase
      .from('document_requests')
      .select('client_id, status')
      .in('client_id', clientIds)
      .in('status', ['pending', 'partial', 'complete']);
    if (error) throw new Error(error.message);
    const map: Record<string, 'awaiting' | 'ready'> = {};
    for (const r of (data || []) as { client_id: string; status: string }[]) {
      if (r.status === 'pending' || r.status === 'partial') map[r.client_id] = 'awaiting';
      else if (r.status === 'complete' && map[r.client_id] !== 'awaiting') map[r.client_id] = 'ready';
    }
    return map;
  },

  /** Realtime das solicitações de documento (lista/cabeçalho/pendências reagem à baixa por IA). */
  subscribeDocRequests(onChange: () => void): () => void {
    const ch = supabase
      .channel('wa-docreqs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'document_requests' }, () => onChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'document_request_items' }, () => onChange())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  },

  /**
   * Carrega o pacote 360 do cliente de uma vez (processos + agenda + pendências),
   * em paralelo. Banner-resumo e painéis laterais consomem este único resultado,
   * evitando os fetches duplicados de antes. Falha parcial vira vazio.
   */
  async getClientOverview(clientId: string): Promise<ClientOverview> {
    const [processes, schedule, pendings, signatures, agreements] = await Promise.all([
      processService.listProcesses({ client_id: clientId }).catch(() => [] as Process[]),
      client360Api.getClientSchedule(clientId).catch(() => ({ deadlines: [], events: [] } as ClientSchedule)),
      client360Api.getClientPendings(clientId).catch(() => ({ requirements: [], documents: [] } as ClientPendings)),
      signatureService.listRequestsWithSigners({ client_id: clientId }).catch(() => [] as SignatureRequestWithSigners[]),
      financialService.listAgreements({ client_id: clientId }).catch(() => [] as Agreement[]),
    ]);
    return { processes, schedule, pendings, signatures, agreements };
  },
};
