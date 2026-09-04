// ============================================================================
// O "J" DA MARCA — o ícone do papel timbrado do laudo.
// ----------------------------------------------------------------------------
// No cliente ele vem de `getLogoBytes()` (`src/utils/logoBase64.ts`), que faz
// `fetch('/logo.png')` — uma requisição ao próprio site. No Deno não há site
// nem `/logo.png`: a Edge Function é a origem, não um navegador visitando-a.
//
// Então o arquivo virou constante, como o wordmark ao lado.
//
// O ORIGINAL TEM 1254×1254 E 306 KB, e embutir isso aqui seria 409 KB de
// base64 num módulo que sobe a cada deploy — para desenhar um quadrado de 20
// pontos. A cópia foi reduzida para 128×128 (12.967 bytes), o que ainda é 6,4×
// a resolução em que ela é desenhada.
//
// A FIDELIDADE FOI MEDIDA, NÃO ASSUMIDA. Comparando a original e a reduzida
// depois de ambas serem levadas ao tamanho de desenho e compostas sobre branco
// — que é o que o leitor de PDF mostra:
//
//     40 px  desvio médio 0,57 de 255   máximo  9
//     60 px  desvio médio 0,56 de 255   máximo  8
//     83 px  desvio médio 0,44 de 255   máximo 11
//
// Menos de 0,25% de desvio médio, invisível a olho nu. (Sem essa composição o
// número engana: os pixels totalmente transparentes da moldura têm RGB
// indefinido e inflam a média sem nada aparecer na folha.)
//
// A quantização de paleta foi DESCARTADA no caminho: ela derrubava o arquivo
// para 6 KB, mas o dithering introduzia ruído de 33/255 na própria resolução da
// imagem. Economia que suja o desenho não é economia.
//
// Medido em 04/09/2026. Ver `docs/assinatura-montagem-no-servidor.md`.
//
// SE FOR PRECISO REGERAR: reduza `public/logo.png` para 128×128 com Lanczos, em
// PNG sem paleta, e refaça a medição acima antes de trocar. Mudar este ícone
// muda o laudo, então a bancada (`npm run montagem:comparar`) tem de aprovar o
// antes e o depois.
// ============================================================================

/** Lado do PNG em pixels. Quadrado — o lockup do cabeçalho conta com isso. */
export const LOGO_LADO = 128;

/** O PNG em base64. 12967 bytes de imagem. */
const LOGO_PNG_BASE64 =
  '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' +
  'RU5ErkJggg==';

/**
 * Os bytes do PNG, prontos para `pdfDoc.embedPng()`.
 *
 * Decodifica a cada chamada de propósito: quem chama embute num PDFDocument, e
 * guardar um Uint8Array em módulo faria duas montagens simultâneas
 * compartilharem o mesmo buffer.
 */
export function logoPngBytes(): Uint8Array {
  const binario = atob(LOGO_PNG_BASE64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
