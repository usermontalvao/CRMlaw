-- Último passo da migração Realtime → Broadcast: tira whatsapp_messages da
-- publicação `supabase_realtime`.
--
-- A ordem que autoriza esta migration já se cumpriu:
--   1. 20260806210000_whatsapp_messages_broadcast.sql — gatilhos + policy;
--   2. 20260806234746_whatsapp_broadcast_hardening.sql — topico privado, só
--      equipe interna ATIVA (`wa_can_read_message_broadcast`);
--   3. o front passou a ler `whatsapp:messages` como fonte ÚNICA, sem rede de
--      `postgres_changes`, e o canal foi validado em produção.
--
-- O que sai daqui é a decodificação da linha inteira de cada mensagem em JSON,
-- replicada para toda aba aberta do CRM: `raw` da Evolution, `transcription_text`
-- e os campos de mídia. O broadcast manda só o que a tela usa.
--
-- A volta atrás deixa de ser `git revert`: para religar o caminho antigo é
-- preciso republicar a tabela e reintroduzir o canal no cliente. O que repõe o
-- que o socket perde continua sendo HTTP, em `useWaRealtime`.
--
-- whatsapp_conversations SEGUE publicada de propósito — o módulo depende do
-- postgres_changes dela (linha de ~400 bytes, com campos de fila e atribuição
-- que a tela lê direto do payload).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.whatsapp_messages;
  END IF;
END;
$$;
