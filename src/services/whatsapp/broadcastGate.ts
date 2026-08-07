/**
 * A política de conexão do canal privado `whatsapp:messages`.
 *
 * Existe por causa de um laço concreto, medido em produção. O canal é privado, e
 * o Realtime só aceita o join se o JWT do atendente já estiver no RealtimeClient
 * quando o `phx_join` sobe. Quando não está, o join sobe como `anon`, a policy
 * (`TO authenticated`) não se aplica e o servidor responde
 * "Unauthorized: You do not have permissions to read from this Channel topic".
 *
 * Até aqui seria só um erro. O laço vinha do que acontecia DEPOIS: o canal em
 * erro era deixado de pé. O `RealtimeChannel` do supabase-js tem um `rejoinTimer`
 * próprio que refaz o join sozinho em 1s, 2s, 5s, 10s e daí em diante a cada 10s,
 * PARA SEMPRE — não há limite de tentativas na biblioteca. Cada join reavalia a
 * policy no Postgres. Com algumas abas abertas isso deu ~12 avaliações por minuto,
 * ~20 mil em 26 horas, e o Realtime passou a responder
 * `IncreaseSubscriptionConnectionPool: Too many database timeouts`. Nos logs o
 * espaçamento exato de 10s entre os "Unauthorized" é a assinatura desse timer.
 *
 * Daí as duas regras que este módulo existe para garantir:
 *
 *  1. o token vai para o Realtime ANTES de o canal ser criado — nunca se assina
 *     um tópico privado sem sessão;
 *  2. um canal que deu erro é REMOVIDO na hora. Remover é o que desarma o
 *     `rejoinTimer` da biblioteca (`unsubscribe` → `close` → `rejoinTimer.reset`).
 *     A partir daí quem decide se e quando tentar de novo é este módulo, com
 *     backoff e com FIM: quatro tentativas e para. Um tópico negado por RLS não
 *     vira liberado por insistência — insistir só cobra do banco.
 *
 * Sem imports de propósito: o módulo é puro para o ts-node do `npm test`
 * conseguir carregá-lo sem arrastar a cadeia de imports do cliente Supabase.
 */

/** Prefixo de todo log daqui. O escopo entra montado pelo chamador. */
export type StatusAssinatura = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' | string;

/** Eventos de sessão que interessam (os nomes vêm do `onAuthStateChange`). */
export type EventoSessao = 'SIGNED_IN' | 'TOKEN_REFRESHED' | 'SIGNED_OUT' | string;

/**
 * Espera antes de cada nova tentativa. Cresce rápido e ACABA.
 *
 * O caso que motivou o teto não é rede oscilando (essa volta sozinha) — é
 * autorização negada, que não muda por tentar de novo. Quatro tentativas cobrem
 * a corrida do token no carregamento da página; passou disso, a resposta é
 * parar e deixar a rede de postgres_changes trabalhando.
 */
export const BROADCAST_RETRY_DELAYS = [2_000, 5_000, 15_000, 30_000] as const;

/** Quantas tentativas existem depois da primeira falha. */
export const BROADCAST_MAX_RETRIES = BROADCAST_RETRY_DELAYS.length;

/**
 * Espera da tentativa `tentativa` (0 = primeira reação ao erro), ou `null`
 * quando o limite acabou — `null` é "não tente mais", não "tente em 0ms".
 */
export function broadcastRetryDelay(tentativa: number): number | null {
  if (!Number.isFinite(tentativa) || tentativa < 0) return BROADCAST_RETRY_DELAYS[0];
  const indice = Math.floor(tentativa);
  return indice < BROADCAST_RETRY_DELAYS.length ? BROADCAST_RETRY_DELAYS[indice] : null;
}

/** Estados de canal que significam "não estou mais entregando evento nenhum". */
export function isStatusDeQueda(status: StatusAssinatura): boolean {
  return status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED';
}

