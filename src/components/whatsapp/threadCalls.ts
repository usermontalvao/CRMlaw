// A ligação como uma linha da CONVERSA — do jeito que o WhatsApp escreve.
//
// A ficha do cliente já tinha o registro das chamadas (aba "Chamadas"), mas
// quem atende não vive na ficha: vive na thread. E é lá que a ligação faz
// falta, porque ela é parte da MESMA conversa. Sem isso, a leitura do
// atendimento tinha um buraco no meio — "mandei os documentos" … silêncio de
// duas horas … "então ficou combinado assim" — e o que aconteceu no silêncio
// (uma ligação de 6 minutos) não estava em lugar nenhum daquela tela.
//
// AS PALAVRAS SÃO AS DO WHATSAPP, de propósito. Quem trabalha na inbox tem o
// aplicativo aberto no celular ao lado; usar outro vocabulário para os mesmos
// seis desfechos obrigaria a traduzir mentalmente a cada linha. Duas coisas
// mudam de nome porque no CRM elas significam outra coisa:
//   · quem recusou. No celular a recusa é sempre sua; aqui a chamada de saída
//     pode ter sido recusada PELO CONTATO, e isso muda o que o atendente faz em
//     seguida (não insistir agora). As duas recusas são ditas com todas as letras.
//   · "falhou" existe. É o desfecho de erro do WaCalls, e ele não é a mesma
//     coisa que "não atenderam" — um pede tentar de novo, o outro pede esperar.
//
// PURO DE PROPÓSITO: nenhum import (ver o cabeçalho de `attendanceRouting.ts`).

export type ThreadCallDirection = 'inbound' | 'outbound';
export type ThreadCallOutcome = 'answered' | 'missed' | 'declined' | 'failed';

export interface ThreadCallInput {
  direction: ThreadCallDirection;
  outcome: ThreadCallOutcome;
  /** Segundos de conversa. Só faz sentido em chamada atendida. */
  durationSeconds?: number | null;
}

/** Qual seta desenhar. `missed` é a seta quebrada, em vermelho. */
export type ThreadCallIcon = 'incoming' | 'outgoing' | 'missed';

export interface ThreadCallLabel {
  /** A frase da linha: "Chamada de voz perdida", "Sem resposta"… */
  title: string;
  icon: ThreadCallIcon;
  /** `true` pinta a linha de vermelho — algo ficou pendente de retorno. */
  attention: boolean;
  /** "6 min 12 s" quando houve conversa; `null` quando não houve. */
  duration: string | null;
}

/**
 * "6 min 12 s" / "42 s" / "1 h 3 min" — duração para ler, não para calcular.
 *
 * Passa de hora com mais frequência do que parece: audiência por vídeo e
 * perícia acompanhada ficam na linha o tempo todo, e "78 min" é pior de ler.
 */
export function formatCallDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  if (total === 0) return '';
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const resto = total % 60;
  if (horas > 0) return minutos > 0 ? `${horas} h ${minutos} min` : `${horas} h`;
  if (minutos === 0) return `${resto} s`;
  return resto === 0 ? `${minutos} min` : `${minutos} min ${resto} s`;
}

/** A linha da chamada, pronta para desenhar. */
export function threadCallLabel(call: ThreadCallInput): ThreadCallLabel {
  const recebida = call.direction === 'inbound';
  const atendida = call.outcome === 'answered';
  const duration = atendida ? (formatCallDuration(call.durationSeconds) || null) : null;

  if (atendida) {
    return {
      title: recebida ? 'Chamada de voz recebida' : 'Chamada de voz',
      icon: recebida ? 'incoming' : 'outgoing',
      attention: false,
      duration,
    };
  }

  if (call.outcome === 'declined') {
    return {
      // Quem recusou é a informação: recusa nossa é decisão do escritório;
      // recusa do contato é "ele viu e não quis atender agora".
      title: recebida ? 'Chamada recusada' : 'Chamada recusada pelo contato',
      icon: recebida ? 'missed' : 'outgoing',
      attention: recebida,
      duration: null,
    };
  }

  if (call.outcome === 'failed') {
    return { title: 'A chamada falhou', icon: 'missed', attention: true, duration: null };
  }

  // missed. A assimetria é real: uma chamada RECEBIDA que ninguém atendeu é
  // dívida do escritório (aparece em vermelho, como no celular); uma de saída
  // que o contato não atendeu é só "não estava lá".
  return {
    title: recebida ? 'Chamada de voz perdida' : 'Sem resposta',
    icon: recebida ? 'missed' : 'outgoing',
    attention: recebida,
    duration: null,
  };
}
