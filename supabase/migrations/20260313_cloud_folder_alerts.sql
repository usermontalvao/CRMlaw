alter table public.cloud_folders
  add column if not exists has_pending_issue boolean not null default false,
  add column if not exists alert_level text null,
  add column if not exists pending_reason text null,
  add column if not exists resolved_at timestamptz null;

create index if not exists idx_cloud_folders_has_pending_issue
  on public.cloud_folders(has_pending_issue);

create index if not exists idx_cloud_folders_alert_level
  on public.cloud_folders(alert_level);