export interface DependenciasPortao<C> {
  /** Ex.: `[Jurius Realtime][WhatsApp]`. */
  marca: string;
  /** Token da sessão atual, ou `null` se não houver sessão válida. */
  lerToken: () => Promise<string | null>;
  /** Entrega o token ao RealtimeClient. Aguardado antes de qualquer canal. */
  aplicarToken: (token: string) => Promise<void> | void;
  /** Cria e assina o canal broadcast, devolvendo-o. */
  abrirBroadcast: (
    aoStatus: (status: StatusAssinatura, erro?: { message?: string } | null) => void,
  ) => C;
  /** Cria e assina a rede de postgres_changes. */
  abrirFallback: () => C;
  remover: (canal: C) => void;
  agendar: (fn: () => void, ms: number) => unknown;
  cancelar: (id: unknown) => void;
  registrar?: (linha: string) => void;
  avisar?: (linha: string) => void;
}

export interface PortaoBroadcast {
  /** Idempotente: chamar de novo com canal no ar (ou tentativa agendada) não faz nada. */
  iniciar: () => void;
  /** SIGNED_IN/TOKEN_REFRESHED rearmam; SIGNED_OUT desliga tudo. */
  aoEventoDeSessao: (evento: EventoSessao) => void;
  /** Desmontagem definitiva: cancela timer e remove os canais. */
  encerrar: () => void;
}

/**
 * Só a mensagem, cortada. Um erro inteiro no console arrastaria o payload junto,
 * e payload de mensagem tem texto de cliente dentro.
 */
function mensagemDe(erro: unknown): string {
  const bruta =
    erro instanceof Error
      ? erro.message
      : typeof (erro as { message?: unknown } | null)?.message === 'string'
        ? ((erro as { message: string }).message)
        : '';
  return bruta.slice(0, 120);
}

