-- ============================================================
-- Módulo WhatsApp — multi-canal + departamentos (modelo Chatwoot)
--   Canal  = whatsapp_instances (um número/conexão Evolution).
--   Setor  = whatsapp_departments (grupo de atendimento).
--   Conversa pertence a um canal e pode ir a um departamento e/ou pessoa.
--   Transferência registrada em whatsapp_transfers.
-- Servidor Evolution (base_url + api_key) é único e fica em system_settings.
-- ============================================================

-- ── Canais (whatsapp_instances ganha metadados de canal) ──
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS name          text,
  ADD COLUMN IF NOT EXISTS color         text,
  ADD COLUMN IF NOT EXISTS webhook_token text,
  ADD COLUMN IF NOT EXISTS is_active     boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_inst_webhook_token
  ON public.whatsapp_instances (webhook_token) WHERE webhook_token IS NOT NULL;

-- ── Departamentos (setores de atendimento) ──
CREATE TABLE IF NOT EXISTS public.whatsapp_departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  color      text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_department_members (
  department_id uuid NOT NULL REFERENCES public.whatsapp_departments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_dept_member_user ON public.whatsapp_department_members (user_id);

-- ── Conversa: departamento responsável ──
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.whatsapp_departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wa_conv_department ON public.whatsapp_conversations (department_id);

-- ── Histórico de transferências ──
CREATE TABLE IF NOT EXISTS public.whatsapp_transfers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  from_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  to_user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  from_department_id uuid REFERENCES public.whatsapp_departments(id) ON DELETE SET NULL,
  to_department_id   uuid REFERENCES public.whatsapp_departments(id) ON DELETE SET NULL,
  note               text,
  performed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_transfers_conv ON public.whatsapp_transfers (conversation_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_wa_dept_updated ON public.whatsapp_departments;
CREATE TRIGGER trg_wa_dept_updated BEFORE UPDATE ON public.whatsapp_departments
  FOR EACH ROW EXECUTE FUNCTION public.wa_set_updated_at();

-- ── RLS staff-only ──
ALTER TABLE public.whatsapp_departments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_department_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_transfers          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_dept_staff ON public.whatsapp_departments;
CREATE POLICY wa_dept_staff ON public.whatsapp_departments FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());
DROP POLICY IF EXISTS wa_dept_member_staff ON public.whatsapp_department_members;
CREATE POLICY wa_dept_member_staff ON public.whatsapp_department_members FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());
DROP POLICY IF EXISTS wa_transfers_staff ON public.whatsapp_transfers;
CREATE POLICY wa_transfers_staff ON public.whatsapp_transfers FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

-- ── Realtime ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='whatsapp_instances') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_instances;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='whatsapp_transfers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_transfers;
  END IF;
END $$;
ALTER TABLE public.whatsapp_instances REPLICA IDENTITY FULL;
