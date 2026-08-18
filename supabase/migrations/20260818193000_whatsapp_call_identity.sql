-- QUEM ESTÁ LIGANDO — os dois caminhos que faltavam.
--
-- O cartão da chamada recebida escrevia "Número não identificado" em duas
-- situações que o CRM tinha como responder e não respondia:
--
--  1. A CONVERSA QUE MORA NO LID. Um convite endereçado por `<n>@lid` só era
--     reconhecido quando o mapeamento devolvia um TELEFONE válido
--     (`wa_phone_by_lid` exige `^\d{12,13}$`). A conversa que nasceu pelo LID —
--     `remote_jid = '<n>@lid'`, sem telefone no cadastro dela — não devolvia
--     nada, mesmo tendo nome, foto e cliente vinculado ali dentro. Ou seja: o
--     CRM sabia de quem era a ligação e dizia que não sabia.
--
--  2. O CLIENTE SEM CONVERSA. Quem tem ficha no escritório mas nunca trocou
--     mensagem pelo WhatsApp não tem linha em `whatsapp_conversations`, e a
--     identificação da chamada entrava SÓ por lá. O telefone aparecia na tela
--     e o nome do cliente, que está a uma consulta de distância, não.
--
-- A FUNÇÃO NOVA É SECURITY DEFINER, como a `wa_phone_by_lid`, e pelo mesmo motivo:
-- a chamada toca para o escritório INTEIRO e quem atende nem sempre é quem
-- enxerga aquela conversa (a leitura de `whatsapp_conversations` é por setor).
-- Sem isso, a recepcionista veria "número não identificado" numa ligação de
-- cliente antigo só porque a conversa é de outro setor. Sai daqui apenas o que
-- o cartão da chamada precisa mostrar — identidade e roteamento, nada do
-- conteúdo do atendimento.

/**
 * A conversa por trás de um LID — identidade completa, não só o telefone.
 *
 * Entra pelas duas formas que o apelido aparece na tabela: a coluna
 * `contact_lid` (aprendida da nossa própria chamada de saída ou do webhook) e o
 * `remote_jid` da conversa que NASCEU endereçada por LID. O telefone vai junto
 * quando existir e for telefone de verdade — uma conversa que guardou o LID no
 * campo do telefone (defeito antigo) não pode devolvê-lo com cara de número.
 */
CREATE OR REPLACE FUNCTION public.wa_contact_by_lid(p_lid text)
RETURNS TABLE (
  conversation_id uuid,
  contact_phone text,
  contact_name text,
  contact_avatar_path text,
  client_id uuid,
  assigned_user_id uuid,
  instance_id uuid,
  is_blocked boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lid AS (
    SELECT regexp_replace(coalesce(p_lid, ''), '\D', '', 'g') AS digits
  )
  SELECT
    c.id,
    CASE WHEN c.contact_phone ~ '^\d{12,13}$' THEN c.contact_phone ELSE '' END,
    c.contact_name,
    c.contact_avatar_path,
    c.client_id,
    c.assigned_user_id,
    c.instance_id,
    coalesce(c.is_blocked, false)
  FROM public.whatsapp_conversations c, lid
  WHERE public.is_office_staff()
    AND lid.digits <> ''
    AND (c.contact_lid = lid.digits OR c.remote_jid = lid.digits || '@lid')
  -- A conversa que SABE quem é vem primeiro. Duas linhas podem casar com o
  -- mesmo apelido: a que nasceu por LID (sem nome, sem cliente, telefone
  -- inválido — defeito antigo) e a de verdade, que aprendeu o LID depois.
  -- Ordenar só pela data mais recente devolveria justamente a vazia.
  ORDER BY (c.client_id IS NOT NULL) DESC,
           (nullif(btrim(coalesce(c.contact_name, '')), '') IS NOT NULL) DESC,
           (c.contact_phone ~ '^\d{12,13}$') DESC,
           c.last_message_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.wa_contact_by_lid(text) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_contact_by_lid(text) TO authenticated;

-- O CLIENTE SEM CONVERSA NÃO GANHOU FUNÇÃO NOVA: `whatsapp_match_client_by_phone`
-- já responde essa pergunta melhor do que uma função nova responderia (trata o
-- nono dígito, olha `phone` E `mobile`, ignora arquivado e mesclado, e ainda
-- devolve a foto da ficha). O que faltava era o cartão da chamada PERGUNTAR —
-- ver `resolveIncomingRoute` em `services/wacalls/callStore.ts`.
