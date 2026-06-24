import React from 'react';
import {
  BRAND_GRADIENT,
  BRAND_DOT,
  BRAND_DOT_ON_DARK,
  BRAND_NAVY_GOLD,
  BRAND_SERIF,
  BRAND_SANS,
  BRAND_DIVIDER,
  BRAND_WORDMARK,
  BRAND_TAGLINE,
} from '../../constants/brand';

/**
 * BrandLogo — marca Jurius canônica (fonte única de verdade visual).
 *
 * Reprodução fiel do documento de identidade "Jurius Logo" (Frames A/B/C/D):
 * tile âmbar com gradiente 152deg + "J" em serifa Spectral, régua divisória,
 * wordmark "jurius●com.br" em Spectral e tagline em Space Grotesk.
 *
 * Use SEMPRE este componente em vez de recriar o "J" manualmente.
 * Para HTML/PDF (sem React) use os helpers de src/constants/brand.ts.
 * NÃO usar para a logo do escritório (`logo_url`): essa é dinâmica/multi-tenant.
 */

export type BrandVariant = 'light' | 'ink' | 'navy' | 'reversed';
export type BrandSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface BrandLogoProps {
  /** Paleta conforme o fundo. light=fundo claro; ink/reversed=fundo escuro; navy=institucional. */
  variant?: BrandVariant;
  size?: BrandSize;
  /** Só o tile do "J" (sem wordmark nem divisória). */
  iconOnly?: boolean;
  showWordmark?: boolean;
  /** Só a wordmark (sem tile nem divisória). */
  wordmarkOnly?: boolean;
  showTagline?: boolean;
  /** Régua divisória vertical entre tile e wordmark (do lockup do doc). */
  divider?: boolean;
  /** Empilha tile sobre a wordmark, centralizado. */
  stacked?: boolean;
  /** Brilho animado passando pelo tile (telas de marca/loaders). */
  shine?: boolean;
  className?: string;
  wordmarkClassName?: string;
  title?: string;
}

/** lado do tile (px) por tamanho. */
const TILE_PX: Record<BrandSize, number> = { xs: 24, sm: 36, md: 48, lg: 72, xl: 108 };
/** tamanho da wordmark (px) por tamanho — proporção fiel do doc (48px @ tile 108px). */
const WORD_PX: Record<BrandSize, number> = { xs: 13, sm: 16, md: 22, lg: 32, xl: 48 };

const wordmarkColors = (variant: BrandVariant) => {
  switch (variant) {
    case 'ink':
    case 'reversed':
      return { lead: '#FBF6F1', dot: BRAND_DOT_ON_DARK, tld: '#8C7E72', tag: '#9A8B7D' };
    case 'navy':
      return { lead: '#F4F1EC', dot: BRAND_NAVY_GOLD, tld: '#6E7A8C', tag: '#7E8A9C' };
    case 'light':
    default:
      return { lead: '#211C18', dot: BRAND_DOT, tld: '#A0958C', tag: '#A89C92' };
  }
};

const Tile: React.FC<{ variant: BrandVariant; px: number; shine: boolean; decorative: boolean }> = ({
  variant,
  px,
  shine,
  decorative,
}) => {
  const radius = Math.round(px * 0.25);
  const fontSize = Math.round(px * 0.61);
  const isNavy = variant === 'navy';
  const tileStyle: React.CSSProperties = isNavy
    ? {
        width: px,
        height: px,
        borderRadius: radius,
        background: 'linear-gradient(152deg,#1B2B45,#13203A)',
        border: '1px solid rgba(224,162,60,.35)',
        boxShadow: '0 18px 40px -14px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.08)',
      }
    : {
        width: px,
        height: px,
        borderRadius: radius,
        background: BRAND_GRADIENT,
        boxShadow: `0 ${Math.round(px * 0.14)}px ${Math.round(px * 0.32)}px -${Math.round(
          px * 0.12,
        )}px rgba(150,58,16,.42), inset 0 1.5px 0 rgba(255,255,255,.5), inset 0 -${Math.round(
          px * 0.05,
        )}px ${Math.round(px * 0.11)}px rgba(120,46,10,.3)`,
      };
  return (
    <div
      className="relative inline-flex items-center justify-center overflow-hidden flex-shrink-0"
      style={tileStyle}
      aria-hidden={decorative ? true : undefined}
    >
      <span
        style={{
          fontFamily: BRAND_SERIF,
          fontWeight: isNavy ? 500 : 600,
          fontSize,
          lineHeight: 1,
          color: isNavy ? '#E6B45A' : '#fff',
          transform: 'translateY(-1px)',
          textShadow: isNavy ? 'none' : '0 2px 7px rgba(120,40,0,.4)',
          userSelect: 'none',
        }}
      >
        J
      </span>
      {shine && !isNavy && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 brand-shine"
          style={{ width: '60%', background: 'linear-gradient(100deg,transparent,rgba(255,255,255,.22) 50%,transparent)' }}
        />
      )}
    </div>
  );
};

