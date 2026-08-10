// Núcleo compartilhado do serviço WhatsApp: constantes de tabela/bucket,
// helpers puros (telefone, template, permissões) e os tipos de domínio
// consumidos pelas camadas conversations/messages/admin/client360/automation.
import { supabase } from '../../config/supabase';
import { realtimeRetryDelay, resolveChannelStatus } from './realtimeBackoff';
import type { CalendarEvent } from '../../types/calendar.types';
import type { Requirement } from '../../types/requirement.types';
import type { Process } from '../../types/process.types';
import type { WhatsAppConversation, WhatsAppMessage } from '../../types/whatsapp.types';
import type { SignatureRequestWithSigners } from '../../types/signature.types';
import type { Agreement } from '../../types/financial.types';

export type RealtimeChannel = ReturnType<typeof supabase.channel>;

/**
 * Abre um canal realtime que se reergue sozinho e devolve como desligá-lo.
 *
 * Um websocket cai — rede oscilando, notebook suspenso, proxy reciclando
 * conexão — e um canal caído do Supabase nunca volta por conta própria. Isso já
 * era tratado no canal da inbox, mas os canais do notificador global assinavam
 * "cru": se o socket deles morresse, morriam calados, e quem estava FORA do
 * módulo simplesmente parava de ser avisado de mensagem nova pelo resto da
 * sessão — sem som, sem aviso, sem nada na tela dizendo que o aviso acabou.
 * Justamente o caso em que o aviso é a única coisa que existe. Agora a política
 * é uma só, e vale para todos os canais.
 *
 * A numeração de gerações resolve a armadilha descrita em `resolveChannelStatus`:
 * `removeChannel` faz o canal removido reportar CLOSED, indistinguível de uma
 * queda real — e como quem remove é a própria reconexão, cada tentativa
 * provocava a seguinte, num laço que nunca assentava.
 */
export function openResilientChannel(opts: {
  /** Prefixo do nome do canal (a geração e o instante são acrescentados). */
  name: string;
  /** Registra os `.on(...)` do canal. Chamado a cada (re)abertura. */
  bind: (channel: RealtimeChannel) => RealtimeChannel;
  onStatusChange?: (status: 'live' | 'down') => void;
}): () => void {
  let channel: RealtimeChannel | null = null;
  let attempt = 0;
  let timer: number | null = null;
  let disposed = false;
  let generation = 0;

  /** Aposenta e remove o canal atual. O que ele disser depois não conta. */
  const discardCurrent = () => {
    if (!channel) return;
    generation += 1;
    supabase.removeChannel(channel);
    channel = null;
  };

  const reopenLater = () => {
    if (disposed || timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      if (disposed) return;
      // Descarta o canal morto antes de abrir outro: um canal em erro nunca
      // volta sozinho, e mantê-lo só acumula socket parado.
      discardCurrent();
      open();
    }, realtimeRetryDelay(attempt++));
  };

  const open = () => {
    if (disposed) return;
    const mine = generation;
    // Nome único por tentativa: reutilizar o mesmo nome enquanto o canal
    // anterior ainda está fechando faz o servidor recusar a nova inscrição.
    channel = opts.bind(supabase.channel(`${opts.name}-${mine}-${Date.now()}`))
      .subscribe(status => {
        const action = resolveChannelStatus(status, {
          fromGeneration: mine, currentGeneration: generation, disposed,
        });
        if (action === 'live') { attempt = 0; opts.onStatusChange?.('live'); return; }
        if (action === 'down-and-retry') { opts.onStatusChange?.('down'); reopenLater(); }
      });
  };

  open();
  return () => {
    disposed = true;
    if (timer !== null) window.clearTimeout(timer);
    discardCurrent();
  };
}

// ── Tabelas / storage ────────────────────────────────────────
export const CONV_TABLE = 'whatsapp_conversations';
export const MSG_TABLE = 'whatsapp_messages';
export const CHANNEL_TABLE = 'whatsapp_instances';
export const CHANNEL_MEMBER_TABLE = 'whatsapp_channel_members';
export const CHANNEL_FUNNEL_STAGE_TABLE = 'whatsapp_channel_funnel_stages';
export const DEPT_TABLE = 'whatsapp_departments';
export const DEPT_MEMBER_TABLE = 'whatsapp_department_members';
export const TRANSFER_TABLE = 'whatsapp_transfers';
export const NOTES_TABLE = 'whatsapp_internal_notes';
export const TEMPLATES_TABLE = 'whatsapp_templates';
export const SCHEDULED_TABLE = 'whatsapp_scheduled_messages';

