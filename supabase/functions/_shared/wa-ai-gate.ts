/**
 * Portaria de execução do Assistente de IA do WhatsApp — REGRAS PURAS.
 *
 * ATENÇÃO — ESTE ARQUIVO EXISTE EM DUAS CÓPIAS BYTE A BYTE:
 *   src/utils/waAiRunGate.ts
 *   supabase/functions/_shared/wa-ai-gate.ts
 * Ao mexer em um, COPIE O ARQUIVO INTEIRO para o outro: `waAiRunGate.test.ts`
 * compara os dois byte a byte.
 *
 * SEM IMPORTS de propósito — ver memória testes-ts-node-imports.
 *
 * Responde a três perguntas, todas sem tocar no banco:
 *   1. esta mensagem deve acionar a IA? (idempotência, handoff, debounce)
 *   2. o que vai no prompt? (memória resumida + janela de mensagens)
 *   3. como fica a memória depois do turno? (limites de tamanho)
 */

// ── Idempotência ────────────────────────────────────────────────────────────

/**
 * Chave que representa UM turno. A reentrega do webhook — que acontece de
 * verdade, a Evolution reenvia a mesma mensagem — recai na mesma chave e é
 * barrada pelo índice único de `whatsapp_ai_executions.idempotency_key`.
 */
export function waAiIdempotencyKey(conversationId: string, triggerMessageId: string): string {
  return `msg:${conversationId}:${triggerMessageId}`;
}

/** A chave de um disparo de follow-up, que não tem mensagem de gatilho. */
export function waAiFollowupIdempotencyKey(followupId: string): string {
  return `followup:${followupId}`;
}

// ── Decisão de acionar ──────────────────────────────────────────────────────

export interface WaAiRunGateState {
  /** Mensagem que chegou e disparou a chamada. */
  triggerMessageId: string;
  /** A mensagem de ENTRADA mais recente da conversa neste momento. */
  latestInboundMessageId: string | null;
  /** Última mensagem já processada pela IA nesta conversa. */
  lastProcessedMessageId: string | null;
  conversationStatus: string;
  conversationBlocked: boolean;
  /** false depois do handoff humano. Não volta sozinho. */
  aiActive: boolean;
  channelAiEnabled: boolean;
  assistantActive: boolean;
  /** Alguém do escritório assumiu a conversa. */
  assignedUserId: string | null;
  /** A conversa está aguardando o aceite de uma transferência. */
  awaitingAccept: boolean;
  /** Trava de execução em vigor (ISO), se houver. */
  lockedUntilIso: string | null;
  nowIso: string;
}

export type WaAiRunDecision =
  | { run: true }
  | { run: false; reason: string };

/**
 * Vale acionar o modelo para esta mensagem?
 *
 * A ordem é deliberada: primeiro os desligamentos (que o operador controla),
 * depois a idempotência, e só então o debounce. Assim o motivo registrado no
 * log é o mais informativo dos que se aplicam — "conversa entregue ao humano" é
 * mais útil do que "mensagem já processada", mesmo quando as duas valem.
 *
 * O caso do `assignedUserId`: um humano que assume a conversa PARA a IA na hora.
 * Não é o mesmo que `aiActive === false` (aquele é o handoff explícito) — é o
 * operador simplesmente clicando em "assumir" na inbox, e vale igual.
 */
