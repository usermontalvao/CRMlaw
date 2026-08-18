-- O apelido interno do WhatsApp (LID) ganha um lugar para morar.
--
-- POR QUE. Em 17/08/2026 o escritório ligou para a Lisliandra e desligou; um
-- minuto depois ela ligou de volta e o convite chegou do WaCalls como
-- `252677908865131@lid`. O `@lid` é o LID — um identificador INTERNO que o
-- WhatsApp usa no lugar do telefone. O CRM cortou o `@lid`, tratou os dígitos
-- como número e mostrou "+252677908865131" (Somália) no lugar do nome da
-- cliente. A chamada foi registrada sem cliente e sem conversa.
--
-- Corrigir a leitura resolve o pior (o CRM parou de inventar números), mas
-- deixa um buraco: chegando SÓ o LID, a ligação fica anônima mesmo sendo de
-- alguém conhecido. Este é o mapeamento que fecha o buraco.
--
-- POR QUE UMA COLUNA E NÃO UMA TABELA. O LID é um segundo endereço da MESMA
-- conversa — `remote_jid` e `contact_phone` já são os outros dois. Uma tabela à
-- parte precisaria ser costurada a `whatsapp_conversations` em toda leitura
-- para dizer a única coisa que interessa ("de quem é esta ligação?"), que a
-- conversa já sabe responder.
--
-- DE ONDE O VALOR VEM. Duas fontes, ambas EXATAS — nada aqui é adivinhação:
--   · o webhook da Evolution, quando a mensagem chega endereçada por LID e traz
--     o telefone resolvido em `key.remoteJidAlt`;
--   · a nossa própria chamada de SAÍDA: discamos para um número que sabemos e o
--     WaCalls devolve o `peer` daquela chamada; se ele vier como LID, aquele
--     LID é, por construção, o do número que acabamos de discar.

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS contact_lid text;

COMMENT ON COLUMN public.whatsapp_conversations.contact_lid IS
  'Identificador interno do WhatsApp (LID) deste contato, só dígitos. NÃO é telefone: serve para reconhecer quem está ligando quando o convite chega endereçado por LID.';

-- Parcial: só as conversas que têm LID entram no índice, e é sempre por ele que
-- a consulta entra.
CREATE INDEX IF NOT EXISTS whatsapp_conversations_contact_lid_idx
  ON public.whatsapp_conversations (contact_lid)
  WHERE contact_lid IS NOT NULL;

/**
 * LID → telefone real. Devolve '' (nenhuma linha) quando não há mapeamento.
 *
 * SECURITY DEFINER porque a chamada toca para o escritório INTEIRO e quem
 * atende nem sempre é quem enxerga aquela conversa (a política de leitura de
 * `whatsapp_conversations` é por setor/responsável). Sem isso, a recepcionista
 * veria "número não identificado" numa ligação de cliente antigo só porque a
 * conversa é de outro setor.
 *
 * Devolve SOMENTE o telefone e o nome — nada do conteúdo do atendimento.
 */
CREATE OR REPLACE FUNCTION public.wa_phone_by_lid(p_lid text)
RETURNS TABLE (contact_phone text, contact_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.contact_phone, c.contact_name
    FROM public.whatsapp_conversations c
   WHERE public.is_office_staff()
     AND c.contact_lid = regexp_replace(coalesce(p_lid, ''), '\D', '', 'g')
     AND regexp_replace(coalesce(p_lid, ''), '\D', '', 'g') <> ''
     -- Só telefone de VERDADE sai daqui: 55 + DDD + 8/9 dígitos. Uma conversa
     -- que nasceu com o LID no campo do telefone (defeito antigo) não pode
     -- devolver o LID de volta com cara de número resolvido.
     AND c.contact_phone ~ '^\d{12,13}$'
   ORDER BY c.last_message_at DESC NULLS LAST
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.wa_phone_by_lid(text) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_phone_by_lid(text) TO authenticated;

/**
 * Registra o mapeamento LID → conversa.
 *
 * Entra pelo navegador (o `callStore` aprende o LID da chamada que ELE mesmo
 * discou) e pelo webhook. Idempotente e conservador: só grava quando a conversa
 * tem telefone real, e nunca sobrescreve um LID diferente já registrado sem
 * necessidade — se o WhatsApp trocar o apelido, o mais novo vence.
 */
CREATE OR REPLACE FUNCTION public.wa_link_lid(p_phone text, p_lid text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lid    text := regexp_replace(coalesce(p_lid, ''), '\D', '', 'g');
  v_phone  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_count  integer;
BEGIN
  IF NOT public.is_office_staff() THEN
    RAISE EXCEPTION 'sem permissão para registrar identidade de contato';
  END IF;
  IF v_lid = '' OR v_phone !~ '^\d{12,13}$' THEN RETURN 0; END IF;

  UPDATE public.whatsapp_conversations
     SET contact_lid = v_lid
   WHERE contact_phone = v_phone
     AND contact_lid IS DISTINCT FROM v_lid;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.wa_link_lid(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_link_lid(text, text) TO authenticated;
