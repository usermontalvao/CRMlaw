/**
 * Conversão DOCX -> PDF no navegador.
 *
 * Fonte única de verdade: o Nextcloud, o Cloud, os Documentos e qualquer outro
 * módulo chamam `docxToPdf` daqui em vez de duplicar o pipeline (eram três
 * cópias, cada uma com um defeito diferente).
 *
 * DOIS MOTORES, nesta ordem:
 *
 *  1. `syncfusion` (preferido, em `syncfusionDocxToPdf.ts`) — o mesmo motor que
 *     o editor de petições usa para abrir .docx. Faz a paginação DE VERDADE, do
 *     Word: quebra de linha, tabela, cabeçalho/rodapé e quebra de página caem
 *     onde o Word coloca.
 *  2. `preview` (reserva, aqui neste arquivo) — `docx-preview` + `html2canvas`.
 *     O layout é o de um visualizador HTML, uma APROXIMAÇÃO do Word. Só entra
 *     quando o motor 1 não está disponível (sem licença/servidor) ou falha.
 *
 * O motor de reserva também foi corrigido. O que a versão antiga fazia de errado:
 *  - forçava `width: 794px` em toda `<section>`, jogando fora o tamanho real da
 *    folha: Carta, Ofício, paisagem e margens personalizadas saíam fora de
 *    escala;
 *  - abria o PDF sempre como A4 retrato;
 *  - fatiava a imagem em blocos de 297 mm, então 1 mm de arredondamento de
 *    layout virava uma página quase branca a cada folha;
 *  - rasterizava em escala 1,5 com JPEG 0,88, deixando o texto borrado;
 *  - esperava 250 ms fixos em vez de aguardar fontes e imagens.
 *
 * A matemática (tamanho de folha, escala e paginação) fica em
 * `docxPdfGeometry.ts`, coberta por testes.
 */
import { renderAsync } from 'docx-preview';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

import {
  CSS_PX_PER_INCH,
  planPagePlacement,
  pxToMm,
  resolvePageGeometry,
  resolveRasterScale,
  type PageGeometry,
} from './docxPdfGeometry';
import { encodeRasterForPdf } from './pdfRasterEncode';
import {
  isEmptyRun,
  mapFontFamily,
  mergeAdjacentRuns,
  normalizeRunText,
  writeTextLayer,
  type TextLayerRun,
} from './pdfTextLayer';
import { syncfusionDocxToPdf, syncfusionEngineUnavailableReason } from './syncfusionDocxToPdf';
import {
  acharMarcadores,
  campoEmPorcentagem,
  mascaraPara,
} from './marcadoresDeAssinatura';

/** Classe do contêiner invisível de renderização (usada também no CSS injetado). */
const RENDER_CLASS = 'docx-to-pdf-render';

/**
 * Classe base do docx-preview. ATENÇÃO à semântica, que já causou estrago aqui:
 * a opção `className` nomeia CADA PÁGINA (`<section class="docx">`), e o
 * contêiner externo recebe `${className}-wrapper`. O código antigo passava
 * `className: 'docx-wrapper'`, então as páginas ficavam com a classe
 * `docx-wrapper` e o wrapper com `docx-wrapper-wrapper`; procurar
 * `.docx-wrapper` devolvia a PRIMEIRA PÁGINA e o código tratava os `<article>`
 * de dentro dela como se fossem as folhas do documento.
 */
const DOCX_CLASS = 'docx';
const DOCX_WRAPPER_CLASS = `${DOCX_CLASS}-wrapper`;

/** Motor de conversão. `auto` prefere o Syncfusion e cai para o `preview`. */
export type DocxToPdfEngine = 'auto' | 'syncfusion' | 'preview';

