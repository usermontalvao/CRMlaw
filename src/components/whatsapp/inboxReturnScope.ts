// Para onde a lista lateral volta quando alguém abre uma conversa vinda de uma
// aba de CONSULTA (hoje, "Ligações").
//
// As abas de consulta não são escopos de fila: são perguntas ("quem ligou?").
// Respondida a pergunta com o clique em "abrir a conversa", ficar dentro da
// consulta com uma thread aberta ao lado deixa a lateral falando de um assunto
// e a tela do meio de outro — e a próxima resposta que a pessoa escreve sai
// sem a fila à vista. Então a lateral volta para a lista de conversas.
//
// VOLTAR PARA ONDE É A PARTE DIFÍCIL. Voltar sempre para "Todas" trocaria o
// escopo de quem trabalha em "Minhas" sem ter pedido; voltar sempre para o
// escopo anterior pode devolver uma lista em que a conversa recém-aberta NÃO
// aparece — que é a mesma desorientação, ao contrário. A regra abaixo tenta o
// escopo anterior e só desce para "Todas" quando ele esconderia a conversa.
//
// "Não lidas" nunca serve de destino: abrir a conversa a marca como lida, e ela
// sumiria da lista no instante seguinte ao clique.
//
// NENHUM FILTRO É TOCADO AQUI — nem canal, nem setor, nem etiqueta, nem status.
// São recortes que a pessoa configurou de propósito, e vê-los trocados sem ter
// pedido assusta. A ligação de um atendimento já encerrado (caso comum) não
// precisa de alargamento nenhum para caber: a conversa que se acabou de abrir
// nunca é escondida pelo filtro de status — ver `inboxStatusScope`.
//
// PURO, SEM IMPORTS: dá para testar a regra sem montar a inbox inteira.

export type InboxScopeTab = 'all' | 'unread' | 'mine';

export interface ReturnScopeInput {
  /** O escopo de fila em que a pessoa estava antes de abrir a consulta. */
  previous: InboxScopeTab;
  /** A conversa está atribuída a quem está olhando. */
  mine: boolean;
}

export interface ReturnScope {
  /** A aba de fila que a lateral deve mostrar. */
  tab: InboxScopeTab;
}

export function returnScopeForConversation(i: ReturnScopeInput): ReturnScope {
  const cabe = i.previous === 'all' || (i.previous === 'mine' && i.mine);
  return { tab: cabe ? i.previous : 'all' };
}
