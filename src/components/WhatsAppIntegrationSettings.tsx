import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Save, Loader2, Eye, EyeOff, Plus, Trash2, QrCode, Check, Users, X, Phone,
  Clock, BellOff, Bot, Pencil, MessageSquare, IdCard, TimerOff,
} from 'lucide-react';
import {
  settingsService,
  WHATSAPP_EVOLUTION_DEFAULTS,
  WHATSAPP_MODULE_DEFAULTS,
  type WhatsAppEvolutionConfig,
  type WhatsAppChannelDepartmentRouting,
  type WhatsAppModuleConfig,
} from '../services/settings.service';
import { whatsappService, DEFAULT_AGENT_PREFS, type StaffOption, type AgentPrefs } from '../services/whatsapp.service';
import { useAuth } from '../contexts/AuthContext';
import { agentLabel, agentRoleLabel } from './whatsapp/format';
import type {
  WhatsAppChannel, WhatsAppDepartment, WhatsAppTemplate, WhatsAppBusinessHoursRow,
} from '../types/whatsapp.types';
import { alwaysOpenRows, isAlwaysOpen } from './whatsapp/businessTime';
import { useWaEscopo } from './whatsapp/hooks/useWaPermissions';
import { podeConfigurarIa } from '../services/whatsapp/waPermissions';
import ChannelAccessManager from './whatsapp/ChannelAccessManager';
import ChannelFunnelManager from './whatsapp/ChannelFunnelManager';
import AiAssistantsPanel from './whatsapp/aiAssistantsPanel';

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

const BR_TIMEZONES = [
  { label: 'Cuiabá / Manaus (MT, AM, RO, RR) — UTC-4', value: 'America/Cuiaba' },
  { label: 'Brasília / São Paulo (GMT-3)', value: 'America/Sao_Paulo' },
  { label: 'Manaus — UTC-4 sem horário de verão', value: 'America/Manaus' },
  { label: 'Rio Branco (AC) — UTC-5', value: 'America/Rio_Branco' },
  { label: 'Fernando de Noronha — UTC-2', value: 'America/Noronha' },
];

const PALETTE = ['#ea6c00', '#16a34a', '#2563eb', '#9333ea', '#dc2626', '#0891b2', '#ca8a04', '#db2777'];

// Prazos de inatividade oferecidos. Lista fechada em vez de campo livre porque
// o valor não é uma preferência fina — é "algumas horas", "um dia", "uma
// semana" — e um campo livre convida ao 1 minuto que encerraria a fila inteira
// no primeiro varrimento. Os limites são os mesmos do CHECK da tabela.
const AUTO_CLOSE_PRESETS = [
  { label: '30 minutos', value: 30 },
  { label: '1 hora', value: 60 },
  { label: '2 horas', value: 120 },
  { label: '4 horas', value: 240 },
  { label: '8 horas', value: 480 },
  { label: '12 horas', value: 720 },
  { label: '24 horas', value: 1440 },
  { label: '2 dias', value: 2880 },
  { label: '3 dias', value: 4320 },
  { label: '7 dias', value: 10080 },
  { label: '15 dias', value: 21600 },
  { label: '30 dias', value: 43200 },
];

interface Props {
  requirePin: (opts: any) => Promise<boolean>;
  userName?: string;
  onFeedback: (type: 'error' | 'success', msg: string) => void;
}

type WhatsAppSettingsSection =
  | 'connection'
  | 'identity'
  | 'channels'
  | 'departments'
  | 'copies'
  | 'templates'
  | 'agents';

interface WhatsAppSettingsGroup {
  label: string;
  description: string;
  items: Array<{
    key: WhatsAppSettingsSection;
    label: string;
    summary: string;
    icon: React.ComponentType<{ size?: number }>;
  }>;
}

const statusColor = (s: string) => s === 'connected' ? '#16a34a' : s === 'connecting' ? '#f59e0b' : '#9ca3af';
const statusLabel = (s: string) => s === 'connected' ? 'Conectado' : s === 'connecting' ? 'Conectando…' : 'Desconectado';

