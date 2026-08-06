-- Tira da publicação do Realtime as tabelas que ninguém assina.
--
-- Motivo: o custo do decodificador de WAL (walrus) não acompanha o volume de
-- escrita — ele vem do ciclo de polling, cujo preço escala com o número de
-- tabelas publicadas e de assinaturas. Medido em produção: 289 GB de buffer
-- tocados em 4 horas para um total de 350 escritas em TODAS as tabelas
-- publicadas somadas.
--
-- Cada tabela abaixo foi conferida no código: nenhuma aparece em
-- `postgres_changes` em src/. Publicar significa decodificar WAL para
-- ninguém.
--
--   chat_room_members       — só leitura/escrita comum pelo chat.service
--   nextcloud_file_locks    — abandonada; o "quem está editando" virou
--                             nextcloudPresence.service, sobre Presence
--                             (ver comentário em nextcloud.service.ts)
--   petition_blocks         — só consulta comum em petitionEditor.service
--   whatsapp_internal_notes — sem canal
--   whatsapp_transfers      — sem canal
--
-- Isto NÃO desliga as tabelas: SELECT, INSERT, UPDATE e RLS seguem iguais.
-- Só para o empurrão automático de mudança, que hoje não tem destinatário.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'chat_room_members',
    'nextcloud_file_locks',
    'petition_blocks',
    'whatsapp_internal_notes',
    'whatsapp_transfers'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END;
$$;
