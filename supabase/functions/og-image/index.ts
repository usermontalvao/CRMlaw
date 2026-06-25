import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";

let initialized = false;
let fontBold: Uint8Array | null = null;
let fontRegular: Uint8Array | null = null;

async function ensureInit() {
  if (initialized) return;
  const [wasm, bold, regular] = await Promise.all([
    fetch("https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm"),
    fetch("https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-700-normal.woff2"),
    fetch("https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-400-normal.woff2"),
  ]);
  await initWasm(wasm);
  fontBold = new Uint8Array(await bold.arrayBuffer());
  fontRegular = new Uint8Array(await regular.arrayBuffer());
  initialized = true;
}

function svgAssinar(): string {
  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
<rect width="1200" height="630" fill="#18100a"/>
<rect width="1200" height="8" rx="0" fill="#f97316" opacity="0.9"/>
<rect x="0" y="0" width="8" height="630" fill="#f97316" opacity="0.15"/>

<!-- glow right -->
<circle cx="1050" cy="315" r="280" fill="#f97316" opacity="0.06"/>
<circle cx="1050" cy="315" r="160" fill="#f97316" opacity="0.06"/>

<!-- decorative pen path right -->
<path d="M860 440 Q910 390 950 430 Q990 470 1040 410 Q1080 360 1130 400" fill="none" stroke="#f97316" stroke-width="2.5" stroke-linecap="round" opacity="0.35"/>
<path d="M870 480 Q930 440 970 470 Q1010 500 1060 450 Q1100 415 1150 445" fill="none" stroke="#f97316" stroke-width="1.5" stroke-linecap="round" opacity="0.18"/>

<!-- document lines subtle -->
<rect x="880" y="130" width="220" height="260" rx="12" fill="#f97316" opacity="0.04" stroke="#f97316" stroke-width="1.5" stroke-opacity="0.2"/>
<rect x="910" y="175" width="160" height="6" rx="3" fill="#f97316" opacity="0.4"/>
<rect x="910" y="200" width="120" height="6" rx="3" fill="#ffffff" opacity="0.1"/>
<rect x="910" y="225" width="140" height="6" rx="3" fill="#ffffff" opacity="0.1"/>
<rect x="910" y="250" width="100" height="6" rx="3" fill="#ffffff" opacity="0.1"/>
<rect x="910" y="275" width="130" height="6" rx="3" fill="#ffffff" opacity="0.1"/>
<!-- dog ear -->
<path d="M1072 130 L1100 130 L1100 158 Z" fill="#18100a"/>
<path d="M1072 130 L1072 158 L1100 158" fill="none" stroke="#f97316" stroke-width="1.5" opacity="0.3"/>
<!-- pen icon -->
<g transform="translate(970, 340) rotate(-30)">
  <rect x="-10" y="-50" width="20" height="70" rx="4" fill="none" stroke="#f97316" stroke-width="2" opacity="0.55"/>
  <polygon points="-10,20 0,36 10,20" fill="#f97316" opacity="0.55"/>
  <line x1="4" y1="-48" x2="4" y2="18" stroke="#f97316" stroke-width="1.5" opacity="0.3"/>
</g>

<!-- label top -->
<text x="80" y="118" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#f97316" opacity="0.75" letter-spacing="5">JURIUS - ASSINATURA DIGITAL</text>

<!-- main text -->
<text x="80" y="258" font-family="Inter, Arial, sans-serif" font-size="88" font-weight="700" fill="#ffffff" letter-spacing="-2">Seu documento</text>
<text x="80" y="360" font-family="Inter, Arial, sans-serif" font-size="88" font-weight="700" fill="#f97316" letter-spacing="-2">chegou para assinar.</text>

<!-- subtitle -->
<text x="80" y="430" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="400" fill="#92400e" opacity="0.9">Assine com seguran&#231;a, direto pelo celular ou computador.</text>

<!-- divider -->
<rect x="80" y="485" width="1040" height="1" fill="#ffffff" opacity="0.07"/>

<!-- site -->
<text x="80" y="526" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="400" fill="#78350f" opacity="0.5" letter-spacing="1">jurius.com.br</text>
</svg>`;
}

function svgPreencher(): string {
  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
<rect width="1200" height="630" fill="#1a0e04"/>
<rect width="1200" height="8" rx="0" fill="#f97316" opacity="0.9"/>
<rect x="0" y="0" width="8" height="630" fill="#f97316" opacity="0.15"/>

<circle cx="1050" cy="315" r="280" fill="#f97316" opacity="0.06"/>
<circle cx="1050" cy="315" r="160" fill="#f97316" opacity="0.06"/>

<rect x="880" y="130" width="220" height="275" rx="12" fill="#f97316" opacity="0.04" stroke="#f97316" stroke-width="1.5" stroke-opacity="0.2"/>
<rect x="950" y="118" width="80" height="28" rx="14" fill="none" stroke="#f97316" stroke-width="1.5" opacity="0.35"/>
<rect x="910" y="185" width="14" height="14" rx="3" fill="none" stroke="#f97316" stroke-width="1.5" opacity="0.55"/>
<rect x="936" y="189" width="130" height="6" rx="3" fill="#f97316" opacity="0.4"/>
<rect x="910" y="216" width="14" height="14" rx="3" fill="#f97316" opacity="0.5"/>
<path d="M913 223 L917 228 L924 219" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="936" y="220" width="110" height="6" rx="3" fill="#ffffff" opacity="0.12"/>
<rect x="910" y="247" width="14" height="14" rx="3" fill="none" stroke="#f97316" stroke-width="1.5" opacity="0.55"/>
<rect x="936" y="251" width="140" height="6" rx="3" fill="#ffffff" opacity="0.12"/>
<rect x="910" y="278" width="14" height="14" rx="3" fill="none" stroke="#f97316" stroke-width="1.5" opacity="0.55"/>
<rect x="936" y="282" width="90" height="6" rx="3" fill="#f97316" opacity="0.3"/>
<rect x="910" y="309" width="14" height="14" rx="3" fill="none" stroke="#f97316" stroke-width="1.5" opacity="0.55"/>
<rect x="936" y="313" width="120" height="6" rx="3" fill="#ffffff" opacity="0.12"/>
<rect x="910" y="358" width="160" height="4" rx="2" fill="#f97316" opacity="0.55"/>

<text x="80" y="118" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#f97316" opacity="0.75" letter-spacing="5">JURIUS - FORMULARIO DIGITAL</text>
<text x="80" y="258" font-family="Inter, Arial, sans-serif" font-size="88" font-weight="700" fill="#ffffff" letter-spacing="-2">Formul&#225;rio enviado</text>
<text x="80" y="360" font-family="Inter, Arial, sans-serif" font-size="88" font-weight="700" fill="#f97316" letter-spacing="-2">pelo escrit&#243;rio.</text>
<text x="80" y="430" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="400" fill="#92400e" opacity="0.9">Preencha os dados solicitados pelo seu advogado.</text>
<rect x="80" y="485" width="1040" height="1" fill="#ffffff" opacity="0.07"/>
<text x="80" y="526" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="400" fill="#78350f" opacity="0.5" letter-spacing="1">jurius.com.br</text>
</svg>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);

  // Detectar tipo: /og-image/assinar ou /og-image/preencher
  let type: 'assinar' | 'preencher' | null = null;
  for (const seg of segments) {
    if (seg === 'assinar' || seg === 'preencher') { type = seg; break; }
  }

  if (!type) {
    return new Response('Not found — use /og-image/assinar ou /og-image/preencher', { status: 404 });
  }

  try {
    await ensureInit();

    const svg = type === 'assinar' ? svgAssinar() : svgPreencher();

    const resvg = new Resvg(svg, {
      font: {
        fontBuffers: [fontBold!, fontRegular!],
        defaultFontFamily: 'Inter',
        serifFamily: 'Inter',
        sansSerifFamily: 'Inter',
        monospaceFamily: 'Inter',
      },
      fitTo: { mode: 'width', value: 1200 },
    });

    const rendered = resvg.render();
    const png = rendered.asPng();

    return new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('og-image error:', err);
    return new Response('Error generating image', { status: 500 });
  }
});
