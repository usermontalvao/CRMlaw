import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Loader2, Eye, EyeOff, CheckCircle2, AlertCircle, Scale, Shield, Sparkles, Rocket, User, Lock, ArrowRight, Ban,
  Users, Target, Briefcase, Calendar, Bell, PiggyBank, Library, Newspaper, FileText, PenTool, MessageSquare, Cloud, Clock,
} from 'lucide-react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import { clientService } from '../services/client.service';
import { BrandLogo } from './ui';
import { BRAND_SERIF } from '../constants/brand';

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onResetPassword: (email: string) => Promise<void>;
}

// Uma imagem por mês — mantém o painel vivo ao longo do ano, sempre discreta.
const HERO_IMAGES = [
  'https://images.unsplash.com/photo-1489515217757-5fd1be406fef?auto=format&fit=crop&w=1920&q=80', // Janeiro
  'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=1920&q=80', // Fevereiro
  'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?auto=format&fit=crop&w=1920&q=80', // Março
  'https://images.unsplash.com/photo-1476041800959-2f6bb412c8ce?auto=format&fit=crop&w=1920&q=80', // Abril
  'https://images.unsplash.com/photo-1494972688394-4cc796f9e4c1?auto=format&fit=crop&w=1920&q=80', // Maio
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1920&q=80', // Junho
  'https://images.unsplash.com/photo-1454496522488-7a8e488e8606?auto=format&fit=crop&w=1920&q=80', // Julho
  'https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?auto=format&fit=crop&w=1920&q=80', // Agosto
  'https://images.unsplash.com/photo-1500534313736-46d310c28335?auto=format&fit=crop&w=1920&q=80', // Setembro
  'https://images.unsplash.com/photo-1501471984908-815b9968623f?auto=format&fit=crop&w=1920&q=80', // Outubro
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1920&q=80', // Novembro
  'https://images.unsplash.com/photo-1482517967863-00e15c9b44be?auto=format&fit=crop&w=1920&q=80', // Dezembro
];

const MODULES: { icon: React.ElementType; accent: boolean; title: string; caption: string }[] = [
  { icon: User, accent: true, title: 'Gerenciar Clientes', caption: 'CRM Jurídico completo' },
  { icon: Scale, accent: false, title: 'Processos & Prazos', caption: 'Monitoramento 24/7' },
  { icon: AlertCircle, accent: false, title: 'Intimações', caption: 'Captura automática' },
  { icon: Shield, accent: false, title: 'Admin. Previdenciário', caption: 'Integração INSS' },
  { icon: Rocket, accent: false, title: 'Gestão de Leads', caption: 'Converta mais clientes potenciais' },
  { icon: Sparkles, accent: true, title: '...e muito mais', caption: 'Automação, integrações e insights' },
];

const MODULE_CARDS: {
  icon: React.ElementType;
  title: string;
  caption: string;
  tone: 'amber' | 'ink' | 'olive';
  size?: 'sm' | 'lg';
}[] = [
  { icon: Users, title: 'Clientes', caption: 'cadastro, histórico e relacionamento', tone: 'amber', size: 'lg' },
  { icon: Target, title: 'Leads', caption: 'captação e conversão comercial', tone: 'ink' },
  { icon: Briefcase, title: 'Processos', caption: 'andamento processual em contexto', tone: 'ink' },
  { icon: Calendar, title: 'Agenda & Prazos', caption: 'audiências, tarefas e vencimentos', tone: 'olive', size: 'lg' },
  { icon: Bell, title: 'Intimações', caption: 'captura e triagem operacional', tone: 'ink' },
  { icon: PiggyBank, title: 'Financeiro', caption: 'honorários, acordos e cobrança', tone: 'amber' },
  { icon: Library, title: 'Requerimentos', caption: 'fluxos jurídicos e documentos', tone: 'olive' },
  { icon: Newspaper, title: 'Petições', caption: 'produção com mais consistência', tone: 'ink' },
  { icon: FileText, title: 'Documentos', caption: 'modelos, arquivos e kits', tone: 'amber' },
  { icon: PenTool, title: 'Assinaturas', caption: 'envio e acompanhamento digital', tone: 'olive' },
  { icon: MessageSquare, title: 'WhatsApp', caption: 'atendimento integrado ao CRM', tone: 'amber', size: 'lg' },
  { icon: Shield, title: 'Chat da Equipe', caption: 'coordenação interna com contexto', tone: 'ink' },
  { icon: Cloud, title: 'Cloud', caption: 'armazenamento e organização central', tone: 'olive' },
];

