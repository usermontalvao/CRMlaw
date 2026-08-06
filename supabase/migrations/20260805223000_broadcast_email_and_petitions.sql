-- Passo 1 de 2: broadcast para e-mail e petições salvas.
--
-- Motivo: os dois handlers no cliente descartam o payload inteiro e só chamam
-- um refresh com atraso — `scheduleReload` no EmailModule e `scheduleRefresh`
-- no PetitionEditorModule. É campainha, não dado. Só que as duas tabelas são
-- as maiores do banco (email_messages 184 MB, com 124 MB de corpos em TOAST;
-- saved_petitions 83 MB de .docx), e o postgres_changes decodifica a linha
-- inteira em JSON para o cliente jogar fora.
--
-- Com broadcast, o que trafega é um aviso de algumas dezenas de bytes. Além
-- disso o broadcast usa o slot `..._messages_replication_slot` (pgoutput),
-- separado do slot do walrus (wal2json).
--
-- Esta migration NÃO tira as tabelas da publicação: enquanto o cliente antigo
-- estiver no ar, os dois caminhos convivem. A despublicação vem depois que o
-- cliente novo estiver publicado, para não existir janela sem atualização.

-- ---------------------------------------------------------------------------
-- Leitura dos canais privados
-- ---------------------------------------------------------------------------
-- realtime.messages tem RLS ligado e nenhuma policy, então canal privado hoje
-- seria recusado. As duas policies abaixo liberam SOMENTE os tópicos usados
-- aqui, espelhando o alcance que o postgres_changes tinha:
--   - e-mail: a assinatura antiga não tinha filtro, todo mundo do escritório
--     recebia; mantido.
--   - petições: a assinatura antiga filtrava created_by = usuário logado;
--     mantido, um tópico por dono.

DROP POLICY IF EXISTS "broadcast de email para o escritorio" ON realtime.messages;
CREATE POLICY "broadcast de email para o escritorio"
  ON realtime.messages FOR SELECT TO authenticated
  USING (extension = 'broadcast' AND topic = 'email:changes');

-- Petições: tópico único do escritório, e não por dono.
--
-- A assinatura antiga filtrava `created_by=eq.<usuário>` — só que created_by
-- está NULL nas 147 linhas da tabela, então aquele filtro nunca casou com
-- nada: essa atualização automática nunca funcionou. E `listPetitions()` não
-- filtra por dono nenhum, devolve a lista inteira. O tópico único é o que
-- corresponde ao que a tela realmente mostra.
DROP POLICY IF EXISTS "broadcast das proprias peticoes" ON realtime.messages;
DROP POLICY IF EXISTS "broadcast de peticoes para o escritorio" ON realtime.messages;
CREATE POLICY "broadcast de peticoes para o escritorio"
  ON realtime.messages FOR SELECT TO authenticated
  USING (extension = 'broadcast' AND topic = 'petitions:changes');

-- ---------------------------------------------------------------------------
-- E-mail: um aviso por COMANDO, não por linha
-- ---------------------------------------------------------------------------
-- A sincronização de e-mail insere em lote. No nível de comando, um lote de
-- 200 mensagens vira 1 aviso em vez de 200 — e o cliente já agrupa em 1,2 s.

CREATE OR REPLACE FUNCTION public.broadcast_email_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('op', TG_OP),
    'changed',
    'email:changes',
    true
  );
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_email_messages_broadcast ON public.email_messages;
CREATE TRIGGER trg_email_messages_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.email_messages
  FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_email_changed();

-- ---------------------------------------------------------------------------
-- Petições: também por COMANDO
-- ---------------------------------------------------------------------------
-- Sem tópico por dono, não há motivo para rodar por linha. O editor salva
-- sozinho de tempos em tempos; no nível de comando cada salvamento gera um
-- aviso só, e o cliente ainda agrupa em 1,5 s.

CREATE OR REPLACE FUNCTION public.broadcast_saved_petition_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('op', TG_OP),
    'changed',
    'petitions:changes',
    true
  );
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_saved_petitions_broadcast ON public.saved_petitions;
CREATE TRIGGER trg_saved_petitions_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.saved_petitions
  FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_saved_petition_changed();
