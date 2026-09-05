/**
 * Bancada da MONTAGEM do PDF assinado (só desenvolvimento).
 *
 * Abre em `/montagem-lab.html` com o servidor de desenvolvimento.
 *
 * POR QUE ELA EXISTE. A montagem do documento assinado vai sair do navegador e
 * passar para o servidor (ver `docs/assinatura-montagem-no-servidor.md`). O que
 * ela produz é PROVA: layout milimétrico, carimbo de assinatura em posição
 * exata, código de verificação, hash. "Compilou" não diz nada sobre isso, e
 * comparar as duas versões no olho também não — a diferença que importa é de
 * milímetros, e some numa tela de 14 polegadas.
 *
 * Sem esta bancada, portar a montagem é reescrever no escuro um documento que
 * vale como prova. É o mesmo remédio que o `docx-pdf-lab.html` deu para a
 * conversão, com o mesmo vocabulário: tinta por página, texto extraível,
 * medidas em milímetros.
 *
 * COMO SE USA. Dois PDFs: A é a referência (o que o navegador monta hoje), B é
 * o novo (o que o servidor montou). A bancada confere a estrutura, mede cada
 * página e mostra, em vermelho, exatamente onde os dois diferem.
 *
 * PRIMEIRO TESTE, sempre: o MESMO arquivo nos dois lados. Tem de dar "idêntica"
 * em todas as páginas. Se não der, o defeito está na bancada — e uma bancada
 * que acusa diferença onde não há é pior do que bancada nenhuma.
 *
 * Não entra no build de produção (`vite.config.ts` só empacota `index.html`).
 */
import { pdfjs } from 'react-pdf';

import { setLocalPdfWorker } from '../utils/pdfWorker';
import {
  medirTinta,
  compararPaginas,
  compararEstrutura,
  vereditoDaPagina,
  descreverDiferenca,
  ptParaMm,
  type PaginaRasterizada,
  type PaginaDoDocumento,
  type Veredito,
} from '../utils/comparacaoDePdf';

setLocalPdfWorker(pdfjs);

const log = document.getElementById('log') as HTMLDivElement;
const saida = document.getElementById('out') as HTMLDivElement;
const entradaA = document.getElementById('file-a') as HTMLInputElement;
const entradaB = document.getElementById('file-b') as HTMLInputElement;
const botao = document.getElementById('comparar') as HTMLButtonElement;
const campoEscala = document.getElementById('escala') as HTMLInputElement;

function escrever(linha: string): void {
  log.textContent = `${log.textContent}\n${linha}`;
  log.scrollTop = log.scrollHeight;
}

function limpar(): void {
  log.textContent = 'pronto.';
  saida.innerHTML = '';
}

interface PaginaLida extends PaginaRasterizada, PaginaDoDocumento {
  texto: string;
  numero: number;
}

/** Rasteriza cada página e já extrai o texto — as duas medidas que a bancada usa. */
async function lerPdf(arquivo: File, escala: number): Promise<PaginaLida[]> {
  const dados = new Uint8Array(await arquivo.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: dados }).promise;
  const paginas: PaginaLida[] = [];

  for (let numero = 1; numero <= pdf.numPages; numero++) {
    const page = await pdf.getPage(numero);
    const viewport = page.getViewport({ scale: escala });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    // Fundo branco explícito: sem isto o canvas nasce transparente e a medida de
    // tinta contaria a transparência como escuro, acusando "página cheia" numa
    // folha em branco.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport } as never).promise;

    const conteudo = await page.getTextContent();
    const texto = conteudo.items
      .map((item) => ('str' in item ? item.str : ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();

    const imagem = ctx.getImageData(0, 0, canvas.width, canvas.height);
    paginas.push({
      numero,
      pixels: imagem.data,
      largura: canvas.width,
      altura: canvas.height,
      larguraPt: page.view[2] - page.view[0],
      alturaPt: page.view[3] - page.view[1],
      texto,
    });
  }

  return paginas;
}

/**
 * A imagem da diferença: o documento apagado ao fundo, o que mudou em vermelho.
 *
 * Ver a caixa em número ajuda; ver o pixel aceso na página é o que faz alguém
 * reconhecer, em um segundo, que "aquilo ali é o carimbo da assinatura".
 */
function pintarDiferenca(a: PaginaLida, b: PaginaLida, limiar = 8): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = a.largura;
  canvas.height = a.altura;
  const ctx = canvas.getContext('2d')!;
  const imagem = ctx.createImageData(a.largura, a.altura);

  for (let p = 0; p < a.largura * a.altura; p++) {
    const i = p * 4;
    const desvio = Math.max(
      Math.abs(a.pixels[i] - b.pixels[i]),
      Math.abs(a.pixels[i + 1] - b.pixels[i + 1]),
      Math.abs(a.pixels[i + 2] - b.pixels[i + 2]),
    );
    if (desvio > limiar) {
      imagem.data[i] = 220; imagem.data[i + 1] = 38; imagem.data[i + 2] = 38; imagem.data[i + 3] = 255;
    } else {
      // O original clareado, só para dar contexto ao vermelho.
      const claro = 255 - Math.round((255 - a.pixels[i]) * 0.18);
      imagem.data[i] = claro; imagem.data[i + 1] = claro; imagem.data[i + 2] = claro; imagem.data[i + 3] = 255;
    }
  }

  ctx.putImageData(imagem, 0, 0);
  return canvas;
}

