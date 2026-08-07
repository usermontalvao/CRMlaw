-- Quem pode ouvir `email:changes` e `petitions:changes`: equipe interna ATIVA.
--
-- Corretiva de 20260805223000_broadcast_email_and_petitions.sql (aplicada; ver
-- supabase/migrations/README.md para o mapa de versões). Aquela migration segue
-- intacta — o que muda vem por DROP/CREATE POLICY aqui.
--
-- As duas policies aceitavam QUALQUER papel `authenticated`. O Portal do Cliente
-- autentica no mesmo projeto Supabase, então "authenticated" inclui cliente: um
-- cliente logado podia assinar os dois tópicos e saber, ao vivo, cada vez que o
-- escritório recebe e-mail ou salva petição. O payload é um aviso de duas chaves
-- (`{"op": "INSERT"}`), então não vazava conteúdo — mas o ritmo do escritório é
-- informação, e não há motivo para o portal ter acesso a ela.
--
-- É a mesma correção já aplicada ao WhatsApp em
-- 20260806234746_whatsapp_broadcast_hardening.sql, e agora com a MESMA função:
-- `wa_can_read_message_broadcast()` passa a delegar, para a regra ter um lugar só.

-- ---------------------------------------------------------------------------
-- A regra, em um lugar só
-- ---------------------------------------------------------------------------
-- Função própria em vez de `is_office_staff()`: aquela responde só "existe
-- perfil?" e ignora `is_active`, então alguém desligado continuaria ouvindo
-- enquanto o JWT não expirasse. Mexer nela seria mexer em dezenas de policies de
-- outros módulos — fora do escopo desta correção.
--
-- SECURITY DEFINER não é atalho para furar RLS: é obrigatório aqui. A policy é
-- avaliada pelo papel `authenticated` dentro do schema `realtime`, e a leitura de
-- `public.profiles` está ela mesma sob RLS (`Authenticated can read profiles`
-- USING is_office_staff()) — sem DEFINER a checagem se auto-referenciaria.
--
-- STABLE, e não VOLATILE: o Realtime reavalia a policy a cada join do canal, e
-- dentro de uma mesma avaliação o resultado não pode mudar.

CREATE OR REPLACE FUNCTION public.is_active_office_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.user_id = auth.uid()
       AND p.is_active IS TRUE
  );
$function$;

COMMENT ON FUNCTION public.is_active_office_staff() IS
  'Equipe interna ATIVA. Gate dos tópicos privados de broadcast (whatsapp:messages, '
  'email:changes, petitions:changes) — mais estrita que is_office_staff(), que ignora is_active.';

-- `anon` nunca precisa: os tópicos são privados e as policies são TO authenticated.
REVOKE ALL ON FUNCTION public.is_active_office_staff() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_active_office_staff() TO authenticated, service_role;

-- O gate do WhatsApp continua existindo (a policy dele o nomeia), mas com um corpo
-- só: duas cópias do mesmo EXISTS acabariam divergindo na próxima correção.
CREATE OR REPLACE FUNCTION public.wa_can_read_message_broadcast()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT public.is_active_office_staff();
$function$;

COMMENT ON FUNCTION public.wa_can_read_message_broadcast() IS
  'Delega para is_active_office_staff(). Mantida pelo nome que a policy de '
  'whatsapp:messages já usa.';

-- ---------------------------------------------------------------------------
-- As duas policies
-- ---------------------------------------------------------------------------
-- Alcance inalterado quanto ao escritório: e-mail e petições continuam tópico
-- único, sem filtro por dono (`listPetitions()` devolve a lista do escritório, e
-- created_by está NULL em todas as linhas de saved_petitions).

DROP POLICY IF EXISTS "broadcast de email para o escritorio" ON realtime.messages;
CREATE POLICY "broadcast de email para o escritorio"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    extension = 'broadcast'
    AND topic = 'email:changes'
    AND public.is_active_office_staff()
  );

DROP POLICY IF EXISTS "broadcast de peticoes para o escritorio" ON realtime.messages;
CREATE POLICY "broadcast de peticoes para o escritorio"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    extension = 'broadcast'
    AND topic = 'petitions:changes'
    AND public.is_active_office_staff()
  );

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- Não destrutiva: nenhuma linha de e-mail ou de petição é lida, escrita ou
-- apagada. Para voltar ao estado anterior, reaplique as duas policies sem a
-- chamada de função (como em 20260805223000_broadcast_email_and_petitions.sql) e,
-- se quiser o gate do WhatsApp com corpo próprio de volta, reaplique
-- 20260806234746_whatsapp_broadcast_hardening.sql.
