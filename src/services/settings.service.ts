/**
 * Serviço de Configurações do Sistema
 * Gerencia todas as configurações, permissões e auditoria
 */

import { supabase } from '../config/supabase';

// Tipos
export interface OfficeIdentity {
  name: string;
  email: string;
  phone: string;
  address: string;
  address_cep: string;
  address_street: string;
  address_number: string;
  address_neighborhood: string;
  address_city: string;
  address_state: string;
  cnpj: string;
  oab_state: string;
  oab_number: string;
  logo_url: string;
}

export interface DjenConfig {
  auto_sync: boolean;
  sync_interval_hours: number;
  default_tribunal: string;
  search_days_back: number;
  api_timeout_seconds: number;
  max_retries: number;
  lawyers_to_monitor: string[];
}

export interface NotificationConfig {
  email_enabled: boolean;
  push_enabled: boolean;
  whatsapp_enabled: boolean;
  deadline_reminder_days: number[];
  new_intimation_alert: boolean;
  daily_digest: boolean;
  digest_time: string;
  // Resumo semanal automático
  weekly_digest: boolean;
  weekly_digest_day: number;          // 0 = Dom, 1 = Seg, ... 6 = Sáb
  weekly_digest_hour: string;         // "08:00"
  weekly_digest_resend_key: string;   // Resend API key
}

export interface Preferences {
  timezone: string;
  date_format: string;
  currency: string;
  default_deadline_days: number;
  business_hours_start: string;
  business_hours_end: string;
  work_days: number[];
}

export interface SecurityConfig {
  session_timeout_hours: number;
  require_2fa: boolean;
  password_min_length: number;
  max_login_attempts: number;
  audit_log_enabled: boolean;
  pin_session_minutes: number;    // TTL da sessão PIN para ações sensíveis (padrão: 5 min)
  financial_view_hours: number;   // TTL da sessão para revelar dados financeiros (padrão: 2 h)
}

export interface ModulesConfig {
  leads_enabled: boolean;
  financial_enabled: boolean;
  requirements_enabled: boolean;
  documents_enabled: boolean;
  calendar_enabled: boolean;
  tasks_enabled: boolean;
  /**
   * Módulos ocultados do menu lateral pelo administrador, independente da
   * permissão de função. Lista de chaves de ModuleName (ex.: 'feed').
   */
  hidden_menu_modules?: string[];
}

export interface PortalModulesConfig {
  processos:    boolean;
  documentos:   boolean;
  assinar:      boolean;
  financeiro:   boolean;
  agenda:       boolean;
  mensagens:    boolean;
  notificacoes: boolean;
  perfil:       boolean;
}

export const PORTAL_MODULES_DEFAULT: PortalModulesConfig = {
  processos:    true,
  documentos:   true,
  assinar:      true,
  financeiro:   true,
  agenda:       true,
  mensagens:    true,
  notificacoes: true,
  perfil:       true,
};

export interface DatajudKeyConfig {
  key: string;           // chave pública CNJ (ex: cDZHYzl...)
  invalid: boolean;      // true quando a última chamada retornou 401/403
  invalid_since: string | null; // ISO datetime da primeira falha
}

