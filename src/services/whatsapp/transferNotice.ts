/**
 * QUANDO UMA CONVERSA QUE MUDOU DE DONO VIRA AVISO NA TELA.
 *
 * A transferência era o buraco mais barulhento do módulo: o banco registra
 * tudo (`whatsapp_transfers`, `whatsapp_attendance_events`), o cliente recebe
 * uma mensagem automática avisando que vai falar com outra pessoa — e quem
 * PASSOU A SER O RESPONSÁVEL não era avisado de nada. A conversa aparecia no
 * nome dele na próxima vez que ele abrisse a inbox, que podia ser à tarde.
 *
 * O sinal chega pelo mesmo `postgres_changes` que já alimenta o cache de
 * atribuição do notificador. O que este módulo faz é decidir, olhando a linha
 * nova, se aquilo é notícia para MIM — e essa decisão tem três armadilhas:
 *
 *  1. A LINHA CHEGA INTEIRA, SEM O "ANTES". O postgres_changes entrega o estado
 *     novo; o anterior só existe no cache que o notificador mantém, e o cache
 *     está vazio logo depois do login — justamente quando a primeira
 *     transferência do dia chega. Por isso o caminho principal não depende do
 *     cache: `wa_transfer_contact_attendance` carimba `transfer_pending_since`,
 *     e um carimbo recente com `awaiting_accept` ligado É a transferência. O
 *     próprio carimbo vira a chave de dedupe, então a mesma transferência não
 *     avisa duas vezes nem que a linha seja atualizada dez vezes depois.
 *  2. TODA MENSAGEM MEXE NA LINHA. `unread_count`, `last_message_at` e presença
 *     atualizam a conversa o tempo todo. Sem exigir novidade na atribuição,
 *     cada mensagem de uma conversa minha viraria "esta conversa é sua agora".
 *  3. EU MESMO POSSO SER O AUTOR. Assumir da fila e aceitar uma transferência
 *     são cliques meus, e o banco responde com a mesma linha que um colega me
 *     passando o caso produziria. Avisar aí seria o sistema me contando o que
 *     eu acabei de fazer — por isso a ação local marca a conversa como
 *     silenciada por alguns segundos (ver `suprimirAvisoDeTransferencia`).
 *
 * A decisão é pura de propósito: é ela que os testes vigiam, sem banco, sem
 * relógio e sem React. O módulo não importa NADA — ver a lição registrada em
 * `testes-ts-node-imports`.
 */

/** O que a decisão precisa da linha da conversa. */
export interface LinhaDeAtribuicao {
  assigned_user_id?: string | null;
  awaiting_accept?: boolean | null;
  /** Carimbo de `wa_transfer_contact_attendance` (ISO). */
  transfer_pending_since?: string | null;
  updated_at?: string | null;
  /**
   * A chave do ATENDIMENTO — o mesmo contato falando por dois números do
   * escritório são duas linhas com esta chave igual. A transferência move todas
   * de uma vez, então sem ela o mesmo caso avisaria duas vezes, com dois
   * cartões e dois toques.
   */
  attendance_key?: string | null;
}

export interface DecisaoDeAviso {
  /** true quando a mudança merece cartão + som. */
  avisar: boolean;
  /** true quando a conversa ainda espera o aceite de quem recebeu. */
  aguardandoAceite: boolean;
  /**
   * Chave estável do episódio. Duas entregas do mesmo evento (e o realtime
   * repete) produzem a mesma chave, e o notificador só deixa passar a primeira.
   */
  chave: string;
}

const NAO: DecisaoDeAviso = { avisar: false, aguardandoAceite: false, chave: '' };

/**
 * Quanto tempo um carimbo continua sendo "notícia".
 *
 * Dois minutos cobre a viagem do webhook, uma reconexão do canal e o intervalo
 * em que o realtime reentrega o que perdeu. Acima disso a transferência é
 * história: quem chegou agora vê a conversa na lista, no seu nome, e um cartão
 * dizendo "acabou de chegar" mentiria.
 */
export const JANELA_DE_NOVIDADE_MS = 2 * 60_000;

