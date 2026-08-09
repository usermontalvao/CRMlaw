/**
 * Gera os ícones do APP "Atendimento" (módulo WhatsApp como PWA separado).
 *
 * Fonte: tile verde do WhatsApp + o GLIFO que o CRM já usa na sidebar e na
 * busca — o mesmo `path` de src/components/icons/WhatsAppIcon.tsx, copiado aqui
 * porque este script roda em Node puro (sem o bundler para ler o .tsx).
 * ⚠️ Se aquele arquivo mudar, atualize o `GLIFO` abaixo e rode este script.
 *
 * Saída: public/atendimento-icon-192.png e public/atendimento-icon-512.png.
 *
 * Para trocar a arte: edite o SVG e rode `node scripts/render-atendimento-icon.mjs`.
 * Requer a devDependency `sharp`.
 */
import sharp from 'sharp';

const pub = (name) =>
  new URL(`../public/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Glifo do WhatsApp, viewBox 0 0 24 24 (idêntico ao do WhatsAppIcon.tsx). */
const GLIFO =
  'M17.472 14.382c-.297-.149-1.758-.867-2.03-.966-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.981.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.895 6.99c-.003 5.45-4.437 9.884-9.887 9.889m8.413-18.297A11.815 11.815 0 0 0 12.055 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.9 11.9 0 0 0 5.688 1.448h.005c6.557 0 11.892-5.335 11.895-11.893a11.821 11.821 0 0 0-3.486-8.413Z';

// O glifo é 24x24. Ampliado 11x dá 264px de lado — 52% dos 512, dentro da zona
// segura central (~64%) que o recorte circular do "maskable" preserva. O resto
// é tile full-bleed, para o ícone não ganhar borda branca em nenhum formato.
const ESCALA = 11;
const DESLOCA = (512 - 24 * ESCALA) / 2;

const SVG = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#25d366"/>
      <stop offset="0.55" stop-color="#1ebe57"/>
      <stop offset="1" stop-color="#128c7e"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#064e3b" flood-opacity="0.28"/>
    </filter>
  </defs>

  <rect width="512" height="512" rx="112" fill="url(#bg)"/>

  <g filter="url(#soft)" transform="translate(${DESLOCA} ${DESLOCA}) scale(${ESCALA})">
    <path d="${GLIFO}" fill="#ffffff"/>
  </g>
</svg>`;

const jobs = [
  ['atendimento-icon-192.png', 192],
  ['atendimento-icon-512.png', 512],
];

for (const [name, size] of jobs) {
  await sharp(Buffer.from(SVG))
    .resize(size, size)
    .png()
    .toFile(pub(name));
  console.log('gerado', name, `${size}x${size}`);
}
