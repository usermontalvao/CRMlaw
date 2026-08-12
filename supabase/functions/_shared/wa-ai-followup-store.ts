/**
 * O acompanhamento como GARANTIA DO BACKEND — a camada que toca o banco.
 *
 * As regras puras (quando cai, se ainda vale, o que escrever) moram em
 * `wa-ai-followup.ts`. Aqui está a única coisa que elas não podem fazer:
 * escrever a linha pendente e manter `whatsapp_ai_sessions.next_followup_at`
 * casado com ela.
 *
 * POR QUE ESTE ARQUIVO EXISTE: até 12/08/2026 o agendamento dependia de o
 * modelo chamar `agendar_followup`. Ele não chamava — e não tinha como: o
 * modelo só roda quando o cliente escreve, e nesse instante ninguém sabe que o
 * cliente vai sumir depois. A campanha "Sem registro na carteira" ficou com
 * `followup_attempts = 0`, `next_followup_at = null` e nenhuma linha em
 * `whatsapp_ai_followups`, com a política de 8 tentativas ligada.
 *
 * DUAS INVARIANTES, e todo este módulo existe para elas:
 *   1. no máximo UM pendente por conversa (o índice único
 *      `uniq_wa_ai_followup_pending` é a autoridade; a corrida perdida é um
 *      resultado normal, não um erro operacional);
 *   2. `next_followup_at` NUNCA fica preenchido sem uma linha pendente
 *      correspondente — e é sempre igual ao `scheduled_at` dela.
 */
import {
  WA_AI_FOLLOWUP_MESSAGE_MAX,
  nextFollowupAt,
  type WaAiFollowupPolicy,
} from './wa-ai-followup.ts';

const FOLLOWUPS = 'whatsapp_ai_followups';
const SESSIONS = 'whatsapp_ai_sessions';

export interface WaAiEnsureFollowupInput {
  conversationId: string;
  assistantId: string | null;
  policy: WaAiFollowupPolicy;
  /** A tentativa que se quer agendar (1 = a primeira desta conversa). */
  attempt: number;
  /** De onde o intervalo é contado — normalmente o instante da resposta. */
  fromIso: string;
  /** Texto já pronto. Vazio não passa no CHECK da tabela. */
  message: string;
  reason?: string | null;
  /**
   * Hora marcada PELO CLIENTE ("me chama às 14h"), já ajustada à janela do
   * canal. Substitui o degrau da escada e ignora o teto de tentativas: isto não
   * é cobrança, é o compromisso que a pessoa pediu — e furar a hora que ela
   * escolheu é pior do que não ter marcado nada.
   */
  scheduledAtOverride?: string | null;
  /**
   * 'appointment' quando a hora foi pedida pelo cliente. A diferença não é
   * cosmética: compromisso pausa a escada e não consome tentativa — quem marcou
   * hora não sumiu, e gastar uma das oito cobranças com ele é punir quem
   * respondeu.
   */
  kind?: 'followup' | 'appointment';
}

export type WaAiEnsureFollowupResult =
  | { created: true; id: string; attempt: number; scheduledAt: string }
  | { created: false; reason: string; attempt?: number; scheduledAt?: string };

/** O pendente desta conversa, se houver. */
async function pendingFollowup(admin: any, conversationId: string) {
  const { data } = await admin.from(FOLLOWUPS)
    .select('id, attempt, scheduled_at')
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
    .maybeSingle();
  return (data as { id: string; attempt: number; scheduled_at: string } | null) ?? null;
}

async function setNextFollowupAt(admin: any, conversationId: string, iso: string | null) {
  await admin.from(SESSIONS)
    .update({ next_followup_at: iso })
    .eq('conversation_id', conversationId)
    .then(() => {}, () => {});
}

/**
 * Garante que exista EXATAMENTE UM acompanhamento pendente para a conversa.
 *
 * Idempotente por construção: se já existe um pendente — porque o modelo chamou
 * `agendar_followup`, porque outra execução ganhou a corrida, ou porque este
 * mesmo caminho já rodou —, nada é criado e o `next_followup_at` da sessão é
 * apenas realinhado com ele. Chamar duas vezes tem o mesmo efeito de chamar uma.
 */
export async function ensureWaAiFollowupScheduled(
  admin: any, input: WaAiEnsureFollowupInput,
): Promise<WaAiEnsureFollowupResult> {
  const existente = await pendingFollowup(admin, input.conversationId);
  if (existente) {
    await setNextFollowupAt(admin, input.conversationId, existente.scheduled_at);
    return {
      created: false,
      reason: 'Já existe um acompanhamento pendente para esta conversa.',
      attempt: Number(existente.attempt),
      scheduledAt: existente.scheduled_at,
    };
  }

  const override = input.scheduledAtOverride ? new Date(input.scheduledAtOverride) : null;
  const at = override && Number.isFinite(override.getTime())
    ? override
    : nextFollowupAt(input.policy, input.attempt, input.fromIso);
  if (!at) {
    // Sem próxima tentativa, a sessão não pode ficar prometendo uma data.
    await setNextFollowupAt(admin, input.conversationId, null);
    return { created: false, reason: 'A política não prevê a próxima tentativa.' };
  }

  const texto = String(input.message || '').trim().slice(0, WA_AI_FOLLOWUP_MESSAGE_MAX);
  if (!texto) {
    await setNextFollowupAt(admin, input.conversationId, null);
    return { created: false, reason: 'Sem texto para a retomada.' };
  }

  const scheduledAt = at.toISOString();
  const { data: criado, error } = await admin.from(FOLLOWUPS).insert({
    conversation_id: input.conversationId,
    assistant_id: input.assistantId,
    attempt: input.attempt,
    scheduled_at: scheduledAt,
    message: texto,
    reason: input.reason ? String(input.reason).slice(0, 300) : null,
    kind: input.kind || 'followup',
  }).select('id').maybeSingle();

  if (error || !criado) {
    // Corrida perdida no índice único: outra execução criou o pendente entre a
    // consulta e o insert. Isso é o índice trabalhando, não uma falha — o
    // estado final é o que se queria (um pendente), então só realinhamos.
    const vencedor = await pendingFollowup(admin, input.conversationId);
    if (vencedor) {
      await setNextFollowupAt(admin, input.conversationId, vencedor.scheduled_at);
      return {
        created: false,
        reason: 'Outra execução agendou o acompanhamento primeiro.',
        attempt: Number(vencedor.attempt),
        scheduledAt: vencedor.scheduled_at,
      };
    }
    await setNextFollowupAt(admin, input.conversationId, null);
    return { created: false, reason: String(error?.message || 'Não foi possível agendar o acompanhamento.') };
  }

  await setNextFollowupAt(admin, input.conversationId, scheduledAt);
  return { created: true, id: String(criado.id), attempt: input.attempt, scheduledAt };
}

/**
 * Cancela os pendentes da conversa e apaga a promessa da sessão.
 *
 * O `next_followup_at` sai JUNTO, sempre — mesmo quando não havia nada para
 * cancelar. Era exatamente esse par desencontrado (data na sessão, nenhuma
 * linha pendente) que fazia o painel prometer uma retomada que nunca sairia.
 */
export async function cancelWaAiPendingFollowups(
  admin: any, conversationId: string, reason: string,
): Promise<number> {
  const { data } = await admin.from(FOLLOWUPS)
    .update({ status: 'cancelled', cancel_reason: String(reason || '').slice(0, 300) })
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
    .select('id');

  await setNextFollowupAt(admin, conversationId, null);
  return (data || []).length;
}