export interface SystemSetting {
  id: string;
  key: string;
  value: any;
  description: string | null;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface RolePermission {
  id: string;
  role: string;
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_value: any;
  new_value: any;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface FinancialModuleConfig {
  default_fee_percentage: number;
  default_installments_count: number;
  default_payment_type: 'upfront' | 'installments';
  payment_methods: string[];
  overdue_check_days: number;
}

export const FINANCIAL_MODULE_DEFAULTS: FinancialModuleConfig = {
  default_fee_percentage: 40,
  default_installments_count: 12,
  default_payment_type: 'installments',
  payment_methods: ['pix', 'transferencia', 'dinheiro', 'cartao_credito', 'cartao_debito', 'cheque'],
  overdue_check_days: 2,
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  transferencia: 'Transferência Bancária',
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de Crédito',
  cartao_debito: 'Cartão de Débito',
  cheque: 'Cheque',
};

export interface EmailIntegrationConfig {
  resend_key: string;
  from_name: string;
  from_email: string;
}

export const EMAIL_INTEGRATION_DEFAULTS: EmailIntegrationConfig = {
  resend_key: '',
  from_name: '',
  from_email: '',
};

// ── Integração WhatsApp (Evolution API) ────────────────────────────────────
// Servidor único; cada CANAL é uma instância nele (tabela whatsapp_instances).
export interface WhatsAppEvolutionConfig {
  base_url: string;       // ex: https://evolution.seudominio.com.br
  api_key: string;        // header apikey (global do servidor)
}

export const WHATSAPP_EVOLUTION_DEFAULTS: WhatsAppEvolutionConfig = {
  base_url: '',
  api_key: '',
};

// ── Regras de notificação ──────────────────────────────────────────────────

export type NotificationChannel = 'email' | 'push' | 'whatsapp';
export type NotificationRecipient = 'responsible' | 'admin' | 'all_lawyers' | 'specific_role';

export interface NotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  channels: NotificationChannel[];
  recipients: NotificationRecipient;
  specific_role?: string;
  respect_business_hours: boolean;
}

export type NotifChannelStatus = 'active' | 'planned' | 'no';
export type NotifAudience = 'admin' | 'colaborador' | 'cliente';

export interface NotificationEventDef {
  key: string;
  label: string;
  group: string;
  audience: NotifAudience[];
  web: NotifChannelStatus;
  email: NotifChannelStatus;
  default_channels: NotificationChannel[];
  default_recipients: NotificationRecipient;
  default_enabled: boolean;
}

export const NOTIFICATION_TRIGGERS: NotificationEventDef[] = [
  // ── Sistema / Acesso ────────────────────────────────────────────────────
  { key: 'access_request_pending',    label: 'Solicitação de acesso pendente',      group: 'Sistema',     audience: ['admin'],                   web: 'active',  email: 'active',  default_channels: ['push','email'], default_recipients: 'admin',         default_enabled: true  },
  { key: 'access_request_approved',   label: 'Acesso aprovado',                     group: 'Sistema',     audience: ['cliente'],                 web: 'active',  email: 'active',  default_channels: ['email'],        default_recipients: 'responsible',   default_enabled: true  },
  { key: 'access_request_rejected',   label: 'Acesso recusado',                     group: 'Sistema',     audience: ['cliente'],                 web: 'active',  email: 'active',  default_channels: ['email'],        default_recipients: 'responsible',   default_enabled: true  },
  { key: 'access_request_expired',    label: 'Acesso expirado',                     group: 'Sistema',     audience: ['admin'],                   web: 'planned', email: 'planned', default_channels: ['push'],         default_recipients: 'admin',         default_enabled: false },
  { key: 'account_blocked',           label: 'Conta bloqueada / desativada',        group: 'Sistema',     audience: ['admin'],                   web: 'planned', email: 'planned', default_channels: ['push'],         default_recipients: 'admin',         default_enabled: false },
  // ── Autenticação ────────────────────────────────────────────────────────
  { key: 'password_reset_requested',  label: 'Redefinição de senha solicitada',     group: 'Autenticação', audience: ['cliente'],                web: 'no',      email: 'active',  default_channels: ['email'],        default_recipients: 'responsible',   default_enabled: true  },
  { key: 'password_changed',          label: 'Senha alterada',                      group: 'Autenticação', audience: ['cliente'],                web: 'active',  email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: true  },
  // ── Assinaturas ─────────────────────────────────────────────────────────
  { key: 'signature_link_sent',       label: 'Link de assinatura enviado',          group: 'Assinaturas', audience: ['cliente'],                 web: 'no',      email: 'active',  default_channels: ['email'],        default_recipients: 'responsible',   default_enabled: true  },
  { key: 'signature_otp_sent',        label: 'Código OTP enviado',                  group: 'Assinaturas', audience: ['cliente'],                 web: 'no',      email: 'active',  default_channels: ['email'],        default_recipients: 'responsible',   default_enabled: true  },
  { key: 'document_signed',           label: 'Documento assinado pelo cliente',     group: 'Assinaturas', audience: ['colaborador'],             web: 'active',  email: 'active',  default_channels: ['push','email'], default_recipients: 'responsible',   default_enabled: true  },
  { key: 'signature_request_reminder',label: 'Lembrete de assinatura pendente',     group: 'Assinaturas', audience: ['cliente'],                 web: 'planned', email: 'planned', default_channels: ['email'],        default_recipients: 'responsible',   default_enabled: false },
  // ── Prazos ──────────────────────────────────────────────────────────────
  { key: 'deadline_assigned',         label: 'Prazo atribuído',                     group: 'Prazos',      audience: ['colaborador'],             web: 'active',  email: 'active',  default_channels: ['push','email'], default_recipients: 'responsible',   default_enabled: true  },
  { key: 'deadline_due',              label: 'Prazo vencendo em breve',             group: 'Prazos',      audience: ['colaborador'],             web: 'active',  email: 'active',  default_channels: ['push','email'], default_recipients: 'responsible',   default_enabled: true  },
  { key: 'deadline_overdue',          label: 'Prazo vencido sem cumprimento',       group: 'Prazos',      audience: ['colaborador','admin'],     web: 'active',  email: 'active',  default_channels: ['push','email'], default_recipients: 'responsible',   default_enabled: true  },
  // ── Intimações / Processos ──────────────────────────────────────────────
  { key: 'new_intimation',            label: 'Nova intimação recebida',             group: 'Intimações',  audience: ['colaborador'],             web: 'active',  email: 'active',  default_channels: ['push'],         default_recipients: 'all_lawyers',   default_enabled: true  },
  { key: 'intimation_urgent',         label: 'Intimação urgente',                   group: 'Intimações',  audience: ['colaborador'],             web: 'active',  email: 'planned', default_channels: ['push'],         default_recipients: 'all_lawyers',   default_enabled: true  },
  { key: 'process_updated',           label: 'Novo andamento no processo (DataJud)', group: 'Processos',  audience: ['colaborador'],             web: 'planned', email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: false },
  { key: 'process_idle',              label: 'Processo sem movimentação há X dias', group: 'Processos',   audience: ['colaborador','admin'],     web: 'planned', email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: false },
  // ── Financeiro ──────────────────────────────────────────────────────────
  { key: 'payment_received',          label: 'Pagamento / parcela confirmado',      group: 'Financeiro',  audience: ['admin','cliente'],         web: 'active',  email: 'active',  default_channels: ['push','email'], default_recipients: 'admin',         default_enabled: true  },
  { key: 'installment_overdue',       label: 'Parcela vencida sem pagamento',       group: 'Financeiro',  audience: ['admin'],                   web: 'active',  email: 'active',  default_channels: ['email'],        default_recipients: 'admin',         default_enabled: true  },
  { key: 'payment_reminder',          label: 'Lembrete de pagamento ao cliente',    group: 'Financeiro',  audience: ['cliente'],                 web: 'planned', email: 'planned', default_channels: ['email'],        default_recipients: 'responsible',   default_enabled: false },
  // ── Agenda ──────────────────────────────────────────────────────────────
  { key: 'appointment_assigned',      label: 'Compromisso atribuído',               group: 'Agenda',      audience: ['colaborador'],             web: 'active',  email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: true  },
  { key: 'appointment_shared',        label: 'Compromisso compartilhado',           group: 'Agenda',      audience: ['colaborador'],             web: 'active',  email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: true  },
  { key: 'appointment_reminder',      label: 'Lembrete de compromisso',             group: 'Agenda',      audience: ['colaborador'],             web: 'active',  email: 'active',  default_channels: ['push','email'], default_recipients: 'responsible',   default_enabled: true  },
  // ── Tarefas ─────────────────────────────────────────────────────────────
  { key: 'task_assigned',             label: 'Tarefa atribuída',                    group: 'Tarefas',     audience: ['colaborador'],             web: 'active',  email: 'active',  default_channels: ['push','email'], default_recipients: 'responsible',   default_enabled: true  },
  { key: 'task_overdue',              label: 'Tarefa em atraso',                    group: 'Tarefas',     audience: ['colaborador'],             web: 'active',  email: 'active',  default_channels: ['push','email'], default_recipients: 'responsible',   default_enabled: true  },
  // ── Requerimentos ───────────────────────────────────────────────────────
  { key: 'requirement_alert',         label: 'Requerimento em exigência',           group: 'Requerimentos', audience: ['colaborador'],           web: 'active',  email: 'active',  default_channels: ['push','email'], default_recipients: 'responsible',   default_enabled: true  },
  { key: 'requirement_critical',      label: 'Requerimento crítico',                group: 'Requerimentos', audience: ['colaborador','admin'],   web: 'active',  email: 'active',  default_channels: ['push','email'], default_recipients: 'admin',         default_enabled: true  },
  // ── Chat / Comentários ──────────────────────────────────────────────────
  { key: 'mention',                   label: 'Menção em comentário / chat',         group: 'Comunicação', audience: ['colaborador'],             web: 'active',  email: 'active',  default_channels: ['push','email'], default_recipients: 'responsible',   default_enabled: true  },
  { key: 'chat_message',              label: 'Nova mensagem direta',                group: 'Comunicação', audience: ['colaborador'],             web: 'active',  email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: true  },
  // ── Portal / Cliente ────────────────────────────────────────────────────
  { key: 'new_message',               label: 'Nova mensagem no portal',             group: 'Portal',      audience: ['colaborador','cliente'],   web: 'active',  email: 'active',  default_channels: ['push','email'], default_recipients: 'responsible',   default_enabled: true  },
  { key: 'new_signature_request',     label: 'Nova solicitação de assinatura',      group: 'Portal',      audience: ['cliente'],                 web: 'active',  email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: true  },
  { key: 'new_document_request',      label: 'Nova solicitação de documento',       group: 'Portal',      audience: ['cliente'],                 web: 'active',  email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: true  },
  { key: 'document_request_answered', label: 'Solicitação de documento respondida', group: 'Portal',      audience: ['colaborador'],             web: 'planned', email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: false },
  { key: 'document_upload_approved',  label: 'Documento enviado aprovado',          group: 'Portal',      audience: ['cliente'],                 web: 'active',  email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: true  },
  { key: 'document_upload_rejected',  label: 'Documento enviado recusado',          group: 'Portal',      audience: ['cliente'],                 web: 'active',  email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: true  },
  { key: 'profile_update_approved',   label: 'Atualização de perfil aprovada',      group: 'Portal',      audience: ['cliente'],                 web: 'active',  email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: true  },
  { key: 'profile_update_rejected',   label: 'Atualização de perfil recusada',      group: 'Portal',      audience: ['cliente'],                 web: 'active',  email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: true  },
  // ── Leads ───────────────────────────────────────────────────────────────
  { key: 'new_lead',                  label: 'Novo lead cadastrado',                group: 'Leads',       audience: ['admin','colaborador'],     web: 'active',  email: 'planned', default_channels: ['push'],         default_recipients: 'admin',         default_enabled: false },
  { key: 'lead_no_followup',          label: 'Lead sem follow-up há X dias',        group: 'Leads',       audience: ['colaborador'],             web: 'planned', email: 'planned', default_channels: ['push'],         default_recipients: 'responsible',   default_enabled: false },
  // ── Resumo ──────────────────────────────────────────────────────────────
  { key: 'weekly_digest',             label: 'Resumo semanal por e-mail',           group: 'Resumo',      audience: ['colaborador'],             web: 'no',      email: 'active',  default_channels: ['email'],        default_recipients: 'all_lawyers',   default_enabled: false },
];

export const DEFAULT_NOTIFICATION_RULES: NotificationRule[] = NOTIFICATION_TRIGGERS.map((ev, i) => ({
  id: String(i + 1),
  name: ev.label,
  enabled: ev.default_enabled,
  trigger: ev.key,
  channels: ev.default_channels,
  recipients: ev.default_recipients,
  respect_business_hours: true,
}));

// ── Templates de e-mail ───────────────────────────────────────────────────

export interface EmailTemplateVariable { key: string; label: string; example: string }

export interface EmailTemplate {
  id: string;
  name: string;
  trigger: string;
  subject: string;
  html_body: string;
  enabled: boolean;
  is_custom: boolean;
  category?: string; // domínio funcional para organização na UI
}

export const EMAIL_TEMPLATE_VARIABLES: Record<string, EmailTemplateVariable[]> = {
  _default: [
    { key: '{{escritorio_nome}}',  label: 'Nome do escritório', example: 'Silva & Advogados' },
    { key: '{{cliente_nome}}',     label: 'Nome do cliente',    example: 'João da Silva' },
    { key: '{{data_hora}}',        label: 'Data e hora',        example: '09/06/2026 às 14:30' },
  ],
  deadline_due: [
    { key: '{{prazo_descricao}}',  label: 'Descrição do prazo',  example: 'Contestação nº 0001234' },
    { key: '{{prazo_data}}',       label: 'Data do prazo',       example: '15/06/2026' },
    { key: '{{dias_restantes}}',   label: 'Dias restantes',      example: '3' },
    { key: '{{responsavel}}',      label: 'Responsável',         example: 'Dr. Carlos' },
  ],
  deadline_overdue: [
    { key: '{{prazo_descricao}}',  label: 'Descrição do prazo',  example: 'Contestação nº 0001234' },
    { key: '{{prazo_data}}',       label: 'Data do prazo',       example: '15/06/2026' },
    { key: '{{responsavel}}',      label: 'Responsável',         example: 'Dr. Carlos' },
  ],
  new_intimation: [
    { key: '{{intimacao_numero}}', label: 'Número do processo',  example: '0001234-56.2026.8.26.0001' },
    { key: '{{intimacao_texto}}',  label: 'Texto da intimação',  example: 'Cumpra-se o despacho...' },
    { key: '{{tribunal}}',         label: 'Tribunal',            example: 'TJSP' },
  ],
  payment_received: [
    { key: '{{valor}}',            label: 'Valor recebido',      example: 'R$ 1.500,00' },
    { key: '{{parcela}}',          label: 'Parcela',             example: '3/12' },
    { key: '{{processo_numero}}',  label: 'Número do processo',  example: '0001234-56.2026' },
  ],
  installment_overdue: [
    { key: '{{valor}}',            label: 'Valor em atraso',     example: 'R$ 1.500,00' },
    { key: '{{dias_atraso}}',      label: 'Dias em atraso',      example: '5' },
    { key: '{{parcela}}',          label: 'Parcela',             example: '3/12' },
  ],
  access_request_pending: [
    { key: '{{solicitante_nome}}', label: 'Nome do solicitante', example: 'Maria Costa' },
  ],
  deadline_assigned: [
    { key: '{{prazo_descricao}}',  label: 'Descrição do prazo',  example: 'Contestação nº 0001234' },
    { key: '{{prazo_data}}',       label: 'Data do prazo',       example: '15/06/2026' },
    { key: '{{responsavel}}',      label: 'Responsável',         example: 'Dr. Carlos' },
    { key: '{{atribuido_por}}',    label: 'Atribuído por',       example: 'Dra. Ana' },
  ],
  signature_link_sent: [
    { key: '{{link_assinatura}}',  label: 'Link de assinatura',  example: 'https://assinar.sistema.com/abc123' },
    { key: '{{documento_nome}}',   label: 'Nome do documento',   example: 'Contrato de Honorários' },
    { key: '{{validade}}',         label: 'Validade do link',    example: '48 horas' },
  ],
  signature_otp: [
    { key: '{{codigo_otp}}',       label: 'Código OTP',          example: '847523' },
    { key: '{{validade_otp}}',     label: 'Validade',            example: '10 minutos' },
    { key: '{{documento_nome}}',   label: 'Nome do documento',   example: 'Contrato de Honorários' },
  ],
  comment_mention: [
    { key: '{{mencionado_por}}',   label: 'Mencionado por',      example: 'Dr. Carlos' },
    { key: '{{contexto}}',         label: 'Contexto',            example: 'Processo 0001234' },
    { key: '{{link_conversa}}',    label: 'Link da conversa',    example: 'https://sistema/chat/xyz' },
  ],
  weekly_digest: [
    { key: '{{prazos_semana}}',    label: 'Prazos da semana',    example: '5 prazos' },
    { key: '{{tarefas_pendentes}}',label: 'Tarefas pendentes',   example: '3 tarefas' },
    { key: '{{periodo}}',          label: 'Período',             example: '09/06/2026 a 15/06/2026' },
  ],
};

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplate[] = [
  // ── Prazos ──────────────────────────────────────────────────────────────
  {
    id: 'deadline_assigned',
    name: 'Prazo Atribuído',
    trigger: 'deadline_assigned',
    category: 'Prazos',
    subject: '📌 Novo prazo atribuído a você — {{prazo_descricao}}',
    html_body: `<p>Olá <strong>{{responsavel}}</strong>,</p>
<p>Um novo prazo foi atribuído a você por <strong>{{atribuido_por}}</strong>.</p>
<p><strong>Prazo:</strong> {{prazo_descricao}}<br/><strong>Data limite:</strong> {{prazo_data}}</p>
<p>Acesse o sistema para verificar os detalhes.</p>
<p>Atenciosamente,<br/>{{escritorio_nome}}</p>`,
    enabled: true,
    is_custom: false,
  },
  {
    id: 'deadline_due',
    name: 'Alerta de Prazo',
    trigger: 'deadline_due',
    category: 'Prazos',
    subject: '⚠️ Prazo vencendo em {{dias_restantes}} dias — {{prazo_descricao}}',
    html_body: `<p>Olá <strong>{{responsavel}}</strong>,</p>
<p>Este é um lembrete: o prazo <strong>{{prazo_descricao}}</strong> vence em <strong>{{dias_restantes}} dias</strong>, no dia {{prazo_data}}.</p>
<p>Acesse o sistema para tomar as providências necessárias.</p>
<p>Atenciosamente,<br/>{{escritorio_nome}}</p>`,
    enabled: true,
    is_custom: false,
  },
  {
    id: 'deadline_overdue',
    name: 'Prazo Vencido',
    trigger: 'deadline_overdue',
    category: 'Prazos',
    subject: '🔴 Prazo vencido — {{prazo_descricao}}',
    html_body: `<p>Olá <strong>{{responsavel}}</strong>,</p>
<p>O prazo <strong>{{prazo_descricao}}</strong> venceu em {{prazo_data}} e ainda não foi cumprido.</p>
<p>Acesse o sistema imediatamente para regularizar a situação.</p>
<p>Atenciosamente,<br/>{{escritorio_nome}}</p>`,
    enabled: true,
    is_custom: false,
  },
  // ── Intimações & Processos ───────────────────────────────────────────────
  {
    id: 'new_intimation',
    name: 'Nova Intimação',
    trigger: 'new_intimation',
    category: 'Intimações',
    subject: '📋 Nova intimação recebida — Processo {{intimacao_numero}}',
    html_body: `<p>Prezado(a),</p>
<p>Uma nova intimação foi recebida no processo <strong>{{intimacao_numero}}</strong> ({{tribunal}}).</p>
<blockquote style="border-left:3px solid #ff8a00;margin:12px 0;padding:8px 12px;color:#555">{{intimacao_texto}}</blockquote>
<p>Acesse o sistema para verificar os detalhes.</p>
<p>Atenciosamente,<br/>{{escritorio_nome}}</p>`,
    enabled: true,
    is_custom: false,
  },
  // ── Financeiro ───────────────────────────────────────────────────────────
  {
    id: 'payment_received',
    name: 'Pagamento Recebido',
    trigger: 'payment_received',
    category: 'Financeiro',
    subject: '✅ Pagamento confirmado — {{valor}}',
    html_body: `<p>Olá <strong>{{cliente_nome}}</strong>,</p>
<p>Confirmamos o recebimento do pagamento de <strong>{{valor}}</strong> (parcela {{parcela}}) referente ao processo {{processo_numero}}.</p>
<p>Obrigado pela pontualidade.</p>
<p>Atenciosamente,<br/>{{escritorio_nome}}</p>`,
    enabled: true,
    is_custom: false,
  },
  {
    id: 'installment_overdue',
    name: 'Parcela em Atraso',
    trigger: 'installment_overdue',
    category: 'Financeiro',
    subject: '🔴 Parcela em atraso — {{valor}} ({{dias_atraso}} dias)',
    html_body: `<p>Olá <strong>{{cliente_nome}}</strong>,</p>
<p>A parcela {{parcela}} no valor de <strong>{{valor}}</strong> encontra-se em atraso há <strong>{{dias_atraso}} dias</strong>.</p>
<p>Por favor, entre em contato para regularizar a situação.</p>
<p>Atenciosamente,<br/>{{escritorio_nome}}</p>`,
    enabled: true,
    is_custom: false,
  },
  // ── Assinaturas ──────────────────────────────────────────────────────────
  {
    id: 'signature_link_sent',
    name: 'Link de Assinatura',
    trigger: 'signature_link_sent',
    category: 'Assinaturas',
    subject: '✍️ Documento aguardando sua assinatura — {{documento_nome}}',
    html_body: `<p>Olá <strong>{{cliente_nome}}</strong>,</p>
<p>O documento <strong>{{documento_nome}}</strong> está aguardando sua assinatura eletrônica.</p>
<p>Clique no link abaixo para assinar. O link é válido por <strong>{{validade}}</strong>.</p>
<p><a href="{{link_assinatura}}" style="display:inline-block;padding:10px 20px;background:#ff8a00;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Assinar Documento</a></p>
<p>Atenciosamente,<br/>{{escritorio_nome}}</p>`,
    enabled: true,
    is_custom: false,
  },
  {
    id: 'signature_otp',
    name: 'Código de Autenticação (OTP)',
    trigger: 'signature_otp',
    category: 'Assinaturas',
    subject: '🔐 Seu código de autenticação — {{codigo_otp}}',
    html_body: `<p>Olá <strong>{{cliente_nome}}</strong>,</p>
<p>Seu código de autenticação para assinar o documento <strong>{{documento_nome}}</strong> é:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;color:#ff8a00;padding:16px 0">{{codigo_otp}}</p>
<p>Este código é válido por <strong>{{validade_otp}}</strong>. Não compartilhe com ninguém.</p>
<p>Atenciosamente,<br/>{{escritorio_nome}}</p>`,
    enabled: true,
    is_custom: false,
  },
  // ── Portal / Sistema ─────────────────────────────────────────────────────
  {
    id: 'access_request_pending',
    name: 'Solicitação de Acesso Pendente',
    trigger: 'access_request_pending',
    category: 'Portal',
    subject: '🔑 Nova solicitação de acesso ao portal — {{solicitante_nome}}',
    html_body: `<p>Olá,</p>
<p><strong>{{solicitante_nome}}</strong> solicitou acesso ao Portal do Cliente em {{data_hora}}.</p>
<p>Acesse as configurações do sistema para aprovar ou recusar a solicitação.</p>
<p>Atenciosamente,<br/>{{escritorio_nome}}</p>`,
    enabled: true,
    is_custom: false,
  },
  // ── Comunicação interna ──────────────────────────────────────────────────
  {
    id: 'comment_mention',
    name: 'Menção em Comentário',
    trigger: 'comment_mention',
    category: 'Comunicação',
    subject: '💬 Você foi mencionado por {{mencionado_por}}',
    html_body: `<p>Olá <strong>{{cliente_nome}}</strong>,</p>
<p><strong>{{mencionado_por}}</strong> mencionou você em {{contexto}}.</p>
<p><a href="{{link_conversa}}" style="color:#ff8a00">Ver mensagem →</a></p>
<p>Atenciosamente,<br/>{{escritorio_nome}}</p>`,
    enabled: true,
    is_custom: false,
  },
  // ── Resumo semanal ───────────────────────────────────────────────────────
  {
    id: 'weekly_digest',
    name: 'Resumo Semanal',
    trigger: 'weekly_digest',
    category: 'Sistema',
    subject: '📊 Resumo da semana — {{periodo}}',
    html_body: `<p>Olá <strong>{{cliente_nome}}</strong>,</p>
<p>Aqui está o resumo da semana <strong>{{periodo}}</strong>:</p>
<ul>
  <li><strong>{{prazos_semana}}</strong> vencendo nos próximos dias</li>
  <li><strong>{{tarefas_pendentes}}</strong> tarefas pendentes</li>
</ul>
<p>Acesse o sistema para acompanhar.</p>
<p>Atenciosamente,<br/>{{escritorio_nome}}</p>`,
    enabled: true,
    is_custom: false,
  },
];

// ── Configuração do módulo Leads ─────────────────────────────────────────

export const LEAD_COLORS = ['slate', 'blue', 'emerald', 'amber', 'red', 'violet', 'orange', 'cyan'] as const;
export type LeadColor = typeof LEAD_COLORS[number];

export interface LeadStageConfig {
  key: string;
  label: string;
  description: string;
  color: LeadColor;
  active?: boolean;
  isDefault?: boolean;
}

export interface LeadModuleConfig {
  stages: LeadStageConfig[];
  sources: string[];
}

export const LEAD_MODULE_DEFAULTS: LeadModuleConfig = {
  stages: [
    { key: 'novo',                 label: 'Novo',                 description: 'Lead recém-cadastrado, aguarda primeiro contato.', color: 'slate' },
    { key: 'qualificando',         label: 'Qualificando',         description: 'Contato em andamento para entender necessidades.', color: 'blue' },
    { key: 'qualificado',          label: 'Qualificado',          description: 'Lead validado e pronto para conversão.',          color: 'emerald' },
    { key: 'aguardando_documentos',label: 'Aguardando Documentos',description: 'Lead enviando documentos ou informações.',        color: 'amber' },
    { key: 'nao_qualificado',      label: 'Não Qualificado',      description: 'Lead não avançará como cliente.',                 color: 'red' },
  ],
  sources: ['Indicação', 'Site', 'Instagram', 'Google', 'WhatsApp', 'Outro'],
};

// ── Configuração do módulo Agenda ─────────────────────────────────────────

export interface CalendarEventTypeConfig {
  key: string;
  label: string;
  color: string; // hex
  duration_min: number;
  active?: boolean;
}

export interface CalendarModuleConfig {
  event_types: CalendarEventTypeConfig[];
  buffer_min: number;
}

export const CALENDAR_MODULE_DEFAULTS: CalendarModuleConfig = {
  event_types: [
    { key: 'deadline',    label: 'Prazo',         color: '#4f46e5', duration_min: 60 },
    { key: 'hearing',     label: 'Audiência',     color: '#dc2626', duration_min: 120 },
    { key: 'requirement', label: 'Requerimento',  color: '#d97706', duration_min: 60 },
    { key: 'payment',     label: 'Pagamento',     color: '#0284c7', duration_min: 30 },
    { key: 'meeting',     label: 'Reunião',       color: '#059669', duration_min: 60 },
    { key: 'pericia',     label: 'Perícia',       color: '#7c3aed', duration_min: 180 },
    { key: 'personal',    label: 'Pessoal',       color: '#a21caf', duration_min: 60 },
  ],
  buffer_min: 0,
};

// ── Configuração do módulo Assinaturas ───────────────────────────────────

export interface SignatureModuleConfig {
  signer_roles: string[];
  auth_methods: string[];
  default_auth_method: string;
}

export const SIGNATURE_MODULE_DEFAULTS: SignatureModuleConfig = {
  signer_roles: ['Signatário', 'Contratante', 'Contratado', 'Testemunha', 'Fiador', 'Cônjuge', 'Representante Legal'],
  auth_methods: ['Só assinatura', 'Assinatura + Validação Facial', 'Assinatura + Facial + Documento'],
  default_auth_method: 'Só assinatura',
};

// ── Configuração do módulo Tarefas ────────────────────────────────────────

export interface TaskPriorityConfig { key: string; label: string; badge: string; active?: boolean; isDefault?: boolean }

export interface TaskModuleConfig {
  priorities: TaskPriorityConfig[];
}

export const TASK_MODULE_DEFAULTS: TaskModuleConfig = {
  priorities: [
    { key: 'high',   label: 'Alta',  badge: 'bg-red-100 text-red-700' },
    { key: 'medium', label: 'Média', badge: 'bg-amber-100 text-amber-700' },
    { key: 'low',    label: 'Baixa', badge: 'bg-slate-100 text-slate-600' },
  ],
};

// ── Configuração do módulo Clientes ───────────────────────────────────────

export interface ClientStatusConfig  { key: string; label: string; badge: string; active?: boolean }
export interface MaritalStatusConfig { key: string; label: string; active?: boolean; isDefault?: boolean }

export interface ClientModuleConfig {
  statuses:        ClientStatusConfig[];
  marital_statuses: MaritalStatusConfig[];
}

export const CLIENT_MODULE_DEFAULTS: ClientModuleConfig = {
  statuses: [
    { key: 'ativo',    label: 'Ativo',    badge: 'bg-green-100 text-green-700' },
    { key: 'inativo',  label: 'Inativo',  badge: 'bg-slate-100 text-slate-600' },
    { key: 'suspenso', label: 'Suspenso', badge: 'bg-amber-100 text-amber-700' },
  ],
  marital_statuses: [
    { key: 'solteiro',      label: 'Solteiro(a)' },
    { key: 'casado',        label: 'Casado(a)' },
    { key: 'divorciado',    label: 'Divorciado(a)' },
    { key: 'viuvo',         label: 'Viúvo(a)' },
    { key: 'uniao_estavel', label: 'União Estável' },
  ],
};

// ── Personalização do Portal ──────────────────────────────────────────────

export interface PortalCustomizationConfig {
  accent_color: string;
  welcome_message: string;
  footer_text: string;
  support_contact: string;
}

export const PORTAL_CUSTOMIZATION_DEFAULTS: PortalCustomizationConfig = {
  accent_color: '#ff8a00',
  welcome_message: 'Bem-vindo ao Portal do Cliente',
  footer_text: '',
  support_contact: '',
};

export interface PortalClientNotificationsConfig {
  new_document:        boolean;
  document_request:    boolean;
  deadline_approaching: boolean;
  process_update:      boolean;
  payment_confirmed:   boolean;
  new_message:         boolean;
}

export const PORTAL_CLIENT_NOTIF_DEFAULTS: PortalClientNotificationsConfig = {
  new_document:         true,
  document_request:     true,
  deadline_approaching: true,
  process_update:       true,
  payment_confirmed:    true,
  new_message:          true,
};

// ── Editor de Prompts de IA ───────────────────────────────────────────────

export const AI_PROMPT_KEYS: { key: string; label: string; description: string }[] = [
  { key: 'analyze_intimation',   label: 'Análise de intimação',       description: 'Análise completa: resumo, prazo, urgência, ações. Arquivo: ai.service.ts' },
  { key: 'extract_deadline',     label: 'Extração de prazo',          description: 'Identifica prazos no texto de uma intimação. Arquivo: ai.service.ts' },
  { key: 'summarize_text',       label: 'Resumo de texto',            description: 'Resume textos jurídicos em N palavras. Arquivo: ai.service.ts' },
  { key: 'classify_urgency',     label: 'Classificação de urgência',  description: 'Classifica comunicações como crítica/alta/média/baixa. Arquivo: ai.service.ts' },
  { key: 'suggest_actions',      label: 'Sugestão de ações',          description: 'Sugere 3-5 ações práticas ao advogado. Arquivo: ai.service.ts' },
  { key: 'edit_legal_text',      label: 'Edição de texto jurídico',   description: 'Edita trechos de petições. Arquivo: ai.service.ts' },
  { key: 'format_qualification', label: 'Formatação de qualificação', description: 'Formata qualificação das partes. Arquivo: ai.service.ts' },
];

export interface AiPromptOverride {
  key:           string;
  system_prompt: string;
  updated_at:    string;
}

// ── Motor de IA ──────────────────────────────────────────────────────────

export type AiProviderId = 'openai' | 'groq' | 'anthropic' | 'grok' | 'gemini';

export interface AiProviderConfig {
  primary: AiProviderId;
  fallback_order: AiProviderId[];
  enabled: Record<AiProviderId, boolean>;
  cooldown_ms: number;
}

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  openai:    'OpenAI (GPT-4o)',
  groq:      'Groq (Llama)',
  anthropic: 'Anthropic (Claude)',
  grok:      'Grok (xAI)',
  gemini:    'Gemini (Google)',
};

