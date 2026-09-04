/**
 * A geometria da montagem — onde cada coisa é desenhada.
 *
 * Tudo aqui é aritmética pura: entra número, sai número. Nada de pdf-lib, nada
 * de DOM. É de propósito, e o motivo é o defeito que a bancada existe para
 * pegar: uma assinatura no lugar errado num documento jurídico só aparece
 * DEPOIS de assinado, e "compila" não diz nada sobre isso.
 *
 * Separado assim, cada regra de posição tem teste próprio e as bordas ficam
 * escritas: campo maior que a página, página que não existe, documento que não
 * foi mesclado, porcentagem fora de 0..100.
 *
 * Espelha `pdfSignature.service.ts` (cliente). As duas cópias precisam
 * concordar enquanto a montagem do navegador não for removida.
 */

export type CampoEmPorcentagem = {
  x_percent: number;
  y_percent: number;
  w_percent: number;
  h_percent: number;
};

export type Retangulo = { x: number; y: number; w: number; h: number };

/**
 * Converte um campo em porcentagem para o retângulo do pdf-lib.
 *
 * A INVERSÃO DO EIXO Y é a única sutileza, e é a que causa erro caro: a tela
 * marca a partir do TOPO (y=0 em cima), o PDF desenha a partir da BASE (y=0
 * embaixo). Além de inverter, é preciso descontar a ALTURA do campo — senão o
 * que é devolvido é o topo do retângulo tratado como base, e a assinatura sobe
 * a própria altura.
 */
export function retanguloDoCampo(
  larguraDaPagina: number,
  alturaDaPagina: number,
  campo: CampoEmPorcentagem,
): Retangulo {
  const w = (larguraDaPagina * campo.w_percent) / 100;
  const h = (alturaDaPagina * campo.h_percent) / 100;
  const x = (larguraDaPagina * campo.x_percent) / 100;
  const yDoTopo = (alturaDaPagina * campo.y_percent) / 100;
  return { x, y: alturaDaPagina - yDoTopo - h, w, h };
}

/**
 * Encaixa o retângulo dentro da página.
 *
 * Não é paranoia: a porcentagem pode vir de uma medição feita noutra geometria
 * (o campo foi marcado numa folha A4 e o anexo é ofício), e desenhar fora do
 * MediaBox produz um PDF que abre com a assinatura invisível — pior que uma
 * assinatura deslocada, porque parece documento não assinado.
 *
 * Largura e altura têm piso de 1: um retângulo de dimensão zero ou negativa faz
 * o pdf-lib desenhar nada, calado.
 */
export function encaixarNaPagina(
  retangulo: Retangulo,
  larguraDaPagina: number,
  alturaDaPagina: number,
): Retangulo {
  const x = Math.max(0, Math.min(larguraDaPagina, retangulo.x));
  const y = Math.max(0, Math.min(alturaDaPagina, retangulo.y));
  return {
    x,
    y,
    w: Math.max(1, Math.min(retangulo.w, larguraDaPagina - x)),
    h: Math.max(1, Math.min(retangulo.h, alturaDaPagina - y)),
  };
}

/**
 * Em qual página do PDF montado este campo cai.
 *
 * `deslocamentos` mapeia a chave do documento (`main`, `attachment-0`, …) para
 * a página em que ele COMEÇA no arquivo final, porque os anexos são mesclados um
 * atrás do outro.
 *
 * Devolve `null` quando o documento do campo não está no arquivo — e essa é a
 * trava que importa. Sem ela, um campo de anexo não mesclado caía no
 * deslocamento 0 e era estampado no documento PRINCIPAL, empilhando assinaturas
 * de arquivos diferentes na mesma folha. O defeito é citado no código do
 * cliente; aqui ele tem teste.
 */
export function paginaDoCampo(params: {
  chaveDoDocumento: string;
  numeroDaPagina: number | null | undefined;
  deslocamentos: Record<string, number>;
  totalDePaginas: number;
}): number | null {
  const { chaveDoDocumento, numeroDaPagina, deslocamentos, totalDePaginas } = params;

  if (!Object.prototype.hasOwnProperty.call(deslocamentos, chaveDoDocumento)) return null;

  const deslocamento = deslocamentos[chaveDoDocumento];
  const pagina = Math.max(1, numeroDaPagina ?? 1);
  const indice = deslocamento + pagina - 1;

  // Fora do arquivo é `null`, não a última página: um campo que aponta para a
  // página 7 de um documento de 3 folhas é dado corrompido, e adivinhar onde
  // ele deveria estar carimbaria uma assinatura num lugar que ninguém marcou.
  if (indice < 0 || indice >= totalDePaginas) return null;
  return indice;
}

/**
 * Onde a assinatura vai quando o envelope não tem campo nenhum marcado.
 *
 * Último recurso, e vale saber que ele é ruim: 150×60 pt no canto inferior
 * direito da última página, acima da faixa do rodapé. Não é onde o documento
 * pede — é onde não atrapalha. Envelope que cai aqui é envelope que perdeu a
 * âncora, e isso merece investigação, não conformismo.
 */
export function posicaoDeReserva(
  larguraDaPagina: number,
  alturaDaPagina: number,
): Retangulo {
  const w = 150;
  const h = 60;
  return encaixarNaPagina(
    { x: larguraDaPagina - w - 80, y: 120, w, h },
    larguraDaPagina,
    alturaDaPagina,
  );
}

/** Altura, em pontos, da faixa aberta embaixo de cada página de conteúdo. */
export const ALTURA_DA_FAIXA_DO_RODAPE = 84;

/**
 * A nova caixa da página depois de abrir espaço para o rodapé.
 *
 * A página cresce PARA BAIXO: a origem desce e a altura aumenta. Assim o
 * conteúdo e as assinaturas já desenhadas ficam nas MESMAS coordenadas — nada
 * se move — e a faixa nasce embaixo, vazia.
 *
 * O caminho tentador (transladar ou escalar o conteúdo) está proibido no
 * cliente por um motivo medido: o pdf-lib embrulha o content stream em cache
 * dentro de um `q…cm…Q`, e todo desenho FEITO DEPOIS é acrescentado no mesmo
 * stream — ou seja, dentro da transformação. O rodapé acabava flutuando, com
 * uma faixa branca embaixo dele.
 */
export function caixaComFaixaDoRodape(
  caixa: { x: number; y: number; width: number; height: number },
  altura: number = ALTURA_DA_FAIXA_DO_RODAPE,
): { x: number; y: number; width: number; height: number } {
  return {
    x: caixa.x,
    y: caixa.y - altura,
    width: caixa.width,
    height: caixa.height + altura,
  };
}
