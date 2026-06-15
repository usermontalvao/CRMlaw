-- ============================================================
-- Módulo WhatsApp (Evolution API) — Fase 2: mídia + transcrição + reply/edit
-- Aditiva sobre a fase 1. Não remove nem altera o suporte a texto.
-- ============================================================

-- ── Colunas de mídia / transcrição / reply / edição em mensagens ──
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS storage_path        text,          -- caminho no bucket whatsapp-media
  ADD COLUMN IF NOT EXISTS media_size          bigint,        -- bytes
  ADD COLUMN IF NOT EXISTS media_sha256        text,          -- hash p/ dedupe/integridade
  ADD COLUMN IF NOT EXISTS file_name           text,          -- nome original (documentos)
  ADD COLUMN IF NOT EXISTS transcription_text  text,          -- texto da transcrição de áudio
  ADD COLUMN IF NOT EXISTS transcription_status text,         -- null | pending | done | failed | unsupported
  ADD COLUMN IF NOT EXISTS reply_to_id         uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at           timestamptz;

CREATE INDEX IF NOT EXISTS idx_wa_msg_reply_to ON public.whatsapp_messages (reply_to_id);

-- ── Bucket privado para mídia do WhatsApp ──────────────────────
-- Privado: é dado de cliente. Leitura via signed URLs; envio à Evolution via base64.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('whatsapp-media', 'whatsapp-media', false, 52428800)  -- 50 MB
ON CONFLICT (id) DO NOTHING;

-- Policies de storage: somente equipe do escritório (mesma regra das tabelas).
DROP POLICY IF EXISTS wa_media_staff_select ON storage.objects;
CREATE POLICY wa_media_staff_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'whatsapp-media' AND public.is_office_staff());

DROP POLICY IF EXISTS wa_media_staff_insert ON storage.objects;
CREATE POLICY wa_media_staff_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'whatsapp-media' AND public.is_office_staff());

DROP POLICY IF EXISTS wa_media_staff_update ON storage.objects;
CREATE POLICY wa_media_staff_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'whatsapp-media' AND public.is_office_staff())
  WITH CHECK (bucket_id = 'whatsapp-media' AND public.is_office_staff());

DROP POLICY IF EXISTS wa_media_staff_delete ON storage.objects;
CREATE POLICY wa_media_staff_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'whatsapp-media' AND public.is_office_staff());