export const AI_PROVIDER_DEFAULTS: AiProviderConfig = {
  primary: 'openai',
  fallback_order: ['groq'],
  enabled: { openai: true, groq: true, anthropic: false, grok: false, gemini: false },
  cooldown_ms: 60000,
};

export interface AiTaskConfig {
  task_key: string;
  label: string;
  provider: AiProviderId;
  model: string;
  temperature: number;
  max_tokens: number;
}

export const DEFAULT_AI_TASKS: AiTaskConfig[] = [
  { task_key: 'analyze_intimation',    label: 'Análise de intimação',        provider: 'openai', model: 'gpt-4o',      temperature: 0.2, max_tokens: 1200 },
  { task_key: 'extract_deadline',      label: 'Extração de prazo',           provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 300  },
  { task_key: 'summarize_text',        label: 'Resumo de texto',             provider: 'openai', model: 'gpt-4o-mini', temperature: 0.3, max_tokens: 200  },
  { task_key: 'classify_urgency',      label: 'Classificação de urgência',   provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 10   },
  { task_key: 'suggest_actions',       label: 'Sugestão de ações',           provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4, max_tokens: 300  },
  { task_key: 'format_qualification',  label: 'Formatação de qualificação',  provider: 'openai', model: 'gpt-4o-mini', temperature: 0.1, max_tokens: 300  },
  { task_key: 'edit_legal_text',       label: 'Edição de texto jurídico',    provider: 'openai', model: 'gpt-4o-mini', temperature: 0.3, max_tokens: 1200 },
];

