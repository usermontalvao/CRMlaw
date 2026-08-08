-- Prazo excluído vira histórico, não sumiço.
--
-- Até aqui "Excluir prazo" era DELETE: a linha saía do banco e o único vestígio
-- ficava no snapshot de audit_log — invisível para quem usa o CRM e recuperável
-- só por SQL. O escritório precisa do contrário: excluir tira o prazo da fila de
-- tarefas e o deposita no Histórico de Prazos, ao lado dos cumpridos, vencidos e
-- cancelados, de onde dá para consultar e restaurar.
--
-- A exclusão passa a ser um ESTADO ('excluido') mais um carimbo (deleted_at).
-- Os dois juntos, e não só a data, porque a falha de quem esquecer de filtrar
-- muda de gravidade: com status próprio um prazo excluído que escape para uma
-- listagem aparece rotulado e nunca é contado como pendente; com apenas
-- deleted_at ele voltaria à tela como "pendente", uma obrigação viva de novo.

alter table public.deadlines
  add column if not exists deleted_at timestamptz;

comment on column public.deadlines.deleted_at is
  'Quando o prazo foi excluído (soft delete). NULL = prazo vivo. Anda junto com status = ''excluido''.';

alter table public.deadlines drop constraint if exists deadlines_status_check;
alter table public.deadlines add constraint deadlines_status_check
  check (status = any (array['pendente'::text, 'cumprido'::text, 'vencido'::text, 'cancelado'::text, 'excluido'::text]));

-- Índice sobre os excluídos (poucos) — é o recorte que o Histórico pede inteiro.
create index if not exists idx_deadlines_deleted_at
  on public.deadlines (deleted_at desc)
  where deleted_at is not null;

