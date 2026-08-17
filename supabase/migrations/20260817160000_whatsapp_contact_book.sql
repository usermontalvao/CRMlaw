-- A agenda da "Nova conversa".
--
-- O painel novo imita a tela de novo contato do WhatsApp: a lista abre pronta,
-- separada por letra. Para isso a consulta precisa entregar a agenda INTEIRA de
-- uma vez, e não os 20 primeiros de uma busca (`whatsapp_search_clients`, que
-- continua servindo o vínculo de cliente à conversa).
--
-- Duas coisas acontecem aqui e não no navegador, porque em SQL saem de graça:
--
--  1. UMA LINHA POR NÚMERO. O WhatsApp lista números, não pessoas: quem tem
--     celular e fixo aparece duas vezes, e clicar já é escolher por onde falar.
--     No navegador isso significaria expandir e desduplicar a lista a cada
--     render.
--
--  2. A FOTO. O cadastro quase nunca tem retrato, mas o próprio WhatsApp já
--     mandou a foto de perfil de quem o escritório atendeu — ela está em
--     `whatsapp_conversations.contact_avatar_path`. Casando pelos 8 últimos
--     dígitos (a mesma tolerância que o módulo usa para o nono dígito), a
--     agenda nasce com rosto de verdade em vez de iniciais.

CREATE OR REPLACE FUNCTION public.whatsapp_contact_book()
RETURNS TABLE (
  client_id       uuid,
  full_name       text,
  cpf_cnpj        text,
  phone           text,     -- só dígitos
  phone_kind      text,     -- 'mobile' | 'phone'
  photo_path      text,     -- retrato do cadastro
  wa_avatar_path  text,     -- foto de perfil vinda do WhatsApp
  is_pre_cadastro boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Trava de quem pode: `authenticated` inclui o CLIENTE logado no portal, e
  -- esta função devolve a agenda inteira do escritório de uma vez — coisa que
  -- as buscas existentes não fazem porque devolvem no máximo 20 linhas do que
  -- foi procurado. Sem gente do escritório do outro lado, a agenda sai vazia.
  WITH permitido AS (SELECT public.is_office_staff() AS ok),
  numeros AS (
    SELECT c.id, c.full_name, c.cpf_cnpj, c.photo_path, c.is_pre_cadastro,
           t.kind,
           regexp_replace(t.raw, '\D', '', 'g') AS digitos
      FROM clients c, permitido p
      CROSS JOIN LATERAL (VALUES (c.mobile, 'mobile'), (c.phone, 'phone')) AS t(raw, kind)
     WHERE p.ok
       AND c.status <> 'arquivado'
       AND c.merged_into_client_id IS NULL
       AND t.raw IS NOT NULL
  ),
  -- Celular e fixo iguais viram uma linha só. 'mobile' < 'phone' na ordenação,
  -- então quando os dois campos têm o mesmo número quem sobra é o celular.
  unicos AS (
    SELECT DISTINCT ON (id, digitos) *
      FROM numeros
     WHERE length(digitos) >= 10
     ORDER BY id, digitos, kind
  )
  SELECT u.id, u.full_name, u.cpf_cnpj, u.digitos, u.kind, u.photo_path,
         (SELECT w.contact_avatar_path
            FROM whatsapp_conversations w
           WHERE w.contact_avatar_path IS NOT NULL
             AND right(regexp_replace(w.contact_phone, '\D', '', 'g'), 8) = right(u.digitos, 8)
           ORDER BY w.last_message_at DESC NULLS LAST
           LIMIT 1),
         u.is_pre_cadastro
    FROM unicos u
   ORDER BY u.full_name, u.kind;
$$;

COMMENT ON FUNCTION public.whatsapp_contact_book() IS
  'Agenda completa da Nova conversa: uma linha por número de cliente ativo, em ordem alfabética, já com a foto de perfil que o WhatsApp mandou para aquele número.';

REVOKE ALL ON FUNCTION public.whatsapp_contact_book() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_contact_book() TO authenticated;