// ── Configuração do módulo Requerimentos ─────────────────────────────────

export interface RequirementStatusConfig { key: string; label: string; badge: string; active?: boolean; isDefault?: boolean }
export interface RequirementBenefitConfig { key: string; label: string; active?: boolean; isDefault?: boolean }

export interface RequirementModuleConfig {
  statuses:      RequirementStatusConfig[];
  benefit_types: RequirementBenefitConfig[];
}

export const REQUIREMENT_MODULE_DEFAULTS: RequirementModuleConfig = {
  statuses: [
    { key: 'em_exigencia',       label: 'Em Exigência',         badge: 'bg-amber-500 text-white border border-amber-600' },
    { key: 'em_analise',         label: 'Em Análise',           badge: 'bg-blue-500 text-white border border-blue-600' },
    { key: 'aguardando_pericia', label: 'Aguardando Perícia',   badge: 'bg-cyan-500 text-white border border-cyan-600' },
    { key: 'aguardando_confeccao',label:'Aguardando Confecção', badge: 'bg-indigo-500 text-white border border-indigo-600' },
    { key: 'deferido',           label: 'Deferidos',            badge: 'bg-green-500 text-white border border-green-600' },
    { key: 'indeferido',         label: 'Indeferidos',          badge: 'bg-red-500 text-white border border-red-600' },
    { key: 'ajuizado',           label: 'Ajuizados',            badge: 'bg-slate-700 text-white border border-slate-800' },
  ],
  benefit_types: [
    { key: 'bpc_loas',                label: 'BPC LOAS - Deficiente' },
    { key: 'bpc_loas_deficiencia',    label: 'BPC LOAS - Deficiência' },
    { key: 'bpc_loas_idoso',          label: 'BPC LOAS - Idoso' },
    { key: 'aposentadoria_tempo',     label: 'Aposentadoria por Tempo de Contribuição' },
    { key: 'aposentadoria_idade',     label: 'Aposentadoria por Idade' },
    { key: 'aposentadoria_invalidez', label: 'Aposentadoria por Invalidez' },
    { key: 'auxilio_acidente',        label: 'Auxílio Acidente' },
    { key: 'auxilio_doenca',          label: 'Auxílio Doença' },
    { key: 'pensao_morte',            label: 'Pensão por Morte' },
    { key: 'salario_maternidade',     label: 'Salário Maternidade' },
    { key: 'outro',                   label: 'Outro' },
  ],
};

// ── Configuração do módulo Processos ─────────────────────────────────────

export interface ProcessStatusConfig { key: string; label: string; badge: string; active?: boolean; isDefault?: boolean }
export interface PracticeAreaConfig   { key: string; label: string; description: string; active?: boolean; isDefault?: boolean }

export interface ProcessModuleConfig {
  statuses: ProcessStatusConfig[];
  practice_areas: PracticeAreaConfig[];
  timeline_event_limit: number;
  ai_summary_max_tokens: number;
}

export const PROCESS_MODULE_DEFAULTS: ProcessModuleConfig = {
  statuses: [
    { key: 'nao_protocolado',     label: 'Não Protocolado',      badge: 'bg-slate-100 text-slate-700' },
    { key: 'distribuido',         label: 'Distribuído',           badge: 'bg-amber-100 text-amber-700' },
    { key: 'aguardando_confeccao',label: 'Aguardando Confecção',  badge: 'bg-blue-100 text-blue-700' },
    { key: 'citacao',             label: 'Citação',               badge: 'bg-cyan-100 text-cyan-700' },
    { key: 'conciliacao',         label: 'Conciliação',           badge: 'bg-teal-100 text-teal-700' },
    { key: 'contestacao',         label: 'Contestação',           badge: 'bg-orange-100 text-orange-700' },
    { key: 'instrucao',           label: 'Instrução',             badge: 'bg-indigo-100 text-indigo-700' },
    { key: 'andamento',           label: 'Em Andamento',          badge: 'bg-emerald-100 text-emerald-700' },
    { key: 'sentenca',            label: 'Sentença',              badge: 'bg-purple-100 text-purple-700' },
    { key: 'recurso',             label: 'Recurso',               badge: 'bg-yellow-100 text-yellow-700' },
    { key: 'cumprimento',         label: 'Cumprimento',           badge: 'bg-rose-100 text-rose-700' },
    { key: 'arquivado',           label: 'Arquivado',             badge: 'bg-slate-100 text-slate-600' },
  ],
  practice_areas: [
    { key: 'trabalhista',   label: 'Trabalhista',   description: 'Demandas trabalhistas e relações de emprego' },
    { key: 'familia',       label: 'Família',       description: 'Divórcios, guarda, pensão e outros temas familiares' },
    { key: 'consumidor',    label: 'Consumidor',    description: 'Direitos do consumidor e relações de consumo' },
    { key: 'previdenciario',label: 'Previdenciário',description: 'Benefícios do INSS, aposentadorias e afins' },
    { key: 'civel',         label: 'Cível',         description: 'Demandas cíveis em geral' },
  ],
  timeline_event_limit: 30,
  ai_summary_max_tokens: 1000,
};

// ── Configuração do módulo Prazos ─────────────────────────────────────────

export interface DeadlineStatusConfig   { key: string; label: string; badge: string; active?: boolean; isDefault?: boolean }
export interface DeadlinePriorityConfig { key: string; label: string; badge: string; active?: boolean; isDefault?: boolean }
export interface DeadlineTypeConfig     { key: string; label: string; icon?: string; active?: boolean; isDefault?: boolean }

export interface DeadlineModuleConfig {
  statuses: DeadlineStatusConfig[];
  priorities: DeadlinePriorityConfig[];
  types: DeadlineTypeConfig[];
  soon_days_threshold: number;
  week_days_threshold: number;
  default_notify_days: number;
}

export const DEADLINE_MODULE_DEFAULTS: DeadlineModuleConfig = {
  statuses: [
    { key: 'pendente',  label: 'Pendentes',   badge: 'bg-blue-500 text-white' },
    { key: 'cumprido',  label: 'Cumpridos',   badge: 'bg-green-600 text-white' },
    { key: 'vencido',   label: 'Vencidos',    badge: 'bg-red-600 text-white' },
    { key: 'cancelado', label: 'Cancelados',  badge: 'bg-slate-400 text-white' },
  ],
  priorities: [
    { key: 'urgente', label: 'Urgente', badge: 'bg-red-600 text-white' },
    { key: 'alta',    label: 'Alta',    badge: 'bg-orange-500 text-white' },
    { key: 'media',   label: 'Média',   badge: 'bg-yellow-500 text-white' },
    { key: 'baixa',   label: 'Baixa',   badge: 'bg-slate-400 text-white' },
  ],
  types: [
    { key: 'processo',      label: 'Processo' },
    { key: 'requerimento',  label: 'Requerimento' },
    { key: 'geral',         label: 'Geral' },
  ],
  soon_days_threshold: 2,
  week_days_threshold: 7,
  default_notify_days: 2,
};

// ── Construtor de Formulários ─────────────────────────────────────────────

export interface FormFieldConfig {
  field_key:  string;
  label:      string;
  hidden:     boolean;
  required:   boolean;
  order:      number;
  help_text:  string;
  system:     boolean; // system fields cannot be hidden
}

export interface FormLayoutModule {
  module_key: string;
  label:      string;
  fields:     FormFieldConfig[];
}

