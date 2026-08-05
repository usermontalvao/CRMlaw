// Que conversas o filtro de status deixa passar — e por que a busca muda isso.
//
// O filtro nasce em "Abertas", que é o certo para trabalhar: a inbox é a fila do
// dia, não o arquivo do escritório. Só que o mesmo filtro governava a BUSCA, e aí
// ele passava a atrapalhar. Procurar um cliente cuja conversa já foi encerrada
// não devolvia nada — nem "encerrada", nem "nenhum resultado por causa do
// filtro": nada. Quem não soubesse que existe um seletor de status escondido no
// painel de filtros concluiria que a conversa tinha sumido do sistema.
//
// A distinção que resolve: FILTRAR é escolher um escopo para navegar; BUSCAR é
// dizer "ache esta pessoa, onde ela estiver". Então, enquanto há texto digitado,
// "Abertas" para de esconder o arquivo. Só essa dimensão cede, e só nesse filtro:
//
//   · "Encerradas" continua só encerradas — quem escolheu o arquivo quer o arquivo.
//   · "Aguardando você"/"interno"/"Reaberta" são estados de trabalho, escolhas
//     deliberadas sobre o que fazer agora; ampliá-las seria desfazer o pedido.
//   · Canal, setor e etiqueta não são tocados por nada disto: são recortes que a
//     pessoa configurou de propósito, e vê-los ignorados assustaria.
//
// PURO, SEM IMPORTS: a regra é decidida em dois lugares (a lista e os contadores
// das abas) e eles não podem divergir — um contador dizendo "3" sobre uma lista
// vazia já foi bug aqui antes. Uma função só, testada, mantém os dois honestos.

export type InboxStatusFilter =
  | 'all' | 'open' | 'waiting_you' | 'waiting_internal' | 'reopened' | 'closed';

export interface StatusScopeInput {
  filter: InboxStatusFilter;
  /** `status === 'closed'` — o atendimento foi encerrado. */
  closed: boolean;
  /** Tem `reopened_at` — o cliente voltou depois de encerrada. */
  reopened: boolean;
  /** Chave do status vivo da conversa ('waiting_you', 'waiting_internal'…). */
  liveKey: string;
  /** Há texto na busca agora. */
  searching: boolean;
}

/** `true` = esconder esta conversa sob o filtro de status atual. */
export function hiddenByStatusFilter(i: StatusScopeInput): boolean {
  switch (i.filter) {
    case 'open':
      // A única concessão da busca: encerrada só some quando não se está buscando.
      return i.closed && !i.searching;
    case 'closed':
      return !i.closed;
    case 'waiting_you':
      return i.liveKey !== 'waiting_you';
    case 'waiting_internal':
      return i.liveKey !== 'waiting_internal';
    case 'reopened':
      return i.closed || !i.reopened;
    case 'all':
    default:
      return false;
  }
}

/**
 * Peso de ordenação do resultado: 0 vem antes de 1.
 *
 * Encerrada que apareceu POR CAUSA da busca desce para o fim. Se ficasse
 * misturada por data, um atendimento fechado no mês passado poderia sentar em
 * cima da fila de hoje — a lista deixaria de ser fila de trabalho no exato
 * momento em que se procura alguém. Em cima o que está vivo, embaixo o arquivo.
 * Fora da busca ninguém desce: ali a ordem por data é a que vale.
 */
export function searchRank(i: { closed: boolean; searching: boolean }): 0 | 1 {
  return i.searching && i.closed ? 1 : 0;
}
