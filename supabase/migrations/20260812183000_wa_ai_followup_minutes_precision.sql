-- ============================================================================
-- A escada de acompanhamento passa a aceitar degraus em MINUTOS.
--
-- "Primeiro follow-up 10 minutos depois da última mensagem sem resposta" é
-- 0,1667 hora. Em `numeric(6,2)` isso vira 0,17 — 12 segundos de erro no degrau
-- mais curto, que é justamente o mais visível para o cliente. Quatro casas
-- decimais cobrem até 3,6 segundos, e o teto de 30 dias continua o mesmo.
--
-- O CHECK do intervalo base descia só até 0.25 (15 min) e passa a 0.0166 (1 min).
-- ============================================================================

begin;

alter table public.whatsapp_ai_assistants
  alter column followup_custom_hours type numeric(8,4)[]
    using followup_custom_hours::numeric(8,4)[],
  alter column followup_interval_hours type numeric(8,4)
    using followup_interval_hours::numeric(8,4);

alter table public.whatsapp_ai_assistants
  drop constraint if exists whatsapp_ai_assistants_followup_interval_hours_check;

alter table public.whatsapp_ai_assistants
  add constraint whatsapp_ai_assistants_followup_interval_hours_check
  check (followup_interval_hours between 0.0166 and 720);

commit;
