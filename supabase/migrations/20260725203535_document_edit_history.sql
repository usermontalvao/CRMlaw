create table if not exists public.document_edit_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('petition', 'nextcloud')),
  source_key text not null,
  title text not null,
  client_id uuid references public.clients(id) on delete set null,
  client_name text,
  nextcloud_path text,
  last_action text not null default 'opened' check (last_action in ('opened', 'saved')),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_edit_history_user_source_key_unique unique (user_id, source, source_key)
);

comment on table public.document_edit_history is
  'Historico unificado dos documentos abertos ou salvos por cada usuario no editor, incluindo arquivos do Nextcloud.';

create index if not exists document_edit_history_user_activity_idx
  on public.document_edit_history (user_id, last_activity_at desc);

alter table public.document_edit_history enable row level security;

drop policy if exists document_edit_history_select_own on public.document_edit_history;
create policy document_edit_history_select_own
  on public.document_edit_history
  for select
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists document_edit_history_insert_own on public.document_edit_history;
create policy document_edit_history_insert_own
  on public.document_edit_history
  for insert
  to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists document_edit_history_update_own on public.document_edit_history;
create policy document_edit_history_update_own
  on public.document_edit_history
  for update
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists document_edit_history_delete_own on public.document_edit_history;
create policy document_edit_history_delete_own
  on public.document_edit_history
  for delete
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

grant select, insert, update, delete on table public.document_edit_history to authenticated;
revoke all on table public.document_edit_history from anon;
