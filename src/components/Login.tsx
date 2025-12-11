import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Loader2, Eye, EyeOff, CheckCircle2, AlertCircle, Scale, Shield, Sparkles, Heart, Gift, Egg, Flag, Ghost, TreePine, Star, Flame, Snowflake, PartyPopper, Music, Rocket, User, Lock, ArrowRight } from 'lucide-react';
import { supabase } from '../config/supabase';
import { clientService } from '../services/client.service';

const BrazilFlag: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 28 20"
    className={className}
    role="img"
    aria-label="Bandeira do Brasil"
  >
    <rect width="28" height="20" rx="2" fill="#009C3B" />
    <polygon points="14,3 25,10 14,17 3,10" fill="#FFDF00" />
    <circle cx="14" cy="10" r="5" fill="#002776" />
    <path
      d="M9 9.5c3-.8 7 1.2 10 1"
      stroke="#fff"
      strokeWidth="0.8"
      fill="none"
    />
  </svg>
);

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onResetPassword: (email: string) => Promise<void>;
}

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

// Partícula animada
interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
  type: 'confetti' | 'snow' | 'heart' | 'star' | 'firework' | 'leaf' | 'balloon' | 'sparkle';
}

// Temas festivos brasileiros por mês
interface FestiveTheme {
  name: string;
  emoji: string;
  gradient: string;
  accentColor: string;
  particleColors: string[];
  message: string;
  icon: React.ReactNode;
  particleType: Particle['type'];
  bannerAnimation: string;
  specialEffect: 'confetti' | 'snow' | 'fireworks' | 'hearts' | 'leaves' | 'balloons' | 'sparkles' | 'none';
  backgroundOverlay: string;
  heroImage: string;
  symbolRenderer?: (className?: string) => React.ReactNode;
}

// Gerar partículas aleatórias
const generateParticles = (count: number, type: Particle['type'], colors: string[]): Particle[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 10 + 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    delay: Math.random() * 5,
    duration: Math.random() * 3 + 2,
    type,
  }));
};

