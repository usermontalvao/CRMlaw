/**
 * A MONTAGEM DO ARTEFATO ASSINADO — o documento inteiro, do servidor.
 *
 * Entra o PDF congelado (mais os anexos, quando há), saem os bytes do documento
 * assinado: rubricas nos campos marcados, faixa de rodapé em toda folha de
 * conteúdo, marca d'água diagonal, e o laudo no fim.
 *
 * Porte de `generateSignedPdf` (`pdfSignature.service.ts`).
 *
 * O QUE MUDA EM RELAÇÃO AO CLIENTE — e por que a mudança é o objetivo:
 *
 * · o SHA-256 do original é calculado AQUI, sobre os bytes que o servidor leu
 *   do Storage. No cliente, o navegador calculava e o servidor conferia contra
 *   o valor que o próprio navegador mandara — o que prova que o arquivo não
 *   mudou no caminho, e nada além disso;
 * · a decisão de qual rubrica vai em qual campo sai de `colocacaoDeAssinatura`,
 *   com nome e teste, em vez de um `if` no meio do laço;
 * · o QR é vetorial.
 *
 * O pdf-lib entra por parâmetro (`ferramentas`), e não por import, porque este
 * mesmo arquivo roda no Deno com `npm:pdf-lib@1.17.1` e na bancada local com o
 * pdf-lib de `node_modules` — a MESMA versão, sem duas cópias divergindo.
 */
import {
  ALTURA_DA_FAIXA_DO_RODAPE,
  caixaComFaixaDoRodape,
  encaixarNaPagina,
  paginaDoCampo,
  posicaoDeReserva,
  retanguloDoCampo,
  type CampoEmPorcentagem,
} from './geometria.ts';
import { decidirCampo, precisaDaPosicaoDeReserva, type Decisao } from './colocacaoDeAssinatura.ts';
import { desenharRodape, type DadosDoRodape, type FerramentasPdf, type MatrizDoQr } from './rodape.ts';
import { desenharMarcaDagua } from './marcaDagua.ts';
import { desenharLaudo, type ResumoDoLaudo, type SignatarioNoLaudo } from './laudo.ts';
import type { FontesDoLaudo, IdentidadeDoLaudo } from './laudoCabecalho.ts';
import type { PaletaDoLaudo } from './laudoDesign.ts';
import type { EventoDaTrilha } from './linhaDoTempo.ts';

/** O campo de assinatura como ele vem de `signature_fields`. */
export type CampoDeAssinatura = CampoEmPorcentagem & {
  field_type: string;
  signer_id?: string | null;
  document_id?: string | null;
  page_number?: number | null;
};

/** Só o que a montagem usa de um `PDFDocument`. */
export type DocumentoPdf = {
  getPages: () => any[];
  getPageCount: () => number;
  addPage: (tamanho: [number, number]) => any;
  save: () => Promise<Uint8Array>;
};

export type EntradaDaMontagem = {
  documento: DocumentoPdf;
  ferramentas: FerramentasPdf & { degrees: (graus: number) => unknown; pontaRedonda: unknown };
  fontes: FontesDoLaudo;
  cores: PaletaDoLaudo;

  /**
   * Onde cada documento COMEÇA no arquivo montado: `{ main: 0, 'attachment-0': 3 }`.
   * No modelo `per_document` há uma chave só, mapeada em 0.
   */
  deslocamentos: Record<string, number>;
  /** Quantas páginas são CONTEÚDO (antes do laudo). */
  paginasDeConteudo: number;

  campos: readonly CampoDeAssinatura[];
  /** Ids de TODOS os signatários do envelope, tenham assinado ou não. */
  todosOsSignatarios: ReadonlySet<string>;
  /** Rubricas já embutidas, por id de signatário. Só quem assinou tem. */
  rubricaPorSignatario: ReadonlyMap<string, unknown>;
  /** A rubrica de quem está assinando agora — reserva para campo órfão. */
  rubricaDeReserva?: unknown | null;

  dadosDoRodape: DadosDoRodape;
  qr: MatrizDoQr | null;
  wordmark: { imagem: unknown; ratio: number };
  logo?: unknown | null;

  laudo: {
    identidade: IdentidadeDoLaudo;
    signatarios: readonly SignatarioNoLaudo[];
    eventos: readonly EventoDaTrilha[];
    sha256DoOriginal: string;
  };
};

export type ResultadoDaMontagem = {
  bytes: Uint8Array;
  /** Quantas páginas de conteúdo (sem o laudo). */
  paginasDeConteudo: number;
  paginasTotais: number;
  laudo: ResumoDoLaudo;
  /** Uma entrada por campo, para o registro de quem montou o quê. */
  decisoes: Array<{ campo: number; decisao: Decisao['tipo']; pagina: number | null }>;
  /** A reserva do canto da última página foi usada? Envelope assim perdeu a âncora. */
  usouPosicaoDeReserva: boolean;
};

