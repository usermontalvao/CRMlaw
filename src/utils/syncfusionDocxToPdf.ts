/**
 * Conversão DOCX -> PDF pelo motor do Syncfusion (o mesmo do editor de
 * petições), fora da tela.
 *
 * Por que existe: o caminho antigo renderizava o documento com `docx-preview`
 * (um visualizador HTML aproximado) e tirava um "print" com `html2canvas`. O
 * layout do HTML não é o layout do Word — quebra de linha, tabela, margem,
 * cabeçalho/rodapé e quebra de página saem em lugares diferentes. É a causa da
 * formatação errada no PDF.
 *
 * O Syncfusion DocumentEditor faz a paginação de verdade (é o motor que já abre
 * esses mesmos .docx no editor do CRM). Aqui abrimos o documento numa instância
 * invisível, deixamos ELE decidir onde cada página termina e gravamos página por
 * página no PDF, no tamanho e na orientação que o documento declara.
 *
 * Dependências de ambiente: servidor de documentos (converte .docx em SFDT) e
 * licença do Syncfusion. Sem qualquer um dos dois, `docxToPdf` cai
 * automaticamente para o motor `docx-preview`.
 */
import jsPDF from 'jspdf';

import { pxToMm } from './docxPdfGeometry';
import { encodeRasterForPdf, imageToCanvas } from './pdfRasterEncode';
import {
  isEmptyRun,
  mapFontFamily,
  mergeAdjacentRuns,
  normalizeRunText,
  writeTextLayer,
  type TextLayerRun,
} from './pdfTextLayer';
import {
  buildSyncfusionServiceHeaders,
  hasSyncfusionLicense,
  motivoDaLicencaAusente,
  registerSyncfusionLicenseOnce,
  resolveSyncfusionServiceUrl,
} from './syncfusionRuntime';
import { extractPageWidgetTextRuns } from './syncfusionTextRuns';

/**
 * Nitidez do raster de cada página: 2 ≈ 192 dpi.
 *
 * Bem acima dos 150 dpi que os tribunais consideram legível, e com um terço do
 * peso de 288 dpi. Peso importa aqui: o PDF sai deste CRM para peticionamento
 * eletrônico, que impõe limite por arquivo.
 */
const DEFAULT_PRINT_DPR = 2;
/** Teto de espera pelo layout depois de abrir o documento. */
const LAYOUT_TIMEOUT_MS = 45_000;

export type SyncfusionDocxToPdfOptions = {
  printDevicePixelRatio?: number;
  onProgress?: (progress: { page: number; totalPages: number }) => void;
  signal?: { aborted: boolean };
  /** Token do usuário — só necessário quando o serviço é uma Edge Function. */
  accessToken?: string | null;
  /** Camada de texto invisível (PDF pesquisável). Ligada por padrão. */
  textLayer?: boolean;
};

export type SyncfusionDocxToPdfResult = {
  blob: Blob;
  pageCount: number;
  /** `true` quando o PDF saiu com texto pesquisável. */
  searchable: boolean;
  /** Quantos trechos de texto entraram na camada (diagnóstico). */
  textRuns: number;
  /** `true` se a extração de texto falhou (o PDF continua visualmente correto). */
  textLayerFailed: boolean;
};

