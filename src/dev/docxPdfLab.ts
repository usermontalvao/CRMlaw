/**
 * Laboratório de conversão DOCX -> PDF (só desenvolvimento).
 *
 * Abre em `/docx-pdf-lab.html` com o servidor de desenvolvimento. Gera um .docx
 * de teste no navegador (A4 retrato com tabela e duas páginas + uma seção em
 * paisagem), converte por cada motor e mostra o PDF resultante.
 *
 * Existe porque o defeito que motivou a reescrita — página em branco no PDF — só
 * aparece no navegador de verdade: depende de como o `html2canvas` captura um
 * elemento fora da tela e de o Syncfusion terminar a paginação.
 *
 * Não entra no build de produção (`vite.config.ts` só empacota `index.html`).
 */
import {
  AlignmentType,
  Document,
  HeadingLevel,
  PageOrientation,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

import { pdfjs } from 'react-pdf';

import { docxToPdf, type DocxToPdfEngine } from '../utils/docxToPdf';
import { setLocalPdfWorker } from '../utils/pdfWorker';
import { syncfusionEngineUnavailableReason } from '../utils/syncfusionDocxToPdf';
import { resolveSyncfusionServiceUrl } from '../utils/syncfusionRuntime';

setLocalPdfWorker(pdfjs);

const logElement = document.getElementById('log') as HTMLDivElement;
const output = document.getElementById('out') as HTMLIFrameElement;
const fileInput = document.getElementById('file') as HTMLInputElement;
const buttons = {
  gen: document.getElementById('gen') as HTMLButtonElement,
  syncfusion: document.getElementById('conv-syncfusion') as HTMLButtonElement,
  preview: document.getElementById('conv-preview') as HTMLButtonElement,
  auto: document.getElementById('conv-auto') as HTMLButtonElement,
  download: document.getElementById('dl') as HTMLButtonElement,
};

let source: Blob | null = null;
let lastPdfUrl: string | null = null;

function log(message: string) {
  logElement.textContent = `${new Date().toLocaleTimeString('pt-BR')}  ${message}\n${logElement.textContent}`;
  // eslint-disable-next-line no-console
  console.log('[lab]', message);
}

function setReady(ready: boolean) {
  buttons.syncfusion.disabled = !ready;
  buttons.preview.disabled = !ready;
  buttons.auto.disabled = !ready;
}

/** Documento de teste com o que costuma quebrar: tabela, margem, paisagem. */
async function buildSampleDocx(): Promise<Blob> {
  const longText = 'A conversão precisa respeitar a margem, a quebra de linha e a quebra de página exatamente como o Word faz. '
    + 'Este parágrafo é longo de propósito para forçar várias linhas e revelar corte de palavra ou de linha no PDF. ';

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [0, 1, 2].map((row) => new TableRow({
      children: ['Coluna A', 'Coluna B', 'Coluna C'].map((column) => new TableCell({
        children: [new Paragraph(`${column} — linha ${row + 1}`)],
      })),
    })),
  });

  const document_ = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1701 }, // 2/2/2/3 cm
          },
        },
        children: [
          new Paragraph({ text: 'PETIÇÃO DE TESTE', heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
          new Paragraph({ children: [new TextRun({ text: longText.repeat(6) })], alignment: AlignmentType.JUSTIFIED }),
          table,
          new Paragraph({ children: [new TextRun({ text: longText.repeat(10) })], alignment: AlignmentType.JUSTIFIED }),
          new Paragraph({ children: [new TextRun({ text: 'Fim da primeira seção.', bold: true })] }),
        ],
      },
      {
        properties: {
          page: { size: { orientation: PageOrientation.LANDSCAPE } },
        },
        children: [
          new Paragraph({ text: 'Seção em paisagem', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ children: [new TextRun({ text: longText.repeat(4) })], alignment: AlignmentType.JUSTIFIED }),
        ],
      },
    ],
  });

  return Packer.toBlob(document_);
}

/**
 * Mede quanta tinta há em cada página do PDF.
 *
 * É a verificação que interessa: "página branca" não é uma impressão, é 0% de
 * pixel não branco. Também devolve o tamanho da página em mm, para confirmar que
 * A4/paisagem sobreviveram à conversão.
 */