export const MEDIA_BUCKET = 'whatsapp-media';
export const SIGNED_URL_TTL = 60 * 60; // 1h

// ── Permissões / templates ───────────────────────────────────
/** Permissões operacionais por papel (Fase 9). Texto livre em profiles.role. */
export interface AgentPermissions {
  canTransfer: boolean;
  canClose: boolean;
  canBlock: boolean;
  canSchedule: boolean;
  canManageTemplates: boolean;
}
export function agentPermissions(role?: string | null): AgentPermissions {
  const r = (role || '').trim().toLowerCase();
  const isAdmin = r === 'administrador';
  const isLawyer = r === 'advogado';
  return {
    canTransfer: true,                  // todos encaminham
    canClose: true,                     // todos encerram o próprio atendimento
    canBlock: isAdmin || isLawyer,      // bloqueio é decisão de advogado/gestão
    canSchedule: true,                  // todos agendam follow-up
    canManageTemplates: isAdmin,        // modelos são governados pela gestão
  };
}

/** Contexto para expandir variáveis de template/macro (Fase 8). */
export interface TemplateContext {
  clientName?: string | null;
  clientPhone?: string | null;
  agentName?: string | null;
  processNumber?: string | null;
  greeting?: string | null;
  extraVars?: Record<string, string | null | undefined>;
}

/**
 * Expande as variáveis de um template. Sintaxe `{{chave}}` — chaves vazias
 * viram string vazia para não vazar `{{...}}` ao cliente.
 */
export function renderTemplate(body: string, ctx: TemplateContext): string {
  const map: Record<string, string> = {
    'cliente.nome': ctx.clientName || '',
    'cliente.primeiro_nome': (ctx.clientName || '').trim().split(/\s+/).filter(Boolean)[0] || '',
    'cliente.primeiro_nome_com_virgula': (() => {
      const first = (ctx.clientName || '').trim().split(/\s+/).filter(Boolean)[0] || '';
      return first ? `, ${first}` : '';
    })(),
    'cliente.telefone': ctx.clientPhone || '',
    'agente.nome': ctx.agentName || '',
    'agente.primeiro_nome': (ctx.agentName || '').trim().split(/\s+/).filter(Boolean)[0] || '',
    'processo.numero': ctx.processNumber || '',
    'saudacao': ctx.greeting || '',
  };
  Object.entries(ctx.extraVars || {}).forEach(([key, value]) => {
    map[key] = value || '';
  });
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (k in map ? map[k] : ''));
}

export interface StaffOption {
  user_id: string;
  name: string;
  gender?: string | null;   // '' | 'male' | 'female' — para tratamento Dr./Dra.
  role?: string | null;     // cargo (ex: "Advogado")
  oab?: string | null;      // OAB preenchida reforça que é advogado
  // Identidade de atendimento escolhida pelo próprio agente (whatsapp_agent_settings).
  // Quando preenchida, manda no que a equipe vê na assinatura da mensagem.
  short_name?: string | null;
  role_label?: string | null;
  treatment?: AgentTreatment;
}

/**
 * Tratamento na assinatura da mensagem. `null`/'' mantém a regra automática
 * (Dr./Dra. para advogado, conforme o gênero do perfil); 'none' desliga o
 * tratamento; 'dr'/'dra' força — quem não é advogado no cadastro mas assina
 * como tal, e vice-versa.
 */
export type AgentTreatment = '' | 'none' | 'dr' | 'dra' | null;

/** Preferências de atendimento do agente (saudação inicial, nome curto, cargo). */
export interface AgentPrefs {
  auto_greeting: boolean;
  short_name: string | null;
  role_label: string | null;
  treatment: AgentTreatment;
}

/** Um prazo normalizado (vem da tabela deadlines OU de evento de calendário). */
// `kind` discrimina a origem: 'deadline' = linha em deadlines (editável via
// deadline_edit); 'event' = compromisso de agenda do tipo prazo (editável via
// calendar_edit). O id muda de tabela conforme o kind.
export interface ScheduleDeadline { id: string; title: string; due: string; kind: 'deadline' | 'event' }

