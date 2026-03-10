alter table public.cloud_files
add column if not exists archived_at timestamptz null,
add column if not exists delete_scheduled_for timestamptz null;

create index if not exists idx_cloud_files_archived_at on public.cloud_files(archived_at);
create index if not exists idx_cloud_files_delete_scheduled_for on public.cloud_files(delete_scheduled_for);

create table if not exists public.cloud_activity_logs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('file', 'folder', 'share')),
  entity_id uuid not null,
  action text not null,
  description text null,
  metadata jsonb null default '{}'::jsonb,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_cloud_activity_logs_entity on public.cloud_activity_logs(entity_type, entity_id);
create index if not exists idx_cloud_activity_logs_created_at on public.cloud_activity_logs(created_at desc);

alter table public.cloud_activity_logs enable row level security;

drop policy if exists cloud_activity_logs_authenticated_all on public.cloud_activity_logs;
create policy cloud_activity_logs_authenticated_all on public.cloud_activity_logs
for all to authenticated
using (true)
with check (true);

create or replace function public.log_cloud_activity()
returns trigger
language plpgsql
security definer
as $$
declare
  v_entity_type text;
  v_entity_id uuid;
  v_action text;
  v_description text;
  v_metadata jsonb := '{}'::jsonb;
begin
  if tg_table_name = 'cloud_files' then
    v_entity_type := 'file';
    v_entity_id := coalesce(new.id, old.id);
  elsif tg_table_name = 'cloud_folders' then
    v_entity_type := 'folder';
    v_entity_id := coalesce(new.id, old.id);
  else
    v_entity_type := 'share';
    v_entity_id := coalesce(new.id, old.id);
  end if;

  if tg_op = 'INSERT' then
    v_action := 'created';
    v_description := case v_entity_type
      when 'file' then 'Arquivo criado'
      when 'folder' then 'Pasta criada'
      else 'Link compartilhado criado'
    end;
    v_metadata := jsonb_build_object('new', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
    v_description := case v_entity_type
      when 'file' then 'Arquivo removido permanentemente'
      when 'folder' then 'Pasta removida permanentemente'
      else 'Link compartilhado removido'
    end;
    v_metadata := jsonb_build_object('old', to_jsonb(old));
  else
    if tg_table_name = 'cloud_files' and new.archived_at is not null and old.archived_at is null then
      v_action := 'archived';
      v_description := 'Arquivo enviado para a lixeira';
    elsif tg_table_name = 'cloud_files' and new.archived_at is null and old.archived_at is not null then
      v_action := 'restored';
      v_description := 'Arquivo restaurado da lixeira';
    elsif tg_table_name = 'cloud_folders' and new.archived_at is not null and old.archived_at is null then
      v_action := 'archived';
      v_description := 'Pasta arquivada';
    elsif tg_table_name = 'cloud_folders' and new.archived_at is null and old.archived_at is not null then
      v_action := 'restored';
      v_description := 'Pasta restaurada';
    elsif tg_table_name = 'cloud_folder_shares' and new.is_active = false and old.is_active = true then
      v_action := 'disabled';
      v_description := 'Link compartilhado desativado';
    else
      v_action := 'updated';
      v_description := case v_entity_type
        when 'file' then 'Arquivo atualizado'
        when 'folder' then 'Pasta atualizada'
        else 'Link compartilhado atualizado'
      end;
    end if;
    v_metadata := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
  end if;

  insert into public.cloud_activity_logs (entity_type, entity_id, action, description, metadata, created_by)
  values (v_entity_type, v_entity_id, v_action, v_description, v_metadata, auth.uid());

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_cloud_files_activity_log on public.cloud_files;
create trigger trg_cloud_files_activity_log
after insert or update or delete on public.cloud_files
for each row execute function public.log_cloud_activity();

drop trigger if exists trg_cloud_folders_activity_log on public.cloud_folders;
create trigger trg_cloud_folders_activity_log
after insert or update or delete on public.cloud_folders
for each row execute function public.log_cloud_activity();

drop trigger if exists trg_cloud_shares_activity_log on public.cloud_folder_shares;
create trigger trg_cloud_shares_activity_log
after insert or update or delete on public.cloud_folder_shares
for each row execute function public.log_cloud_activity();
