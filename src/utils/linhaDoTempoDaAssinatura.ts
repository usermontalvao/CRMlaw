/**
 * O HISTÓRICO VIRA UMA HISTÓRIA.
 *
 * O painel de um documento mostrava o log do servidor cru, uma linha por
 * evento, todas com o mesmo peso. Num caso real do escritório isso deu
 * dezesseis linhas idênticas — "abriu o documento para leitura" — empurrando
 * para fora da tela os dois lembretes que o robô tinha mandado e a única coisa
 * que importava saber: a pessoa voltou dezesseis vezes e nunca conseguiu
 * passar da primeira etapa.
 *
 * Aqui as repetições viram uma linha só, que diz quantas foram e entre quando
 * e quando. Nada é escondido: o item guarda os eventos originais para quem
 * quiser abrir. É dobra, não corte — o dossiê probatório continua com tudo.
 *
 * Sem imports: `npm test` roda por ts-node e quebra com import relativo sem
 * extensão em qualquer ponto da cadeia.
 */

export interface EventoDeAuditoria {
  id: string;
  action: string;
  description: string;
  created_at: string;
  signer_id?: string | null;
  [extra: string]: unknown;
}

export interface ItemDaLinhaDoTempo<T extends EventoDeAuditoria = EventoDeAuditoria> {
  chave: string;
  acao: string;
  /** Quantos eventos iguais foram dobrados aqui. 1 = evento solto. */
  quantidade: number;
  /** O evento mais recente do grupo — é o que a linha mostra. */
  evento: T;
  /** O mais antigo do grupo, quando há mais de um. */
  primeiroEm: string | null;
  /** Todos os eventos, do mais antigo ao mais recente, para expandir. */
  eventos: T[];
}

/** Ações cuja repetição não conta uma história nova a cada vez. */
const DOBRAVEIS = new Set(['viewed']);

export function agruparLinhaDoTempo<T extends EventoDeAuditoria>(logs: T[]): ItemDaLinhaDoTempo<T>[] {
  const itens: ItemDaLinhaDoTempo<T>[] = [];

  for (const log of logs) {
    const anterior = itens[itens.length - 1];
    const podeDobrar = anterior
      && DOBRAVEIS.has(log.action)
      && anterior.acao === log.action
      && (anterior.evento.signer_id ?? null) === (log.signer_id ?? null);

    if (podeDobrar) {
      anterior.eventos.push(log);
      anterior.quantidade += 1;
      // A lista chega em ordem crescente, mas não se pode contar com isso: o
      // mais recente é decidido pela data, não pela posição.
      if (new Date(log.created_at).getTime() >= new Date(anterior.evento.created_at).getTime()) {
        anterior.evento = log;
      }
      const primeiro = anterior.eventos
        .map((e) => e.created_at)
        .sort()[0];
      anterior.primeiroEm = primeiro ?? null;
      continue;
    }

    itens.push({
      chave: log.id,
      acao: log.action,
      quantidade: 1,
      evento: log,
      primeiroEm: null,
      eventos: [log],
    });
  }

  return itens;
}

/** "16 aberturas" / "abriu o documento" — o rótulo da linha dobrada. */
export function descreverGrupo(item: ItemDaLinhaDoTempo): string {
  if (item.quantidade === 1) return item.evento.description;
  if (item.acao === 'viewed') return `${item.quantidade} aberturas do documento`;
  return `${item.quantidade} × ${item.evento.description}`;
}
