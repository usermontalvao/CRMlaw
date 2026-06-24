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
  divider: '#E7DDD4',
  wordLead: '#211C18',
  wordDot: '#E45C12',
  wordTld: '#A0958C',
  tagline: '#A89C92',
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
    <radialGradient id="ogglow" cx="0.22" cy="0.26" r="1.0">
      <stop offset="0%" stop-color="#FBEFE3" stop-opacity="0.9"/>
      <stop offset="55%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#FFFFFF"/>
  <rect width="${W}" height="${H}" fill="url(#ogglow)"/>
  <rect x="${dividerX}" y="${tileCy - 60}" width="1" height="120" fill="${BRAND.divider}"/>
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

// ───── email-header.png: lockup CLARO para o cabeçalho dos e-mails ─────
// (renderizado como imagem para ser idêntico ao site em qualquer cliente de e-mail)
{
  const EW = 740, EH = 230;
  const tile = 168;
  const tileX = 44, tileY = Math.round((EH - tile) / 2);
  const dividerX = tileX + tile + 26;
  const textX = dividerX + 34;
  const wordY = EH / 2 - 12;
  const tagY = wordY + 46;
  const ehBase = `<svg xmlns="http://www.w3.org/2000/svg" width="${EW}" height="${EH}" viewBox="0 0 ${EW} ${EH}">
    <defs><style>${fontFace}</style></defs>
    <rect width="${EW}" height="${EH}" fill="#FFFFFF"/>
    <rect x="${dividerX}" y="${EH / 2 - 48}" width="1" height="96" fill="#E7DDD4"/>
    <text x="${textX}" y="${wordY}" dominant-baseline="middle" font-family="${SERIF}" font-size="58" font-weight="700" letter-spacing="-0.012em"><tspan fill="#211C18">jurius</tspan><tspan fill="#E45C12">.</tspan><tspan fill="#A0958C" font-weight="400">com.br</tspan></text>
    <text x="${textX}" y="${tagY}" dominant-baseline="middle" font-family="${SANS}" font-size="16" font-weight="500" letter-spacing="0.34em" fill="#A89C92">GESTÃO JURÍDICA INTELIGENTE</text>
  </svg>`;
  const ehTile = await tileFromLogo(tile, 0.04);
  await sharp(Buffer.from(ehBase))
    .composite([{ input: ehTile, left: tileX, top: tileY }])
    .png()
    .toFile(pub('email-header.png'));
  console.log('wrote email-header.png', EW + 'x' + EH);
}
console.log('done');
