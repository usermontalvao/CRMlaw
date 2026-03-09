create extension if not exists pgcrypto;

create table if not exists public.cloud_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid null references public.cloud_folders(id) on delete cascade,
  client_id uuid null references public.clients(id) on delete set null,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cloud_files (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.cloud_folders(id) on delete cascade,
  client_id uuid null references public.clients(id) on delete set null,
  original_name text not null,
  storage_path text not null unique,
  mime_type text null,
  file_size bigint not null default 0,
  extension text null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cloud_folder_shares (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.cloud_folders(id) on delete cascade,
  token text not null unique,
  password_hash text null,
  expires_at timestamptz null,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cloud_folders_parent_id on public.cloud_folders(parent_id);
create index if not exists idx_cloud_folders_client_id on public.cloud_folders(client_id);
create index if not exists idx_cloud_files_folder_id on public.cloud_files(folder_id);
create index if not exists idx_cloud_files_client_id on public.cloud_files(client_id);
create index if not exists idx_cloud_folder_shares_folder_id on public.cloud_folder_shares(folder_id);
create index if not exists idx_cloud_folder_shares_token on public.cloud_folder_shares(token);

create or replace function public.set_cloud_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_cloud_folders_updated_at on public.cloud_folders;
create trigger trg_cloud_folders_updated_at
before update on public.cloud_folders
for each row execute function public.set_cloud_updated_at();

drop trigger if exists trg_cloud_files_updated_at on public.cloud_files;
create trigger trg_cloud_files_updated_at
before update on public.cloud_files
for each row execute function public.set_cloud_updated_at();

drop trigger if exists trg_cloud_folder_shares_updated_at on public.cloud_folder_shares;
create trigger trg_cloud_folder_shares_updated_at
before update on public.cloud_folder_shares
for each row execute function public.set_cloud_updated_at();

alter table public.cloud_folders enable row level security;
alter table public.cloud_files enable row level security;
alter table public.cloud_folder_shares enable row level security;

drop policy if exists cloud_folders_authenticated_all on public.cloud_folders;
create policy cloud_folders_authenticated_all on public.cloud_folders
for all to authenticated
using (true)
with check (true);

drop policy if exists cloud_files_authenticated_all on public.cloud_files;
create policy cloud_files_authenticated_all on public.cloud_files
for all to authenticated
using (true)
with check (true);

drop policy if exists cloud_folder_shares_authenticated_all on public.cloud_folder_shares;
create policy cloud_folder_shares_authenticated_all on public.cloud_folder_shares
for all to authenticated
using (true)
with check (true);

create or replace function public.cloud_folder_has_active_share(folder_uuid uuid)
returns boolean
language sql
stable
as $$
  with recursive folder_tree as (
    select f.id, f.parent_id
    from public.cloud_folders f
    where f.id = folder_uuid
    union all
    select parent.id, parent.parent_id
    from public.cloud_folders parent
    inner join folder_tree child on child.parent_id = parent.id
  )
  select exists (
    select 1
    from public.cloud_folder_shares s
    join folder_tree ft on ft.id = s.folder_id
    where s.is_active = true
      and (s.expires_at is null or s.expires_at > now())
  );
$$;

drop policy if exists cloud_folders_anon_shared_view on public.cloud_folders;
create policy cloud_folders_anon_shared_view on public.cloud_folders
for select to anon
using (public.cloud_folder_has_active_share(id));

drop policy if exists cloud_files_anon_shared_view on public.cloud_files;
create policy cloud_files_anon_shared_view on public.cloud_files
for select to anon
using (public.cloud_folder_has_active_share(folder_id));

drop policy if exists cloud_folder_shares_anon_lookup on public.cloud_folder_shares;
create policy cloud_folder_shares_anon_lookup on public.cloud_folder_shares
for select to anon
using (is_active = true and (expires_at is null or expires_at > now()));

insert into storage.buckets (id, name, public)
select 'cloud-files', 'cloud-files', false
where not exists (
  select 1 from storage.buckets where id = 'cloud-files'
);

drop policy if exists cloud_files_storage_authenticated_all on storage.objects;
create policy cloud_files_storage_authenticated_all on storage.objects
for all to authenticated
using (bucket_id = 'cloud-files')
with check (bucket_id = 'cloud-files');

drop policy if exists cloud_files_storage_anon_shared_view on storage.objects;
create policy cloud_files_storage_anon_shared_view on storage.objects
for select to anon
using (
  bucket_id = 'cloud-files'
  and public.cloud_folder_has_active_share(split_part(name, '/', 1)::uuid)
);
