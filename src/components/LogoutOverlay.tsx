import React, { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';

/**
 * LogoutOverlay — despedida cinematográfica, sóbria e premium.
 *
 * Estética: fundo escuro sólido (sem vazar a app atrás) com vinheta quente,
 * brasas subindo discretas, emblema com glow SIMÉTRICO e anel orbital fino.
 * A cena se mantém estável até o redirect (~3,6s, sincronizado com o
 * setTimeout(3600) do handleLogout). Puro CSS, respeita prefers-reduced-motion.
 */

interface LogoutOverlayProps {
  userName?: string | null;
}

export const LogoutOverlay: React.FC<LogoutOverlayProps> = ({ userName }) => {
  const firstName = (userName || '').trim().split(/\s+/)[0] || '';

  // Brasas que sobem suavemente — atmosfera quente, sem virar "poeira".
  const embers = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id: i,
        x: (i * 61) % 100, // 0..100 %
        dx: ((i % 5) - 2) * 16, // deriva lateral
        size: 2 + (i % 3) * 1.3,
        delay: ((i % 9) * 0.32).toFixed(2),
        dur: (3.4 + (i % 5) * 0.5).toFixed(2),
        rise: 32 + (i % 6) * 9, // quanto sobe (vh)
      })),
    [],
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
      style={{ background: 'radial-gradient(135% 115% at 50% 38%, #1b140e 0%, #0b0a0e 52%, #050507 100%)' }}
    >
      <style>{`
        @keyframes loEmber {
          0%   { transform: translateY(0) translateX(0); opacity: 0; }
          14%  { opacity: 0.85; }
          80%  { opacity: 0.45; }
          100% { transform: translateY(var(--rise)) translateX(var(--dx)); opacity: 0; }
        }
        @keyframes loGlow {
          0%,100% { opacity: 0.6; transform: translate(-50%,-50%) scale(1); }
          50%     { opacity: 1;   transform: translate(-50%,-50%) scale(1.09); }
        }
        @keyframes loRing {
          0%   { transform: translate(-50%,-50%) scale(0.55); opacity: 0.55; }
          100% { transform: translate(-50%,-50%) scale(3.4);  opacity: 0; }
        }
        @keyframes loSpin { to { transform: rotate(360deg); } }
        @keyframes loEmblemIn {
          0%   { transform: scale(0.55); opacity: 0; filter: blur(8px); }
          60%  { transform: scale(1.06); opacity: 1; filter: blur(0); }
          100% { transform: scale(1); }
        }
        @keyframes loTextIn {
          0%,26% { opacity: 0; transform: translateY(10px); }
          46%    { opacity: 1; transform: none; }
        }
        .lo-emblem { animation: loEmblemIn 1s cubic-bezier(0.34,1.56,0.64,1) both; will-change: transform, opacity, filter; }
        .lo-ember  { position: absolute; bottom: -10px; border-radius: 9999px;
                     background: radial-gradient(circle, #FFC089, #F2631A); will-change: transform, opacity; }

        @media (prefers-reduced-motion: reduce) {
          .lo-scene, .lo-emblem, .lo-anim-rm { animation: none !important; }
          .lo-ember { display: none !important; }
        }
      `}</style>

      {/* vinheta para concentrar o olhar no centro */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(circle at 50% 42%, transparent 32%, rgba(0,0,0,0.5) 100%)' }} />

      {/* brasas subindo */}
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {embers.map((e) => (
          <span key={e.id} className="lo-ember"
            style={{
              left: `${e.x}%`, width: e.size, height: e.size,
              // ts: custom props
              ['--dx' as any]: `${e.dx}px`,
              ['--rise' as any]: `-${e.rise}vh`,
              animation: `loEmber ${e.dur}s ease-in ${e.delay}s infinite`,
            }} />
        ))}
      </div>

      <div className="lo-scene relative flex flex-col items-center">
        {/* glow simétrico atrás do emblema */}
        <div aria-hidden className="lo-anim-rm absolute left-1/2"
          style={{
            top: 44, width: 300, height: 300, transform: 'translate(-50%,-50%)', borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(242,99,26,0.5), rgba(242,99,26,0.08) 48%, transparent 72%)',
            filter: 'blur(20px)', animation: 'loGlow 2.8s ease-in-out infinite',
          }} />

        {/* anel(éis) expandindo — discreto */}
        {[0, 1.4].map((d, i) => (
          <div key={i} aria-hidden className="lo-anim-rm absolute left-1/2 rounded-full"
            style={{
              top: 44, width: 92, height: 92, transform: 'translate(-50%,-50%)',
              border: '1px solid rgba(242,99,26,0.45)',
              animation: `loRing 2.8s cubic-bezier(0.22,0.61,0.36,1) ${d}s infinite`,
            }} />
        ))}

        {/* emblema */}
        <div className="lo-emblem relative mb-10">
          {/* anel orbital fino com ponto luminoso */}
          <div aria-hidden className="lo-anim-rm absolute -inset-[14px] rounded-full"
            style={{ border: '1px solid rgba(255,255,255,0.09)', animation: 'loSpin 9s linear infinite' }}>
            <span className="absolute left-1/2 -top-[3px] h-1.5 w-1.5 -translate-x-1/2 rounded-full"
              style={{ background: '#FFB37A', boxShadow: '0 0 10px 2px rgba(242,99,26,0.85)' }} />
          </div>

          <div className="relative flex h-[88px] w-[88px] items-center justify-center rounded-[1.6rem]"
            style={{
              background: 'linear-gradient(150deg,#FF8A3D,#E8500F)',
              boxShadow: '0 22px 55px -12px rgba(234,83,16,0.65), inset 0 1px 0 rgba(255,255,255,0.35)',
            }}>
            <span className="select-none text-[42px] font-black tracking-tight text-white">J</span>
          </div>
        </div>

        {/* texto */}
        <div className="px-6 text-center" style={{ animation: 'loTextIn 2.4s ease both' }}>
          <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight text-white">
            {firstName ? <>Até logo, <span style={{ color: '#FF9259' }}>{firstName}</span></> : <>Até logo</>}
          </h1>
          <p className="mt-3 flex items-center justify-center gap-2 text-[13px] font-medium text-white/45">
            <ShieldCheck className="h-4 w-4" style={{ color: '#FF9259' }} />
            Sessão encerrada com segurança
          </p>
        </div>
      </div>
    </div>
  );
};

export default LogoutOverlay;
