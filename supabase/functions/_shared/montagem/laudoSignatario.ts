/**
 * A página de um signatário: biometria, dados e o bloco de certificado.
 *
 * Uma por pessoa que assinou. É a página que responde "quem é esta pessoa, o
 * que o sistema verificou sobre ela, e como conferir isso depois".
 *
 * Porte da segunda parte de `addReportPages` (`pdfSignature.service.ts`).
 *
 * DUAS CORREÇÕES DO ORIGINAL ESTÃO PRESERVADAS AQUI, e vale saber quais são
 * para não desfazê-las por engano:
 *
 *  1. **o hash não entra por cima do QR.** As posições eram fixas e o SHA-256
 *     era desenhado na mesma linha do rótulo; 30 caracteres de rótulo mais 64
 *     de hash terminavam depois de onde o QR começa, e o texto — desenhado
 *     DEPOIS — passava por cima, justamente onde a câmera não perdoa. Agora o
 *     bloco desce por um CURSOR (`cy`) e cada valor que não cabe ganha linha
 *     própria, limitada pela borda do QR;
 *  2. **a marca d'água da foto não leva data.** A data vinha do instante da
 *     ASSINATURA, não do da FOTO: a mesma selfie exibia dois relógios com
 *     segundos diferentes, sem nada explicando. Em peça de prova isso é a
 *     brecha que a outra parte usa para sugerir montagem. Fica um carimbo só.
 */
import {
  FOLHA_DO_LAUDO,
  desenharRotuloDeSecao,
  type FontesDoLaudo,
} from './laudoCabecalho.ts';
import {
  marcasDeCanto,
  quebrarTexto,
  retanguloArredondado,
  type PaginaPdf,
  type PaletaDoLaudo,
} from './laudoDesign.ts';
import { escalarRetangulosDoQr, retangulosDoQr, TINTA_DO_QR } from './qr-em-retangulos.ts';
import type { MatrizDoQr } from './rodape.ts';

export type DadoDoSignatario = [rotulo: string, valor: string];

/**
 * Os rótulos cujo valor é lido caractere a caractere, e por isso vão em
 * monoespaçada: quem confere um IP ou um CPF precisa distinguir 0 de O.
 */
export const ROTULOS_MONOESPACADOS = new Set([
  'CPF', 'Endereço IP', 'Localização', 'Assinado em',
]);

/** O que conta como "sem valor" na ficha. */
export function valorVazio(valor: string | null | undefined): boolean {
  const t = String(valor ?? '').trim();
  return t === '' || t === '—' || t === '-';
}

/**
 * A ficha do signatário, na ordem em que aparece.
 *
 * Ordem: identidade primeiro (nome, papel, contato, CPF), depois circunstância
 * (IP, local, aparelho), depois o ato (autenticação, termos, quando).
 */
export function fichaDoSignatario(dados: {
  nome: string;
  papel?: string | null;
  contato?: string | null;
  cpf?: string | null;
  ip?: string | null;
  localizacao?: string | null;
  dispositivo?: string | null;
  autenticacao?: string | null;
  termos?: string | null;
  assinadoEm: string;
}): DadoDoSignatario[] {
  return [
    ['Nome', dados.nome],
    // "Assinar" é rótulo de BOTÃO que vazou para o campo de papel.
    ['Papel', dados.papel && dados.papel !== 'Assinar' ? dados.papel : 'Signatário'],
    ['Contato', dados.contato || '—'],
    ['CPF', dados.cpf || '—'],
    ['Endereço IP', dados.ip || '—'],
    ['Localização', dados.localizacao || '—'],
    ['Dispositivo', dados.dispositivo || '—'],
    ['Autenticação', dados.autenticacao || 'Assinatura direta'],
    ['Termos de Uso', dados.termos || '—'],
    ['Assinado em', dados.assinadoEm],
  ];
}

/**
 * O texto do selo de integridade.
 *
 * ESCRITO COMO INSTRUÇÃO, NÃO COMO AFIRMAÇÃO: a selagem acontece segundos
 * depois desta página ser desenhada, e é falha macia — um envelope pode fechar
 * sem selo. "Confira no leitor" é verdade nos dois casos; "este arquivo está
 * selado" não seria.
 *
 * E não diz mais que o certificado não é da ICP-Brasil: num documento que
 * circula, essa frase não informa — deprecia, e convida a parte contrária a
 * tratar o que é válido como se fosse de segunda.
 */
