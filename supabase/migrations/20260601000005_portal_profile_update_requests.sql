-- ============================================================================
-- Portal do Cliente — Solicitações de atualização cadastral
-- O cliente edita os dados no portal; a alteração fica pendente até o
-- administrador aprovar ou rejeitar.
-- ============================================================================

-- Limpa versões anteriores desta migration (idempotente)
DROP FUNCTION IF EXISTS public.portal_get_profile(uuid)                          CASCADE;
DROP FUNCTION IF EXISTS public.portal_request_profile_update(uuid, jsonb)        CASCADE;
DROP FUNCTION IF EXISTS public.portal_list_profile_requests(uuid)                CASCADE;
DROP FUNCTION IF EXISTS public.admin_list_profile_update_requests(uuid, text)    CASCADE;
DROP FUNCTION IF EXISTS public.admin_approve_profile_update(uuid, uuid)          CASCADE;
DROP FUNCTION IF EXISTS public.admin_reject_profile_update(uuid, text, uuid)     CASCADE;

-- ----------------------------------------------------------------------------
-- Tabela de solicitações
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portal_profile_update_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid NOT NULL REFERENCES public.client_portal_users(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL,
  changes        jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at    timestamptz,
  reviewed_by    uuid
);

CREATE INDEX IF NOT EXISTS idx_ppuq_portal_user ON public.portal_profile_update_requests(portal_user_id);
CREATE INDEX IF NOT EXISTS idx_ppuq_client     ON public.portal_profile_update_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_ppuq_status     ON public.portal_profile_update_requests(status);

ALTER TABLE public.portal_profile_update_requests ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- RPC: perfil completo do cliente (campos editáveis pelo portal)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_get_profile(p_portal_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
  v_row record;
BEGIN
  SELECT
    full_name, email, phone,
    birth_date, marital_status, profession, nationality,
    address_street, address_number, address_neighborhood,
    address_city, address_state, address_zip_code
  INTO v_row
  FROM public.clients
  WHERE id = v_client_id;

  RETURN jsonb_build_object(
    'full_name',              v_row.full_name,
    'email',                  v_row.email,
    'phone',                  v_row.phone,
    'birth_date',             v_row.birth_date,
    'marital_status',         v_row.marital_status,
    'profession',             v_row.profession,
    'nationality',            v_row.nationality,
    'address_street',         v_row.address_street,
    'address_number',         v_row.address_number,
    'address_neighborhood',   v_row.address_neighborhood,
    'address_city',           v_row.address_city,
    'address_state',          v_row.address_state,
    'address_zip_code',       v_row.address_zip_code
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC: cliente solicita atualização
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_request_profile_update(
  p_portal_user_id uuid,
  p_changes        jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
  v_allowed   text[] := ARRAY[
    'full_name','email','phone',
    'birth_date','marital_status','profession','nationality',
    'address_street','address_number','address_neighborhood',
    'address_city','address_state','address_zip_code'
  ];
  v_clean     jsonb := '{}';
  v_key       text;
  v_new_id    uuid;
BEGIN
  -- Remove chaves não permitidas (segurança)
  FOREACH v_key IN ARRAY v_allowed LOOP
    IF p_changes ? v_key THEN
      v_clean := v_clean || jsonb_build_object(v_key, p_changes->>v_key);
    END IF;
  END LOOP;

  IF v_clean = '{}' THEN
    RAISE EXCEPTION 'Nenhuma alteração informada' USING ERRCODE = 'P0001';
  END IF;

  -- Cancela pedidos pendentes anteriores
  UPDATE public.portal_profile_update_requests
     SET status = 'rejected',
         rejection_reason = 'Substituída por nova solicitação',
         reviewed_at = now()
   WHERE portal_user_id = p_portal_user_id AND status = 'pending';

  INSERT INTO public.portal_profile_update_requests (portal_user_id, client_id, changes)
  VALUES (p_portal_user_id, v_client_id, v_clean)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('id', v_new_id, 'status', 'pending');
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC: cliente lista suas solicitações (últimas 5)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_profile_requests(p_portal_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  RETURN (
    SELECT coalesce(jsonb_agg(row_to_json(r) ORDER BY r.requested_at DESC), '[]')
    FROM (
      SELECT id, changes, status, rejection_reason, requested_at, reviewed_at
        FROM public.portal_profile_update_requests
       WHERE portal_user_id = p_portal_user_id
       ORDER BY requested_at DESC
       LIMIT 5
    ) r
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC admin: lista solicitações (por cliente ou todas pendentes)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_profile_update_requests(
  p_client_id uuid DEFAULT NULL,
  p_status    text DEFAULT 'pending'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT coalesce(jsonb_agg(row_to_json(r) ORDER BY r.requested_at DESC), '[]')
    FROM (
      SELECT req.id, req.client_id, req.changes, req.status,
             req.rejection_reason, req.requested_at, req.reviewed_at,
             c.full_name AS client_name,
             regexp_replace(coalesce(c.cpf_cnpj,''), '\D','','g') AS client_cpf
        FROM public.portal_profile_update_requests req
        JOIN public.clients c ON c.id = req.client_id
       WHERE (p_client_id IS NULL OR req.client_id = p_client_id)
         AND (p_status    IS NULL OR req.status    = p_status)
       ORDER BY req.requested_at DESC
       LIMIT 100
    ) r
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC admin: aprovar e aplicar
-- ----------------------------------------------------------------------------
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

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC admin: rejeitar
-- ----------------------------------------------------------------------------
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
BEGIN
  UPDATE public.portal_profile_update_requests
     SET status           = 'rejected',
         rejection_reason = p_reason,
         reviewed_at      = now(),
         reviewed_by      = p_reviewed_by
   WHERE id = p_request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada ou já processada' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
