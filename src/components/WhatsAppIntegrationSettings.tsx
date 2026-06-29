import React, { useCallback, useEffect, useState } from 'react';
import {
  Save, Loader2, Eye, EyeOff, Plus, Trash2, QrCode, Check, Users, X, Phone,
  Clock, BellOff, Bot, Pencil, MessageSquare, Share2,
} from 'lucide-react';
import {
  settingsService,
  WHATSAPP_EVOLUTION_DEFAULTS,
  WHATSAPP_MODULE_DEFAULTS,
  type WhatsAppEvolutionConfig,
  type WhatsAppChannelDepartmentRouting,
  type WhatsAppModuleConfig,
} from '../services/settings.service';
import { whatsappService, type StaffOption } from '../services/whatsapp.service';
import type {
  WhatsAppChannel, WhatsAppDepartment, WhatsAppTemplate, WhatsAppBusinessHoursRow,
  WhatsAppAiChannelConfig, WhatsAppAiPlaybook, AiPlaybookQuestion,
} from '../types/whatsapp.types';

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

const BR_TIMEZONES = [
  { label: 'Cuiabá / Manaus (MT, AM, RO, RR) — UTC-4', value: 'America/Cuiaba' },
  { label: 'Brasília / São Paulo (GMT-3)', value: 'America/Sao_Paulo' },
  { label: 'Manaus — UTC-4 sem horário de verão', value: 'America/Manaus' },
  { label: 'Rio Branco (AC) — UTC-5', value: 'America/Rio_Branco' },
  { label: 'Fernando de Noronha — UTC-2', value: 'America/Noronha' },
];

const PALETTE = ['#ea6c00', '#16a34a', '#2563eb', '#9333ea', '#dc2626', '#0891b2', '#ca8a04', '#db2777'];

interface Props {
  requirePin: (opts: any) => Promise<boolean>;
  userName?: string;
  onFeedback: (type: 'error' | 'success', msg: string) => void;
}

const statusColor = (s: string) => s === 'connected' ? '#16a34a' : s === 'connecting' ? '#f59e0b' : '#9ca3af';
const statusLabel = (s: string) => s === 'connected' ? 'Conectado' : s === 'connecting' ? 'Conectando…' : 'Desconectado';

