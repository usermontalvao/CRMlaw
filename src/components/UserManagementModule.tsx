import React, { useState, useEffect } from 'react';
import { Users, Plus, Search, Mail, Briefcase, Shield, Trash2, Edit2, Loader2, Eye, EyeOff, CheckCircle2, X, UserLock } from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';

interface Profile {
  id: string;
  user_id: string | null;
  email: string;
  name: string;
  role: string;
  avatar_url?: string;
  is_active?: boolean;
  created_at: string;
  last_sign_in_at?: string;
}

const ROLES = [
  { value: 'Administrador', label: 'Administrador', description: 'Acesso total ao sistema', icon: '👑', restricted: true },
  { value: 'Advogado', label: 'Advogado', description: 'Acesso completo aos módulos jurídicos', icon: '⚖️', restricted: false },
  { value: 'Auxiliar', label: 'Auxiliar', description: 'Suporte administrativo', icon: '📋', restricted: false },
  { value: 'Secretária', label: 'Secretária', description: 'Agenda, clientes e comunicados', icon: '📞', restricted: false },
  { value: 'Financeiro', label: 'Financeiro', description: 'Controle do módulo financeiro', icon: '💰', restricted: false },
  { value: 'Estagiário', label: 'Estagiário', description: 'Perfil supervisionado', icon: '📚', restricted: false },
];

