/**
 * A ÂNCORA DENTRO DO `.docx` — trocar `[[ASSINATURA]]` por uma imagem invisível.
 *
 * Este é o passo que falta para o `template-fill` (241 dos 291 envelopes) entrar
 * na montagem no servidor. Hoje esses envelopes nascem como `.docx` montado no
 * servidor, sem navegador que os converta — então nunca congelam, e sem PDF
 * congelado a montagem no servidor não tem sobre o que trabalhar.
 *
 * Converter no servidor sozinho NÃO basta, e é aqui que quase todo mundo erra:
 * se o `.docx` for convertido como está, o texto `[[ASSINATURA]]` é IMPRESSO na
 * folha e a âncora desaparece. O documento sai com um marcador visível no meio
 * e a rubrica cai no rodapé por fallback — num documento que vale como prova.
 *
 * A TROCA. Antes de converter, cada marcador vira uma **imagem inline
 * totalmente transparente de 1×1 pt** — um PONTO, não uma caixa. Duas coisas
 * acontecem de uma vez:
 *
 *   1. o texto do marcador some da folha — não há o que imprimir;
 *   2. o Syncfusion diagrama, e o PDF resultante passa a CARREGAR a coordenada:
 *      uma imagem é desenhada com uma matriz explícita no fluxo de conteúdo,
 *      que `ancoraNoPdf.ts` lê de volta.
 *
 * Trocar por espaços (a alternativa tentadora) resolveria (1) e nada mais: não
 * sobraria nada no PDF para dizer ONDE o marcador estava.
 *
 * E a âncora é um ponto por um motivo MEDIDO, não por elegância — ver
 * `ANCORA_ALTURA_PT` abaixo: uma âncora do tamanho da assinatura mudou a
 * paginação do documento de 2 para 3 páginas.
 *
 * POR QUE MEXER NO XML NA MÃO, e não com uma biblioteca de Word: não existe uma
 * que rode em Deno. O que este módulo faz é cirúrgico — recortar um trecho de
 * texto e inserir um elemento irmão — e é testável exatamente por ser pequeno.
 *
 * Ver `docs/assinatura-montagem-no-servidor.md`.
 */
import { acharMarcadores } from './marcadoresDeAssinatura.ts';

/** Um pedaço de texto do documento, e onde ele mora no XML. */
type NoDeTexto = {
  /** Índice do primeiro caractere do texto DENTRO do XML. */
  de: number;
  /** Índice logo após o último caractere do texto. */
  ate: number;
  texto: string;
};

/**
 * Todos os `<w:t>` na ordem em que aparecem.
 *
 * `<w:t/>` vazio (sem conteúdo) é ignorado de propósito: ele não contribui com
 * caractere nenhum para o texto contínuo, e tentar recortar dentro dele daria um
 * intervalo degenerado.
 */
export function nosDeTexto(xml: string): NoDeTexto[] {
  const nos: NoDeTexto[] = [];
  const regex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    const de = m.index + m[0].indexOf('>') + 1;
    nos.push({ de, ate: de + m[1].length, texto: m[1] });
  }
  return nos;
}

export type AncoraPlanejada = {
  /** Qual assinante: `[[ASSINATURA]]` é 1; `[[ASSINATURA_2]]` é 2. */
  indiceDoAssinante: number;
  /** O id de relacionamento (`rId1001`) que aponta para o PNG. */
  relId: string;
  /** O nome único do XObject no Word — vira o `descr` e o nome do desenho. */
  nome: string;
};

export type PlanoDaTroca = {
  /** O `document.xml` já com as âncoras no lugar dos marcadores. */
  xml: string;
  ancoras: AncoraPlanejada[];
};

/** Largura e altura da âncora, em EMU (914.400 EMU = 1 polegada). */
const EMU_POR_PONTO = 12700;

