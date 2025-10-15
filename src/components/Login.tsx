import React, { useState, useEffect } from 'react';
import { Loader2, Mail, Lock, Eye, EyeOff, CheckCircle2, AlertCircle, Shield, Scale, FileText, Calendar, Users, TrendingUp } from 'lucide-react';

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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex relative overflow-hidden">
      {/* Elegant Background Pattern */}
      <div className="absolute inset-0 opacity-40">
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgb(99 102 241 / 0.15) 1px, transparent 0)`,
          backgroundSize: '40px 40px'
        }}></div>
      </div>

      {/* Subtle Gradient Orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-gradient-to-br from-blue-200/30 to-indigo-200/30 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-gradient-to-tr from-indigo-200/30 to-purple-200/30 rounded-full blur-3xl"></div>
      </div>

      {/* Left Side - Professional Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative items-center justify-center p-12 xl:p-16 bg-gradient-to-br from-slate-900 to-indigo-950">
        <div className={`space-y-8 max-w-xl transition-all duration-1000 delay-200 ${mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'}`}>
          {/* Logo & Title */}
          <div>
            <div className="flex items-center gap-4 mb-6">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 blur-xl opacity-50"></div>
                <div className="relative w-20 h-20 rounded-2xl overflow-hidden shadow-2xl ring-2 ring-white/10">
                  <img 
                    src="/icon-512.png" 
                    alt="Advogado.WEB" 
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
              <div>
                <h1 className="text-5xl font-bold text-white tracking-tight mb-1">
                  Advogado<span className="text-blue-400">.</span>WEB
                </h1>
                <p className="text-sm text-slate-300">Gestão Jurídica Profissional</p>
              </div>
            </div>
            
            <p className="text-base text-slate-300 leading-relaxed">
              Plataforma completa para gestão de escritórios de advocacia com 
              <span className="text-blue-400 font-semibold"> tecnologia avançada</span> e 
              <span className="text-indigo-400 font-semibold"> segurança total</span>.
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="group p-5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-blue-500/30 transition-all cursor-default">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <FileText className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">Processos</h3>
              <p className="text-xs text-slate-400">Gestão completa de processos</p>
            </div>
            
            <div className="group p-5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-indigo-500/30 transition-all cursor-default">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <Calendar className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">Agenda</h3>
              <p className="text-xs text-slate-400">Prazos e compromissos</p>
            </div>
            
            <div className="group p-5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-purple-500/30 transition-all cursor-default">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <Users className="w-6 h-6 text-purple-400" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">Clientes</h3>
              <p className="text-xs text-slate-400">Gestão de relacionamento</p>
            </div>
            
            <div className="group p-5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-blue-500/30 transition-all cursor-default">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <TrendingUp className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">Relatórios</h3>
              <p className="text-xs text-slate-400">Analytics e métricas</p>
            </div>
          </div>

          {/* Trust Badge */}
          <div className="flex items-center gap-3 pt-6 border-t border-white/10">
            <Shield className="w-5 h-5 text-blue-400" />
            <p className="text-xs text-slate-400">
              <span className="text-blue-300 font-semibold">Segurança SSL</span> • Criptografia de ponta a ponta • LGPD Compliant
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
              <div className="w-14 h-14 rounded-xl overflow-hidden shadow-xl">
                <img 
                  src="/icon-512.png" 
                  alt="Advogado.WEB" 
                  className="w-full h-full object-cover"
                />
              </div>
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
                Advogado<span className="text-blue-600">.</span>WEB
              </h1>
            </div>
            <p className="text-center text-sm text-slate-600">Gestão Jurídica Profissional</p>
          </div>

          {/* Login Card */}
          <div className="relative">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-2xl blur opacity-20"></div>
            
            <div className="relative bg-white rounded-2xl p-8 shadow-2xl border border-slate-200">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Bem-vindo</h2>
                <p className="text-sm text-slate-600">Entre com suas credenciais para acessar o sistema</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Email Field */}
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                    E-mail
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail className="h-5 w-5 text-slate-400" />
                    </div>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="block w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-sm text-slate-900 placeholder:text-slate-400"
                      placeholder="seu@email.com"
                      required
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-2">
                    Senha
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Lock className="h-5 w-5 text-slate-400" />
                    </div>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="block w-full pl-10 pr-12 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-sm text-slate-900 placeholder:text-slate-400"
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5 text-slate-400 hover:text-slate-600 transition" />
                      ) : (
                        <Eye className="h-5 w-5 text-slate-400 hover:text-slate-600 transition" />
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
                    className="text-sm text-blue-600 hover:text-blue-700 transition-colors disabled:opacity-60 font-medium"
                  >
                    {resetting ? 'Enviando...' : 'Esqueceu a senha?'}
                  </button>
                </div>

                {/* Error Message */}
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    <span>{error}</span>
                  </div>
                )}

                {resetMessage && (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{resetMessage}</span>
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Entrando...</span>
                    </>
                  ) : (
                    <span>Entrar no Sistema</span>
                  )}
                </button>
              </form>

              {/* Footer */}
              <div className="pt-6 border-t border-slate-200 mt-8">
                <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                  <Shield className="w-3 h-3" />
                  <span>Conexão segura • SSL/TLS</span>
                </div>
                <p className="text-center text-xs text-slate-400 mt-2">
                  © {new Date().getFullYear()} Advogado.WEB • Todos os direitos reservados
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
