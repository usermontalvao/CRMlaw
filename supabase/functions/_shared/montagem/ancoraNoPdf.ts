/**
 * ONDE A ÂNCORA FOI PARAR — lendo a posição de uma imagem no fluxo de conteúdo.
 *
 * O PROBLEMA QUE ISTO RESOLVE. O `[[ASSINATURA]]` precisa virar coordenada
 * (página + porcentagem) para que a rubrica caia no lugar certo. No navegador
 * isso é fácil: o DOM foi diagramado e `getClientRects()` responde. No servidor
 * não há DOM, não há diagramação, e nenhum runtime de JavaScript abre um `.docx`
 * e calcula onde uma linha cai na página.
 *
 * A SAÍDA: não calcular. Trocar o marcador por uma **imagem inline
 * transparente** do tamanho da assinatura, mandar o `.docx` para o
 * `ConvertToPdf` — que É um diagramador de verdade — e depois PERGUNTAR AO PDF
 * onde a imagem ficou. Um XObject de imagem é sempre desenhado no quadrado
 * unitário [0,1]×[0,1] transformado pela matriz corrente (CTM), e essa matriz
 * está escrita, em texto, no fluxo de conteúdo da página:
 *
 *     q  120 0 0 40 90 620 cm  /Im3 Do  Q
 *       └──────── a b c d e f ────────┘
 *
 * Com `b` e `c` zerados (o caso de imagem não rotacionada), isso é literalmente
 * "largura 120, altura 40, no ponto (90, 620)". A conta abaixo não assume isso —
 * ela transforma os quatro cantos e devolve a caixa que os contém, porque uma
 * imagem dentro de uma tabela girada tem `b`/`c` diferentes de zero e o caso
 * "quase sempre reto" é exatamente o que produz um defeito raro e inexplicável.
 *
 * POR QUE ESTA É A COORDENADA CERTA, e não uma aproximação: ela sai do MESMO
 * arquivo que vai ser congelado e montado. Se a paginação do Syncfusion mudar,
 * a coordenada muda junto — não há como as duas divergirem, que é o defeito que
 * derruba uma assinatura para a página seguinte.
 *
 * Ver `docs/assinatura-montagem-no-servidor.md`.
 */

/** A matriz do PDF: `[a b c d e f]`. */
export type Matriz = readonly [number, number, number, number, number, number];

export const IDENTIDADE: Matriz = [1, 0, 0, 1, 0, 0];

/**
 * `m` aplicada ANTES de `ctm` — que é o que o operador `cm` faz.
 *
 * A ordem importa e é contraintuitiva: `cm` não substitui a matriz corrente,
 * ele pré-multiplica. Inverter os dois posiciona a imagem certa no lugar errado
 * sempre que houver mais de uma transformação aninhada.
 */
export function multiplicar(m: Matriz, ctm: Matriz): Matriz {
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = ctm;
  return [
    a * A + b * C,
    a * B + b * D,
    c * A + d * C,
    c * B + d * D,
    e * A + f * C + E,
    e * B + f * D + F,
  ];
}

/** Leva um ponto do espaço da imagem para o da página. */
export function aplicar(ctm: Matriz, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = ctm;
  return { x: x * a + y * c + e, y: x * b + y * d + f };
}

/** Um retângulo em pontos do PDF, origem embaixo à esquerda. */
export type Caixa = { x: number; y: number; largura: number; altura: number };

/** A caixa que contém o quadrado unitário transformado — o lugar da imagem. */
export function caixaDaImagem(ctm: Matriz): Caixa {
  const cantos = [aplicar(ctm, 0, 0), aplicar(ctm, 1, 0), aplicar(ctm, 0, 1), aplicar(ctm, 1, 1)];
  const xs = cantos.map((p) => p.x);
  const ys = cantos.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, largura: Math.max(...xs) - x, altura: Math.max(...ys) - y };
}

export type AncoraEncontrada = {
  /** O nome do XObject, como aparece no fluxo (`Im3`, sem a barra). */
  nome: string;
  caixa: Caixa;
};

/**
 * Percorre o fluxo de conteúdo e devolve onde cada imagem procurada foi
 * desenhada.
 *
 * É um interpretador MÍNIMO, e de propósito: ele entende apenas `q`, `Q`, `cm` e
 * `Do`, que é tudo de que a posição de uma imagem depende. Entender mais
 * (texto, caminhos, sombreamento) seria superfície para errar sem necessidade.
 *
 * As três armadilhas que ele desarma:
 *
 * · **`q`/`Q` são uma PILHA.** Sem empilhar, uma imagem desenhada depois de um
 *   `Q` herda a transformação de um bloco que já fechou, e cai deslocada;
 * · **strings e nomes podem conter parênteses e espaços.** Tokenizar ingênuo por
 *   espaço faria `(a b) Tj` virar operandos soltos. Aqui as strings são puladas
 *   inteiras antes de qualquer coisa;
 * · **`Do` também desenha FORMULÁRIOS** (XObjects do tipo Form), não só imagens.
 *   Por isso o chamador diz QUAIS nomes procurar — a função não adivinha.
 */