const Wordmark: React.FC<{
  variant: BrandVariant;
  size: BrandSize;
  showTagline: boolean;
  stacked: boolean;
  className: string;
}> = ({ variant, size, showTagline, stacked, className }) => {
  const c = wordmarkColors(variant);
  const wordPx = WORD_PX[size];
  return (
    <div className={`flex flex-col ${stacked ? 'items-center' : ''} ${className}`}>
      <span
        style={{
          fontFamily: BRAND_SERIF,
          fontWeight: 700,
          fontSize: wordPx,
          letterSpacing: '-0.012em',
          lineHeight: 1,
          color: c.lead,
        }}
      >
        {BRAND_WORDMARK.lead}
        <span style={{ color: c.dot }}>{BRAND_WORDMARK.dot}</span>
        <span style={{ fontWeight: 400, color: c.tld }}>{BRAND_WORDMARK.tld}</span>
      </span>
      {showTagline && (
        <span
          style={{
            fontFamily: BRAND_SANS,
            fontWeight: 500,
            fontSize: Math.max(9, Math.round(wordPx * 0.25)),
            letterSpacing: '0.44em',
            textTransform: 'uppercase',
            color: c.tag,
            marginTop: Math.round(wordPx * 0.29),
          }}
        >
          {BRAND_TAGLINE}
        </span>
      )}
    </div>
  );
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'light',
  size = 'md',
  iconOnly = false,
  showWordmark,
  wordmarkOnly = false,
  showTagline = true,
  divider,
  stacked = false,
  shine = false,
  className = '',
  wordmarkClassName = '',
  title,
}) => {
  const px = TILE_PX[size];
  const renderTile = !wordmarkOnly;
  const renderWordmark = wordmarkOnly || (showWordmark ?? !iconOnly);
  // Régua divisória: liga por padrão no lockup horizontal completo (como no doc).
  const showDivider =
    (divider ?? true) && renderTile && renderWordmark && !stacked && !wordmarkOnly;

  return (
    <div
      className={`flex ${stacked ? 'flex-col items-center gap-3 text-center' : 'items-center'} ${className}`}
      style={!stacked ? { gap: Math.round(px * 0.31) } : undefined}
      title={title}
    >
      {shine && variant !== 'navy' && renderTile && (
        <style>{`@keyframes brandShine{0%{transform:translateX(-90%) skewX(-10deg);opacity:0}18%{opacity:1}50%{opacity:1}82%{opacity:0}100%{transform:translateX(230%) skewX(-10deg);opacity:0}}.brand-shine{animation:brandShine 6s ease-in-out 2s infinite}@media (prefers-reduced-motion:reduce){.brand-shine{animation:none;opacity:0}}`}</style>
      )}
      {renderTile && <Tile variant={variant} px={px} shine={shine} decorative={renderWordmark} />}
      {showDivider && (
        <span
          aria-hidden="true"
          style={{
            width: 1,
            height: Math.round(px * 0.78),
            background: `linear-gradient(transparent, ${BRAND_DIVIDER[variant]}, transparent)`,
            flexShrink: 0,
          }}
        />
      )}
      {renderWordmark && (
        <Wordmark
          variant={variant}
          size={size}
          showTagline={showTagline}
          stacked={stacked}
          className={wordmarkClassName}
        />
      )}
    </div>
  );
};

export default BrandLogo;
