-- Give critical deadline changes explicit, searchable audit actions without
-- changing the deadline workflow or requiring extra information from users.

CREATE OR REPLACE FUNCTION public.fn_audit_log_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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

  IF TG_OP = 'DELETE' THEN
    v_entity_id := OLD.id::text;
    v_action    := 'delete';
    v_old_val   := to_jsonb(OLD);
    v_new_val   := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_entity_id := NEW.id::text;
    v_action    := 'insert';
    v_old_val   := NULL;
    v_new_val   := to_jsonb(NEW);
  ELSE
    v_entity_id := NEW.id::text;
    v_action    := 'update';
    v_old_val   := to_jsonb(OLD);
    v_new_val   := to_jsonb(NEW);

    IF TG_TABLE_NAME = 'deadlines' THEN
      v_action := CASE
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
