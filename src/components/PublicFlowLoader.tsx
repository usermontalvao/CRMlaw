import React from 'react';
import { BRAND_GRADIENT, BRAND_SERIF } from '../constants/brand';

/**
 * Animação de carregamento compartilhada do fluxo público (kit / preenchimento).
 *
 * Usada tanto no landing de permalink (/#/p/:slug) quanto na página de
 * preenchimento (/#/preencher/:token) para que o link do kit e o link gerado
 * exibam exatamente a mesma animação da marca "jurius".
 */
const PublicFlowLoader: React.FC<{ subtitle?: string }> = ({
  subtitle = 'Gestão Jurídica Inteligente',
}) => {
  return (
    <div className="tfl-load-screen">
      <style>{`
        @keyframes tfl-load-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tfl-load-up {
          0% { opacity: 0; transform: translateY(12px) scale(.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes tfl-load-float {
          0%, 100% { transform: translateY(0) rotate(-3deg); }
          50% { transform: translateY(-10px) rotate(3deg); }
        }
        @keyframes tfl-load-glow {
          0%, 100% { box-shadow: 0 16px 40px -10px rgba(245,158,11,.55), 0 0 0 0 rgba(251,191,36,.4); }
          50% { box-shadow: 0 24px 56px -8px rgba(249,115,22,.7), 0 0 0 14px rgba(251,191,36,0); }
        }
        @keyframes tfl-load-ring {
          0% { transform: scale(.5); opacity: .65; }
          70% { opacity: .1; }
          100% { transform: scale(1.7); opacity: 0; }
        }
        @keyframes tfl-load-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes tfl-load-shimmer { 0% { transform: translateX(-120%); } 100% { transform: translateX(420%); } }
        .tfl-load-screen {
          position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
          background: radial-gradient(120% 120% at 50% 35%, #fffdf7 0%, #fff4e0 55%, #ffedd5 100%);
          animation: tfl-load-fade .3s ease both;
        }
        .tfl-load-box { display: flex; flex-direction: column; align-items: center; gap: 28px; animation: tfl-load-up .5s cubic-bezier(.2,.8,.2,1) both; }
        .tfl-load-stage { position: relative; width: 150px; height: 150px; display: flex; align-items: center; justify-content: center; }
        .tfl-load-ring {
          position: absolute; inset: 0; margin: auto; width: 120px; height: 120px;
          border-radius: 999px; border: 2px solid rgba(245,158,11,.45); animation: tfl-load-ring 2.6s ease-out infinite;
        }
        .tfl-load-ring-2 { animation-delay: .85s; border-color: rgba(249,115,22,.45); }
        .tfl-load-ring-3 { animation-delay: 1.7s; border-color: rgba(251,191,36,.55); }
        .tfl-load-orbit { position: absolute; inset: 0; margin: auto; width: 150px; height: 150px; animation: tfl-load-orbit 4.5s linear infinite; }
        .tfl-load-orbit span {
          position: absolute; top: -3px; left: 50%; width: 9px; height: 9px; margin-left: -4.5px;
          border-radius: 999px; background: linear-gradient(135deg, #fbbf24, #f97316);
          box-shadow: 0 2px 8px rgba(249,115,22,.5);
        }
        .tfl-load-mark {
          position: relative; width: 84px; height: 84px; border-radius: 21px;
          display: flex; align-items: center; justify-content: center;
          font-family: ${BRAND_SERIF}; font-weight: 600; font-size: 51px; line-height: 1; color: #fff;
          text-shadow: 0 2px 7px rgba(120,40,0,.4);
          background: ${BRAND_GRADIENT};
          animation: tfl-load-float 3.2s ease-in-out infinite, tfl-load-glow 2.6s ease-in-out infinite;
        }
        .tfl-load-mark::after { content: ''; position: absolute; inset: 0; border-radius: 21px; border: 1px solid rgba(255,255,255,.35); opacity: .6; }
        .tfl-load-word { text-align: center; }
        .tfl-load-word b { display: block; font-family: ${BRAND_SERIF}; font-size: 22px; font-weight: 700; color: #211C18; letter-spacing: -.012em; }
        .tfl-load-word small { display: block; margin-top: 6px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .44em; color: #b45309; }
        .tfl-load-bar { position: relative; width: 200px; height: 5px; border-radius: 999px; overflow: hidden; background: rgba(245,158,11,.2); }
        .tfl-load-bar > span {
          position: absolute; top: 0; left: 0; height: 100%; width: 35%; border-radius: 999px;
          background: linear-gradient(90deg, transparent, #fbbf24, #f97316, transparent);
          animation: tfl-load-shimmer 1.3s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .tfl-load-mark, .tfl-load-ring, .tfl-load-orbit, .tfl-load-bar > span { animation-duration: .01ms; animation-iteration-count: 1; }
        }
      `}</style>
      <div className="tfl-load-box">
        <div className="tfl-load-stage">
          <span className="tfl-load-ring tfl-load-ring-1" />
          <span className="tfl-load-ring tfl-load-ring-2" />
          <span className="tfl-load-ring tfl-load-ring-3" />
          <div className="tfl-load-orbit"><span /></div>
          <div className="tfl-load-mark">J</div>
        </div>
        <div className="tfl-load-word">
          <b>jurius.com.br</b>
          <small>{subtitle}</small>
        </div>
        <div className="tfl-load-bar"><span /></div>
      </div>
    </div>
  );
};

export default PublicFlowLoader;
