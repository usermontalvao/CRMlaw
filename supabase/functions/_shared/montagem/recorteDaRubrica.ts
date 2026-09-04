/**
 * O recorte do fundo branco da rubrica, do lado do servidor.
 *
 * `fundo-branco.ts` tem a REGRA (entra RGBA, sai RGBA). Aqui está o que falta
 * para usá-la fora do navegador: decodificar o PNG, aplicar, recodificar — e,
 * principalmente, DECIDIR o que fazer quando o recorte apagou demais.
 *
 * O codec entra por parâmetro em vez de import. É o que mantém este arquivo
 * carregável pelo `node --test` sem arrastar um `npm:` que só o Deno resolve; a
 * Edge Function passa o `fast-png`, e o teste passa um codec de mentira que
 * exercita a regra sem depender de compressão nenhuma.
 */
import { apagarFundoBranco, recorteApagouDemais } from './fundo-branco.ts';

export type ImagemRgba = {
  width: number;
  height: number;
  /** RGBA entrelaçado, 4 bytes por pixel. */
  data: Uint8Array | Uint8ClampedArray;
  /** Quantos canais o decodificador devolveu. Só 4 é aproveitável. */
  channels?: number;
  depth?: number;
};

export type CodecPng = {
  decodificar: (bytes: Uint8Array) => ImagemRgba;
  codificar: (imagem: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }) => Uint8Array;
};

export type ResultadoDaRubrica = {
  /** O PNG a embutir no documento. */
  png: Uint8Array;
  /** O recorte foi aplicado, ou preferiu-se a imagem original? */
  recortado: boolean;
  /**
   * Por que não recortou. `null` quando recortou.
   *
   * · `apagou-demais` — a assinatura sumiria inteira;
   * · `formato-inesperado` — o PNG não veio em RGBA de 8 bits;
   * · `falhou` — o codec lançou.
   */
  motivo: null | 'apagou-demais' | 'formato-inesperado' | 'falhou';
  apagados: number;
  total: number;
};

/**
 * Recorta o fundo branco — e devolve a ORIGINAL quando o recorte apagaria a
 * assinatura inteira.
 *
 * A escolha é deliberada e vale escrever: fundo branco indesejado é feio;
 * assinatura ausente é um documento SEM assinatura, que é outra coisa. Uma
 * rubrica clara demais, ou digitalizada quase toda em branco, some por completo
 * com o limiar de 240 — e nada, hoje, olha o resultado.
 *
 * Falha macia em tudo: PNG que o codec não entende, formato inesperado, exceção
 * — a rubrica original é embutida, exatamente como o cliente já faz no `catch`.
 * A montagem nunca para por causa do recorte.
 */
export function recortarFundoDaRubrica(png: Uint8Array, codec: CodecPng): ResultadoDaRubrica {
  const original: ResultadoDaRubrica = {
    png, recortado: false, motivo: 'falhou', apagados: 0, total: 0,
  };

  let imagem: ImagemRgba;
  try {
    imagem = codec.decodificar(png);
  } catch {
    return original;
  }

  // Sem os quatro canais não há o que apagar: escrever alfa num buffer de 3
  // canais desalinharia a imagem inteira, e o documento sairia com a assinatura
  // em cores trocadas — pior que o fundo branco.
  const canais = imagem.channels ?? (imagem.data.length / (imagem.width * imagem.height));
  if (canais !== 4 || (imagem.depth != null && imagem.depth !== 8)) {
    return { ...original, motivo: 'formato-inesperado' };
  }

  const resultado = apagarFundoBranco(imagem.data);

  if (recorteApagouDemais(resultado)) {
    return { ...original, motivo: 'apagou-demais', ...resultado };
  }

  try {
    return {
      png: codec.codificar({ width: imagem.width, height: imagem.height, data: imagem.data }),
      recortado: true,
      motivo: null,
      ...resultado,
    };
  } catch {
    return { ...original, motivo: 'falhou', ...resultado };
  }
}
