-- Acoes opcionais executadas quando uma conversa entra manualmente em uma
-- etapa do funil. O array vazio preserva integralmente os funis existentes.
-- O formato reutiliza o vocabulario de whatsapp_workflow_rules:
-- [{"type":"send_message","message":"..."},
--  {"type":"transfer_to_department","target":"<uuid>"},
--  {"type":"close_conversation","message":"...","payload":{"reason":"..."}}]

alter table public.whatsapp_channel_funnel_stages
  add column if not exists entry_actions jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wa_channel_funnel_entry_actions_array'
      and conrelid = 'public.whatsapp_channel_funnel_stages'::regclass
  ) then
    alter table public.whatsapp_channel_funnel_stages
      add constraint wa_channel_funnel_entry_actions_array
      check (jsonb_typeof(entry_actions) = 'array');
  end if;
end $$;

comment on column public.whatsapp_channel_funnel_stages.entry_actions is
  'Acoes ordenadas executadas pela interface ao mover uma conversa para esta etapa.';

notify pgrst, 'reload schema';
