// Regras de transferência de atendimento — inclusive o encaminhamento para
// advogado, que é o caminho mais usado do escritório.
//
// Hoje o modal aceita qualquer destino: dá para transferir para si mesmo, para
// quem está de folga, para quem nem enxerga aquele canal, e para quem acabou de
// devolver a conversa (o ping-pong que faz o cliente contar o caso três vezes).
// Nada disso é erro de banco: é regra de operação, e é aqui que ela mora.
//
// PURO DE PROPÓSITO: nenhum import. Ver o cabeçalho de `attendanceRouting.ts`.

export interface TransferStaff {
  userId: string;
  name: string;
  role?: string | null;
  oab?: string | null;
  isActive?: boolean;
  /** 'available' | 'busy' | 'away' | 'offline'. Ausente = tratado como disponível. */
  availability?: 'available' | 'busy' | 'away' | 'offline';
  /** Teto de conversas simultâneas. `0`/ausente = sem teto. */
  capacity?: number;
  openLoad?: number;
  departmentIds?: string[];
  channelIds?: string[] | '*';
}

export interface TransferHistoryEntry {
  fromUserId: string | null;
  toUserId: string | null;
  toDepartmentId: string | null;
  /** ISO. */
  at: string;
}

export interface TransferContext {
  conversationId: string;
  channelId: string | null;
  currentAssignee: string | null;
  currentDepartment: string | null;
  awaitingAccept?: boolean | null;
  status?: string;
  isBlocked?: boolean | null;
  clientId?: string | null;
  /** Transferências anteriores desta conversa, da mais antiga para a mais nova. */
  history?: TransferHistoryEntry[];
}

export interface TransferIntent {
  toUserId?: string | null;
  toDepartmentId?: string | null;
  /** Quem está executando a transferência. */
  byUserId: string | null;
  note?: string | null;
}

/** `block` impede a ação; `warn` deixa seguir, mas o atendente precisa ver. */
export type TransferIssueLevel = 'block' | 'warn';

export interface TransferIssue {
  level: TransferIssueLevel;
  code: string;
  message: string;
}

export interface TransferValidation {
  ok: boolean;
  issues: TransferIssue[];
  blocks: TransferIssue[];
  warnings: TransferIssue[];
}

export interface TransferPolicy {
  /** Devolver a conversa a quem já a passou adiante dentro desta janela é ping-pong. */
  pingPongWindowMinutes: number;
  /** Acima disto a conversa está rodando entre atendentes em vez de ser resolvida. */
  maxHopsPerDay: number;
}

export const DEFAULT_TRANSFER_POLICY: TransferPolicy = {
  pingPongWindowMinutes: 60,
  maxHopsPerDay: 3,
};

