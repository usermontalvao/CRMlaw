/**
 * A BANCADA, sem navegador: compara dois PDFs montados e dá o parecer.
 *
 *   npm run montagem:comparar -- referencia.pdf novo.pdf
 *
 * POR QUE EM NODE, e não só na página `/montagem-lab.html`: aqui ela roda no
 * terminal, entra em CI e pode ser conferida por quem escreveu o código —
 * inclusive por um agente. A página existe para OLHAR a diferença em vermelho;
 * esta versão existe para PROVAR que não há diferença.
 *
 * A conta é a mesma dos dois lados: `src/utils/comparacaoDePdf.ts`, que é puro e
 * tem teste próprio. Aqui em volta fica só o que precisa de um renderizador —
 * o pdf.js desenhando cada página num canvas.
 *
 * Ver `docs/assinatura-montagem-no-servidor.md`.
 */
import { readFileSync } from 'node:fs';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';

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
} from '../src/utils/comparacaoDePdf.ts';

// O pdf.js espera estes três no ambiente. No navegador vêm de graça; aqui quem
// os fornece é o canvas nativo. Sem isto, o `page.render` falha em tempo de
// execução com erro que não diz o que está faltando.
const g = globalThis as unknown as Record<string, unknown>;
g.DOMMatrix ??= DOMMatrix;
g.ImageData ??= ImageData;
g.Path2D ??= Path2D;

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

interface PaginaLida extends PaginaRasterizada, PaginaDoDocumento {
  texto: string;
}

// As 14 fontes padrão do PDF (Helvetica, Times…) não vêm dentro do arquivo: o
// leitor tem de trazê-las. No navegador o pdf.js acha sozinho; aqui não, e sem
// isto ele avisa `standardFontDataUrl` e desenha com fonte de reserva — o que
// faria a bancada acusar diferença de texto que não existe no documento.
const FONTES_PADRAO = new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href;