export function decideWaAiRun(state: WaAiRunGateState): WaAiRunDecision {
  if (!state.channelAiEnabled) return { run: false, reason: 'IA desativada no canal.' };
  if (!state.assistantActive) return { run: false, reason: 'Agente inativo.' };
  if (!state.aiActive) return { run: false, reason: 'Conversa entregue ao atendimento humano.' };
  if (state.conversationBlocked) return { run: false, reason: 'Contato bloqueado.' };
  if (state.conversationStatus === 'closed') return { run: false, reason: 'Conversa encerrada.' };
  if (state.assignedUserId) return { run: false, reason: 'Conversa assumida por um atendente.' };
  if (state.awaitingAccept) return { run: false, reason: 'Conversa aguardando aceite de transferência.' };

  if (state.lastProcessedMessageId && state.lastProcessedMessageId === state.triggerMessageId) {
    return { run: false, reason: 'Mensagem já processada (reentrega do webhook).' };
  }

  // Debounce: mensagens consecutivas do cliente viram UM turno. Quem responde é
  // sempre a execução da ÚLTIMA mensagem; as anteriores desistem aqui, depois de
  // esperar a janela. As mensagens intermediárias não se perdem — entram no
  // histórico que o turno vencedor lê.
  if (state.latestInboundMessageId && state.latestInboundMessageId !== state.triggerMessageId) {
    return { run: false, reason: 'Chegou mensagem mais nova (agrupada por debounce).' };
  }

  if (state.lockedUntilIso) {
    const until = new Date(state.lockedUntilIso).getTime();
    const now = new Date(state.nowIso).getTime();
    if (Number.isFinite(until) && Number.isFinite(now) && until > now) {
      return { run: false, reason: 'Já existe uma execução em andamento nesta conversa.' };
    }
  }

  return { run: true };
}

// ── Memória ─────────────────────────────────────────────────────────────────

export const WA_AI_SUMMARY_MAX_CHARS = 1500;
export const WA_AI_KNOWN_FACTS_MAX_KEYS = 30;
export const WA_AI_FACT_VALUE_MAX_CHARS = 300;
export const WA_AI_PENDING_ITEMS_MAX = 12;
export const WA_AI_PENDING_ITEM_MAX_CHARS = 200;
export type WaAiMemoryFactValue = string | number | boolean;

export interface WaAiMemory {
  /** Resumo breve do caso, reescrito a cada turno. */
  summary: string;
  /** Dados já informados pelo cliente: {chave: valor}. */
  knownFacts: Record<string, WaAiMemoryFactValue>;
  /** O que o agente está aguardando. */
  pendingItems: string[];
  /** Última ação executada, para o operador ver de relance. */
  lastAction: string | null;
}

export const WA_AI_EMPTY_MEMORY: WaAiMemory = {
  summary: '',
  knownFacts: {},
  pendingItems: [],
  lastAction: null,
};

function trimTo(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Lê a memória vinda do banco, aparando tudo.
 *
 * O modelo escreve boa parte deste conteúdo, então nada aqui pode confiar no
 * formato: chave repetida, valor gigante, lista infinita e tipo errado saem
 * todos pelo mesmo funil.
 */
export function normalizeWaAiMemory(raw: unknown): WaAiMemory {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};

  const facts: Record<string, WaAiMemoryFactValue> = {};
  const rawFacts = src.knownFacts ?? src.known_facts;
  if (rawFacts && typeof rawFacts === 'object' && !Array.isArray(rawFacts)) {
    for (const [key, value] of Object.entries(rawFacts as Record<string, unknown>)) {
      if (Object.keys(facts).length >= WA_AI_KNOWN_FACTS_MAX_KEYS) break;
      const cleanKey = trimTo(key, 60);
      if (!cleanKey) continue;
      if (typeof value === 'boolean') { facts[cleanKey] = value; continue; }
      if (typeof value === 'number' && Number.isFinite(value)) { facts[cleanKey] = value; continue; }
      const cleanValue = typeof value === 'string'
        ? trimTo(value, WA_AI_FACT_VALUE_MAX_CHARS)
        : '';
      if (cleanValue) facts[cleanKey] = cleanValue;
    }
  }

  const items: string[] = [];
  const rawItems = src.pendingItems ?? src.pending_items;
  if (Array.isArray(rawItems)) {
    for (const item of rawItems) {
      if (items.length >= WA_AI_PENDING_ITEMS_MAX) break;
      const text = trimTo(item, WA_AI_PENDING_ITEM_MAX_CHARS);
      if (text && items.indexOf(text) === -1) items.push(text);
    }
  }

  return {
    summary: trimTo(src.summary, WA_AI_SUMMARY_MAX_CHARS),
    knownFacts: facts,
    pendingItems: items,
    lastAction: trimTo(src.lastAction ?? src.last_action, 120) || null,
  };
}