export const UserManagementModule: React.FC = () => {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editRole, setEditRole] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Form de criação
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'Auxiliar',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);

  // Verificar se usuário pode gerenciar
  const normalizeRole = (role?: string | null) => {
    if (!role) return '';
    return role
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  };

  const normalizedCurrentRole = normalizeRole(currentUserRole);
  const canManageUsers = normalizedCurrentRole === 'advogado' || normalizedCurrentRole === 'administrador';

  useEffect(() => {
    loadCurrentUserRole();
    loadProfiles();
  }, []);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const loadCurrentUserRole = async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (data) {
      setCurrentUserRole(data.role);
    }
  };

  const loadProfiles = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProfiles(data || []);
    } catch (err) {
      console.error('Erro ao carregar perfis:', err);
      setError('Erro ao carregar lista de usuários');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim() || !formData.email.trim() || !formData.password.trim()) {
      setError('Preencha todos os campos obrigatórios.');
      return;
    }

    if (formData.password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    // Regras:
    // - Advogado: pode criar qualquer cargo exceto Administrador
    // - Sócio/Administrador: pode criar qualquer cargo
    const selectedRole = ROLES.find((r) => r.value === formData.role);
    const normalizedTargetRole = normalizeRole(selectedRole?.value);
    if (normalizedCurrentRole === 'advogado') {
      if (normalizedTargetRole === 'administrador') {
        setError('Apenas Administradores podem criar usuários com cargo de Administrador.');
        return;
      }
    }

    setCreating(true);
    setError(null);

    try {
      const { error: fnError } = await supabase.functions.invoke('create-collaborator', {
        body: {
          email: formData.email,
          password: formData.password,
          name: formData.name,
          role: formData.role,
        },
      });

      if (fnError) {
        throw new Error(fnError.message);
      }

      // Reset form e recarregar
      setFormData({ name: '', email: '', role: 'Auxiliar', password: '' });
      setShowCreateModal(false);
      setSuccess(`Usuário "${formData.name}" criado com sucesso!`);
      loadProfiles();

    } catch (err: any) {
      console.error('Erro ao criar usuário:', err);
      setError(err.message || 'Erro ao criar usuário. Tente novamente.');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!confirm(`Tem certeza que deseja excluir o usuário "${userName}"? Esta ação não pode ser desfeita.`)) {
      return;
    }

    setDeleting(userId);
    try {
      // Usar Edge Function para deletar do Auth e soft delete do profile
      const { error: fnError } = await supabase.functions.invoke('delete-user', {
        body: { user_id: userId },
      });

      if (fnError) throw new Error(fnError.message);

      setSuccess(`Usuário "${userName}" excluído com sucesso!`);
      loadProfiles();
    } catch (err: any) {
      console.error('Erro ao excluir usuário:', err);
      setError(err.message || 'Erro ao excluir usuário.');
    } finally {
      setDeleting(null);
    }
  };

  const handleEditUser = (profile: Profile) => {
    setEditingUser(profile);
    setEditRole(profile.role);
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;

    setSaving(true);
    setError(null);

    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ role: editRole, updated_at: new Date().toISOString() })
        .eq('user_id', editingUser.user_id);

      if (updateError) throw updateError;

      setSuccess(`Cargo de "${editingUser.name}" atualizado para "${editRole}"!`);
      setEditingUser(null);
      loadProfiles();
    } catch (err: any) {
      console.error('Erro ao atualizar cargo:', err);
      setError('Erro ao atualizar cargo do usuário.');
    } finally {
      setSaving(false);
    }
  };

  const filteredProfiles = profiles.filter(profile =>
    profile.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    profile.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    profile.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!canManageUsers) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto text-center">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <UserLock className="w-8 h-8 text-orange-600" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Acesso Restrito</h2>
          <p className="text-slate-600">
            Apenas Advogados, Sócios ou Administradores podem gerenciar usuários do sistema.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-6 h-6 text-orange-500" />
              Gestão de Usuários
            </h1>
            <p className="text-slate-600 mt-1">
              Cadastre e gerencie colaboradores do escritório
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Novo Usuário
          </button>
        </div>

        {/* Busca */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nome, e-mail ou cargo..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
          />
        </div>
      </div>

      {/* Alertas */}
      {success && (
        <div className="mb-4 p-4 bg-emerald-50 border border-emerald-100 rounded-lg flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <p className="text-emerald-700">{success}</p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-100 rounded-lg flex items-center gap-3">
          <X className="w-5 h-5 text-red-600" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Lista de Usuários */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
          </div>
        ) : filteredProfiles.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">
              {searchTerm ? 'Nenhum usuário encontrado.' : 'Nenhum usuário cadastrado.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left p-4 font-semibold text-slate-700">Usuário</th>
                  <th className="text-left p-4 font-semibold text-slate-700">Cargo</th>
                  <th className="text-left p-4 font-semibold text-slate-700">Criado em</th>
                  <th className="text-left p-4 font-semibold text-slate-700">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.map((profile) => {
                  const roleInfo = ROLES.find(r => r.value === profile.role);
                  return (
                    <tr key={profile.user_id ?? profile.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                            {profile.avatar_url ? (
                              <img src={profile.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                            ) : (
                              <span className="text-slate-600 font-semibold">
                                {profile.name.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{profile.name}</p>
                            <p className="text-sm text-slate-500">{profile.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span>{roleInfo?.icon}</span>
                          <div>
                            <p className="font-medium text-slate-900">{profile.role}</p>
                            <p className="text-xs text-slate-500">{roleInfo?.description}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-slate-600">
                        {new Date(profile.created_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleEditUser(profile)}
                            disabled={profile.user_id === user?.id}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={profile.user_id === user?.id ? 'Você não pode editar seu próprio cargo' : 'Editar cargo'}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (!profile.user_id) {
                                setError('Usuário sem vínculo (user_id) no perfil.');
                                return;
                              }
                              handleDeleteUser(profile.user_id, profile.name);
                            }}
                            disabled={deleting === profile.user_id || profile.user_id === user?.id}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={profile.user_id === user?.id ? 'Você não pode excluir seu próprio usuário' : 'Excluir usuário'}
                          >
                            {deleting === profile.user_id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Criação */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h2 className="text-xl font-semibold text-slate-900">Criar Novo Usuário</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
                className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              {/* Nome */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Nome Completo</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  placeholder="Nome do colaborador"
                  required
                  disabled={creating}
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">E-mail</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  placeholder="email@exemplo.com"
                  required
                  disabled={creating}
                />
              </div>

              {/* Cargo */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Cargo</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  disabled={creating}
                >
                  {ROLES.filter((role) => {
                    // Administrador vê todos os cargos
                    if (normalizedCurrentRole === 'administrador') {
                      return true;
                    }
                    // Advogado vê todos exceto Administrador
                    if (normalizedCurrentRole === 'advogado') {
                      return normalizeRole(role.value) !== 'administrador';
                    }
                    // Outros cargos só veem não-restritos
                    return !role.restricted;
                  }).map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.icon} {role.label} - {role.description}
                    </option>
                  ))}
                </select>
                {normalizedCurrentRole === 'advogado' && (
                  <p className="text-xs text-slate-500 mt-1">
                    Advogados podem criar Advogado, Auxiliar, Secretária, Financeiro e Estagiário. Apenas Administradores podem criar Administradores.
                  </p>
                )}
              </div>

              {/* Senha */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Senha Temporária</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                    placeholder="Mínimo 6 caracteres"
                    required
                    disabled={creating}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Botões */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creating}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
                >
                  {creating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                      Criando...
                    </>
                  ) : (
                    'Criar Usuário'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Edição de Cargo */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Editar Cargo</h3>
              <button
                onClick={() => setEditingUser(null)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Usuário</label>
                <p className="text-slate-900 font-medium">{editingUser.name}</p>
                <p className="text-sm text-slate-500">{editingUser.email}</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Novo Cargo</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  disabled={saving}
                >
                  {ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.icon} {role.label} - {role.description}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  disabled={saving}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving || editRole === editingUser.role}
                  className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                      Salvando...
                    </>
                  ) : (
                    'Salvar'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagementModule;