export const CANONICAL_FORM_FIELDS: FormLayoutModule[] = [
  {
    module_key: 'clients',
    label: 'Clientes',
    fields: [
      { field_key: 'name',          label: 'Nome',              hidden: false, required: true,  order: 1, help_text: '', system: true },
      { field_key: 'cpf',           label: 'CPF',               hidden: false, required: false, order: 2, help_text: '', system: false },
      { field_key: 'email',         label: 'E-mail',            hidden: false, required: false, order: 3, help_text: '', system: false },
      { field_key: 'phone',         label: 'Telefone',          hidden: false, required: false, order: 4, help_text: '', system: false },
      { field_key: 'status',        label: 'Status',            hidden: false, required: false, order: 5, help_text: '', system: false },
      { field_key: 'marital',       label: 'Estado Civil',      hidden: false, required: false, order: 6, help_text: '', system: false },
      { field_key: 'birth_date',    label: 'Data de Nascimento',hidden: false, required: false, order: 7, help_text: '', system: false },
      { field_key: 'address',       label: 'Endereço',          hidden: false, required: false, order: 8, help_text: '', system: false },
      { field_key: 'notes',         label: 'Observações',       hidden: false, required: false, order: 9, help_text: '', system: false },
    ],
  },
  {
    module_key: 'processes',
    label: 'Processos',
    fields: [
      { field_key: 'number',        label: 'Número do Processo', hidden: false, required: true,  order: 1, help_text: '', system: true },
      { field_key: 'status',        label: 'Status',             hidden: false, required: false, order: 2, help_text: '', system: false },
      { field_key: 'practice_area', label: 'Área do Direito',    hidden: false, required: false, order: 3, help_text: '', system: false },
      { field_key: 'client',        label: 'Cliente',            hidden: false, required: true,  order: 4, help_text: '', system: true },
      { field_key: 'responsible',   label: 'Responsável',        hidden: false, required: false, order: 5, help_text: '', system: false },
      { field_key: 'court',         label: 'Tribunal / Vara',    hidden: false, required: false, order: 6, help_text: '', system: false },
      { field_key: 'description',   label: 'Descrição',          hidden: false, required: false, order: 7, help_text: '', system: false },
    ],
  },
  {
    module_key: 'deadlines',
    label: 'Prazos',
    fields: [
      { field_key: 'title',          label: 'Título',              hidden: false, required: true,  order: 1, help_text: '', system: true },
      { field_key: 'type',           label: 'Tipo',                hidden: false, required: false, order: 2, help_text: '', system: false },
      { field_key: 'priority',       label: 'Prioridade',          hidden: false, required: false, order: 3, help_text: '', system: false },
      { field_key: 'responsible',    label: 'Responsável',         hidden: false, required: false, order: 4, help_text: '', system: false },
      { field_key: 'pub_date',       label: 'Data de Publicação',  hidden: false, required: false, order: 5, help_text: '', system: false },
      { field_key: 'days',           label: 'Dias / Contagem',     hidden: false, required: false, order: 6, help_text: '', system: false },
      { field_key: 'process',        label: 'Processo vinculado',  hidden: false, required: false, order: 7, help_text: '', system: false },
      { field_key: 'notes',          label: 'Observações',         hidden: false, required: false, order: 8, help_text: '', system: false },
    ],
  },
  {
    module_key: 'tasks',
    label: 'Tarefas',
    fields: [
      { field_key: 'title',       label: 'Título',          hidden: false, required: true,  order: 1, help_text: '', system: true },
      { field_key: 'priority',    label: 'Prioridade',      hidden: false, required: false, order: 2, help_text: '', system: false },
      { field_key: 'responsible', label: 'Responsável',     hidden: false, required: false, order: 3, help_text: '', system: false },
      { field_key: 'due_date',    label: 'Data de entrega', hidden: false, required: false, order: 4, help_text: '', system: false },
      { field_key: 'process',     label: 'Processo',        hidden: false, required: false, order: 5, help_text: '', system: false },
      { field_key: 'client',      label: 'Cliente',         hidden: false, required: false, order: 6, help_text: '', system: false },
      { field_key: 'description', label: 'Descrição',       hidden: false, required: false, order: 7, help_text: '', system: false },
    ],
  },
  {
    module_key: 'requirements',
    label: 'Requerimentos (INSS)',
    fields: [
      { field_key: 'title',        label: 'Título / Benefício', hidden: false, required: true,  order: 1, help_text: '', system: true },
      { field_key: 'benefit_type', label: 'Tipo de benefício',  hidden: false, required: false, order: 2, help_text: '', system: false },
      { field_key: 'status',       label: 'Status',             hidden: false, required: false, order: 3, help_text: '', system: false },
      { field_key: 'responsible',  label: 'Responsável',        hidden: false, required: false, order: 4, help_text: '', system: false },
      { field_key: 'der_date',     label: 'Data DER',           hidden: false, required: false, order: 5, help_text: '', system: false },
      { field_key: 'client',       label: 'Cliente',            hidden: false, required: true,  order: 6, help_text: '', system: true },
      { field_key: 'notes',        label: 'Observações',        hidden: false, required: false, order: 7, help_text: '', system: false },
    ],
  },
  {
    module_key: 'leads',
    label: 'Leads',
    fields: [
      { field_key: 'name',   label: 'Nome',        hidden: false, required: true,  order: 1, help_text: '', system: true },
      { field_key: 'email',  label: 'E-mail',      hidden: false, required: false, order: 2, help_text: '', system: false },
      { field_key: 'phone',  label: 'Telefone',    hidden: false, required: false, order: 3, help_text: '', system: false },
      { field_key: 'source', label: 'Origem',      hidden: false, required: false, order: 4, help_text: '', system: false },
      { field_key: 'notes',  label: 'Observações', hidden: false, required: false, order: 5, help_text: '', system: false },
    ],
  },
  {
    module_key: 'calendar',
    label: 'Agenda / Compromissos',
    fields: [
      { field_key: 'title',       label: 'Título',          hidden: false, required: true,  order: 1, help_text: '', system: true },
      { field_key: 'event_type',  label: 'Tipo',            hidden: false, required: false, order: 2, help_text: '', system: false },
      { field_key: 'start',       label: 'Data e hora',     hidden: false, required: true,  order: 3, help_text: '', system: true },
      { field_key: 'responsible', label: 'Responsável',     hidden: false, required: false, order: 4, help_text: '', system: false },
      { field_key: 'client',      label: 'Cliente',         hidden: false, required: false, order: 5, help_text: '', system: false },
      { field_key: 'process',     label: 'Processo',        hidden: false, required: false, order: 6, help_text: '', system: false },
      { field_key: 'location',    label: 'Local / Link',    hidden: false, required: false, order: 7, help_text: '', system: false },
      { field_key: 'notes',       label: 'Observações',     hidden: false, required: false, order: 8, help_text: '', system: false },
    ],
  },
];

// ── Responsável por módulo ────────────────────────────────────────────────

export type ResponsibilityAllowed = 'all' | 'lawyers' | 'single';
export type ResponsibilityDefault = 'none' | 'creator' | 'single';
export type ResponsibilityNotify = 'responsible' | 'admin' | 'all';

export interface ModuleResponsibilityConfig {
  module:           string;
  label:            string;
  allowed:          ResponsibilityAllowed;
  single_member_id: string | null;
  default_mode:     ResponsibilityDefault;
  notify:           ResponsibilityNotify;
}

export const RESPONSIBILITY_MODULE_KEYS: { key: string; label: string }[] = [
  { key: 'processes',    label: 'Processos' },
  { key: 'deadlines',    label: 'Prazos' },
  { key: 'tasks',        label: 'Tarefas' },
  { key: 'requirements', label: 'Requerimentos (INSS)' },
  { key: 'calendar',     label: 'Agenda / Compromissos' },
  { key: 'leads',        label: 'Leads' },
  { key: 'financial',    label: 'Financeiro' },
];

export const RESPONSIBILITY_DEFAULTS: ModuleResponsibilityConfig[] = RESPONSIBILITY_MODULE_KEYS.map(m => ({
  module:           m.key,
  label:            m.label,
  allowed:          'all',
  single_member_id: null,
  default_mode:     'creator',
  notify:           'responsible',
}));

// ── Gateway de Pagamento ──────────────────────────────────────────────────

export type PaymentGatewayId = 'stripe' | 'pagarme' | 'mercadopago' | 'asaas' | 'iugu';
export type PaymentGatewayMode = 'sandbox' | 'production';

export const PAYMENT_GATEWAY_LABELS: Record<PaymentGatewayId, string> = {
  stripe:       'Stripe',
  pagarme:      'Pagar.me',
  mercadopago:  'Mercado Pago',
  asaas:        'ASAAS',
  iugu:         'Iugu',
};

export interface PaymentGatewayConfig {
  gateway:         PaymentGatewayId;
  mode:            PaymentGatewayMode;
  public_key:      string;
  secret_key_hint: string; // last 4 chars only — full key stored in env
  methods_pix:     boolean;
  methods_boleto:  boolean;
  methods_card:    boolean;
}

export const PAYMENT_GATEWAY_DEFAULTS: PaymentGatewayConfig = {
  gateway:         'stripe',
  mode:            'sandbox',
  public_key:      '',
  secret_key_hint: '',
  methods_pix:     true,
  methods_boleto:  true,
  methods_card:    true,
};

// ── Automações & Cron ─────────────────────────────────────────────────────

export interface AutomationThresholds {
  /** Dias após DER para marcar requerimento como "alta urgência" */
  requirement_alert_days: number;
  /** Dias após DER para marcar requerimento como "urgência crítica" */
  requirement_critical_days: number;
  /** Minutos antes do compromisso para enviar lembrete */
  appointment_remind_minutes: number;
  /** Tamanho do lote ao processar requerimentos no cron (limit) */
  requirement_batch_size: number;
}

export const AUTOMATION_THRESHOLDS_DEFAULTS: AutomationThresholds = {
  requirement_alert_days:      90,
  requirement_critical_days:   120,
  appointment_remind_minutes:  60,
  requirement_batch_size:      200,
};

export interface CronJobInfo {
  key: string;
  label: string;
  description: string;
  source: string;
}

export interface CronJobLatest {
  job_name: string;
  last_run_at: string | null;
  status: 'running' | 'success' | 'failed' | null;
  duration_ms: number | null;
  error: string | null;
}

export interface Holiday {
  id: string;
  date: string; // 'YYYY-MM-DD'
  name: string;
  type: 'nacional' | 'estadual' | 'municipal' | 'facultativo';
  state: string | null;
  city: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SecretEntry {
  id: string;
  key_name: string;
  description: string | null;
  provider: string;
  env_var_name: string | null;
  category: 'api_key' | 'webhook' | 'oauth' | 'smtp' | 'other';
  status: 'configured' | 'unconfigured' | 'error' | 'revoked';
  last_tested_at: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const KNOWN_CRON_JOBS: CronJobInfo[] = [
  { key: 'notification-scheduler',          label: 'Lembretes & Alertas',         description: 'Envia lembretes de prazo, compromisso e marcos de requerimento.',   source: 'notification-scheduler/' },
  { key: 'weekly-digest',                   label: 'Digest Semanal',              description: 'Compila e envia o resumo semanal por e-mail.',                      source: 'weekly-digest/' },
  { key: 'run-djen-sync',                   label: 'Sincronização DJEN',          description: 'Busca novas intimações do Diário de Justiça Eletrônico.',            source: 'run-djen-sync/' },
  { key: 'datajud-sync',                    label: 'Sincronização DataJud',       description: 'Atualiza movimentos e status dos processos via API do CNJ.',        source: 'datajud-sync/' },
  { key: 'convert-prescription-deadlines',  label: 'Conversão de Prescrições',    description: 'Converte prazos de prescrição gerados em prazos do sistema.',       source: 'convert-prescription-deadlines/' },
  { key: 'sync-emails',                     label: 'Sync de E-mails',             description: 'Sincroniza e-mails recebidos/enviados via Resend.',                 source: 'sync-emails/' },
];

class SettingsService {
  // Cache do flag audit_log_enabled para evitar query extra em cada logAudit.
  // Invalidado em updateSecurityConfig.
  private _auditEnabled: boolean | null = null;

  // ==================== CONFIGURAÇÕES DO SISTEMA ====================

  /**
   * Busca todas as configurações
   */
  async getAllSettings(): Promise<SystemSetting[]> {
    const { data, error } = await supabase
      .from('system_settings')
      .select('*')
      .order('category');

    if (error) {
      console.error('Erro ao buscar configurações:', error);
      throw new Error(error.message);
    }

    return data || [];
  }

  /**
   * Busca uma configuração específica por chave
   */
  async getSetting<T>(key: string): Promise<T | null> {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') return null;
      return null; // silencia erros de chave não encontrada
    }

    return data?.value as T ?? null;
  }

  /**
   * Atualiza uma configuração
   */
  async updateSetting<T>(key: string, value: T, userName?: string): Promise<void> {
    // Buscar valor antigo para auditoria
    const oldValue = await this.getSetting(key);

    const { error } = await supabase
      .from('system_settings')
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );

    if (error) {
      console.error('Erro ao atualizar configuração:', error);
      throw new Error(error.message);
    }

    // Registrar auditoria
    await this.logAudit({
      action: 'update',
      entity_type: 'system_settings',
      entity_id: key,
      old_value: oldValue,
      new_value: value,
      user_name: userName,
    });
  }

  /**
   * Busca configurações de identidade do escritório
   */
  async getOfficeIdentity(): Promise<OfficeIdentity> {
    const value = await this.getSetting<OfficeIdentity>('office_identity');
    return value || {
      name: '',
      email: '',
      phone: '',
      address: '',
      address_cep: '',
      address_street: '',
      address_number: '',
      address_neighborhood: '',
      address_city: '',
      address_state: '',
      cnpj: '',
      oab_state: '',
      oab_number: '',
      logo_url: '',
    };
  }

  /**
   * Atualiza configurações de identidade
   */
  async updateOfficeIdentity(identity: OfficeIdentity, userName?: string): Promise<void> {
    await this.updateSetting('office_identity', identity, userName);
  }

  /**
   * Busca configurações do DJEN
   */
  async getDjenConfig(): Promise<DjenConfig> {
    const value = await this.getSetting<DjenConfig>('djen_config');
    return value || {
      auto_sync: true,
      sync_interval_hours: 24,
      default_tribunal: 'all',
      search_days_back: 30,
      api_timeout_seconds: 30,
      max_retries: 3,
      lawyers_to_monitor: [],
    };
  }

