import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { profileService, type Profile } from '../services/profile.service';
import UserManagementModule from './UserManagementModule';
import {
  settingsService,
  type AuditLogEntry,
  type DjenConfig,
  type NotificationConfig,
  type OfficeIdentity,
  type Preferences,
  type RolePermission,
  type SecurityConfig,
} from '../services/settings.service';

interface UserWithProfile extends Profile {
  is_active?: boolean;
}

type SettingsSection =
  | 'identity'
  | 'users'
  | 'roles'
  | 'djen'
  | 'notifications'
  | 'preferences'
  | 'security'
  | 'audit';

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
  { key: 'configuracoes', label: 'Configurações' },
];

const SettingsModule: React.FC = () => {
  const { user } = useAuth();
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<SettingsSection>('identity');
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalSuccess, setGlobalSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Identity
  const [identity, setIdentity] = useState<OfficeIdentity>({
    name: '',
    email: '',
    phone: '',
    address: '',
    cnpj: '',
    oab_number: '',
    logo_url: '',
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);

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
  });
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
  });

  // Users
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

  const loadSettings = useCallback(async () => {
    if (!hasConfigAccess) return;
    try {
      const [identityData, djenData, notifData, prefData, secData, allUsers] = await Promise.all([
        settingsService.getOfficeIdentity(),
        settingsService.getDjenConfig(),
        settingsService.getNotificationConfig(),
        settingsService.getPreferences(),
        settingsService.getSecurityConfig(),
        settingsService.listUsers(),
      ]);
      setIdentity(identityData);
      
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

  const loadAudit = useCallback(async () => {
    if (!hasConfigAccess) return;
    setAuditLoading(true);
    try {
      const logs = await settingsService.getAuditLog({ limit: 50 });
      setAuditLog(logs);
    } catch (error) {
      setFeedback('error', 'Não foi possível carregar a auditoria.');
    } finally {
      setAuditLoading(false);
    }
  }, [hasConfigAccess]);

  useEffect(() => {
    if (activeSection === 'audit') loadAudit();
  }, [activeSection, loadAudit]);

  const saveIdentity = async () => {
    setSaving(true);
    try {
      await settingsService.updateOfficeIdentity(identity, currentProfile?.name);
      setFeedback('success', 'Identidade atualizada com sucesso.');
    } catch (error: any) {
      setFeedback('error', error.message || 'Erro ao salvar identidade.');
    } finally {
      setSaving(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    if (!term) return users;
    return users.filter((u) =>
      [u.name, u.email, u.role, u.phone, u.oab]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term)),
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
      await settingsService.updateUserProfile(
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
      );
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

  const sections = [
    { key: 'identity', label: 'Identidade', icon: Building2, description: 'Dados do escritório' },
    { key: 'users', label: 'Usuários', icon: Users, description: 'Equipe e acessos' },
    { key: 'roles', label: 'Permissões', icon: Shield, description: 'Papéis e módulos' },
    { key: 'djen', label: 'DJEN', icon: FileText, description: 'Monitoramento' },
    { key: 'notifications', label: 'Notificações', icon: Bell, description: 'Alertas inteligentes' },
    { key: 'preferences', label: 'Preferências', icon: Settings, description: 'Operação' },
    { key: 'security', label: 'Segurança', icon: ShieldCheck, description: 'Políticas' },
    { key: 'audit', label: 'Auditoria', icon: History, description: 'Registro completo' },
  ] satisfies { key: SettingsSection; label: string; icon: any; description: string }[];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <Settings className="w-5 h-5" />
            </span>
            Configurações do Sistema
          </h1>
          <p className="text-sm text-slate-500">Integração total com Supabase e controle minucioso</p>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold ${
            ROLES.find((role) => role.key === (currentProfile?.role?.toLowerCase() || ''))?.tone ||
            'bg-slate-100 text-slate-700'
          }`}
        >
          <Crown className="w-4 h-4" />
          {currentProfile?.role || 'Usuário'}
        </span>
      </header>

      {globalError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {globalError}
          <button type="button" className="ml-auto" onClick={() => setGlobalError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {globalSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <Check className="w-4 h-4" />
          {globalSuccess}
          <button type="button" className="ml-auto" onClick={() => setGlobalSuccess(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <aside className="lg:col-span-1">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm sticky top-4">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-900">Seções</p>
              <p className="text-xs text-slate-500">Integração total</p>
            </div>
            <nav className="p-2 space-y-1">
              {sections.map((section) => (
                <button
                  key={section.key}
                  onClick={() => setActiveSection(section.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition ${
                    activeSection === section.key
                      ? 'bg-amber-50 text-amber-900 border border-amber-200 shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <section.icon
                    className={`w-4 h-4 ${activeSection === section.key ? 'text-amber-600' : 'text-slate-400'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{section.label}</p>
                    <p className="text-xs text-slate-400 truncate">{section.description}</p>
                  </div>
                </button>
              ))}
            </nav>
          </div>
        </aside>

        <section className="lg:col-span-3">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            {!settingsLoaded && activeSection === 'identity' ? (
              <div className="p-12 text-center">
                <Loader2 className="w-8 h-8 text-amber-600 animate-spin mx-auto" />
                <p className="text-sm text-slate-500 mt-3">Carregando identidade...</p>
              </div>
            ) : (
              <div>
                {activeSection === 'identity' && (
                  <div className="p-6 space-y-6">
                    <header className="flex items-center gap-3">
                      <span className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-blue-600" />
                      </span>
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">Identidade e Branding</h2>
                        <p className="text-sm text-slate-500">Dados oficiais utilizados em documentos, integrações e DJEN.</p>
                      </div>
                    </header>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2">
                        <label className="text-sm font-medium text-slate-700">Nome do Escritório *</label>
                        <input
                          type="text"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-500/10"
                          value={identity.name}
                          onChange={(e) => setIdentity({ ...identity, name: e.target.value })}
                          placeholder="Ex: Montalvão Advocacia Integrada"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Email principal *</label>
                        <input
                          type="email"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-500/10"
                          value={identity.email}
                          onChange={(e) => setIdentity({ ...identity, email: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Telefone</label>
                        <input
                          type="tel"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-500/10"
                          value={identity.phone}
                          onChange={(e) => setIdentity({ ...identity, phone: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">CNPJ</label>
                        <input
                          type="text"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-500/10"
                          value={identity.cnpj}
                          onChange={(e) => setIdentity({ ...identity, cnpj: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Registro OAB</label>
                        <input
                          type="text"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-500/10"
                          value={identity.oab_number}
                          onChange={(e) => setIdentity({ ...identity, oab_number: e.target.value })}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-sm font-medium text-slate-700">Endereço completo</label>
                        <textarea
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-500/10"
                          rows={2}
                          value={identity.address}
                          onChange={(e) => setIdentity({ ...identity, address: e.target.value })}
                          placeholder="Rua, número, bairro, cidade, UF"
                        />
                      </div>
                      <div className="md:col-span-2 space-y-2">
                        <label className="text-sm font-medium text-slate-700">URL do logo</label>
                        <input
                          type="url"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-500/10"
                          value={identity.logo_url}
                          onChange={(e) => setIdentity({ ...identity, logo_url: e.target.value })}
                          placeholder="https://"
                        />
                        {identity.logo_url && (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 inline-flex items-center gap-3">
                            <img src={identity.logo_url} alt="Logo" className="h-12 object-contain" />
                            <span className="text-xs text-slate-500">Pré-visualização</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-slate-200 pt-4 flex justify-end">
                      <button
                        onClick={saveIdentity}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Salvar identidade
                      </button>
                    </div>
                  </div>
                )}

                {activeSection === 'users' && <UserManagementModule />}

                {activeSection === 'roles' && (
                  <div className="p-6 space-y-6">
                    <header className="flex items-center gap-3">
                      <span className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                        <Shield className="w-5 h-5 text-emerald-600" />
                      </span>
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">Permissões e módulos</h2>
                        <p className="text-sm text-slate-500">Configure o que cada papel pode visualizar ou alterar.</p>
                      </div>
                    </header>

                    <div className="flex flex-wrap gap-2">
                      {ROLES.map((role) => (
                        <button
                          key={role.key}
                          onClick={() => setSelectedRole(role.key)}
                          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                            selectedRole === role.key
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                              : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {role.label}
                        </button>
                      ))}
                    </div>

                    {permissionsLoading ? (
                      <div className="py-8 text-center">
                        <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                              <th className="px-3 py-2 text-left font-semibold text-slate-600">Módulo</th>
                              <th className="px-3 py-2 text-center font-semibold text-slate-600">Ver</th>
                              <th className="px-3 py-2 text-center font-semibold text-slate-600">Criar</th>
                              <th className="px-3 py-2 text-center font-semibold text-slate-600">Editar</th>
                              <th className="px-3 py-2 text-center font-semibold text-slate-600">Excluir</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {MODULES.map((module) => {
                              const rolePerm = rolePermissions.find((perm) => perm.module === module.key);
                              const disabled = selectedRole === 'administrador';
                              return (
                                <tr key={module.key} className="hover:bg-slate-50">
                                  <td className="px-3 py-2 font-medium text-slate-700">{module.label}</td>
                                  {(['can_view', 'can_create', 'can_edit', 'can_delete'] as const).map((field) => (
                                    <td key={field} className="px-3 py-2 text-center">
                                      <button
                                        disabled={disabled}
                                        onClick={() => updatePermission(module.key, field, !(rolePerm as any)?.[field])}
                                        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-white transition ${
                                          (rolePerm as any)?.[field] || disabled
                                            ? 'bg-emerald-500'
                                            : 'bg-slate-200 text-slate-400 hover:bg-slate-300'
                                        } ${disabled ? 'opacity-70 cursor-not-allowed' : ''}`}
                                      >
                                        {(rolePerm as any)?.[field] || disabled ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                                      </button>
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {selectedRole === 'administrador' && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                        Administradores possuem todas as permissões e não podem ser limitados.
                      </div>
                    )}
                  </div>
                )}

                {activeSection === 'audit' && (
                  <div className="p-6 space-y-4">
                    <header className="flex items-center gap-3">
                      <span className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
                        <History className="w-5 h-5 text-slate-600" />
                      </span>
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">Registro de auditoria</h2>
                        <p className="text-sm text-slate-500">Todas as alterações são auditadas no Supabase.</p>
                      </div>
                    </header>

                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-400">Mostrando as 50 alterações mais recentes.</p>
                      <button
                        onClick={loadAudit}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Atualizar
                      </button>
                    </div>

                    {auditLoading ? (
                      <div className="py-10 text-center">
                        <Loader2 className="w-8 h-8 text-slate-600 animate-spin mx-auto" />
                      </div>
                    ) : auditLog.length === 0 ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                        Nenhum registro encontrado.
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[500px] overflow-y-auto">
                        {auditLog.map((entry) => (
                          <div key={entry.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                            <div className="flex items-center justify-between text-xs text-slate-400">
                              <span>{new Date(entry.created_at).toLocaleString('pt-BR')}</span>
                              <span>{entry.user_name || 'Sistema'}</span>
                            </div>
                            <p className="text-sm font-semibold text-slate-900 mt-1">{entry.action}</p>
                            <p className="text-xs text-slate-500">
                              {entry.entity_type}
                              {entry.entity_id && <span className="ml-1 text-slate-400">#{entry.entity_id}</span>}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeSection === 'djen' && (
                  <div className="p-6 space-y-6">
                    <header className="flex items-center gap-3">
                      <span className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
                        <FileText className="w-5 h-5 text-indigo-600" />
                      </span>
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">Configurações do DJEN</h2>
                        <p className="text-sm text-slate-500">Diário de Justiça Eletrônico Nacional</p>
                      </div>
                    </header>

                    <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Sincronização Automática</p>
                        <p className="text-xs text-slate-500">Buscar intimações automaticamente</p>
                      </div>
                      <button
                        onClick={() => setDjenConfig({ ...djenConfig, auto_sync: !djenConfig.auto_sync })}
                        className={`w-12 h-7 rounded-full transition-colors ${djenConfig.auto_sync ? 'bg-emerald-500' : 'bg-slate-300'}`}
                      >
                        <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${djenConfig.auto_sync ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-slate-700">Tribunal Padrão</label>
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
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
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
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
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
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
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={djenConfig.api_timeout_seconds}
                          onChange={(e) => setDjenConfig({ ...djenConfig, api_timeout_seconds: parseInt(e.target.value) || 30 })}
                        />
                      </div>
                    </div>

                    <div className="border-t border-slate-200 pt-6">
                      <h3 className="text-sm font-semibold text-slate-900 mb-3">Advogados Monitorados</h3>
                      <p className="text-xs text-slate-500 mb-4">Nomes que serão buscados nas publicações do DJEN (use o nome exato como aparece no diário).</p>
                      <div className="space-y-2">
                        {djenConfig.lawyers_to_monitor.map((name, idx) => (
                          <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
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
                            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
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
                            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-200 pt-4 flex justify-end">
                      <button
                        onClick={async () => {
                          setSaving(true);
                          try {
                            await settingsService.updateDjenConfig(djenConfig, currentProfile?.name);
                            setFeedback('success', 'Configurações DJEN salvas!');
                          } catch (err: any) {
                            setFeedback('error', err.message || 'Erro ao salvar.');
                          } finally {
                            setSaving(false);
                          }
                        }}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Salvar DJEN
                      </button>
                    </div>
                  </div>
                )}

                {activeSection === 'notifications' && (
                  <div className="p-6 space-y-6">
                    <header className="flex items-center gap-3">
                      <span className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
                        <Bell className="w-5 h-5 text-amber-600" />
                      </span>
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">Notificações</h2>
                        <p className="text-sm text-slate-500">Configure alertas e lembretes</p>
                      </div>
                    </header>

                    <div className="space-y-4">
                      {[
                        { key: 'email_enabled', label: 'Notificações por Email', desc: 'Receba alertas no seu email', icon: Mail },
                        { key: 'push_enabled', label: 'Notificações Push', desc: 'Alertas no navegador', icon: Bell },
                        { key: 'new_intimation_alert', label: 'Alertas de Intimações', desc: 'Aviso imediato de novas intimações', icon: FileText },
                        { key: 'daily_digest', label: 'Resumo Diário', desc: 'Email com resumo das atividades', icon: Mail },
                      ].map((item) => (
                        <div key={item.key} className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200">
                          <div className="flex items-center gap-3">
                            <item.icon className="w-5 h-5 text-slate-400" />
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                              <p className="text-xs text-slate-500">{item.desc}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setNotificationConfig({ ...notificationConfig, [item.key]: !(notificationConfig as any)[item.key] })}
                            className={`w-12 h-7 rounded-full transition-colors ${(notificationConfig as any)[item.key] ? 'bg-emerald-500' : 'bg-slate-300'}`}
                          >
                            <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${(notificationConfig as any)[item.key] ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-slate-700">Horário do Resumo Diário</label>
                        <input
                          type="time"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={notificationConfig.digest_time}
                          onChange={(e) => setNotificationConfig({ ...notificationConfig, digest_time: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Lembrete de Prazos (dias antes)</label>
                        <input
                          type="text"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={notificationConfig.deadline_reminder_days.join(', ')}
                          onChange={(e) => setNotificationConfig({ ...notificationConfig, deadline_reminder_days: e.target.value.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)) })}
                          placeholder="1, 3, 7"
                        />
                        <p className="text-xs text-slate-400 mt-1">Separados por vírgula (ex: 1, 3, 7)</p>
                      </div>
                    </div>

                    <div className="border-t border-slate-200 pt-4 flex justify-end">
                      <button
                        onClick={async () => {
                          setSaving(true);
                          try {
                            await settingsService.updateNotificationConfig(notificationConfig, currentProfile?.name);
                            setFeedback('success', 'Notificações salvas!');
                          } catch (err: any) {
                            setFeedback('error', err.message || 'Erro ao salvar.');
                          } finally {
                            setSaving(false);
                          }
                        }}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Salvar Notificações
                      </button>
                    </div>
                  </div>
                )}

                {activeSection === 'preferences' && (
                  <div className="p-6 space-y-6">
                    <header className="flex items-center gap-3">
                      <span className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
                        <Settings className="w-5 h-5 text-slate-600" />
                      </span>
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">Preferências Operacionais</h2>
                        <p className="text-sm text-slate-500">Configurações gerais do sistema</p>
                      </div>
                    </header>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-slate-700">Fuso Horário</label>
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
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
                        <label className="text-sm font-medium text-slate-700">Formato de Data</label>
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
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
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={preferences.default_deadline_days}
                          onChange={(e) => setPreferences({ ...preferences, default_deadline_days: parseInt(e.target.value) || 15 })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Moeda</label>
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={preferences.currency}
                          onChange={(e) => setPreferences({ ...preferences, currency: e.target.value })}
                        >
                          <option value="BRL">Real (R$)</option>
                          <option value="USD">Dólar (US$)</option>
                          <option value="EUR">Euro (€)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Horário Comercial - Início</label>
                        <input
                          type="time"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={preferences.business_hours_start}
                          onChange={(e) => setPreferences({ ...preferences, business_hours_start: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Horário Comercial - Fim</label>
                        <input
                          type="time"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={preferences.business_hours_end}
                          onChange={(e) => setPreferences({ ...preferences, business_hours_end: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="border-t border-slate-200 pt-4 flex justify-end">
                      <button
                        onClick={async () => {
                          setSaving(true);
                          try {
                            await settingsService.updatePreferences(preferences, currentProfile?.name);
                            setFeedback('success', 'Preferências salvas!');
                          } catch (err: any) {
                            setFeedback('error', err.message || 'Erro ao salvar.');
                          } finally {
                            setSaving(false);
                          }
                        }}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Salvar Preferências
                      </button>
                    </div>
                  </div>
                )}

                {activeSection === 'security' && (
                  <div className="p-6 space-y-6">
                    <header className="flex items-center gap-3">
                      <span className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center">
                        <ShieldCheck className="w-5 h-5 text-red-600" />
                      </span>
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">Segurança</h2>
                        <p className="text-sm text-slate-500">Políticas de acesso e auditoria</p>
                      </div>
                    </header>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-slate-700">Timeout da Sessão (horas)</label>
                        <input
                          type="number"
                          min="1"
                          max="24"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={securityConfig.session_timeout_hours}
                          onChange={(e) => setSecurityConfig({ ...securityConfig, session_timeout_hours: parseInt(e.target.value) || 6 })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Tentativas Máximas de Login</label>
                        <input
                          type="number"
                          min="3"
                          max="10"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={securityConfig.max_login_attempts}
                          onChange={(e) => setSecurityConfig({ ...securityConfig, max_login_attempts: parseInt(e.target.value) || 5 })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Tamanho Mínimo da Senha</label>
                        <input
                          type="number"
                          min="6"
                          max="20"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={securityConfig.password_min_length}
                          onChange={(e) => setSecurityConfig({ ...securityConfig, password_min_length: parseInt(e.target.value) || 8 })}
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Log de Auditoria</p>
                          <p className="text-xs text-slate-500">Registrar todas as alterações no sistema</p>
                        </div>
                        <button
                          onClick={() => setSecurityConfig({ ...securityConfig, audit_log_enabled: !securityConfig.audit_log_enabled })}
                          className={`w-12 h-7 rounded-full transition-colors ${securityConfig.audit_log_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        >
                          <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${securityConfig.audit_log_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-slate-200 pt-4 flex justify-end">
                      <button
                        onClick={async () => {
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
                        className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Salvar Segurança
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {userModalOpen && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => setUserModalOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-2xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-2 w-full bg-orange-500" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                  Formulário
                </p>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                  {selectedUser ? 'Editar usuário' : 'Novo usuário'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setUserModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 p-8 space-y-5">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <img
                    src={avatarPreview || selectedUser?.avatar_url || 'https://api.dicebear.com/7.x/initials/svg?seed=' + userFormData.name}
                    alt={userFormData.name}
                    className="h-20 w-20 rounded-full object-cover border border-slate-200"
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
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    value={userFormData.name}
                    onChange={(e) => setUserFormData((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">Email *</label>
                  <input
                    type="email"
                    disabled
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 cursor-not-allowed"
                    value={userFormData.email}
                    onChange={(e) => setUserFormData((prev) => ({ ...prev, email: e.target.value }))}
                  />
                  <p className="text-[11px] text-slate-400">O email é definido pelo convite do Supabase.</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">Papel *</label>
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
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
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
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
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    value={userFormData.phone}
                    onChange={(e) => setUserFormData((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">OAB</label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    value={userFormData.oab}
                    onChange={(e) => setUserFormData((prev) => ({ ...prev, oab: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">Nome completo no DJEN</label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    value={userFormData.lawyer_full_name}
                    onChange={(e) => setUserFormData((prev) => ({ ...prev, lawyer_full_name: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 sm:px-6 py-3">
              <div className="flex justify-end gap-3">
                <button className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500" onClick={() => setUserModalOpen(false)}>
                  Cancelar
                </button>
                <button
                  onClick={handleUserSave}
                  disabled={saving || !selectedUser}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar mudanças
                </button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl">
            <div className="px-6 py-5">
              <div className="flex items-center gap-3 text-red-600">
                <span className="rounded-full bg-red-50 p-2">
                  <Trash2 className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-lg font-semibold">Remover usuário</h3>
                  <p className="text-sm text-slate-500">
                    Essa ação remove o perfil do CRM. A conta Supabase permanecerá ativa até ser removida pelo painel de autenticação.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                <p>
                  <strong>{deleteTarget.name}</strong>
                </p>
                <p className="text-xs text-slate-400">{deleteTarget.email}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
              <button className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500" onClick={() => setDeleteTarget(null)}>
                Cancelar
              </button>
              <button
                onClick={confirmDeleteUser}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                disabled={deleteLoading}
              >
                {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Remover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsModule;