export function criarPortaoBroadcast<C>(deps: DependenciasPortao<C>): PortaoBroadcast {
  const registrar = deps.registrar ?? ((linha: string) => console.info(linha));
  const avisar = deps.avisar ?? ((linha: string) => console.warn(linha));
  const marca = `${deps.marca}[Broadcast]`;

  let canal: C | null = null;
  let fallback: C | null = null;
  let timer: unknown = null;
  let tentativa = 0;
  let abrindo = false;
  let descartado = false;
  /**
   * Numeração de canais. `remover` faz o canal removido reportar CLOSED, que é
   * indistinguível de uma queda de verdade — e como quem remove é a própria
   * rotina de reconexão, tratar esse adeus como queda faria cada tentativa
   * provocar a seguinte. Um canal aposentado não tem mais voz, diga o que disser.
   */
  let geracao = 0;

  const cancelarTimer = () => {
    if (timer === null) return;
    deps.cancelar(timer);
    timer = null;
  };

  /** Aposenta o canal atual. Sempre avança a geração, mesmo sem canal aberto. */
  const aposentar = () => {
    geracao += 1;
    if (canal === null) return;
    deps.remover(canal);
    canal = null;
  };

  const removerFallback = () => {
    if (fallback === null) return;
    deps.remover(fallback);
    fallback = null;
  };

  /**
   * A rede de postgres_changes. Idempotente: uma sequência de CHANNEL_ERROR não
   * pode virar pilha de canais. Uma vez aberta fica aberta — enquanto o broadcast
   * não estiver comprovadamente estável, tirar a rede no primeiro SUBSCRIBED
   * devolveria o buraco de entrega que ela existe para tapar.
   */
  const abrirFallback = () => {
    if (fallback !== null || descartado) return;
    try {
      fallback = deps.abrirFallback();
      registrar(`${deps.marca}[PostgresFallback] ABRINDO`);
    } catch (erro) {
      // A rede é a rede, não o trapézio: se ela falhar, o resto continua.
      avisar(`${deps.marca}[PostgresFallback] CHANNEL_ERROR ${mensagemDe(erro)}`.trim());
      fallback = null;
    }
  };

  const agendarNovaTentativa = () => {
    if (descartado || timer !== null) return;
    const espera = broadcastRetryDelay(tentativa);
    if (espera === null) {
      // Fim de linha. Nada mais é agendado até uma sessão nova chegar — é isso
      // que impede o canal negado de virar 20 mil joins por dia.
      avisar(`${marca} RETRY_ABORTED`);
      return;
    }
    tentativa += 1;
    registrar(`${marca} RETRY_SCHEDULED ${espera}ms`);
    timer = deps.agendar(() => {
      timer = null;
      void tentarAbrir();
    }, espera);
  };

  const aoStatus =
    (minhaGeracao: number) => (status: StatusAssinatura, erro?: { message?: string } | null) => {
      if (descartado || minhaGeracao !== geracao) return;
      if (status === 'SUBSCRIBED') {
        tentativa = 0;
        registrar(`${marca} SUBSCRIBED`);
        return;
      }
      if (!isStatusDeQueda(status)) return; // 'joining' e afins não são notícia
      avisar(`${marca} CHANNEL_ERROR ${status} ${mensagemDe(erro)}`.trim());
      // A rede entra ANTES de qualquer espera: o atendente não fica sem mensagem
      // enquanto o backoff corre.
      abrirFallback();
      // Remover é o ponto todo desta correção: é o que desarma o rejoinTimer da
      // biblioteca. Sem isto, o backoff daqui só se somaria ao laço de 10s dela.
      aposentar();
      agendarNovaTentativa();
    };

  const tentarAbrir = async (): Promise<void> => {
    if (descartado || abrindo || canal !== null) return;
    abrindo = true;
    try {
      const token = await deps.lerToken();
      if (descartado) return;
      if (!token) {
        // Sem sessão não se assina tópico privado: o join subiria como `anon` e
        // seria negado — exatamente o erro que alimentava o laço.
        avisar(`${marca} AUTH_MISSING`);
        abrirFallback();
        return;
      }
      await deps.aplicarToken(token);
      if (descartado) return;
      registrar(`${marca} AUTH_READY`);

      const minhaGeracao = geracao;
      const novo = deps.abrirBroadcast(aoStatus(minhaGeracao));
      // O canal pode ter sido aposentado enquanto subia (erro síncrono, encerramento
      // no meio do await). Nesse caso ele já nasceu órfão — não pode virar `canal`.
      if (descartado || geracao !== minhaGeracao) {
        deps.remover(novo);
        return;
      }
      canal = novo;
    } catch (erro) {
      avisar(`${marca} CHANNEL_ERROR ${mensagemDe(erro)}`.trim());
      abrirFallback();
      agendarNovaTentativa();
    } finally {
      abrindo = false;
    }
  };

  return {
    iniciar: () => {
      // Uma tentativa agendada é uma inicialização em curso: deixar `iniciar`
      // furar o backoff faria cada remontagem do módulo reabrir na hora.
      if (descartado || timer !== null) return;
      void tentarAbrir();
    },

    aoEventoDeSessao: (evento) => {
      if (descartado) return;
      if (evento === 'SIGNED_OUT') {
        cancelarTimer();
        aposentar();
        // A rede também sai: sem sessão ela não passa pela RLS de
        // `whatsapp_messages`, e um canal sem dono é só socket parado.
        removerFallback();
        tentativa = 0;
        registrar(`${marca} CLEANED_UP`);
        return;
      }
      // Todo evento que não seja logout rearma. A lista do supabase-js tem
      // INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED,
      // PASSWORD_RECOVERY e MFA_CHALLENGE_VERIFIED, e cada um deles pode trazer
      // um JWT novo — INITIAL_SESSION é justamente o que chega no carregamento
      // da página, quando a sessão sai do localStorage. Uma lista de permitidos
      // erraria calada: o canal ficaria parado até a renovação seguinte do token,
      // até uma hora depois. Rearmar à toa não custa — com o canal no ar isto não
      // faz nada, e com ele fora o limite de tentativas continua valendo.
      cancelarTimer();
      tentativa = 0;
      if (canal !== null) return; // já no ar: não se derruba o que funciona
      void tentarAbrir();
    },

    encerrar: () => {
      if (descartado) return;
      descartado = true;
      cancelarTimer();
      aposentar();
      removerFallback();
      registrar(`${marca} CLEANED_UP`);
    },
  };
}
