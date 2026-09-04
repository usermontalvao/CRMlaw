// ============================================================================
// WORDMARK "jurius.com.br" — PRÉ-RENDERIZADO
// ----------------------------------------------------------------------------
// Última peça de navegador da montagem. No cliente, `renderWordmarkPng()`
// (`src/services/pdfSignature.service.ts`) desenha este texto num canvas, com a
// webfont Spectral baixada da web. Nada disso existe no Deno: não há canvas,
// não há `document.fonts`, e não há arquivo de fonte no repositório.
//
// Então o desenho foi feito UMA vez e virou constante.
//
// COMO ESTE PNG FOI PRODUZIDO, e por que ele é fiel:
//
//   1. `wordmark-lab.html` roda o MESMO código do cliente, no Chrome, com a
//      Spectral de verdade (conferido: `document.fonts.check` verdadeiro, e a
//      largura de "jurius" deu 346,24 px contra 395 px do Georgia de reserva —
//      larguras diferentes provam que não houve fallback silencioso);
//   2. o mesmo desenho foi refeito em Node com `@napi-rs/canvas` e a Spectral
//      baixada do Google Fonts;
//   3. os dois foram COMPARADOS por assinatura de pixels (perfil de tinta por
//      coluna, 40 baldes, normalizado):
//
//        dimensões : 794x149 nos dois
//        ratio     : 5.328859060402684 nos dois (15 casas)
//        desvio    : máximo 0,27% da tinta, médio 0,068%
//
//      A tinta total do Node é 6,8% menor — antialiasing do rasterizador, não
//      posição de glifo. O perfil normalizado é que prova que os glifos caem
//      nos MESMOS lugares.
//
// Medido em 04/09/2026. Ver `docs/assinatura-montagem-no-servidor.md`.
//
// SE FOR PRECISO REGERAR: abra `wordmark-lab.html` no Chrome (o navegador
// embutido serve — a fonte carrega), confira a assinatura, e refaça o render em
// Node. Trocar este PNG muda o laudo, então a bancada
// (`npm run montagem:comparar`) tem de aprovar o antes/depois.
// ============================================================================

/** Largura do PNG em pixels. */
export const WORDMARK_LARGURA = 794;

/** Altura do PNG em pixels. */
export const WORDMARK_ALTURA = 149;

/**
 * Proporção largura/altura. Quem desenha usa isto para escalar sem distorcer —
 * é o mesmo valor que `renderWordmarkPng()` devolve como `ratio`.
 */
export const WORDMARK_RATIO = 794 / 149;

/** O PNG em base64. 16452 bytes de imagem. */
const WORDMARK_PNG_BASE64 =
  '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';

/**
 * Os bytes do PNG, prontos para `pdfDoc.embedPng()`.
 *
 * Decodifica a cada chamada de propósito: quem chama embute num PDFDocument, e
 * guardar um Uint8Array em módulo faria duas montagens simultâneas
 * compartilharem o mesmo buffer. O custo é de microssegundos.
 */
export function wordmarkPngBytes(): Uint8Array {
  const binario = atob(WORDMARK_PNG_BASE64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