/** Agenda enxuta do cliente para o painel da conversa (Seção 10). */
export interface ClientSchedule {
  deadlines: ScheduleDeadline[]; // prazos abertos, por vencimento asc
  events: CalendarEvent[];        // compromissos futuros (não-prazo), por start_at asc
}

/** Item individual de uma solicitação de documento (para o checklist na conversa). */
export interface ClientDocRequestItem { id: string; label: string; required: boolean; status: string }

/** Uma solicitação de documento ao cliente (resumo + itens para checklist). */
export interface ClientDocRequest { id: string; title: string; due_date: string | null; status: string; items: ClientDocRequestItem[] }

export interface ClientTemplateFillLink {
  id: string;
  public_token: string;
  template_id: string;
  template_name: string;
  status: 'pending' | 'submitted' | 'cancelled' | 'expired';
  followup_stopped: boolean;
  created_at: string;
  opened_at: string | null;
  last_seen_at: string | null;
  submitted_at: string | null;
  signature_request_id: string | null;
}

export interface ClientTrackedSignatureStatus {
  client_id: string;
  link_id: string;
  signature_request_id: string | null;
  kind: 'fill_sent' | 'fill_opened' | 'fill_live' | 'signature_pending' | 'signature_viewed' | 'signature_live' | 'signature_signed' | 'signature_refused';
  label: string;
  cls: string;
  /** Presença ativa AGORA na página pública (heartbeat recente). Prevalece sobre "Aguardando você". */
  live: boolean;
  /** Estado terminal (assinado/recusado): mostra badge até a equipe fechar o acompanhamento. */
  terminal?: boolean;
}

/** Pendências do cliente para o painel da conversa (Seção 11). */
export interface ClientPendings {
  requirements: Requirement[];      // requerimentos em andamento (não terminais)
  documents: ClientDocRequest[];    // solicitações de documento abertas (aguardando)
}

/**
 * Pacote 360 do cliente carregado de uma vez ao abrir a conversa (Fase 10).
 * Compartilhado pelo banner-resumo e pelos painéis laterais — elimina os
 * fetches duplicados que cada bloco fazia (anti-N+1 / menos roundtrips).
 */
export interface ClientOverview {
  processes: Process[];
  schedule: ClientSchedule;
  pendings: ClientPendings;
  templateFillLinks: ClientTemplateFillLink[];
  /** Assinaturas do cliente (Fase G) — pendentes e ativas. */
  signatures: SignatureRequestWithSigners[];
  /** Acordos/contratos financeiros do cliente (Fase G). */
  agreements: Agreement[];
}

/** Resumo rápido do cliente/processo derivado do overview (Fase 6). */
export interface ClientQuickSummary {
  processCount: number;
  urgentCount: number;
  nextDeadline: ScheduleDeadline | null;
  nextEvent: { title: string; start_at: string } | null;
  pendingCount: number;
  pendingSignatures: number;
}

/** Resumo enxuto a partir do pacote 360 (sem novas chamadas). */
export function summarizeOverview(o: ClientOverview): ClientQuickSummary {
  return {
    processCount: o.processes.length,
    urgentCount: o.processes.filter(p => p.priority === 'urgente').length,
    nextDeadline: o.schedule.deadlines[0] || null,
    nextEvent: o.schedule.events[0] ? { title: o.schedule.events[0].title, start_at: o.schedule.events[0].start_at } : null,
    pendingCount: o.pendings.requirements.length + o.pendings.documents.length,
    pendingSignatures: o.signatures.filter(s => s.status === 'pending').length + o.templateFillLinks.filter(l => l.status === 'pending').length,
  };
}

