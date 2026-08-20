/**
 * QUEM FICA NA FRENTE DE QUEM — a escala única de camadas do CRM.
 *
 * Antes disto havia cinquenta e poucos valores diferentes de `z-index`
 * espalhados pelos módulos, do 10 ao 2 147 483 647 (o inteiro máximo do
 * navegador). Não era desleixo: era o resultado previsível de cada peça nova
 * resolver o próprio problema sozinha. Quem aparecia atrás de alguém somava um
 * zero, o vizinho somava dois, e em algumas telas a disputa já tinha chegado ao
 * teto — de onde ninguém mais consegue subir, porque acima do máximo não há
 * número. O sintoma que trouxe isto à tona foi pequeno e exato: abrir a ficha
 * do cliente (70) escondia o discador (60).
 *
 * A ordem abaixo não é uma escolha de gosto. Ela responde a uma pergunta de
 * cada vez: **quando estas duas coisas estiverem na tela juntas, qual delas a
 * pessoa precisa ver para poder agir?**
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ BLOCKING    o que impede o uso do CRM: PIN, conta bloqueada, saindo      │
 * │ CALL_NESTED o que abre de dentro da chamada (escolher microfone)         │
 * │ CALL        ligação em curso, convite tocando, vídeo em tela cheia       │
 * │ DIALER      o discador                                                   │
 * │ NOTICE      toast, chamada perdida, sessão expirando                     │
 * │ WIDGET_NESTED o que o widget abriu: diálogo, ficha, imagem ampliada      │
 * │ WIDGET      o widget flutuante de conversas (WhatsApp e chat interno)    │
 * │ POPOVER     menu, dropdown, seletor — inclusive os que saem de um modal  │
 * │ MODAL_NESTED  o modal que um modal abriu (confirmar, ampliar imagem)     │
 * │ MODAL       o modal de módulo: ficha do cliente, prazo, processo…        │
 * │ FLOATING    janelas flutuantes de módulo e a barra delas                 │
 * │ SIDEBAR     menu lateral e a gaveta do celular                           │
 * │ HEADER      a barra do topo                                              │
 * │ STICKY      cabeçalho de tabela e barras que grudam dentro do conteúdo   │
 * │ CONTENT     empilhamento dentro de um cartão                             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * OS PORQUÊS QUE NÃO SÃO ÓBVIOS:
 *
 * · **A CHAMADA GANHA DE TUDO** (menos do que trava o CRM). Ela é a única peça
 *   com alguém do outro lado esperando. Um modal que cobre o botão de desligar
 *   transforma um erro de camada em uma ligação que não acaba.
 * · **O DISCADOR FICA ACIMA DOS MODAIS**, e é justamente por isso que ele é
 *   janela e não modal: a razão de ser dele é consultar o processo, o prazo ou
 *   a ficha ENQUANTO se liga. Deixá-lo embaixo desfaz a única coisa que ele
 *   veio fazer. Abaixo da chamada, porque discar é o que vem antes de falar.
 * · **POPOVER ACIMA DE MODAL** porque o dropdown quase sempre nasce DENTRO de
 *   um modal. Empatado com ele, some por baixo — que é o defeito clássico de
 *   `select` dentro de caixa de diálogo.
 * · **NOTICE ACIMA DE POPOVER**: o aviso de chamada perdida e o toast de erro
 *   não podem ficar presos atrás de um menu que alguém deixou aberto.
 * · **O WIDGET DE CONVERSAS ACIMA DOS MODAIS**, pela mesma razão do discador e
 *   com a mesma consequência prática: quase todo clique que o abre parte de
 *   uma ficha ABERTA — o botão verde do cliente, do lead, do requerimento. Ele
 *   nasceu na faixa das janelas flutuantes (50) e ficava atrás do modal que o
 *   chamou: a conversa abria de verdade, ninguém via, e o clique parecia não
 *   ter feito nada. Abaixo do toast (o aviso tem de aparecer sobre ele) e
 *   abaixo do discador e da chamada, que continuam sendo a conversa que já
 *   está acontecendo.
 * · **AS FAIXAS SÃO DE 20 EM 20.** O espaço no meio é de propósito: uma peça
 *   que precisa ficar um fio acima da vizinha usa `LAYER.MODAL + 1` e continua
 *   dentro da faixa dela, sem começar uma nova corrida.
 *
 * COMO USAR. Em `style` (o caminho preferido, porque o número vem daqui e não
 * de uma string):
 *
 *     style={{ zIndex: LAYER.MODAL }}
 *
 * Em classe do Tailwind, quando o resto do componente já é classe:
 *
 *     className={`fixed inset-0 ${zc.MODAL} …`}
 *
 * O QUE NÃO PRECISA VIR PARA CÁ: `z-10`, `z-20` e afins usados DENTRO de um
 * componente para empilhar as próprias peças (um selo sobre uma foto, a sombra
 * de um cabeçalho de tabela). Aquilo é arrumação interna e não disputa nada
 * nesta escala — trazer tudo para cá só encheria este arquivo de coisas que
 * ninguém precisa comparar.
 */
