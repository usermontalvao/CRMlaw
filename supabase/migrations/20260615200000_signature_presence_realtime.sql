-- Presença da assinatura pública refletindo no WhatsApp em tempo real.
--
-- 1) As colunas opened_at/last_seen_at de signature_signers (heartbeat da página
--    pública) NÃO existiam em produção: a migration anterior
--    (20260615193000_signature_signer_presence_tracking.sql) nunca foi aplicada,
--    então o heartbeat falhava e getTrackedSignatureStatusByClients quebrava ao
--    fazer SELECT dessas colunas (erro engolido por .catch). Reaplicamos aqui de
--    forma idempotente.
ALTER TABLE public.signature_signers
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_signature_signers_opened_at
  ON public.signature_signers(opened_at);
CREATE INDEX IF NOT EXISTS idx_signature_signers_last_seen_at
  ON public.signature_signers(last_seen_at);

COMMENT ON COLUMN public.signature_signers.opened_at IS
  'Primeira vez em que o signatario abriu a pagina publica de assinatura.';
COMMENT ON COLUMN public.signature_signers.last_seen_at IS
  'Ultimo heartbeat observado na pagina publica de assinatura.';

-- 2) Realtime: as 3 tabelas do tracking precisam estar na publicação
--    supabase_realtime para o WhatsApp (subscribeSignatures) reagir ao vivo.
--    REPLICA IDENTITY FULL garante payload completo em UPDATE/DELETE sob RLS.
ALTER TABLE public.signature_signers   REPLICA IDENTITY FULL;
ALTER TABLE public.signature_requests  REPLICA IDENTITY FULL;
ALTER TABLE public.template_fill_links REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='signature_signers') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.signature_signers';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='signature_requests') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.signature_requests';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='template_fill_links') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.template_fill_links';
  END IF;
END $$;
