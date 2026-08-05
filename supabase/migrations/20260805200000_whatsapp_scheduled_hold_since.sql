-- Retenção por reconexão: desde quando a mensagem está esperando o canal voltar.
--
-- Sem esta marca, o scheduler não tinha como saber há quanto tempo insistia:
-- `created_at` é o momento em que a mensagem foi criada (numa agendada comum,
-- dias antes de o canal cair) e `scheduled_at` é reescrito a cada tentativa.
-- Com ela dá para espaçar as tentativas e desistir quando o canal está morto —
-- em vez de bater na Evolution a cada minuto para sempre.
alter table public.whatsapp_scheduled_messages
  add column if not exists hold_since timestamptz;

comment on column public.whatsapp_scheduled_messages.hold_since is
  'Início da retenção automática (hold_reason=''reconnect''). NULL quando não está retida.';