const WhatsAppIntegrationSettings: React.FC<Props> = ({ requirePin, userName, onFeedback }) => {
  const { user } = useAuth();
  // Quem é esta pessoa segundo o BANCO (`wa_is_admin`, que também exige
  // `is_active`) — e não segundo o cargo escrito no perfil. É a mesma resposta
  // que o módulo do WhatsApp usa, e a mesma que as policies aplicam.
  const escopo = useWaEscopo();
  const [server, setServer] = useState<WhatsAppEvolutionConfig>({ ...WHATSAPP_EVOLUTION_DEFAULTS });
  const [showKey, setShowKey] = useState(false);
  const [savingServer, setSavingServer] = useState(false);

  const [channels, setChannels] = useState<WhatsAppChannel[]>([]);
  const [departments, setDepartments] = useState<WhatsAppDepartment[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [copyConfig, setCopyConfig] = useState<WhatsAppModuleConfig>({ ...WHATSAPP_MODULE_DEFAULTS });
  const [channelRouting, setChannelRouting] = useState<WhatsAppChannelDepartmentRouting[]>([]);
  const [newTpl, setNewTpl] = useState({ name: '', category: '', body: '' });
  const [editingTplId, setEditingTplId] = useState<string | null>(null);
  const [tplDraft, setTplDraft] = useState({ name: '', category: '', body: '' });
  const [addingTpl, setAddingTpl] = useState(false);
  const [savingTplId, setSavingTplId] = useState<string | null>(null);
  const [savingCopy, setSavingCopy] = useState(false);
  const [savingRouting, setSavingRouting] = useState(false);
  // Identidade de atendimento do usuário logado (assinatura das mensagens).
  const [agentPrefs, setAgentPrefs] = useState<AgentPrefs>(DEFAULT_AGENT_PREFS);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [activeSection, setActiveSection] = useState<WhatsAppSettingsSection>('connection');
  // Acessos, funis e roteamento são propriedades DO canal — moram aqui dentro,
  // não como itens soltos no menu lateral.
  const [activeChannelSection, setActiveChannelSection] =
    useState<'list' | 'access' | 'funnels' | 'routing' | 'new'>('list');
  const [loading, setLoading] = useState(true);

  // formulário de canal
  const [newCh, setNewCh] = useState({ name: '', instance_name: '', phone_number: '', color: PALETTE[0] });
  const [addingCh, setAddingCh] = useState(false);

  // Fase N: horários, ausência e timezone por canal
  const [hoursOpenFor, setHoursOpenFor] = useState<string | null>(null);
  const [hoursData, setHoursData] = useState<WhatsAppBusinessHoursRow[]>([]);
  const [absence, setAbsence] = useState({ message: '', enabled: false, timezone: 'America/Cuiaba' });
  const [savingHours, setSavingHours] = useState(false);
  // Agenda de antes de ligar o 24h. Desligar o plantão devolve o horário que
  // estava na tela; sem isso, um clique errado apaga a jornada inteira e a
  // pessoa tem de redigitar sete dias para voltar ao que era.
  const hoursBefore24h = useRef<WhatsAppBusinessHoursRow[] | null>(null);
  // Encerramento automático por inatividade: painel PRÓPRIO, não um rodapé do
  // horário comercial. São decisões de naturezas diferentes — uma diz quando o
  // escritório atende, a outra desiste de um atendimento — e quem mexe numa
  // quase nunca quer mexer na outra.
  const [autoCloseOpenFor, setAutoCloseOpenFor] = useState<string | null>(null);
  const [autoClose, setAutoClose] = useState({
    enabled: false, minutes: 1440, message: '', businessHoursOnly: true,
  });
  const [savingAutoClose, setSavingAutoClose] = useState(false);
  // QR / conexão por canal
  const [qrFor, setQrFor] = useState<{ id: string; qr?: string; status: string } | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [savingDefaultAssigneeFor, setSavingDefaultAssigneeFor] = useState<string | null>(null);

  // formulário de departamento
  const [newDept, setNewDept] = useState({ name: '', color: PALETTE[1] });
  const [addingDept, setAddingDept] = useState(false);
  // membros (canal ou departamento — mesmo editor)
  const [editMembersFor, setEditMembersFor] = useState<{ id: string } | null>(null);
  const [memberSel, setMemberSel] = useState<Set<string>>(new Set());
  const [savingMembers, setSavingMembers] = useState(false);

  const reload = async () => {
    try {
      const [cfg, copyCfg, routingCfg, chs, depts, st, tpls, prefs] = await Promise.all([
        settingsService.getWhatsAppEvolutionConfig(),
        settingsService.getWhatsAppModuleConfig(),
        settingsService.getWhatsAppChannelDepartmentRouting(),
        whatsappService.listChannels(),
        whatsappService.listDepartments(),
        whatsappService.listStaff(),
        whatsappService.listTemplates(),
        whatsappService.getMyAgentPrefs().catch(() => DEFAULT_AGENT_PREFS),
      ]);
      setServer(cfg);
      setCopyConfig(copyCfg);
      setChannelRouting(routingCfg);
      setChannels(chs);
      setDepartments(depts);
      setStaff(st);
      setTemplates(tpls);
      setAgentPrefs(prefs);
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao carregar dados do WhatsApp.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  // Fase N: abre painel de horários de um canal
  const openHours = useCallback(async (ch: WhatsAppChannel) => {
    if (hoursOpenFor === ch.id) { setHoursOpenFor(null); return; }
    setHoursOpenFor(ch.id);
    setAbsence({ message: ch.absence_message || '', enabled: ch.absence_enabled, timezone: ch.timezone || 'America/Cuiaba' });
    const rows = await whatsappService.listBusinessHours(ch.id).catch(() => []);
    // Garante que todos os 7 dias estão presentes (preenche com defaults se faltarem)
    const byDay = new Map(rows.map(r => [r.day_of_week, r]));
    const full: WhatsAppBusinessHoursRow[] = Array.from({ length: 7 }, (_, i) =>
      byDay.get(i) ?? { id: '', instance_id: ch.id, day_of_week: i, start_time: '08:00', end_time: '18:00', is_active: i >= 1 && i <= 5 }
    );
    hoursBefore24h.current = null;
    setHoursData(full);
  }, [hoursOpenFor]);

  /**
   * Liga/desliga o plantão 24 horas do canal em edição.
   *
   * 24h aqui não é uma flag separada: é a agenda cheia (sete dias, 00:00→24:00).
   * O canal de plantão passa então pelo MESMO caminho de todos os outros — SLA
   * da fila, aviso de ausência, encerramento por inatividade —, sem que cada um
   * desses pontos precise aprender uma segunda regra e esquecer dela.
   */
  const toggle24h = (ligar: boolean, instanceId: string) => {
    if (ligar) {
      hoursBefore24h.current = hoursData;
      setHoursData(alwaysOpenRows().map(r => ({ ...r, id: '', instance_id: instanceId })));
      return;
    }
    setHoursData(hoursBefore24h.current ?? Array.from({ length: 7 }, (_, i) => ({
      id: '', instance_id: instanceId, day_of_week: i,
      start_time: '08:00', end_time: '18:00', is_active: i >= 1 && i <= 5,
    })));
    hoursBefore24h.current = null;
  };

  /** O canal em edição está com plantão 24h? Lido da própria agenda na tela. */
  const is24h = isAlwaysOpen(hoursData);

  const saveHours = async (ch: WhatsAppChannel) => {
    setSavingHours(true);
    try {
      await whatsappService.upsertBusinessHours(ch.id, hoursData.map(({ id: _id, instance_id: _iid, ...r }) => r));
      await whatsappService.updateAbsenceConfig(ch.id, absence.message, absence.enabled, absence.timezone);
      setChannels(prev => prev.map(c => c.id === ch.id ? { ...c, absence_message: absence.message || null, absence_enabled: absence.enabled, timezone: absence.timezone } : c));
      onFeedback('success', 'Horários e ausência salvos!');
    } catch (e: any) { onFeedback('error', e.message); }
    finally { setSavingHours(false); }
  };

  // Encerramento por inatividade — painel próprio, com o próprio salvar.
  const openAutoClose = useCallback((ch: WhatsAppChannel) => {
    if (autoCloseOpenFor === ch.id) { setAutoCloseOpenFor(null); return; }
    setAutoCloseOpenFor(ch.id);
    setAutoClose({
      enabled: ch.auto_close_enabled ?? false,
      minutes: ch.auto_close_minutes || 1440,
      message: ch.auto_close_message || '',
      businessHoursOnly: ch.auto_close_business_hours_only ?? true,
    });
  }, [autoCloseOpenFor]);

  const saveAutoClose = async (ch: WhatsAppChannel) => {
    setSavingAutoClose(true);
    try {
      await whatsappService.updateAutoCloseConfig(ch.id, autoClose);
      setChannels(prev => prev.map(c => c.id === ch.id ? {
        ...c,
        auto_close_enabled: autoClose.enabled,
        auto_close_minutes: autoClose.minutes,
        auto_close_message: autoClose.message.trim() || null,
        auto_close_business_hours_only: autoClose.businessHoursOnly,
      } : c));
      onFeedback('success', 'Encerramento por inatividade salvo!');
    } catch (e: any) { onFeedback('error', e.message); }
    finally { setSavingAutoClose(false); }
  };

  const saveServer = async () => {
    const pinOk = await requirePin({
      action: 'update_whatsapp_server', resourceType: 'setting', sensitivity: 'critical',
      title: 'Salvar servidor Evolution', description: 'Confirme com seu PIN para salvar as credenciais do servidor.',
      permission: { module: 'configuracoes', action: 'edit' },
    });
    if (!pinOk) return;
    setSavingServer(true);
    try {
      await settingsService.updateWhatsAppEvolutionConfig(server, userName);
      onFeedback('success', 'Servidor Evolution salvo!');
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao salvar.');
    } finally {
      setSavingServer(false);
    }
  };

  const addChannel = async () => {
    if (!newCh.name.trim() || !newCh.instance_name.trim()) {
      onFeedback('error', 'Informe nome do canal e nome da instância.');
      return;
    }
    setAddingCh(true);
    try {
      await whatsappService.createChannel({
        name: newCh.name.trim(),
        instance_name: newCh.instance_name.trim().replace(/\s+/g, '-').toLowerCase(),
        phone_number: newCh.phone_number.replace(/\D/g, '') || undefined,
        color: newCh.color,
      });
      setNewCh({ name: '', instance_name: '', phone_number: '', color: PALETTE[0] });
      await reload();
      onFeedback('success', 'Canal criado. Clique em Conectar para parear o número.');
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao criar canal.');
    } finally {
      setAddingCh(false);
    }
  };

  const connect = async (id: string) => {
    setConnecting(id);
    setQrFor(null);
    try {
      const res = await whatsappService.connectChannel(id);
      setQrFor({ id, qr: res.qr, status: res.status });
      if (res.status === 'connected') onFeedback('success', 'Canal conectado!');
      await reload();
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao conectar.');
    } finally {
      setConnecting(null);
    }
  };

  // Após exibir o QR, a Evolution não avisa o front quando o aparelho é pareado.
  // Enquanto o QR está aberto e ainda não conectou, consulta o status em intervalo;
  // ao detectar "connected", avisa, recarrega e fecha o QR automaticamente.
  useEffect(() => {
    if (!qrFor || qrFor.status === 'connected') return;
    const channelId = qrFor.id;
    let cancelled = false;
    let attempts = 0;
    const interval = setInterval(async () => {
      if (attempts++ >= 60) { clearInterval(interval); return; } // ~3min de teto
      try {
        const res = await whatsappService.channelStatus(channelId);
        if (cancelled || res.status !== 'connected') return;
        clearInterval(interval);
        setQrFor((cur) => (cur?.id === channelId ? { ...cur, status: 'connected', qr: undefined } : cur));
        onFeedback('success', 'Canal conectado!');
        await reload();
        // mantém a confirmação visível por um instante antes de fechar o QR
        setTimeout(() => setQrFor((cur) => (cur?.id === channelId ? null : cur)), 1800);
      } catch { /* ignora; tenta no próximo tick */ }
    }, 3000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrFor?.id, qrFor?.status]);

  const removeChannel = async (ch: WhatsAppChannel) => {
    const pinOk = await requirePin({
      action: 'delete_whatsapp_channel',
      resourceType: 'whatsapp_channel',
      resourceId: ch.id,
      sensitivity: 'critical',
      title: 'Excluir canal',
      description: `Excluir o canal "${ch.name || ch.instance_name}"? As conversas ficam, mas o canal sai.`,
      actionLabel: 'Excluir canal',
      permission: { module: 'configuracoes', action: 'edit' },
    });
    if (!pinOk) return;
    try {
      await whatsappService.deleteChannel(ch.id);
      await reload();
      onFeedback('success', 'Canal excluído.');
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao excluir.');
    }
  };

  const saveDefaultAssignee = async (ch: WhatsAppChannel, userId: string) => {
    const nextUserId = userId || null;
    if (nextUserId === ch.default_assignee_id) return;

    const selected = staff.find(person => person.user_id === nextUserId);
    const pinOk = await requirePin({
      action: 'update_whatsapp_channel_default_assignee',
      resourceType: 'whatsapp_channel',
      resourceId: ch.id,
      sensitivity: 'high',
      title: 'Alterar responsável inicial',
      description: nextUserId
        ? `Confirme com seu PIN para direcionar novas mensagens de ${ch.name || ch.instance_name} para ${selected?.name || 'o usuário selecionado'}.`
        : `Confirme com seu PIN para desativar a atribuição inicial automática de ${ch.name || ch.instance_name}.`,
      permission: { module: 'configuracoes', action: 'edit' },
    });
    if (!pinOk) return;

    setSavingDefaultAssigneeFor(ch.id);
    try {
      await whatsappService.updateChannel(ch.id, { default_assignee_id: nextUserId });
      setChannels(prev => prev.map(channel => channel.id === ch.id
        ? { ...channel, default_assignee_id: nextUserId }
        : channel));
      onFeedback(
        'success',
        nextUserId
          ? `${selected?.name || 'Responsável'} receberá as novas conversas deste canal.`
          : 'A atribuição inicial automática deste canal foi desativada.',
      );
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao salvar o responsável inicial.');
    } finally {
      setSavingDefaultAssigneeFor(null);
    }
  };

  const addDepartment = async () => {
    if (!newDept.name.trim()) { onFeedback('error', 'Informe o nome do departamento.'); return; }
    setAddingDept(true);
    try {
      await whatsappService.createDepartment({ name: newDept.name.trim(), color: newDept.color });
      setNewDept({ name: '', color: PALETTE[1] });
      await reload();
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao criar departamento.');
    } finally {
      setAddingDept(false);
    }
  };

  const removeDepartment = async (d: WhatsAppDepartment) => {
    const pinOk = await requirePin({
      action: 'delete_whatsapp_department',
      resourceType: 'whatsapp_department',
      resourceId: d.id,
      sensitivity: 'critical',
      title: 'Excluir departamento',
      description: `Excluir o departamento "${d.name}"?`,
      actionLabel: 'Excluir departamento',
      permission: { module: 'configuracoes', action: 'edit' },
    });
    if (!pinOk) return;
    try {
      await whatsappService.deleteDepartment(d.id);
      await reload();
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao excluir.');
    }
  };

  const openMembers = async (id: string) => {
    setEditMembersFor({ id });
    const ids = await whatsappService.listDepartmentMembers(id);
    setMemberSel(new Set(ids));
  };

  const saveMembers = async () => {
    if (!editMembersFor) return;
    setSavingMembers(true);
    try {
      const ids = Array.from(memberSel);
      await whatsappService.setDepartmentMembers(editMembersFor.id, ids);
      setEditMembersFor(null);
      onFeedback('success', 'Membros atualizados.');
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao salvar membros.');
    } finally {
      setSavingMembers(false);
    }
  };

  const addTemplate = async () => {
    if (!newTpl.name.trim() || !newTpl.body.trim()) { onFeedback('error', 'Informe nome e corpo do modelo.'); return; }
    setAddingTpl(true);
    try {
      await whatsappService.createTemplate({ name: newTpl.name.trim(), category: newTpl.category.trim() || undefined, body: newTpl.body.trim() });
      setNewTpl({ name: '', category: '', body: '' });
      await reload();
      onFeedback('success', 'Modelo criado.');
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao criar modelo.');
    } finally {
      setAddingTpl(false);
    }
  };

  const saveCopyConfig = async () => {
    const pinOk = await requirePin({
      action: 'update_whatsapp_module_config',
      resourceType: 'setting',
      sensitivity: 'high',
      title: 'Salvar copys do WhatsApp',
      description: 'Confirme com seu PIN para salvar os textos padrão do módulo WhatsApp.',
      permission: { module: 'configuracoes', action: 'edit' },
    });
    if (!pinOk) return;
    setSavingCopy(true);
    try {
      await settingsService.updateWhatsAppModuleConfig(copyConfig, userName);
      onFeedback('success', 'Copys do WhatsApp salvas!');
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao salvar copys do WhatsApp.');
    } finally {
      setSavingCopy(false);
    }
  };

  const getChannelRouting = (channelId: string): WhatsAppChannelDepartmentRouting => {
    return channelRouting.find(item => item.channel_id === channelId) ?? {
      channel_id: channelId,
      allowed_department_ids: [],
      default_department_id: null,
    };
  };

  const updateChannelRouting = (channelId: string, patch: Partial<WhatsAppChannelDepartmentRouting>) => {
    setChannelRouting(prev => {
      const current = prev.find(item => item.channel_id === channelId) ?? {
        channel_id: channelId,
        allowed_department_ids: [],
        default_department_id: null,
      };
      const next = { ...current, ...patch };
      const filtered = prev.filter(item => item.channel_id !== channelId);
      return [...filtered, next];
    });
  };

  const toggleAllowedDepartment = (channelId: string, departmentId: string) => {
    const current = getChannelRouting(channelId);
    const on = current.allowed_department_ids.includes(departmentId);
    const nextAllowed = on
      ? current.allowed_department_ids.filter(id => id !== departmentId)
      : [...current.allowed_department_ids, departmentId];
    updateChannelRouting(channelId, {
      allowed_department_ids: nextAllowed,
      default_department_id: nextAllowed.includes(current.default_department_id || '') ? current.default_department_id : null,
    });
  };

  const saveChannelRouting = async () => {
    const pinOk = await requirePin({
      action: 'update_whatsapp_channel_department_routing',
      resourceType: 'setting',
      sensitivity: 'high',
      title: 'Salvar roteamento de canais',
      description: 'Confirme com seu PIN para salvar departamentos permitidos e padrão por canal.',
      permission: { module: 'configuracoes', action: 'edit' },
    });
    if (!pinOk) return;
    setSavingRouting(true);
    try {
      // Envia todos os canais presentes no estado — inclusive os esvaziados,
      // para que a remoção de departamentos seja persistida (delete por canal).
      const sanitized = channelRouting
        .map(item => ({
          channel_id: item.channel_id,
          allowed_department_ids: Array.from(new Set(item.allowed_department_ids)).filter(Boolean),
          default_department_id: item.default_department_id || null,
        }));
      await settingsService.updateWhatsAppChannelDepartmentRouting(sanitized, userName);
      onFeedback('success', 'Roteamento de departamentos por canal salvo!');
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao salvar roteamento por canal.');
    } finally {
      setSavingRouting(false);
    }
  };

  const removeTemplate = async (t: WhatsAppTemplate) => {
    const pinOk = await requirePin({
      action: 'delete_whatsapp_template',
      resourceType: 'whatsapp_template',
      resourceId: t.id,
      sensitivity: 'critical',
      title: 'Excluir modelo',
      description: `Excluir o modelo "${t.name}"?`,
      actionLabel: 'Excluir modelo',
      permission: { module: 'configuracoes', action: 'edit' },
    });
    if (!pinOk) return;
    try {
      await whatsappService.deleteTemplate(t.id);
      await reload();
      onFeedback('success', 'Modelo excluído.');
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao excluir.');
    }
  };

  const startEditTemplate = (t: WhatsAppTemplate) => {
    setEditingTplId(t.id);
    setTplDraft({
      name: t.name || '',
      category: t.category || '',
      body: t.body || '',
    });
  };

  const cancelEditTemplate = () => {
    setEditingTplId(null);
    setTplDraft({ name: '', category: '', body: '' });
  };

  const saveTemplateEdit = async (t: WhatsAppTemplate) => {
    if (!tplDraft.name.trim() || !tplDraft.body.trim()) {
      onFeedback('error', 'Informe nome e corpo do modelo.');
      return;
    }
    setSavingTplId(t.id);
    try {
      await whatsappService.updateTemplate(t.id, {
        name: tplDraft.name.trim(),
        category: tplDraft.category.trim() || null,
        body: tplDraft.body.trim(),
      });
      await reload();
      cancelEditTemplate();
      onFeedback('success', 'Modelo atualizado.');
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao atualizar modelo.');
    } finally {
      setSavingTplId(null);
    }
  };

  // Editor de membros reutilizado por canal e departamento.
  const renderMemberEditor = (radius: string) => (
    <div style={{ border: '1px solid #e7e5df', borderTop: 'none', borderRadius: radius, padding: '12px', background: '#faf9f7' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
        {staff.map(s => {
          const on = memberSel.has(s.user_id);
          return (
            <button key={s.user_id}
              onClick={() => setMemberSel(prev => { const n = new Set(prev); on ? n.delete(s.user_id) : n.add(s.user_id); return n; })}
              style={{ padding: '5px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                border: on ? '1px solid #ea6c00' : '1px solid #e0ded8', background: on ? '#fff7ed' : '#fff', color: on ? '#c2410c' : '#6b7280' }}>
              {on && <Check size={11} style={{ display: 'inline', marginRight: 4 }} />}{s.name}
            </button>
          );
        })}
        {staff.length === 0 && <span style={{ fontSize: '12px', color: '#9ca3af' }}>Nenhum usuário ativo.</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
        <span style={{ marginRight: 'auto', fontSize: '11.5px', color: '#9ca3af' }}>
          Sem membros = aberto a todos.
        </span>
        <button className="settings-btn-ghost" onClick={() => setEditMembersFor(null)}><X size={13} /> Cancelar</button>
        <button className="settings-btn-primary" onClick={saveMembers} disabled={savingMembers}>
          {savingMembers ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar
        </button>
      </div>
    </div>
  );

  // Meu perfil na equipe — base do rótulo automático mostrado como referência.
  const myProfile = staff.find(s => s.user_id === user?.id) || null;
  // Prévia ao vivo: exatamente o que o cliente lê acima da mensagem.
  const identityPreview = agentLabel(myProfile ? { ...myProfile, ...agentPrefs } : null)
    || agentPrefs.short_name?.trim()
    || userName
    || 'Sem assinatura';
  const identityRolePreview = agentRoleLabel(myProfile ? { ...myProfile, ...agentPrefs } : null);

  const saveIdentity = async () => {
    setSavingIdentity(true);
    try {
      const saved = await whatsappService.saveMyAgentPrefs(agentPrefs);
      setAgentPrefs(saved);
      // A equipe inteira vê esta assinatura, então a lista de staff em memória
      // (que alimenta os rótulos) precisa refletir a mudança na hora.
      setStaff(prev => prev.map(s => s.user_id === user?.id
        ? { ...s, short_name: saved.short_name, role_label: saved.role_label, treatment: saved.treatment }
        : s));
      onFeedback('success', 'Identidade de atendimento salva!');
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao salvar identidade.');
    } finally { setSavingIdentity(false); }
  };

  const sectionGroups: WhatsAppSettingsGroup[] = [
    {
      label: 'Infraestrutura',
      description: 'Conexão técnica',
      items: [
        { key: 'connection' as const, label: 'Conexão', summary: 'Servidor Evolution e API', icon: QrCode },
      ],
    },
    {
      label: 'Atendimento',
      description: 'Equipe e operação',
      items: [
        { key: 'identity' as const, label: 'Minha assinatura', summary: 'Nome exibido nas mensagens', icon: IdCard },
        { key: 'channels' as const, label: 'Canais', summary: 'Números, horários, acessos, funis e roteamento', icon: Phone },
        { key: 'departments' as const, label: 'Departamentos', summary: 'Setores e membros', icon: Users },
      ],
    },
    {
      label: 'Conteúdo e IA',
      description: 'Mensagens e automação',
      items: [
        { key: 'copies' as const, label: 'Textos padrão', summary: 'Copys operacionais', icon: Pencil },
        { key: 'templates' as const, label: 'Modelos', summary: 'Mensagens prontas', icon: MessageSquare },
        { key: 'agents' as const, label: 'Agentes de IA', summary: 'Assistente que atende sozinho', icon: Bot },
      ],
    },
  ];
  const renderSection = (key: WhatsAppSettingsSection, title: string, summary: string, content: React.ReactNode) => {
    if (activeSection !== key) return null;
    return (
      <div className="settings-card">
        <p className="settings-card-title">{title}</p>
        <p style={{ fontSize: '12.5px', color: '#9ca3af', marginBottom: '14px' }}>{summary}</p>
        {content}
      </div>
    );
  };

  const hasServerConfig = !!server.base_url.trim() && !!server.api_key.trim();
  const connectedChannels = channels.filter(ch => ch.status === 'connected').length;
  const connectingChannels = channels.filter(ch => ch.status === 'connecting').length;
  const disconnectedChannels = channels.filter(ch => ch.status !== 'connected' && ch.status !== 'connecting').length;
  const connectionStatus = !hasServerConfig
    ? { label: 'Não configurado', tone: '#991b1b', bg: '#fef2f2', border: '#fecaca', detail: 'Preencha URL base e API Key para ativar a integração.' }
    : connectedChannels > 0
      ? { label: 'Online', tone: '#166534', bg: '#f0fdf4', border: '#bbf7d0', detail: `${connectedChannels} canal${connectedChannels !== 1 ? 'is' : ''} conectado${connectedChannels !== 1 ? 's' : ''}.` }
      : connectingChannels > 0
        ? { label: 'Conectando', tone: '#92400e', bg: '#fffbeb', border: '#fde68a', detail: `${connectingChannels} canal${connectingChannels !== 1 ? 'is' : ''} em pareamento.` }
        : channels.length === 0
          ? { label: 'Configurado', tone: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', detail: 'Servidor salvo, mas ainda não há canais cadastrados.' }
          : { label: 'Sem canais online', tone: '#6b7280', bg: '#f8fafc', border: '#e5e7eb', detail: `${disconnectedChannels} canal${disconnectedChannels !== 1 ? 'is' : ''} desconectado${disconnectedChannels !== 1 ? 's' : ''}.` };

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>;
  }

  return (
    <div className="whatsapp-settings-layout">
      <nav className="settings-card whatsapp-settings-nav" aria-label="Áreas de configuração do WhatsApp">
        {sectionGroups.map(group => (
          <div className="whatsapp-settings-nav-group" key={group.label}>
            <div>
              <p style={{ margin: 0, fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#64748b' }}>
                {group.label}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '10.5px', color: '#a0a7b2' }}>{group.description}</p>
            </div>
            <div className="whatsapp-settings-nav-items">
              {group.items.map(item => {
                const active = activeSection === item.key;
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`whatsapp-settings-nav-button${active ? ' is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    title={item.summary}
                    onClick={() => setActiveSection(item.key)}
                  >
                    <Icon size={14} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="whatsapp-settings-content" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Servidor Evolution ── */}
      {renderSection('connection', 'Conexão com Evolution', 'Servidor global e credenciais da API', <>
        <p style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '12px' }}>
          Um servidor para todos os canais. Cada canal abaixo é uma instância (número) neste servidor.
        </p>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '12px 14px',
          marginBottom: '14px',
          borderRadius: '12px',
          background: connectionStatus.bg,
          border: `1px solid ${connectionStatus.border}`,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: connectionStatus.tone,
                flexShrink: 0,
              }} />
              <span style={{ fontSize: '12px', fontWeight: 800, color: connectionStatus.tone, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Status da conexão
              </span>
            </div>
            <p style={{ fontSize: '14px', fontWeight: 700, color: '#1f2937', marginBottom: '2px' }}>{connectionStatus.label}</p>
            <p style={{ fontSize: '12px', color: '#6b7280' }}>{connectionStatus.detail}</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '5px 9px' }}>
              Conectados: {connectedChannels}
            </span>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '5px 9px' }}>
              Pareando: {connectingChannels}
            </span>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '5px 9px' }}>
              Total: {channels.length}
            </span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <label className="settings-label">URL base</label>
            <input className="settings-input" type="url" value={server.base_url}
              onChange={e => setServer({ ...server, base_url: e.target.value })}
              placeholder="https://evolution.seudominio.com.br" />
          </div>
          <div>
            <label className="settings-label">API Key (global)</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input className="settings-input" style={{ fontFamily: 'monospace' }}
                type={showKey ? 'text' : 'password'} value={server.api_key}
                onChange={e => setServer({ ...server, api_key: e.target.value })}
                placeholder="apikey do servidor" />
              <button type="button" onClick={() => setShowKey(v => !v)}
                style={{ flexShrink: 0, padding: '0 12px', background: '#f2f4f6', border: '1px solid rgba(15,23,42,0.14)', borderRadius: '8px', cursor: 'pointer', color: '#555' }}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>
        <div className="settings-save-bar" style={{ marginTop: '16px' }}>
          <button className="settings-btn-primary" onClick={saveServer} disabled={savingServer}>
            {savingServer ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar servidor
          </button>
        </div>
      </>)}

      {/* ── Minha assinatura nas mensagens ── */}
      {renderSection('identity', 'Minha assinatura', 'Como o seu nome aparece acima do texto enviado', <>
        <p style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '14px' }}>
          Toda mensagem que você envia sai com o seu nome em negrito antes do texto, e a
          equipe vê esse mesmo nome acima da bolha aqui no CRM. Sem nada preenchido, o
          sistema usa o primeiro nome do seu cadastro e acrescenta Dr./Dra. quando o
          perfil é de advogado. Isto vale só para você — cada pessoa configura a sua.
        </p>

        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px',
          marginBottom: '16px', borderRadius: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0',
        }}>
          <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#15803d' }}>
            Prévia
          </span>
          <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#166534' }}>{identityPreview}</span>
          {identityRolePreview && (
            <span style={{
              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
              color: '#15803d', background: '#dcfce7', padding: '2px 6px', borderRadius: '6px',
            }}>{identityRolePreview}</span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <label className="settings-label">Nome exibido</label>
            <input className="settings-input" maxLength={60}
              placeholder={myProfile ? agentLabel({ ...myProfile, short_name: null, treatment: null }) || 'Seu primeiro nome' : 'Seu primeiro nome'}
              value={agentPrefs.short_name ?? ''}
              onChange={e => setAgentPrefs(prev => ({ ...prev, short_name: e.target.value }))} />
            <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '6px' }}>
              Escrito exatamente como você digitar. Em branco = primeiro nome do cadastro.
            </p>
          </div>
          <div>
            <label className="settings-label">Tratamento</label>
            <select className="settings-input" value={agentPrefs.treatment || ''}
              onChange={e => setAgentPrefs(prev => ({ ...prev, treatment: (e.target.value || null) as AgentPrefs['treatment'] }))}>
              <option value="">Automático (pelo cadastro)</option>
              <option value="none">Sem tratamento</option>
              <option value="dr">Dr.</option>
              <option value="dra">Dra.</option>
            </select>
            <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '6px' }}>
              Vai na frente do nome exibido.
            </p>
          </div>
          <div>
            <label className="settings-label">Cargo exibido</label>
            <input className="settings-input" maxLength={40}
              placeholder={myProfile?.role || 'Cargo do cadastro'}
              value={agentPrefs.role_label ?? ''}
              onChange={e => setAgentPrefs(prev => ({ ...prev, role_label: e.target.value }))} />
            <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '6px' }}>
              Etiqueta ao lado do nome, visível só para a equipe no CRM.
            </p>
          </div>
        </div>

        <div className="settings-save-bar" style={{ marginTop: '16px' }}>
          <button className="settings-btn-primary" onClick={saveIdentity} disabled={savingIdentity}>
            {savingIdentity ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar minha assinatura
          </button>
        </div>
      </>)}

      {/* ── Canais ── */}
      {renderSection('channels', 'Canais', `${channels.length} canal${channels.length !== 1 ? 'is' : ''} configurado${channels.length !== 1 ? 's' : ''} · números, acessos, funis e roteamento`, <>
        <p style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '12px' }}>
          Tudo o que pertence a um número mora aqui: horário comercial, quem enxerga o canal, o funil dele e
          quais departamentos o atendem.
        </p>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {[
            { key: 'list' as const, label: 'Lista de canais' },
            { key: 'access' as const, label: 'Acessos' },
            { key: 'funnels' as const, label: 'Funis' },
            { key: 'routing' as const, label: 'Roteamento' },
            { key: 'new' as const, label: 'Novo canal' },
          ].map(item => {
            const active = activeChannelSection === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveChannelSection(item.key)}
                style={{
                  borderRadius: '999px',
                  border: active ? '1px solid #f59e0b' : '1px solid #e5e7eb',
                  background: active ? '#fff7ed' : '#fff',
                  color: active ? '#c2410c' : '#6b7280',
                  padding: '7px 12px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {activeChannelSection === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
          {channels.length === 0 && (
            <p style={{ fontSize: '12.5px', color: '#9ca3af' }}>Nenhum canal ainda. Crie o primeiro abaixo.</p>
          )}
          {channels.map(ch => (
            <div key={ch.id} style={{ border: '1px solid #e7e5df', borderRadius: '12px', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: ch.color || '#ea6c00', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '13.5px', fontWeight: 700, color: '#1f2937' }}>{ch.name || ch.instance_name}</p>
                  <p style={{ fontSize: '11.5px', color: '#9ca3af' }}>
                    {ch.instance_name}{ch.phone_number ? ` · ${ch.phone_number}` : ''}
                  </p>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: '#6b7280' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColor(ch.status) }} />
                  {statusLabel(ch.status)}
                </span>
                <button onClick={() => connect(ch.id)} disabled={connecting === ch.id}
                  className="settings-btn-ghost" style={{ padding: '6px 10px' }}>
                  {connecting === ch.id ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />}
                  {ch.status === 'connected' ? 'Reconectar' : 'Conectar'}
                </button>
                <button onClick={() => openHours(ch)} title="Horário comercial e mensagem de ausência"
                  className="settings-btn-ghost" style={{ padding: '6px 10px', color: hoursOpenFor === ch.id ? '#d97706' : undefined }}>
                  <Clock size={13} /> Horário comercial
                </button>
                <button onClick={() => openAutoClose(ch)} title="Encerrar sozinho as conversas paradas"
                  className="settings-btn-ghost" style={{ padding: '6px 10px', color: autoCloseOpenFor === ch.id ? '#d97706' : undefined }}>
                  <TimerOff size={13} /> Encerramento
                </button>
                <button onClick={() => removeChannel(ch)} title="Excluir canal"
                  style={{ padding: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                  <Trash2 size={14} />
                </button>
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
                marginTop: '12px', padding: '10px 12px', border: '1px solid #e2e8f0',
                borderRadius: '10px', background: '#f8fafc',
              }}>
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <p style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                    <Users size={13} /> Responsável inicial
                  </p>
                  <p style={{ marginTop: '3px', fontSize: '11px', lineHeight: 1.45, color: '#64748b' }}>
                    Recebe automaticamente mensagens novas e conversas sem responsável, inclusive fora do horário comercial. Uma atribuição ou transferência já existente nunca é substituída.
                  </p>
                </div>
                <div style={{ flex: '0 1 300px', minWidth: '230px', position: 'relative' }}>
                  <select
                    aria-label={`Responsável inicial do canal ${ch.name || ch.instance_name}`}
                    value={ch.default_assignee_id || ''}
                    disabled={savingDefaultAssigneeFor === ch.id}
                    onChange={event => { void saveDefaultAssignee(ch, event.target.value); }}
                    style={{
                      width: '100%', fontSize: '12px', padding: '7px 32px 7px 9px', borderRadius: '7px',
                      border: '1px solid #cbd5e1', background: '#fff', color: '#111827',
                      opacity: savingDefaultAssigneeFor === ch.id ? 0.65 : 1,
                    }}
                  >
                    <option value="">— Sem atribuição automática —</option>
                    {staff.map(person => {
                      const role = agentRoleLabel(person);
                      return (
                        <option key={person.user_id} value={person.user_id}>
                          {agentLabel(person) || person.name}{role ? ` · ${role}` : ''}
                        </option>
                      );
                    })}
                  </select>
                  {savingDefaultAssigneeFor === ch.id && (
                    <Loader2 size={14} className="animate-spin" style={{ position: 'absolute', right: '10px', top: '8px', color: '#64748b' }} />
                  )}
                </div>
              </div>

              {/* Painel de horários e ausência (Fase N) */}
              {hoursOpenFor === ch.id && (
                <div style={{ marginTop: '12px', border: '1px solid #e7e5df', borderRadius: '10px', padding: '14px', background: '#fafaf9' }}>
                  <p style={{ fontSize: '11.5px', color: '#6b7280', marginBottom: '10px' }}>
                    Aqui você define o horário comercial real deste canal. A copy usada quando o cliente escreve fora do horário fica logo abaixo.
                  </p>
                  <p style={{ fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Clock size={13} /> Horário comercial
                  </p>

                  {/* Timezone */}
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>Fuso horário do canal</label>
                    <select value={absence.timezone}
                      onChange={e => setAbsence(a => ({ ...a, timezone: e.target.value }))}
                      style={{ fontSize: '12px', padding: '5px 8px', borderRadius: '7px', border: '1px solid #d1d5db', background: '#fff', color: '#111827', width: '100%' }}>
                      {BR_TIMEZONES.map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Plantão 24 horas. Fica ACIMA da grade porque é a primeira
                      pergunta ("este canal fecha?"); só quem responde "sim"
                      precisa da grade de dias. */}
                  <label style={{
                    display: 'flex', alignItems: 'flex-start', gap: '7px', cursor: 'pointer',
                    marginBottom: '12px', padding: '9px 10px', borderRadius: '8px',
                    border: `1px solid ${is24h ? '#bbf7d0' : '#e5e7eb'}`,
                    background: is24h ? '#f0fdf4' : '#fff',
                  }}>
                    <input type="checkbox" checked={is24h} style={{ marginTop: '2px' }}
                      onChange={e => toggle24h(e.target.checked, ch.id)} />
                    <span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: is24h ? '#15803d' : '#374151' }}>
                        Atendimento 24 horas, todos os dias
                      </span>
                      <span style={{ display: 'block', marginTop: '2px', fontSize: '10.5px', lineHeight: 1.45, color: '#6b7280' }}>
                        O canal nunca fica fora do horário: nada de mensagem de ausência, e a espera da fila
                        conta no relógio de parede. Use em plantão e em canal de campanha, que recebe a
                        qualquer hora.
                      </span>
                    </span>
                  </label>

                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px',
                    opacity: is24h ? 0.45 : 1, pointerEvents: is24h ? 'none' : 'auto',
                  }} aria-hidden={is24h}>
                    {hoursData.map((row, idx) => (
                      <div key={row.day_of_week} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', minWidth: '38px' }}>
                          <input type="checkbox" checked={row.is_active}
                            onChange={e => setHoursData(prev => prev.map((r, i) => i === idx ? { ...r, is_active: e.target.checked } : r))} />
                          <span style={{ fontSize: '12px', fontWeight: 600, color: row.is_active ? '#1f2937' : '#9ca3af' }}>{DAY_NAMES[row.day_of_week]}</span>
                        </label>
                        <input type="time" value={row.start_time} disabled={!row.is_active}
                          onChange={e => setHoursData(prev => prev.map((r, i) => i === idx ? { ...r, start_time: e.target.value } : r))}
                          style={{ fontSize: '12px', padding: '3px 6px', borderRadius: '6px', border: '1px solid #d1d5db', background: row.is_active ? '#fff' : '#f3f4f6', color: row.is_active ? '#111827' : '#9ca3af' }} />
                        <span style={{ fontSize: '11px', color: '#9ca3af' }}>até</span>
                        <input type="time" value={row.end_time} disabled={!row.is_active}
                          onChange={e => setHoursData(prev => prev.map((r, i) => i === idx ? { ...r, end_time: e.target.value } : r))}
                          style={{ fontSize: '12px', padding: '3px 6px', borderRadius: '6px', border: '1px solid #d1d5db', background: row.is_active ? '#fff' : '#f3f4f6', color: row.is_active ? '#111827' : '#9ca3af' }} />
                      </div>
                    ))}
                  </div>

                  <p style={{ fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <BellOff size={13} /> Mensagem de ausência
                  </p>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={absence.enabled} onChange={e => setAbsence(a => ({ ...a, enabled: e.target.checked }))} />
                    <span style={{ fontSize: '12px', color: '#374151' }}>Enviar mensagem automática ao cliente quando fora do horário</span>
                  </label>
                  {is24h && absence.enabled && (
                    <p style={{ margin: '-4px 0 8px 22px', fontSize: '10.5px', lineHeight: 1.4, color: '#b45309' }}>
                      Com o plantão 24 horas ligado, nunca existe "fora do horário" — esta mensagem fica
                      guardada, mas não vai sair para ninguém.
                    </p>
                  )}
                  {absence.enabled && (
                    <>
                      <textarea value={absence.message} onChange={e => setAbsence(a => ({ ...a, message: e.target.value }))}
                        rows={2} placeholder="Ex: Olá! No momento estamos fora do horário de atendimento. Nosso horário é de seg a sex, das 8h às 18h. Sua mensagem foi recebida e retornaremos assim que possível."
                        style={{ width: '100%', fontSize: '12px', padding: '6px 8px', borderRadius: '6px', border: '1px solid #d1d5db', resize: 'vertical', boxSizing: 'border-box' }} />
                      <p style={{ margin: '5px 1px 0', fontSize: '10.5px', lineHeight: 1.4, color: '#8a94a6' }}>
                        Para não insistir, este aviso é enviado no máximo uma vez a cada 12 horas por conversa, mesmo após encerrar ou reabrir o atendimento.
                      </p>
                    </>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                    <button className="settings-btn-primary" onClick={() => saveHours(ch)} disabled={savingHours}>
                      {savingHours ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar horários
                    </button>
                  </div>
                </div>
              )}


              {/* Encerramento por inatividade: painel próprio. Ele CONSULTA o
                  horário comercial (quando "só dentro do expediente" está
                  ligado), mas é outra decisão — e misturar as duas fazia mexer
                  no horário do canal esbarrar num encerramento automático que
                  ninguém pediu para revisar. */}
              {autoCloseOpenFor === ch.id && (
                <div style={{ marginTop: '12px', border: '1px solid #e7e5df', borderRadius: '10px', padding: '14px', background: '#fafaf9' }}>
                  <p style={{ fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <TimerOff size={13} /> Encerramento por inatividade
                  </p>
                  <p style={{ fontSize: '11.5px', color: '#6b7280', marginBottom: '10px', lineHeight: 1.5 }}>
                    Conversa parada esperando o cliente sai da fila sozinha. O relógio é a última
                    mensagem da conversa, e qualquer mensagem nova reinicia a contagem do zero — a
                    sua inclusive. Mas o prazo só corre quando a última palavra é NOSSA: enquanto o
                    escritório dever resposta, nada é encerrado.
                  </p>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={autoClose.enabled}
                      onChange={e => setAutoClose(a => ({ ...a, enabled: e.target.checked }))} />
                    <span style={{ fontSize: '12px', color: '#374151' }}>Encerrar sozinho as conversas paradas deste canal</span>
                  </label>
                  <p style={{ margin: '0 1px 8px', fontSize: '10.5px', lineHeight: 1.4, color: '#8a94a6' }}>
                    Deixe desligado nos canais atendidos por IA: o assistente tem a própria escada de
                    acompanhamento, e o silêncio entre um lembrete e outro não é atendimento abandonado.
                  </p>
                  {autoClose.enabled && (
                    <>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>
                        Silêncio tolerado antes de encerrar
                      </label>
                      <select value={autoClose.minutes}
                        onChange={e => setAutoClose(a => ({ ...a, minutes: Number(e.target.value) }))}
                        style={{ fontSize: '12px', padding: '5px 8px', borderRadius: '7px', border: '1px solid #d1d5db', background: '#fff', color: '#111827', width: '100%', marginBottom: '4px' }}>
                        {AUTO_CLOSE_PRESETS.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                      <p style={{ margin: '0 1px 10px', fontSize: '10.5px', lineHeight: 1.4, color: '#8a94a6' }}>
                        Contado a partir da última mensagem da conversa. Cada mensagem nova zera o
                        relógio — inclusive as suas. Exceção: o aviso automático de fora do horário e
                        o convite de reabertura não contam como resposta, e depois deles a conversa
                        continua sendo pendência do escritório.
                      </p>

                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', marginBottom: '4px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={autoClose.businessHoursOnly} style={{ marginTop: '2px' }}
                          onChange={e => setAutoClose(a => ({ ...a, businessHoursOnly: e.target.checked }))} />
                        <span style={{ fontSize: '12px', color: '#374151' }}>Só falar com o cliente dentro do horário comercial deste canal</span>
                      </label>
                      <p style={{ margin: '0 1px 10px 22px', fontSize: '10.5px', lineHeight: 1.4, color: '#8a94a6' }}>
                        O encerramento acontece na hora em que o prazo vence, seja que horas for — o que
                        espera a abertura é a despedida abaixo, que fica reservada e sai na primeira
                        varredura do expediente seguinte. Desmarcado, a despedida sai na mesma hora,
                        inclusive de madrugada.
                      </p>

                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>
                        Mensagem de despedida (opcional)
                      </label>
                      <textarea value={autoClose.message}
                        onChange={e => setAutoClose(a => ({ ...a, message: e.target.value }))}
                        rows={2} placeholder="Ex: Como não tivemos retorno, estou encerrando este atendimento por aqui. Se precisar, é só chamar de novo — respondemos normalmente. 🙂"
                        style={{ width: '100%', fontSize: '12px', padding: '6px 8px', borderRadius: '6px', border: '1px solid #d1d5db', resize: 'vertical', boxSizing: 'border-box' }} />
                      <p style={{ margin: '5px 1px 0', fontSize: '10.5px', lineHeight: 1.4, color: '#8a94a6' }}>
                        Em branco, a conversa é encerrada sem avisar o cliente. Se ele escrever depois, o
                        atendimento reabre normalmente.
                      </p>
                    </>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                    <button className="settings-btn-primary" onClick={() => saveAutoClose(ch)} disabled={savingAutoClose}>
                      {savingAutoClose ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar encerramento
                    </button>
                  </div>
                </div>
              )}

              {qrFor?.id === ch.id && (
                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  {qrFor.status === 'connected' ? (
                    <div style={{ padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', color: '#166534', fontSize: '12.5px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <Check size={14} /> Conectado.
                    </div>
                  ) : qrFor.qr ? (
                    <>
                      <img src={qrFor.qr.startsWith('data:') ? qrFor.qr : `data:image/png;base64,${qrFor.qr}`}
                        alt="QR Code" style={{ width: '210px', height: '210px', borderRadius: '12px', border: '1px solid #e7e5df' }} />
                      <p style={{ fontSize: '12px', color: '#6b7280' }}>WhatsApp → Aparelhos conectados → Conectar aparelho.</p>
                    </>
                  ) : (
                    <p style={{ fontSize: '12px', color: '#9ca3af' }}>Sem QR no momento. Tente novamente em alguns segundos.</p>
                  )}
                </div>
              )}

              <p style={{ marginTop: '12px', borderTop: '1px dashed #ece7df', paddingTop: '12px', fontSize: '11.5px', color: '#9ca3af' }}>
                Acessos, funil e departamentos deste número estão nas abas acima; o assistente de IA
                deste canal, em <strong>Agentes de IA</strong>.
              </p>
            </div>
          ))}
        </div>
        )}

        {/* Novo canal */}
        {activeChannelSection === 'new' && (
        <div style={{ borderTop: '1px dashed #e0ded8', paddingTop: '14px' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280', marginBottom: '10px' }}>Novo canal</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div>
              <label className="settings-label">Nome</label>
              <input className="settings-input" value={newCh.name}
                onChange={e => setNewCh({ ...newCh, name: e.target.value })} placeholder="Ex: Comercial" />
            </div>
            <div>
              <label className="settings-label">Instância (Evolution)</label>
              <input className="settings-input" value={newCh.instance_name}
                onChange={e => setNewCh({ ...newCh, instance_name: e.target.value })} placeholder="comercial" />
            </div>
            <div>
              <label className="settings-label">Número (opcional)</label>
              <input className="settings-input" value={newCh.phone_number}
                onChange={e => setNewCh({ ...newCh, phone_number: e.target.value })} placeholder="5565999999999" />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
            <div style={{ display: 'flex', gap: '6px' }}>
              {PALETTE.map(c => (
                <button key={c} onClick={() => setNewCh({ ...newCh, color: c })}
                  style={{ width: '20px', height: '20px', borderRadius: '50%', background: c, border: newCh.color === c ? '2px solid #1f2937' : '2px solid transparent', cursor: 'pointer' }} />
              ))}
            </div>
            <button className="settings-btn-primary" style={{ marginLeft: 'auto' }} onClick={addChannel} disabled={addingCh}>
              {addingCh ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Adicionar canal
            </button>
          </div>
        </div>
        )}

        {/* Quem enxerga o canal — atendimento e funil de Leads leem a mesma fonte. */}
        {activeChannelSection === 'access' && (
        <div>
          <p className="settings-card-title">Acessos por usuário</p>
          <p style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '14px' }}>
            Defina quem enxerga cada canal no atendimento e no funil de Leads.
          </p>
          <ChannelAccessManager
            channels={channels}
            staff={staff}
            requirePin={requirePin}
            onFeedback={onFeedback}
            onChannelsChange={setChannels}
          />
        </div>
        )}

        {/* Funil comercial/jurídico próprio de cada canal. */}
        {activeChannelSection === 'funnels' && (
        <div>
          <p className="settings-card-title">Funis por canal</p>
          <p style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '14px' }}>
            Personalize as etapas, a ordem, as cores e a entrada inicial de cada número.
          </p>
          <ChannelFunnelManager
            channels={channels}
            departments={departments}
            staff={staff}
            moduleConfig={copyConfig}
            requirePin={requirePin}
            onFeedback={onFeedback}
            onChannelsChange={setChannels}
          />
        </div>
        )}

        {/* Quais departamentos atendem cada número — propriedade do canal. */}
        {activeChannelSection === 'routing' && (
        <div>
        <p className="settings-card-title">Canais × departamentos</p>
        <p style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '14px' }}>
          Marque quais setores podem atender cada número. O <strong>padrão</strong> recebe as novas conversas
          que chegam nesse canal. Um mesmo departamento pode atender vários canais.
        </p>

        {channels.length === 0 || departments.length === 0 ? (
          <p style={{ fontSize: '12.5px', color: '#9ca3af' }}>
            {channels.length === 0
              ? 'Cadastre um número na aba Lista de canais.'
              : 'Cadastre setores na área Departamentos.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid #ece7df', borderRadius: '12px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: '#faf9f7' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 700, color: '#374151', position: 'sticky', left: 0, background: '#faf9f7', borderBottom: '1px solid #ece7df' }}>
                    Canal
                  </th>
                  {departments.map(d => (
                    <th key={d.id} style={{ padding: '10px 8px', fontWeight: 600, color: '#374151', borderBottom: '1px solid #ece7df', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: d.color || '#16a34a' }} />
                        {d.name}
                      </span>
                    </th>
                  ))}
                  <th style={{ padding: '10px 12px', fontWeight: 700, color: '#374151', borderBottom: '1px solid #ece7df', borderLeft: '1px solid #ece7df', whiteSpace: 'nowrap' }}>
                    Padrão
                  </th>
                </tr>
              </thead>
              <tbody>
                {channels.map(ch => {
                  const routing = getChannelRouting(ch.id);
                  const allowed = departments.filter(d => routing.allowed_department_ids.includes(d.id));
                  return (
                    <tr key={ch.id} style={{ borderTop: '1px solid #f1efe9' }}>
                      <td style={{ padding: '10px 12px', position: 'sticky', left: 0, background: '#fff', borderRight: '1px solid #f1efe9' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                          <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: ch.color || '#ea6c00' }} />
                          <span style={{ fontWeight: 600, color: '#1f2937' }}>{ch.name || ch.instance_name}</span>
                        </span>
                      </td>
                      {departments.map(d => {
                        const on = routing.allowed_department_ids.includes(d.id);
                        return (
                          <td key={d.id} style={{ textAlign: 'center', padding: '8px' }}>
                            <button
                              onClick={() => toggleAllowedDepartment(ch.id, d.id)}
                              title={on ? 'Atende este canal' : 'Não atende'}
                              style={{
                                width: '22px', height: '22px', borderRadius: '6px', cursor: 'pointer',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                border: on ? `1px solid ${d.color || '#16a34a'}` : '1px solid #e5e7eb',
                                background: on ? `${d.color || '#16a34a'}18` : '#fff',
                                color: on ? (d.color || '#16a34a') : 'transparent',
                              }}>
                              <Check size={13} />
                            </button>
                          </td>
                        );
                      })}
                      <td style={{ padding: '8px 12px', borderLeft: '1px solid #f1efe9' }}>
                        <select
                          className="settings-input"
                          style={{ minWidth: '130px', padding: '5px 8px', fontSize: '12px' }}
                          value={routing.default_department_id || ''}
                          disabled={allowed.length === 0}
                          onChange={e => updateChannelRouting(ch.id, { default_department_id: e.target.value || null })}
                        >
                          <option value="">{allowed.length === 0 ? '—' : 'Nenhum'}</option>
                          {allowed.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {channels.length > 0 && departments.length > 0 && (
          <div className="settings-save-bar" style={{ marginTop: '14px' }}>
            <button className="settings-btn-primary" onClick={saveChannelRouting} disabled={savingRouting}>
              {savingRouting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar roteamento
            </button>
          </div>
        )}
        </div>
        )}
      </>)}

      {/* ── Departamentos ── */}
      {renderSection('departments', 'Departamentos', `${departments.length} setor${departments.length !== 1 ? 'es' : ''} configurado${departments.length !== 1 ? 's' : ''}`, <>
        <p className="settings-card-title">Departamentos (setores)</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
          {departments.length === 0 && (
            <p style={{ fontSize: '12.5px', color: '#9ca3af' }}>Nenhum departamento. Crie setores como Suporte, Comercial, Cancelamento.</p>
          )}
          {departments.map(d => (
            <div key={d.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid #e7e5df', borderRadius: '10px', padding: '10px 12px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: d.color || '#16a34a', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: '13.5px', fontWeight: 600, color: '#1f2937' }}>{d.name}</span>
                <button onClick={() => openMembers(d.id)} className="settings-btn-ghost" style={{ padding: '6px 10px' }}>
                  <Users size={13} /> Membros
                </button>
                <button onClick={() => removeDepartment(d)} title="Excluir"
                  style={{ padding: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                  <Trash2 size={14} />
                </button>
              </div>

              {editMembersFor?.id === d.id && renderMemberEditor('0 0 10px 10px')}
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px dashed #e0ded8', paddingTop: '14px', display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <label className="settings-label">Novo departamento</label>
            <input className="settings-input" value={newDept.name}
              onChange={e => setNewDept({ ...newDept, name: e.target.value })} placeholder="Ex: Suporte" />
          </div>
          <div style={{ display: 'flex', gap: '6px', paddingBottom: '8px' }}>
            {PALETTE.map(c => (
              <button key={c} onClick={() => setNewDept({ ...newDept, color: c })}
                style={{ width: '20px', height: '20px', borderRadius: '50%', background: c, border: newDept.color === c ? '2px solid #1f2937' : '2px solid transparent', cursor: 'pointer' }} />
            ))}
          </div>
          <button className="settings-btn-primary" onClick={addDepartment} disabled={addingDept}>
            {addingDept ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Adicionar
          </button>
        </div>
      </>)}

      {/* ── Roteamento: matriz canal × departamento ── */}
      {/* ── Copys e textos padrão do módulo ── */}
      {renderSection('copies', 'Textos padrão', 'Saudações, horários, transferências e mensagens automáticas', <>
        <p className="settings-card-title">Copys e textos padrão</p>
        <p style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '12px' }}>
          Textos automáticos usados pelo módulo WhatsApp. Você pode usar variáveis como
          {' '}<code>{'{{saudacao}}'}</code>, <code>{'{{agente.nome}}'}</code>, <code>{'{{agente.primeiro_nome}}'}</code>,
          {' '}<code>{'{{cliente.nome}}'}</code>, <code>{'{{cliente.primeiro_nome}}'}</code>, <code>{'{{cliente.primeiro_nome_com_virgula}}'}</code>,
          {' '}<code>{'{{url}}'}</code>, <code>{'{{destino}}'}</code>, <code>{'{{setor}}'}</code>, <code>{'{{inicio}}'}</code>, <code>{'{{fim}}'}</code> e <code>{'{{itens}}'}</code>.
        </p>
        <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px' }}>
          Importante: esta seção edita a <strong>copy</strong>. O <strong>horário comercial real</strong> continua sendo configurado por canal na seção acima.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <label className="settings-label">Apresentação ao aceitar transferência</label>
            <textarea className="settings-input" rows={2} style={{ resize: 'vertical' }} value={copyConfig.accept_presentation_template}
              onChange={e => setCopyConfig(prev => ({ ...prev, accept_presentation_template: e.target.value }))} />
          </div>
          <div>
            <label className="settings-label">Mensagem de transferência para responsável</label>
            <textarea className="settings-input" rows={2} style={{ resize: 'vertical' }} value={copyConfig.transfer_to_agent_template}
              onChange={e => setCopyConfig(prev => ({ ...prev, transfer_to_agent_template: e.target.value }))} />
          </div>
          <div>
            <label className="settings-label">Mensagem de transferência para setor</label>
            <textarea className="settings-input" rows={2} style={{ resize: 'vertical' }} value={copyConfig.transfer_to_department_template}
              onChange={e => setCopyConfig(prev => ({ ...prev, transfer_to_department_template: e.target.value }))} />
          </div>
          <div>
            <label className="settings-label">Mensagem padrão do link de kit</label>
            <textarea className="settings-input" rows={3} style={{ resize: 'vertical' }} value={copyConfig.kit_link_message_template}
              onChange={e => setCopyConfig(prev => ({ ...prev, kit_link_message_template: e.target.value }))} />
          </div>
          <div>
            <label className="settings-label">Mensagem padrão de solicitação de documentos</label>
            <textarea className="settings-input" rows={3} style={{ resize: 'vertical' }} value={copyConfig.document_request_message_template}
              onChange={e => setCopyConfig(prev => ({ ...prev, document_request_message_template: e.target.value }))} />
          </div>
          <div>
            <label className="settings-label">Mensagem padrão ao encerrar atendimento</label>
            <textarea className="settings-input" rows={2} style={{ resize: 'vertical' }} value={copyConfig.close_farewell_default}
              onChange={e => setCopyConfig(prev => ({ ...prev, close_farewell_default: e.target.value }))} />
          </div>
          <div>
            <label className="settings-label">Copy fora do horário</label>
            <textarea className="settings-input" rows={2} style={{ resize: 'vertical' }} value={copyConfig.outside_hours_fallback_message}
              onChange={e => setCopyConfig(prev => ({ ...prev, outside_hours_fallback_message: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="settings-label">Copy do resumo de horário comercial</label>
            <textarea className="settings-input" rows={2} style={{ resize: 'vertical' }} value={copyConfig.outside_hours_schedule_template}
              onChange={e => setCopyConfig(prev => ({ ...prev, outside_hours_schedule_template: e.target.value }))} />
            <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '6px' }}>
              Use <code>{'{{inicio}}'}</code> e <code>{'{{fim}}'}</code> para montar a frase com a faixa configurada no canal.
            </p>
          </div>
        </div>
        <div className="settings-save-bar" style={{ marginTop: '16px' }}>
          <button className="settings-btn-primary" onClick={saveCopyConfig} disabled={savingCopy}>
            {savingCopy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar copys do WhatsApp
          </button>
        </div>
      </>)}

      {/* ── Modelos de mensagem (templates/macros) ── */}
      {renderSection('templates', 'Modelos de mensagem', `${templates.length} modelo${templates.length !== 1 ? 's' : ''} cadastrado${templates.length !== 1 ? 's' : ''}`, <>
        <p className="settings-card-title">Modelos de mensagem</p>
        <p style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '12px' }}>
          Mensagens padrão para a equipe inserir na conversa. Variáveis:{' '}
          <code>{'{{cliente.nome}}'}</code>, <code>{'{{cliente.telefone}}'}</code>, <code>{'{{agente.nome}}'}</code>, <code>{'{{processo.numero}}'}</code>, <code>{'{{saudacao}}'}</code>.
        </p>
        <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px' }}>
          Os modelos existentes podem ser editados diretamente aqui.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
          {templates.length === 0 && (
            <p style={{ fontSize: '12.5px', color: '#9ca3af' }}>Nenhum modelo ainda.</p>
          )}
          {templates.map(t => (
            <div key={t.id} style={{ border: '1px solid #e7e5df', borderRadius: '10px', padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#1f2937' }}>{t.name}</span>
                {t.category && <span style={{ fontSize: '10.5px', fontWeight: 600, color: '#6b7280', background: '#f2f4f6', padding: '1px 6px', borderRadius: '6px' }}>{t.category}</span>}
                <button onClick={() => startEditTemplate(t)} title="Editar modelo"
                  style={{ marginLeft: 'auto', padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
                  <Pencil size={14} />
                </button>
                <button onClick={() => removeTemplate(t)} title="Excluir modelo"
                  style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                  <Trash2 size={14} />
                </button>
              </div>
              {editingTplId === t.id ? (
                <div style={{ marginTop: '10px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <label className="settings-label">Nome</label>
                      <input className="settings-input" value={tplDraft.name}
                        onChange={e => setTplDraft(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Ex: Pedir documento" />
                    </div>
                    <div>
                      <label className="settings-label">Categoria (opcional)</label>
                      <input className="settings-input" value={tplDraft.category}
                        onChange={e => setTplDraft(prev => ({ ...prev, category: e.target.value }))}
                        placeholder="espera, documento..." />
                    </div>
                  </div>
                  <label className="settings-label">Corpo</label>
                  <textarea className="settings-input" rows={4} style={{ resize: 'vertical' }} value={tplDraft.body}
                    onChange={e => setTplDraft(prev => ({ ...prev, body: e.target.value }))}
                    placeholder="Olá {{cliente.nome}}, ..." />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                    <button className="settings-btn-ghost" onClick={cancelEditTemplate}>
                      <X size={13} /> Cancelar
                    </button>
                    <button className="settings-btn-primary" onClick={() => saveTemplateEdit(t)} disabled={savingTplId === t.id}>
                      {savingTplId === t.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar edição
                    </button>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px', whiteSpace: 'pre-wrap' }}>{t.body}</p>
              )}
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px dashed #e0ded8', paddingTop: '14px' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280', marginBottom: '10px' }}>Novo modelo</p>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label className="settings-label">Nome</label>
              <input className="settings-input" value={newTpl.name}
                onChange={e => setNewTpl({ ...newTpl, name: e.target.value })} placeholder="Ex: Pedir documento" />
            </div>
            <div>
              <label className="settings-label">Categoria (opcional)</label>
              <input className="settings-input" value={newTpl.category}
                onChange={e => setNewTpl({ ...newTpl, category: e.target.value })} placeholder="espera, documento…" />
            </div>
          </div>
          <label className="settings-label">Corpo</label>
          <textarea className="settings-input" rows={3} style={{ resize: 'vertical' }} value={newTpl.body}
            onChange={e => setNewTpl({ ...newTpl, body: e.target.value })}
            placeholder="Olá {{cliente.nome}}, ..." />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
            <button className="settings-btn-primary" onClick={addTemplate} disabled={addingTpl}>
              {addingTpl ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Adicionar modelo
            </button>
          </div>
        </div>
      </>)}

      {/* ── Agentes de IA ──
          Prompt, playbook, modelo, ações permitidas, canais atendidos, horários,
          limites e política de follow-up. Tudo isto é configuração do
          ESCRITÓRIO, não de um atendimento — e por isso é de administrador.

          A trava é do banco: `wa_ai_assistants_escrita`, `ai_config_escrita`,
          `ai_playbooks_escrita` e `wa_ai_agents_escrita` exigem `wa_is_admin()`.
          O que muda aqui é o outro lado: Configurações é aberta a três cargos
          (admin, advogado e AUXILIAR), então o auxiliar via o editor de prompt
          inteiro, escrevia, clicava em salvar e colhia um erro de RLS cru. Não
          mostrar é o certo — a opção proibida não deve aparecer. */}
      {renderSection('agents', 'Agentes de IA', 'Assistente que atende sozinho no WhatsApp',
        podeConfigurarIa(escopo) ? (
          <AiAssistantsPanel channels={channels} onFeedback={onFeedback} />
        ) : (
          <div style={{
            border: '1px solid #e7e5df', borderRadius: '10px', padding: '18px',
            background: '#fafaf9', display: 'flex', gap: '12px', alignItems: 'flex-start',
          }}>
            <Bot size={18} style={{ color: '#9ca3af', flexShrink: 0, marginTop: '1px' }} />
            <div>
              <p style={{ fontSize: '13px', fontWeight: 700, color: '#374151', marginBottom: '4px' }}>
                Somente administradores configuram os agentes de IA
              </p>
              <p style={{ fontSize: '12.5px', color: '#6b7280', lineHeight: 1.5 }}>
                Prompt, modelo, ações permitidas, canais atendidos e política de retomada
                valem para o escritório inteiro. Durante o atendimento, os controles da IA
                daquela conversa — pausar, retomar, assumir e ver o resumo — ficam no módulo
                do WhatsApp, na faixa do alto da conversa.
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WhatsAppIntegrationSettings;
