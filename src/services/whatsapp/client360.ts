// Camada 360 do cliente: busca/match, agenda, pendências e overview consolidado.
import { supabase } from '../../config/supabase';
import { normalizePhone, samePhone, openResilientChannel, attachAvatarUrls, invokeFn } from './shared';
import { chaveDeConsulta, criarCompartilhadorDeConsultas } from '../realtime/inFlight';
import { clientChangeHistoryService } from '../clientChangeHistory.service';
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
import type { WhatsAppClientLite, WhatsAppContactBookEntry, WhatsAppContactProbe } from '../../types/whatsapp.types';
import type { ClientSchedule, ScheduleDeadline, ClientPendings, ClientDocRequest, ClientOverview, ClientTemplateFillLink, ClientTrackedSignatureStatus } from './shared';

/**
 * Até quantos dias depois do vencimento um prazo pendente ainda é mostrado no
 * painel da conversa. Passou disso, é registro esquecido no cadastro — não é
 * pauta do atendimento de hoje.
 */
const STALE_DEADLINE_DAYS = 30;

/**
 * Compartilhador das consultas que várias partes da mesma tela pedem juntas.
 *
 * Os chips da lista, o cabeçalho e o painel do cliente pedem o MESMO conjunto ao
 * mesmo tempo, e o StrictMode monta cada efeito duas vezes — daí as consultas
 * idênticas de `document_requests`, `signature_requests`, `signature_signers` e
 * `template_fill_links` saindo três, quatro e cinco vezes em poucos
 * milissegundos nos logs da API. Aqui elas viram uma só.
 */
const consultasEmVoo = criarCompartilhadorDeConsultas({ marca: '[Jurius Fetch][WhatsApp]' });

/** Colunas do cadastro que o painel da conversa mostra (`WhatsAppClientLite`). */
const CLIENT_LITE_COLS =
  'id, full_name, cpf_cnpj, phone, mobile, photo_path, email, status, client_type, address_city, address_state, is_pre_cadastro';

/** Dias de atraso de um vencimento (0 quando ainda não venceu). */
function daysOverdue(due: string, startOfToday: Date): number {
  const d = new Date(due.length <= 10 ? `${due}T00:00:00` : due);
  if (Number.isNaN(d.getTime())) return 0;
  d.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((startOfToday.getTime() - d.getTime()) / 86_400_000));
}

/** Linha crua de `whatsapp_contact_probes` (ou da Edge Function de sondagem). */
interface ProbeRow {
  phone: string;
  has_whatsapp: boolean | null;
  avatar_path: string | null;
}

/**
 * Troca o caminho da foto por uma URL assinada, em lote e pelo mesmo cache das
 * conversas — quem já abriu a inbox costuma ver a agenda com rosto sem uma ida
 * a mais ao storage.
 */
async function assinarProbes(rows: ProbeRow[]): Promise<WhatsAppContactProbe[]> {
  const paraAssinar = rows.map(r => ({ contact_avatar_path: r.avatar_path, contact_avatar_url: null as string | null }));
  await attachAvatarUrls(paraAssinar);
  return rows.map((r, i) => ({
    phone: r.phone,
    hasWhatsApp: r.has_whatsapp,
    avatarUrl: paraAssinar[i].contact_avatar_url,
  }));
}

