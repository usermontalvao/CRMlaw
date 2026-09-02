/**
 * Regras puras do portão de rosto do visor da selfie.
 *
 * Mora fora do hook de propósito: sem nenhum import, para poder ser exercitada
 * pelos testes sem arrastar React, TensorFlow nem a câmera. O hook
 * (useDeteccaoDeRosto.ts) cuida do ciclo de vida; toda a DECISÃO está aqui.
 */

export type EstadoDeteccao =
  | 'carregando'   // baixando o modelo
  | 'procurando'   // modelo pronto, nenhum rosto no quadro
  | 'longe'        // há rosto, mas pequeno demais
  | 'fora'         // há rosto, mas fora do centro
  | 'pronto'       // rosto enquadrado
  | 'indisponivel'; // modelo não carregou — a etapa segue sem o portão

/** Confiança mínima para considerar que há mesmo um rosto. Rosto parcialmente
 *  coberto costuma pontuar mais baixo — não resolve oclusão (quem julga isso é
 *  a IA em analyze-facial-photo), mas apara os casos mais grosseiros antes de
 *  gastar uma chamada de visão. */
export const CONFIANCA_MINIMA = 0.92;
/** O rosto precisa ocupar ao menos esta fração da largura do quadro. Barra
 *  rosto de outra pessoa ao fundo e retrato pendurado na parede. */
export const LARGURA_MINIMA = 0.16;
/** E precisa estar na região central — é onde o oval do visor está desenhado. */
export const MARGEM_CENTRAL = 0.32;
/** Quadros seguidos em 'pronto' para o enquadramento contar como parado.
 *  A ~6 fps isso é ~1s, o que evita disparar num rosto de passagem. */
export const QUADROS_PARA_GANHAR = 6;
/** Quadros seguidos SEM rosto para desmontar um enquadramento já estável.
 *  Existe porque o detector pisca: uma piscada de olho, um quadro borrado ou o
 *  rosto virando de leve derrubavam a estabilidade por um instante e
 *  reiniciavam a contagem regressiva, que nunca chegava a zero e por isso a
 *  foto nunca saía sozinha. Ganhar é rápido; perder exige insistência. */
export const QUADROS_PARA_PERDER = 5;

/** O que o BlazeFace devolve por rosto, no que interessa aqui. */
export interface RostoDetectado {
  topLeft: [number, number];
  bottomRight: [number, number];
  probability?: number | number[];
  /** 6 pontos: olho direito, olho esquerdo, nariz, boca, orelha D, orelha E. */
  landmarks?: [number, number][];
}

/** Normaliza a confiança, que vem ora como número, ora como vetor de um item. */
export const confiancaDe = (rosto: RostoDetectado): number | null => {
  const p = rosto.probability;
  if (Array.isArray(p)) return typeof p[0] === 'number' ? p[0] : null;
  return typeof p === 'number' ? p : null;
};

/**
 * A geometria entre os pontos derruba coisas que "parecem rosto" sem ser
 * (padrões, objetos, rosto de cabeça para baixo).
 *
 * NÃO derruba mão sobre o rosto: os pontos são regredidos pelo modelo e saem
 * mesmo quando a região está coberta. Obstrução é decidida depois, pela IA.
 */
export const geometriaPlausivel = (rosto: RostoDetectado, larguraCaixa: number): boolean => {
  const p = rosto.landmarks;
  if (!Array.isArray(p) || p.length < 4) return true; // sem pontos, não julga
  const [olhoD, olhoE, nariz, boca] = p;
  const distanciaOlhos = Math.abs(olhoE[0] - olhoD[0]);
  if (distanciaOlhos < larguraCaixa * 0.18) return false;
  if (distanciaOlhos > larguraCaixa * 0.8) return false;
  const alturaOlhos = (olhoD[1] + olhoE[1]) / 2;
  if (nariz[1] <= alturaOlhos) return false; // nariz tem de ficar abaixo dos olhos
  if (boca[1] <= nariz[1]) return false;     // e a boca abaixo do nariz
  return true;
};

/**
 * Classifica o quadro. Devolve o MELHOR estado entre os rostos vistos: basta
 * um rosto bem enquadrado para o quadro valer, e os motivos de recusa
 * ('longe'/'fora') servem para dizer à pessoa o que corrigir.
 */
