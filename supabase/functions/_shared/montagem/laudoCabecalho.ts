/**
 * O cabeçalho das páginas do laudo — o papel timbrado.
 *
 * As três páginas (capa, signatário, histórico) começam com ele, então portá-lo
 * uma vez é o que impede as três de divergirem.
 *
 * Porte de `createReportHeader` (`pdfSignature.service.ts`), com os mesmos
 * números.
 */
import { nomeParaCabecalho, type Cor, type FonteQueMede, type PaginaPdf, type PaletaDoLaudo } from './laudoDesign.ts';

/** As medidas da folha do laudo. Sempre A4 retrato. */
export const FOLHA_DO_LAUDO = {
  largura: 595.28,
  altura: 841.89,
  /** Margem esquerda (e direita, por simetria). */
  margem: 50,
} as const;

/**
 * Distância entre a base do cabeçalho e o começo do conteúdo.
 *
 * Constante nomeada porque as três páginas precisam do MESMO valor: se cada uma
 * chutar o próprio respiro, o laudo fica com o conteúdo dançando de página para
 * página.
 */
export const RESPIRO_APOS_CABECALHO = 10;

export type FontesDoLaudo = {
  helvetica: FonteQueMede;
  helveticaBold: FonteQueMede;
  courier: FonteQueMede;
  courierBold: FonteQueMede;
};

export type IdentidadeDoLaudo = {
  /** Nome do documento (do arquivo em escopo, no per_document). */
  nomeDoDocumento: string | null;
  /** Código de verificação, já em maiúsculas. */
  codigo: string;
  /** `signature_requests.id`. */
  protocolo: string;
  /** Data/hora de emissão, já formatada no fuso do escritório. */
  emitidoEm: string;
};

export function desenharCabecalhoDoLaudo(params: {
  pagina: PaginaPdf;
  fontes: FontesDoLaudo;
  cores: PaletaDoLaudo;
  identidade: IdentidadeDoLaudo;
  /** Rótulo da página, à direita ("CERTIFICADO DE ASSINATURA"). */
  titulo: string;
  /**
   * Quando presente, substitui a grade código/protocolo por uma linha só.
   * A página do histórico usa isso; a capa não.
   */
  subtitulo?: string | null;
  /** O "J" da marca. */
  logo?: unknown | null;
  /** Wordmark pré-renderizado. Sem ele, escreve "jurius" em Helvetica. */
  wordmark?: { imagem: unknown; ratio: number } | null;
}): void {
  const { pagina, fontes, cores, identidade, titulo, subtitulo, logo, wordmark } = params;
  const { helvetica, helveticaBold, courier, courierBold } = fontes;
  const { largura: L, altura: A, margem: lm } = FOLHA_DO_LAUDO;

  // Acento superior laranja.
  pagina.drawRectangle({ x: 0, y: A - 2.5, width: L, height: 2.5, color: cores.orange });

  // O lockup da marca: ícone + wordmark travados no MESMO eixo vertical. Cada
  // um centrado na própria altura, senão o "J" flutua acima do texto.
  const marcaY = A - 32;
  const ladoDoLogo = 20;
  const centroDoLockup = marcaY - 5;
  if (logo) {
    pagina.drawImage(logo, {
      x: lm, y: centroDoLockup - ladoDoLogo / 2,
      width: ladoDoLogo, height: ladoDoLogo,
    });
  }
  const marcaX = lm + ladoDoLogo + 9;
  if (wordmark) {
    const h = 12;
    pagina.drawImage(wordmark.imagem, {
      x: marcaX, y: centroDoLockup - h / 2,
      width: h * wordmark.ratio, height: h,
    });
  } else {
    pagina.drawText('jurius', { x: marcaX, y: centroDoLockup - 4, size: 11, font: helveticaBold, color: cores.navy });
  }

  // Rótulo da página e data, alinhados à DIREITA.
  const rotulo = titulo.toUpperCase();
  const larguraDoRotulo = helveticaBold.widthOfTextAtSize(rotulo, 7.5);
  pagina.drawText(rotulo, { x: L - lm - larguraDoRotulo, y: marcaY + 3, size: 7.5, font: helveticaBold, color: cores.txtSoft });
  const larguraDaData = helvetica.widthOfTextAtSize(identidade.emitidoEm, 7);
  pagina.drawText(identidade.emitidoEm, { x: L - lm - larguraDaData, y: marcaY - 7, size: 7, font: helvetica, color: cores.silver });

  pagina.drawLine({
    start: { x: lm, y: A - 46 }, end: { x: L - lm, y: A - 46 },
    thickness: 0.6, color: cores.border,
  });

  // Nome do documento. Sem extensão: o laudo fala do DOCUMENTO, e depois do
  // congelamento a extensão nem é mais a que o autor enviou.
  pagina.drawText(nomeParaCabecalho(identidade.nomeDoDocumento), {
    x: lm, y: A - 68, size: 14, font: helveticaBold, color: cores.navy,
  });

  if (subtitulo) {
    pagina.drawText(subtitulo, { x: lm, y: A - 84, size: 8, font: helvetica, color: cores.txtSoft });
  } else {
    // Grade rótulo→valor: código em destaque, protocolo abaixo. Os dois em
    // monoespaçada, porque são para ser CONFERIDOS caractere a caractere.
    let y = A - 82;
    if (identidade.codigo) {
      const rot = 'Código de verificação';
      pagina.drawText(rot, { x: lm, y, size: 6.5, font: helvetica, color: cores.silver });
      pagina.drawText(identidade.codigo, {
        x: lm + helvetica.widthOfTextAtSize(rot, 6.5) + 8, y: y - 0.5,
        size: 8.5, font: courierBold, color: cores.txtDark,
      });
      y -= 12;
    }
    const rotProto = 'Protocolo';
    pagina.drawText(rotProto, { x: lm, y, size: 6.5, font: helvetica, color: cores.silver });
    pagina.drawText(identidade.protocolo, {
      x: lm + helvetica.widthOfTextAtSize(rotProto, 6.5) + 8, y: y - 0.5,
      size: 7.5, font: courier, color: cores.txtSoft,
    });
  }

  pagina.drawLine({
    start: { x: lm, y: A - 104 }, end: { x: L - lm, y: A - 104 },
    thickness: 0.6, color: cores.borderSoft,
  });
}

/** Onde o conteúdo de uma página do laudo pode começar. */
export function topoDoConteudo(): number {
  return FOLHA_DO_LAUDO.altura - 116 - RESPIRO_APOS_CABECALHO;
}

/**
 * O rótulo de seção: barrinha laranja, texto e o fio até a margem direita.
 *
 * Devolve o y da linha, para quem precisa empilhar conteúdo abaixo.
 */
export function desenharRotuloDeSecao(params: {
  pagina: PaginaPdf;
  fonte: FonteQueMede;
  cores: PaletaDoLaudo;
  texto: string;
  y: number;
}): void {
  const { pagina, fonte, cores, texto, y } = params;
  const { largura: L, margem: lm } = FOLHA_DO_LAUDO;

  pagina.drawRectangle({ x: lm, y: y - 1, width: 3, height: 12, color: cores.orange });
  pagina.drawText(texto, { x: lm + 10, y, size: 8.5, font: fonte, color: cores.txtDark });
  const larguraDoTexto = fonte.widthOfTextAtSize(texto, 8.5);
  pagina.drawLine({
    start: { x: lm + 20 + larguraDoTexto, y: y + 3 }, end: { x: L - lm, y: y + 3 },
    thickness: 0.5, color: cores.borderSoft,
  });
}
