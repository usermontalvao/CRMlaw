/**
 * Registro compartilhado por chave, com contagem de referências.
 *
 * O padrão que este módulo impõe:
 *
 *     1 assinatura  →  registro  →  N consumidores
 *
 * e não o que existia:
 *
 *     componente A → assinatura
 *     componente B → assinatura
 *
 * O caso concreto: `ThreadScheduledGhosts` (as bolhas-fantasma na thread) e
 * `ScheduledMessagesPanel` (o painel lateral) mostram a MESMA lista de mensagens
 * agendadas da MESMA conversa. Cada um abria o seu canal `wa-sched-<conversa>` e
 * disparava o seu `listScheduled(conversa)` — dois canais idênticos e duas
 * consultas idênticas, lado a lado, para o mesmo dado na mesma tela. Nos logs da
 * API isso aparecia como o mesmo `GET whatsapp_scheduled_messages` repetido.
 *
 * Regras:
 *  · o PRIMEIRO consumidor de uma chave abre o recurso;
 *  · os seguintes entram na lista e recebem na hora o último valor conhecido —
 *    ninguém espera uma segunda ida ao servidor pelo que já está em memória;
 *  · o ÚLTIMO a sair fecha. Chaves diferentes (conversas diferentes) são
 *    independentes e não se enxergam.
 *
 * Cancelar é idempotente, porque o StrictMode do React chama todo cleanup duas
 * vezes: a segunda chamada não pode fechar o recurso de quem chegou no meio.
 *
 * Sem imports de propósito: o módulo é puro para o ts-node do `npm test`
 * conseguir carregá-lo sem arrastar a cadeia de imports do cliente Supabase.
 */

export interface RegistroCompartilhado<T> {
  /**
   * Entra na lista da `chave`. Devolve o cancelamento (idempotente).
   * O ouvinte recebe o último valor conhecido imediatamente, se houver.
   */
  assinar: (chave: string, ouvinte: (valor: T) => void) => () => void;
  /** Reentrega o valor atual a todos os ouvintes da chave, se houver algum. */
  publicar: (chave: string, valor: T) => void;
  /** Quantas chaves estão abertas. Só para diagnóstico e teste. */
  abertos: () => number;
  /** Quantos consumidores a chave tem. Só para diagnóstico e teste. */
  consumidores: (chave: string) => number;
}

export interface OpcoesRegistroCompartilhado<T> {
  /**
   * Abre o recurso da chave (canal + carga inicial). Recebe `publicar` para
   * entregar valores. Devolve o cleanup, chamado quando o último consumidor sai.
   */
  abrir: (chave: string, publicar: (valor: T) => void) => () => void;
  /**
   * O que trafega é ESTADO (`true`, padrão) ou EVENTO (`false`)?
   *
   * Estado — "a lista de agendadas desta conversa" — pode e deve ser reentregue
   * a quem chega depois: é a foto atual, e sem ela o recém-chegado ficaria vazio
   * até a próxima mudança.
   *
   * Evento — "chegou esta mensagem", "alguém te chamou" — NÃO pode. Reentregar
   * o último evento a cada novo consumidor faria uma mensagem antiga tocar o
   * aviso de novo toda vez que alguém abrisse o chat.
   */
  reentregarUltimo?: boolean;
  /** Ex.: `[Jurius Realtime][Scheduled]`. */
  marca?: string;
  registrar?: (linha: string) => void;
}

interface Entrada<T> {
  ouvintes: Set<(valor: T) => void>;
  fechar: () => void;
  /** `undefined` = ainda não chegou nada; distinto de um valor legítimo nulo. */
  ultimo: { valor: T } | undefined;
}

export function criarRegistroCompartilhado<T>(
  opcoes: OpcoesRegistroCompartilhado<T>,
): RegistroCompartilhado<T> {
  const marca = opcoes.marca ?? '[Jurius Realtime][Shared]';
  const registrar = opcoes.registrar;
  const reentregarUltimo = opcoes.reentregarUltimo !== false;
  const entradas = new Map<string, Entrada<T>>();

  const publicar = (chave: string, valor: T) => {
    const entrada = entradas.get(chave);
    if (!entrada) return;
    if (reentregarUltimo) entrada.ultimo = { valor };
    // Cópia da lista: um ouvinte que se desinscreve dentro do próprio callback
    // não pode quebrar a iteração.
    for (const ouvinte of [...entrada.ouvintes]) {
      try {
        ouvinte(valor);
      } catch {
        /* um consumidor quebrado não derruba os outros nem o canal */
      }
    }
  };

  return {
    assinar: (chave, ouvinte) => {
      let entrada = entradas.get(chave);
      if (!entrada) {
        registrar?.(`${marca} SUBSCRIBE`);
        // A entrada entra no mapa ANTES de `abrir`, porque `abrir` pode publicar
        // de forma síncrona — e um `publicar` sem entrada no mapa se perderia.
        const nova: Entrada<T> = { ouvintes: new Set(), fechar: () => {}, ultimo: undefined };
        entradas.set(chave, nova);
        nova.fechar = opcoes.abrir(chave, (valor) => publicar(chave, valor));
        entrada = nova;
      } else {
        registrar?.(`${marca} REUSE`);
      }

      entrada.ouvintes.add(ouvinte);
      // Quem chega depois não espera uma nova ida ao servidor pelo que já está
      // em memória — é o que torna o compartilhamento invisível para a tela.
      if (entrada.ultimo !== undefined) {
        try {
          ouvinte(entrada.ultimo.valor);
        } catch {
          /* idem */
        }
      }

      let saiu = false;
      return () => {
        if (saiu) return;
        saiu = true;
        const atual = entradas.get(chave);
        if (!atual) return;
        atual.ouvintes.delete(ouvinte);
        if (atual.ouvintes.size > 0) return;
        registrar?.(`${marca} UNSUBSCRIBE`);
        entradas.delete(chave);
        atual.fechar();
      };
    },

    publicar,
    abertos: () => entradas.size,
    consumidores: (chave) => entradas.get(chave)?.ouvintes.size ?? 0,
  };
}
