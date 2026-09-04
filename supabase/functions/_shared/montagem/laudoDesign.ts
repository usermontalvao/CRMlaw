/**
 * A camada de desenho do laudo: paleta e primitivas de forma.
 *
 * As três páginas do laudo (capa, uma por signatário, e o histórico) desenham
 * as MESMAS formas — cartão arredondado, cabeçalho de cartão, visto, marcas de
 * canto. Portar isso uma vez, aqui, é o que impede as três de divergirem no
 * caminho.
 *
 * As funções de CAMINHO são puras (entra número, sai string SVG) e têm teste
 * próprio. As de desenho são camadas finas por cima, para o pdf-lib.
 *
 * Porte do bloco "Design system" de `addReportPages`
 * (`pdfSignature.service.ts`). Os números são os do cliente, copiados.
 */

export type PaginaPdf = any;
export type Cor = unknown;

export type FerramentasDeForma = {
  rgb: (r: number, g: number, b: number) => Cor;
  /** `LineCapStyle.Round` do pdf-lib — a ponta arredondada do visto. */
  pontaRedonda: unknown;
};

/**
 * A paleta do laudo.
 *
 * Recebe o `rgb` do pdf-lib em vez de importá-lo: o mesmo arquivo roda no Deno
 * (`npm:pdf-lib`) e na bancada local, sem duas cópias.
 */
export function paletaDoLaudo(rgb: FerramentasDeForma['rgb']) {
  return {
    navy: rgb(0.07, 0.10, 0.19),
    navyMid: rgb(0.13, 0.17, 0.27),
    orange: rgb(0.91, 0.32, 0.04),
    emerald: rgb(0.05, 0.49, 0.29),
    emeraldSoft: rgb(0.90, 0.96, 0.92),
    white: rgb(1, 1, 1),
    bgLight: rgb(0.965, 0.975, 0.985),
    paper: rgb(0.98, 0.985, 0.992),
    border: rgb(0.87, 0.90, 0.94),
    borderSoft: rgb(0.93, 0.95, 0.97),
    txtDark: rgb(0.10, 0.13, 0.20),
    txtMid: rgb(0.36, 0.42, 0.50),
    txtSoft: rgb(0.55, 0.60, 0.68),
    silver: rgb(0.74, 0.78, 0.84),
  };
}

export type PaletaDoLaudo = ReturnType<typeof paletaDoLaudo>;

/**
 * O caminho SVG de um retângulo de cantos arredondados.
 *
 * ATENÇÃO AO EIXO: o `drawSvgPath` do pdf-lib usa origem no canto SUPERIOR
 * esquerdo com y crescendo para BAIXO — ao contrário do resto do PDF. Por isso
 * quem chama passa a borda de CIMA como `y`, e não a de baixo. Trocar isso
 * desenha o cartão deslocado da própria altura, sem erro nenhum.
 *
 * O raio é limitado a metade do menor lado: um raio maior faria as curvas se
 * cruzarem e o pdf-lib desenharia uma forma torcida.
 */
export function caminhoRetanguloArredondado(largura: number, altura: number, raio: number): string {
  const r = Math.max(0, Math.min(raio, largura / 2, altura / 2));
  return `M ${r} 0 L ${largura - r} 0 Q ${largura} 0 ${largura} ${r} `
    + `L ${largura} ${altura - r} Q ${largura} ${altura} ${largura - r} ${altura} `
    + `L ${r} ${altura} Q 0 ${altura} 0 ${altura - r} L 0 ${r} Q 0 0 ${r} 0 Z`;
}

/**
 * Só os cantos DE CIMA arredondados — o cabeçalho colorido de um cartão, que
 * encosta no corpo reto embaixo.
 */
export function caminhoRetanguloTopoArredondado(largura: number, altura: number, raio: number): string {
  const r = Math.max(0, Math.min(raio, largura / 2, altura));
  return `M 0 ${altura} L 0 ${r} Q 0 0 ${r} 0 L ${largura - r} 0 Q ${largura} 0 ${largura} ${r} L ${largura} ${altura} Z`;
}

/**
 * O caminho do visto (✓) dentro de um quadrado de lado `2r`.
 *
 * Os três pontos são frações do lado, e não medidas absolutas: assim o visto
 * cresce junto com o círculo que o contém, sem sair do lugar.
 */
export function caminhoDoVisto(raio: number): string {
  const s = raio * 2;
  return `M ${0.15 * s} ${0.50 * s} L ${0.40 * s} ${0.75 * s} L ${0.85 * s} ${0.25 * s}`;
}

/** Desenha um retângulo arredondado pela borda de CIMA (`topoY`). */
export function retanguloArredondado(
  pagina: PaginaPdf,
  x: number, topoY: number, largura: number, altura: number, raio: number,
  opcoes: { preenchimento?: Cor; contorno?: Cor; espessura?: number; opacidade?: number } = {},
): void {
  pagina.drawSvgPath(caminhoRetanguloArredondado(largura, altura, raio), {
    x, y: topoY,
    color: opcoes.preenchimento,
    borderColor: opcoes.contorno,
    borderWidth: opcoes.espessura ?? (opcoes.contorno ? 0.8 : 0),
    opacity: opcoes.opacidade,
  });
}

