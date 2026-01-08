import React, { useState } from 'react';
import { X, User, Mail, Lock, Briefcase, Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { supabase } from '../config/supabase';

interface SignUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (email: string) => void;
}

const ROLES = [
  { value: 'Advogado', label: 'Advogado', description: 'Acesso completo ao sistema' },
  { value: 'Sócio', label: 'Sócio', description: 'Acesso administrativo' },
  { value: 'Secretária', label: 'Secretária', description: 'Suporte administrativo' },
  { value: 'Auxiliar', label: 'Auxiliar', description: 'Tarefas básicas' },
  { value: 'Fisioterapeuta', label: 'Fisioterapeuta', description: 'Profissional da saúde' },
  { value: 'Estagiário', label: 'Estagiário', description: 'Aprendiz jurídico' },
];

export const SignUpModal: React.FC<SignUpModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'Advogado' as const,
  });

  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      password: '',
      role: 'Advogado',
    });
    setError(null);
    setSuccess(false);
    setShowPassword(false);
  };

  const handleClose = () => {
    if (!loading) {
      resetForm();
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim() || !formData.email.trim() || !formData.password.trim()) {
      setError('Preencha todos os campos obrigatórios.');
      return;
    }

    if (formData.password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Criar usuário no Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            name: formData.name,
            role: formData.role,
          }
        }
      });

      if (authError) {
        // Se email já existe, verificar se é apenas na auth mas não no profiles
        if (authError.message.includes('already registered')) {
          setError('Este e-mail já está cadastrado. Tente fazer login.');
          return;
        }
        throw authError;
      }

      // 2. Criar perfil na tabela profiles
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: authData.user?.id,
          email: formData.email,
          name: formData.name,
          role: formData.role,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (profileError) {
        console.error('Erro ao criar perfil:', profileError);
        // Tentar deletar usuário auth se profile falhou
        if (authData.user?.id) {
          await supabase.auth.admin.deleteUser(authData.user.id);
        }
        throw profileError;
      }

      setSuccess(true);
      
      // Após 2 segundos, fechar e chamar onSuccess
      setTimeout(() => {
        onSuccess(formData.email);
        handleClose();
      }, 2000);

    } catch (err: any) {
      console.error('Erro no cadastro:', err);
      setError(err.message || 'Erro ao criar conta. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 className="text-xl font-semibold text-slate-900">Criar Nova Conta</h2>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Formulário */}
        {!success ? (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Nome */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Nome Completo
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="w-5 h-5 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                </div>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="block w-full rounded-xl border border-slate-200 bg-slate-50 text-slate-900 pl-10 pr-4 py-3.5 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 text-sm placeholder-slate-400 transition-all duration-200 hover:border-slate-300"
                  placeholder="Seu nome completo"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                E-mail
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="w-5 h-5 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                </div>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="block w-full rounded-xl border border-slate-200 bg-slate-50 text-slate-900 pl-10 pr-4 py-3.5 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 text-sm placeholder-slate-400 transition-all duration-200 hover:border-slate-300"
                  placeholder="seu@email.com"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            {/* Cargo */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Cargo/Função
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Briefcase className="w-5 h-5 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                </div>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                  className="block w-full rounded-xl border border-slate-200 bg-slate-50 text-slate-900 pl-10 pr-4 py-3.5 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 text-sm placeholder-slate-400 transition-all duration-200 hover:border-slate-300 appearance-none cursor-pointer"
                  disabled={loading}
                >
                  {ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label} - {role.description}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Senha */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Senha
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="w-5 h-5 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="block w-full rounded-xl border border-slate-200 bg-slate-50 text-slate-900 pl-10 pr-12 py-3.5 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 text-sm placeholder-slate-400 transition-all duration-200 hover:border-slate-300"
                  placeholder="Mínimo 6 caracteres"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* Erro */}
            {error && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
                <X className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">Erro no cadastro</p>
                  <p className="text-sm text-red-600 mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {/* Botão */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center items-center py-3.5 px-4 border border-transparent rounded-xl shadow-lg shadow-orange-500/20 text-sm font-semibold text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 transition-all duration-300 transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Criando conta...
                </>
              ) : (
                'Criar Conta'
              )}
            </button>
          </form>
        ) : (
          /* Sucesso */
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Conta Criada!</h3>
            <p className="text-sm text-slate-600">
              Sua conta foi criada com sucesso. Redirecionando para o login...
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