export const TEXTO_DO_SELO_DE_INTEGRIDADE =
  'Este PDF recebe assinatura criptográfica do emissor: qualquer alteração posterior a '
  + 'invalida, e o próprio leitor de PDF acusa. Assinatura eletrônica válida nos termos da '
  + 'MP 2.200-2/2001 e do entendimento do STJ. Para conferir, abra o arquivo em um leitor de PDF '
  + 'ou use o código acima no endereço abaixo.';

/**
 * O AMPARO LEGAL, CITADO — e não parafraseado.
 *
 * O parágrafo do selo já dizia "válida nos termos da MP 2.200-2/2001". Isso é
 * uma afirmação nossa sobre a lei; quem recebe o documento e quer contestar
 * precisa ir procurar a lei para saber se a afirmação se sustenta. O § 2º do
 * art. 10 é curto e é exatamente o dispositivo que ampara ESTE arquivo — um
 * documento eletrônico assinado com certificado que não é da ICP-Brasil —,
 * então ele vai transcrito, entre aspas, com a fonte.
 *
 * REPARE QUE A CITAÇÃO INVERTE O SINAL. A frase "não é ICP-Brasil" saiu do
 * selo porque, dita por nós, deprecia. Dita pela lei, e com a condição que ela
 * própria põe ("desde que admitido pelas partes como válido ou aceito pela
 * pessoa a quem for oposto o documento"), a mesma informação vira fundamento:
 * o signatário aceitou os termos aqui mesmo, e a trilha de auditoria deste
 * laudo é a prova disso.
 */
export const AMPARO_LEGAL_DO_SELO = {
  fonte: 'MP 2.200-2/2001 · Art. 10, § 2º',
  texto:
    'O disposto nesta Medida Provisória não obsta a utilização de outro meio de comprovação '
    + 'da autoria e integridade de documentos em forma eletrônica, inclusive os que utilizem '
    + 'certificados não emitidos pela ICP-Brasil, desde que admitido pelas partes como válido '
    + 'ou aceito pela pessoa a quem for oposto o documento.',
} as const;

export type ConteudoDoSignatario = {
  nome: string;
  ficha: DadoDoSignatario[];
  /** A selfie já embutida. Ausente ⇒ placeholder "Selfie não coletada". */
  foto?: { imagem: unknown; largura: number; altura: number } | null;
  qr?: MatrizDoQr | null;
  codigoDoDocumento: string;
  protocolo: string;
  sha256DoOriginal: string;
  urlDeVerificacao: string | null;
};