const getFestiveTheme = (): FestiveTheme => {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const day = now.getDate();
  const heroImage = HERO_IMAGES[month] ?? HERO_IMAGES[0];

  // Janeiro - Ano Novo / Verão
  if (month === 0) {
    return {
      name: 'Ano Novo',
      emoji: '🎆',
      gradient: 'from-yellow-400 via-orange-500 to-red-500',
      accentColor: 'text-yellow-500',
      particleColors: ['#FFD700', '#FFA500', '#FF6347', '#FFE4B5', '#FFFFFF'],
      message: '✨ Feliz Ano Novo! ✨',
      icon: <PartyPopper className="w-4 h-4" />,
      particleType: 'firework',
      bannerAnimation: 'animate-pulse',
      specialEffect: 'fireworks',
      backgroundOverlay: 'bg-gradient-to-br from-indigo-900/90 via-purple-900/80 to-pink-900/70',
      heroImage,
    };
  }

  // Fevereiro - Carnaval
  if (month === 1) {
    return {
      name: 'Carnaval',
      emoji: '🎭',
      gradient: 'from-purple-500 via-pink-500 to-yellow-400',
      accentColor: 'text-purple-500',
      particleColors: ['#9333EA', '#EC4899', '#FBBF24', '#22C55E', '#3B82F6', '#EF4444'],
      message: '🎉 É Carnaval! 🎊',
      icon: <Music className="w-4 h-4 animate-bounce" />,
      particleType: 'confetti',
      bannerAnimation: 'animate-bounce',
      specialEffect: 'confetti',
      backgroundOverlay: 'bg-gradient-to-br from-purple-900/80 via-pink-900/70 to-yellow-900/60',
      heroImage,
    };
  }

  // Março/Abril - Páscoa (aproximado)
  if (month === 2 || (month === 3 && day <= 20)) {
    return {
      name: 'Páscoa',
      emoji: '🐰',
      gradient: 'from-pink-400 via-purple-400 to-indigo-400',
      accentColor: 'text-pink-500',
      particleColors: ['#F9A8D4', '#C084FC', '#A78BFA', '#FDE68A', '#86EFAC'],
      message: '🐣 Feliz Páscoa! 🥚',
      icon: <Egg className="w-4 h-4" />,
      particleType: 'sparkle',
      bannerAnimation: '',
      specialEffect: 'sparkles',
      backgroundOverlay: 'bg-gradient-to-br from-pink-900/70 via-purple-900/60 to-indigo-900/70',
      heroImage,
    };
  }

  // Abril - Tiradentes / Outono
  if (month === 3) {
    return {
      name: 'Outono',
      emoji: '🍂',
      gradient: 'from-orange-400 via-red-500 to-yellow-600',
      accentColor: 'text-orange-500',
      particleColors: ['#F97316', '#EF4444', '#FBBF24', '#92400E', '#DC2626'],
      message: '🍁 Boas vindas ao Outono! 🍂',
      icon: <Flame className="w-4 h-4" />,
      particleType: 'leaf',
      bannerAnimation: '',
      specialEffect: 'leaves',
      backgroundOverlay: 'bg-gradient-to-br from-orange-900/80 via-red-900/70 to-yellow-900/60',
      heroImage,
    };
  }

  // Maio - Dia das Mães
  if (month === 4) {
    return {
      name: 'Dia das Mães',
      emoji: '💐',
      gradient: 'from-pink-400 via-rose-500 to-red-400',
      accentColor: 'text-pink-500',
      particleColors: ['#EC4899', '#F43F5E', '#FB7185', '#FDA4AF', '#FFFFFF'],
      message: '💕 Feliz Dia das Mães! 💐',
      icon: <Heart className="w-4 h-4 animate-pulse" />,
      particleType: 'heart',
      bannerAnimation: '',
      specialEffect: 'hearts',
      backgroundOverlay: 'bg-gradient-to-br from-pink-900/80 via-rose-900/70 to-red-900/60',
      heroImage,
    };
  }

  // Junho - Festa Junina
  if (month === 5) {
    return {
      name: 'Festa Junina',
      emoji: '🎪',
      gradient: 'from-orange-500 via-red-600 to-yellow-500',
      accentColor: 'text-orange-500',
      particleColors: ['#F97316', '#DC2626', '#FBBF24', '#22C55E', '#FFFFFF'],
      message: '🌽 Arraiá! 🔥',
      icon: <Flame className="w-4 h-4 animate-pulse" />,
      particleType: 'sparkle',
      bannerAnimation: '',
      specialEffect: 'sparkles',
      backgroundOverlay: 'bg-gradient-to-br from-orange-900/80 via-red-900/70 to-yellow-900/60',
      heroImage,
    };
  }

  // Julho - Inverno / Férias
  if (month === 6) {
    return {
      name: 'Inverno',
      emoji: '❄️',
      gradient: 'from-blue-400 via-cyan-400 to-sky-500',
      accentColor: 'text-blue-400',
      particleColors: ['#FFFFFF', '#E0F2FE', '#BAE6FD', '#7DD3FC', '#38BDF8'],
      message: '❄️ Bom Inverno! ☃️',
      icon: <Snowflake className="w-4 h-4 animate-spin-slow" />,
      particleType: 'snow',
      bannerAnimation: '',
      specialEffect: 'snow',
      backgroundOverlay: 'bg-gradient-to-br from-blue-900/80 via-cyan-900/70 to-sky-900/60',
      heroImage,
    };
  }

  // Agosto - Dia dos Pais
  if (month === 7) {
    return {
      name: 'Dia dos Pais',
      emoji: '👔',
      gradient: 'from-blue-500 via-indigo-500 to-purple-600',
      accentColor: 'text-blue-500',
      particleColors: ['#3B82F6', '#6366F1', '#8B5CF6', '#FFFFFF', '#1E40AF'],
      message: '👨 Feliz Dia dos Pais! 💙',
      icon: <Heart className="w-4 h-4" />,
      particleType: 'star',
      bannerAnimation: '',
      specialEffect: 'sparkles',
      backgroundOverlay: 'bg-gradient-to-br from-blue-900/80 via-indigo-900/70 to-purple-900/60',
      heroImage,
    };
  }

  // Setembro - Independência / Primavera
  if (month === 8) {
    return {
      name: 'Independência',
      emoji: '🇧🇷',
      gradient: 'from-green-500 via-yellow-400 to-blue-500',
      accentColor: 'text-green-500',
      particleColors: ['#22C55E', '#FBBF24', '#3B82F6', '#FFFFFF'],
      message: '🇧🇷 Viva o Brasil! 💚💛',
      icon: <Flag className="w-4 h-4" />,
      particleType: 'confetti',
      bannerAnimation: '',
      specialEffect: 'confetti',
      backgroundOverlay: 'bg-gradient-to-br from-green-900/80 via-yellow-900/60 to-blue-900/70',
      heroImage,
    };
  }

  // Outubro - Dia das Crianças / Halloween
  if (month === 9) {
    return {
      name: 'Dia das Crianças',
      emoji: '🎈',
      gradient: 'from-orange-400 via-pink-500 to-purple-500',
      accentColor: 'text-orange-500',
      particleColors: ['#F97316', '#EC4899', '#A855F7', '#22C55E', '#3B82F6', '#EF4444'],
      message: '🎈 Feliz Dia das Crianças! 🎁',
      icon: <Gift className="w-4 h-4 animate-bounce" />,
      particleType: 'balloon',
      bannerAnimation: 'animate-bounce',
      specialEffect: 'balloons',
      backgroundOverlay: 'bg-gradient-to-br from-orange-900/70 via-pink-900/60 to-purple-900/70',
      heroImage,
    };
  }

  // Novembro - Proclamação da República
  if (month === 10) {
    return {
      name: 'República',
      emoji: '🇧🇷',
      gradient: 'from-green-600 via-yellow-400 to-green-600',
      accentColor: 'text-yellow-400',
      particleColors: ['#16A34A', '#FACC15', '#166534', '#FDE047', '#15803D'],
      message: '🇧🇷 Viva a República! 15 de Novembro 🇧🇷',
      icon: <BrazilFlag className="w-5 h-4" />,
      particleType: 'star',
      bannerAnimation: '',
      specialEffect: 'sparkles',
      backgroundOverlay: 'bg-gradient-to-br from-green-900/85 via-yellow-900/70 to-green-900/80',
      symbolRenderer: (className) => <BrazilFlag className={`inline-block ${className ?? ''}`} />,
      heroImage,
    };
  }

  // Dezembro - Natal
  return {
    name: 'Natal',
    emoji: '🎄',
    gradient: 'from-red-500 via-green-600 to-red-600',
    accentColor: 'text-red-500',
    particleColors: ['#FFFFFF', '#EF4444', '#22C55E', '#FBBF24', '#F87171'],
    message: '🎅 Feliz Natal! 🎄',
    icon: <TreePine className="w-4 h-4" />,
    particleType: 'snow',
    bannerAnimation: '',
    specialEffect: 'snow',
    backgroundOverlay: 'bg-gradient-to-br from-red-900/80 via-green-900/70 to-red-900/60',
    heroImage,
  };
};

