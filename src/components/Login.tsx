import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, Eye, EyeOff, CheckCircle2, AlertCircle, Scale, Shield, Sparkles, Heart, Gift, Egg, Flag, Ghost, TreePine, Star, Flame, Snowflake, PartyPopper, Music } from 'lucide-react';

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
  };
};

// Componente de partículas animadas
const AnimatedParticles: React.FC<{ theme: FestiveTheme }> = ({ theme }) => {
  const particles = useMemo(() => generateParticles(30, theme.particleType, theme.particleColors), [theme]);

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

  const theme = useMemo(() => getFestiveTheme(), []);

  const renderThemeSymbol = useCallback(
    (className?: string) =>
      theme.symbolRenderer ? theme.symbolRenderer(className) : <span className={className}>{theme.emoji}</span>,
    [theme]
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
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
    <div className="relative flex min-h-screen w-full overflow-hidden bg-slate-50">
      {/* Animated Particles Layer */}
      <AnimatedParticles theme={theme} />

      {/* Animated Background Blobs - Themed */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute top-20 left-10 w-72 h-72 rounded-full blur-3xl animate-pulse"
          style={{ backgroundColor: `${theme.particleColors[0]}33` }}
        />
        <div 
          className="absolute bottom-20 right-10 w-96 h-96 rounded-full blur-3xl animate-pulse"
          style={{ backgroundColor: `${theme.particleColors[1]}33`, animationDelay: '1s' }}
        />
        <div 
          className="absolute top-1/2 left-1/4 w-64 h-64 rounded-full blur-3xl animate-pulse"
          style={{ backgroundColor: `${theme.particleColors[2]}33`, animationDelay: '0.5s' }}
        />
      </div>

      {/* Festive Banner - Interactive */}
      <div 
        className={`absolute top-0 left-0 right-0 z-30 bg-gradient-to-r ${theme.gradient} py-3 px-4 text-center text-white font-semibold flex items-center justify-center gap-3 shadow-xl ${theme.bannerAnimation} cursor-default select-none`}
        style={{ backgroundSize: '200% 200%' }}
      >
        <span className="text-xl animate-bounce" style={{ animationDelay: '0s' }}>{renderThemeSymbol('w-6 h-auto')}</span>
        <span className="text-sm md:text-base tracking-wide">{theme.message}</span>
        <span className="text-xl animate-bounce" style={{ animationDelay: '0.2s' }}>{renderThemeSymbol('w-6 h-auto')}</span>
        <span className="absolute left-4 opacity-50">{renderThemeSymbol('w-5 h-auto')}</span>
        <span className="absolute right-4 opacity-50">{renderThemeSymbol('w-5 h-auto')}</span>
      </div>

      {/* Left Side - Login Form */}
      <div
        className={`flex w-full flex-col items-center justify-center bg-white/80 backdrop-blur-sm p-8 pt-16 lg:w-1/2 lg:p-16 lg:pt-20 transition-all duration-700 ${
          mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
        }`}
      >
        <div className="flex w-full max-w-md flex-col items-start gap-8">
          {/* Logo & Title */}
          <div className="flex w-full flex-col items-start gap-2">
            <div 
              className="flex items-center gap-4 mb-4"
              onMouseEnter={() => setLogoHover(true)}
              onMouseLeave={() => setLogoHover(false)}
            >
              <div className="relative group">
                <div className={`absolute -inset-1 bg-gradient-to-r ${theme.gradient} rounded-xl blur opacity-30 transition-all duration-500 ${logoHover ? 'opacity-60 scale-110' : ''}`} />
                <img
                  src="/icon-512.png"
                  alt="Advogado.WEB"
                  className={`relative h-16 w-16 rounded-xl shadow-lg transition-transform duration-500 ${logoHover ? 'scale-105 rotate-3' : ''}`}
                />
                <span className={`absolute -top-2 -right-2 ${theme.accentColor} transition-all duration-300 ${logoHover ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}>
                  {theme.icon}
                </span>
              </div>
              <div>
                <h1 className="text-4xl font-bold tracking-tight text-slate-900">
                  Advogado<span className={`${theme.accentColor} font-semibold`}>.WEB</span>
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
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={resetting}
                  className="text-sm font-medium text-slate-500 hover:text-amber-600 transition-colors duration-200 disabled:opacity-50"
                >
                  {resetting ? (
                    <span className="flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Enviando...
                    </span>
                  ) : (
                    'Esqueceu a senha?'
                  )}
                </button>
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
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Entrando...
                  </>
                ) : (
                  <>
                    <Scale className="w-4 h-4" />
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
        className={`relative hidden w-1/2 flex-col items-start justify-between bg-slate-900 p-12 pt-20 text-white lg:flex transition-all duration-700 delay-200 ${
          mounted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'
        }`}
      >
        {/* Background Image with Ken Burns effect */}
        <div
          className="absolute inset-0 bg-center bg-cover animate-slow-zoom"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1920&q=80')`,
          }}
        />
        {/* Themed Overlay */}
        <div className={`absolute inset-0 ${theme.backgroundOverlay}`} />
        
        {/* Extra Animated Elements for Hero */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {/* Floating themed icons */}
          <div className="absolute top-1/4 right-1/4 text-2xl animate-float opacity-30">{renderThemeSymbol('w-8 h-auto')}</div>
          <div className="absolute top-1/3 right-1/3 text-xl animate-float opacity-20" style={{ animationDelay: '1s' }}>{renderThemeSymbol('w-6 h-auto')}</div>
          <div className="absolute bottom-1/3 left-1/4 text-3xl animate-float opacity-25" style={{ animationDelay: '2s' }}>{renderThemeSymbol('w-10 h-auto')}</div>
          <div className="absolute top-1/2 right-1/5 text-lg animate-float opacity-20" style={{ animationDelay: '0.5s' }}>{renderThemeSymbol('w-5 h-auto')}</div>
          <div className="absolute bottom-1/4 right-1/3 text-2xl animate-float opacity-30" style={{ animationDelay: '1.5s' }}>{renderThemeSymbol('w-7 h-auto')}</div>
          
          {/* Glowing orbs */}
          <div 
            className="absolute top-1/4 left-1/4 w-32 h-32 rounded-full blur-2xl animate-pulse"
            style={{ backgroundColor: `${theme.particleColors[0]}40` }}
          />
          <div 
            className="absolute bottom-1/3 right-1/4 w-24 h-24 rounded-full blur-2xl animate-pulse"
            style={{ backgroundColor: `${theme.particleColors[1]}40`, animationDelay: '1s' }}
          />
        </div>

        {/* Hero Content */}
        <div className={`relative z-10 flex w-full max-w-lg flex-col items-start gap-4 transition-all duration-700 delay-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
          {/* Festive Badge */}
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 ${theme.bannerAnimation}`}>
            <span className="text-lg flex items-center">{renderThemeSymbol('w-6 h-auto')}</span>
            <span className={`text-sm font-semibold ${theme.accentColor.replace('-500', '-300')}`}>{theme.name}</span>
            {theme.icon}
          </div>
          
          <h2 className="text-4xl font-bold text-white leading-tight">
            Simplifique sua<br />
            <span className={`bg-gradient-to-r ${theme.gradient} bg-clip-text text-transparent`}>gestão jurídica.</span>
          </h2>
          <p className="text-white/70 text-lg">
            Centralize casos, clientes e documentos com a ferramenta mais completa do mercado.
          </p>
          
          {/* Feature pills with theme colors */}
          <div className="flex flex-wrap gap-2 mt-2">
            {['Processos', 'Prazos', 'Clientes', 'Financeiro'].map((feature, idx) => (
              <span 
                key={feature}
                className="px-3 py-1.5 rounded-full bg-white/10 text-white/90 text-xs font-medium backdrop-blur-sm border border-white/20 hover:bg-white/20 transition-all cursor-default"
                style={{ animationDelay: `${idx * 0.1}s` }}
              >
                <span className={theme.accentColor.replace('-500', '-400')}>✓</span> {feature}
              </span>
            ))}
          </div>
        </div>

        {/* Testimonial with themed border */}
        <div 
          className={`relative z-10 mt-auto w-full max-w-lg rounded-2xl bg-black/40 p-6 backdrop-blur-md border-2 transition-all duration-700 delay-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
          style={{ borderColor: `${theme.particleColors[0]}50` }}
        >
          <div className="absolute -top-4 left-6 opacity-50">{renderThemeSymbol('w-10 h-auto')}</div>
          <p className="text-lg font-medium leading-relaxed text-white/90 pl-4">
            A organização é a chave para a justiça. Com este CRM, alcançamos um novo patamar de
            eficiência e precisão em nosso escritório.
          </p>
          <p className="mt-4 pl-4 text-xs uppercase tracking-[0.3em] text-white/60">
            Equipe Advogado.WEB
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
