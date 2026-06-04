-- ============================================================================
-- Portal do Cliente — estado persistido de notificações + deduplicação
-- ============================================================================

ALTER TABLE public.client_portal_users
  ADD COLUMN IF NOT EXISTS notifications_last_seen_at timestamptz;

UPDATE public.client_portal_users
   SET notifications_last_seen_at = COALESCE(notifications_last_seen_at, last_login_at, now())
 WHERE notifications_last_seen_at IS NULL;

ALTER TABLE public.portal_client_notifications
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

ALTER TABLE public.portal_client_notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text;

UPDATE public.portal_client_notifications
   SET read_at = COALESCE(read_at, created_at, now())
 WHERE is_read = true
   AND read_at IS NULL;

CREATE OR REPLACE FUNCTION public._portal_notification_dedupe_key(
  p_type text,
  p_metadata jsonb DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_metadata->>'dedupe_key', '') <> '' THEN p_metadata->>'dedupe_key'
    WHEN p_type IN ('profile_update_approved', 'profile_update_rejected')
      AND COALESCE(p_metadata->>'request_id', '') <> ''
      THEN p_metadata->>'request_id'
    WHEN p_type = 'new_document_request'
      AND COALESCE(p_metadata->>'request_id', '') <> ''
      THEN p_metadata->>'request_id'
    WHEN p_type IN ('document_upload_approved', 'document_upload_rejected')
      AND COALESCE(p_metadata->>'upload_id', '') <> ''
      THEN p_metadata->>'upload_id'
    WHEN p_type IN ('document_upload_approved', 'document_upload_rejected')
      AND COALESCE(p_metadata->>'request_item_id', '') <> ''
      THEN p_metadata->>'request_item_id'
    WHEN p_type = 'new_signature_request'
      AND COALESCE(p_metadata->>'signature_request_id', '') <> ''
      THEN p_metadata->>'signature_request_id'
    WHEN p_type = 'new_agreement'
      AND COALESCE(p_metadata->>'agreement_id', '') <> ''
      THEN p_metadata->>'agreement_id'
    WHEN p_type = 'process_status_changed'
      AND COALESCE(p_metadata->>'process_id', '') <> ''
      AND COALESCE(p_metadata->>'status', '') <> ''
      THEN concat_ws(':', p_metadata->>'process_id', p_metadata->>'status')
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.tg_portal_client_notifications_prepare()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_at IS NULL THEN
    NEW.created_at := now();
  END IF;

  NEW.is_read := COALESCE(NEW.is_read, false);

  IF NEW.dedupe_key IS NULL OR btrim(NEW.dedupe_key) = '' THEN
    NEW.dedupe_key := public._portal_notification_dedupe_key(NEW.type, NEW.metadata);
  END IF;

  IF NEW.read_at IS NOT NULL THEN
    NEW.is_read := true;
  ELSIF NEW.is_read THEN
    NEW.read_at := COALESCE(NEW.created_at, now());
  END IF;

  IF TG_OP = 'INSERT'
     AND NEW.dedupe_key IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.portal_client_notifications existing
        WHERE existing.client_id = NEW.client_id
          AND existing.type = NEW.type
          AND existing.dedupe_key = NEW.dedupe_key
     ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_client_notifications_prepare ON public.portal_client_notifications;
CREATE TRIGGER trg_portal_client_notifications_prepare
  BEFORE INSERT OR UPDATE ON public.portal_client_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_portal_client_notifications_prepare();

