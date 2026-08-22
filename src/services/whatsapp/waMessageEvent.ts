/**
 * O formato único de "mensagem mudou" do módulo WhatsApp.
 *
 * Há um caminho só: o broadcast `whatsapp:messages`, com os campos escolhidos a
 * dedo pelo gatilho no banco. A leitura por `postgres_changes` — linha inteira,
 * `raw` e `transcription_text` juntos — existiu como rede enquanto o canal
 * privado não estava provado em produção, e saiu quando ficou.
 *
 * O broadcast manda o MÍNIMO por operação, e não um formato fixo:
 *   · INSERT — id, conversation_id, direction, type, status e refresh=true.
 *     `direction`/`type` existem só porque o notificador os usa (filtra 'in' e
 *     escolhe o ícone); a thread não lê nenhum dos dois.
 *   · UPDATE — id, conversation_id, status e refresh.
 *   · DELETE — id e conversation_id.
 *
 * NENHUMA operação carrega o TEXTO da mensagem, e esta é uma regra de
 * autorização, não de economia: `whatsapp:messages` é um tópico só para o
 * escritório inteiro, e a policy de `realtime.messages` decide quem ENTRA no
 * tópico, não o que cada um recebe. Tudo que o gatilho puser no payload chega
 * a toda aba aberta, inclusive à de quem não enxerga aquele canal. O texto é
 * lido por HTTP (`messagesApi.getPreview`), onde o RLS responde por usuário.
 * O campo `content` continua aceito aqui só para a janela do deploy, em que o
 * gatilho antigo ainda pode estar no ar.
 *
 * Por isso os campos extras são opcionais aqui: ausência é o normal, não erro.
 *
 * Normalizar aqui é o que permite `useWaRealtime` e o notificador não saberem
 * nada sobre o formato do canal.
 *
 * Sem imports de propósito: o módulo é puro para o ts-node do `npm test`
 * conseguir carregá-lo sem arrastar a cadeia de imports do supabase client.
 */

export type WaMessageOp = 'INSERT' | 'UPDATE' | 'DELETE';

export interface WaMessageEvent {
  op: WaMessageOp;
  id: string;
  /** Nulo quando o gatilho não conseguiu resolvê-lo — acontece em DELETE. */
  conversation_id: string | null;
  direction?: string | null;
  type?: string | null;
  status?: string | null;
  content?: string | null;
  /**
   * true  = a thread aberta precisa ser relida por HTTP (mensagem nova,
   *         transcrição pronta, texto editado, mídia que terminou de subir).
   * false = dá para mesclar só o `status` no lugar, sem ir ao servidor.
   */
  refresh: boolean;
}

/** Objeto sem forma conhecida — o que chega do canal antes da validação. */
type Bruto = Record<string, unknown> | null | undefined;

function texto(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function operacao(v: unknown): WaMessageOp | null {
  return v === 'INSERT' || v === 'UPDATE' || v === 'DELETE' ? v : null;
}

/**
 * Evento vindo do gatilho `broadcast_whatsapp_message_changed` no banco.
 * O `refresh` é decidido lá — o banco é quem sabe quais colunas mudaram.
 */
export function normalizarBroadcast(payload: Bruto): WaMessageEvent | null {
  if (!payload) return null;
  const op = operacao(payload.op);
  const id = texto(payload.id);
  if (!op || !id) return null;

  if (op === 'DELETE') {
    return { op, id, conversation_id: texto(payload.conversation_id), refresh: false };
  }

  return {
    op,
    id,
    conversation_id: texto(payload.conversation_id),
    direction: texto(payload.direction),
    type: texto(payload.type),
    status: texto(payload.status),
    content: texto(payload.content),
    // Ausente/estranho conta como "precisa reler": errar para o lado de uma
    // requisição a mais é barato; errar para o lado de não atualizar a tela
    // devolve o bug que era "sair da conversa e entrar de novo".
    refresh: payload.refresh !== false,
  };
}
