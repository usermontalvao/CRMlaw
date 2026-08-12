/**
 * Janela anti-spam da mensagem automática fora do horário.
 *
 * A marca pertence à conversa e sobrevive ao encerramento/reabertura. Assim,
 * uma nova mensagem do mesmo cliente poucos minutos depois não recebe o mesmo
 * comunicado novamente.
 */
export const ABSENCE_COOLDOWN_HOURS = 12;
export const ABSENCE_COOLDOWN_MS = ABSENCE_COOLDOWN_HOURS * 60 * 60 * 1_000;

export function isAbsenceCooldownActive(
  lastSentAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!lastSentAt) return false;
  const sentAtMs = Date.parse(lastSentAt);
  if (!Number.isFinite(sentAtMs)) return false;
  return nowMs - sentAtMs < ABSENCE_COOLDOWN_MS;
}

export function absenceCooldownCutoff(nowMs = Date.now()): string {
  return new Date(nowMs - ABSENCE_COOLDOWN_MS).toISOString();
}

// ── Quando a IA está atendendo ──────────────────────────────────────────────

/**
 * O retrato que decide se o aviso comercial ainda faz sentido nesta conversa.
 */
export interface WaAbsenceAiState {
  channelAiEnabled: boolean;
  assistantId: string | null;
  assistantActive: boolean;
  /** 'test' não envia nada ao cliente — então o aviso continua necessário. */
  assistantMode: string;
  /** false depois do handoff. Sem sessão ainda, a IA vai atender: true. */
  sessionAiActive: boolean;
  conversationAssignedUserId: string | null;
  awaitingAccept: boolean;
}

/**
 * O aviso de "estamos fora do horário" deve ser engolido?
 *
 * SIM quando a IA vai responder esta mensagem. O aviso existe para explicar um
 * silêncio — e não há silêncio nenhum: o cliente escreve às 21h, o agente
 * responde às 21h. Mandar os dois é a conversa se contradizendo na cara da
 * pessoa ("ninguém está aqui agora" seguido de uma pergunta da triagem).
 *
 * O único horário que continua valendo para a IA é o do ACOMPANHAMENTO: ali o
 * escritório é quem inicia a conversa, e aí sim madrugada é invasão. Responder
 * quem falou com a gente agora não é.
 *
 * NÃO quando a IA não vai responder — modo de teste, agente desligado, canal
 * sem IA, conversa já entregue a uma pessoa ou aguardando aceite. Nesses casos
 * o silêncio é real e o aviso é a coisa certa a fazer.
 */
export function absenceSuppressedByAi(state: WaAbsenceAiState): boolean {
  if (!state.channelAiEnabled) return false;
  if (!state.assistantId) return false;
  if (!state.assistantActive) return false;
  if (state.assistantMode !== 'auto') return false;
  if (!state.sessionAiActive) return false;
  if (state.conversationAssignedUserId) return false;
  if (state.awaitingAccept) return false;
  return true;
}
