import React, { useState, useEffect } from 'react';
import { Users, Plus, Search, Shield, Trash2, Edit2, Loader2, Eye, EyeOff, CheckCircle2, X, UserLock, UserX, UserCheck, KeyRound } from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import { securityPinService, type PinMeta } from '../services/securityPin.service';
import { useSecurityPin } from '../contexts/SecurityPinContext';
import { matchesNormalizedSearch, normalizeSearchText } from '../utils/search';
import { Modal, ModalBody, ModuleSkeleton } from './ui';

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
  const { requirePin } = useSecurityPin();
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
  const [toggling, setToggling] = useState<string | null>(null);
  const [editingUserPinMeta, setEditingUserPinMeta] = useState<PinMeta | null>(null);
  const [resettingPin, setResettingPin] = useState(false);

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
    return normalizeSearchText(role);
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
        .order('is_active', { ascending: false })
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
    const selectedRole = ROLES.find((r) => r.value === formData.role);
    const normalizedTargetRole = normalizeRole(selectedRole?.value);
    if (normalizedCurrentRole === 'advogado' && normalizedTargetRole === 'administrador') {
      setError('Apenas Administradores podem criar usuários com cargo de Administrador.');
      return;
    }

    const nameSnapshot = formData.name;
    await requirePin({
      action: 'create_user',
      resourceType: 'user',
      resourceId: user?.id ?? 'new',
      sensitivity: 'high',
      title: 'Criar usuário',
      description: `Confirme seu PIN para criar o usuário "${nameSnapshot}".`,
      actionLabel: 'Criar usuário',
      onVerified: async () => {
        setCreating(true);
        setError(null);
        try {
          const { error: fnError } = await supabase.functions.invoke('create-collaborator', {
            body: { email: formData.email, password: formData.password, name: formData.name, role: formData.role },
          });
          if (fnError) throw new Error(fnError.message);
          setFormData({ name: '', email: '', role: 'Auxiliar', password: '' });
          setShowCreateModal(false);
          setSuccess(`Usuário "${nameSnapshot}" criado com sucesso!`);
          loadProfiles();
        } catch (err: any) {
          setError(err.message || 'Erro ao criar usuário. Tente novamente.');
        } finally {
          setCreating(false);
        }
      },
    });
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    await requirePin({
      action: 'delete_user',
      resourceType: 'user',
      resourceId: userId,
      sensitivity: 'high',
      title: 'Excluir usuário',
      description: `Confirme seu PIN para excluir permanentemente "${userName}". Esta ação não pode ser desfeita.`,
      actionLabel: 'Excluir permanentemente',
      onVerified: async () => {
        setDeleting(userId);
        try {
          const { error: fnError } = await supabase.functions.invoke('delete-user', { body: { user_id: userId } });
          if (fnError) throw new Error(fnError.message);
          setSuccess(`Usuário "${userName}" excluído com sucesso!`);
          loadProfiles();
        } catch (err: any) {
          setError(err.message || 'Erro ao excluir usuário.');
        } finally {
          setDeleting(null);
        }
      },
    });
  };

  const handleEditUser = (profile: Profile) => {
    setEditingUser(profile);
    setEditRole(profile.role);
    setEditingUserPinMeta(null);
    if (profile.user_id) {
      securityPinService.getPinMeta(profile.user_id)
        .then(setEditingUserPinMeta)
        .catch(() => {});
    }
  };

  const handleAdminResetPin = async () => {
    if (!editingUser?.user_id) return;
    const name = editingUser.name;
    const targetUserId = editingUser.user_id;
    await requirePin({
      action: 'reset_user_pin',
      resourceType: 'user',
      resourceId: targetUserId,
      sensitivity: 'high',
      title: 'Resetar PIN',
      description: `O PIN de "${name}" será removido. O usuário precisará criar um novo PIN na próxima ação sensível.`,
      actionLabel: 'Resetar PIN',
      onVerified: async () => {
        setResettingPin(true);
        try {
          await securityPinService.adminResetSecurityPin(targetUserId);
          setSuccess(`PIN de "${name}" removido. O usuário precisará criar um novo PIN.`);
          setEditingUserPinMeta({ has_pin: false, pin_required_setup: true });
        } catch (err: any) {
          setError(err.message || 'Erro ao resetar PIN.');
        } finally {
          setResettingPin(false);
        }
      },
    });
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    const targetName = editingUser.name;
    const targetUserId = editingUser.user_id;
    await requirePin({
      action: 'update_user_role',
      resourceType: 'user',
      resourceId: targetUserId ?? editingUser.id,
      sensitivity: 'high',
      title: 'Alterar cargo',
      description: `Confirme seu PIN para alterar o cargo de "${targetName}" para "${editRole}".`,
      actionLabel: 'Salvar cargo',
      onVerified: async () => {
        setSaving(true);
        setError(null);
        try {
          const { error: updateError } = await supabase
            .from('profiles')
            .update({ role: editRole, updated_at: new Date().toISOString() })
            .eq('user_id', targetUserId);
          if (updateError) throw updateError;
          setSuccess(`Cargo de "${targetName}" atualizado para "${editRole}"!`);
          setEditingUser(null);
          loadProfiles();
        } catch (err: any) {
          setError('Erro ao atualizar cargo do usuário.');
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const handleToggleStatus = async (profile: Profile) => {
    if (!profile.user_id) {
      setError('Usuário sem vínculo (user_id) no perfil.');
      return;
    }
    const activate = !profile.is_active;
    const targetUserId = profile.user_id;
    await requirePin({
      action: activate ? 'activate_user' : 'deactivate_user',
      resourceType: 'user',
      resourceId: targetUserId,
      sensitivity: 'high',
      title: activate ? 'Reativar acesso' : 'Desativar acesso',
      description: `Confirme seu PIN para ${activate ? 'reativar' : 'desativar'} o acesso de "${profile.name}".`,
      actionLabel: activate ? 'Reativar acesso' : 'Desativar acesso',
      onVerified: async () => {
        setToggling(targetUserId);
        try {
          const { error: fnError } = await supabase.functions.invoke('toggle-user-status', {
            body: { user_id: targetUserId, activate },
          });
          if (fnError) throw new Error(fnError.message);
          setSuccess(`Acesso de "${profile.name}" ${activate ? 'reativado' : 'desativado'} com sucesso!`);
          loadProfiles();
        } catch (err: any) {
          setError(err.message || 'Erro ao alterar status do usuário.');
        } finally {
          setToggling(null);
        }
      },
    });
  };

  const filteredProfiles = profiles.filter((profile) =>
    matchesNormalizedSearch(searchTerm, [profile.name, profile.email, profile.role])
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header bar */}
      <div style={{ flexShrink: 0, padding: '16px 24px 12px', borderBottom: '1px solid rgba(15,23,42,0.06)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Search */}
        <div style={{ flex: 1, position: 'relative' }}>
          <Search style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', width: '14px', height: '14px', color: '#9ca3af' }} />
          <input
            type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nome, e-mail ou cargo..."
            style={{ width: '100%', paddingLeft: '32px', paddingRight: '12px', paddingTop: '8px', paddingBottom: '8px',
              fontSize: '13px', background: '#f8f9fb', border: '1px solid rgba(15,23,42,0.10)', borderRadius: '8px',
              color: '#191c1e', outline: 'none', boxSizing: 'border-box' }}
            onFocus={e => { e.currentTarget.style.borderColor = '#ff8a00'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(255,138,0,0.10)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(15,23,42,0.10)'; e.currentTarget.style.background = '#f8f9fb'; e.currentTarget.style.boxShadow = 'none'; }}
          />
        </div>
        {/* Novo usuário */}
        <button
          onClick={() => setShowCreateModal(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px',
            fontSize: '13px', fontWeight: 600, color: '#fff', background: '#ea6c00',
            border: 'none', borderRadius: '8px', cursor: 'pointer', flexShrink: 0,
            transition: 'background .15s ease' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#d46000')}
          onMouseLeave={e => (e.currentTarget.style.background = '#ea6c00')}
        >
          <Plus size={14} />
          Novo usuário
        </button>
      </div>

      {/* Alertas */}
      {(success || error) && (
        <div style={{ flexShrink: 0, padding: '8px 24px 0' }}>
          {success && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px',
              background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px',
              fontSize: '13px', color: '#15803d' }}>
              <CheckCircle2 size={14} />
              {success}
            </div>
          )}
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px',
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
              fontSize: '13px', color: '#dc2626', marginTop: success ? '6px' : 0 }}>
              <X size={14} />
              {error}
            </div>
          )}
        </div>
      )}

      {/* User list */}
      <div className="settings-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 24px 16px' }}>
        {loading ? (
          <ModuleSkeleton variant="list" rows={7} />
        ) : filteredProfiles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: '#747878' }}>
            <Users size={32} style={{ margin: '0 auto 10px', color: '#d1d5db' }} />
            <p style={{ fontSize: '14px' }}>{searchTerm ? 'Nenhum usuário encontrado.' : 'Nenhum usuário cadastrado.'}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {filteredProfiles.map((profile) => {
              const roleInfo = ROLES.find(r => r.value === profile.role);
              const isActive = profile.is_active !== false;
              const isSelf = profile.user_id === user?.id;
              const initial = profile.name.charAt(0).toUpperCase();

              // Role badge colors
              const roleColors: Record<string, { bg: string; text: string }> = {
                'Administrador': { bg: '#fef3c7', text: '#92400e' },
                'Advogado': { bg: '#eff6ff', text: '#1d4ed8' },
                'Auxiliar': { bg: '#f0fdf4', text: '#15803d' },
                'Secretária': { bg: '#faf5ff', text: '#7e22ce' },
                'Financeiro': { bg: '#fff7ed', text: '#c2410c' },
                'Estagiário': { bg: '#f8fafc', text: '#475569' },
              };
              const rc = roleColors[profile.role] || { bg: '#f8fafc', text: '#475569' };

              return (
                <div
                  key={profile.user_id ?? profile.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '10px 14px', borderRadius: '9px',
                    border: '1px solid rgba(15,23,42,0.06)', background: '#fff',
                    opacity: isActive ? 1 : 0.55,
                    transition: 'background .12s ease, border-color .12s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#fafafa'; e.currentTarget.style.borderColor = 'rgba(15,23,42,0.10)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'rgba(15,23,42,0.06)'; }}
                >
                  {/* Avatar */}
                  <div style={{ width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, #ff8a00, #ea6c00)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {profile.avatar_url ? (
                      <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{initial}</span>
                    )}
                  </div>

                  {/* Name + email */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <p style={{ fontSize: '13.5px', fontWeight: 600, color: '#191c1e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {profile.name}
                      </p>
                      {isSelf && (
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', background: 'rgba(255,138,0,0.10)', color: '#c45c00', flexShrink: 0 }}>
                          você
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: '12px', color: '#747878', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {profile.email}
                    </p>
                  </div>

                  {/* Role badge */}
                  <span style={{ fontSize: '11.5px', fontWeight: 600, padding: '3px 9px', borderRadius: '999px',
                    background: rc.bg, color: rc.text, flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {profile.role}
                  </span>

                  {/* Status badge */}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', fontWeight: 600,
                    padding: '3px 9px', borderRadius: '999px', flexShrink: 0,
                    background: isActive ? '#f0fdf4' : '#f8fafc',
                    color: isActive ? '#15803d' : '#94a3b8',
                    border: `1px solid ${isActive ? '#bbf7d0' : '#e2e8f0'}` }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isActive ? '#16a34a' : '#94a3b8' }} />
                    {isActive ? 'Ativo' : 'Inativo'}
                  </span>

                  {/* Date */}
                  <span style={{ fontSize: '12px', color: '#9ca3af', flexShrink: 0, minWidth: '80px', textAlign: 'right' }}>
                    {new Date(profile.created_at).toLocaleDateString('pt-BR')}
                  </span>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                    {/* Edit role button */}
                    <button
                      onClick={() => handleEditUser(profile)}
                      disabled={isSelf || !isActive}
                      title={isSelf ? 'Você não pode editar seu próprio cargo' : !isActive ? 'Reative o usuário para editar' : 'Editar cargo'}
                      style={{ width: '28px', height: '28px', borderRadius: '7px', border: '1px solid rgba(15,23,42,0.09)',
                        background: 'transparent', color: '#747878', cursor: 'pointer', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', transition: 'background .12s ease, color .12s ease',
                        opacity: (isSelf || !isActive) ? 0.4 : 1 }}
                      onMouseEnter={e => { if (!isSelf && isActive) { e.currentTarget.style.background = '#f2f4f6'; e.currentTarget.style.color = '#191c1e'; } }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#747878'; }}
                    >
                      <Edit2 size={12} />
                    </button>

                    {/* Toggle status */}
                    {!isSelf && (
                      <button
                        onClick={() => handleToggleStatus(profile)}
                        disabled={toggling === profile.user_id}
                        title={isActive ? 'Desativar acesso' : 'Reativar acesso'}
                        style={{ width: '28px', height: '28px', borderRadius: '7px', border: '1px solid rgba(15,23,42,0.09)',
                          background: 'transparent', color: '#747878', cursor: 'pointer', display: 'flex',
                          alignItems: 'center', justifyContent: 'center', transition: 'background .12s ease' }}
                        onMouseEnter={e => { e.currentTarget.style.background = isActive ? '#fef2f2' : '#f0fdf4'; e.currentTarget.style.color = isActive ? '#dc2626' : '#16a34a'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#747878'; }}
                      >
                        {toggling === profile.user_id ? <Loader2 size={12} className="animate-spin" /> : isActive ? <UserX size={12} /> : <UserCheck size={12} />}
                      </button>
                    )}

                    {/* Delete */}
                    {canManageUsers && !isSelf && (
                      <button
                        onClick={() => {
                          if (!profile.user_id) {
                            setError('Usuário sem vínculo (user_id) no perfil.');
                            return;
                          }
                          handleDeleteUser(profile.user_id, profile.name);
                        }}
                        disabled={!!deleting}
                        title="Remover usuário"
                        style={{ width: '28px', height: '28px', borderRadius: '7px', border: '1px solid rgba(15,23,42,0.09)',
                          background: 'transparent', color: '#747878', cursor: 'pointer', display: 'flex',
                          alignItems: 'center', justifyContent: 'center', transition: 'background .12s ease' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#dc2626'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#747878'; }}
                      >
                        {deleting === (profile.user_id ?? profile.id) ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Criação */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Criar Novo Usuário"
        size="sm"
        zIndex={50}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              disabled={creating}
              className="px-3 py-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 rounded transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="create-user-form"
              disabled={creating}
              className="px-4 py-1.5 text-[13px] font-semibold bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors disabled:opacity-50"
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
        }
      >
        <ModalBody className="px-5 py-4">
          <form
            id="create-user-form"
            onSubmit={handleCreateUser}
            className="space-y-3"
            style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}
          >
            {/* Nome */}
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Nome Completo</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition"
                placeholder="Nome do colaborador"
                required
                disabled={creating}
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">E-mail</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition"
                placeholder="email@exemplo.com"
                required
                disabled={creating}
              />
            </div>

            {/* Cargo */}
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Cargo</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition"
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
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Senha Temporária</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full h-[34px] px-3 pr-10 border border-slate-300 rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400"
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
          </form>
        </ModalBody>
      </Modal>

      {/* Edit role modal inline */}
      {editingUser && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(6px)' }}
          onClick={() => setEditingUser(null)}>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '24px', width: '360px',
            boxShadow: '0 24px 60px rgba(0,0,0,0.18)', border: '1px solid rgba(15,23,42,0.10)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#191c1e', marginBottom: '4px' }}>Editar cargo</h3>
            <p style={{ fontSize: '13px', color: '#747878', marginBottom: '16px' }}>{editingUser.name}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {ROLES.map(role => (
                <button key={role.value} onClick={() => setEditRole(role.value)}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
                    borderRadius: '8px', border: `1px solid ${editRole === role.value ? 'rgba(255,138,0,0.4)' : 'rgba(15,23,42,0.10)'}`,
                    background: editRole === role.value ? 'rgba(255,138,0,0.06)' : '#fff',
                    cursor: 'pointer', textAlign: 'left', transition: 'all .12s ease', width: '100%' }}>
                  <span style={{ fontSize: '16px' }}>{role.icon}</span>
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: editRole === role.value ? '#c45c00' : '#191c1e' }}>{role.label}</p>
                    <p style={{ fontSize: '11.5px', color: '#747878' }}>{role.description}</p>
                  </div>
                  {editRole === role.value && <span style={{ marginLeft: 'auto', color: '#ff8a00' }}>✓</span>}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setEditingUser(null)}
                style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 500, color: '#444748',
                  background: 'transparent', border: '1px solid rgba(15,23,42,0.12)', borderRadius: '8px', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={handleSaveEdit} disabled={saving || editRole === editingUser.role}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px',
                  fontSize: '13px', fontWeight: 600, color: '#fff', background: '#ea6c00',
                  border: 'none', borderRadius: '8px', cursor: 'pointer', opacity: (saving || editRole === editingUser.role) ? 0.6 : 1 }}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                Salvar
              </button>
            </div>

            {/* ── PIN de Segurança (admin) ───────────────────────────────── */}
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(15,23,42,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#191c1e' }}>PIN de Segurança</p>
                {editingUserPinMeta !== null && (
                  <span style={{
                    fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
                    background: editingUserPinMeta.has_pin ? '#f0fdf4' : '#fffbeb',
                    color: editingUserPinMeta.has_pin ? '#15803d' : '#92400e',
                    border: `1px solid ${editingUserPinMeta.has_pin ? '#bbf7d0' : '#fde68a'}`,
                  }}>
                    {editingUserPinMeta.has_pin ? 'Configurado' : editingUserPinMeta.pin_required_setup ? 'Aguarda configuração' : 'Não configurado'}
                  </span>
                )}
              </div>
              {editingUserPinMeta?.locked_until && new Date(editingUserPinMeta.locked_until) > new Date() && (
                <p style={{ fontSize: '12px', color: '#dc2626', marginBottom: '8px' }}>
                  ⚠ Bloqueado até {new Date(editingUserPinMeta.locked_until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              {editingUserPinMeta?.pin_set_at && editingUserPinMeta.has_pin && (
                <p style={{ fontSize: '12px', color: '#747878', marginBottom: '10px' }}>
                  Configurado em {new Date(editingUserPinMeta.pin_set_at).toLocaleDateString('pt-BR')}
                </p>
              )}
              <button
                onClick={handleAdminResetPin}
                disabled={resettingPin || !editingUserPinMeta?.has_pin}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 12px',
                  fontSize: '12.5px', fontWeight: 600, color: '#dc2626',
                  background: 'transparent', border: '1px solid #fecaca', borderRadius: '8px',
                  cursor: (!editingUserPinMeta?.has_pin || resettingPin) ? 'not-allowed' : 'pointer',
                  opacity: (!editingUserPinMeta?.has_pin || resettingPin) ? 0.5 : 1 }}>
                {resettingPin ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                Resetar PIN
              </button>
              {!editingUserPinMeta?.has_pin && (
                <p style={{ fontSize: '11.5px', color: '#9ca3af', marginTop: '6px' }}>
                  {editingUserPinMeta === null ? 'Carregando...' : 'Usuário não possui PIN configurado.'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagementModule;
