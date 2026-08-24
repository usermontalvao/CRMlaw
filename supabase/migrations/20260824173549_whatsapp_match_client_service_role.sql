-- Mantém a busca por telefone fechada para o público, mas permite que as
-- Edge Functions (service_role) vinculem assinaturas ao cadastro existente.
CREATE OR REPLACE FUNCTION public.whatsapp_match_client_by_phone(p_phone text)
RETURNS TABLE(
  id uuid,
  full_name text,
  cpf_cnpj text,
  phone text,
  mobile text,
  photo_path text,
  email text,
  status text,
  client_type text,
  address_city text,
  address_state text,
  is_pre_cadastro boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  d10 text;
  d11 text;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     AND NOT public.is_office_staff() THEN
    RETURN;
  END IF;

  IF length(digits) < 8 THEN
    RETURN;
  END IF;

  IF length(digits) >= 12 AND left(digits, 2) = '55' THEN
    digits := substring(digits FROM 3);
  END IF;

  IF length(digits) = 11 AND substring(digits, 3, 1) = '9' THEN
    d11 := digits;
    d10 := left(digits, 2) || substring(digits, 4);
  ELSIF length(digits) = 10 THEN
    d10 := digits;
    d11 := left(digits, 2) || '9' || substring(digits, 3);
  ELSE
    d11 := digits;
    d10 := digits;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.full_name::text,
    c.cpf_cnpj::text,
    c.phone::text,
    c.mobile::text,
    c.photo_path::text,
    c.email::text,
    c.status::text,
    c.client_type::text,
    c.address_city::text,
    c.address_state::text,
    c.is_pre_cadastro
  FROM public.clients c
  WHERE c.status <> 'arquivado'
    AND c.merged_into_client_id IS NULL
    AND (
      regexp_replace(c.phone, '\D', '', 'g') IN (d10, d11, '55' || d10, '55' || d11)
      OR regexp_replace(c.mobile, '\D', '', 'g') IN (d10, d11, '55' || d10, '55' || d11)
    )
  ORDER BY c.full_name
  LIMIT 5;
END;
$function$;

REVOKE ALL ON FUNCTION public.whatsapp_match_client_by_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_match_client_by_phone(text) TO authenticated, service_role;