  /**
   * Atualiza configurações do DJEN
   */
  async updateDjenConfig(config: DjenConfig, userName?: string): Promise<void> {
    await this.updateSetting('djen_config', config, userName);
  }

  // ── Chave pública DataJud (CNJ) ────────────────────────────────────────────

  /** Chave pública CNJ padrão (fallback quando nenhuma configurada) */
  readonly DATAJUD_DEFAULT_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

  async getDatajudKeyConfig(): Promise<DatajudKeyConfig> {
    const value = await this.getSetting<DatajudKeyConfig>('datajud_key_config');
    return value ?? { key: this.DATAJUD_DEFAULT_KEY, invalid: false, invalid_since: null };
  }

  async setDatajudKey(key: string, userName?: string): Promise<void> {
    const current = await this.getDatajudKeyConfig();
    await this.updateSetting<DatajudKeyConfig>(
      'datajud_key_config',
      { ...current, key: key.trim(), invalid: false, invalid_since: null },
      userName,
    );
  }

  /** Chamado automaticamente pelo datajud.service quando recebe 401/403 */
  async markDatajudKeyInvalid(): Promise<void> {
    const current = await this.getDatajudKeyConfig();
    if (current.invalid) return; // já marcado, evita loop
    await this.updateSetting<DatajudKeyConfig>('datajud_key_config', {
      ...current,
      invalid: true,
      invalid_since: current.invalid_since ?? new Date().toISOString(),
    });
  }

  async clearDatajudKeyInvalid(): Promise<void> {
    const current = await this.getDatajudKeyConfig();
    await this.updateSetting<DatajudKeyConfig>('datajud_key_config', {
      ...current,
      invalid: false,
      invalid_since: null,
    });
  }

  /**
   * Busca configurações de notificações
   */
  async getNotificationConfig(): Promise<NotificationConfig> {
    const value = await this.getSetting<NotificationConfig>('notification_config');
    return value || {
      email_enabled: true,
      push_enabled: true,
      whatsapp_enabled: false,
      deadline_reminder_days: [1, 3, 7],
      new_intimation_alert: true,
      daily_digest: false,
      digest_time: '08:00',
      weekly_digest: false,
      weekly_digest_day: 0,
      weekly_digest_hour: '08:00',
      weekly_digest_resend_key: '',
    };
  }

  /**
   * Atualiza configurações de notificações
   */
  async updateNotificationConfig(config: NotificationConfig, userName?: string): Promise<void> {
    await this.updateSetting('notification_config', config, userName);
  }

  /**
   * Busca preferências operacionais
   */
  async getPreferences(): Promise<Preferences> {
    const value = await this.getSetting<Preferences>('preferences');
    return value || {
      timezone: 'America/Sao_Paulo',
      date_format: 'DD/MM/YYYY',
      currency: 'BRL',
      default_deadline_days: 15,
      business_hours_start: '08:00',
      business_hours_end: '18:00',
      work_days: [1, 2, 3, 4, 5],
    };
  }

  /**
   * Atualiza preferências operacionais
   */
  async updatePreferences(prefs: Preferences, userName?: string): Promise<void> {
    await this.updateSetting('preferences', prefs, userName);
  }

  /**
   * Busca configurações de segurança
   */
  async getSecurityConfig(): Promise<SecurityConfig> {
    const value = await this.getSetting<SecurityConfig>('security_config');
    const defaults = {
      session_timeout_hours: 6,
      require_2fa: false,
      password_min_length: 8,
      max_login_attempts: 5,
      audit_log_enabled: true,
      pin_session_minutes: 5,
      financial_view_hours: 2,
    };
    return value ? { ...defaults, ...value } : defaults;
  }

  /**
   * Atualiza configurações de segurança
   */
  async updateSecurityConfig(config: SecurityConfig, userName?: string): Promise<void> {
    this._auditEnabled = config.audit_log_enabled; // invalida cache imediatamente
    await this.updateSetting('security_config', config, userName);
  }

  /**
   * Busca configurações de módulos
   */
  async getModulesConfig(): Promise<ModulesConfig> {
    const value = await this.getSetting<ModulesConfig>('modules_config');
    return {
      leads_enabled: true,
      financial_enabled: true,
      requirements_enabled: true,
      documents_enabled: true,
      calendar_enabled: true,
      tasks_enabled: true,
      hidden_menu_modules: [],
      ...(value || {}),
    };
  }

  /**
   * Atualiza configurações de módulos
   */
  async updateModulesConfig(config: ModulesConfig, userName?: string): Promise<void> {
    await this.updateSetting('modules_config', config, userName);
  }

  /**
   * Busca configuração de submódulos do portal do cliente
   */
  async getPortalModulesConfig(): Promise<PortalModulesConfig> {
    const value = await this.getSetting<PortalModulesConfig>('portal_modules_config');
    return { ...PORTAL_MODULES_DEFAULT, ...(value || {}) };
  }

  /**
   * Salva configuração de submódulos do portal do cliente
   */
  async savePortalModulesConfig(config: PortalModulesConfig, userName?: string): Promise<void> {
    await this.updateSetting('portal_modules_config', config, userName);
  }

  async getFinancialModuleConfig(): Promise<FinancialModuleConfig> {
    const stored = await this.getSetting<FinancialModuleConfig>('financial_module_config');
    return { ...FINANCIAL_MODULE_DEFAULTS, ...(stored || {}) };
  }

  async updateFinancialModuleConfig(config: FinancialModuleConfig, userName?: string): Promise<void> {
    await this.updateSetting('financial_module_config', config, userName);
  }

  async getEmailIntegrationConfig(): Promise<EmailIntegrationConfig> {
    const stored = await this.getSetting<EmailIntegrationConfig>('email_integration_config');
    if (stored?.resend_key) return { ...EMAIL_INTEGRATION_DEFAULTS, ...stored };
    // migrar chave legada de notification_config
    const notif = await this.getNotificationConfig();
    return { ...EMAIL_INTEGRATION_DEFAULTS, ...(stored || {}), resend_key: notif.weekly_digest_resend_key || '' };
  }

  async updateEmailIntegrationConfig(config: EmailIntegrationConfig, userName?: string): Promise<void> {
    await this.updateSetting('email_integration_config', config, userName);
    // manter weekly_digest_resend_key sincronizado para a edge function weekly-digest
    const notif = await this.getNotificationConfig();
    await this.updateSetting('notification_config', { ...notif, weekly_digest_resend_key: config.resend_key }, userName);
  }

  async getWhatsAppEvolutionConfig(): Promise<WhatsAppEvolutionConfig> {
    const stored = await this.getSetting<WhatsAppEvolutionConfig>('whatsapp_evolution_config');
    return { ...WHATSAPP_EVOLUTION_DEFAULTS, ...(stored || {}) };
  }

  async updateWhatsAppEvolutionConfig(config: WhatsAppEvolutionConfig, userName?: string): Promise<void> {
    await this.updateSetting('whatsapp_evolution_config', config, userName);
  }

  async getNotificationRules(): Promise<NotificationRule[]> {
    const stored = await this.getSetting<NotificationRule[]>('notification_rules');
    if (stored?.length) return stored;
    return DEFAULT_NOTIFICATION_RULES.map(r => ({ ...r }));
  }

  async updateNotificationRules(rules: NotificationRule[], userName?: string): Promise<void> {
    await this.updateSetting('notification_rules', rules, userName);
  }

  async getProcessModuleConfig(): Promise<ProcessModuleConfig> {
    const stored = await this.getSetting<ProcessModuleConfig>('process_module_config');
    if (!stored) return { ...PROCESS_MODULE_DEFAULTS };
    return {
      ...PROCESS_MODULE_DEFAULTS,
      ...stored,
      statuses:       stored.statuses?.length       ? stored.statuses       : PROCESS_MODULE_DEFAULTS.statuses,
      practice_areas: stored.practice_areas?.length ? stored.practice_areas : PROCESS_MODULE_DEFAULTS.practice_areas,
    };
  }

  async updateProcessModuleConfig(config: ProcessModuleConfig, userName?: string): Promise<void> {
    await this.updateSetting('process_module_config', config, userName);
  }

  async getDeadlineModuleConfig(): Promise<DeadlineModuleConfig> {
    const stored = await this.getSetting<DeadlineModuleConfig>('deadline_module_config');
    if (!stored) return { ...DEADLINE_MODULE_DEFAULTS };
    return {
      ...DEADLINE_MODULE_DEFAULTS,
      ...stored,
      statuses:   stored.statuses?.length   ? stored.statuses   : DEADLINE_MODULE_DEFAULTS.statuses,
      priorities: stored.priorities?.length ? stored.priorities : DEADLINE_MODULE_DEFAULTS.priorities,
      types:      stored.types?.length      ? stored.types      : DEADLINE_MODULE_DEFAULTS.types,
    };
  }

  async updateDeadlineModuleConfig(config: DeadlineModuleConfig, userName?: string): Promise<void> {
    await this.updateSetting('deadline_module_config', config, userName);
  }

  async getSignatureModuleConfig(): Promise<SignatureModuleConfig> {
    const stored = await this.getSetting<SignatureModuleConfig>('signature_module_config');
    if (!stored) return { ...SIGNATURE_MODULE_DEFAULTS, signer_roles: [...SIGNATURE_MODULE_DEFAULTS.signer_roles], auth_methods: [...SIGNATURE_MODULE_DEFAULTS.auth_methods] };
    return { ...SIGNATURE_MODULE_DEFAULTS, ...stored };
  }

  async updateSignatureModuleConfig(config: SignatureModuleConfig, userName?: string): Promise<void> {
    await this.updateSetting('signature_module_config', config, userName);
  }

  async getTaskModuleConfig(): Promise<TaskModuleConfig> {
    const stored = await this.getSetting<TaskModuleConfig>('task_module_config');
    if (!stored) return { priorities: TASK_MODULE_DEFAULTS.priorities.map(p => ({ ...p })) };
    return { priorities: stored.priorities?.length ? stored.priorities : TASK_MODULE_DEFAULTS.priorities.map(p => ({ ...p })) };
  }

  async updateTaskModuleConfig(config: TaskModuleConfig, userName?: string): Promise<void> {
    await this.updateSetting('task_module_config', config, userName);
  }

  async getClientModuleConfig(): Promise<ClientModuleConfig> {
    const stored = await this.getSetting<ClientModuleConfig>('client_module_config');
    if (!stored) return { statuses: CLIENT_MODULE_DEFAULTS.statuses.map(s => ({ ...s })), marital_statuses: CLIENT_MODULE_DEFAULTS.marital_statuses.map(m => ({ ...m })) };
    return {
      statuses:         stored.statuses?.length         ? stored.statuses         : CLIENT_MODULE_DEFAULTS.statuses.map(s => ({ ...s })),
      marital_statuses: stored.marital_statuses?.length ? stored.marital_statuses : CLIENT_MODULE_DEFAULTS.marital_statuses.map(m => ({ ...m })),
    };
  }

  async updateClientModuleConfig(config: ClientModuleConfig, userName?: string): Promise<void> {
    await this.updateSetting('client_module_config', config, userName);
  }

  async getPortalCustomizationConfig(): Promise<PortalCustomizationConfig> {
    const stored = await this.getSetting<PortalCustomizationConfig>('portal_customization_config');
    return { ...PORTAL_CUSTOMIZATION_DEFAULTS, ...(stored ?? {}) };
  }

  async updatePortalCustomizationConfig(config: PortalCustomizationConfig, userName?: string): Promise<void> {
    await this.updateSetting('portal_customization_config', config, userName);
  }

  async getPortalClientNotificationsConfig(): Promise<PortalClientNotificationsConfig> {
    const stored = await this.getSetting<PortalClientNotificationsConfig>('portal_client_notifications_config');
    return { ...PORTAL_CLIENT_NOTIF_DEFAULTS, ...(stored ?? {}) };
  }

  async updatePortalClientNotificationsConfig(config: PortalClientNotificationsConfig, userName?: string): Promise<void> {
    await this.updateSetting('portal_client_notifications_config', config, userName);
  }

