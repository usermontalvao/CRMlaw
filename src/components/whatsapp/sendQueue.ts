// Fila de saída do compositor: garante que as mensagens cheguem ao WhatsApp na
// ORDEM em que foram disparadas, sem travar quem está escrevendo.
//
// Antes o compositor tinha uma trava única (`sending`): enquanto uma mensagem
// estava em voo, o botão de enviar ficava desabilitado e a próxima não saía.
// Quem atende escreve em rajada — três linhas curtas seguidas — e ficava
// esperando o servidor entre uma e outra. Tirar a trava sozinha não resolve:
// dois envios soltos ao mesmo tempo chegam na ordem que a rede quiser, e uma
// resposta pode aparecer antes da pergunta.
//
// A fila separa as duas coisas. Cada envio RESERVA seu lugar no instante do
// gesto (é a ordem que o atendente viu na tela), prepara o que precisa em
// paralelo — o upload de uma imagem não segura o texto seguinte — e só then
// espera a sua vez para o disparo em si. O resultado: todas as bolhas aparecem
// e carregam juntas, e a saída respeita a ordem digitada.

/** Um lugar reservado na fila. */
export interface SendTurn {
  /** Resolve quando o envio anterior terminou (com sucesso ou não). */
  wait: Promise<void>;
  /** Libera o próximo da fila. Idempotente — pode ser chamado no `finally`. */
  release: () => void;
}

export interface SendQueue {
  /** Reserva um lugar. Deve ser chamado de forma SÍNCRONA no gesto do usuário. */
  take: () => SendTurn;
  /** Lugares reservados que ainda não foram liberados. */
  size: () => number;
}

/**
 * Cria uma fila de envio.
 *
 * @param onDrain chamado quando o último lugar é liberado (fim da rajada).
 *        Serve para zerar o que valia só enquanto a rajada durava — por
 *        exemplo, "esta conversa já foi assumida por este lote de mensagens".
 */
export function createSendQueue(onDrain?: () => void): SendQueue {
  // A cauda é a promessa do ÚLTIMO lugar reservado: quem entra agora espera
  // por ela e passa a ser a nova cauda. Nunca rejeita — um envio que falha
  // libera a fila do mesmo jeito, senão uma falha travaria todo o resto.
  let tail: Promise<void> = Promise.resolve();
  let abertos = 0;

  return {
    take() {
      const wait = tail;
      let liberar!: () => void;
      tail = new Promise<void>(resolve => { liberar = resolve; });
      abertos += 1;
      let jaLiberado = false;
      return {
        wait,
        release: () => {
          if (jaLiberado) return;
          jaLiberado = true;
          abertos -= 1;
          liberar();
          if (abertos === 0) onDrain?.();
        },
      };
    },
    size: () => abertos,
  };
}
