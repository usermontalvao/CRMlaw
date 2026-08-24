// A tela de espera entre clicar em "Link para o cliente" e a janela abrir.
//
// A versão anterior seguia `prefers-color-scheme`, ou seja, o tema do SISTEMA
// OPERACIONAL — e não o do CRM. Com o macOS no escuro ela abria preta por cima
// de um app claro. Esta é branca sempre, de propósito: é um instante de espera,
// não uma tela do produto, e a folha branca é o assunto.
//
// A cena conta o que está acontecendo em três tempos, porque o trabalho real
// termina rápido demais para o usuário entender o que houve — sem isso, o
// clique parecia não ter feito nada.
import React from 'react';
import { Check, Link2 } from 'lucide-react';

/**
 * Tempo mínimo de cena antes de abrir o modal.
 *
 * O trabalho no banco costuma terminar em poucas centenas de milissegundos; sem
 * um piso, a animação vira um flash. Para deixar a cena mais longa, mude só
 * este número (5000 = cinco segundos) — o CSS abaixo se ajusta sozinho pela
 * variável `--tfl-dur`.
 */
export const DURACAO_MINIMA_ANIMACAO_MS = 2200;

/** O tempo do "pronto" com o visto verde, antes de a janela abrir. */
export const DURACAO_DO_FECHO_MS = 750;

export type LinkOverlayPhase = 'working' | 'done';

export interface LinkGenerationOverlayProps {
  phase: LinkOverlayPhase;
  /** Nome do modelo, para a pessoa confirmar que clicou no cartão certo. */
  templateName?: string;
  /** `inline` desliga o `position: fixed` — usado só pela bancada. */
  variant?: 'fixed' | 'inline';
}

const PASSOS = ['Lendo o modelo', 'Criando o link do cliente', 'Preparando a janela'];