-- ── Auditoria: exclusão e restauração ganham nome próprio ────────────────────
-- Sem isto a exclusão viraria um 'deadline_status_changed' genérico na linha do
-- tempo, e a coluna "Baixado por" do histórico ficaria vazia justamente para as
-- linhas novas.
create or replace function public.fn_audit_log_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_user_id   uuid;
  v_user_name text;
  v_entity_id text;
  v_action    text;
  v_old_val   jsonb;
  v_new_val   jsonb;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NOT NULL THEN
    SELECT name INTO v_user_name
    FROM public.profiles
    WHERE user_id = v_user_id
    LIMIT 1;
  END IF;

  -- Colunas volumosas (ex.: processes.notes pode ter MBs) são excluídas do
  -- snapshot de auditoria: inflavam o audit_log sem valor de auditoria real.
  IF TG_OP = 'DELETE' THEN
    v_entity_id := OLD.id::text;
    v_action    := 'delete';
    v_old_val   := to_jsonb(OLD) - 'notes' - 'datajud_cache';
    v_new_val   := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_entity_id := NEW.id::text;
    v_action    := 'insert';
    v_old_val   := NULL;
    v_new_val   := to_jsonb(NEW) - 'notes' - 'datajud_cache';
  ELSE
    v_entity_id := NEW.id::text;
    v_action    := 'update';
    v_old_val   := to_jsonb(OLD) - 'notes' - 'datajud_cache';
    v_new_val   := to_jsonb(NEW) - 'notes' - 'datajud_cache';

    IF TG_TABLE_NAME = 'deadlines' THEN
      v_action := CASE
        WHEN OLD.status IS DISTINCT FROM NEW.status
          AND NEW.status = 'excluido'
          THEN 'deadline_deleted'
        WHEN OLD.status = 'excluido'
          AND NEW.status IS DISTINCT FROM OLD.status
          THEN 'deadline_restored'
        WHEN OLD.status IS DISTINCT FROM NEW.status
          AND NEW.status = 'cumprido'
          THEN 'deadline_completed'
        WHEN OLD.status IS DISTINCT FROM NEW.status
          AND NEW.status = 'cancelado'
          THEN 'deadline_cancelled'
        WHEN OLD.status = 'cumprido'
          AND NEW.status IS DISTINCT FROM OLD.status
          THEN 'deadline_reopened'
        WHEN OLD.due_date IS DISTINCT FROM NEW.due_date
          THEN 'deadline_due_date_changed'
        WHEN OLD.responsible_id IS DISTINCT FROM NEW.responsible_id
          THEN 'deadline_responsible_changed'
        WHEN OLD.status IS DISTINCT FROM NEW.status
          THEN 'deadline_status_changed'
        ELSE 'update'
      END;
    END IF;
  END IF;

  INSERT INTO public.audit_log (
    user_id,
    user_name,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value
  )
  VALUES (
    v_user_id,
    COALESCE(v_user_name, 'system'),
    v_action,
    TG_TABLE_NAME,
    v_entity_id,
    v_old_val,
    v_new_val
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── "Baixado por" também para quem excluiu ───────────────────────────────────
create or replace function public.get_deadline_closures(p_deadline_ids uuid[])
returns table(deadline_id uuid, action text, user_id uuid, user_name text, created_at timestamp with time zone)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not public.is_office_staff() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if p_deadline_ids is null or array_length(p_deadline_ids, 1) is null then
    return;
  end if;

  if array_length(p_deadline_ids, 1) > 1000 then
    raise exception 'too many deadline ids' using errcode = '22023';
  end if;

  return query
    select distinct on (a.entity_id)
      a.entity_id::uuid,
      case
        when a.action <> 'update' then a.action
        when (a.new_value->>'status') = 'cumprido' then 'deadline_completed'
        when (a.new_value->>'status') = 'excluido' then 'deadline_deleted'
        else 'deadline_cancelled'
      end,
      a.user_id,
      a.user_name,
      a.created_at
    from public.audit_log a
    where a.entity_type = 'deadlines'
      and a.entity_id in (select x::text from unnest(p_deadline_ids) as x)
      and (
        a.action in ('deadline_completed', 'deadline_cancelled', 'deadline_deleted')
        or (
          a.action = 'update'
          and (a.new_value->>'status') in ('cumprido', 'cancelado', 'excluido')
          and (a.old_value->>'status') is distinct from (a.new_value->>'status')
        )
      )
    order by a.entity_id, a.created_at desc;
end;
$function$;

create or replace function public.get_deadline_timeline(p_deadline_id uuid)
returns table(id uuid, action text, user_id uuid, user_name text, created_at timestamp with time zone, status_from text, status_to text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not public.is_office_staff() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  return query
    select
      a.id,
      case
        when a.action <> 'update' then a.action
        when (a.new_value->>'status') is not distinct from (a.old_value->>'status') then a.action
        when (a.new_value->>'status') = 'excluido'  then 'deadline_deleted'
        when (a.old_value->>'status') = 'excluido'  then 'deadline_restored'
        when (a.new_value->>'status') = 'cumprido'  then 'deadline_completed'
        when (a.new_value->>'status') = 'cancelado' then 'deadline_cancelled'
        when (a.old_value->>'status') = 'cumprido'  then 'deadline_reopened'
        else 'deadline_status_changed'
      end,
      a.user_id,
      a.user_name,
      a.created_at,
      a.old_value->>'status',
      a.new_value->>'status'
    from public.audit_log a
    where a.entity_type = 'deadlines'
      and a.entity_id = p_deadline_id::text
    order by a.created_at desc
    limit 200;
end;
$function$;

-- ── Portal do cliente não enxerga prazo excluído ─────────────────────────────
-- Estas duas RPCs listam prazos de QUALQUER status; sem o filtro, um prazo que o
-- escritório excluiu continuaria aparecendo para o cliente.
create or replace function public.portal_list_deadlines(p_portal_user_id uuid)
returns setof jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.deadlines') IS NULL THEN RETURN; END IF;

  RETURN QUERY EXECUTE
    'SELECT to_jsonb(d) || jsonb_build_object(
        ''process_code'', (SELECT p.process_code FROM public.processes p WHERE p.id = d.process_id)
     )
     FROM public.deadlines d
     WHERE d.deleted_at IS NULL
       AND (d.client_id = $1
            OR d.process_id IN (SELECT id FROM public.processes WHERE client_id = $1))
     ORDER BY
       CASE WHEN d.status = ''pendente'' THEN 0 ELSE 1 END,
       d.due_date ASC'
    USING v_client_id;
END;
$function$;

create or replace function public.portal_get_process(p_portal_user_id uuid, p_process_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_client_id    uuid    := public._portal_resolve_client(p_portal_user_id);
  v_process      jsonb;
  v_movements    jsonb   := '[]'::jsonb;
  v_deadlines    jsonb   := '[]'::jsonb;
  v_publications jsonb   := '[]'::jsonb;
  v_appointments jsonb   := '[]'::jsonb;
  v_names        text;
  v_raw_status   text;
  v_eff_status   text;
BEGIN
  SELECT to_jsonb(p) INTO v_process
  FROM public.processes p
  WHERE p.id = p_process_id AND p.client_id = v_client_id
  LIMIT 1;

  IF v_process IS NULL THEN
    RETURN NULL;
  END IF;

  IF to_regclass('public.datajud_movimentos') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.data_hora DESC NULLS LAST), '[]'::jsonb),
           string_agg(coalesce(m.nome,''), E'\n')
      INTO v_movements, v_names
    FROM public.datajud_movimentos m
    WHERE m.process_id = p_process_id;
  END IF;

  v_raw_status := v_process->>'status';
  v_eff_status := public._portal_stage_from_names(v_names, v_raw_status);

  IF to_regclass('public.deadlines') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.due_date ASC), '[]'::jsonb)
      INTO v_deadlines
    FROM public.deadlines d
    WHERE d.process_id = p_process_id
      AND d.deleted_at IS NULL;
  END IF;

  IF to_regclass('public.djen_comunicacoes') IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',                   dc.id,
          'data',                 dc.data_disponibilizacao,
          'tipo',                 COALESCE(dc.tipo_documento, dc.tipo_comunicacao, 'Publicação'),
          'orgao',                dc.nome_orgao,
          'texto',                dc.texto,
          'ai_summary',           ia.summary,
          'ai_urgency',           ia.urgency,
          'ai_deadline_days',     ia.deadline_days,
          'ai_deadline_due_date', ia.deadline_due_date
        )
        ORDER BY dc.data_disponibilizacao DESC NULLS LAST
      ),
      '[]'::jsonb
    )
    INTO v_publications
    FROM public.djen_comunicacoes dc
    LEFT JOIN public.intimation_ai_analysis ia ON ia.intimation_id = dc.id
    WHERE dc.process_id = p_process_id
      AND dc.ativo = true;
  END IF;

  IF to_regclass('public.calendar_events') IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',          e.id,
          'title',       e.title,
          'event_type',  e.event_type,
          'event_mode',  e.event_mode,
          'start_at',    e.start_at,
          'end_at',      e.end_at,
          'status',      e.status,
          'description', e.description
        )
        ORDER BY e.start_at ASC
      ),
      '[]'::jsonb
    )
    INTO v_appointments
    FROM public.calendar_events e
    WHERE e.process_id = p_process_id
      AND (e.is_private IS NULL OR e.is_private = false)
      AND e.start_at >= (now() - interval '30 days');
  END IF;

  RETURN v_process || jsonb_build_object(
    'status',       v_eff_status,
    'status_raw',   v_raw_status,
    'movements',    v_movements,
    'deadlines',    v_deadlines,
    'publications', v_publications,
    'appointments', v_appointments
  );
END;
$function$;

create or replace function public.portal_public_stats()
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  SELECT jsonb_build_object(
    'clientes',    (SELECT COUNT(*) FROM clients),
    'processos',   (SELECT COUNT(*) FROM processes),
    'assinaturas', (SELECT COUNT(*) FROM signature_requests),
    'acordos',     (SELECT COUNT(*) FROM agreements),
    'prazos',      (SELECT COUNT(*) FROM deadlines WHERE deleted_at IS NULL)
  );
$function$;
