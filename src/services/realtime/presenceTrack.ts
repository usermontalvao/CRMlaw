/**
 * Controle de envio de presença: deduplicação por conteúdo e throttle.
 *
 * Existe por causa de um erro concreto do Realtime em produção,
 * `ClientPresenceRateLimitReached: client_rate_limit_exceeded`. A origem era o
 * indicador de "está digitando" do chat interno: cada TECLA chamava
 * `channel.track({ ..., typing: true })`. Digitar "bom dia, doutor" mandava
 * quinze atualizações de presença em dois segundos — todas com exatamente o
 * mesmo conteúdo, porque o que mudava era o texto da mensagem, que nem sequer
 * entra no payload de presença.
 *
 * Daí as duas regras, nesta ordem:
 *
 *  1. DEDUPLICAÇÃO por conteúdo. Presença é estado, não evento: reenviar o mesmo
 *     estado não informa nada a ninguém. Uma referência JavaScript nova não é
 *     mudança — o que conta é o valor dos campos. Só isto já resolve o caso do
 *     "está digitando", em que o payload é idêntico tecla após tecla.
 *
 *  2. THROTTLE, para o payload que muda de verdade em rajada (arrastar o cursor,
 *     trocar de conversa com o teclado). Mantém a PRIMEIRA atualização imediata
 *     — presença atrasada é presença errada — e agrupa o resto numa atualização
 *     ao fim da janela, para o estado final nunca se perder.
 *
 * Sem imports de propósito: o módulo é puro para o ts-node do `npm test`
 * conseguir carregá-lo sem arrastar a cadeia de imports do cliente Supabase.
 */

/** Janela padrão entre dois envios de presença do mesmo canal. */
export const INTERVALO_PRESENCA_MS = 1_500;

/**
 * Assinatura estável de um payload: mesmas chaves e mesmos valores produzem a
 * mesma string, independente da ordem em que o objeto foi montado.
 *
 * Feita à mão, e não com `JSON.stringify` direto, porque a ordem das chaves de
 * um objeto montado em lugares diferentes do código não é garantida — e uma
 * assinatura instável derrubaria a deduplicação sem ninguém perceber.
 */
export function assinaturaDePayload(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null';
  if (Array.isArray(valor)) return `[${valor.map(assinaturaDePayload).join(',')}]`;
  const entradas = Object.entries(valor as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${assinaturaDePayload(v)}`).join(',')}}`;
}

export interface ControleDePresenca<P> {
  /**
   * Pede a publicação de um estado. Pode não virar envio nenhum (repetido) ou
   * virar um envio adiado (dentro da janela do throttle).
   */
  publicar: (payload: P, agora?: number) => void;
  /**
   * Esquece o último estado enviado, sem enviar nada. Usado quando o canal cai:
   * na volta, o mesmo payload precisa subir de novo, senão a pessoa fica
   * invisível para os colegas até mudar de conversa.
   */
  esquecer: () => void;
  /** Cancela o envio adiado. Obrigatório no cleanup. */
  encerrar: () => void;
}

export interface OpcoesControleDePresenca<P> {
  /** O envio de verdade — normalmente `channel.track`. */
  enviar: (payload: P) => void;
  intervaloMs?: number;
  agendar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (id: unknown) => void;
  /** Ex.: `[Jurius Realtime][Presence][Chat]`. Só usado se `registrar` existir. */
  marca?: string;
  registrar?: (linha: string) => void;
}

export function criarControleDePresenca<P>(
  opcoes: OpcoesControleDePresenca<P>,
): ControleDePresenca<P> {
  const intervaloMs = opcoes.intervaloMs ?? INTERVALO_PRESENCA_MS;
  const agendar =
    opcoes.agendar ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const cancelar =
    opcoes.cancelar ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const marca = opcoes.marca ?? '[Jurius Realtime][Presence]';
  const registrar = opcoes.registrar;

  let ultimaAssinatura: string | null = null;
  let ultimoEnvio = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  /** Estado que chegou dentro da janela e ainda não subiu. */
  let pendente: { payload: P; assinatura: string } | null = null;

  const enviarAgora = (payload: P, assinatura: string, agora: number) => {
    ultimaAssinatura = assinatura;
    ultimoEnvio = agora;
    registrar?.(`${marca} TRACK`);
    opcoes.enviar(payload);
  };

  const cancelarTimer = () => {
    if (timer === null) return;
    cancelar(timer);
    timer = null;
  };

  return {
    publicar: (payload, agora = Date.now()) => {
      const assinatura = assinaturaDePayload(payload);
      // Presença é estado: o mesmo estado de novo não é notícia para ninguém.
      if (assinatura === ultimaAssinatura) {
        registrar?.(`${marca} TRACK_SKIPPED_DUPLICATE`);
        pendente = null;
        cancelarTimer();
        return;
      }

      const desdeOUltimo = agora - ultimoEnvio;
      if (desdeOUltimo >= intervaloMs) {
        cancelarTimer();
        pendente = null;
        enviarAgora(payload, assinatura, agora);
        return;
      }

      // Dentro da janela: guarda o mais recente e deixa marcado para o fim dela.
      // Só o ÚLTIMO estado sobe — os intermediários de uma rajada não interessam.
      pendente = { payload, assinatura };
      if (timer !== null) return;
      timer = agendar(() => {
        timer = null;
        const aSubir = pendente;
        pendente = null;
        if (!aSubir || aSubir.assinatura === ultimaAssinatura) return;
        enviarAgora(aSubir.payload, aSubir.assinatura, ultimoEnvio + intervaloMs);
      }, intervaloMs - desdeOUltimo);
    },

    esquecer: () => {
      ultimaAssinatura = null;
    },

    encerrar: () => {
      cancelarTimer();
      pendente = null;
      ultimaAssinatura = null;
      // O relógio do throttle também volta ao início. Sem isto, um controle
      // reaproveitado depois do cleanup herdaria a janela do canal ANTERIOR e
      // seguraria a primeira publicação do canal novo — presença atrasada logo
      // na entrada, que é justamente o que o envio imediato existe para evitar.
      ultimoEnvio = Number.NEGATIVE_INFINITY;
      registrar?.(`${marca} CLEANUP`);
    },
  };
}
