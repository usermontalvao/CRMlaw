/**
 * O rodapé de assinatura e o carimbo lateral — porte do desenho do cliente.
 *
 * Estas são as marcas que aparecem em TODA folha de conteúdo do documento
 * assinado: a faixa branca embaixo (marca, código de verificação, protocolo,
 * SHA-256 do original e QR) e o texto girado nas margens.
 *
 * PORTE FIEL, NÃO REESCRITA. Cada número aqui — tamanho de fonte, tracking,
 * margem, cor — foi copiado de `pdfSignature.service.ts`. A tentação de
 * "arrumar" o layout no caminho tem de ser resistida: o documento assinado é
 * prova, e mudança de aparência é mudança que alguém precisa aprovar olhando,
 * não um efeito colateral de refatoração. Quem quiser mexer no visual, mexa
 * depois, com a bancada mostrando o antes e o depois.
 *
 * O pdf-lib é recebido por parâmetro (`rgb`, `degrees`, `PDFString`) em vez de
 * importado: o mesmo arquivo roda no Deno com `npm:pdf-lib@1.17.1` e na bancada
 * local com o pdf-lib de `node_modules`, sem duas cópias divergindo.
 */
import { escalarRetangulosDoQr, retangulosDoQr, TINTA_DO_QR } from './qr-em-retangulos.ts';

/** As peças do pdf-lib que o desenho usa. */
export type FerramentasPdf = {
  rgb: (r: number, g: number, b: number) => unknown;
  degrees: (graus: number) => unknown;
  PDFString: { of: (texto: string) => unknown };
};

/** Uma fonte embutida, do ponto de vista de quem só precisa medir e escrever. */
export type Fonte = {
  widthOfTextAtSize: (texto: string, tamanho: number) => number;
};

/** O QR já pronto para desenho: a matriz de módulos e o lado dela. */
export type MatrizDoQr = { modulos: ArrayLike<number | boolean>; tamanho: number };

export type PaginaPdf = any;
export type ImagemEmbutida = any;

export type DadosDoRodape = {
  /** Código de verificação do documento (per_document) ou do signatário. */
  codigo: string;
  /** `signature_requests.id` — carimbado em todas as folhas. */
  protocolo: string;
  /** SHA-256 do documento de ORIGEM, antes de assinar. */
  sha256DoOriginal: string;
  /** URL da página de conferência. */
  urlDeVerificacao: string | null;
  /** Instante da assinatura, já formatado no fuso do escritório. */
  assinadoEm: string | null;
  /** Impressão curta do certificado que sela (8 primeiros bytes). */
  seloCurto: string;
};

/**
 * Como a URL de verificação aparece no rodapé.
 *
 * Só o host mais `/#/verificar`: a URL inteira leva o hash e não caberia em 5,4
 * pt. O que a pessoa precisa ler é PARA ONDE ir; o resto vem do QR.
 */
