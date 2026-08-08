-- As duas consultas de cliente do WhatsApp passam a devolver `is_pre_cadastro`.
-- O painel precisa saber com o que está falando: um pré-cadastro aparece como
-- "Pré-cadastro", não como cliente vinculado. E o casamento por telefone
-- continua achando o pré-cadastro — se a mesma pessoa abrir outra conversa, ela
-- reencontra o próprio histórico em vez de virar um segundo registro.
--
-- Aproveita para excluir das duas o cadastro absorvido numa mesclagem
-- (`merged_into_client_id`): ele já sai da listagem e da busca do módulo
-- Clientes, e vincular uma conversa a um registro esvaziado não leva a lugar
-- nenhum.
drop function if exists public.whatsapp_match_client_by_phone(text);
create function public.whatsapp_match_client_by_phone(p_phone text)
returns table(
  id uuid, full_name text, cpf_cnpj text, phone text, mobile text,
  photo_path text, email text, status text, client_type text,
  address_city text, address_state text, is_pre_cadastro boolean
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE
  digits TEXT := regexp_replace(p_phone, '\D', '', 'g');
  d10    TEXT;
  d11    TEXT;
BEGIN
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
  FROM clients c
  WHERE
    c.status != 'arquivado'
    AND c.merged_into_client_id IS NULL
    AND (
      regexp_replace(c.phone,  '\D', '', 'g') IN (d10, d11, '55'||d10, '55'||d11)
      OR regexp_replace(c.mobile, '\D', '', 'g') IN (d10, d11, '55'||d10, '55'||d11)
    )
  ORDER BY c.full_name
  LIMIT 5;
END;
$function$;

drop function if exists public.whatsapp_search_clients(text);
create function public.whatsapp_search_clients(p_query text)
returns table(
  id uuid, full_name text, cpf_cnpj text, phone text, mobile text,
  photo_path text, email text, status text, client_type text,
  address_city text, address_state text, is_pre_cadastro boolean
)
language sql
stable security definer
set search_path to 'public'
as $function$
  WITH q AS (
    SELECT p_query AS raw, regexp_replace(p_query, '\D', '', 'g') AS digits
  )
  SELECT
    c.id, c.full_name, c.cpf_cnpj, c.phone, c.mobile, c.photo_path,
    c.email, c.status, c.client_type, c.address_city, c.address_state,
    c.is_pre_cadastro
  FROM clients c, q
  WHERE
    c.status != 'arquivado'
    AND c.merged_into_client_id IS NULL
    AND (
      c.full_name ILIKE '%' || q.raw || '%'
      OR (q.digits <> '' AND c.cpf_cnpj ILIKE '%' || q.digits || '%')
      OR (q.digits <> '' AND regexp_replace(c.phone,  '\D', '', 'g') ILIKE '%' || q.digits || '%')
      OR (q.digits <> '' AND regexp_replace(c.mobile, '\D', '', 'g') ILIKE '%' || q.digits || '%')
    )
  ORDER BY c.full_name
  LIMIT 20;
$function$;

grant execute on function public.whatsapp_match_client_by_phone(text) to authenticated;
grant execute on function public.whatsapp_search_clients(text) to authenticated;
