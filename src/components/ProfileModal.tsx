import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Save,
  Loader2,
  Camera,
  Shield,
  Key,
  Activity,
  TrendingUp,
  Users,
  Briefcase,
  CheckCircle,
  Mail,
  Award,
  Calendar,
  CalendarDays,
  ChevronDown,
  RefreshCw,
  Settings,
  Download,
  History,
  Filter,
  FileText,
  Clock,
  Bell,
  User,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { profileService } from '../services/profile.service';
import { clientService } from '../services/client.service';
import { caseService } from '../services/case.service';
import { taskService } from '../services/task.service';
import { settingsService } from '../services/settings.service';
import { djenSyncStatusService, type DjenSyncLog } from '../services/djenSyncStatus.service';
import { djenLocalService } from '../services/djenLocal.service';
import { supabase } from '../config/supabase';
import { usePermissions } from '../hooks/usePermissions';

export type UserRole = 'Administrador' | 'Advogado' | 'Auxiliar' | 'Secretária' | 'Financeiro' | 'Estagiário';
type ActiveTab = 'dados' | 'profissional' | 'sobre' | 'security' | 'stats';

export interface AppProfile {
  name?: string;
  email?: string;
  avatarUrl?: string;
  role?: UserRole;
  cpf?: string;
  oab?: string;
  phone?: string;
  bio?: string;
  lawyerFullName?: string;
}

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: AppProfile;
  onProfileUpdate: (profile: AppProfile) => void;
}

interface ProfileFormData {
  name: string;
  email: string;
  avatarUrl: string;
  role: UserRole;
  cpf: string;
  oab: string;
  phone: string;
  bio: string;
  lawyerFullName: string;
}

interface PasswordFormData {
  newPassword: string;
  confirmPassword: string;
}

interface StatsData {
  totalClients: number;
  totalCases: number;
  totalTasks: number;
  completedTasks: number;
  // Métricas de Requerimentos
  totalRequirements: number;
  requirementsInAnalysis: number;
  requirementsDeferred: number;
  // Métricas de Prazos
  totalDeadlines: number;
  overdueDeadlines: number;
  upcomingDeadlines: number;
  // Métricas de Agenda
  totalEvents: number;
  eventsThisMonth: number;
  // Métricas de Intimações
  totalIntimacoes: number;
  unreadIntimacoes: number;
}

interface DjenStatusState {
  autoSyncEnabled: boolean;
  syncIntervalHours: number;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  pendingCount: number;
}

type MessageState = { type: 'success' | 'error'; text: string } | null;

const GENERIC_AVATAR = 'https://www.gravatar.com/avatar/?d=mp&s=300';
const MAX_AVATAR_SIZE_MB = 2;

