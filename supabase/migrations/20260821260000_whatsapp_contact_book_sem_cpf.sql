-- ============================================================================
-- A agenda da "Nova conversa" para de carregar CPF/CNPJ.
--
-- Abrir o painel trazia a base inteira de clientes para o navegador com nome,
-- telefone E documento — e pintava o documento em cada linha da lista, que fica
-- aberta na tela enquanto se escolhe com quem falar.
--
-- Para COMEÇAR uma conversa basta o telefone. O CPF nunca foi necessário ali:
-- era um campo a mais de busca, e um campo a mais na tela de quem passa atrás
-- da cadeira. A ficha do cliente e o painel de vínculo continuam mostrando o
-- documento, onde ele é o assunto e a consulta é de UM cliente por vez.
--
-- A lista continua abrindo de uma vez, sem esperar o usuário digitar: isso é
-- decisão de UX documentada em `newConversationPanel.tsx` ("a agenda é buscada
-- UMA VEZ, na abertura"), e o que estava errado não era a lista — era o que ela
-- carregava.
--
-- A assinatura muda (uma coluna a menos), então é DROP + CREATE: o
-- CREATE OR REPLACE não altera o tipo de retorno.
-- ============================================================================
DROP FUNCTION IF EXISTS public.whatsapp_contact_book();

CREATE FUNCTION public.whatsapp_contact_book()
RETURNS TABLE(client_id uuid, full_name text, phone text,
              phone_kind text, photo_path text, wa_avatar_path text,
              is_pre_cadastro boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH permitido AS (SELECT public.is_office_staff() AS ok),
  numeros AS (
    SELECT c.id, c.full_name, c.photo_path, c.is_pre_cadastro,
           t.kind,
           regexp_replace(t.raw, '\D', '', 'g') AS digitos
      FROM clients c, permitido p
      CROSS JOIN LATERAL (VALUES (c.mobile, 'mobile'), (c.phone, 'phone')) AS t(raw, kind)
     WHERE p.ok
       AND c.status <> 'arquivado'
       AND c.merged_into_client_id IS NULL
       AND t.raw IS NOT NULL
  ),
  unicos AS (
    SELECT DISTINCT ON (id, digitos) *
      FROM numeros
     WHERE length(digitos) >= 10
     ORDER BY id, digitos, kind
  )
  SELECT u.id, u.full_name, u.digitos, u.kind, u.photo_path,
         (SELECT w.contact_avatar_path
            FROM whatsapp_conversations w
           WHERE w.contact_avatar_path IS NOT NULL
             AND right(regexp_replace(w.contact_phone, '\D', '', 'g'), 8) = right(u.digitos, 8)
             AND public.wa_can_see_conv(w.instance_id, w.department_id, w.assigned_user_id, w.id)
           ORDER BY w.last_message_at DESC NULLS LAST
           LIMIT 1),
         u.is_pre_cadastro
    FROM unicos u
   ORDER BY u.full_name, u.kind;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_contact_book() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_contact_book() TO authenticated, service_role;

COMMENT ON FUNCTION public.whatsapp_contact_book() IS
  'Agenda da Nova conversa: um registro por NÚMERO. Sem CPF/CNPJ — para começar uma conversa basta o telefone.';
