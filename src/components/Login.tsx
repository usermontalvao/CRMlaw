import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Loader2, Eye, EyeOff, CheckCircle2, AlertCircle, Scale, Shield, Sparkles, Heart, Gift, Egg, Flag, Ghost, TreePine, Star, Flame, Snowflake, PartyPopper, Music, Rocket } from 'lucide-react';

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
  const [launching, setLaunching] = useState(false);
  const [rocketState, setRocketState] = useState<'idle' | 'launching' | 'crashing'>('idle');
  const crashTimeoutRef = useRef<number | null>(null);

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

  useEffect(() => {
    return () => {
      if (crashTimeoutRef.current) {
        clearTimeout(crashTimeoutRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetMessage(null);
    setLoading(true);
    setLaunching(true);
    setRocketState('launching');

    try {
      // Delay para a animação do foguete (5 segundos) antes de tentar o login
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Tentar login após a animação
      await onLogin(email, password);
    } catch (err: any) {
      setError(translateAuthError(err?.message));
      setRocketState('crashing');

      if (crashTimeoutRef.current) {
        clearTimeout(crashTimeoutRef.current);
      }

      crashTimeoutRef.current = window.setTimeout(() => {
        setLaunching(false);
        setRocketState('idle');
      }, 2500);
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
    <div className="relative flex min-h-screen w-full overflow-hidden bg-slate-50">
      {/* Overlay de Lançamento - Animação Nave */}
      {launching && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-900 animate-fade-in">
          {/* Estrelas de fundo */}
          <div className="absolute inset-0 overflow-hidden">
            {Array.from({ length: 50 }).map((_, i) => (
              <div
                key={i}
                className="absolute w-1 h-1 bg-white rounded-full animate-twinkle"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 2}s`,
                  opacity: Math.random() * 0.8 + 0.2,
                }}
              />
            ))}
          </div>
          
          {/* Rastro da nave */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-32 bg-gradient-to-t from-orange-500/0 via-orange-500/50 to-transparent animate-rocket-exhaust opacity-0" style={{ height: '40vh' }} />
          
          {/* Nave/Foguete Customizado */}
          <div className="relative z-10 animate-rocket-launch">
            <div className="relative transform scale-150">
              {/* Corpo do foguete */}
              <div className="relative w-12 h-24 bg-slate-100 rounded-[50%_50%_50%_50%_/_60%_60%_40%_40%] shadow-inner overflow-hidden z-20 mx-auto border border-slate-300">
                {/* Janela */}
                <div className="absolute top-6 left-1/2 -translate-x-1/2 w-6 h-6 bg-sky-300 rounded-full border-2 border-slate-300 shadow-inner">
                  <div className="absolute top-1 left-1 w-2 h-2 bg-white rounded-full opacity-50" />
                </div>
                {/* Detalhes */}
                <div className="absolute bottom-0 w-full h-1 bg-red-500" />
                <div className="absolute bottom-2 w-full h-1 bg-red-500" />
              </div>

              {/* Asas esquerda */}
              <div className="absolute bottom-2 -left-3 w-6 h-10 bg-red-600 rounded-tl-full rounded-bl-lg skew-y-12 z-10 border-l border-red-700" />
              
              {/* Asas direita */}
              <div className="absolute bottom-2 -right-3 w-6 h-10 bg-red-600 rounded-tr-full rounded-br-lg -skew-y-12 z-10 border-r border-red-700" />

              {/* Fogo principal */}
              <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 w-8 h-16 z-0">
                <div className="absolute inset-0 bg-gradient-to-t from-transparent via-yellow-400 to-red-500 rounded-b-full animate-fire blur-[2px]" />
                <div className="absolute inset-2 bg-gradient-to-t from-transparent via-yellow-200 to-white rounded-b-full animate-fire-inner blur-[1px]" />
              </div>
              
              {/* Partículas de propulsão */}
              <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 w-2 h-20 bg-white/20 blur-md animate-pulse" />
            </div>
          </div>
          
          {/* Texto */}
          <div className="relative z-10 mt-12 text-center animate-fade-in-up">
            <p className="text-2xl font-bold text-white mb-2">
              🚀 Decolando...
            </p>
            <p className="text-amber-400 text-lg font-medium">
              Entrando no melhor CRM jurídico!
            </p>
          </div>
        </div>
      )}
      {/* Subtle Background Gradient */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute top-20 left-10 w-96 h-96 rounded-full blur-3xl opacity-30"
          style={{ backgroundColor: `${theme.particleColors[0]}` }}
        />
        <div 
          className="absolute bottom-20 right-10 w-80 h-80 rounded-full blur-3xl opacity-20"
          style={{ backgroundColor: `${theme.particleColors[1]}` }}
        />
      </div>

      {/* Left Side - Login Form */}
      <div
        className={`flex w-full flex-col items-center justify-center bg-white p-8 lg:w-1/2 lg:p-16 transition-all duration-700 ${
          mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
        }`}
      >
        <div className="flex w-full max-w-md flex-col items-start gap-8">
          {/* Logo & Title */}
          <div className="flex w-full flex-col items-start gap-2">
            <div className="flex items-center gap-4 mb-4">
              <div className="relative">
                <div className="absolute -inset-1 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl blur opacity-20" />
                <img
                  src="/icon-512.png"
                  alt="Advogado.WEB"
                  className="relative h-16 w-16 rounded-xl shadow-lg"
                />
              </div>
              <div>
                <h1 className="text-4xl font-bold tracking-tight text-slate-900">
                  Advogado<span className="text-amber-600 font-semibold">.WEB</span>
                </h1>
                <p className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                  <Shield className="w-3 h-3" />
                  Plataforma Segura
                </p>
              </div>
            </div>
            <h2 className={`text-3xl font-bold tracking-tight text-slate-800 transition-all duration-500 delay-100 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
              Acesse sua conta
            </h2>
            <p className={`text-base font-normal leading-normal text-slate-500 transition-all duration-500 delay-200 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
              Bem-vindo de volta! Insira seus dados abaixo.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className={`flex w-full flex-col gap-4 transition-all duration-500 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            {/* Email */}
            <label className="flex flex-col w-full group">
              <p className="text-sm font-medium leading-normal text-slate-700 pb-2 group-focus-within:text-amber-600 transition-colors">
                E-mail ou Usuário
              </p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex w-full rounded-lg border border-slate-300 bg-white h-12 px-4 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all duration-200 hover:border-slate-400"
                placeholder="seunome@exemplo.com"
                required
              />
            </label>

            {/* Password */}
            <label className="flex flex-col w-full group">
              <div className="flex items-center justify-between w-full pb-2">
                <p className="text-sm font-medium leading-normal text-slate-700 group-focus-within:text-amber-600 transition-colors">Senha</p>
                <span className="text-[11px] uppercase tracking-wide text-slate-400">mín. 8 caracteres</span>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex w-full rounded-lg border border-slate-300 bg-white h-12 px-4 pr-12 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all duration-200 hover:border-slate-400"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-amber-500 transition-colors duration-200"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </label>

            <div className="flex flex-col gap-2 text-sm">
              <label className="inline-flex items-center gap-2 text-slate-600 select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  defaultChecked
                />
                Manter sessão ativa neste dispositivo
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2 text-slate-500">
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={resetting}
                  className="inline-flex items-center gap-1 font-medium text-amber-600/80 hover:text-amber-600 transition-colors disabled:opacity-50"
                >
                  {resetting ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Enviando link de recuperação...
                    </>
                  ) : (
                    'Esqueceu a senha?'
                  )}
                </button>
                <a
                  href="mailto:pedro@advcuiaba.com"
                  className="inline-flex items-center gap-1 hover:text-slate-700 transition-colors"
                >
                  <Shield className="w-3.5 h-3.5" />
                  Precisa de ajuda?
                </a>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2 animate-shake">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Success */}
            {resetMessage && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2 animate-fade-in">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{resetMessage}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="relative flex items-center justify-center font-semibold text-base text-white bg-slate-900 hover:bg-slate-800 rounded-lg w-full h-12 mt-4 transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-amber-500 to-amber-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <span className="relative flex items-center gap-2">
                {loading ? (
                  <>
                    <Rocket className="w-5 h-5 animate-bounce" />
                    Decolando...
                  </>
                ) : (
                  <>
                    <Rocket className="w-4 h-4 group-hover:animate-bounce" />
                    Entrar
                  </>
                )}
              </span>
            </button>
          </form>

          {/* Footer */}
          <div className="w-full text-center mt-4">
            <p className="text-sm text-slate-400">
              © {new Date().getFullYear()} Advogado.WEB. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </div>

      {/* Right Side - Hero */}
      <div
        className={`relative hidden w-1/2 flex-col items-start justify-between bg-slate-900 p-12 text-white lg:flex transition-all duration-700 delay-200 ${
          mounted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'
        }`}
      >
        {/* Background Image */}
        <div
          className="absolute inset-0 bg-center bg-cover"
          style={{
            backgroundImage: `url('${theme.heroImage}')`,
          }}
        />
        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900/95 via-slate-900/90 to-slate-900/85" />

        {/* Hero Content */}
        <div className={`relative z-10 flex w-full max-w-lg flex-col items-start gap-6 transition-all duration-700 delay-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
          <h2 className="text-5xl font-bold text-white leading-tight">
            Simplifique sua<br />
            gestão jurídica.
          </h2>
          <p className="text-white/80 text-xl leading-relaxed">
            Centralize casos, clientes e documentos com a ferramenta mais completa do mercado.
          </p>
          
          {/* Feature pills */}
          <div className="flex flex-wrap gap-2.5 mt-2">
            {['Processos', 'Prazos', 'Clientes', 'Financeiro'].map((feature) => (
              <span 
                key={feature}
                className="px-4 py-2 rounded-full bg-white/15 text-white text-sm font-medium backdrop-blur-md border border-white/30 hover:bg-white/25 transition-all cursor-default"
              >
                {feature}
              </span>
            ))}
          </div>
        </div>

        {/* Testimonial */}
        <div 
          className={`relative z-10 mt-auto w-full max-w-lg rounded-2xl bg-black/30 p-6 backdrop-blur-md border border-white/20 transition-all duration-700 delay-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
        >
          <p className="text-lg font-medium leading-relaxed text-white/90">
            "A organização é a chave para a justiça. Com este CRM, alcançamos um novo patamar de
            eficiência e precisão em nosso escritório."
          </p>
          <p className="mt-4 text-sm text-white/60">
            — Equipe Advogado.WEB
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