async function inspectPdf(blob: Blob): Promise<string[]> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const report: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 0.5 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport } as never).promise;

    // Texto extraível: é a prova de que a camada pesquisável funciona. Um PDF
    // só de imagem devolve 0 caracteres aqui — o problema do "PDF sem OCR".
    const textContent = await page.getTextContent();
    const extracted = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();

    // ONDE o texto caiu, não só quanto: a camada pode existir e estar toda
    // empilhada num canto (foi o defeito de ler `line.x`/`line.y` do Syncfusion,
    // que o layout nunca preenche). O PDF fica com contagem de caracteres alta e
    // nada selecionável sobre o documento — igual a digitalizado sem OCR.
    const spread = (() => {
      const positions = textContent.items
        .filter((item): item is typeof item & { transform: number[]; width: number } => 'transform' in item)
        .map((item) => ({ x: item.transform[4], y: item.transform[5] }));
      if (!positions.length) return null;
      const xs = positions.map((position) => position.x);
      const ys = positions.map((position) => position.y);
      const ptToMm = (pt: number) => (pt * 25.4) / 72;
      return {
        count: positions.length,
        widthMm: ptToMm(Math.max(...xs) - Math.min(...xs)),
        heightMm: ptToMm(Math.max(...ys) - Math.min(...ys)),
      };
    })();

    const { data: pixels } = context.getImageData(0, 0, canvas.width, canvas.height);
    let inked = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      // Qualquer pixel visivelmente diferente de branco conta como tinta.
      if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) inked += 1;
    }
    const total = canvas.width * canvas.height;
    const percent = ((inked / total) * 100).toFixed(2);
    const [widthPt, heightPt] = [page.view[2] - page.view[0], page.view[3] - page.view[1]];
    const mm = (pt: number) => ((pt * 25.4) / 72).toFixed(0);
    report.push(
      `  pág ${pageNumber}: ${mm(widthPt)}×${mm(heightPt)} mm `
      + `(${widthPt > heightPt ? 'paisagem' : 'retrato'}) — tinta ${percent}%`
      + (inked === 0 ? '  <<< PÁGINA BRANCA' : '')
      + `; texto ${extracted.length} car.`
      + (extracted.length === 0 ? '  <<< SEM CAMADA DE TEXTO' : ` → "${extracted.slice(0, 70)}…"`)
      + (spread
        ? `\n         texto espalhado em ${spread.widthMm.toFixed(0)}×${spread.heightMm.toFixed(0)} mm`
          + ` (${spread.count} trechos)`
          // Um documento real ocupa dezenas de mm em cada eixo. Área minúscula
          // com muitos trechos = camada empilhada num ponto.
          + (spread.count > 3 && spread.widthMm < 10 && spread.heightMm < 10
            ? '  <<< TEXTO EMPILHADO NUM CANTO'
            : '')
        : ''),
    );
  }
  return report;
}

async function convert(engine: DocxToPdfEngine) {
  if (!source) { log('nenhum .docx carregado.'); return; }
  setReady(false);
  const started = performance.now();
  try {
    log(`convertendo com motor "${engine}"…`);
    const result = await docxToPdf(source, {
      engine,
      onProgress: ({ page, totalPages }) => log(`  página ${page}/${totalPages}`),
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    log(
      `OK — motor usado: ${result.engine}; páginas: ${result.pageCount}; `
      + `pesquisável: ${result.searchable ? 'SIM' : 'NÃO'}; `
      + `tamanho: ${(result.blob.size / 1024).toFixed(0)} KB; tempo: ${seconds}s`
      + (result.fallbackReason ? `; caiu para reserva porque: ${result.fallbackReason}` : ''),
    );
    for (const line of await inspectPdf(result.blob)) log(line);
    if (lastPdfUrl) URL.revokeObjectURL(lastPdfUrl);
    lastPdfUrl = URL.createObjectURL(result.blob);
    output.src = lastPdfUrl;
    buttons.download.disabled = false;
  } catch (error) {
    log(`FALHOU: ${error instanceof Error ? error.message : String(error)}`);
    // eslint-disable-next-line no-console
    console.error(error);
  } finally {
    setReady(true);
  }
}

buttons.gen.addEventListener('click', async () => {
  buttons.gen.disabled = true;
  try {
    source = await buildSampleDocx();
    log(`.docx de teste gerado (${(source.size / 1024).toFixed(0)} KB).`);
    setReady(true);
  } catch (error) {
    log(`falha ao gerar o .docx: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    buttons.gen.disabled = false;
  }
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  source = file;
  log(`arquivo carregado: ${file.name} (${(file.size / 1024).toFixed(0)} KB).`);
  setReady(true);
});

buttons.syncfusion.addEventListener('click', () => void convert('syncfusion'));
buttons.preview.addEventListener('click', () => void convert('preview'));
buttons.auto.addEventListener('click', () => void convert('auto'));
buttons.download.addEventListener('click', () => {
  if (!lastPdfUrl) return;
  const link = document.createElement('a');
  link.href = lastPdfUrl;
  link.download = 'conversao-teste.pdf';
  link.click();
});

log('laboratório pronto. Gere o .docx de teste ou escolha um arquivo.');
log(`servidor de documentos: ${resolveSyncfusionServiceUrl() || '(nenhum)'}`);
log(`motor Syncfusion: ${syncfusionEngineUnavailableReason() ?? 'disponível'}`);