export function acharAncoras(
  fluxo: string,
  nomesProcurados: ReadonlySet<string>,
): AncoraEncontrada[] {
  const achados: AncoraEncontrada[] = [];
  let ctm: Matriz = IDENTIDADE;
  const pilha: Matriz[] = [];
  const operandos: string[] = [];

  const numeros = (n: number): number[] | null => {
    if (operandos.length < n) return null;
    const fatia = operandos.slice(-n).map(Number);
    return fatia.every((v) => Number.isFinite(v)) ? fatia : null;
  };

  let i = 0;
  while (i < fluxo.length) {
    const ch = fluxo[i];

    // Comentário até o fim da linha.
    if (ch === '%') {
      while (i < fluxo.length && fluxo[i] !== '\n' && fluxo[i] !== '\r') i += 1;
      continue;
    }
    // String literal `( … )`, com aninhamento e escape — pulada inteira.
    if (ch === '(') {
      let profundidade = 1;
      i += 1;
      while (i < fluxo.length && profundidade > 0) {
        if (fluxo[i] === '\\') { i += 2; continue; }
        if (fluxo[i] === '(') profundidade += 1;
        else if (fluxo[i] === ')') profundidade -= 1;
        i += 1;
      }
      operandos.push('()');
      continue;
    }
    // String hexadecimal `< … >` (mas não o dicionário `<<`).
    if (ch === '<' && fluxo[i + 1] !== '<') {
      while (i < fluxo.length && fluxo[i] !== '>') i += 1;
      i += 1;
      operandos.push('<>');
      continue;
    }
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\0') {
      i += 1;
      continue;
    }

    // Um token: nome (`/Im3`), número, ou operador.
    let j = i;
    while (j < fluxo.length && !' \n\r\t\f\0()<>[]{}/%'.includes(fluxo[j])) j += 1;
    if (j === i) {
      // Delimitador solto (`[`, `]`, `<<`, `>>`) — irrelevante para a posição.
      if (fluxo[i] === '/') { j = i + 1; while (j < fluxo.length && !' \n\r\t\f\0()<>[]{}/%'.includes(fluxo[j])) j += 1; operandos.push('/' + fluxo.slice(i + 1, j)); i = j; continue; }
      i += 1;
      continue;
    }
    const token = fluxo.slice(i, j);
    i = j;

    switch (token) {
      case 'q':
        pilha.push(ctm);
        operandos.length = 0;
        break;
      case 'Q':
        ctm = pilha.pop() ?? IDENTIDADE;
        operandos.length = 0;
        break;
      case 'cm': {
        const n = numeros(6);
        if (n) ctm = multiplicar(n as unknown as Matriz, ctm);
        operandos.length = 0;
        break;
      }
      case 'Do': {
        const alvo = operandos[operandos.length - 1] ?? '';
        const nome = alvo.startsWith('/') ? alvo.slice(1) : alvo;
        if (nomesProcurados.has(nome)) achados.push({ nome, caixa: caixaDaImagem(ctm) });
        operandos.length = 0;
        break;
      }
      default:
        // Número ou nome vira operando; qualquer outro operador limpa a pilha
        // de operandos, que é o que o PDF faz.
        if (/^[-+.\d]/.test(token)) operandos.push(token);
        else operandos.length = 0;
    }
  }

  return achados;
}

/**
 * Da caixa em pontos para a porcentagem que `signature_fields` guarda.
 *
 * A INVERSÃO DO EIXO É A ARMADILHA: o PDF conta o Y de baixo para cima e o
 * `y_percent` do designer conta de cima para baixo. Copiar o valor direto
 * espelha a assinatura para a metade oposta da folha — e num documento de uma
 * página só, onde o marcador costuma ficar embaixo, ela vai parar no cabeçalho.
 */
export function caixaEmPorcentagem(
  caixa: Caixa,
  larguraDaPagina: number,
  alturaDaPagina: number,
): { x_percent: number; y_percent: number; w_percent: number; h_percent: number } | null {
  if (!(larguraDaPagina > 0) || !(alturaDaPagina > 0)) return null;
  const topo = alturaDaPagina - (caixa.y + caixa.altura);
  return {
    x_percent: (caixa.x / larguraDaPagina) * 100,
    y_percent: (topo / alturaDaPagina) * 100,
    w_percent: (caixa.largura / larguraDaPagina) * 100,
    h_percent: (caixa.altura / alturaDaPagina) * 100,
  };
}
