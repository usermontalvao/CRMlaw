-- ============================================================================
-- Notificações do cliente no portal (aprovação/rejeição de cadastro, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.portal_client_notifications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid        NOT NULL,
  type         text        NOT NULL,
  title        text        NOT NULL,
  message      text,
  is_read      boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  metadata     jsonb
);

CREATE INDEX IF NOT EXISTS idx_pcn_client ON public.portal_client_notifications(client_id);
CREATE INDEX IF NOT EXISTS idx_pcn_read   ON public.portal_client_notifications(client_id, is_read);

ALTER TABLE public.portal_client_notifications ENABLE ROW LEVEL SECURITY;

-- ── admin_approve: notifica cliente ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_approve_profile_update(
  p_request_id  uuid,
  p_reviewed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req record;
BEGIN
  SELECT * INTO v_req
    FROM public.portal_profile_update_requests
   WHERE id = p_request_id AND status = 'pending';

  IF v_req IS NULL THEN
    RAISE EXCEPTION 'Solicitação não encontrada ou já processada' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.clients
     SET
       full_name            = COALESCE(v_req.changes->>'full_name',            full_name),
       email                = COALESCE(v_req.changes->>'email',                email),
       phone                = COALESCE(v_req.changes->>'phone',                phone),
       birth_date           = COALESCE((v_req.changes->>'birth_date')::date,   birth_date),
       marital_status       = COALESCE(v_req.changes->>'marital_status',       marital_status),
       profession           = COALESCE(v_req.changes->>'profession',           profession),
       nationality          = COALESCE(v_req.changes->>'nationality',          nationality),
       address_street       = COALESCE(v_req.changes->>'address_street',       address_street),
       address_number       = COALESCE(v_req.changes->>'address_number',       address_number),
       address_neighborhood = COALESCE(v_req.changes->>'address_neighborhood', address_neighborhood),
       address_city         = COALESCE(v_req.changes->>'address_city',         address_city),
       address_state        = COALESCE(v_req.changes->>'address_state',        address_state),
       address_zip_code     = COALESCE(v_req.changes->>'address_zip_code',     address_zip_code)
   WHERE id = v_req.client_id;

  UPDATE public.portal_profile_update_requests
     SET status = 'approved', reviewed_at = now(), reviewed_by = p_reviewed_by
   WHERE id = p_request_id;

  INSERT INTO public.portal_client_notifications (client_id, type, title, message, metadata)
  VALUES (
    v_req.client_id,
    'profile_update_approved',
    'Dados atualizados com sucesso',
    'Sua solicitação de atualização cadastral foi aprovada pelo escritório. Seus dados já estão atualizados.',
    jsonb_build_object('request_id', p_request_id, 'changes', v_req.changes)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── admin_reject: notifica cliente ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reject_profile_update(
  p_request_id  uuid,
  p_reason      text    DEFAULT NULL,
  p_reviewed_by uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req record;
BEGIN
  SELECT * INTO v_req
    FROM public.portal_profile_update_requests
   WHERE id = p_request_id AND status = 'pending';

  IF v_req IS NULL THEN
    RAISE EXCEPTION 'Solicitação não encontrada ou já processada' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.portal_profile_update_requests
     SET status           = 'rejected',
         rejection_reason = p_reason,
         reviewed_at      = now(),
         reviewed_by      = p_reviewed_by
   WHERE id = p_request_id;

  INSERT INTO public.portal_client_notifications (client_id, type, title, message, metadata)
  VALUES (
    v_req.client_id,
    'profile_update_rejected',
    'Solicitação de atualização não aprovada',
    COALESCE(
      'O escritório não pôde aprovar sua solicitação de atualização cadastral.' ||
        CASE WHEN p_reason IS NOT NULL AND p_reason <> '' THEN ' Motivo: ' || p_reason ELSE '' END,
      'O escritório não pôde aprovar sua solicitação de atualização cadastral.'
    ),
    jsonb_build_object('request_id', p_request_id, 'reason', p_reason, 'changes', v_req.changes)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── portal_list_notifications: inclui notificações cadastrais ───────────────
DROP FUNCTION IF EXISTS public.portal_list_notifications(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.portal_list_notifications(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.process_notifications') IS NOT NULL THEN
    RETURN QUERY EXECUTE
      'SELECT to_jsonb(n) || jsonb_build_object(
          ''process_code'', (SELECT p.process_code FROM public.processes p WHERE p.id = n.process_id)
       )
       FROM public.process_notifications n
       WHERE n.process_id IN (SELECT id FROM public.processes WHERE client_id = $1)
       ORDER BY n.created_at DESC LIMIT 50'
      USING v_client_id;
  END IF;

  RETURN QUERY
    SELECT to_jsonb(n)
    FROM public.portal_client_notifications n
    WHERE n.client_id = v_client_id
    ORDER BY n.created_at DESC
    LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_list_notifications(uuid) TO anon, authenticated;