// Componente de partículas animadas
const AnimatedParticles: React.FC<{ theme: FestiveTheme }> = ({ theme }) => {
  const particles = useMemo(() => generateParticles(15, theme.particleType, theme.particleColors), [theme]);

  const getParticleStyle = (particle: Particle): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      left: `${particle.x}%`,
      animationDelay: `${particle.delay}s`,
      animationDuration: `${particle.duration}s`,
    };

    switch (particle.type) {
      case 'snow':
        return { ...baseStyle, top: '-20px', fontSize: `${particle.size}px` };
      case 'confetti':
        return { ...baseStyle, top: '-20px', width: `${particle.size}px`, height: `${particle.size * 0.6}px`, backgroundColor: particle.color };
      case 'heart':
        return { ...baseStyle, top: '-20px', fontSize: `${particle.size + 5}px`, color: particle.color };
      case 'star':
        return { ...baseStyle, top: '-20px', fontSize: `${particle.size}px`, color: particle.color };
      case 'firework':
        return { ...baseStyle, bottom: '0', fontSize: `${particle.size + 8}px` };
      case 'leaf':
        return { ...baseStyle, top: '-20px', fontSize: `${particle.size + 3}px` };
      case 'balloon':
        return { ...baseStyle, bottom: '-50px', fontSize: `${particle.size + 10}px` };
      case 'sparkle':
        return { ...baseStyle, top: `${particle.y}%`, fontSize: `${particle.size}px`, color: particle.color };
      default:
        return baseStyle;
    }
  };

  const getParticleContent = (particle: Particle) => {
    switch (particle.type) {
      case 'snow': return '❄';
      case 'confetti': return null;
      case 'heart': return '❤';
      case 'star': return '⭐';
      case 'firework': return '✨';
      case 'leaf': return '🍂';
      case 'balloon': return '🎈';
      case 'sparkle': return '✦';
      default: return '•';
    }
  };

  const getAnimationClass = (type: Particle['type']) => {
    switch (type) {
      case 'snow': return 'animate-snowfall';
      case 'confetti': return 'animate-confetti';
      case 'heart': return 'animate-float-up';
      case 'star': return 'animate-twinkle';
      case 'firework': return 'animate-firework';
      case 'leaf': return 'animate-leaf-fall';
      case 'balloon': return 'animate-balloon';
      case 'sparkle': return 'animate-sparkle';
      default: return '';
    }
  };

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-10">
      {particles.map((particle) => (
        <div
          key={particle.id}
          className={`${getAnimationClass(particle.type)} opacity-80`}
          style={getParticleStyle(particle)}
        >
          {getParticleContent(particle)}
        </div>
      ))}
    </div>
  );
};

