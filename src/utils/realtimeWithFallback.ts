/**
 * Broadcast com rede de segurança de postgres_changes.
 *
 * Temporário: existe só enquanto o Broadcast não estiver confirmado com sessão
 * real em produção. Quando estiver, este módulo sai inteiro, junto com os logs,
 * e só então as tabelas saem da publicação.
 *
 * Por que a rede existe: o canal privado só é aceito se o token já tiver
 * chegado ao RealtimeClient quando o join sobe. `subscribe()` lê
 * `accessTokenValue` de forma síncrona, enquanto `connect()` dispara
 * `setAuth()` sem esperar — na prática o token chega antes do handshake do
 * WebSocket, mas é uma corrida.
 *
 * O fallback só abre no caminho degradado. Deixar os dois ligados juntos
 * pagaria de novo a decodificação de linha inteira que o Broadcast veio
 * remover: 184 MB de corpos de e-mail e 83 MB de .docx.
 *
 * Os dois caminhos entram pelo mesmo debounce, então um aviso que chegue pelos
 * dois não vira duas recargas.
 *
 * Sem imports: o módulo é puro de propósito, para o ts-node do `npm test`
 * conseguir carregá-lo sem arrastar a cadeia de imports do componente.
 */

export type StatusAssinatura = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR' | string;

export type AoStatus = (status: StatusAssinatura, erro?: { message?: string } | null) => void;

export interface OpcoesRealtimeComFallback<C> {
  /** Aparece no log: `Email`, `Petitions`. */
  escopo: string;
  /** Janela do debounce, em ms. */
  atrasoMs: number;
  /** O que fazer quando a janela fecha. */
  recarregar: () => void;
  abrirBroadcast: (aoEvento: () => void, aoStatus: AoStatus) => C;
  abrirFallback: (aoEvento: () => void, aoStatus: AoStatus) => C;
  remover: (canal: C) => void;
  registrar?: (linha: string) => void;
  avisar?: (linha: string) => void;
  agendar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (id: unknown) => void;
}

/**
 * Liga os dois caminhos e devolve o cleanup. O cleanup cancela o timer
 * pendente e remove todos os canais abertos — inclusive o fallback, se tiver
 * chegado a abrir.
 */
export function ligarRealtimeComFallback<C>(opcoes: OpcoesRealtimeComFallback<C>): () => void {
  const registrar = opcoes.registrar ?? ((linha: string) => console.info(linha));
  const avisar = opcoes.avisar ?? ((linha: string) => console.warn(linha));
  const agendar = opcoes.agendar ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancelar =
    opcoes.cancelar ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));

  const marca = `[Jurius Realtime][${opcoes.escopo}]`;

  let timer: unknown = null;
  let desmontado = false;
  let fallback: C | null = null;

  const agendarRecarga = () => {
    // Nada do conteúdo entra aqui — só o fato de que uma recarga foi agendada.
    registrar(`${marca} RELOAD_SCHEDULED`);
    if (timer !== null) cancelar(timer);
    timer = agendar(() => {
      timer = null;
      opcoes.recarregar();
    }, opcoes.atrasoMs);
  };

  const abrirFallback = () => {
    // Idempotente: uma sequência de CHANNEL_ERROR (o Realtime tenta rejuntar)
    // não pode virar uma pilha de canais. E depois do cleanup não abre mais
    // nada, senão o canal ficaria sem dono.
    if (fallback !== null || desmontado) return;
    try {
      fallback = opcoes.abrirFallback(
        () => {
          registrar(`${marca}[PostgresFallback] EVENT_RECEIVED`);
          agendarRecarga();
        },
        (status) => {
          if (status === 'SUBSCRIBED') registrar(`${marca}[PostgresFallback] SUBSCRIBED`);
        },
      );
    } catch (erro) {
      // O fallback é a rede, não o trapézio: se ele falhar, quem já estiver
      // funcionando continua.
      avisar(`${marca}[PostgresFallback] CHANNEL_ERROR ${mensagemDe(erro)}`.trim());
      fallback = null;
    }
  };

  const aoStatusBroadcast: AoStatus = (status, erro) => {
    if (status === 'SUBSCRIBED') {
      registrar(`${marca}[Broadcast] SUBSCRIBED`);
      return;
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      avisar(`${marca}[Broadcast] CHANNEL_ERROR (${status}) ${erro?.message ?? ''}`.trim());
      abrirFallback();
    }
  };

  let broadcast: C | null = null;
  try {
    broadcast = opcoes.abrirBroadcast(() => {
      registrar(`${marca}[Broadcast] EVENT_RECEIVED`);
      agendarRecarga();
    }, aoStatusBroadcast);
  } catch (erro) {
    // Falhou antes de subir: a rede vale igual.
    avisar(`${marca}[Broadcast] CHANNEL_ERROR ${mensagemDe(erro)}`.trim());
    abrirFallback();
  }

  return () => {
    desmontado = true;
    if (timer !== null) {
      cancelar(timer);
      timer = null;
    }
    if (broadcast !== null) {
      opcoes.remover(broadcast);
      broadcast = null;
    }
    if (fallback !== null) {
      opcoes.remover(fallback);
      fallback = null;
    }
  };
}

/** Só a mensagem: um erro inteiro no console poderia arrastar payload junto. */
function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : '';
}
