import { useState, useEffect, useCallback } from 'react';
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
  ChevronDown,
  RefreshCw,
  Settings,
  Download,
  History,
  Filter,
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

export type UserRole = 'Advogado' | 'Auxiliar' | 'Estagiário' | 'Administrador' | 'Sócio';
type ActiveTab = 'dados' | 'profissional' | 'sobre' | 'security' | 'stats';

export interface AppProfile {
  name?: string;
  email?: string;
  avatarUrl?: string;
  role?: UserRole;
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

  const [activeTab, setActiveTab] = useState<ActiveTab>('dados');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<MessageState>(null);

  const [profileForm, setProfileForm] = useState<ProfileFormData>({
    name: initialProfile.name || 'Usuário',
    email: initialProfile.email || '',
    avatarUrl: initialProfile.avatarUrl || GENERIC_AVATAR,
    role: (initialProfile.role as UserRole) || 'Advogado',
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
      role: (initialProfile.role as UserRole) || 'Advogado',
      oab: initialProfile.oab || '',
      phone: initialProfile.phone || '',
      bio: initialProfile.bio || '',
      lawyerFullName: initialProfile.lawyerFullName || '',
    });
  }, [initialProfile]);

  const loadStats = useCallback(async () => {
    if (!user) return;

    try {
      const [clients, cases, tasks] = await Promise.all([
        clientService.listClients().catch(() => []),
        caseService.listCases().catch(() => []),
        taskService.listTasks().catch(() => []),
      ]);

      setStats({
        totalClients: clients.length,
        totalCases: cases.length,
        totalTasks: tasks.length,
        completedTasks: tasks.filter((t: any) => t.status === 'completed').length,
      });
    } catch (error) {
      console.error('Erro ao carregar estatísticas:', error);
    }
  }, [user]);

  useEffect(() => {
    if (isOpen) {
      resetProfileFormFromProps();
      loadStats();
      setMessage(null);
      setActiveTab((prev) => prev); // mantém aba ativa ao reabrir
    }
  }, [isOpen, resetProfileFormFromProps, loadStats]);

  const handleProfileChange = (field: keyof ProfileFormData, value: string) => {
    setProfileForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Selecione um arquivo de imagem válido.' });
      event.target.value = '';
      return;
    }

    const fileSizeMb = file.size / (1024 * 1024);
    if (fileSizeMb > MAX_AVATAR_SIZE_MB) {
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
        oab: payload.oab ?? undefined,
        phone: payload.phone ?? undefined,
        bio: payload.bio ?? undefined,
        lawyerFullName: payload.lawyer_full_name ?? undefined,
      });

      setMessage({ type: 'success', text: 'Perfil atualizado com sucesso!' });
      setTimeout(() => onClose(), 1000);
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error?.message || 'Erro ao atualizar perfil.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!passwordForm.newPassword || passwordForm.newPassword.length < 8) {
      setMessage({ type: 'error', text: 'A senha deve ter pelo menos 8 caracteres.' });
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setMessage({ type: 'error', text: 'As senhas não coincidem.' });
      return;
    }

    try {
      setSaving(true);
      setMessage(null);

      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      });

      if (error) throw error;

      setMessage({ type: 'success', text: 'Senha atualizada com sucesso!' });
      setPasswordForm({ newPassword: '', confirmPassword: '' });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error?.message || 'Erro ao atualizar senha.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const completionRate =
    stats.totalTasks > 0
      ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
      : 0;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-300 ring-1 ring-black/5">
        <div className="h-2 w-full bg-orange-500" />
        {/* Header Minimalista */}
        <div className="relative px-8 pt-8 pb-4 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 hover:bg-slate-50 p-2 rounded-full transition-all disabled:opacity-50"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="flex flex-col items-center text-center">
            <div className="relative group">
              <div className="w-24 h-24 rounded-full p-1 ring-2 ring-slate-100 bg-white shadow-sm">
                <img
                  src={profileForm.avatarUrl || GENERIC_AVATAR}
                  alt={profileForm.name}
                  className="w-full h-full object-cover rounded-full"
                />
              </div>
              <label className="absolute bottom-0 right-0 p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full cursor-pointer shadow-lg transition-transform hover:scale-110 active:scale-95">
                <Camera className="w-4 h-4" />
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
              </label>
            </div>
            <h2 className="mt-4 text-xl font-bold text-slate-900 tracking-tight">
              {profileForm.name}
            </h2>
            <p className="text-sm font-medium text-slate-500 flex items-center gap-2 mt-1">
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-wider">
                {profileForm.role}
              </span>
              <span>{profileForm.email}</span>
            </p>
          </div>
        </div>

        {/* Modern Tabs */}
        <div className="px-8 mt-2 flex-shrink-0">
          <div className="flex p-1 bg-slate-100 rounded-xl overflow-x-auto scrollbar-hide">
            {[
              { id: 'dados', label: 'Dados Pessoais' },
              { id: 'profissional', label: 'Profissional' },
              { id: 'sobre', label: 'Bio' },
              { id: 'security', label: 'Senha' },
              { id: 'stats', label: 'Métricas' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Message Toast */}
        {message && (
          <div className="px-8 mt-4">
            <div
              className={`rounded-xl p-3 text-sm font-medium flex items-center gap-3 animate-in slide-in-from-top-2 ${
                message.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : 'bg-red-50 text-red-700 border border-red-100'
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full ${
                  message.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'
                }`}
              />
              {message.text}
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8">
          {/* Aba Dados */}
          {activeTab === 'dados' && (
            <form onSubmit={handleSaveProfile} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="grid gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Nome Completo
                  </label>
                  <input
                    type="text"
                    value={profileForm.name}
                    onChange={(e) => handleProfileChange('name', e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Telefone
                    </label>
                    <input
                      type="tel"
                      value={profileForm.phone}
                      onChange={(e) => handleProfileChange('phone', e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      E-mail
                    </label>
                    <input
                      type="email"
                      value={profileForm.email}
                      className="w-full px-4 py-2.5 bg-slate-100 border-transparent rounded-xl text-slate-500 cursor-not-allowed"
                      disabled
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-8 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-slate-900/20 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          )}

          {/* Aba Profissional */}
          {activeTab === 'profissional' && (
            <form onSubmit={handleSaveProfile} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Cargo
                  </label>
                  <div className="relative">
                    <select
                      value={profileForm.role}
                      onChange={(e) => handleProfileChange('role', e.target.value as UserRole)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 appearance-none transition-all"
                    >
                      <option value="Advogado">Advogado</option>
                      <option value="Sócio">Sócio</option>
                      <option value="Administrador">Administrador</option>
                      <option value="Auxiliar">Auxiliar</option>
                      <option value="Estagiário">Estagiário</option>
                    </select>
                    <Briefcase className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    OAB
                  </label>
                  <input
                    type="text"
                    value={profileForm.oab}
                    onChange={(e) => handleProfileChange('oab', e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    placeholder="UF 000000"
                  />
                </div>
              </div>

              {(profileForm.role === 'Advogado' || profileForm.role === 'Sócio') && (
                <>
                  <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100">
                    <label className="block text-sm font-bold text-blue-900 mb-2">
                      Monitoramento DJEN
                    </label>
                    <p className="text-xs text-blue-700 mb-4">
                      Nome exato para busca automática de publicações no Diário de Justiça.
                    </p>
                    <input
                      type="text"
                      value={profileForm.lawyerFullName}
                      onChange={(e) => handleProfileChange('lawyerFullName', e.target.value)}
                      className="w-full px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      placeholder="Nome completo do advogado"
                    />
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm">
                    <button
                      type="button"
                      onClick={() => setDjenCardOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between text-left"
                      aria-expanded={djenCardOpen}
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Intimações DJEN</p>
                        <p className="text-xs text-slate-500">Monitoramento contínuo das comunicações judiciais pelo cron do Supabase.</p>
                      </div>
                      <span className={`rounded-full bg-slate-100 p-1.5 text-slate-500 transition-transform ${djenCardOpen ? 'rotate-180' : ''}`}>
                        <ChevronDown className="w-4 h-4" />
                      </span>
                    </button>

                    {djenCardOpen && (
                      <div className="mt-5 space-y-4 animate-in fade-in">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                          <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-600">Monitoramento contínuo</span>
                          <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-600">Sincronização automática • a cada 6h</span>
                          <span className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                            <RefreshCw className="w-3 h-3 animate-spin" /> Sincronizando...
                          </span>
                        </div>
                        <p className="text-sm text-slate-600">
                          Acompanhe todas as publicações oficiais e sincronize dados relevantes diretamente para clientes e processos vinculados.
                        </p>

                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                          >
                            <RefreshCw className="w-4 h-4" /> Atualizar status
                          </button>
                          <button
                            type="button"
                            className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            <History className="w-4 h-4" /> Gerenciar histórico
                          </button>
                          <button
                            type="button"
                            className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            <Download className="w-4 h-4" /> Exportar
                          </button>
                          <button
                            type="button"
                            className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            <Settings className="w-4 h-4" /> Configurações
                          </button>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filtros rápidos</p>
                          <div className="flex flex-wrap gap-2">
                            {['Todas', 'Pendentes', 'Com prazo', 'Arquivadas'].map((filter) => (
                              <button
                                key={filter}
                                type="button"
                                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-900 hover:text-slate-900"
                              >
                                {filter}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                          >
                            <Filter className="w-3.5 h-3.5" /> Filtros avançados
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="flex justify-end pt-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-8 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-slate-900/20 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          )}

          {/* Aba Bio */}
          {activeTab === 'sobre' && (
            <form onSubmit={handleSaveProfile} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Biografia Profissional
                </label>
                <div className="relative">
                  <textarea
                    value={profileForm.bio}
                    onChange={(e) => handleProfileChange('bio', e.target.value)}
                    rows={8}
                    className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none transition-all leading-relaxed"
                    placeholder="Compartilhe sua experiência, especializações e conquistas..."
                  />
                  <div className="absolute bottom-4 right-4 text-xs text-slate-400 pointer-events-none">
                    {profileForm.bio.length} caracteres
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-8 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-slate-900/20 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          )}

          {/* Aba Segurança */}
          {activeTab === 'security' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <form onSubmit={handlePasswordSubmit} className="space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
                  <div className="p-2 bg-rose-50 text-rose-600 rounded-lg">
                    <Key className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Alterar Senha</h3>
                    <p className="text-xs text-slate-500">Mantenha sua conta segura.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Nova Senha
                    </label>
                    <input
                      type="password"
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                      placeholder="••••••••"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Confirmar Senha
                    </label>
                    <input
                      type="password"
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-xl transition-all shadow-lg shadow-rose-600/20 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Atualizar Senha'}
                  </button>
                </div>
              </form>

              <div className="space-y-4">
                <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
                  <div className="p-2 bg-slate-50 text-slate-600 rounded-lg">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Detalhes da Conta</h3>
                    <p className="text-xs text-slate-500">Informações de registro.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <p className="text-xs text-slate-500 mb-1">ID do Usuário</p>
                    <p className="text-xs font-mono text-slate-900 truncate">{user?.id}</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <p className="text-xs text-slate-500 mb-1">Criado em</p>
                    <p className="text-sm font-medium text-slate-900">
                      {user?.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : '-'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Aba Métricas */}
          {activeTab === 'stats' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="relative p-6 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl text-white shadow-lg shadow-blue-500/20 overflow-hidden group">
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <Users className="w-5 h-5 opacity-80" />
                      <TrendingUp className="w-4 h-4 opacity-60" />
                    </div>
                    <p className="text-3xl font-bold mb-1 tracking-tight">{stats.totalClients}</p>
                    <p className="text-sm font-medium opacity-80">Clientes Ativos</p>
                  </div>
                  <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:bg-white/20 transition-colors" />
                </div>

                <div className="p-6 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow group">
                  <div className="flex items-center justify-between mb-4">
                    <Briefcase className="w-5 h-5 text-purple-600" />
                    <div className="p-1.5 bg-purple-50 rounded-lg group-hover:bg-purple-100 transition-colors">
                      <TrendingUp className="w-3.5 h-3.5 text-purple-600" />
                    </div>
                  </div>
                  <p className="text-3xl font-bold text-slate-900 mb-1 tracking-tight">{stats.totalCases}</p>
                  <p className="text-sm font-medium text-slate-500">Processos Ativos</p>
                </div>

                <div className="p-6 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow group">
                  <div className="flex items-center justify-between mb-4">
                    <CheckCircle className="w-5 h-5 text-emerald-600" />
                    <div className="p-1.5 bg-emerald-50 rounded-lg group-hover:bg-emerald-100 transition-colors">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                    </div>
                  </div>
                  <p className="text-3xl font-bold text-slate-900 mb-1 tracking-tight">{stats.completedTasks}</p>
                  <p className="text-sm font-medium text-slate-500">Tarefas Concluídas</p>
                </div>

                <div className="p-6 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow group">
                  <div className="flex items-center justify-between mb-4">
                    <Activity className="w-5 h-5 text-amber-600" />
                    <div className="p-1.5 bg-amber-50 rounded-lg group-hover:bg-amber-100 transition-colors">
                      <TrendingUp className="w-3.5 h-3.5 text-amber-600" />
                    </div>
                  </div>
                  <p className="text-3xl font-bold text-slate-900 mb-1 tracking-tight">{stats.totalTasks}</p>
                  <p className="text-sm font-medium text-slate-500">Total de Tarefas</p>
                </div>
              </div>

              <div className="p-6 bg-slate-900 rounded-2xl text-white shadow-xl relative overflow-hidden">
                <div className="relative z-10">
                  <div className="flex justify-between items-end mb-4">
                    <div>
                      <h4 className="text-lg font-bold">Produtividade</h4>
                      <p className="text-sm text-slate-400">Taxa de conclusão de tarefas</p>
                    </div>
                    <span className="text-3xl font-bold text-emerald-400">{completionRate}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-emerald-400 to-emerald-600 h-full rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${completionRate}%` }}
                    />
                  </div>
                </div>
                <div className="absolute right-0 top-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
