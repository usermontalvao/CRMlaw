/**
 * O formato único de "mensagem mudou" do módulo WhatsApp.
 *
 * Existem dois caminhos para o mesmo fato: o broadcast (`whatsapp:messages`,
 * campos escolhidos a dedo pelo gatilho no banco) e o postgres_changes
 * (linha inteira, incluindo `raw` e `transcription_text`), que segue como rede
 * de segurança enquanto o canal privado não estiver confirmado em produção.
 *
 * O broadcast manda o MÍNIMO por operação, e não um formato fixo:
 *   · INSERT — id, conversation_id, direction, type, status, content (120) e
 *     refresh=true. `direction`/`type`/`content` existem só porque o notificador
 *     os usa (filtra 'in' e monta o preview); a thread não lê nenhum dos três.
 *   · UPDATE — id, conversation_id, status e refresh. Sem `content`: ninguém lê
 *     texto de mensagem no UPDATE, e mandá-lo a cada `sent → delivered → read`
 *     era espalhar conteúdo por toda aba aberta sem consumidor.
 *   · DELETE — id e conversation_id.
 *
 * Por isso os campos extras são opcionais aqui: ausência é o normal, não erro.
 *
 * Normalizar os dois aqui é o que permite `useWaRealtime` e o notificador não
 * saberem por qual caminho o evento chegou.
 *
 * Sem imports de propósito: o módulo é puro para o ts-node do `npm test`
 * conseguir carregá-lo sem arrastar a cadeia de imports do supabase client.
 */

export type WaMessageOp = 'INSERT' | 'UPDATE' | 'DELETE';

export interface WaMessageEvent {
  op: WaMessageOp;
  id: string;
  /** Ausente só no DELETE que vem pelo postgres_changes (replica identity default). */
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

/** Objeto sem forma conhecida — o que chega dos dois canais antes da validação. */
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

/**
 * Evento vindo do postgres_changes (rede de segurança).
 *
 * Aqui não dá para saber QUAIS colunas mudaram — a linha chega inteira. Então
 * reproduz-se exatamente a regra que o módulo já usava: UPDATE que traz `status`
 * é tratado como mudança de status e mescla no lugar. É por isso que a
 * transcrição não aparecia sozinha na thread; pelo broadcast, aparece.
 */
export function normalizarPostgres(payload: Bruto): WaMessageEvent | null {
  if (!payload) return null;
  const op = operacao(payload.eventType);
  if (!op) return null;

  if (op === 'DELETE') {
    // Replica identity default: `old` traz só a chave primária, e é o bastante.
    const antigo = payload.old as Bruto;
    const id = texto(antigo?.id);
    return id ? { op, id, conversation_id: null, refresh: false } : null;
  }

  const linha = payload.new as Bruto;
  const id = texto(linha?.id);
  if (!linha || !id) return null;

  const status = texto(linha.status);
  return {
    op,
    id,
    conversation_id: texto(linha.conversation_id),
    direction: texto(linha.direction),
    type: texto(linha.type),
    status,
    content: texto(linha.content),
    refresh: op === 'INSERT' ? true : !status,
  };
}
