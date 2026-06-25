import React from 'react';
import { BRAND_SANS } from '../constants/brand';
import { BrandLogo } from './ui';

/**
 * Loader público com linguagem institucional e foco em mobile.
 */
const PublicFlowLoader: React.FC<{ subtitle?: string }> = ({
  subtitle = 'Gestão Jurídica Inteligente',
}) => {
  return (
    <div className="pfl-screen">
      <style>{`
        @keyframes pfl-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pfl-rise {
          0% { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes pfl-progress {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(320%); }
        }
        .pfl-screen {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            radial-gradient(circle at top, rgba(255,255,255,.98), rgba(248,243,236,.96) 42%, rgba(241,234,225,.94) 100%);
          animation: pfl-fade .22s ease-out both;
        }
        .pfl-frame {
          width: min(100%, 390px);
          padding: 32px 28px;
          animation: pfl-rise .38s ease-out both;
        }
        .pfl-mark {
          display: flex;
          justify-content: center;
          margin-bottom: 22px;
        }
        .pfl-divider {
          width: 64px;
          height: 1px;
          margin: 0 auto 22px;
          background: linear-gradient(90deg, transparent, rgba(157,136,117,.9), transparent);
        }
        .pfl-copy {
          text-align: center;
          max-width: 320px;
          margin: 0 auto;
        }
        .pfl-kicker {
          margin: 0 0 12px;
          font-family: ${BRAND_SANS};
          font-size: 10px;
          font-weight: 600;
          letter-spacing: .24em;
          text-transform: uppercase;
          color: #a16b3f;
        }
        .pfl-title {
          margin: 0;
          font-family: ${BRAND_SANS};
          font-size: 24px;
          line-height: 1.25;
          font-weight: 500;
          letter-spacing: -.02em;
          color: #231f1b;
        }
        .pfl-text {
          margin: 14px 0 0;
          font-family: ${BRAND_SANS};
          font-size: 14px;
          line-height: 1.7;
          color: #6c5f53;
        }
        .pfl-progress {
          position: relative;
          width: min(100%, 220px);
          height: 2px;
          margin: 28px auto 0;
          overflow: hidden;
          background: rgba(184,164,143,.28);
        }
        .pfl-progress::after {
          content: '';
          position: absolute;
          inset: 0 auto 0 0;
          width: 34%;
          background: linear-gradient(90deg, transparent, #d97706, #ea580c, transparent);
          animation: pfl-progress 1.15s ease-in-out infinite;
        }
        .pfl-footer {
          margin-top: 14px;
          text-align: center;
          font-family: ${BRAND_SANS};
          font-size: 10px;
          font-weight: 500;
          letter-spacing: .18em;
          text-transform: uppercase;
          color: #9b8a79;
        }
        @media (max-width: 420px) {
          .pfl-frame {
            padding: 28px 22px;
          }
          .pfl-title {
            font-size: 22px;
          }
          .pfl-text {
            font-size: 13.5px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pfl-progress::after {
            animation-duration: .01ms;
            animation-iteration-count: 1;
          }
        }
      `}</style>

      <div className="pfl-frame">
        <div className="pfl-mark">
          <BrandLogo stacked size="lg" divider={false} shine={false} className="select-none" />
        </div>

        <div className="pfl-divider" />

        <div className="pfl-copy">
          <p className="pfl-kicker">{subtitle}</p>
          <h1 className="pfl-title">Preparando o documento para preenchimento</h1>
          <p className="pfl-text">
            Aguarde alguns instantes enquanto organizamos os dados e validamos
            o ambiente para uma experiência segura no seu dispositivo.
          </p>
        </div>

        <div className="pfl-progress" />
        <div className="pfl-footer">Carregando ambiente seguro</div>
      </div>
    </div>
  );
};

export default PublicFlowLoader;
