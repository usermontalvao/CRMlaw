-- ============================================================
-- WhatsApp — Fase 11: RETENCAO, CUSTO E GOVERNANCA
--   Politica: apos 6 meses, o CONTEUDO e a MIDIA das mensagens sao
--   descartados, preservando apenas os METADADOS operacionais (tipo,
--   direcao, horarios, status, autoria). Conversas com guarda juridica
--   (`legal_hold`) ficam de fora. Toda execucao gera log auditavel.
--
--   A limpeza efetiva (incl. remocao dos blobs no bucket) roda na edge
--   `whatsapp-retention` com service role. Este arquivo apenas prepara o
--   schema e a auditoria — NAO agenda exclusao sozinho (cron e opt-in,
--   ver bloco comentado ao final).
-- ============================================================

-- Excecao juridica: conversa marcada nao tem conteudo/midia descartados.
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;

-- Marca quando o conteudo/midia daquela mensagem ja foi descartado, para
-- nao reprocessar e para a UI sinalizar "conteudo removido por retencao".
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS retention_purged_at timestamptz;

-- Seleciona rapido as candidatas a limpeza (antigas, com midia, nao purgadas).
CREATE INDEX IF NOT EXISTS idx_wa_msg_retention
  ON public.whatsapp_messages (wa_timestamp)
  WHERE retention_purged_at IS NULL AND storage_path IS NOT NULL;

-- ── Log de auditoria de cada rodada de retencao ──
CREATE TABLE IF NOT EXISTS public.whatsapp_retention_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at           timestamptz NOT NULL DEFAULT now(),
  cutoff           timestamptz NOT NULL,        -- limite de idade aplicado
  months           int NOT NULL,                -- janela de retencao usada
  messages_purged  int NOT NULL DEFAULT 0,      -- mensagens com conteudo limpo
  media_purged     int NOT NULL DEFAULT 0,      -- blobs removidos do bucket
  held_skipped     int NOT NULL DEFAULT 0,      -- puladas por guarda juridica
  details          jsonb                        -- erros parciais, amostras, etc.
);
CREATE INDEX IF NOT EXISTS idx_wa_retention_log_ran ON public.whatsapp_retention_log (ran_at DESC);

ALTER TABLE public.whatsapp_retention_log ENABLE ROW LEVEL SECURITY;

-- Leitura do log: apenas supervisao (governanca). Escrita e via service role.
DROP POLICY IF EXISTS wa_retention_log_select ON public.whatsapp_retention_log;
CREATE POLICY wa_retention_log_select ON public.whatsapp_retention_log FOR SELECT TO authenticated
  USING (public.wa_is_supervisor());

COMMENT ON COLUMN public.whatsapp_conversations.legal_hold IS
  'Guarda juridica: protege conteudo/midia da retencao automatica (Fase 11).';
COMMENT ON COLUMN public.whatsapp_messages.retention_purged_at IS
  'Quando o conteudo/midia foi descartado pela retencao; metadados ficam.';

-- ── Agendamento (OPT-IN) ────────────────────────────────────
-- A retencao apaga dados de forma irreversivel. Por isso o cron NAO e criado
-- aqui. Para ativar (mensal, 03:00 UTC), revise a edge `whatsapp-retention`,
-- defina WA_RETENTION_TOKEN e rode manualmente algo como:
--
--   select cron.schedule(
--     'whatsapp-retention-monthly', '0 3 1 * *',
--     $$ select net.http_post(
--          url    := 'https://<PROJECT-REF>.functions.supabase.co/whatsapp-retention?token=<WA_RETENTION_TOKEN>&months=6',
--          headers:= '{"Content-Type":"application/json"}'::jsonb
--        ); $$
--   );