/** Nota interna da conversa — só a equipe vê (Fase 7). */
export interface WhatsAppInternalNote {
  id: string;
  conversation_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

// ── Telefone ─────────────────────────────────────────────────
/**
 * Normaliza um telefone para o formato E.164 brasileiro só com dígitos
 * (55 + DDD + número). Aceita entradas com máscara, com ou sem +55. Devolve
 * '' quando não há dígitos suficientes para um número válido.
 */
export function normalizePhone(input: string): string {
  let d = (input || '').replace(/\D/g, '');
  if (!d) return '';
  // 10 (fixo) ou 11 (móvel) dígitos sem código do país → assume Brasil.
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  // Já veio com 55 e tamanho plausível.
  if (d.length < 12 || d.length > 13) return '';
  return d;
}

/**
 * Variantes do mesmo número brasileiro com e sem o 9º dígito de celular. O
 * WhatsApp ora usa o número antigo (8 dígitos), ora o novo (9 dígitos), e
 * contatos via `@lid` chegam só com o telefone — sem isso a mesma pessoa abriria
 * conversas duplicadas. Devolve as formas distintas para casar a thread certa.
 */
export function phoneVariants(input: string): string[] {
  const d = normalizePhone(input);
  if (!d) return [];
  const out = new Set<string>([d]);
  const m = d.match(/^55(\d{2})(\d+)$/);
  if (m) {
    const [, ddd, rest] = m;
    if (rest.length === 9 && rest[0] === '9') out.add(`55${ddd}${rest.slice(1)}`); // remove o 9
    else if (rest.length === 8) out.add(`55${ddd}9${rest}`);                       // adiciona o 9
  }
  return Array.from(out);
}

/**
 * Dois telefones são da mesma pessoa? Compara pelas variantes com e sem o 9º
 * dígito, do mesmo jeito que a RPC `whatsapp_match_client_by_phone` faz ao
 * procurar o cliente.
 *
 * Comparar só por `normalizePhone` (igualdade literal) tratava `5565992216459`
 * e `556592216459` como números diferentes: o painel de vínculo então oferecia
 * "adicionar ao cadastro" um número que já estava lá, só na outra forma.
 */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const va = phoneVariants(a);
  if (va.length === 0) return false;
  const vb = new Set(phoneVariants(b));
  return va.some(v => vb.has(v));
}

export function extOf(name: string, mime: string): string {
  const fromName = name.includes('.') ? name.split('.').pop()! : '';
  if (fromName) return fromName.toLowerCase().slice(0, 8);
  const sub = (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
  return sub.slice(0, 8) || 'bin';
}

// ── Edge / storage helpers ───────────────────────────────────
/**
 * Invoca uma edge function e extrai a mensagem de erro REAL do corpo da resposta.
 * O supabase-js, em respostas não-2xx, joga só "Edge Function returned a non-2xx
 * status code" em error.message e guarda o body em error.context (Response).
 */
export async function invokeFn<T = any>(name: string, body: Record<string, any>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message || 'Falha na função.';
    let parsed: any = null;
    const ctx = (error as any).context;
    if (ctx && typeof ctx.json === 'function') {
      try { parsed = await ctx.json(); if (parsed?.error) msg = parsed.error; } catch { /* */ }
    }
    // Preserva o corpo estruturado da resposta no erro para detecção robusta
    // (ex.: reconnect_pending → fila automática), sem depender de casar texto.
    const e = new Error(msg) as Error & { body?: any; reconnectPending?: boolean };
    e.body = parsed;
    if (parsed?.reconnect_pending === true) e.reconnectPending = true;
    throw e;
  }
  if (data?.error) {
    const e = new Error(data.error) as Error & { body?: any; reconnectPending?: boolean };
    e.body = data;
    if (data?.reconnect_pending === true) e.reconnectPending = true;
    throw e;
  }
  return data as T;
}

/** Resolve URLs assinadas (em lote) para as fotos de perfil dos contatos. */
// ── Cache de URLs assinadas ──────────────────────────────────
// O Storage devolve um token NOVO a cada createSignedUrls, mesmo para o mesmo
// path — então reassinar em todo reload trocava o `src` de avatares/mídia e
// fazia o navegador re-baixar tudo (flicker). Aqui guardamos a URL por path e
// só reassinamos perto de expirar; assim a mesma imagem mantém a mesma URL
// entre reloads e o React não vê mudança.
const SIGNED_URL_CACHE = new Map<string, { url: string; expiresAt: number }>();
// Reassina com folga antes do TTL real (1h) — evita servir URL prestes a expirar.
const SIGNED_URL_REFRESH_MS = (SIGNED_URL_TTL - 5 * 60) * 1000; // ~55min

/**
 * Resolve URLs assinadas em lote reaproveitando o cache: só assina os paths que
 * ainda não temos (ou que estão perto de expirar). Devolve um mapa path→url.
 */