export default function ProfileModal({
  isOpen,
  onClose,
  profile: initialProfile,
  onProfileUpdate,
}: ProfileModalProps) {
  const { user } = useAuth();
  const { canView, loading: permissionsLoading } = usePermissions();

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

  const normalizeRole = useCallback((role: string) => {
    return role
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }, []);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dados');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<MessageState>(null);

  const [profileForm, setProfileForm] = useState<ProfileFormData>({
    name: initialProfile.name || 'Usuário',
    email: initialProfile.email || '',
    avatarUrl: initialProfile.avatarUrl || GENERIC_AVATAR,
    role: (initialProfile.role as UserRole) || 'Auxiliar',
    cpf: initialProfile.cpf || '',
    oab: initialProfile.oab || '',
    phone: initialProfile.phone || '',
    bio: initialProfile.bio || '',
    lawyerFullName: initialProfile.lawyerFullName || '',
  });

  const [passwordForm, setPasswordForm] = useState<PasswordFormData>({
    newPassword: '',
    confirmPassword: '',
  });

  const [stats, setStats] = useState<StatsData>({
    totalClients: 0,
    totalCases: 0,
    totalTasks: 0,
    completedTasks: 0,
    // Métricas de Requerimentos
    totalRequirements: 0,
    requirementsInAnalysis: 0,
    requirementsDeferred: 0,
    // Métricas de Prazos
    totalDeadlines: 0,
    overdueDeadlines: 0,
    upcomingDeadlines: 0,
    // Métricas de Agenda
    totalEvents: 0,
    eventsThisMonth: 0,
    // Métricas de Intimações
    totalIntimacoes: 0,
    unreadIntimacoes: 0,
  });

  const [djenCardOpen, setDjenCardOpen] = useState(false);
  const [djenStatus, setDjenStatus] = useState<DjenStatusState>({
    autoSyncEnabled: true,
    syncIntervalHours: 6,
    lastSyncAt: null,
    nextSyncAt: null,
    pendingCount: 0,
  });
  const [djenStatusLoading, setDjenStatusLoading] = useState(false);
  const [djenHistory, setDjenHistory] = useState<DjenSyncLog[]>([]);
  const [djenHistoryOpen, setDjenHistoryOpen] = useState(false);
  const [djenHistoryLoading, setDjenHistoryLoading] = useState(false);
  const [djenExporting, setDjenExporting] = useState(false);
  const [djenSettingsOpen, setDjenSettingsOpen] = useState(false);
  const [djenFiltersOpen, setDjenFiltersOpen] = useState(false);
  const [djenMessage, setDjenMessage] = useState<string | null>(null);
  const [djenFilterStatus, setDjenFilterStatus] = useState('all');
  const [djenFilterTribunal, setDjenFilterTribunal] = useState('all');
  const [djenFilterDateRange, setDjenFilterDateRange] = useState('30d');

  const formatDateTime = useCallback((iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  const refreshDjenStatus = useCallback(async () => {
    try {
      setDjenStatusLoading(true);
      setDjenMessage(null);

      const [config, logs, pending] = await Promise.all([
        settingsService.getDjenConfig(),
        djenSyncStatusService.listRecent(1).catch(() => []),
        djenLocalService.contarNaoLidas().catch(() => 0),
      ]);

      const lastLog = logs[0];
      const lastSyncAt = lastLog?.run_finished_at || lastLog?.run_started_at || null;
      const intervalHours = config.sync_interval_hours ?? 6;
      const nextSyncAt = lastSyncAt
        ? new Date(new Date(lastSyncAt).getTime() + intervalHours * 60 * 60 * 1000).toISOString()
        : null;

      setDjenStatus({
        autoSyncEnabled: config.auto_sync ?? true,
        syncIntervalHours: intervalHours,
        lastSyncAt,
        nextSyncAt,
        pendingCount: pending ?? 0,
      });

      if (lastLog?.status || lastLog?.message) {
        const statusLabel =
          lastLog.status === 'success'
            ? 'Concluída com sucesso'
            : lastLog.status === 'running'
            ? 'Sincronização em andamento'
            : 'Falhou';
        setDjenMessage(lastLog?.message || `Última sincronização: ${statusLabel}`);
      }
    } catch (error) {
      console.error('Erro ao atualizar status do DJEN:', error);
      setDjenMessage('Não foi possível atualizar o status do DJEN.');
    } finally {
      setDjenStatusLoading(false);
    }
  }, []);

  const loadDjenHistory = useCallback(async () => {
    try {
      setDjenHistoryLoading(true);
      const logs = await djenSyncStatusService.listRecent(5);
      setDjenHistory(logs);
    } catch (error) {
      console.error('Erro ao carregar histórico do DJEN:', error);
      setDjenMessage('Erro ao carregar histórico de sincronização.');
    } finally {
      setDjenHistoryLoading(false);
    }
  }, []);

  const handleExportDjen = useCallback(async () => {
    try {
      setDjenExporting(true);
      setDjenMessage(null);
      const data = await djenLocalService.listComunicacoes();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `intimacoes-djen-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setDjenMessage('Exportação concluída.');
    } catch (error) {
      console.error('Erro ao exportar intimações:', error);
      setDjenMessage('Erro ao exportar intimações.');
    } finally {
      setDjenExporting(false);
    }
  }, []);

  useEffect(() => {
    if (djenCardOpen) {
      refreshDjenStatus();
    }
  }, [djenCardOpen, refreshDjenStatus]);

  useEffect(() => {
    if (djenHistoryOpen) {
      loadDjenHistory();
    }
  }, [djenHistoryOpen, loadDjenHistory]);

  const resetProfileFormFromProps = useCallback(() => {
    setProfileForm({
      name: initialProfile.name || 'Usuário',
      email: initialProfile.email || '',
      avatarUrl: initialProfile.avatarUrl || GENERIC_AVATAR,
      role: (initialProfile.role as UserRole) || 'Auxiliar',
      cpf: initialProfile.cpf || '',
      oab: initialProfile.oab || '',
      phone: initialProfile.phone || '',
      bio: initialProfile.bio || '',
      lawyerFullName: initialProfile.lawyerFullName || '',
    });
  }, [initialProfile]);

  const canSeeProfessionalTab = normalizeRole(profileForm.role) === 'advogado';

  useEffect(() => {
    if (activeTab === 'profissional' && !canSeeProfessionalTab) {
      setActiveTab('dados');
    }
  }, [activeTab, canSeeProfessionalTab]);

  const loadStats = useCallback(async () => {
    if (!user) return;
    if (permissionsLoading) return;

    try {
      const canSeeClients = canView('clientes');
      const canSeeCases = canView('processos');
      const canSeeTasks = canView('tarefas');
      const canSeeIntimacoes = canView('intimacoes');

      const [clients, cases, tasks, intimacoes] = await Promise.all([
        canSeeClients
          ? clientService.listClients().catch((err: any) => {
              console.error('Erro ao carregar clientes:', err);
              return [];
            })
          : Promise.resolve([]),
        canSeeCases
          ? caseService.listCases().catch((err: any) => {
              console.error('Erro ao carregar casos:', err);
              return [];
            })
          : Promise.resolve([]),
        canSeeTasks
          ? taskService.listTasks().catch((err: any) => {
              console.error('Erro ao carregar tarefas:', err);
              return [];
            })
          : Promise.resolve([]),
        canSeeIntimacoes
          ? djenLocalService.listComunicacoes().catch((err: any) => {
              console.error('Erro ao carregar intimações:', err);
              return [];
            })
          : Promise.resolve([]),
      ]);

      // Carregar dados adicionais via Supabase
      const canSeeRequirements = canView('requerimentos');
      const canSeeDeadlines = canView('prazos');
      const canSeeAgenda = canView('agenda');

      const [{ data: requirements }, { data: deadlines }, { data: events }] = await Promise.all([
        canSeeRequirements ? supabase.from('requirements').select('*') : Promise.resolve({ data: [] as any[] }),
        canSeeDeadlines ? supabase.from('deadlines').select('*') : Promise.resolve({ data: [] as any[] }),
        canSeeAgenda ? supabase.from('calendar_events').select('*') : Promise.resolve({ data: [] as any[] }),
      ]);
      
      const today = new Date();
      const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      const newStats = {
        totalClients: clients.length,
        totalCases: cases.length,
        totalTasks: tasks.length,
        completedTasks: tasks.filter((t: any) => t.status === 'completed').length,
        // Métricas de Requerimentos
        totalRequirements: requirements?.length || 0,
        requirementsInAnalysis: requirements?.filter((r: any) => r.status === 'em_analise').length || 0,
        requirementsDeferred: requirements?.filter((r: any) => r.status === 'deferido').length || 0,
        // Métricas de Prazos
        totalDeadlines: deadlines?.length || 0,
        overdueDeadlines: deadlines?.filter((d: any) => new Date(d.due_date) < today).length || 0,
        upcomingDeadlines: deadlines?.filter((d: any) => {
          const dueDate = new Date(d.due_date);
          return dueDate >= today && dueDate <= nextWeek;
        }).length || 0,
        // Métricas de Agenda
        totalEvents: events?.length || 0,
        eventsThisMonth: events?.filter((e: any) => new Date(e.date) >= thisMonth).length || 0,
        // Métricas de Intimações
        totalIntimacoes: intimacoes.length,
        unreadIntimacoes: intimacoes.filter((i: any) => !i.lida).length,
      };
      setStats(newStats);
    } catch (error) {
      console.error('Erro ao carregar estatísticas:', error);
    }
  }, [user, canView, permissionsLoading]);

  useEffect(() => {
    if (isOpen) {
      resetProfileFormFromProps();
      setMessage(null);
    }
  }, [isOpen, resetProfileFormFromProps]);

  useEffect(() => {
    if (isOpen && !permissionsLoading) {
      loadStats();
    }
  }, [isOpen, permissionsLoading, loadStats]);

  const handleProfileChange = (field: keyof ProfileFormData, value: string) => {
    setProfileForm(prev => ({ ...prev, [field]: value }));
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_AVATAR_SIZE_MB * 1024 * 1024) {
      setMessage({
        type: 'error',
        text: `A imagem deve ter no máximo ${MAX_AVATAR_SIZE_MB}MB.`,
      });
      event.target.value = '';
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = () => {
        setProfileForm((prev) => ({
          ...prev,
          avatarUrl: (reader.result as string) || GENERIC_AVATAR,
        }));
      };
      reader.readAsDataURL(file);
    } catch {
      setMessage({ type: 'error', text: 'Erro ao carregar imagem.' });
    } finally {
      event.target.value = '';
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      setSaving(true);
      setMessage(null);

      const payload = {
        name: profileForm.name.trim(),
        email: profileForm.email || user.email || '',
        role: profileForm.role,
        cpf: profileForm.cpf || null,
        phone: profileForm.phone || null,
        oab: profileForm.oab || null,
        lawyer_full_name: profileForm.lawyerFullName || null,
        bio: profileForm.bio || null,
        avatar_url: profileForm.avatarUrl || GENERIC_AVATAR,
      };

      await profileService.upsertProfile(user.id, payload);

      onProfileUpdate({
        name: payload.name,
        email: payload.email,
        avatarUrl: payload.avatar_url,
        role: payload.role,
        cpf: payload.cpf ?? undefined,
        oab: payload.oab ?? undefined,
        phone: payload.phone ?? undefined,
        bio: payload.bio ?? undefined,
        lawyerFullName: payload.lawyer_full_name ?? undefined,
      });

      setMessage({ type: 'success', text: 'Perfil atualizado com sucesso!' });
    } catch (error) {
      console.error('Erro ao salvar perfil:', error);
      setMessage({ type: 'error', text: 'Erro ao salvar perfil. Tente novamente.' });
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setMessage({ type: 'error', text: 'As senhas não coincidem.' });
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      setMessage({ type: 'error', text: 'A senha deve ter pelo menos 6 caracteres.' });
      return;
    }

    try {
      setSaving(true);
      setMessage(null);

      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      });

      if (error) throw error;

      setPasswordForm({ newPassword: '', confirmPassword: '' });
      setMessage({ type: 'success', text: 'Senha atualizada com sucesso!' });
    } catch (error) {
      console.error('Erro ao atualizar senha:', error);
      setMessage({ type: 'error', text: 'Erro ao atualizar senha. Tente novamente.' });
    } finally {
      setSaving(false);
    }
  };

  const completionRate = stats.totalTasks > 0 
    ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
    : 0;

  if (!isOpen) return null;

  const content = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
        <div className="h-2 w-full bg-orange-500" />
        <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
              Perfil do Usuário
            </p>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Configurações</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900">
          {/* Tabs Navigation */}
          <div className="border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900">
            <nav className="flex space-x-8 px-8" aria-label="Tabs">
              {[
                { id: 'dados', label: 'Dados Pessoais', icon: User },
                ...(canSeeProfessionalTab ? [{ id: 'profissional', label: 'Profissional', icon: Briefcase }] : []),
                { id: 'sobre', label: 'Sobre Você', icon: Award },
                { id: 'security', label: 'Segurança', icon: Shield },
                { id: 'stats', label: 'Estatísticas', icon: TrendingUp },
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as ActiveTab)}
                    className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-8">
            {message && (
              <div
                className={`mb-6 p-4 rounded-xl border ${
                  message.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-200'
                    : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200'
                }`}
              >
                <p className="text-sm font-medium">{message.text}</p>
              </div>
            )}

            {/* Tab Contents */}
            {activeTab === 'dados' && (
              <form onSubmit={handleSaveProfile} className="space-y-6">
                <div className="flex items-center gap-6 pb-6 border-b border-slate-200">
                  <div className="relative">
                    <img
                      src={profileForm.avatarUrl}
                      alt={profileForm.name}
                      className="w-20 h-20 rounded-full object-cover ring-4 ring-slate-100"
                    />
                    <label className="absolute -bottom-1 -right-1 w-8 h-8 bg-orange-500 hover:bg-orange-600 text-white rounded-full flex items-center justify-center cursor-pointer transition-colors shadow-lg">
                      <Camera className="w-4 h-4" />
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={handleAvatarChange}
                      />
                    </label>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{profileForm.name}</h3>
                    <p className="text-sm text-slate-500">{profileForm.role}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Nome Completo
                    </label>
                    <input
                      type="text"
                      value={profileForm.name}
                      onChange={(e) => handleProfileChange('name', e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => handleProfileChange('email', e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      CPF
                    </label>
                    <input
                      type="text"
                      value={profileForm.cpf}
                      onChange={(e) => handleProfileChange('cpf', formatCpf(e.target.value))}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                      placeholder="000.000.000-00"
                      maxLength={14}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Telefone
                    </label>
                    <input
                      type="tel"
                      value={profileForm.phone}
                      onChange={(e) => handleProfileChange('phone', e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Cargo
                    </label>
                    <select
                      value={profileForm.role}
                      onChange={(e) => handleProfileChange('role', e.target.value as UserRole)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                      disabled
                    >
                      <option value="Administrador">Administrador</option>
                      <option value="Advogado">Advogado</option>
                      <option value="Auxiliar">Auxiliar</option>
                      <option value="Secretária">Secretária</option>
                      <option value="Financeiro">Financeiro</option>
                      <option value="Estagiário">Estagiário</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Salvar Alterações
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {activeTab === 'profissional' && canSeeProfessionalTab && (
              <form onSubmit={handleSaveProfile} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Nome Completo para Documentos
                    </label>
                    <input
                      type="text"
                      value={profileForm.lawyerFullName}
                      onChange={(e) => handleProfileChange('lawyerFullName', e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                      placeholder="Nome como deve aparecer em documentos jurídicos"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Número OAB
                    </label>
                    <input
                      type="text"
                      value={profileForm.oab}
                      onChange={(e) => handleProfileChange('oab', e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                      placeholder="UF 123456"
                    />
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <p className="text-sm text-blue-800">
                    <strong>Atenção:</strong> Estes dados serão utilizados para gerar documentos e petições.
                    Mantenha-os sempre atualizados.
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Salvar Alterações
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {activeTab === 'sobre' && (
              <form onSubmit={handleSaveProfile} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Biografia Profissional
                  </label>
                  <textarea
                    value={profileForm.bio}
                    onChange={(e) => handleProfileChange('bio', e.target.value)}
                    rows={6}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all resize-none"
                    placeholder="Fale sobre sua formação, especializações e áreas de atuação..."
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Salvar Alterações
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {activeTab === 'security' && (
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-6">Alterar Senha</h3>
                  <form onSubmit={handlePasswordSubmit} className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Nova Senha
                      </label>
                      <input
                        type="password"
                        value={passwordForm.newPassword}
                        onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                        placeholder="••••••••"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Confirmar Senha
                      </label>
                      <input
                        type="password"
                        value={passwordForm.confirmPassword}
                        onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                        placeholder="••••••••"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={saving}
                        className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {saving ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Atualizando...
                          </>
                        ) : (
                          <>
                            <Shield className="w-4 h-4" />
                            Atualizar Senha
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>

                <div className="border-t border-slate-200 pt-8">
                  <h3 className="text-lg font-semibold text-slate-900 mb-6">Detalhes da Conta</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-slate-50 p-4 rounded-xl">
                      <p className="text-xs text-slate-500 mb-1">ID do Usuário</p>
                      <p className="text-sm font-mono text-slate-900">{user?.id}</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-xl">
                      <p className="text-xs text-slate-500 mb-1">Criado em</p>
                      <p className="text-sm text-slate-900">
                        {user?.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : '-'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'stats' && (
              <div className="space-y-8">
                {permissionsLoading && (
                  <div className="text-sm text-slate-500">Carregando permissões...</div>
                )}

                {/* Cards Principais */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {canView('clientes') && (
                    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-2 bg-blue-100 rounded-lg">
                          <Users className="w-6 h-6 text-blue-600" />
                        </div>
                        <span className="text-2xl font-bold text-slate-900">{stats.totalClients}</span>
                      </div>
                      <p className="text-sm text-slate-600">Clientes Ativos</p>
                    </div>
                  )}

                  {canView('processos') && (
                    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-2 bg-emerald-100 rounded-lg">
                          <Briefcase className="w-6 h-6 text-emerald-600" />
                        </div>
                        <span className="text-2xl font-bold text-slate-900">{stats.totalCases}</span>
                      </div>
                      <p className="text-sm text-slate-600">Processos Ativos</p>
                    </div>
                  )}

                  {canView('tarefas') && (
                    <>
                      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <div className="p-2 bg-purple-100 rounded-lg">
                            <CheckCircle className="w-6 h-6 text-purple-600" />
                          </div>
                          <span className="text-2xl font-bold text-slate-900">{stats.completedTasks}</span>
                        </div>
                        <p className="text-sm text-slate-600">Tarefas Concluídas</p>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <div className="p-2 bg-orange-100 rounded-lg">
                            <Activity className="w-6 h-6 text-orange-600" />
                          </div>
                          <span className="text-2xl font-bold text-slate-900">{stats.totalTasks}</span>
                        </div>
                        <p className="text-sm text-slate-600">Total de Tarefas</p>
                      </div>
                    </>
                  )}
                </div>

                {/* Produtividade */}
                {canView('tarefas') && (
                  <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Produtividade</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Taxa de Conclusão</span>
                        <span className="text-lg font-bold text-orange-600">{completionRate}%</span>
                      </div>
                      <div className="w-full bg-orange-200 rounded-full h-2">
                        <div 
                          className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${completionRate}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Requerimentos */}
                {canView('requerimentos') && (
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Requerimentos</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-2xl font-bold text-slate-900">{stats.totalRequirements}</span>
                        <FileText className="w-4 h-4 text-blue-600" />
                      </div>
                      <p className="text-xs text-slate-600">Total</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-2xl font-bold text-slate-900">{stats.requirementsInAnalysis}</span>
                        <Clock className="w-4 h-4 text-yellow-600" />
                      </div>
                      <p className="text-xs text-slate-600">Em Análise</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-2xl font-bold text-slate-900">{stats.requirementsDeferred}</span>
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      </div>
                      <p className="text-xs text-slate-600">Deferidos</p>
                    </div>
                    </div>
                  </div>
                )}

                {/* Prazos */}
                {canView('prazos') && (
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Prazos</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="bg-white border border-slate-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-2xl font-bold text-slate-900">{stats.totalDeadlines}</span>
                          <Calendar className="w-4 h-4 text-slate-600" />
                        </div>
                        <p className="text-xs text-slate-600">Total</p>
                      </div>
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-2xl font-bold text-red-600">{stats.overdueDeadlines}</span>
                          <Clock className="w-4 h-4 text-red-600" />
                        </div>
                        <p className="text-xs text-red-600">Vencidos</p>
                      </div>
                      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-2xl font-bold text-yellow-600">{stats.upcomingDeadlines}</span>
                          <CalendarDays className="w-4 h-4 text-yellow-600" />
                        </div>
                        <p className="text-xs text-yellow-600">Próxima Semana</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Agenda */}
                {canView('agenda') && (
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Agenda</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="bg-white border border-slate-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-2xl font-bold text-slate-900">{stats.totalEvents}</span>
                          <Calendar className="w-4 h-4 text-blue-600" />
                        </div>
                        <p className="text-xs text-slate-600">Total de Eventos</p>
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-2xl font-bold text-blue-600">{stats.eventsThisMonth}</span>
                          <CalendarDays className="w-4 h-4 text-blue-600" />
                        </div>
                        <p className="text-xs text-blue-600">Este Mês</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Intimações DJEN */}
                {canView('intimacoes') && (
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Intimações DJEN</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="bg-white border border-slate-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-2xl font-bold text-slate-900">{stats.totalIntimacoes}</span>
                          <Bell className="w-4 h-4 text-slate-600" />
                        </div>
                        <p className="text-xs text-slate-600">Total</p>
                      </div>
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-2xl font-bold text-red-600">{stats.unreadIntimacoes}</span>
                          <Bell className="w-4 h-4 text-red-600" />
                        </div>
                        <p className="text-xs text-red-600">Não Lidas</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