async function lerPdf(caminho: string, escala: number): Promise<PaginaLida[]> {
  const dados = new Uint8Array(readFileSync(caminho));
  const pdf = await pdfjs.getDocument({
    data: dados, isEvalSupported: false, standardFontDataUrl: FONTES_PADRAO,
  }).promise;
  const paginas: PaginaLida[] = [];

  for (let numero = 1; numero <= pdf.numPages; numero++) {
    const page = await pdf.getPage(numero);
    const viewport = page.getViewport({ scale: escala });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    // Fundo branco explícito: o canvas nasce transparente, e transparência
    // contaria como escuro na medida de tinta — uma folha em branco apareceria
    // como página cheia.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as never, viewport } as never).promise;

    const conteudo = await page.getTextContent();
    const texto = conteudo.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();

    const imagem = ctx.getImageData(0, 0, canvas.width, canvas.height);
    paginas.push({
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
 * A BANCADA SE PROVA.
 *
 * Uma bancada que acusa diferença onde não há é pior do que bancada nenhuma:
 * ela transforma todo porte em caça a fantasma. Este autoteste monta três PDFs
 * conhecidos e exige os três pareceres certos — inclusive o mais importante, o
 * de que dois arquivos idênticos dão ZERO diferença.
 *
 *   npm run montagem:autoteste
 */
async function autoteste(): Promise<void> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const montar = async (opcoes: { carimbo: boolean; paginas: number }) => {
    const pdf = await PDFDocument.create();
    const fonte = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < opcoes.paginas; i++) {
      const p = pdf.addPage([595.28, 841.89]);
      p.drawText(`CONTRATO DE PRESTACAO DE SERVICOS - pagina ${i + 1}`, {
        x: 60, y: 780, size: 14, font: fonte, color: rgb(0.1, 0.1, 0.1),
      });
      for (let l = 0; l < 24; l++) {
        p.drawText('Clausula de teste com texto suficiente para ocupar a linha inteira da folha.', {
          x: 60, y: 740 - l * 18, size: 10, font: fonte, color: rgb(0.2, 0.2, 0.2),
        });
      }
      // O "carimbo de assinatura": pequeno e no rodapé — o caso que a bancada
      // tem de pegar mesmo ocupando pouquíssima área da folha.
      if (opcoes.carimbo && i === opcoes.paginas - 1) {
        p.drawRectangle({ x: 380, y: 90, width: 150, height: 46, color: rgb(0.05, 0.05, 0.05) });
      }
    }
    return await pdf.save();
  };

  const pasta = mkdtempSync(join(tmpdir(), 'montagem-bancada-'));
  const arquivo = (nome: string) => join(pasta, nome);
  writeFileSync(arquivo('a.pdf'), await montar({ carimbo: false, paginas: 2 }));
  writeFileSync(arquivo('b.pdf'), await montar({ carimbo: true, paginas: 2 }));
  writeFileSync(arquivo('c.pdf'), await montar({ carimbo: false, paginas: 3 }));

  const casos: Array<{ nome: string; a: string; b: string; espera: Veredito | 'ESTRUTURA' }> = [
    { nome: 'arquivos idênticos não podem acusar nada', a: 'a.pdf', b: 'a.pdf', espera: 'IDENTICO' },
    { nome: 'carimbo acrescentado no rodapé é pego', a: 'a.pdf', b: 'b.pdf', espera: 'DIFERENTE' },
    { nome: 'página a mais reprova pela estrutura', a: 'a.pdf', b: 'c.pdf', espera: 'ESTRUTURA' },
  ];

  let falhas = 0;
  for (const caso of casos) {
    const pa = await lerPdf(arquivo(caso.a), 1.5);
    const pb = await lerPdf(arquivo(caso.b), 1.5);
    const estrutura = compararEstrutura(pa, pb);

    let obtido: Veredito | 'ESTRUTURA';
    if (!estrutura.ok && estrutura.paginasA !== estrutura.paginasB) {
      obtido = 'ESTRUTURA';
    } else {
      obtido = 'IDENTICO';
      for (let i = 0; i < pa.length; i++) {
        const v = vereditoDaPagina(compararPaginas(pa[i], pb[i]));
        if (v === 'DIFERENTE') { obtido = 'DIFERENTE'; break; }
        if (v === 'DIFERENCA_TOLERAVEL') obtido = 'DIFERENCA_TOLERAVEL';
      }
    }

    const ok = obtido === caso.espera;
    if (!ok) falhas += 1;
    console.log(`${ok ? '✔' : '✖'} ${caso.nome} — esperado ${caso.espera}, obtido ${obtido}`);
  }

  console.log(falhas === 0 ? '\nbancada confiável.' : `\n${falhas} caso(s) falharam — NÃO confie nesta bancada.`);
  process.exit(falhas === 0 ? 0 : 1);
}

async function principal(): Promise<void> {
  const [arquivoA, arquivoB, escalaBruta] = process.argv.slice(2);

  if (arquivoA === '--autoteste') { await autoteste(); return; }

  if (!arquivoA || !arquivoB) {
    console.error('uso: npm run montagem:comparar -- <referencia.pdf> <novo.pdf> [escala]');
    console.error('     npm run montagem:autoteste');
    process.exit(2);
  }
  const escala = Math.min(Math.max(Number(escalaBruta) || 1.5, 0.5), 3);

  const a = await lerPdf(arquivoA, escala);
  const b = await lerPdf(arquivoB, escala);

  // ── Estrutura primeiro ──
  // Página a mais, a menos, ou de tamanho trocado muda a que página cada campo
  // de assinatura pertence. Nenhuma média de pixels captura isso, então isto
  // reprova sozinho, antes de comparar imagem.
  const estrutura = compararEstrutura(a, b);
  console.log(`estrutura: A ${estrutura.paginasA} pág., B ${estrutura.paginasB} pág.`);
  if (!estrutura.ok) {
    console.log(`  REPROVADO: ${estrutura.motivo}`);
    if (estrutura.paginasA !== estrutura.paginasB) {
      console.log('\n=== PARECER: DIFERENTE ===');
      process.exit(1);
    }
  }

  const mmPorPixel = ptParaMm(a[0] ? a[0].larguraPt / a[0].largura : 1);
  let pior: Veredito = 'IDENTICO';

  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const tintaA = medirTinta(a[i]);
    const tintaB = medirTinta(b[i]);
    const diferenca = compararPaginas(a[i], b[i]);
    const veredito = vereditoDaPagina(diferenca);
    if (veredito === 'DIFERENTE') pior = 'DIFERENTE';
    else if (veredito === 'DIFERENCA_TOLERAVEL' && pior === 'IDENTICO') pior = 'DIFERENCA_TOLERAVEL';

    console.log(
      `\npág ${i + 1}: ${veredito} — ${descreverDiferenca(diferenca, { mmPorPixel })}`
      + `\n   tinta A ${(tintaA.proporcao * 100).toFixed(2)}% / B ${(tintaB.proporcao * 100).toFixed(2)}%`
      + (tintaB.pintados === 0 ? '   <<< PÁGINA B EM BRANCO' : '')
      + `\n   texto A ${a[i].texto.length} car. / B ${b[i].texto.length} car.`
      + (b[i].texto.length === 0 && a[i].texto.length > 0 ? '   <<< B PERDEU A CAMADA DE TEXTO' : '')
      + (a[i].texto !== b[i].texto ? '\n   <<< o texto extraído mudou' : ''),
    );
  }

  console.log(`\n=== PARECER: ${pior} ===`);
  // Código de saída para o CI: só 'IDENTICO' passa limpo.
  process.exit(pior === 'DIFERENTE' ? 1 : 0);
}

await principal();
