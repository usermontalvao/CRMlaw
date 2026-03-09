alter table public.cloud_folders
add column if not exists archived_at timestamptz null,
add column if not exists delete_scheduled_for timestamptz null;

create index if not exists idx_cloud_folders_archived_at on public.cloud_folders(archived_at);
create index if not exists idx_cloud_folders_delete_scheduled_for on public.cloud_folders(delete_scheduled_for);