/**
 * Aplica o que o modelo devolveu por cima da memória anterior.
 *
 * Mesclar em vez de substituir é o que dá continuidade: um turno em que o
 * modelo só confirma o CPF não pode apagar o nome coletado três mensagens
 * antes. Só `pendingItems` é substituído por inteiro quando vem preenchido —
 * ele descreve o AGORA ("aguardando o comprovante"), não um acúmulo.
 */
export function mergeWaAiMemory(previous: WaAiMemory, patch: unknown): WaAiMemory {
  const prev = normalizeWaAiMemory(previous);
  const next = normalizeWaAiMemory(patch);

  const facts: Record<string, WaAiMemoryFactValue> = { ...prev.knownFacts };
  for (const [key, value] of Object.entries(next.knownFacts)) {
    if (!(key in facts) && Object.keys(facts).length >= WA_AI_KNOWN_FACTS_MAX_KEYS) continue;
    facts[key] = value;
  }

  const patchGaveItems = Array.isArray((patch as Record<string, unknown> | null)?.pendingItems)
    || Array.isArray((patch as Record<string, unknown> | null)?.pending_items);

  return {
    summary: next.summary || prev.summary,
    knownFacts: facts,
    pendingItems: patchGaveItems ? next.pendingItems : prev.pendingItems,
    lastAction: next.lastAction || prev.lastAction,
  };
}

/** Bloco de memória colado no prompt. Vazio quando ainda não há nada a dizer. */
export function renderWaAiMemoryForPrompt(memory: WaAiMemory): string {
  const mem = normalizeWaAiMemory(memory);
  const lines: string[] = [];
  if (mem.summary) lines.push(`Resumo do caso até agora: ${mem.summary}`);
  const factKeys = Object.keys(mem.knownFacts);
  if (factKeys.length) lines.push(`Estado factual canônico (JSON):\n${JSON.stringify(mem.knownFacts, null, 2)}`);
  if (mem.pendingItems.length) {
    lines.push('Você está aguardando:');
    for (const item of mem.pendingItems) lines.push(`- ${item}`);
  }
  if (mem.lastAction) lines.push(`Última ação executada: ${mem.lastAction}`);
  return lines.join('\n');
}

// ── Janela de histórico ─────────────────────────────────────────────────────

export interface WaAiHistoryMessage {
  id: string;
  direction: 'in' | 'out';
  type: string;
  content: string | null;
  /** Texto produzido pela transcrição do áudio, quando não há conteúdo escrito. */
  transcriptionText?: string | null;
  waTimestamp: string;
}

export interface WaAiPromptMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Teto de caracteres por mensagem levada ao modelo. */
export const WA_AI_HISTORY_MESSAGE_MAX_CHARS = 1200;

/**
 * As últimas `limit` mensagens, em ordem cronológica, prontas para o prompt.
 *
 * Não mandamos o histórico inteiro: uma conversa de meses estouraria o contexto
 * e o custo a cada turno. O que sustenta a continuidade é o resumo da memória,
 * que é justamente o que sobrevive fora desta janela.
 *
 * Áudio transcrito entra como fala do cliente. Só mídia realmente sem conteúdo
 * nem transcrição vira marcador ("[áudio]"): o modelo precisa saber que o
 * cliente MANDOU algo, mesmo sem poder ler o quê.
 */
export function buildWaAiPromptMessages(
  messages: WaAiHistoryMessage[],
  limit: number,
): WaAiPromptMessage[] {
  const max = Number.isInteger(limit) && limit > 0 ? Math.min(40, limit) : 12;
  const sorted = (messages || []).slice().sort((a, b) => {
    const ta = new Date(a.waTimestamp).getTime();
    const tb = new Date(b.waTimestamp).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });

  const window = sorted.slice(-max);
  const out: WaAiPromptMessage[] = [];

  for (const msg of window) {
    // O texto digitado/legenda vence. Na ausência dele, a transcrição já pronta
    // é a fala do cliente — não um metadado que o modelo deva ignorar.
    let text = (msg.content || msg.transcriptionText || '').trim();
    if (!text) text = waAiEmptyMessageMarker(msg.type);
    if (text.length > WA_AI_HISTORY_MESSAGE_MAX_CHARS) {
      text = `${text.slice(0, WA_AI_HISTORY_MESSAGE_MAX_CHARS - 1)}…`;
    }
    out.push({ role: msg.direction === 'in' ? 'user' : 'assistant', content: text });
  }

  return out;
}