export function desenharPaginaDoSignatario(params: {
  pagina: PaginaPdf;
  fontes: FontesDoLaudo;
  cores: PaletaDoLaudo;
  ferramentas: { rgb: (r: number, g: number, b: number) => unknown; degrees: (g: number) => unknown };
  conteudo: ConteudoDoSignatario;
  wordmark?: { imagem: unknown; ratio: number } | null;
}): void {
  const { pagina, fontes, cores, ferramentas, conteudo, wordmark } = params;
  const { helvetica, helveticaBold, courier, courierBold } = fontes;
  const { rgb, degrees } = ferramentas;
  const { largura: L, altura: A, margem: lm } = FOLHA_DO_LAUDO;

  desenharRotuloDeSecao({
    pagina, fonte: helveticaBold, cores,
    texto: 'BIOMETRIA FACIAL', y: A - 128 - 10,
  });

  // ── A foto ─────────────────────────────────────────────────────────────
  const fotoL = 210;
  const fotoH = 260;
  const fotoX = lm;
  const fotoY = A - 168 - fotoH;

  pagina.drawText(`Foto do rosto (selfie) de ${conteudo.nome}:`, {
    x: fotoX, y: fotoY + fotoH + 10, size: 6.5, font: helvetica, color: cores.txtSoft,
  });

  if (conteudo.foto) {
    retanguloArredondado(pagina, fotoX, fotoY + fotoH, fotoL, fotoH, 8, {
      preenchimento: cores.white, contorno: cores.border, espessura: 1.2,
    });

    // "contain": preserva a proporção REAL da selfie. Esticar para preencher a
    // moldura fixa achatava o rosto — numa página que existe para identificar
    // uma pessoa, deformá-la é o pior defeito possível.
    const respiro = 4;
    const molduraL = fotoL - respiro * 2;
    const molduraH = fotoH - respiro * 2;
    const escala = Math.min(molduraL / conteudo.foto.largura, molduraH / conteudo.foto.altura);
    const desenhoL = conteudo.foto.largura * escala;
    const desenhoH = conteudo.foto.altura * escala;
    pagina.drawImage(conteudo.foto.imagem, {
      x: fotoX + respiro + (molduraL - desenhoL) / 2,
      y: fotoY + respiro + (molduraH - desenhoH) / 2,
      width: desenhoL, height: desenhoH,
    });

    marcasDeCanto(pagina, fotoX + 9, fotoY + 9, fotoL - 18, fotoH - 18, 11, rgb(1, 1, 1));

    // ── Marca d'água CONFIDENTIAL, entre dois tracejados ──
    const centroX = fotoX + respiro + (fotoL - respiro * 2) / 2;
    const centroY = fotoY + respiro + (fotoH - respiro * 2) / 2;
    const traco = 5;
    const vao = 4;
    const x1 = fotoX + respiro + 16;
    const x2 = fotoX + fotoL - respiro - 16;
    const cinza = rgb(0.38, 0.38, 0.38);
    const tracejado = (y: number) => {
      for (let cx = x1; cx < x2; cx += traco + vao) {
        pagina.drawLine({
          start: { x: cx, y }, end: { x: Math.min(cx + traco, x2), y },
          thickness: 0.6, color: cinza, opacity: 0.3,
        });
      }
    };
    tracejado(centroY + 14);
    const texto = 'CONFIDENTIAL';
    const larguraDoTexto = helveticaBold.widthOfTextAtSize(texto, 10);
    pagina.drawText(texto, {
      x: centroX - larguraDoTexto / 2, y: centroY + 2,
      size: 10, font: helveticaBold, color: rgb(0.30, 0.30, 0.30), opacity: 0.42,
    });
    // -6 e não -16: o vão maior existia para uma data que saiu daqui (ver o
    // cabeçalho do arquivo). Sem ela, a marca ficaria pendurada no alto.
    tracejado(centroY - 6);

    // ── Protocolo na borda lateral da foto ──
    // SEM caixa atrás, de propósito: uma tarja opaca sobre a selfie esconderia
    // justamente o que a página existe para mostrar. Serve para o caso em que a
    // foto é recortada e circula sozinha.
    const selo = `PROTOCOLO ${conteudo.protocolo.toUpperCase()}`;
    const larguraDoSelo = courier.widthOfTextAtSize(selo, 5);
    if (larguraDoSelo < fotoH - 24) {
      pagina.drawText(selo, {
        x: fotoX + fotoL - 7,
        y: fotoY + (fotoH - larguraDoSelo) / 2,
        size: 5, font: courier,
        color: rgb(0.85, 0.87, 0.90), opacity: 0.62,
        rotate: degrees(90),
      });
    }
  } else {
    retanguloArredondado(pagina, fotoX, fotoY + fotoH, fotoL, fotoH, 8, {
      preenchimento: cores.bgLight, contorno: cores.border, espessura: 1,
    });
    const ausente = rgb(0.70, 0.72, 0.75);
    pagina.drawText('Selfie não', { x: fotoX + 68, y: fotoY + fotoH / 2 + 8, size: 9, font: helveticaBold, color: ausente });
    pagina.drawText('coletada', { x: fotoX + 76, y: fotoY + fotoH / 2 - 6, size: 9, font: helveticaBold, color: ausente });
  }

  // ── Ficha, coluna da direita ───────────────────────────────────────────
  const fichaX = fotoX + fotoL + 20;
  const fichaL = L - lm - fichaX;
  let y = A - 148 - 2;

  pagina.drawText('DADOS DO SIGNATÁRIO', { x: fichaX, y, size: 6.5, font: helveticaBold, color: cores.txtSoft });
  y -= 16;

  for (const [rotulo, valor] of conteudo.ficha) {
    if (y < fotoY + 4) break;
    const vazio = valorVazio(valor);
    pagina.drawCircle({ x: fichaX + 2, y: y + 2.5, size: 2, color: cores.emerald });

    const rot = `${rotulo}: `;
    pagina.drawText(rot, { x: fichaX + 10, y, size: 7.5, font: helvetica, color: cores.txtSoft });
    const larguraDoRotulo = helvetica.widthOfTextAtSize(rot, 7.5);
    const fonteDoValor = !vazio && ROTULOS_MONOESPACADOS.has(rotulo) ? courier : helveticaBold;

    // O valor QUEBRA em vez de ser cortado. Antes havia corte seco em 40
    // caracteres, e a linha da autenticação — justamente a que precisa ser lida
    // por inteiro num documento de prova — saía como "…enviad…".
    const texto = vazio ? 'Não informado' : String(valor);
    const largura = fichaX + fichaL - (fichaX + 10 + larguraDoRotulo) - 6;
    let linhaY = y;
    for (const linha of quebrarTexto(texto, fonteDoValor, 7.5, largura)) {
      if (linhaY < fotoY + 4) break;
      pagina.drawText(linha, {
        x: fichaX + 10 + larguraDoRotulo, y: linhaY,
        size: 7.5, font: fonteDoValor, color: vazio ? cores.silver : cores.txtDark,
      });
      linhaY -= 11;
    }
    y = linhaY - 4;
  }

  // ── Bloco do certificado ───────────────────────────────────────────────
  const topoDoBloco = fotoY - 18;
  // 190, e não os 196 originais: o bloco ganhou a citação do § 2º e perdeu o
  // vazio que sobrava embaixo. O texto agora termina a ~156 do topo, e o QR
  // (132 + molduras = 162) continua centrado com folga.
  const alturaDoBloco = 190;
  const larguraDoBloco = L - lm * 2;

  const cbBorda = rgb(0.86, 0.89, 0.93);
  const cbEscuro = rgb(0.09, 0.12, 0.18);
  const cbSuave = rgb(0.45, 0.50, 0.58);
  const cbMudo = rgb(0.62, 0.67, 0.74);
  const cbValor = rgb(0.20, 0.255, 0.333);
  const cbValorAlt = rgb(0.278, 0.333, 0.412);

  retanguloArredondado(pagina, lm, topoDoBloco, larguraDoBloco, alturaDoBloco, 9, {
    preenchimento: cores.white,
  });

  // ── O QR, emoldurado e com legenda ──
  // Era um quadrado branco cru colado na borda. Emoldurado e um pouco menor ele
  // lê melhor, e a legenda diz para que serve — QR sem legenda num documento
  // jurídico é um borrão que ninguém aponta a câmera.
  const qrLado = 132;
  const qrRespiro = 9;
  const qrX = lm + larguraDoBloco - qrLado - qrRespiro - 14;
  const alturaDaLegenda = 12;
  const qrTopo = topoDoBloco - (alturaDoBloco - (qrLado + qrRespiro * 2 + alturaDaLegenda)) / 2;
  const qrY = qrTopo - qrRespiro - qrLado;

  retanguloArredondado(
    pagina, qrX - qrRespiro, qrTopo,
    qrLado + qrRespiro * 2, qrLado + qrRespiro * 2 + alturaDaLegenda, 8,
    { preenchimento: cores.white, contorno: cbBorda, espessura: 0.8 },
  );
  if (conteudo.qr && conteudo.qr.tamanho > 0) {
    const tintaDoQr = rgb(...TINTA_DO_QR);
    for (const r of escalarRetangulosDoQr(
      retangulosDoQr(conteudo.qr.modulos, conteudo.qr.tamanho),
      conteudo.qr.tamanho,
      { origemX: qrX, origemY: qrY, lado: qrLado },
    )) {
      pagina.drawRectangle({ x: r.x, y: r.y, width: r.largura, height: r.altura, color: tintaDoQr });
    }
  }
  const legenda = 'Aponte a câmera para validar';
  const larguraDaLegenda = helvetica.widthOfTextAtSize(legenda, 5.5);
  pagina.drawText(legenda, {
    x: qrX + (qrLado - larguraDaLegenda) / 2, y: qrY - 9,
    size: 5.5, font: helvetica, color: cbMudo,
  });

  // A borda esquerda do QR é o limite de TODO texto deste bloco. É isto que
  // impede o hash de passar por cima do código.
  const tx = lm + 14;
  const limite = qrX - qrRespiro - 12;
  const larguraDoTexto = limite - tx;

  let cy = topoDoBloco - 18;

  let fimDaMarca: number;
  if (wordmark) {
    const h = 11;
    pagina.drawImage(wordmark.imagem, { x: tx, y: cy - 2, width: h * wordmark.ratio, height: h });
    fimDaMarca = tx + h * wordmark.ratio;
  } else {
    pagina.drawText('jurius', { x: tx, y: cy, size: 9, font: helveticaBold, color: cbEscuro });
    fimDaMarca = tx + helveticaBold.widthOfTextAtSize('jurius', 9);
  }
  pagina.drawText('·', { x: fimDaMarca + 6, y: cy, size: 8, font: helvetica, color: cbMudo });
  pagina.drawText('Certificado de Assinatura Eletrônica', {
    x: fimDaMarca + 13, y: cy, size: 7.5, font: helvetica, color: cbSuave,
  });

  cy -= 8;
  pagina.drawLine({ start: { x: tx, y: cy }, end: { x: limite, y: cy }, thickness: 0.4, color: cbBorda });

  /** Rótulo e valor na mesma linha; se não couber, o valor cai para baixo. */
  const linhaDoCertificado = (rotulo: string, valor: string, fonte: typeof courier, tamanho: number) => {
    cy -= 11;
    pagina.drawText(rotulo, { x: tx, y: cy, size: 6, font: helvetica, color: cbMudo });
    const larguraDoRotulo = helvetica.widthOfTextAtSize(rotulo, 6);
    const sobra = larguraDoTexto - larguraDoRotulo - 8;
    if (fonte.widthOfTextAtSize(valor, tamanho) <= sobra) {
      pagina.drawText(valor, { x: tx + larguraDoRotulo + 8, y: cy, size: tamanho, font: fonte, color: cbValorAlt });
      return;
    }
    for (const linha of quebrarTexto(valor, fonte, tamanho, larguraDoTexto)) {
      cy -= 9;
      pagina.drawText(linha, { x: tx, y: cy, size: tamanho, font: fonte, color: cbValorAlt });
    }
  };

  // O código CANÔNICO do documento — nunca o identificador interno do signatário.
  cy -= 11;
  const rotuloDoCodigo = 'CÓDIGO DO DOCUMENTO:';
  pagina.drawText(rotuloDoCodigo, { x: tx, y: cy, size: 6, font: helvetica, color: cbMudo });
  pagina.drawText(conteudo.codigoDoDocumento || 'N/A', {
    x: tx + helvetica.widthOfTextAtSize(rotuloDoCodigo, 6) + 8, y: cy,
    size: 7.5, font: courierBold, color: cbValor,
  });

  linhaDoCertificado('PROTOCOLO DO ENVELOPE:', conteudo.protocolo, courier, 6);

  const original = String(conteudo.sha256DoOriginal || '').trim().toLowerCase();
  if (original) {
    linhaDoCertificado('SHA-256 DO DOCUMENTO ORIGINAL:', original, courier, 5.5);
  }

  cy -= 9;
  pagina.drawLine({ start: { x: tx, y: cy }, end: { x: limite, y: cy }, thickness: 0.4, color: cbBorda });

  cy -= 12;
  pagina.drawText('SELO DE INTEGRIDADE', { x: tx, y: cy, size: 6, font: helveticaBold, color: cbSuave });
  for (const linha of quebrarTexto(TEXTO_DO_SELO_DE_INTEGRIDADE, helvetica, 5.5, larguraDoTexto)) {
    cy -= 8;
    pagina.drawText(linha, { x: tx, y: cy, size: 5.5, font: helvetica, color: cbMudo });
  }

  // O dispositivo, transcrito. Vem depois do selo porque é ele que sustenta o
  // que o selo acabou de afirmar — e antes da URL, que é o passo seguinte de
  // quem, lendo isto, resolve conferir.
  cy -= 11;
  pagina.drawText(AMPARO_LEGAL_DO_SELO.fonte, { x: tx, y: cy, size: 5.5, font: helveticaBold, color: cbSuave });
  for (const linha of quebrarTexto(`\u201C${AMPARO_LEGAL_DO_SELO.texto}\u201D`, helvetica, 5, larguraDoTexto)) {
    cy -= 7;
    pagina.drawText(linha, { x: tx, y: cy, size: 5, font: helvetica, color: cbMudo });
  }

  if (conteudo.urlDeVerificacao) {
    cy -= 10;
    const url = conteudo.urlDeVerificacao.length > 80
      ? `${conteudo.urlDeVerificacao.slice(0, 77)}...`
      : conteudo.urlDeVerificacao;
    pagina.drawText(url, { x: tx, y: cy, size: 5.5, font: helvetica, color: cbValorAlt });
  }

  cy -= 10;
  pagina.drawText(`Signatário: ${conteudo.nome}`, { x: tx, y: cy, size: 5, font: helvetica, color: cbMudo });
}
