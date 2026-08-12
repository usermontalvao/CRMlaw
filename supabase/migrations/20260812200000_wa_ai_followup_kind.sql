-- ============================================================================
-- Compromisso ≠ cobrança.
--
-- "Me chama às 14h" e "a pessoa sumiu, vou insistir" viram a mesma linha em
-- `whatsapp_ai_followups`, mas não são a mesma coisa e não podem contar igual:
--
--   followup    — degrau da escada. Consome uma tentativa das 8.
--   appointment — hora que o CLIENTE pediu. PAUSA a escada enquanto existe e
--                 NÃO consome tentativa: a pessoa não sumiu, ela marcou.
--
-- Sem esta distinção, um cliente que remarca duas vezes gasta duas das oito
-- cobranças sem nunca ter deixado de responder.
-- ============================================================================

begin;

alter table public.whatsapp_ai_followups
  add column if not exists kind text not null default 'followup';

alter table public.whatsapp_ai_followups
  drop constraint if exists wa_ai_followup_kind_check;

alter table public.whatsapp_ai_followups
  add constraint wa_ai_followup_kind_check check (kind in ('followup', 'appointment'));

comment on column public.whatsapp_ai_followups.kind is
  'followup = cobrança da escada (consome tentativa). appointment = hora marcada pelo cliente (pausa a escada, não consome).';

commit;
