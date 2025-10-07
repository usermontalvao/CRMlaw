import React, { useState, useEffect } from 'react';
import { Scale, Loader2, Mail, Lock, Eye, EyeOff, CheckCircle2, AlertCircle, Shield, Sparkles, FileText, Calendar, Bell, TrendingUp } from 'lucide-react';

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onResetPassword: (email: string) => Promise<void>;
}

const Login: React.FC<LoginProps> = ({ onLogin, onResetPassword }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetMessage(null);
    setLoading(true);

    try {
      await onLogin(email, password);
    } catch (err: any) {
      setError(err.message || 'Erro ao fazer login. Verifique suas credenciais.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setError(null);
    setResetMessage(null);

    if (!email) {
      setError('Informe seu e-mail para recuperar a senha.');
      return;
    }

    try {
      setResetting(true);
      await onResetPassword(email);
      setResetMessage('Enviamos um link de redefinição de senha para seu e-mail.');
    } catch (err: any) {
      setError(err.message || 'Não foi possível enviar o e-mail de recuperação.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex relative overflow-hidden">
      {/* Elegant Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}></div>
      </div>

      {/* Subtle Gradient Orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-br from-amber-600/10 via-orange-600/5 to-transparent rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-to-tr from-amber-600/10 via-orange-600/5 to-transparent rounded-full blur-3xl"></div>
      </div>

      {/* Left Side - Professional Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative items-center justify-center p-12 xl:p-16">
        <div className={`space-y-8 max-w-xl transition-all duration-1000 delay-200 ${mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'}`}>
          {/* Premium Badge */}
          <div className="inline-flex items-center gap-2 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-400/20 rounded-full px-4 py-2 backdrop-blur-sm">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></div>
            <span className="text-xs font-semibold text-amber-200/90 tracking-wide uppercase">Sistema Profissional</span>
          </div>
          
          {/* Logo & Title */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-400 to-orange-600 blur-xl opacity-50"></div>
                <div className="relative w-14 h-14 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center shadow-2xl">
                  <Scale className="w-8 h-8 text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-4xl font-bold text-white tracking-tight">
                  Advogado<span className="text-amber-400">/</span>WEB
                </h1>
                <p className="text-sm text-white/40 font-medium mt-0.5">Gestão Jurídica Avançada</p>
              </div>
            </div>
            
            <p className="text-base text-white/60 leading-relaxed">
              Centralize toda a gestão do seu escritório em uma plataforma moderna, 
              segura e completa para advogados.
            </p>
          </div>

          {/* Feature Grid */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="group p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-amber-500/30 transition-all cursor-default">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <FileText className="w-5 h-5 text-amber-400" />
              </div>
              <h3 className="text-sm font-semibold text-white mb-1">Processos</h3>
              <p className="text-xs text-white/50">Gestão completa de processos e andamentos</p>
            </div>
            
            <div className="group p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-amber-500/30 transition-all cursor-default">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <Bell className="w-5 h-5 text-amber-400" />
              </div>
              <h3 className="text-sm font-semibold text-white mb-1">DJEN</h3>
              <p className="text-xs text-white/50">Sincronização automática de intimações</p>
            </div>
            
            <div className="group p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-amber-500/30 transition-all cursor-default">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <Calendar className="w-5 h-5 text-amber-400" />
              </div>
              <h3 className="text-sm font-semibold text-white mb-1">Prazos</h3>
              <p className="text-xs text-white/50">Controle de deadlines e compromissos</p>
            </div>
            
            <div className="group p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-amber-500/30 transition-all cursor-default">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <TrendingUp className="w-5 h-5 text-amber-400" />
              </div>
              <h3 className="text-sm font-semibold text-white mb-1">Analytics</h3>
              <p className="text-xs text-white/50">Relatórios e métricas detalhadas</p>
            </div>
          </div>

          {/* Trust Badge */}
          <div className="flex items-center gap-3 pt-4 border-t border-white/10">
            <Shield className="w-5 h-5 text-amber-400/60" />
            <p className="text-xs text-white/40">
              Plataforma segura com criptografia de ponta a ponta • LGPD Compliant
            </p>
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 relative">
        <div className={`w-full max-w-md transition-all duration-1000 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          {/* Mobile Logo */}
          <div className="lg:hidden mb-8">
            <div className="flex items-center gap-3 justify-center mb-2">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                <Scale className="w-7 h-7 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-white tracking-tight">
                Advogado<span className="text-amber-400">/</span>WEB
              </h1>
            </div>
            <p className="text-center text-sm text-white/40">Gestão Jurídica Avançada</p>
          </div>

          {/* Login Card */}
          <div className="relative">
            {/* Card Glow Effect */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/20 rounded-2xl blur opacity-30"></div>
            
            <div className="relative bg-slate-900/90 border border-white/10 backdrop-blur-2xl rounded-2xl p-8 space-y-6 shadow-2xl">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">Acesso ao Sistema</h2>
                <p className="text-sm text-white/50">Entre com suas credenciais profissionais</p>
              </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-white/70 mb-2">
                E-mail
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-4 w-4 text-white/30" />
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-10 pr-4 py-2.5 border border-white/10 bg-white/5 text-white placeholder:text-white/30 rounded-lg focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400/50 transition-all text-sm"
                  placeholder="seu@email.com"
                  required
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-white/70 mb-2">
                Senha
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-white/30" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-10 py-2.5 border border-white/10 bg-white/5 text-white placeholder:text-white/30 rounded-lg focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400/50 transition-all text-sm"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-white/30 hover:text-white/60 transition" />
                  ) : (
                    <Eye className="h-4 w-4 text-white/30 hover:text-white/60 transition" />
                  )}
                </button>
              </div>
            </div>

            {/* Forgot Password */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={resetting}
                className="text-xs text-amber-400/80 hover:text-amber-400 transition-colors disabled:opacity-60"
              >
                {resetting ? 'Enviando...' : 'Esqueceu a senha?'}
              </button>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-200 px-3 py-2 rounded-lg text-xs flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{error}</span>
              </div>
            )}

            {resetMessage && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 px-3 py-2 rounded-lg text-xs flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{resetMessage}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-black font-bold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/30 hover:shadow-xl hover:shadow-amber-500/40 hover:scale-[1.02] active:scale-[0.98]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Entrando...</span>
                </>
              ) : (
                <span className="text-sm">Entrar</span>
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="pt-6 border-t border-white/5">
            <div className="flex items-center justify-center gap-2 text-xs text-white/30">
              <Shield className="w-3 h-3" />
              <span>Conexão segura • SSL/TLS</span>
            </div>
            <p className="text-center text-xs text-white/20 mt-2">
              © {new Date().getFullYear()} Advogado/WEB. Todos os direitos reservados.
            </p>
          </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
