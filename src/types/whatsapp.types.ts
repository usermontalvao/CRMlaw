export type WhatsAppDirection = 'in' | 'out';
export type WhatsAppMsgType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker';
export type WhatsAppMsgStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type WhatsAppTranscriptionStatus = 'pending' | 'done' | 'failed' | 'unsupported' | null;
/** Estados puramente de UI (mensagens otimistas, ainda não confirmadas). */
export type WhatsAppLocalState = 'uploading' | 'sending' | 'transcribing' | 'failed' | null;
export type WhatsAppConvStatus = 'open' | 'pending' | 'closed';
export type WhatsAppInstanceStatus = 'disconnected' | 'connecting' | 'connected';
/**
 * Presença do contato vinda do WhatsApp (Baileys/Evolution). Oportunista: só
 * existe quando o servidor emite presence.update. `null` = sem sinal recente.
 */
export type WhatsAppPresence = 'available' | 'unavailable' | 'composing' | 'recording' | 'paused' | null;

export interface WhatsAppConversation {
  id: string;
  instance_id: string | null;
  remote_jid: string;
  contact_phone: string;
  contact_name: string | null;
  contact_avatar_path: string | null;   // caminho no bucket (persistido)
  contact_avatar_url: string | null;     // URL assinada resolvida no client (efêmera)
  client_id: string | null;
  assigned_user_id: string | null;
  department_id: string | null;
  status: WhatsAppConvStatus;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: WhatsAppDirection | null;
  presence: WhatsAppPresence;            // último sinal de presença (oportunista)
  presence_updated_at: string | null;    // quando esse sinal chegou
  last_seen_at: string | null;           // "visto por último" quando o WhatsApp fornecer
  is_blocked: boolean;                    // contato bloqueado — fora da fila normal
  blocked_at: string | null;
  blocked_by: string | null;
  blocked_reason: string | null;
  // Ciclo de vida (Fase 3) + SLA (Fase 4)
  closed_at: string | null;
  closed_by: string | null;
  closure_reason: string | null;
  reopened_at: string | null;
  first_response_at: string | null;
  last_customer_message_at: string | null;
  last_agent_message_at: string | null;
  // Aceite de transferência (Fase 4): conversa transferida aguardando o destino aceitar.
  awaiting_accept: boolean;
  transfer_pending_since: string | null;
  contact_reason: string | null;   // assunto/motivo do contato (Fase F)
  labels: string[];                 // etiquetas/tags (Fase M)
  // Fase L: guarda jurídica — impede purga pela retenção
  legal_hold: boolean;
  legal_hold_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppMessage {
  id: string;
  conversation_id: string;
  evolution_message_id: string | null;
  direction: WhatsAppDirection;
  type: WhatsAppMsgType;
  content: string | null;
  media_url: string | null;          // URL assinada resolvida no client (efêmera)
  media_mime: string | null;
  storage_path: string | null;
  media_size: number | null;
  media_sha256: string | null;
  file_name: string | null;
  transcription_text: string | null;
  transcription_status: WhatsAppTranscriptionStatus;
  reply_to_id: string | null;
  edited_at: string | null;
  status: WhatsAppMsgStatus;
  sender_user_id: string | null;
  wa_timestamp: string;
  created_at: string;
  /** Apenas UI — não vem do banco. */
  _local?: WhatsAppLocalState;
  _tempId?: string;
  _serverId?: string;
}

export interface SendMediaInput {
  conversationId?: string;
  phone?: string;
  channelId?: string;
  type: 'image' | 'audio' | 'video' | 'document';
  text?: string;            // legenda
  storagePath: string;
  mimeType: string;
  fileName?: string;
  replyToId?: string;
}

export interface UploadedMedia {
  storagePath: string;
  mimeType: string;
  fileName: string;
  size: number;
}

/** Versão enxuta do cliente para vínculo/painel da conversa. */
export interface WhatsAppClientLite {
  id: string;
  full_name: string;
  cpf_cnpj: string | null;
  phone: string | null;
  mobile: string | null;
  photo_path: string | null;
  // Campos expandidos para o painel de informações do cliente (Fase P)
  email: string | null;
  status: string | null;
  client_type: string | null;
  address_city: string | null;
  address_state: string | null;
}

/** Canal = uma conexão/número na Evolution (whatsapp_instances). */
export interface WhatsAppChannel {
  id: string;
  instance_name: string;
  name: string | null;
  color: string | null;
  phone_number: string | null;
  status: WhatsAppInstanceStatus;
  last_qr: string | null;
  profile_pic_url: string | null;
  webhook_token: string | null;
  is_active: boolean;
  connected_at: string | null;
  absence_message: string | null;    // Fase N
  absence_enabled: boolean;          // Fase N
  timezone: string;                  // Fase N — IANA timezone para regra de horário comercial
}

/** Linha de horário de atendimento (Fase N). */
export interface WhatsAppBusinessHoursRow {
  id: string;
  instance_id: string;
  day_of_week: number;   // 0=Dom … 6=Sab
  start_time: string;    // "HH:MM"
  end_time: string;      // "HH:MM"
  is_active: boolean;
}

/** Compat: alias antigo. */
export type WhatsAppInstance = WhatsAppChannel;

/** Departamento/setor de atendimento. */
export interface WhatsAppDepartment {
  id: string;
  name: string;
  color: string | null;
  is_active: boolean;
}

/** Template/macro de mensagem (Fase 8). */
export type WhatsAppTemplateScope = 'global' | 'channel' | 'department';
export interface WhatsAppTemplate {
  id: string;
  name: string;
  category: string | null;
  scope: WhatsAppTemplateScope;
  channel_id: string | null;
  department_id: string | null;
  body: string;
  is_active: boolean;
}

/** Mensagem agendada (Fase 8.1). */
export type WhatsAppScheduledStatus = 'pending' | 'sent' | 'canceled' | 'failed';
export interface WhatsAppScheduledMessage {
  id: string;
  conversation_id: string;
  channel_id: string | null;
  type: 'text' | 'image' | 'audio' | 'video' | 'document';
  body: string | null;
  storage_path: string | null;
  mime_type: string | null;
  file_name: string | null;
  scheduled_at: string;
  status: WhatsAppScheduledStatus;
  error: string | null;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
}

/** Evento unificado da timeline da conversa (Fase 7). */
export type TimelineKind = 'transfer' | 'note' | 'closed' | 'reopened' | 'blocked' | 'process';
export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string | null;
  actorId: string | null;
}