  async getAiPromptOverrides(): Promise<AiPromptOverride[]> {
    const stored = await this.getSetting<AiPromptOverride[]>('ai_prompt_overrides');
    return stored ?? [];
  }

  async updateAiPromptOverrides(overrides: AiPromptOverride[], userName?: string): Promise<void> {
    await this.updateSetting('ai_prompt_overrides', overrides, userName);
  }

  async getAiProviderConfig(): Promise<AiProviderConfig> {
    const stored = await this.getSetting<AiProviderConfig>('ai_provider_config');
    if (!stored) return { ...AI_PROVIDER_DEFAULTS, enabled: { ...AI_PROVIDER_DEFAULTS.enabled }, fallback_order: [...AI_PROVIDER_DEFAULTS.fallback_order] };
    return { ...AI_PROVIDER_DEFAULTS, ...stored, enabled: { ...AI_PROVIDER_DEFAULTS.enabled, ...(stored.enabled ?? {}) } };
  }

  async updateAiProviderConfig(config: AiProviderConfig, userName?: string): Promise<void> {
    await this.updateSetting('ai_provider_config', config, userName);
  }

  async getAiTaskConfigs(): Promise<AiTaskConfig[]> {
    const stored = await this.getSetting<AiTaskConfig[]>('ai_task_configs');
    if (!stored?.length) return DEFAULT_AI_TASKS.map(t => ({ ...t }));
    // merge stored with defaults (stored wins, but new tasks from defaults are appended)
    const storedMap = new Map(stored.map(t => [t.task_key, t]));
    return DEFAULT_AI_TASKS.map(def => storedMap.get(def.task_key) ?? { ...def });
  }

  async updateAiTaskConfigs(configs: AiTaskConfig[], userName?: string): Promise<void> {
    await this.updateSetting('ai_task_configs', configs, userName);
  }

  async getRequirementModuleConfig(): Promise<RequirementModuleConfig> {
    const stored = await this.getSetting<RequirementModuleConfig>('requirement_module_config');
    if (!stored) return { statuses: REQUIREMENT_MODULE_DEFAULTS.statuses.map(s => ({ ...s })), benefit_types: REQUIREMENT_MODULE_DEFAULTS.benefit_types.map(b => ({ ...b })) };
    return {
      statuses:      stored.statuses?.length      ? stored.statuses      : REQUIREMENT_MODULE_DEFAULTS.statuses.map(s => ({ ...s })),
      benefit_types: stored.benefit_types?.length ? stored.benefit_types : REQUIREMENT_MODULE_DEFAULTS.benefit_types.map(b => ({ ...b })),
    };
  }

  async updateRequirementModuleConfig(config: RequirementModuleConfig, userName?: string): Promise<void> {
    await this.updateSetting('requirement_module_config', config, userName);
  }

  async getLeadModuleConfig(): Promise<LeadModuleConfig> {
    const stored = await this.getSetting<LeadModuleConfig>('lead_module_config');
    if (!stored) return { ...LEAD_MODULE_DEFAULTS, stages: LEAD_MODULE_DEFAULTS.stages.map(s => ({ ...s })), sources: [...LEAD_MODULE_DEFAULTS.sources] };
    return {
      ...LEAD_MODULE_DEFAULTS,
      ...stored,
      stages:  stored.stages?.length  ? stored.stages  : LEAD_MODULE_DEFAULTS.stages.map(s => ({ ...s })),
      sources: stored.sources?.length ? stored.sources : [...LEAD_MODULE_DEFAULTS.sources],
    };
  }

  async updateLeadModuleConfig(config: LeadModuleConfig, userName?: string): Promise<void> {
    await this.updateSetting('lead_module_config', config, userName);
  }

  async getCalendarModuleConfig(): Promise<CalendarModuleConfig> {
    const stored = await this.getSetting<CalendarModuleConfig>('calendar_module_config');
    if (!stored) return { ...CALENDAR_MODULE_DEFAULTS, event_types: CALENDAR_MODULE_DEFAULTS.event_types.map(t => ({ ...t })) };
    return {
      ...CALENDAR_MODULE_DEFAULTS,
      ...stored,
      event_types: stored.event_types?.length ? stored.event_types : CALENDAR_MODULE_DEFAULTS.event_types.map(t => ({ ...t })),
    };
  }

  async updateCalendarModuleConfig(config: CalendarModuleConfig, userName?: string): Promise<void> {
    await this.updateSetting('calendar_module_config', config, userName);
  }

  async getEmailTemplates(): Promise<EmailTemplate[]> {
    const stored = await this.getSetting<EmailTemplate[]>('email_templates');
    if (stored?.length) return stored;
    return DEFAULT_EMAIL_TEMPLATES.map(t => ({ ...t }));
  }

  async updateEmailTemplates(templates: EmailTemplate[], userName?: string): Promise<void> {
    await this.updateSetting('email_templates', templates, userName);
  }

  // ==================== CONSTRUTOR DE FORMULÁRIOS ====================

  async getFormLayouts(): Promise<FormLayoutModule[]> {
    const stored = await this.getSetting<Record<string, FormFieldConfig[]>>('form_layouts');
    if (!stored) return CANONICAL_FORM_FIELDS.map(m => ({ ...m, fields: m.fields.map(f => ({ ...f })) }));
    return CANONICAL_FORM_FIELDS.map(m => {
      const overrides = stored[m.module_key];
      if (!overrides?.length) return { ...m, fields: m.fields.map(f => ({ ...f })) };
      const overrideMap = new Map(overrides.map(f => [f.field_key, f]));
      const merged = m.fields.map(canonical => {
        const ov = overrideMap.get(canonical.field_key);
        return ov ? { ...canonical, ...ov, system: canonical.system } : { ...canonical };
      });
      return { ...m, fields: merged };
    });
  }

  async updateFormLayouts(layouts: FormLayoutModule[], userName?: string): Promise<void> {
    const stored: Record<string, FormFieldConfig[]> = {};
    for (const m of layouts) { stored[m.module_key] = m.fields; }
    await this.updateSetting('form_layouts', stored, userName);
  }

  // ==================== RESPONSÁVEL POR MÓDULO ====================

  async getResponsibilityConfig(): Promise<ModuleResponsibilityConfig[]> {
    const stored = await this.getSetting<ModuleResponsibilityConfig[]>('responsibility_config');
    if (!stored?.length) return RESPONSIBILITY_DEFAULTS.map(r => ({ ...r }));
    const storedMap = new Map(stored.map(r => [r.module, r]));
    return RESPONSIBILITY_DEFAULTS.map(def => storedMap.get(def.module) ?? { ...def });
  }

  async updateResponsibilityConfig(config: ModuleResponsibilityConfig[], userName?: string): Promise<void> {
    await this.updateSetting('responsibility_config', config, userName);
  }

  // ==================== GATEWAY DE PAGAMENTO ====================

  async getPaymentGatewayConfig(): Promise<PaymentGatewayConfig> {
    const stored = await this.getSetting<PaymentGatewayConfig>('payment_gateway_config');
    if (!stored) return { ...PAYMENT_GATEWAY_DEFAULTS };
    return { ...PAYMENT_GATEWAY_DEFAULTS, ...stored };
  }

  async updatePaymentGatewayConfig(config: PaymentGatewayConfig, userName?: string): Promise<void> {
    await this.updateSetting('payment_gateway_config', config, userName);
  }

  // ==================== AUTOMAÇÕES ====================

  async getAutomationThresholds(): Promise<AutomationThresholds> {
    const stored = await this.getSetting<AutomationThresholds>('automation_thresholds');
    if (!stored) return { ...AUTOMATION_THRESHOLDS_DEFAULTS };
    return { ...AUTOMATION_THRESHOLDS_DEFAULTS, ...stored };
  }

  async updateAutomationThresholds(config: AutomationThresholds, userName?: string): Promise<void> {
    await this.updateSetting('automation_thresholds', config, userName);
  }

  async getCronJobLatest(): Promise<CronJobLatest[]> {
    const { data, error } = await supabase.rpc('get_cron_job_latest');
    if (error) return [];
    return (data as CronJobLatest[]) || [];
  }

  async getHolidays(year?: number): Promise<Holiday[]> {
    const { data, error } = await supabase.rpc('get_holidays', { p_year: year ?? null });
    if (error) return [];
    return (data as Holiday[]) || [];
  }

  async upsertHoliday(holiday: Omit<Holiday, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    await supabase.from('holidays').upsert({
      ...holiday,
      updated_at: new Date().toISOString(),
    });
  }

  async deleteHoliday(id: string): Promise<void> {
    await supabase.from('holidays').delete().eq('id', id);
  }

  async getSecretsRegistry(): Promise<SecretEntry[]> {
    const { data, error } = await supabase
      .from('secrets_registry')
      .select('*')
      .eq('is_active', true)
      .order('provider');
    if (error) return [];
    return (data as SecretEntry[]) || [];
  }

