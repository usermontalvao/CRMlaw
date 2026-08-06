-- Passo 2 de 2: tira email_messages e saved_petitions da publicação.
--
-- Só depois de 20260805223000_broadcast_email_and_petitions.sql (gatilhos +
-- policies) e do cliente já ouvindo `email:changes` e `petitions:changes` por
-- broadcast. Aplicar esta migration antes disso deixaria a caixa de entrada e
-- a lista de petições sem atualização automática até o deploy do front.
--
-- O que sai daqui é a decodificação de linha inteira em JSON: 184 MB de
-- e-mails (124 MB só de corpos em TOAST) e 83 MB de .docx que o cliente
-- descartava sem olhar.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_messages', 'saved_petitions'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END;
$$;
