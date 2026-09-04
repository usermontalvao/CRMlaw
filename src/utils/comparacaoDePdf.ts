/**
 * A BANCADA: o mesmo envelope montado de dois jeitos, medido em pixels.
 *
 * A montagem do PDF assinado vai sair do navegador e passar para o servidor. O
 * documento que ela produz é PROVA: layout milimétrico, hash, código de
 * verificação, carimbo de assinatura em posição exata. "Compilou" não diz nada
 * sobre isso, e olhar as duas versões lado a lado no olho também não — a
 * diferença que importa costuma ser de milímetros.
 *
 * Este módulo responde três perguntas, nesta ordem de importância:
 *
 *   1. **Mudou a estrutura?** Número de páginas ou tamanho de página diferentes
 *      são reprovação imediata: é a classe de defeito que faz um campo marcado
 *      na página 3 sair na 4, e nenhuma média de pixels captura isso.
 *   2. **Quanto mudou?** A proporção de pixels diferentes.
 *   3. **ONDE mudou?** A caixa que envolve a diferença. É o que separa "o
 *      carimbo de assinatura saiu 2 mm mais para a esquerda" de "o documento
 *      inteiro deslizou" — os dois dão a mesma porcentagem e têm gravidades
 *      opostas.
 *
 * O projeto já resolveu um problema igual no `docx-pdf-lab.html`, e o
 * vocabulário aqui é o mesmo de lá: tinta por página, texto extraível, medidas
 * em milímetros.
 *
 * Sem imports, de propósito: `npm test` roda por ts-node e quebra com import
 * relativo sem extensão em qualquer ponto da cadeia.
 */

/** Uma página já rasterizada, em RGBA (4 bytes por pixel). */
export interface PaginaRasterizada {
  pixels: ArrayLike<number>;
  largura: number;
  altura: number;
}

export interface Medida {
  pintados: number;
  total: number;
  /** 0..1 */
  proporcao: number;
}

/**
 * Quanta tinta há na página.
 *
 * O limiar de 245 é o mesmo do laboratório de conversão: qualquer pixel
 * visivelmente diferente de branco conta. Serve para o defeito mais bruto que
 * existe aqui — a página que sai em branco —, que nenhuma comparação relativa
 * pega quando os DOIS lados saem brancos.
 */
export function medirTinta(pagina: PaginaRasterizada): Medida {
  const { pixels, largura, altura } = pagina;
  const total = Math.max(0, largura * altura);
  let pintados = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) pintados += 1;
  }
  return { pintados, total, proporcao: total > 0 ? pintados / total : 0 };
}

export interface CaixaDaDiferenca {
  x0: number; y0: number; x1: number; y1: number;
  larguraPx: number; alturaPx: number;
}

export interface DiferencaDePagina {
  /** `true` quando as duas páginas nem têm o mesmo tamanho — comparar pixel a pixel perde o sentido. */
  tamanhoIncompativel: boolean;
  pixelsComparados: number;
  pixelsDiferentes: number;
  /** 0..1 */
  proporcao: number;
  /** O maior desvio encontrado em um canal (0..255). */
  maiorDesvio: number;
  /** Onde a diferença mora. `null` quando não houve diferença. */
  caixa: CaixaDaDiferenca | null;
}

export interface OpcoesDeComparacao {
  /**
   * Quanto um canal pode variar sem contar como diferença (0..255).
   *
   * Não é frouxidão: dois renderizadores desenhando exatamente a mesma coisa
   * divergem por antialiasing na borda de cada letra. Com limiar 0, um PDF
   * idêntico acusaria diferença em toda linha de texto e a bancada viraria
   * ruído — que é o mesmo que não ter bancada.
   */
  limiar?: number;
}

/**
 * Compara duas páginas rasterizadas no MESMO tamanho.
 *
 * Tamanhos diferentes não são comparados por interpolação de propósito:
 * redimensionar para "poder comparar" esconde justamente o defeito de página
 * com geometria trocada, que é dos piores aqui.
 */
export function compararPaginas(
  a: PaginaRasterizada,
  b: PaginaRasterizada,
  opcoes: OpcoesDeComparacao = {},
): DiferencaDePagina {
  const limiar = opcoes.limiar ?? 8;

  if (a.largura !== b.largura || a.altura !== b.altura) {
    return {
      tamanhoIncompativel: true,
      pixelsComparados: 0, pixelsDiferentes: 0, proporcao: 0, maiorDesvio: 0, caixa: null,
    };
  }

  const total = a.largura * a.altura;
  let diferentes = 0;
  let maiorDesvio = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const dr = Math.abs(a.pixels[i] - b.pixels[i]);
    const dg = Math.abs(a.pixels[i + 1] - b.pixels[i + 1]);
    const db = Math.abs(a.pixels[i + 2] - b.pixels[i + 2]);
    const desvio = Math.max(dr, dg, db);
    if (desvio > maiorDesvio) maiorDesvio = desvio;
    if (desvio > limiar) {
      diferentes += 1;
      const x = p % a.largura;
      const y = Math.floor(p / a.largura);
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }

  return {
    tamanhoIncompativel: false,
    pixelsComparados: total,
    pixelsDiferentes: diferentes,
    proporcao: total > 0 ? diferentes / total : 0,
    maiorDesvio,
    caixa: diferentes > 0
      ? { x0, y0, x1, y1, larguraPx: x1 - x0 + 1, alturaPx: y1 - y0 + 1 }
      : null,
  };
}

