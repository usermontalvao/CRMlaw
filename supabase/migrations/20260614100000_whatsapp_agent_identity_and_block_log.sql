-- ============================================================
-- WhatsApp — Fase 1 (identidade do agente) + log de bloqueio
-- ============================================================

-- Log do resultado da Evolution em cada bloqueio/desbloqueio (diagnóstico).
ALTER TABLE public.whatsapp_contact_blocks
  ADD COLUMN IF NOT EXISTS wa_response jsonb;

-- Identidade de atendimento do agente (tratamento, nome curto, cargo, saudação).
CREATE TABLE IF NOT EXISTS public.whatsapp_agent_settings (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  treatment     text NOT NULL DEFAULT '',          -- '' | 'dr' | 'dra'
  short_name    text,                               -- ex: "Pedro" (exibido no atendimento)
  role_label    text,                               -- ex: "Advogado", "Assistente jurídica"
  auto_greeting boolean NOT NULL DEFAULT true,      -- envia saudação no 1º atendimento
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_agent_settings ENABLE ROW LEVEL SECURITY;

-- Cada um lê/edita a própria identidade; equipe pode ler as demais (para
-- montar templates de transferência com tratamento correto).
DROP POLICY IF EXISTS wa_agent_self_write ON public.whatsapp_agent_settings;
CREATE POLICY wa_agent_self_write ON public.whatsapp_agent_settings FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS wa_agent_staff_read ON public.whatsapp_agent_settings;
CREATE POLICY wa_agent_staff_read ON public.whatsapp_agent_settings FOR SELECT TO authenticated
  USING (public.is_office_staff());

DROP TRIGGER IF EXISTS trg_wa_agent_updated ON public.whatsapp_agent_settings;
CREATE TRIGGER trg_wa_agent_updated BEFORE UPDATE ON public.whatsapp_agent_settings
  FOR EACH ROW EXECUTE FUNCTION public.wa_set_updated_at();
