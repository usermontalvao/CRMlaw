// Núcleo compartilhado do serviço WhatsApp: constantes de tabela/bucket,
// helpers puros (telefone, template, permissões) e os tipos de domínio
// consumidos pelas camadas conversations/messages/admin/client360/automation.
import { supabase } from '../../config/supabase';
import type { CalendarEvent } from '../../types/calendar.types';
import type { Requirement } from '../../types/requirement.types';
import type { Process } from '../../types/process.types';
import type { WhatsAppConversation, WhatsAppMessage } from '../../types/whatsapp.types';
import type { SignatureRequestWithSigners } from '../../types/signature.types';
import type { Agreement } from '../../types/financial.types';

// ── Tabelas / storage ────────────────────────────────────────
export const CONV_TABLE = 'whatsapp_conversations';
export const MSG_TABLE = 'whatsapp_messages';
export const CHANNEL_TABLE = 'whatsapp_instances';
export const DEPT_TABLE = 'whatsapp_departments';
export const DEPT_MEMBER_TABLE = 'whatsapp_department_members';
export const CHANNEL_MEMBER_TABLE = 'whatsapp_channel_members';
export const TRANSFER_TABLE = 'whatsapp_transfers';
export const NOTES_TABLE = 'whatsapp_internal_notes';
export const TEMPLATES_TABLE = 'whatsapp_templates';
export const SCHEDULED_TABLE = 'whatsapp_scheduled_messages';
export const WF_AGENTS_TABLE = 'whatsapp_workflow_agents';
export const WF_TABLE = 'whatsapp_workflows';
export const WF_STEPS_TABLE = 'whatsapp_workflow_steps';
export const WF_RULES_TABLE = 'whatsapp_workflow_rules';
export const WF_CHANNELS_TABLE = 'whatsapp_channel_workflows';
export const WF_STATE_TABLE = 'whatsapp_conversation_workflow_state';
export const WF_TRANSITIONS_TABLE = 'whatsapp_workflow_transition_log';
export const FOLLOWUP_POLICIES_TABLE = 'whatsapp_followup_policies';
export const FOLLOWUP_POLICY_STEPS_TABLE = 'whatsapp_followup_policy_steps';

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
}

/**
 * Expande as variáveis de um template. Sintaxe `{{chave}}` — chaves vazias
 * viram string vazia para não vazar `{{...}}` ao cliente.
 */
export function renderTemplate(body: string, ctx: TemplateContext): string {
  const map: Record<string, string> = {
    'cliente.nome': ctx.clientName || '',
    'cliente.telefone': ctx.clientPhone || '',
    'agente.nome': ctx.agentName || '',
    'processo.numero': ctx.processNumber || '',
    'saudacao': ctx.greeting || '',
  };
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (k in map ? map[k] : ''));
}

export interface StaffOption {
  user_id: string;
  name: string;
  gender?: string | null;   // '' | 'male' | 'female' — para tratamento Dr./Dra.
  role?: string | null;     // cargo (ex: "Advogado")
  oab?: string | null;      // OAB preenchida reforça que é advogado
}

/** Preferências de atendimento do agente (saudação inicial, nome curto, cargo). */
export interface AgentPrefs {
  auto_greeting: boolean;
  short_name: string | null;
  role_label: string | null;
}

/** Um prazo normalizado (vem da tabela deadlines OU de evento de calendário). */
export interface ScheduleDeadline { id: string; title: string; due: string }

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
    const ctx = (error as any).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); if (j?.error) msg = j.error; } catch { /* */ }
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
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

export async function attachAvatarUrls(convs: WhatsAppConversation[]): Promise<void> {
  const paths = convs.map(c => c.contact_avatar_path).filter((p): p is string => !!p);
  if (paths.length === 0) return;
  const byPath = await resolveSignedUrls(paths);
  for (const c of convs) {
    if (c.contact_avatar_path) c.contact_avatar_url = byPath.get(c.contact_avatar_path) || null;
  }
}

/** Resolve URLs assinadas (em lote, com cache) para mensagens com mídia no storage. */
export async function attachSignedUrls(msgs: WhatsAppMessage[]): Promise<void> {
  const paths = msgs.map(m => m.storage_path).filter((p): p is string => !!p);
  if (paths.length === 0) return;
  const byPath = await resolveSignedUrls(paths);
  for (const m of msgs) {
    if (m.storage_path) m.media_url = byPath.get(m.storage_path) || null;
  }
}
