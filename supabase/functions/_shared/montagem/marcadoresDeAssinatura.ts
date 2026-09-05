/**
 * O marcador `[[ASSINATURA]]` — a regra pura, sem DOM.
 *
 * POR QUE ISTO EXISTE SEPARADO
 *
 * Hoje o marcador é procurado na hora de ASSINAR, no navegador de quem assina,
 * sobre o Word renderizado pelo `docx-preview`. Isso funciona porque o PDF
 * assinado nasce daquele mesmo desenho.
 *
 * Com o congelamento (etapa 1), o original vira PDF na CRIAÇÃO do envelope. Se o
 * marcador continuar sendo procurado só na assinatura, ele já terá sido impresso
 * na folha — e a âncora se perde: o texto `[[ASSINATURA]]` aparece no documento
 * e a rubrica cai no rodapé, por fallback.
 *
 * Então a detecção precisa acontecer na conversão. Esta é a parte que não
 * depende de navegador nenhum: achar os marcadores num texto e converter um
 * retângulo em porcentagens da folha. O passeio pelo DOM e a medição com
 * `Range` ficam em `docxToPdf.ts`, que é onde há DOM.
 *
 * Manter separado é o que permite testar as bordas de verdade — marcador
 * partido em vários `runs` do Word, `[[ASSINATURA_2]]`, retângulo degenerado —
 * sem precisar montar um documento inteiro.
 */

/**
 * O marcador aceita espaço interno e um índice de assinante:
 * `[[ASSINATURA]]`, `[[assinatura_2]]`, `[[ ASSINATURA ]]`.
 *
 * É devolvido por função, e não exportado como constante: `RegExp` com a flag
 * `g` guarda `lastIndex` entre chamadas, e uma constante compartilhada faria a
 * segunda folha começar a busca de onde a primeira parou — pulando marcadores
 * sem erro nenhum.
 */
export const criarRegexDeMarcador = (): RegExp => /\[\[\s*assinatura(?:_(\d+))?\s*\]\]/gi;

export type MarcadorNoTexto = {
  /** Índice do primeiro caractere do marcador no texto contínuo. */
  inicio: number;
  /** Índice logo APÓS o último caractere. */
  fim: number;
  /** Qual assinante: `[[ASSINATURA]]` é 1; `[[ASSINATURA_2]]` é 2. */
  indiceDoAssinante: number;
  /** O texto casado, como estava. */
  bruto: string;
};

/**
 * Acha todos os marcadores num texto contínuo.
 *
 * O texto tem de ser a concatenação dos nós de texto NA ORDEM em que aparecem,
 * porque o Word costuma quebrar `[[ASSINATURA]]` em vários `runs` (basta o
 * autor ter digitado um colchete e depois formatado o resto). Procurar nó a nó
 * acharia zero marcadores num documento perfeitamente válido.
 */
export function acharMarcadores(texto: string): MarcadorNoTexto[] {
  const regex = criarRegexDeMarcador();
  const achados: MarcadorNoTexto[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(texto)) !== null) {
    const bruto = match[0];
    // Marcador de tamanho zero é impossível com esta regex, mas um `lastIndex`
    // que não anda trava o laço para sempre. A guarda custa uma linha.
    if (bruto.length === 0) {
      regex.lastIndex += 1;
      continue;
    }

    const indice = match[1] ? Number.parseInt(match[1], 10) : 1;
    if (!Number.isFinite(indice) || indice < 1) continue;

    achados.push({
      inicio: match.index,
      fim: match.index + bruto.length,
      indiceDoAssinante: indice,
      bruto,
    });
  }

  return achados;
}

export type RetanguloMedido = {
  /** Esquerda do marcador, em pixels, relativa à esquerda da folha. */
  esquerda: number;
  /** Topo do marcador, em pixels, relativo ao topo da folha. */
  topo: number;
  largura: number;
  altura: number;
};

export type CampoEmPorcentagem = {
  x_percent: number;
  y_percent: number;
  w_percent: number;
  h_percent: number;
};

/**
 * Converte o retângulo medido do marcador em porcentagens da folha.
 *
 * Os limites são os MESMOS que a detecção de hoje aplica
 * (`pdfSignature.service.ts`), e existem por motivos diferentes:
 *
 * - x e y só são grampeados em 0..100 — posição fora da folha é erro de medida,
 *   e jogar para a borda é menos ruim do que desenhar fora do papel;
 * - largura e altura têm PISO além do teto. Um marcador pode ser medido com
 *   largura quase zero (fonte minúscula, run partido, `display:none` herdado), e
 *   uma assinatura de 0,3% de largura é uma assinatura invisível — pior que uma
 *   fora de lugar, porque parece que o documento não foi assinado.
 *
 * O padrão de 18% × 7% é o tamanho de uma rubrica típica, usado quando a medida
 * não veio (retângulo degenerado).
 */
export function campoEmPorcentagem(
  marcador: RetanguloMedido,
  folha: { largura: number; altura: number },
): CampoEmPorcentagem | null {
  const cru = campoCruEmPorcentagem(marcador, folha);
  return cru && enquadrarCampo(cru);
}

/**
 * A medida NUA, em porcentagem da folha — sem piso nem teto.
 *
 * Existe para quem ainda vai MUDAR a régua antes de enquadrar. É o caso da
 * conversão por fatias no navegador: quando o Word não traz quebra de página, o
 * documento inteiro sai numa folha só, que vira N páginas — e o piso de 4% de
 * altura, aplicado à folha, viraria 4·N% da página, uma rubrica gigante. Lá a
 * ordem certa é medir cru, levar para a página (`campoDaFolhaNaFatia`) e só
 * então `enquadrarCampo`.
 *
 * Quem mede direto sobre a página não precisa disto: use `campoEmPorcentagem`.
 */
export function campoCruEmPorcentagem(
  marcador: RetanguloMedido,
  folha: { largura: number; altura: number },
): CampoEmPorcentagem | null {
  if (!(folha.largura > 0) || !(folha.altura > 0)) return null;

  return {
    x_percent: (marcador.esquerda / folha.largura) * 100,
    y_percent: (marcador.topo / folha.altura) * 100,
    w_percent: (marcador.largura / folha.largura) * 100,
    h_percent: (marcador.altura / folha.altura) * 100,
  };
}

/**
 * Aplica os limites descritos acima a um campo já em porcentagem DA PÁGINA.
 *
 * Idempotente: enquadrar duas vezes dá o mesmo resultado. É por isso que ela
 * pode ser chamada no fim de qualquer caminho, sem quem chama precisar saber se
 * alguém já enquadrou antes.
 */
export function enquadrarCampo(campo: CampoEmPorcentagem): CampoEmPorcentagem {
  const { x_percent: x, y_percent: y, w_percent: w, h_percent: h } = campo;
  return {
    x_percent: Math.max(0, Math.min(100, x)),
    y_percent: Math.max(0, Math.min(100, y)),
    w_percent: Math.max(8, Math.min(40, w > 0 ? w : 18)),
    h_percent: Math.max(4, Math.min(20, h > 0 ? h : 7)),
  };
}

/**
 * O texto que substitui o marcador na folha antes de rasterizar.
 *
 * Espaço inquebrável, um por caractere: preserva a largura da linha (o parágrafo
 * não reflui e o resto do documento não anda) e não imprime nada. Apagar os
 * caracteres moveria o texto seguinte, e o PDF congelado deixaria de bater com o
 * que o autor viu no Word.
 */
export function mascaraPara(bruto: string): string {
  return '\u00A0'.repeat(bruto.length);
}
