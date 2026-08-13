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
    if (!text) {
      const marker = msg.type === 'audio' ? '[áudio]'
        : msg.type === 'image' ? '[imagem]'
        : msg.type === 'video' ? '[vídeo]'
        : msg.type === 'document' ? '[documento]'
        : msg.type === 'sticker' ? '[figurinha]'
        : '[mensagem sem texto]';
      text = marker;
    }
    if (text.length > WA_AI_HISTORY_MESSAGE_MAX_CHARS) {
      text = `${text.slice(0, WA_AI_HISTORY_MESSAGE_MAX_CHARS - 1)}…`;
    }
    out.push({ role: msg.direction === 'in' ? 'user' : 'assistant', content: text });
  }

  return out;
}