/** Cabeçalho de cartão: cantos de cima arredondados, base reta. */
export function retanguloTopoArredondado(
  pagina: PaginaPdf,
  x: number, topoY: number, largura: number, altura: number, raio: number, preenchimento: Cor,
): void {
  pagina.drawSvgPath(caminhoRetanguloTopoArredondado(largura, altura, raio), {
    x, y: topoY, color: preenchimento,
  });
}

/**
 * O visto, centrado em (cx, cy).
 *
 * O `y` passado ao pdf-lib é `cy + raio` — o TOPO da caixa — porque o caminho
 * interno vai de 0 (topo) a 2r (base), no eixo invertido do SVG.
 */
export function visto(
  pagina: PaginaPdf,
  cx: number, cy: number, raio: number,
  cor: Cor, ferramentas: FerramentasDeForma, espessura = 1.4,
): void {
  pagina.drawSvgPath(caminhoDoVisto(raio), {
    x: cx - raio,
    y: cy + raio,
    borderColor: cor,
    borderWidth: espessura,
    borderLineCap: ferramentas.pontaRedonda,
  });
}

/**
 * As marcas de canto em volta de uma foto emoldurada.
 *
 * Oito segmentos, dois por canto. Recebe o canto INFERIOR esquerdo (`x`, `y`) e
 * as dimensões, como o resto do desenho em coordenadas de PDF.
 */
export function marcasDeCanto(
  pagina: PaginaPdf,
  x: number, y: number, largura: number, altura: number, comprimento: number, cor: Cor,
): void {
  const t = 0.8;
  const seg = (x1: number, y1: number, x2: number, y2: number) =>
    pagina.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color: cor });

  const topo = y + altura;
  const direita = x + largura;
  // superior esquerdo
  seg(x, topo, x + comprimento, topo); seg(x, topo, x, topo - comprimento);
  // superior direito
  seg(direita - comprimento, topo, direita, topo); seg(direita, topo, direita, topo - comprimento);
  // inferior esquerdo
  seg(x, y, x + comprimento, y); seg(x, y, x, y + comprimento);
  // inferior direito
  seg(direita - comprimento, y, direita, y); seg(direita, y, direita, y + comprimento);
}

/** Uma fonte, do ponto de vista de quem só precisa medir. */
export type FonteQueMede = { widthOfTextAtSize: (texto: string, tamanho: number) => number };

/**
 * Quebra o texto em linhas que cabem numa largura.
 *
 * POR QUE NÃO USAR O `maxWidth` DO pdf-lib: ele quebra ao desenhar, mas quem
 * chama não fica sabendo em QUANTAS linhas quebrou. No laudo isso importa
 * porque a altura do cartão é calculada ANTES do desenho — e com uma conta de
 * "uma linha por item" um texto comprido virava duas linhas e a segunda caía
 * por cima do item seguinte. Quebrando aqui, quem manda na altura é o número de
 * linhas de verdade.
 *
 * Palavra sozinha maior que a largura NÃO é cortada: fica numa linha só e
 * transborda. É de propósito — cortar no meio produziria "Geolocaliza" numa
 * linha e "ção" na outra, e o que transborda no laudo são identificadores
 * (Google ID, IP), onde o corte seria pior que a sobra.
 */
export function quebrarTexto(
  texto: string, fonte: FonteQueMede, tamanho: number, larguraMax: number,
): string[] {
  const limpo = String(texto ?? '').trim();
  if (!limpo) return [''];

  const palavras = limpo.split(/\s+/);
  const linhas: string[] = [];
  let atual = '';

  for (const palavra of palavras) {
    const candidata = atual ? `${atual} ${palavra}` : palavra;
    const largura = typeof fonte?.widthOfTextAtSize === 'function'
      ? fonte.widthOfTextAtSize(candidata, tamanho)
      // Sem fonte de verdade, uma estimativa grosseira é melhor que estourar:
      // acontece em teste e em desenho de reserva.
      : candidata.length * tamanho * 0.5;
    // `|| !atual` é o que impede o laço infinito com palavra maior que a caixa.
    if (largura <= larguraMax || !atual) atual = candidata;
    else { linhas.push(atual); atual = palavra; }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/**
 * Corta um nome de documento para o cabeçalho do laudo.
 *
 * Tira a extensão (o laudo fala do documento, não do arquivo) e limita a 70
 * caracteres — acima disso o nome invadiria a coluna da direita, onde ficam o
 * rótulo da página e a data.
 */
export function nomeParaCabecalho(bruto: string | null | undefined): string {
  const limpo = String(bruto ?? '').replace(/\.(pdf|docx?|rtf|odt)$/i, '').trim();
  return limpo.length > 70 ? `${limpo.slice(0, 67)}...` : limpo;
}
