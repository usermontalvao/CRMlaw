/**
 * Converte a posição de um campo medida a partir do TOPO do documento para o
 * eixo Y do PDF, cuja origem fica embaixo.
 *
 * O resultado ancora a base da imagem exatamente na base do campo detectado.
 * Não deve existir compensação fixa aqui: o próprio marcador [[ASSINATURA]] é
 * a fonte de verdade para o posicionamento no template.
 */
export const calcularYDaAssinatura = (params: {
  baseDaFatia: number;
  alturaDaFatia: number;
  yDoCampoAPartirDoTopo: number;
  alturaDoCampo: number;
}): number => {
  const { baseDaFatia, alturaDaFatia, yDoCampoAPartirDoTopo, alturaDoCampo } = params;
  return baseDaFatia + alturaDaFatia - yDoCampoAPartirDoTopo - alturaDoCampo;
};
