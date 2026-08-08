-- ============================================================
-- WhatsApp — apagar mensagem e duração da mídia
--
-- DUAS COISAS QUE FALTAVAM NA TABELA:
--
-- 1. APAGAR MENSAGEM. O módulo não tinha nenhuma forma de apagar: um áudio
--    gravado por engano, um documento mandado para o contato errado, uma
--    mensagem com dado sensível — tudo ficava na thread para sempre. O WhatsApp
--    tem duas exclusões e elas são coisas diferentes:
--      • 'me'       — some só do nosso lado. O contato continua com a mensagem
--                     no aparelho dele. É o "Apagar para mim" do aplicativo, que
--                     aqui vale para o ESCRITÓRIO inteiro (a thread é uma só e é
--                     compartilhada pela equipe — não existe "meu" histórico).
--      • 'everyone' — pede à Evolution para revogar no aparelho do contato. Só
--                     funciona em mensagem NOSSA e dentro da janela que o
--                     WhatsApp permite; falhando lá, não marcamos aqui.
--
--    É soft delete, e de propósito: a mensagem apagada continua na linha, com
--    quem apagou e quando. Num CRM de escritório de advocacia, "sumiu da tela"
--    não pode significar "não dá para auditar quem tirou". A bolha vira o
--    aviso cinza "Mensagem apagada", como no próprio WhatsApp.
--
--    O REVOKE que vem do CONTATO (ele apagou para todos no aparelho dele) cai no
--    mesmo lugar, pelo webhook, com deleted_by nulo — foi ele quem apagou, não
--    alguém do escritório.
--
-- 2. DURAÇÃO DA MÍDIA. O aviso de mensagem nova dizia só "Mensagem de voz", sem
--    dizer se era um "ok" de 2 segundos ou um relato de 4 minutos — que é
--    exatamente a informação que decide se a pessoa para o que está fazendo para
--    ouvir. O número vem de graça no payload da Evolution (audioMessage.seconds,
--    videoMessage.seconds) e só estava sendo jogado fora.
-- ============================================================

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS deleted_at    timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_scope text,
  ADD COLUMN IF NOT EXISTS media_duration_seconds integer;

-- CHECK em ADD CONSTRAINT separado: a forma inline não tem IF NOT EXISTS e
-- quebraria o replay da migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.whatsapp_messages'::regclass
      AND conname  = 'whatsapp_messages_deleted_scope_check'
  ) THEN
    ALTER TABLE public.whatsapp_messages
      ADD CONSTRAINT whatsapp_messages_deleted_scope_check
      CHECK (deleted_scope IS NULL OR deleted_scope IN ('me', 'everyone'));
  END IF;
END $$;

COMMENT ON COLUMN public.whatsapp_messages.deleted_at IS
  'Quando a mensagem foi apagada (soft delete). Nulo = mensagem viva.';
COMMENT ON COLUMN public.whatsapp_messages.deleted_by IS
  'Quem apagou. NULO com deleted_at preenchido = quem apagou foi o CONTATO (revoke recebido pelo webhook).';
COMMENT ON COLUMN public.whatsapp_messages.deleted_scope IS
  '''me'' = sumiu só no CRM; ''everyone'' = revogada também no aparelho do contato.';
COMMENT ON COLUMN public.whatsapp_messages.media_duration_seconds IS
  'Duração do áudio/vídeo em segundos, como a Evolution informa. Usada no aviso de mensagem nova e no player.';

-- Índice parcial: a thread pergunta "quais estão apagadas?" em toda abertura de
-- conversa, e as apagadas são a minoria absoluta das linhas.
CREATE INDEX IF NOT EXISTS idx_wa_messages_deleted_at
  ON public.whatsapp_messages (conversation_id, deleted_at)
  WHERE deleted_at IS NOT NULL;