export type DocxToPdfOptions = {
  engine?: DocxToPdfEngine;
  /**
   * Escala de rasterização desejada. 2.5 (~240 dpi) deixa o texto nítido sem
   * explodir o tamanho do arquivo. É reduzida automaticamente em folhas muito
   * grandes para não estourar o limite de canvas do navegador.
   */
  scale?: number;
  /** Progresso por folha — útil para mostrar "folha 3 de 12". */
  onProgress?: (progress: { page: number; totalPages: number }) => void;
  /** Cancelamento cooperativo entre folhas. */
  signal?: { aborted: boolean };
  /** Token do usuário — só necessário quando o serviço é uma Edge Function. */
  accessToken?: string | null;
  /** Camada de texto invisível (PDF pesquisável). Ligada por padrão. */
  textLayer?: boolean;
  /**
   * Detectar `[[ASSINATURA]]` e OCULTAR o marcador antes de rasterizar.
   *
   * Desligado por padrão: só o congelamento de envelope precisa disso. Ligado,
   * `marcadores` volta preenchido no resultado e o texto do marcador não é
   * impresso na folha.
   *
   * Só vale no motor `preview` — é ele que tem DOM para medir. Com o
   * Syncfusion não há onde procurar, e `marcadores` volta vazio.
   */
  detectarMarcadores?: boolean;
};

/** Um `[[ASSINATURA]]` achado na folha, já em coordenadas de campo. */
export type MarcadorDetectado = {
  /** `[[ASSINATURA]]` é 1; `[[ASSINATURA_2]]` é 2. */
  indiceDoAssinante: number;
  /** Folha em que apareceu, contando de 1. */
  pagina: number;
  x_percent: number;
  y_percent: number;
  w_percent: number;
  h_percent: number;
};

export type DocxToPdfResult = {
  blob: Blob;
  /** Páginas geradas no PDF (pode passar do nº de folhas se algo transbordou). */
  pageCount: number;
  /** Folhas que o motor produziu. */
  sheetCount: number;
  /** Motor que realmente gerou o arquivo. */
  engine: 'syncfusion' | 'preview';
  /** `true` quando o PDF tem camada de texto (pesquisável/copiável). */
  searchable: boolean;
  /** Por que o motor preferido não foi usado (quando houve troca). */
  fallbackReason?: string;
  /**
   * Marcadores `[[ASSINATURA]]` achados, quando `detectarMarcadores` foi ligado.
   * Vazio quando a opção está desligada OU quando o motor foi o Syncfusion.
   */
  marcadores: MarcadorDetectado[];
};

/** CSS mínimo: neutraliza a moldura de visualização do docx-preview sem tocar
 *  na geometria da folha (largura/altura/margens vêm do documento). */
function renderStyleSheet(): string {
  return `
    .${RENDER_CLASS} .${DOCX_WRAPPER_CLASS} {
      background: transparent !important;
      padding: 0 !important;
      margin: 0 !important;
      display: block !important;
      width: auto !important;
      max-width: none !important;
    }
    .${RENDER_CLASS} .${DOCX_WRAPPER_CLASS} > section {
      margin: 0 !important;
      background: #ffffff !important;
      box-shadow: none !important;
      border: 0 !important;
      border-radius: 0 !important;
      /* Sem transform/filter: o html2canvas rasteriza o elemento como está. */
    }
  `;
}

/** Espera fontes e imagens: substitui o `setTimeout` fixo que rasterizava o
 *  documento antes de a fonte certa estar aplicada (texto saía deslocado). */