// ── Fase J: Atendimento assistido por IA ────────────────────────────────────

/** Configuração de IA por canal (whatsapp_ai_channel_config). */
export interface WhatsAppAiChannelConfig {
  channel_id: string;
  ai_enabled: boolean;
  max_ai_turns: number;
  playbook_id: string | null;
  require_human_approval: boolean; // Fase O
}

/** Pergunta individual de um playbook de IA. */
export interface AiPlaybookQuestion {
  key: string;
  label: string;
  required: boolean;
  type: 'text' | 'phone' | 'date' | 'choice';
  choices?: string[];
}

/** Roteiro/playbook de atendimento assistido por IA (whatsapp_ai_playbooks). */
export interface WhatsAppAiPlaybook {
  id: string;
  name: string;
  description: string | null;
  category: string;
  welcome_message: string;
  questions: AiPlaybookQuestion[];
  handoff_message: string;
  system_prompt: string | null;
  is_active: boolean;
  created_at: string;
}

export type WhatsAppAiSessionStatus = 'active' | 'completed' | 'handed_off' | 'aborted' | 'pending_approval';

/** Sessão de IA ativa para uma conversa (whatsapp_ai_sessions). */
export interface WhatsAppAiSession {
  id: string;
  conversation_id: string;
  playbook_id: string | null;
  status: WhatsAppAiSessionStatus;
  current_step: number;
  collected_data: Record<string, string>;
  turn_count: number;
  started_at: string;
  ended_at: string | null;
  handoff_summary: string | null;
  // Fase O: aprovação humana
  pending_ai_reply: string | null;
  pending_ai_next_step: number | null;
}

export interface WhatsAppTransfer {
  id: string;
  conversation_id: string;
  from_user_id: string | null;
  to_user_id: string | null;
  from_department_id: string | null;
  to_department_id: string | null;
  note: string | null;
  performed_by: string | null;
  created_at: string;
}
