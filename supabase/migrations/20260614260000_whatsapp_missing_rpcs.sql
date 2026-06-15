-- P2.2: RPCs chamadas pelo frontend (client360.ts, WhatsAppModule.tsx)
-- que não tinham definição nas migrations do repositório.

DROP FUNCTION IF EXISTS public.whatsapp_search_clients(TEXT);
DROP FUNCTION IF EXISTS public.whatsapp_match_client_by_phone(TEXT);
DROP FUNCTION IF EXISTS public.whatsapp_dashboard_stats();

-- ── whatsapp_search_clients ───────────────────────────────────────────────────
-- Busca clientes por nome, CPF/CNPJ ou telefone normalizado.
CREATE OR REPLACE FUNCTION public.whatsapp_search_clients(p_query TEXT)
RETURNS TABLE (
  id            UUID,
  full_name     TEXT,
  cpf_cnpj      TEXT,
  phone         TEXT,
  mobile        TEXT,
  photo_path    TEXT,
  email         TEXT,
  status        TEXT,
  client_type   TEXT,
  address_city  TEXT,
  address_state TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id, c.full_name, c.cpf_cnpj, c.phone, c.mobile, c.photo_path,
    c.email, c.status, c.client_type, c.address_city, c.address_state
  FROM clients c
  WHERE
    c.status != 'arquivado'
    AND (
      c.full_name  ILIKE '%' || p_query || '%'
      OR c.cpf_cnpj ILIKE '%' || regexp_replace(p_query, '\D', '', 'g') || '%'
      OR regexp_replace(c.phone,  '\D', '', 'g') ILIKE '%' || regexp_replace(p_query, '\D', '', 'g') || '%'
      OR regexp_replace(c.mobile, '\D', '', 'g') ILIKE '%' || regexp_replace(p_query, '\D', '', 'g') || '%'
    )
  ORDER BY c.full_name
  LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_search_clients(TEXT) TO authenticated;

-- ── whatsapp_match_client_by_phone ────────────────────────────────────────────
-- Encontra clientes cujo telefone normalizado corresponde a variantes do número.
-- Aceita número com/sem código de país (55) e com/sem 9º dígito.
CREATE OR REPLACE FUNCTION public.whatsapp_match_client_by_phone(p_phone TEXT)
RETURNS TABLE (
  id            UUID,
  full_name     TEXT,
  cpf_cnpj      TEXT,
  phone         TEXT,
  mobile        TEXT,
  photo_path    TEXT,
  email         TEXT,
  status        TEXT,
  client_type   TEXT,
  address_city  TEXT,
  address_state TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  digits TEXT := regexp_replace(p_phone, '\D', '', 'g');
  d10    TEXT;
  d11    TEXT;
BEGIN
  IF length(digits) >= 12 AND left(digits, 2) = '55' THEN
    digits := substring(digits FROM 3);
  END IF;
  IF length(digits) = 11 AND substring(digits, 3, 1) = '9' THEN
    d11 := digits; d10 := left(digits, 2) || substring(digits, 4);
  ELSIF length(digits) = 10 THEN
    d10 := digits; d11 := left(digits, 2) || '9' || substring(digits, 3);
  ELSE
    d11 := digits; d10 := digits;
  END IF;
  RETURN QUERY
  SELECT
    c.id, c.full_name, c.cpf_cnpj, c.phone, c.mobile, c.photo_path,
    c.email, c.status, c.client_type, c.address_city, c.address_state
  FROM clients c
  WHERE
    c.status != 'arquivado'
    AND (
      regexp_replace(c.phone,  '\D', '', 'g') IN (d10, d11, '55'||d10, '55'||d11)
      OR regexp_replace(c.mobile, '\D', '', 'g') IN (d10, d11, '55'||d10, '55'||d11)
    )
  ORDER BY c.full_name
  LIMIT 5;
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_match_client_by_phone(TEXT) TO authenticated;

-- ── whatsapp_dashboard_stats ──────────────────────────────────────────────────
-- Métricas agregadas para o painel de atendimento (AttendanceDashboard).
CREATE OR REPLACE FUNCTION public.whatsapp_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_by_status       JSONB;
  v_by_agent        JSONB;
  v_sla_breached    INT;
  v_sla_warning     INT;
  v_unassigned      INT;
  v_opened_today    INT;
  v_closed_today    INT;
  v_msgs_today      INT;
  v_avg_first_resp  NUMERIC;
  v_today_start     TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  SELECT jsonb_object_agg(status, cnt) INTO v_by_status
  FROM (SELECT status, count(*) AS cnt FROM whatsapp_conversations WHERE status IN ('open','pending') GROUP BY status) s;

  SELECT jsonb_agg(row_to_json(t)) INTO v_by_agent
  FROM (
    SELECT COALESCE(p.name,'Sem nome') AS agent_name, count(*) AS total,
      count(*) FILTER (WHERE c.last_message_direction='in'
        AND (c.last_agent_message_at IS NULL OR c.last_agent_message_at < c.last_customer_message_at)) AS waiting_reply
    FROM whatsapp_conversations c
    LEFT JOIN profiles p ON p.id = c.assigned_user_id
    WHERE c.status IN ('open','pending') AND c.assigned_user_id IS NOT NULL
    GROUP BY c.assigned_user_id, p.name ORDER BY total DESC LIMIT 20
  ) t;

  SELECT
    count(*) FILTER (WHERE extract(epoch FROM (now()-last_customer_message_at))/3600 > 4),
    count(*) FILTER (WHERE extract(epoch FROM (now()-last_customer_message_at))/3600 BETWEEN 2 AND 4)
  INTO v_sla_breached, v_sla_warning
  FROM whatsapp_conversations
  WHERE status IN ('open','pending') AND last_customer_message_at IS NOT NULL
    AND (last_agent_message_at IS NULL OR last_agent_message_at < last_customer_message_at);

  SELECT count(*) INTO v_unassigned FROM whatsapp_conversations WHERE status IN ('open','pending') AND assigned_user_id IS NULL;
  SELECT count(*) INTO v_opened_today FROM whatsapp_conversations WHERE created_at >= v_today_start;
  SELECT count(*) INTO v_closed_today FROM whatsapp_conversations WHERE status='closed' AND closed_at >= v_today_start;
  SELECT count(*) INTO v_msgs_today FROM whatsapp_messages WHERE direction='out' AND created_at >= v_today_start;
  SELECT avg(extract(epoch FROM (first_response_at-created_at))/60) INTO v_avg_first_resp
  FROM whatsapp_conversations WHERE first_response_at IS NOT NULL AND created_at >= now()-interval '7 days';

  RETURN jsonb_build_object(
    'by_status',             COALESCE(v_by_status,'{}'::jsonb),
    'by_agent',              COALESCE(v_by_agent,'[]'::jsonb),
    'sla_breached',          COALESCE(v_sla_breached,0),
    'sla_warning',           COALESCE(v_sla_warning,0),
    'unassigned',            COALESCE(v_unassigned,0),
    'opened_today',          COALESCE(v_opened_today,0),
    'closed_today',          COALESCE(v_closed_today,0),
    'messages_sent_today',   COALESCE(v_msgs_today,0),
    'avg_first_response_min',v_avg_first_resp
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_dashboard_stats() TO authenticated;
