/**
 * A BANCADA DA ÂNCORA — o experimento que decide se o porte do `template-fill`
 * se sustenta.
 *
 * A ideia inteira depende de uma aposta que precisa ser MEDIDA, não presumida:
 *
 *   trocar `[[ASSINATURA]]` por uma imagem inline transparente, mandar o
 *   `.docx` para o `ConvertToPdf` de verdade, e conseguir ler de volta, no PDF
 *   produzido, a posição exata onde essa imagem caiu.
 *
 * Se o Syncfusion descartar a imagem, ou desenhá-la de um jeito que o fluxo de
 * conteúdo não revele, o desenho não funciona e é melhor saber agora — antes de
 * escrever a Edge Function em volta.
 *
 *   npm run ancora:bancada [entrada.docx]
 *
 * Ele imprime, por marcador: a página, a caixa em pontos e a caixa em
 * porcentagem — que é exatamente o que iria para `signature_fields`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, unzlibSync, zipSync } from 'fflate';
import { encode as encodePng } from 'fast-png';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

import { docxParaPdfComAncoras } from '../supabase/functions/_shared/montagem/docxParaPdf.ts';

const ENTRADA = process.argv.find((a) => a.endsWith('.docx'))
  ?? 'tmp/pdfs/kit-trabalhista-source.docx';
const CONVERSOR = 'https://docs.jurius-api.com';

const docx = new Uint8Array(readFileSync(ENTRADA));
console.log(`entrada: ${ENTRADA} (${docx.length} bytes)`);

const conversao = await docxParaPdfComAncoras(docx, 'bancada.docx', CONVERSOR, {
  unzip: unzipSync,
  zip: zipSync,
  inflar: (b) => unzlibSync(b),
  codificarPng: (img) => new Uint8Array(encodePng({ ...img, channels: 4, depth: 8 } as any)),
  PDFDocument, PDFName, PDFRawStream,
  buscar: fetch,
});

writeFileSync('tmp/pdfs/kit-com-ancora.pdf', conversao.pdf);
const pdf = await PDFDocument.load(conversao.pdf);

console.log(`marcadores no .docx ....... ${conversao.marcadores}`);
console.log(`âncoras achadas no PDF .... ${conversao.ancorasLocalizadas}`);
console.log(`pdf ....................... ${conversao.pdf.length} bytes, ${pdf.getPageCount()} páginas`);

for (const campo of conversao.campos) {
  console.log(
    `\n  assinante ${campo.indiceDoAssinante}`
    + `\n    página ..... ${campo.page_number} de ${pdf.getPageCount()}`
    + `\n    campo em % . x=${campo.x_percent.toFixed(2)} y=${campo.y_percent.toFixed(2)} `
    + `w=${campo.w_percent.toFixed(2)} h=${campo.h_percent.toFixed(2)}`,
  );
}

if (conversao.marcadores === 0) {
  console.log('\neste .docx não tem [[ASSINATURA]] — nada a localizar');
  process.exit(0);
}
if (conversao.ancorasLocalizadas < conversao.marcadores) {
  console.error(`\n*** ${conversao.marcadores - conversao.ancorasLocalizadas} ÂNCORA(S) PERDIDA(S) ***`);
  console.error('O conversor engoliu a imagem, ou ela não aparece no fluxo de conteúdo.');
  process.exit(2);
}
console.log(`\n${conversao.ancorasLocalizadas} âncora(s) localizada(s) — o caminho do template-fill é viável.`);