/**
 * O tamanho da âncora, em pontos — e por que ele é MINÚSCULO.
 *
 * A tentação é fazer a âncora do tamanho da assinatura (algo como 160×40) e
 * usar a caixa dela direto como o campo. **Isso foi tentado e MEDIDO em
 * 04/09/2026, e está errado:** uma imagem inline de 40 pt força a linha a ter
 * 40 pt de altura, onde o texto tinha ~14. No `kit-trabalhista-source.docx` o
 * PDF passou de **2 para 3 páginas** só por causa disso.
 *
 * Um documento congelado com paginação diferente da que o autor escreveu é
 * inaceitável — e a causa seria a nossa própria instrumentação. Pior: o defeito
 * é silencioso, porque o PDF sai bonito, só com uma quebra a mais.
 *
 * Então a âncora é um PONTO: 1×1 pt não aumenta a altura de linha nenhuma. Ela
 * não é a caixa da assinatura; ela marca ONDE a caixa começa. A caixa é
 * derivada dela em `caixaDaAssinatura`, com a convenção escrita ali.
 */
export const ANCORA_LARGURA_PT = 1;
export const ANCORA_ALTURA_PT = 1;

/**
 * A caixa da assinatura, a partir do ponto da âncora.
 *
 * A CONVENÇÃO, e ela é uma decisão, não um detalhe: a âncora marca o canto
 * inferior ESQUERDO da caixa, e a assinatura cresce para a direita e para
 * CIMA. É como uma rubrica é feita à mão sobre uma linha de assinatura — a
 * caneta apoia na linha e o traço sobe.
 *
 * Crescer para baixo colocaria a rubrica por cima do texto seguinte, que num
 * documento com "Nome:" logo abaixo da linha é exatamente o pior lugar.
 *
 * A caixa é grampeada na folha: um marcador colado na margem direita não pode
 * produzir uma assinatura desenhada para fora do papel.
 */
export function caixaDaAssinatura(
  ancora: { x: number; y: number },
  larguraDaPagina: number,
  alturaDaPagina: number,
  larguraPt = 160,
  alturaPt = 40,
): { x: number; y: number; largura: number; altura: number } {
  const largura = Math.min(larguraPt, larguraDaPagina);
  const altura = Math.min(alturaPt, alturaDaPagina);
  const x = Math.max(0, Math.min(ancora.x, larguraDaPagina - largura));
  const y = Math.max(0, Math.min(ancora.y, alturaDaPagina - altura));
  return { x, y, largura, altura };
}

/**
 * O XML do desenho inline que substitui o marcador.
 *
 * `<wp:inline>` (e não `<wp:anchor>`) é obrigatório: uma imagem flutuante sai
 * do fluxo do texto e o Syncfusion pode posicioná-la em outro lugar — a âncora
 * tem de ocupar exatamente o lugar onde o marcador estava.
 */
export function desenhoDaAncora(
  relId: string,
  nome: string,
  larguraPt = ANCORA_LARGURA_PT,
  alturaPt = ANCORA_ALTURA_PT,
): string {
  const cx = Math.round(larguraPt * EMU_POR_PONTO);
  const cy = Math.round(alturaPt * EMU_POR_PONTO);
  const id = Math.abs(hashDoNome(nome)) % 100000 + 1000;
  return (
    '<w:drawing>'
    + `<wp:inline distT="0" distB="0" distL="0" distR="0">`
    + `<wp:extent cx="${cx}" cy="${cy}"/>`
    + '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
    + `<wp:docPr id="${id}" name="${nome}" descr="${nome}"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks '
    + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>'
    + '</wp:cNvGraphicFramePr>'
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${nome}" descr="${nome}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + '<pic:spPr><a:xfrm><a:off x="0" y="0"/>'
    + `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
  );
}

/** Hash estável e curto, só para gerar um `id` numérico determinístico. */
function hashDoNome(nome: string): number {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) | 0;
  return h;
}

/**
 * Troca cada `[[ASSINATURA]]` por uma âncora, devolvendo o XML novo e o plano.
 *
 * DE TRÁS PARA A FRENTE, e isso é regra: cada troca muda o comprimento do XML,
 * então aplicar da esquerda para a direita invalidaria todos os índices
 * seguintes — e o recorte cairia no meio de uma tag, produzindo um `.docx`
 * corrompido que o Word abre com "conteúdo ilegível".
 *
 * O marcador PARTIDO EM VÁRIOS `runs` é o caso normal, não a exceção: basta o
 * autor ter digitado um colchete e formatado o resto para o Word quebrar
 * `[[ASSINATURA]]` em três pedaços. Por isso a busca acontece no texto contínuo
 * e o recorte volta para os nós um a um.
 */
