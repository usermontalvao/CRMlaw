/**
 * A fonte única de eventos de mensagem do WhatsApp.
 *
 * Antes existiam DOIS canais postgres_changes sobre `whatsapp_messages` — o do
 * módulo e o do notificador —, então cada mensagem do escritório era decodificada
 * e trafegada duas vezes por aba aberta, linha inteira, com `raw` e
 * `transcription_text` dentro. Aqui há um canal só, com fan-out local: quem
 * assina não abre socket nenhum, entra numa lista.
 *
 * O canal é aberto na primeira assinatura e fechado quando o último ouvinte sai
 * — o notificador vive fora do módulo e não pode manter socket aberto sozinho.
 *
 * Hoje o broadcast é a ÚNICA fonte. A rede de `postgres_changes` que o
 * acompanhava saiu depois de o canal privado ser validado em produção, e a
 * tabela `whatsapp_messages` saiu da publicação `supabase_realtime` logo em
 * seguida (migration `realtime_drop_whatsapp_messages`): um canal de
 * `postgres_changes` sobre ela hoje não receberia evento nenhum. O que repõe o
 * que o socket perde é HTTP, em `useWaRealtime`.
 *
 * Este arquivo é só a ligação com o Supabase. As duas partes com regra própria
 * moram em módulos puros, testáveis sem rede, e é lá que está escrito o porquê:
 * a política de conexão em `src/utils/broadcastGate.ts` (compartilhada hoje com o
 * e-mail e as petições) e o fan-out em `waMessageFanOut.ts`.
 */
import { supabase } from '../../config/supabase';
import { criarPortaoBroadcast, type PortaoBroadcast } from '../../utils/broadcastGate';
import { criarFanOutDeMensagens, type FanOutDeMensagens } from './waMessageFanOut';
import { normalizarBroadcast, type WaMessageEvent } from './waMessageEvent';
import { registrarEventoRecebido } from './realtimeDebug';
import { assinarEscopoWa, escopoWaAtual } from './scope';

export type { WaMessageEvent } from './waMessageEvent';

/**
 * Nome do canal = tópico do broadcast. Precisa bater com o gatilho no banco.
 *
 * ── UM TÓPICO POR CANAL ────────────────────────────────────────────────────
 *
 * Havia um tópico só para o escritório inteiro, e a policy dele era "é
 * funcionário ativo". O texto da mensagem não viajava ali, mas o
 * `conversation_id` sim — e um id de conversa de canal restrito chegando a
 * quem não tem o canal é dado do canal restrito vazando, além de um palpite
 * pronto para as demais rotas.
 *
 * Agora o gatilho endereça `whatsapp:messages:<instance_id>`, e a policy de
 * `realtime.messages` resolve o canal pelo nome do tópico e pergunta à
 * `wa_can_see_channel` — a MESMA função que recorta a inbox.
 *
 * `TOPICO_SEM_CANAL` continua existindo para a conversa sem `instance_id`: ela
 * não pertence a canal nenhum, e `wa_can_see_conv` já a trata como visível a
 * quem é do escritório.
 *
 * Um portão POR tópico, e não um portão com vários canais: o portão existe para
 * desarmar o `rejoinTimer` da biblioteca quando um join é negado (ver
 * `broadcastGate`), e essa decisão é por tópico — um canal negado não pode
 * derrubar a assinatura dos outros. Na prática são poucos tópicos: os canais
 * que a pessoa enxerga, que é 1 ou 2 no escritório.
 */
const TOPICO_SEM_CANAL = 'whatsapp:messages';
const topicoDoCanal = (instanceId: string) => `whatsapp:messages:${instanceId}`;
const MARCA = '[Jurius Realtime][WhatsApp]';

type Ouvinte = (evento: WaMessageEvent) => void;
type Canal = ReturnType<typeof supabase.channel>;

let fanOut: FanOutDeMensagens | null = null;
/** Um portão por tópico assinado. A chave é o próprio nome do tópico. */
const portoes = new Map<string, PortaoBroadcast>();
let pararDeOuvirSessao: (() => void) | null = null;

function criarPortao(topico: string, entregar: FanOutDeMensagens): PortaoBroadcast {
  return criarPortaoBroadcast<Canal>({
    marca: `${MARCA}[${topico}]`,

    lerToken: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },

    // O token precisa estar no RealtimeClient ANTES de `channel()`: o
    // `subscribe()` lê `accessTokenValue` de forma síncrona ao montar o join, e
    // o que não estiver lá nessa hora vira um join `anon` — negado pela policy.
    aplicarToken: (token) => supabase.realtime.setAuth(token),

    abrirBroadcast: (aoStatus) =>
      supabase
        .channel(topico, { config: { private: true } })
        .on('broadcast', { event: 'changed' }, (msg) => {
          const evento = normalizarBroadcast(
            (msg as { payload?: Record<string, unknown> }).payload,
          );
          // Antes do fan-out de propósito: o filtro de repetição descarta o que
          // for repetido, e é justamente o que chega no fio que se quer enxergar
          // ao conferir se o canal está entregando.
          registrarEventoRecebido(`${MARCA}[Broadcast][${topico}]`, evento);
          entregar.emitir(evento);
        })
        .subscribe(aoStatus),

    // Só os canais deste módulo. `removeAllChannels()` derrubaria os da agenda,
    // do chat interno e da nuvem junto.
    remover: (canal) => {
      void supabase.removeChannel(canal);
    },

    agendar: (fn, ms) => window.setTimeout(fn, ms),
    cancelar: (id) => window.clearTimeout(id as number),
  });
}

