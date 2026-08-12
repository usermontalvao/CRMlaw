-- ============================================================================
-- Limiar de INATIVIDADE do acompanhamento.
--
-- A escada (2h, 4h, 8h…) não conta a partir da última fala do escritório: ela
-- conta a partir do momento em que a outra parte é considerada INATIVA. São
-- coisas diferentes — "duas horas" quer dizer duas horas de alguém que já parou
-- de responder, e não duas horas de uma conversa que talvez ainda esteja
-- acontecendo.
--
-- Só vale para a PRIMEIRA tentativa. Da segunda em diante a inatividade já está
-- estabelecida, e somar de novo empurraria a escada inteira para a frente.
-- ============================================================================

begin;

alter table public.whatsapp_ai_assistants
  add column if not exists followup_inactivity_minutes int not null default 10;

alter table public.whatsapp_ai_assistants
  drop constraint if exists wa_ai_followup_inactivity_range;

alter table public.whatsapp_ai_assistants
  add constraint wa_ai_followup_inactivity_range
  check (followup_inactivity_minutes between 0 and 1440);

comment on column public.whatsapp_ai_assistants.followup_inactivity_minutes is
  'Silêncio que define a outra parte como inativa. Marco zero da escada, não um degrau.';

commit;
