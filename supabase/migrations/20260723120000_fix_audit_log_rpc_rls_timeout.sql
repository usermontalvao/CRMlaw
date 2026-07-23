-- The audit_log SELECT policy adds is_office_staff() as an RLS security
-- barrier. For authenticated calls that barrier prevents PostgreSQL from
-- combining the entity_id and new_value->>'client_id' indexes, producing a
-- sequential scan over several GB of toasted JSONB.
--
-- These RPCs perform the authorization check explicitly and then run with the
-- function owner's privileges so the indexed plan is available. Execution is
-- restricted to authenticated users.

CREATE OR REPLACE FUNCTION public.search_audit_log(
  p_action text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_user_name text DEFAULT NULL,
  p_client_id text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS SETOF public.audit_log
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_where text := ' where true';
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_office_staff() THEN
    RAISE EXCEPTION 'access denied'
      USING ERRCODE = '42501';
  END IF;

  IF p_action IS NOT NULL THEN
    v_where := v_where || format(' and action = %L', p_action);
  END IF;
  IF p_entity_type IS NOT NULL THEN
    v_where := v_where || format(' and entity_type = %L', p_entity_type);
  END IF;
  IF p_user_name IS NOT NULL THEN
    v_where := v_where || format(' and user_name ilike %L', '%' || p_user_name || '%');
  END IF;
  IF p_client_id IS NOT NULL THEN
    v_where := v_where || format(
      ' and (entity_id = %L or (new_value->>''client_id'') = %L)',
      p_client_id,
      p_client_id
    );
  END IF;
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || format(' and created_at >= %L', p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || format(' and created_at <= %L', p_date_to);
  END IF;

  RETURN QUERY EXECUTE
    'select * from public.audit_log' || v_where ||
    format(
      ' order by created_at desc limit %s offset %s',
      least(greatest(coalesce(p_limit, 25), 0), 1000),
      greatest(coalesce(p_offset, 0), 0)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_audit_log(
  p_action text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_user_name text DEFAULT NULL,
  p_client_id text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_where text := ' where true';
  v_count bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_office_staff() THEN
    RAISE EXCEPTION 'access denied'
      USING ERRCODE = '42501';
  END IF;

  IF p_action IS NOT NULL THEN
    v_where := v_where || format(' and action = %L', p_action);
  END IF;
  IF p_entity_type IS NOT NULL THEN
    v_where := v_where || format(' and entity_type = %L', p_entity_type);
  END IF;
  IF p_user_name IS NOT NULL THEN
    v_where := v_where || format(' and user_name ilike %L', '%' || p_user_name || '%');
  END IF;
  IF p_client_id IS NOT NULL THEN
    v_where := v_where || format(
      ' and (entity_id = %L or (new_value->>''client_id'') = %L)',
      p_client_id,
      p_client_id
    );
  END IF;
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || format(' and created_at >= %L', p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || format(' and created_at <= %L', p_date_to);
  END IF;

  EXECUTE 'select count(*)::bigint from public.audit_log' || v_where
    INTO v_count;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_audit_log(
  text, text, text, text, timestamptz, timestamptz, integer, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_audit_log(
  text, text, text, text, timestamptz, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.search_audit_log(
  text, text, text, text, timestamptz, timestamptz, integer, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_audit_log(
  text, text, text, text, timestamptz, timestamptz
) TO authenticated;
