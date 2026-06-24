/**
 * Gera os PNGs da marca Jurius a partir da LOGO OFICIAL estática.
 *
 * Fonte única do símbolo: public/logo.png (tile âmbar com o "J").
 * Para trocar a marca: substitua public/logo.png e rode `npm run brand:icons`.
 *
 *  - icon-192 / icon-512 / apple-touch-icon : o tile oficial recortado e centralizado
 *  - og-image (1200x630)                    : lockup horizontal (tile oficial + wordmark)
 *
 * Requer a devDependency `sharp` e as fontes em scripts/assets/.
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const pub = (name) => new URL(`../public/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const asset = (name) => new URL(`./assets/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const LOGO = pub('logo.png');

// Cores/texto do lockup do og — espelham src/constants/brand.ts
const BRAND = {
  divider: '#473C33',
  wordLead: '#FBF6F1',
  wordDot: '#F2843E',
  wordTld: '#8C7E72',
  tagline: '#9A8B7D',
};

const spectralB64 = readFileSync(asset('Spectral-SemiBold.ttf')).toString('base64');
const spaceGroteskB64 = readFileSync(asset('SpaceGrotesk-Medium.ttf')).toString('base64');
const fontFace =
  `@font-face{font-family:'Spectral';src:url(data:font/ttf;base64,${spectralB64}) format('truetype');font-weight:600 700;}` +
  `@font-face{font-family:'Space Grotesk';src:url(data:font/ttf;base64,${spaceGroteskB64}) format('truetype');font-weight:500;}`;
const SERIF = "'Spectral', Georgia, 'Times New Roman', serif";
const SANS = "'Space Grotesk', 'Manrope', system-ui, sans-serif";

/**
 * Recorta a transparência ao redor da logo oficial e centraliza num quadrado
 * com uma margem, preservando a sombra/cantos da arte original.
 */
async function tileFromLogo(size, margin = 0.06) {
  const inner = Math.round(size * (1 - margin * 2));
  const art = await sharp(LOGO)
    .trim({ threshold: 12 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, gravity: 'center' }])
    .png()
    .toBuffer();
}

// ───── ícones do app (a partir da logo oficial) ─────
const iconJobs = [
  ['icon-192.png', 192, 0.06],
  ['icon-512.png', 512, 0.06],
  ['apple-touch-icon.png', 180, 0.03],
];
for (const [name, size, margin] of iconJobs) {
  const buf = await tileFromLogo(Math.max(size, 512), margin);
  await sharp(buf).resize(size, size).png().toFile(pub(name));
  console.log('wrote', name, size + 'px');
}

// ───── og-image: lockup horizontal (tile oficial + wordmark) ─────
const W = 1200,
  H = 630;
const ogTile = 220; // inclui margem/sombra da arte
const tileCx = 250,
  tileCy = H / 2 - 6;
const dividerX = 470;
const textX = 524;
const wordY = tileCy - 18;
const tagY = wordY + 56;

const ogBaseSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>${fontFace}</style>
    <linearGradient id="ogbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#231d18"/>
      <stop offset="100%" stop-color="#140f0c"/>
    </linearGradient>
    <radialGradient id="ogglow" cx="0.2" cy="0.28" r="0.9">
      <stop offset="0%" stop-color="#f6a356" stop-opacity="0.20"/>
      <stop offset="45%" stop-color="#f6a356" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#f6a356" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#ogbg)"/>
  <rect width="${W}" height="${H}" fill="url(#ogglow)"/>
  <rect x="44" y="44" width="${W - 88}" height="${H - 88}" rx="24" fill="none" stroke="#ffffff" stroke-opacity="0.05"/>
  <rect x="${dividerX}" y="${tileCy - 66}" width="1" height="132" fill="${BRAND.divider}" opacity="0.9"/>
  <text x="${textX}" y="${wordY}" dominant-baseline="middle" font-family="${SERIF}" font-size="74" font-weight="700" letter-spacing="-0.012em">
    <tspan fill="${BRAND.wordLead}">jurius</tspan><tspan fill="${BRAND.wordDot}">.</tspan><tspan fill="${BRAND.wordTld}" font-weight="400">com.br</tspan>
  </text>
  <text x="${textX}" y="${tagY}" dominant-baseline="middle" font-family="${SANS}" font-size="19" font-weight="500" letter-spacing="0.4em" fill="${BRAND.tagline}">GESTÃO JURÍDICA INTELIGENTE</text>
</svg>`;

const ogTileBuf = await tileFromLogo(ogTile, 0.04);
const ogTileX = Math.round(tileCx - ogTile / 2);
const ogTileY = Math.round(tileCy - ogTile / 2);
await sharp(Buffer.from(ogBaseSvg))
  .composite([{ input: ogTileBuf, left: ogTileX, top: ogTileY }])
  .png()
  .toFile(pub('og-image.png'));
console.log('wrote og-image.png', W + 'x' + H);

// master SVG do og (espelha o PNG; embute o tile oficial como <image>)
const ogTileB64 = ogTileBuf.toString('base64');
const ogSvgMaster = ogBaseSvg.replace(
  '</svg>',
  `  <image href="data:image/png;base64,${ogTileB64}" x="${ogTileX}" y="${ogTileY}" width="${ogTile}" height="${ogTile}"/>\n</svg>`,
);
writeFileSync(pub('og-image.svg'), ogSvgMaster);
console.log('wrote og-image.svg');

// ───── favicon (aba do navegador) a partir da logo oficial ─────
const favTile = await tileFromLogo(128, 0.02);
const favB64 = favTile.toString('base64');
writeFileSync(
  pub('favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><image href="data:image/png;base64,${favB64}" width="128" height="128"/></svg>\n`,
);
for (const s of [16, 32, 48]) {
  await sharp(favTile).resize(s, s).png().toFile(pub(`favicon-${s}.png`));
}
console.log('wrote favicon.svg + favicon-16/32/48.png');
console.log('done');
