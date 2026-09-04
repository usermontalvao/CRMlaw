/**
 * A ordem dos eventos na trilha de auditoria.
 *
 * A trilha é a parte do laudo que conta a HISTÓRIA: quem abriu, quando se
 * autenticou, quando aceitou os termos, quando assinou. Numa disputa, é a
 * sequência que sustenta (ou derruba) o ato — então a ordem não pode depender
 * de sorte de carimbo de tempo.
 *
 * Por isso ela vive aqui, separada do desenho, com teste.
 *
 * Porte das regras de ordenação de `addReportPages`
 * (`pdfSignature.service.ts`).
 */

export type EventoDaTrilha = {
  /** 'Criado', 'Visualizado', 'Autenticação', 'Assinado'… */
  rotulo: string;
  /** Instante já formatado para leitura, com segundos. */
  quando: string;
  /** A frase do evento. */
  detalhe: string;
  /** Instante em milissegundos — a chave primária de ordenação. */
  instante: number;
  /** Desempate quando o instante é o mesmo. Ver `PRIORIDADE`. */
  prioridade: number;
};

/**
 * A prioridade lógica de cada tipo de evento.
 *
 * Serve para desempatar quando dois eventos caem no MESMO segundo — o que
 * acontece o tempo todo: aceitar os termos e assinar são dois cliques
 * seguidos. Sem isto, a ordem viria da ordem de inserção no array, e o laudo
 * poderia mostrar "Assinado" antes de "Termos" — sugerindo que a pessoa assinou
 * sem aceitar nada.
 *
 * A biometria é 2,5 de propósito: entra logo depois da autenticação e antes da
 * localização, sem precisar renumerar o resto.
 */
export const PRIORIDADE = {
  criado: 0,
  visualizado: 1,
  autenticacao: 2,
  biometria: 2.5,
  localizacao: 3,
  termos: 4,
  assinado: 5,
} as const;

/**
 * O instante que os Termos devem ocupar na linha do tempo.
 *
 * TRAVA: o aceite nunca aparece DEPOIS da assinatura. O aceite é pré-requisito
 * do ato; um laudo que mostra o contrário é munição para a outra parte, e o
 * relógio do cliente pode gravar um valor igual ou até posterior por diferença
 * de fuso, latência ou ajuste de horário no aparelho.
 *
 * Quando não há assinatura ainda, vale o instante gravado.
 */
export function instanteDosTermos(termosEm: number, assinadoEm: number): number {
  return assinadoEm ? Math.min(termosEm, assinadoEm) : termosEm;
}

/**
 * Ordena a trilha: pelo instante e, no empate, pela prioridade lógica.
 *
 * Não altera o array recebido — a trilha é montada em pedaços por vários
 * trechos, e ordenar no lugar já causou surpresa em quem ainda ia acrescentar
 * eventos.
 */
export function ordenarTrilha(eventos: readonly EventoDaTrilha[]): EventoDaTrilha[] {
  return [...eventos].sort((a, b) => a.instante - b.instante || a.prioridade - b.prioridade);
}

/**
 * O contato deve ser repetido no começo da linha?
 *
 * Quando a identidade foi CONFIRMADA, a frase de autenticação já diz o número
 * ("…enviado via WhatsApp para +55 (65) 98404-6375"). Repetir o mesmo número
 * entre parênteses não acrescenta nada e deixa o evento com cara de formulário
 * preenchido duas vezes.
 */
export function sufixoDeContato(params: {
  contato: string | null | undefined;
  rotulo: string;
  identidadeConfirmada: boolean;
}): string {
  const contato = params.contato?.trim();
  if (!contato || params.identidadeConfirmada) return '';
  return ` (${params.rotulo}: ${contato})`;
}

/**
 * Quantas linhas de detalhe cabem num cartão de evento.
 *
 * Teto de 5: um agente de usuário cru passa fácil de dez linhas, e um evento
 * sozinho encheria a página. O texto continua inteiro no `detalhe` — o que é
 * limitado é o desenho.
 */
export const MAXIMO_DE_LINHAS_POR_EVENTO = 5;

/** A altura do cartão de um evento, dadas as linhas do detalhe. */
export function alturaDoEvento(linhasDeDetalhe: number): number {
  return 38 + linhasDeDetalhe * 12;
}
