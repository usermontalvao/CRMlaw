-- Motivo de cancelamento de prazos.
-- Um registro por cancelamento; o mais recente é o que a UI exibe.
create table if not exists public.deadline_cancellations (
  id uuid primary key default gen_random_uuid(),
  deadline_id uuid not null references public.deadlines(id) on delete cascade,
  reason text not null,
  cancelled_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists deadline_cancellations_deadline_id_idx
  on public.deadline_cancellations (deadline_id, created_at desc);

alter table public.deadline_cancellations enable row level security;

drop policy if exists "Equipe do escritorio gerencia cancelamentos" on public.deadline_cancellations;
create policy "Equipe do escritorio gerencia cancelamentos"
  on public.deadline_cancellations
  for all
  using (is_office_staff())
  with check (is_office_staff());

comment on table public.deadline_cancellations is 'Motivo de cancelamento de prazos: um registro por cancelamento, o mais recente e o vigente.';
