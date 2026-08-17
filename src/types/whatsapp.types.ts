export type WhatsAppDirection = 'in' | 'out';
/**
 * Os seis primeiros são os que o escritório envia e recebe o dia inteiro. Os
 * quatro últimos são tipos NATIVOS do WhatsApp que o painel não produz, só
 * recebe — e que até então caíam como texto vazio, virando bolha branca na
 * conversa (ver `wa-native-content.ts` no webhook). Cada um carrega o conteúdo
 * já legível em `content`; o tipo serve para a bolha escolher ícone e moldura.
 */
export type WhatsAppMsgType =
  | 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker'
  | 'contact' | 'location' | 'poll' | 'reaction' | 'interactive' | 'album' | 'unsupported';
export type WhatsAppMsgStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Alcance da exclusão, na mesma divisão do WhatsApp:
 *  - 'me'       — some só do CRM; o contato continua com a mensagem no aparelho.
 *                 Vale para qualquer mensagem, inclusive as recebidas.
 *  - 'everyone' — revogada também no aparelho do contato. Só para mensagem nossa
 *                 e dentro da janela que o WhatsApp aceita.
 */
export type WhatsAppDeleteScope = 'me' | 'everyone';
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
  client_name: string | null;            // nome do cadastro vinculado, resolvido no client (não é coluna)
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
  // Pausa a auto-mensagem de ausência (fora do horário) só nesta conversa; o
  // encerramento limpa o flag (volta ao normal no próximo contato).
  absence_suppressed: boolean;
  /**
   * Quando as duas mensagens automáticas saíram nesta conversa. O painel usa
   * essas marcas para NÃO contar um recado de secretária eletrônica como
   * resposta nossa no contador de encerramento (a mesma regra do banco).
   */
  absence_sent_at?: string | null;
  reopen_prompt_sent_at?: string | null;
  /**
   * Tira SÓ esta conversa do encerramento automático por inatividade do canal.
   * Como `absence_suppressed`, vale até o atendimento encerrar — a pausa não
   * sobrevive ao caso que a justificou.
   */
  auto_close_suppressed: boolean;
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
  /**
   * GIF: o WhatsApp converte GIF em mp4 e sinaliza `gifPlayback`. Sem guardar
   * essa marca, o GIF fica indistinguível de um vídeo curto e a conversa mostra
   * um play parado no lugar da animação.
   */
  is_animated?: boolean | null;
  /** Duração do áudio/vídeo em segundos, quando a Evolution informa. */
  media_duration_seconds?: number | null;
  reply_to_id: string | null;
  edited_at: string | null;
  status: WhatsAppMsgStatus;
  sender_user_id: string | null;
  wa_timestamp: string;
  created_at: string;
  /**
   * Mensagem apagada (soft delete). A linha continua no banco: a bolha vira o
   * aviso cinza "Mensagem apagada" e o conteúdo some da tela, mas quem apagou e
   * quando permanecem auditáveis.
   */
  deleted_at?: string | null;
  /** Quem apagou. Nulo COM `deleted_at` = quem apagou foi o próprio contato. */
  deleted_by?: string | null;
  /** 'me' = sumiu só no CRM; 'everyone' = revogada também no aparelho do contato. */
  deleted_scope?: WhatsAppDeleteScope | null;
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
  /**
   * Vídeo que na verdade é um GIF (seletor do Giphy). Faz o WhatsApp usar
   * `gifPlayback` e marca `is_animated` na linha: toca em laço, mudo e sem
   * controles, dos dois lados da conversa.
   */
  asGif?: boolean;
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
  /** Pré-cadastro (nome + telefone), ainda não é cliente. Ver `clients.is_pre_cadastro`. */
  is_pre_cadastro?: boolean | null;
}

/**
 * Uma linha da agenda da "Nova conversa" — um NÚMERO de um cliente, não uma
 * pessoa (quem tem celular e fixo aparece duas vezes, como no WhatsApp).
 *
 * O gêmeo estrutural disto é `ContactEntry`, em `components/whatsapp/contactBook.ts`.
 * São dois porque aquele módulo é puro por regra (sem import nenhum, para poder
 * ser testado); a tipagem estrutural do TypeScript faz os dois se encaixarem
 * sem conversão.
 */
