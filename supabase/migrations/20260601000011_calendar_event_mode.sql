-- Adiciona coluna `event_mode` em calendar_events para indicar
-- se o compromisso é presencial ou online.
-- Nullable: eventos antigos e tipos sem modo (pessoal, prazo) ficam NULL.
alter table public.calendar_events
  add column if not exists event_mode text
    check (event_mode in ('presencial', 'online'))
    default null;
