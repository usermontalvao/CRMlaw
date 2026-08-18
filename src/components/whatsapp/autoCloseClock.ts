/**
 * O contador do encerramento por inatividade.
 *
 * A regra mora no banco (`wa_auto_close_idle_since`), que é quem de fato
 * encerra. Aqui ela é REPETIDA para a tela poder dizer, antes de acontecer,
 * quanto falta — um encerramento automático que só se descobre depois de
 * acontecer é indistinguível de conversa sumida.
 *
 * Cópia dupla é dívida conhecida e assumida: o relógio do painel não pode
 * depender de uma ida ao servidor por conversa a cada minuto. O que segura as
 * duas pontas juntas é o teste ao lado, escrito com os mesmos casos da
 * migration — se a regra do banco mudar sem esta mudar, é aqui que quebra.
 *
 * Sem imports de propósito: `npm test` roda via ts-node e qualquer import
 * relativo sem extensão na cadeia derruba a suíte inteira.
 */

export interface AutoCloseConversation {
  status: string;
  is_blocked: boolean;
  awaiting_accept: boolean;
  auto_close_suppressed: boolean;
  /**
   * Última mensagem da conversa, de QUALQUER lado — o relógio inteiro.
   *
   * O gatilho `wa_touch_conversation` atualiza esta coluna nas duas direções,
   * então ela é o espelho de `max(wa_timestamp)` que o banco calcula. Diverge só
   * num caso de canto: a última mensagem apagada depois de enviada continua
   * carimbada aqui e some da conta do banco. O painel adiantaria o encerramento
   * de uma conversa cuja última mensagem foi apagada — pequeno demais para
   * pagar uma consulta por conversa a cada minuto.
   */
  last_message_at: string | null;
  /** De que lado veio a última mensagem: é ela que diz de quem é a vez. */
  last_message_direction: 'in' | 'out' | null;
  /**
   * Marcas das mensagens automáticas. Servem para reconhecer que a última
   * mensagem que saiu foi um recado de secretária eletrônica — e não uma
   * resposta que passa a bola para o cliente.
   *
   * `document_ack_sent_at` é o "Recebemos os seus arquivos!": o cliente manda
   * cinco documentos, o robô agradece e, sem esta marca, o agradecimento vale
   * como atendimento — o painel passa a contar o encerramento de um caso que
   * ninguém leu ainda.
   */
  absence_sent_at?: string | null;
  reopen_prompt_sent_at?: string | null;
  document_ack_sent_at?: string | null;
}

export interface AutoCloseChannel {
  auto_close_enabled: boolean;
  auto_close_minutes: number;
  auto_close_business_hours_only: boolean;
}

export type AutoCloseClock =
  /** O canal não encerra sozinho, ou esta conversa não está sujeita à regra. */
  | { key: 'off' }
  /** O atendente tirou ESTA conversa da regra. */
  | { key: 'suppressed' }
  /** A resposta é nossa: não há prazo correndo, e a conversa não encerra. */
  | { key: 'waiting_us' }
  /** Contando: `minutesLeft` até o encerramento. */
  | { key: 'counting'; minutesLeft: number; idleMinutes: number; label: string; urgent: boolean }
  /** Prazo vencido, esperando a varredura do minuto seguinte. */
  | { key: 'due'; idleMinutes: number; label: string; urgent: boolean };

/**
 * Mensagem automática (aviso de fora do horário / prompt de reabertura) não é
 * resposta nossa. A janela é a mesma da migration: a marca é gravada ANTES do
 * envio e a mensagem entra alguns segundos depois.
 */
const isAutomatic = (
  sentAt: number, markIso: string | null | undefined, beforeMs = 5_000,
): boolean => {
  const mark = markIso ? new Date(markIso).getTime() : NaN;
  if (Number.isNaN(mark)) return false;
  return sentAt >= mark - beforeMs && sentAt <= mark + 60_000;
};

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/** "2h15", "38min", "menos de 1 min" — o que cabe num badge. */
export const autoCloseLeftLabel = (minutes: number): string => {
  const m = Math.floor(minutes);
  if (m < 1) return 'menos de 1 min';
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h${String(rest).padStart(2, '0')}`;
};

/** "3 dias", "5h" — o tempo parado acumulado, em texto de gente. */
export const autoCloseIdleLabel = (minutes: number): string => {
  const m = Math.floor(Math.max(0, minutes));
  if (m < 60) return `${m}min`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  const d = Math.floor(m / 1440);
  return d === 1 ? '1 dia' : `${d} dias`;
};

/**
 * Quanto falta para esta conversa encerrar sozinha.
 *
 * O relógio é a última mensagem da conversa, venha de quem vier: qualquer
 * mensagem nova zera a contagem, inclusive a nossa — e como o painel lê
 * `last_message_at`, que o realtime atualiza na hora, o contador reinicia
 * sozinho no mesmo instante em que a mensagem entra.
 *
 * Mas o prazo só CORRE enquanto a resposta é do cliente. Com a última palavra
 * sendo dele, quem está parado é o escritório, e inatividade de operador não
 * encerra atendimento nenhum.
 *
 * O expediente do canal NÃO entra na conta. Ele segura a despedida, não o
 * encerramento: vencendo de madrugada a conversa fecha de madrugada e só o
 * aviso ao cliente espera a abertura. Por isso o contador pode ir até o fim em
 * qualquer horário sem mentir.
 */
export function autoCloseClock(
  conv: AutoCloseConversation,
  channel: AutoCloseChannel | null | undefined,
  now: number,
): AutoCloseClock {
  if (!channel?.auto_close_enabled || !(channel.auto_close_minutes > 0)) return { key: 'off' };
  if (conv.status === 'closed' || conv.is_blocked || conv.awaiting_accept) return { key: 'off' };
  if (conv.auto_close_suppressed) return { key: 'suppressed' };

  // Conversa sem mensagem nenhuma não tem inatividade a medir.
  const lastActivity = ms(conv.last_message_at);
  if (lastActivity == null) return { key: 'off' };

  // A vez é nossa: nada conta.
  if (conv.last_message_direction !== 'out') return { key: 'waiting_us' };
  // A última coisa que saiu foi automática — recado de secretária eletrônica
  // não passa a bola para o cliente.
  // O aviso de documentos recebidos abre a janela para os dois lados (60s): a
  // marca dele é gravada DEPOIS do envio, ao contrário das outras duas.
  if (isAutomatic(lastActivity, conv.absence_sent_at)
      || isAutomatic(lastActivity, conv.reopen_prompt_sent_at)
      || isAutomatic(lastActivity, conv.document_ack_sent_at, 60_000)) {
    return { key: 'waiting_us' };
  }

  const dueAt = lastActivity + channel.auto_close_minutes * 60_000;
  const idleMinutes = Math.max(0, (now - lastActivity) / 60_000);
  const leftMinutes = (dueAt - now) / 60_000;

  if (leftMinutes > 0) {
    return {
      key: 'counting',
      minutesLeft: leftMinutes,
      idleMinutes,
      label: `encerra em ${autoCloseLeftLabel(leftMinutes)}`,
      urgent: leftMinutes <= 60,
    };
  }
  return { key: 'due', idleMinutes, label: 'encerrando por inatividade', urgent: true };
}
