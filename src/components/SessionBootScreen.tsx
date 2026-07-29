import { BRAND_SANS, brandCopyright } from '../constants/brand';
import BrandLogo from './ui/BrandLogo';

interface SessionBootScreenProps {
  fontsReady: boolean;
}

/**
 * Tela de abertura da sessão — a marca é o centro da composição e o anel ao
 * redor do tile é o próprio indicador de carregamento. Fundo na família da
 * casca do sistema (sidebar #1e2028). Sem HUD, grid, selos ou etapas falsas.
 */
const SessionBootScreen = ({ fontsReady }: SessionBootScreenProps) => (
  <div
    className="jurius-boot"
    role="status"
    aria-live="polite"
    aria-label="Verificando sua sessão Jurius"
  >
    <style>{`
      .jurius-boot {
        position: fixed;
        inset: 0;
        z-index: 100;
        overflow: hidden;
        display: grid;
        place-items: center;
        /* mesma família da casca do sistema (sidebar #1e2028) */
        background: radial-gradient(125% 100% at 50% 42%, #262932 0%, #1e2028 52%, #171920 100%);
        color: #f7f2ec;
      }
      .jurius-boot * { box-sizing: border-box; }

      /* ── Ambiente ──────────────────────────────────────────────────────── */
      .jb-glow {
        position: absolute;
        left: 50%;
        top: 46%;
        width: 760px;
        height: 760px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        pointer-events: none;
        background: radial-gradient(circle, rgba(236,106,30,.1) 0%, rgba(236,106,30,.035) 38%, transparent 68%);
        animation: jb-breathe 8s ease-in-out infinite;
      }
      /* faixa de luz atravessando a cena bem devagar */
      .jb-sweep {
        position: absolute;
        top: -20%;
        bottom: -20%;
        left: 0;
        width: 55%;
        pointer-events: none;
        background: linear-gradient(102deg, transparent 30%, rgba(255,255,255,.05) 50%, transparent 70%);
        animation: jb-sweep 13s cubic-bezier(.5, 0, .5, 1) infinite;
      }
      .jb-vignette {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(ellipse at center, transparent 42%, rgba(10,11,15,.55) 100%);
      }
      .jb-grain {
        position: absolute;
        inset: 0;
        opacity: .04;
        pointer-events: none;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
      }

      /* ── Composição ────────────────────────────────────────────────────── */
      .jb-shell {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 0 24px;
        opacity: 0;
        transition: opacity .45s cubic-bezier(.16, 1, .3, 1);
      }
      .jb-shell.is-ready { opacity: 1; }
      .jb-rise { animation: jb-rise .85s cubic-bezier(.16, 1, .3, 1) both; }

      .jb-markwrap {
        position: relative;
        margin-bottom: 34px;
      }
      /* brilho de apoio no "chão" da marca */
      .jb-floor {
        position: absolute;
        left: 50%;
        bottom: -6px;
        width: 260px;
        height: 34px;
        transform: translateX(-50%);
        border-radius: 50%;
        pointer-events: none;
        background: radial-gradient(ellipse, rgba(236,106,30,.2) 0%, rgba(203,74,10,.07) 45%, transparent 72%);
        filter: blur(12px);
        animation: jb-floor-breathe 8s ease-in-out infinite;
      }
      .jb-mark {
        position: relative;
        width: 220px;
        height: 220px;
        display: grid;
        place-items: center;
        animation: jb-mark-in 1.1s cubic-bezier(.16, 1, .3, 1) both;
      }
      .jb-mark-halo {
        position: absolute;
        width: 190px;
        height: 190px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(236,106,30,.22) 0%, rgba(203,74,10,.08) 45%, transparent 70%);
        filter: blur(14px);
        animation: jb-halo-breathe 8s ease-in-out infinite;
      }
      /* onda lenta saindo da marca */
      .jb-pulse {
        position: absolute;
        width: 200px;
        height: 200px;
        border-radius: 50%;
        border: 1px solid rgba(236,106,30,.3);
        animation: jb-pulse 5.2s cubic-bezier(.22, .6, .3, 1) infinite;
      }
      .jb-ring {
        position: absolute;
        inset: 0;
        width: 220px;
        height: 220px;
      }
      .jb-ring-sweep {
        transform-box: view-box;
        transform-origin: center;
        animation: jb-spin 3.1s linear infinite;
        filter: drop-shadow(0 0 7px rgba(236,106,30,.4));
        will-change: transform;
      }
      /* arco interno, contrário e mais lento — profundidade sem ruído */
      .jb-ring-counter {
        transform-box: view-box;
        transform-origin: center;
        animation: jb-spin-reverse 7.4s linear infinite;
        will-change: transform;
      }
      .jb-tile { position: relative; }

      /* ── Tipografia ────────────────────────────────────────────────────── */
      .jb-word {
        position: relative;
        overflow: hidden;
      }
      /* glint único passando pela wordmark na entrada */
      .jb-word::after {
        content: '';
        position: absolute;
        inset: -8px -20px;
        pointer-events: none;
        background: linear-gradient(100deg, transparent 38%, rgba(255,255,255,.42) 50%, transparent 62%);
        mix-blend-mode: screen;
        transform: translateX(-130%);
        animation: jb-glint 1.7s .55s cubic-bezier(.4, 0, .2, 1) both;
      }
      .jb-rule {
        width: 56px;
        height: 1px;
        margin: 30px 0 22px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent);
      }
      .jb-status {
        margin: 0;
        font-family: ${BRAND_SANS};
        font-size: 10px;
        font-weight: 500;
        line-height: 1.4;
        letter-spacing: .28em;
        text-transform: uppercase;
        background: linear-gradient(
          100deg,
          rgba(247,242,236,.34) 38%,
          rgba(255,241,229,.92) 50%,
          rgba(247,242,236,.34) 62%
        );
        background-size: 260% 100%;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
        /* entrada + brilho contínuo (o shorthand de .jb-rise seria sobrescrito aqui) */
        animation:
          jb-rise .85s cubic-bezier(.16, 1, .3, 1) both,
          jb-textshimmer 3.4s linear infinite;
      }
      .jb-footer {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 30px;
        text-align: center;
        font-family: ${BRAND_SANS};
        font-size: 9px;
        font-weight: 500;
        letter-spacing: .18em;
        text-transform: uppercase;
        color: rgba(247,242,236,.2);
      }

      /* ── Movimento ─────────────────────────────────────────────────────── */
      @keyframes jb-rise {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes jb-mark-in {
        from { opacity: 0; transform: scale(.9); filter: blur(9px); }
        to { opacity: 1; transform: scale(1); filter: blur(0); }
      }
      @keyframes jb-spin { to { transform: rotate(360deg); } }
      @keyframes jb-spin-reverse { to { transform: rotate(-360deg); } }
      @keyframes jb-breathe {
        0%, 100% { opacity: .72; transform: translate(-50%, -50%) scale(1); }
        50% { opacity: 1; transform: translate(-50%, -50%) scale(1.05); }
      }
      @keyframes jb-halo-breathe {
        0%, 100% { opacity: .7; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.06); }
      }
      @keyframes jb-pulse {
        0% { transform: scale(.9); opacity: 0; }
        18% { opacity: .38; }
        100% { transform: scale(1.42); opacity: 0; }
      }
      @keyframes jb-sweep {
        0% { transform: translateX(-60%) skewX(-8deg); }
        100% { transform: translateX(260%) skewX(-8deg); }
      }
      @keyframes jb-glint { to { transform: translateX(130%); } }
      @keyframes jb-textshimmer {
        0% { background-position: 150% 0; }
        100% { background-position: -50% 0; }
      }

      /* o brilho do "chão" é centralizado por translateX — mantém no keyframe */
      @keyframes jb-floor-breathe {
        0%, 100% { opacity: .68; transform: translateX(-50%) scale(1); }
        50% { opacity: 1; transform: translateX(-50%) scale(1.07); }
      }

      @media (max-width: 640px) {
        .jb-markwrap { transform: scale(.86); margin-bottom: 22px; }
        .jb-rule { margin: 26px 0 20px; }
        .jb-footer { bottom: 24px; font-size: 8px; }
      }
      @media (max-height: 640px) {
        .jb-markwrap { transform: scale(.8); margin-bottom: 16px; }
        .jb-rule { margin: 20px 0 16px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .jurius-boot * { animation: none !important; filter: none !important; }
        .jb-ring-sweep { opacity: .6; }
        .jb-pulse, .jb-sweep, .jb-word::after { display: none; }
        .jb-status {
          background: none;
          color: rgba(247,242,236,.42);
          -webkit-text-fill-color: rgba(247,242,236,.42);
        }
      }
    `}</style>

    <div className="jb-glow" aria-hidden="true" />
    <div className="jb-sweep" aria-hidden="true" />
    <div className="jb-vignette" aria-hidden="true" />
    <div className="jb-grain" aria-hidden="true" />

    <div className={`jb-shell${fontsReady ? ' is-ready' : ''}`}>
      <div className="jb-markwrap">
        <span className="jb-floor" aria-hidden="true" />

        <div className="jb-mark">
          <span className="jb-mark-halo" aria-hidden="true" />
          <span className="jb-pulse" aria-hidden="true" />

          <svg className="jb-ring" viewBox="0 0 220 220" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="jb-arc" x1="0" y1="0" x2="220" y2="220" gradientUnits="userSpaceOnUse">
                <stop stopColor="#CB4A0A" stopOpacity="0" />
                <stop offset=".45" stopColor="#EC6A1E" />
                <stop offset="1" stopColor="#F6A356" stopOpacity="0" />
              </linearGradient>
            </defs>
            <circle cx="110" cy="110" r="96" stroke="rgba(255,255,255,.06)" strokeWidth="1" />
            <g className="jb-ring-sweep">
              <circle
                cx="110"
                cy="110"
                r="96"
                stroke="url(#jb-arc)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="132 471"
              />
            </g>
            <g className="jb-ring-counter">
              <circle
                cx="110"
                cy="110"
                r="88"
                stroke="rgba(255,255,255,.16)"
                strokeWidth="1"
                strokeLinecap="round"
                strokeDasharray="34 519"
              />
            </g>
          </svg>

          <div className="jb-tile">
            <BrandLogo iconOnly size="xl" shine />
          </div>
        </div>
      </div>

      <div className="jb-word jb-rise" style={{ animationDelay: '130ms' }}>
        <BrandLogo wordmarkOnly variant="reversed" size="lg" showTagline />
      </div>

      <span className="jb-rule jb-rise" style={{ animationDelay: '250ms' }} aria-hidden="true" />

      <p className="jb-status jb-rise" style={{ animationDelay: '330ms' }}>
        Verificando sessão
      </p>
    </div>

    <p className="jb-footer">{brandCopyright()}</p>
  </div>
);

export default SessionBootScreen;
