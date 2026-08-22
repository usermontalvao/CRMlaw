-- ============================================================================
-- Busca de cliente: o papel ANÔNIMO perde a chave.
--
-- O QUE ESTAVA ERRADO
-- -------------------
-- `whatsapp_search_clients` e `whatsapp_match_client_by_phone` são
-- SECURITY DEFINER — elas leem `clients` por baixo da RLS de propósito, porque
-- a inbox precisa casar telefone com cadastro antes de saber de quem é a
-- conversa. O que não podia é o GRANT: as duas estavam executáveis por `anon`.
--
-- `anon` não é "ninguém": é a chave publicável, que vai inteira no bundle do
-- navegador e está em qualquer aba de DevTools. Uma chamada direta ao
-- PostgREST devolvia nome, CPF/CNPJ, telefone, celular, e-mail, cidade, estado
-- e status — 20 linhas por vez na busca, 5 no casamento por telefone — sem
-- sessão nenhuma. Com `p_query` de uma letra, varrer o alfabeto raspa a base.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
-- Duas travas, porque uma só não basta:
--
--   1. o GRANT sai de `anon` e de `public` (quem chama é o navegador do
--      escritório, autenticado, e as Edge Functions com service role — nenhum
--      dos dois perde nada);
--   2. o corpo passa a exigir `is_office_staff()`. Se um GRANT for reposto por
--      engano numa migration futura, a função continua devolvendo vazio.
--
-- O piso de 2 caracteres é o mesmo que `client360Api.searchClients` já aplica
-- na tela: agora ele vale também para quem chama a RPC por fora, e mata a
-- varredura por letra única (e a busca com texto vazio, que hoje casa com
-- `ILIKE '%%'` e devolve as 20 primeiras da base).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.whatsapp_search_clients(p_query text)
RETURNS TABLE(id uuid, full_name text, cpf_cnpj text, phone text, mobile text,
              photo_path text, email text, status text, client_type text,
              address_city text, address_state text, is_pre_cadastro boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH q AS (
    SELECT btrim(coalesce(p_query, '')) AS raw,
           regexp_replace(coalesce(p_query, ''), '\D', '', 'g') AS digits
  )
  SELECT
    c.id, c.full_name, c.cpf_cnpj, c.phone, c.mobile, c.photo_path,
    c.email, c.status, c.client_type, c.address_city, c.address_state,
    c.is_pre_cadastro
  FROM clients c, q
  WHERE
    public.is_office_staff()
    AND length(q.raw) >= 2
    AND c.status != 'arquivado'
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

CREATE OR REPLACE FUNCTION public.whatsapp_match_client_by_phone(p_phone text)
RETURNS TABLE(id uuid, full_name text, cpf_cnpj text, phone text, mobile text,
              photo_path text, email text, status text, client_type text,
              address_city text, address_state text, is_pre_cadastro boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  digits TEXT := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  d10    TEXT;
  d11    TEXT;
BEGIN
  -- A trava vem antes de tudo: sem sessão do escritório, não há resposta.
  IF NOT public.is_office_staff() THEN RETURN; END IF;
  IF length(digits) < 8 THEN RETURN; END IF;

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
    c.id, c.full_name::text, c.cpf_cnpj::text, c.phone::text, c.mobile::text,
    c.photo_path::text, c.email::text, c.status::text, c.client_type::text,
    c.address_city::text, c.address_state::text, c.is_pre_cadastro
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

REVOKE EXECUTE ON FUNCTION public.whatsapp_search_clients(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.whatsapp_match_client_by_phone(text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.whatsapp_search_clients(text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.whatsapp_match_client_by_phone(text) TO authenticated, service_role;

-- ── As demais RPCs do WhatsApp que o papel anônimo alcançava ────────────────
-- Nenhuma delas é chamada sem sessão: o navegador do escritório chama
-- autenticado e as Edge Functions chamam com service role (que não perde
-- GRANT nenhum aqui). Ficavam abertas por herança do GRANT padrão a `public`.
DO $revoke$
DECLARE
  v_sig text;
BEGIN
  FOR v_sig IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.proname IN (
         'wa_contact_by_lid', 'wa_phone_by_lid', 'wa_lid_from_callback',
         'wa_link_lid', 'wa_log_call', 'wa_resolve_call_lids',
         'wa_delete_call_recording', 'wa_seed_business_hours'
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, public', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_sig);
  END LOOP;
END
$revoke$;

COMMENT ON FUNCTION public.whatsapp_search_clients(text) IS
  'Busca de cliente da inbox. SECURITY DEFINER, mas só responde a is_office_staff() e a partir de 2 caracteres.';
COMMENT ON FUNCTION public.whatsapp_match_client_by_phone(text) IS
  'Casa telefone com cadastro (tolera o nono dígito). SECURITY DEFINER, só responde a is_office_staff().';