// ── Mídia não é fala ────────────────────────────────────────────────────────
//
// Uma mensagem sem texto entra no prompt como MARCADOR ("[imagem]"): o modelo
// precisa saber que o cliente mandou algo, mas não recebe a imagem — nenhum
// arquivo é enviado ao provedor neste agente.
//
// Em 24/08/2026, na campanha de rescisão indireta, um contato mandou UMA foto e
// mais nada. A fase de extração recebeu a única fala do cliente — a string
// `[imagem]` — junto da lista inteira de campos do roteiro e da instrução
// "extraia TODAS as informações, inclusive as antecipadas". O modelo preencheu
// os 21 campos: nome, função (babá), início 01/2020, saída 12/2022, R$ 1.200
// por mês, testemunhas, honorários aceitos. Nada disso foi dito.
//
// O estrago não parou na memória. Os cortes são DETERMINÍSTICOS sobre os fatos
// (`evaluateWaAiCuts`), então a saída inventada em 12/2022 disparou o corte
// `prazo_2_anos` e, 25 segundos depois da foto, o lead recebeu por escrito que
// o escritório não seguiria com o atendimento.
//
// A regra abaixo fecha essa porta na entrada: sem fala em TEXTO, não há o que
// extrair. Sem extração não entram fatos, e sem fatos nenhum corte dispara — a
// conversa simplesmente continua na pergunta em que estava.
export const WA_AI_EMPTY_MESSAGE_MARKERS = [
  '[áudio]', '[imagem]', '[vídeo]', '[documento]', '[figurinha]', '[mensagem sem texto]',
] as const;

/** O marcador de uma mensagem que chegou sem texto nem transcrição. */
export function waAiEmptyMessageMarker(type: string): string {
  return type === 'audio' ? '[áudio]'
    : type === 'image' ? '[imagem]'
    : type === 'video' ? '[vídeo]'
    : type === 'document' ? '[documento]'
    : type === 'sticker' ? '[figurinha]'
    : '[mensagem sem texto]';
}

/**
 * A rodada atual: tudo que veio DEPOIS da última fala do agente.
 *
 * É o recorte que a extração lê — o resto da janela já foi lido nos turnos
 * anteriores e está condensado no estado.
 */
export function waAiCurrentBundle(messages: readonly WaAiPromptMessage[]): WaAiPromptMessage[] {
  const lista = messages || [];
  let inicio = 0;
  for (let i = 0; i < lista.length; i++) {
    if (lista[i].role === 'assistant') inicio = i;
  }
  return lista.slice(inicio).filter(m => m.role === 'user');
}

/**
 * A rodada de verdade: o que o cliente disse e AINDA NÃO FOI LIDO por turno
 * nenhum.
 *
 * `waAiCurrentBundle` usa a última fala do agente como fronteira, e essa
 * fronteira mente quando duas mensagens do cliente chegam coladas. Cada
 * mensagem agenda o seu turno; o primeiro turno passa uns quinze segundos no
 * modelo, e nesse intervalo a segunda mensagem chega e a resposta do primeiro é
 * enviada — nesta ordem. O segundo turno então acorda vendo a fala do cliente
 * ANTES da própria resposta, conclui que a rodada está vazia e repete a
 * pergunta que acabou de fazer, sem nunca ler o que ele respondeu.
 *
 * Foi o que a Marcia recebeu duas vezes em 26/08/2026 ("Mais ou menos quanto
 * você recebia..." e "Tinha alguém que passava..."), e as duas respostas dela
 * que dispararam isso ("Né" e "Segunda a sexta-feira") não entraram em turno
 * nenhum.
 *
 * A fronteira certa não é a fala do agente, é a última mensagem que o agente
 * PROCESSOU — `whatsapp_ai_sessions.last_processed_message_id`. Fora da janela
 * ou ausente (primeiro turno), vale a fronteira antiga.
 */
