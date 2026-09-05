/**
 * As páginas da trilha de auditoria: a linha do tempo dos eventos.
 *
 * Diferente das outras duas, esta PAGINA SOZINHA — a trilha pode ter três
 * eventos ou trinta, e cada evento tem altura própria (o detalhe quebra em até
 * cinco linhas). Por isso o desenho recebe uma função que cria página nova, em
 * vez de receber a página pronta.
 *
 * Porte da terceira parte de `addReportPages` (`pdfSignature.service.ts`).
 * As regras de ORDEM vivem em `linhaDoTempo.ts`, testadas à parte.
 */
import { FOLHA_DO_LAUDO, desenharRotuloDeSecao, type FontesDoLaudo } from './laudoCabecalho.ts';
import {
  quebrarTexto,
  retanguloArredondado,
  type PaginaPdf,
  type PaletaDoLaudo,
} from './laudoDesign.ts';
import {
  MAXIMO_DE_LINHAS_POR_EVENTO,
  alturaDoEvento,
  type EventoDaTrilha,
} from './linhaDoTempo.ts';

/** Onde a primeira linha de eventos começa. */
const TOPO_DOS_EVENTOS = FOLHA_DO_LAUDO.altura - 158 - 10;

/**
 * Abaixo disto não cabe mais evento: é onde começa a nota de rodapé da trilha.
 * A linha vertical do tempo também para aqui.
 */
const PISO_DOS_EVENTOS = 92;
const BASE_DA_LINHA_DO_TEMPO = 102;

/** Espaço entre um cartão de evento e o seguinte. */
const VAO_ENTRE_EVENTOS = 11;

export const NOTA_DA_TRILHA =
  'Este registro de auditoria é parte integrante do certificado de assinatura. '
  // Os dois relógios ficam DITOS aqui porque a trilha é a única página onde a
  // hora aparece dezenas de vezes: repetir "(Cuiabá) · (Brasília)" em cada
  // evento encheria a folha e atrapalharia justamente a leitura da ordem dos
  // atos. A conversão fica escrita uma vez, e a página inteira herda.
  + 'Datas em horário de Cuiabá (UTC-04:00); em Brasília (UTC-03:00), uma hora mais tarde.';

/**
 * A cor de cada tipo de evento — o que o leitor usa para varrer a página sem
 * ler. Verde é o ato consumado; laranja é a origem; roxo é o aceite; azul
 * acinzentado é a visita.
 */
export function corDoEvento(rotulo: string, cores: PaletaDoLaudo, rgb: (r: number, g: number, b: number) => unknown): unknown {
  switch (rotulo) {
    case 'Assinado': return cores.emerald;
    case 'Visualizado': return rgb(0.35, 0.40, 0.52);
    case 'Criado': return cores.orange;
    case 'Termos': return rgb(0.45, 0.32, 0.72);
    default: return cores.txtSoft;
  }
}

/** A cor do selo é a do evento, com um fundo próprio para os tipos neutros. */
export function corDoSelo(rotulo: string, cores: PaletaDoLaudo, rgb: (r: number, g: number, b: number) => unknown): unknown {
  const conhecidos = new Set(['Assinado', 'Visualizado', 'Criado', 'Termos']);
  return conhecidos.has(rotulo) ? corDoEvento(rotulo, cores, rgb) : cores.navyMid;
}