async function resolveSignedUrls(paths: string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const result = new Map<string, string>();
  const stale: string[] = [];
  for (const p of paths) {
    const hit = SIGNED_URL_CACHE.get(p);
    if (hit && hit.expiresAt > now) result.set(p, hit.url);
    else if (!stale.includes(p)) stale.push(p);
  }
  if (stale.length > 0) {
    const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(stale, SIGNED_URL_TTL);
    for (const d of data || []) {
      if (!d.path || !d.signedUrl) continue;
      SIGNED_URL_CACHE.set(d.path, { url: d.signedUrl, expiresAt: now + SIGNED_URL_REFRESH_MS });
      result.set(d.path, d.signedUrl);
    }
  }
  return result;
}

/**
 * Assina UM caminho de avatar (o notificador conhece uma conversa por vez).
 * Passa pelo mesmo cache das listas, então o cartão do aviso reaproveita a URL
 * que a caixa de entrada já assinou — sem ida extra ao storage no caminho
 * crítico do aviso.
 */
export async function resolveAvatarUrl(path: string | null | undefined): Promise<string | null> {
  return resolveOneSignedUrl(path);
}

/**
 * Assina UM caminho qualquer do bucket de mídia — a mesma coisa que
 * `resolveAvatarUrl` faz, com o nome que descreve o uso quando o arquivo não é
 * um avatar (a miniatura da foto no aviso de mensagem nova, por exemplo).
 */
export async function resolveMediaUrl(path: string | null | undefined): Promise<string | null> {
  return resolveOneSignedUrl(path);
}

async function resolveOneSignedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const byPath = await resolveSignedUrls([path]);
  return byPath.get(path) ?? null;
}

/**
 * Assina as fotos de contato em lote. Aceita qualquer linha que carregue o par
 * `contact_avatar_path`/`contact_avatar_url` — conversas da inbox e também a
 * lista de agendadas, que mostra a mesma foto fora da conversa.
 */
export async function attachAvatarUrls(
  convs: { contact_avatar_path?: string | null; contact_avatar_url?: string | null }[],
): Promise<void> {
  const paths = convs.map(c => c.contact_avatar_path).filter((p): p is string => !!p);
  if (paths.length === 0) return;
  const byPath = await resolveSignedUrls(paths);
  for (const c of convs) {
    if (c.contact_avatar_path) c.contact_avatar_url = byPath.get(c.contact_avatar_path) || null;
  }
}

/**
 * Preenche `client_name` com o nome do cadastro vinculado (uma consulta em lote
 * para toda a lista). A conversa guarda só `client_id`; sem isto a lista e o
 * cabeçalho continuariam mostrando o nome do WhatsApp mesmo com cliente
 * vinculado — e o nome do WhatsApp é o apelido que o próprio contato escolheu.
 */
export async function attachClientNames(convs: WhatsAppConversation[]): Promise<void> {
  const ids = Array.from(new Set(convs.map(c => c.client_id).filter((id): id is string => !!id)));
  if (ids.length === 0) return;
  const { data } = await supabase.from('clients').select('id, full_name').in('id', ids);
  const byId = new Map<string, string>();
  for (const row of (data || []) as { id: string; full_name: string | null }[]) {
    if (row.full_name) byId.set(row.id, row.full_name);
  }
  for (const c of convs) {
    c.client_name = c.client_id ? byId.get(c.client_id) ?? null : null;
  }
}

/** Resolve URLs assinadas (em lote, com cache) para mensagens com mídia no storage. */
export async function attachSignedUrls(msgs: WhatsAppMessage[]): Promise<void> {
  // Mensagem apagada não recebe URL: a bolha dela é um aviso de texto, e assinar
  // a mídia seria pagar uma ida à rede para produzir um link que ninguém abre —
  // além de deixar o arquivo alcançável por quem inspecionasse a resposta.
  const paths = msgs.filter(m => !m.deleted_at).map(m => m.storage_path).filter((p): p is string => !!p);
  if (paths.length === 0) return;
  const byPath = await resolveSignedUrls(paths);
  for (const m of msgs) {
    if (m.storage_path && !m.deleted_at) m.media_url = byPath.get(m.storage_path) || null;
  }
}
