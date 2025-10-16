import { useState, useEffect } from 'react';
import {
  X, Save, Loader2, Camera, Shield, Key, Activity, TrendingUp, Users, 
  Briefcase, CheckCircle, Mail, Phone, Building, Award, Calendar
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { profileService } from '../services/profile.service';
import { clientService } from '../services/client.service';
import { caseService } from '../services/case.service';
import { taskService } from '../services/task.service';
import { supabase } from '../config/supabase';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: any;
  onProfileUpdate: (profile: any) => void;
}

export default function ProfileModal({ isOpen, onClose, profile: initialProfile, onProfileUpdate }: ProfileModalProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'dados' | 'profissional' | 'sobre' | 'security' | 'stats'>('dados');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const GENERIC_AVATAR = 'https://www.gravatar.com/avatar/?d=mp&s=300';

  const [profileForm, setProfileForm] = useState({
    name: initialProfile.name || 'Usuário',
    email: initialProfile.email || '',
    avatarUrl: initialProfile.avatarUrl || GENERIC_AVATAR,
    role: initialProfile.role || 'Advogado',
    oab: initialProfile.oab || '',
    phone: initialProfile.phone || '',
    bio: initialProfile.bio || '',
    lawyerFullName: initialProfile.lawyerFullName || '',
  });

  const [passwordForm, setPasswordForm] = useState({ newPassword: '', confirmPassword: '' });
  
  const [stats, setStats] = useState({
    totalClients: 0,
    totalCases: 0,
    totalTasks: 0,
    completedTasks: 0,
  });

  useEffect(() => {
    if (isOpen) {
      setProfileForm({
        name: initialProfile.name || 'Usuário',
        email: initialProfile.email || '',
        avatarUrl: initialProfile.avatarUrl || GENERIC_AVATAR,
        role: initialProfile.role || 'Advogado',
        oab: initialProfile.oab || '',
        phone: initialProfile.phone || '',
        bio: initialProfile.bio || '',
        lawyerFullName: initialProfile.lawyerFullName || '',
      });
      loadStats();
    }
  }, [isOpen, initialProfile]);

  const loadStats = async () => {
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
        completedTasks: tasks.filter(t => t.status === 'completed').length,
      });
    } catch (error) {
      console.error('Erro ao carregar estatísticas:', error);
    }
  };

  const handleProfileChange = (field: string, value: string) => {
    setProfileForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Selecione um arquivo de imagem válido.' });
      return;
    }
    try {
      const reader = new FileReader();
      reader.onload = () => {
        setProfileForm((prev) => ({ ...prev, avatarUrl: reader.result as string }));
      };
      reader.readAsDataURL(file);
    } catch (error: any) {
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
        name: profileForm.name,
        email: profileForm.email || user.email || '',
        role: profileForm.role,
        phone: profileForm.phone || null,
        oab: profileForm.oab || null,
        lawyer_full_name: profileForm.lawyerFullName || null,
        bio: profileForm.bio || null,
        avatar_url: profileForm.avatarUrl || GENERIC_AVATAR,
      };
      await profileService.upsertProfile(user.id, payload);
      onProfileUpdate({ ...profileForm, email: payload.email });
      setMessage({ type: 'success', text: 'Perfil atualizado com sucesso!' });
      setTimeout(() => onClose(), 1000);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Erro ao atualizar perfil.' });
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
      const { error } = await supabase.auth.updateUser({ password: passwordForm.newPassword });
      if (error) throw error;
      setMessage({ type: 'success', text: 'Senha atualizada com sucesso!' });
      setPasswordForm({ newPassword: '', confirmPassword: '' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Erro ao atualizar senha.' });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in duration-200">
        {/* Header Moderno */}
        <div className="relative bg-gradient-to-br from-slate-50 via-white to-slate-50 px-8 py-6 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl overflow-hidden ring-2 ring-slate-200 shadow-lg">
                  <img src={profileForm.avatarUrl || GENERIC_AVATAR} alt={profileForm.name} className="w-full h-full object-cover" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-white"></div>
              </div>
              <div>
                <h3 className="text-2xl font-bold text-slate-900">Perfil Profissional</h3>
                <p className="text-sm text-slate-600 mt-0.5">{profileForm.name} • {profileForm.role}</p>
              </div>
            </div>
            <button 
              onClick={onClose} 
              className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2.5 rounded-xl transition-all duration-200 hover:scale-110"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs Modernos */}
        <div className="px-8 pt-4 bg-slate-50/50">
          <div className="flex gap-2 overflow-x-auto">
            {[
              { id: 'dados', label: 'Dados', icon: Users },
              { id: 'profissional', label: 'Profissional', icon: Briefcase },
              { id: 'sobre', label: 'Sobre Você', icon: Award },
              { id: 'security', label: 'Segurança', icon: Shield },
              { id: 'stats', label: 'Estatísticas', icon: Activity },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-6 py-3 font-semibold rounded-t-2xl transition-all duration-200 ${
                    isActive
                      ? 'bg-white text-blue-600 shadow-sm border-t-2 border-x border-slate-200 border-t-blue-600'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`mx-8 mt-6 rounded-xl p-4 text-sm font-medium flex items-center gap-3 shadow-sm animate-in slide-in-from-top duration-300 ${
            message.type === 'success' 
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              message.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'
            }`} />
            {message.text}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 bg-white">
          {/* Aba Dados */}
          {activeTab === 'dados' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              {/* Foto de Perfil */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <h4 className="text-sm font-bold text-slate-900 mb-4">Foto de Perfil</h4>
                <div className="flex items-center gap-6">
                  <div className="flex-shrink-0">
                    <div className="relative w-28 h-28 rounded-2xl overflow-hidden ring-4 ring-blue-100 group shadow-lg">
                      <img src={profileForm.avatarUrl || GENERIC_AVATAR} alt={profileForm.name} className="w-full h-full object-cover" />
                      <label className="absolute inset-0 bg-black/0 group-hover:bg-black/70 flex items-center justify-center cursor-pointer transition-all">
                        <div className="text-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Camera className="w-7 h-7 text-white mx-auto mb-1" />
                          <span className="text-xs text-white font-medium">Alterar</span>
                        </div>
                        <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
                      </label>
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900 mb-1">Escolha uma foto profissional</p>
                    <p className="text-xs text-slate-600">JPG, PNG ou GIF. Tamanho máximo de 2MB.</p>
                  </div>
                </div>
              </div>

              {/* Informações Básicas */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <h4 className="text-sm font-bold text-slate-900 mb-3">Informações Básicas</h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Nome Completo *</label>
                    <input type="text" value={profileForm.name} onChange={(e) => handleProfileChange('name', e.target.value)} className="input-field text-sm" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">Telefone</label>
                      <input type="tel" value={profileForm.phone} onChange={(e) => handleProfileChange('phone', e.target.value)} className="input-field text-sm" placeholder="(00) 00000-0000" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">E-mail <span className="text-slate-400">(não editável)</span></label>
                      <input type="email" value={profileForm.email} className="input-field text-sm bg-slate-100 text-slate-500 cursor-not-allowed" disabled />
                    </div>
                  </div>
                </div>
              </div>

              {/* Botões de Ação */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button 
                  type="button" 
                  onClick={onClose}
                  className="px-6 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl hover:scale-105 duration-200"
                >
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando...</> : <><Save className="w-4 h-4" />Salvar Alterações</>}
                </button>
              </div>
            </form>
          )}

          {/* Aba Profissional */}
          {activeTab === 'profissional' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              {/* Informações Profissionais */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <h4 className="text-sm font-bold text-slate-900 mb-3">Informações Profissionais</h4>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">Cargo / Função</label>
                      <select value={profileForm.role} onChange={(e) => handleProfileChange('role', e.target.value)} className="input-field text-sm">
                        <option value="Advogado">Advogado</option>
                        <option value="Auxiliar">Auxiliar</option>
                        <option value="Estagiário">Estagiário</option>
                        <option value="Administrador">Administrador</option>
                        <option value="Sócio">Sócio</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">Número OAB</label>
                      <input type="text" value={profileForm.oab} onChange={(e) => handleProfileChange('oab', e.target.value)} className="input-field text-sm" placeholder="OAB/SP 12345" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Nome Completo para DJEN <span className="text-slate-400">(Opcional)</span></label>
                    <input type="text" value={profileForm.lawyerFullName} onChange={(e) => handleProfileChange('lawyerFullName', e.target.value)} className="input-field text-sm" placeholder="Nome completo para pesquisa no Diário Oficial" />
                    <p className="text-xs text-slate-500 mt-1.5 flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5">ℹ️</span>
                      <span>Utilizado para consultas automáticas no Diário de Justiça Eletrônico Nacional (DJEN)</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Botões de Ação */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button 
                  type="button" 
                  onClick={onClose}
                  className="px-6 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl hover:scale-105 duration-200"
                >
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando...</> : <><Save className="w-4 h-4" />Salvar Alterações</>}
                </button>
              </div>
            </form>
          )}

          {/* Aba Sobre Você */}
          {activeTab === 'sobre' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              {/* Biografia */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <h4 className="text-sm font-bold text-slate-900 mb-3">Sobre Você</h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Descrição Profissional</label>
                    <textarea 
                      value={profileForm.bio} 
                      onChange={(e) => handleProfileChange('bio', e.target.value)} 
                      rows={6} 
                      className="input-field text-sm resize-none" 
                      placeholder="Escreva uma breve descrição sobre você...&#10;&#10;Exemplo:&#10;• Áreas de atuação&#10;• Especialidades&#10;• Experiência profissional&#10;• Formação acadêmica" 
                    />
                    <p className="text-xs text-slate-500 mt-1.5">Esta informação pode ser útil para apresentações e perfis profissionais.</p>
                  </div>
                </div>
              </div>

              {/* Botões de Ação */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button 
                  type="button" 
                  onClick={onClose}
                  className="px-6 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl hover:scale-105 duration-200"
                >
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando...</> : <><Save className="w-4 h-4" />Salvar Alterações</>}
                </button>
              </div>
            </form>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              {/* Alterar Senha */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Alterar Senha</h4>
                    <p className="text-xs text-slate-600 mt-1">Use uma senha forte com pelo menos 8 caracteres.</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Nova Senha</label>
                    <input 
                      type="password" 
                      value={passwordForm.newPassword} 
                      onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))} 
                      className="input-field text-sm" 
                      placeholder="Mínimo 8 caracteres" 
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Confirmar Nova Senha</label>
                    <input 
                      type="password" 
                      value={passwordForm.confirmPassword} 
                      onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))} 
                      className="input-field text-sm" 
                      placeholder="Repita a senha" 
                    />
                  </div>
                </div>
              </div>

              {/* Informações da Conta */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <h4 className="text-sm font-bold text-slate-900 mb-3">Informações da Conta</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-white rounded-xl">
                    <div className="flex items-center gap-3">
                      <Mail className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-600">E-mail</span>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">{profileForm.email}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-white rounded-xl">
                    <div className="flex items-center gap-3">
                      <Calendar className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-600">Membro desde</span>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">
                      {user?.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Botões de Ação */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button 
                  type="button" 
                  onClick={() => setPasswordForm({ newPassword: '', confirmPassword: '' })}
                  className="px-6 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Limpar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl hover:scale-105 duration-200"
                >
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Atualizando...</> : <><Key className="w-4 h-4" />Atualizar Senha</>}
                </button>
              </div>
            </form>
          )}

          {/* Stats Tab */}
          {activeTab === 'stats' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <Users className="w-8 h-8 text-blue-600" />
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-2xl font-bold text-blue-900">{stats.totalClients}</div>
                  <div className="text-xs text-blue-700">Clientes</div>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
                  <div className="flex items-center justify-between mb-2">
                    <Briefcase className="w-8 h-8 text-purple-600" />
                    <TrendingUp className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="text-2xl font-bold text-purple-900">{stats.totalCases}</div>
                  <div className="text-xs text-purple-700">Processos</div>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
                  <div className="flex items-center justify-between mb-2">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                    <TrendingUp className="w-4 h-4 text-green-600" />
                  </div>
                  <div className="text-2xl font-bold text-green-900">{stats.completedTasks}</div>
                  <div className="text-xs text-green-700">Concluídas</div>
                </div>

                <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg p-4 border border-amber-200">
                  <div className="flex items-center justify-between mb-2">
                    <Activity className="w-8 h-8 text-amber-600" />
                    <TrendingUp className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="text-2xl font-bold text-amber-900">{stats.totalTasks}</div>
                  <div className="text-xs text-amber-700">Total Tarefas</div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg p-4 border border-amber-200">
                <h4 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-amber-600" />
                  Taxa de Conclusão
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600">Tarefas concluídas</span>
                    <span className="font-semibold text-slate-900">{stats.completedTasks} de {stats.totalTasks}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-gradient-to-r from-amber-500 to-orange-500 h-2 rounded-full transition-all" style={{ width: `${stats.totalTasks > 0 ? (stats.completedTasks / stats.totalTasks) * 100 : 0}%` }} />
                  </div>
                  <div className="text-xl font-bold text-amber-600">{stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0}%</div>
                </div>
              </div>

              <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                <h4 className="text-sm font-semibold text-slate-900 mb-3">Resumo Geral</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center py-1.5 border-b border-slate-200">
                    <span className="text-slate-600 flex items-center gap-2"><Users className="w-3 h-3" />Clientes gerenciados</span>
                    <span className="text-lg font-bold text-blue-600">{stats.totalClients}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-slate-200">
                    <span className="text-slate-600 flex items-center gap-2"><Briefcase className="w-3 h-3" />Processos ativos</span>
                    <span className="text-lg font-bold text-purple-600">{stats.totalCases}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5">
                    <span className="text-slate-600 flex items-center gap-2"><CheckCircle className="w-3 h-3" />Tarefas finalizadas</span>
                    <span className="text-lg font-bold text-green-600">{stats.completedTasks}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
