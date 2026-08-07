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

export type { WaMessageEvent } from './waMessageEvent';

/**
 * Nome do canal = tópico do broadcast. Precisa bater com o gatilho no banco.
 *
 * O tópico é privado e a policy de `realtime.messages` só aceita equipe interna
 * ATIVA (`public.wa_can_read_message_broadcast`). Portal do Cliente e `anon`
 * assinam e não recebem nada — se um dia a assinatura começar a cair em
 * CHANNEL_ERROR para todo mundo, é aí que se olha primeiro.
 */
const TOPICO = 'whatsapp:messages';
const MARCA = '[Jurius Realtime][WhatsApp]';

type Ouvinte = (evento: WaMessageEvent) => void;
type Canal = ReturnType<typeof supabase.channel>;

let fanOut: FanOutDeMensagens | null = null;
let portao: PortaoBroadcast | null = null;
let pararDeOuvirSessao: (() => void) | null = null;

function criarPortao(entregar: FanOutDeMensagens): PortaoBroadcast {
  return criarPortaoBroadcast<Canal>({
    marca: MARCA,

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
        .channel(TOPICO, { config: { private: true } })
        .on('broadcast', { event: 'changed' }, (msg) => {
          const evento = normalizarBroadcast(
            (msg as { payload?: Record<string, unknown> }).payload,
          );
          // Antes do fan-out de propósito: o filtro de repetição descarta o que
          // for repetido, e é justamente o que chega no fio que se quer enxergar
          // ao conferir se o canal está entregando.
          registrarEventoRecebido(`${MARCA}[Broadcast]`, evento);
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
function ouvirSessao(alvo: PortaoBroadcast): () => void {
  const { data } = supabase.auth.onAuthStateChange((evento) => {
    // Nada de consulta nem de assinatura aqui dentro: o callback do supabase-js
    // roda dentro do lock de auth, e um `getSession()` daqui reentraria nele. O
    // portão só recebe o nome do evento e faz o trabalho por fora.
    alvo.aoEventoDeSessao(evento);
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
  if (portao === null) {
    portao = criarPortao(fanOut);
    pararDeOuvirSessao = ouvirSessao(portao);
  }

  const cancelar = fanOut.assinar(ouvinte);
  portao.iniciar();

  return () => {
    cancelar();
    if (fanOut === null || fanOut.quantidade() > 0) return;
    portao?.encerrar();
    portao = null;
    pararDeOuvirSessao?.();
    pararDeOuvirSessao = null;
    // Zera junto com o canal: a memória de repetição é da sessão do canal, e
    // guardá-la entre montagens faria a primeira mensagem depois de reabrir a
    // inbox ser descartada como "repetida".
    fanOut = null;
  };
}