const Login: React.FC<LoginProps> = ({ onLogin, onResetPassword }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [logoHover, setLogoHover] = useState(false);
  const [identifierConfirmed, setIdentifierConfirmed] = useState(false);
  const [identifierRaw, setIdentifierRaw] = useState('');
  const [identifierProfileName, setIdentifierProfileName] = useState<string | null>(null);
  const [identifierProfileAvatar, setIdentifierProfileAvatar] = useState<string | null>(null);
  const [identifierLoading, setIdentifierLoading] = useState(false);
  const [testimonialIndex, setTestimonialIndex] = useState(0);

  const testimonials = useMemo(
    () => [
      {
        initials: 'AW',
        name: 'Equipe Advogado.WEB',
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

  const theme = useMemo(() => getFestiveTheme(), []);

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

    if (normalized.includes('rate limit') || normalized.includes('too many requests')) {
      return 'Muitas tentativas em sequência. Aguarde alguns segundos e tente novamente.';
    }

    if (normalized.includes('network error') || normalized.includes('fetch')) {
      return 'Não foi possível comunicar com o servidor. Verifique sua conexão.';
    }

    return 'Não foi possível fazer login. Verifique os dados e tente novamente.';
  }, []);

  const renderThemeSymbol = useCallback(
    (className?: string) =>
      theme.symbolRenderer ? theme.symbolRenderer(className) : <span className={className}>{theme.emoji}</span>,
    [theme]
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const loadIdentifierProfile = useCallback(async (identifier: string): Promise<boolean> => {
    setIdentifierLoading(true);

    try {
      const trimmed = identifier.trim();

      // 1) Se for e-mail, buscamos direto em profiles
      if (trimmed.includes('@')) {
        const { data, error } = await supabase
          .from('profiles')
          .select('name, avatar_url, email')
          .ilike('email', trimmed);

        if (error) {
          console.error('Erro ao buscar perfil para login:', error.message);
          setIdentifierProfileName(null);
          setIdentifierProfileAvatar(null);
          return false;
        }

        const profile = data && data.length > 0 ? data[0] : null;
        if (!profile) {
          setIdentifierProfileName(null);
          setIdentifierProfileAvatar(null);
          return false;
        }

        // Garantimos que o e-mail do estado é o mesmo do perfil
        if (profile.email && profile.email !== email) {
          setEmail(profile.email);
        }

        setIdentifierProfileName(profile.name ?? null);
        setIdentifierProfileAvatar(profile.avatar_url ?? null);
        return true;
      }

      // 2) Se não for e-mail, tratamos como CPF/CNPJ: buscamos em clients.cpf_cnpj
      const numericId = trimmed.replace(/\D/g, '');
      if (!numericId) {
        setIdentifierProfileName(null);
        setIdentifierProfileAvatar(null);
        return false;
      }

      try {
        const client = await clientService.getClientByCpfCnpj(numericId);
        if (!client || !client.email) {
          setIdentifierProfileName(null);
          setIdentifierProfileAvatar(null);
          return false;
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

        return true;
      } catch (clientError) {
        console.error('Erro ao buscar cliente por CPF/CNPJ para login:', clientError);
        setIdentifierProfileName(null);
        setIdentifierProfileAvatar(null);
        return false;
      }
    } catch (e) {
      console.error('Erro inesperado ao buscar identificador para login:', e);
      setIdentifierProfileName(null);
      setIdentifierProfileAvatar(null);
      return false;
    } finally {
      setIdentifierLoading(false);
    }
  }, [email]);

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
      const found = await loadIdentifierProfile(email.trim());
      if (!found) {
        setError('Usuário não encontrado. Verifique o e-mail informado.');
        setIdentifierConfirmed(false);
        return;
      }

      setIdentifierConfirmed(true);
      return;
    }

    // Etapa 2: login com senha
    setError(null);
    setResetMessage(null);
    setLoading(true);

    try {
      await onLogin(email, password);
    } catch (err: any) {
      setError(translateAuthError(err?.message));
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
    <div className="min-h-screen md:h-screen flex flex-col md:flex-row overflow-hidden bg-white">
      {/* ===== LADO ESQUERDO - LOGIN ===== */}
      <div
        className={`w-full md:w-[45%] lg:w-[40%] flex flex-col justify-between p-8 md:p-10 lg:p-12 bg-white relative z-20 shadow-2xl min-h-screen md:h-screen md:overflow-y-auto transition-all duration-700 ${
          mounted ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Header - Logo */}
        <div className="flex items-center gap-3 select-none">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-orange-500/20">
            AW
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 leading-none">
              Advogado<span className="text-orange-500">.WEB</span>
            </h1>
            <span className="text-[11px] font-medium text-slate-400 tracking-wide uppercase mt-1">
              Gestão Jurídica Inteligente
            </span>
          </div>
        </div>

        {/* Centro - Formulário */}
        <div className="flex flex-col justify-center flex-grow py-8 max-w-md mx-auto w-full">
          {/* Badge */}
          <div
            className={`inline-flex items-center self-start bg-orange-50 text-orange-700 text-[11px] font-bold tracking-wider px-3 py-1.5 rounded-full mb-8 border border-orange-100 uppercase transition-all duration-500 ${
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
          >
            <span className="w-1.5 h-1.5 bg-orange-500 rounded-full mr-2 animate-pulse" />
            Acesso Exclusivo
          </div>

          {/* Título */}
          <h2
            className={`text-3xl md:text-4xl font-bold text-slate-900 mb-3 tracking-tight transition-all duration-500 delay-75 ${
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
          >
            Bem-vindo de volta
          </h2>
          <p
            className={`text-slate-500 mb-10 text-base leading-relaxed transition-all duration-500 delay-100 ${
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
          >
            Acesse seu painel jurídico e gerencie seu escritório com eficiência e segurança.
          </p>

          {/* Formulário */}
          <form
            onSubmit={handleSubmit}
            className={`space-y-5 transition-all duration-500 delay-150 ${
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
          >
            {/* Etapa 1 - Identificador */}
            {!identifierConfirmed && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  E-mail ou CPF
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="w-5 h-5 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                  </div>
                  <input
                    type="text"
                    value={identifierRaw}
                    onChange={(e) => {
                      setIdentifierRaw(e.target.value);
                      setEmail(e.target.value);
                    }}
                    className="block w-full rounded-xl border border-slate-200 bg-slate-50 text-slate-900 pl-10 pr-4 py-3.5 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 text-sm placeholder-slate-400 transition-all duration-200 hover:border-slate-300"
                    placeholder="seuemail@advogado.com"
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
                <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl border border-orange-100">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-orange-600 text-white font-bold text-lg uppercase overflow-hidden shadow-lg shadow-orange-500/20">
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
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {identifierProfileName || identifierRaw || email}
                    </p>
                    <p className="text-xs text-orange-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Conta verificada
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIdentifierConfirmed(false);
                      setPassword('');
                    }}
                    className="text-xs text-slate-500 hover:text-slate-700 font-medium px-2 py-1 rounded hover:bg-slate-100 transition-colors"
                  >
                    Trocar
                  </button>
                </div>

                {/* Campo de senha */}
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
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="block w-full rounded-xl border border-slate-200 bg-slate-50 text-slate-900 pl-10 pr-12 py-3.5 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 text-sm placeholder-slate-400 transition-all duration-200 hover:border-slate-300"
                      placeholder="Digite sua senha"
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
                    className="text-sm font-medium text-orange-500 hover:text-orange-600 disabled:opacity-50 transition-colors"
                  >
                    {resetting ? 'Enviando...' : 'Esqueceu a senha?'}
                  </button>
                </div>
              </>
            )}

            {/* Mensagem de erro */}
            {error && (
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
              disabled={loading || identifierLoading || (identifierConfirmed && !password)}
              className="w-full flex justify-center items-center py-3.5 px-4 border border-transparent rounded-xl shadow-lg shadow-orange-500/20 text-sm font-semibold text-white bg-gradient-to-r from-slate-900 to-slate-800 hover:from-black hover:to-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 transition-all duration-300 transform active:scale-[0.98] group mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
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
          <div className="mt-8 pt-6 border-t border-slate-100">
            <p className="text-center text-xs text-slate-400">
              Precisa de ajuda?{' '}
              <a href="mailto:pedro@advcuiaba.com" className="font-semibold text-orange-500 hover:text-orange-600 transition-colors">
                Fale com um consultor
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center text-xs text-slate-400 mt-auto">
          <span>© {new Date().getFullYear()} Advogado.WEB</span>
          <div className="flex gap-4">
            <a href="#/terms" className="hover:text-orange-500 transition-colors">Termos</a>
            <a href="#/privacidade" className="hover:text-orange-500 transition-colors">Privacidade</a>
          </div>
        </div>
      </div>

      {/* ===== LADO DIREITO - VISUAL ===== */}
      <div
        className={`hidden md:flex md:w-[55%] lg:w-[60%] relative bg-slate-900 items-center justify-center overflow-hidden min-h-screen md:h-screen transition-all duration-700 delay-100 ${
          mounted ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Background */}
        <div className="absolute inset-0 z-0">
          <img
            src={theme.heroImage}
            alt="Background"
            className="w-full h-full object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-800/90" />
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-orange-500/20 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/3" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[100px] translate-y-1/3 -translate-x-1/3" />
        </div>

        {/* Conteúdo */}
        <div className="relative z-10 w-full max-w-4xl px-8 lg:px-14 py-10 text-white h-full flex flex-col justify-between">
          {/* Header */}
          <div className={`mb-8 transition-all duration-700 delay-200 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm mb-6 w-fit">
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              <span className="text-xs font-medium tracking-wide uppercase text-slate-300">Plataforma All-in-One</span>
            </div>
            <h2 className="text-4xl lg:text-5xl font-bold leading-tight mb-4">
              Simplifique a rotina do <br />
              <span className="bg-gradient-to-r from-white to-slate-400 text-transparent bg-clip-text">seu escritório.</span>
            </h2>
            <p className="text-slate-300 text-base lg:text-lg leading-relaxed max-w-xl font-light">
              Centralize operações, automatize prazos e foque no que realmente importa: seus clientes.
            </p>
          </div>

          {/* Cards de módulos */}
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-5 mb-8 transition-all duration-700 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            <div className="group bg-slate-800/40 backdrop-blur-md border border-white/5 hover:border-orange-500/30 p-4 rounded-2xl transition-all duration-300 hover:bg-slate-800/60 hover:-translate-y-1">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white shadow-lg shadow-orange-500/20 group-hover:scale-110 transition-transform duration-300">
                  <User className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-base">Gerenciar Clientes</h3>
                  <p className="text-xs text-slate-400 mt-1">CRM Jurídico completo</p>
                </div>
              </div>
            </div>
            <div className="group bg-slate-800/40 backdrop-blur-md border border-white/5 hover:border-orange-500/30 p-4 rounded-2xl transition-all duration-300 hover:bg-slate-800/60 hover:-translate-y-1">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-700 to-slate-600 flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform duration-300">
                  <Scale className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-base">Processos & Prazos</h3>
                  <p className="text-xs text-slate-400 mt-1">Monitoramento 24/7</p>
                </div>
              </div>
            </div>
            <div className="group bg-slate-800/40 backdrop-blur-md border border-white/5 hover:border-orange-500/30 p-4 rounded-2xl transition-all duration-300 hover:bg-slate-800/60 hover:-translate-y-1">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-700 to-slate-600 flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform duration-300">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-base">Intimações</h3>
                  <p className="text-xs text-slate-400 mt-1">Captura automática</p>
                </div>
              </div>
            </div>
            <div className="group bg-slate-800/40 backdrop-blur-md border border-white/5 hover:border-orange-500/30 p-4 rounded-2xl transition-all duration-300 hover:bg-slate-800/60 hover:-translate-y-1">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-700 to-slate-600 flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform duration-300">
                  <Shield className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-base">Admin. Previdenciário</h3>
                  <p className="text-xs text-slate-400 mt-1">Integração INSS</p>
                </div>
              </div>
            </div>
            <div className="group bg-slate-800/40 backdrop-blur-md border border-white/5 hover:border-orange-500/30 p-4 rounded-2xl transition-all duration-300 hover:bg-slate-800/60 hover:-translate-y-1">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-700 to-slate-600 flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform duration-300">
                  <Rocket className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-base">Gestão de Leads</h3>
                  <p className="text-xs text-slate-400 mt-1">Converta mais clientes potenciais</p>
                </div>
              </div>
            </div>
            <div className="group bg-slate-800/40 backdrop-blur-md border border-white/5 hover:border-orange-500/30 p-4 rounded-2xl transition-all duration-300 hover:bg-slate-800/60 hover:-translate-y-1">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20 group-hover:scale-110 transition-transform duration-300">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-base">...e muito mais</h3>
                  <p className="text-xs text-slate-400 mt-1">Automação, integrações e insights para todo o escritório</p>
                </div>
              </div>
            </div>
          </div>

          {/* Depoimento */}
          {testimonials.length > 0 && (
            <div className={`relative pl-5 border-l-2 border-orange-500/50 transition-all duration-700 delay-400 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
              <p className="text-slate-200 italic mb-3 relative z-10 text-sm font-light leading-relaxed">
                "{testimonials[testimonialIndex].quote}"
              </p>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white font-bold text-xs ring-2 ring-slate-800">
                  {testimonials[testimonialIndex].initials}
                </div>
                <div>
                  <div className="text-white font-medium text-sm">{testimonials[testimonialIndex].name}</div>
                  <div className="text-slate-400 text-xs">{testimonials[testimonialIndex].role}</div>
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
