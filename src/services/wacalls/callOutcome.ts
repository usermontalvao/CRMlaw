// Como a chamada terminou, e em que estado ela está — em texto de gente.
//
// Regras puras, sem rede e sem React, para os testes cobrirem o que o operador
// lê na tela. Os motivos são os do servidor (`internal/voip/core/types.go` do
// WaCalls): user_ended, declined, timeout, busy, cancelled, failed,
// do_not_disturb, unknown.
import type { WaCallPhase, WaCallsStatus } from './types';

/**
 * A frase que fecha a chamada.
 *
 * `answered` distingue os dois desfechos que mais importam ao escritório: uma
 * ligação que chegou a acontecer terminou; uma que nunca foi atendida é
 * retorno pendente. "declined" é dito com todas as letras porque muda o que o
 * atendente faz em seguida (não insistir agora).
 */
export function endReasonMessage(
  reason: string | null,
  options: { answered: boolean; direction: 'outbound' | 'inbound' },
): string {
  switch (reason) {
    case 'declined':
      return options.direction === 'outbound' ? 'Chamada recusada.' : 'Chamada recusada.';
    case 'do_not_disturb':
      return 'O contato está com o "não perturbe" ligado.';
    case 'busy':
      return 'A linha do contato estava ocupada.';
    case 'timeout':
      return 'Chamada não atendida.';
    case 'cancelled':
      return options.answered ? 'Chamada encerrada.' : 'Chamada cancelada.';
    case 'failed':
      return 'A chamada falhou.';
    case 'user_ended':
      return 'Chamada encerrada.';
    case 'connection_lost':
      // Não é o servidor que manda este: é o próprio CRM, quando a internet
      // desta máquina cai com a linha aberta. Sem ele, o painel continuaria
      // contando os minutos de uma conversa que não existe mais.
      return 'A chamada caiu: esta máquina ficou sem conexão.';
    default:
      return options.answered ? 'Chamada encerrada.' : 'Chamada não atendida.';
  }
}

/** O desfecho merece toast de erro (vermelho) ou é só o fim normal? */
export function endReasonIsFailure(reason: string | null, answered: boolean): boolean {
  // Queda de rede é falha mesmo tendo conversado antes: o que interessa ao
  // atendente é que a conversa foi interrompida e alguém precisa voltar a ligar.
  if (reason === 'connection_lost') return true;
  if (answered) return false;
  return reason !== 'user_ended' && reason !== 'cancelled';
}

/**
 * Estado do servidor → estado da tela.
 *
 * O servidor só conhece starting/ringing/connected/ended. A distinção entre
 * "Chamando" (o pedido saiu daqui) e "Tocando" (o WhatsApp do outro lado já
 * está tocando) é da UI, e por isso `current` entra: uma chamada de saída que
 * ainda está PREPARING não pode pular para RINGING antes de existir.
 */
export function phaseFromStatus(
  status: WaCallsStatus,
  direction: 'outbound' | 'inbound',
  current: WaCallPhase,
): WaCallPhase {
  // Depois de encerrada, nada ressuscita a chamada: eventos atrasados do
  // servidor não podem reabrir um cartão que o operador já viu fechar.
  if (current === 'ENDED' || current === 'FAILED') return current;
  switch (status) {
    case 'ended':
      return 'ENDED';
    case 'connected':
      return 'ACTIVE';
    case 'ringing':
      // Enquanto o microfone e o SDP não terminaram, quem manda é o PREPARING.
      if (current === 'PREPARING' || current === 'ENDING') return current;
      return direction === 'outbound' ? 'RINGING' : 'RINGING';
    case 'starting':
      return current === 'PREPARING' ? 'PREPARING' : 'CALLING';
    default:
      return current;
  }
}

/** O cronômetro só corre em chamada de verdade. */
export function callElapsedSeconds(connectedAt: number | null, now: number): number {
  if (!connectedAt) return 0;
  return Math.max(0, Math.floor((now - connectedAt) / 1000));
}

/** mm:ss (ou h:mm:ss quando passa da hora, o que acontece em audiência). */
export function formatCallTimer(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** O rótulo grande do modal, por estado. */
export function phaseLabel(phase: WaCallPhase, direction: 'outbound' | 'inbound'): string {
  switch (phase) {
    case 'PREPARING': return direction === 'outbound' ? 'Preparando…' : 'Conectando…';
    case 'CALLING':   return 'Chamando…';
    case 'RINGING':   return direction === 'outbound' ? 'Chamando…' : 'Chamada recebida';
    case 'ACTIVE':    return 'Em chamada';
    case 'ENDING':    return 'Encerrando…';
    case 'ENDED':     return 'Chamada encerrada';
    case 'FAILED':    return 'Chamada não completada';
    default:          return '';
  }
}
