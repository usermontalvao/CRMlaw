/**
 * A capa do laudo: o selo "Documento assinado" e um cartão por signatário.
 *
 * É a página que alguém olha primeiro quando abre o certificado — e a que
 * responde, sem rolar, "isto está assinado, por quem, e quando".
 *
 * Porte da primeira parte de `addReportPages` (`pdfSignature.service.ts`).
 *
 * A ALTURA DO CARTÃO É CALCULADA ANTES DO DESENHO, e essa é a decisão que mais
 * importa aqui: antes a conta era `itens * 13` — uma linha por fator de
 * autenticação — mas o texto era desenhado com quebra automática. Um fator
 * comprido virava duas linhas e a segunda caía POR CIMA do item seguinte. Quem
 * manda na altura agora é o número de linhas de verdade.
 */
import {
  FOLHA_DO_LAUDO,
  desenharRotuloDeSecao,
  topoDoConteudo,
  type FontesDoLaudo,
} from './laudoCabecalho.ts';
import {
  quebrarTexto,
  retanguloArredondado,
  visto,
  type FerramentasDeForma,
  type PaginaPdf,
  type PaletaDoLaudo,
} from './laudoDesign.ts';

export type SignatarioNaCapa = {
  nome: string;
  papel: string | null;
  /** Data/hora da assinatura, já formatada (com segundos). */
  assinadoEm: string;
  /** As afirmações do laudo — de `provasDeAutenticacao`. */
  provas: string[];
  /** A imagem da rubrica, já embutida no documento. Ausente = caixa vazia. */
  rubrica?: unknown | null;
};

/** Altura mínima de um cartão, mesmo com poucos fatores. */
export const ALTURA_MINIMA_DO_CARTAO = 180;

/**
 * Quantos pontos de altura um cartão precisa.
 *
 * Separado e exportado porque é a conta que já errou: a base de 86 (e não 78)
 * existe para a última linha da lista assentar 13 pt acima do fundo do cartão,
 * em vez de colada nele. Com uma linha por item a diferença não aparecia; com
 * itens que quebram, o aperto no rodapé ficaria visível.
 */
export function alturaDoCartao(totalDeLinhas: number): number {
  return Math.max(ALTURA_MINIMA_DO_CARTAO, 86 + totalDeLinhas * 13);
}

/** Quantos fatores de autenticação cabem num cartão. */
export const MAXIMO_DE_PROVAS_NO_CARTAO = 8;

/** Abaixo deste y não cabe mais cartão — o resto vai para as páginas seguintes. */
export const PISO_DOS_CARTOES = 80;