async function waitForRenderedAssets(container: HTMLElement): Promise<void> {
  const pending: Promise<unknown>[] = [];

  if (typeof document !== 'undefined' && 'fonts' in document) {
    // `document.fonts.ready` resolve quando o layout de fontes estabiliza.
    pending.push(Promise.resolve((document as Document & { fonts: FontFaceSet }).fonts.ready));
  }

  const images = Array.from(container.querySelectorAll('img'));
  for (const image of images) {
    if (image.complete && image.naturalWidth > 0) continue;
    pending.push(new Promise<void>((resolve) => {
      const done = () => resolve();
      image.addEventListener('load', done, { once: true });
      image.addEventListener('error', done, { once: true });
    }));
  }

  // Nunca travar a conversão por um recurso que não carrega.
  const guard = new Promise<void>((resolve) => { window.setTimeout(resolve, 4000); });
  await Promise.race([Promise.all(pending), guard]);

  // Dois frames para o navegador terminar o layout depois das fontes.
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

/**
 * As folhas renderizadas, na ordem do documento.
 *
 * Cada folha é um `<section class="docx">` filho direto do wrapper. Um
 * `<article>` é o CONTEÚDO de dentro da folha, nunca uma folha — tratá-lo como
 * folha fazia a conversão medir a página errada.
 */
function collectSheets(container: HTMLElement): HTMLElement[] {
  const wrapper = container.querySelector(`.${DOCX_WRAPPER_CLASS}`) as HTMLElement | null;
  const scope = wrapper ?? container;
  const sheets = Array.from(scope.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node.tagName.toLowerCase() === 'section',
  );
  if (sheets.length) return sheets;
  // Sem wrapper (inWrapper desligado) as seções ficam no próprio contêiner.
  const loose = Array.from(container.querySelectorAll(`section.${DOCX_CLASS}`)) as HTMLElement[];
  return loose.length ? loose : [];
}

/**
 * Texto posicionado de uma folha renderizada em HTML.
 *
 * Mesmo propósito da camada de texto do motor Syncfusion: o PDF não pode sair
 * "cego" (sem pesquisa nem seleção). Aqui as posições vêm do próprio navegador —
 * `Range.getClientRects()` devolve o retângulo de cada pedaço de texto exatamente
 * onde ele foi desenhado, o que é o que o `html2canvas` fotografou.
 *
 * Coordenadas são relativas ao canto superior esquerdo da folha, em mm.
 */
function extractSheetTextRuns(sheet: HTMLElement): TextLayerRun[] {
  const runs: TextLayerRun[] = [];
  const sheetRect = sheet.getBoundingClientRect();
  const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (isEmptyRun(text)) continue;
    const parent = node.parentElement;
    if (!parent) continue;

    const style = window.getComputedStyle(parent);
    // Texto invisível na tela não deve entrar na camada: ficaria pesquisável
    // algo que o leitor não vê.
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;

    const range = document.createRange();
    range.selectNodeContents(node);
    // Uma linha visual por retângulo: texto que quebrou em várias linhas gera
    // vários retângulos, e cada um recebe sua fatia do conteúdo.
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    range.detach();
    if (!rects.length) continue;

    const fontSizePx = Number.parseFloat(style.fontSize) || 16;
    const fontSizePt = (fontSizePx * 72) / CSS_PX_PER_INCH;
    const weight = Number.parseInt(style.fontWeight, 10);
    const bold = style.fontWeight === 'bold' || (Number.isFinite(weight) && weight >= 600);
    const italic = style.fontStyle === 'italic' || style.fontStyle === 'oblique';
    const family = mapFontFamily(style.fontFamily);

    // Uma única caixa: o texto inteiro cabe nela.
    if (rects.length === 1) {
      const rect = rects[0];
      runs.push({
        text: normalizeRunText(text),
        xMm: pxToMm(rect.left - sheetRect.left),
        // Aproximação da linha de base: ~82% da altura da caixa a partir do topo.
        baselineMm: pxToMm(rect.top - sheetRect.top + rect.height * 0.82),
        widthMm: pxToMm(rect.width),
        fontSizePt, bold, italic, family,
      });
      continue;
    }

    // Várias caixas: reparte o texto proporcionalmente à largura de cada linha.
    // Não é exato caractere a caractere, mas mantém as palavras na linha certa —
    // o que a busca e a seleção precisam.
    const totalWidth = rects.reduce((sum, rect) => sum + rect.width, 0);
    const cleaned = normalizeRunText(text);
    let consumed = 0;
    rects.forEach((rect, rectIndex) => {
      const share = totalWidth > 0 ? rect.width / totalWidth : 1 / rects.length;
      const take = rectIndex === rects.length - 1
        ? cleaned.length - consumed
        : Math.max(1, Math.round(cleaned.length * share));
      const slice = cleaned.slice(consumed, consumed + take);
      consumed += take;
      if (!slice || isEmptyRun(slice)) return;
      runs.push({
        text: slice,
        xMm: pxToMm(rect.left - sheetRect.left),
        baselineMm: pxToMm(rect.top - sheetRect.top + rect.height * 0.82),
        widthMm: pxToMm(rect.width),
        fontSizePt, bold, italic, family,
      });
    });
  }

  return mergeAdjacentRuns(runs);
}

