/**
 * QUANDO INSISTIR — a sala de espera da linha, em forma de regra.
 *
 * O discador mostra um ponto verde quando dá para ligar e um ponto amarelo
 * quando não dá. A primeira versão da volta automática vigiava UMA causa (o
 * serviço de chamadas não ter respondido na abertura da aba) e por isso deixava
 * o amarelo de pé para sempre nas outras: conta de WhatsApp pareada mas sem a
 * conexão aberta, e pessoa ainda sem canal liberado. Nos dois casos o socket
 * está de pé, nada tenta de novo, e só recarregar a página resolvia.
 *
 * A regra aqui vigia o SINTOMA — "não dá para discar" — em vez de uma lista de
 * causas que eu tenha conseguido imaginar. E é justamente por isso que ela vale
 * a pena ser pura e testada: ela decide um comportamento de fundo, que ninguém
 * vê acontecer, e cujo defeito aparece como "o telefone ficou amarelo a manhã
 * inteira" — a semana seguinte inteira sem ninguém saber por quê.
 *
 * PURO DE PROPÓSITO: nenhum import (ver `callRouting`, `callLine`).
 */

/** O retrato do momento, do jeito que a decisão precisa dele. */
export interface RetryState {
  /** O primeiro contato com o serviço já aconteceu (deu certo ou não)? */
  ready: boolean;
  /** O navegador enxerga rede? */
  online: boolean;
  /** O serviço de chamadas respondeu na última tentativa? */
  available: boolean;
  /** Há uma conta de voz escolhida e liberada para esta pessoa? */
  hasLine: boolean;
  /** Já existe uma tentativa em curso ou agendada? */
  busy: boolean;
  /** A aba está escondida (outra aba, janela minimizada)? */
  hidden: boolean;
  /** Esta mesa está em ligação agora? */
  inCall: boolean;
  /** A bancada de desenvolvimento armou o estado à mão. */
  preview: boolean;
}

/** Dá para discar agora? É a mesma conta do ponto verde na tela. */
export function canDial(state: Pick<RetryState, 'online' | 'available' | 'hasLine'>): boolean {
  return state.online && state.available && state.hasLine;
}

/**
 * Marcar nova tentativa?
 *
 * As recusas, e por que cada uma existe:
 *
 *  · ANTES DO PRIMEIRO CONTATO não há amarelo — há carregamento. Insistir aqui
 *    faria toda abertura de aba disparar uma tentativa contra a que já está
 *    a caminho.
 *  · SEM REDE não adianta: o navegador avisa quando ela volta, e é esse aviso
 *    que acorda a espera.
 *  · EM LIGAÇÃO não se mexe em nada. O indicador pode esperar; a conversa não.
 *  · ABA ESCONDIDA não precisa de linha. Quem não está olhando não vai ligar, e
 *    a volta à aba já dispara uma tentativa imediata — polir o indicador de uma
 *    aba que ninguém vê é bater no servidor de graça, vezes o escritório todo.
 */
export function shouldRetry(state: RetryState): boolean {
  if (state.preview) return false;
  if (!state.ready) return false;
  if (canDial(state)) return false;
  if (state.busy) return false;
  if (!state.online) return false;
  if (state.inCall) return false;
  if (state.hidden) return false;
  return true;
}

/**
 * A escada de espera, em milissegundos.
 *
 * Degraus longos de propósito: isto não é a reconexão de uma ligação em curso
 * (essa é do socket, com degraus de meio segundo), é uma sala de espera. O teto
 * de dois minutos é o que mantém viva a única recuperação que depende de outra
 * pessoa: o administrador incluir alguém no canal e o discador daquela pessoa
 * acender sozinho, sem recarregar nada.
 */
export const RETRY_STEPS_MS = [10_000, 20_000, 40_000, 80_000, 120_000] as const;

export function retryDelay(attempt: number): number {
  const i = Math.min(Math.max(attempt, 0), RETRY_STEPS_MS.length - 1);
  return RETRY_STEPS_MS[i];
}