export function plantarAncoras(xml: string, prefixoDoRelId = 'rIdAnc'): PlanoDaTroca {
  const nos = nosDeTexto(xml);
  const continuo = nos.map((n) => n.texto).join('');
  const marcadores = acharMarcadores(continuo);
  if (marcadores.length === 0) return { xml, ancoras: [] };

  // Onde cada nó começa dentro do texto contínuo.
  const inicios: number[] = [];
  let acumulado = 0;
  for (const n of nos) { inicios.push(acumulado); acumulado += n.texto.length; }

  type Edicao = { de: number; ate: number; conteudo: string };
  const edicoes: Edicao[] = [];
  const ancoras: AncoraPlanejada[] = [];

  marcadores.forEach((marcador, ordem) => {
    const relId = `${prefixoDoRelId}${ordem + 1}`;
    const nome = `assinatura-${marcador.indiceDoAssinante}-${ordem + 1}`;
    ancoras.push({ indiceDoAssinante: marcador.indiceDoAssinante, relId, nome });

    let desenhoJaColocado = false;
    for (let i = 0; i < nos.length; i++) {
      const inicioDoNo = inicios[i];
      const fimDoNo = inicioDoNo + nos[i].texto.length;
      const de = Math.max(marcador.inicio, inicioDoNo);
      const ate = Math.min(marcador.fim, fimDoNo);
      if (ate <= de) continue;

      // O recorte, em coordenadas do XML.
      const deNoXml = nos[i].de + (de - inicioDoNo);
      const ateNoXml = nos[i].de + (ate - inicioDoNo);

      // O desenho entra UMA vez, no primeiro nó tocado. `<w:t>` e `<w:drawing>`
      // são irmãos válidos dentro de `<w:r>`, então fechar o texto e abrir o
      // desenho ali mesmo dispensa achar a fronteira do run — que é onde um
      // recorte no XML costuma quebrar o pacote.
      const conteudo = desenhoJaColocado
        ? ''
        : `</w:t>${desenhoDaAncora(relId, nome)}<w:t xml:space="preserve">`;
      desenhoJaColocado = true;

      edicoes.push({ de: deNoXml, ate: ateNoXml, conteudo });
    }
  });

  edicoes.sort((a, b) => b.de - a.de);
  let saida = xml;
  for (const e of edicoes) saida = saida.slice(0, e.de) + e.conteudo + saida.slice(e.ate);

  return { xml: saida, ancoras };
}

/**
 * As linhas de relacionamento a acrescentar em `word/_rels/document.xml.rels`.
 *
 * Sem elas o `r:embed` aponta para o nada, e o Word (e o Syncfusion) tratam a
 * imagem como ausente: a âncora não é desenhada, o PDF não tem o que localizar
 * e o campo de assinatura some sem erro nenhum.
 */
export function relacionamentosDasAncoras(
  ancoras: readonly AncoraPlanejada[],
  arquivoDaMidia = 'media/ancora-de-assinatura.png',
): string {
  return ancoras
    .map((a) => `<Relationship Id="${a.relId}" Type="http://schemas.openxmlformats.org/`
      + `officeDocument/2006/relationships/image" Target="${arquivoDaMidia}"/>`)
    .join('');
}

/** Insere os relacionamentos antes do `</Relationships>` de fecho. */
export function comRelacionamentos(relsXml: string, novos: string): string {
  if (!novos) return relsXml;
  const fecho = relsXml.lastIndexOf('</Relationships>');
  if (fecho < 0) return relsXml;
  return relsXml.slice(0, fecho) + novos + relsXml.slice(fecho);
}

/**
 * Garante que o `[Content_Types].xml` declara o PNG.
 *
 * Um pacote sem a extensão declarada é inválido: o Word recusa e o Syncfusion
 * pode ignorar a imagem. Se `png` já estiver lá (documento que já tinha uma
 * figura), nada muda — declarar duas vezes é que seria erro.
 */
export function comTipoPng(contentTypesXml: string): string {
  if (/Extension="png"/i.test(contentTypesXml)) return contentTypesXml;
  const fecho = contentTypesXml.lastIndexOf('</Types>');
  if (fecho < 0) return contentTypesXml;
  return contentTypesXml.slice(0, fecho)
    + '<Default Extension="png" ContentType="image/png"/>'
    + contentTypesXml.slice(fecho);
}