/** Tamanho real da folha: o que o documento declarou, com a medida como reserva. */
function sheetGeometry(sheet: HTMLElement): PageGeometry {
  const inline = sheet.style;
  const computed = typeof window !== 'undefined' ? window.getComputedStyle(sheet) : null;
  return resolvePageGeometry({
    declaredWidth: inline.width || computed?.width || null,
    declaredHeight: inline.minHeight || computed?.minHeight || null,
    measuredWidthPx: sheet.scrollWidth || sheet.offsetWidth || null,
    measuredHeightPx: sheet.scrollHeight || sheet.offsetHeight || null,
  });
}

/**
 * Converte um `.docx` em PDF pelo motor de visualização HTML (`docx-preview`).
 *
 * É o motor de reserva: preserva tamanho de folha, orientação e margens, mas o
 * layout é o do visualizador HTML, não o do Word. Prefira `docxToPdf`.
 */
/**
 * Acha os `[[ASSINATURA]]` de UMA folha renderizada e oculta o texto deles.
 *
 * Esta é a metade que precisa de navegador; a regra está em
 * `marcadoresDeAssinatura.ts`, testada à parte.
 *
 * DUAS PASSADAS, de propósito. Medir e mascarar no mesmo laço funcionaria hoje
 * (a máscara tem o mesmo comprimento, então os offsets não andam), mas amarra
 * a corretude a esse detalhe. Medindo tudo antes, trocar a máscara um dia não
 * quebra a medição em silêncio.
 */
function detectarMarcadoresNaFolha(
  folha: HTMLElement,
  pagina: number,
): MarcadorDetectado[] {
  const base = folha.getBoundingClientRect();
  if (!(base.width > 0) || !(base.height > 0)) return [];

  // Texto contínuo: o Word parte `[[ASSINATURA]]` em vários `runs`, e quem
  // procura nó a nó não acha nada num documento perfeitamente válido.
  const nos: Text[] = [];
  const inicios: number[] = [];
  let texto = '';
  const walker = document.createTreeWalker(folha, NodeFilter.SHOW_TEXT, null);
  let no: Text | null;
  while ((no = walker.nextNode() as Text | null)) {
    nos.push(no);
    inicios.push(texto.length);
    texto += no.textContent ?? '';
  }

  const marcadores = acharMarcadores(texto);
  if (marcadores.length === 0) return [];

  const localizar = (abs: number): { no: Text; offset: number } | null => {
    for (let i = nos.length - 1; i >= 0; i -= 1) {
      const inicio = inicios[i];
      const tam = (nos[i].textContent ?? '').length;
      if (abs >= inicio && abs <= inicio + tam) {
        return { no: nos[i], offset: Math.max(0, Math.min(tam, abs - inicio)) };
      }
    }
    return null;
  };

  // ── Passada 1: medir ──
  const achados: MarcadorDetectado[] = [];
  for (const m of marcadores) {
    const ini = localizar(m.inicio);
    const fim = localizar(m.fim);
    if (!ini || !fim) continue;

    let rect: DOMRect | null = null;
    try {
      const range = document.createRange();
      range.setStart(ini.no, ini.offset);
      range.setEnd(fim.no, fim.offset);
      rect = range.getBoundingClientRect();
      range.detach?.();
    } catch {
      rect = null;
    }

    // Sem retângulo do trecho exato, vale o do elemento que o contém: uma
    // posição aproximada na linha certa é muito melhor do que o fallback de
    // rodapé, que joga a rubrica para o fim da página.
    const alvo = rect ?? ini.no.parentElement?.getBoundingClientRect() ?? null;
    if (!alvo) continue;

    const campo = campoEmPorcentagem(
      {
        esquerda: alvo.left - base.left,
        topo: alvo.top - base.top,
        largura: alvo.width,
        altura: alvo.height,
      },
      { largura: base.width, altura: base.height },
    );
    if (!campo) continue;

    achados.push({ indiceDoAssinante: m.indiceDoAssinante, pagina, ...campo });
  }

  // ── Passada 2: ocultar ──
  // Sem isto o texto `[[ASSINATURA]]` sai impresso no PDF congelado, e a
  // assinatura acaba desenhada por cima dele.
  for (const m of marcadores) {
    const mascara = mascaraPara(m.bruto);
    for (let i = 0; i < nos.length; i += 1) {
      const inicio = inicios[i];
      const conteudo = nos[i].textContent ?? '';
      const fim = inicio + conteudo.length;
      const de = Math.max(m.inicio, inicio);
      const ate = Math.min(m.fim, fim);
      if (ate <= de) continue;
      nos[i].textContent =
        conteudo.slice(0, de - inicio)
        + mascara.slice(de - m.inicio, ate - m.inicio)
        + conteudo.slice(ate - inicio);
    }
  }

  return achados;
}