/** Motivo pelo qual este motor não pode rodar (`null` = pode). */
export function syncfusionEngineUnavailableReason(): string | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 'Conversão pelo Syncfusion exige navegador.';
  }
  if (!hasSyncfusionLicense()) {
    // Sem licença o EJ2 desenha o aviso de avaliação sobre a página. O motivo
    // vem pronto porque "não configurada" e "configurada torta" pedem conserto
    // em lugares diferentes — e a segunda foi a que aconteceu de verdade.
    return motivoDaLicencaAusente();
  }
  if (!resolveSyncfusionServiceUrl()) {
    return 'Servidor de documentos do Syncfusion não configurado.';
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

/**
 * Converte o .docx em SFDT chamando o endpoint `Import` do servidor.
 *
 * Por que não usar `editor.open(file)`: internamente ele dispara essa mesma
 * chamada em "fire and forget" — a promise resolve ANTES da resposta e a falha
 * não é repassada. Como a instância nasce com um documento em branco já
 * carregado (uma página Carta), quem exportava em seguida gravava essa folha
 * vazia. Era o PDF branco, e de forma intermitente: dependia de a resposta
 * chegar antes ou depois da exportação.
 *
 * Fazendo a requisição aqui, o carregamento passa a ser determinístico e o erro
 * de rede/servidor chega com status de verdade.
 */
async function importDocxAsSfdt(
  docxBlob: Blob,
  serviceUrl: string,
  headers: Record<string, string>[],
): Promise<string> {
  const file = new File([docxBlob], 'documento.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const form = new FormData();
  form.append('files', file);

  const flatHeaders: Record<string, string> = {};
  for (const header of headers) Object.assign(flatHeaders, header);

  let response: Response;
  try {
    response = await fetch(`${serviceUrl}Import`, { method: 'POST', body: form, headers: flatHeaders });
  } catch (error) {
    throw new Error(
      'Não foi possível falar com o servidor de documentos (rede ou CORS). '
      + `Detalhe: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `O servidor de documentos recusou a conversão (HTTP ${response.status}`
      + `${response.statusText ? ` ${response.statusText}` : ''}).`,
    );
  }

  const sfdt = (await response.text()).trim();
  if (!sfdt) throw new Error('O servidor de documentos devolveu uma resposta vazia.');
  return sfdt;
}

/** Espera a condição virar verdadeira, com teto de tempo. */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`Tempo esgotado: ${label}.`);
    await sleep(120);
  }
}

/**
 * Espera a paginação TERMINAR, não começar.
 *
 * O Syncfusion pagina em etapas: logo depois do `open` já existe a primeira
 * página, e as demais aparecem em seguida. Ler o total nesse instante gerava um
 * PDF de uma única página com o documento inteiro cortado — foi exatamente o que
 * o laboratório mostrou. Aqui esperamos o total ficar estável por uma janela de
 * tempo antes de exportar.
 */
async function waitForStablePageCount(
  getCount: () => number,
  options: { timeoutMs: number; stableSamples?: number; intervalMs?: number },
): Promise<number> {
  const { timeoutMs, stableSamples = 8, intervalMs = 100 } = options;
  const deadline = Date.now() + timeoutMs;
  let previous = -1;
  let stable = 0;

  while (Date.now() < deadline) {
    const count = getCount();
    if (count > 0 && count === previous) {
      stable += 1;
      if (stable >= stableSamples) return count;
    } else {
      stable = 0;
    }
    previous = count;
    await sleep(intervalMs);
  }

  // Estourou o tempo mas já há páginas: melhor exportar o que existe do que
  // falhar — o motor de reserva não faria melhor.
  if (previous > 0) return previous;
  throw new Error('O documento não terminou de ser paginado.');
}

// ── Extração do texto posicionado (camada pesquisável) ──────────────────────
//
// Andamos na árvore JÁ PAGINADA do Syncfusion: os mesmos widgets que geraram a
// imagem da página. Por isso o texto cai exatamente sobre o desenho.
//
// A geometria (a conta que o renderizador do EJ2 faz para desenhar cada trecho)
// fica em `syncfusionTextRuns.ts`, coberta por testes. Aqui só convertemos px
// para mm, normalizamos o texto e juntamos os trechos vizinhos.

/** Texto posicionado de uma página, em milímetros. */
function extractPageTextRuns(page: unknown): TextLayerRun[] {
  const runs: TextLayerRun[] = [];

  for (const run of extractPageWidgetTextRuns(page)) {
    if (isEmptyRun(run.text)) continue;
    runs.push({
      text: normalizeRunText(run.text),
      xMm: pxToMm(run.xPx),
      baselineMm: pxToMm(run.baselinePx),
      widthMm: pxToMm(run.widthPx),
      fontSizePt: run.fontSizePt,
      bold: run.bold,
      italic: run.italic,
      family: mapFontFamily(run.fontFamily),
    });
  }

  return mergeAdjacentRuns(runs);
}

/** Garante que a `<img>` devolvida por `exportAsImage` já esteja decodificada. */
async function decodeImage(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) return;
  if (typeof image.decode === 'function') {
    try {
      await image.decode();
      return;
    } catch {
      // Alguns navegadores recusam decode() em imagem fora do documento.
    }
  }
  await new Promise<void>((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error('Falha ao ler a página exportada.')), { once: true });
    window.setTimeout(() => reject(new Error('Tempo esgotado ao ler a página exportada.')), 20_000);
  });
}

/**
 * Converte o .docx usando o motor do Syncfusion.
 * Lança quando o ambiente não permite (licença/servidor) ou o documento falha.
 */
export async function syncfusionDocxToPdf(
  docxBlob: Blob,
  options: SyncfusionDocxToPdfOptions = {},
): Promise<SyncfusionDocxToPdfResult> {
  const unavailable = syncfusionEngineUnavailableReason();
  if (unavailable) throw new Error(unavailable);

  const {
    printDevicePixelRatio = DEFAULT_PRINT_DPR,
    onProgress,
    signal,
    accessToken = null,
    textLayer = true,
  } = options;

  // Import dinâmico: o Nextcloud não deve carregar o EJ2 só por existir.
  const [{ DocumentEditor, Print, SfdtExport, WordExport }, { registerLicense }] = await Promise.all([
    import('@syncfusion/ej2-documenteditor'),
    import('@syncfusion/ej2-base'),
  ]);
  if (!registerSyncfusionLicenseOnce(registerLicense)) {
    throw new Error('Licença do Syncfusion não configurada.');
  }
  DocumentEditor.Inject(Print, SfdtExport, WordExport);

  const serviceUrl = resolveSyncfusionServiceUrl();

  // Instância invisível, porém REALMENTE renderizada: o Syncfusion pagina em
  // canvas e precisa de dimensões. `visibility/opacity/display:none` zeram o
  // layout e o documento sai em branco — daí o posicionamento fora da tela.
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = [
    'position:fixed',
    'left:-20000px',
    'top:0',
    'width:1000px',
    'height:800px',
    'z-index:-1',
    'pointer-events:none',
    'background:#ffffff',
  ].join(';');
  document.body.appendChild(host);

  const editor = new DocumentEditor({
    isReadOnly: true,
    enablePrint: true,
    enableSfdtExport: true,
    enableWordExport: true,
    // Sem seleção/cursor no raster.
    enableSelection: false,
    height: '800px',
    serviceUrl,
    headers: buildSyncfusionServiceHeaders(serviceUrl, accessToken) as object[],
    documentEditorSettings: { printDevicePixelRatio },
  } as never);

  try {
    editor.appendTo(host);

    // Importação em duas etapas explícitas: .docx -> SFDT pelo servidor, SFDT ->
    // editor no cliente. `open(sfdt)` é síncrono, então quando ele retorna o
    // documento REAL já substituiu o documento em branco inicial.
    const sfdt = await importDocxAsSfdt(
      docxBlob,
      serviceUrl,
      buildSyncfusionServiceHeaders(serviceUrl, accessToken),
    );
    editor.open(sfdt);

    const helper = () => (editor as unknown as {
      documentHelper?: { pages?: Array<{ boundingRectangle: { width: number; height: number } }> };
    }).documentHelper;

    await waitUntil(
      () => Boolean(helper()?.pages?.length),
      LAYOUT_TIMEOUT_MS,
      'o documento não foi paginado',
    );

    const totalPages = await waitForStablePageCount(
      () => helper()?.pages?.length ?? 0,
      { timeoutMs: LAYOUT_TIMEOUT_MS },
    );
    const pages = helper()!.pages!;
    if (!totalPages) throw new Error('O documento não gerou nenhuma página.');

    let textRunsWritten = 0;
    let textLayerFailed = false;

    // As medidas do Syncfusion são px CSS (96 dpi) — convertidas para mm.
    const firstWidthMm = pxToMm(pages[0].boundingRectangle.width);
    const firstHeightMm = pxToMm(pages[0].boundingRectangle.height);
    const pdf = new jsPDF({
      orientation: firstWidthMm > firstHeightMm ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [firstWidthMm, firstHeightMm],
      compress: true,
    });

    for (let index = 0; index < totalPages; index += 1) {
      if (signal?.aborted) throw new Error('Conversão cancelada.');
      onProgress?.({ page: index + 1, totalPages });

      const rect = pages[index].boundingRectangle;
      const widthMm = pxToMm(rect.width);
      const heightMm = pxToMm(rect.height);

      const image = editor.exportAsImage(index + 1, 'Png');
      if (!image) throw new Error(`Não foi possível exportar a página ${index + 1}.`);
      await decodeImage(image);
      const canvas = imageToCanvas(image);
      const { dataUrl, format } = encodeRasterForPdf(canvas);

      if (index > 0) {
        // Cada página com o SEU tamanho: um documento pode misturar retrato e
        // paisagem por seção, e o Word faz isso.
        pdf.addPage([widthMm, heightMm], widthMm > heightMm ? 'landscape' : 'portrait');
      }
      pdf.addImage(dataUrl, format, 0, 0, widthMm, heightMm, undefined, 'FAST');

      // Camada de texto invisível SOBRE a imagem: é o que faz o PDF ser
      // pesquisável e copiável. Extração falha não invalida a página.
      if (textLayer) {
        try {
          textRunsWritten += writeTextLayer(pdf, extractPageTextRuns(pages[index]));
        } catch {
          textLayerFailed = true;
        }
      }

      // Documento longo acumularia centenas de MB de canvas na aba.
      canvas.width = 0;
      canvas.height = 0;
    }

    return {
      blob: pdf.output('blob'),
      pageCount: totalPages,
      searchable: textRunsWritten > 0,
      textRuns: textRunsWritten,
      textLayerFailed,
    };
  } finally {
    try { editor.destroy(); } catch { /* instância já descartada */ }
    host.remove();
  }
}