export function waAiUnreadBundle(
  messages: WaAiHistoryMessage[],
  limit: number,
  lastProcessedMessageId: string | null,
): WaAiPromptMessage[] {
  return waAiUnreadTurn(messages, limit, lastProcessedMessageId).messages;
}

/**
 * A rodada não lida, com o cursor exato que ela consumiu.
 *
 * O texto serve à extração; o id serve à persistência. Manter os dois no mesmo
 * cálculo evita um erro sutil: a execução pode ter sido disparada por `m1`,
 * mas já encontrar `m2` no histórico e ler as duas. Se gravar `m1`, o próximo
 * webhook entende que `m2` continua virgem e repete a pergunta.
 *
 * `precedingAssistantMessage` é a última pergunta anterior à primeira entrada
 * não lida. Respostas curtas como "sim" e "não" só têm sentido junto dela.
 */
export function waAiUnreadTurn(
  messages: WaAiHistoryMessage[],
  limit: number,
  lastProcessedMessageId: string | null,
): {
  messages: WaAiPromptMessage[];
  precedingAssistantMessage: WaAiPromptMessage | null;
  lastInboundMessageId: string | null;
} {
  const prompt = buildWaAiPromptMessages(messages, limit);
  const max = Number.isInteger(limit) && limit > 0 ? Math.min(40, limit) : 12;
  const ordenadas = (messages || []).slice().sort((a, b) => {
    const ta = new Date(a.waTimestamp).getTime();
    const tb = new Date(b.waTimestamp).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  }).slice(-max);

  let corte = lastProcessedMessageId
    ? ordenadas.findIndex(m => String(m.id) === String(lastProcessedMessageId))
    : -1;
  if (corte === -1) {
    // Primeiro turno (ou cursor antigo fora da janela): a última fala do agente
    // continua sendo a fronteira segura, como já era em `waAiCurrentBundle`.
    corte = -1;
    for (let i = 0; i < prompt.length; i++) {
      if (prompt[i].role === 'assistant') corte = i;
    }
  }

  const indices: number[] = [];
  for (let i = corte + 1; i < prompt.length; i++) {
    if (prompt[i].role === 'user') indices.push(i);
  }
  const primeiraEntrada = indices.length > 0 ? indices[0] : prompt.length;
  let perguntaAnterior: WaAiPromptMessage | null = null;
  for (let i = primeiraEntrada - 1; i >= 0; i--) {
    if (prompt[i].role === 'assistant') { perguntaAnterior = prompt[i]; break; }
  }

  // `prompt` e `ordenadas` são a MESMA janela, na mesma ordem: o índice serve
  // para as duas, e é assim que o texto já tratado (transcrição, marcador,
  // truncagem) é reaproveitado sem reescrever a montagem.
  const ultima = indices.length > 0 ? indices[indices.length - 1] : -1;
  return {
    messages: indices.map(i => prompt[i]),
    precedingAssistantMessage: perguntaAnterior,
    lastInboundMessageId: ultima >= 0 ? String(ordenadas[ultima]?.id || '') || null : null,
  };
}

/**
 * O cliente disse alguma coisa em TEXTO nestas mensagens?
 *
 * Marcador de mídia não conta: ele diz que algo chegou, não o que foi dito.
 * Áudio transcrito conta — a transcrição já entrou como texto lá em cima.
 */
export function waAiCustomerSaidSomething(messages: readonly WaAiPromptMessage[]): boolean {
  for (const msg of (messages || [])) {
    if (msg.role !== 'user') continue;
    const texto = String(msg.content || '').trim();
    if (!texto) continue;
    if ((WA_AI_EMPTY_MESSAGE_MARKERS as readonly string[]).indexOf(texto) !== -1) continue;
    return true;
  }
  return false;
}