const normalizeRole = (role?: string | null) =>
  (role || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Advogado = cargo "advogado"/"advogada" no cadastro OU OAB preenchida. */
export function isLawyer(staff: Pick<TransferStaff, 'role' | 'oab'>): boolean {
  const role = normalizeRole(staff.role);
  if (role === 'advogado' || role === 'advogada') return true;
  return !!(staff.oab && staff.oab.trim());
}

function hasSlot(staff: TransferStaff): boolean {
  const capacity = staff.capacity ?? 0;
  if (capacity <= 0) return true;
  return (staff.openLoad ?? 0) < capacity;
}

function seesChannel(staff: TransferStaff, channelId: string | null): boolean {
  if (!channelId) return true;
  const channels = staff.channelIds;
  if (!channels || channels === '*') return true;
  return channels.includes(channelId);
}

function minutesBetween(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return Math.max(0, (now - t) / 60000);
}

/**
 * Valida um destino de transferência. Devolve TODOS os problemas de uma vez —
 * corrigir um erro por vez, com o modal fechando a cada tentativa, é o que faz
 * o atendente desistir e mandar para "qualquer um".
 */
export function validateTransfer(
  ctx: TransferContext,
  intent: TransferIntent,
  staff: TransferStaff[],
  now: number = Date.now(),
  policy: TransferPolicy = DEFAULT_TRANSFER_POLICY,
): TransferValidation {
  const issues: TransferIssue[] = [];
  const push = (level: TransferIssueLevel, code: string, message: string) =>
    issues.push({ level, code, message });

  const toUserId = intent.toUserId || null;
  const toDepartmentId = intent.toDepartmentId || null;
  const target = toUserId ? staff.find(s => s.userId === toUserId) ?? null : null;

  if (!toUserId && !toDepartmentId) {
    push('block', 'sem_destino', 'Escolha um setor ou um responsável.');
  }

  if (ctx.isBlocked) {
    push('block', 'contato_bloqueado', 'Contato bloqueado: desbloqueie antes de encaminhar.');
  }
  if (ctx.status === 'closed') {
    push('warn', 'conversa_encerrada', 'A conversa está encerrada — transferir vai reabri-la para o destino.');
  }

  if (toUserId) {
    if (!target) {
      push('block', 'destino_inexistente', 'O responsável escolhido não está mais na equipe.');
    } else {
      if (target.isActive === false) {
        push('block', 'destino_inativo', `${target.name} está inativo no sistema.`);
      }
      if (toUserId === ctx.currentAssignee) {
        push('block', 'ja_responsavel', `${target.name} já é o responsável por esta conversa.`);
      } else if (toUserId === intent.byUserId) {
        push('block', 'transferir_para_si', 'Para ficar com a conversa use "Assumir" — transferir para si mesmo deixa um aceite pendente à toa.');
      }
      if (!seesChannel(target, ctx.channelId)) {
        push('block', 'sem_acesso_canal', `${target.name} não tem acesso a este canal e não veria a conversa.`);
      }
      if (toDepartmentId && target.departmentIds && !target.departmentIds.includes(toDepartmentId)) {
        push('block', 'fora_do_setor', `${target.name} não pertence ao setor escolhido.`);
      }
      if (target.availability === 'offline' || target.availability === 'away') {
        push('warn', 'destino_indisponivel', `${target.name} está ${target.availability === 'offline' ? 'offline' : 'ausente'} — a conversa pode ficar parada no aceite.`);
      }
      if (!hasSlot(target)) {
        push('warn', 'destino_lotado', `${target.name} já está com ${target.openLoad}/${target.capacity} conversas.`);
      }
    }
  }

  if (ctx.awaitingAccept) {
    push('warn', 'aceite_pendente', 'Já existe uma transferência aguardando aceite; esta substitui a anterior.');
  }

  // Ping-pong: o destino é justamente quem passou esta conversa adiante há pouco.
  const history = ctx.history ?? [];
  if (toUserId) {
    const bounced = history.find(h =>
      h.fromUserId === toUserId && minutesBetween(h.at, now) <= policy.pingPongWindowMinutes,
    );
    if (bounced) {
      push('warn', 'ping_pong', `Esta conversa já saiu de ${target?.name ?? 'esse atendente'} há pouco. Devolver agora faz o cliente repetir tudo.`);
    }
  }
  const hopsToday = history.filter(h => minutesBetween(h.at, now) <= 24 * 60).length;
  if (hopsToday >= policy.maxHopsPerDay) {
    push('warn', 'excesso_de_saltos', `A conversa já passou por ${hopsToday} encaminhamentos hoje — considere resolver ou escalar para a gestão.`);
  }

  const blocks = issues.filter(i => i.level === 'block');
  const warnings = issues.filter(i => i.level === 'warn');
  return { ok: blocks.length === 0, issues, blocks, warnings };
}

// ── Sugestão de advogado ─────────────────────────────────────────────

export interface LawyerSuggestion {
  userId: string;
  name: string;
  score: number;
  /** Motivos legíveis, em ordem de peso ("já atendeu este cliente · carga 2/6"). */
  reasons: string[];
  /** Já está lotado/indisponível: aparece na lista, mas com ressalva. */
  caution: string | null;
}

export interface LawyerSuggestionInput {
  /** Advogados que já atenderam este cliente antes (continuidade). */
  previousAgentIds?: string[];
  /** Setor preferido para o assunto (ex.: previdenciário). */
  departmentId?: string | null;
  /** Área/assunto — só entra no texto do motivo. */
  topic?: string | null;
}

/**
 * Ranqueia os advogados para o encaminhamento. Continuidade pesa mais que
 * carga: o cliente que já explicou o caso para a Dra. Ana prefere a Dra. Ana
 * ocupada a um advogado livre que vai pedir tudo de novo. Indisponível e
 * lotado não somem da lista — descem e ganham uma ressalva, porque às vezes
 * só existe um advogado daquela área.
 */
export function suggestLawyers(
  staff: TransferStaff[],
  ctx: Pick<TransferContext, 'channelId' | 'currentAssignee'>,
  input: LawyerSuggestionInput = {},
): LawyerSuggestion[] {
  const previous = new Set(input.previousAgentIds ?? []);

  return staff
    .filter(s => isLawyer(s))
    .filter(s => s.isActive !== false)
    .filter(s => s.userId !== ctx.currentAssignee)
    .filter(s => seesChannel(s, ctx.channelId))
    .map(s => {
      const reasons: string[] = [];
      let score = 100;

      if (previous.has(s.userId)) {
        score += 50;
        reasons.push('já atendeu este cliente');
      }
      if (input.departmentId && s.departmentIds?.includes(input.departmentId)) {
        score += 20;
        reasons.push('no setor do assunto');
      }

      const capacity = s.capacity ?? 0;
      const load = s.openLoad ?? 0;
      const occ = capacity > 0 ? Math.min(1, load / capacity) : Math.min(1, load / 10);
      score += Math.round((1 - occ) * 25);
      reasons.push(capacity > 0 ? `carga ${load}/${capacity}` : `carga ${load}`);

      let caution: string | null = null;
      if (s.availability === 'offline' || s.availability === 'away') {
        score -= 40;
        caution = s.availability === 'offline' ? 'offline agora' : 'ausente agora';
      } else if (s.availability === 'busy') {
        score -= 10;
      }
      if (!hasSlot(s)) {
        score -= 30;
        caution = caution ?? 'agenda de atendimento cheia';
      }

      return { userId: s.userId, name: s.name, score, reasons, caution };
    })
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.name.localeCompare(b.name, 'pt-BR')));
}

/**
 * Resumo interno de handoff. Transferir sem contexto é o que obriga o cliente a
 * repetir o caso — este texto vira a nota da transferência.
 */
export function buildHandoffNote(input: {
  fromName?: string | null;
  topic?: string | null;
  clientName?: string | null;
  summary?: string | null;
  pendingItems?: string[];
}): string {
  const lines: string[] = [];
  if (input.clientName) lines.push(`Cliente: ${input.clientName}`);
  if (input.topic) lines.push(`Assunto: ${input.topic}`);
  if (input.summary) lines.push(`Contexto: ${input.summary.trim()}`);
  if (input.pendingItems?.length) lines.push(`Pendências: ${input.pendingItems.join('; ')}`);
  if (input.fromName) lines.push(`Encaminhado por ${input.fromName}.`);
  return lines.join('\n');
}