const WhatsAppIntegrationSettings: React.FC<Props> = ({ requirePin, userName, onFeedback }) => {
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
  const [activeSection, setActiveSection] = useState<'connection' | 'channels' | 'departments' | 'routing' | 'copies' | 'templates' | 'playbooks'>('connection');
  const [activeChannelSection, setActiveChannelSection] = useState<'list' | 'new'>('list');
  const [loading, setLoading] = useState(true);

  // formulário de canal
  const [newCh, setNewCh] = useState({ name: '', instance_name: '', phone_number: '', color: PALETTE[0] });
  const [addingCh, setAddingCh] = useState(false);
  // Fase J: config de IA por canal e playbooks
  const [playbooks, setPlaybooks] = useState<WhatsAppAiPlaybook[]>([]);
  const [aiConfigs, setAiConfigs] = useState<Record<string, WhatsAppAiChannelConfig>>({});
  const [aiOpenFor, setAiOpenFor] = useState<string | null>(null);
  const [savingAi, setSavingAi] = useState(false);
  const [addingPb, setAddingPb] = useState(false);
  const [newPb, setNewPb] = useState({ name: '', description: '', category: 'intake', welcome_message: '', handoff_message: '', questions: '' });

  // Fase N: horários, ausência e timezone por canal
  const [hoursOpenFor, setHoursOpenFor] = useState<string | null>(null);
  const [hoursData, setHoursData] = useState<WhatsAppBusinessHoursRow[]>([]);
  const [absence, setAbsence] = useState({ message: '', enabled: false, timezone: 'America/Cuiaba' });
  const [savingHours, setSavingHours] = useState(false);
  // QR / conexão por canal
  const [qrFor, setQrFor] = useState<{ id: string; qr?: string; status: string } | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  // formulário de departamento
  const [newDept, setNewDept] = useState({ name: '', color: PALETTE[1] });
  const [addingDept, setAddingDept] = useState(false);
  // membros (canal ou departamento — mesmo editor)
  const [editMembersFor, setEditMembersFor] = useState<{ id: string } | null>(null);
  const [memberSel, setMemberSel] = useState<Set<string>>(new Set());
  const [savingMembers, setSavingMembers] = useState(false);

  const reload = async () => {
    try {
      const [cfg, copyCfg, routingCfg, chs, depts, st, tpls, pbs] = await Promise.all([
        settingsService.getWhatsAppEvolutionConfig(),
        settingsService.getWhatsAppModuleConfig(),
        settingsService.getWhatsAppChannelDepartmentRouting(),
        whatsappService.listChannels(),
        whatsappService.listDepartments(),
        whatsappService.listStaff(),
        whatsappService.listTemplates(),
        whatsappService.listPlaybooks().catch(() => [] as WhatsAppAiPlaybook[]),
      ]);
      setServer(cfg);
      setCopyConfig(copyCfg);
      setChannelRouting(routingCfg);
      setChannels(chs);
      setDepartments(depts);
      setStaff(st);
      setTemplates(tpls);
      setPlaybooks(pbs);
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
    setHoursData(full);
  }, [hoursOpenFor]);

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

  const saveServer = async () => {
    const pinOk = await requirePin({
      action: 'update_whatsapp_server', resourceType: 'setting', sensitivity: 'critical',
      title: 'Salvar servidor Evolution', description: 'Confirme com seu PIN para salvar as credenciais do servidor.',
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
    if (!confirm(`Excluir o canal "${ch.name || ch.instance_name}"? As conversas ficam, mas o canal sai.`)) return;
    try {
      await whatsappService.deleteChannel(ch.id);
      await reload();
      onFeedback('success', 'Canal excluído.');
    } catch (e: any) {
      onFeedback('error', e.message || 'Erro ao excluir.');
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
    if (!confirm(`Excluir o departamento "${d.name}"?`)) return;
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

  // ── IA de atendimento (Fase J) ────────────────────────────────
  const openAiPanel = useCallback(async (ch: WhatsAppChannel) => {
    if (aiOpenFor === ch.id) { setAiOpenFor(null); return; }
    setAiOpenFor(ch.id);
    if (!aiConfigs[ch.id]) {
      const cfg = await whatsappService.getAiChannelConfig(ch.id).catch(() => null);
      setAiConfigs(prev => ({
        ...prev,
        [ch.id]: cfg ?? { channel_id: ch.id, ai_enabled: false, max_ai_turns: 5, playbook_id: null, require_human_approval: false },
      }));
    }
  }, [aiOpenFor, aiConfigs]);

  const saveAiConfig = async (channelId: string) => {
    const cfg = aiConfigs[channelId];
    if (!cfg) return;
    setSavingAi(true);
    try {
      await whatsappService.upsertAiChannelConfig(channelId, {
        ai_enabled: cfg.ai_enabled,
        max_ai_turns: cfg.max_ai_turns,
        playbook_id: cfg.playbook_id || null,
        require_human_approval: cfg.require_human_approval ?? false,
      });
      onFeedback('success', 'Configuração de IA salva!');
    } catch (e: any) { onFeedback('error', e.message); }
    finally { setSavingAi(false); }
  };

  const addPlaybook = async () => {
    if (!newPb.name.trim() || !newPb.welcome_message.trim() || !newPb.handoff_message.trim()) {
      onFeedback('error', 'Preencha nome, mensagem de boas-vindas e mensagem de handoff.');
      return;
    }
    let questions: AiPlaybookQuestion[] = [];
    if (newPb.questions.trim()) {
      try {
        questions = JSON.parse(newPb.questions);
        if (!Array.isArray(questions)) throw new Error('deve ser array');
      } catch {
        onFeedback('error', 'Perguntas deve ser um JSON válido (array de objetos).');
        return;
      }
    }
    setAddingPb(true);
    try {
      await whatsappService.createPlaybook({
        name: newPb.name.trim(),
        description: newPb.description.trim() || undefined,
        category: newPb.category,
        welcome_message: newPb.welcome_message.trim(),
        questions,
        handoff_message: newPb.handoff_message.trim(),
      });
      setNewPb({ name: '', description: '', category: 'intake', welcome_message: '', handoff_message: '', questions: '' });
      const pbs = await whatsappService.listPlaybooks().catch(() => [] as WhatsAppAiPlaybook[]);
      setPlaybooks(pbs);
      onFeedback('success', 'Playbook criado.');
    } catch (e: any) { onFeedback('error', e.message); }
    finally { setAddingPb(false); }
  };

  const removePlaybook = async (pb: WhatsAppAiPlaybook) => {
    if (!confirm(`Excluir o playbook "${pb.name}"?`)) return;
    try {
      await whatsappService.deletePlaybook(pb.id);
      setPlaybooks(prev => prev.filter(p => p.id !== pb.id));
      onFeedback('success', 'Playbook excluído.');
    } catch (e: any) { onFeedback('error', e.message); }
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
    if (!confirm(`Excluir o modelo "${t.name}"?`)) return;
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

  const sectionItems = [
    { key: 'connection' as const, label: 'Conexão', summary: 'Servidor Evolution e API', icon: QrCode },
    { key: 'channels' as const, label: 'Canais', summary: 'Números, horários e IA', icon: Phone },
    { key: 'departments' as const, label: 'Departamentos', summary: 'Setores e membros', icon: Users },
    { key: 'routing' as const, label: 'Roteamento', summary: 'Canais × departamentos', icon: Share2 },
    { key: 'copies' as const, label: 'Textos padrão', summary: 'Copys operacionais', icon: Pencil },
    { key: 'templates' as const, label: 'Modelos', summary: 'Mensagens prontas', icon: MessageSquare },
    { key: 'playbooks' as const, label: 'Playbooks IA', summary: 'Fluxos automatizados', icon: Bot },
  ];

  const renderSection = (key: typeof sectionItems[number]['key'], title: string, summary: string, content: React.ReactNode) => {
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
    <div style={{ padding: '28px 40px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', gap: '20px', alignItems: 'start' }}>
        <div className="settings-card" style={{ position: 'sticky', top: '16px' }}>
          <p className="settings-card-title">WhatsApp</p>
          <p style={{ fontSize: '12.5px', color: '#9ca3af', marginBottom: '14px' }}>
            Submenu do módulo para separar conexão, canais, textos e automações.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sectionItems.map(item => {
              const active = activeSection === item.key;
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSection(item.key)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    borderRadius: '12px',
                    border: active ? '1px solid #f59e0b' : '1px solid #ebe7df',
                    background: active ? '#fff7ed' : '#fff',
                    padding: '10px 12px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                    <span style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '999px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: active ? '#fed7aa' : '#f8fafc',
                      color: active ? '#c2410c' : '#6b7280',
                      flexShrink: 0,
                    }}>
                      <Icon size={13} />
                    </span>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: active ? '#c2410c' : '#1f2937' }}>
                      {item.label}
                    </div>
                  </div>
                  <div style={{ fontSize: '11.5px', color: active ? '#9a3412' : '#9ca3af' }}>
                    {item.summary}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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

      {/* ── Canais ── */}
      {renderSection('channels', 'Canais', `${channels.length} canal${channels.length !== 1 ? 'is' : ''} configurado${channels.length !== 1 ? 's' : ''}`, <>
        <p style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '12px' }}>
          O horário comercial é configurado por canal. Em cada número, use o botão <strong>Horário comercial</strong> para definir dias,
          faixa de atendimento, fuso e a mensagem automática fora do horário.
        </p>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {[
            { key: 'list' as const, label: 'Lista de canais' },
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
                <button onClick={() => openHours(ch)} title="Horário comercial e ausência"
                  className="settings-btn-ghost" style={{ padding: '6px 10px', color: hoursOpenFor === ch.id ? '#d97706' : undefined }}>
                  <Clock size={13} /> Horário comercial
                </button>
                <button onClick={() => openAiPanel(ch)} title="Configurar IA de atendimento"
                  className="settings-btn-ghost" style={{ padding: '6px 10px', color: aiOpenFor === ch.id ? '#7c3aed' : (aiConfigs[ch.id]?.ai_enabled ? '#059669' : undefined) }}>
                  <Bot size={13} /> IA
                </button>
                <button onClick={() => removeChannel(ch)} title="Excluir canal"
                  style={{ padding: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                  <Trash2 size={14} />
                </button>
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

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
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
                  {absence.enabled && (
                    <textarea value={absence.message} onChange={e => setAbsence(a => ({ ...a, message: e.target.value }))}
                      rows={2} placeholder="Ex: Olá! No momento estamos fora do horário de atendimento. Nosso horário é de seg a sex, das 8h às 18h. Sua mensagem foi recebida e retornaremos assim que possível."
                      style={{ width: '100%', fontSize: '12px', padding: '6px 8px', borderRadius: '6px', border: '1px solid #d1d5db', resize: 'vertical', boxSizing: 'border-box' }} />
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                    <button className="settings-btn-primary" onClick={() => saveHours(ch)} disabled={savingHours}>
                      {savingHours ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar horários
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

              {/* Painel de IA por canal (Fase J) */}
              {aiOpenFor === ch.id && (() => {
                const cfg = aiConfigs[ch.id] ?? { channel_id: ch.id, ai_enabled: false, max_ai_turns: 5, playbook_id: null, require_human_approval: false };
                const setCfg = (patch: Partial<WhatsAppAiChannelConfig>) =>
                  setAiConfigs(prev => ({ ...prev, [ch.id]: { ...cfg, ...patch } }));
                return (
                  <div style={{ marginTop: '12px', border: '1px solid #e7e5df', borderRadius: '10px', padding: '14px', background: '#faf9f7' }}>
                    <p style={{ fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Bot size={13} /> IA de atendimento automático
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={cfg.ai_enabled} onChange={e => setCfg({ ai_enabled: e.target.checked })} />
                        <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#1f2937' }}>Habilitar assistente IA neste canal</span>
                      </label>
                      {cfg.ai_enabled && (
                        <>
                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>Playbook</label>
                            <select value={cfg.playbook_id || ''}
                              onChange={e => setCfg({ playbook_id: e.target.value || null })}
                              style={{ fontSize: '12px', padding: '5px 8px', borderRadius: '7px', border: '1px solid #d1d5db', background: '#fff', color: '#111827', width: '100%' }}>
                              <option value="">— Sem playbook (resposta genérica) —</option>
                              {playbooks.filter(p => p.is_active).map(p => (
                                <option key={p.id} value={p.id}>{p.name} ({p.category})</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>Máximo de turnos da IA</label>
                            <input type="number" min={1} max={20} value={cfg.max_ai_turns}
                              onChange={e => setCfg({ max_ai_turns: Math.max(1, +e.target.value) })}
                              style={{ width: '80px', fontSize: '12px', padding: '4px 8px', borderRadius: '7px', border: '1px solid #d1d5db', background: '#fff' }} />
                            <span style={{ fontSize: '11px', color: '#9ca3af', marginLeft: '8px' }}>mensagens antes de transferir para humano</span>
                          </div>
                          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={cfg.require_human_approval ?? false}
                              onChange={e => setCfg({ require_human_approval: e.target.checked })}
                              style={{ marginTop: '2px', flexShrink: 0 }} />
                            <span style={{ fontSize: '12.5px', color: '#1f2937' }}>
                              <span style={{ fontWeight: 600 }}>Exigir aprovação humana</span>
                              <span style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                                A IA não envia automaticamente — o agente revisa e aprova cada resposta antes do envio.
                              </span>
                            </span>
                          </label>
                        </>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px', gap: '8px' }}>
                      <button className="settings-btn-ghost" onClick={() => setAiOpenFor(null)}><X size={13} /> Fechar</button>
                      <button className="settings-btn-primary" onClick={() => saveAiConfig(ch.id)} disabled={savingAi}>
                        {savingAi ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar IA
                      </button>
                    </div>
                  </div>
                );
              })()}

              <p style={{ marginTop: '12px', borderTop: '1px dashed #ece7df', paddingTop: '12px', fontSize: '11.5px', color: '#9ca3af' }}>
                Os departamentos que atendem este número são definidos na aba <strong>Roteamento</strong>.
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
      {renderSection('routing', 'Roteamento', 'Quais departamentos atendem cada canal e qual é o padrão', <>
        <p className="settings-card-title">Canais × departamentos</p>
        <p style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '14px' }}>
          Marque quais setores podem atender cada número. O <strong>padrão</strong> recebe as novas conversas
          que chegam nesse canal. Um mesmo departamento pode atender vários canais.
        </p>

        {channels.length === 0 || departments.length === 0 ? (
          <p style={{ fontSize: '12.5px', color: '#9ca3af' }}>
            {channels.length === 0 ? 'Cadastre canais na aba Canais.' : 'Cadastre departamentos na aba Departamentos.'}
            {channels.length > 0 && departments.length === 0 ? '' : ''}
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
      </>)}

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
            <label className="settings-label">Saudação automática inicial</label>
            <textarea className="settings-input" rows={2} style={{ resize: 'vertical' }} value={copyConfig.auto_greeting_template}
              onChange={e => setCopyConfig(prev => ({ ...prev, auto_greeting_template: e.target.value }))} />
          </div>
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

      {/* ── Playbooks de IA (Fase J) ── */}
      {renderSection('playbooks', 'Playbooks de IA', `${playbooks.length} playbook${playbooks.length !== 1 ? 's' : ''} disponível${playbooks.length !== 1 ? 'eis' : ''}`, <>
        <p className="settings-card-title">Playbooks de atendimento IA</p>
        <p style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '12px' }}>
          Roteiros de coleta estruturada. O assistente segue a sequência de perguntas e transfere para um humano ao concluir.
          Configure quais canais usam IA na seção Canais acima.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
          {playbooks.length === 0 && <p style={{ fontSize: '12.5px', color: '#9ca3af' }}>Nenhum playbook ainda.</p>}
          {playbooks.map(pb => (
            <div key={pb.id} style={{ border: '1px solid #e7e5df', borderRadius: '10px', padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <Bot size={14} style={{ color: '#7c3aed', marginTop: '2px', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#1f2937' }}>{pb.name}</span>
                    <span style={{ fontSize: '10.5px', fontWeight: 600, color: '#7c3aed', background: '#ede9fe', padding: '1px 6px', borderRadius: '6px' }}>{pb.category}</span>
                    {!pb.is_active && <span style={{ fontSize: '10.5px', color: '#9ca3af', background: '#f3f4f6', padding: '1px 6px', borderRadius: '6px' }}>inativo</span>}
                  </div>
                  {pb.description && <p style={{ fontSize: '11.5px', color: '#6b7280', marginTop: '2px' }}>{pb.description}</p>}
                  <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '3px' }}>
                    {pb.questions.length} pergunta{pb.questions.length !== 1 ? 's' : ''} · Handoff: "{pb.handoff_message.slice(0, 60)}{pb.handoff_message.length > 60 ? '…' : ''}"
                  </p>
                </div>
                <button onClick={() => removePlaybook(pb)} title="Excluir playbook"
                  style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444', flexShrink: 0 }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px dashed #e0ded8', paddingTop: '14px' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280', marginBottom: '10px' }}>Novo playbook</p>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label className="settings-label">Nome</label>
              <input className="settings-input" value={newPb.name}
                onChange={e => setNewPb(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Triagem trabalhista" />
            </div>
            <div>
              <label className="settings-label">Categoria</label>
              <select className="settings-input" value={newPb.category} onChange={e => setNewPb(p => ({ ...p, category: e.target.value }))}>
                <option value="intake">intake — triagem inicial</option>
                <option value="followup">followup — acompanhamento</option>
                <option value="documents">documents — documentos</option>
                <option value="custom">custom — personalizado</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label className="settings-label">Descrição (opcional)</label>
            <input className="settings-input" value={newPb.description}
              onChange={e => setNewPb(p => ({ ...p, description: e.target.value }))} placeholder="Para que serve este playbook..." />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label className="settings-label">Mensagem de boas-vindas</label>
            <textarea className="settings-input" rows={2} style={{ resize: 'vertical' }} value={newPb.welcome_message}
              onChange={e => setNewPb(p => ({ ...p, welcome_message: e.target.value }))}
              placeholder="Olá! Sou o assistente do escritório. Preciso de algumas informações..." />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label className="settings-label">
              Perguntas (JSON)
              <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: '6px' }}>
                array de {'{'}"key","label","required":true,"type":"text"{'}'}</span>
            </label>
            <textarea className="settings-input" rows={4} style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '11px' }} value={newPb.questions}
              onChange={e => setNewPb(p => ({ ...p, questions: e.target.value }))}
              placeholder={'[\n  {"key":"nome","label":"Qual é o seu nome?","required":true,"type":"text"},\n  {"key":"assunto","label":"Qual o assunto?","required":true,"type":"text"}\n]'} />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label className="settings-label">Mensagem de handoff (enviada ao cliente ao finalizar)</label>
            <textarea className="settings-input" rows={2} style={{ resize: 'vertical' }} value={newPb.handoff_message}
              onChange={e => setNewPb(p => ({ ...p, handoff_message: e.target.value }))}
              placeholder="Obrigado! Vou transferir seu atendimento para um de nossos advogados." />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="settings-btn-primary" onClick={addPlaybook} disabled={addingPb}>
              {addingPb ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Criar playbook
            </button>
          </div>
        </div>
      </>)}
        </div>
      </div>
    </div>
  );
};

export default WhatsAppIntegrationSettings;