export const client360Api = {
  /** Busca manual de cliente por nome, CPF/CNPJ ou telefone. */
  async searchClients(query: string): Promise<WhatsAppClientLite[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const { data, error } = await supabase.rpc('whatsapp_search_clients', { p_query: q });
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppClientLite[];
  },

  /**
   * A agenda inteira da "Nova conversa": uma linha por NÚMERO, em ordem
   * alfabética, com a foto já assinada.
   *
   * Vem de uma vez, e não paginada, porque o painel imita a agenda do WhatsApp
   * — lista aberta desde o primeiro instante, busca peneirando o que já está na
   * mão. São poucas centenas de linhas; o dia em que forem milhares, o lugar de
   * paginar é aqui, não no componente.
   *
   * A foto é a que o WHATSAPP mandou, não a do cadastro. Ela vem do mesmo
   * bucket e passa pelo mesmo cache de URL assinada da caixa de entrada — ou
   * seja, quem já abriu a inbox vê a agenda com rosto sem uma ida a mais ao
   * storage. O retrato do cadastro (`photo_path`) fica de fora de propósito:
   * mora em outro caminho, com outro cache e uma cadeia de fallback própria
   * (`useClientPhotos`), e são pouquíssimos cadastros com retrato — não paga
   * arrastar tudo isso para dentro deste painel.
   */
  async listContactBook(): Promise<WhatsAppContactBookEntry[]> {
    const { data, error } = await supabase.rpc('whatsapp_contact_book');
    if (error) throw new Error(error.message);
    const rows = (data || []) as {
      client_id: string; full_name: string; cpf_cnpj: string | null;
      phone: string; phone_kind: 'mobile' | 'phone';
      wa_avatar_path: string | null; is_pre_cadastro: boolean | null;
    }[];

    // `attachAvatarUrls` assina em lote e é o dono do cache; emprestamos a ele
    // o formato que ele conhece em vez de abrir um segundo caminho de assinatura.
    const paraAssinar = rows.map(r => ({ contact_avatar_path: r.wa_avatar_path, contact_avatar_url: null as string | null }));
    await attachAvatarUrls(paraAssinar);

    return rows.map((r, i) => ({
      clientId: r.client_id,
      name: r.full_name,
      phone: r.phone,
      phoneKind: r.phone_kind,
      doc: r.cpf_cnpj,
      avatarUrl: paraAssinar[i].contact_avatar_url,
      isPreCadastro: r.is_pre_cadastro === true,
    }));
  },

  /**
   * O que já se sabe, sem perguntar nada à Evolution: quais números da agenda
   * têm WhatsApp e qual a foto de perfil de cada um.
   *
   * É o cache (`whatsapp_contact_probes`) sendo lido de uma vez na abertura do
   * painel. A tabela tem uma linha por número JÁ sondado — poucas centenas no
   * pior caso —, então trazê-la inteira custa menos do que montar um `in(...)`
   * com a agenda toda.
   */
  async listContactProbes(): Promise<WhatsAppContactProbe[]> {
    const { data, error } = await supabase
      .from('whatsapp_contact_probes')
      .select('phone, has_whatsapp, avatar_path');
    if (error) return [];
    return assinarProbes((data || []) as ProbeRow[]);
  },

  /**
   * Pergunta à Evolution sobre os números que ainda não estão no cache: existe
   * WhatsApp nesse número? qual a foto?
   *
   * Chamada com o que está NA TELA, em lotes pequenos — ver o cabeçalho da Edge
   * Function. Falha de rede não é erro do painel: a agenda continua servindo sem
   * rosto e sem selo, então o erro vira lista vazia.
   */
  async probeContacts(phones: string[], channelId?: string | null): Promise<WhatsAppContactProbe[]> {
    const alvos = Array.from(new Set(phones.map(normalizePhone).filter(Boolean)));
    if (alvos.length === 0) return [];
    try {
      const data = await invokeFn('whatsapp-contact-probe', {
        phones: alvos,
        channel_id: channelId || null,
      });
      return assinarProbes((data?.results || []) as ProbeRow[]);
    } catch {
      return [];
    }
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
      .select(CLIENT_LITE_COLS)
      .eq('id', clientId)
      .maybeSingle();
    return (data as WhatsAppClientLite) || null;
  },

  /**
   * Cria um contato a partir da conversa e devolve o registro.
   *
   * `preCadastro` (o padrão) grava a linha marcada como pré-cadastro: nome de
   * exibição e telefone de alguém que ligou, mas ainda não é cliente. É o que
   * permite marcar um compromisso ou um prazo ali mesmo sem inventar um cliente
   * — e o registro fica fora da lista, da busca e das estatísticas do módulo
   * Clientes até alguém promovê-lo.
   */
  async createQuickContact(params: {
    fullName: string;
    phone: string;
    preCadastro?: boolean;
  }): Promise<WhatsAppClientLite> {
    const name = params.fullName.trim();
    if (!name) throw new Error('Informe o nome do contato.');
    const norm = normalizePhone(params.phone);
    if (!norm) throw new Error('Telefone inválido.');
    const { data, error } = await supabase
      .from('clients')
      .insert({
        full_name: name,
        mobile: norm,
        client_type: 'pessoa_fisica',
        status: 'ativo',
        is_pre_cadastro: params.preCadastro !== false,
      })
      .select(CLIENT_LITE_COLS)
      .single();
    if (error) throw new Error(error.message);
    return data as WhatsAppClientLite;
  },

  /** Tira a marca de pré-cadastro: o MESMO registro passa a valer como cliente. */
  async promoteClient(clientId: string): Promise<void> {
    const { error } = await supabase
      .from('clients')
      .update({ is_pre_cadastro: false, updated_at: new Date().toISOString() })
      .eq('id', clientId);
    if (error) throw new Error(error.message);
    await clientChangeHistoryService.record(clientId, 'whatsapp', [{
      field: 'is_pre_cadastro',
      oldValue: true,
      newValue: false,
      sourceLabel: 'Pré-cadastro promovido a cliente no atendimento',
    }]);
  },

  /**
   * Tenta adicionar o telefone da conversa ao cadastro do cliente.
   * Preenche `mobile` primeiro; se cheio, usa `phone`. Ignora se o número já existe.
   * Retorna `{ added: true, field }` quando gravou ou `{ added: false }` quando pulou.
   */
  /**
   * Grava o número da conversa no cadastro do cliente.
   *
   * Campo livre é preenchido (Celular primeiro). Com os dois já preenchidos, o
   * Celular é SUBSTITUÍDO — o número do WhatsApp é, por definição, o celular em
   * uso, e é por ele que o escritório fala com a pessoa hoje. O número antigo
   * não se perde: vai para o histórico do cadastro com origem `whatsapp`, do
   * mesmo jeito que a edição manual e a mesclagem fazem.
   *
   * Devolve `replaced` com o valor sobrescrito (null quando só preencheu campo
   * vazio), para o painel poder dizer ao atendente o que mudou.
   */
  async addPhoneToClient(clientId: string, phone: string): Promise<{
    added: boolean;
    field: 'mobile' | 'phone' | null;
    replaced: string | null;
  }> {
    const norm = normalizePhone(phone);
    const unchanged = { added: false, field: null, replaced: null } as const;
    if (!norm) return unchanged;
    const { data } = await supabase
      .from('clients')
      .select('mobile, phone')
      .eq('id', clientId)
      .single();
    const cur = data as { mobile: string | null; phone: string | null } | null;
    if (!cur) return unchanged;
    // Casa pelas variantes com/sem o 9º dígito: `556592216459` no WhatsApp e
    // `65992216459` na ficha são o mesmo número, não há o que gravar.
    if (samePhone(cur.mobile, norm) || samePhone(cur.phone, norm)) return unchanged;

    const field: 'mobile' | 'phone' = !cur.mobile ? 'mobile' : !cur.phone ? 'phone' : 'mobile';
    const replaced = field === 'mobile' && cur.mobile ? cur.mobile : null;

    const { error } = await supabase.from('clients').update({ [field]: norm }).eq('id', clientId);
    if (error) throw new Error(error.message);

    // Trilha do cadastro. Nunca derruba a operação: o número já foi gravado.
    await clientChangeHistoryService.record(clientId, 'whatsapp', [{
      field,
      oldValue: cur[field],
      newValue: norm,
      sourceLabel: 'Número informado pela conversa do WhatsApp',
    }]);

    return { added: true, field, replaced };
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

    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const deadlines: ScheduleDeadline[] = [
      ...tableDeadlines.map(d => ({ id: d.id, title: d.title, due: d.due_date, kind: 'deadline' as const })),
      ...orphanCalDeadlines.map(e => ({ id: e.id, title: e.title, due: e.start_at, kind: 'event' as const })),
    ]
      // Vencido recente ainda é pendência de verdade e precisa aparecer. Vencido
      // há meses é prazo que ninguém baixou no cadastro — e, como a lista é
      // ordenada por vencimento e cortada nos 5 primeiros, esse resíduo antigo
      // empurrava os prazos REAIS para fora do painel (e virava o "próximo
      // prazo" do banner-resumo). Fora da janela, o registro segue no módulo de
      // Prazos; só deixa de poluir o atendimento.
      .filter(d => daysOverdue(d.due, startOfToday) <= STALE_DEADLINE_DAYS)
      .sort((a, b) => a.due.localeCompare(b.due));

    // Compromissos = eventos de calendário que não são prazos, daqui pra frente.
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
    return consultasEmVoo.compartilhar(
      chaveDeConsulta('document_requests.status', { clientIds }),
      () => client360Api.lerStatusDeDocumentos(clientIds),
    );
  },

  /** @internal Implementação de `getDocStatusByClients`, sem o compartilhador. */
  async lerStatusDeDocumentos(clientIds: string[]): Promise<Record<string, 'awaiting' | 'ready'>> {
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
    return consultasEmVoo.compartilhar(
      chaveDeConsulta('signatures.tracked', { clientIds }),
      () => client360Api.lerStatusDeAssinaturas(clientIds),
    );
  },

  /** @internal Implementação de `getTrackedSignatureStatusByClients`, sem o compartilhador. */
  async lerStatusDeAssinaturas(clientIds: string[]): Promise<Record<string, ClientTrackedSignatureStatus>> {
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
    return openResilientChannel({
      name: 'wa-docreqs',
      bind: ch => ch
        .on('postgres_changes', { event: '*', schema: 'public', table: 'document_requests' }, () => onChange())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'document_request_items' }, () => onChange()),
    });
  },

  /** Realtime das assinaturas para a lateral 360 da conversa refletir preenchimento/assinatura em aberto. */
  subscribeSignatures(onChange: () => void): () => void {
    return openResilientChannel({
      name: 'wa-signatures',
      bind: ch => ch
        .on('postgres_changes', { event: '*', schema: 'public', table: 'signature_requests' }, () => onChange())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'signature_signers' }, () => onChange())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'template_fill_links' }, () => onChange()),
    });
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
   * Assinaturas de um CONTATO pelo telefone do signatário — o caminho para
   * acompanhar quem ainda não virou cadastro. A solicitação de assinatura pode
   * nascer sem `client_id` (documento avulso enviado para alguém que só existe
   * como contato do WhatsApp); antes disto, essa assinatura simplesmente não
   * aparecia na conversa e não havia como acompanhar se a pessoa abriu/assinou.
   *
   * A busca é grossa no banco (últimos 4 dígitos, que sobrevivem a qualquer
   * formatação de telefone) e fina no cliente, com `samePhone` — que já trata o
   * 9º dígito de celular.
   */
  async listSignaturesByContactPhone(phone: string): Promise<SignatureRequestWithSigners[]> {
    const digits = normalizePhone(phone);
    if (!digits) return [];
    const tail = digits.slice(-4);
    const { data, error } = await supabase
      .from('signature_signers')
      .select('signature_request_id, phone')
      .not('phone', 'is', null)
      .ilike('phone', `%${tail}%`)
      .limit(400);
    if (error) throw new Error(error.message);

    const ids = Array.from(new Set(
      ((data || []) as { signature_request_id: string; phone: string | null }[])
        .filter(row => samePhone(row.phone, phone))
        .map(row => row.signature_request_id),
    ));
    if (ids.length === 0) return [];
    return signatureService.listRequestsWithSigners({ ids });
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
