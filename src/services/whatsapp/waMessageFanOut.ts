/**
 * O fan-out local dos eventos de mensagem: uma lista de ouvintes e um filtro de
 * repetição, para que UM canal atenda todos os consumidores da aba.
 *
 * Dois motivos para isto viver separado do `messageEvents.ts`:
 *
 *  · repetição — enquanto o broadcast e a rede de postgres_changes estiverem
 *    ligados juntos, a MESMA mudança chega pelos dois caminhos. Se a duplicata
 *    passasse daqui, ela viraria dois toques de notificação para uma mensagem
 *    só. Filtrar no fan-out mata o par antes de qualquer consumidor ver;
 *
 *  · remontagem — quem entra e sai da lista é o React. Uma inscrição que não
 *    saísse na desmontagem acumularia a cada volta ao módulo, e a mesma mensagem
 *    seria processada tantas vezes quantas o atendente tivesse aberto a inbox.
 *
 * Sem imports de valor: só o tipo, que é apagado na compilação. O módulo é puro
 * para o ts-node do `npm test` carregá-lo sem arrastar o cliente Supabase.
 */
import type { WaMessageEvent } from './waMessageEvent';

export type OuvinteDeMensagem = (evento: WaMessageEvent) => void;

/** Quanto tempo o mesmo fato é considerado repetição. */
export const JANELA_DE_REPETICAO_MS = 5_000;

/** Teto da memória do filtro: rajada de importação não pode virar vazamento. */
const LIMITE_DE_IMPRESSOES = 500;

/**
 * A identidade de um FATO, não a de um evento.
 *
 * O que identifica é a operação, a linha e o que mudou nela — nunca o conteúdo,
 * que vem cortado em 120 por um caminho e inteiro pelo outro, e que colocaria
 * texto de cliente dentro de uma chave de cache.
 */
function impressaoDe(evento: WaMessageEvent): string {
  return `${evento.op}|${evento.id}|${evento.status ?? ''}|${evento.refresh ? 1 : 0}`;
}

export interface FanOutDeMensagens {
  /** Inscreve e devolve o cancelamento. */
  assinar: (ouvinte: OuvinteDeMensagem) => () => void;
  /** Entrega a todos. `null` e repetição são descartados em silêncio. */
  emitir: (evento: WaMessageEvent | null, agora?: number) => void;
  /** Quantos ouvintes ativos — é o que decide abrir e fechar o canal. */
  quantidade: () => number;
}

export function criarFanOutDeMensagens(opcoes: {
  janelaMs?: number;
  /** Um consumidor que estoura não pode derrubar os outros nem o canal. */
  aoErroDeOuvinte?: (mensagem: string) => void;
} = {}): FanOutDeMensagens {
  const janelaMs = opcoes.janelaMs ?? JANELA_DE_REPETICAO_MS;
  const ouvintes = new Set<OuvinteDeMensagem>();
  const vistos = new Map<string, number>();

  /**
   * `true` quando o evento é novidade. A janela é curta de propósito:
   * `sent → delivered → read` são fatos DIFERENTES da mesma mensagem (o `status`
   * entra na impressão), e uma releitura pedida de novo minutos depois é legítima.
   */
  const novidade = (evento: WaMessageEvent, agora: number): boolean => {
    const impressao = impressaoDe(evento);
    const anterior = vistos.get(impressao);
    if (anterior !== undefined && agora - anterior < janelaMs) return false;

    vistos.set(impressao, agora);
    if (vistos.size > LIMITE_DE_IMPRESSOES) {
      // Map preserva ordem de inserção: os mais antigos saem primeiro.
      for (const chave of vistos.keys()) {
        vistos.delete(chave);
        if (vistos.size <= LIMITE_DE_IMPRESSOES) break;
      }
    }
    return true;
  };

  return {
    assinar: (ouvinte) => {
      ouvintes.add(ouvinte);
      let saiu = false;
      // O cancelamento precisa ser idempotente: o StrictMode do React chama o
      // cleanup duas vezes, e a segunda não pode remover a inscrição de outro.
      return () => {
        if (saiu) return;
        saiu = true;
        ouvintes.delete(ouvinte);
      };
    },

    emitir: (evento, agora = Date.now()) => {
      if (!evento || !novidade(evento, agora)) return;
      // Cópia da lista: um ouvinte que se desinscreve dentro do próprio callback
      // (acontece no unmount durante uma rajada) não pode quebrar a iteração.
      for (const ouvinte of [...ouvintes]) {
        try {
          ouvinte(evento);
        } catch (erro) {
          opcoes.aoErroDeOuvinte?.(erro instanceof Error ? erro.message : '');
        }
      }
    },

    quantidade: () => ouvintes.size,
  };
}
