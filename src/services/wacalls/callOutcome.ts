// Como a chamada terminou, e em que estado ela está — em texto de gente.
//
// Regras puras, sem rede e sem React, para os testes cobrirem o que o operador
// lê na tela.
//
// O MOTIVO DO FIM NÃO TEM LISTA FECHADA. Ele chega de três lugares:
//   · do WhatsApp, cru — `declined`, `timeout`, `busy`, `do_not_disturb`,
//     `accepted_elsewhere`, `enc`… O servidor repassa a string que veio, então
//     nenhuma enumeração aqui vai dar conta do que ainda não apareceu;
//   · do Jurius Call, que inventa o seu quando o WhatsApp não manda nenhum —
//     `rejected` (o outro lado recusou sem dizer por quê), `terminate` (o outro
//     lado desligou), `missed`, `relay_failed`, `relay_timeout`,
//     `accept_failed` e o sufixo `_elsewhere` de quando outro aparelho da conta
//     resolveu a chamada;
//   · do próprio CRM — `connection_lost`, quando a internet DESTA máquina cai
//     com a linha aberta.
// Por isso tudo aqui é "conheço estes, o resto cai no caso comum", e cada
// exceção está escrita com o nome dela.
import type { WaCallPhase, WaCallsStatus } from './types';

/** O motivo chega cru, de três fontes: compara-se sempre normalizado. */
function normalize(reason: string | null): string {
  return (reason ?? '').trim().toLowerCase();
}

/**
 * Tira o `_elsewhere` do motivo.
 *
 * Outro aparelho da MESMA conta (o celular pareado) resolveu a chamada. Isso
 * diz duas coisas ao mesmo tempo: o que aconteceu (`accepted`, `rejected`…) e
 * que não aconteceu AQUI — nesta aba não houve conversa nenhuma.
 */
function stripElsewhere(reason: string): { base: string; elsewhere: boolean } {
  const sufixo = '_elsewhere';
  return reason.endsWith(sufixo)
    ? { base: reason.slice(0, -sufixo.length), elsewhere: true }
    : { base: reason, elsewhere: false };
}

/** Recusa: alguém — ou o aparelho, pelo dono — disse não. */
const DECLINED_REASONS = new Set(['declined', 'reject', 'rejected', 'do_not_disturb']);

/** Defeito: não houve conversa porque algo quebrou, não porque alguém não quis. */
const FAILED_REASONS = new Set([
  'failed', 'enc', 'connection_lost',
  'relay_failed', 'relay_timeout', 'relay_reconnect_timeout', 'accept_failed',
]);

/** Tocou e ninguém pegou. */
const MISSED_REASONS = new Set(['timeout', 'missed', 'no_answer', 'busy']);

/**
 * Este motivo só existe em chamada que NUNCA foi atendida.
 *
 * É a trava que conserta o pior defeito que o painel já teve: numa ligação de
 * SAÍDA o serviço anuncia a mídia (o relay) menos de um segundo depois de
 * discar, muito antes de o contato tocar na tela. O CRM lia aquilo como
 * atendimento, começava o cronômetro — "Em chamada 00:07" — e registrava na
 * ficha uma conversa que não existiu. Quando o fim chega dizendo `rejected` ou
 * `timeout`, o WhatsApp está afirmando o contrário: ninguém atendeu. Essa
 * afirmação vale mais do que o palpite do cronômetro, e é ela que manda.
 */
export function endReasonMeansNeverAnswered(reason: string | null): boolean {
  const { base, elsewhere } = stripElsewhere(normalize(reason));
  // Resolvida em outro aparelho: seja qual for o desfecho de lá, aqui não
  // houve conversa — e o cronômetro desta aba estava contando o nada.
  if (elsewhere) return true;
  if (DECLINED_REASONS.has(base)) return true;
  return MISSED_REASONS.has(base);
}

/**
 * A frase que fecha a chamada.
 *
 * `answered` distingue os dois desfechos que mais importam ao escritório: uma
 * ligação que chegou a acontecer terminou; uma que nunca foi atendida é
 * retorno pendente. A recusa é dita com todas as letras porque muda o que o
 * atendente faz em seguida (não insistir agora).
 */
