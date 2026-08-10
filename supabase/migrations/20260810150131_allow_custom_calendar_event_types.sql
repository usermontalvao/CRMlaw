-- Os tipos da Agenda são configuráveis em system_settings. A restrição
-- anterior repetia apenas os sete tipos canônicos e impedia salvar qualquer
-- tipo personalizado criado pela própria interface de Configurações.
alter table public.calendar_events
  drop constraint if exists calendar_events_event_type_check;

-- Mantém a validação estrutural sem duplicar no banco a lista dinâmica
-- armazenada em system_settings.
alter table public.calendar_events
  add constraint calendar_events_event_type_check
  check (
    event_type = btrim(event_type)
    and char_length(event_type) between 1 and 100
  );
