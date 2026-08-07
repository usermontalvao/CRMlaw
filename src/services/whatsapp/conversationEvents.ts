/**
 * A fonte única de eventos de CONVERSA do WhatsApp.
 *
 * Mesma história que `messageEvents.ts` fez com as mensagens, agora com as
 * conversas. Existiam dois canais `postgres_changes` sobre `whatsapp_conversations`,
 * ambos sem filtro e ambos com `event: '*'`:
 *
 *   · `whatsapp-realtime` — o módulo aberto, que mescla a linha na lista;
 *   · `whatsapp-notify`   — o notificador global (sino/som), que vive fora do
 *                            módulo e mantém fresco o cache de atribuição.
 *
 * Ouviam exatamente a mesma coisa. Com o módulo aberto, toda mudança de conversa
 * era decodificada e trafegada DUAS vezes por aba — e a linha de conversa tem
 * ~400 bytes, com preview, contador, ordem e presença dentro.
 *
 * Agora é um canal só, com fan-out local e contagem de referências: o primeiro
 * assinante abre, os demais entram na lista, o último a sair fecha. O notificador
 * continua funcionando sozinho quando o módulo está fechado — que é justamente
 * quando o aviso é a única coisa que existe.
 *
 * As conversas seguem em postgres_changes de propósito (e não em broadcast como
 * as mensagens): o payload é usado INTEIRO no merge da lista, então trocar não
 * economizaria nada e obrigaria a repetir a linha toda dentro do aviso.
 */
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { CONV_TABLE, openResilientChannel } from './shared';
import { criarRegistroCompartilhado } from '../realtime/sharedResource';

export type ConversationPayload = RealtimePostgresChangesPayload<Record<string, any>>;
export type StatusDoCanal = 'live' | 'down';

const MARCA = '[Jurius Realtime][WhatsApp][Conversations]';

/**
 * Saúde do canal. É ESTADO, não evento: quem assina no meio precisa saber como
 * as coisas estão agora, senão o módulo aberto durante uma queda acharia que
 * está tudo bem e não reporia por HTTP o que se perdeu.
 */
const ouvintesDeStatus = new Set<(status: StatusDoCanal) => void>();
let ultimoStatus: StatusDoCanal = 'live';

function anunciarStatus(status: StatusDoCanal): void {
  ultimoStatus = status;
  for (const ouvinte of [...ouvintesDeStatus]) {
    try {
      ouvinte(status);
    } catch {
      /* um consumidor quebrado não derruba os outros nem o canal */
    }
  }
}

/**
 * As mudanças de linha são EVENTO: reentregar a última a quem chega depois
 * faria a lista reprocessar uma alteração já aplicada.
 */
const mudancasDeConversa = criarRegistroCompartilhado<ConversationPayload>({
  marca: MARCA,
  reentregarUltimo: false,
  abrir: (_chave, publicar) => {
    const fechar = openResilientChannel({
      name: 'whatsapp-conversations',
      bind: ch => ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: CONV_TABLE },
        p => publicar(p as ConversationPayload),
      ),
      onStatusChange: anunciarStatus,
    });
    return () => {
      fechar();
      // Canal novo começa otimista. Sem isto, uma queda antes do fechamento
      // ficaria grudada e o próximo módulo a abrir nasceria "fora do ar".
      ultimoStatus = 'live';
    };
  },
});

/**
 * Assina as mudanças de conversa. Devolve o cleanup.
 *
 * `onStatusChange` recebe o estado ATUAL na inscrição, e não só as mudanças
 * seguintes — quem entra durante uma queda precisa saber que está caído.
 */
export function subscribeWaConversationEvents(handlers: {
  onChange: (payload: ConversationPayload) => void;
  onStatusChange?: (status: StatusDoCanal) => void;
}): () => void {
  const pararMudancas = mudancasDeConversa.assinar('todas', handlers.onChange);

  const aoStatus = handlers.onStatusChange;
  if (aoStatus) {
    ouvintesDeStatus.add(aoStatus);
    aoStatus(ultimoStatus);
  }

  let saiu = false;
  return () => {
    // Idempotente: o StrictMode chama todo cleanup duas vezes, e a segunda não
    // pode remover a inscrição de quem chegou no meio.
    if (saiu) return;
    saiu = true;
    if (aoStatus) ouvintesDeStatus.delete(aoStatus);
    pararMudancas();
  };
}
