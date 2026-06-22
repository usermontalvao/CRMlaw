import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal, ModalBody } from './ui';
import {
  Settings,
  Building2,
  Users,
  Shield,
  FileText,
  Bell,
  History,
  ShieldCheck,
  Crown,
  RefreshCw,
  Edit2,
  Trash2,
  Search,
  Plus,
  Save,
  Loader2,
  Mail,
  Phone,
  AlertTriangle,
  Check,
  X,
  Upload,
  Camera,
  Eye,
  EyeOff,
  CalendarClock,
  Send,
  Key,
  Smartphone,
  Briefcase,
  FolderOpen,
  PenTool,
  PiggyBank,
  Calendar,
  MessageCircle,
  MessageSquare,
  User,
  Globe,
  MapPin,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  DollarSign,
  Percent,
  CreditCard,
  ToggleLeft,
  ToggleRight,
  CheckCircle2,
  XCircle,
  Clock,
  CheckCircle,
  Circle,
  Layers,
  Newspaper,
  Target,
  Scale,
  AlarmClock,
  Cloud,
  CheckSquare,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSecurityPin } from '../contexts/SecurityPinContext';
import { supabase } from '../config/supabase';
import ConfigurableList, { normalizeItems, type ConfigurableItem } from './ConfigurableList';
import { ClientSearchSelect } from './ClientSearchSelect';
import { profileService, type Profile } from '../services/profile.service';
import UserManagementModule from './UserManagementModule';
import WhatsAppIntegrationSettings from './WhatsAppIntegrationSettings';
import { AccessRequestsAdmin } from './AccessRequestsAdmin';
import { accessRequestService } from '../services/accessRequest.service';
import { aiService } from '../services/ai.service';
import { matchesNormalizedSearch, normalizeSearchText } from '../utils/search';
import { events, SYSTEM_EVENTS } from '../utils/events';
import {
  settingsService,
  type AuditLogEntry,
  type DatajudKeyConfig,
  type DjenConfig,
  type NotificationConfig,
  type OfficeIdentity,
  type Preferences,
  type RolePermission,
  type SecurityConfig,
  type PortalModulesConfig,
  type ModulesConfig,
  type FinancialModuleConfig,
  type EmailIntegrationConfig,
  type WhatsAppEvolutionConfig,
  type NotificationRule,
  type NotificationChannel,
  type ProcessModuleConfig,
  type DeadlineModuleConfig,
  PORTAL_MODULES_DEFAULT,
  FINANCIAL_MODULE_DEFAULTS,
  EMAIL_INTEGRATION_DEFAULTS,
  WHATSAPP_EVOLUTION_DEFAULTS,
  PAYMENT_METHOD_LABELS,
  NOTIFICATION_TRIGGERS,
  DEFAULT_NOTIFICATION_RULES,
  PROCESS_MODULE_DEFAULTS,
  DEADLINE_MODULE_DEFAULTS,
  type EmailTemplate,
  EMAIL_TEMPLATE_VARIABLES,
  DEFAULT_EMAIL_TEMPLATES,
  type LeadModuleConfig,
  type CalendarModuleConfig,
  LEAD_MODULE_DEFAULTS,
  CALENDAR_MODULE_DEFAULTS,
  LEAD_COLORS,
  type RequirementModuleConfig,
  REQUIREMENT_MODULE_DEFAULTS,
  type AiProviderConfig,
  type AiTaskConfig,
  type AiProviderId,
  type AiPromptOverride,
  AI_PROVIDER_DEFAULTS,
  AI_PROVIDER_LABELS,
  DEFAULT_AI_TASKS,
  AI_PROMPT_KEYS,
  type SignatureModuleConfig,
  type TaskModuleConfig,
  type ClientModuleConfig,
  type PortalCustomizationConfig,
  type PortalClientNotificationsConfig,
  SIGNATURE_MODULE_DEFAULTS,
  TASK_MODULE_DEFAULTS,
  CLIENT_MODULE_DEFAULTS,
  PORTAL_CUSTOMIZATION_DEFAULTS,
  PORTAL_CLIENT_NOTIF_DEFAULTS,
  type AutomationThresholds,
  AUTOMATION_THRESHOLDS_DEFAULTS,
  KNOWN_CRON_JOBS,
  type CronJobLatest,
  type Holiday,
  type SecretEntry,
  type ModuleResponsibilityConfig,
  type ResponsibilityAllowed,
  type ResponsibilityDefault,
  type ResponsibilityNotify,
  RESPONSIBILITY_DEFAULTS,
  type FormLayoutModule,
  type FormFieldConfig,
  CANONICAL_FORM_FIELDS,
  type NotifAudience,
  type NotifChannelStatus,
  type NotificationEventDef,
} from '../services/settings.service';

interface UserWithProfile extends Profile {
  is_active?: boolean;
}

type SettingsSection =
  | 'overview'
  | 'identity'
  | 'users'
  | 'roles'
  | 'djen'
  | 'notifications'
  | 'preferences'
  | 'security'
  | 'audit'
  | 'access_requests'
  | 'portal'
  | 'modules_financial'
  | 'modules_processes'
  | 'modules_deadlines'
  | 'integrations_email'
  | 'integrations_whatsapp'
  | 'notifications_rules'
  | 'notifications_email_templates'
  | 'modules_leads'
  | 'modules_agenda'
  | 'modules_requirements'
  | 'ai_providers'
  | 'ai_tasks'
  | 'ai_prompts'
  | 'modules_signature'
  | 'modules_tasks'
  | 'modules_clients'
  | 'modules_whatsapp'
  | 'portal_customization'
  | 'portal_notifications'
  | 'automations'
  | 'holidays'
  | 'secrets'
  | 'apps'
  | 'responsibility'
  | 'menu_modules'
  | 'form_builder';

type SettingsGroupKey = 'geral' | 'modulos' | 'notificacoes' | 'integracoes' | 'administracao';

// Status de integração por seção — só marcamos as não-integradas para manter o sidebar limpo
const SECTION_STATUS: Partial<Record<SettingsSection, 'parcial' | 'pendente'>> = {
  preferences:                  'parcial',  // timezone ainda não aplicado; data/moeda já integrados
  djen:                         'parcial',  // DataJud configurado; consumo real depende da chave ativa
};

const SETTINGS_GROUPS: {
  key: SettingsGroupKey;
  label: string;
  icon: React.ComponentType<any>;
  items: { key: SettingsSection; label: string; icon: React.ComponentType<any>; description: string }[];
}[] = [
  {
    key: 'geral',
    label: 'Geral',
    icon: Settings,
    items: [
      { key: 'identity',    label: 'Identidade',   icon: Building2,   description: 'Dados do escritório' },
      { key: 'preferences', label: 'Preferências', icon: Settings,    description: 'Operação e fuso horário' },
      { key: 'security',    label: 'Segurança',    icon: ShieldCheck, description: 'Senhas e sessões' },
      { key: 'audit',       label: 'Auditoria',    icon: History,     description: 'Registro de atividades' },
    ],
  },
  {
    key: 'modulos',
    label: 'Módulos',
    icon: PiggyBank,
    items: [
      { key: 'modules_clients',       label: 'Clientes',      icon: User,           description: 'Status e estado civil' },
      { key: 'modules_processes',     label: 'Processos',     icon: Briefcase,      description: 'Status e áreas do direito' },
      { key: 'modules_deadlines',     label: 'Prazos',        icon: Calendar,       description: 'Status, prioridades e thresholds' },
      { key: 'modules_tasks',         label: 'Tarefas',       icon: FolderOpen,     description: 'Prioridades de tarefas' },
      { key: 'modules_agenda',        label: 'Agenda',        icon: CalendarClock,  description: 'Tipos de compromisso e duração' },
      { key: 'modules_leads',         label: 'Leads',         icon: User,           description: 'Estágios e origens do funil' },
      { key: 'modules_whatsapp',      label: 'WhatsApp',      icon: MessageSquare,  description: 'Central de configurações do atendimento' },
      { key: 'modules_financial',     label: 'Financeiro',    icon: PiggyBank,      description: 'Defaults e métodos de pagamento' },
      { key: 'modules_requirements',  label: 'Requerimentos', icon: FileText,       description: 'Status e tipos de benefício INSS' },
      { key: 'modules_signature',     label: 'Assinaturas',   icon: PenTool,        description: 'Papéis de signatário e autenticação' },
      { key: 'form_builder',          label: 'Campos',        icon: FileText,       description: 'Renomear e reordenar campos por módulo' },
      { key: 'responsibility',        label: 'Responsáveis',  icon: Users,          description: 'Quem pode ser responsável por módulo' },
    ],
  },
  {
    key: 'notificacoes',
    label: 'Notificações',
    icon: Bell,
    items: [
      { key: 'notifications',                 label: 'Canais & Digest',     icon: Bell,       description: 'Email, push e resumos' },
      { key: 'notifications_rules',           label: 'Regras',              icon: ToggleLeft, description: 'Gatilhos e destinatários' },
      { key: 'notifications_email_templates', label: 'Templates de E-mail', icon: Mail,       description: 'Modelos de e-mail transacionais' },
    ],
  },
  {
    key: 'integracoes',
    label: 'Integrações',
    icon: Globe,
    items: [
      { key: 'apps',                 label: 'Apps & Terceiros', icon: Globe,      description: 'Hub de todas as integrações' },
      { key: 'integrations_email',   label: 'E-mail (Resend)',  icon: Mail,       description: 'Remetente e API key' },
      { key: 'integrations_whatsapp', label: 'WhatsApp (Evolution)', icon: MessageCircle, description: 'Servidor, canais e departamentos' },
      { key: 'djen',                 label: 'DJEN & DataJud',   icon: FileText,   description: 'Monitoramento jurídico' },
      { key: 'automations',          label: 'Jobs & Limiares',  icon: RefreshCw,  description: 'Painel de jobs agendados e limiares' },
      { key: 'holidays',             label: 'Feriados',         icon: Calendar,   description: 'Calendário de feriados para dias úteis' },
      { key: 'secrets',              label: 'Cofre de Chaves',  icon: Key,        description: 'Registro e status de chaves de API' },
      { key: 'ai_providers',         label: 'Provedores IA',    icon: Globe,      description: 'OpenAI, Groq, Anthropic e fallback' },
      { key: 'ai_tasks',             label: 'Params IA',        icon: Settings,   description: 'Modelo, temperatura e tokens por tarefa' },
      { key: 'ai_prompts',           label: 'Prompts IA',       icon: PenTool,    description: 'Customizar prompts do sistema' },
    ],
  },
  {
    key: 'administracao',
    label: 'Administração',
    icon: Building2,
    items: [
      { key: 'users',               label: 'Equipe',                   icon: Users,      description: 'Usuários e perfis' },
      { key: 'roles',               label: 'Permissões',               icon: Shield,     description: 'Papéis e módulos' },
      { key: 'menu_modules',        label: 'Menu — Módulos',           icon: Layers,     description: 'Mostrar/ocultar módulos no menu lateral' },
      { key: 'access_requests',     label: 'Solicitações',             icon: ShieldCheck, description: 'Pedidos de acesso' },
      { key: 'portal',              label: 'Portal — Módulos',         icon: Smartphone, description: 'O que o cliente acessa' },
      { key: 'portal_customization', label: 'Portal — Aparência',      icon: Globe,      description: 'Cor, mensagem e rodapé do portal' },
      { key: 'portal_notifications', label: 'Portal — Notificações',   icon: Bell,       description: 'Eventos que alertam o cliente' },
    ],
  },
];

const ALL_AUTH_METHODS = [
  'Só assinatura',
  'Assinatura + Validação Facial',
  'Assinatura + Facial + Documento',
] as const;

const GROUPS_STORAGE_KEY = 'crm_settings_expanded_groups_v3';
const DEFAULT_EXPANDED: Record<SettingsGroupKey, boolean> = {
  geral: true, modulos: false, notificacoes: false, integracoes: false, administracao: false,
};

const ROLES = [
  {
    key: 'administrador',
    label: 'Administrador',
    description: 'Acesso total ao sistema',
    tone: 'bg-red-100 text-red-800',
    icon: Crown,
  },
  {
    key: 'advogado',
    label: 'Advogado',
    description: 'Acesso completo aos módulos jurídicos',
    tone: 'bg-blue-100 text-blue-800',
    icon: Users,
  },
  {
    key: 'auxiliar',
    label: 'Auxiliar',
    description: 'Suporte administrativo',
    tone: 'bg-emerald-100 text-emerald-800',
    icon: Shield,
  },
  {
    key: 'secretaria',
    label: 'Secretária',
    description: 'Agenda, clientes e comunicados',
    tone: 'bg-purple-100 text-purple-800',
    icon: Phone,
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    description: 'Controle do módulo financeiro',
    tone: 'bg-amber-100 text-amber-800',
    icon: ShieldCheck,
  },
  {
    key: 'estagiario',
    label: 'Estagiário',
    description: 'Perfil supervisionado com acesso limitado',
    tone: 'bg-slate-100 text-slate-700',
    icon: Users,
  },
];

const MODULES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'leads', label: 'Leads' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'processos', label: 'Processos' },
  { key: 'prazos', label: 'Prazos' },
  { key: 'requerimentos', label: 'Requerimentos' },
  { key: 'intimacoes', label: 'Intimações' },
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'assinaturas', label: 'Assinaturas' },
  { key: 'agenda', label: 'Agenda' },
  { key: 'tarefas', label: 'Tarefas' },
  { key: 'peticoes', label: 'Petições' },
  { key: 'chat', label: 'Chat' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
  { key: 'configuracoes', label: 'Configurações' },
];

