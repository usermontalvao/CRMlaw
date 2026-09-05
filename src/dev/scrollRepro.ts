/**
 * Bancada isolada para medir a renderização do editor durante o SCROLL.
 *
 * Não faz parte do app (entrada própria em /dev-scroll-repro.html, fora do
 * build de produção). Monta o DocumentEditor com a MESMA configuração do editor
 * de petições, abre um documento longo e mede:
 *
 *  - `run()`     — se a página é pintada DENTRO do handler de rolagem ou só
 *                  depois (foi assim que o modo otimizado do corretor foi pego);
 *  - `cost()`    — quanto tempo o handler leva por quadro. É esse tempo,
 *                  multiplicado pela velocidade da rolagem, que vira a faixa em
 *                  branco na borda de entrada da tela.
 *
 * O documento "pesado" imita a peça real: timbre com imagem no cabeçalho,
 * rodapé, borda de página e texto justificado em Century Gothic.
 */
import '../styles/syncfusion-editor.css';
import { registerLicense } from '@syncfusion/ej2-base';
import { registerSyncfusionLicenseOnce } from '../utils/syncfusionRuntime';
import { DocumentEditorContainer, Toolbar } from '@syncfusion/ej2-documenteditor';
import { attachLocalSpellChecker } from '../components/local-spell-checker';

// Porta única: ver `syncfusionRuntime.ts` — `registerLicense` troca o
// validador inteiro, então cada um registrar a sua chave apaga as outras.
registerSyncfusionLicenseOnce(registerLicense);

DocumentEditorContainer.Inject(Toolbar);

const PARAGRAPH = [
  'Trata-se de ação de indenização por danos morais e materiais proposta pelo requerente',
  'em face da requerida, diante da conduta ilícita praticada e amplamente documentada nos',
  'autos, na forma dos artigos 186 e 927 do Código Civil, bem como do artigo 6º do Código',
  'de Defesa do Consumidor, cuja aplicação ao caso concreto é medida que se impõe.',
].join(' ');

/** Timbre sintético — só para o custo de `drawImage` por página existir. */
const letterhead = (): string => {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 900, 160);
  grad.addColorStop(0, '#8a6a2f');
  grad.addColorStop(1, '#e6d3a3');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 900, 160);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 48px serif';
  ctx.fillText('ADVOCACIA', 40, 100);
  return c.toDataURL('image/png');
};

const buildSfdt = (opts: { paragraphs: number; heavy: boolean }) => {
  const font = opts.heavy ? 'Century Gothic' : 'Times New Roman';
  const header = opts.heavy
    ? {
        blocks: [
          { inlines: [{ imageString: letterhead(), width: 420, height: 75 }] },
          {
            paragraphFormat: { textAlignment: 'Center' },
            inlines: [{ characterFormat: { fontSize: 9, fontFamily: font }, text: 'PEDRO RODRIGUES — OAB/MT' }],
          },
        ],
      }
    : { blocks: [{ inlines: [] }] };
  const footer = opts.heavy
    ? {
        blocks: [
          {
            paragraphFormat: { textAlignment: 'Center' },
            inlines: [
              { characterFormat: { fontSize: 8, fontFamily: font }, text: 'Rua 14, quadra 70, nº 16 — Pedra 90 — Cuiabá/MT — (65) 9 8404-6375' },
            ],
          },
        ],
      }
    : { blocks: [{ inlines: [] }] };

  return {
    sections: [
      {
        sectionFormat: {
          pageWidth: 595.3,
          pageHeight: 841.9,
          leftMargin: 85.05,
          rightMargin: 85.05,
          topMargin: opts.heavy ? 110 : 85.05,
          bottomMargin: opts.heavy ? 80 : 85.05,
          headerDistance: 20,
          footerDistance: 20,
        },
        blocks: Array.from({ length: opts.paragraphs }, (_, i) => ({
          paragraphFormat: { afterSpacing: 12, textAlignment: 'Justify', lineSpacing: 1.5, lineSpacingType: 'Multiple' },
          inlines: [
            { characterFormat: { fontSize: 14, fontFamily: font }, text: `${i + 1}. ${PARAGRAPH}` },
          ],
        })),
        headersFooters: { header, footer },
      },
    ],
  };
};

const container = new DocumentEditorContainer({
  height: '100%',
  enableToolbar: false,
  enableSpellCheck: true,
  showPropertiesPane: false,
});
container.appendTo('#host');