export interface WhatsAppContactBookEntry {
  clientId: string;
  name: string;
  /** Só dígitos. */
  phone: string;
  phoneKind: 'mobile' | 'phone';
  doc: string | null;
  /** Foto de perfil que o WhatsApp mandou para este número, já assinada. */
  avatarUrl: string | null;
  isPreCadastro: boolean;
}

/** Canal = uma conexão/número na Evolution (whatsapp_instances). */
export type WhatsAppChannelVisibility = 'all' | 'restricted';

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
  /**
   * Encerramento automático por inatividade. Desligado por padrão: canal
   * servido por IA tem a própria escada de acompanhamento e não quer que o
   * silêncio entre um lembrete e outro seja lido como atendimento abandonado.
   */
  auto_close_enabled: boolean;
  /** Minutos de silêncio tolerados (qualquer lado da conversa reinicia a contagem). */
  auto_close_minutes: number;
  /** Despedida enviada antes de encerrar. Vazio = encerra sem avisar o cliente. */
  auto_close_message: string | null;
  /** Só encerra dentro do expediente — evita a despedida chegando de madrugada. */
  auto_close_business_hours_only: boolean;
  /** Fonte única de visibilidade usada pela inbox, nova conversa e funil de Leads. */
  visibility_mode: WhatsAppChannelVisibility;
  /** Recebe automaticamente mensagens de entrada quando a conversa ainda não tem responsável. */
  default_assignee_id?: string | null;
  /** O canal participa do quadro de Leads do WhatsApp. */
  funnel_enabled: boolean;
  /** Chave da etapa inicial deste canal. */
  funnel_initial_stage: string | null;
}

/** Etapa do funil comercial/jurídico pertencente a um canal do WhatsApp. */
export type WhatsAppFunnelStageActionType =
  | 'send_message'
  | 'transfer_to_user'
  | 'transfer_to_department'
  | 'close_conversation';

export interface WhatsAppFunnelStageAction {
  type: WhatsAppFunnelStageActionType;
  /** Destino da transferência (user_id ou department_id, conforme o tipo). */
  target?: string | null;
  /** Texto enviado; em encerramento, funciona como mensagem de despedida. */
  message?: string | null;
  /** Metadados internos, como motivo/observação da automação. */
  payload?: { reason?: string | null; note?: string | null } & Record<string, unknown>;
}

export interface WhatsAppChannelFunnelStage {
  id: string;
  channel_id: string;
  stage_key: string;
  label: string;
  description: string;
  color: string;
  labels: string[];
  position: number;
  is_active: boolean;
  is_default: boolean;
  /** Automações opcionais executadas, em ordem, ao entrar nesta etapa. */
  entry_actions: WhatsAppFunnelStageAction[];
  created_at: string;
  updated_at: string;
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
  /** NULL = agendada pelo usuário; 'reconnect' = retida aguardando reconexão automática do canal. */
  hold_reason: string | null;
  /** Início da retenção automática — o scheduler desiste depois de 12h presa. */
  hold_since?: string | null;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
}

/**
 * Agendada do próprio atendente com o contato já resolvido.
 *
 * A tabela só guarda `conversation_id`. Quem lista FORA de uma conversa (a aba
 * "Agendadas" do módulo e o cartão do painel) não tem a conversa carregada em
 * memória para traduzir o id em contato, então ele vem junto da consulta —
 * inclusive `client_name` e a foto, para a lista exibir a mesma identidade que
 * a inbox exibe (nome do cadastro na frente do apelido do WhatsApp).
 */