const SettingsModule: React.FC<{ open?: boolean; initialSection?: SettingsSection; onParamConsumed?: () => void; onClose?: () => void; variant?: 'page' | 'modal' }> = ({
  open = true,
  initialSection,
  onParamConsumed,
  onClose,
  variant = 'page',
}) => {
  const { user } = useAuth();
  const { requirePin } = useSecurityPin();
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  // 'overview' = hub/visão geral (tela inicial). Sem deep-link, abre no hub.
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection ?? 'overview');

  // Consumir o param de seção inicial uma vez
  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
      onParamConsumed?.();
    }
  }, [initialSection]);

  // Fechar com Escape + travar scroll — apenas no modo modal
  useEffect(() => {
    if (variant !== 'modal' || !open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [variant, open, onClose]);

  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalSuccess, setGlobalSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingAccessCount, setPendingAccessCount] = useState(0);
  const [navSearch, setNavSearch] = useState('');

  // Painéis recolhíveis da página unificada de WhatsApp (Módulos → WhatsApp)
  const [waHubExpanded, setWaHubExpanded] = useState<Record<string, boolean>>({ connection: false, funnel: false });
  const toggleWaHub = (k: string) => setWaHubExpanded(prev => ({ ...prev, [k]: !prev[k] }));

  // Sidebar grupos colapsáveis (estado salvo no localStorage)
  const [expandedGroups, setExpandedGroupsState] = useState<Record<SettingsGroupKey, boolean>>(() => {
    try {
      const stored = localStorage.getItem(GROUPS_STORAGE_KEY);
      if (stored) return { ...DEFAULT_EXPANDED, ...JSON.parse(stored) };
    } catch {}
    return { ...DEFAULT_EXPANDED };
  });

  // Accordion: abre um grupo e fecha todos os outros
  const toggleGroup = (key: SettingsGroupKey) => {
    setExpandedGroupsState(prev => {
      const opening = !prev[key];
      const next = opening
        ? Object.fromEntries(Object.keys(prev).map(k => [k, k === key])) as Record<SettingsGroupKey, boolean>
        : { ...prev, [key]: false };
      try { localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Auto-expandir grupo do item ativo e fechar os demais
  useEffect(() => {
    const group = SETTINGS_GROUPS.find(g => g.items.some(i => i.key === activeSection));
    if (group) {
      setExpandedGroupsState(prev => {
        if (prev[group.key as SettingsGroupKey] && Object.entries(prev).every(([k, v]) => k === group.key ? v : !v)) return prev;
        const next = Object.fromEntries(
          Object.keys(prev).map(k => [k, k === group.key])
        ) as Record<SettingsGroupKey, boolean>;
        try { localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    }
  }, [activeSection]);

  // Identity
  const [identity, setIdentity] = useState<OfficeIdentity>({
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
  });
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // DataJud API key
  const [datajudKeyConfig, setDatajudKeyConfig] = useState<DatajudKeyConfig>({
    key: settingsService.DATAJUD_DEFAULT_KEY,
    invalid: false,
    invalid_since: null,
  });
  const [datajudKeyVisible, setDatajudKeyVisible] = useState(false);
  const [datajudKeySaving, setDatajudKeySaving] = useState(false);

  // DJEN & configs
  const [djenConfig, setDjenConfig] = useState<DjenConfig>({
    auto_sync: true,
    sync_interval_hours: 24,
    default_tribunal: 'all',
    search_days_back: 30,
    api_timeout_seconds: 30,
    max_retries: 3,
    lawyers_to_monitor: [],
  });
  const [notificationConfig, setNotificationConfig] = useState<NotificationConfig>({
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
  });
  const [showResendKey, setShowResendKey] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>({
    timezone: 'America/Sao_Paulo',
    date_format: 'DD/MM/YYYY',
    currency: 'BRL',
    default_deadline_days: 15,
    business_hours_start: '08:00',
    business_hours_end: '18:00',
    work_days: [1, 2, 3, 4, 5],
  });
  const [securityConfig, setSecurityConfig] = useState<SecurityConfig>({
    session_timeout_hours: 6,
    require_2fa: false,
    password_min_length: 8,
    max_login_attempts: 5,
    audit_log_enabled: true,
    pin_session_minutes: 5,
    financial_view_hours: 2,
  });

  // Novas seções de configuração
  const [financialConfig, setFinancialConfig] = useState<FinancialModuleConfig>({ ...FINANCIAL_MODULE_DEFAULTS });
  const [emailIntConfig, setEmailIntConfig] = useState<EmailIntegrationConfig>({ ...EMAIL_INTEGRATION_DEFAULTS });
  const [showEmailKey, setShowEmailKey] = useState(false);

  // Regras de notificação
  const [notifRules, setNotifRules] = useState<NotificationRule[]>([...DEFAULT_NOTIFICATION_RULES]);
  const [ruleModal, setRuleModal] = useState<{ open: boolean; rule: NotificationRule | null }>({ open: false, rule: null });
  const [ruleForm, setRuleForm] = useState<Partial<NotificationRule>>({});
  const [notifAudFilter, setNotifAudFilter] = useState<NotifAudience | 'all'>('all');
  const [notifDomFilter, setNotifDomFilter] = useState<string>('all');

  // Módulo Processos
  const [processConfig, setProcessConfig] = useState<ProcessModuleConfig>({ ...PROCESS_MODULE_DEFAULTS });

  // Módulo Prazos
  const [deadlineConfig, setDeadlineConfig] = useState<DeadlineModuleConfig>({ ...DEADLINE_MODULE_DEFAULTS });

  // Templates de e-mail
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>(DEFAULT_EMAIL_TEMPLATES.map(t => ({ ...t })));
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templatePreviewMode, setTemplatePreviewMode] = useState<'editor' | 'preview'>('editor');
  const [testEmailTo, setTestEmailTo]   = useState('');
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; msg: string } | null>(null);
  // Backfill INSS
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ processed: number; failed: number; remaining: number; message: string } | null>(null);

  // Módulo Leads
  const [leadConfig, setLeadConfig] = useState<LeadModuleConfig>({
    ...LEAD_MODULE_DEFAULTS,
    stages: LEAD_MODULE_DEFAULTS.stages.map(s => ({ ...s })),
    sources: [...LEAD_MODULE_DEFAULTS.sources],
    channels: (LEAD_MODULE_DEFAULTS.channels ?? []).map(c => ({ ...c })),
  });
  const [newSource, setNewSource] = useState('');
  // Canais (contas de WhatsApp conectadas) + sua config de entrada no funil.
  type WaFunnelChannel = { id: string; label: string; funnel_enabled: boolean; funnel_initial_stage: string | null };
  const [waFunnelChannels, setWaFunnelChannels] = useState<WaFunnelChannel[]>([]);
  const loadWaFunnelChannels = useCallback(async () => {
    const { data } = await supabase
      .from('whatsapp_instances')
      .select('id, name, instance_name, funnel_enabled, funnel_initial_stage')
      .order('created_at', { ascending: true });
    setWaFunnelChannels((data ?? []).map((c: any) => ({
      id: c.id,
      label: c.name || c.instance_name || 'Canal',
      funnel_enabled: c.funnel_enabled !== false,
      funnel_initial_stage: c.funnel_initial_stage ?? null,
    })));
  }, []);
  useEffect(() => { if (activeSection === 'modules_leads' || activeSection === 'modules_whatsapp') loadWaFunnelChannels(); }, [activeSection, loadWaFunnelChannels]);
  const updateWaFunnelChannel = useCallback(async (id: string, patch: Partial<Pick<WaFunnelChannel, 'funnel_enabled' | 'funnel_initial_stage'>>) => {
    setWaFunnelChannels(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
    await supabase.from('whatsapp_instances').update(patch).eq('id', id);
  }, []);

  // Módulos restantes
  const [signatureConfig, setSignatureConfig]  = useState<SignatureModuleConfig>({ ...SIGNATURE_MODULE_DEFAULTS, signer_roles: [...SIGNATURE_MODULE_DEFAULTS.signer_roles], auth_methods: [...SIGNATURE_MODULE_DEFAULTS.auth_methods] });
  const [publicAuthSignConfig, setPublicAuthSignConfig] = useState<{ google: boolean; email: boolean; phone: boolean }>({ google: true, email: true, phone: true });
  const [newSignerRole, setNewSignerRole]       = useState('');
  const [taskModConfig, setTaskModConfig]       = useState<TaskModuleConfig>({ priorities: TASK_MODULE_DEFAULTS.priorities.map(p => ({ ...p })) });
  const [clientConfig, setClientConfig]         = useState<ClientModuleConfig>({ statuses: CLIENT_MODULE_DEFAULTS.statuses.map(s => ({ ...s })), marital_statuses: CLIENT_MODULE_DEFAULTS.marital_statuses.map(m => ({ ...m })) });

  // Portal personalização + notificações ao cliente
  const [portalCustom, setPortalCustom] = useState<PortalCustomizationConfig>({ ...PORTAL_CUSTOMIZATION_DEFAULTS });
  const [portalClientNotif, setPortalClientNotif] = useState<PortalClientNotificationsConfig>({ ...PORTAL_CLIENT_NOTIF_DEFAULTS });

  // Construtor de formulários
  const [formLayouts, setFormLayouts] = useState<FormLayoutModule[]>(CANONICAL_FORM_FIELDS.map(m => ({ ...m, fields: m.fields.map(f => ({ ...f })) })));
  const [selectedFormModule, setSelectedFormModule] = useState<string | null>(null);

  // Responsável por módulo
  const [responsibilityConfig, setResponsibilityConfig] = useState<ModuleResponsibilityConfig[]>(RESPONSIBILITY_DEFAULTS.map(r => ({ ...r })));

  // Automações & Cron
  const [automationThresholds, setAutomationThresholds] = useState<AutomationThresholds>({ ...AUTOMATION_THRESHOLDS_DEFAULTS });
  const [cronJobLatest, setCronJobLatest] = useState<CronJobLatest[]>([]);
  const [cronJobsLoading, setCronJobsLoading] = useState(false);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidaysLoading, setHolidaysLoading] = useState(false);
  const [holidayForm, setHolidayForm] = useState<{ date: string; name: string; type: Holiday['type']; state: string; city: string }>({ date: '', name: '', type: 'nacional', state: '', city: '' });
  const [holidayFormOpen, setHolidayFormOpen] = useState(false);
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [secretsLoading, setSecretsLoading] = useState(false);
  const [verifyingSecrets, setVerifyingSecrets] = useState(false);

  // Prompts de IA
  const [aiPromptOverrides, setAiPromptOverrides] = useState<AiPromptOverride[]>([]);
  const [selectedPromptKey, setSelectedPromptKey] = useState<string | null>(null);
  const [promptDraft, setPromptDraft]             = useState('');

  // Motor de IA
  const [aiProviderConfig, setAiProviderConfig] = useState<AiProviderConfig>({
    ...AI_PROVIDER_DEFAULTS,
    enabled: { ...AI_PROVIDER_DEFAULTS.enabled },
    fallback_order: [...AI_PROVIDER_DEFAULTS.fallback_order],
  });
  const [aiTaskConfigs, setAiTaskConfigs] = useState<AiTaskConfig[]>(DEFAULT_AI_TASKS.map(t => ({ ...t })));

  // Módulo Requerimentos
  const [requirementConfig, setRequirementConfig] = useState<RequirementModuleConfig>({
    statuses:      REQUIREMENT_MODULE_DEFAULTS.statuses.map(s => ({ ...s })),
    benefit_types: REQUIREMENT_MODULE_DEFAULTS.benefit_types.map(b => ({ ...b })),
  });
  // Módulo Agenda
  const [calendarConfig, setCalendarConfig] = useState<CalendarModuleConfig>({
    ...CALENDAR_MODULE_DEFAULTS,
    event_types: CALENDAR_MODULE_DEFAULTS.event_types.map(t => ({ ...t })),
  });

  // Users
  const [portalModules, setPortalModules] = useState<PortalModulesConfig>(PORTAL_MODULES_DEFAULT);
  const [portalLoginEnabled, setPortalLoginEnabled] = useState(true);
  const [portalSaving, setPortalSaving] = useState(false);

  // Visibilidade dos módulos no menu lateral (independente da permissão de função)
  const [modulesConfig, setModulesConfig] = useState<ModulesConfig | null>(null);
  const [menuModulesSaving, setMenuModulesSaving] = useState(false);

  const [users, setUsers] = useState<UserWithProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithProfile | null>(null);
  const [userFormData, setUserFormData] = useState({
    name: '',
    email: '',
    role: 'advogado',
    cpf: '',
    phone: '',
    oab: '',
    lawyer_full_name: '',
    avatar_url: '',
  });
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserWithProfile | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Permissions
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState('advogado');

  // Audit
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const AUDIT_PAGE_SIZE = 25;
  const [auditDateFrom, setAuditDateFrom] = useState('');
  const [auditDateTo, setAuditDateTo] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [auditUserFilter, setAuditUserFilter] = useState('');
  const [auditEntityFilter, setAuditEntityFilter] = useState('');
  const [auditClientFilter, setAuditClientFilter] = useState('');
  const [auditClientMap, setAuditClientMap] = useState<Map<string, string>>(new Map());
  const [auditInstallmentMap, setAuditInstallmentMap] = useState<Map<string, { value: number; installment_number: number; due_date: string; client_name: string | null }>>(new Map());

  const normalizeRoleKey = (role?: string | null) => {
    if (!role) return '';
    const normalized = role
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (normalized === 'administrador' || normalized === 'admin') return 'admin';
    if (normalized === 'socio') return 'admin';
    return normalized;
  };

  const allowedRoles = ['admin', 'advogado', 'auxiliar'];

  const formatCpf = useCallback((value: string) => {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
    const p1 = digits.slice(0, 3);
    const p2 = digits.slice(3, 6);
    const p3 = digits.slice(6, 9);
    const p4 = digits.slice(9, 11);

    if (digits.length <= 3) return p1;
    if (digits.length <= 6) return `${p1}.${p2}`;
    if (digits.length <= 9) return `${p1}.${p2}.${p3}`;
    return `${p1}.${p2}.${p3}-${p4}`;
  }, []);

  const hasConfigAccess = useMemo(() => {
    const roleKey = normalizeRoleKey(currentProfile?.role);
    return roleKey ? allowedRoles.includes(roleKey) : false;
  }, [currentProfile]);

  const isAdmin = useMemo(() => {
    // Advogado tem os mesmos poderes de admin no sistema
    const roleKey = normalizeRoleKey(currentProfile?.role);
    return roleKey === 'admin' || roleKey === 'advogado';
  }, [currentProfile]);

  const setFeedback = (type: 'error' | 'success', message: string) => {
    if (type === 'error') {
      setGlobalError(message);
      setTimeout(() => setGlobalError(null), 6000);
    } else {
      setGlobalSuccess(message);
      setTimeout(() => setGlobalSuccess(null), 4000);
    }
  };

  const confirmSettingsMutation = useCallback(
    async ({
      action,
      title,
      description,
      resourceType = 'setting',
      resourceId,
      sensitivity = 'critical',
    }: {
      action: string;
      title: string;
      description: string;
      resourceType?: string;
      resourceId?: string;
      sensitivity?: 'medium' | 'high' | 'critical';
    }) => {
      return requirePin({
        action,
        resourceType,
        resourceId,
        sensitivity,
        title,
        description,
      });
    },
    [requirePin],
  );

  const runWithSettingsPin = useCallback(
    async (
      options: {
        action: string;
        title: string;
        description: string;
        resourceType?: string;
        resourceId?: string;
        sensitivity?: 'medium' | 'high' | 'critical';
      },
      persist: () => Promise<void>,
    ) => {
      const pinOk = await confirmSettingsMutation(options);
      if (!pinOk) return false;
      await persist();
      return true;
    },
    [confirmSettingsMutation],
  );

  const loadProfile = useCallback(async () => {
    if (!user) return;
    try {
      const profile = await profileService.getProfile(user.id);
      setCurrentProfile(profile);
    } catch (error) {
      console.error('Erro ao carregar perfil', error);
    } finally {
      setPageLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Carregar contagem de solicitações pendentes (para badge no sidebar)
  useEffect(() => {
    if (!isAdmin) return;
    accessRequestService.getPendingCount().then(setPendingAccessCount).catch(() => {});
  }, [isAdmin]);

  // Atualizar badge quando sair da seção de solicitações (após aprovar/negar)
  useEffect(() => {
    if (!isAdmin || activeSection === 'access_requests') return;
    accessRequestService.getPendingCount().then(setPendingAccessCount).catch(() => {});
  }, [activeSection, isAdmin]);

  const loadSettings = useCallback(async () => {
    if (!hasConfigAccess) return;
    try {
      const [identityData, djenData, notifData, prefData, secData, allUsers, djKeyData] = await Promise.all([
        settingsService.getOfficeIdentity(),
        settingsService.getDjenConfig(),
        settingsService.getNotificationConfig(),
        settingsService.getPreferences(),
        settingsService.getSecurityConfig(),
        settingsService.listUsers(),
        settingsService.getDatajudKeyConfig(),
      ]);
      setIdentity(identityData);
      setDatajudKeyConfig(djKeyData);
      
      // Integrar nomes dos advogados dos perfis com lawyers_to_monitor
      const lawyerNamesFromProfiles = allUsers
        .filter((u: any) => u.lawyer_full_name?.trim())
        .map((u: any) => u.lawyer_full_name.trim());
      
      // Mesclar nomes do banco com nomes dos perfis (sem duplicatas)
      const mergedLawyers = Array.from(new Set([
        ...(djenData.lawyers_to_monitor || []),
        ...lawyerNamesFromProfiles,
      ]));
      
      setDjenConfig({ ...djenData, lawyers_to_monitor: mergedLawyers });
      setNotificationConfig(notifData);
      setPreferences(prefData);
      setSecurityConfig(secData);
      const [portalData, finData, emailData, rulesData, procData, deadlineData, tmplData, leadData, calData, reqData, aiProv, aiTasks, sigData, taskData, clientData, portalCustData, portalNotifData, promptData, autoThreshData, respData, formLayoutData, pubAuthGoogle, pubAuthEmail, pubAuthPhone, modulesConfigData, portalLoginData] = await Promise.all([
        settingsService.getPortalModulesConfig(),
        settingsService.getFinancialModuleConfig(),
        settingsService.getEmailIntegrationConfig(),
        settingsService.getNotificationRules(),
        settingsService.getProcessModuleConfig(),
        settingsService.getDeadlineModuleConfig(),
        settingsService.getEmailTemplates(),
        settingsService.getLeadModuleConfig(),
        settingsService.getCalendarModuleConfig(),
        settingsService.getRequirementModuleConfig(),
        settingsService.getAiProviderConfig(),
        settingsService.getAiTaskConfigs(),
        settingsService.getSignatureModuleConfig(),
        settingsService.getTaskModuleConfig(),
        settingsService.getClientModuleConfig(),
        settingsService.getPortalCustomizationConfig(),
        settingsService.getPortalClientNotificationsConfig(),
        settingsService.getAiPromptOverrides(),
        settingsService.getAutomationThresholds(),
        settingsService.getResponsibilityConfig(),
        settingsService.getFormLayouts(),
        settingsService.getSetting<boolean>('public_signature_auth_google'),
        settingsService.getSetting<boolean>('public_signature_auth_email'),
        settingsService.getSetting<boolean>('public_signature_auth_phone'),
        settingsService.getModulesConfig(),
        settingsService.getSetting<boolean>('portal_login_enabled'),
      ]);
      setPortalModules(portalData);
      setPortalLoginEnabled(portalLoginData ?? true);
      setFinancialConfig(finData);
      setEmailIntConfig(emailData);
      setNotifRules(rulesData);
      setProcessConfig(procData);
      setDeadlineConfig(deadlineData);
      setEmailTemplates(tmplData);
      setLeadConfig(leadData);
      setCalendarConfig(calData);
      setRequirementConfig(reqData);
      setAiProviderConfig(aiProv);
      setAiTaskConfigs(aiTasks);
      setSignatureConfig(sigData);
      setPublicAuthSignConfig({ google: pubAuthGoogle ?? true, email: pubAuthEmail ?? true, phone: pubAuthPhone ?? true });
      setTaskModConfig(taskData);
      setClientConfig(clientData);
      setPortalCustom(portalCustData);
      setPortalClientNotif(portalNotifData);
      setAiPromptOverrides(promptData);
      setAutomationThresholds(autoThreshData);
      setResponsibilityConfig(respData);
      setFormLayouts(formLayoutData);
      setModulesConfig(modulesConfigData);
      setSettingsLoaded(true);
    } catch (error) {
      console.error('Erro ao carregar configurações', error);
      setFeedback('error', 'Falha ao carregar configurações.');
    }
  }, [hasConfigAccess]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const loadUsers = useCallback(async () => {
    if (!hasConfigAccess) return;
    setUsersLoading(true);
    try {
      const list = await settingsService.listUsers();
      setUsers(list);
    } catch (error) {
      console.error('Erro ao carregar usuários', error);
      setFeedback('error', 'Não foi possível carregar os usuários.');
    } finally {
      setUsersLoading(false);
    }
  }, [hasConfigAccess]);

  useEffect(() => {
    if (activeSection === 'users') loadUsers();
  }, [activeSection, loadUsers]);

  const loadPermissions = useCallback(async () => {
    if (!hasConfigAccess) return;
    setPermissionsLoading(true);
    try {
      const perms = await settingsService.getAllPermissions();
      setPermissions(perms);
    } catch (error) {
      setFeedback('error', 'Não foi possível carregar permissões.');
    } finally {
      setPermissionsLoading(false);
    }
  }, [hasConfigAccess]);

  useEffect(() => {
    if (activeSection === 'roles') loadPermissions();
  }, [activeSection, loadPermissions]);

  const loadAudit = useCallback(async (page = 0, dateFrom = auditDateFrom, dateTo = auditDateTo, action = auditActionFilter, userName = auditUserFilter, entity = auditEntityFilter, clientId = auditClientFilter) => {
    if (!hasConfigAccess) return;
    setAuditLoading(true);
    try {
      const filters = {
        ...(action    ? { action }                    : {}),
        ...(entity    ? { entity_type: entity }       : {}),
        ...(userName  ? { user_name: userName }       : {}),
        ...(clientId  ? { client_id: clientId }       : {}),
        ...(dateFrom  ? { date_from: dateFrom }       : {}),
        ...(dateTo    ? { date_to: dateTo }           : {}),
      };
      const [logs, total, sigLogs] = await Promise.all([
        settingsService.getAuditLog({ ...filters, limit: AUDIT_PAGE_SIZE, offset: page * AUDIT_PAGE_SIZE }),
        settingsService.getAuditLogCount(filters),
        // Assinaturas: busca para o mesmo período (sem filtro de entity_type quando filtrando outro módulo)
        (!entity || entity === 'signature_request')
          ? settingsService.getSignatureAuditLog({ date_from: dateFrom || undefined, date_to: dateTo || undefined, limit: AUDIT_PAGE_SIZE })
          : Promise.resolve([] as AuditLogEntry[]),
      ]);

      // Filtra assinaturas pelo cliente selecionado (client_id está em new_value)
      const filteredSigLogs = clientId
        ? sigLogs.filter(e => e.new_value?.client_id === clientId)
        : sigLogs;

      // Merge e ordena por data desc
      const merged = [...logs, ...filteredSigLogs].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ).slice(0, AUDIT_PAGE_SIZE);

      // Enriquece installments com contexto (valor, cliente)
      const installmentIds = merged
        .filter(e => e.entity_type === 'installment' && e.entity_id)
        .map(e => e.entity_id as string);
      if (installmentIds.length > 0) {
        settingsService.getInstallmentContext(installmentIds).then(setAuditInstallmentMap);
      }

      setAuditLog(merged);
      setAuditTotal(total + filteredSigLogs.length); // aproximado para paginação
      setAuditPage(page);
    } catch (error) {
      setFeedback('error', 'Não foi possível carregar a auditoria.');
    } finally {
      setAuditLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasConfigAccess, auditDateFrom, auditDateTo, auditActionFilter, auditUserFilter, auditEntityFilter, auditClientFilter]);

  useEffect(() => {
    if (activeSection === 'audit') {
      loadAudit();
      // Carrega mapa id→nome de clientes uma vez por visita à seção
      supabase.from('clients').select('id, full_name').then(({ data }) => {
        if (data) {
          const map = new Map<string, string>();
          (data as { id: string; full_name: string }[]).forEach(c => map.set(c.id, c.full_name));
          setAuditClientMap(map);
        }
      });
    }
  }, [activeSection, loadAudit]);

  useEffect(() => {
    if (activeSection !== 'automations') return;
    setCronJobsLoading(true);
    settingsService.getCronJobLatest().then(data => {
      setCronJobLatest(data);
      setCronJobsLoading(false);
    }).catch(() => setCronJobsLoading(false));
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'holidays') return;
    setHolidaysLoading(true);
    settingsService.getHolidays().then(data => {
      setHolidays(data);
      setHolidaysLoading(false);
    }).catch(() => setHolidaysLoading(false));
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'secrets') return;
    setSecretsLoading(true);
    settingsService.getSecretsRegistry().then(data => {
      setSecrets(data);
      setSecretsLoading(false);
    }).catch(() => setSecretsLoading(false));
  }, [activeSection]);

  const handleVerifySecrets = async () => {
    const envKeys = secrets.map(s => s.env_var_name).filter(Boolean) as string[];
    if (envKeys.length === 0) return;
    const pinOk = await confirmSettingsMutation({
      action: 'verify_secret_statuses',
      title: 'Verificar status das chaves',
      description: 'Confirme com seu PIN para atualizar o status das chaves registradas.',
      resourceType: 'secret_registry',
    });
    if (!pinOk) return;
    setVerifyingSecrets(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-env-keys', { body: { keys: envKeys } });
      if (error || !data?.results) throw error ?? new Error('Sem resposta');
      const results: Record<string, boolean> = data.results;
      const updated: SecretEntry[] = [];
      for (const s of secrets) {
        if (!s.env_var_name) { updated.push(s); continue; }
        const present = results[s.env_var_name];
        const newStatus: SecretEntry['status'] = present ? 'configured' : s.status === 'revoked' ? 'revoked' : 'unconfigured';
        if (newStatus !== s.status) {
          await settingsService.updateSecretStatus(s.id, newStatus);
          updated.push({ ...s, status: newStatus, last_tested_at: new Date().toISOString() });
        } else {
          updated.push(s);
        }
      }
      setSecrets(updated);
      setFeedback('success', `Verificação concluída — ${envKeys.length} chave(s) verificada(s).`);
    } catch (err: any) {
      setFeedback('error', err?.message || 'Erro ao verificar chaves.');
    } finally {
      setVerifyingSecrets(false);
    }
  };

  const saveIdentity = async () => {
    setSaving(true);
    try {
      const parts = [
        identity.address_street,
        identity.address_number,
        identity.address_neighborhood,
        identity.address_city && identity.address_state
          ? `${identity.address_city} - ${identity.address_state}`
          : identity.address_city || identity.address_state,
        identity.address_cep,
      ].filter(Boolean);
      const derived = { ...identity, address: parts.join(', ') };
      const persisted = await runWithSettingsPin(
        {
          action: 'update_office_identity',
          title: 'Salvar identidade do escritório',
          description: 'Confirme com seu PIN para salvar os dados da identidade do escritório.',
          resourceType: 'office_identity',
        },
        () => settingsService.updateOfficeIdentity(derived, currentProfile?.name),
      );
      if (!persisted) return;
      setFeedback('success', 'Identidade atualizada com sucesso.');
    } catch (error: any) {
      setFeedback('error', error.message || 'Erro ao salvar identidade.');
    } finally {
      setSaving(false);
    }
  };

  const fetchCep = async (cep: string) => {
    const clean = cep.replace(/\D/g, '');
    if (clean.length !== 8) return;
    setCepLoading(true);
    setCepError('');
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const data = await res.json();
      if (data.erro) {
        setCepError('CEP não encontrado.');
        return;
      }
      setIdentity(prev => ({
        ...prev,
        address_street: data.logradouro || prev.address_street,
        address_neighborhood: data.bairro || prev.address_neighborhood,
        address_city: data.localidade || prev.address_city,
        address_state: data.uf || prev.address_state,
      }));
    } catch {
      setCepError('Erro ao consultar o CEP.');
    } finally {
      setCepLoading(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const term = normalizeSearchText(userSearch);
    if (!term) return users;
    return users.filter((u) =>
      [u.name, u.email, u.role, u.phone, u.oab]
        .filter(Boolean)
        .some((value) => matchesNormalizedSearch(term, [value || ''])),
    );
  }, [users, userSearch]);

  const openUserModal = (userData?: UserWithProfile) => {
    if (userData) {
      setSelectedUser(userData);
      setUserFormData({
        name: userData.name,
        email: userData.email,
        role: userData.role?.toLowerCase() || 'advogado',
        cpf: userData.cpf || '',
        phone: userData.phone || '',
        oab: userData.oab || '',
        lawyer_full_name: userData.lawyer_full_name || '',
        avatar_url: userData.avatar_url || '',
      });
      setAvatarPreview(userData.avatar_url || null);
    } else {
      setSelectedUser(null);
      setUserFormData({
        name: '',
        email: '',
        role: 'advogado',
        cpf: '',
        phone: '',
        oab: '',
        lawyer_full_name: '',
        avatar_url: '',
      });
      setAvatarPreview(null);
    }
    setUserModalOpen(true);
  };

  const handleAvatarUpload = async (file: File) => {
    if (!selectedUser) return;
    const pinOk = await confirmSettingsMutation({
      action: 'upload_user_avatar',
      title: 'Alterar foto do usuário',
      description: 'Confirme com seu PIN para alterar a foto do usuário.',
      resourceType: 'user_profile',
      resourceId: selectedUser.user_id,
    });
    if (!pinOk) return;
    setAvatarUploading(true);
    try {
      const url = await settingsService.uploadUserAvatar(selectedUser.user_id, file);
      setUserFormData((prev) => ({ ...prev, avatar_url: url }));
      setAvatarPreview(url);
    } catch (error: any) {
      setFeedback('error', error.message || 'Erro ao enviar foto.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleUserSave = async () => {
    if (!selectedUser) {
      setFeedback('error', 'Para criar usuários, convide pelo painel do Supabase.');
      return;
    }
    setSaving(true);
    try {
      const persisted = await runWithSettingsPin(
        {
          action: 'update_user_profile',
          title: 'Salvar dados do usuário',
          description: 'Confirme com seu PIN para salvar as alterações do usuário.',
          resourceType: 'user_profile',
          resourceId: selectedUser.user_id,
        },
        () => settingsService.updateUserProfile(
        selectedUser.user_id,
        {
          name: userFormData.name,
          email: userFormData.email,
          role: userFormData.role,
          cpf: userFormData.cpf || undefined,
          phone: userFormData.phone || undefined,
          oab: userFormData.oab || undefined,
          lawyer_full_name: userFormData.lawyer_full_name || undefined,
          avatar_url: userFormData.avatar_url || undefined,
        },
        currentProfile?.name,
      ));
      if (!persisted) return;
      setFeedback('success', 'Usuário atualizado com sucesso.');
      setUserModalOpen(false);
      loadUsers();
    } catch (error: any) {
      setFeedback('error', error.message || 'Erro ao salvar usuário.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteUser = async () => {
    if (!deleteTarget) return;
    const pinOk = await confirmSettingsMutation({
      action: 'delete_user_profile',
      title: 'Remover usuário',
      description: 'Confirme com seu PIN para remover o usuário do CRM.',
      resourceType: 'user_profile',
      resourceId: deleteTarget.user_id,
    });
    if (!pinOk) return;
    setDeleteLoading(true);
    try {
      await settingsService.deleteUserProfile(deleteTarget.user_id, currentProfile?.name);
      setFeedback('success', 'Usuário removido do CRM.');
      setDeleteTarget(null);
      loadUsers();
    } catch (error: any) {
      setFeedback('error', error.message || 'Erro ao remover usuário.');
    } finally {
      setDeleteLoading(false);
    }
  };

  const rolePermissions = useMemo(
    () => permissions.filter((perm) => perm.role === selectedRole.toLowerCase()),
    [permissions, selectedRole],
  );

  const updatePermission = async (
    moduleKey: string,
    field: 'can_view' | 'can_create' | 'can_edit' | 'can_delete',
    value: boolean,
  ) => {
    const pinOk = await requirePin({
      action: 'update_permission',
      resourceType: 'permission',
      resourceId: `${selectedRole}_${moduleKey}`,
      sensitivity: 'critical',
      title: 'Alterar permissões',
      description: 'Confirme com seu PIN para alterar as permissões de acesso.',
    });
    if (!pinOk) return;
    try {
      await settingsService.updatePermission(selectedRole, moduleKey, { [field]: value }, currentProfile?.name);
      setPermissions((prev) =>
        prev.map((perm) =>
          perm.role === selectedRole.toLowerCase() && perm.module === moduleKey
            ? { ...perm, [field]: value }
            : perm,
        ),
      );
    } catch (error: any) {
      setFeedback('error', error.message || 'Erro ao atualizar permissão.');
    }
  };

  if (pageLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amber-600 animate-spin" />
      </div>
    );
  }

  if (!hasConfigAccess) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="max-w-md text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center">
            <Shield className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Acesso restrito</h2>
          <p className="text-sm text-slate-500">
            Apenas administradores e advogados podem acessar as configurações. Seu papel atual é
            {' '}
            <strong>{currentProfile?.role || 'Indefinido'}</strong>.
          </p>
        </div>
      </div>
    );
  }

  // Busca flat de todas as seções para o header e para o filtro de busca
  const allSectionItems = SETTINGS_GROUPS.flatMap(g => g.items);

  // Grupos filtrados pela busca (mantendo estrutura de grupos)
  const filteredGroups = navSearch.trim()
    ? SETTINGS_GROUPS.map(g => ({
        ...g,
        items: g.items.filter(s => matchesNormalizedSearch(navSearch, [s.label, s.description])),
      })).filter(g => g.items.length > 0)
    : SETTINGS_GROUPS;

  const activeItem = allSectionItems.find(s => s.key === activeSection);
  const activeGroup = SETTINGS_GROUPS.find(g => g.items.some(i => i.key === activeSection));
  const ActiveIcon = activeItem?.icon;

  const cssStyles = `
  /* ── Scrollbar ── */
  .settings-scroll::-webkit-scrollbar { width: 4px; }
  .settings-scroll::-webkit-scrollbar-track { background: transparent; }
  .settings-scroll::-webkit-scrollbar-thumb { background: rgba(15,23,42,0.10); border-radius: 10px; }
  .settings-scroll::-webkit-scrollbar-thumb:hover { background: rgba(15,23,42,0.20); }
  .settings-scroll { scrollbar-width: thin; scrollbar-color: rgba(15,23,42,0.10) transparent; }

  /* ── Inputs ── */
  .settings-input {
    width: 100%; padding: 9px 13px; font-size: 13.5px; color: #191c1e;
    background: #fff; border: 1px solid rgba(15,23,42,0.13); border-radius: 8px;
    outline: none; transition: border-color .15s ease, box-shadow .15s ease;
    box-sizing: border-box;
  }
  .settings-input:focus { border-color: #ff8a00; box-shadow: 0 0 0 3px rgba(255,138,0,0.09); }
  .settings-input::placeholder { color: #b0b5bc; }

  .settings-select {
    width: 100%; padding: 9px 13px; font-size: 13.5px; color: #191c1e;
    background: #fff; border: 1px solid rgba(15,23,42,0.13); border-radius: 8px;
    outline: none; cursor: pointer; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23747878' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 11px center;
    padding-right: 32px;
    transition: border-color .15s ease, box-shadow .15s ease;
  }
  .settings-select:focus { border-color: #ff8a00; box-shadow: 0 0 0 3px rgba(255,138,0,0.09); }

  /* ── Labels ── */
  .settings-label {
    display: block; font-size: 11.5px; font-weight: 600;
    color: #6b7280; margin-bottom: 5px; letter-spacing: 0.01em;
  }

  /* ── Cards — mais leves, mais respiro ── */
  .settings-card {
    background: #fafafa; border: 1px solid rgba(15,23,42,0.06);
    border-radius: 12px; padding: 22px 24px;
  }

  .settings-card-title {
    font-size: 11px; font-weight: 700; color: #9ca3af;
    text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 18px;
  }

  /* ── Sticky save footer ── */
  .settings-save-bar {
    flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end;
    gap: 10px; padding: 14px 40px 18px;
    border-top: 1px solid rgba(15,23,42,0.06);
    background: rgba(255,255,255,0.96);
    backdrop-filter: blur(8px);
  }

  /* ── Buttons ── */
  .settings-btn-primary {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 9px 20px; font-size: 13px; font-weight: 600; color: #fff;
    background: #ea6c00; border: none; border-radius: 9px; cursor: pointer;
    transition: background .15s ease, box-shadow .15s ease;
  }
  .settings-btn-primary:hover { background: #d46000; box-shadow: 0 2px 10px rgba(234,108,0,0.28); }
  .settings-btn-primary:disabled { opacity: 0.50; cursor: not-allowed; }

  .settings-btn-ghost {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; font-size: 13px; font-weight: 500; color: #555f6e;
    background: transparent; border: 1px solid rgba(15,23,42,0.11); border-radius: 9px; cursor: pointer;
    transition: background .12s ease, border-color .12s ease;
  }
  .settings-btn-ghost:hover { background: #f2f4f6; border-color: rgba(15,23,42,0.18); }

  /* ── Toggle ── */
  .settings-toggle {
    position: relative; width: 44px; height: 24px; border: none;
    background: #d1d5db; border-radius: 999px; cursor: pointer;
    transition: background .2s ease; flex-shrink: 0; padding: 0;
  }
  .settings-toggle.on { background: #16a34a; }
  .settings-toggle::after {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 20px; height: 20px; background: #fff; border-radius: 50%;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2); transition: transform .2s ease;
  }
  .settings-toggle.on::after { transform: translateX(20px); }

  /* ── Row items ── */
  .settings-row-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px; background: #fff; border: 1px solid rgba(15,23,42,0.06);
    border-radius: 10px;
  }

  .settings-section-divider {
    height: 1px; background: rgba(15,23,42,0.05); margin: 6px 0;
  }

  /* ── Sidebar nav item transition ── */
  .settings-nav-item {
    transition: background .13s ease, color .13s ease;
  }

  /* ── Hub (visão geral) ── */
  .settings-hub-item {
    transition: background .12s ease;
  }
  .settings-hub-item:hover { background: #fff6ec !important; }
  .settings-hub-row {
    transition: border-color .12s ease, box-shadow .12s ease, transform .12s ease;
  }
  .settings-hub-row:hover {
    border-color: rgba(234,108,0,0.35) !important;
    box-shadow: 0 2px 12px rgba(234,108,0,0.10);
  }
  .settings-hub-tile {
    position: relative;
    transition: border-color .14s ease, box-shadow .14s ease, transform .14s ease, background .14s ease;
  }
  .settings-hub-tile:hover {
    border-color: rgba(234,108,0,0.45) !important;
    box-shadow: 0 6px 20px rgba(234,108,0,0.12), 0 1px 2px rgba(15,23,42,0.04);
    transform: translateY(-2px);
  }
  .settings-hub-tile:hover .settings-hub-tile-icon {
    background: #ff8a00 !important;
    color: #fff !important;
  }
  .settings-hub-tile:hover .settings-hub-tile-arrow {
    opacity: 1 !important;
    transform: translateX(0) !important;
  }
  .settings-hub-tile-icon {
    transition: background .14s ease, color .14s ease;
  }
  .settings-hub-tile-arrow {
    transition: opacity .14s ease, transform .14s ease;
  }
  @keyframes settingsHubFade {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .settings-hub-group {
    animation: settingsHubFade .32s ease both;
  }
  .settings-nav-group-btn { transition: background .12s ease, color .12s ease; }
  .settings-nav-group-btn:hover { background: #f1f2f4 !important; }
  .settings-nav-item { transition: background .12s ease, color .12s ease, border-color .12s ease; }
  .settings-nav-item:hover { background: #f4f5f7 !important; }
  .settings-nav-item-active { background: #fff6ec !important; }
  .settings-nav-item-active:hover { background: #ffeedc !important; }
  .settings-section-head { animation: settingsHubFade .26s ease both; }
  .settings-fade-key { animation: settingsHubFade .30s ease both; }
  .settings-back-pill { transition: background .14s ease, color .14s ease; }
  .settings-back-pill:hover { background: #fff6ec; color: #ea6c00 !important; }
  .settings-back-pill:hover .settings-back-ico { transform: translateX(-2px); }
  .settings-back-ico { transition: transform .14s ease; }
  .settings-head-icon { animation: settingsHeadPop .32s cubic-bezier(0.22,0.68,0,1.2) both; }
  @keyframes settingsHeadPop {
    from { opacity: 0; transform: scale(0.82); }
    to   { opacity: 1; transform: scale(1); }
  }
  .settings-card { transition: border-color .16s ease, box-shadow .16s ease; }
  .settings-card:hover { border-color: rgba(234,108,0,0.16); box-shadow: 0 2px 16px rgba(15,23,42,0.05); }
`;

  // Corpo compartilhado — sem sidebar duplicado, header unificado no topo
  const settingsBody = (
    <div className="flex flex-col w-full min-h-0 overflow-hidden bg-slate-50">

      {/* ── Header bar ── */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-8 pt-5 pb-4">
        {activeSection !== 'overview' ? (
          <div className="settings-section-head" key={activeSection}>
            {/* Breadcrumb compacto / voltar */}
            <button
              onClick={() => setActiveSection('overview')}
              className="settings-back-pill -ml-2 mb-2.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-400"
            >
              <ChevronLeft className="settings-back-ico w-3.5 h-3.5" />
              Configurações
              {activeGroup && (
                <>
                  <span className="text-slate-300">/</span>
                  <span>{activeGroup.label}</span>
                </>
              )}
            </button>
            {/* Título da seção com ícone */}
            <div className="flex items-center gap-3.5">
              {ActiveIcon && (
                <span
                  className="settings-head-icon flex shrink-0 items-center justify-center"
                  style={{ width: '44px', height: '44px', borderRadius: '13px', background: '#fff6ec' }}
                >
                  <ActiveIcon style={{ width: '21px', height: '21px', color: '#ea6c00' }} />
                </span>
              )}
              <div className="min-w-0">
                <h1 className="text-xl font-bold leading-tight text-slate-900" style={{ letterSpacing: '-0.02em' }}>{activeItem?.label}</h1>
                {activeItem?.description && (
                  <p className="mt-0.5 text-sm text-slate-500">{activeItem.description}</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-slate-900">Configurações</h1>
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                autoFocus
                value={navSearch}
                onChange={e => setNavSearch(e.target.value)}
                placeholder="Buscar configuração..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none placeholder:text-slate-400 focus:bg-white focus:border-orange-500 focus:ring-2 focus:ring-orange-100 transition-all"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Feedback ── */}
      {(globalError || globalSuccess) && (
        <div className="shrink-0 px-8 pt-4">
          {globalError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {globalError}
              <button type="button" className="ml-auto" onClick={() => setGlobalError(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {globalSuccess && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2 mt-2">
              <Check className="w-4 h-4 flex-shrink-0" />
              {globalSuccess}
              <button type="button" className="ml-auto" onClick={() => setGlobalSuccess(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!settingsLoaded && activeSection === 'identity' ? (
              <div className="p-12 text-center">
                <Loader2 className="w-8 h-8 text-amber-600 animate-spin mx-auto" />
                <p className="text-sm text-slate-500 mt-3">Carregando identidade...</p>
              </div>
            ) : (
              <div key={activeSection} className="settings-fade-key" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {activeSection === 'identity' && (
                  <div className="settings-scroll" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ flex: 1, padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                      {/* Card: Dados do escritório */}
                      <div className="settings-card">
                        <p className="settings-card-title">Dados do Escritório</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                          <div style={{ gridColumn: '1 / -1' }}>
                            <label className="settings-label">Nome do Escritório *</label>
                            <input className="settings-input" type="text" value={identity.name}
                              onChange={(e) => setIdentity({ ...identity, name: e.target.value })}
                              placeholder="Ex: Montalvão Advocacia Integrada" />
                          </div>
                          <div>
                            <label className="settings-label">CPF / CNPJ</label>
                            <input className="settings-input" type="text" value={identity.cnpj}
                              onChange={(e) => {
                                const digits = e.target.value.replace(/\D/g, '').slice(0, 14);
                                let formatted = digits;
                                if (digits.length <= 11) {
                                  if (digits.length > 9) formatted = `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
                                  else if (digits.length > 6) formatted = `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6)}`;
                                  else if (digits.length > 3) formatted = `${digits.slice(0,3)}.${digits.slice(3)}`;
                                  else formatted = digits;
                                } else {
                                  if (digits.length > 12) formatted = `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12)}`;
                                  else if (digits.length > 8) formatted = `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8)}`;
                                  else if (digits.length > 5) formatted = `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5)}`;
                                  else if (digits.length > 2) formatted = `${digits.slice(0,2)}.${digits.slice(2)}`;
                                  else formatted = digits;
                                }
                                setIdentity({ ...identity, cnpj: formatted });
                              }}
                              placeholder="000.000.000-00 ou 00.000.000/0001-00"
                              maxLength={18} />
                          </div>
                          <div>
                            <label className="settings-label">Registro OAB</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: '8px' }}>
                              <input className="settings-input" type="text" value={identity.oab_state}
                                onChange={(e) => setIdentity({ ...identity, oab_state: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) })}
                                placeholder="MT" maxLength={2}
                                style={{ textAlign: 'center', fontWeight: 600 }} />
                              <input className="settings-input" type="text" value={identity.oab_number}
                                onChange={(e) => setIdentity({ ...identity, oab_number: e.target.value })}
                                placeholder="000.000" />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Card: Endereço */}
                      <div className="settings-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '14px' }}>
                          <MapPin size={14} style={{ color: '#ea6c00' }} />
                          <p className="settings-card-title" style={{ margin: 0 }}>Endereço</p>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                          {/* CEP */}
                          <div>
                            <label className="settings-label">CEP</label>
                            <div style={{ position: 'relative' }}>
                              <input className="settings-input" type="text" value={identity.address_cep}
                                style={{ paddingRight: cepLoading ? '32px' : undefined }}
                                onChange={(e) => {
                                  const v = e.target.value.replace(/\D/g, '').slice(0, 8);
                                  const formatted = v.length > 5 ? `${v.slice(0,5)}-${v.slice(5)}` : v;
                                  setIdentity({ ...identity, address_cep: formatted });
                                  setCepError('');
                                }}
                                onBlur={(e) => fetchCep(e.target.value)}
                                placeholder="00000-000" />
                              {cepLoading && (
                                <Loader2 size={13} className="animate-spin" style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#ea6c00' }} />
                              )}
                            </div>
                            {cepError && <p style={{ fontSize: '11.5px', color: '#dc2626', marginTop: '4px' }}>{cepError}</p>}
                          </div>
                          {/* Número */}
                          <div>
                            <label className="settings-label">Número</label>
                            <input className="settings-input" type="text" value={identity.address_number}
                              onChange={(e) => setIdentity({ ...identity, address_number: e.target.value })}
                              placeholder="Ex: 123 / S/N" />
                          </div>
                          {/* Logradouro */}
                          <div style={{ gridColumn: '1 / -1' }}>
                            <label className="settings-label">Logradouro</label>
                            <input className="settings-input" type="text" value={identity.address_street}
                              onChange={(e) => setIdentity({ ...identity, address_street: e.target.value })}
                              placeholder="Rua, Avenida, Travessa..." />
                          </div>
                          {/* Bairro */}
                          <div>
                            <label className="settings-label">Bairro</label>
                            <input className="settings-input" type="text" value={identity.address_neighborhood}
                              onChange={(e) => setIdentity({ ...identity, address_neighborhood: e.target.value })}
                              placeholder="Bairro" />
                          </div>
                          {/* Cidade + UF */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '10px' }}>
                            <div>
                              <label className="settings-label">Cidade</label>
                              <input className="settings-input" type="text" value={identity.address_city}
                                onChange={(e) => setIdentity({ ...identity, address_city: e.target.value })}
                                placeholder="Cidade" />
                            </div>
                            <div>
                              <label className="settings-label">UF</label>
                              <input className="settings-input" type="text" value={identity.address_state}
                                onChange={(e) => setIdentity({ ...identity, address_state: e.target.value.toUpperCase().slice(0,2) })}
                                placeholder="MT" maxLength={2} />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Card: Contato */}
                      <div className="settings-card">
                        <p className="settings-card-title">Contato</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                          <div>
                            <label className="settings-label">Email principal *</label>
                            <input className="settings-input" type="email" value={identity.email}
                              onChange={(e) => setIdentity({ ...identity, email: e.target.value })} />
                          </div>
                          <div>
                            <label className="settings-label">Telefone</label>
                            <input className="settings-input" type="tel" value={identity.phone}
                              onChange={(e) => setIdentity({ ...identity, phone: e.target.value })} />
                          </div>
                        </div>
                      </div>

                    </div>

                    {/* Sticky save bar */}
                    <div className="settings-save-bar">
                      <button className="settings-btn-primary" onClick={saveIdentity} disabled={saving}>
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Salvar alterações
                      </button>
                    </div>
                  </div>
                )}

                {activeSection !== 'identity' && (
                <div className="settings-scroll" style={{ flex: 1, overflowY: 'auto' }}>

                {activeSection === 'users' && <UserManagementModule />}

                {activeSection === 'roles' && (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    {/* Role selector bar */}
                    <div style={{ flexShrink: 0, padding: '16px 40px 14px', borderBottom: '1px solid rgba(15,23,42,0.06)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {ROLES.map((role) => {
                        const RoleIcon = role.icon;
                        const isSelected = selectedRole === role.key;
                        return (
                          <button
                            key={role.key}
                            onClick={() => setSelectedRole(role.key)}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '6px',
                              padding: '6px 13px', borderRadius: '999px', fontSize: '12.5px', fontWeight: 600,
                              border: `1px solid ${isSelected ? 'rgba(255,138,0,0.35)' : 'rgba(15,23,42,0.10)'}`,
                              background: isSelected ? 'rgba(255,138,0,0.08)' : '#fff',
                              color: isSelected ? '#c45c00' : '#444748',
                              cursor: 'pointer', transition: 'all .12s ease',
                            }}
                          >
                            <RoleIcon size={12} />
                            {role.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Admin notice */}
                    {selectedRole === 'administrador' && (
                      <div style={{ flexShrink: 0, margin: '12px 24px 0', padding: '10px 14px',
                        background: 'rgba(255,138,0,0.06)', border: '1px solid rgba(255,138,0,0.20)',
                        borderRadius: '9px', fontSize: '12.5px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <AlertTriangle size={13} style={{ color: '#ea6c00', flexShrink: 0 }} />
                        Administradores possuem todas as permissões e não podem ser limitados.
                      </div>
                    )}

                    {/* Module list */}
                    <div className="settings-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 40px 20px' }}>
                      {permissionsLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px' }}>
                          <Loader2 size={20} className="animate-spin" style={{ color: '#ea6c00' }} />
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {/* Header row */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 64px 64px 64px', gap: '4px',
                            padding: '6px 14px', borderRadius: '8px', background: '#f8f9fb',
                            marginBottom: '2px' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#747878', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Módulo</span>
                            {['Ver', 'Criar', 'Editar', 'Excluir'].map(h => (
                              <span key={h} style={{ fontSize: '11px', fontWeight: 700, color: '#747878', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center' }}>{h}</span>
                            ))}
                          </div>
                          {MODULES.map((module) => {
                            const rolePerm = rolePermissions.find((perm) => perm.module === module.key);
                            const disabled = selectedRole === 'administrador';
                            return (
                              <div
                                key={module.key}
                                style={{ display: 'grid', gridTemplateColumns: '1fr 64px 64px 64px 64px', gap: '4px',
                                  alignItems: 'center', padding: '9px 14px', borderRadius: '9px',
                                  border: '1px solid rgba(15,23,42,0.06)', background: '#fff',
                                  transition: 'background .12s ease, border-color .12s ease' }}
                                onMouseEnter={e => { e.currentTarget.style.background = '#fafafa'; e.currentTarget.style.borderColor = 'rgba(15,23,42,0.10)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'rgba(15,23,42,0.06)'; }}
                              >
                                <span style={{ fontSize: '13px', fontWeight: 500, color: '#191c1e' }}>{module.label}</span>
                                {(['can_view', 'can_create', 'can_edit', 'can_delete'] as const).map((field) => {
                                  const active = (rolePerm as any)?.[field] || disabled;
                                  return (
                                    <div key={field} style={{ display: 'flex', justifyContent: 'center' }}>
                                      <button
                                        disabled={disabled}
                                        onClick={() => updatePermission(module.key, field, !(rolePerm as any)?.[field])}
                                        style={{ width: '28px', height: '28px', borderRadius: '7px', border: 'none',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          background: active ? '#ea6c00' : 'rgba(15,23,42,0.07)',
                                          color: active ? '#fff' : '#9ca3af',
                                          cursor: disabled ? 'not-allowed' : 'pointer',
                                          opacity: disabled ? 0.75 : 1,
                                          transition: 'background .12s ease' }}
                                        onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = active ? '#d46000' : 'rgba(15,23,42,0.12)'; }}
                                        onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = active ? '#ea6c00' : 'rgba(15,23,42,0.07)'; }}
                                      >
                                        {active ? <Check size={13} /> : <X size={13} />}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeSection === 'audit' && (() => {
                  // ── Tabelas de tradução ──────────────────────────────────
                  const AUDIT_ACTION_VERBS: Record<string, string> = {
                    insert: 'criou', update: 'atualizou', delete: 'removeu',
                    security_pin_verified: 'verificou PIN de segurança em',
                    update_security_config: 'atualizou as configurações de segurança',
                    update_djen_config: 'atualizou a configuração do DJEN',
                    update_notification_config: 'atualizou as configurações de notificação',
                    signed: 'assinou o documento',
                    viewed: 'abriu o documento',
                    cancelled: 'cancelou a assinatura de',
                    rejected: 'recusou assinar',
                    resent: 'reenviou link de assinatura de',
                    expired: 'expirou a solicitação de',
                    blocked: 'bloqueou a assinatura de',
                  };
                  const AUDIT_ENTITY_LABELS: Record<string, string> = {
                    deadlines: 'prazo', clients: 'cliente', processes: 'processo',
                    requirements: 'requerimento', calendar_events: 'compromisso',
                    tasks: 'tarefa', leads: 'lead', audit_log: 'registro de auditoria',
                    system_settings: 'configuração', profiles: 'usuário',
                    role_permissions: 'permissão', user_module_overrides: 'permissão personalizada',
                    installment: 'parcela', installments: 'parcelas',
                    agreement: 'acordo', system: 'sistema',
                    signature_request: 'documento',
                    calendar_event: 'compromisso',
                  };
                  const SETTINGS_KEY_LABELS: Record<string, string> = {
                    client_module_config: 'Clientes', process_module_config: 'Processos',
                    deadline_module_config: 'Prazos', task_module_config: 'Tarefas',
                    calendar_module_config: 'Agenda', lead_module_config: 'Leads',
                    requirement_module_config: 'Requerimentos', signature_module_config: 'Assinaturas',
                    financial_module_config: 'Financeiro', notification_rules: 'Regras de Notificação',
                    email_templates: 'Templates de E-mail', notification_config: 'Notificações',
                    security_config: 'Segurança', office_identity: 'Identidade do Escritório',
                    preferences: 'Preferências Gerais', portal_modules_config: 'Módulos do Portal',
                    portal_customization_config: 'Personalização do Portal',
                    portal_client_notifications_config: 'Notificações do Portal',
                    ai_provider_config: 'Provedores de IA', automation_thresholds: 'Limiares de Automação',
                    email_integration_config: 'E-mail (integração)', djen_config: 'DJEN',
                    form_layouts: 'Layouts de Formulário', role_permissions: 'Permissões',
                    automation_secrets: 'Cofre de Chaves',
                  };
                  const AUDIT_ACTION_COLORS: Record<string, { bg: string; color: string; dot: string }> = {
                    insert:                 { bg: '#f0fdf4', color: '#166534', dot: '#22c55e' },
                    delete:                 { bg: '#fef2f2', color: '#991b1b', dot: '#ef4444' },
                    security_pin_verified:  { bg: '#eff6ff', color: '#1e40af', dot: '#3b82f6' },
                    signed:                 { bg: '#f0fdf4', color: '#166534', dot: '#22c55e' },
                    viewed:                 { bg: '#f8fafc', color: '#475569', dot: '#94a3b8' },
                    cancelled:              { bg: '#fef2f2', color: '#991b1b', dot: '#ef4444' },
                    rejected:               { bg: '#fef2f2', color: '#991b1b', dot: '#ef4444' },
                    blocked:                { bg: '#fef2f2', color: '#991b1b', dot: '#ef4444' },
                    resent:                 { bg: '#fffbeb', color: '#92400e', dot: '#f59e0b' },
                  };
                  const getColor = (action: string) =>
                    AUDIT_ACTION_COLORS[action] ?? { bg: '#fffbeb', color: '#92400e', dot: '#f59e0b' };

                  const SKIP_DIFF = new Set([
                    'id', 'created_at', 'updated_at', 'notified_at', 'completed_at',
                    'djen_last_sync', 'djen_synced', 'djen_has_data', 'datajud_synced_at',
                    'datajud_cache', 'alarm_triggered', 'user_agent', 'ip_address',
                  ]);
                  const FIELD_LABELS: Record<string, string> = {
                    title: 'Título', full_name: 'Nome', name: 'Nome', status: 'Status',
                    priority: 'Prioridade', due_date: 'Vencimento', description: 'Descrição',
                    type: 'Tipo', process_code: 'Número do processo', court: 'Vara',
                    practice_area: 'Área', notes: 'Anotações', hearing_date: 'Audiência',
                    deadline_days: 'Prazo (dias)', notify_days_before: 'Notificar antes (dias)',
                    email: 'E-mail', phone: 'Telefone', document_number: 'CPF/CNPJ',
                    responsible_id: 'Responsável', client_id: 'Cliente',
                    stage: 'Estágio', origin: 'Origem', value: 'Valor',
                    counting_type: 'Tipo de contagem', publication_date: 'Publicação',
                    beneficiary: 'Beneficiário', protocol: 'Protocolo',
                    start_at: 'Início', end_at: 'Fim', event_type: 'Tipo de evento',
                    role: 'Papel', is_active: 'Ativo', audit_log_enabled: 'Log de auditoria',
                    responsible_lawyer: 'Advogado responsável', amount: 'Valor',
                    due_amount: 'Valor devido', paid_amount: 'Valor pago',
                    hearing_scheduled: 'Audiência agendada', status_manual: 'Status manual',
                  };
                  const ENTITY_NAME_FIELDS: Record<string, string[]> = {
                    clients:         ['full_name'],
                    deadlines:       ['title'],
                    processes:       ['process_code'],
                    requirements:    ['beneficiary', 'protocol'],
                    calendar_events: ['title'],
                    tasks:           ['title'],
                    leads:           ['name', 'full_name'],
                    profiles:        ['name', 'full_name'],
                    system_settings: [],
                  };
                  // Entidades que têm client_id e devem mostrar o cliente vinculado
                  const HAS_CLIENT_ID = new Set(['deadlines','processes','requirements','calendar_events','tasks','leads']);

                  // ── Funções auxiliares ───────────────────────────────────
                  const formatVal = (v: any): string => {
                    if (v === null || v === undefined) return '—';
                    if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
                    if (Array.isArray(v)) {
                      if (v.length === 0) return '(lista vazia)';
                      if (typeof v[0] === 'object' && v[0] !== null) {
                        const labels = v.map((item: any) => item.label || item.name || item.title || item.value || '').filter(Boolean);
                        if (labels.length > 0) {
                          const preview = labels.slice(0, 3).join(', ');
                          return labels.length > 3 ? `${preview} e mais ${labels.length - 3}` : preview;
                        }
                        return `${v.length} ${v.length === 1 ? 'item' : 'itens'}`;
                      }
                      const strs = v.slice(0, 5).map(String);
                      return strs.join(', ') + (v.length > 5 ? ` +${v.length - 5}` : '');
                    }
                    if (typeof v === 'object') return JSON.stringify(v).slice(0, 50) + '…';
                    const s = String(v);
                    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
                      try { return new Date(s).toLocaleDateString('pt-BR'); } catch { return s; }
                    }
                    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
                      const [y, m, d] = s.split('-');
                      return `${d}/${m}/${y}`;
                    }
                    // UUID → resolve cliente se disponível, senão curto
                    if (/^[0-9a-f-]{36}$/i.test(s)) {
                      return auditClientMap.get(s) ?? s.slice(0, 8) + '…';
                    }
                    if (s.length > 60) return s.slice(0, 57) + '…';
                    return s;
                  };

                  const getEntityName = (e: AuditLogEntry): string | null => {
                    // system_settings: usa chave legível
                    if (e.entity_type === 'system_settings' && e.entity_id) {
                      return SETTINGS_KEY_LABELS[e.entity_id] ?? e.entity_id.replace(/_/g, ' ');
                    }
                    const src = e.action === 'delete' ? e.old_value : (e.new_value ?? e.old_value);
                    if (!src || typeof src !== 'object') return null;
                    const fields = ENTITY_NAME_FIELDS[e.entity_type] ?? [];
                    for (const f of fields) {
                      if (src[f]) return String(src[f]);
                    }
                    return null;
                  };

                  const getClientName = (e: AuditLogEntry): string | null => {
                    // Assinatura: client_name vem no new_value._source
                    if (e.entity_type === 'signature_request' && e.new_value?._source === 'signature_audit_log') {
                      return e.new_value.client_name ?? null;
                    }
                    // Installment: vem do mapa carregado pelo serviço
                    if (e.entity_type === 'installment' && e.entity_id) {
                      return auditInstallmentMap.get(e.entity_id)?.client_name ?? null;
                    }
                    if (!HAS_CLIENT_ID.has(e.entity_type)) return null;
                    const src = e.new_value ?? e.old_value;
                    if (!src || typeof src !== 'object') return null;
                    const cid = src.client_id;
                    if (!cid) return null;
                    return auditClientMap.get(cid) ?? null;
                  };

                  const formatUserName = (name: string | null): string => {
                    if (!name) return 'Sistema';
                    // email sem nome → mostra a parte local
                    if (name.includes('@') && !name.includes(' ')) return name.split('@')[0];
                    return name;
                  };

                  type DiffItem = { field: string; label: string; oldVal: string; newVal: string };
                  const getDiff = (e: AuditLogEntry): DiffItem[] => {
                    if (e.action !== 'update') return [];
                    const ov = e.old_value; const nv = e.new_value;
                    if (!ov || !nv || typeof ov !== 'object' || typeof nv !== 'object') return [];
                    const diffs: DiffItem[] = [];
                    const allKeys = new Set([...Object.keys(ov), ...Object.keys(nv)]);
                    for (const key of allKeys) {
                      if (SKIP_DIFF.has(key)) continue;
                      const o = ov[key]; const n = nv[key];
                      if (JSON.stringify(o) === JSON.stringify(n)) continue;
                      if ((o === null || o === undefined) && (n === null || n === undefined)) continue;
                      // Campos UUID que têm resolução no cliente
                      let oldVal = formatVal(o);
                      let newVal = formatVal(n);
                      diffs.push({ field: key, label: FIELD_LABELS[key] ?? key.replace(/_/g, ' '), oldVal, newVal });
                    }
                    return diffs.slice(0, 8);
                  };

                  const isSystemOnlyUpdate = (e: AuditLogEntry): boolean => {
                    if (e.action !== 'update') return false;
                    return getDiff(e).length === 0;
                  };

                  const totalPages = Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE));
                  const firstItem  = auditTotal === 0 ? 0 : auditPage * AUDIT_PAGE_SIZE + 1;
                  const lastItem   = Math.min((auditPage + 1) * AUDIT_PAGE_SIZE, auditTotal);

                  return (
                    <div style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

                      {/* Barra de filtros */}
                      <div className="settings-card" style={{ padding: '16px 18px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280' }}>De</label>
                          <input type="date" value={auditDateFrom}
                            onChange={e => setAuditDateFrom(e.target.value)}
                            style={{ fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '6px 10px', color: '#374151' }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280' }}>Até</label>
                          <input type="date" value={auditDateTo}
                            onChange={e => setAuditDateTo(e.target.value)}
                            style={{ fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '6px 10px', color: '#374151' }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280' }}>Ação</label>
                          <select value={auditActionFilter} onChange={e => setAuditActionFilter(e.target.value)}
                            style={{ fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '6px 10px', color: '#374151', background: '#fff' }}>
                            <option value="">Todas</option>
                            <option value="insert">Criação</option>
                            <option value="update">Atualização</option>
                            <option value="delete">Remoção</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280' }}>Módulo</label>
                          <select value={auditEntityFilter} onChange={e => setAuditEntityFilter(e.target.value)}
                            style={{ fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '6px 10px', color: '#374151', background: '#fff' }}>
                            <option value="">Todos</option>
                            <option value="clients">Clientes</option>
                            <option value="processes">Processos</option>
                            <option value="deadlines">Prazos</option>
                            <option value="tasks">Tarefas</option>
                            <option value="calendar_events">Agenda</option>
                            <option value="leads">Leads</option>
                            <option value="requirements">Requerimentos</option>
                            <option value="system_settings">Configurações</option>
                            <option value="profiles">Usuários</option>
                            <option value="role_permissions">Permissões</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '200px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280' }}>Cliente</label>
                          <ClientSearchSelect
                            value={auditClientFilter}
                            onChange={(id) => setAuditClientFilter(id)}
                            placeholder="Buscar cliente..."
                            allowCreate={false}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexGrow: 1, minWidth: '160px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280' }}>Usuário</label>
                          <input type="text" placeholder="Nome do usuário..." value={auditUserFilter}
                            onChange={e => setAuditUserFilter(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && loadAudit(0)}
                            style={{ fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '6px 10px', color: '#374151' }} />
                        </div>
                        <button onClick={() => loadAudit(0)}
                          style={{ height: '34px', padding: '0 16px', background: '#ff8a00', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <RefreshCw size={13} /> Buscar
                        </button>
                        {(auditDateFrom || auditDateTo || auditActionFilter || auditUserFilter || auditEntityFilter || auditClientFilter) && (
                          <button onClick={() => { setAuditDateFrom(''); setAuditDateTo(''); setAuditActionFilter(''); setAuditUserFilter(''); setAuditEntityFilter(''); setAuditClientFilter(''); setTimeout(() => loadAudit(0, '', '', '', '', '', ''), 0); }}
                            style={{ height: '34px', padding: '0 12px', background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>
                            Limpar
                          </button>
                        )}
                      </div>
                      </div>

                      {/* Totalizador */}
                      {!auditLoading && (
                        <p style={{ fontSize: '12px', color: '#9ca3af' }}>
                          {auditTotal === 0 ? 'Nenhum registro encontrado.' : `${firstItem}–${lastItem} de ${auditTotal.toLocaleString('pt-BR')} registros`}
                        </p>
                      )}

                      {/* Lista */}
                      {auditLoading ? (
                        <div style={{ padding: '40px 0', textAlign: 'center' }}>
                          <Loader2 className="w-8 h-8 animate-spin mx-auto" style={{ color: '#9ca3af' }} />
                        </div>
                      ) : auditLog.length === 0 ? (
                        <div style={{ borderRadius: '10px', border: '1px solid #f1f5f9', background: '#f8fafc', padding: '32px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>
                          Nenhum registro encontrado para os filtros aplicados.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {auditLog.map((entry) => {
                            const col     = getColor(entry.action);
                            const dt      = new Date(entry.created_at);
                            const dateStr = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                            const timeStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                            const sysOnly = isSystemOnlyUpdate(entry);

                            // Ocultar atualizações automáticas de sistema sem autor e sem diff legível
                            if (sysOnly && !entry.user_name) return null;

                            // ── Assinatura: renderização especial ──────────────
                            if (entry.entity_type === 'signature_request' && entry.new_value?._source === 'signature_audit_log') {
                              const nv = entry.new_value;
                              const signerName = formatUserName(entry.user_name) || 'Signatário';
                              const verb = AUDIT_ACTION_VERBS[entry.action] ?? entry.action;
                              return (
                                <div key={entry.id} style={{ padding: '13px 16px', borderRadius: '10px', border: '1px solid rgba(15,23,42,0.06)', background: '#fff' }}>
                                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: col.dot, marginTop: '6px', flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <p style={{ margin: 0, fontSize: '13.5px', color: '#111827', lineHeight: 1.6 }}>
                                        <strong style={{ fontWeight: 700 }}>{signerName}</strong>{' '}
                                        <span style={{ color: col.color, fontWeight: 500 }}>{verb}</span>
                                        {nv.document_name && <span style={{ marginLeft: '4px', fontWeight: 700 }}>"{nv.document_name}"</span>}
                                      </p>
                                      {nv.client_name && <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#6b7280' }}>👤 Cliente: <strong style={{ color: '#374151' }}>{nv.client_name}</strong></p>}
                                      {nv.process_number && <p style={{ margin: '1px 0 0', fontSize: '12px', color: '#6b7280' }}>⚖️ Processo: <strong style={{ color: '#374151' }}>{nv.process_number}</strong></p>}
                                      {nv.ip_address && <p style={{ margin: '1px 0 0', fontSize: '11px', color: '#9ca3af' }}>IP: {nv.ip_address}</p>}
                                      <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: '#9ca3af' }}>{dateStr} às {timeStr}</p>
                                    </div>
                                    <span style={{ fontSize: '10.5px', fontWeight: 700, color: col.color, background: col.bg, padding: '3px 9px', borderRadius: '99px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                                      assinatura
                                    </span>
                                  </div>
                                </div>
                              );
                            }

                            // ── Installment PIN: renderização especial ─────────
                            const installCtx = entry.entity_type === 'installment' && entry.entity_id
                              ? auditInstallmentMap.get(entry.entity_id) ?? null : null;

                            const who        = formatUserName(entry.user_name);
                            const verb       = AUDIT_ACTION_VERBS[entry.action] ?? entry.action.replace(/_/g, ' ');
                            const what       = entry.entity_type ? (AUDIT_ENTITY_LABELS[entry.entity_type] ?? entry.entity_type.replace(/_/g, ' ')) : '';
                            const entityName = getEntityName(entry);
                            const clientName = getClientName(entry);
                            const diff       = getDiff(entry);

                            return (
                              <div key={entry.id} style={{ padding: '13px 16px', borderRadius: '10px', border: '1px solid rgba(15,23,42,0.06)', background: '#fff' }}>
                                {/* Cabeçalho */}
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: col.dot, marginTop: '6px', flexShrink: 0 }} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ margin: 0, fontSize: '13.5px', color: '#111827', lineHeight: 1.6 }}>
                                      <strong style={{ fontWeight: 700 }}>{who}</strong>{' '}
                                      <span style={{ color: col.color, fontWeight: 500 }}>{verb}</span>
                                      {what && !AUDIT_ACTION_VERBS[entry.action]?.includes('configurações') && (
                                        <> um <span style={{ fontWeight: 500, color: '#374151' }}>{what}</span></>
                                      )}
                                      {entityName && <span style={{ marginLeft: '4px', fontWeight: 700 }}>"{entityName}"</span>}
                                    </p>
                                    {/* Contexto de installment */}
                                    {installCtx && (
                                      <>
                                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#6b7280' }}>
                                          💰 Parcela {installCtx.installment_number} · <strong style={{ color: '#374151' }}>R$ {Number(installCtx.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
                                          {installCtx.due_date && <> · venc. {(() => { const [y,m,d] = installCtx.due_date.split('-'); return `${d}/${m}/${y}`; })()}</>}
                                        </p>
                                        {installCtx.client_name && <p style={{ margin: '1px 0 0', fontSize: '12px', color: '#6b7280' }}>👤 Cliente: <strong style={{ color: '#374151' }}>{installCtx.client_name}</strong></p>}
                                      </>
                                    )}
                                    {/* Cliente vinculado (outros módulos) */}
                                    {!installCtx && clientName && (
                                      <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#6b7280' }}>
                                        👤 Cliente: <strong style={{ color: '#374151' }}>{clientName}</strong>
                                      </p>
                                    )}
                                    <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: '#9ca3af' }}>{dateStr} às {timeStr}</p>
                                  </div>
                                  <span style={{ fontSize: '10.5px', fontWeight: 700, color: col.color, background: col.bg, padding: '3px 9px', borderRadius: '99px', flexShrink: 0, whiteSpace: 'nowrap', marginTop: '1px' }}>
                                    {entry.action === 'insert' ? 'criação'
                                      : entry.action === 'update' ? 'atualização'
                                      : entry.action === 'delete' ? 'remoção'
                                      : entry.action.replace(/_/g, ' ')}
                                  </span>
                                </div>

                                {/* Diff de campos alterados */}
                                {diff.length > 0 && (
                                  <div style={{ marginTop: '10px', marginLeft: '18px', borderTop: '1px solid #f3f4f6', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                    {diff.map(d => (
                                      <div key={d.field} style={{ display: 'grid', gridTemplateColumns: '130px 1fr auto 1fr', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                                        <span style={{ color: '#6b7280', fontWeight: 600 }}>{d.label}</span>
                                        <span style={{ color: '#b91c1c', background: '#fef2f2', padding: '1px 7px', borderRadius: '5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.oldVal}</span>
                                        <span style={{ color: '#9ca3af', fontWeight: 700 }}>→</span>
                                        <span style={{ color: '#15803d', background: '#f0fdf4', padding: '1px 7px', borderRadius: '5px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.newVal}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {entry.action === 'update' && diff.length === 0 && !sysOnly && (
                                  <p style={{ margin: '6px 0 0 18px', fontSize: '11.5px', color: '#9ca3af', fontStyle: 'italic' }}>
                                    Atualização interna do sistema.
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Paginação */}
                      {auditTotal > AUDIT_PAGE_SIZE && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
                          <button disabled={auditPage === 0 || auditLoading}
                            onClick={() => loadAudit(auditPage - 1)}
                            style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 500, border: '1px solid #e5e7eb', borderRadius: '8px', background: '#fff', color: auditPage === 0 ? '#d1d5db' : '#374151', cursor: auditPage === 0 ? 'default' : 'pointer' }}>
                            ← Anterior
                          </button>
                          <span style={{ fontSize: '12px', color: '#6b7280' }}>
                            Página {auditPage + 1} de {totalPages}
                          </span>
                          <button disabled={auditPage >= totalPages - 1 || auditLoading}
                            onClick={() => loadAudit(auditPage + 1)}
                            style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 500, border: '1px solid #e5e7eb', borderRadius: '8px', background: '#fff', color: auditPage >= totalPages - 1 ? '#d1d5db' : '#374151', cursor: auditPage >= totalPages - 1 ? 'default' : 'pointer' }}>
                            Próxima →
                          </button>
                        </div>
                      )}

                    </div>
                  );
                })()}

                {activeSection === 'djen' && (
                  <div className="px-8 py-6 space-y-6">
                    <div className="settings-row-item">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Sincronização Automática</p>
                        <p className="text-xs text-slate-500">Buscar intimações automaticamente</p>
                      </div>
                      <button
                        className={`settings-toggle${djenConfig.auto_sync ? ' on' : ''}`}
                        onClick={() => setDjenConfig({ ...djenConfig, auto_sync: !djenConfig.auto_sync })}
                        aria-label="toggle"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-slate-700">Tribunal Padrão</label>
                        <select
                          className="mt-1 w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                          value={djenConfig.default_tribunal}
                          onChange={(e) => setDjenConfig({ ...djenConfig, default_tribunal: e.target.value })}
                        >
                          <option value="all">🇧🇷 Todos os Tribunais (Brasil inteiro)</option>
                          <optgroup label="Tribunais de Justiça Estaduais">
                            <option value="TJAC">TJAC - Acre</option>
                            <option value="TJAL">TJAL - Alagoas</option>
                            <option value="TJAM">TJAM - Amazonas</option>
                            <option value="TJAP">TJAP - Amapá</option>
                            <option value="TJBA">TJBA - Bahia</option>
                            <option value="TJCE">TJCE - Ceará</option>
                            <option value="TJDFT">TJDFT - Distrito Federal e Territórios</option>
                            <option value="TJES">TJES - Espírito Santo</option>
                            <option value="TJGO">TJGO - Goiás</option>
                            <option value="TJMA">TJMA - Maranhão</option>
                            <option value="TJMG">TJMG - Minas Gerais</option>
                            <option value="TJMS">TJMS - Mato Grosso do Sul</option>
                            <option value="TJMT">TJMT - Mato Grosso</option>
                            <option value="TJPA">TJPA - Pará</option>
                            <option value="TJPB">TJPB - Paraíba</option>
                            <option value="TJPE">TJPE - Pernambuco</option>
                            <option value="TJPI">TJPI - Piauí</option>
                            <option value="TJPR">TJPR - Paraná</option>
                            <option value="TJRJ">TJRJ - Rio de Janeiro</option>
                            <option value="TJRN">TJRN - Rio Grande do Norte</option>
                            <option value="TJRO">TJRO - Rondônia</option>
                            <option value="TJRR">TJRR - Roraima</option>
                            <option value="TJRS">TJRS - Rio Grande do Sul</option>
                            <option value="TJSC">TJSC - Santa Catarina</option>
                            <option value="TJSE">TJSE - Sergipe</option>
                            <option value="TJSP">TJSP - São Paulo</option>
                            <option value="TJTO">TJTO - Tocantins</option>
                          </optgroup>
                          <optgroup label="Tribunais Regionais Federais">
                            <option value="TRF1">TRF1 - 1ª Região (DF, GO, MT, AC, AM, AP, BA, MA, MG, PA, PI, RO, RR, TO)</option>
                            <option value="TRF2">TRF2 - 2ª Região (RJ, ES)</option>
                            <option value="TRF3">TRF3 - 3ª Região (SP, MS)</option>
                            <option value="TRF4">TRF4 - 4ª Região (PR, SC, RS)</option>
                            <option value="TRF5">TRF5 - 5ª Região (PE, CE, AL, SE, RN, PB)</option>
                            <option value="TRF6">TRF6 - 6ª Região (MG)</option>
                          </optgroup>
                          <optgroup label="Tribunais Regionais do Trabalho">
                            <option value="TRT1">TRT1 - Rio de Janeiro</option>
                            <option value="TRT2">TRT2 - São Paulo (Capital)</option>
                            <option value="TRT3">TRT3 - Minas Gerais</option>
                            <option value="TRT4">TRT4 - Rio Grande do Sul</option>
                            <option value="TRT5">TRT5 - Bahia</option>
                            <option value="TRT6">TRT6 - Pernambuco</option>
                            <option value="TRT7">TRT7 - Ceará</option>
                            <option value="TRT8">TRT8 - Pará e Amapá</option>
                            <option value="TRT9">TRT9 - Paraná</option>
                            <option value="TRT10">TRT10 - Distrito Federal e Tocantins</option>
                            <option value="TRT11">TRT11 - Amazonas e Roraima</option>
                            <option value="TRT12">TRT12 - Santa Catarina</option>
                            <option value="TRT13">TRT13 - Paraíba</option>
                            <option value="TRT14">TRT14 - Rondônia e Acre</option>
                            <option value="TRT15">TRT15 - Campinas (SP Interior)</option>
                            <option value="TRT16">TRT16 - Maranhão</option>
                            <option value="TRT17">TRT17 - Espírito Santo</option>
                            <option value="TRT18">TRT18 - Goiás</option>
                            <option value="TRT19">TRT19 - Alagoas</option>
                            <option value="TRT20">TRT20 - Sergipe</option>
                            <option value="TRT21">TRT21 - Rio Grande do Norte</option>
                            <option value="TRT22">TRT22 - Piauí</option>
                            <option value="TRT23">TRT23 - Mato Grosso</option>
                            <option value="TRT24">TRT24 - Mato Grosso do Sul</option>
                          </optgroup>
                          <optgroup label="Tribunais Superiores">
                            <option value="STF">STF - Supremo Tribunal Federal</option>
                            <option value="STJ">STJ - Superior Tribunal de Justiça</option>
                            <option value="TST">TST - Tribunal Superior do Trabalho</option>
                            <option value="TSE">TSE - Tribunal Superior Eleitoral</option>
                            <option value="STM">STM - Superior Tribunal Militar</option>
                          </optgroup>
                        </select>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Intervalo de Sincronização (horas)</label>
                        <input
                          type="number"
                          min="1"
                          max="168"
                          className="mt-1 w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                          value={djenConfig.sync_interval_hours}
                          onChange={(e) => setDjenConfig({ ...djenConfig, sync_interval_hours: parseInt(e.target.value) || 24 })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Buscar dias anteriores</label>
                        <input
                          type="number"
                          min="1"
                          max="90"
                          className="mt-1 w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                          value={djenConfig.search_days_back}
                          onChange={(e) => setDjenConfig({ ...djenConfig, search_days_back: parseInt(e.target.value) || 30 })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Timeout da API (segundos)</label>
                        <input
                          type="number"
                          min="10"
                          max="120"
                          className="mt-1 w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                          value={djenConfig.api_timeout_seconds}
                          onChange={(e) => setDjenConfig({ ...djenConfig, api_timeout_seconds: parseInt(e.target.value) || 30 })}
                        />
                      </div>
                    </div>

                    {/* ── DataJud (CNJ) ── separador visual explícito ── */}
                    <div className="border-t-2 border-orange-100 pt-6 mt-2">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-orange-50 border border-orange-200 text-xs font-bold text-orange-700 tracking-wide uppercase">
                          DataJud — CNJ
                        </span>
                        {datajudKeyConfig.invalid && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                            Chave inválida
                          </span>
                        )}
                        {!datajudKeyConfig.invalid && datajudKeyConfig.key && datajudKeyConfig.key !== settingsService.DATAJUD_DEFAULT_KEY && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-700 text-[11px] font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Chave configurada
                          </span>
                        )}
                      </div>
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">Chave de API DataJud (CNJ)</h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Chave pública do CNJ para consultar movimentações processuais. Disponível em{' '}
                            <a href="https://datajud-wiki.cnj.jus.br/api-publica/acesso" target="_blank" rel="noopener noreferrer" className="text-[#f97316] hover:underline">datajud-wiki.cnj.jus.br</a>.
                          </p>
                        </div>
                      </div>
                      {datajudKeyConfig.invalid && datajudKeyConfig.invalid_since && (
                        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                          A chave falhou em {new Date(datajudKeyConfig.invalid_since).toLocaleString('pt-BR')}. Atualize-a abaixo e salve.
                        </div>
                      )}
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={datajudKeyVisible ? 'text' : 'password'}
                            className="w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm font-mono pr-10"
                            value={datajudKeyConfig.key}
                            onChange={(e) => setDatajudKeyConfig({ ...datajudKeyConfig, key: e.target.value, invalid: false, invalid_since: null })}
                            placeholder="Cole aqui a chave pública do CNJ"
                          />
                          <button
                            type="button"
                            onClick={() => setDatajudKeyVisible(v => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                          >
                            {datajudKeyVisible ? 'ocultar' : 'ver'}
                          </button>
                        </div>
                        <button
                          type="button"
                          disabled={datajudKeySaving}
                          onClick={async () => {
                            setDatajudKeySaving(true);
                            try {
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'set_datajud_key',
                                  title: 'Salvar chave DataJud',
                                  description: 'Confirme com seu PIN para salvar a chave do DataJud.',
                                  resourceType: 'integration_key',
                                  resourceId: 'datajud',
                                },
                                () => settingsService.setDatajudKey(datajudKeyConfig.key),
                              );
                              if (!persisted) return;
                              // Recarrega para refletir invalid=false
                              const fresh = await settingsService.getDatajudKeyConfig();
                              setDatajudKeyConfig(fresh);
                            } finally {
                              setDatajudKeySaving(false);
                            }
                          }}
                          className="px-4 py-2 bg-[#f97316] text-white rounded-lg text-sm font-semibold hover:bg-orange-700 disabled:opacity-60 flex-shrink-0"
                        >
                          {datajudKeySaving ? 'Salvando…' : 'Salvar chave'}
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-[#e7e5df] pt-6">
                      <h3 className="text-sm font-semibold text-slate-900 mb-3">Advogados Monitorados</h3>
                      <p className="text-xs text-slate-500 mb-4">Nomes que serão buscados nas publicações do DJEN (use o nome exato como aparece no diário).</p>
                      <div className="space-y-2">
                        {djenConfig.lawyers_to_monitor.map((name, idx) => (
                          <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-[#e7e5df]">
                            <span className="text-sm font-medium text-slate-700">{name}</span>
                            <button
                              onClick={() => setDjenConfig({ ...djenConfig, lawyers_to_monitor: djenConfig.lawyers_to_monitor.filter((_, i) => i !== idx) })}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Nome completo do advogado"
                            className="flex-1 rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                setDjenConfig({ ...djenConfig, lawyers_to_monitor: [...djenConfig.lawyers_to_monitor, e.currentTarget.value.trim()] });
                                e.currentTarget.value = '';
                              }
                            }}
                          />
                          <button
                            onClick={(e) => {
                              const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                              if (input.value.trim()) {
                                setDjenConfig({ ...djenConfig, lawyers_to_monitor: [...djenConfig.lawyers_to_monitor, input.value.trim()] });
                                input.value = '';
                              }
                            }}
                            className="px-4 py-2 rounded-lg bg-[#ea6c00] text-white text-sm font-medium hover:bg-[#d46000]"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="settings-save-bar" style={{ marginTop: '8px' }}>
                      <button className="settings-btn-primary"
                        onClick={async () => {
                          setSaving(true);
                          try {
                            const persisted = await runWithSettingsPin(
                              {
                                action: 'update_djen_config',
                                title: 'Salvar configurações DJEN',
                                description: 'Confirme com seu PIN para salvar as configurações do DJEN.',
                                resourceType: 'djen_config',
                              },
                              () => settingsService.updateDjenConfig(djenConfig, currentProfile?.name),
                            );
                            if (!persisted) return;
                            setFeedback('success', 'Configurações DJEN salvas!');
                          } catch (err: any) {
                            setFeedback('error', err.message || 'Erro ao salvar.');
                          } finally {
                            setSaving(false);
                          }
                        }}
                        disabled={saving}
                      >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Salvar
                      </button>
                    </div>
                  </div>
                )}

                {activeSection === 'notifications' && (
                  <div className="px-8 py-6 space-y-6">
                    {/* Toggles básicos */}
                    <div className="space-y-3">
                      {[
                        { key: 'email_enabled', label: 'Notificações por Email', desc: 'Receba alertas no seu email', icon: Mail },
                        { key: 'push_enabled', label: 'Notificações Push', desc: 'Alertas no navegador', icon: Bell },
                        { key: 'new_intimation_alert', label: 'Alertas de Intimações', desc: 'Aviso imediato de novas intimações', icon: FileText },
                      ].map((item) => (
                        <div key={item.key} className="settings-row-item">
                          <div className="flex items-center gap-3">
                            <item.icon className="w-5 h-5 text-slate-400" />
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                              <p className="text-xs text-slate-500">{item.desc}</p>
                            </div>
                          </div>
                          <button
                            className={`settings-toggle${(notificationConfig as any)[item.key] ? ' on' : ''}`}
                            onClick={() => setNotificationConfig({ ...notificationConfig, [item.key]: !(notificationConfig as any)[item.key] })}
                            aria-label="toggle"
                          />
                        </div>
                      ))}
                    </div>

                    {/* Lembrete de prazos */}
                    <div>
                      <label className="text-sm font-medium text-slate-700">Lembrete de Prazos (dias antes)</label>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                        value={notificationConfig.deadline_reminder_days.join(', ')}
                        onChange={(e) => setNotificationConfig({ ...notificationConfig, deadline_reminder_days: e.target.value.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)) })}
                        placeholder="1, 3, 7"
                      />
                      <p className="text-xs text-slate-400 mt-1">Separados por vírgula (ex: 1, 3, 7)</p>
                    </div>

                    {/* ── RESUMO SEMANAL ── */}
                    <div className={`rounded-2xl border-2 transition-colors duration-200 overflow-hidden ${notificationConfig.weekly_digest ? 'border-amber-300 bg-amber-50/60' : 'border-[#e7e5df] bg-slate-50'}`}>
                      {/* Cabeçalho do card */}
                      <div className="flex items-center justify-between p-5">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${notificationConfig.weekly_digest ? 'bg-amber-100' : 'bg-slate-200'}`}>
                            <CalendarClock className={`w-5 h-5 ${notificationConfig.weekly_digest ? 'text-amber-600' : 'text-slate-400'}`} />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">Resumo Semanal por Email</p>
                            <p className="text-xs text-slate-500">Envia automaticamente para cada membro, respeitando as permissões de módulo</p>
                          </div>
                        </div>
                        <button
                          className={`settings-toggle${notificationConfig.weekly_digest ? ' on' : ''}`}
                          onClick={() => setNotificationConfig({ ...notificationConfig, weekly_digest: !notificationConfig.weekly_digest })}
                          aria-label="toggle"
                        />
                      </div>

                      {/* Configurações — expandem quando ativo */}
                      {notificationConfig.weekly_digest && (
                        <div className="px-5 pb-5 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                          <div className="h-px bg-amber-200" />

                          {/* Dia + Horário */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Dia de envio</label>
                              <select
                                className="mt-1.5 w-full rounded-xl border border-amber-200 bg-[#f8f7f5] px-3 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                                value={notificationConfig.weekly_digest_day}
                                onChange={(e) => setNotificationConfig({ ...notificationConfig, weekly_digest_day: Number(e.target.value) })}
                              >
                                {['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'].map((d, i) => (
                                  <option key={i} value={i}>{d}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Horário</label>
                              <input
                                type="time"
                                className="mt-1.5 w-full rounded-xl border border-amber-200 bg-[#f8f7f5] px-3 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                                value={notificationConfig.weekly_digest_hour}
                                onChange={(e) => setNotificationConfig({ ...notificationConfig, weekly_digest_hour: e.target.value })}
                              />
                            </div>
                          </div>

                          {/* Aviso: chave movida para Integrações */}
                          {!emailIntConfig.resend_key && (
                            <div style={{ padding: '10px 12px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', fontSize: '12px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                              API key Resend não configurada.{' '}
                              <button type="button" onClick={() => setActiveSection('integrations_email')}
                                style={{ textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: '#92400e', fontWeight: 600 }}>
                                Configure em Integrações → E-mail
                              </button>
                            </div>
                          )}
                          {emailIntConfig.resend_key && (
                            <div style={{ padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '12px', color: '#166534', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Check size={13} />
                              API key configurada em <button type="button" onClick={() => setActiveSection('integrations_email')}
                                style={{ textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: '#166534', fontWeight: 600 }}>Integrações → E-mail</button>.
                            </div>
                          )}

                          {/* O que será enviado */}
                          <div className="rounded-xl bg-[#f8f7f5] border border-amber-200 p-4">
                            <p className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                              <Send className="w-3.5 h-3.5 text-amber-500" />
                              O que cada membro recebe (conforme permissões):
                            </p>
                            <div className="space-y-1.5">
                              {[
                                { icon: '📅', label: 'Compromissos da semana', module: 'agenda' },
                                { icon: '⚖️', label: 'Prazos que vencem em 7 dias', module: 'prazos' },
                                { icon: '💰', label: 'Honorários em aberto', module: 'financeiro' },
                                { icon: '📋', label: 'Requerimentos pendentes', module: 'requerimentos' },
                                { icon: '📁', label: 'Processos sem movimentação recente', module: 'processos' },
                              ].map((s) => (
                                <div key={s.module} className="flex items-center gap-2 text-xs text-slate-600">
                                  <span>{s.icon}</span>
                                  <span>{s.label}</span>
                                  <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 uppercase">{s.module}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="settings-save-bar" style={{ marginTop: '8px' }}>
                      <button className="settings-btn-primary"
                        onClick={async () => {
                          setSaving(true);
                          try {
                            const persisted = await runWithSettingsPin(
                              {
                                action: 'update_notification_config',
                                title: 'Salvar notificações',
                                description: 'Confirme com seu PIN para salvar as configurações de notificações.',
                                resourceType: 'notification_config',
                              },
                              () => settingsService.updateNotificationConfig(notificationConfig, currentProfile?.name),
                            );
                            if (!persisted) return;
                            setFeedback('success', 'Notificações salvas!');
                          } catch (err: any) {
                            setFeedback('error', err.message || 'Erro ao salvar.');
                          } finally {
                            setSaving(false);
                          }
                        }}
                        disabled={saving}
                      >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Salvar
                      </button>
                    </div>
                  </div>
                )}

                {activeSection === 'preferences' && (
                  <div className="px-8 py-6 space-y-6">

                    {/* Aviso de integração pendente */}
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '10px', padding: '12px 16px' }}>
                      <span style={{ fontSize: '16px', flexShrink: 0 }}>✅</span>
                      <div>
                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#166534', margin: 0 }}>Formato de data e moeda aplicados globalmente</p>
                        <p style={{ fontSize: '12px', color: '#15803d', margin: '3px 0 0' }}>Formato de data e moeda são consumidos automaticamente pelos módulos (Financeiro, Prazos, etc.). Fuso horário ainda não é aplicado globalmente — as datas exibidas usam o horário local do navegador.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <label className="text-sm font-medium text-slate-700">Fuso Horário</label>
                          <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px', background: '#fee2e2', color: '#991b1b' }}>Não aplicado</span>
                        </div>
                        <select
                          className="w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                          value={preferences.timezone}
                          onChange={(e) => setPreferences({ ...preferences, timezone: e.target.value })}
                        >
                          <option value="America/Sao_Paulo">Brasília (GMT-3)</option>
                          <option value="America/Cuiaba">Cuiabá (GMT-4)</option>
                          <option value="America/Manaus">Manaus (GMT-4)</option>
                          <option value="America/Fortaleza">Fortaleza (GMT-3)</option>
                        </select>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <label className="text-sm font-medium text-slate-700">Formato de Data</label>
                          <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px', background: '#dcfce7', color: '#166534' }}>Aplicado</span>
                        </div>
                        <select
                          className="w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                          value={preferences.date_format}
                          onChange={(e) => setPreferences({ ...preferences, date_format: e.target.value })}
                        >
                          <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                          <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Prazo Padrão (dias)</label>
                        <input
                          type="number"
                          min="1"
                          max="90"
                          className="mt-1 w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                          value={preferences.default_deadline_days}
                          onChange={(e) => setPreferences({ ...preferences, default_deadline_days: parseInt(e.target.value) || 15 })}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <label className="text-sm font-medium text-slate-700">Moeda</label>
                          <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px', background: '#dcfce7', color: '#166534' }}>Aplicado</span>
                        </div>
                        <select
                          className="w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                          value={preferences.currency}
                          onChange={(e) => setPreferences({ ...preferences, currency: e.target.value })}
                        >
                          <option value="BRL">Real (R$)</option>
                          <option value="USD">Dólar (US$)</option>
                          <option value="EUR">Euro (€)</option>
                        </select>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <label className="text-sm font-medium text-slate-700">Horário Comercial - Início</label>
                          <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px', background: '#fef9c3', color: '#854d0e' }}>Parcial</span>
                        </div>
                        <input
                          type="time"
                          className="w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                          value={preferences.business_hours_start}
                          onChange={(e) => setPreferences({ ...preferences, business_hours_start: e.target.value })}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <label className="text-sm font-medium text-slate-700">Horário Comercial - Fim</label>
                          <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px', background: '#fef9c3', color: '#854d0e' }}>Parcial</span>
                        </div>
                        <input
                          type="time"
                          className="w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                          value={preferences.business_hours_end}
                          onChange={(e) => setPreferences({ ...preferences, business_hours_end: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="settings-save-bar" style={{ marginTop: '8px' }}>
                      <button className="settings-btn-primary"
                        onClick={async () => {
                          setSaving(true);
                          try {
                            const persisted = await runWithSettingsPin(
                              {
                                action: 'update_preferences',
                                title: 'Salvar preferências',
                                description: 'Confirme com seu PIN para salvar as preferências do sistema.',
                                resourceType: 'preferences',
                              },
                              () => settingsService.updatePreferences(preferences, currentProfile?.name),
                            );
                            if (!persisted) return;
                            setFeedback('success', 'Preferências salvas!');
                          } catch (err: any) {
                            setFeedback('error', err.message || 'Erro ao salvar.');
                          } finally {
                            setSaving(false);
                          }
                        }}
                        disabled={saving}
                      >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Salvar
                      </button>
                    </div>
                  </div>
                )}

                {activeSection === 'access_requests' && (
                  <div className="px-8 py-6">
                    <AccessRequestsAdmin />
                  </div>
                )}

                {activeSection === 'portal' && (
                  <div className="px-8 py-6 space-y-6">
                    {/* Acesso ao Portal — chave-mestra do login do cliente */}
                    <button
                      type="button"
                      onClick={() => setPortalLoginEnabled((v) => !v)}
                      className={`flex w-full items-center gap-4 rounded-xl border p-4 text-left transition hover:shadow-sm ${
                        portalLoginEnabled ? 'border-orange-200 bg-orange-50/50' : 'border-[#e7e5df] bg-[#f8f7f5]'
                      }`}
                    >
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${portalLoginEnabled ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>
                        <Globe className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900">Acesso ao Portal do Cliente</p>
                        <p className="text-xs text-slate-500">
                          {portalLoginEnabled
                            ? 'Clientes podem entrar no portal normalmente.'
                            : 'Login desativado — nenhum cliente consegue entrar no portal.'}
                        </p>
                      </div>
                      <div className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${portalLoginEnabled ? 'bg-orange-500' : 'bg-slate-200'}`}>
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#f8f7f5] shadow-sm transition-transform ${portalLoginEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </div>
                    </button>

                    {/* Módulos */}
                    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 transition-opacity ${portalLoginEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
                      {([
                        { key: 'processos',    label: 'Processos',    desc: 'Listagem e detalhes dos processos',      icon: Briefcase },
                        { key: 'documentos',   label: 'Documentos',   desc: 'Documentos enviados pelo escritório',    icon: FolderOpen },
                        { key: 'assinar',      label: 'Assinaturas',  desc: 'Documentos pendentes de assinatura',     icon: PenTool },
                        { key: 'financeiro',   label: 'Financeiro',   desc: 'Contratos, parcelas e pagamentos',       icon: PiggyBank },
                        { key: 'agenda',       label: 'Agenda',       desc: 'Compromissos e audiências',              icon: Calendar },
                        { key: 'mensagens',    label: 'Mensagens',    desc: 'Chat com o escritório',                  icon: MessageCircle },
                        { key: 'notificacoes', label: 'Notificações', desc: 'Central de avisos e atualizações',       icon: Bell },
                        { key: 'perfil',       label: 'Perfil',       desc: 'Dados cadastrais e solicitações',        icon: User },
                      ] as { key: keyof PortalModulesConfig; label: string; desc: string; icon: React.ComponentType<any> }[]).map(({ key, label, desc, icon: Icon }) => {
                        const enabled = portalModules[key];
                        return (
                          <button
                            key={key}
                            onClick={() => setPortalModules((p) => ({ ...p, [key]: !p[key] }))}
                            className={`flex items-center gap-4 rounded-xl border p-4 text-left transition hover:shadow-sm ${
                              enabled ? 'border-orange-200 bg-orange-50/50' : 'border-[#e7e5df] bg-[#f8f7f5] opacity-60'
                            }`}
                          >
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${enabled ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>
                              <Icon className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-semibold ${enabled ? 'text-slate-900' : 'text-slate-400'}`}>{label}</p>
                              <p className="text-xs text-slate-500 truncate">{desc}</p>
                            </div>
                            {/* Toggle */}
                            <div className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-orange-500' : 'bg-slate-200'}`}>
                              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#f8f7f5] shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Aviso perfil */}
                    <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
                      <Globe className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
                      O módulo <strong>Perfil</strong> exibe os dados cadastrais. Se desativado, o cliente não poderá solicitar atualizações via portal.
                    </div>

                    <div className="settings-save-bar" style={{ marginTop: '8px' }}>
                      <button className="settings-btn-primary"
                        disabled={portalSaving}
                        onClick={async () => {
                          setPortalSaving(true);
                          try {
                            const persisted = await runWithSettingsPin(
                              {
                                action: 'save_portal_modules',
                                title: 'Salvar módulos do portal',
                                description: 'Confirme com seu PIN para salvar as configurações do portal.',
                                resourceType: 'portal_modules',
                              },
                              async () => {
                                await settingsService.savePortalModulesConfig(portalModules, currentProfile?.name);
                                await settingsService.updateSetting('portal_login_enabled', portalLoginEnabled, currentProfile?.name);
                              },
                            );
                            if (!persisted) return;
                            setFeedback('success', 'Configurações do portal salvas!');
                          } catch (err: any) {
                            setFeedback('error', err.message || 'Erro ao salvar.');
                          } finally {
                            setPortalSaving(false);
                          }
                        }}
                      >
                        {portalSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Salvar
                      </button>
                    </div>
                  </div>
                )}

                {activeSection === 'menu_modules' && (
                  <div className="px-8 py-6 space-y-6">
                    <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
                      <Layers className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
                      Controla o que aparece no <strong>menu lateral</strong> para todos os usuários, independente das permissões de função. Cada alteração é salva automaticamente e aplicada na hora. Esconder um módulo aqui não altera permissões nem apaga dados. <strong>Perfil</strong> e <strong>Configurações</strong> não podem ser ocultados.
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {([
                        { key: 'feed',          label: 'Feed',          desc: 'Mural e colaboração interna',     icon: Newspaper },
                        { key: 'agenda',        label: 'Agenda',        desc: 'Compromissos e audiências',       icon: Calendar },
                        { key: 'chat',          label: 'Chat',          desc: 'Mensagens entre a equipe',        icon: MessageCircle },
                        { key: 'whatsapp',      label: 'WhatsApp',      desc: 'Atendimento via WhatsApp',        icon: MessageSquare },
                        { key: 'email',         label: 'Email',         desc: 'Caixa de e-mail integrada',       icon: Mail },
                        { key: 'leads',         label: 'Leads',         desc: 'Funil de atendimento',            icon: Target },
                        { key: 'clientes',      label: 'Clientes',      desc: 'Cadastro de clientes',            icon: Users },
                        { key: 'processos',     label: 'Processos',     desc: 'Processos e andamentos',          icon: Scale },
                        { key: 'requerimentos', label: 'Requerimentos', desc: 'Requerimentos INSS',              icon: Briefcase },
                        { key: 'peticoes',      label: 'Petições',      desc: 'Editor de petições',              icon: FileText },
                        { key: 'financeiro',    label: 'Financeiro',    desc: 'Contratos, parcelas e pagamentos', icon: PiggyBank },
                        { key: 'prazos',        label: 'Prazos',        desc: 'Prazos processuais',              icon: AlarmClock },
                        { key: 'intimacoes',    label: 'Intimações',    desc: 'Intimações DJEN',                 icon: Bell },
                        { key: 'documentos',    label: 'Documentos',    desc: 'Biblioteca de documentos',        icon: FolderOpen },
                        { key: 'assinaturas',   label: 'Assinaturas',   desc: 'Assinatura eletrônica',           icon: PenTool },
                        { key: 'cloud',         label: 'Cloud',         desc: 'Arquivos na nuvem',               icon: Cloud },
                        { key: 'tarefas',       label: 'Tarefas',       desc: 'Tarefas da equipe',               icon: CheckSquare },
                      ] as { key: string; label: string; desc: string; icon: React.ComponentType<any> }[]).map(({ key, label, desc, icon: Icon }) => {
                        const hidden = (modulesConfig?.hidden_menu_modules ?? []).includes(key);
                        const enabled = !hidden;
                        const toggleMenuModule = async () => {
                          if (menuModulesSaving) return;
                          const willHide = !hidden;
                          const pinOk = await requirePin({
                            action: 'toggle_menu_module',
                            resourceType: 'menu_module',
                            resourceId: key,
                            sensitivity: 'critical',
                            title: willHide ? 'Ocultar módulo do menu' : 'Exibir módulo no menu',
                            description: `Confirme com seu PIN para ${willHide ? 'ocultar' : 'exibir'} o módulo "${label}" no menu lateral.`,
                          });
                          if (!pinOk) return;
                          const base: ModulesConfig = modulesConfig ?? {
                            leads_enabled: true, financial_enabled: true, requirements_enabled: true,
                            documents_enabled: true, calendar_enabled: true, tasks_enabled: true,
                            hidden_menu_modules: [],
                          };
                          const current = new Set(base.hidden_menu_modules ?? []);
                          if (current.has(key)) current.delete(key); else current.add(key);
                          const next: ModulesConfig = { ...base, hidden_menu_modules: Array.from(current) };
                          setModulesConfig(next);          // otimista
                          setMenuModulesSaving(true);
                          try {
                            await settingsService.updateModulesConfig(next, currentProfile?.name);
                            events.emit(SYSTEM_EVENTS.MODULES_CONFIG_UPDATED);
                          } catch (err: any) {
                            setModulesConfig(base);        // reverte em caso de falha
                            setFeedback('error', err?.message || 'Erro ao salvar.');
                          } finally {
                            setMenuModulesSaving(false);
                          }
                        };
                        return (
                          <button
                            key={key}
                            onClick={toggleMenuModule}
                            disabled={menuModulesSaving}
                            className={`flex items-center gap-4 rounded-xl border p-4 text-left transition hover:shadow-sm disabled:cursor-wait ${
                              enabled ? 'border-orange-200 bg-orange-50/50' : 'border-[#e7e5df] bg-[#f8f7f5] opacity-60'
                            }`}
                          >
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${enabled ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>
                              <Icon className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-semibold ${enabled ? 'text-slate-900' : 'text-slate-400'}`}>{label}</p>
                              <p className="text-xs text-slate-500 truncate">{desc}</p>
                            </div>
                            <div className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-orange-500' : 'bg-slate-200'}`}>
                              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#f8f7f5] shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeSection === 'security' && (
                  <div className="px-8 py-6 space-y-6">

                    {/* TTLs do PIN — aplicados de verdade pelo SecurityPinContext */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <p className="text-sm font-semibold text-slate-800">Sessões de PIN</p>
                        <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px', background: '#dcfce7', color: '#166534' }}>Aplicado</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium text-slate-700 block mb-1">Duração da sessão PIN (minutos)</label>
                          <p className="text-xs text-slate-400 mb-1">Após verificar o PIN, ações sensíveis não pedem PIN novamente por este período.</p>
                          <input
                            type="number"
                            min="1"
                            max="60"
                            className="w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                            value={securityConfig.pin_session_minutes ?? 5}
                            onChange={(e) => setSecurityConfig({ ...securityConfig, pin_session_minutes: Math.max(1, parseInt(e.target.value) || 5) })}
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-slate-700 block mb-1">Duração da sessão financeira (horas)</label>
                          <p className="text-xs text-slate-400 mb-1">Após revelar valores financeiros, o módulo permanece desbloqueado por este período.</p>
                          <input
                            type="number"
                            min="1"
                            max="12"
                            step="0.5"
                            className="w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm"
                            value={securityConfig.financial_view_hours ?? 2}
                            onChange={(e) => setSecurityConfig({ ...securityConfig, financial_view_hours: Math.max(0.5, parseFloat(e.target.value) || 2) })}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="settings-row-item">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Log de Auditoria</p>
                          <p className="text-xs text-slate-500">Registrar todas as alterações no sistema</p>
                        </div>
                        <button
                          className={`settings-toggle${securityConfig.audit_log_enabled ? ' on' : ''}`}
                          onClick={() => setSecurityConfig({ ...securityConfig, audit_log_enabled: !securityConfig.audit_log_enabled })}
                          aria-label="toggle"
                        />
                      </div>
                    </div>

                    <div className="settings-save-bar" style={{ marginTop: '8px' }}>
                      <button className="settings-btn-primary"
                        onClick={async () => {
                          const pinOk = await requirePin({
                            action: 'update_security_config',
                            resourceType: 'setting',
                            sensitivity: 'critical',
                            title: 'Salvar configurações de segurança',
                            description: 'Confirme com seu PIN para salvar as configurações de segurança.',
                          });
                          if (!pinOk) return;
                          setSaving(true);
                          try {
                            await settingsService.updateSecurityConfig(securityConfig, currentProfile?.name);
                            setFeedback('success', 'Segurança salva!');
                          } catch (err: any) {
                            setFeedback('error', err.message || 'Erro ao salvar.');
                          } finally {
                            setSaving(false);
                          }
                        }}
                        disabled={saving}
                      >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Salvar
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Integrações → E-mail (Resend) ── */}
                {activeSection === 'integrations_email' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div className="settings-card">
                        <p className="settings-card-title">Remetente Padrão</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                          <div>
                            <label className="settings-label">Nome do remetente</label>
                            <input className="settings-input" type="text"
                              value={emailIntConfig.from_name}
                              onChange={e => setEmailIntConfig({ ...emailIntConfig, from_name: e.target.value })}
                              placeholder="Ex: Montalvão Advocacia" />
                          </div>
                          <div>
                            <label className="settings-label">E-mail de origem</label>
                            <input className="settings-input" type="email"
                              value={emailIntConfig.from_email}
                              onChange={e => setEmailIntConfig({ ...emailIntConfig, from_email: e.target.value })}
                              placeholder="contato@escritorio.com.br" />
                            <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                              Deve ser um domínio verificado no Resend.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="settings-card">
                        <p className="settings-card-title">API Key — Resend</p>
                        <div>
                          <label className="settings-label">Chave de API</label>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input className="settings-input" style={{ fontFamily: 'monospace' }}
                              type={showEmailKey ? 'text' : 'password'}
                              value={emailIntConfig.resend_key}
                              onChange={e => setEmailIntConfig({ ...emailIntConfig, resend_key: e.target.value })}
                              placeholder="re_xxxxxxxxxxxxxxxxxxxx" />
                            <button type="button" onClick={() => setShowEmailKey(v => !v)}
                              style={{ flexShrink: 0, padding: '0 12px', background: '#f2f4f6', border: '1px solid rgba(15,23,42,0.14)', borderRadius: '8px', cursor: 'pointer', color: '#555' }}>
                              {showEmailKey ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </div>
                          <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                            Obtenha em <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer" style={{ color: '#ff8a00' }}>resend.com/api-keys</a> — plano gratuito: 3.000 emails/mês.
                          </p>
                        </div>
                        {emailIntConfig.resend_key && (
                          <div style={{ marginTop: '12px', padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#166534' }}>
                            <Check size={14} />
                            Chave configurada — usada pelo digest semanal e por todos os templates de e-mail.
                          </div>
                        )}
                      </div>

                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary"
                          onClick={async () => {
                            const pinOk = await requirePin({
                              action: 'update_email_integration',
                              resourceType: 'setting',
                              sensitivity: 'critical',
                              title: 'Salvar integração de e-mail',
                              description: 'Confirme com seu PIN para salvar a chave de API.',
                            });
                            if (!pinOk) return;
                            setSaving(true);
                            try {
                              await settingsService.updateEmailIntegrationConfig(emailIntConfig, currentProfile?.name);
                              setFeedback('success', 'Integração de e-mail salva!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally {
                              setSaving(false);
                            }
                          }}
                          disabled={saving}
                        >
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          Salvar
                        </button>
                      </div>
                    </div>
                )}

                {/* ── Integrações → WhatsApp (Evolution) ── */}
                {activeSection === 'integrations_whatsapp' && (
                  <WhatsAppIntegrationSettings requirePin={requirePin} userName={currentProfile?.name} onFeedback={setFeedback} />
                )}

                {/* ── Módulos → Financeiro ── */}
                {activeSection === 'modules_financial' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                      {/* Defaults de criação de acordo */}
                      <div className="settings-card">
                        <p className="settings-card-title">Defaults ao criar acordo</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                          <div>
                            <label className="settings-label">% Honorários padrão</label>
                            <div style={{ position: 'relative' }}>
                              <input className="settings-input" type="number" min={0} max={100} step={1}
                                style={{ paddingRight: '32px' }}
                                value={financialConfig.default_fee_percentage}
                                onChange={e => setFinancialConfig({ ...financialConfig, default_fee_percentage: Number(e.target.value) || 0 })} />
                              <Percent size={12} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
                            </div>
                          </div>
                          <div>
                            <label className="settings-label">Parcelas padrão</label>
                            <input className="settings-input" type="number" min={1} max={120}
                              value={financialConfig.default_installments_count}
                              onChange={e => setFinancialConfig({ ...financialConfig, default_installments_count: Number(e.target.value) || 1 })} />
                          </div>
                          <div>
                            <label className="settings-label">Tipo de cobrança padrão</label>
                            <select className="settings-select"
                              value={financialConfig.default_payment_type}
                              onChange={e => setFinancialConfig({ ...financialConfig, default_payment_type: e.target.value as 'upfront' | 'installments' })}>
                              <option value="installments">Parcelado</option>
                              <option value="upfront">À vista</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Dias para marcar como vencido */}
                      <div className="settings-card">
                        <p className="settings-card-title">Inadimplência</p>
                        <div style={{ maxWidth: '200px' }}>
                          <label className="settings-label">Dias de tolerância para atraso</label>
                          <input className="settings-input" type="number" min={0} max={30}
                            value={financialConfig.overdue_check_days}
                            onChange={e => setFinancialConfig({ ...financialConfig, overdue_check_days: Number(e.target.value) || 0 })} />
                          <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                            Parcelas só são marcadas como vencidas após N dias da data de vencimento.
                          </p>
                        </div>
                      </div>

                      {/* Métodos de pagamento aceitos */}
                      <div className="settings-card">
                        <p className="settings-card-title">Métodos de pagamento aceitos</p>
                        <p style={{ fontSize: '12px', color: '#747878', marginBottom: '12px' }}>
                          Apenas os métodos marcados aparecem nas opções de recebimento.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                          {Object.entries(PAYMENT_METHOD_LABELS).map(([key, label]) => {
                            const enabled = financialConfig.payment_methods.includes(key);
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => {
                                  const next = enabled
                                    ? financialConfig.payment_methods.filter(m => m !== key)
                                    : [...financialConfig.payment_methods, key];
                                  setFinancialConfig({ ...financialConfig, payment_methods: next });
                                }}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '8px',
                                  padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                                  border: `1.5px solid ${enabled ? '#ff8a00' : 'rgba(15,23,42,0.12)'}`,
                                  background: enabled ? 'rgba(255,138,0,0.06)' : '#fff',
                                  fontSize: '12.5px', fontWeight: enabled ? 600 : 400,
                                  color: enabled ? '#c45c00' : '#444748',
                                  transition: 'all .12s ease',
                                }}
                              >
                                <CreditCard size={13} style={{ color: enabled ? '#ff8a00' : '#b0b5bc' }} />
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary"
                          onClick={async () => {
                            setSaving(true);
                            try {
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_financial_module',
                                  title: 'Salvar configurações financeiras',
                                  description: 'Confirme com seu PIN para salvar as configurações do módulo financeiro.',
                                  resourceType: 'financial_module',
                                },
                                () => settingsService.updateFinancialModuleConfig(financialConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setFeedback('success', 'Configurações financeiras salvas!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally {
                              setSaving(false);
                            }
                          }}
                          disabled={saving}
                        >
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          Salvar
                        </button>
                      </div>
                    </div>
                )}

                {/* ── Notificações → Central de Notificações ── */}
                {activeSection === 'notifications_rules' && (() => {
                  // garantir que todos os eventos do catálogo têm uma regra correspondente
                  const rulesMap = Object.fromEntries(notifRules.map(r => [r.trigger, r]));
                  const fullRules: NotificationRule[] = NOTIFICATION_TRIGGERS.map((ev, i) =>
                    rulesMap[ev.key] ?? {
                      id: `default_${ev.key}`,
                      name: ev.label,
                      enabled: ev.default_enabled,
                      trigger: ev.key,
                      channels: ev.default_channels,
                      recipients: ev.default_recipients,
                      respect_business_hours: true,
                    }
                  );

                  const allDomains = Array.from(new Set(NOTIFICATION_TRIGGERS.map(e => e.group)));
                  const filtered = NOTIFICATION_TRIGGERS.filter(ev => {
                    const audOk = notifAudFilter === 'all' || ev.audience.includes(notifAudFilter as NotifAudience);
                    const domOk = notifDomFilter === 'all' || ev.group === notifDomFilter;
                    return audOk && domOk;
                  });

                  // agrupar os filtrados por domain para renderizar sections
                  const grouped = filtered.reduce<Record<string, NotificationEventDef[]>>((acc, ev) => {
                    (acc[ev.group] ??= []).push(ev);
                    return acc;
                  }, {});

                  const audLabels: Record<NotifAudience, string> = { admin: 'Admin', colaborador: 'Colaborador', cliente: 'Cliente' };
                  const audStyles: Record<NotifAudience, React.CSSProperties> = {
                    admin:       { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' },
                    colaborador: { background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' },
                    cliente:     { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' },
                  };

                  const toggleRule = async (evKey: string, field: 'enabled' | 'web' | 'email') => {
                    let updated: NotificationRule[];
                    if (field === 'enabled') {
                      const existing = rulesMap[evKey];
                      const ev = NOTIFICATION_TRIGGERS.find(e => e.key === evKey)!;
                      if (existing) {
                        updated = notifRules.map(r => r.trigger === evKey ? { ...r, enabled: !r.enabled } : r);
                      } else {
                        const newRule: NotificationRule = {
                          id: `custom_${evKey}`,
                          name: ev.label,
                          enabled: true,
                          trigger: evKey,
                          channels: ev.default_channels,
                          recipients: ev.default_recipients,
                          respect_business_hours: true,
                        };
                        updated = [...notifRules, newRule];
                      }
                    } else {
                      const ch: NotificationChannel = field === 'web' ? 'push' : 'email';
                      const existing = rulesMap[evKey];
                      const ev = NOTIFICATION_TRIGGERS.find(e => e.key === evKey)!;
                      const base: NotificationRule = existing ?? {
                        id: `custom_${evKey}`, name: ev.label, enabled: ev.default_enabled,
                        trigger: evKey, channels: ev.default_channels,
                        recipients: ev.default_recipients, respect_business_hours: true,
                      };
                      const hasChannel = base.channels.includes(ch);
                      const newChannels = hasChannel ? base.channels.filter(c => c !== ch) : [...base.channels, ch];
                      if (existing) {
                        updated = notifRules.map(r => r.trigger === evKey ? { ...r, channels: newChannels } : r);
                      } else {
                        updated = [...notifRules, { ...base, channels: newChannels }];
                      }
                    }
                    setNotifRules(updated);
                    const persisted = await runWithSettingsPin(
                      {
                        action: 'update_notification_rules',
                        title: 'Salvar regras de notificação',
                        description: 'Confirme com seu PIN para salvar as regras de notificação.',
                        resourceType: 'notification_rules',
                      },
                      () => settingsService.updateNotificationRules(updated, currentProfile?.name),
                    );
                    if (!persisted) return;
                  };

                  return (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      {/* Header */}
                      <div>
                        <p style={{ fontSize: '12.5px', color: '#747878', marginBottom: '12px' }}>
                          Central de notificações — configure por evento quais canais estão ativos e para qual público.
                        </p>

                        {/* Filtros */}
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginRight: '2px' }}>PÚBLICO</span>
                          {(['all', 'admin', 'colaborador', 'cliente'] as const).map(a => (
                            <button key={a}
                              onClick={() => setNotifAudFilter(a)}
                              style={{
                                padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', cursor: 'pointer',
                                fontWeight: notifAudFilter === a ? 700 : 500, transition: 'all .12s',
                                background: notifAudFilter === a ? '#ff8a00' : '#f1f5f9',
                                color: notifAudFilter === a ? '#fff' : '#475569',
                                border: notifAudFilter === a ? '1px solid #ff8a00' : '1px solid #e2e8f0',
                              }}>
                              {a === 'all' ? 'Todos' : audLabels[a as NotifAudience]}
                            </button>
                          ))}
                          <span style={{ width: '1px', height: '16px', background: '#e2e8f0', margin: '0 4px' }} />
                          <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginRight: '2px' }}>MÓDULO</span>
                          <button
                            onClick={() => setNotifDomFilter('all')}
                            style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', cursor: 'pointer', fontWeight: notifDomFilter === 'all' ? 700 : 500, transition: 'all .12s', background: notifDomFilter === 'all' ? '#ff8a00' : '#f1f5f9', color: notifDomFilter === 'all' ? '#fff' : '#475569', border: notifDomFilter === 'all' ? '1px solid #ff8a00' : '1px solid #e2e8f0' }}>
                            Todos
                          </button>
                          {allDomains.map(d => (
                            <button key={d}
                              onClick={() => setNotifDomFilter(d === notifDomFilter ? 'all' : d)}
                              style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', cursor: 'pointer', fontWeight: notifDomFilter === d ? 700 : 500, transition: 'all .12s', background: notifDomFilter === d ? '#ff8a00' : '#f1f5f9', color: notifDomFilter === d ? '#fff' : '#475569', border: notifDomFilter === d ? '1px solid #ff8a00' : '1px solid #e2e8f0' }}>
                              {d}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Legenda de canais */}
                      <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 14px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700 }}>Canais:</span>
                        <span>🔔 Web/Sistema</span>
                        <span>✉️ E-mail</span>
                        <span style={{ color: '#94a3b8' }}>💬 SMS <em>(planejado)</em></span>
                        <span style={{ color: '#94a3b8' }}>📱 WhatsApp <em>(planejado)</em></span>
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} /> ativo
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#e2e8f0', display: 'inline-block', border: '1px solid #cbd5e1' }} /> planejado
                          </span>
                        </span>
                      </div>

                      {/* Tabela de eventos agrupada por domínio */}
                      {Object.keys(grouped).length === 0 ? (
                        <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: '13px', padding: '32px 0' }}>Nenhum evento encontrado para os filtros selecionados.</p>
                      ) : (
                        Object.entries(grouped).map(([domain, events]) => (
                          <div key={domain}>
                            <p style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: '6px' }}>{domain}</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {/* Cabeçalho */}
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 80px 80px 80px', gap: '8px', padding: '4px 12px', fontSize: '10px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                <span>Evento</span>
                                <span style={{ textAlign: 'center' }}>Público</span>
                                <span style={{ textAlign: 'center' }}>Web</span>
                                <span style={{ textAlign: 'center' }}>E-mail</span>
                                <span style={{ textAlign: 'center' }}>Ativo</span>
                              </div>
                              {events.map(ev => {
                                const rule = rulesMap[ev.key];
                                const isEnabled = rule ? rule.enabled : ev.default_enabled;
                                const webOn = rule ? rule.channels.includes('push') : ev.default_channels.includes('push');
                                const emailOn = rule ? rule.channels.includes('email') : ev.default_channels.includes('email');

                                return (
                                  <div key={ev.key} style={{
                                    display: 'grid', gridTemplateColumns: '1fr 100px 80px 80px 80px',
                                    gap: '8px', padding: '10px 12px',
                                    background: isEnabled ? '#fff' : '#f8fafc',
                                    border: `1px solid ${isEnabled ? 'rgba(255,138,0,0.18)' : 'rgba(15,23,42,0.07)'}`,
                                    borderRadius: '8px', alignItems: 'center',
                                    opacity: isEnabled ? 1 : 0.65,
                                    transition: 'all .15s',
                                  }}>
                                    {/* Nome do evento */}
                                    <span style={{ fontSize: '12.5px', fontWeight: 500, color: '#191c1e' }}>{ev.label}</span>

                                    {/* Público */}
                                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', justifyContent: 'center' }}>
                                      {ev.audience.map(a => (
                                        <span key={a} style={{ fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '6px', ...audStyles[a] }}>
                                          {audLabels[a]}
                                        </span>
                                      ))}
                                    </div>

                                    {/* Web */}
                                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                      {ev.web === 'no' ? (
                                        <span style={{ fontSize: '11px', color: '#cbd5e1' }}>—</span>
                                      ) : ev.web === 'planned' ? (
                                        <span style={{ fontSize: '10px', color: '#94a3b8', fontStyle: 'italic' }}>plan.</span>
                                      ) : (
                                        <span
                                          style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', background: webOn ? '#22c55e' : '#e2e8f0', border: webOn ? '1px solid #16a34a' : '1px solid #cbd5e1', cursor: 'pointer', transition: 'background .15s' }}
                                          title={webOn ? 'Web ativo' : 'Web inativo'}
                                          onClick={() => toggleRule(ev.key, 'web')}
                                        />
                                      )}
                                    </div>

                                    {/* E-mail */}
                                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                      {ev.email === 'no' ? (
                                        <span style={{ fontSize: '11px', color: '#cbd5e1' }}>—</span>
                                      ) : ev.email === 'planned' ? (
                                        <span style={{ fontSize: '10px', color: '#94a3b8', fontStyle: 'italic' }}>plan.</span>
                                      ) : (
                                        <span
                                          style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', background: emailOn ? '#22c55e' : '#e2e8f0', border: emailOn ? '1px solid #16a34a' : '1px solid #cbd5e1', cursor: 'pointer', transition: 'background .15s' }}
                                          title={emailOn ? 'E-mail ativo' : 'E-mail inativo'}
                                          onClick={() => toggleRule(ev.key, 'email')}
                                        />
                                      )}
                                    </div>

                                    {/* Toggle ativo */}
                                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                                      <button
                                        className={`settings-toggle${isEnabled ? ' on' : ''}`}
                                        onClick={() => toggleRule(ev.key, 'enabled')}
                                        aria-label="ativar/desativar evento"
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })()}

                {/* ── Notificações → Templates de E-mail ── */}
                {activeSection === 'notifications_email_templates' && (() => {
                  const selectedTemplate = emailTemplates.find(t => t.id === selectedTemplateId) ?? null;
                  const allVars = [
                    ...EMAIL_TEMPLATE_VARIABLES._default,
                    ...(selectedTemplate ? (EMAIL_TEMPLATE_VARIABLES[selectedTemplate.trigger] ?? []) : []),
                  ];

                  // Compila o template com valores de exemplo para preview
                  const compiledPreview = (() => {
                    if (!selectedTemplate) return '';
                    let html = selectedTemplate.html_body;
                    for (const v of allVars) {
                      html = html.split(v.key).join(v.example ?? v.key);
                    }
                    return html;
                  })();

                  return (
                      <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <p style={{ fontSize: '12.5px', color: '#747878' }}>
                          Personalize os modelos de e-mail transacionais. As variáveis entre chaves são substituídas automaticamente no envio.
                        </p>

                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                          {/* Lista de templates — agrupada por categoria/domínio */}
                          <div style={{ width: '216px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {(() => {
                              const categoryOrder = ['Prazos','Intimações','Financeiro','Assinaturas','Portal','Comunicação','Sistema'];
                              const grouped = emailTemplates.reduce<Record<string, typeof emailTemplates>>((acc, tmpl) => {
                                const cat = tmpl.category ?? 'Outros';
                                (acc[cat] ??= []).push(tmpl);
                                return acc;
                              }, {});
                              const orderedCats = [
                                ...categoryOrder.filter(c => grouped[c]),
                                ...Object.keys(grouped).filter(c => !categoryOrder.includes(c)),
                              ];
                              return orderedCats.map(cat => (
                                <div key={cat}>
                                  <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#b0b5bc', padding: '8px 4px 4px', margin: 0 }}>{cat}</p>
                                  {grouped[cat].map(tmpl => (
                                    <div key={tmpl.id} style={{
                                      display: 'flex', alignItems: 'center', gap: '8px',
                                      padding: '8px 10px', marginBottom: '2px',
                                      background: selectedTemplateId === tmpl.id ? 'rgba(255,138,0,0.07)' : '#fff',
                                      border: `1px solid ${selectedTemplateId === tmpl.id ? 'rgba(255,138,0,0.45)' : 'rgba(15,23,42,0.09)'}`,
                                      borderRadius: '8px', cursor: 'pointer', transition: 'border-color .15s',
                                    }} onClick={() => { setSelectedTemplateId(tmpl.id); setTemplatePreviewMode('editor'); setTestEmailResult(null); }}>
                                      <button
                                        className={`settings-toggle${tmpl.enabled ? ' on' : ''}`}
                                        onClick={e => {
                                          e.stopPropagation();
                                          const updated = emailTemplates.map(t => t.id === tmpl.id ? { ...t, enabled: !t.enabled } : t);
                                          setEmailTemplates(updated);
                                          void runWithSettingsPin(
                                            {
                                              action: 'toggle_email_template',
                                              title: 'Alterar template de e-mail',
                                              description: 'Confirme com seu PIN para alterar o status do template de e-mail.',
                                              resourceType: 'email_template',
                                              resourceId: tmpl.id,
                                            },
                                            () => settingsService.updateEmailTemplates(updated, currentProfile?.name),
                                          ).then((persisted) => {
                                            if (!persisted) {
                                              setEmailTemplates(emailTemplates);
                                            }
                                          }).catch((err: any) => {
                                            setEmailTemplates(emailTemplates);
                                            setFeedback('error', err?.message || 'Erro ao salvar.');
                                          });
                                        }}
                                        aria-label="ativar/desativar template"
                                      />
                                      <span style={{ flex: 1, fontSize: '12px', fontWeight: selectedTemplateId === tmpl.id ? 600 : 500, color: '#191c1e', lineHeight: 1.3 }}>{tmpl.name}</span>
                                    </div>
                                  ))}
                                </div>
                              ));
                            })()}
                          </div>

                          {/* Editor / Preview */}
                          {selectedTemplate ? (
                            <div className="settings-card" style={{ flex: 1 }}>
                              {/* Header: título + tabs + restaurar */}
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <p className="settings-card-title" style={{ margin: 0 }}>{selectedTemplate.name}</p>
                                  {/* Tabs Editor / Preview */}
                                  <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '8px', padding: '2px', gap: '2px' }}>
                                    {(['editor', 'preview'] as const).map(mode => (
                                      <button key={mode}
                                        onClick={() => setTemplatePreviewMode(mode)}
                                        style={{
                                          padding: '4px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                          fontSize: '11.5px', fontWeight: 500, transition: 'all .15s',
                                          background: templatePreviewMode === mode ? '#fff' : 'transparent',
                                          color: templatePreviewMode === mode ? '#f97316' : '#64748b',
                                          boxShadow: templatePreviewMode === mode ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                                        }}>
                                        {mode === 'editor' ? 'Editor' : 'Preview'}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <button
                                  style={{ fontSize: '11px', color: '#747878', border: '1px solid rgba(15,23,42,0.12)', borderRadius: '6px', padding: '4px 10px', background: 'transparent', cursor: 'pointer' }}
                                  onClick={() => {
                                    const def = DEFAULT_EMAIL_TEMPLATES.find(t => t.id === selectedTemplate.id);
                                    if (def) {
                                      setEmailTemplates(prev => prev.map(t => t.id === def.id ? { ...def, enabled: t.enabled } : t));
                                    }
                                  }}>
                                  Restaurar padrão
                                </button>
                              </div>

                              {templatePreviewMode === 'editor' ? (
                                <>
                                  <div style={{ marginBottom: '12px' }}>
                                    <label className="settings-label">Assunto</label>
                                    <input
                                      className="settings-input"
                                      value={selectedTemplate.subject}
                                      onChange={e => setEmailTemplates(prev => prev.map(t => t.id === selectedTemplate.id ? { ...t, subject: e.target.value } : t))}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                                    <div style={{ flex: 1 }}>
                                      <label className="settings-label">Corpo (HTML)</label>
                                      <textarea
                                        className="settings-input"
                                        rows={12}
                                        style={{ fontFamily: 'monospace', fontSize: '11.5px', resize: 'vertical', lineHeight: 1.5 }}
                                        value={selectedTemplate.html_body}
                                        onChange={e => setEmailTemplates(prev => prev.map(t => t.id === selectedTemplate.id ? { ...t, html_body: e.target.value } : t))}
                                      />
                                    </div>

                                    <div style={{ width: '176px', flexShrink: 0 }}>
                                      <label className="settings-label">Variáveis disponíveis</label>
                                      <p style={{ fontSize: '10.5px', color: '#9ca3af', marginBottom: '6px' }}>Clique para copiar</p>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        {allVars.map(v => (
                                          <button
                                            key={v.key}
                                            title={`Exemplo: ${v.example}`}
                                            onClick={() => { try { navigator.clipboard.writeText(v.key); } catch { /* clipboard indisponível */ } }}
                                            style={{
                                              padding: '5px 8px', background: '#f8fafc',
                                              border: '1px solid rgba(15,23,42,0.08)', borderRadius: '6px',
                                              cursor: 'pointer', textAlign: 'left',
                                            }}>
                                            <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#374151', display: 'block' }}>{v.key}</span>
                                            <span style={{ fontSize: '10px', color: '#9ca3af' }}>{v.label}</span>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </>
                              ) : (
                                /* ── Preview compilado ── */
                                <div>
                                  <div style={{ marginBottom: '8px', padding: '8px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid rgba(15,23,42,0.06)' }}>
                                    <span style={{ fontSize: '11px', color: '#64748b' }}>Assunto: </span>
                                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#1e293b' }}>{selectedTemplate.subject}</span>
                                  </div>
                                  <p style={{ fontSize: '10.5px', color: '#9ca3af', marginBottom: '6px' }}>Visualização com dados de exemplo — não reflete o e-mail real enviado.</p>
                                  <iframe
                                    srcDoc={compiledPreview}
                                    sandbox="allow-same-origin"
                                    style={{ width: '100%', minHeight: '380px', border: '1px solid rgba(15,23,42,0.09)', borderRadius: '8px', background: '#fff' }}
                                    title="Preview do template"
                                  />
                                </div>
                              )}

                              {/* Barra inferior: salvar + enviar teste */}
                              <div className="settings-save-bar" style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
                                <button
                                  className="settings-btn-primary"
                                  disabled={templateSaving}
                                  onClick={async () => {
                                    setTemplateSaving(true);
                                    try {
                                      const persisted = await runWithSettingsPin(
                                        {
                                          action: 'update_email_templates',
                                          title: 'Salvar templates de e-mail',
                                          description: 'Confirme com seu PIN para salvar os templates de e-mail.',
                                          resourceType: 'email_templates',
                                        },
                                        () => settingsService.updateEmailTemplates(emailTemplates, currentProfile?.name),
                                      );
                                      if (!persisted) return;
                                      setFeedback('success', 'Template salvo com sucesso!');
                                    } catch (err: any) {
                                      setFeedback('error', err.message || 'Erro ao salvar.');
                                    } finally { setTemplateSaving(false); }
                                  }}>
                                  {templateSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                                </button>

                                {/* Enviar teste */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                                  <input
                                    type="email"
                                    placeholder="e-mail para teste"
                                    value={testEmailTo}
                                    onChange={e => { setTestEmailTo(e.target.value); setTestEmailResult(null); }}
                                    className="settings-input"
                                    style={{ width: '200px', fontSize: '12px', padding: '6px 10px' }}
                                  />
                                  <button
                                    className="settings-btn-ghost"
                                    style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                                    disabled={testEmailSending || !testEmailTo.trim()}
                                    onClick={async () => {
                                      if (!testEmailTo.trim()) return;
                                      setTestEmailSending(true);
                                      setTestEmailResult(null);
                                      try {
                                        const { data, error } = await supabase.functions.invoke('email-send-test', {
                                          body: {
                                            to:        testEmailTo.trim(),
                                            subject:   selectedTemplate.subject,
                                            html_body: compiledPreview,
                                          },
                                        });
                                        if (error || !data?.success) {
                                          setTestEmailResult({ ok: false, msg: data?.error ?? error?.message ?? 'Erro desconhecido' });
                                        } else {
                                          setTestEmailResult({ ok: true, msg: `Enviado para ${testEmailTo.trim()}` });
                                        }
                                      } catch (e: any) {
                                        setTestEmailResult({ ok: false, msg: e.message ?? 'Erro' });
                                      } finally { setTestEmailSending(false); }
                                    }}>
                                    {testEmailSending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                    Enviar teste
                                  </button>
                                </div>
                              </div>

                              {/* Feedback envio de teste */}
                              {testEmailResult && (
                                <div style={{
                                  marginTop: '8px', padding: '8px 12px', borderRadius: '8px',
                                  background: testEmailResult.ok ? '#f0fdf4' : '#fef2f2',
                                  border: `1px solid ${testEmailResult.ok ? '#bbf7d0' : '#fecaca'}`,
                                  display: 'flex', alignItems: 'center', gap: '6px',
                                }}>
                                  {testEmailResult.ok
                                    ? <CheckCircle2 size={13} style={{ color: '#16a34a', flexShrink: 0 }} />
                                    : <XCircle size={13} style={{ color: '#dc2626', flexShrink: 0 }} />}
                                  <span style={{ fontSize: '12px', color: testEmailResult.ok ? '#15803d' : '#dc2626' }}>
                                    {testEmailResult.msg}
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '13px', padding: '40px 0' }}>
                              Selecione um template à esquerda para editar.
                            </div>
                          )}
                        </div>
                      </div>
                  );
                })()}

                {/* ── Módulos → Processos ── */}
                {activeSection === 'modules_processes' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                      <div className="settings-card">
                        <p className="settings-card-title">Áreas do Direito</p>
                        <ConfigurableList
                          items={normalizeItems(processConfig.practice_areas)}
                          showColor={false}
                          showDefault={true}
                          showDescription={true}
                          addLabel="Nova área"
                          emptyMessage="Nenhuma área configurada"
                          countRef={async (item) => {
                            const { data } = await supabase.rpc('count_processes_by_practice_area', { p_area: item.id });
                            return Number(data ?? 0);
                          }}
                          onChange={async items => {
                            const newAreas = items.map(item => ({
                              key:         item.id,
                              label:       item.label,
                              description: item.description ?? '',
                              active:      item.active,
                              isDefault:   item.isDefault ?? false,
                            }));
                            const newConfig = { ...processConfig, practice_areas: newAreas };
                            const persisted = await runWithSettingsPin(
                              {
                                action: 'update_process_practice_areas',
                                title: 'Alterar áreas do Direito',
                                description: 'Confirme com seu PIN para salvar as áreas do módulo de Processos.',
                                resourceType: 'process_module',
                                resourceId: 'practice_areas',
                              },
                              () => settingsService.updateProcessModuleConfig(newConfig, currentProfile?.name),
                            );
                            if (!persisted) return;
                            setProcessConfig(newConfig);
                            setFeedback('success', 'Salvo!');
                          }}
                        />
                      </div>

                      <div className="settings-card">
                        <p className="settings-card-title">Status dos Processos</p>
                        <p style={{ fontSize: '12px', color: '#747878', marginBottom: '12px' }}>Reordene ou renomeie status. Remoção pode afetar processos existentes.</p>
                        <ConfigurableList
                          items={normalizeItems(processConfig.statuses)}
                          showColor={false}
                          showDefault={true}
                          showDescription={false}
                          addLabel="Novo status"
                          emptyMessage="Nenhum status configurado"
                          countRef={async (item) => {
                            const { data } = await supabase.rpc('count_processes_by_status', { p_status: item.id });
                            return Number(data ?? 0);
                          }}
                          onChange={async items => {
                            const newStatuses = items.map(item => ({
                              key:       item.id,
                              label:     item.label,
                              badge:     processConfig.statuses.find(s => s.key === item.id)?.badge ?? 'bg-slate-100 text-slate-700',
                              active:    item.active,
                              isDefault: item.isDefault ?? false,
                            }));
                            const newConfig = { ...processConfig, statuses: newStatuses };
                            const persisted = await runWithSettingsPin(
                              {
                                action: 'update_process_statuses',
                                title: 'Alterar status de Processos',
                                description: 'Confirme com seu PIN para salvar os status do módulo de Processos.',
                                resourceType: 'process_module',
                                resourceId: 'statuses',
                              },
                              () => settingsService.updateProcessModuleConfig(newConfig, currentProfile?.name),
                            );
                            if (!persisted) return;
                            setProcessConfig(newConfig);
                            setFeedback('success', 'Salvo!');
                          }}
                        />
                      </div>

                      {/* Parâmetros de IA */}
                      <div className="settings-card">
                        <p className="settings-card-title">Parâmetros de IA & Timeline</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                          <div>
                            <label className="settings-label">Limite de eventos na timeline</label>
                            <input className="settings-input" type="number" min={10} max={200}
                              value={processConfig.timeline_event_limit}
                              onChange={e => setProcessConfig(prev => ({ ...prev, timeline_event_limit: Number(e.target.value) || 30 }))} />
                          </div>
                          <div>
                            <label className="settings-label">Máx. tokens no resumo por IA</label>
                            <input className="settings-input" type="number" min={200} max={5000} step={100}
                              value={processConfig.ai_summary_max_tokens}
                              onChange={e => setProcessConfig(prev => ({ ...prev, ai_summary_max_tokens: Number(e.target.value) || 1000 }))} />
                          </div>
                        </div>
                      </div>

                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary"
                          onClick={async () => {
                            setSaving(true);
                            try {
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_process_module',
                                  title: 'Salvar configurações de Processos',
                                  description: 'Confirme com seu PIN para salvar as configurações do módulo de Processos.',
                                  resourceType: 'process_module',
                                },
                                () => settingsService.updateProcessModuleConfig(processConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setFeedback('success', 'Configurações de Processos salvas!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally { setSaving(false); }
                          }}
                          disabled={saving}>
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                        </button>
                      </div>
                    </div>
                )}

                {/* ── Módulos → Prazos ── */}
                {activeSection === 'modules_deadlines' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                      {/* Thresholds de urgência */}
                      <div className="settings-card">
                        <p className="settings-card-title">Faixas de urgência (dias)</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                          <div>
                            <label className="settings-label">Aviso padrão (dias antes)</label>
                            <input className="settings-input" type="number" min={1} max={30}
                              value={deadlineConfig.default_notify_days}
                              onChange={e => setDeadlineConfig(prev => ({ ...prev, default_notify_days: Number(e.target.value) || 2 }))} />
                            <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>Notificação enviada X dias antes.</p>
                          </div>
                          <div>
                            <label className="settings-label">"Próximos N dias" (faixa laranja)</label>
                            <input className="settings-input" type="number" min={1} max={14}
                              value={deadlineConfig.soon_days_threshold}
                              onChange={e => setDeadlineConfig(prev => ({ ...prev, soon_days_threshold: Number(e.target.value) || 2 }))} />
                          </div>
                          <div>
                            <label className="settings-label">"Próxima semana" (faixa amarela)</label>
                            <input className="settings-input" type="number" min={3} max={30}
                              value={deadlineConfig.week_days_threshold}
                              onChange={e => setDeadlineConfig(prev => ({ ...prev, week_days_threshold: Number(e.target.value) || 7 }))} />
                          </div>
                        </div>
                      </div>

                      <div className="settings-card">
                        <p className="settings-card-title">Status dos Prazos</p>
                        <p style={{ fontSize: '12px', color: '#747878', marginBottom: '8px' }}>
                          Renomeie livremente. Os 4 status canônicos (<strong>pendente · cumprido · vencido · cancelado</strong>) são usados em ordenação, filtros e notificações automáticas — desativá-los ou excluí-los pode afetar o comportamento do módulo.
                        </p>
                        <ConfigurableList
                          items={normalizeItems(deadlineConfig.statuses)}
                          showColor={false}
                          showDefault={true}
                          showDescription={false}
                          addLabel="Novo status"
                          emptyMessage="Nenhum status configurado"
                          countRef={async (item) => {
                            const { data } = await supabase.rpc('count_deadlines_by_status', { p_status: item.id });
                            return Number(data ?? 0);
                          }}
                          onChange={async items => {
                            const newStatuses = items.map(item => ({
                              key:       item.id,
                              label:     item.label,
                              badge:     deadlineConfig.statuses.find(s => s.key === item.id)?.badge ?? 'bg-slate-400 text-white',
                              active:    item.active,
                              isDefault: item.isDefault ?? false,
                            }));
                              const newConfig = { ...deadlineConfig, statuses: newStatuses };
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_deadline_statuses',
                                  title: 'Alterar status de Prazos',
                                  description: 'Confirme com seu PIN para salvar os status do módulo de Prazos.',
                                  resourceType: 'deadline_module',
                                  resourceId: 'statuses',
                                },
                                () => settingsService.updateDeadlineModuleConfig(newConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setDeadlineConfig(newConfig);
                              setFeedback('success', 'Status salvo!');
                          }}
                        />
                      </div>

                      <div className="settings-card">
                        <p className="settings-card-title">Prioridades</p>
                        <p style={{ fontSize: '12px', color: '#747878', marginBottom: '12px' }}>
                          Renomeie ou reordene livremente. As chaves canônicas (<strong>urgente · alta · media · baixa</strong>) são usadas na ordenação automática e nos filtros do módulo — excluir pode alterar a classificação de prazos existentes.
                        </p>
                        <ConfigurableList
                          items={normalizeItems(deadlineConfig.priorities)}
                          showColor={false}
                          showDefault={true}
                          showDescription={false}
                          emptyMessage="Nenhuma prioridade configurada"
                          countRef={async (item) => {
                            const { data } = await supabase.rpc('count_deadlines_by_priority', { p_priority: item.id });
                            return Number(data ?? 0);
                          }}
                          onChange={async items => {
                            const newPriorities = items.map(item => ({
                              key:    item.id,
                              label:  item.label,
                              badge:     deadlineConfig.priorities.find(p => p.key === item.id)?.badge ?? 'bg-slate-400 text-white',
                              active:    item.active,
                              isDefault: item.isDefault ?? false,
                            }));
                              const newConfig = { ...deadlineConfig, priorities: newPriorities };
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_deadline_priorities',
                                  title: 'Alterar prioridades de Prazos',
                                  description: 'Confirme com seu PIN para salvar as prioridades do módulo de Prazos.',
                                  resourceType: 'deadline_module',
                                  resourceId: 'priorities',
                                },
                                () => settingsService.updateDeadlineModuleConfig(newConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setDeadlineConfig(newConfig);
                              setFeedback('success', 'Salvo!');
                          }}
                        />
                      </div>

                      <div className="settings-card">
                        <p className="settings-card-title">Tipos de Prazo</p>
                        <p style={{ fontSize: '11.5px', color: '#747878', marginBottom: '10px' }}>
                          Os 3 tipos canônicos (<strong>processo · requerimento · geral</strong>) são usados para vincular prazos a outros módulos e nos filtros do painel. Renomeie livremente — excluir pode afetar prazos já existentes e remover o vínculo com processos e requerimentos.
                        </p>
                        <ConfigurableList
                          items={normalizeItems(deadlineConfig.types)}
                          showColor={false}
                          showDefault={false}
                          showDescription={false}
                          addLabel="Novo tipo"
                          emptyMessage="Nenhum tipo configurado"
                          countRef={async (item) => {
                            const { data } = await supabase.rpc('count_deadlines_by_type', { p_type: item.id });
                            return Number(data ?? 0);
                          }}
                          onChange={async items => {
                            const newTypes = items.map(item => ({ key: item.id, label: item.label, active: item.active }));
                              const newConfig = { ...deadlineConfig, types: newTypes };
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_deadline_types',
                                  title: 'Alterar tipos de Prazos',
                                  description: 'Confirme com seu PIN para salvar os tipos do módulo de Prazos.',
                                  resourceType: 'deadline_module',
                                  resourceId: 'types',
                                },
                                () => settingsService.updateDeadlineModuleConfig(newConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setDeadlineConfig(newConfig);
                              setFeedback('success', 'Salvo!');
                          }}
                        />
                      </div>

                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary"
                          onClick={async () => {
                            setSaving(true);
                            try {
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_deadline_module',
                                  title: 'Salvar configurações de Prazos',
                                  description: 'Confirme com seu PIN para salvar as configurações do módulo de Prazos.',
                                  resourceType: 'deadline_module',
                                },
                                () => settingsService.updateDeadlineModuleConfig(deadlineConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setFeedback('success', 'Configurações de Prazos salvas!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally { setSaving(false); }
                          }}
                          disabled={saving}>
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                        </button>
                      </div>
                    </div>
                )}

                {/* ── Módulos → Leads / WhatsApp (gestão unificada) ── */}
                {(activeSection === 'modules_leads' || activeSection === 'modules_whatsapp') && (() => {
                  const LEAD_COLOR_HEX: Record<string, string> = {
                    slate: '#64748b', blue: '#3b82f6', emerald: '#10b981',
                    amber: '#f59e0b', red: '#ef4444', violet: '#8b5cf6',
                    orange: '#f97316', cyan: '#06b6d4',
                  };
                  const HEX_TO_LEAD_COLOR: Record<string, string> = Object.fromEntries(
                    Object.entries(LEAD_COLOR_HEX).map(([k, v]) => [v, k])
                  );
                  const stageItems = normalizeItems(leadConfig.stages.map(s => ({
                    ...s,
                    color: LEAD_COLOR_HEX[s.color] ?? '#64748b',
                  }))).map(it => ({
                    ...it,
                    metadata: { ...it.metadata, labels: leadConfig.stages.find(s => s.key === it.id)?.labels ?? [] },
                  }));
                  const leadsCards = (
                      <>

                        <div className="settings-card">
                          <p className="settings-card-title">Estágios do Funil</p>
                          <p style={{ fontSize: '11.5px', color: '#9ca3af', margin: '-4px 0 10px' }}>
                            Cada etapa vincula <strong>etiquetas</strong> que a representam. No WhatsApp, a etiqueta aplicada na conversa espelha o estágio do funil. Arraste para reordenar as etapas (= ordem do funil).
                          </p>
                          <ConfigurableList
                            items={stageItems}
                            showColor={true}
                            showDefault={true}
                            showDescription={true}
                            addLabel="Novo estágio"
                            emptyMessage="Nenhum estágio configurado"
                            countRef={async (item) => {
                              const { data } = await supabase.rpc('count_leads_by_stage', { p_stage: item.id });
                              return Number(data ?? 0);
                            }}
                            extraFields={(draft, patch) => {
                              const labels = Array.isArray(draft.metadata?.labels) ? (draft.metadata!.labels as string[]) : [];
                              return (
                                <div>
                                  <label className="block text-xs font-semibold text-slate-600 mb-1">Etiquetas desta etapa</label>
                                  <input
                                    type="text"
                                    defaultValue={labels.join(', ')}
                                    onBlur={e => patch({ metadata: { ...draft.metadata, labels: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })}
                                    placeholder="Ex: Proposta enviada, Aguardando retorno"
                                    className="w-full px-3 py-2 text-sm border border-[#e7e5df] rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400 bg-[#f8f7f5]"
                                  />
                                  <p className="text-[11px] text-slate-400 mt-1">Separe por vírgula. Essas etiquetas aparecem no seletor da conversa, sob esta etapa.</p>
                                </div>
                              );
                            }}
                            onChange={async items => {
                              const newStages = items.map(item => ({
                                key:         item.id,
                                label:       item.label,
                                description: item.description ?? '',
                                color:       (HEX_TO_LEAD_COLOR[item.color ?? ''] ?? leadConfig.stages.find(s => s.key === item.id)?.color ?? 'slate') as any,
                                active:      item.active,
                                isDefault:   item.isDefault ?? false,
                                labels:      Array.isArray(item.metadata?.labels) ? (item.metadata!.labels as string[]) : (leadConfig.stages.find(s => s.key === item.id)?.labels ?? []),
                              }));
                                const newConfig = { ...leadConfig, stages: newStages };
                                const persisted = await runWithSettingsPin(
                                  {
                                    action: 'update_lead_stages',
                                    title: 'Alterar estágios de Leads',
                                    description: 'Confirme com seu PIN para salvar os estágios do módulo de Leads.',
                                    resourceType: 'lead_module',
                                    resourceId: 'stages',
                                  },
                                  () => settingsService.updateLeadModuleConfig(newConfig, currentProfile?.name),
                                );
                                if (!persisted) return;
                                setLeadConfig(newConfig);
                                setFeedback('success', 'Salvo!');
                            }}
                          />
                        </div>

                        {/* Canais (contas conectadas) & etapa inicial no funil */}
                        <div className="settings-card">
                          <p className="settings-card-title">Canais & Etapa Inicial</p>
                          <p style={{ fontSize: '11.5px', color: '#9ca3af', margin: '-4px 0 12px' }}>
                            Por canal (conta de WhatsApp conectada): se participa do funil e em qual etapa uma <strong>nova conversa</strong> entra. Aplica-se <strong>só na criação</strong> da conversa — reabrir/novas mensagens não reiniciam o funil. Sem etapa definida, usa a <strong>padrão</strong>.
                          </p>
                          {waFunnelChannels.length === 0 ? (
                            <p style={{ fontSize: '12.5px', color: '#9ca3af' }}>Nenhuma conta de WhatsApp conectada.</p>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {waFunnelChannels.map(ch => (
                                <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: '#f8fafc', border: '1px solid rgba(15,23,42,0.08)', borderRadius: '10px' }}>
                                  <button
                                    type="button"
                                    onClick={() => updateWaFunnelChannel(ch.id, { funnel_enabled: !ch.funnel_enabled })}
                                    title={ch.funnel_enabled ? 'Desativar no funil' : 'Ativar no funil'}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                                    {ch.funnel_enabled
                                      ? <ToggleRight size={22} style={{ color: '#f97316' }} />
                                      : <ToggleLeft size={22} style={{ color: '#94a3b8' }} />}
                                  </button>
                                  <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: ch.funnel_enabled ? '#374151' : '#9ca3af' }}>{ch.label}</span>
                                  <select
                                    className="settings-input"
                                    style={{ width: '200px', fontSize: '12.5px', opacity: ch.funnel_enabled ? 1 : 0.5 }}
                                    disabled={!ch.funnel_enabled}
                                    value={ch.funnel_initial_stage ?? ''}
                                    onChange={e => updateWaFunnelChannel(ch.id, { funnel_initial_stage: e.target.value || null })}>
                                    <option value="">Etapa padrão do funil</option>
                                    {leadConfig.stages.filter(s => s.active !== false).map(s => (
                                      <option key={s.key} value={s.key}>{s.label}</option>
                                    ))}
                                  </select>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Origens */}
                        <div className="settings-card">
                          <p className="settings-card-title">Origens de Lead</p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                            {leadConfig.sources.map((src, idx) => (
                              <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', background: '#f8fafc', border: '1px solid rgba(15,23,42,0.09)', borderRadius: '20px', fontSize: '12px', color: '#374151' }}>
                                {src}
                                <button onClick={() => setLeadConfig(prev => ({ ...prev, sources: prev.sources.filter((_, i) => i !== idx) }))}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#9ca3af', lineHeight: 1 }}>
                                  <X size={11} />
                                </button>
                              </span>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input className="settings-input" style={{ flex: 1, fontSize: '12.5px' }}
                              placeholder="Nova origem..."
                              value={newSource}
                              onChange={e => setNewSource(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && newSource.trim()) {
                                  setLeadConfig(prev => ({ ...prev, sources: [...prev.sources, newSource.trim()] }));
                                  setNewSource('');
                                }
                              }} />
                            <button className="settings-btn-ghost" style={{ padding: '6px 14px', fontSize: '12px' }}
                              onClick={() => {
                                if (newSource.trim()) {
                                  setLeadConfig(prev => ({ ...prev, sources: [...prev.sources, newSource.trim()] }));
                                  setNewSource('');
                                }
                              }}>
                              <Plus size={12} /> Adicionar
                            </button>
                          </div>
                        </div>

                        {/* Canais de entrada = contas de WhatsApp conectadas (geridas em
                            Integrações). No funil, o canal é escolhido na gaveta de Leads
                            dentro do WhatsApp e filtra os leads por origem. */}

                        <div className="settings-save-bar" style={{ marginTop: 0 }}>
                          <button className="settings-btn-primary" disabled={saving}
                            onClick={async () => {
                              setSaving(true);
                              try {
                                const persisted = await runWithSettingsPin(
                                  {
                                    action: 'update_lead_module',
                                    title: 'Salvar configurações de Leads',
                                    description: 'Confirme com seu PIN para salvar as configurações do módulo de Leads.',
                                    resourceType: 'lead_module',
                                  },
                                  () => settingsService.updateLeadModuleConfig(leadConfig, currentProfile?.name),
                                );
                                if (!persisted) return;
                                setFeedback('success', 'Configurações de Leads salvas!');
                              } catch (err: any) {
                                setFeedback('error', err.message || 'Erro ao salvar.');
                              } finally { setSaving(false); }
                            }}>
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                          </button>
                        </div>
                      </>
                  );
                  const isWa = activeSection === 'modules_whatsapp';
                  if (!isWa) {
                    return (
                      <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {leadsCards}
                      </div>
                    );
                  }
                  const waPanelHeader = (k: string, Icon: React.ComponentType<any>, title: string, subtitle: string) => (
                    <button
                      type="button"
                      onClick={() => toggleWaHub(k)}
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '16px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '34px', height: '34px', borderRadius: '9px', background: '#fff7ed', color: '#f97316', flexShrink: 0 }}>
                        <Icon size={17} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 700, color: '#374151' }}>{title}</span>
                        <span style={{ display: 'block', fontSize: '11.5px', color: '#9ca3af' }}>{subtitle}</span>
                      </span>
                      <ChevronDown size={18} style={{ color: '#94a3b8', flexShrink: 0, transition: 'transform 0.15s', transform: waHubExpanded[k] ? 'rotate(180deg)' : 'none' }} />
                    </button>
                  );
                  return (
                    <div style={{ padding: '24px 40px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <p style={{ fontSize: '11.5px', color: '#9ca3af', margin: '0 2px 4px' }}>
                        Tudo do atendimento por WhatsApp em um só lugar. Expanda cada seção para configurar.
                      </p>

                      {/* Painel 1 — Conexão, servidor, canais e departamentos (Evolution) */}
                      <div className="settings-card" style={{ padding: 0, overflow: 'hidden' }}>
                        {waPanelHeader('connection', MessageCircle, 'Conexão & Servidor', 'Servidor Evolution, canais conectados e departamentos')}
                        {waHubExpanded.connection && (
                          <div style={{ borderTop: '1px solid #f1f0ec' }}>
                            <WhatsAppIntegrationSettings requirePin={requirePin} userName={currentProfile?.name} onFeedback={setFeedback} />
                          </div>
                        )}
                      </div>

                      {/* Painel 2 — Funil de atendimento (mesma config do módulo Leads) */}
                      <div className="settings-card" style={{ padding: 0, overflow: 'hidden' }}>
                        {waPanelHeader('funnel', Target, 'Funil de atendimento (Leads)', 'Estágios, etiquetas, etapa inicial por canal e origens')}
                        {waHubExpanded.funnel && (
                          <div style={{ borderTop: '1px solid #f1f0ec', padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {leadsCards}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* ── Módulos → Agenda ── */}
                {activeSection === 'modules_agenda' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                      {/* Buffer entre compromissos */}
                      <div className="settings-card">
                        <p className="settings-card-title">Parâmetros gerais</p>
                        <div style={{ maxWidth: '240px' }}>
                          <label className="settings-label">Buffer entre compromissos (minutos)</label>
                          <input className="settings-input" type="number" min={0} max={60} step={5}
                            value={calendarConfig.buffer_min}
                            onChange={e => setCalendarConfig(prev => ({ ...prev, buffer_min: Number(e.target.value) || 0 }))} />
                          <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>Tempo de folga após cada compromisso.</p>
                        </div>
                      </div>

                      <div className="settings-card">
                        <p className="settings-card-title">Tipos de Compromisso</p>
                        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '12px', color: '#92400e' }}>
                          <strong>O que é configurável:</strong> rótulo, cor, duração padrão e visibilidade de cada tipo.<br/>
                          <strong>O que não muda:</strong> os 7 tipos canônicos (<em>deadline · hearing · requirement · payment · pericia · meeting · personal</em>) têm lógica interna estrutural — filtros de permissão, navegação entre módulos e dedup de audiências dependem das chaves exatas. Renomeie à vontade, mas excluí-los ou desativá-los pode esconder eventos já existentes.<br/>
                          Novos tipos adicionados aqui ficam disponíveis como <em>compromisso personalizado</em>, sem navegação automática para outros módulos.
                        </div>
                        <ConfigurableList
                          items={normalizeItems(calendarConfig.event_types.map(et => ({
                            ...et,
                            metadata: { duration_min: et.duration_min },
                          })))}
                          showColor={true}
                          showDefault={false}
                          showDescription={false}
                          addLabel="Novo tipo de compromisso"
                          emptyMessage="Nenhum tipo configurado"
                          noDeleteIds={new Set(['deadline','hearing','requirement','payment','pericia','meeting','personal'])}
                          countRef={async (item) => {
                            const { data } = await supabase.rpc('count_calendar_events_by_type', { p_type: item.id });
                            return Number(data ?? 0);
                          }}
                          extraFields={(draft, patch) => (
                            <div>
                              <label className="block text-xs font-semibold text-slate-600 mb-1">Duração padrão (min)</label>
                              <input
                                type="number" min={15} max={480} step={15}
                                value={(draft.metadata?.duration_min as number) ?? 60}
                                onChange={e => patch({ metadata: { ...draft.metadata, duration_min: Number(e.target.value) || 60 } })}
                                className="w-full px-3 py-2 text-sm border border-[#e7e5df] rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400 bg-[#f8f7f5]"
                              />
                            </div>
                          )}
                          onChange={async items => {
                            const newTypes = items.map(item => ({
                              key:          item.id,
                              label:        item.label,
                              color:        item.color ?? '#64748b',
                              duration_min: (item.metadata?.duration_min as number) ?? 60,
                              active:       item.active,
                            }));
                              const newConfig = { ...calendarConfig, event_types: newTypes };
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_calendar_event_types',
                                  title: 'Alterar tipos da Agenda',
                                  description: 'Confirme com seu PIN para salvar os tipos de compromisso da Agenda.',
                                  resourceType: 'calendar_module',
                                  resourceId: 'event_types',
                                },
                                () => settingsService.updateCalendarModuleConfig(newConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setCalendarConfig(newConfig);
                              setFeedback('success', 'Salvo!');
                          }}
                        />
                      </div>

                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary" disabled={saving}
                          onClick={async () => {
                            setSaving(true);
                            try {
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_calendar_module',
                                  title: 'Salvar configurações da Agenda',
                                  description: 'Confirme com seu PIN para salvar as configurações do módulo de Agenda.',
                                  resourceType: 'calendar_module',
                                },
                                () => settingsService.updateCalendarModuleConfig(calendarConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setFeedback('success', 'Configurações de Agenda salvas!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally { setSaving(false); }
                          }}>
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                        </button>
                      </div>
                    </div>
                )}

                {/* ── Motor de IA → Provedores ── */}
                {activeSection === 'ai_providers' && (() => {
                  const AI_IDS: AiProviderId[] = ['openai', 'groq', 'anthropic', 'grok', 'gemini'];
                  return (
                      <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <p style={{ fontSize: '12.5px', color: '#747878' }}>
                          A IA roda pela Edge Function <code>openai-proxy</code> (cadeia DeepSeek → Groq → OpenAI) com as chaves guardadas como <em>secrets</em> no servidor (<code>DEEPSEEK_API_KEY</code>, <code>GROQ_API_KEY</code>, <code>OPENAI_API_KEY</code>). Nenhuma chave de IA fica no frontend.
                        </p>

                        {/* Provedores */}
                        <div className="settings-card">
                          <p className="settings-card-title">Provedores disponíveis</p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {AI_IDS.map(pid => {
                              const isEnabled = aiProviderConfig.enabled[pid] ?? false;
                              const isPrimary = aiProviderConfig.primary === pid;
                              return (
                                <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: '#fff', border: `1px solid ${isEnabled ? 'rgba(255,138,0,0.2)' : 'rgba(15,23,42,0.09)'}`, borderRadius: '10px' }}>
                                  <button
                                    className={`settings-toggle${isEnabled ? ' on' : ''}`}
                                    onClick={() => setAiProviderConfig(prev => ({ ...prev, enabled: { ...prev.enabled, [pid]: !isEnabled } }))}
                                    aria-label="toggle"
                                  />
                                  <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: '#191c1e' }}>{AI_PROVIDER_LABELS[pid]}</span>
                                  {isPrimary && <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#ff8a00', background: 'rgba(255,138,0,0.1)', padding: '2px 8px', borderRadius: '12px' }}>PRIMÁRIO</span>}
                                  {isEnabled && !isPrimary && (
                                    <button style={{ fontSize: '11px', color: '#747878', border: '1px solid rgba(15,23,42,0.12)', borderRadius: '6px', padding: '3px 9px', background: 'transparent', cursor: 'pointer' }}
                                      onClick={() => setAiProviderConfig(prev => ({ ...prev, primary: pid }))}>
                                      Definir como primário
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Ordem de fallback */}
                        <div className="settings-card">
                          <p className="settings-card-title">Ordem de fallback</p>
                          <p style={{ fontSize: '11.5px', color: '#747878', marginBottom: '10px' }}>Sequência de provedores tentados quando o primário falha.</p>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {AI_IDS.filter(pid => aiProviderConfig.enabled[pid] && pid !== aiProviderConfig.primary).map(pid => {
                              const inFallback = aiProviderConfig.fallback_order.includes(pid);
                              return (
                                <button key={pid}
                                  onClick={() => {
                                    const cur = aiProviderConfig.fallback_order;
                                    const next = inFallback ? cur.filter(p => p !== pid) : [...cur, pid];
                                    setAiProviderConfig(prev => ({ ...prev, fallback_order: next }));
                                  }}
                                  style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: `1px solid ${inFallback ? 'rgba(255,138,0,0.4)' : 'rgba(15,23,42,0.12)'}`, background: inFallback ? 'rgba(255,138,0,0.08)' : 'transparent', color: inFallback ? '#ff8a00' : '#747878' }}>
                                  {AI_PROVIDER_LABELS[pid]}
                                </button>
                              );
                            })}
                            {AI_IDS.filter(pid => aiProviderConfig.enabled[pid] && pid !== aiProviderConfig.primary).length === 0 && (
                              <p style={{ fontSize: '12px', color: '#9ca3af' }}>Habilite outros provedores para configurar o fallback.</p>
                            )}
                          </div>
                        </div>

                        {/* Cooldown */}
                        <div className="settings-card">
                          <p className="settings-card-title">Cooldown após erro de rate-limit</p>
                          <div style={{ maxWidth: '240px' }}>
                            <label className="settings-label">Tempo de espera (ms)</label>
                            <input className="settings-input" type="number" min={1000} max={300000} step={1000}
                              value={aiProviderConfig.cooldown_ms}
                              onChange={e => setAiProviderConfig(prev => ({ ...prev, cooldown_ms: Number(e.target.value) || 60000 }))} />
                            <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>Padrão: 60 000 ms (60s)</p>
                          </div>
                        </div>

                        <div className="settings-save-bar" style={{ marginTop: 0 }}>
                          <button className="settings-btn-primary" disabled={saving}
                            onClick={async () => {
                              setSaving(true);
                              try {
                                const persisted = await runWithSettingsPin(
                                  {
                                    action: 'update_ai_providers',
                                    title: 'Salvar provedores de IA',
                                    description: 'Confirme com seu PIN para salvar a configuração dos provedores de IA.',
                                    resourceType: 'ai_provider_config',
                                  },
                                  () => settingsService.updateAiProviderConfig(aiProviderConfig, currentProfile?.name),
                                );
                                if (!persisted) return;
                                aiService.invalidateSettings();
                                setFeedback('success', 'Configuração de provedores de IA salva!');
                              } catch (err: any) {
                                setFeedback('error', err.message || 'Erro ao salvar.');
                              } finally { setSaving(false); }
                            }}>
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                          </button>
                        </div>
                      </div>
                  );
                })()}

                {/* ── Motor de IA → Parâmetros por tarefa ── */}
                {activeSection === 'ai_tasks' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <p style={{ fontSize: '12.5px', color: '#747878' }}>
                        Ajuste o modelo, temperatura e limite de tokens para cada tarefa de IA. Alterações afetam chamadas futuras.
                      </p>

                      <div className="settings-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                          <thead>
                            <tr style={{ background: '#f8fafc', borderBottom: '1px solid rgba(15,23,42,0.08)' }}>
                              <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, color: '#374151', fontSize: '11.5px' }}>Tarefa</th>
                              <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, color: '#374151', fontSize: '11.5px' }}>Modelo</th>
                              <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 600, color: '#374151', fontSize: '11.5px' }}>Temperatura</th>
                              <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 600, color: '#374151', fontSize: '11.5px' }}>Max tokens</th>
                            </tr>
                          </thead>
                          <tbody>
                            {aiTaskConfigs.map((task, idx) => (
                              <tr key={task.task_key} style={{ borderBottom: idx < aiTaskConfigs.length - 1 ? '1px solid rgba(15,23,42,0.06)' : 'none' }}>
                                <td style={{ padding: '10px 14px', color: '#191c1e', fontWeight: 500 }}>{task.label}</td>
                                <td style={{ padding: '10px 14px' }}>
                                  <input className="settings-input" style={{ fontSize: '12px', padding: '4px 8px' }}
                                    value={task.model}
                                    onChange={e => setAiTaskConfigs(prev => prev.map((t, i) => i === idx ? { ...t, model: e.target.value } : t))} />
                                </td>
                                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                  <input className="settings-input" type="number" min={0} max={2} step={0.1} style={{ width: '70px', fontSize: '12px', padding: '4px 8px', textAlign: 'center' }}
                                    value={task.temperature}
                                    onChange={e => setAiTaskConfigs(prev => prev.map((t, i) => i === idx ? { ...t, temperature: Number(e.target.value) } : t))} />
                                </td>
                                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                  <input className="settings-input" type="number" min={10} max={8000} step={50} style={{ width: '85px', fontSize: '12px', padding: '4px 8px', textAlign: 'center' }}
                                    value={task.max_tokens}
                                    onChange={e => setAiTaskConfigs(prev => prev.map((t, i) => i === idx ? { ...t, max_tokens: Number(e.target.value) || 200 } : t))} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary" disabled={saving}
                          onClick={async () => {
                            setSaving(true);
                            try {
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_ai_tasks',
                                  title: 'Salvar parâmetros de IA',
                                  description: 'Confirme com seu PIN para salvar os parâmetros das tarefas de IA.',
                                  resourceType: 'ai_task_config',
                                },
                                () => settingsService.updateAiTaskConfigs(aiTaskConfigs, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setFeedback('success', 'Parâmetros de IA salvos!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally { setSaving(false); }
                          }}>
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                        </button>
                      </div>
                    </div>
                )}

                {/* ── Módulos → Requerimentos ── */}
                {activeSection === 'modules_requirements' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                      <div className="settings-card">
                        <p className="settings-card-title">Status dos Requerimentos</p>
                        <p style={{ fontSize: '12px', color: '#747878', marginBottom: '12px' }}>Reordene, renomeie ou desative status. Remoção pode afetar requerimentos existentes.</p>
                        <ConfigurableList
                          items={normalizeItems(requirementConfig.statuses)}
                          showColor={false}
                          showDefault={true}
                          showDescription={false}
                          addLabel="Novo status"
                          emptyMessage="Nenhum status configurado"
                          countRef={async (item) => {
                            const { data } = await supabase.rpc('count_requirements_by_status', { p_status: item.id });
                            return Number(data ?? 0);
                          }}
                          onChange={async items => {
                            const newStatuses = items.map(item => ({
                              key:       item.id,
                              label:     item.label,
                              badge:     requirementConfig.statuses.find(s => s.key === item.id)?.badge ?? 'bg-slate-100 text-slate-700',
                              active:    item.active,
                              isDefault: item.isDefault ?? false,
                            }));
                              const newConfig = { ...requirementConfig, statuses: newStatuses };
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_requirement_statuses',
                                  title: 'Alterar status de Requerimentos',
                                  description: 'Confirme com seu PIN para salvar os status do módulo de Requerimentos.',
                                  resourceType: 'requirement_module',
                                  resourceId: 'statuses',
                                },
                                () => settingsService.updateRequirementModuleConfig(newConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setRequirementConfig(newConfig);
                              setFeedback('success', 'Salvo!');
                          }}
                        />
                      </div>

                      <div className="settings-card">
                        <p className="settings-card-title">Tipos de Benefício INSS</p>
                        <ConfigurableList
                          items={normalizeItems(requirementConfig.benefit_types)}
                          showColor={false}
                          showDefault={false}
                          showDescription={false}
                          addLabel="Novo tipo de benefício"
                          emptyMessage="Nenhum tipo de benefício"
                          countRef={async (item) => {
                            const { data } = await supabase.rpc('count_requirements_by_benefit_type', { p_benefit_type: item.id });
                            return Number(data ?? 0);
                          }}
                          onChange={async items => {
                            const newTypes = items.map(item => ({ key: item.id, label: item.label, active: item.active }));
                              const newConfig = { ...requirementConfig, benefit_types: newTypes };
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_requirement_benefits',
                                  title: 'Alterar tipos de benefício',
                                  description: 'Confirme com seu PIN para salvar os tipos de benefício do módulo de Requerimentos.',
                                  resourceType: 'requirement_module',
                                  resourceId: 'benefit_types',
                                },
                                () => settingsService.updateRequirementModuleConfig(newConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setRequirementConfig(newConfig);
                              setFeedback('success', 'Salvo!');
                          }}
                        />
                      </div>

                      {/* ── Backfill Senha INSS ── */}
                      <div className="settings-card" style={{ borderColor: 'rgba(234,88,12,0.2)', background: 'rgba(255,237,213,0.18)' }}>
                        <p className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Key size={14} style={{ color: '#ea580c' }} />
                          Migração de Senha INSS (Backfill)
                        </p>
                        <p style={{ fontSize: '12px', color: '#747878', marginBottom: '12px', lineHeight: 1.5 }}>
                          Registros antigos armazenam a senha INSS em texto simples. Este processo encripta cada senha em lote (AES-GCM) e zera o campo original. Execute uma vez; registros já migrados são ignorados automaticamente.
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          <button
                            className="settings-btn-primary"
                            style={{ background: backfillRunning ? undefined : '#ea580c' }}
                            disabled={backfillRunning}
                            onClick={async () => {
                              setBackfillRunning(true);
                              setBackfillResult(null);
                              try {
                                const { data, error } = await supabase.functions.invoke('inss-backfill', { body: { batch_size: 200 } });
                                if (error) {
                                  setFeedback('error', error.message || 'Erro ao executar backfill.');
                                } else {
                                  setBackfillResult({
                                    processed: data.processed ?? 0,
                                    failed:    data.failed    ?? 0,
                                    remaining: data.remaining ?? 0,
                                    message:   data.message   ?? '',
                                  });
                                }
                              } catch (e: any) {
                                setFeedback('error', e.message || 'Erro');
                              } finally { setBackfillRunning(false); }
                            }}>
                            {backfillRunning ? <Loader2 size={13} className="animate-spin" /> : <Key size={13} />}
                            {backfillRunning ? 'Migrando…' : 'Iniciar Backfill'}
                          </button>
                          {backfillResult && (
                            <div style={{
                              padding: '7px 12px', borderRadius: '8px',
                              background: backfillResult.failed === 0 ? '#f0fdf4' : '#fef9c3',
                              border: `1px solid ${backfillResult.failed === 0 ? '#bbf7d0' : '#fde68a'}`,
                              fontSize: '12px', color: backfillResult.failed === 0 ? '#15803d' : '#92400e',
                              display: 'flex', alignItems: 'center', gap: '6px',
                            }}>
                              {backfillResult.failed === 0
                                ? <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
                                : <AlertTriangle size={13} style={{ flexShrink: 0 }} />}
                              {backfillResult.message}
                              {backfillResult.remaining > 0 && (
                                <span style={{ marginLeft: '4px', opacity: 0.8 }}>— execute novamente para continuar.</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary" disabled={saving}
                          onClick={async () => {
                            setSaving(true);
                            try {
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_requirement_module',
                                  title: 'Salvar configurações de Requerimentos',
                                  description: 'Confirme com seu PIN para salvar as configurações do módulo de Requerimentos.',
                                  resourceType: 'requirement_module',
                                },
                                () => settingsService.updateRequirementModuleConfig(requirementConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setFeedback('success', 'Configurações de Requerimentos salvas!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally { setSaving(false); }
                          }}>
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                        </button>
                      </div>
                    </div>
                )}

                {/* ── Módulos → Assinaturas ── */}
                {activeSection === 'modules_signature' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                      {/* Papéis do signatário */}
                      <div className="settings-card">
                        <p className="settings-card-title">Papéis do Signatário</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                          {signatureConfig.signer_roles.map((role, idx) => (
                            <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', background: '#f8fafc', border: '1px solid rgba(15,23,42,0.09)', borderRadius: '20px', fontSize: '12px', color: '#374151' }}>
                              {role}
                              <button onClick={() => setSignatureConfig(prev => ({ ...prev, signer_roles: prev.signer_roles.filter((_, i) => i !== idx) }))}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#9ca3af' }}><X size={11} /></button>
                            </span>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input className="settings-input" style={{ flex: 1, fontSize: '12.5px' }}
                            placeholder="Novo papel..."
                            value={newSignerRole}
                            onChange={e => setNewSignerRole(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && newSignerRole.trim()) {
                                setSignatureConfig(prev => ({ ...prev, signer_roles: [...prev.signer_roles, newSignerRole.trim()] }));
                                setNewSignerRole('');
                              }
                            }} />
                          <button className="settings-btn-ghost" style={{ padding: '6px 14px', fontSize: '12px' }}
                            onClick={() => {
                              if (newSignerRole.trim()) {
                                setSignatureConfig(prev => ({ ...prev, signer_roles: [...prev.signer_roles, newSignerRole.trim()] }));
                                setNewSignerRole('');
                              }
                            }}>
                            <Plus size={12} /> Adicionar
                          </button>
                        </div>
                      </div>

                      {/* Autenticação pública (portal) */}
                      <div className="settings-card">
                        <p className="settings-card-title">Autenticação Pública</p>
                        <p style={{ fontSize: '12px', color: '#747878', marginBottom: '12px' }}>Métodos de login disponíveis para o cliente acessar a página de assinatura.</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {(
                            [
                              { key: 'google' as const, label: 'Google' },
                              { key: 'email' as const, label: 'E-mail' },
                              { key: 'phone' as const, label: 'Telefone' },
                            ]
                          ).map((item) => (
                            <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: '#374151' }}>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = { ...publicAuthSignConfig, [item.key]: !publicAuthSignConfig[item.key] };
                                  if (!next.google && !next.email && !next.phone) return;
                                  setPublicAuthSignConfig(next);
                                }}
                                className={`relative w-8 h-5 rounded-full transition ${publicAuthSignConfig[item.key] ? 'bg-orange-500' : 'bg-slate-300'}`}
                              >
                                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-[#f8f7f5] rounded-full shadow transition-transform ${publicAuthSignConfig[item.key] ? 'translate-x-3' : 'translate-x-0'}`} />
                              </button>
                              {item.label}
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Métodos de autenticação disponíveis */}
                      <div className="settings-card">
                        <p className="settings-card-title">Métodos de Autenticação Disponíveis</p>
                        <p style={{ fontSize: '12px', color: '#747878', marginBottom: '12px' }}>
                          Habilite os métodos que podem ser selecionados ao criar uma solicitação. O padrão (⭕) é pré-selecionado automaticamente.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {ALL_AUTH_METHODS.map(method => {
                            const enabled = signatureConfig.auth_methods.includes(method);
                            const isDefault = signatureConfig.default_auth_method === method;
                            const enabledCount = signatureConfig.auth_methods.length;
                            return (
                              <div key={method} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: enabled ? '#fef9f0' : '#f8fafc', border: `1px solid ${enabled ? 'rgba(255,138,0,0.2)' : 'rgba(15,23,42,0.08)'}`, borderRadius: '8px' }}>
                                <button
                                  onClick={() => {
                                    if (enabled && enabledCount <= 1) return;
                                    const next = enabled
                                      ? signatureConfig.auth_methods.filter(m => m !== method)
                                      : [...signatureConfig.auth_methods, method];
                                    const newDefault = (enabled && isDefault)
                                      ? next[0] ?? ''
                                      : signatureConfig.default_auth_method;
                                    setSignatureConfig(prev => ({ ...prev, auth_methods: next, default_auth_method: newDefault }));
                                  }}
                                  title={enabled && enabledCount <= 1 ? 'Pelo menos um método deve estar habilitado' : enabled ? 'Desabilitar' : 'Habilitar'}
                                  style={{ width: '18px', height: '18px', borderRadius: '4px', border: `2px solid ${enabled ? '#ff8a00' : '#d1d5db'}`, background: enabled ? '#ff8a00' : 'white', cursor: enabled && enabledCount <= 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                                >
                                  {enabled && <Check size={11} color="white" strokeWidth={3} />}
                                </button>
                                <span style={{ flex: 1, fontSize: '13px', color: enabled ? '#374151' : '#9ca3af' }}>{method}</span>
                                {enabled && (
                                  <button
                                    onClick={() => setSignatureConfig(prev => ({ ...prev, default_auth_method: method }))}
                                    title={isDefault ? 'Método padrão' : 'Definir como padrão'}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: isDefault ? '#ff8a00' : '#d1d5db' }}
                                  >
                                    {isDefault ? <CheckCircle size={15} /> : <Circle size={15} />}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary" disabled={saving}
                          onClick={async () => {
                            setSaving(true);
                              try {
                                const persisted = await runWithSettingsPin(
                                  {
                                    action: 'update_signature_module',
                                    title: 'Salvar configurações de Assinaturas',
                                    description: 'Confirme com seu PIN para salvar as configurações do módulo de Assinaturas.',
                                    resourceType: 'signature_module',
                                  },
                                  () => Promise.all([
                                    settingsService.updateSignatureModuleConfig(signatureConfig, currentProfile?.name),
                                    settingsService.updateSetting('public_signature_auth_google', publicAuthSignConfig.google, currentProfile?.name),
                                    settingsService.updateSetting('public_signature_auth_email', publicAuthSignConfig.email, currentProfile?.name),
                                    settingsService.updateSetting('public_signature_auth_phone', publicAuthSignConfig.phone, currentProfile?.name),
                                  ]).then(() => undefined),
                                );
                                if (!persisted) return;
                                setFeedback('success', 'Configurações de Assinaturas salvas!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally { setSaving(false); }
                          }}>
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                        </button>
                      </div>
                    </div>
                )}

                {/* ── Módulos → Tarefas ── */}
                {activeSection === 'modules_tasks' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div className="settings-card">
                        <p className="settings-card-title">Prioridades</p>
                        <p style={{ fontSize: '12px', color: '#747878', marginBottom: '12px' }}>Reordene ou renomeie prioridades. As chaves são usadas internamente.</p>
                        <ConfigurableList
                          items={normalizeItems(taskModConfig.priorities)}
                          showColor={false}
                          showDefault={true}
                          showDescription={false}
                          emptyMessage="Nenhuma prioridade configurada"
                          countRef={async (item) => {
                            const { data } = await supabase.rpc('count_tasks_by_priority', { p_priority: item.id });
                            return Number(data ?? 0);
                          }}
                          onChange={async items => {
                            const newPriorities = items.map(item => ({
                              key:       item.id,
                              label:     item.label,
                              badge:     taskModConfig.priorities.find(p => p.key === item.id)?.badge ?? 'bg-slate-400 text-white',
                              active:    item.active,
                              isDefault: item.isDefault ?? false,
                            }));
                              const newConfig = { ...taskModConfig, priorities: newPriorities };
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_task_priorities',
                                  title: 'Alterar prioridades de Tarefas',
                                  description: 'Confirme com seu PIN para salvar as prioridades do módulo de Tarefas.',
                                  resourceType: 'task_module',
                                  resourceId: 'priorities',
                                },
                                () => settingsService.updateTaskModuleConfig(newConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setTaskModConfig(newConfig);
                              setFeedback('success', 'Salvo!');
                          }}
                        />
                      </div>
                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary" disabled={saving}
                          onClick={async () => {
                            setSaving(true);
                            try {
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_task_module',
                                  title: 'Salvar configurações de Tarefas',
                                  description: 'Confirme com seu PIN para salvar as configurações do módulo de Tarefas.',
                                  resourceType: 'task_module',
                                },
                                () => settingsService.updateTaskModuleConfig(taskModConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setFeedback('success', 'Configurações de Tarefas salvas!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally { setSaving(false); }
                          }}>
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                        </button>
                      </div>
                    </div>
                )}

                {/* ── Módulos → Clientes ── */}
                {activeSection === 'modules_clients' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                      <div className="settings-card">
                        <p className="settings-card-title">Status de Clientes</p>
                        <ConfigurableList
                          items={normalizeItems(clientConfig.statuses)}
                          showColor={false}
                          showDefault={false}
                          showDescription={false}
                          addLabel="Novo status"
                          emptyMessage="Nenhum status configurado"
                          countRef={async (item) => {
                            const { data } = await supabase.rpc('count_clients_by_status', { p_status: item.id });
                            return Number(data ?? 0);
                          }}
                          onChange={async items => {
                            const newStatuses = items.map(item => ({
                              key:    item.id,
                              label:  item.label,
                              badge:  clientConfig.statuses.find(s => s.key === item.id)?.badge ?? 'bg-slate-100 text-slate-700',
                              active: item.active,
                            }));
                              const newConfig = { ...clientConfig, statuses: newStatuses };
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_client_statuses',
                                  title: 'Alterar status de Clientes',
                                  description: 'Confirme com seu PIN para salvar os status do módulo de Clientes.',
                                  resourceType: 'client_module',
                                  resourceId: 'statuses',
                                },
                                () => settingsService.updateClientModuleConfig(newConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setClientConfig(newConfig);
                              setFeedback('success', 'Salvo!');
                          }}
                        />
                      </div>

                      <div className="settings-card">
                        <p className="settings-card-title">Estado Civil</p>
                        <p style={{ fontSize: '12px', color: '#747878', marginBottom: '12px' }}>Estado civil é definido legalmente — renomeie rótulos sem alterar as chaves internas. Entradas incorretas podem ser excluídas.</p>
                        <ConfigurableList
                          items={normalizeItems(clientConfig.marital_statuses)}
                          showColor={false}
                          showDefault={true}
                          showDescription={false}
                          emptyMessage="Nenhum estado civil configurado"
                          countRef={async (item) => {
                            const { data } = await supabase.rpc('count_clients_by_marital_status', { p_marital: item.id });
                            return Number(data ?? 0);
                          }}
                          onChange={async items => {
                            const newMarital = items.map(item => ({ key: item.id, label: item.label, active: item.active, isDefault: item.isDefault ?? false }));
                              const newConfig = { ...clientConfig, marital_statuses: newMarital };
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_client_marital_statuses',
                                  title: 'Alterar estado civil de Clientes',
                                  description: 'Confirme com seu PIN para salvar os estados civis do módulo de Clientes.',
                                  resourceType: 'client_module',
                                  resourceId: 'marital_statuses',
                                },
                                () => settingsService.updateClientModuleConfig(newConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setClientConfig(newConfig);
                              setFeedback('success', 'Salvo!');
                          }}
                        />
                      </div>

                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary" disabled={saving}
                          onClick={async () => {
                            setSaving(true);
                            try {
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_client_module',
                                  title: 'Salvar configurações de Clientes',
                                  description: 'Confirme com seu PIN para salvar as configurações do módulo de Clientes.',
                                  resourceType: 'client_module',
                                },
                                () => settingsService.updateClientModuleConfig(clientConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setFeedback('success', 'Configurações de Clientes salvas!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally { setSaving(false); }
                          }}>
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                        </button>
                      </div>
                    </div>
                )}

                {/* ── Portal → Personalização ── */}
                {activeSection === 'portal_customization' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div className="settings-card">
                        <p className="settings-card-title">Aparência do Portal</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                          <div>
                            <label className="settings-label">Cor de destaque</label>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <input type="color" style={{ width: '40px', height: '32px', border: '1px solid rgba(15,23,42,0.12)', borderRadius: '6px', padding: '2px', cursor: 'pointer' }}
                                value={portalCustom.accent_color}
                                onChange={e => setPortalCustom(prev => ({ ...prev, accent_color: e.target.value }))} />
                              <input className="settings-input" style={{ flex: 1, fontSize: '12.5px', fontFamily: 'monospace' }}
                                value={portalCustom.accent_color}
                                onChange={e => setPortalCustom(prev => ({ ...prev, accent_color: e.target.value }))} />
                            </div>
                          </div>
                          <div>
                            <label className="settings-label">Contato de suporte</label>
                            <input className="settings-input"
                              value={portalCustom.support_contact}
                              placeholder="ex: (11) 9999-9999 ou suporte@escritorio.com"
                              onChange={e => setPortalCustom(prev => ({ ...prev, support_contact: e.target.value }))} />
                          </div>
                        </div>
                      </div>
                      <div className="settings-card">
                        <p className="settings-card-title">Textos</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div>
                            <label className="settings-label">Mensagem de boas-vindas</label>
                            <input className="settings-input"
                              value={portalCustom.welcome_message}
                              onChange={e => setPortalCustom(prev => ({ ...prev, welcome_message: e.target.value }))} />
                          </div>
                          <div>
                            <label className="settings-label">Texto do rodapé</label>
                            <input className="settings-input"
                              value={portalCustom.footer_text}
                              placeholder="ex: © 2026 Silva & Advogados Associados"
                              onChange={e => setPortalCustom(prev => ({ ...prev, footer_text: e.target.value }))} />
                          </div>
                        </div>
                      </div>
                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary" disabled={saving}
                          onClick={async () => {
                            setSaving(true);
                            try {
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_portal_customization',
                                  title: 'Salvar aparência do Portal',
                                  description: 'Confirme com seu PIN para salvar a personalização do Portal.',
                                  resourceType: 'portal_customization',
                                },
                                () => settingsService.updatePortalCustomizationConfig(portalCustom, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setFeedback('success', 'Personalização do Portal salva!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally { setSaving(false); }
                          }}>
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                        </button>
                      </div>
                    </div>
                )}

                {/* ── Portal → Notificações ao cliente ── */}
                {activeSection === 'portal_notifications' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <p style={{ fontSize: '12.5px', color: '#747878' }}>
                        Defina quais eventos disparam alertas automáticos para o cliente no Portal.
                      </p>
                      <div className="settings-card">
                        <p className="settings-card-title">Eventos que notificam o cliente</p>
                        {(
                          [
                            { key: 'new_document',         label: 'Novo documento disponível' },
                            { key: 'document_request',     label: 'Solicitação de documento (escritório pediu algo)' },
                            { key: 'deadline_approaching', label: 'Prazo importante se aproximando' },
                            { key: 'process_update',       label: 'Atualização em processo (novo andamento)' },
                            { key: 'payment_confirmed',    label: 'Pagamento / parcela confirmado' },
                            { key: 'new_message',          label: 'Nova mensagem do escritório' },
                          ] as { key: keyof PortalClientNotificationsConfig; label: string }[]
                        ).map(({ key, label }) => (
                          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: '1px solid rgba(15,23,42,0.05)', cursor: 'pointer', fontSize: '13px', color: '#374151' }}>
                            <button
                              className={`settings-toggle${portalClientNotif[key] ? ' on' : ''}`}
                              onClick={() => setPortalClientNotif(prev => ({ ...prev, [key]: !prev[key] }))}
                              aria-label={label} />
                            {label}
                          </label>
                        ))}
                      </div>
                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary" disabled={saving}
                          onClick={async () => {
                            setSaving(true);
                            try {
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_portal_client_notifications',
                                  title: 'Salvar notificações do Portal',
                                  description: 'Confirme com seu PIN para salvar as notificações do cliente no Portal.',
                                  resourceType: 'portal_client_notifications',
                                },
                                () => settingsService.updatePortalClientNotificationsConfig(portalClientNotif, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setFeedback('success', 'Notificações ao cliente salvas!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally { setSaving(false); }
                          }}>
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                        </button>
                      </div>
                    </div>
                )}

                {/* ── Motor de IA → Editor de Prompts ── */}
                {activeSection === 'ai_prompts' && (() => {
                  const override = aiPromptOverrides.find(o => o.key === selectedPromptKey);
                  const metaEntry = AI_PROMPT_KEYS.find(k => k.key === selectedPromptKey);
                  return (
                      <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <p style={{ fontSize: '12.5px', color: '#747878' }}>
                          Customize os prompts do sistema de IA. Os padrões estão em <code>ai.service.ts</code> — salve aqui para sobrescrever. Após salvar, atualize <code>ai.service.ts</code> para ler de <code>settingsService.getAiPromptOverrides()</code>.
                        </p>

                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                          {/* Lista */}
                          <div style={{ width: '210px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {AI_PROMPT_KEYS.map(pk => {
                              const hasOverride = aiPromptOverrides.some(o => o.key === pk.key);
                              return (
                                <div key={pk.key}
                                  onClick={() => {
                                    setSelectedPromptKey(pk.key);
                                    setPromptDraft(aiPromptOverrides.find(o => o.key === pk.key)?.system_prompt ?? '');
                                  }}
                                  style={{ padding: '9px 12px', background: selectedPromptKey === pk.key ? 'rgba(255,138,0,0.05)' : '#fff', border: `1px solid ${selectedPromptKey === pk.key ? 'rgba(255,138,0,0.45)' : 'rgba(15,23,42,0.09)'}`, borderRadius: '10px', cursor: 'pointer', transition: 'border-color .15s' }}>
                                  <p style={{ fontSize: '12.5px', fontWeight: selectedPromptKey === pk.key ? 600 : 500, color: '#191c1e', margin: 0 }}>{pk.label}</p>
                                  <p style={{ fontSize: '10.5px', color: hasOverride ? '#ff8a00' : '#9ca3af', marginTop: '2px' }}>{hasOverride ? '● Customizado' : '○ Padrão'}</p>
                                </div>
                              );
                            })}
                          </div>

                          {/* Editor */}
                          {metaEntry ? (
                            <div className="settings-card" style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                <div>
                                  <p className="settings-card-title" style={{ margin: 0 }}>{metaEntry.label}</p>
                                  <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>{metaEntry.description}</p>
                                </div>
                                {override && (
                                  <button style={{ fontSize: '11px', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)', borderRadius: '6px', padding: '4px 10px', background: 'transparent', cursor: 'pointer' }}
                                    onClick={() => {
                                      const updated = aiPromptOverrides.filter(o => o.key !== selectedPromptKey);
                                      setAiPromptOverrides(updated);
                                      setPromptDraft('');
                                        void runWithSettingsPin(
                                          {
                                            action: 'remove_ai_prompt_override',
                                            title: 'Remover customização de prompt',
                                            description: 'Confirme com seu PIN para remover a customização do prompt.',
                                            resourceType: 'ai_prompt_override',
                                            resourceId: selectedPromptKey ?? undefined,
                                          },
                                          () => settingsService.updateAiPromptOverrides(updated, currentProfile?.name),
                                        ).then((persisted) => {
                                          if (!persisted) {
                                            setAiPromptOverrides(aiPromptOverrides);
                                            setPromptDraft(aiPromptOverrides.find(x => x.key === selectedPromptKey)?.system_prompt ?? '');
                                          }
                                        }).catch((err: any) => {
                                          setAiPromptOverrides(aiPromptOverrides);
                                          setFeedback('error', err?.message || 'Erro ao salvar.');
                                        });
                                    }}>
                                    Remover customização
                                  </button>
                                )}
                              </div>
                              <label className="settings-label">Prompt customizado (system prompt)</label>
                              <textarea
                                className="settings-input"
                                rows={14}
                                style={{ fontFamily: 'monospace', fontSize: '11.5px', resize: 'vertical', lineHeight: 1.5 }}
                                placeholder={`Cole aqui o prompt customizado para "${metaEntry.label}". Deixe em branco para usar o padrão de ai.service.ts.`}
                                value={promptDraft}
                                onChange={e => setPromptDraft(e.target.value)}
                              />
                              <div className="settings-save-bar" style={{ marginTop: '10px' }}>
                                <button className="settings-btn-primary" disabled={saving}
                                  onClick={async () => {
                                    if (!selectedPromptKey) return;
                                    setSaving(true);
                                    try {
                                      const filtered = aiPromptOverrides.filter(o => o.key !== selectedPromptKey);
                                      const updated = promptDraft.trim()
                                        ? [...filtered, { key: selectedPromptKey, system_prompt: promptDraft.trim(), updated_at: new Date().toISOString() }]
                                        : filtered;
                                      setAiPromptOverrides(updated);
                                      const persisted = await runWithSettingsPin(
                                        {
                                          action: 'update_ai_prompt_overrides',
                                          title: 'Salvar prompt de IA',
                                          description: 'Confirme com seu PIN para salvar a customização do prompt.',
                                          resourceType: 'ai_prompt_override',
                                          resourceId: selectedPromptKey ?? undefined,
                                        },
                                        () => settingsService.updateAiPromptOverrides(updated, currentProfile?.name),
                                      );
                                      if (!persisted) return;
                                      aiService.invalidateSettings();
                                      setFeedback('success', promptDraft.trim() ? 'Prompt salvo!' : 'Customização removida (usando padrão).');
                                    } catch (err: any) {
                                      setFeedback('error', err.message || 'Erro ao salvar.');
                                    } finally { setSaving(false); }
                                  }}>
                                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '13px', padding: '40px 0' }}>
                              Selecione um prompt à esquerda para editar.
                            </div>
                          )}
                        </div>
                      </div>
                  );
                })()}

                {/* ── Construtor de Formulários ── */}
                {activeSection === 'form_builder' && (() => {
                  const selectedLayout = formLayouts.find(m => m.module_key === selectedFormModule) ?? null;
                  const updateField = (module_key: string, field_key: string, patch: Partial<FormFieldConfig>) => {
                    setFormLayouts(prev => prev.map(m =>
                      m.module_key === module_key
                        ? { ...m, fields: m.fields.map(f => f.field_key === field_key ? { ...f, ...patch } : f) }
                        : m
                    ));
                  };
                  const moveField = (module_key: string, field_key: string, dir: -1 | 1) => {
                    setFormLayouts(prev => prev.map(m => {
                      if (m.module_key !== module_key) return m;
                      const sorted = [...m.fields].sort((a, b) => a.order - b.order);
                      const idx = sorted.findIndex(f => f.field_key === field_key);
                      if (idx === -1) return m;
                      const next = idx + dir;
                      if (next < 0 || next >= sorted.length) return m;
                      const fields = sorted.map((f, i) => {
                        if (i === idx) return { ...f, order: sorted[next].order };
                        if (i === next) return { ...f, order: sorted[idx].order };
                        return f;
                      });
                      return { ...m, fields };
                    }));
                  };
                  return (
                      <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '10px', padding: '12px 16px' }}>
                          <span style={{ fontSize: '16px', flexShrink: 0 }}>⚠️</span>
                          <div>
                            <p style={{ fontSize: '13px', fontWeight: 600, color: '#92400e', margin: 0 }}>Renomeação e ordem salvos — ocultar/obrigatório ainda não consumidos</p>
                            <p style={{ fontSize: '12px', color: '#b45309', margin: '3px 0 0' }}>Alterações de rótulo e ordem são persistidas e poderão ser consumidas por módulos futuramente. As flags "Ocultar" e "Obrigatório" são salvas mas os formulários ainda não as leem.</p>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                          {/* Module list */}
                          <div style={{ width: '180px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {formLayouts.map(m => (
                              <div key={m.module_key}
                                onClick={() => setSelectedFormModule(m.module_key)}
                                style={{ padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, background: selectedFormModule === m.module_key ? '#ff8a00' : '#fff', color: selectedFormModule === m.module_key ? '#fff' : '#374151', border: `1px solid ${selectedFormModule === m.module_key ? '#ff8a00' : 'rgba(15,23,42,0.10)'}` }}>
                                {m.label}
                              </div>
                            ))}
                          </div>
                          {/* Field editor */}
                          {selectedLayout ? (
                            <div style={{ flex: 1 }}>
                              <div className="settings-card">
                                <p className="settings-card-title" style={{ marginBottom: '12px' }}>Campos — {selectedLayout.label}</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  {[...selectedLayout.fields].sort((a, b) => a.order - b.order).map((field, idx, arr) => (
                                    <div key={field.field_key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: field.hidden ? '#f9fafb' : '#fff', border: '1px solid rgba(15,23,42,0.08)', borderRadius: '8px', opacity: field.hidden ? 0.6 : 1 }}>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <button style={{ padding: '1px 4px', border: '1px solid rgba(15,23,42,0.10)', borderRadius: '4px', background: 'transparent', cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.3 : 1 }} onClick={() => moveField(selectedLayout.module_key, field.field_key, -1)} disabled={idx === 0}>▲</button>
                                        <button style={{ padding: '1px 4px', border: '1px solid rgba(15,23,42,0.10)', borderRadius: '4px', background: 'transparent', cursor: idx === arr.length - 1 ? 'not-allowed' : 'pointer', opacity: idx === arr.length - 1 ? 0.3 : 1 }} onClick={() => moveField(selectedLayout.module_key, field.field_key, 1)} disabled={idx === arr.length - 1}>▼</button>
                                      </div>
                                      <div style={{ flex: 1 }}>
                                        <input className="settings-input" style={{ fontSize: '12.5px', padding: '5px 8px' }}
                                          value={field.label}
                                          onChange={e => updateField(selectedLayout.module_key, field.field_key, { label: e.target.value })} />
                                        <p style={{ fontSize: '10.5px', color: '#9ca3af', marginTop: '2px' }}>chave: {field.field_key}{field.system ? ' · campo do sistema' : ''}</p>
                                      </div>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: '#374151', cursor: 'pointer', flexShrink: 0 }}>
                                        <input type="checkbox" checked={field.required} disabled={field.system}
                                          onChange={e => updateField(selectedLayout.module_key, field.field_key, { required: e.target.checked })} />
                                        Obrigatório
                                      </label>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: '#374151', cursor: field.system ? 'not-allowed' : 'pointer', flexShrink: 0, opacity: field.system ? 0.4 : 1 }}>
                                        <input type="checkbox" checked={field.hidden} disabled={field.system}
                                          onChange={e => updateField(selectedLayout.module_key, field.field_key, { hidden: e.target.checked })} />
                                        Ocultar
                                      </label>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="settings-save-bar">
                                <button className="settings-btn-primary" disabled={saving}
                                  onClick={async () => {
                                    setSaving(true);
                                    try {
                                      const persisted = await runWithSettingsPin(
                                        {
                                          action: 'update_form_layouts',
                                          title: 'Salvar layout de formulário',
                                          description: 'Confirme com seu PIN para salvar o layout dos formulários.',
                                          resourceType: 'form_layouts',
                                        },
                                        () => settingsService.updateFormLayouts(formLayouts, currentProfile?.name),
                                      );
                                      if (!persisted) return;
                                      setFeedback('success', 'Layout de formulário salvo!');
                                    } catch (err: any) {
                                      setFeedback('error', err.message || 'Erro ao salvar.');
                                    } finally { setSaving(false); }
                                  }}>
                                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '13px', padding: '40px 0' }}>
                              Selecione um módulo à esquerda.
                            </div>
                          )}
                        </div>
                      </div>
                  );
                })()}

                {/* ── Responsável por módulo ── */}
                {activeSection === 'responsibility' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <p style={{ fontSize: '12.5px', color: '#747878', margin: 0 }}>
                        Configure quem pode ser responsável em cada módulo e qual é o padrão ao criar um novo item.
                      </p>
                      {responsibilityConfig.map((rc, idx) => (
                        <div key={rc.module} className="settings-card">
                          <p className="settings-card-title" style={{ marginBottom: '12px' }}>{rc.label}</p>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                            <div>
                              <label className="settings-label">Quem pode ser responsável</label>
                              <select className="settings-input"
                                value={rc.allowed}
                                onChange={e => setResponsibilityConfig(prev => prev.map((r, i) => i === idx ? { ...r, allowed: e.target.value as ResponsibilityAllowed } : r))}>
                                <option value="all">Todos os membros</option>
                                <option value="lawyers">Apenas advogados</option>
                                <option value="single">Membro fixo</option>
                              </select>
                            </div>
                            <div>
                              <label className="settings-label">Responsável padrão ao criar</label>
                              <select className="settings-input"
                                value={rc.default_mode}
                                onChange={e => setResponsibilityConfig(prev => prev.map((r, i) => i === idx ? { ...r, default_mode: e.target.value as ResponsibilityDefault } : r))}>
                                <option value="none">Nenhum (deixar em branco)</option>
                                <option value="creator">Quem criou</option>
                                <option value="single">Membro fixo</option>
                              </select>
                            </div>
                            <div>
                              <label className="settings-label">Quem recebe notificação</label>
                              <select className="settings-input"
                                value={rc.notify}
                                onChange={e => setResponsibilityConfig(prev => prev.map((r, i) => i === idx ? { ...r, notify: e.target.value as ResponsibilityNotify } : r))}>
                                <option value="responsible">O responsável</option>
                                <option value="admin">Apenas admins</option>
                                <option value="all">Todos</option>
                              </select>
                            </div>
                          </div>
                          {(rc.allowed === 'single' || rc.default_mode === 'single') && (
                            <div style={{ marginTop: '10px' }}>
                              <label className="settings-label">Membro fixo (ID)</label>
                              <select className="settings-input"
                                value={rc.single_member_id ?? ''}
                                onChange={e => setResponsibilityConfig(prev => prev.map((r, i) => i === idx ? { ...r, single_member_id: e.target.value || null } : r))}>
                                <option value="">Selecionar…</option>
                                {users.map(u => (
                                  <option key={u.id} value={u.id}>{u.name || u.email}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary" disabled={saving}
                          onClick={async () => {
                            setSaving(true);
                            try {
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_responsibility_config',
                                  title: 'Salvar responsáveis por módulo',
                                  description: 'Confirme com seu PIN para salvar a configuração de responsáveis por módulo.',
                                  resourceType: 'responsibility_config',
                                },
                                () => settingsService.updateResponsibilityConfig(responsibilityConfig, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setFeedback('success', 'Responsáveis por módulo salvos!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally { setSaving(false); }
                          }}>
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                        </button>
                      </div>
                    </div>
                )}

                {/* ── Apps & Terceiros ── */}
                {activeSection === 'apps' && (() => {
                  type AppCard = { key: SettingsSection | null; label: string; description: string; category: string; status: 'active' | 'configured' | 'coming_soon' | 'unconfigured'; };
                  const APP_CARDS: AppCard[] = [
                    { key: 'integrations_email',   label: 'E-mail (Resend)',         description: 'Envio de e-mails transacionais e digest.',            category: 'Comunicação',  status: emailIntConfig.from_email ? 'configured' : 'unconfigured' },
                    { key: 'djen',                 label: 'DJEN & DataJud',          description: 'Monitoramento de intimações e atualização de processos.', category: 'Jurídico', status: 'active' },
                    { key: null,                   label: 'WhatsApp Business',       description: 'Envio de notificações e templates via WhatsApp.',       category: 'Comunicação', status: 'coming_soon' },
                    { key: null,                   label: 'Google Calendar',         description: 'Sincronização bidirecional de agenda.',                 category: 'Produtividade', status: 'coming_soon' },
                    { key: null,                   label: 'Google Drive / Dropbox',  description: 'Backup automático de documentos.',                      category: 'Armazenamento', status: 'coming_soon' },
                    { key: null,                   label: 'Zapier / Make',           description: 'Automações no-code com centenas de apps.',              category: 'Automação', status: 'coming_soon' },
                    { key: null,                   label: 'ClickSign / DocuSign',    description: 'Assinatura eletrônica externa (complementa fluxo nativo).', category: 'Jurídico', status: 'coming_soon' },
                    { key: null,                   label: 'PJe',                     description: 'Integração direta com o sistema PJe.',                  category: 'Jurídico', status: 'coming_soon' },
                  ];
                  const STATUS_INFO = {
                    active:       { label: 'Ativo',           color: '#059669', bg: '#d1fae5' },
                    configured:   { label: 'Configurado',     color: '#d97706', bg: '#fef3c7' },
                    coming_soon:  { label: 'Em breve',        color: '#6b7280', bg: '#f3f4f6' },
                    unconfigured: { label: 'Não configurado', color: '#dc2626', bg: '#fee2e2' },
                  };
                  const categories = [...new Set(APP_CARDS.map(c => c.category))];
                  return (
                      <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {categories.map(cat => (
                          <div key={cat}>
                            <p style={{ fontSize: '11px', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '10px' }}>{cat}</p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
                              {APP_CARDS.filter(c => c.category === cat).map(card => {
                                const si = STATUS_INFO[card.status];
                                return (
                                  <div key={card.label}
                                    onClick={() => card.key && setActiveSection(card.key)}
                                    style={{ padding: '14px 16px', background: '#fff', border: '1px solid rgba(15,23,42,0.08)', borderRadius: '10px', cursor: card.key ? 'pointer' : 'default', opacity: card.status === 'coming_soon' ? 0.72 : 1, transition: 'box-shadow 0.15s' }}
                                    onMouseEnter={e => { if (card.key) (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.10)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                                      <p style={{ fontSize: '13px', fontWeight: 600, color: '#111827', margin: 0 }}>{card.label}</p>
                                      <span style={{ fontSize: '10.5px', fontWeight: 600, color: si.color, background: si.bg, padding: '2px 7px', borderRadius: '99px', flexShrink: 0 }}>{si.label}</span>
                                    </div>
                                    <p style={{ fontSize: '11.5px', color: '#6b7280', margin: 0 }}>{card.description}</p>
                                    {card.key && <p style={{ fontSize: '11px', color: '#ff8a00', marginTop: '8px', fontWeight: 500 }}>Configurar →</p>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                  );
                })()}

                {/* ── Automações & Cron ── */}
                {activeSection === 'automations' && (
                    <div style={{ padding: '28px 40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                      {/* Limiares configuráveis */}
                      <div className="settings-card">
                        <p className="settings-card-title">Limiares de Automação</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                          <div>
                            <label className="settings-label">Requerimentos INSS — "Alta urgência" (dias após DER)</label>
                            <input className="settings-input" type="number" min={1} max={365}
                              value={automationThresholds.requirement_alert_days}
                              onChange={e => setAutomationThresholds(prev => ({ ...prev, requirement_alert_days: Number(e.target.value) || 90 }))} />
                            <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>Hoje fixo em 90 dias no <code>notification-scheduler</code>.</p>
                          </div>
                          <div>
                            <label className="settings-label">Requerimentos INSS — "Urgência crítica" (dias após DER)</label>
                            <input className="settings-input" type="number" min={1} max={365}
                              value={automationThresholds.requirement_critical_days}
                              onChange={e => setAutomationThresholds(prev => ({ ...prev, requirement_critical_days: Number(e.target.value) || 120 }))} />
                            <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>Hoje fixo em 120 dias no <code>notification-scheduler</code>.</p>
                          </div>
                          <div>
                            <label className="settings-label">Lembretes de compromisso — antecedência (minutos)</label>
                            <input className="settings-input" type="number" min={5} max={1440}
                              value={automationThresholds.appointment_remind_minutes}
                              onChange={e => setAutomationThresholds(prev => ({ ...prev, appointment_remind_minutes: Number(e.target.value) || 60 }))} />
                            <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>Hoje fixo em 60 min. O cron lê de <code>deadline_module_config</code>.</p>
                          </div>
                          <div>
                            <label className="settings-label">Requerimentos — tamanho do lote (registros por execução)</label>
                            <input className="settings-input" type="number" min={10} max={1000}
                              value={automationThresholds.requirement_batch_size}
                              onChange={e => setAutomationThresholds(prev => ({ ...prev, requirement_batch_size: Number(e.target.value) || 200 }))} />
                            <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>Hoje fixo em 200 no <code>notification-scheduler</code>.</p>
                          </div>
                        </div>
                        <p style={{ fontSize: '11.5px', color: '#b45309', marginTop: '10px', padding: '8px 10px', background: '#fffbeb', borderRadius: '6px', border: '1px solid #fde68a' }}>
                          ⚠️ Esses valores são salvos aqui, mas as edge functions ainda leem valores fixos no código. Para ativá-los, atualize cada edge function para ler de <code>automation_thresholds</code> via <code>system_settings</code>.
                        </p>
                      </div>

                      <div className="settings-save-bar" style={{ marginTop: 0 }}>
                        <button className="settings-btn-primary" disabled={saving}
                          onClick={async () => {
                            setSaving(true);
                            try {
                              const persisted = await runWithSettingsPin(
                                {
                                  action: 'update_automation_thresholds',
                                  title: 'Salvar limiares de automação',
                                  description: 'Confirme com seu PIN para salvar os limiares de automação.',
                                  resourceType: 'automation_thresholds',
                                },
                                () => settingsService.updateAutomationThresholds(automationThresholds, currentProfile?.name),
                              );
                              if (!persisted) return;
                              setFeedback('success', 'Limiares de automação salvos!');
                            } catch (err: any) {
                              setFeedback('error', err.message || 'Erro ao salvar.');
                            } finally { setSaving(false); }
                          }}>
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                        </button>
                      </div>

                      {/* Painel de Jobs */}
                      <div className="settings-card">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                          <p className="settings-card-title" style={{ margin: 0 }}>Jobs Agendados</p>
                          <button
                            onClick={() => {
                              setCronJobsLoading(true);
                              settingsService.getCronJobLatest().then(d => { setCronJobLatest(d); setCronJobsLoading(false); }).catch(() => setCronJobsLoading(false));
                            }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: '#ea6c00' }}
                          >
                            {cronJobsLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                            Atualizar
                          </button>
                        </div>
                        <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>
                          Última execução de cada edge function agendada. Horário/frequência gerenciados no painel do Supabase.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {KNOWN_CRON_JOBS.map(job => {
                            const log = cronJobLatest.find(l => l.job_name === job.key);
                            const statusIcon = !log ? null
                              : log.status === 'success' ? <CheckCircle2 size={14} style={{ color: '#16a34a', flexShrink: 0 }} />
                              : log.status === 'failed'  ? <XCircle      size={14} style={{ color: '#dc2626', flexShrink: 0 }} />
                              : log.status === 'running' ? <Loader2      size={14} className="animate-spin" style={{ color: '#ea6c00', flexShrink: 0 }} />
                              : <Clock size={14} style={{ color: '#9ca3af', flexShrink: 0 }} />;
                            const lastRunLabel = log?.last_run_at
                              ? new Date(log.last_run_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
                              : 'Nunca executado';
                            return (
                              <div key={job.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px 12px', background: '#fff', border: '1px solid rgba(15,23,42,0.08)', borderRadius: '8px' }}>
                                <RefreshCw size={15} style={{ color: '#ff8a00', flexShrink: 0, marginTop: '2px' }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ fontSize: '13px', fontWeight: 600, color: '#111827', margin: 0 }}>{job.label}</p>
                                  <p style={{ fontSize: '11.5px', color: '#6b7280', margin: '2px 0 0' }}>{job.description}</p>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                                    {statusIcon}
                                    <span style={{ fontSize: '10.5px', color: log?.status === 'failed' ? '#dc2626' : '#9ca3af' }}>
                                      {lastRunLabel}
                                      {log?.duration_ms != null && ` · ${log.duration_ms}ms`}
                                    </span>
                                  </div>
                                  {log?.error && (
                                    <p style={{ fontSize: '10.5px', color: '#dc2626', margin: '2px 0 0', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.error}>
                                      {log.error}
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                    </div>
                )}

                {/* ─── Cofre de Chaves ─── */}
                {activeSection === 'secrets' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                    <div className="settings-card">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <p className="settings-card-title" style={{ margin: 0 }}>Cofre de Chaves & Segredos</p>
                        <button
                          className="settings-btn-ghost"
                          style={{ fontSize: '11.5px', padding: '4px 12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                          onClick={handleVerifySecrets}
                          disabled={verifyingSecrets || secretsLoading || secrets.length === 0}
                          title="Verifica se as variáveis de ambiente estão configuradas no servidor"
                        >
                          {verifyingSecrets ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          Verificar tudo
                        </button>
                      </div>
                      <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
                        Registro de chaves de API e segredos do sistema. As chaves reais ficam nas variáveis de ambiente; aqui é apenas o inventário de status.
                      </p>
                      {secretsLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                          <Loader2 size={20} className="animate-spin" style={{ color: '#ea6c00' }} />
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {secrets.map(s => {
                            const statusColor = s.status === 'configured' ? '#16a34a'
                              : s.status === 'error' ? '#dc2626'
                              : s.status === 'revoked' ? '#6b7280'
                              : '#d97706';
                            const statusLabel = s.status === 'configured' ? 'Configurado'
                              : s.status === 'error' ? 'Erro'
                              : s.status === 'revoked' ? 'Revogado'
                              : 'Não configurado';
                            return (
                              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', background: '#fff', border: '1px solid rgba(15,23,42,0.08)', borderRadius: '8px' }}>
                                <Key size={14} style={{ color: '#ea6c00', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ fontSize: '13px', fontWeight: 600, color: '#111827', margin: 0 }}>{s.key_name}</p>
                                  {s.description && <p style={{ fontSize: '11.5px', color: '#6b7280', margin: '1px 0 0' }}>{s.description}</p>}
                                  {s.env_var_name && <p style={{ fontSize: '10.5px', color: '#9ca3af', margin: '1px 0 0', fontFamily: 'monospace' }}>{s.env_var_name}</p>}
                                </div>
                                <span style={{ fontSize: '10px', fontWeight: 600, color: statusColor, background: `${statusColor}18`, border: `1px solid ${statusColor}44`, borderRadius: '4px', padding: '2px 8px', flexShrink: 0 }}>{statusLabel}</span>
                                <select
                                  style={{ fontSize: '11.5px', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '3px 6px', color: '#374151', background: '#fff' }}
                                  value={s.status}
                                  onChange={async e => {
                                    const newStatus = e.target.value as SecretEntry['status'];
                                      const persisted = await runWithSettingsPin(
                                        {
                                          action: 'update_secret_status',
                                          title: 'Alterar status da chave',
                                          description: 'Confirme com seu PIN para alterar o status da chave registrada.',
                                          resourceType: 'secret_registry',
                                          resourceId: s.id,
                                        },
                                        () => settingsService.updateSecretStatus(s.id, newStatus),
                                      );
                                      if (!persisted) return;
                                      setSecrets(prev => prev.map(x => x.id === s.id ? { ...x, status: newStatus } : x));
                                  }}
                                >
                                  <option value="configured">Configurado</option>
                                  <option value="unconfigured">Não configurado</option>
                                  <option value="error">Erro</option>
                                  <option value="revoked">Revogado</option>
                                </select>
                              </div>
                            );
                          })}
                          {secrets.length === 0 && <p style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center', padding: '16px 0' }}>Nenhum segredo registrado.</p>}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ─── Feriados ─── */}
                {activeSection === 'holidays' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                    <div className="settings-card">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <p className="settings-card-title" style={{ margin: 0 }}>Calendário de Feriados</p>
                        <button
                          className="settings-btn-primary"
                          style={{ fontSize: '11.5px', padding: '5px 12px' }}
                          onClick={() => { setHolidayForm({ date: '', name: '', type: 'nacional', state: '', city: '' }); setHolidayFormOpen(true); }}
                        >
                          <Plus size={13} /> Adicionar
                        </button>
                      </div>
                      <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>
                        Feriados são usados para cálculo de dias úteis em prazos e na IA. Feriados nacionais 2025–2027 pré-carregados.
                      </p>
                      {holidaysLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                          <Loader2 size={20} className="animate-spin" style={{ color: '#ea6c00' }} />
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {holidays.length === 0 && <p style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center', padding: '16px 0' }}>Nenhum feriado cadastrado.</p>}
                          {holidays.map(h => (
                            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', background: '#fff', border: '1px solid rgba(15,23,42,0.07)', borderRadius: '7px' }}>
                              <Calendar size={13} style={{ color: '#ea6c00', flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>{h.name}</span>
                                <span style={{ fontSize: '11px', color: '#9ca3af', marginLeft: '8px' }}>{new Date(h.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                                {h.state && <span style={{ fontSize: '11px', color: '#6b7280', marginLeft: '6px' }}>· {h.state}{h.city ? `/${h.city}` : ''}</span>}
                              </div>
                              <span style={{ fontSize: '10px', color: '#ea6c00', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '4px', padding: '1px 6px', flexShrink: 0 }}>{h.type}</span>
                              <button
                                onClick={async () => {
                                  const persisted = await runWithSettingsPin(
                                    {
                                      action: 'delete_holiday',
                                      title: 'Remover feriado',
                                      description: 'Confirme com seu PIN para remover este feriado.',
                                      resourceType: 'holiday',
                                      resourceId: h.id,
                                    },
                                    () => settingsService.deleteHoliday(h.id),
                                  );
                                  if (!persisted) return;
                                  setHolidays(prev => prev.filter(x => x.id !== h.id));
                                }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#dc2626', flexShrink: 0 }}
                                title="Remover"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Formulário inline de novo feriado */}
                    {holidayFormOpen && (
                      <div className="settings-card" style={{ border: '1px solid #fed7aa' }}>
                        <p className="settings-card-title" style={{ marginBottom: '12px' }}>Novo Feriado</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          <div>
                            <label className="settings-label">Data *</label>
                            <input type="date" className="settings-input" value={holidayForm.date} onChange={e => setHolidayForm(p => ({ ...p, date: e.target.value }))} />
                          </div>
                          <div>
                            <label className="settings-label">Nome *</label>
                            <input className="settings-input" placeholder="Ex: Carnaval" value={holidayForm.name} onChange={e => setHolidayForm(p => ({ ...p, name: e.target.value }))} />
                          </div>
                          <div>
                            <label className="settings-label">Tipo</label>
                            <select className="settings-select" value={holidayForm.type} onChange={e => setHolidayForm(p => ({ ...p, type: e.target.value as Holiday['type'] }))}>
                              <option value="nacional">Nacional</option>
                              <option value="estadual">Estadual</option>
                              <option value="municipal">Municipal</option>
                              <option value="facultativo">Facultativo</option>
                            </select>
                          </div>
                          <div>
                            <label className="settings-label">Estado (UF)</label>
                            <input className="settings-input" placeholder="Ex: MT" maxLength={2} value={holidayForm.state} onChange={e => setHolidayForm(p => ({ ...p, state: e.target.value.toUpperCase() }))} />
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
                          <button className="settings-btn-ghost" onClick={() => setHolidayFormOpen(false)}>Cancelar</button>
                          <button className="settings-btn-primary" onClick={async () => {
                            if (!holidayForm.date || !holidayForm.name.trim()) {
                              setFeedback('error', 'Data e nome são obrigatórios.'); return;
                            }
                            const persisted = await runWithSettingsPin(
                              {
                                action: 'upsert_holiday',
                                title: 'Salvar feriado',
                                description: 'Confirme com seu PIN para salvar este feriado.',
                                resourceType: 'holiday',
                                resourceId: holidayForm.date,
                              },
                              () => settingsService.upsertHoliday({
                                date: holidayForm.date,
                                name: holidayForm.name.trim(),
                                type: holidayForm.type,
                                state: holidayForm.state.trim() || null,
                                city: holidayForm.city?.trim() || null,
                                is_active: true,
                              }),
                            );
                            if (!persisted) return;
                            const updated = await settingsService.getHolidays();
                            setHolidays(updated);
                            setHolidayFormOpen(false);
                            setFeedback('success', 'Feriado adicionado!');
                          }}>
                            <Save size={13} /> Salvar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                </div>
                )}

            </div>
          )}
        </div>
      </div>
  );

  // Modais auxiliares — usam portal próprio (zIndex 100); válidos nos dois modos
  const settingsModals = (
    <>
      {/* Modal de regra de notificação */}
      <Modal
        open={ruleModal.open}
        onClose={() => setRuleModal({ open: false, rule: null })}
        title={ruleModal.rule ? 'Editar Regra' : 'Nova Regra'}
        eyebrow="Notificações"
        size="md"
        zIndex={100}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '12px 24px' }}>
            <button className="settings-btn-ghost" onClick={() => setRuleModal({ open: false, rule: null })}>Cancelar</button>
            <button className="settings-btn-primary" onClick={async () => {
              if (!ruleForm.name?.trim() || !ruleForm.trigger || !ruleForm.channels?.length) {
                setFeedback('error', 'Preencha nome, gatilho e ao menos um canal.'); return;
              }
              const rule = ruleForm as NotificationRule;
              const updated = ruleModal.rule
                ? notifRules.map(r => r.id === rule.id ? rule : r)
                : [...notifRules, { ...rule, id: Date.now().toString() }];
              setNotifRules(updated);
              const persisted = await runWithSettingsPin(
                {
                  action: 'update_notification_rules',
                  title: 'Salvar regra de notificação',
                  description: 'Confirme com seu PIN para salvar a regra de notificação.',
                  resourceType: 'notification_rules',
                },
                () => settingsService.updateNotificationRules(updated, currentProfile?.name),
              );
              if (!persisted) return;
              setRuleModal({ open: false, rule: null });
              setFeedback('success', 'Regra salva!');
            }}>
              <Save size={13} /> Salvar
            </button>
          </div>
        }
      >
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 0' }}>
            <div>
              <label className="settings-label">Nome da regra *</label>
              <input className="settings-input" placeholder="Ex: Prazo vencendo"
                value={ruleForm.name || ''}
                onChange={e => setRuleForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="settings-label">Gatilho *</label>
              <select className="settings-select"
                value={ruleForm.trigger || 'deadline_due'}
                onChange={e => setRuleForm(p => ({ ...p, trigger: e.target.value }))}>
                {NOTIFICATION_TRIGGERS.map(t => (
                  <option key={t.key} value={t.key}>{t.group} — {t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="settings-label">Canais de envio *</label>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                {(['email', 'push', 'whatsapp'] as NotificationChannel[]).map(ch => {
                  const labels: Record<NotificationChannel, string> = { email: '✉️ E-mail', push: '🔔 Push', whatsapp: '💬 WhatsApp' };
                  const active = (ruleForm.channels || []).includes(ch);
                  return (
                    <button key={ch} type="button"
                      onClick={() => {
                        const cur = ruleForm.channels || [];
                        setRuleForm(p => ({ ...p, channels: active ? cur.filter(c => c !== ch) : [...cur, ch] }));
                      }}
                      style={{
                        padding: '6px 12px', borderRadius: '8px', border: `1.5px solid ${active ? '#ff8a00' : 'rgba(15,23,42,0.12)'}`,
                        background: active ? 'rgba(255,138,0,0.07)' : '#fff', cursor: 'pointer',
                        fontSize: '12.5px', fontWeight: active ? 600 : 400, color: active ? '#c45c00' : '#555',
                      }}>{labels[ch]}</button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="settings-label">Destinatários</label>
              <select className="settings-select"
                value={ruleForm.recipients || 'responsible'}
                onChange={e => setRuleForm(p => ({ ...p, recipients: e.target.value as any }))}>
                <option value="responsible">Responsável pelo item</option>
                <option value="admin">Administrador</option>
                <option value="all_lawyers">Todos os advogados</option>
                <option value="specific_role">Papel específico</option>
              </select>
            </div>
            <div className="settings-row-item">
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#191c1e' }}>Respeitar horário comercial</p>
                <p style={{ fontSize: '11.5px', color: '#747878' }}>Não enviar fora do horário definido nas Preferências.</p>
              </div>
              <button
                className={`settings-toggle${ruleForm.respect_business_hours ? ' on' : ''}`}
                onClick={() => setRuleForm(p => ({ ...p, respect_business_hours: !p.respect_business_hours }))}
                aria-label="toggle" />
            </div>
          </div>
        </ModalBody>
      </Modal>

      <Modal
        open={userModalOpen}
        onClose={() => setUserModalOpen(false)}
        title={selectedUser ? 'Editar usuário' : 'Novo usuário'}
        eyebrow="Formulário"
        size="lg"
        zIndex={100}
        footer={
          <div className="flex justify-end gap-3">
            <button className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500" onClick={() => setUserModalOpen(false)}>Cancelar</button>
            <button onClick={handleUserSave} disabled={saving || !selectedUser} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar mudanças
            </button>
          </div>
        }
      >
        <ModalBody className="p-8 space-y-5">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <img
                    src={avatarPreview || selectedUser?.avatar_url || 'https://api.dicebear.com/7.x/initials/svg?seed=' + userFormData.name}
                    alt={userFormData.name}
                    className="h-20 w-20 rounded-full object-cover border border-[#e7e5df]"
                  />
                  <label className="absolute -bottom-1 -right-1 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-amber-500 text-white shadow-lg">
                    {avatarUploading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Camera className="w-4 h-4" />
                    )}
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file && selectedUser) {
                          handleAvatarUpload(file);
                        }
                      }}
                    />
                  </label>
                </div>
                <div className="text-xs text-slate-500">
                  Foto armazenada no Supabase Storage com cache público otimizado.
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500">Nome completo *</label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                    value={userFormData.name}
                    onChange={(e) => setUserFormData((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">Email *</label>
                  <input
                    type="email"
                    disabled
                    className="mt-1 w-full rounded-lg border border-[#e7e5df] bg-slate-50 px-3 py-2 text-sm text-slate-500 cursor-not-allowed"
                    value={userFormData.email}
                    onChange={(e) => setUserFormData((prev) => ({ ...prev, email: e.target.value }))}
                  />
                  <p className="text-[11px] text-slate-400">O email é definido pelo convite do Supabase.</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">Papel *</label>
                  <select
                    className="mt-1 w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                    value={userFormData.role}
                    onChange={(e) => setUserFormData((prev) => ({ ...prev, role: e.target.value }))}
                  >
                    {ROLES.map((role) => (
                      <option key={role.key} value={role.key}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">CPF</label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                    value={userFormData.cpf}
                    onChange={(e) => setUserFormData((prev) => ({ ...prev, cpf: formatCpf(e.target.value) }))}
                    placeholder="000.000.000-00"
                    maxLength={14}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">Telefone</label>
                  <input
                    type="tel"
                    className="mt-1 w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                    value={userFormData.phone}
                    onChange={(e) => setUserFormData((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">OAB</label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                    value={userFormData.oab}
                    onChange={(e) => setUserFormData((prev) => ({ ...prev, oab: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">Nome completo no DJEN</label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-[#e7e5df] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                    value={userFormData.lawyer_full_name}
                    onChange={(e) => setUserFormData((prev) => ({ ...prev, lawyer_full_name: e.target.value }))}
                  />
                </div>
              </div>
        </ModalBody>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Remover usuário"
        size="sm"
        zIndex={100}
        footer={
          <div className="flex justify-end gap-3">
            <button className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500" onClick={() => setDeleteTarget(null)}>Cancelar</button>
            <button onClick={confirmDeleteUser} disabled={deleteLoading} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
              {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Remover
            </button>
          </div>
        }
      >
        <ModalBody>
          {deleteTarget && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Essa ação remove o perfil do CRM. A conta Supabase permanecerá ativa até ser removida pelo painel de autenticação.
              </p>
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                <p><strong>{deleteTarget.name}</strong></p>
                <p className="text-xs text-slate-400">{deleteTarget.email}</p>
              </div>
            </div>
          )}
        </ModalBody>
      </Modal>
    </>
  );

  // ── Hub / Visão geral — tela inicial calma com cards por categoria ──
  const hubSearchActive = navSearch.trim().length > 0;
  const hubResults = hubSearchActive
    ? allSectionItems.filter(s => matchesNormalizedSearch(navSearch, [s.label, s.description]))
    : [];
  const sectionBadge = (key: SettingsSection) => {
    if (key === 'access_requests' && pendingAccessCount > 0) {
      return <span style={{ minWidth: '18px', height: '18px', padding: '0 5px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '999px', background: '#ff8a00', color: '#fff', fontSize: '10px', fontWeight: 700 }}>{pendingAccessCount}</span>;
    }
    const st = SECTION_STATUS[key];
    if (st) {
      return <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px', background: st === 'parcial' ? '#fef9c3' : '#fee2e2', color: st === 'parcial' ? '#854d0e' : '#991b1b' }}>{st === 'parcial' ? 'Parcial' : 'Pendente'}</span>;
    }
    return null;
  };

  const totalSections = SETTINGS_GROUPS.reduce((n, g) => n + g.items.length, 0);

  const renderHubTile = (
    item: { key: SettingsSection; label: string; icon: React.ComponentType<any>; description: string },
    onPick: () => void,
  ) => (
    <button
      key={item.key}
      onClick={onPick}
      className="settings-hub-tile"
      style={{
        display: 'flex', flexDirection: 'column', gap: '11px', width: '100%', textAlign: 'left',
        padding: '16px 16px 15px', borderRadius: '14px', border: '1px solid rgba(15,23,42,0.08)',
        background: '#fff', cursor: 'pointer', minHeight: '112px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <span
          className="settings-hub-tile-icon"
          style={{ width: '40px', height: '40px', borderRadius: '11px', background: '#fff6ec', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#ea6c00' }}
        >
          <item.icon style={{ width: '19px', height: '19px' }} />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {sectionBadge(item.key)}
        </span>
      </div>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: '14px', fontWeight: 650, color: '#1f2430', lineHeight: 1.25, marginBottom: '3px' }}>{item.label}</span>
        <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: '12.5px', color: '#9aa0a8', lineHeight: 1.4 }}>{item.description}</span>
      </span>
      <ChevronRight
        className="settings-hub-tile-arrow"
        style={{ position: 'absolute', right: '14px', bottom: '14px', width: '16px', height: '16px', color: '#ea6c00', opacity: 0, transform: 'translateX(-4px)' }}
      />
    </button>
  );

  const hubView = (
    <div className="settings-scroll" style={{ flex: '1 1 auto', minHeight: 0 }}>
      <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '40px 44px 64px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {/* Cabeçalho do hub */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#ea6c00', marginBottom: '8px' }}>Sistema</p>
            <h1 style={{ fontSize: '28px', fontWeight: 750, color: '#0f1420', lineHeight: 1.15, letterSpacing: '-0.025em' }}>Configurações</h1>
            <p style={{ fontSize: '14px', color: '#9aa0a8', marginTop: '7px', maxWidth: '520px' }}>Escolha uma área para configurar o sistema, ou busque pela seção desejada.</p>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', fontWeight: 600, color: '#6b7280', background: '#f6f7f9', border: '1px solid rgba(15,23,42,0.07)', padding: '7px 13px', borderRadius: '999px', whiteSpace: 'nowrap' }}>
            <Layers style={{ width: '14px', height: '14px', color: '#ea6c00' }} />
            {totalSections} seções
          </span>
        </div>

        {/* Busca grande */}
        <div style={{ position: 'relative', maxWidth: '640px' }}>
          <Search style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', width: '18px', height: '18px', color: '#b0b5bc', pointerEvents: 'none' }} />
          <input
            type="text"
            autoFocus
            value={navSearch}
            onChange={e => setNavSearch(e.target.value)}
            placeholder="Buscar configuração… (ex.: WhatsApp, prazos, permissões)"
            style={{ width: '100%', paddingLeft: '46px', paddingRight: '40px', paddingTop: '14px', paddingBottom: '14px', fontSize: '14.5px', background: '#fff', border: '1px solid rgba(15,23,42,0.13)', borderRadius: '13px', color: '#191c1e', outline: 'none', boxSizing: 'border-box', boxShadow: '0 1px 2px rgba(15,23,42,0.03)', transition: 'border-color .15s, box-shadow .15s' }}
            onFocus={e => { e.currentTarget.style.borderColor = '#ff8a00'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(255,138,0,0.12)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(15,23,42,0.13)'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,23,42,0.03)'; }}
          />
          {hubSearchActive && (
            <button
              onClick={() => setNavSearch('')}
              aria-label="Limpar busca"
              style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', width: '24px', height: '24px', borderRadius: '50%', border: 'none', background: '#f1f2f4', color: '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X style={{ width: '13px', height: '13px' }} />
            </button>
          )}
        </div>

        {/* Resultados da busca OU grid de grupos */}
        {hubSearchActive ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ fontSize: '12px', fontWeight: 600, color: '#9aa0a8' }}>
              {hubResults.length === 0
                ? `Nenhuma seção encontrada para “${navSearch}”.`
                : `${hubResults.length} ${hubResults.length === 1 ? 'resultado' : 'resultados'} para “${navSearch}”`}
            </p>
            {hubResults.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '14px' }}>
                {hubResults.map(item => renderHubTile(item, () => { setActiveSection(item.key); setNavSearch(''); }))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '34px' }}>
            {SETTINGS_GROUPS.map((group, gi) => (
              <div key={group.key} className="settings-hub-group" style={{ animationDelay: `${gi * 50}ms` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                  <span style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#fff6ec', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <group.icon style={{ width: '15px', height: '15px', color: '#ea6c00' }} />
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#374151' }}>{group.label}</span>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#b0b5bc' }}>{group.items.length}</span>
                  <span style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, rgba(15,23,42,0.08), transparent)' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '14px' }}>
                  {group.items.map(item => renderHubTile(item, () => setActiveSection(item.key)))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ── Menu lateral (modo página) ──
  const attentionItems = allSectionItems.filter(
    i => SECTION_STATUS[i.key] || (i.key === 'access_requests' && pendingAccessCount > 0),
  );

  const sidebarNav = (
    <aside
      className="settings-scroll"
      style={{ width: '276px', flexShrink: 0, height: '100%', display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(15,23,42,0.07)', background: '#fbfbfc', overflowY: 'auto' }}
    >
      <div style={{ padding: '22px 20px 14px' }}>
        <p style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#ea6c00', marginBottom: '5px' }}>Sistema</p>
        <h2 style={{ fontSize: '18px', fontWeight: 750, color: '#0f1420', letterSpacing: '-0.02em' }}>Configurações</h2>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <div style={{ position: 'relative' }}>
          <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', width: '15px', height: '15px', color: '#b0b5bc', pointerEvents: 'none' }} />
          <input
            type="text"
            value={navSearch}
            onChange={e => setNavSearch(e.target.value)}
            placeholder="Buscar…"
            style={{ width: '100%', paddingLeft: '34px', paddingRight: navSearch ? '30px' : '12px', paddingTop: '9px', paddingBottom: '9px', fontSize: '13px', background: '#fff', border: '1px solid rgba(15,23,42,0.12)', borderRadius: '10px', color: '#191c1e', outline: 'none', boxSizing: 'border-box', transition: 'border-color .15s, box-shadow .15s' }}
            onFocus={e => { e.currentTarget.style.borderColor = '#ff8a00'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(255,138,0,0.10)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(15,23,42,0.12)'; e.currentTarget.style.boxShadow = 'none'; }}
          />
          {navSearch && (
            <button
              onClick={() => setNavSearch('')}
              aria-label="Limpar"
              style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', width: '20px', height: '20px', borderRadius: '50%', border: 'none', background: '#f1f2f4', color: '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X style={{ width: '12px', height: '12px' }} />
            </button>
          )}
        </div>
      </div>

      <nav style={{ padding: '2px 12px 24px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {hubSearchActive ? (
          hubResults.length === 0 ? (
            <p style={{ padding: '14px 10px', fontSize: '12.5px', color: '#9aa0a8' }}>Nada encontrado.</p>
          ) : (
            hubResults.map(item => {
              const active = activeSection === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setActiveSection(item.key)}
                  className={`settings-nav-item${active ? ' settings-nav-item-active' : ''}`}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '9px 11px', borderRadius: '9px', border: 'none', background: 'transparent', cursor: 'pointer' }}
                >
                  <item.icon style={{ width: '15px', height: '15px', color: active ? '#ea6c00' : '#9aa0a8', flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: active ? 600 : 500, color: active ? '#b35600' : '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                  {sectionBadge(item.key)}
                </button>
              );
            })
          )
        ) : (
          SETTINGS_GROUPS.map(group => {
            const open = expandedGroups[group.key];
            return (
              <div key={group.key} style={{ marginBottom: '2px' }}>
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="settings-nav-group-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '9px', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: '8px', border: 'none', background: 'transparent', cursor: 'pointer' }}
                >
                  <group.icon style={{ width: '14px', height: '14px', color: '#ea6c00', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#6b7280' }}>{group.label}</span>
                  <span style={{ fontSize: '10.5px', fontWeight: 600, color: '#c0c5cc' }}>{group.items.length}</span>
                  <ChevronDown style={{ width: '14px', height: '14px', color: '#b0b5bc', flexShrink: 0, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .15s ease' }} />
                </button>
                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '2px', paddingLeft: '3px' }}>
                    {group.items.map(item => {
                      const active = activeSection === item.key;
                      return (
                        <button
                          key={item.key}
                          onClick={() => setActiveSection(item.key)}
                          className={`settings-nav-item${active ? ' settings-nav-item-active' : ''}`}
                          style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '8px 11px', borderRadius: '9px', border: 'none', borderLeft: active ? '2px solid #ea6c00' : '2px solid transparent', background: 'transparent', cursor: 'pointer' }}
                        >
                          <item.icon style={{ width: '15px', height: '15px', color: active ? '#ea6c00' : '#9aa0a8', flexShrink: 0 }} />
                          <span style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: active ? 600 : 500, color: active ? '#b35600' : '#3a4150', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                          {sectionBadge(item.key)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </nav>
    </aside>
  );

  const overviewWelcome = (
    <div className="settings-scroll" style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ margin: 'auto', maxWidth: '520px', padding: '48px 40px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
        <span style={{ width: '64px', height: '64px', borderRadius: '18px', background: '#fff6ec', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Settings style={{ width: '30px', height: '30px', color: '#ea6c00' }} />
        </span>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 750, color: '#0f1420', letterSpacing: '-0.02em', marginBottom: '8px' }}>Configurações do sistema</h1>
          <p style={{ fontSize: '14px', color: '#9aa0a8', lineHeight: 1.5 }}>Escolha uma área no menu à esquerda para começar, ou use a busca para ir direto à seção desejada.</p>
        </div>
        {attentionItems.length > 0 && (
          <div style={{ width: '100%', marginTop: '8px', textAlign: 'left' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#b0b5bc', marginBottom: '10px', textAlign: 'center' }}>Requer atenção</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
              {attentionItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => setActiveSection(item.key)}
                  className="settings-hub-row"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '10px', border: '1px solid rgba(15,23,42,0.09)', background: '#fff', cursor: 'pointer' }}
                >
                  <item.icon style={{ width: '14px', height: '14px', color: '#ea6c00' }} />
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#374151' }}>{item.label}</span>
                  {sectionBadge(item.key)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Conteúdo principal: hub na visão geral, layout 2 colunas numa seção
  const mainContent = activeSection === 'overview' ? hubView : settingsBody;

  // ── Modo página: ocupa o módulo inteiro, sem overlay/modal ──
  if (variant === 'page') {
    return (
      <>
        <style>{cssStyles}</style>
        <div
          className="relative flex overflow-hidden"
          style={{
            height: '100%',
            minHeight: 0,
            width: '100%',
            background: '#ffffff',
            border: '1px solid rgba(15,23,42,0.07)',
            borderRadius: '16px',
            boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
          }}
        >
          {sidebarNav}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {activeSection === 'overview' ? overviewWelcome : settingsBody}
          </div>
        </div>
        {settingsModals}
      </>
    );
  }

  // ── Modo modal (fallback) ──
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <style>{cssStyles}</style>
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center"
            style={{ padding: '24px', background: 'rgba(0,0,0,0.38)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            onClick={onClose}
          >
            {/* Modal card */}
            <motion.div
              className="relative flex overflow-hidden"
              style={{
                width: 'min(1180px, calc(100vw - 48px))',
                height: 'min(860px, calc(100vh - 48px))',
                minHeight: '560px',
                background: '#ffffff',
                border: '1px solid rgba(0,0,0,0.09)',
                borderRadius: '16px',
                boxShadow: '0 32px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.03)',
              }}
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.20, ease: [0.22, 0.68, 0, 1.2] }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* X — canto superior direito */}
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fechar"
                  style={{ position: 'absolute', top: 14, right: 14, zIndex: 10, width: '30px', height: '30px',
                    borderRadius: '50%', border: '1px solid rgba(15,23,42,0.10)', background: 'transparent',
                    color: '#747878', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background .12s ease, border-color .12s ease, color .12s ease' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f2f4f6'; e.currentTarget.style.borderColor = 'rgba(15,23,42,0.20)'; e.currentTarget.style.color = '#191c1e'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(15,23,42,0.10)'; e.currentTarget.style.color = '#747878'; }}
                >
                  <X size={16} />
                </button>
              )}
              {mainContent}
            </motion.div>
          </div>
          {settingsModals}
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default SettingsModule;