const editor: any = container.documentEditor;
editor.spellChecker.languageID = 1046;
editor.spellChecker.allowSpellCheckAndSuggestion = true;
editor.spellChecker.ignoreUppercase = true;
// Mesma decisão do app (ver SyncfusionEditor.tsx): sem check por página, a
// pintura da página não espera corretor nenhum.
editor.spellChecker.enableOptimizedSpellCheck = false;
attachLocalSpellChecker(editor);

const load = (heavy: boolean, paragraphs = 160) =>
  editor.open(JSON.stringify(buildSfdt({ paragraphs, heavy })));

load(true);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Esvazia a fila de microtasks (é aí que cai o `.then` do corretor). */
const microtasks = async (n = 10) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** Fração de pixels "com tinta" (não-fundo) numa faixa horizontal do canvas. */
const inkInBand = (topRatio: number, bottomRatio: number): number => {
  const canvas: HTMLCanvasElement = editor.documentHelper.containerCanvas;
  const ctx = canvas.getContext('2d')!;
  const y0 = Math.floor(canvas.height * topRatio);
  const y1 = Math.floor(canvas.height * bottomRatio);
  const data = ctx.getImageData(0, y0, canvas.width, Math.max(1, y1 - y0)).data;
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Canvas limpo é transparente (alpha 0) — não confundir com texto preto.
    if (data[i + 3] > 0 && data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128) ink++;
  }
  return ink / (data.length / 4);
};

type Sample = { scrollTop: number; sync: number; micro: number; settled: number };

/**
 * Rola em passos e mede a tinta em três momentos:
 *  - `sync`:    assim que o handler de scroll retorna (o que o quadro veria);
 *  - `micro`:   depois da fila de microtasks;
 *  - `settled`: 600 ms depois, com tudo assíncrono resolvido.
 * Página pintada só de forma assíncrona aparece como sync ≈ 0 < settled.
 */
const run = async (opts: { optimized: boolean; steps?: number; band?: [number, number] }): Promise<Sample[]> => {
  const viewer: HTMLElement = editor.documentHelper.viewerContainer;
  editor.spellChecker.enableOptimizedSpellCheck = opts.optimized;
  // Estado do corretor zerado entre as rodadas — senão a 2ª rodada só mede cache.
  editor.spellChecker.resetSpellCheckState();
  viewer.scrollTop = 0;
  viewer.dispatchEvent(new Event('scroll'));
  await sleep(600);

  const [top, bottom] = opts.band ?? [0, 1];
  const steps = opts.steps ?? 8;
  const stepSize = Math.floor(viewer.clientHeight * 0.9);
  const samples: Sample[] = [];

  for (let i = 1; i <= steps; i++) {
    viewer.scrollTop = stepSize * i;
    viewer.dispatchEvent(new Event('scroll'));
    const sync = inkInBand(top, bottom);
    await microtasks();
    const micro = inkInBand(top, bottom);
    await sleep(600);
    const settled = inkInBand(top, bottom);
    samples.push({ scrollTop: viewer.scrollTop, sync, micro, settled });
  }
  return samples;
};

/**
 * Custo do repintar por quadro de rolagem. `msPerFrame` × velocidade da rolagem
 * = tamanho da faixa que fica sem pintura na borda de entrada.
 */
const cost = async (steps = 40) => {
  const viewer: HTMLElement = editor.documentHelper.viewerContainer;
  viewer.scrollTop = 0;
  viewer.dispatchEvent(new Event('scroll'));
  await sleep(400);

  const times: number[] = [];
  const stepSize = Math.max(60, Math.floor(viewer.clientHeight * 0.4));
  for (let i = 1; i <= steps; i++) {
    viewer.scrollTop = stepSize * i;
    const t0 = performance.now();
    viewer.dispatchEvent(new Event('scroll'));
    times.push(performance.now() - t0);
    await sleep(20);
  }
  times.sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  return {
    steps,
    mean: +(sum / times.length).toFixed(2),
    p50: +times[Math.floor(times.length * 0.5)].toFixed(2),
    p90: +times[Math.floor(times.length * 0.9)].toFixed(2),
    max: +times[times.length - 1].toFixed(2),
  };
};

/**
 * Acompanha, quadro a quadro, a distância entre onde a rolagem está e onde o
 * canvas foi pintado pela última vez. Em pixels: é exatamente a faixa que o
 * usuário vê sem conteúdo durante a rolagem rápida.
 */