/**
 * Estampa as rubricas nos campos marcados.
 *
 * Iterar pelos CAMPOS (e não pelos signatários) é o que garante que cada
 * rubrica caia na página que alguém marcou. O laço por signatário levava ao
 * defeito antigo: bastava um `signer_id` não casar para a assinatura ir parar
 * na última página, mesmo com campos corretamente posicionados.
 */
function estamparRubricas(entrada: EntradaDaMontagem): {
  decisoes: ResultadoDaMontagem['decisoes'];
  usouPosicaoDeReserva: boolean;
} {
  const paginas = entrada.documento.getPages();
  const decisoes: ResultadoDaMontagem['decisoes'] = [];
  const tomadas: Decisao[] = [];

  const estado = {
    comAssinatura: new Set(entrada.rubricaPorSignatario.keys()),
    conhecidos: entrada.todosOsSignatarios,
    temReserva: !!entrada.rubricaDeReserva,
  };

  const deAssinatura = entrada.campos.filter((c) => c.field_type === 'signature');

  deAssinatura.forEach((campo, i) => {
    const decisao = decidirCampo(campo.signer_id, estado);
    tomadas.push(decisao);

    if (decisao.tipo === 'pular-ainda-nao-assinou' || decisao.tipo === 'pular-sem-imagem') {
      decisoes.push({ campo: i, decisao: decisao.tipo, pagina: null });
      return;
    }

    const imagem = decisao.tipo === 'assinatura-do-titular'
      ? entrada.rubricaPorSignatario.get(decisao.signerId)
      : entrada.rubricaDeReserva;
    if (!imagem) {
      decisoes.push({ campo: i, decisao: 'pular-sem-imagem', pagina: null });
      return;
    }

    const indice = paginaDoCampo({
      chaveDoDocumento: campo.document_id || 'main',
      numeroDaPagina: campo.page_number,
      deslocamentos: entrada.deslocamentos,
      totalDePaginas: paginas.length,
    });
    // Documento que não foi mesclado, ou página que não existe: NÃO se adivinha
    // onde a rubrica deveria cair. Estampar num lugar que ninguém marcou é pior
    // do que não estampar.
    if (indice === null) {
      decisoes.push({ campo: i, decisao: decisao.tipo, pagina: null });
      return;
    }

    const pagina = paginas[indice];
    const { width, height } = pagina.getSize();
    const r = encaixarNaPagina(retanguloDoCampo(width, height, campo), width, height);
    pagina.drawImage(imagem, { x: r.x, y: r.y, width: r.w, height: r.h });
    decisoes.push({ campo: i, decisao: decisao.tipo, pagina: indice });
  });

  // A reserva do canto só dispara quando NADA foi desenhado em lugar nenhum.
  const desenhou = decisoes.some((d) => d.pagina !== null);
  const precisa = !desenhou
    && precisaDaPosicaoDeReserva(tomadas, !!entrada.rubricaDeReserva)
    && !!entrada.rubricaDeReserva;

  if (precisa) {
    const ultima = paginas[paginas.length - 1];
    if (ultima) {
      const { width, height } = ultima.getSize();
      const r = posicaoDeReserva(width, height);
      ultima.drawImage(entrada.rubricaDeReserva, { x: r.x, y: r.y, width: r.w, height: r.h });
      return { decisoes, usouPosicaoDeReserva: true };
    }
  }

  return { decisoes, usouPosicaoDeReserva: false };
}

/**
 * Abre a faixa do rodapé nas páginas de conteúdo.
 *
 * A página cresce PARA BAIXO. Nada se move: o conteúdo e as rubricas já
 * desenhadas ficam nas mesmas coordenadas, e a faixa nasce vazia embaixo.
 *
 * O caminho tentador — transladar ou escalar o conteúdo — está proibido por um
 * motivo medido: o pdf-lib embrulha o content stream num `q…cm…Q` e todo
 * desenho FEITO DEPOIS entra no mesmo stream, ou seja, dentro da transformação.
 * O rodapé acabava flutuando, com uma faixa branca embaixo dele.
 */
export function abrirFaixaDoRodape(documento: DocumentoPdf, quantasPaginas: number): void {
  const paginas = documento.getPages();
  for (let i = 0; i < Math.min(quantasPaginas, paginas.length); i++) {
    const pagina = paginas[i];
    const mb = pagina.getMediaBox();
    const nova = caixaComFaixaDoRodape(mb);
    pagina.setMediaBox(nova.x, nova.y, nova.width, nova.height);
    // O CropBox só é mexido quando ele existe de verdade: criar um onde não
    // havia mudaria o recorte de páginas que estavam certas.
    if (pagina.node?.CropBox?.()) {
      const cb = pagina.getCropBox();
      const novaCb = caixaComFaixaDoRodape(cb);
      pagina.setCropBox(novaCb.x, novaCb.y, novaCb.width, novaCb.height);
    }
  }
}

