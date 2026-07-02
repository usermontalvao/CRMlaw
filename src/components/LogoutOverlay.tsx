import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { BrandLogo } from './ui';

/**
 * LogoutOverlay — despedida sóbria e premium, na mesma linguagem visual
 * da tela de boot (App.tsx): fundo #0a0806, glow central respirando,
 * grain sutil, arco orbital fino em SVG e coreografia em cascata com
 * ease-out-expo. A cena se mantém estável até o redirect (~3,6s,
 * sincronizado com o setTimeout(3600) do handleLogout).
 * Puro CSS, respeita prefers-reduced-motion.
 */

interface LogoutOverlayProps {
  userName?: string | null;
}

export const LogoutOverlay: React.FC<LogoutOverlayProps> = ({ userName }) => {
  const firstName = (userName || '').trim().split(/\s+/)[0] || '';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#0a0806]">
      <style>{`
        @keyframes lo-breathe{0%,100%{opacity:.55;transform:translate(-50%,-50%) scale(1)}50%{opacity:.9;transform:translate(-50%,-50%) scale(1.08)}}
        @keyframes lo-orbit{to{transform:rotate(360deg)}}
        @keyframes lo-rise{from{opacity:0;transform:translateY(16px) scale(.985);filter:blur(8px)}to{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}}
        @keyframes lo-ellipsis{0%,60%,100%{opacity:.2}30%{opacity:1}}
        .lo-rise{animation:lo-rise 1.1s cubic-bezier(.16,1,.3,1) both}
        @media (prefers-reduced-motion:reduce){.lo-rise,.lo-anim{animation:none!important;opacity:1!important}}
      `}</style>

      {/* Ambient: glow central respirando + vinheta + grain */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div
          className="absolute left-1/2 top-1/2 w-[720px] h-[720px] rounded-full lo-anim"
          style={{
            background: 'radial-gradient(circle, rgba(242,122,35,0.10) 0%, rgba(242,122,35,0.04) 38%, transparent 68%)',
            animation: 'lo-breathe 7s ease-in-out infinite',
          }}
        />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)' }} />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`,
          }}
        />
      </div>

      {/* Conteúdo — coreografia em cascata */}
      <div className="relative z-10 flex flex-col items-center px-6">
        {/* Tile + arco orbital único */}
        <div className="relative mb-9 lo-rise">
          <svg
            className="absolute inset-[-34px] lo-anim"
            viewBox="0 0 140 140"
            fill="none"
            style={{ animation: 'lo-orbit 3.6s cubic-bezier(.45,.05,.55,.95) infinite' }}
            aria-hidden="true"
          >
            <circle cx="70" cy="70" r="66" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
            <circle
              cx="70" cy="70" r="66"
              stroke="url(#lo-arc)" strokeWidth="1.5" strokeLinecap="round"
              strokeDasharray="112 303"
            />
            <defs>
              <linearGradient id="lo-arc" x1="0" y1="0" x2="140" y2="140" gradientUnits="userSpaceOnUse">
                <stop stopColor="#f97316" stopOpacity="0" />
                <stop offset="0.5" stopColor="#fbbf24" />
                <stop offset="1" stopColor="#f27a23" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
          {/* halo suave sob o tile */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full blur-2xl lo-anim"
            style={{ background: 'rgba(242,122,35,0.16)', animation: 'lo-breathe 7s ease-in-out infinite' }}
            aria-hidden="true"
          />
          <BrandLogo iconOnly size="lg" shine className="relative" />
        </div>

        {/* Despedida */}
        <div className="text-center lo-rise" style={{ animationDelay: '140ms' }}>
          <h1 className="text-[26px] sm:text-[32px] font-bold tracking-tight text-white">
            {firstName ? <>Até logo, <span style={{ color: '#FF9259' }}>{firstName}</span></> : <>Até logo</>}
          </h1>
        </div>

        <div
          className="mt-6 mb-8 h-px w-64 lo-rise"
          style={{
            animationDelay: '280ms',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent)',
          }}
        />

        {/* Selo de segurança */}
        <p
          className="lo-rise flex items-center gap-2 text-[11px] font-medium uppercase"
          style={{ animationDelay: '400ms', letterSpacing: '0.32em', color: 'rgba(255,255,255,0.42)' }}
        >
          <ShieldCheck className="h-4 w-4 flex-shrink-0" style={{ color: '#FF9259' }} aria-hidden="true" />
          <span>Sessão encerrada com segurança</span>
        </p>

        {/* Status de saída */}
        <p
          className="lo-rise mt-4 flex items-baseline gap-[3px] text-[11px] font-medium uppercase"
          style={{ animationDelay: '520ms', letterSpacing: '0.32em', color: 'rgba(255,255,255,0.28)' }}
        >
          <span>Saindo</span>
          <span className="inline-flex gap-[3px]" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className="lo-anim" style={{ animation: `lo-ellipsis 1.6s ease-in-out ${i * 0.22}s infinite` }}>
                .
              </span>
            ))}
          </span>
        </p>
      </div>

      {/* Rodapé institucional */}
      <div className="absolute bottom-8 left-0 right-0 flex justify-center lo-rise" style={{ animationDelay: '700ms' }}>
        <span className="text-[10px] uppercase" style={{ letterSpacing: '0.28em', color: 'rgba(255,255,255,0.22)' }}>
          © 2026 jurius.com.br
        </span>
      </div>
    </div>
  );
};

export default LogoutOverlay;