export type Veredito = 'IDENTICO' | 'DIFERENCA_TOLERAVEL' | 'DIFERENTE';

export interface OpcoesDeVeredito {
  /** Acima disto, reprova. 0.001 = um pixel em mil. */
  proporcaoMaxima?: number;
  /** Um desvio muito forte reprova mesmo em poucos pixels: cor trocada, carimbo faltando. */
  desvioMaximo?: number;
}

/**
 * O parecer de uma página.
 *
 * Duas réguas, e as duas precisam existir. Só a proporção deixaria passar um
 * carimbo inteiro que sumiu de um canto (poucos pixels, desvio máximo); só o
 * desvio reprovaria qualquer antialiasing.
 */
export function vereditoDaPagina(
  diferenca: DiferencaDePagina,
  opcoes: OpcoesDeVeredito = {},
): Veredito {
  const proporcaoMaxima = opcoes.proporcaoMaxima ?? 0.001;
  const desvioMaximo = opcoes.desvioMaximo ?? 200;

  if (diferenca.tamanhoIncompativel) return 'DIFERENTE';
  if (diferenca.pixelsDiferentes === 0) return 'IDENTICO';
  if (diferenca.proporcao > proporcaoMaxima) return 'DIFERENTE';
  if (diferenca.maiorDesvio >= desvioMaximo) return 'DIFERENTE';
  return 'DIFERENCA_TOLERAVEL';
}

export interface PaginaDoDocumento {
  /** Tamanho da página em pontos, como o PDF declara. */
  larguraPt: number;
  alturaPt: number;
}

export interface DiferencaEstrutural {
  paginasA: number;
  paginasB: number;
  /** Páginas cujo tamanho declarado não bate (índice base 1). */
  tamanhosDivergentes: number[];
  ok: boolean;
  motivo?: string;
}

/**
 * A conferência que vem ANTES de qualquer pixel.
 *
 * Página a mais, a menos, ou de tamanho trocado, muda a que página cada campo
 * de assinatura pertence. É a diferença que faz uma assinatura sair no lugar
 * errado de um documento jurídico, e é invisível para qualquer medida de
 * proporção — por isso ela reprova sozinha, antes de comparar imagem.
 */
export function compararEstrutura(
  a: PaginaDoDocumento[],
  b: PaginaDoDocumento[],
  toleranciaPt = 1,
): DiferencaEstrutural {
  const paginasA = a?.length ?? 0;
  const paginasB = b?.length ?? 0;

  if (paginasA !== paginasB) {
    return {
      paginasA, paginasB, tamanhosDivergentes: [], ok: false,
      motivo: `número de páginas diferente: ${paginasA} contra ${paginasB}`,
    };
  }

  const tamanhosDivergentes: number[] = [];
  for (let i = 0; i < paginasA; i++) {
    const dl = Math.abs(a[i].larguraPt - b[i].larguraPt);
    const da = Math.abs(a[i].alturaPt - b[i].alturaPt);
    if (dl > toleranciaPt || da > toleranciaPt) tamanhosDivergentes.push(i + 1);
  }

  return {
    paginasA, paginasB, tamanhosDivergentes,
    ok: tamanhosDivergentes.length === 0,
    motivo: tamanhosDivergentes.length > 0
      ? `tamanho de página diferente em: ${tamanhosDivergentes.join(', ')}`
      : undefined,
  };
}

/** Converte pontos do PDF para milímetros — a unidade em que este projeto fala. */
export function ptParaMm(pt: number): number {
  return (pt * 25.4) / 72;
}

/**
 * A frase que o operador da bancada lê.
 *
 * Diz QUANTO e ONDE, em milímetros, porque "0,4% diferente" não permite decidir
 * nada: 0,4% espalhado pela página inteira é o documento errado; 0,4% numa
 * caixa de 40×12 mm no rodapé é o carimbo da assinatura, e aí a pergunta é
 * outra.
 */
export function descreverDiferenca(
  diferenca: DiferencaDePagina,
  escala: { mmPorPixel: number },
): string {
  if (diferenca.tamanhoIncompativel) return 'tamanho de página diferente — não comparável pixel a pixel';
  if (diferenca.pixelsDiferentes === 0) return 'idêntica';

  const pct = (diferenca.proporcao * 100).toFixed(3);
  const caixa = diferenca.caixa!;
  const larguraMm = (caixa.larguraPx * escala.mmPorPixel).toFixed(1);
  const alturaMm = (caixa.alturaPx * escala.mmPorPixel).toFixed(1);
  const xMm = (caixa.x0 * escala.mmPorPixel).toFixed(1);
  const yMm = (caixa.y0 * escala.mmPorPixel).toFixed(1);

  return `${pct}% dos pixels (desvio máx. ${diferenca.maiorDesvio}), `
    + `numa área de ${larguraMm}×${alturaMm} mm a partir de ${xMm},${yMm} mm`;
}
