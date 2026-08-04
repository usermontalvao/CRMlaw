-- Visibilidade por usuário para os canais do WhatsApp.
--
-- Uma única regra passa a alimentar inbox, nova conversa e funil de Leads:
--   * all        = toda a equipe enxerga o canal;
--   * restricted = somente administradores, membros selecionados e usuários
--                  já envolvidos numa conversa (responsável/transferência).

alter table public.whatsapp_instances
  add column if not exists visibility_mode text not null default 'all';

alter table public.whatsapp_instances
  drop constraint if exists whatsapp_instances_visibility_mode_check;

alter table public.whatsapp_instances
  add constraint whatsapp_instances_visibility_mode_check
  check (visibility_mode in ('all', 'restricted'));

create table if not exists public.whatsapp_channel_members (
  channel_id uuid not null references public.whatsapp_instances(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists idx_wa_channel_member_user
  on public.whatsapp_channel_members (user_id, channel_id);

alter table public.whatsapp_channel_members enable row level security;

grant select, insert, delete on table public.whatsapp_channel_members to authenticated;
grant all on table public.whatsapp_channel_members to service_role;

drop policy if exists wa_channel_member_staff on public.whatsapp_channel_members;
drop policy if exists wa_channel_member_select on public.whatsapp_channel_members;
drop policy if exists wa_channel_member_insert on public.whatsapp_channel_members;
drop policy if exists wa_channel_member_delete on public.whatsapp_channel_members;

create policy wa_channel_member_select
  on public.whatsapp_channel_members
  for select
  to authenticated
  using (public.is_office_staff());

create policy wa_channel_member_insert
  on public.whatsapp_channel_members
  for insert
  to authenticated
  with check (public.wa_is_supervisor());

create policy wa_channel_member_delete
  on public.whatsapp_channel_members
  for delete
  to authenticated
  using (public.wa_is_supervisor());

-- Mantida como SECURITY INVOKER: as tabelas consultadas já têm RLS e a função
-- serve apenas para compor a policy de whatsapp_instances.
create or replace function public.wa_can_see_channel(
  p_channel uuid,
  p_visibility_mode text
)
returns boolean
language sql
stable
security invoker
set search_path to 'public'
as $$
  select public.is_office_staff() and (
    public.wa_is_supervisor()
    or p_visibility_mode = 'all'
    or exists (
      select 1
      from public.whatsapp_channel_members cm
      where cm.channel_id = p_channel and cm.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.whatsapp_conversations c
      where c.instance_id = p_channel and c.assigned_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.whatsapp_transfers t
      join public.whatsapp_conversations c on c.id = t.conversation_id
      where c.instance_id = p_channel
        and (t.to_user_id = auth.uid() or t.from_user_id = auth.uid())
    )
  );
$$;

revoke execute on function public.wa_can_see_channel(uuid, text) from public, anon;
grant execute on function public.wa_can_see_channel(uuid, text) to authenticated;

-- Conversas passam a respeitar canal E departamento. As exceções por
-- responsabilidade/transferência permanecem para não esconder trabalho já
-- atribuído ao usuário.
create or replace function public.wa_can_see_conv(
  p_channel uuid,
  p_dept uuid,
  p_assigned uuid,
  p_conv uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_office_staff() and (
    public.wa_is_supervisor()
    or p_assigned = auth.uid()
    or exists (
      select 1
      from public.whatsapp_transfers t
      where t.conversation_id = p_conv
        and (t.to_user_id = auth.uid() or t.from_user_id = auth.uid())
    )
    or (
      (
        p_channel is null
        or exists (
          select 1
          from public.whatsapp_instances i
          where i.id = p_channel and i.visibility_mode = 'all'
        )
        or exists (
          select 1
          from public.whatsapp_channel_members cm
          where cm.channel_id = p_channel and cm.user_id = auth.uid()
        )
      )
      and (
        p_dept is null
        or not exists (
          select 1
          from public.whatsapp_department_members dm
          where dm.department_id = p_dept
        )
        or exists (
          select 1
          from public.whatsapp_department_members dm
          where dm.department_id = p_dept and dm.user_id = auth.uid()
        )
      )
    )
  );
$$;

revoke execute on function public.wa_can_see_conv(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.wa_can_see_conv(uuid, uuid, uuid, uuid) to authenticated;

-- A lista de canais usa a mesma regra das conversas. As policies de escrita
-- continuam separadas para não transformar uma policy SELECT em autorização
-- de alteração.
drop policy if exists wa_inst_staff on public.whatsapp_instances;
drop policy if exists wa_inst_select on public.whatsapp_instances;
drop policy if exists wa_inst_insert on public.whatsapp_instances;
drop policy if exists wa_inst_update on public.whatsapp_instances;
drop policy if exists wa_inst_delete on public.whatsapp_instances;

create policy wa_inst_select
  on public.whatsapp_instances
  for select
  to authenticated
  using (public.wa_can_see_channel(id, visibility_mode));

create policy wa_inst_insert
  on public.whatsapp_instances
  for insert
  to authenticated
  with check (public.wa_is_supervisor());

create policy wa_inst_update
  on public.whatsapp_instances
  for update
  to authenticated
  using (public.wa_is_supervisor())
  with check (public.wa_is_supervisor());

create policy wa_inst_delete
  on public.whatsapp_instances
  for delete
  to authenticated
  using (public.wa_is_supervisor());

comment on column public.whatsapp_instances.visibility_mode is
  'Escopo único do canal para WhatsApp e Leads: all ou restricted.';

comment on table public.whatsapp_channel_members is
  'Usuários autorizados a enxergar canais com visibility_mode=restricted.';