export function textoDeVerificacao(url: string | null | undefined): string {
  const bruto = String(url ?? '').trim();
  if (!bruto) return 'verificar autenticidade';
  try {
    const parsed = new URL(bruto);
    return `${parsed.host.replace(/^www\./i, '')}/#/verificar`;
  } catch {
    return bruto.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

/**
 * Corta o texto com reticências para caber numa largura.
 *
 * Devolve o texto intacto quando já cabe — cortar sempre acrescentaria
 * reticências a um código que estava inteiro.
 */
export function coubeOuCorta(texto: string, fonte: Fonte, tamanho: number, larguraMax: number): string {
  if (fonte.widthOfTextAtSize(texto, tamanho) <= larguraMax) return texto;
  let t = texto;
  while (t.length > 1 && fonte.widthOfTextAtSize(`${t}…`, tamanho) > larguraMax) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

/**
 * As partes do carimbo lateral, na ordem.
 *
 * Separado do desenho porque a REGRA é o que importa: o que entra, o que fica
 * de fora e por quê. O hash não entra de propósito — 64 caracteres numa faixa
 * vertical de 6 pt são ilegíveis, e ele já está no rodapé, rotulado.
 */
export function partesDoCarimboLateral(dados: {
  protocolo?: string;
  codigo?: string;
  assinadoEm?: string | null;
  seloCurto?: string;
}): string[] {
  const partes: string[] = [];
  if (dados.protocolo?.trim()) partes.push(`PROTOCOLO ${dados.protocolo.trim().toUpperCase()}`);
  const codigo = dados.codigo?.trim().toUpperCase();
  if (codigo && codigo !== 'N/A') partes.push(`CÓDIGO ${codigo}`);
  // QUANDO, ao lado de o quê: a margem existe para o caso em que só ela
  // sobrevive ao recorte, e "quando isso foi assinado?" é a pergunta seguinte
  // de quem recebe a folha solta.
  if (dados.assinadoEm?.trim()) partes.push(dados.assinadoEm.trim().toUpperCase());
  // Quem carimbou. É a identidade do certificado, não a afirmação de que ESTE
  // arquivo foi selado — a selagem acontece depois e pode falhar (falha macia).
  if (dados.seloCurto?.trim()) partes.push(`CERT. SELO ${dados.seloCurto.trim()}`);
  return partes;
}

/**
 * O carimbo das margens: mesma informação do rodapé, num lugar que sobrevive a
 * recorte, fotografia e reimpressão do miolo.
 */
export function desenharCarimboLateral(params: {
  pagina: PaginaPdf;
  fonte: Fonte;
  ferramentas: FerramentasPdf;
  dados: Parameters<typeof partesDoCarimboLateral>[0];
}): void {
  const { pagina, fonte, ferramentas, dados } = params;
  const partes = partesDoCarimboLateral(dados);
  if (partes.length === 0) return;

  const texto = partes.join('   ·   ');
  const tamanho = 6;
  const mb = pagina.getMediaBox();
  const larguraDoTexto = fonte.widthOfTextAtSize(texto, tamanho);
  const cor = ferramentas.rgb(0.62, 0.66, 0.72);
  const opacidade = 0.75;

  // Numa folha menor que A4 o carimbo seria desenhado para fora e sumiria sem
  // aviso. Melhor não desenhar do que desenhar onde ninguém vê.
  const alturaUtil = (mb.height as number) - 108 - 40;
  if (larguraDoTexto > alturaUtil) return;

  // Girado 90°, o texto cresce em +y e o corpo ocupa x para a ESQUERDA da
  // âncora — por isso ela fica em x=16 e o glifo vive entre 10 e 16, fora de
  // qualquer margem de documento.
  pagina.drawText(texto, {
    x: (mb.x as number) + 16,
    y: (mb.y as number) + 108,
    size: tamanho, font: fonte, color: cor, opacity: opacidade,
    rotate: ferramentas.degrees(90),
  });

  // Espelhado à direita: girado -90° o texto cresce em -y e o corpo ocupa x
  // para a DIREITA da âncora, então ela fica a 16 pt da borda e o glifo volta
  // para dentro.
  pagina.drawText(texto, {
    x: (mb.x as number) + (mb.width as number) - 16,
    y: (mb.y as number) + (mb.height as number) - 40,
    size: tamanho, font: fonte, color: cor, opacity: opacidade,
    rotate: ferramentas.degrees(-90),
  });
}

/**
 * A faixa do rodapé (modo `strip`) — a que vai em toda folha de conteúdo.
 *
 * A âncora é a origem FÍSICA do MediaBox, não `y = 0`. As páginas que passaram
 * por `caixaComFaixaDoRodape` têm origem em -84, e PDFs de origem podem ter
 * MediaBox deslocado. Com `y = 0` fixo a faixa flutuava no meio da página, com
 * uma tarja branca embaixo.
 */
export function desenharRodape(params: {
  pagina: PaginaPdf;
  ferramentas: FerramentasPdf;
  helvetica: Fonte;
  helveticaBold: Fonte;
  /** Monoespaçada para código, protocolo e hash. Cai na Helvetica se ausente. */
  courier?: Fonte;
  courierBold?: Fonte;
  /** Wordmark pré-renderizado. Sem ele, desenha "jurius" + ponto laranja. */
  wordmark?: { imagem: ImagemEmbutida; ratio: number } | null;
  /**
   * O QR como MATRIZ, não como imagem: ele é desenhado em retângulos vetoriais
   * (ver `qr-em-retangulos.ts`). Fica nítido em qualquer zoom, mais leve que um
   * PNG de 512 px, e some a última dependência de canvas do rodapé.
   */
  qr?: MatrizDoQr | null;
  dados: DadosDoRodape;
  /** Fundo totalmente opaco (a faixa foi reservada, não há nada por baixo). */
  opaco?: boolean;
}): void {
  const { pagina, ferramentas, helvetica, helveticaBold, wordmark, qr, dados, opaco } = params;
  const { rgb, PDFString } = ferramentas;
  const courier = params.courier ?? helvetica;
  const courierBold = params.courierBold ?? helveticaBold;

  const codigo = (dados.codigo || '').toUpperCase() || 'N/A';
  const protocolo = (dados.protocolo || '').trim();
  // O único SHA-256 que PODE ser impresso é o do documento de ORIGEM: ele já
  // existe antes de o PDF assinado ser montado. O hash do próprio assinado tem
  // dependência circular — escrevê-lo mudaria os bytes e produziria outro hash.
  // Por isso o rótulo diz DE QUÊ: um "SHA-256:" solto fazia a pessoa comparar
  // este número com o do arquivo em mãos e concluir, com razão, que não batia.
  const hashDoOriginal = String(dados.sha256DoOriginal || '').trim().toLowerCase();

  desenharCarimboLateral({
    pagina, fonte: courier, ferramentas,
    dados: {
      protocolo, codigo,
      assinadoEm: dados.assinadoEm,
      seloCurto: dados.seloCurto,
    },
  });

  const h = 64;
  const mb = pagina.getMediaBox();
  const x = mb.x as number;
  const y = mb.y as number;
  const w = mb.width as number;

  // Paleta enxuta: uma tinta, um mutado, um rótulo, um fio — e o laranja como
  // único acento.
  const ink = rgb(0.067, 0.094, 0.153);
  const inkValue = rgb(0.13, 0.17, 0.24);
  const inkSoft = rgb(0.34, 0.39, 0.47);
  const label = rgb(0.62, 0.66, 0.72);
  const hair = rgb(0.90, 0.92, 0.94);
  const hairSoft = rgb(0.93, 0.95, 0.96);
  const topDivider = rgb(0.80, 0.83, 0.87);
  const orange = rgb(0.878, 0.380, 0.102);
  const white = rgb(1, 1, 1);

  // O pdf-lib não tem letter-spacing: cada glifo é desenhado e avançado à mão.
  // Devolve o x final para quem precisa encostar algo do lado.
  const comTracking = (
    texto: string,
    o: { x: number; y: number; size: number; font: Fonte; color: unknown; tracking: number },
  ): number => {
    let cx = o.x;
    for (const ch of texto) {
      pagina.drawText(ch, { x: cx, y: o.y, size: o.size, font: o.font, color: o.color });
      cx += o.font.widthOfTextAtSize(ch, o.size) + o.tracking;
    }
    return cx - o.tracking;
  };

  const verificacaoCompacta = textoDeVerificacao(dados.urlDeVerificacao);

  pagina.drawRectangle({ x, y, width: w, height: h, color: white, opacity: opaco ? 1 : 0.97 });
  pagina.drawRectangle({ x, y: y + h - 0.8, width: w, height: 0.8, color: topDivider });
  pagina.drawRectangle({ x, y: y + h - 1.3, width: w, height: 0.4, color: orange });

  const margemE = 26;
  const margemD = 16;
  const tx = x + margemE;

  // ── Zona de validação (direita): QR selado + coluna de texto ──
  const qrTamanho = 44;
  const qrX = x + w - margemD - qrTamanho;
  const qrY = y + (h - 2) / 2 - qrTamanho / 2;
  if (qr && qr.tamanho > 0) {
    const tintaDoQr = rgb(...TINTA_DO_QR);
    // Fundo branco sob o QR: a "zona de silêncio" precisa ser clara de verdade.
    // Sobre a faixa translúcida (opacity 0.97) o conteúdo da página apareceria
    // por baixo dos módulos e o leitor erraria.
    pagina.drawRectangle({ x: qrX, y: qrY, width: qrTamanho, height: qrTamanho, color: white });
    const emPontos = escalarRetangulosDoQr(
      retangulosDoQr(qr.modulos, qr.tamanho),
      qr.tamanho,
      { origemX: qrX, origemY: qrY, lado: qrTamanho },
    );
    for (const r of emPontos) {
      pagina.drawRectangle({ x: r.x, y: r.y, width: r.largura, height: r.altura, color: tintaDoQr });
    }
  }

  const valDireita = qrX - 12;
  const valX = qrX - 12 - 96;
  const divisorX = valX - 16;
  pagina.drawLine({
    start: { x: divisorX, y: y + 10 }, end: { x: divisorX, y: y + h - 12 },
    thickness: 0.5, color: hair,
  });

  comTracking('VALIDAÇÃO DIGITAL', { x: valX, y: y + h - 22, size: 5.6, font: helveticaBold, color: ink, tracking: 0.7 });
  pagina.drawText(coubeOuCorta(verificacaoCompacta, courier, 5.4, valDireita - valX), {
    x: valX, y: y + h - 33, size: 5.4, font: courier, color: inkSoft,
  });
  pagina.drawText('Escaneie o QR Code para', { x: valX, y: y + 15, size: 4.9, font: helvetica, color: label });
  pagina.drawText('verificar a autenticidade', { x: valX, y: y + 8.5, size: 4.9, font: helvetica, color: label });

  const conteudoDireita = divisorX - 18;

  // ── Marca (esquerda) ──
  const marcaY = y + h - 20;
  let fimDaMarca: number;
  if (wordmark) {
    const wmH = 12;
    const wmW = wmH * wordmark.ratio;
    pagina.drawImage(wordmark.imagem, { x: tx, y: marcaY - 2.5, width: wmW, height: wmH });
    fimDaMarca = tx + wmW;
  } else {
    // Reserva: "jurius" em fonte genérica + ponto laranja desenhado.
    const fim = comTracking('jurius', { x: tx, y: marcaY, size: 13, font: helveticaBold, color: ink, tracking: 0.2 });
    pagina.drawCircle({ x: fim + 2.8, y: marcaY + 1.4, size: 1.6, color: orange });
    fimDaMarca = fim + 2.8 + 1.6;
  }
  pagina.drawRectangle({ x: fimDaMarca + 8, y: marcaY - 0.5, width: 0.5, height: 8.5, color: hair });
  comTracking('ASSINATURA ELETRÔNICA', { x: fimDaMarca + 14, y: marcaY + 1.4, size: 5.6, font: helvetica, color: label, tracking: 1.4 });

  // ── Grade rótulo-sobre-valor: código | protocolo ──
  const rotuloY = y + 27;
  const valorY = y + 15;

  comTracking('CÓDIGO DE VERIFICAÇÃO', { x: tx, y: rotuloY, size: 5, font: helveticaBold, color: label, tracking: 0.9 });
  if (codigo !== 'N/A') {
    pagina.drawText(coubeOuCorta(codigo, courierBold, 12.5, conteudoDireita - tx), {
      x: tx, y: valorY, size: 12.5, font: courierBold, color: inkValue,
    });
  }
  const larguraDoCodigo = codigo !== 'N/A' ? courierBold.widthOfTextAtSize(codigo, 12.5) : 90;

  const col2X = tx + Math.max(larguraDoCodigo, 118) + 34;
  if (protocolo && col2X < conteudoDireita - 40) {
    comTracking('PROTOCOLO', { x: col2X, y: rotuloY, size: 5, font: helveticaBold, color: label, tracking: 0.9 });
    pagina.drawText(coubeOuCorta(protocolo, courier, 8.5, conteudoDireita - col2X), {
      x: col2X, y: valorY + 1, size: 8.5, font: courier, color: inkSoft,
    });
  }

  // ── SHA-256 do documento original: faixa inferior com hairline ──
  if (hashDoOriginal) {
    pagina.drawLine({
      start: { x: tx, y: y + 10 }, end: { x: conteudoDireita, y: y + 10 },
      thickness: 0.5, color: hairSoft,
    });
    const fimDoRotulo = comTracking('SHA-256 DO DOCUMENTO ORIGINAL', {
      x: tx, y: y + 3.5, size: 5, font: helveticaBold, color: label, tracking: 0.9,
    });
    pagina.drawText(coubeOuCorta(hashDoOriginal, courier, 5.4, conteudoDireita - (fimDoRotulo + 8)), {
      x: fimDoRotulo + 8, y: y + 3.4, size: 5.4, font: courier, color: inkSoft,
    });
  }

  // Link clicável cobrindo a zona de validação inteira (divisor → margem).
  if (dados.urlDeVerificacao) {
    try {
      const anotacao = pagina.doc.context.obj({
        Type: 'Annot', Subtype: 'Link',
        Rect: [divisorX, y + 6, x + w - margemD, y + h - 6],
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(dados.urlDeVerificacao) },
      });
      pagina.node.addAnnot(pagina.doc.context.register(anotacao));
    } catch {
      // Melhor sem link do que sem rodapé: a informação toda já está impressa.
    }
  }
}