/**
 * Liga o portão à sessão. Sem isto, um `RETRY_ABORTED` seria definitivo até o
 * próximo F5: é o login (ou a renovação do token) que muda a resposta da policy.
 */
function ouvirSessao(avisar: (evento: string) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((evento) => {
    // Nada de consulta nem de assinatura aqui dentro: o callback do supabase-js
    // roda dentro do lock de auth, e um `getSession()` daqui reentraria nele. Os
    // portões só recebem o nome do evento e fazem o trabalho por fora.
    avisar(evento);
  });
  return () => data.subscription.unsubscribe();
}

/**
 * Assina os eventos de mensagem. Devolve o cleanup.
 *
 * Idempotente por construção: o primeiro ouvinte abre o canal, os seguintes
 * entram na lista, e só a saída do último desmonta tudo. Remontar o módulo não
 * acumula canal nem listener.
 */
export function subscribeWaMessageEvents(ouvinte: Ouvinte): () => void {
  if (fanOut === null) {
    fanOut = criarFanOutDeMensagens({
      aoErroDeOuvinte: (mensagem) => console.warn(`${MARCA} LISTENER_ERROR`, mensagem),
    });
  }
  const entregar = fanOut;

  // Abre o que faltar e mantém o que já está de pé. Chamado na primeira
  // assinatura e de novo quando o escopo muda (um canal concedido hoje passa a
  // entregar hoje, sem F5).
  const sincronizar = (topicos: readonly string[]): void => {
    for (const topico of topicos) {
      if (portoes.has(topico)) continue;
      const novo = criarPortao(topico, entregar);
      portoes.set(topico, novo);
      novo.iniciar();
    }
  };

  // O tópico sem canal vale para todos e não depende de consulta nenhuma — ele
  // sobe já, para a conversa sem `instance_id` não ficar esperando a resposta
  // do escopo.
  sincronizar([TOPICO_SEM_CANAL]);

  // Os tópicos de canal dependem de saber QUAIS canais esta pessoa enxerga.
  // Falha aqui não é silêncio total: o `TOPICO_SEM_CANAL` continua de pé e o
  // `useWaRealtime` repõe lista e thread por HTTP.
  const aplicarEscopo = (escopo: { canaisMembro: readonly string[]; isAdmin: boolean; carregado: boolean }) => {
    if (!escopo.carregado) return;
    void (async () => {
      if (!await suportaTopicoPorCanal()) return;
      // O administrador enxerga todos os canais, e não é membro de nenhum: a
      // lista dele sai da própria tabela (recortada pela policy do canal).
      const ids = escopo.isAdmin
        ? await todosOsCanaisVisiveis()
        : [...escopo.canaisMembro];
      sincronizar(ids.map(topicoDoCanal));
    })();
  };
  aplicarEscopo(escopoWaAtual());
  const pararEscopo = assinarEscopoWa(aplicarEscopo);

  if (pararDeOuvirSessao === null) {
    pararDeOuvirSessao = ouvirSessao(() => {
      for (const p of portoes.values()) p.aoEventoDeSessao('TOKEN_REFRESHED');
    });
  }

  const cancelar = entregar.assinar(ouvinte);

  return () => {
    cancelar();
    pararEscopo();
    if (fanOut === null || fanOut.quantidade() > 0) return;
    for (const p of portoes.values()) p.encerrar();
    portoes.clear();
    pararDeOuvirSessao?.();
    pararDeOuvirSessao = null;
    // Zera junto com o canal: a memória de repetição é da sessão do canal, e
    // guardá-la entre montagens faria a primeira mensagem depois de reabrir a
    // inbox ser descartada como "repetida".
    fanOut = null;
  };
}

/**
 * O banco já tem a policy de broadcast POR CANAL?
 *
 * Ela nasce na migration `whatsapp_realtime_por_canal`, junto com a função
 * abaixo. Antes dela, o gatilho ainda publica tudo no tópico único e um join em
 * `whatsapp:messages:<id>` seria negado — quatro tentativas recusadas por canal,
 * por aba, sem ganho nenhum. Perguntar pela função é o sinal exato: existe a
 * função, existe a policy e existe o gatilho novo.
 *
 * Resolvido uma vez por sessão.
 */
let temTopicoPorCanal: Promise<boolean> | null = null;
function suportaTopicoPorCanal(): Promise<boolean> {
  if (temTopicoPorCanal) return temTopicoPorCanal;
  const sonda = (async () => {
    try {
      const { error } = await supabase
        .rpc('wa_can_read_channel_broadcast', { p_topic: 'whatsapp:messages:sonda' });
      // Só PGRST202 ("função não encontrada") significa banco antigo. Qualquer
      // outro erro é da chamada, não da ausência da policy.
      return !error || error.code !== 'PGRST202';
    } catch {
      return false;
    }
  })();
  temTopicoPorCanal = sonda;
  return sonda;
}

/** Os canais que a policy deixa este usuário ler. Só o administrador precisa. */
async function todosOsCanaisVisiveis(): Promise<string[]> {
  const { data, error } = await supabase.from('whatsapp_instances').select('id');
  if (error) return [];
  return (data ?? []).map((c: { id: string }) => c.id).filter(Boolean);
}
