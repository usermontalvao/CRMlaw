/**
 * Decide QUANDO a presença precisa ir para o banco.
 *
 * Vive separado do hook de propósito: sem imports e sem DOM, para poder ser
 * testado direto. `profiles` é publicada no Realtime, então cada escrita aqui
 * vira WAL que o walrus decodifica e avalia contra todas as assinaturas — a
 * regra de ouro é escrever só quando o estado muda de verdade.
 */

export type PresenceStatus = 'online' | 'away' | 'offline';

/** Depois deste tempo sem atividade o usuário vira "ausente". */
export const AWAY_AFTER_MS = 5 * 60 * 1000;

/** De quanto em quanto tempo a presença pode ser reconfirmada no banco. */
export const REFRESH_MS = 5 * 60 * 1000;

export interface PresenceState {
  /** Último estado que chegou a ser gravado. null = nada gravado ainda. */
  status: PresenceStatus | null;
  /** Quando houve a última atividade do usuário. */
  lastActivityAt: number;
  /** Quando foi a última escrita no banco. */
  lastSyncAt: number;
}

export function createPresenceState(now: number): PresenceState {
  return { status: null, lastActivityAt: now, lastSyncAt: 0 };
}

/** Registra a escrita que acabou de acontecer. */
export function applyWrite(state: PresenceState, status: PresenceStatus, now: number): void {
  state.status = status;
  state.lastSyncAt = now;
}

/** Entrou no sistema: sempre marca presença. */
export function decideOnMount(): PresenceStatus {
  return 'online';
}

/**
 * Houve atividade (clique, tecla, rolagem, voltar para a aba).
 *
 * Só gera escrita quando é uma transição real — tipicamente voltar de
 * "ausente". Quem já está online e continua trabalhando não escreve nada aqui;
 * quem cuida disso é a reconfirmação periódica.
 */
export function decideOnActivity(state: PresenceState, now: number): PresenceStatus | null {
  state.lastActivityAt = now;
  if (state.status !== 'online') return 'online';
  return null;
}

/** Passou o tempo de inatividade sem nenhum sinal do usuário. */
export function decideOnInactivity(state: PresenceState): PresenceStatus | null {
  if (state.status === 'away') return null;
  return 'away';
}

/**
 * Batida periódica. Só escreve se o usuário está online E houve atividade
 * desde a última escrita — aba aberta e parada não gera escrita nenhuma.
 */
export function decideOnRefresh(state: PresenceState): PresenceStatus | null {
  if (state.status !== 'online') return null;
  if (state.lastActivityAt <= state.lastSyncAt) return null;
  return 'online';
}

/** Fechou, escondeu a página ou desmontou. */
export function decideOnLeave(state: PresenceState): PresenceStatus | null {
  if (state.status === 'offline') return null;
  return 'offline';
}