const Login: React.FC<LoginProps> = ({ onLogin, onResetPassword }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBanned, setIsBanned] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [sessionExpiredNotice] = useState(() => {
    try {
      const v = sessionStorage.getItem('auth_notice');
      if (v === 'session_expired') { sessionStorage.removeItem('auth_notice'); return true; }
    } catch {}
    return false;
  });
  const [resetting, setResetting] = useState(false);
  const [identifierConfirmed, setIdentifierConfirmed] = useState(false);
  const [identifierRaw, setIdentifierRaw] = useState('');
  const [identifierProfileName, setIdentifierProfileName] = useState<string | null>(null);
  const [identifierProfileAvatar, setIdentifierProfileAvatar] = useState<string | null>(null);
  const [identifierLoading, setIdentifierLoading] = useState(false);
  const [testimonialIndex, setTestimonialIndex] = useState(0);

  // Bloqueio progressivo por IP (anti-força-bruta) — contador regressivo ao vivo.
  const { checkStaffLoginBlock } = useAuth();
  const [blockUntil, setBlockUntil] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());
  const blockRemainingSec = blockUntil ? Math.max(0, Math.ceil((blockUntil - nowTs) / 1000)) : 0;
  const isBlocked = blockRemainingSec > 0;

  const formatCountdown = useCallback((secs: number) => {
    const s = Math.max(0, secs);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }, []);

  // Tique de 1s enquanto houver bloqueio ativo; ao zerar, libera o formulário.
  useEffect(() => {
    if (!blockUntil) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNowTs(t);
      if (t >= blockUntil) {
        setBlockUntil(null);
        setError(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [blockUntil]);

  // Ao confirmar o identificador (passo da senha), verifica se o IP já está bloqueado.
  useEffect(() => {
    if (!identifierConfirmed) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await checkStaffLoginBlock(email);
        if (!cancelled && r.blocked && r.retryAfterSeconds > 0) {
          setBlockUntil(Date.now() + r.retryAfterSeconds * 1000);
          setNowTs(Date.now());
        }
      } catch { /* fail-open: não bloqueia por erro */ }
    })();
    return () => { cancelled = true; };
  }, [identifierConfirmed, email, checkStaffLoginBlock]);

  const testimonials = useMemo(
    () => [
      {
        initials: 'JT',
        name: 'Equipe jurius.com.br',
        role: 'Especialistas em gestão jurídica',
        quote:
          'Acreditamos que cada advogado merece tecnologia que inspire confiança e liberte tempo para cuidar das pessoas.',
      },
    ],
    [],
  );

  useEffect(() => {
    if (testimonials.length === 0) return;

    const interval = setInterval(() => {
      setTestimonialIndex((prev) => (prev + 1) % testimonials.length);
    }, 8000);

    return () => clearInterval(interval);
  }, [testimonials.length]);

  const heroImage = useMemo(() => HERO_IMAGES[new Date().getMonth()] ?? HERO_IMAGES[0], []);
  const moduleToneClass: Record<'amber' | 'ink' | 'olive', { shell: string; iconWrap: string; icon: string; eyebrow: string }> = {
    amber: {
      shell: 'border-[#efddc9] bg-[linear-gradient(145deg,rgba(255,251,246,0.96),rgba(247,236,222,0.88))] shadow-[0_18px_44px_-28px_rgba(215,118,33,0.45)]',
      iconWrap: 'bg-[#fff4e7] border-[#f0d2ae]',
      icon: 'text-[#d97706]',
      eyebrow: 'text-[#c56a1a]',
    },
    ink: {
      shell: 'border-[#ddd6cb] bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(245,241,235,0.88))] shadow-[0_18px_44px_-30px_rgba(44,33,24,0.18)]',
      iconWrap: 'bg-[#f5f1eb] border-[#e4dbcf]',
      icon: 'text-[#3f342a]',
      eyebrow: 'text-[#6f6258]',
    },
    olive: {
      shell: 'border-[#d9dccd] bg-[linear-gradient(145deg,rgba(251,252,247,0.96),rgba(239,242,229,0.92))] shadow-[0_18px_44px_-30px_rgba(89,96,58,0.18)]',
      iconWrap: 'bg-[#f0f4e6] border-[#d7dfbf]',
      icon: 'text-[#667249]',
      eyebrow: 'text-[#778260]',
    },
  };

  const translateAuthError = useCallback((message?: string) => {
    if (!message) {
      return 'Ocorreu um erro inesperado. Tente novamente em instantes.';
    }

    const normalized = message.toLowerCase();

    if (normalized.includes('invalid login credentials')) {
      return 'Credenciais inválidas. Confira seu e-mail e senha e tente novamente.';
    }

    if (normalized.includes('email not confirmed')) {
      return 'Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.';
    }

    if (normalized.includes('user is banned') || normalized.includes('user_banned') || normalized.includes('banned')) {
      return '__BANNED__';
    }

    if (normalized.includes('rate limit') || normalized.includes('too many requests')) {
      return 'Muitas tentativas em sequência. Aguarde alguns segundos e tente novamente.';
    }

    if (normalized.includes('network error') || normalized.includes('fetch')) {
      return 'Não foi possível comunicar com o servidor. Verifique sua conexão.';
    }

    return 'Não foi possível fazer login. Verifique os dados e tente novamente.';
  }, []);

  const LAST_LOGIN_CPF_KEY = 'crm-last-login-cpf';

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

  const loadIdentifierProfile = useCallback(async (identifier: string): Promise<{ found: boolean; message?: string }> => {
    setIdentifierLoading(true);

    try {
      const trimmed = identifier.trim();

      // 1) Se for e-mail, buscamos direto em profiles
      if (trimmed.includes('@')) {
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem(LAST_LOGIN_CPF_KEY);
        }
        const { data, error } = await supabase
          .from('profiles')
          .select('name, avatar_url, email')
          .ilike('email', trimmed);

        if (error) {
          console.error('Erro ao buscar perfil para login:', error.message);
          setIdentifierProfileName(null);
          setIdentifierProfileAvatar(null);
          return { found: false };
        }

        const profile = data && data.length > 0 ? data[0] : null;
        if (!profile) {
          setIdentifierProfileName(null);
          setIdentifierProfileAvatar(null);
          return { found: false };
        }

        // Garantimos que o e-mail do estado é o mesmo do perfil
        if (profile.email && profile.email !== email) {
          setEmail(profile.email);
        }

        setIdentifierProfileName(profile.name ?? null);
        setIdentifierProfileAvatar(profile.avatar_url ?? null);
        return { found: true };
      }

      // 2) Se não for e-mail, tratamos como CPF/CNPJ: buscamos em clients.cpf_cnpj
      const numericId = trimmed.replace(/\D/g, '');
      if (!numericId) {
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem(LAST_LOGIN_CPF_KEY);
        }
        setIdentifierProfileName(null);
        setIdentifierProfileAvatar(null);
        return { found: false };
      }

      if (typeof window !== 'undefined') {
        if (numericId.length === 11) {
          sessionStorage.setItem(LAST_LOGIN_CPF_KEY, formatCpf(numericId));
        } else {
          sessionStorage.removeItem(LAST_LOGIN_CPF_KEY);
        }
      }

      if (numericId.length === 11) {
        try {
          const maskedCpf = formatCpf(numericId);
          const { data: profileByMaskedCpf, error: profileByMaskedCpfError } = await supabase
            .from('profiles')
            .select('name, avatar_url, email')
            .eq('cpf', maskedCpf)
            .maybeSingle();

          if (!profileByMaskedCpfError && profileByMaskedCpf?.email) {
            setIdentifierProfileName(profileByMaskedCpf.name ?? profileByMaskedCpf.email);
            setIdentifierProfileAvatar(profileByMaskedCpf.avatar_url ?? null);
            setEmail(profileByMaskedCpf.email);
            return { found: true };
          }

          const { data: profileByRawCpf, error: profileByRawCpfError } = await supabase
            .from('profiles')
            .select('name, avatar_url, email')
            .eq('cpf', numericId)
            .maybeSingle();

          if (!profileByRawCpfError && profileByRawCpf?.email) {
            setIdentifierProfileName(profileByRawCpf.name ?? profileByRawCpf.email);
            setIdentifierProfileAvatar(profileByRawCpf.avatar_url ?? null);
            setEmail(profileByRawCpf.email);
            return { found: true };
          }
        } catch (profileLookupError) {
          console.error('Erro ao buscar perfil por CPF para login:', profileLookupError);
        }
      }

      try {
        const client = await clientService.getClientByCpfCnpj(numericId);
        if (!client) {
          setIdentifierProfileName(null);
          setIdentifierProfileAvatar(null);
          return { found: false };
        }

        if (!client.email) {
          setIdentifierProfileName(client.full_name || null);
          setIdentifierProfileAvatar(null);
          return {
            found: false,
            message: 'CPF encontrado, mas este cadastro não possui e-mail. Cadastre um e-mail para este CPF (ou vincule o usuário no sistema) para conseguir entrar.',
          };
        }

        // Usamos o nome do cliente e o e-mail associado como identidade de login
        setIdentifierProfileName(client.full_name || client.email);
        setIdentifierProfileAvatar(null);
        setEmail(client.email);

        // Opcionalmente, podemos tentar buscar avatar no profiles usando o e-mail do cliente
        const { data: profileData } = await supabase
          .from('profiles')
          .select('avatar_url')
          .ilike('email', client.email);

        const profileFromClientEmail = profileData && profileData.length > 0 ? profileData[0] : null;
        if (profileFromClientEmail?.avatar_url) {
          setIdentifierProfileAvatar(profileFromClientEmail.avatar_url);
        }

        return { found: true };
      } catch (clientError) {
        console.error('Erro ao buscar cliente por CPF/CNPJ para login:', clientError);
        setIdentifierProfileName(null);
        setIdentifierProfileAvatar(null);
        return { found: false };
      }
    } catch (e) {
      console.error('Erro inesperado ao buscar identificador para login:', e);
      setIdentifierProfileName(null);
      setIdentifierProfileAvatar(null);
      return { found: false };
    } finally {
      setIdentifierLoading(false);
    }
  }, [email, formatCpf]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Etapa 1: confirmar identificador (email/CPF/CNPJ)
    if (!identifierConfirmed) {
      if (!email.trim()) {
        setError('Informe seu e-mail, CPF ou CNPJ para continuar.');
        return;
      }
      setError(null);
      setResetMessage(null);

      // Verifica se existe perfil para este identificador
      const result = await loadIdentifierProfile(email.trim());
      if (!result.found) {
        setError(result.message || 'Usuário não encontrado. Verifique o e-mail informado.');
        setIdentifierConfirmed(false);
        return;
      }

      setIdentifierConfirmed(true);
      return;
    }

    // Etapa 2: login com senha
    if (isBlocked) return; // IP bloqueado: nem tenta enquanto o timer não zera
    setError(null);
    setResetMessage(null);
    setLoading(true);

    try {
      await onLogin(email, password);
    } catch (err: any) {
      // Lockout anti-força-bruta: inicia o contador regressivo e trava o formulário.
      if (err?.code === 'staff_login_blocked') {
        const secs = Number(err?.retryAfterSeconds) || 60;
        setBlockUntil(Date.now() + secs * 1000);
        setNowTs(Date.now());
        setError(null);
        setIsBanned(false);
        return;
      }
      const msg = translateAuthError(err?.message);
      if (msg === '__BANNED__') {
        setIsBanned(true);
        setError(null);
      } else {
        setError(msg);
        setIsBanned(false);
      }
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
      setError(translateAuthError(err?.message));
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen md:h-screen flex flex-col md:flex-row overflow-hidden bg-[#f8f7f5]">
      <style>{`
        @keyframes lg-rise{from{opacity:0;transform:translateY(18px);filter:blur(6px)}to{opacity:1;transform:translateY(0);filter:blur(0)}}
        @keyframes lg-breathe{0%,100%{opacity:.45;transform:scale(1)}50%{opacity:.8;transform:scale(1.07)}}
        .lg-rise{animation:lg-rise .9s cubic-bezier(.16,1,.3,1) both}
        @media (prefers-reduced-motion:reduce){.lg-rise,.lg-anim{animation:none!important;opacity:1!important}}
      `}</style>

      {/* ===== LADO ESQUERDO - LOGIN ===== */}
      <div className="w-full md:w-[45%] lg:w-[40%] flex flex-col justify-between p-8 md:p-10 lg:p-12 bg-[#f8f7f5] relative z-20 shadow-2xl min-h-screen md:h-screen md:overflow-y-auto">
        {/* Header - Logo */}
        <div className="lg-rise">
          <BrandLogo variant="light" size="sm" divider={false} className="select-none" />
        </div>

        {/* Centro - Formulário */}
        <div className="flex flex-col justify-center flex-grow py-8 max-w-md mx-auto w-full">
          {/* Título */}
          <h2
            className="text-[34px] md:text-[40px] font-semibold text-[#211c18] mb-3 leading-[1.12] tracking-tight lg-rise"
            style={{ fontFamily: BRAND_SERIF, animationDelay: '80ms' }}
          >
            Bem-vindo de volta
          </h2>
          <p className="text-slate-500 mb-10 text-[15px] leading-relaxed lg-rise" style={{ animationDelay: '160ms' }}>
            Acesse seu painel jurídico e gerencie seu escritório com eficiência e segurança.
          </p>

          {/* Formulário */}
          <form onSubmit={handleSubmit} className="space-y-5 lg-rise" style={{ animationDelay: '240ms' }}>
            {/* Etapa 1 - Identificador */}
            {!identifierConfirmed && (
              <div>
                <label
                  className="block text-[11px] font-semibold text-slate-500 mb-2.5 uppercase"
                  style={{ letterSpacing: '0.14em' }}
                >
                  E-mail ou CPF
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <User className="w-[18px] h-[18px] text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                  </div>
                  <input
                    type="text"
                    value={identifierRaw}
                    onChange={(e) => {
                      let value = e.target.value;
                      // Se começar com número, aplicar máscara de CPF
                      const digits = value.replace(/\D/g, '');
                      if (digits.length > 0 && /^\d/.test(value)) {
                        // Formatar como CPF: 000.000.000-00
                        let masked = '';
                        for (let i = 0; i < digits.length && i < 11; i++) {
                          if (i === 3 || i === 6) masked += '.';
                          if (i === 9) masked += '-';
                          masked += digits[i];
                        }
                        value = masked;
                      }
                      setIdentifierRaw(value);
                      setEmail(value);
                    }}
                    className="block w-full rounded-xl border border-[#e7e4de] bg-white text-slate-900 pl-11 pr-4 py-3.5 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 text-sm placeholder-slate-400 transition-all duration-200 hover:border-[#d9d5cd] shadow-[0_1px_2px_rgba(33,28,24,0.04)]"
                    placeholder="seu email ou CPF"
                    required
                  />
                </div>
              </div>
            )}

            {/* Loading de busca */}
            {!identifierConfirmed && identifierLoading && (
              <div className="flex items-center gap-2 text-sm text-orange-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Localizando sua conta...</span>
              </div>
            )}

            {/* Etapa 2 - Senha */}
            {identifierConfirmed && (
              <>
                {/* Card do usuário identificado */}
                <div className="flex items-center gap-3 rounded-2xl border border-[#e7e4de] bg-white px-4 py-3 shadow-[0_1px_3px_rgba(33,28,24,0.05)]">
                  <div className="relative h-12 w-12">
                    <div className="h-12 w-12 rounded-2xl bg-[#f4f2ee] text-slate-600 font-bold text-lg flex items-center justify-center uppercase overflow-hidden">
                      {identifierProfileAvatar ? (
                        <img
                          src={identifierProfileAvatar}
                          alt={identifierProfileName || identifierRaw || email}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        (identifierProfileName || identifierRaw || email).trim().charAt(0) || '?'
                      )}
                    </div>
                    <span className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {identifierProfileName || identifierRaw || email}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIdentifierConfirmed(false);
                      setPassword('');
                    }}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
                  >
                    Trocar
                  </button>
                </div>

                {/* Campo de senha */}
                <div>
                  <label
                    className="block text-[11px] font-semibold text-slate-500 mb-2.5 uppercase"
                    style={{ letterSpacing: '0.14em' }}
                  >
                    Senha
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Lock className="w-[18px] h-[18px] text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setIsBanned(false); }}
                      disabled={isBlocked}
                      className="block w-full rounded-xl border border-[#e7e4de] bg-white text-slate-900 pl-11 pr-12 py-3.5 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 text-sm placeholder-slate-400 transition-all duration-200 hover:border-[#d9d5cd] shadow-[0_1px_2px_rgba(33,28,24,0.04)] disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed disabled:hover:border-[#e7e4de]"
                      placeholder={isBlocked ? 'Acesso temporariamente bloqueado' : 'Digite sua senha'}
                      required
                      autoFocus
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

                {/* Opções */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-slate-500 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 text-orange-500 focus:ring-orange-500 border-slate-300 rounded"
                      defaultChecked
                    />
                    Lembrar-me
                  </label>
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    disabled={resetting}
                    className="text-sm font-medium text-orange-600 hover:text-orange-700 disabled:opacity-50 transition-colors"
                  >
                    {resetting ? 'Enviando...' : 'Esqueceu a senha?'}
                  </button>
                </div>
              </>
            )}

            {/* Sessão expirada */}
            {sessionExpiredNotice && (
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3"/></svg>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Sessão encerrada</p>
                  <p className="text-sm text-amber-700 mt-0.5">Sua sessão expirou por inatividade. Faça login novamente.</p>
                </div>
              </div>
            )}

            {/* Acesso revogado */}
            {isBanned && (
              <div className="flex flex-col items-center gap-3 p-5 bg-orange-50 border border-orange-200 rounded-xl text-center">
                <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                  <Ban className="w-6 h-6 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-orange-900">Ops! Seu acesso foi revogado.</p>
                  <p className="text-sm text-orange-700 mt-1">
                    Sua conta foi desativada pelo administrador do escritório.
                    <br />
                    Entre em contato para reativar o acesso.
                  </p>
                </div>
              </div>
            )}

            {/* Bloqueio progressivo por IP com contador regressivo ao vivo */}
            {isBlocked && (
              <div className="flex items-start gap-3 p-4 bg-orange-50 border border-orange-200 rounded-xl">
                <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-[18px] h-[18px] text-orange-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-orange-900">Acesso temporariamente bloqueado</p>
                  <p className="text-sm text-orange-700 mt-0.5">
                    Muitas tentativas de login. Você pode tentar novamente em{' '}
                    <span className="font-bold tabular-nums text-orange-900">{formatCountdown(blockRemainingSec)}</span>.
                  </p>
                </div>
              </div>
            )}

            {/* Mensagem de erro */}
            {error && !isBanned && !isBlocked && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">Erro ao entrar</p>
                  <p className="text-sm text-red-600 mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {/* Mensagem de sucesso */}
            {resetMessage && (
              <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                <p className="text-sm text-emerald-700">{resetMessage}</p>
              </div>
            )}

            {/* Botão de submit */}
            <button
              type="submit"
              disabled={loading || identifierLoading || isBlocked || (identifierConfirmed && !password)}
              className="w-full flex justify-center items-center py-4 px-4 rounded-xl text-sm font-semibold text-white bg-[#16110d] hover:bg-black focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 transition-all duration-300 active:scale-[0.985] group mt-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_10px_30px_-12px_rgba(242,122,35,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]"
            >
              {isBlocked ? (
                <>
                  <Clock className="w-4 h-4 mr-2" />
                  Aguarde {formatCountdown(blockRemainingSec)}
                </>
              ) : loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Entrando...
                </>
              ) : identifierConfirmed ? (
                <>
                  Acessar Plataforma
                  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </>
              ) : (
                <>
                  Continuar
                  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          {/* Link para contato */}
          <div className="mt-8 pt-6 border-t border-[#eceae4] lg-rise" style={{ animationDelay: '320ms' }}>
            <p className="text-center text-xs text-slate-400">
              Precisa de ajuda?{' '}
              <a href="mailto:pedro@advcuiaba.com" className="font-semibold text-orange-600 hover:text-orange-700 transition-colors">
                Fale com um consultor
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center text-xs text-slate-400 mt-auto lg-rise" style={{ animationDelay: '400ms' }}>
          <span>© {new Date().getFullYear()} jurius.com.br</span>
          <div className="flex gap-4">
            <a href="#/terms" className="hover:text-orange-600 transition-colors">Termos</a>
            <a href="#/privacidade" className="hover:text-orange-600 transition-colors">Privacidade</a>
          </div>
        </div>
      </div>

      {/* ===== LADO DIREITO - VISUAL ===== */}
      <div className="hidden md:flex md:w-[55%] lg:w-[60%] relative items-center justify-center overflow-hidden min-h-screen md:h-screen bg-[#efe7dc]">
        {/* Ambient: foto do mês bem sutil + glow respirando + vinheta + grain */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <img
            src={heroImage}
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover opacity-[0.08]"
            style={{ filter: 'sepia(0.18) saturate(0.72) brightness(1.08)' }}
          />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(245,240,233,0.92) 0%, rgba(239,231,220,0.9) 36%, rgba(227,214,197,0.88) 100%)' }} />
          <div
            className="absolute -top-24 -right-16 w-[540px] h-[540px] rounded-full lg-anim"
            style={{
              background: 'radial-gradient(circle, rgba(242,122,35,0.16) 0%, rgba(242,122,35,0.07) 38%, transparent 70%)',
              animation: 'lg-breathe 8s ease-in-out infinite',
            }}
          />
          <div
            className="absolute -bottom-32 left-[-120px] h-[440px] w-[440px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(120,81,45,0.12) 0%, rgba(120,81,45,0.05) 44%, transparent 72%)' }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(120,99,77,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(120,99,77,0.06)_1px,transparent_1px)] bg-[size:100px_100px]" />
          <div
            className="absolute inset-0 opacity-[0.028]"
            style={{
              backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`,
            }}
          />
        </div>

        {/* Conteúdo */}
        <div className="relative z-10 w-full max-w-5xl px-8 lg:px-14 py-10 text-[#2c241d] h-full flex flex-col justify-between">
          {/* Header */}
          <div className="mb-8 lg-rise" style={{ animationDelay: '200ms' }}>
            <div
              className="inline-flex items-center gap-2.5 mb-7 rounded-full border border-[#e6d8c7] bg-white/65 px-4 py-2 text-[11px] font-semibold uppercase shadow-[0_12px_30px_-24px_rgba(44,33,24,0.35)] backdrop-blur-sm"
              style={{ letterSpacing: '0.28em', color: '#8e7156' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
              Plataforma Jurídica Integrada
            </div>
            <h2
              className="text-4xl lg:text-[52px] font-semibold leading-[1.1] tracking-tight mb-5"
              style={{ fontFamily: BRAND_SERIF }}
            >
              Gestão jurídica com{' '}
              <span
                className="text-transparent bg-clip-text"
                style={{ backgroundImage: 'linear-gradient(100deg, #f59e0b, #dc6b1f)' }}
              >
                seu escritório.
              </span>
            </h2>
            <p className="text-base lg:text-lg leading-relaxed max-w-2xl font-medium" style={{ color: '#6f6258' }}>
              Centralize operações, automatize prazos e foque no que realmente importa: seus clientes.
            </p>
          </div>

          {/* Cards de módulos */}
          <div className="mb-8">
            <div className="mb-4 flex items-end justify-between gap-6">
              <div className="lg-rise" style={{ animationDelay: '300ms' }}>
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#9b7a5c]">Tudo o que o escritório precisa</p>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#7a6a5d]">
                  Os módulos agora aparecem como uma vitrine funcional, não como uma lista corrida de etiquetas.
                </p>
              </div>
              <div className="hidden xl:flex items-center gap-2 rounded-full border border-white/70 bg-white/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8a7059] shadow-[0_12px_28px_-24px_rgba(44,33,24,0.4)]">
                <Sparkles className="h-3.5 w-3.5 text-orange-500" />
                Fluxo unificado
              </div>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3.5 lg:gap-4">
              {MODULE_CARDS.map((m, i) => {
                const tone = moduleToneClass[m.tone];
                return (
                  <div
                    key={m.title}
                    className={`group rounded-[26px] border p-4 lg:p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_22px_50px_-30px_rgba(44,33,24,0.28)] lg-rise ${tone.shell} ${m.size === 'lg' ? 'col-span-2 xl:col-span-1' : ''}`}
                    style={{ animationDelay: `${360 + i * 55}ms` }}
                  >
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border transition-transform duration-300 group-hover:scale-105 ${tone.iconWrap}`}>
                        <m.icon className={`h-5 w-5 ${tone.icon}`} />
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-[0.24em] ${tone.eyebrow}`}>
                        módulo
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-[#231b15] text-[15px] lg:text-[16px]">{m.title}</h3>
                      <p className="mt-2 text-[12.5px] leading-relaxed text-[#76685d]">{m.caption}</p>
                    </div>
                    <div className="mt-5 h-px w-full bg-[linear-gradient(90deg,rgba(128,101,79,0.18),rgba(128,101,79,0.02))]" />
                    <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold text-[#8b7766]">
                      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                      Pronto para operação diária
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Depoimento */}
          {testimonials.length > 0 && (
            <div className="lg-rise" style={{ animationDelay: '820ms' }}>
              <div
                className="h-px w-full mb-6"
                style={{ background: 'linear-gradient(90deg, rgba(114,91,72,0.18), transparent 65%)' }}
              />
              <p
                className="mb-4 text-[15px] leading-relaxed max-w-2xl"
                style={{ fontFamily: BRAND_SERIF, fontStyle: 'italic', color: '#5e4f42' }}
              >
                "{testimonials[testimonialIndex].quote}"
              </p>
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-[0_12px_28px_-16px_rgba(217,119,6,0.6)]"
                  style={{ background: 'linear-gradient(140deg, #f59e0b, #ea580c)' }}
                >
                  {testimonials[testimonialIndex].initials}
                </div>
                <div>
                  <div className="text-[#2b241d] font-medium text-sm">{testimonials[testimonialIndex].name}</div>
                  <div className="text-xs text-[#8a7868]">{testimonials[testimonialIndex].role}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
