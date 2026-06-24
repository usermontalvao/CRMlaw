/**
 * Marca Jurius — fonte única de verdade.
 *
 * Toda a identidade visual da marca (cores, tipografia, textos e os geradores
 * de HTML para contextos de PDF/print/e-mail) vive aqui. Componentes React
 * consomem estes tokens via <BrandLogo> (src/components/ui/BrandLogo.tsx);
 * geradores de string HTML (recibos, relatórios, PDFs) consomem os helpers
 * brand*HTML() abaixo.
 *
 * NÃO confundir com a logo do escritório (`logo_url`/`logoUrl`): aquela é a
 * marca do escritório-cliente, dinâmica e multi-tenant, e não passa por aqui.
 */

/* ─── Cores ──────────────────────────────────────────────────────────────── */

/** Gradiente âmbar da marca (152deg), do documento de identidade. */
export const BRAND_GRADIENT_STOPS = {
  from: '#F6A356',
  via: '#EC6A1E',
  to: '#CB4A0A',
} as const;

export const BRAND_GRADIENT = `linear-gradient(152deg, ${BRAND_GRADIENT_STOPS.from} 0%, ${BRAND_GRADIENT_STOPS.via} 48%, ${BRAND_GRADIENT_STOPS.to} 100%)`;

/** Ponto laranja da wordmark ("jurius●com.br"), claro e escuro. */
export const BRAND_DOT = '#E45C12';
export const BRAND_DOT_ON_DARK = '#F2843E';

/** Neutros do sistema. */
export const BRAND_INK = '#1A1613'; // tinta (fundo escuro quente)
export const BRAND_NAVY = '#0F1B2D'; // institucional (opcional, não-padrão)
export const BRAND_NAVY_GOLD = '#E0A23C'; // detalhe da linha navy
export const BRAND_IVORY = '#FBF8F5'; // marfim (fundo claro)

/* ─── Tipografia ─────────────────────────────────────────────────────────── */

/** Serifa da wordmark e do monograma "J". Carregada no index.html. */
export const BRAND_SERIF = "'Spectral', Georgia, 'Times New Roman', serif";
/** Sans geométrica da tagline e rótulos. Carregada no index.html. */
export const BRAND_SANS = "'Space Grotesk', 'Manrope', system-ui, sans-serif";

/** Cor da régua divisória do lockup, por variante. */
export const BRAND_DIVIDER: Record<'light' | 'ink' | 'navy' | 'reversed', string> = {
  light: '#E7DDD4',
  ink: '#473C33',
  reversed: '#473C33',
  navy: '#324158',
};

/* ─── Textos ─────────────────────────────────────────────────────────────── */

export const BRAND_NAME = 'Jurius';
export const BRAND_DOMAIN = 'jurius.com.br';
/** Partes da wordmark para montar "jurius" + ponto + "com.br". */
export const BRAND_WORDMARK = { lead: 'jurius', dot: '.', tld: 'com.br' } as const;
export const BRAND_TAGLINE = 'Gestão Jurídica Inteligente';
export const BRAND_TAGLINE_SHORT = 'Sistema de Gestão Jurídica';

/** Linha de copyright pronta (ano corrente). */
export const brandCopyright = (year: number = new Date().getFullYear()): string =>
  `© ${year} ${BRAND_DOMAIN} — ${BRAND_TAGLINE_SHORT}`;

/* ─── Helpers para HTML/PDF (sem React) ──────────────────────────────────── */

type BrandHTMLVariant = 'light' | 'ink' | 'navy' | 'reversed';

const wordmarkColors = (variant: BrandHTMLVariant) => {
  switch (variant) {
    case 'ink':
    case 'reversed':
      return { lead: '#FBF6F1', dot: BRAND_DOT_ON_DARK, tld: '#8C7E72' };
    case 'navy':
      return { lead: '#F4F1EC', dot: BRAND_NAVY_GOLD, tld: '#6E7A8C' };
    case 'light':
    default:
      return { lead: '#211C18', dot: BRAND_DOT, tld: '#A0958C' };
  }
};

/**
 * Tile do monograma "J" como string HTML (para PDFs/recibos/e-mails).
 * @param px lado do tile em pixels (default 40).
 */
export const brandMarkHTML = ({ px = 40, variant = 'light' as BrandHTMLVariant } = {}): string => {
  const radius = Math.round(px * 0.25);
  const fontSize = Math.round(px * 0.6);
  const isNavy = variant === 'navy';
  const bg = isNavy
    ? 'linear-gradient(152deg,#1B2B45,#13203A)'
    : BRAND_GRADIENT;
  const color = isNavy ? BRAND_NAVY_GOLD : '#fff';
  const border = isNavy ? `border:1px solid rgba(224,162,60,.35);` : '';
  const shadow = isNavy
    ? 'box-shadow:0 8px 20px -8px rgba(0,0,0,.5);'
    : `box-shadow:0 ${Math.round(px * 0.18)}px ${Math.round(px * 0.4)}px -${Math.round(
        px * 0.12,
      )}px rgba(203,74,10,.55), inset 0 1.5px 0 rgba(255,255,255,.5);`;
  return (
    `<div style="width:${px}px;height:${px}px;border-radius:${radius}px;` +
    `background:${bg};${border}${shadow}` +
    `display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">` +
    `<span style="font-family:${BRAND_SERIF};font-weight:600;font-size:${fontSize}px;` +
    `line-height:1;color:${color};text-shadow:0 2px 7px rgba(120,40,0,.35);">J</span>` +
    `</div>`
  );
};

/** Wordmark "jurius●com.br" como string HTML. */
export const brandWordmarkHTML = ({
  px = 28,
  variant = 'light' as BrandHTMLVariant,
} = {}): string => {
  const c = wordmarkColors(variant);
  return (
    `<span style="font-family:${BRAND_SERIF};font-weight:700;font-size:${px}px;` +
    `letter-spacing:-.012em;line-height:1;color:${c.lead};">` +
    `${BRAND_WORDMARK.lead}<span style="color:${c.dot};">${BRAND_WORDMARK.dot}</span>` +
    `<span style="font-weight:400;color:${c.tld};">${BRAND_WORDMARK.tld}</span></span>`
  );
};

/** Lockup completo (tile + wordmark + tagline) como string HTML. */
export const brandLockupHTML = ({
  px = 40,
  variant = 'light' as BrandHTMLVariant,
  tagline = true,
  gap = 14,
}: { px?: number; variant?: BrandHTMLVariant; tagline?: boolean; gap?: number } = {}): string => {
  const c = wordmarkColors(variant);
  const tag = tagline
    ? `<div style="font-size:${Math.round(px * 0.22)}px;letter-spacing:.28em;` +
      `text-transform:uppercase;color:${c.tld};margin-top:3px;font-weight:600;">${BRAND_TAGLINE}</div>`
    : '';
  return (
    `<div style="display:inline-flex;align-items:center;gap:${gap}px;">` +
    brandMarkHTML({ px, variant }) +
    `<div style="line-height:1;">${brandWordmarkHTML({ px: Math.round(px * 0.62), variant })}${tag}</div>` +
    `</div>`
  );
};