  async updateSecretStatus(id: string, status: SecretEntry['status'], notes?: string): Promise<void> {
    await supabase.from('secrets_registry').update({
      status,
      ...(notes !== undefined ? { notes } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', id);
  }

  async upsertSecret(entry: Omit<SecretEntry, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    await supabase.from('secrets_registry').upsert({
      ...entry,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key_name' });
  }

  // ==================== PERMISSÕES ====================

  /**
   * Busca todas as permissões
   */
  async getAllPermissions(): Promise<RolePermission[]> {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('*')
      .order('role')
      .order('module');

    if (error) {
      console.error('Erro ao buscar permissões:', error);
      throw new Error(error.message);
    }

    return data || [];
  }

  /**
   * Busca permissões de um papel específico
   */
  async getPermissionsByRole(role: string): Promise<RolePermission[]> {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('*')
      .eq('role', role.toLowerCase())
      .order('module');

    if (error) {
      console.error('Erro ao buscar permissões do papel:', error);
      throw new Error(error.message);
    }

    return data || [];
  }

  /**
   * Atualiza uma permissão específica
   */
  async updatePermission(
    role: string, 
    module: string, 
    permissions: { can_view?: boolean; can_create?: boolean; can_edit?: boolean; can_delete?: boolean },
    userName?: string
  ): Promise<void> {
    // Buscar permissão atual
    const { data: current } = await supabase
      .from('role_permissions')
      .select('*')
      .eq('role', role.toLowerCase())
      .eq('module', module)
      .single();

    const { error } = await supabase
      .from('role_permissions')
      .upsert({
        role: role.toLowerCase(),
        module,
        can_view: permissions.can_view ?? current?.can_view ?? false,
        can_create: permissions.can_create ?? current?.can_create ?? false,
        can_edit: permissions.can_edit ?? current?.can_edit ?? false,
        can_delete: permissions.can_delete ?? current?.can_delete ?? false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'role,module' });

    if (error) {
      console.error('Erro ao atualizar permissão:', error);
      throw new Error(error.message);
    }

    // Registrar auditoria
    await this.logAudit({
      action: 'update_permission',
      entity_type: 'role_permissions',
      entity_id: `${role}:${module}`,
      old_value: current,
      new_value: permissions,
      user_name: userName,
    });
  }

  /**
   * Atualiza todas as permissões de um papel
   */
  async updateRolePermissions(
    role: string, 
    permissions: Array<{ module: string; can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean }>,
    userName?: string
  ): Promise<void> {
    const updates = permissions.map(p => ({
      role: role.toLowerCase(),
      module: p.module,
      can_view: p.can_view,
      can_create: p.can_create,
      can_edit: p.can_edit,
      can_delete: p.can_delete,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('role_permissions')
      .upsert(updates, { onConflict: 'role,module' });

    if (error) {
      console.error('Erro ao atualizar permissões do papel:', error);
      throw new Error(error.message);
    }

    // Registrar auditoria
    await this.logAudit({
      action: 'update_role_permissions',
      entity_type: 'role_permissions',
      entity_id: role,
      new_value: permissions,
      user_name: userName,
    });
  }

  /**
   * Verifica se um papel tem permissão para uma ação em um módulo
   */
  async checkPermission(role: string, module: string, action: 'view' | 'create' | 'edit' | 'delete'): Promise<boolean> {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('*')
      .eq('role', role.toLowerCase())
      .eq('module', module)
      .single();

    if (error || !data) return false;

    switch (action) {
      case 'view': return data.can_view;
      case 'create': return data.can_create;
      case 'edit': return data.can_edit;
      case 'delete': return data.can_delete;
      default: return false;
    }
  }

  // ==================== AUDITORIA ====================

  /**
   * Registra uma entrada no log de auditoria
   */
  async logAudit(entry: {
    action: string;
    entity_type: string;
    entity_id?: string;
    old_value?: any;
    new_value?: any;
    user_name?: string;
  }): Promise<void> {
    try {
      // Respeita o toggle audit_log_enabled da SecurityConfig (carregado com cache).
      if (this._auditEnabled === null) {
        const cfg = await this.getSecurityConfig();
        this._auditEnabled = cfg.audit_log_enabled;
      }
      if (!this._auditEnabled) return;

      const { data: { user } } = await supabase.auth.getUser();

      await supabase.from('audit_log').insert({
        user_id: user?.id,
        user_name: entry.user_name || user?.email,
        action: entry.action,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        old_value: entry.old_value,
        new_value: entry.new_value,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      });
    } catch (err) {
      console.error('Erro ao registrar auditoria:', err);
      // Não lançar erro para não interromper a operação principal
    }
  }

  /**
   * Busca log de auditoria com filtros
   */
  async getAuditLog(filters?: {
    entity_type?: string;
    entity_id?: string;
    user_id?: string;
    action?: string;
    user_name?: string;
    client_id?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
  }): Promise<AuditLogEntry[]> {
    let query = supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.entity_type) query = query.eq('entity_type', filters.entity_type);
    if (filters?.entity_id)   query = query.eq('entity_id', filters.entity_id);
    if (filters?.user_id)     query = query.eq('user_id', filters.user_id);
    if (filters?.action)      query = query.eq('action', filters.action);
    if (filters?.user_name)   query = query.ilike('user_name', `%${filters.user_name}%`);
    if (filters?.client_id)   query = (query as any).or(`entity_id.eq.${filters.client_id},new_value->>client_id.eq.${filters.client_id}`);
    if (filters?.date_from)   query = query.gte('created_at', filters.date_from);
    if (filters?.date_to)     query = query.lte('created_at', filters.date_to + 'T23:59:59.999Z');
    if (filters?.limit)       query = query.limit(filters.limit);
    if (filters?.offset != null && filters.offset > 0) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 25) - 1);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao buscar log de auditoria:', error);
      throw new Error(error.message);
    }

    return data || [];
  }

  async getAuditLogCount(filters?: {
    action?: string;
    entity_type?: string;
    user_name?: string;
    client_id?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<number> {
    let query = supabase
      .from('audit_log')
      .select('id', { count: 'exact', head: true });

    if (filters?.action)      query = (query as any).eq('action', filters.action);
    if (filters?.entity_type) query = (query as any).eq('entity_type', filters.entity_type);
    if (filters?.user_name)   query = (query as any).ilike('user_name', `%${filters.user_name}%`);
    if (filters?.client_id)   query = (query as any).or(`entity_id.eq.${filters.client_id},new_value->>client_id.eq.${filters.client_id}`);
    if (filters?.date_from)   query = (query as any).gte('created_at', filters.date_from);
    if (filters?.date_to)     query = (query as any).lte('created_at', filters.date_to + 'T23:59:59.999Z');

    const { count, error } = await query;
    if (error) return 0;
    return count ?? 0;
  }

  // Retorna eventos de assinatura normalizados para o mesmo formato do audit_log
  async getSignatureAuditLog(filters?: {
    date_from?: string;
    date_to?: string;
    limit?: number;
  }): Promise<AuditLogEntry[]> {
    let query = supabase
      .from('signature_audit_log')
      .select(`
        id, action, description, ip_address, user_agent, created_at,
        signature_request_id,
        signature_signers(name),
        signature_requests(document_name, client_name, client_id, process_number)
      `)
      .order('created_at', { ascending: false });

    if (filters?.date_from) query = (query as any).gte('created_at', filters.date_from);
    if (filters?.date_to)   query = (query as any).lte('created_at', filters.date_to + 'T23:59:59.999Z');
    if (filters?.limit)     query = (query as any).limit(filters.limit);

    const { data, error } = await query;
    if (error) return [];

    return (data || []).map((row: any) => ({
      id: `sig_${row.id}`,
      user_id: null,
      user_name: row.signature_signers?.name ?? null,
      action: row.action,
      entity_type: 'signature_request',
      entity_id: row.signature_request_id,
      old_value: null,
      new_value: {
        _source: 'signature_audit_log',
        description: row.description,
        document_name: row.signature_requests?.document_name ?? null,
        client_name: row.signature_requests?.client_name ?? null,
        client_id: row.signature_requests?.client_id ?? null,
        process_number: row.signature_requests?.process_number ?? null,
        ip_address: row.ip_address,
      },
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      created_at: row.created_at,
    }));
  }

  // Retorna contexto de installments (valor, parcela, cliente) para enriquecer o audit
  async getInstallmentContext(ids: string[]): Promise<Map<string, { value: number; installment_number: number; due_date: string; client_name: string | null }>> {
    const map = new Map<string, { value: number; installment_number: number; due_date: string; client_name: string | null }>();
    if (!ids.length) return map;

    const { data: installments } = await supabase
      .from('installments')
      .select('id, value, installment_number, due_date, agreement_id')
      .in('id', ids);

    if (!installments?.length) return map;

    const agreementIds = [...new Set(installments.map((i: any) => i.agreement_id).filter(Boolean))];
    const { data: agreements } = await supabase
      .from('agreements')
      .select('id, client_id')
      .in('id', agreementIds);

    const clientIds = [...new Set((agreements || []).map((a: any) => a.client_id).filter(Boolean))];
    const { data: clients } = await supabase
      .from('clients')
      .select('id, full_name')
      .in('id', clientIds);

    const agreementToClient = new Map<string, string>();
    for (const a of agreements || []) {
      const client = (clients || []).find((c: any) => c.id === a.client_id);
      if (client) agreementToClient.set(a.id, client.full_name);
    }

    for (const inst of installments) {
      map.set(inst.id, {
        value: inst.value,
        installment_number: inst.installment_number,
        due_date: inst.due_date,
        client_name: inst.agreement_id ? (agreementToClient.get(inst.agreement_id) ?? null) : null,
      });
    }

    return map;
  }

  // ==================== USUÁRIOS ====================

  /**
   * Lista todos os usuários com seus perfis
   */
  async listUsers(): Promise<any[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('Erro ao listar usuários:', error);
      throw new Error(error.message);
    }

    return data || [];
  }

  /**
   * Atualiza o papel de um usuário
   */
  async updateUserRole(userId: string, role: string, userName?: string): Promise<void> {
    // Buscar papel atual
    const { data: current } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', userId)
      .single();

    const { error } = await supabase
      .from('profiles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) {
      console.error('Erro ao atualizar papel do usuário:', error);
      throw new Error(error.message);
    }

    // Registrar auditoria
    await this.logAudit({
      action: 'update_user_role',
      entity_type: 'profiles',
      entity_id: userId,
      old_value: { role: current?.role },
      new_value: { role },
      user_name: userName,
    });
  }

  /**
   * Atualiza perfil de um usuário
   */
  async updateUserProfile(userId: string, profile: {
    name?: string;
    email?: string;
    cpf?: string;
    phone?: string;
    oab?: string;
    role?: string;
    lawyer_full_name?: string;
    avatar_url?: string;
    bio?: string;
  }, userName?: string): Promise<void> {
    const attempt = async (attemptProfile: typeof profile) => {
      const { error } = await supabase
        .from('profiles')
        .update({ ...attemptProfile, updated_at: new Date().toISOString() })
        .eq('user_id', userId);

      if (error) {
        console.error('Erro ao atualizar perfil:', error);
        throw new Error(error.message);
      }
    };

    try {
      await attempt(profile);
    } catch (err: any) {
      const message = String(err?.message || err || '');
      const shouldRetryWithoutCpf =
        message.includes("Could not find the 'cpf' column") ||
        message.includes('Could not find the "cpf" column') ||
        (message.includes('cpf') && message.includes('schema cache'));

      if (!shouldRetryWithoutCpf || profile.cpf === undefined) {
        throw err;
      }

      const { cpf: _cpf, ...profileWithoutCpf } = profile as any;
      await attempt(profileWithoutCpf);
    }

    // Registrar auditoria
    await this.logAudit({
      action: 'update_user_profile',
      entity_type: 'profiles',
      entity_id: userId,
      new_value: profile,
      user_name: userName,
    });
  }

  /**
   * Remove o perfil de um usuário do CRM (não remove a conta de autenticação)
   */
  async deleteUserProfile(userId: string, userName?: string): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) {
      console.error('Erro ao remover perfil:', error);
      throw new Error(error.message);
    }

    await this.logAudit({
      action: 'delete_user_profile',
      entity_type: 'profiles',
      entity_id: userId,
      user_name: userName,
    });
  }

  /** Bucket público para avatares */
  private avatarBucket = 'profile-avatars';
  
  /** Bucket público para perfil */
  private profileBucket = 'perfil';

  private async ensureAvatarBucket() {
    try {
      const { data } = await supabase.storage.getBucket(this.avatarBucket);
      if (data) return;

      await supabase.storage.createBucket(this.avatarBucket, {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
      });
    } catch (error) {
      console.warn('Não foi possível validar bucket de avatares:', error);
    }
  }

  private async ensureProfileBucket() {
    try {
      const { data } = await supabase.storage.getBucket(this.profileBucket);
      if (data) return;

      console.log('Criando bucket de perfil:', this.profileBucket);
      await supabase.storage.createBucket(this.profileBucket, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf', 'text/plain'],
      });
      console.log('Bucket de perfil criado com sucesso');
    } catch (error) {
      console.error('Erro ao criar bucket de perfil:', error);
      throw new Error(`Não foi possível criar o bucket de perfil: ${error}`);
    }
  }

  /**
   * Upload de avatar para o Storage do Supabase
   */
  async uploadUserAvatar(userId: string, file: File): Promise<string> {
    await this.ensureAvatarBucket();

    const extension = file.name.split('.').pop() || 'jpg';
    const path = `${userId}/${Date.now()}.${extension}`;

    const { error } = await supabase.storage
      .from(this.avatarBucket)
      .upload(path, file, {
        upsert: true,
        cacheControl: '3600',
        contentType: file.type,
      });

    if (error) {
      console.error('Erro ao enviar avatar:', error);
      throw new Error('Falha ao enviar imagem. Tente novamente.');
    }

    const { data } = supabase.storage.from(this.avatarBucket).getPublicUrl(path);
    return data.publicUrl;
  }

  /**
   * Garante que o bucket 'perfil' exista
   */
  async ensureProfileBucketExists(): Promise<void> {
    await this.ensureProfileBucket();
  }

  /**
   * Upload de arquivo para o bucket 'perfil'
   */
  async uploadToProfileBucket(filePath: string, file: File): Promise<string> {
    await this.ensureProfileBucket();

    const { error } = await supabase.storage
      .from(this.profileBucket)
      .upload(filePath, file, {
        upsert: true,
        cacheControl: '3600',
        contentType: file.type,
      });

    if (error) {
      console.error('Erro ao enviar arquivo para bucket perfil:', error);
      throw new Error('Falha ao enviar arquivo. Tente novamente.');
    }

    const { data } = supabase.storage.from(this.profileBucket).getPublicUrl(filePath);
    return data.publicUrl;
  }

  /**
   * Obtém URL pública de arquivo no bucket 'perfil'
   */
  getProfileBucketPublicUrl(filePath: string): string {
    const { data } = supabase.storage.from(this.profileBucket).getPublicUrl(filePath);
    return data.publicUrl;
  }
}

export const settingsService = new SettingsService();