export function desenharCapaDoLaudo(params: {
  pagina: PaginaPdf;
  fontes: FontesDoLaudo;
  cores: PaletaDoLaudo;
  ferramentas: FerramentasDeForma;
  signatarios: SignatarioNaCapa[];
  /** Data/hora de emissão, já formatada. */
  emitidoEm: string;
}): void {
  const { pagina, fontes, cores, ferramentas, signatarios, emitidoEm } = params;
  const { helvetica, helveticaBold } = fontes;
  const { largura: L, margem: lm } = FOLHA_DO_LAUDO;
  const larguraDoConteudo = L - lm * 2;

  // ── O selo de validação ────────────────────────────────────────────────
  const topoDoHeroi = topoDoConteudo();
  const alturaDoHeroi = 58;
  const seloX = lm + 20;
  const seloY = topoDoHeroi - alturaDoHeroi / 2;

  pagina.drawCircle({ x: seloX, y: seloY, size: 15, color: cores.emeraldSoft });
  pagina.drawCircle({ x: seloX, y: seloY, size: 11, color: cores.emerald });
  visto(pagina, seloX, seloY, 6.5, cores.white, ferramentas, 2);

  pagina.drawText('Documento assinado', {
    x: seloX + 26, y: seloY + 2, size: 12.5, font: helveticaBold, color: cores.navy,
  });
  const quantos = signatarios.length;
  pagina.drawText(
    `${quantos} ${quantos === 1 ? 'signatário' : 'signatários'}  ·  Emitido em ${emitidoEm}`,
    { x: seloX + 26, y: seloY - 10, size: 7.5, font: helvetica, color: cores.txtMid },
  );

  pagina.drawLine({
    start: { x: lm, y: topoDoHeroi - alturaDoHeroi },
    end: { x: L - lm, y: topoDoHeroi - alturaDoHeroi },
    thickness: 0.6, color: cores.borderSoft,
  });

  // ── Seção ASSINATURAS ──────────────────────────────────────────────────
  const ySecao = topoDoHeroi - alturaDoHeroi - 24;
  desenharRotuloDeSecao({ pagina, fonte: helveticaBold, cores, texto: 'ASSINATURAS', y: ySecao });

  let y = ySecao - 22;
  for (const s of signatarios) {
    const colunaDireita = 175;
    const inicioDaDireita = L - lm - colunaDireita;

    // Quebrar ANTES de medir: é isto que impede a sobreposição.
    const larguraDoTexto = inicioDaDireita - lm - 38;
    const linhasPorProva = s.provas
      .slice(0, MAXIMO_DE_PROVAS_NO_CARTAO)
      .map((prova) => quebrarTexto(prova, helvetica, 7.5, larguraDoTexto));
    const totalDeLinhas = linhasPorProva.reduce((soma, linhas) => soma + linhas.length, 0);
    const altura = alturaDoCartao(totalDeLinhas);

    // Não espreme o último cartão contra o rodapé: quem não coube fica de fora
    // da capa e aparece na própria página, logo adiante.
    if (y - altura < PISO_DOS_CARTOES) break;

    const topo = y;
    retanguloArredondado(pagina, lm, topo, larguraDoConteudo, altura, 9, {
      preenchimento: cores.white, contorno: cores.border, espessura: 0.8,
    });

    const alturaDoCabecalho = 34;
    pagina.drawLine({
      start: { x: lm + 14, y: topo - alturaDoCabecalho },
      end: { x: lm + larguraDoConteudo - 14, y: topo - alturaDoCabecalho },
      thickness: 0.5, color: cores.borderSoft,
    });

    // Selo ASSINADO
    const seloBadgeX = lm + 14;
    const seloBadgeY = topo - alturaDoCabecalho + 8.5;
    const seloBadgeL = 76;
    const seloBadgeH = 17;
    retanguloArredondado(pagina, seloBadgeX, seloBadgeY + seloBadgeH, seloBadgeL, seloBadgeH, 8.5, {
      preenchimento: cores.emerald,
    });
    visto(pagina, seloBadgeX + 14, seloBadgeY + seloBadgeH / 2, 5, cores.white, ferramentas, 1.5);
    pagina.drawText('ASSINADO', {
      x: seloBadgeX + 23, y: seloBadgeY + 5, size: 7.5, font: helveticaBold, color: cores.white,
    });

    // Nome e papel. O corte em 34 evita que um nome longo invada a coluna da
    // direita, onde fica a rubrica.
    const nome = s.nome.length > 34 ? `${s.nome.slice(0, 32)}...` : s.nome;
    pagina.drawText(nome, {
      x: seloBadgeX + seloBadgeL + 12, y: topo - alturaDoCabecalho + 13,
      size: 11.5, font: helveticaBold, color: cores.navy,
    });
    // "Assinar" é rótulo de BOTÃO que vazou para o campo de papel; no laudo ele
    // não diz nada sobre a pessoa.
    const papel = s.papel && s.papel !== 'Assinar' ? s.papel : 'Signatário';
    pagina.drawText(papel, {
      x: seloBadgeX + seloBadgeL + 12, y: topo - alturaDoCabecalho + 2,
      size: 7, font: helvetica, color: cores.txtSoft,
    });

    // ── Corpo ──
    const topoDoCorpo = topo - alturaDoCabecalho;
    pagina.drawText('Assinado em', { x: lm + 14, y: topoDoCorpo - 17, size: 7.5, font: helvetica, color: cores.txtSoft });
    pagina.drawText(s.assinadoEm, { x: lm + 72, y: topoDoCorpo - 17, size: 7.5, font: helveticaBold, color: cores.txtDark });
    pagina.drawLine({
      start: { x: lm + 14, y: topoDoCorpo - 27 }, end: { x: inicioDaDireita - 10, y: topoDoCorpo - 27 },
      thickness: 0.5, color: cores.borderSoft,
    });
    pagina.drawText('FATORES DE AUTENTICAÇÃO', {
      x: lm + 14, y: topoDoCorpo - 41, size: 6.5, font: helveticaBold, color: cores.txtSoft,
    });

    let yProva = topoDoCorpo - 55;
    for (const linhas of linhasPorProva) {
      // A bolinha marca só a PRIMEIRA linha do item; as continuações entram
      // alinhadas com o texto, sem marcador, como uma lista de verdade.
      pagina.drawCircle({ x: lm + 16, y: yProva + 2.5, size: 2, color: cores.emerald });
      for (const linha of linhas) {
        pagina.drawText(linha, { x: lm + 24, y: yProva, size: 7.5, font: helvetica, color: cores.txtMid });
        yProva -= 13;
      }
    }

    // ── Coluna da direita: a rubrica ──
    const caixaL = colunaDireita - 16;
    const caixaX = inicioDaDireita + 8;
    const yRotulo = topoDoCorpo - 13;
    const topoDaCaixa = yRotulo - 6;
    const baseDaCaixa = topo - altura + 12;
    const alturaDaCaixa = Math.max(30, topoDaCaixa - baseDaCaixa);

    pagina.drawText('ASSINATURA MANUSCRITA', {
      x: caixaX, y: yRotulo, size: 6, font: helveticaBold, color: cores.txtSoft,
    });
    retanguloArredondado(pagina, caixaX, topoDaCaixa, caixaL, alturaDaCaixa, 6, {
      preenchimento: cores.paper, contorno: cores.border, espessura: 0.8,
    });
    // A linha de assinatura, como num papel.
    pagina.drawLine({
      start: { x: caixaX + 10, y: baseDaCaixa + 16 },
      end: { x: caixaX + caixaL - 10, y: baseDaCaixa + 16 },
      thickness: 0.5, color: cores.border,
    });
    if (s.rubrica) {
      const respiro = 8;
      pagina.drawImage(s.rubrica, {
        x: caixaX + respiro, y: baseDaCaixa + respiro,
        width: caixaL - respiro * 2,
        height: Math.max(10, alturaDaCaixa - respiro * 2),
      });
    }

    y -= altura + 18;
  }
}