/**
 * Tapa, de branco, a faixa que acabou de ser aberta embaixo da página.
 *
 * O DEFEITO QUE ISTO FECHA: crescer o MediaBox não cria papel em branco — ele
 * DESCOBRE o que o recorte da página escondia. Um PDF cuja última linha
 * transborda o pé da folha (o que a conversão por fatias produz o tempo todo:
 * a imagem do documento é cortada no meio da linha) some com o excedente
 * porque o visualizador recorta na caixa. Aberta a faixa, esse excedente
 * reaparece — e o rodapé fica por cima de um texto que ninguém deveria ver,
 * que foi exatamente a queixa de "o rodapé está sobrepondo o documento".
 *
 * Tapar restaura o que o original mostrava: nada se perde, porque nada disso
 * era visível antes.
 *
 * Vem ANTES da marca d'água e do rodapé no mesmo laço — o PDF pinta na ordem
 * do stream, e uma máscara desenhada depois apagaria os dois.
 */
export function taparFaixaRevelada(
  pagina: any,
  branco: unknown,
  altura: number = ALTURA_DA_FAIXA_DO_RODAPE,
): void {
  const mb = pagina.getMediaBox();
  pagina.drawRectangle({
    x: mb.x, y: mb.y, width: mb.width, height: altura, color: branco,
  });
}

/**
 * Monta o documento assinado inteiro.
 *
 * A ORDEM das etapas é regra, não estilo:
 *
 *   1. **rubricas primeiro**, nas coordenadas originais das páginas;
 *   2. **depois a faixa** — a página cresce para baixo e nada do que já foi
 *      desenhado se move;
 *   3. **então o laudo**, cujas páginas já nascem com layout próprio e por isso
 *      NÃO passam pela reserva de faixa;
 *   4. **por fim a máscara, a marca d'água e o rodapé**, em cima de tudo, com
 *      a máscara e a marca só nas folhas de conteúdo — a máscara antes das
 *      outras duas, porque ela existe para tapar o que a faixa descobriu (ver
 *      `taparFaixaRevelada`), não para apagá-las.
 *
 * Inverter 1 e 2 desenharia as rubricas já contando com a folha crescida —
 * deslocadas 84 pt para cima. Inverter 2 e 3 abriria faixa nas páginas do laudo.
 */
export async function montarDocumentoAssinado(
  entrada: EntradaDaMontagem,
): Promise<ResultadoDaMontagem> {
  const { documento, ferramentas, fontes, cores } = entrada;

  const { decisoes, usouPosicaoDeReserva } = estamparRubricas(entrada);

  abrirFaixaDoRodape(documento, entrada.paginasDeConteudo);

  const laudo = desenharLaudo({
    documento,
    fontes,
    cores,
    ferramentas: {
      rgb: ferramentas.rgb,
      degrees: ferramentas.degrees,
      pontaRedonda: ferramentas.pontaRedonda,
    },
    identidade: entrada.laudo.identidade,
    signatarios: entrada.laudo.signatarios,
    eventos: entrada.laudo.eventos,
    sha256DoOriginal: entrada.laudo.sha256DoOriginal,
    wordmark: entrada.wordmark,
    logo: entrada.logo ?? null,
  });

  const paginas = documento.getPages();
  for (let i = 0; i < paginas.length; i++) {
    const pagina = paginas[i];
    const { width, height } = pagina.getSize();
    const ehConteudo = i < entrada.paginasDeConteudo;

    if (ehConteudo) {
      taparFaixaRevelada(pagina, ferramentas.rgb(1, 1, 1));

      desenharMarcaDagua({
        pagina,
        larguraDaPagina: width,
        alturaDaPagina: height,
        fonte: fontes.helveticaBold as any,
        ferramentas: { rgb: ferramentas.rgb, degrees: ferramentas.degrees },
      });
    }

    desenharRodape({
      pagina,
      ferramentas: {
        rgb: ferramentas.rgb, degrees: ferramentas.degrees, PDFString: ferramentas.PDFString,
      },
      helvetica: fontes.helvetica,
      helveticaBold: fontes.helveticaBold,
      courier: fontes.courier,
      courierBold: fontes.courierBold,
      wordmark: entrada.wordmark,
      qr: entrada.qr,
      dados: entrada.dadosDoRodape,
      // Folha de conteúdo tem espaço reservado ⇒ fundo branco puro. A do laudo
      // tem layout próprio e recebe a faixa semitransparente por cima.
      opaco: ehConteudo,
    });
  }

  return {
    bytes: await documento.save(),
    paginasDeConteudo: entrada.paginasDeConteudo,
    paginasTotais: paginas.length,
    laudo,
    decisoes,
    usouPosicaoDeReserva,
  };
}
