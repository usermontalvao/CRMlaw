-- nextcloud_change_events (MVP)
-- -----------------------------------------------------------------------------
-- Fila de eventos de mudança vindos do Nextcloud/CloudNexus via webhook.
-- Fluxo: Nextcloud -> Edge Function nextcloud-webhook (service_role) -> INSERT
--        aqui -> Supabase Realtime -> NextcloudBrowser atualiza a pasta afetada.
--
-- MVP: estrutura mínima para provar o fluxo ponta a ponta. Dedup/retenção/
-- índices adicionais entram na versão final.

create table if not exists public.nextcloud_change_events (
  id                  uuid primary key default gen_random_uuid(),
  event_class         text not null,
  actor_uid           text,
  actor_name          text,
  node_path           text,
  source_path         text,
  target_path         text,
  affected_directory  text,
  node_id             bigint,
  payload             jsonb not null,
  created_at          timestamptz not null default now()
);

comment on table public.nextcloud_change_events is
  'Eventos de mudança do Nextcloud recebidos via webhook. INSERT somente via service_role (Edge Function). Leitura pelos usuários autenticados do CRM.';

create index if not exists nextcloud_change_events_created_at_idx
  on public.nextcloud_change_events (created_at desc);

-- RLS: leitura para autenticados (CRM privado); escrita apenas service_role
-- (que ignora RLS). NENHUMA policy de INSERT/UPDATE/DELETE é criada de
-- propósito, para bloquear qualquer escrita a partir do cliente.
alter table public.nextcloud_change_events enable row level security;

drop policy if exists nextcloud_change_events_select on public.nextcloud_change_events;
create policy nextcloud_change_events_select
  on public.nextcloud_change_events
  for select
  to authenticated
  using (true);

-- Garante que a tabela seja transmitida pelo Supabase Realtime.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'nextcloud_change_events'
  ) then
    alter publication supabase_realtime add table public.nextcloud_change_events;
  end if;
end $$;
