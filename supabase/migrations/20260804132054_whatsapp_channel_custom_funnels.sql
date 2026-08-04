-- Funil personalizado por canal do WhatsApp.
-- Cada número passa a ter suas próprias etapas, ordem, cores e etiquetas.
-- O funil global de Leads permanece como modelo-base e fallback para leads que
-- não nasceram de uma conversa do WhatsApp.

alter table public.whatsapp_instances
  add column if not exists funnel_enabled boolean not null default true,
  add column if not exists funnel_initial_stage text;

create table if not exists public.whatsapp_channel_funnel_stages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.whatsapp_instances(id) on delete cascade,
  stage_key text not null,
  label text not null,
  description text not null default '',
  color text not null default '#64748b',
  labels text[] not null default '{}',
  position integer not null default 0,
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_channel_funnel_stage_key_not_blank check (btrim(stage_key) <> ''),
  constraint whatsapp_channel_funnel_label_not_blank check (btrim(label) <> ''),
  constraint whatsapp_channel_funnel_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$'),
  unique (channel_id, stage_key)
);

create index if not exists idx_wa_channel_funnel_order
  on public.whatsapp_channel_funnel_stages (channel_id, position, created_at);

drop trigger if exists trg_wa_channel_funnel_updated on public.whatsapp_channel_funnel_stages;
create trigger trg_wa_channel_funnel_updated
  before update on public.whatsapp_channel_funnel_stages
  for each row execute function public.wa_set_updated_at();

-- Se as etiquetas de uma etapa mudarem, mantém as conversas existentes dentro
-- da mesma etapa. Ao excluir uma etapa, move-as para a etapa inicial/seguinte,
-- evitando cards órfãos fora do Kanban.
create or replace function public.wa_sync_channel_funnel_conversations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_labels text[];
  replacement_label text;
  affected_channel uuid;
begin
  previous_labels := case
    when cardinality(old.labels) > 0 then old.labels
    else array[old.label]
  end;
  affected_channel := old.channel_id;

  if tg_op = 'DELETE' then
    select coalesce(nullif(s.labels[1], ''), s.label)
    into replacement_label
    from public.whatsapp_channel_funnel_stages s
    join public.whatsapp_instances i on i.id = s.channel_id
    where s.channel_id = old.channel_id
      and s.stage_key <> old.stage_key
      and s.is_active
    order by
      (s.stage_key = i.funnel_initial_stage) desc,
      s.is_default desc,
      s.position,
      s.created_at
    limit 1;
  else
    replacement_label := coalesce(nullif(new.labels[1], ''), new.label);
  end if;

  if replacement_label is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  update public.whatsapp_conversations c
  set labels = (
    select array_agg(mapped_label order by first_position)
    from (
      select mapped_label, min(position) as first_position
      from (
        select
          case when item = any(previous_labels) then replacement_label else item end as mapped_label,
          position
        from unnest(c.labels) with ordinality as current_label(item, position)
      ) mapped
      group by mapped_label
    ) deduplicated
  )
  where c.instance_id = affected_channel
    and c.labels && previous_labels;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.wa_sync_channel_funnel_conversations() from public, anon, authenticated;

drop trigger if exists trg_wa_sync_channel_funnel_update on public.whatsapp_channel_funnel_stages;
create trigger trg_wa_sync_channel_funnel_update
  after update of label, labels on public.whatsapp_channel_funnel_stages
  for each row
  when (old.label is distinct from new.label or old.labels is distinct from new.labels)
  execute function public.wa_sync_channel_funnel_conversations();

drop trigger if exists trg_wa_sync_channel_funnel_delete on public.whatsapp_channel_funnel_stages;
create trigger trg_wa_sync_channel_funnel_delete
  before delete on public.whatsapp_channel_funnel_stages
  for each row execute function public.wa_sync_channel_funnel_conversations();

alter table public.whatsapp_channel_funnel_stages enable row level security;

grant select, insert, update, delete
  on table public.whatsapp_channel_funnel_stages to authenticated;
grant all
  on table public.whatsapp_channel_funnel_stages to service_role;

drop policy if exists wa_channel_funnel_select on public.whatsapp_channel_funnel_stages;
drop policy if exists wa_channel_funnel_insert on public.whatsapp_channel_funnel_stages;
drop policy if exists wa_channel_funnel_update on public.whatsapp_channel_funnel_stages;
drop policy if exists wa_channel_funnel_delete on public.whatsapp_channel_funnel_stages;

-- A consulta herda o recorte do próprio canal: a subconsulta abaixo passa pela
-- RLS de whatsapp_instances e, portanto, usa a mesma visibilidade da inbox.
create policy wa_channel_funnel_select
  on public.whatsapp_channel_funnel_stages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.whatsapp_instances i
      where i.id = channel_id
    )
  );

create policy wa_channel_funnel_insert
  on public.whatsapp_channel_funnel_stages
  for insert
  to authenticated
  with check (public.wa_is_supervisor());

create policy wa_channel_funnel_update
  on public.whatsapp_channel_funnel_stages
  for update
  to authenticated
  using (public.wa_is_supervisor())
  with check (public.wa_is_supervisor());

