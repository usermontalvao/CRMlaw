/**
 * ONDE CORTAR uma página quando o documento vem como um canvas alto.
 *
 * O DOCX é renderizado como um bloco contínuo e fatiado em páginas A4. Cortar
 * numa altura fixa parte a linha de texto que estiver na fronteira: a metade de
 * cima fica colada no rodapé da página N e a de baixo reaparece no topo da
 * seguinte. Foi assim que "OAB/MT 30.021" saiu cortado ao meio no fim de um
 * contrato.
 *
 * A regra vive fora do serviço de PDF de propósito: ela não precisa de canvas
 * nem de navegador para ser exercitada — só de uma função que diga se uma
 * linha de pixels tem tinta. Assim o teste cobre a decisão, que é a parte que
 * erra, sem arrastar html2canvas junto.
 */

/** Fração da largura que é ignorada em cada lado ao julgar se a linha está limpa. */
export const MARGEM_IGNORADA = 0.03;

/**
 * Quantos pixels com tinta ainda deixam a linha passar por "limpa", como
 * fração da largura examinada.
 *
 * A versão anterior exigia a linha PERFEITAMENTE branca de ponta a ponta: um
 * único pixel abaixo do limiar — antisserrilhado do html2canvas a 2,5x, a
 * borda da folha, um filete de tabela — reprovava a linha inteira. Numa página
 * onde nenhuma linha passava, a busca desistia e cortava no meio do texto, que
 * é exatamente o defeito que ela existia para evitar.
 */
export const TOLERANCIA_DE_TINTA = 0.004;

/**
 * Escolhe a altura de corte: a linha limpa mais BAIXA dentro da janela de
 * busca acima do limite ideal. Não achando nenhuma, corta no ideal — cortar
 * mal é melhor que não paginar.
 *
 * @param alturaIdeal  onde o corte cairia se não houvesse texto no caminho
 * @param janela       quantos pixels acima do ideal vale a pena procurar
 * @param linhaTemTinta  se a linha `y` (absoluta) tem tinta demais para cortar
 * @param alturaTotal  altura do canvas; corte no fim não precisa de busca
 */
export const escolherCorte = (params: {
  alturaIdeal: number;
  janela: number;
  alturaTotal: number;
  linhaTemTinta: (y: number) => boolean;
}): number => {
  const { alturaIdeal, janela, alturaTotal, linhaTemTinta } = params;
  if (alturaIdeal >= alturaTotal) return alturaTotal;
  const topo = Math.max(0, alturaIdeal - janela);
  for (let y = alturaIdeal - 1; y >= topo; y--) {
    if (!linhaTemTinta(y)) return y + 1;
  }
  return alturaIdeal;
};

/**
 * Se a linha `y` de um bloco RGBA tem tinta suficiente para não se cortar nela.
 *
 * Ignora uma margem de cada lado (borda da folha, sombra, artefato de captura)
 * e tolera alguns pixels isolados. Julgar a faixa central é o que importa: é
 * onde o texto mora.
 */
export const linhaTemTintaEm = (params: {
  dados: Uint8ClampedArray | number[];
  larguraDoBloco: number;
  /** Linha DENTRO do bloco (0 = primeira linha lida). */
  linha: number;
  limiar?: number;
}): boolean => {
  const { dados, larguraDoBloco, linha, limiar = 245 } = params;
  const inicio = Math.floor(larguraDoBloco * MARGEM_IGNORADA);
  const fim = Math.ceil(larguraDoBloco * (1 - MARGEM_IGNORADA));
  const examinados = Math.max(1, fim - inicio);
  const maximo = Math.floor(examinados * TOLERANCIA_DE_TINTA);

  let comTinta = 0;
  const base = linha * larguraDoBloco * 4;
  for (let col = inicio; col < fim; col++) {
    const i = base + col * 4;
    if (dados[i] < limiar || dados[i + 1] < limiar || dados[i + 2] < limiar) {
      comTinta += 1;
      if (comTinta > maximo) return true;
    }
  }
  return false;
};