export interface WhatsAppScheduledWithContact extends WhatsAppScheduledMessage {
  contact_name: string | null;
  contact_phone: string;
  client_name: string | null;
  contact_avatar_path: string | null;
  contact_avatar_url: string | null;
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

// ── Assistente de IA (MVP de 08/2026) ───────────────────────────────────────
// Substitui a experiência de "Playbooks IA" na tela de configurações. Os tipos
// de playbook acima continuam declarados porque a tabela segue de pé no banco,
// mas nenhuma tela nova os usa.

/** Modo de operação do agente. */
export type WhatsAppAiAssistantMode = 'test' | 'auto';
export type WhatsAppAiFactValue = string | number | boolean;

/** Referência compilada de uma expressão `ação=...` do editor de prompt. */
export interface WhatsAppAiActionRef {
  action: string;
  target_type: 'user' | 'department' | 'document_template' | 'none';
  target_id: string | null;
  target_label: string;
  raw: string;
}

/** Agente de IA do WhatsApp (whatsapp_ai_assistants). */
export interface WhatsAppAiAssistant {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  is_active: boolean;
  mode: WhatsAppAiAssistantMode;
  instructions_do: string;
  instructions_dont: string;
  allowed_actions: string[];
  action_refs: WhatsAppAiActionRef[];
  followup_enabled: boolean;
  followup_instructions: string;
  followup_max_attempts: number;
  followup_strategy: 'fixed' | 'progressive' | 'custom';
  followup_interval_hours: number;
  followup_custom_hours: number[];
  followup_days: number[];
  followup_start_minute: number;
  followup_end_minute: number;
  timezone: string;
  debounce_seconds: number;
  history_limit: number;
  /** Roteiro da triagem. Objeto vazio = agente sem roteiro, em texto livre. */
  playbook: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Campos que a tela envia ao criar ou editar um agente. */
export type WhatsAppAiAssistantInput = Partial<Omit<WhatsAppAiAssistant,
  'id' | 'created_by' | 'created_at' | 'updated_at'>> & { name: string };

/** Uma ação que o agente PEDIRIA, do jeito que a prévia devolve. */
export interface WhatsAppAiSimulatedAction {
  action: string;
  ok: boolean;
  simulated?: boolean;
  args?: Record<string, unknown>;
  target?: string | null;
  error?: string;
}

/**
 * Resultado de um turno de prévia (`whatsapp-ai-agent` em modo `simulate`).
 * Nada disso foi gravado nem executado: é o que o agente FARIA.
 */
export interface WhatsAppAiSimulationResult {
  ok: boolean;
  error?: string;
  reply: string;
  /** A resposta já dividida nas mensagens que o WhatsApp receberia, na ordem. */
  reply_parts?: string[];
  requested: { action: string; args?: unknown }[];
  executed: WhatsAppAiSimulatedAction[];
  /** Devolver na chamada seguinte — é a continuidade da conversa. */
  memory: {
    summary: string;
    knownFacts: Record<string, WhatsAppAiFactValue>;
    pendingItems: string[];
    lastAction: string;
  };
  handed_off: boolean;
  followup: { attempt: number; scheduled_at: string } | null;
  /** Onde a triagem parou, calculada pelo backend. Ausente em agente sem roteiro. */
  triage?: {
    stage: string | null;
    stage_label: string | null;
    pending: string[];
    next_field: string | null;
    next_action:
      | { type: 'ask_field'; field: string; question: string }
      | { type: 'handoff' | 'disqualify'; cutId: string; reason: string; guidance: string }
      | { type: 'complete'; guidance: string }
      | { type: 'none'; reason: string }
      | null;
    cut: { id: string; effect: 'disqualify' | 'handoff'; reason: string; guidance: string } | null;
    complete: boolean;
  };
  /** Preenchido quando a resposta do modelo veio fora do formato combinado. */
  degraded?: string;
  duration_ms: number;
}

/** Registro de uma execução do agente (whatsapp_ai_executions). */
export interface WhatsAppAiExecution {
  id: string;
  conversation_id: string;
  assistant_id: string | null;
  channel_id: string | null;
  provider: string | null;
  model: string | null;
  mode: string;
  trigger_message_id: string | null;
  idempotency_key: string;
  reply_text: string | null;
  requested_actions: unknown[];
  executed_actions: unknown[];
  error: string | null;
  duration_ms: number | null;
  /** 'degraded' = respondeu, mas fora do formato combinado; a leitura caiu de degrau. */
  status: 'ok' | 'skipped' | 'error' | 'test' | 'degraded';
  created_at: string;
}

/** Acompanhamento agendado pelo agente (whatsapp_ai_followups). */
export interface WhatsAppAiFollowup {
  id: string;
  conversation_id: string;
  assistant_id: string | null;
  attempt: number;
  scheduled_at: string;
  message: string;
  reason: string | null;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  cancel_reason: string | null;
  sent_at: string | null;
  error: string | null;
  created_at: string;
  /** 'followup' = degrau da escada; 'appointment' = hora marcada pelo cliente. */
  kind: 'followup' | 'appointment';
}

/** O que o painel "Memória da IA" mostra ao operador dentro da conversa. */
export interface WhatsAppAiConversationState {
  aiActive: boolean;
  assistantId: string | null;
  assistantName: string | null;
  mode: WhatsAppAiAssistantMode | null;
  /** Política que governa as retomadas automáticas deste agente. */
  followupPolicy: {
    enabled: boolean;
    strategy: 'fixed' | 'progressive' | 'custom';
    intervalHours: number;
    customHours: number[];
    maxAttempts: number;
    days: number[];
    startMinute: number;
    endMinute: number;
    timezone: string;
    /** Silêncio que define a inatividade — marco zero da escada, não um degrau. */
    inactivityMinutes: number;
  } | null;
  channelAiEnabled: boolean;
  status: WhatsAppAiSessionStatus | null;
  summary: string | null;
  knownFacts: Record<string, WhatsAppAiFactValue>;
  pendingItems: string[];
  lastAction: string | null;
  /** Etapa do roteiro, calculada pelo backend a cada turno. */
  triageStage: string | null;
  /** Id da regra de corte que encerrou a triagem, e o motivo em texto. */
  triageCut: string | null;
  triageCutReason: string | null;
  handoffReason: string | null;
  handoffSummary: string | null;
  nextFollowupAt: string | null;
  followupAttempts: number;
  lastExecution: WhatsAppAiExecution | null;
  pendingFollowup: WhatsAppAiFollowup | null;
}

/** Registro real que o autocomplete `ação=` oferece como destino. */
export interface WhatsAppAiTargetOption {
  type: 'user' | 'department' | 'document_template';
  id: string;
  label: string;
  /** Cargo/e-mail, setor ou permalink — identifica a opção na lista. */
  hint: string | null;
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

// —— Workflow / agents autopilot ------------------------------------------------

export type WhatsAppWorkflowAgentType =
  | 'assistant'
  | 'triage'
  | 'qualification'
  | 'documents'
  | 'followup'
  | 'handoff'
  | 'closer';

export interface WhatsAppWorkflowAgent {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  agent_type: WhatsAppWorkflowAgentType;
  prompt_base: string;
  prompt_context_template: string | null;
  objective: string | null;
  fields_to_collect: string[];
  behavior_config: Record<string, any>;
  can_send_automatically: boolean;
  requires_human_approval: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppRequiredDocument {
  key: string;
  label: string;
  required: boolean;
  description?: string | null;
  sort_order?: number;
}

export interface WhatsAppWorkflowFieldDefinition {
  key: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'phone' | 'date' | 'choice' | 'boolean' | 'number';
  choices?: string[];
}

export type WhatsAppFollowupAttemptStatus = 'pending' | 'sent' | 'canceled' | 'failed';

export interface WhatsAppFollowupPolicy {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  stop_on_reply: boolean;
  stop_on_disqualify: boolean;
  stop_on_close: boolean;
  business_hours_only: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppFollowupPolicyStep {
  id: string;
  policy_id: string;
  order_index: number;
  delay_minutes: number;
  template_id: string | null;
  message_body: string | null;
  cancel_if_customer_replied: boolean;
  business_hours_only: boolean;
  created_at: string;
}

export type WhatsAppWorkflowType = 'campaign' | 'intake' | 'documents' | 'followup' | 'custom';

export interface WhatsAppWorkflow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  workflow_type: WhatsAppWorkflowType;
  version: number;
  entry_message: string | null;
  fallback_message: string | null;
  handoff_summary_template: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type WhatsAppWorkflowStepKind = 'start' | 'conversation' | 'decision' | 'documents' | 'followup' | 'handoff' | 'end';

export interface WhatsAppWorkflowStep {
  id: string;
  workflow_id: string;
  name: string;
  slug: string;
  description: string | null;
  order_index: number;
  agent_id: string | null;
  step_kind: WhatsAppWorkflowStepKind;
  required_fields: WhatsAppWorkflowFieldDefinition[];
  required_documents_json: WhatsAppRequiredDocument[];
  ai_config: Record<string, any>;
  timeout_minutes: number | null;
  allow_auto_reply: boolean;
  requires_business_hours: boolean;
  followup_policy_id: string | null;
  terminal: boolean;
  created_at: string;
  updated_at: string;
}

export type WhatsAppWorkflowConditionType =
  | 'message_contains'
  | 'message_contains_any'
  | 'message_equals'
  | 'field_equals'
  | 'field_filled'
  | 'classified_subject'
  | 'additional_issue_detected'
  | 'channel_is'
  | 'department_is'
  | 'priority_is'
  | 'tag_present'
  | 'timeout_reached'
  | 'document_delivered'
  | 'all_required_documents_delivered'
  | 'required_document_missing'
  | 'signature_completed'
  | 'signature_refused'
  | 'kit_opened'
  | 'kit_abandoned'
  | 'within_business_hours'
  | 'qualification_status';

export interface WhatsAppWorkflowCondition {
  type: WhatsAppWorkflowConditionType;
  field?: string;
  operator?: 'equals' | 'not_equals' | 'contains' | 'contains_any' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  value?: any;
}

export type WhatsAppWorkflowActionType =
  | 'go_to_step'
  | 'transfer_to_agent'
  | 'transfer_to_user'
  | 'transfer_to_department'
  | 'send_message'
  | 'schedule_followup'
  | 'cancel_followup'
  | 'apply_tag'
  | 'remove_tag'
  | 'set_subject'
  | 'set_department'
  | 'set_priority'
  | 'set_qualification'
  | 'handoff_human'
  | 'pause_workflow'
  | 'close_conversation'
  | 'raise_exception';

export interface WhatsAppWorkflowAction {
  type: WhatsAppWorkflowActionType;
  target?: string | null;
  message?: string | null;
  template_id?: string | null;
  payload?: Record<string, any>;
}

export interface WhatsAppWorkflowRule {
  id: string;
  workflow_id: string;
  step_id: string;
  name: string;
  description: string | null;
  priority: number;
  match_mode: 'all' | 'any';
  conditions_json: WhatsAppWorkflowCondition[];
  action_json: WhatsAppWorkflowAction;
  else_action_json: WhatsAppWorkflowAction | null;
  stop_on_match: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppChannelWorkflowBinding {
  channel_id: string;
  workflow_id: string;
  is_default: boolean;
  entry_agent_id: string | null;
  config_json: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export type WhatsAppWorkflowConversationStateStatus =
  | 'active'
  | 'waiting_customer'
  | 'waiting_internal'
  | 'followup_scheduled'
  | 'paused'
  | 'handed_off'
  | 'qualified'
  | 'disqualified'
  | 'completed'
  | 'cancelled'
  | 'exception';

export type WhatsAppWorkflowQualificationStatus =
  | 'unknown'
  | 'qualified'
  | 'disqualified'
  | 'warm'
  | 'cold'
  | 'needs_review';

export interface WhatsAppDetectedAdditionalIssue {
  subject: string;
  confidence?: number | null;
  notes?: string | null;
}

export interface WhatsAppConversationWorkflowState {
  conversation_id: string;
  workflow_id: string | null;
  current_step_id: string | null;
  current_agent_id: string | null;
  state: WhatsAppWorkflowConversationStateStatus;
  primary_subject: string | null;
  detected_additional_issues: WhatsAppDetectedAdditionalIssue[];
  collected_data_json: Record<string, any>;
  pending_documents_json: WhatsAppRequiredDocument[];
  suggested_department_id: string | null;
  suggested_priority: string | null;
  confidence_score: number | null;
  qualification_status: WhatsAppWorkflowQualificationStatus;
  qualification_reason: string | null;
  handoff_target_user_id: string | null;
  handoff_target_department_id: string | null;
  latest_summary: string | null;
  active_followup_policy_id: string | null;
  active_followup_step: number | null;
  next_followup_at: string | null;
  followup_attempts: number;
  last_customer_reply_at: string | null;
  last_agent_action_at: string | null;
  last_rule_id: string | null;
  exception_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppWorkflowTransitionLog {
  id: string;
  conversation_id: string;
  workflow_id: string | null;
  from_step_id: string | null;
  to_step_id: string | null;
  triggered_rule_id: string | null;
  action_type: string;
  actor_user_id: string | null;
  actor_kind: 'system' | 'agent' | 'user';
  detail_json: Record<string, any>;
  created_at: string;
}
