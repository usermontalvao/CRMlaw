-- ============================================================
-- WhatsApp — a agendada que saiu passa a APONTAR para a mensagem
--   que ela virou na thread.
--
--   Sem este vínculo, "concluída" era um fim de linha: a lista sabia
--   que a mensagem tinha saído, mas não onde ela caiu na conversa —
--   clicar levava para o fim da thread, e quem queria conferir o que
--   o cliente leu tinha de procurar pela data, rolando para cima.
--
--   O elo mora aqui (e não em `whatsapp_messages`) de propósito: a
--   marca "isto saiu de um agendamento" é INTERNA. A mensagem que o
--   contato recebeu é uma mensagem como qualquer outra — nada no que
--   sai muda, e nada do agendamento viaja para o aparelho dele.
-- ============================================================

alter table public.whatsapp_scheduled_messages
  add column if not exists sent_message_id uuid
    references public.whatsapp_messages(id) on delete set null;

comment on column public.whatsapp_scheduled_messages.sent_message_id is
  'Mensagem da thread criada por este agendamento. Preenchida pelo whatsapp-scheduler no sucesso do envio. NULL = ainda não saiu, ou saiu antes deste vínculo existir. ON DELETE SET NULL: apagar a mensagem não pode apagar o registro do agendamento.';

create index if not exists idx_wa_sched_sent_message
  on public.whatsapp_scheduled_messages (sent_message_id)
  where sent_message_id is not null;

-- ── Retroativo, e só onde não há dúvida ──────────────────────────────
-- As agendadas que já saíram não guardaram o elo. Ele é reconstruído pelo
-- que sobrou: MESMA conversa, mensagem NOSSA, mesmo texto e um instante
-- colado no `sent_at` (o envio e a gravação acontecem no mesmo passo do
-- cron). A janela de 2 minutos é folga de relógio, não chute.
--
-- Deliberadamente conservador: sem `sent_at`, sem corpo, com mais de uma
-- candidata ou com texto repetido na janela, a linha fica sem elo — e o
-- clique continua abrindo a conversa no fim, como antes. Um elo errado
-- levaria o atendente à mensagem errada, o que é pior que não levar.
with candidata as (
  select
    s.id as sched_id,
    (
      select m.id
      from public.whatsapp_messages m
      where m.conversation_id = s.conversation_id
        and m.direction = 'out'
        and m.content is not distinct from s.body
        and m.wa_timestamp between s.sent_at - interval '2 minutes'
                              and s.sent_at + interval '2 minutes'
      order by abs(extract(epoch from (m.wa_timestamp - s.sent_at)))
      limit 1
    ) as message_id,
    (
      select count(*)
      from public.whatsapp_messages m
      where m.conversation_id = s.conversation_id
        and m.direction = 'out'
        and m.content is not distinct from s.body
        and m.wa_timestamp between s.sent_at - interval '2 minutes'
                              and s.sent_at + interval '2 minutes'
    ) as quantas
  from public.whatsapp_scheduled_messages s
  where s.status = 'sent'
    and s.sent_at is not null
    and s.body is not null
    and s.sent_message_id is null
)
update public.whatsapp_scheduled_messages s
set sent_message_id = c.message_id
from candidata c
where s.id = c.sched_id
  and c.quantas = 1
  and c.message_id is not null;
