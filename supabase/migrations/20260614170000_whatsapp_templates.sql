-- ============================================================
-- WhatsApp — Fase 8: TEMPLATES e macros jurídicas
--   Mensagens padrão por escopo (global/canal/setor), com variáveis
--   expandidas no envio: {{cliente.nome}}, {{cliente.telefone}},
--   {{agente.nome}}, {{processo.numero}}, {{saudacao}}.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  category      text,                 -- ex: espera, transferencia, documento, encerramento
  scope         text NOT NULL DEFAULT 'global',  -- global | channel | department
  channel_id    uuid REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.whatsapp_departments(id) ON DELETE CASCADE,
  body          text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_templates_scope ON public.whatsapp_templates (scope, is_active);

DROP TRIGGER IF EXISTS trg_wa_templates_updated ON public.whatsapp_templates;
CREATE TRIGGER trg_wa_templates_updated BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.wa_set_updated_at();

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_templates_staff ON public.whatsapp_templates;
CREATE POLICY wa_templates_staff ON public.whatsapp_templates FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

-- Modelos iniciais (Fase 8 item 2): espera, transferência, documento, encerramento.
INSERT INTO public.whatsapp_templates (name, category, scope, body)
SELECT * FROM (VALUES
  ('Aguardar um instante', 'espera', 'global', 'Só um instante, {{cliente.nome}}, já retorno seu atendimento.'),
  ('Pedir documento', 'documento', 'global', 'Olá {{cliente.nome}}, para prosseguirmos preciso que você nos envie o(s) documento(s) pendente(s). Pode mandar por aqui mesmo.'),
  ('Encerramento', 'encerramento', 'global', 'Seu atendimento foi encerrado. Se surgir qualquer dúvida, pode nos chamar novamente por aqui. {{saudacao}}!'),
  ('Confirmar recebimento', 'documento', 'global', 'Recebido, {{cliente.nome}}. Obrigado! Vou analisar e retorno em seguida.')
) AS t(name, category, scope, body)
WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_templates);
