-- Histórico de alterações do cadastro do cliente.
--
-- Regra de negócio: dado novo entra, dado antigo NUNCA some. Toda vez que um
-- campo do cadastro muda — por edição manual, por aprovação de solicitação do
-- portal, por importação de dados da assinatura ou por mesclagem de contatos
-- duplicados — o valor anterior fica registrado aqui, com a origem da mudança.
-- É isso que permite mesclar dois cadastros da mesma pessoa sem medo: o que foi
-- sobrescrito continua consultável na ficha.

create table if not exists public.client_change_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  source text not null default 'edicao'
    check (source in ('edicao', 'mesclagem', 'portal', 'assinatura', 'importacao')),
  -- Na mesclagem: de qual cadastro duplicado o dado novo veio.
  source_client_id uuid references public.clients(id) on delete set null,
  source_label text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

comment on table public.client_change_history is
  'Trilha de alterações dos campos do cadastro do cliente. O valor antigo é preservado mesmo quando sobrescrito por um dado mais recente ou por mesclagem de duplicados.';

create index if not exists client_change_history_client_idx
  on public.client_change_history (client_id, changed_at desc);

alter table public.client_change_history enable row level security;

drop policy if exists client_change_history_select on public.client_change_history;
create policy client_change_history_select
  on public.client_change_history
  for select
  to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists client_change_history_insert on public.client_change_history;
create policy client_change_history_insert
  on public.client_change_history
  for insert
  to authenticated
  with check ((select auth.uid()) is not null);

grant select, insert on table public.client_change_history to authenticated;
revoke all on table public.client_change_history from anon;
