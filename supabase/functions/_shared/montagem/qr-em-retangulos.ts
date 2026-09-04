/**
 * O QR CODE SEM CANVAS.
 *
 * Hoje o código de verificação vira imagem com `QRCode.toCanvas` — um canvas de
 * 512 px que depois é embutido como PNG no PDF. Canvas não existe no servidor, e
 * essa é uma das poucas coisas que prendiam a montagem no navegador.
 *
 * A saída não é procurar um canvas para o Deno: é parar de precisar de um. O
 * QR é uma grade de quadrados pretos — desenhar retângulos é exatamente o que o
 * `pdf-lib` faz melhor. De quebra, o QR passa a ser VETORIAL: nítido em
 * qualquer zoom e mais leve que um PNG de 512 px.
 *
 * Este módulo não gera o QR; ele recebe a matriz pronta (do `qrcode`, cujo
 * `create()` é puro e roda em Deno) e devolve os retângulos a desenhar.
 *
 * Ver `docs/assinatura-montagem-no-servidor.md`.
 */

/** Um retângulo em unidades de MÓDULO (o quadradinho do QR), origem no topo. */
export interface RetanguloDeModulos {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/** Retângulo já em pontos do PDF, origem embaixo à esquerda. */
export interface RetanguloEmPontos {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/**
 * Junta módulos escuros vizinhos na horizontal num retângulo só.
 *
 * Um QR de correção alta para uma URL nossa tem ~2.000 módulos escuros. Um
 * retângulo por módulo são 2.000 operações de desenho por documento — e o kit
 * tem um QR por página de laudo. Emendando as sequências horizontais isso cai
 * para algumas centenas, com o MESMO desenho: os módulos são contíguos, então
 * emendar não altera um pixel.
 */
export function retangulosDoQr(
  modulos: ArrayLike<number | boolean>,
  tamanho: number,
): RetanguloDeModulos[] {
  const retangulos: RetanguloDeModulos[] = [];
  if (!modulos || tamanho <= 0) return retangulos;

  const escuro = (x: number, y: number): boolean => {
    const v = modulos[y * tamanho + x];
    return v === true || v === 1;
  };

  for (let y = 0; y < tamanho; y++) {
    let x = 0;
    while (x < tamanho) {
      if (!escuro(x, y)) { x += 1; continue; }
      let fim = x;
      while (fim + 1 < tamanho && escuro(fim + 1, y)) fim += 1;
      retangulos.push({ x, y, largura: fim - x + 1, altura: 1 });
      x = fim + 1;
    }
  }

  return retangulos;
}

export interface EscalaDoQr {
  /** Canto inferior esquerdo do QR, em pontos (a origem do PDF). */
  origemX: number;
  origemY: number;
  /** Lado total do QR desenhado, em pontos — margem incluída. */
  lado: number;
  /** Módulos de margem clara em volta (a "zona de silêncio"). Padrão 1. */
  margem?: number;
}

/**
 * Leva os retângulos de módulo para pontos do PDF.
 *
 * A ARMADILHA QUE ISTO EXISTE PARA DESARMAR: a matriz do QR conta as linhas de
 * CIMA para baixo, e o PDF conta o Y de BAIXO para cima. Copiar o `y` direto
 * espelha o código na vertical — e QR espelhado não é "QR de cabeça para
 * baixo", que leitor nenhum lê. Ele continua parecendo um QR perfeitamente
 * normal na tela, e simplesmente não abre nada. Num documento que já foi
 * assinado e arquivado, esse defeito só aparece quando alguém tenta conferir.
 */
export function escalarRetangulosDoQr(
  retangulos: RetanguloDeModulos[],
  tamanho: number,
  escala: EscalaDoQr,
): RetanguloEmPontos[] {
  const margem = escala.margem ?? 1;
  const totalDeModulos = tamanho + margem * 2;
  const passo = escala.lado / totalDeModulos;

  return retangulos.map((r) => ({
    x: escala.origemX + (r.x + margem) * passo,
    // Inverte o eixo: a linha 0 da matriz é a de CIMA.
    y: escala.origemY + (totalDeModulos - margem - r.y - r.altura) * passo,
    largura: r.largura * passo,
    altura: r.altura * passo,
  }));
}

/**
 * Quantos pontos tem cada módulo, dado o lado desejado.
 *
 * Serve para a única regra de legibilidade que importa aqui: módulo pequeno
 * demais não é lido por câmera de celular. Abaixo de ~0,7 pt (0,25 mm) impresso,
 * o leitor erra — e o QR do laudo existe justamente para ser lido com o
 * documento na mão.
 */
export function pontosPorModulo(tamanho: number, lado: number, margem = 1): number {
  const total = tamanho + margem * 2;
  return total > 0 ? lado / total : 0;
}

/** Lado mínimo em pontos para o QR continuar legível na impressão. */
export function ladoMinimoLegivel(tamanho: number, margem = 1, minimoPorModulo = 0.7): number {
  return (tamanho + margem * 2) * minimoPorModulo;
}

/**
 * A TINTA DO QR — `#111827`, não preto puro.
 *
 * O cliente sempre desenhou o QR nesta cor (`color.dark` do `QRCode.toCanvas`),
 * que é a mesma tinta do resto do laudo. Preto puro passa despercebido na tela e
 * é uma divergência de verdade contra o artefato que já está arquivado: dois
 * documentos do MESMO envelope sairiam com QR de cores diferentes conforme
 * tivessem sido montados antes ou depois desta migração.
 *
 * Fica aqui, e não em cada chamador, porque são dois lugares que desenham QR (o
 * rodapé e a ficha do signatário) e eles têm de concordar.
 */
export const TINTA_DO_QR: readonly [number, number, number] = [0.067, 0.094, 0.153];

/**
 * O NÍVEL DE CORREÇÃO DE ERRO do QR do laudo: `H` (recupera ~30%).
 *
 * Não é preferência: é o que o cliente usa hoje (`errorCorrectionLevel: 'H'` em
 * `buildQrPng`), e o motivo é o uso real do documento. O laudo é impresso,
 * fotocopiado, fotografado de celular e às vezes digitalizado torto — `M`
 * (~15%) começa a falhar exatamente nessas condições. Um QR ilegível num
 * documento de prova é o link de verificação perdido.
 *
 * Trocar por `M` também MUDA O DESENHO (outra versão do QR, outra máscara), e a
 * bancada A/B acusaria a página inteira como diferente.
 */
export const CORRECAO_DE_ERRO_DO_QR = 'H' as const;