export function endReasonMessage(
  reason: string | null,
  options: { answered: boolean; direction: 'outbound' | 'inbound' },
): string {
  const { base, elsewhere } = stripElsewhere(normalize(reason));
  if (elsewhere) {
    if (base === 'accepted') return 'Chamada atendida em outro aparelho.';
    if (DECLINED_REASONS.has(base)) return 'Chamada recusada em outro aparelho.';
    return 'Chamada encerrada em outro aparelho.';
  }
  switch (base) {
    // A recusa vale mesmo com o cronômetro na tela: quem recusou não tinha
    // como estar conversando. Ver `endReasonMeansNeverAnswered`.
    case 'declined':
    case 'reject':
    case 'rejected':
      return 'Chamada recusada.';
    case 'do_not_disturb':
      return 'O contato está com o "não perturbe" ligado.';
    case 'busy':
      return 'A linha do contato estava ocupada.';
    case 'timeout':
    case 'missed':
    case 'no_answer':
      return 'Chamada não atendida.';
    case 'cancelled':
    case 'canceled':
      return options.answered ? 'Chamada encerrada.' : 'Chamada cancelada.';
    case 'failed':
    case 'enc':
      return 'A chamada falhou.';
    // O relay é o caminho do áudio. Sem ele não há o que tentar de novo na
    // mesma chamada: o operador precisa saber que o defeito foi de mídia, e
    // não que o contato desligou na cara dele.
    case 'relay_failed':
    case 'relay_timeout':
    case 'relay_reconnect_timeout':
    case 'accept_failed':
      return 'A chamada falhou: o áudio não pôde ser aberto.';
    case 'user_ended':
    case 'terminate':
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
  const { base } = stripElsewhere(normalize(reason));
  // Queda de rede é falha mesmo tendo conversado antes: o que interessa ao
  // atendente é que a conversa foi interrompida e alguém precisa voltar a ligar.
  if (base === 'connection_lost') return true;
  if (answered) return false;
  return base !== 'user_ended' && base !== 'terminate' && base !== 'cancelled' && base !== 'canceled';
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
      if (current === 'PREPARING') return 'PREPARING';
      // Uma chamada que já está tocando não volta para "Chamando…": o
      // `starting` do servidor também é o instante entre o aceite e a mídia, e
      // deixá-lo rebobinar a fase piscaria o rótulo na cara do operador.
      if (current === 'RINGING' || current === 'ENDING') return current;
      return 'CALLING';
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

/** O desfecho da chamada como a ficha do cliente — e o aviso — vão lê-lo. */
export type CallEndOutcome = 'answered' | 'missed' | 'declined' | 'failed';

/**
 * O motivo do fim vira desfecho — para uma chamada que NUNCA foi atendida aqui.
 *
 * Por que isto é regra e não detalhe: `missed` é o que acende o cartão de
 * chamada perdida na tela de todo mundo. Enquanto tudo o que não era `declined`
 * caía em `missed`, uma ligação ATENDIDA no celular do escritório virava, para
 * o CRM, uma perdida a retornar — e o aviso que mais rápido se aprende a
 * ignorar é o que avisa de coisa que não aconteceu.
 */
export function outcomeFromEndReason(reason: string | null): CallEndOutcome {
  const { base } = stripElsewhere(normalize(reason));
  // Alguém do escritório atendeu: no celular pareado, ou em outro aparelho da
  // mesma conta. Não há o que retornar.
  if (base === 'accepted') return 'answered';
  // Recusar é um ato — quem recusou viu a chamada. O "não perturbe" é o mesmo
  // ato, tomado antes, pelo aparelho.
  if (DECLINED_REASONS.has(base)) return 'declined';
  // Aborto de protocolo do WhatsApp (`enc` é da camada de criptografia) ou
  // defeito de mídia: não é gente deixando de atender. Fica no histórico como
  // falha e fora do aviso. `connection_lost` entra aqui porque quem desligou
  // fomos NÓS, por falta de áudio — não há a quem retornar, há o que consertar.
  if (FAILED_REASONS.has(base)) return 'failed';
  // `timeout`, `cancelled`, `busy`, `terminate` e `user_ended` numa chamada
  // recebida são perdida de verdade: o telefone tocou aqui e ninguém pegou.
  return 'missed';
}

/**
 * O desfecho final, cruzando o que o cronômetro achou com o que o fim afirma.
 *
 * A ordem importa e é esta: o MOTIVO vence o cronômetro. Uma chamada que o
 * contato recusou não é "atendida" só porque a mídia subiu antes de ele olhar
 * para o telefone (ver `endReasonMeansNeverAnswered`); e uma chamada em que se
 * conversou de verdade continua atendida ainda que o fim tenha chegado torto.
 */
export function resolveCallOutcome(
  reason: string | null,
  options: { connected: boolean; failed: boolean },
): CallEndOutcome {
  if (endReasonMeansNeverAnswered(reason)) return outcomeFromEndReason(reason);
  if (options.connected) return 'answered';
  if (options.failed) return 'failed';
  return outcomeFromEndReason(reason);
}

/**
 * O que o cartão diz DEPOIS que a chamada acabou.
 *
 * "Chamada encerrada" servia para tudo — inclusive para a que o contato
 * recusou, que é justamente a que o atendente precisa distinguir: não adianta
 * ligar de novo agora. Quem recusou também muda a frase: recusa nossa é
 * decisão do escritório; recusa do contato é "ele viu e não quis atender".
 */
export function endedCallLabel(
  reason: string | null,
  options: { answered: boolean; direction: 'outbound' | 'inbound' },
): string {
  const outcome = resolveCallOutcome(reason, { connected: options.answered, failed: false });
  const recebida = options.direction === 'inbound';
  const { base, elsewhere } = stripElsewhere(normalize(reason));
  // A queda da internet daqui é "atendida" na ficha (houve conversa), mas no
  // cartão ela precisa dizer o que houve: sem isto, a ligação que caiu ficava
  // idêntica à que o cliente encerrou de propósito.
  if (base === 'connection_lost') return 'A chamada caiu';
  switch (outcome) {
    case 'answered':
      return elsewhere ? 'Atendida em outro aparelho' : 'Chamada encerrada';
    case 'declined':
      return recebida ? 'Chamada recusada' : 'Chamada recusada pelo contato';
    case 'failed':
      return 'Chamada não completada';
    default:
      return recebida ? 'Chamada perdida' : 'Sem resposta';
  }
}
