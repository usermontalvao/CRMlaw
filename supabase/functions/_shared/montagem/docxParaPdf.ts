/**
 * O `.docx` VIRA PDF COM ÂNCORAS — a volta inteira, num lugar só.
 *
 * Junta as três peças: plantar a âncora no lugar do `[[ASSINATURA]]`
 * (`ancoraNoDocx`), mandar para o conversor de verdade, e ler de volta onde
 * cada âncora caiu (`lerAncorasDoPdf`).
 *
 * POR QUE AQUI, E NÃO DENTRO DA EDGE FUNCTION. A bancada
 * (`npm run ancora:bancada`) é o que prova que essa volta funciona contra o
 * `docs.jurius-api.com` real. Se a Edge Function tivesse a sua própria cópia da
 * sequência, a prova valeria para o código da bancada e não para o que roda em
 * produção — que é a forma mais silenciosa de um teste mentir. As duas chamam
 * esta função.
 *
 * As ferramentas entram por parâmetro porque o mesmo arquivo roda no Deno
 * (`npm:fflate`, `npm:pdf-lib@1.17.1`) e na bancada local (os de
 * `node_modules`, nas MESMAS versões).
 *
 * Ver `docs/assinatura-montagem-no-servidor.md`.
 */
import {
  caixaDaAssinatura, comRelacionamentos, comTipoPng, plantarAncoras,
} from './ancoraNoDocx.ts';
import {
  ANCORA_PNG_LARGURA, alturaDoPngDaAncora, campoDaAncora, lerAncorasDoPdf,
} from './lerAncorasDoPdf.ts';

export type FerramentasDaConversao = {
  unzip: (b: Uint8Array) => Record<string, Uint8Array>;
  zip: (pacote: Record<string, Uint8Array>) => Uint8Array;
  /** zlib, não deflate cru — `FlateDecode` do PDF é zlib. */
  inflar: (b: Uint8Array) => Uint8Array;
  codificarPng: (img: { width: number; height: number; data: Uint8Array }) => Uint8Array;
  PDFDocument: any;
  PDFName: any;
  PDFRawStream: any;
  /** Injetado para a bancada poder medir e a função poder ser testada sem rede. */
  buscar: typeof fetch;
};

export type CampoDeMarcador = {
  /** Qual assinante: `[[ASSINATURA]]` é 1; `[[ASSINATURA_2]]` é 2. */
  indiceDoAssinante: number;
  page_number: number;
  x_percent: number;
  y_percent: number;
  w_percent: number;
  h_percent: number;
};

export type ConversaoDoDocx = {
  pdf: Uint8Array;
  campos: CampoDeMarcador[];
  /** Quantos `[[ASSINATURA]]` o `.docx` tinha. */
  marcadores: number;
  /** Quantas âncoras foram achadas no PDF. Menos que `marcadores` é alarme. */
  ancorasLocalizadas: number;
};

/** O PNG transparente da âncora `n` — a ALTURA dele é a identidade no PDF. */
export function pngDaAncora(
  indice: number,
  codificarPng: FerramentasDaConversao['codificarPng'],
): Uint8Array {
  const width = ANCORA_PNG_LARGURA;
  const height = alturaDoPngDaAncora(indice);
  // Tudo zero em RGBA = totalmente transparente. A âncora não pode aparecer no
  // documento: ela existe para ser MEDIDA, não vista.
  return codificarPng({ width, height, data: new Uint8Array(width * height * 4) });
}

function pareceUmPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50
    && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/**
 * Converte, e devolve os campos de assinatura que os marcadores viraram.
 *
 * `marcadores` e `ancorasLocalizadas` vêm SEPARADOS de propósito: se o
 * documento tinha 2 marcadores e só 1 âncora foi localizada, alguma coisa
 * aconteceu na conversão — e o chamador precisa poder gritar, em vez de receber
 * uma lista curta que parece completa.
 *
 * Documento SEM marcador é convertido do mesmo jeito, mas sem tocar no pacote:
 * reescrever o ZIP sem necessidade mudaria bytes à toa antes do congelamento.
 */
export async function docxParaPdfComAncoras(
  docx: Uint8Array,
  nomeDoArquivo: string,
  baseDoConversor: string,
  f: FerramentasDaConversao,
): Promise<ConversaoDoDocx> {
  const pacote = f.unzip(docx);
  const documentXml = pacote['word/document.xml'];
  if (!documentXml) throw new Error('.docx sem word/document.xml');

  const decodificar = (b: Uint8Array) => new TextDecoder().decode(b);
  const codificar = (s: string) => new TextEncoder().encode(s);

  const plano = plantarAncoras(decodificar(documentXml));

  if (plano.ancoras.length > 0) {
    const rels: string[] = [];
    plano.ancoras.forEach((a, i) => {
      const midia = `media/ancora-assinatura-${i + 1}.png`;
      pacote[`word/${midia}`] = pngDaAncora(i + 1, f.codificarPng);
      rels.push(`<Relationship Id="${a.relId}" Type="http://schemas.openxmlformats.org/`
        + `officeDocument/2006/relationships/image" Target="${midia}"/>`);
    });
    pacote['word/document.xml'] = codificar(plano.xml);

    const caminhoDosRels = 'word/_rels/document.xml.rels';
    if (pacote[caminhoDosRels]) {
      pacote[caminhoDosRels] = codificar(
        comRelacionamentos(decodificar(pacote[caminhoDosRels]), rels.join('')));
    }
    if (pacote['[Content_Types].xml']) {
      pacote['[Content_Types].xml'] = codificar(
        comTipoPng(decodificar(pacote['[Content_Types].xml'])));
    }
  }

  const paraConverter = plano.ancoras.length > 0 ? f.zip(pacote) : docx;

  const resposta = await f.buscar(
    `${baseDoConversor}/api/documenteditor/ConvertToPdf`
    + `?fileName=${encodeURIComponent(nomeDoArquivo)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: paraConverter },
  );
  if (!resposta.ok) {
    throw new Error(
      `ConvertToPdf devolveu ${resposta.status}: ${(await resposta.text()).slice(0, 200)}`);
  }
  const pdf = new Uint8Array(await resposta.arrayBuffer());
  // O `Export` do word-processor devolve 200 com `application/msword` quando não
  // sabe converter (medido em 30/07/2026). Conferir os bytes é o que separa
  // "converteu" de "respondeu".
  if (!pareceUmPdf(pdf)) throw new Error('ConvertToPdf não devolveu um PDF');

  const campos: CampoDeMarcador[] = [];
  let ancorasLocalizadas = 0;

  if (plano.ancoras.length > 0) {
    const doc = await f.PDFDocument.load(pdf);
    const localizadas = lerAncorasDoPdf(
      doc,
      { PDFName: f.PDFName, PDFRawStream: f.PDFRawStream, inflar: f.inflar },
      plano.ancoras.length,
    );
    ancorasLocalizadas = localizadas.length;

    for (const ancora of localizadas) {
      const planejada = plano.ancoras[ancora.indiceDaAncora - 1];
      if (!planejada) continue;
      const campo = campoDaAncora(ancora, (ponto, larg, alt) => caixaDaAssinatura(ponto, larg, alt));
      if (!campo) continue;
      campos.push({ indiceDoAssinante: planejada.indiceDoAssinante, ...campo });
    }
  }

  return { pdf, campos, marcadores: plano.ancoras.length, ancorasLocalizadas };
}
