-- ============================================================================
-- Auditoria de compromissos da agenda (27/06/2026)
--
-- Cria a tabela `calendar_event_audit` e um trigger AFTER INSERT/UPDATE/DELETE
-- em `calendar_events` que grava:
--   - ação realizada (create / update / delete)
--   - usuário responsável (auth.uid())  +  nome do perfil
--   - snapshot anterior (before_data) e posterior (after_data)
--   - diff de campos alterados em UPDATE (changed_fields)
--
-- Padrão do projeto: SECURITY DEFINER + auth.uid() — idêntico ao usado em
-- cloud_activity_logs / log_cloud_activity().
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela de auditoria
-- ----------------------------------------------------------------------------
create table if not exists public.calendar_event_audit (
  id                 uuid        primary key default gen_random_uuid(),
  calendar_event_id  uuid        null,          -- null quando o evento foi deletado (sem FK para não bloquear deleção)
  action             text        not null check (action in ('create', 'update', 'delete')),
  changed_at         timestamptz not null default now(),
  changed_by         uuid        null references auth.users(id) on delete set null,
  changed_by_name    text        null,
  before_data        jsonb       null,
  after_data         jsonb       null,
  changed_fields     jsonb       null          -- somente em UPDATE: {campo: {before, after}}
);

create index if not exists idx_cal_audit_event_id
  on public.calendar_event_audit(calendar_event_id);

create index if not exists idx_cal_audit_changed_at
  on public.calendar_event_audit(changed_at desc);

create index if not exists idx_cal_audit_changed_by
  on public.calendar_event_audit(changed_by);

-- ----------------------------------------------------------------------------
-- 2. RLS — apenas autenticados podem ler; escrita exclusiva via trigger (SD)
-- ----------------------------------------------------------------------------
alter table public.calendar_event_audit enable row level security;

drop policy if exists cal_audit_read_authenticated on public.calendar_event_audit;
create policy cal_audit_read_authenticated
  on public.calendar_event_audit
  for select
  to authenticated
  using (true);

-- Escrita só via service_role / trigger SECURITY DEFINER — sem política INSERT/UPDATE/DELETE
-- para authenticated, o que bloqueia gravação direta pelo frontend.

-- ----------------------------------------------------------------------------
-- 3. Função de trigger
-- ----------------------------------------------------------------------------
create or replace function public.fn_calendar_event_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action        text;
  v_before        jsonb;
  v_after         jsonb;
  v_changed       jsonb := null;
  v_user_id       uuid;
  v_user_name     text;
  v_old_field     jsonb;
  v_new_field     jsonb;
  v_key           text;
  -- Campos de controle interno que não devem gerar diff no audit
  v_skip_fields   text[] := array['updated_at', 'created_at', 'djen_checked_at'];
begin
  -- Identificar usuário da sessão
  v_user_id := auth.uid();

  -- Resolver nome do perfil (pode ser null se ação vier de trigger interno)
  if v_user_id is not null then
    select name
      into v_user_name
      from public.profiles
     where user_id = v_user_id
     limit 1;
  end if;

  if tg_op = 'INSERT' then
    v_action := 'create';
    v_before := null;
    v_after  := to_jsonb(new);

  elsif tg_op = 'DELETE' then
    v_action := 'delete';
    v_before := to_jsonb(old);
    v_after  := null;

  else -- UPDATE
    v_action := 'update';
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);

    -- Calcular diff: apenas campos que realmente mudaram
    v_changed := '{}'::jsonb;
    for v_key, v_old_field in select * from jsonb_each(v_before) loop
      if v_key = any(v_skip_fields) then
        continue;
      end if;
      v_new_field := v_after -> v_key;
      if v_old_field is distinct from v_new_field then
        v_changed := v_changed || jsonb_build_object(
          v_key,
          jsonb_build_object('before', v_old_field, 'after', v_new_field)
        );
      end if;
    end loop;

    -- Se nada mudou além de campos ignorados, não grava auditoria
    if v_changed = '{}'::jsonb then
      return coalesce(new, old);
    end if;
  end if;

  insert into public.calendar_event_audit (
    calendar_event_id,
    action,
    changed_by,
    changed_by_name,
    before_data,
    after_data,
    changed_fields
  ) values (
    coalesce(new.id, old.id),
    v_action,
    v_user_id,
    v_user_name,
    v_before,
    v_after,
    v_changed
  );

  return coalesce(new, old);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Trigger na tabela calendar_events
-- ----------------------------------------------------------------------------
drop trigger if exists trg_calendar_event_audit on public.calendar_events;

create trigger trg_calendar_event_audit
  after insert or update or delete
  on public.calendar_events
  for each row
  execute function public.fn_calendar_event_audit();

-- ----------------------------------------------------------------------------
-- 5. Comentários de documentação
-- ----------------------------------------------------------------------------
comment on table public.calendar_event_audit is
  'Trilha de auditoria dos compromissos da agenda. Gerada automaticamente pelo trigger trg_calendar_event_audit.';

comment on column public.calendar_event_audit.changed_fields is
  'Diff de campos em UPDATE: { "campo": { "before": <valor_anterior>, "after": <valor_novo> } }. Nulo para create/delete.';