create policy wa_channel_funnel_delete
  on public.whatsapp_channel_funnel_stages
  for delete
  to authenticated
  using (public.wa_is_supervisor());

-- Migração sem ruptura: copia o funil-base atual para cada canal. Se o projeto
-- ainda não tiver lead_module_config, usa um modelo jurídico seguro.
with base_config as (
  select coalesce(
    (
      select value->'stages'
      from public.system_settings
      where key = 'lead_module_config'
      limit 1
    ),
    $$[
      {"key":"novo","label":"Novo","description":"Lead recém-cadastrado, aguarda primeiro contato.","color":"#64748b","labels":["Novo lead"]},
      {"key":"qualificando","label":"Qualificando","description":"Contato em andamento para entender necessidades.","color":"#3b82f6","labels":["Aguardando retorno"]},
      {"key":"qualificado","label":"Qualificado","description":"Lead validado e pronto para conversão.","color":"#10b981","labels":["Proposta enviada"]},
      {"key":"aguardando_documentos","label":"Aguardando Documentos","description":"Lead enviando documentos ou informações.","color":"#f59e0b","labels":["Documentação pendente"]},
      {"key":"nao_qualificado","label":"Não Qualificado","description":"Lead não avançará como cliente.","color":"#ef4444","labels":["Perdido"]}
    ]$$::jsonb
  ) as stages
), expanded as (
  select
    i.id as channel_id,
    stage.value as stage,
    stage.ordinality::integer - 1 as position
  from public.whatsapp_instances i
  cross join base_config b
  cross join lateral jsonb_array_elements(b.stages) with ordinality as stage(value, ordinality)
)
insert into public.whatsapp_channel_funnel_stages (
  channel_id,
  stage_key,
  label,
  description,
  color,
  labels,
  position,
  is_active,
  is_default
)
select
  channel_id,
  coalesce(nullif(stage->>'key', ''), 'etapa_' || position::text),
  coalesce(nullif(stage->>'label', ''), 'Etapa ' || (position + 1)::text),
  coalesce(stage->>'description', ''),
  case
    when coalesce(stage->>'color', '') ~ '^#[0-9A-Fa-f]{6}$' then stage->>'color'
    when stage->>'color' = 'blue' then '#3b82f6'
    when stage->>'color' = 'emerald' then '#10b981'
    when stage->>'color' = 'amber' then '#f59e0b'
    when stage->>'color' = 'red' then '#ef4444'
    when stage->>'color' = 'violet' then '#8b5cf6'
    when stage->>'color' = 'orange' then '#f97316'
    when stage->>'color' = 'cyan' then '#06b6d4'
    else '#64748b'
  end,
  case
    when jsonb_typeof(stage->'labels') = 'array' and jsonb_array_length(stage->'labels') > 0
      then array(select jsonb_array_elements_text(stage->'labels'))
    else array[coalesce(nullif(stage->>'label', ''), 'Etapa ' || (position + 1)::text)]
  end,
  position,
  coalesce((stage->>'active')::boolean, true),
  coalesce((stage->>'isDefault')::boolean, position = 0)
from expanded
on conflict (channel_id, stage_key) do nothing;

-- Garante uma etapa inicial coerente nos canais antigos.
update public.whatsapp_instances i
set funnel_initial_stage = coalesce(
  i.funnel_initial_stage,
  (
    select s.stage_key
    from public.whatsapp_channel_funnel_stages s
    where s.channel_id = i.id and s.is_active
    order by s.is_default desc, s.position, s.created_at
    limit 1
  )
)
where i.funnel_initial_stage is null;

-- Toda conversa realmente nova entra na etapa inicial do SEU canal, seja ela
-- criada pela interface ou recebida pelo webhook. Reaberturas e conversas que
-- já possuem etiquetas não são reiniciadas.
create or replace function public.wa_apply_channel_initial_funnel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  initial_label text;
begin
  if new.instance_id is null or coalesce(cardinality(new.labels), 0) > 0 then
    return new;
  end if;

  select coalesce(nullif(s.labels[1], ''), s.label)
  into initial_label
  from public.whatsapp_instances i
  join public.whatsapp_channel_funnel_stages s on s.channel_id = i.id
  where i.id = new.instance_id
    and i.funnel_enabled
    and s.is_active
  order by
    (s.stage_key = i.funnel_initial_stage) desc,
    s.is_default desc,
    s.position,
    s.created_at
  limit 1;

  if initial_label is not null then
    new.labels := array[initial_label];
  end if;
  return new;
end;
$$;

revoke all on function public.wa_apply_channel_initial_funnel() from public, anon, authenticated;

drop trigger if exists trg_wa_apply_channel_initial_funnel on public.whatsapp_conversations;
create trigger trg_wa_apply_channel_initial_funnel
  before insert on public.whatsapp_conversations
  for each row execute function public.wa_apply_channel_initial_funnel();

comment on table public.whatsapp_channel_funnel_stages is
  'Etapas personalizadas do funil de cada canal/número do WhatsApp.';
