import React, { useEffect, useState } from 'react';
import { ShieldOff, AlertTriangle, LogOut } from 'lucide-react';

const COUNTDOWN = 10;

interface Props {
  onLogout: () => void;
}

export const BlockedAccountOverlay: React.FC<Props> = ({ onLogout }) => {
  const [seconds, setSeconds] = useState(COUNTDOWN);

  useEffect(() => {
    if (seconds <= 0) { onLogout(); return; }
    const t = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds, onLogout]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at center, #3b0000 0%, #1a0000 40%, #000000 100%)' }}
    >
      <style>{`
        @keyframes gridScroll  { from { background-position: 0 0 } to { background-position: 60px 60px } }
        @keyframes scanline    { 0%,100% { top:-10% } 50% { top:110% } }
        @keyframes ringPulse   { 0% { transform:scale(0.8); opacity:0.7 } 100% { transform:scale(1.8); opacity:0 } }
        @keyframes shakeIcon   { 0%,100%{transform:rotate(0deg) scale(1)} 10%,30%,50%,70%,90%{transform:rotate(-6deg) scale(1.06)} 20%,40%,60%,80%{transform:rotate(6deg) scale(1.06)} }
        @keyframes flickerText { 0%,91%,96%,100%{opacity:1} 92%,95%{opacity:0.3} 93%,97%{opacity:0.85} }
        @keyframes countdownIn { from{transform:scale(1.7);opacity:0} to{transform:scale(1);opacity:1} }
        @keyframes glowPulse   { 0%,100%{text-shadow:0 0 30px rgba(239,68,68,1),0 0 80px rgba(239,68,68,0.6)} 50%{text-shadow:0 0 60px rgba(239,68,68,1),0 0 140px rgba(239,68,68,0.8)} }
        @keyframes badgePulse  { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.5)} 50%{box-shadow:0 0 0 8px rgba(239,68,68,0)} }
      `}</style>

      {/* Grid */}
      <div className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'linear-gradient(rgba(239,68,68,0.15) 1px,transparent 1px),linear-gradient(90deg,rgba(239,68,68,0.15) 1px,transparent 1px)',
          backgroundSize: '60px 60px',
          animation: 'gridScroll 8s linear infinite',
        }}
      />

      {/* Scanline */}
      <div className="pointer-events-none absolute inset-x-0 h-48"
        style={{
          background: 'linear-gradient(to bottom,transparent,rgba(239,68,68,0.18),transparent)',
          animation: 'scanline 3.5s ease-in-out infinite',
        }}
      />

      {/* Rings */}
      {[{ size: 480, delay: '0s', opacity: 0.5 }, { size: 340, delay: '0.6s', opacity: 0.7 }, { size: 220, delay: '1.2s', opacity: 0.9 }].map(({ size, delay, opacity }) => (
        <div key={size} className="pointer-events-none absolute"
          style={{ animation: `ringPulse 2.4s ease-out ${delay} infinite` }}>
          <div style={{
            width: size, height: size,
            borderRadius: '50%',
            border: `1px solid rgba(239,68,68,${opacity * 0.35})`,
          }} />
        </div>
      ))}

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-7 px-8 text-center">

        {/* Icon */}
        <div
          className="flex h-28 w-28 items-center justify-center rounded-3xl"
          style={{
            background: 'radial-gradient(circle at center, rgba(239,68,68,0.25) 0%, rgba(127,0,0,0.4) 100%)',
            border: '1.5px solid rgba(239,68,68,0.6)',
            boxShadow: '0 0 80px rgba(239,68,68,0.6), inset 0 0 40px rgba(239,68,68,0.15)',
            animation: 'shakeIcon 0.9s ease-in-out infinite, badgePulse 1.8s ease-in-out infinite',
          }}
        >
          <ShieldOff className="h-14 w-14" style={{ color: '#ef4444', filter: 'drop-shadow(0 0 12px rgba(239,68,68,0.9))' }} />
        </div>

        {/* Label */}
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          <span className="text-[11px] font-bold uppercase tracking-[0.35em] text-red-400">
            Acesso Revogado
          </span>
          <AlertTriangle className="h-4 w-4 text-red-500" />
        </div>

        {/* Title */}
        <h1
          className="text-6xl font-black uppercase leading-tight tracking-tight"
          style={{
            color: '#fff',
            animation: 'flickerText 4s ease-in-out infinite',
          }}
        >
          CONTA<br />
          <span style={{
            color: '#ef4444',
            animation: 'glowPulse 2s ease-in-out infinite',
          }}>
            BLOQUEADA
          </span>
        </h1>

        {/* Message */}
        <p className="max-w-xs text-[15px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Seu acesso foi desativado pelo administrador do escritório.{' '}
          <span style={{ color: 'rgba(255,255,255,0.75)' }}>
            Entre em contato para reativar.
          </span>
        </p>

        {/* Countdown */}
        <div className="flex flex-col items-center gap-1.5">
          <div
            key={seconds}
            className="tabular-nums font-black"
            style={{
              fontSize: 88,
              lineHeight: 1,
              color: '#ef4444',
              animation: 'countdownIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both, glowPulse 1s ease-in-out infinite',
            }}
          >
            {seconds}
          </div>
          <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'rgba(239,68,68,0.6)' }}>
            <LogOut className="h-3.5 w-3.5" />
            Saindo automaticamente em {seconds} {seconds === 1 ? 'segundo' : 'segundos'}...
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-[3px] w-72 overflow-hidden rounded-full" style={{ background: 'rgba(239,68,68,0.15)' }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${(seconds / COUNTDOWN) * 100}%`,
              transition: 'width 1s linear',
              background: 'linear-gradient(90deg, #dc2626, #ef4444)',
              boxShadow: '0 0 12px rgba(239,68,68,0.9)',
            }}
          />
        </div>

        {/* Button */}
        <button
          onClick={onLogout}
          className="mt-1 flex items-center gap-2 rounded-xl px-8 py-3 text-sm font-bold transition-all hover:scale-105 active:scale-95"
          style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1.5px solid rgba(239,68,68,0.5)',
            color: '#f87171',
            boxShadow: '0 0 20px rgba(239,68,68,0.2)',
          }}
        >
          <LogOut className="h-4 w-4" />
          Sair agora
        </button>

      </div>
    </div>
  );
};

export default BlockedAccountOverlay;