export const LAYER = {
  /** Empilhamento dentro de um cartão ou de uma célula. */
  CONTENT: 1,
  /** Cabeçalho de tabela e barras que grudam dentro da área de conteúdo. */
  STICKY: 10,
  /** A barra do topo do CRM. */
  HEADER: 30,
  /** Menu lateral e a gaveta do celular (que cobre o conteúdo). */
  SIDEBAR: 40,
  /** Janelas flutuantes de módulo e a barra que as lista embaixo. */
  FLOATING: 50,
  /** O modal de módulo: ficha do cliente, prazo, processo, requerimento… */
  MODAL: 70,
  /** O modal que um modal abriu: confirmar exclusão, ampliar uma imagem. */
  MODAL_NESTED: 90,
  /** Menu, dropdown, seletor de data — inclusive os abertos de dentro de um modal. */
  POPOVER: 110,
  /** O widget flutuante de conversas — ele abre POR CIMA da ficha que o chamou. */
  WIDGET: 120,
  /**
   * O que abre DE DENTRO do widget: um diálogo do módulo embutido, o
   * visualizador de imagem, uma ficha aberta pelo workspace da conversa.
   *
   * Precisa de faixa própria porque o widget subiu acima dos modais: uma caixa
   * aberta lá de dentro na faixa MODAL (70) ficaria atrás do próprio widget que
   * a abriu. Quem faz essa tradução é `useModalLayer` — os modais compartilhados
   * não sabem (nem precisam saber) que estão dentro do widget.
   */
  WIDGET_NESTED: 124,
  /** Toast, aviso de chamada perdida, sessão expirando. */
  NOTICE: 130,
  /** O discador. */
  DIALER: 150,
  /** Ligação em curso, convite tocando, tela cheia de vídeo. */
  CALL: 170,
  /** O que abre de dentro da chamada: escolher microfone e alto-falante. */
  CALL_NESTED: 190,
  /** O que impede o uso do CRM: PIN de segurança, conta bloqueada, saindo. */
  BLOCKING: 210,
} as const;

export type LayerName = keyof typeof LAYER;

/**
 * As mesmas camadas em classe do Tailwind.
 *
 * São escritas à mão, uma a uma, e não geradas por `z-[${LAYER.X}]`: o Tailwind
 * varre o código procurando a classe INTEIRA como texto, e uma classe montada
 * com template nunca chega ao CSS — o elemento fica sem `z-index` nenhum e o
 * defeito aparece só em produção, onde o CSS é podado.
 *
 * O outro lado dessa mesma moeda: a varredura não sabe distinguir código de
 * comentário. Escrever o valor antigo entre colchetes aqui em cima gerava, de
 * verdade, uma classe de dois bilhões no CSS — a corrida que este arquivo veio
 * encerrar, ressuscitada pela documentação dela mesma. Por isso os números
 * antigos aparecem aqui soltos, sem a forma de classe.
 */
export const zc = {
  CONTENT: 'z-[1]',
  STICKY: 'z-[10]',
  HEADER: 'z-[30]',
  SIDEBAR: 'z-[40]',
  FLOATING: 'z-[50]',
  MODAL: 'z-[70]',
  MODAL_NESTED: 'z-[90]',
  POPOVER: 'z-[110]',
  WIDGET: 'z-[120]',
  WIDGET_NESTED: 'z-[124]',
  NOTICE: 'z-[130]',
  DIALER: 'z-[150]',
  CALL: 'z-[170]',
  CALL_NESTED: 'z-[190]',
  BLOCKING: 'z-[210]',
} as const satisfies Record<LayerName, string>;

/**
 * A ESCADA DE DIÁLOGOS EMPILHADOS, dentro da faixa `MODAL_NESTED`.
 *
 * Ela existe porque alguns lugares empilham de verdade — a Cloud e o Nextcloud
 * chegam a quatro caixas abertas ao mesmo tempo (pasta → arquivo → renomear →
 * confirmar), e o Editor de Petições a três. Achatar todas no mesmo número faz
 * a ordem passar a depender de quem foi renderizado por último no DOM, que é
 * exatamente o tipo de acerto que funciona até o dia em que alguém muda a ordem
 * de um `&&` no JSX.
 *
 * Os degraus são de 2 em 2 e cabem inteiros entre `MODAL_NESTED` (90) e
 * `POPOVER` (110): mesmo o quarto nível continua abaixo de um menu aberto de
 * dentro dele.
 */
export const zcStack = [
  'z-[90]',
  'z-[92]',
  'z-[94]',
  'z-[96]',
  'z-[98]',
  'z-[100]',
] as const;

/** O mesmo, em número, para quem escreve `style`. */
export const layerStack = (nivel: number): number =>
  LAYER.MODAL_NESTED + 2 * Math.min(Math.max(nivel, 0), zcStack.length - 1);