UPDATE public.portal_client_notifications
   SET dedupe_key = public._portal_notification_dedupe_key(type, metadata)
 WHERE dedupe_key IS NULL;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY client_id, type, dedupe_key
           ORDER BY created_at DESC, id DESC
         ) AS rn
    FROM public.portal_client_notifications
   WHERE dedupe_key IS NOT NULL
)
DELETE FROM public.portal_client_notifications p
USING ranked r
WHERE p.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_client_notifications_client_type_dedupe
  ON public.portal_client_notifications (client_id, type, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pcn_client_created
  ON public.portal_client_notifications (client_id, created_at DESC);

CREATE OR REPLACE FUNCTION public._portal_notify_client(
  p_client_id  uuid,
  p_type       text,
  p_title      text,
  p_message    text,
  p_metadata   jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.client_portal_users
     WHERE client_id = p_client_id
       AND is_active = true
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.portal_client_notifications (
    client_id,
    type,
    title,
    message,
    metadata,
    dedupe_key
  )
  VALUES (
    p_client_id,
    p_type,
    p_title,
    p_message,
    p_metadata,
    public._portal_notification_dedupe_key(p_type, p_metadata)
  )
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_mark_notifications_seen(
  p_portal_user_id uuid,
  p_seen_at timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seen_at timestamptz := COALESCE(p_seen_at, now());
BEGIN
  UPDATE public.client_portal_users
     SET notifications_last_seen_at = GREATEST(
       COALESCE(notifications_last_seen_at, '-infinity'::timestamptz),
       v_seen_at
     )
   WHERE id = p_portal_user_id
     AND is_active = true;

  RETURN v_seen_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_mark_notification_read(
  p_portal_user_id uuid,
  p_notification_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
  v_now timestamptz := now();
BEGIN
  UPDATE public.portal_client_notifications
     SET is_read = true,
         read_at = COALESCE(read_at, v_now)
   WHERE id = p_notification_id
     AND client_id = v_client_id;

  UPDATE public.process_notifications
     SET read_at = COALESCE(read_at, v_now)
   WHERE id = p_notification_id
     AND read_at IS NULL
     AND process_id IN (
       SELECT id FROM public.processes WHERE client_id = v_client_id
     );

  PERFORM public.portal_mark_notifications_seen(p_portal_user_id, v_now);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_mark_all_notifications_read(
  p_portal_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
  v_now timestamptz := now();
BEGIN
  UPDATE public.portal_client_notifications
     SET is_read = true,
         read_at = COALESCE(read_at, v_now)
   WHERE client_id = v_client_id
     AND is_read = false;

  UPDATE public.process_notifications
     SET read_at = COALESCE(read_at, v_now)
   WHERE read_at IS NULL
     AND process_id IN (
       SELECT id FROM public.processes WHERE client_id = v_client_id
     );

  PERFORM public.portal_mark_notifications_seen(p_portal_user_id, v_now);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_login(p_cpf text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_pwd text := regexp_replace(coalesce(p_password, ''), '\D', '', 'g');
  v_client record;
  v_phone_last4 text;
  v_user record;
BEGIN
  IF length(v_cpf) <> 11 OR length(v_pwd) <> 4 THEN
    RAISE EXCEPTION 'CPF ou senha inválidos' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, full_name, email, phone, cpf_cnpj, photo_path
    INTO v_client
  FROM public.clients
  WHERE regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') = v_cpf
  LIMIT 1;

  IF v_client IS NULL THEN
    RAISE EXCEPTION 'CPF não cadastrado' USING ERRCODE = 'P0001';
  END IF;

  v_phone_last4 := right(regexp_replace(coalesce(v_client.phone, ''), '\D', '', 'g'), 4);
  IF v_phone_last4 IS NULL OR length(v_phone_last4) <> 4 OR v_phone_last4 <> v_pwd THEN
    RAISE EXCEPTION 'Senha incorreta. Use os 4 últimos dígitos do seu telefone.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_user
    FROM public.client_portal_users
   WHERE client_id = v_client.id
   LIMIT 1;

  IF v_user IS NULL THEN
    INSERT INTO public.client_portal_users (
      client_id,
      cpf,
      email,
      phone,
      is_active,
      last_login_at,
      notifications_last_seen_at,
      created_at,
      updated_at
    )
    VALUES (
      v_client.id,
      v_cpf,
      v_client.email,
      v_client.phone,
      true,
      now(),
      now(),
      now(),
      now()
    )
    RETURNING * INTO v_user;
  ELSE
    UPDATE public.client_portal_users
       SET cpf = v_cpf,
           email = COALESCE(v_client.email, email),
           phone = COALESCE(v_client.phone, phone),
           is_active = true,
           last_login_at = now(),
           notifications_last_seen_at = COALESCE(notifications_last_seen_at, now()),
           updated_at = now()
     WHERE id = v_user.id
     RETURNING * INTO v_user;
  END IF;

  RETURN jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_user.id,
      'client_id', v_user.client_id,
      'auth_user_id', v_user.auth_user_id,
      'cpf', v_user.cpf,
      'email', v_user.email,
      'phone', v_user.phone,
      'is_active', v_user.is_active,
      'last_login_at', v_user.last_login_at,
      'notifications_last_seen_at', v_user.notifications_last_seen_at,
      'created_at', v_user.created_at,
      'updated_at', v_user.updated_at
    ),
    'client', jsonb_build_object(
      'id', v_client.id,
      'nome', v_client.full_name,
      'email', v_client.email,
      'telefone', v_client.phone,
      'photo_path', v_client.photo_path
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_mark_notifications_seen(uuid, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_mark_notification_read(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_mark_all_notifications_read(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_login(text, text) TO anon, authenticated;