const CORES: Record<Veredito, string> = {
  IDENTICO: '#16a34a',
  DIFERENCA_TOLERAVEL: '#ca8a04',
  DIFERENTE: '#dc2626',
};

async function comparar(): Promise<void> {
  const a = entradaA.files?.[0];
  const b = entradaB.files?.[0];
  if (!a || !b) { escrever('escolha os dois PDFs.'); return; }

  limpar();
  botao.disabled = true;
  const escala = Math.min(Math.max(Number(campoEscala.value) || 1.5, 0.5), 3);

  try {
    escrever(`lendo A: ${a.name}`);
    const pa = await lerPdf(a, escala);
    escrever(`lendo B: ${b.name}`);
    const pb = await lerPdf(b, escala);

    // ── Estrutura primeiro ──
    // Página a mais, a menos, ou de tamanho trocado muda a que página cada campo
    // de assinatura pertence. Nenhuma média de pixels captura isso.
    const estrutura = compararEstrutura(pa, pb);
    escrever(`\nestrutura: A ${estrutura.paginasA} pág., B ${estrutura.paginasB} pág.`);
    if (!estrutura.ok) {
      escrever(`  <<< REPROVADO: ${estrutura.motivo}`);
      if (estrutura.paginasA !== estrutura.paginasB) return;
    }

    let piorVeredito: Veredito = 'IDENTICO';
    const mmPorPixel = ptParaMm(pa[0] ? pa[0].larguraPt / pa[0].largura : 1);

    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      const tintaA = medirTinta(pa[i]);
      const tintaB = medirTinta(pb[i]);
      const diferenca = compararPaginas(pa[i], pb[i]);
      const veredito = vereditoDaPagina(diferenca);
      if (veredito === 'DIFERENTE') piorVeredito = 'DIFERENTE';
      else if (veredito === 'DIFERENCA_TOLERAVEL' && piorVeredito === 'IDENTICO') piorVeredito = 'DIFERENCA_TOLERAVEL';

      escrever(
        `\npág ${i + 1}: ${veredito} — ${descreverDiferenca(diferenca, { mmPorPixel })}`
        + `\n   tinta A ${(tintaA.proporcao * 100).toFixed(2)}% / B ${(tintaB.proporcao * 100).toFixed(2)}%`
        + (tintaB.pintados === 0 ? '  <<< PÁGINA B EM BRANCO' : '')
        + `\n   texto A ${pa[i].texto.length} car. / B ${pb[i].texto.length} car.`
        + (pb[i].texto.length === 0 && pa[i].texto.length > 0 ? '  <<< B PERDEU A CAMADA DE TEXTO' : '')
        + (pa[i].texto !== pb[i].texto ? '\n   <<< o texto extraído mudou' : ''),
      );

      const bloco = document.createElement('div');
      bloco.className = 'pagina';
      const titulo = document.createElement('div');
      titulo.className = 'titulo';
      titulo.textContent = `página ${i + 1} — ${veredito}`;
      titulo.style.color = CORES[veredito];
      bloco.appendChild(titulo);
      if (!diferenca.tamanhoIncompativel && diferenca.pixelsDiferentes > 0) {
        bloco.appendChild(pintarDiferenca(pa[i], pb[i]));
      }
      saida.appendChild(bloco);
    }

    escrever(`\n═══ PARECER: ${piorVeredito} ═══`);
  } catch (erro) {
    escrever(`ERRO: ${erro instanceof Error ? erro.message : String(erro)}`);
  } finally {
    botao.disabled = false;
  }
}

botao.addEventListener('click', () => void comparar());
