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
import type { ClientSchedule, ScheduleDeadline, ClientPendings, ClientDocRequest, ClientOverview, ClientTemplateFillLink, ClientTrackedSignatureStatus } from './shared';

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

  async getTrackedSignatureStatusByClients(clientIds: string[]): Promise<Record<string, ClientTrackedSignatureStatus>> {
    if (clientIds.length === 0) return {};

    // Fonte A: links de preenchimento de kit (presença na página de preenchimento +
    // assinatura gerada a partir do kit).
    // Fonte B: assinaturas criadas DIRETO (sem kit) — antes ficavam invisíveis na
    // conversa porque a função só olhava template_fill_links.
    const [{ data: links, error: linksError }, { data: directReqs, error: directError }] = await Promise.all([
      supabase
        .from('template_fill_links')
        .select('id, client_id, created_at, opened_at, last_seen_at, submitted_at, signature_request_id, status, followup_stopped')
        .in('client_id', clientIds)
        .eq('followup_stopped', false)
        .in('status', ['pending', 'submitted']),
      // Inclui também assinadas/recusadas (terminal) para mostrar "Assinado"/
      // "Recusado" com opção de fechar; só recentes (30d) p/ não acender tudo.
      supabase
        .from('signature_requests')
        .select('id, client_id, status, signed_at, archived_at, deleted_at, wa_tracking_stopped, created_at')
        .in('client_id', clientIds)
        .in('status', ['pending', 'signed', 'refused'])
        .eq('wa_tracking_stopped', false)
        .is('archived_at', null)
        .is('deleted_at', null)
        .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString()),
    ]);
    if (linksError) throw new Error(linksError.message);
    if (directError) throw new Error(directError.message);

    const linkRows = ((links || []) as any[]).filter((row) => !!row.client_id);
    const linkByReq = new Map<string, string>();
    for (const l of linkRows) if (l.signature_request_id) linkByReq.set(l.signature_request_id, l.id);

    // Requests a carregar: das duas fontes (direto + os referenciados por links).
    const requestMap = new Map<string, any>();
    for (const r of (directReqs || []) as any[]) requestMap.set(r.id, r);
    const linkReqIds = Array.from(new Set(linkRows.map((l) => l.signature_request_id).filter(Boolean))) as string[];
    const requestIds = Array.from(new Set([...requestMap.keys(), ...linkReqIds]));

    const signerMap = new Map<string, any[]>();
    if (requestIds.length > 0) {
      const missing = linkReqIds.filter((id) => !requestMap.has(id));
      const [reqResp, { data: signers, error: signersError }] = await Promise.all([
        missing.length
          ? supabase
              .from('signature_requests')
              .select('id, client_id, status, signed_at, archived_at, deleted_at, wa_tracking_stopped, created_at')
              .in('id', missing)
          : Promise.resolve({ data: [] as any[], error: null } as any),
        supabase
          .from('signature_signers')
          .select('id, signature_request_id, status, viewed_at, opened_at, last_seen_at, signed_at, refused_at')
          .in('signature_request_id', requestIds),
      ]);
      if (reqResp.error) throw new Error(reqResp.error.message);
      if (signersError) throw new Error(signersError.message);
      for (const req of (reqResp.data || []) as any[]) requestMap.set(req.id, req);
      for (const signer of (signers || []) as any[]) {
        const bucket = signerMap.get(signer.signature_request_id) || [];
        bucket.push(signer);
        signerMap.set(signer.signature_request_id, bucket);
      }
    }

    const now = Date.now();
    /** "visto por último" com data e hora reais, no estilo do WhatsApp. */
    const lastSeenLabel = (iso: string) => {
      const d = new Date(iso);
      const hhmm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const today = new Date();
      const yest = new Date(); yest.setDate(today.getDate() - 1);
      if (d.toDateString() === today.toDateString()) return `visto por último hoje às ${hhmm}`;
      if (d.toDateString() === yest.toDateString()) return `visto por último ontem às ${hhmm}`;
      return `visto por último em ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })} às ${hhmm}`;
    };
    const META: Record<ClientTrackedSignatureStatus['kind'], { label: string; cls: string; live: boolean; rank: number; terminal?: boolean }> = {
      signature_signed: { label: 'Assinado',                 cls: 'bg-emerald-100 text-emerald-700', live: false, rank: 8, terminal: true },
      signature_refused:{ label: 'Recusado',                 cls: 'bg-rose-100 text-rose-700',     live: false, rank: 7, terminal: true },
      signature_live:   { label: 'Página de assinatura aberta', cls: 'bg-sky-100 text-sky-700',    live: true,  rank: 6 },
      fill_live:        { label: 'Cliente na tela',          cls: 'bg-violet-100 text-violet-700', live: true,  rank: 5 },
      signature_viewed: { label: 'Saiu sem assinar',         cls: 'bg-orange-100 text-orange-700', live: false, rank: 4 },
      signature_pending:{ label: 'Aguardando assinatura',    cls: 'bg-amber-100 text-amber-700',   live: false, rank: 3 },
      fill_opened:      { label: 'Página aberta',            cls: 'bg-blue-100 text-blue-700',     live: false, rank: 2 },
      fill_sent:        { label: 'Link enviado',             cls: 'bg-slate-100 text-slate-500',   live: false, rank: 1 },
    };
    const out: Record<string, ClientTrackedSignatureStatus> = {};
    const consider = (clientId: string, linkId: string, reqId: string | null, kind: ClientTrackedSignatureStatus['kind'], labelOverride?: string) => {
      const cur = out[clientId];
      if (cur && META[cur.kind].rank >= META[kind].rank) return;
      const m = META[kind];
      out[clientId] = { client_id: clientId, link_id: linkId, signature_request_id: reqId, kind, label: labelOverride ?? m.label, cls: m.cls, live: m.live, terminal: m.terminal };
    };

    // Candidatos de ASSINATURA (de ambas as fontes — direto ou via kit).
    for (const req of requestMap.values()) {
      if (req.archived_at || req.deleted_at || req.wa_tracking_stopped) continue;
      const clientId = req.client_id ? String(req.client_id) : null;
      if (!clientId) continue;
      const signers = signerMap.get(req.id) || [];
      const linkId = linkByReq.get(req.id) || req.id;
      // "Remota" = assinatura conduzida pela página pública (algum signatário
      // abriu/visualizou) OU veio de um kit. Só essas mostram badge terminal —
      // assinaturas feitas presencialmente não devem acender "Assinado" na conversa.
      const remote = linkByReq.has(req.id) || signers.some((s) => !!s.viewed_at || !!s.opened_at || !!s.last_seen_at);

      const isSigned = req.status === 'signed' || !!req.signed_at || signers.some((s) => !!s.signed_at);
      const isRefused = req.status === 'refused' || signers.some((s) => !!s.refused_at);
      if (isSigned) { if (remote) consider(clientId, linkId, req.id, 'signature_signed'); continue; }
      if (isRefused) { if (remote) consider(clientId, linkId, req.id, 'signature_refused'); continue; }

      const pendingSigner = signers.find((s) => s.status !== 'signed' && !s.refused_at) || signers[0] || null;
      const activeSignatureOnPage = !!pendingSigner?.last_seen_at && (now - new Date(pendingSigner.last_seen_at).getTime() <= 30_000);
      if (activeSignatureOnPage) consider(clientId, linkId, req.id, 'signature_live');
      else if (pendingSigner?.viewed_at || pendingSigner?.opened_at) {
        // Já saiu da tela — mostra "visto por último" em vez de travar em "aberta".
        consider(clientId, linkId, req.id, 'signature_viewed', pendingSigner?.last_seen_at ? `Saiu sem assinar — ${lastSeenLabel(pendingSigner.last_seen_at)}` : undefined);
      }
      else consider(clientId, linkId, req.id, 'signature_pending');
    }

    // Candidatos de PREENCHIMENTO (links de kit ainda sem assinatura gerada).
    for (const row of linkRows) {
      if (row.signature_request_id) continue; // já coberto como assinatura acima
      const clientId = String(row.client_id);
      const activeOnPage = !!row.last_seen_at && (now - new Date(row.last_seen_at).getTime() <= 30_000);
      if (activeOnPage) consider(clientId, row.id, null, 'fill_live');
      else if (row.submitted_at) consider(clientId, row.id, null, 'signature_pending');
      else if (row.opened_at) {
        // Já saiu da tela — mostra "visto por último" em vez de travar em "aberta".
        consider(clientId, row.id, null, 'fill_opened', row.last_seen_at ? `Saiu — ${lastSeenLabel(row.last_seen_at)}` : undefined);
      }
      else consider(clientId, row.id, null, 'fill_sent');
    }

    return out;
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

  /** Realtime das assinaturas para a lateral 360 da conversa refletir preenchimento/assinatura em aberto. */
  subscribeSignatures(onChange: () => void): () => void {
    const ch = supabase
      .channel('wa-signatures')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'signature_requests' }, () => onChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'signature_signers' }, () => onChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'template_fill_links' }, () => onChange())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  },

  async listClientTemplateFillLinks(clientId: string): Promise<ClientTemplateFillLink[]> {
    const { data, error } = await supabase
      .from('template_fill_links')
      .select(`
        id,
        public_token,
        template_id,
        status,
        followup_stopped,
        created_at,
        opened_at,
        last_seen_at,
        submitted_at,
        signature_request_id,
        document_templates(name)
      `)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw new Error(error.message);

    return ((data || []) as any[]).map((row) => ({
      id: row.id,
      public_token: row.public_token,
      template_id: row.template_id,
      template_name: row.document_templates?.name || 'Kit sem nome',
      status: row.status,
      followup_stopped: row.followup_stopped === true,
      created_at: row.created_at,
      opened_at: row.opened_at || null,
      last_seen_at: row.last_seen_at || null,
      submitted_at: row.submitted_at || null,
      signature_request_id: row.signature_request_id || null,
    }));
  },

  async stopTemplateFillTracking(linkId: string): Promise<void> {
    const { error } = await supabase
      .from('template_fill_links')
      .update({ followup_stopped: true })
      .eq('id', linkId);
    if (error) throw new Error(error.message);
  },

  async stopSignatureTracking(signatureRequestId: string): Promise<void> {
    // Encerra o acompanhamento marcando a própria assinatura — funciona mesmo
    // quando NÃO há template_fill_link vinculado (assinatura criada fora do
    // fluxo de kit). Antes, atualizar só o link não afetava nenhuma linha e o
    // card "Assinaturas pendentes" continuava aparecendo sem como fechar.
    const { error } = await supabase
      .from('signature_requests')
      .update({ wa_tracking_stopped: true })
      .eq('id', signatureRequestId);
    if (error) throw new Error(error.message);
    // Se existir link de preenchimento vinculado, também interrompe o follow-up dele.
    await supabase
      .from('template_fill_links')
      .update({ followup_stopped: true })
      .eq('signature_request_id', signatureRequestId);
  },

  /**
   * Carrega o pacote 360 do cliente de uma vez (processos + agenda + pendências),
   * em paralelo. Banner-resumo e painéis laterais consomem este único resultado,
   * evitando os fetches duplicados de antes. Falha parcial vira vazio.
   */
  async getClientOverview(clientId: string): Promise<ClientOverview> {
    const [processes, schedule, pendings, templateFillLinks, signatures, agreements] = await Promise.all([
      processService.listProcesses({ client_id: clientId }).catch(() => [] as Process[]),
      client360Api.getClientSchedule(clientId).catch(() => ({ deadlines: [], events: [] } as ClientSchedule)),
      client360Api.getClientPendings(clientId).catch(() => ({ requirements: [], documents: [] } as ClientPendings)),
      client360Api.listClientTemplateFillLinks(clientId).catch(() => [] as ClientTemplateFillLink[]),
      signatureService.listRequestsWithSigners({ client_id: clientId }).catch(() => [] as SignatureRequestWithSigners[]),
      financialService.listAgreements({ client_id: clientId }).catch(() => [] as Agreement[]),
    ]);
    return { processes, schedule, pendings, templateFillLinks, signatures, agreements };
  },
};