export const avaliarQuadro = (
  rostos: RostoDetectado[],
  larguraQuadro: number,
  alturaQuadro: number,
): EstadoDeteccao => {
  if (larguraQuadro <= 0 || alturaQuadro <= 0) return 'procurando';

  let melhor: EstadoDeteccao = 'procurando';

  for (const rosto of rostos) {
    const confianca = confiancaDe(rosto);
    if (confianca !== null && confianca < CONFIANCA_MINIMA) continue;

    const [x1, y1] = rosto.topLeft;
    const [x2, y2] = rosto.bottomRight;
    const larguraCaixa = x2 - x1;
    if (larguraCaixa <= 0 || y2 - y1 <= 0) continue;

    if (larguraCaixa / larguraQuadro < LARGURA_MINIMA) {
      if (melhor === 'procurando') melhor = 'longe';
      continue;
    }

    if (!geometriaPlausivel(rosto, larguraCaixa)) continue;

    const centroX = (x1 + x2) / 2 / larguraQuadro;
    const centroY = (y1 + y2) / 2 / alturaQuadro;
    const dentro =
      centroX > MARGEM_CENTRAL && centroX < 1 - MARGEM_CENTRAL &&
      centroY > MARGEM_CENTRAL * 0.6 && centroY < 1 - MARGEM_CENTRAL * 0.6;

    if (!dentro) {
      melhor = 'fora';
      continue;
    }

    return 'pronto';
  }

  return melhor;
};

/** Estado do acompanhamento de estabilidade entre um quadro e o seguinte. */
export interface EstabilidadeEnquadramento {
  /** Quadros bons seguidos. */
  bons: number;
  /** Quadros ruins seguidos. */
  ruins: number;
  /** Se o enquadramento conta como parado agora. */
  estavel: boolean;
}

export const ESTABILIDADE_INICIAL: EstabilidadeEnquadramento = { bons: 0, ruins: 0, estavel: false };

/**
 * Avança a estabilidade com o resultado de mais um quadro, com histerese:
 * ganha depois de QUADROS_PARA_GANHAR bons seguidos, e só perde depois de
 * QUADROS_PARA_PERDER ruins seguidos. Sem a histerese, um único quadro ruim
 * derrubava tudo e a contagem regressiva reiniciava para sempre.
 */
export const avancarEstabilidade = (
  atual: EstabilidadeEnquadramento,
  estado: EstadoDeteccao,
): EstabilidadeEnquadramento => {
  if (estado === 'pronto') {
    const bons = atual.bons + 1;
    return { bons, ruins: 0, estavel: atual.estavel || bons >= QUADROS_PARA_GANHAR };
  }

  const ruins = atual.ruins + 1;
  if (atual.estavel && ruins < QUADROS_PARA_PERDER) {
    return { bons: atual.bons, ruins, estavel: true };
  }
  return { bons: 0, ruins, estavel: false };
};

/**
 * SE O DISPARO AUTOMÁTICO PODE CORRER.
 *
 * O portão tem escapes para nunca prender ninguém (ver o cabeçalho de
 * `useDeteccaoDeRosto`), e eles funcionavam — para o BOTÃO. O disparo
 * automático continuava amarrado só a `estavel`, que só existe quando o modelo
 * está dando veredito e o rosto chega a `pronto`.
 *
 * O resultado era um sintoma que não se explicava sozinho: a foto manual
 * funcionava e a automática nunca saía. Acontecia sempre que o modelo não
 * carregava, e também quando ele carregava mas nunca dizia `pronto` — rosto um
 * pouco fora do centro, luz fraca, pele escura. A tela prometia uma contagem
 * regressiva que não vinha, e a pessoa ficava esperando.
 *
 * A conta é a mesma do resto deste portão, e ela já estava escrita: deixar
 * passar uma foto ruim custa pouco (a IA atrás reprova e a pessoa repete),
 * mas travar quem quer assinar custa um contrato. Se escapou, a contagem
 * corre — visível, cancelável, e com a validação por IA ainda no caminho.
 */
export const deveDispararSozinho = (params: {
  estavel: boolean;
  escapou: boolean;
}): boolean => params.estavel || params.escapou;
