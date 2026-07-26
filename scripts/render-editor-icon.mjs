/**
 * Gera os ícones do APP "Editor" (PWA instalável separado do CRM).
 *
 * Fonte: SVG inline abaixo (tile âmbar + folha de documento com pena).
 * Saída: public/editor-icon-192.png e public/editor-icon-512.png (maskable).
 *
 * Para trocar a arte: edite o SVG e rode `node scripts/render-editor-icon.mjs`.
 * Requer a devDependency `sharp`.
 */
import sharp from 'sharp';

const pub = (name) =>
  new URL(`../public/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Full-bleed âmbar (sobrevive ao mascaramento circular do maskable). O conteúdo
// principal — a folha — fica dentro da zona segura central (~64%).
const SVG = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fb923c"/>
      <stop offset="0.55" stop-color="#f97316"/>
      <stop offset="1" stop-color="#ea580c"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#fff7ed"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#7c2d12" flood-opacity="0.28"/>
    </filter>
  </defs>

  <rect width="512" height="512" rx="112" fill="url(#bg)"/>

  <!-- Folha de documento -->
  <g filter="url(#soft)">
    <path d="M156 116 h150 l50 50 v230 a16 16 0 0 1 -16 16 H156 a16 16 0 0 1 -16 -16 V132 a16 16 0 0 1 16 -16 z"
          fill="url(#paper)"/>
    <!-- Dobra do canto -->
    <path d="M306 116 v50 h50 z" fill="#fed7aa"/>
  </g>

  <!-- Linhas de texto -->
  <g fill="#fdba74">
    <rect x="176" y="196" width="120" height="16" rx="8"/>
    <rect x="176" y="232" width="160" height="16" rx="8"/>
    <rect x="176" y="268" width="140" height="16" rx="8"/>
  </g>
  <!-- Linha em edição (destaque âmbar) -->
  <rect x="176" y="304" width="96" height="16" rx="8" fill="#f97316"/>

  <!-- Pena / caneta em diagonal -->
  <g transform="rotate(45 356 356)">
    <rect x="342" y="256" width="28" height="150" rx="12" fill="#1f2937"/>
    <rect x="342" y="256" width="28" height="34" rx="12" fill="#f59e0b"/>
    <path d="M342 406 h28 l-14 34 z" fill="#111827"/>
  </g>
</svg>`;

const jobs = [
  ['editor-icon-192.png', 192],
  ['editor-icon-512.png', 512],
];

for (const [name, size] of jobs) {
  await sharp(Buffer.from(SVG))
    .resize(size, size)
    .png()
    .toFile(pub(name));
  console.log('gerado', name, `${size}x${size}`);
}