export function desenharTrilha(params: {
  /** A primeira página, já com cabeçalho desenhado. */
  paginaInicial: PaginaPdf;
  /** Cria a próxima página de continuação, JÁ com o cabeçalho. */
  novaPagina: () => PaginaPdf;
  fontes: FontesDoLaudo;
  cores: PaletaDoLaudo;
  rgb: (r: number, g: number, b: number) => unknown;
  /** Já ordenados por `ordenarTrilha`. */
  eventos: readonly EventoDaTrilha[];
  /** `signature_requests.id`, para a nota do rodapé. */
  protocolo: string;
}): { paginasUsadas: number } {
  const { paginaInicial, novaPagina, fontes, cores, rgb, eventos, protocolo } = params;
  const { helvetica, helveticaBold, courier } = fontes;
  const { largura: L, margem: lm } = FOLHA_DO_LAUDO;

  let pagina = paginaInicial;
  let paginasUsadas = 1;
  const xDaLinha = lm + 15;

  const prepararPagina = (p: PaginaPdf, primeira: boolean) => {
    desenharRotuloDeSecao({
      pagina: p, fonte: helveticaBold, cores,
      texto: primeira ? 'REGISTRO DE EVENTOS' : 'REGISTRO DE EVENTOS (continuação)',
      y: FOLHA_DO_LAUDO.altura - 128 - 10,
    });
    // A linha vertical do tempo vai de cima até o piso, mesmo que os eventos
    // acabem antes: cortá-la no último evento faria a trilha parecer truncada.
    p.drawLine({
      start: { x: xDaLinha, y: TOPO_DOS_EVENTOS + 6 },
      end: { x: xDaLinha, y: BASE_DA_LINHA_DO_TEMPO },
      thickness: 1.2, color: cores.border,
    });
  };

  prepararPagina(pagina, true);
  let y = TOPO_DOS_EVENTOS;

  for (const evento of eventos) {
    const linhas = quebrarTexto(evento.detalhe, helvetica, 7.5, L - lm * 2 - 52);
    const altura = alturaDoEvento(linhas.length);

    if (y - altura < PISO_DOS_EVENTOS) {
      pagina = novaPagina();
      paginasUsadas += 1;
      prepararPagina(pagina, false);
      y = TOPO_DOS_EVENTOS;
      // Um evento maior que a página inteira seria desenhado por cima do
      // rodapé e da nota. Pular é feio; deixar vazar é pior.
      if (y - altura < PISO_DOS_EVENTOS) continue;
    }

    const cor = corDoEvento(evento.rotulo, cores, rgb);
    const corSelo = corDoSelo(evento.rotulo, cores, rgb);

    // O nó da linha do tempo: anel branco, disco colorido, miolo branco. Os três
    // círculos são o que faz o nó "furar" a linha em vez de ficar por cima dela.
    pagina.drawCircle({ x: xDaLinha, y: y - 4, size: 6, color: cores.white });
    pagina.drawCircle({ x: xDaLinha, y: y - 4, size: 5, color: cor });
    pagina.drawCircle({ x: xDaLinha, y: y - 4, size: 1.8, color: cores.white });

    const cartaoX = xDaLinha + 18;
    const cartaoL = L - lm - cartaoX;
    retanguloArredondado(pagina, cartaoX, y, cartaoL, altura, 7, {
      preenchimento: cores.bgLight, contorno: cores.border, espessura: 0.6,
    });
    // Faixa de acento à esquerda, na cor do evento.
    retanguloArredondado(pagina, cartaoX, y, 3.5, altura, 1.5, { preenchimento: cor });

    const seloL = 66;
    retanguloArredondado(pagina, cartaoX + 10, y - 8, seloL, 14, 7, { preenchimento: corSelo });
    const rotulo = evento.rotulo.toUpperCase();
    const larguraDoRotulo = helveticaBold.widthOfTextAtSize(rotulo, 6.5);
    pagina.drawText(rotulo, {
      x: cartaoX + 10 + (seloL - larguraDoRotulo) / 2, y: y - 17,
      size: 6.5, font: helveticaBold, color: cores.white,
    });
    // O horário em monoespaçada: é para ser comparado com outro horário.
    pagina.drawText(evento.quando, {
      x: cartaoX + 10 + seloL + 10, y: y - 17, size: 7, font: courier, color: cores.txtMid,
    });

    let yDetalhe = y - 33;
    for (const linha of linhas.slice(0, MAXIMO_DE_LINHAS_POR_EVENTO)) {
      pagina.drawText(linha, { x: cartaoX + 12, y: yDetalhe, size: 7.5, font: helvetica, color: cores.txtDark });
      yDetalhe -= 12;
    }

    y -= altura + VAO_ENTRE_EVENTOS;
  }

  // A nota fecha a ÚLTIMA página da trilha, não todas: repeti-la em cada
  // continuação faria o leitor achar que a trilha terminou ali.
  pagina.drawLine({
    start: { x: lm, y: 90 }, end: { x: L - lm, y: 90 },
    thickness: 0.5, color: cores.borderSoft,
  });
  pagina.drawText(NOTA_DA_TRILHA, { x: lm, y: 77, size: 6.5, font: helvetica, color: cores.txtSoft });
  pagina.drawText(`Documento ${protocolo}  ·  Jurius`, {
    x: lm, y: 65, size: 6, font: helvetica, color: cores.silver,
  });

  return { paginasUsadas };
}