const LinkGenerationOverlay: React.FC<LinkGenerationOverlayProps> = ({
  phase,
  templateName,
  variant = 'fixed',
}) => {
  const done = phase === 'done';

  return (
    <div
      className={`tfl-gen-veil ${variant === 'inline' ? 'tfl-gen-veil--inline' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={done ? 'Link pronto' : 'Gerando link'}
      style={{
        // Um passo por terço da cena; o CSS deriva todos os atrasos daqui.
        ['--tfl-dur' as string]: `${DURACAO_MINIMA_ANIMACAO_MS}ms`,
        ['--tfl-step' as string]: `${DURACAO_MINIMA_ANIMACAO_MS / 3}ms`,
      }}
    >
      <style>{`
        @keyframes tfl-veil-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes tfl-card-in {
          from { opacity: 0; transform: translateY(12px) scale(.97) }
          to   { opacity: 1; transform: none }
        }
        @keyframes tfl-draw { to { stroke-dashoffset: 0 } }
        @keyframes tfl-line-in {
          from { transform: scaleX(0); opacity: .2 }
          to   { transform: scaleX(1); opacity: 1 }
        }
        @keyframes tfl-badge-in {
          0%   { opacity: 0; transform: translateY(8px) scale(.6) }
          60%  { opacity: 1; transform: translateY(0) scale(1.08) }
          100% { opacity: 1; transform: none }
        }
        @keyframes tfl-sweep {
          0%   { transform: translateY(-120%) }
          100% { transform: translateY(320%) }
        }
        @keyframes tfl-step-on { to { opacity: 1; color: #57534e } }
        @keyframes tfl-tick-on { to { opacity: 1; transform: scale(1) } }
        @keyframes tfl-bar { from { width: 6% } to { width: 100% } }

        .tfl-gen-veil {
          position: fixed; inset: 0; z-index: 120;
          display: flex; align-items: center; justify-content: center;
          background: rgba(250, 249, 247, .82);
          backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
          animation: tfl-veil-in .2s ease both;
        }
        .tfl-gen-veil--inline { position: relative; inset: auto; z-index: 0; border-radius: 18px; padding: 28px 0; }

        .tfl-gen-card {
          width: min(370px, calc(100vw - 32px));
          display: flex; flex-direction: column; align-items: center; gap: 22px;
          padding: 34px 34px 28px;
          border-radius: 26px;
          border: 1px solid #eceae4;
          background: #ffffff;
          box-shadow: 0 32px 70px -32px rgba(41, 37, 30, .3), 0 2px 6px -2px rgba(41, 37, 30, .06);
          animation: tfl-card-in .4s cubic-bezier(.2,.8,.2,1) both;
        }

        /* ---- a folha ---- */
        .tfl-sheet { position: relative; width: 96px; height: 118px; }
        .tfl-sheet svg { position: absolute; inset: 0; overflow: visible; }
        .tfl-sheet-outline {
          fill: #fff; stroke: #ded9d0; stroke-width: 2;
          stroke-dasharray: 420; stroke-dashoffset: 420;
          animation: tfl-draw calc(var(--tfl-step) * 1.1) ease-out both;
        }
        .tfl-sheet-line {
          height: 6px; border-radius: 3px; transform-origin: left center;
          background: #efece6; animation: tfl-line-in .34s cubic-bezier(.2,.8,.2,1) both;
        }
        .tfl-sheet-line.is-filled { background: linear-gradient(90deg, #fdba74, #f97316); }
        .tfl-sheet-lines {
          position: absolute; left: 16px; right: 16px; top: 26px;
          display: flex; flex-direction: column; gap: 9px;
        }
        .tfl-sheet-glare {
          position: absolute; inset: 2px; border-radius: 6px; overflow: hidden; pointer-events: none;
        }
        .tfl-sheet-glare::after {
          content: ''; position: absolute; left: -20%; right: -20%; height: 45%;
          background: linear-gradient(180deg, transparent, rgba(249,115,22,.10), transparent);
          animation: tfl-sweep calc(var(--tfl-dur)) linear infinite;
        }
        .tfl-badge {
          position: absolute; right: -12px; bottom: -10px;
          width: 42px; height: 42px; border-radius: 14px;
          display: flex; align-items: center; justify-content: center;
          color: #fff; background: linear-gradient(135deg, #fb923c, #f97316);
          box-shadow: 0 10px 22px -8px rgba(249,115,22,.75);
          animation: tfl-badge-in .5s cubic-bezier(.2,.8,.2,1) both;
          animation-delay: calc(var(--tfl-step) * 2);
        }
        .tfl-badge.is-done { background: linear-gradient(135deg, #34d399, #059669); box-shadow: 0 10px 22px -8px rgba(5,150,105,.7); animation-delay: 0ms }

        /* ---- texto e passos ---- */
        .tfl-title { font-size: 16px; font-weight: 650; color: #1c1917; letter-spacing: -.01em; text-align: center }
        .tfl-sub { margin-top: 3px; font-size: 12.5px; color: #a8a29e; text-align: center; max-width: 260px }
        .tfl-steps { display: flex; flex-direction: column; gap: 9px; width: 100%; }
        .tfl-step {
          display: flex; align-items: center; gap: 9px;
          font-size: 12.5px; color: #d6d3d1; opacity: .55;
          animation: tfl-step-on .3s ease-out both;
        }
        .tfl-step-tick {
          width: 17px; height: 17px; border-radius: 999px; flex: 0 0 auto;
          display: flex; align-items: center; justify-content: center;
          background: #f5f5f4; color: #fff;
        }
        .tfl-step-tick > svg { opacity: 0; transform: scale(.4); animation: tfl-tick-on .28s cubic-bezier(.2,.8,.2,1) both; }
        .tfl-step:nth-child(1) { animation-delay: calc(var(--tfl-step) * 0) }
        .tfl-step:nth-child(2) { animation-delay: calc(var(--tfl-step) * 1) }
        .tfl-step:nth-child(3) { animation-delay: calc(var(--tfl-step) * 2) }
        .tfl-step:nth-child(1) .tfl-step-tick { animation: tfl-tick-bg .01s linear both; animation-delay: calc(var(--tfl-step) * .9) }
        .tfl-step:nth-child(2) .tfl-step-tick { animation: tfl-tick-bg .01s linear both; animation-delay: calc(var(--tfl-step) * 1.9) }
        .tfl-step:nth-child(3) .tfl-step-tick { animation: tfl-tick-bg .01s linear both; animation-delay: calc(var(--tfl-step) * 2.9) }
        @keyframes tfl-tick-bg { to { background: #10b981 } }
        .tfl-step:nth-child(1) .tfl-step-tick > svg { animation-delay: calc(var(--tfl-step) * .9) }
        .tfl-step:nth-child(2) .tfl-step-tick > svg { animation-delay: calc(var(--tfl-step) * 1.9) }
        .tfl-step:nth-child(3) .tfl-step-tick > svg { animation-delay: calc(var(--tfl-step) * 2.9) }

        .tfl-bar { width: 100%; height: 4px; border-radius: 999px; background: #f2efe9; overflow: hidden }
        .tfl-bar > span {
          display: block; height: 100%; border-radius: 999px; width: 6%;
          background: linear-gradient(90deg, #fdba74, #f97316);
          animation: tfl-bar var(--tfl-dur) cubic-bezier(.4,.1,.2,1) both;
        }
        .tfl-bar.is-done > span { width: 100%; background: linear-gradient(90deg, #34d399, #059669); animation: none }

        @media (prefers-reduced-motion: reduce) {
          .tfl-gen-veil, .tfl-gen-card, .tfl-sheet-outline, .tfl-sheet-line,
          .tfl-badge, .tfl-step, .tfl-step-tick, .tfl-step-tick > svg, .tfl-bar > span {
            animation-duration: .01ms !important; animation-delay: 0ms !important;
          }
          .tfl-sheet-glare::after { animation: none }
        }
      `}</style>

      <div className="tfl-gen-card">
        <div className="tfl-sheet">
          <svg viewBox="0 0 96 118" aria-hidden="true">
            <rect className="tfl-sheet-outline" x="1" y="1" width="94" height="116" rx="8" />
          </svg>
          <div className="tfl-sheet-glare" />
          <div className="tfl-sheet-lines">
            <span className="tfl-sheet-line is-filled" style={{ width: '78%', animationDelay: 'calc(var(--tfl-step) * .5)' }} />
            <span className="tfl-sheet-line is-filled" style={{ width: '92%', animationDelay: 'calc(var(--tfl-step) * .75)' }} />
            <span className="tfl-sheet-line" style={{ width: '64%', animationDelay: 'calc(var(--tfl-step) * 1)' }} />
            <span className="tfl-sheet-line is-filled" style={{ width: '86%', animationDelay: 'calc(var(--tfl-step) * 1.25)' }} />
            <span className="tfl-sheet-line" style={{ width: '48%', animationDelay: 'calc(var(--tfl-step) * 1.5)' }} />
            <span className="tfl-sheet-line is-filled" style={{ width: '70%', animationDelay: 'calc(var(--tfl-step) * 1.75)' }} />
          </div>
          <div className={`tfl-badge ${done ? 'is-done' : ''}`}>
            {done ? <Check className="h-5 w-5" strokeWidth={3} /> : <Link2 className="h-5 w-5" strokeWidth={2.4} />}
          </div>
        </div>

        <div>
          <p className="tfl-title">{done ? 'Link pronto' : 'Preparando o link'}</p>
          <p className="tfl-sub">
            {done
              ? 'Escolha qual mandar e toque em Copiar.'
              : templateName || 'Deixando o formulário pronto para o cliente preencher'}
          </p>
        </div>

        <div className="tfl-steps">
          {PASSOS.map((passo) => (
            <div className="tfl-step" key={passo}>
              <span className="tfl-step-tick">
                <Check className="h-3 w-3" strokeWidth={3.5} />
              </span>
              {passo}
            </div>
          ))}
        </div>

        <div className={`tfl-bar ${done ? 'is-done' : ''}`}>
          <span />
        </div>
      </div>
    </div>
  );
};

export default LinkGenerationOverlay;
