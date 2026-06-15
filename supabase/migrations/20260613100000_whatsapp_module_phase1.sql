-- ============================================================
-- Módulo WhatsApp (Evolution API) — Fase 1
-- Envio/recebimento básico sobre uma instância única do escritório.
-- Tabelas: whatsapp_instances, whatsapp_conversations, whatsapp_messages.
-- client_id / assigned_user_id já incluídos (nullable) para as fases
-- seguintes (vínculo de cliente e multi-atendimento) sem precisar migrar.
-- ============================================================

-- Helper: usuário autenticado é membro do escritório (tem profile)?
-- SECURITY DEFINER para não esbarrar em RLS de profiles e excluir
-- automaticamente clientes do portal (que não têm linha em profiles).
CREATE OR REPLACE FUNCTION public.is_office_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()
  );
$$;

-- ── Instâncias (números conectados via Evolution) ──────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_instances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name   text NOT NULL UNIQUE,
  phone_number    text,
  status          text NOT NULL DEFAULT 'disconnected', -- disconnected | connecting | connected
  last_qr         text,
  profile_pic_url text,
  connected_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Conversas (1 por contato) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id            uuid REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  remote_jid             text NOT NULL,            -- ex: 5565999999999@s.whatsapp.net
  contact_phone          text NOT NULL,
  contact_name           text,
  contact_avatar_url     text,
  client_id              uuid REFERENCES public.clients(id) ON DELETE SET NULL,        -- Fase 2
  assigned_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,            -- Fase 2
  status                 text NOT NULL DEFAULT 'open', -- open | pending | closed
  unread_count           int  NOT NULL DEFAULT 0,
  last_message_at        timestamptz,
  last_message_preview   text,
  last_message_direction text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, remote_jid)
);

CREATE INDEX IF NOT EXISTS idx_wa_conv_last_msg   ON public.whatsapp_conversations (last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_wa_conv_client     ON public.whatsapp_conversations (client_id);
CREATE INDEX IF NOT EXISTS idx_wa_conv_assigned   ON public.whatsapp_conversations (assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_wa_conv_status     ON public.whatsapp_conversations (status);

-- ── Mensagens ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  evolution_message_id text,
  direction           text NOT NULL,                 -- in | out
  type                text NOT NULL DEFAULT 'text',   -- text | image | audio | video | document | sticker
  content             text,
  media_url           text,
  media_mime          text,
  status              text DEFAULT 'sent',            -- pending | sent | delivered | read | failed
  sender_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- quem enviou (out)
  wa_timestamp        timestamptz NOT NULL DEFAULT now(),
  raw                 jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Idempotência de webhook (mesma mensagem chega 2x). Índice único COMPLETO
-- (não parcial) para que o upsert do supabase-js com onConflict por colunas case
-- com o índice. NULLs são distintos no Postgres, então mensagens sem id da
-- Evolution coexistem sem conflito.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_msg_evolution_id
  ON public.whatsapp_messages (conversation_id, evolution_message_id);
CREATE INDEX IF NOT EXISTS idx_wa_msg_conv ON public.whatsapp_messages (conversation_id, wa_timestamp);

-- ── Trigger: manter resumo da conversa em dia + contar não-lidas ─
CREATE OR REPLACE FUNCTION public.wa_touch_conversation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_preview text;
BEGIN
  v_preview := CASE
    WHEN NEW.type = 'text' THEN left(coalesce(NEW.content, ''), 200)
    WHEN NEW.type = 'image' THEN '📷 Imagem'
    WHEN NEW.type = 'audio' THEN '🎤 Áudio'
    WHEN NEW.type = 'video' THEN '🎬 Vídeo'
    WHEN NEW.type = 'document' THEN '📎 Documento'
    ELSE left(coalesce(NEW.content, ''), 200)
  END;

  UPDATE public.whatsapp_conversations c
     SET last_message_at        = NEW.wa_timestamp,
         last_message_preview   = v_preview,
         last_message_direction = NEW.direction,
         unread_count           = CASE WHEN NEW.direction = 'in'
                                       THEN c.unread_count + 1
                                       ELSE c.unread_count END,
         updated_at             = now()
   WHERE c.id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_touch_conversation ON public.whatsapp_messages;
CREATE TRIGGER trg_wa_touch_conversation
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.wa_touch_conversation();

-- ── updated_at automático ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wa_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_wa_inst_updated ON public.whatsapp_instances;
CREATE TRIGGER trg_wa_inst_updated BEFORE UPDATE ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION public.wa_set_updated_at();

DROP TRIGGER IF EXISTS trg_wa_conv_updated ON public.whatsapp_conversations;
CREATE TRIGGER trg_wa_conv_updated BEFORE UPDATE ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION public.wa_set_updated_at();

-- ── RLS: somente equipe do escritório (deny-by-default) ────────
ALTER TABLE public.whatsapp_instances     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_inst_staff ON public.whatsapp_instances;
CREATE POLICY wa_inst_staff ON public.whatsapp_instances
  FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

DROP POLICY IF EXISTS wa_conv_staff ON public.whatsapp_conversations;
CREATE POLICY wa_conv_staff ON public.whatsapp_conversations
  FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

DROP POLICY IF EXISTS wa_msg_staff ON public.whatsapp_messages;
CREATE POLICY wa_msg_staff ON public.whatsapp_messages
  FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

-- ── Realtime ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'whatsapp_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
  END IF;
END $$;

ALTER TABLE public.whatsapp_messages      REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_conversations REPLICA IDENTITY FULL;