export async function previewDocxToPdf(
  docxBlob: Blob,
  options: DocxToPdfOptions = {},
): Promise<Omit<DocxToPdfResult, 'engine' | 'fallbackReason'>> {
  const {
    scale: desiredScale = 2.5, onProgress, signal,
    textLayer = true, detectarMarcadores = false,
  } = options;

  const container = document.createElement('div');
  container.className = RENDER_CLASS;
  // Fora da viewport, mas renderizado de verdade: o html2canvas precisa dos
  // estilos computados, e `opacity/visibility` no ancestral apagariam a folha.
  container.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    'z-index:-1',
    'pointer-events:none',
    'background:#ffffff',
    // Sem largura fixa: a folha define a própria largura a partir do documento.
    'width:max-content',
  ].join(';');

  const style = document.createElement('style');
  style.textContent = renderStyleSheet();
  document.head.appendChild(style);
  document.body.appendChild(container);

  try {
    await renderAsync(docxBlob, container, undefined, {
      className: DOCX_CLASS,
      inWrapper: true,
      // Respeitar a geometria do documento é o ponto desta conversão.
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      useBase64URL: true,
    });

    await waitForRenderedAssets(container);

    const sheets = collectSheets(container);
    if (!sheets.length) throw new Error('O documento Word não produziu nenhuma página.');

    const first = sheetGeometry(sheets[0]);
    const pdf = new jsPDF({
      orientation: first.orientation,
      unit: 'mm',
      format: [first.widthMm, first.heightMm],
      compress: true,
    });
    let pageCount = 0;
    let textRunsWritten = 0;
    const marcadores: MarcadorDetectado[] = [];

    for (let index = 0; index < sheets.length; index += 1) {
      if (signal?.aborted) throw new Error('Conversão cancelada.');
      onProgress?.({ page: index + 1, totalPages: sheets.length });

      const sheet = sheets[index];
      const geometry = index === 0 ? first : sheetGeometry(sheet);
      const widthPx = sheet.scrollWidth || sheet.offsetWidth || 794;
      const heightPx = sheet.scrollHeight || sheet.offsetHeight || 1123;
      const rasterScale = resolveRasterScale({ widthPx, heightPx, desiredScale });

      // ANTES de rasterizar E antes de medir a camada de texto: o marcador tem
      // de sumir das duas coisas. Se saísse só da imagem, o PDF continuaria
      // com "[[ASSINATURA]]" localizável pelo Ctrl+F — num documento que vale
      // como prova, isso é conteúdo que ninguém escreveu.
      if (detectarMarcadores) {
        try {
          marcadores.push(...detectarMarcadoresNaFolha(sheet, index + 1));
        } catch (error) {
          // Detectar é melhoria; falhar aqui não pode custar a conversão, que é
          // o que o usuário pediu. Sem marcador, o fluxo cai no caminho de hoje.
          console.warn('[docxToPdf] falha ao detectar marcadores na folha', index + 1, error);
        }
      }

      const canvas = await html2canvas(sheet, {
        scale: rasterScale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        // Larguras explícitas: sem elas o html2canvas usa a viewport e corta a
        // folha em telas estreitas (celular) ou quando a janela é redimensionada.
        width: widthPx,
        height: heightPx,
        windowWidth: widthPx,
        windowHeight: heightPx,
        imageTimeout: 0,
      });

      const { dataUrl, format } = encodeRasterForPdf(canvas);
      // Texto da folha medido ANTES de mexer no PDF: precisa dos retângulos que
      // o navegador calculou para o elemento ainda no documento.
      const runs = textLayer ? (() => {
        try { return extractSheetTextRuns(sheet); } catch { return []; }
      })() : [];
      const plan = planPagePlacement({
        pageWidthMm: geometry.widthMm,
        pageHeightMm: geometry.heightMm,
        canvasWidthPx: canvas.width,
        canvasHeightPx: canvas.height,
      });

      for (const slice of plan.slices) {
        if (pageCount > 0) {
          // Cada folha entra com o SEU tamanho: um documento pode misturar
          // retrato e paisagem, e o Word faz exatamente isso por seção.
          pdf.addPage([geometry.widthMm, geometry.heightMm], geometry.orientation);
        }
        pdf.addImage(
          dataUrl,
          format,
          0,
          slice.offsetMm,
          plan.imageWidthMm,
          plan.imageHeightMm,
          undefined,
          'FAST',
        );
        // A camada de texto acompanha o deslocamento da fatia, senão em folha
        // que transbordou o texto ficaria na página errada.
        if (runs.length) {
          textRunsWritten += writeTextLayer(pdf, slice.offsetMm === 0 ? runs : runs.map((run) => ({
            ...run,
            baselineMm: run.baselineMm + slice.offsetMm,
          })));
        }
        pageCount += 1;
      }

      // Libera a memória do canvas antes da próxima folha (documentos longos
      // acumulavam centenas de MB e travavam a aba).
      canvas.width = 0;
      canvas.height = 0;
    }

    return {
      blob: pdf.output('blob'),
      pageCount,
      sheetCount: sheets.length,
      searchable: textRunsWritten > 0,
      marcadores,
    };
  } finally {
    style.remove();
    container.remove();
  }
}