const lagTracker = () => {
  const viewer: HTMLElement = editor.documentHelper.viewerContainer;
  const state = { on: true, frames: 0, samples: [] as number[] };
  const loop = () => {
    if (!state.on) return;
    const delta = Math.round(viewer.scrollTop - editor.viewer.containerTop);
    state.frames++;
    if (delta !== 0) state.samples.push(delta);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return {
    state,
    stop: () => {
      state.on = false;
      const abs = state.samples.map(Math.abs);
      return {
        frames: state.frames,
        lagFrames: abs.length,
        maxPx: abs.length ? Math.max(...abs) : 0,
        meanPx: abs.length ? Math.round(abs.reduce((a, b) => a + b, 0) / abs.length) : 0,
      };
    },
  };
};

// ── Detector de deformação de borda ────────────────────────────────────────
//
// A ideia: para uma dada posição de rolagem existe UM desenho correto — o que
// aparece quando tudo assenta. Fotografando o canvas quadro a quadro durante
// uma rolagem rápida com inversão de sentido e comparando com esse desenho
// correto, qualquer borda esticada/duplicada/deslocada vira diferença de
// pixels, com a linha exata em que ela acontece.

/**
 * Perfil por linha de uma FAIXA vertical do canvas: quantos pixels escuros há
 * em cada linha. A faixa cruza a borda esquerda da folha, então pega tanto as
 * bordas horizontais (topo/rodapé) quanto a lateral e o vão entre páginas.
 */
const rowProfile = (stripWidth = 120): Uint16Array => {
  const canvas: HTMLCanvasElement = editor.documentHelper.containerCanvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const page = editor.documentHelper.pages[0];
  const pageLeft = (page?.boundingRectangle?.x ?? 30) - editor.viewer.containerLeft;
  const x0 = Math.max(0, Math.floor((pageLeft - 10) * dpr));
  const w = Math.min(canvas.width - x0, Math.floor(stripWidth * dpr));
  const data = ctx.getImageData(x0, 0, w, canvas.height).data;
  const rows = new Uint16Array(canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    let n = 0;
    const base = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = base + x * 4;
      if (data[i + 3] > 0 && data[i] < 200 && data[i + 1] < 200 && data[i + 2] < 200) n++;
    }
    rows[y] = n;
  }
  return rows;
};

/**
 * Um "quadro" de rolagem: move e roda o handler do Syncfusion. O painel do
 * navegador roda oculto (requestAnimationFrame não dispara), por isso o evento
 * é despachado à mão — é o mesmo caminho que o navegador percorreria.
 */
const scrollFrame = (top: number) => {
  const viewer: HTMLElement = editor.documentHelper.viewerContainer;
  viewer.scrollTop = top;
  viewer.dispatchEvent(new Event('scroll'));
};

/** Posiciona a rolagem e deixa tudo assentar. */
const settleAt = async (top: number) => {
  scrollFrame(top);
  await sleep(320);
  scrollFrame(top);
  await sleep(60);
};

/**
 * Rolagem rápida com inversão brusca de sentido, quadro a quadro, comparando
 * cada quadro com o desenho assentado da MESMA posição. Diferença de pixels =
 * artefato visível.
 */
const reversalTest = async (opts?: { start?: number; velocity?: number; frames?: number }) => {
  const start = opts?.start ?? 6000;
  const velocity = opts?.velocity ?? 260; // px por quadro (rolagem bem rápida)
  const frames = opts?.frames ?? 12;

  const positions: number[] = [];
  let top = start;
  for (let i = 0; i < frames; i++) positions.push((top += velocity));
  for (let i = 0; i < frames; i++) positions.push((top -= velocity)); // inversão brusca

  // 1) Quadro a quadro, na cadência da rolagem (sem tempo de assentar).
  const live: { top: number; profile: Uint16Array }[] = [];
  await settleAt(start);
  for (const p of positions) {
    scrollFrame(p);
    live.push({ top: editor.documentHelper.viewerContainer.scrollTop, profile: rowProfile() });
    await sleep(16);
  }

  // 2) Mesmas posições, agora com tempo de sobra.
  const diffs: { top: number; rows: number; worstRow: number; worstDelta: number }[] = [];
  for (const frame of live) {
    await settleAt(frame.top);
    const truth = rowProfile();
    let rows = 0;
    let worstRow = -1;
    let worstDelta = 0;
    for (let y = 0; y < truth.length; y++) {
      const delta = Math.abs(truth[y] - frame.profile[y]);
      if (delta > 3) rows++;
      if (delta > worstDelta) { worstDelta = delta; worstRow = y; }
    }
    if (rows > 0) diffs.push({ top: frame.top, rows, worstRow, worstDelta });
  }

  return {
    framesTested: live.length,
    framesWithArtifact: diffs.length,
    worst: diffs.sort((a, b) => b.rows - a.rows).slice(0, 6),
  };
};

(window as any).__repro = {
  container, editor, load, run, cost, lagTracker, inkInBand, sleep, microtasks,
  rowProfile, settleAt, reversalTest, scrollFrame,
};