/**
 * O que identifica o EPISÓDIO, e não a linha: a chave do atendimento quando ela
 * existe, a conversa quando não. É o que faz um contato com duas linhas de canal
 * produzir um aviso, e não dois.
 */
function grupo(linha: LinhaDeAtribuicao, conversaId: string): string {
  return linha.attendance_key || conversaId;
}

function idadeMs(iso: string | null | undefined, agoraMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return agoraMs - t;
}

function recente(iso: string | null | undefined, agoraMs: number): boolean {
  const idade = idadeMs(iso, agoraMs);
  // Idade negativa = relógio do servidor à frente do da máquina. Continua sendo
  // novidade: o carimbo acabou de ser feito.
  return idade !== null && idade <= JANELA_DE_NOVIDADE_MS && idade > -JANELA_DE_NOVIDADE_MS;
}

/**
 * A conversa passou a ser minha agora?
 *
 * `donoAnterior` é o que o cache sabia antes desta linha: `undefined` significa
 * "nunca vi esta conversa" — e é diferente de `null`, que significa "estava sem
 * responsável". A distinção decide o caminho 2 (distribuição de fila), que sem
 * o "antes" não tem como se separar de uma atualização qualquer.
 */
export function decidirAvisoDeTransferencia(params: {
  linha: LinhaDeAtribuicao;
  conversaId: string;
  usuarioId: string;
  donoAnterior?: string | null;
  /** true quando ESTA aba acabou de assumir/aceitar a conversa. */
  suprimido?: boolean;
  agoraMs: number;
}): DecisaoDeAviso {
  const { linha, conversaId, usuarioId, donoAnterior, suprimido, agoraMs } = params;

  if (!conversaId || !usuarioId) return NAO;
  if (suprimido) return NAO;
  if ((linha.assigned_user_id ?? null) !== usuarioId) return NAO;
  // Já era minha antes desta linha: o que mudou foi outra coisa (mensagem,
  // presença, contador). Não há notícia de responsabilidade aqui.
  if (donoAnterior === usuarioId) return NAO;

  // Caminho 1 — transferência de pessoa para pessoa. Independe do cache: o
  // carimbo é do próprio banco e diz a hora exata em que o caso foi passado.
  if (linha.awaiting_accept === true && recente(linha.transfer_pending_since, agoraMs)) {
    return {
      avisar: true,
      aguardandoAceite: true,
      chave: `transferencia:${grupo(linha, conversaId)}:${linha.transfer_pending_since}`,
    };
  }

  // Caminho 2 — distribuição de fila (`wa_assign_contact_attendance`): entra
  // valendo, sem aceite, e sem carimbo próprio. Aqui o "antes" é obrigatório;
  // sem ele não há como distinguir "acabou de cair no seu nome" de "já era sua
  // e o contador mudou", e o palpite erraria para o lado barulhento.
  if (donoAnterior !== undefined && donoAnterior !== usuarioId && recente(linha.updated_at, agoraMs)) {
    return {
      avisar: true,
      aguardandoAceite: false,
      chave: `atribuicao:${grupo(linha, conversaId)}:${linha.updated_at}`,
    };
  }

  return NAO;
}

/**
 * As conversas em que ESTA aba acabou de agir.
 *
 * Vive fora da decisão pura porque é estado com relógio. A janela é curta de
 * propósito: ela só precisa cobrir o intervalo entre o clique e a volta do
 * realtime com a linha nova.
 */
const suprimidas = new Map<string, number>();
const JANELA_DE_SUPRESSAO_MS = 15_000;

/** "Fui eu que fiz isto" — não me avise da minha própria ação. */
export function suprimirAvisoDeTransferencia(conversaId: string, agoraMs = Date.now()): void {
  if (!conversaId) return;
  suprimidas.set(conversaId, agoraMs);
}

export function avisoSuprimido(conversaId: string, agoraMs = Date.now()): boolean {
  const quando = suprimidas.get(conversaId);
  if (quando === undefined) return false;
  if (agoraMs - quando > JANELA_DE_SUPRESSAO_MS) {
    suprimidas.delete(conversaId);
    return false;
  }
  return true;
}

/** Troca de usuário na mesma aba: nada do turno anterior vale aqui. */
export function limparSupressoes(): void {
  suprimidas.clear();
}