/**
 * Converte um `.docx` em PDF.
 *
 * Usa o motor do Syncfusion (layout real do Word — o mesmo do editor de
 * petições) e, se ele não estiver disponível ou falhar, cai automaticamente para
 * o motor de visualização HTML. O resultado informa qual motor foi usado e, na
 * troca, o motivo — quem chama pode avisar o usuário de que a fidelidade caiu.
 */
export async function docxToPdf(
  docxBlob: Blob,
  options: DocxToPdfOptions = {},
): Promise<DocxToPdfResult> {
  const engine = options.engine ?? 'auto';

  if (engine !== 'preview') {
    const unavailable = syncfusionEngineUnavailableReason();
    if (unavailable && engine === 'syncfusion') throw new Error(unavailable);
    if (!unavailable) {
      try {
        const { blob, pageCount, searchable } = await syncfusionDocxToPdf(docxBlob, {
          onProgress: options.onProgress,
          signal: options.signal,
          accessToken: options.accessToken,
          textLayer: options.textLayer,
        });
        // O Syncfusion não renderiza em DOM, então não há onde procurar marcador.
        // Quem precisa deles tem de pedir `engine: 'preview'` — e o congelamento
        // já pede, pela armadilha da geometria (ver o diário da migração).
        return { blob, pageCount, sheetCount: pageCount, engine: 'syncfusion', searchable, marcadores: [] };
      } catch (error) {
        if (engine === 'syncfusion') throw error;
        // Cancelamento não é motivo para tentar outro motor.
        if (options.signal?.aborted) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        const result = await previewDocxToPdf(docxBlob, options);
        return { ...result, engine: 'preview', fallbackReason: reason };
      }
    }
    if (unavailable) {
      const result = await previewDocxToPdf(docxBlob, options);
      return { ...result, engine: 'preview', fallbackReason: unavailable };
    }
  }

  const result = await previewDocxToPdf(docxBlob, options);
  return { ...result, engine: 'preview' };
}

/** Atalho para quem só quer o Blob (assinatura da função antiga). */
export async function docxBlobToPdf(docxBlob: Blob, options?: DocxToPdfOptions): Promise<Blob> {
  const { blob } = await docxToPdf(docxBlob, options);
  return blob;
}
