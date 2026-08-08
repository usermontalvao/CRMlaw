// 'excluido' é o prazo que o escritório apagou: ele sai da fila de tarefas e
// passa a morar no Histórico, de onde dá para consultar e restaurar. Não é um
// status que alguém escolhe no formulário — quem o coloca é o botão Excluir.
export type DeadlineStatus = 'pendente' | 'cumprido' | 'vencido' | 'cancelado' | 'excluido';

export type DeadlineType = 'processo' | 'requerimento' | 'geral';

export type DeadlinePriority = 'baixa' | 'media' | 'alta' | 'urgente';

export interface Deadline {
  id: string;
  title: string;
  description?: string | null;
  due_date: string;
  status: DeadlineStatus;
  priority: DeadlinePriority;
  type: DeadlineType;

  // Vinculação opcional com outros módulos
  process_id?: string | null;
  requirement_id?: string | null;
  client_id?: string | null;
  responsible_id?: string | null;
  intimation_id?: string | null;

  // Guardião de prazos
  origin?: string | null;
  confirmed_at?: string | null;

  // Calculadora de prazo (inputs que geraram o due_date)
  publication_date?: string | null;
  deadline_days?: number | null;
  counting_type?: string | null;

  // Notificações
  notify_days_before?: number | null;
  notified_at?: string | null;

  // Metadados
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  completed_at?: string | null;
  /** Carimbo da exclusão (soft delete). Nulo = prazo vivo. */
  deleted_at?: string | null;
  /**
   * A partir de quando o prazo entra na fila de trabalho. Nulo = agora, que é o
   * comportamento de sempre. Serve para cadastrar hoje um prazo que só interessa
   * daqui a meses, sem carregá-lo na tela até lá.
   */
  visible_from?: string | null;
  /**
   * Quando o aviso de atribuição foi resolvido — enviado ao responsável, ou
   * dispensado por ele mesmo ter cadastrado o prazo. Nulo em um prazo agendado
   * significa aviso PENDENTE: o notification-scheduler o entrega quando o prazo
   * acorda, para o responsável não ser avisado de algo que ainda não vê.
   */
  assignment_notified_at?: string | null;
}

export interface CreateDeadlineDTO {
  title: string;
  description?: string | null;
  due_date: string;
  status?: DeadlineStatus;
  priority?: DeadlinePriority;
  type: DeadlineType;
  process_id?: string | null;
  requirement_id?: string | null;
  client_id?: string | null;
  responsible_id: string;
  intimation_id?: string | null;
  origin?: string | null;
  notify_days_before?: number | null;
  publication_date?: string | null;
  deadline_days?: number | null;
  counting_type?: string | null;
  visible_from?: string | null;
  assignment_notified_at?: string | null;
}

export interface UpdateDeadlineDTO extends Partial<Omit<CreateDeadlineDTO, 'responsible_id'>> {
  responsible_id?: string | null;
  completed_at?: string | null;
}

/** Print/arquivo anexado ao motivo do cancelamento (bucket anexos_chat). */
export interface DeadlineCancellationAttachment {
  path: string;
  name: string;
  mime: string;
  size: number;
}

/** Motivo registrado quando um prazo é cancelado (tabela deadline_cancellations). */
export interface DeadlineCancellation {
  id: string;
  deadline_id: string;
  reason: string;
  cancelled_by?: string | null;
  created_at: string;
  attachments?: DeadlineCancellationAttachment[] | null;
}

/**
 * Evento de auditoria do prazo — quem mexeu, quando e em quê.
 * Vem de audit_log via RPC get_deadline_timeline; o gatilho do banco é quem
 * grava, então o registro existe mesmo para alterações feitas fora do CRM.
 */
export interface DeadlineTimelineEvent {
  id: string;
  action: string;
  user_id?: string | null;
  user_name?: string | null;
  created_at: string;
  status_from?: string | null;
  status_to?: string | null;
}

/** Quem deu a baixa (cumpriu ou cancelou) — evento de fechamento mais recente. */
export interface DeadlineClosure {
  deadline_id: string;
  action: string;
  user_id?: string | null;
  user_name?: string | null;
  created_at: string;
}

export interface DeadlineFilters {
  /**
   * Recorte de exclusão. Padrão 'ativos': quem não pede nada nunca recebe prazo
   * excluído — é o que mantém agenda, kanban, busca global e portal limpos sem
   * cada chamador ter de lembrar do filtro. Só o Histórico pede 'excluidos'.
   */
  deleted?: 'ativos' | 'excluidos';
  /**
   * Recorte de agendamento, no mesmo espírito de `deleted`. Padrão 'visiveis':
   * quem não pede nada nunca recebe prazo que ainda está dormindo — é o que faz
   * o agendamento valer para lista, kanban, contagens e alertas de uma vez só.
   * Só a tela de Agendados pede 'agendados'.
   */
  scheduled?: 'visiveis' | 'agendados' | 'todos';
  status?: DeadlineStatus;
  priority?: DeadlinePriority;
  type?: DeadlineType;
  process_id?: string;
  requirement_id?: string;
  client_id?: string;
  responsible_id?: string;
  search?: string;
  due_date_from?: string;
  due_date_to?: string;
}
