-- Aviso de atribuição suspenso enquanto o prazo agendado dorme.
--
-- O problema: quem agenda um prazo para daqui a três meses e o atribui a alguém
-- dispara HOJE a notificação "um prazo foi atribuído a você". O responsável abre
-- a lista, não acha nada — o prazo ainda está dormindo — e o aviso é descartado.
-- Quando o prazo finalmente acorda, ninguém é avisado, porque o aviso já foi
-- dado e lido há três meses.
--
-- A solução é carimbar quando o aviso foi RESOLVIDO, em vez de assumir que ele
-- sai junto com o cadastro:
--
--   * preenchido  → o responsável já foi comunicado, ou não precisa ser (ele
--                   mesmo cadastrou o prazo);
--   * NULL        → aviso PENDENTE. O notification-scheduler o entrega na
--                   primeira passagem em que o prazo já esteja visível.
--
-- O DEFAULT now() é o que torna isto seguro de ligar: todo INSERT que não fala
-- da coluna — automações, guardião de prazos, conversão de prescrições, o
-- próprio formulário no caso comum — já nasce resolvido e continua se
-- comportando exatamente como antes. Só o cadastro agendado grava NULL de
-- propósito, e é o único que o scheduler vai buscar.

alter table public.deadlines
  add column if not exists assignment_notified_at timestamptz default now();

comment on column public.deadlines.assignment_notified_at is
  'Quando o aviso de atribuicao foi resolvido (enviado ao responsavel ou dispensado). NULL = aviso pendente, guardado ate o prazo ficar visivel. DEFAULT now() para que quem nao conhece a coluna continue com o comportamento de sempre.';

-- Backfill do acervo: todo prazo que já existe teve seu aviso resolvido no
-- cadastro. Sem isto, ligar o scheduler notificaria o escritório inteiro sobre
-- prazos antigos de uma vez só.
update public.deadlines
   set assignment_notified_at = created_at
 where assignment_notified_at is null;

-- Índice parcial: a fila de avisos pendentes é minúscula perto da tabela, e o
-- scheduler a varre de hora em hora. Fora dela, a coluna não onera escrita.
create index if not exists idx_deadlines_assignment_notice_pending
  on public.deadlines (visible_from)
  where assignment_notified_at is null and deleted_at is null;

notify pgrst, 'reload schema';
