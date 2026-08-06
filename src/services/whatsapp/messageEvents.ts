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
 */
import { supabase } from '../../config/supabase';
import { MSG_TABLE } from './shared';
import { normalizarBroadcast, normalizarPostgres, type WaMessageEvent } from './waMessageEvent';

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

const ouvintes = new Set<Ouvinte>();
let fechar: (() => void) | null = null;

function emitir(evento: WaMessageEvent | null): void {
  if (!evento) return;
  // Cópia da lista: um ouvinte que se desinscreve dentro do próprio callback
  // (acontece no unmount durante uma rajada) não pode quebrar a iteração.
  for (const ouvinte of [...ouvintes]) {
    try {
      ouvinte(evento);
    } catch (erro) {
      // Um consumidor que estoura não pode derrubar os outros nem o canal.
      console.warn(`${MARCA} LISTENER_ERROR`, erro instanceof Error ? erro.message : '');
    }
  }
}

/**
 * Abre o broadcast e, se ele for recusado, a rede de postgres_changes.
 *
 * A rede existe porque o canal privado só é aceito se o token já tiver chegado
 * ao RealtimeClient quando o join sobe — a mesma corrida documentada em
 * src/utils/realtimeWithFallback.ts. Sai quando o broadcast estiver confirmado
 * em produção, junto com a saída da tabela da publicação.
 */
function abrirCanal(): () => void {
  let desmontado = false;
  let rede: ReturnType<typeof supabase.channel> | null = null;

  const abrirRede = () => {
    // Idempotente: uma sequência de CHANNEL_ERROR não pode virar pilha de canais.
    if (rede !== null || desmontado) return;
    console.warn(`${MARCA}[PostgresFallback] ABRINDO`);
    rede = supabase
      .channel(`whatsapp-messages-fallback-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: MSG_TABLE }, (p) =>
        emitir(normalizarPostgres(p as unknown as Record<string, unknown>)),
      )
      .subscribe();
  };

  const principal = supabase
    .channel(TOPICO, { config: { private: true } })
    .on('broadcast', { event: 'changed' }, (msg) =>
      emitir(normalizarBroadcast((msg as { payload?: Record<string, unknown> }).payload)),
    )
    .subscribe((status, erro) => {
      if (status === 'SUBSCRIBED') {
        console.info(`${MARCA}[Broadcast] SUBSCRIBED`);
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`${MARCA}[Broadcast] ${status} ${erro?.message ?? ''}`.trim());
        abrirRede();
      }
    });

  return () => {
    desmontado = true;
    void supabase.removeChannel(principal);
    if (rede) {
      void supabase.removeChannel(rede);
      rede = null;
    }
  };
}

/**
 * Assina os eventos de mensagem. Devolve o cleanup.
 *
 * Eventos podem chegar duplicados na janela em que broadcast e rede convivem —
 * os dois consumidores são idempotentes por id (mesclar status, reler a thread,
 * remover pelo id), então repetição não faz diferença.
 */
export function subscribeWaMessageEvents(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  if (fechar === null) fechar = abrirCanal();

  return () => {
    ouvintes.delete(ouvinte);
    if (ouvintes.size === 0 && fechar !== null) {
      fechar();
      fechar = null;
    }
  };
}
