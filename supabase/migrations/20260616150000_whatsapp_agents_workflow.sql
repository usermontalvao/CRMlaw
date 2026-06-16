-- ============================================================
-- WhatsApp - Agents Workflow / Autopilot
--   Base para canais -> workflows -> etapas -> agentes -> regras
--   com follow-up progressivo, handoff humano e estado persistente
--   por conversa.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_workflow_agents (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       text NOT NULL,
  slug                       text NOT NULL UNIQUE,
  description                text,
  agent_type                 text NOT NULL DEFAULT 'assistant'
                             CHECK (agent_type IN ('assistant', 'triage', 'qualification', 'documents', 'followup', 'handoff', 'closer')),
  prompt_base                text NOT NULL DEFAULT '',
  prompt_context_template    text,
  objective                  text,
  fields_to_collect          jsonb NOT NULL DEFAULT '[]'::jsonb,
  behavior_config            jsonb NOT NULL DEFAULT '{}'::jsonb,
  can_send_automatically     boolean NOT NULL DEFAULT true,
  requires_human_approval    boolean NOT NULL DEFAULT false,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_wf_agents_type_active
  ON public.whatsapp_workflow_agents (agent_type, is_active);

DROP TRIGGER IF EXISTS trg_wa_wf_agents_updated ON public.whatsapp_workflow_agents;
CREATE TRIGGER trg_wa_wf_agents_updated BEFORE UPDATE ON public.whatsapp_workflow_agents
  FOR EACH ROW EXECUTE FUNCTION public.wa_set_updated_at();

CREATE TABLE IF NOT EXISTS public.whatsapp_followup_policies (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       text NOT NULL,
  slug                       text NOT NULL UNIQUE,
  description                text,
  stop_on_reply              boolean NOT NULL DEFAULT true,
  stop_on_disqualify         boolean NOT NULL DEFAULT true,
  stop_on_close              boolean NOT NULL DEFAULT true,
  business_hours_only        boolean NOT NULL DEFAULT true,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_wa_followup_policies_updated ON public.whatsapp_followup_policies;
CREATE TRIGGER trg_wa_followup_policies_updated BEFORE UPDATE ON public.whatsapp_followup_policies
  FOR EACH ROW EXECUTE FUNCTION public.wa_set_updated_at();

CREATE TABLE IF NOT EXISTS public.whatsapp_followup_policy_steps (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id                  uuid NOT NULL REFERENCES public.whatsapp_followup_policies(id) ON DELETE CASCADE,
  order_index                int NOT NULL,
  delay_minutes              int NOT NULL CHECK (delay_minutes >= 0),
  template_id                uuid REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  message_body               text,
  cancel_if_customer_replied boolean NOT NULL DEFAULT true,
  business_hours_only        boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, order_index)
);
CREATE INDEX IF NOT EXISTS idx_wa_followup_policy_steps_policy
  ON public.whatsapp_followup_policy_steps (policy_id, order_index);

CREATE TABLE IF NOT EXISTS public.whatsapp_workflows (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       text NOT NULL,
  slug                       text NOT NULL UNIQUE,
  description                text,
  workflow_type              text NOT NULL DEFAULT 'campaign'
                             CHECK (workflow_type IN ('campaign', 'intake', 'documents', 'followup', 'custom')),
  version                    int NOT NULL DEFAULT 1,
  entry_message              text,
  fallback_message           text,
  handoff_summary_template   text,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_wa_workflows_updated ON public.whatsapp_workflows;
CREATE TRIGGER trg_wa_workflows_updated BEFORE UPDATE ON public.whatsapp_workflows
  FOR EACH ROW EXECUTE FUNCTION public.wa_set_updated_at();

CREATE TABLE IF NOT EXISTS public.whatsapp_workflow_steps (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id                uuid NOT NULL REFERENCES public.whatsapp_workflows(id) ON DELETE CASCADE,
  name                       text NOT NULL,
  slug                       text NOT NULL,
  description                text,
  order_index                int NOT NULL DEFAULT 0,
  agent_id                   uuid REFERENCES public.whatsapp_workflow_agents(id) ON DELETE SET NULL,
  step_kind                  text NOT NULL DEFAULT 'conversation'
                             CHECK (step_kind IN ('start', 'conversation', 'decision', 'documents', 'followup', 'handoff', 'end')),
  required_fields            jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_documents_json    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_config                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_minutes            int,
  allow_auto_reply           boolean NOT NULL DEFAULT true,
  requires_business_hours    boolean NOT NULL DEFAULT false,
  followup_policy_id         uuid REFERENCES public.whatsapp_followup_policies(id) ON DELETE SET NULL,
  terminal                   boolean NOT NULL DEFAULT false,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_wa_workflow_steps_workflow_order
  ON public.whatsapp_workflow_steps (workflow_id, order_index);

DROP TRIGGER IF EXISTS trg_wa_workflow_steps_updated ON public.whatsapp_workflow_steps;
CREATE TRIGGER trg_wa_workflow_steps_updated BEFORE UPDATE ON public.whatsapp_workflow_steps
  FOR EACH ROW EXECUTE FUNCTION public.wa_set_updated_at();

CREATE TABLE IF NOT EXISTS public.whatsapp_workflow_rules (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id                uuid NOT NULL REFERENCES public.whatsapp_workflows(id) ON DELETE CASCADE,
  step_id                    uuid NOT NULL REFERENCES public.whatsapp_workflow_steps(id) ON DELETE CASCADE,
  name                       text NOT NULL,
  description                text,
  priority                   int NOT NULL DEFAULT 100,
  match_mode                 text NOT NULL DEFAULT 'all'
                             CHECK (match_mode IN ('all', 'any')),
  conditions_json            jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_json                jsonb NOT NULL DEFAULT '{}'::jsonb,
  else_action_json           jsonb,
  stop_on_match              boolean NOT NULL DEFAULT true,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_workflow_rules_step_priority
  ON public.whatsapp_workflow_rules (step_id, priority, is_active);

DROP TRIGGER IF EXISTS trg_wa_workflow_rules_updated ON public.whatsapp_workflow_rules;
CREATE TRIGGER trg_wa_workflow_rules_updated BEFORE UPDATE ON public.whatsapp_workflow_rules
  FOR EACH ROW EXECUTE FUNCTION public.wa_set_updated_at();

CREATE TABLE IF NOT EXISTS public.whatsapp_channel_workflows (
  channel_id                 uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  workflow_id                uuid NOT NULL REFERENCES public.whatsapp_workflows(id) ON DELETE CASCADE,
  is_default                 boolean NOT NULL DEFAULT true,
  entry_agent_id             uuid REFERENCES public.whatsapp_workflow_agents(id) ON DELETE SET NULL,
  config_json                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, workflow_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_channel_default_workflow
  ON public.whatsapp_channel_workflows (channel_id)
  WHERE is_default = true;

DROP TRIGGER IF EXISTS trg_wa_channel_workflows_updated ON public.whatsapp_channel_workflows;
CREATE TRIGGER trg_wa_channel_workflows_updated BEFORE UPDATE ON public.whatsapp_channel_workflows
  FOR EACH ROW EXECUTE FUNCTION public.wa_set_updated_at();

CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_workflow_state (
  conversation_id            uuid PRIMARY KEY REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  workflow_id                uuid REFERENCES public.whatsapp_workflows(id) ON DELETE SET NULL,
  current_step_id            uuid REFERENCES public.whatsapp_workflow_steps(id) ON DELETE SET NULL,
  current_agent_id           uuid REFERENCES public.whatsapp_workflow_agents(id) ON DELETE SET NULL,
  state                      text NOT NULL DEFAULT 'active'
                             CHECK (state IN ('active', 'waiting_customer', 'waiting_internal', 'followup_scheduled', 'paused', 'handed_off', 'qualified', 'disqualified', 'completed', 'cancelled', 'exception')),
  primary_subject            text,
  detected_additional_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  collected_data_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
  pending_documents_json     jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_department_id    uuid REFERENCES public.whatsapp_departments(id) ON DELETE SET NULL,
  suggested_priority         text,
  confidence_score           numeric(5,4),
  qualification_status       text NOT NULL DEFAULT 'unknown'
                             CHECK (qualification_status IN ('unknown', 'qualified', 'disqualified', 'warm', 'cold', 'needs_review')),
  qualification_reason       text,
  handoff_target_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handoff_target_department_id uuid REFERENCES public.whatsapp_departments(id) ON DELETE SET NULL,
  latest_summary             text,
  active_followup_policy_id  uuid REFERENCES public.whatsapp_followup_policies(id) ON DELETE SET NULL,
  active_followup_step       int,
  next_followup_at           timestamptz,
  followup_attempts          int NOT NULL DEFAULT 0,
  last_customer_reply_at     timestamptz,
  last_agent_action_at       timestamptz,
  last_rule_id               uuid REFERENCES public.whatsapp_workflow_rules(id) ON DELETE SET NULL,
  exception_reason           text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_conv_wf_state_workflow
  ON public.whatsapp_conversation_workflow_state (workflow_id, state);
CREATE INDEX IF NOT EXISTS idx_wa_conv_wf_state_followup
  ON public.whatsapp_conversation_workflow_state (next_followup_at)
  WHERE next_followup_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_wa_conv_wf_state_updated ON public.whatsapp_conversation_workflow_state;
CREATE TRIGGER trg_wa_conv_wf_state_updated BEFORE UPDATE ON public.whatsapp_conversation_workflow_state
  FOR EACH ROW EXECUTE FUNCTION public.wa_set_updated_at();

CREATE TABLE IF NOT EXISTS public.whatsapp_workflow_transition_log (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id            uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  workflow_id                uuid REFERENCES public.whatsapp_workflows(id) ON DELETE SET NULL,
  from_step_id               uuid REFERENCES public.whatsapp_workflow_steps(id) ON DELETE SET NULL,
  to_step_id                 uuid REFERENCES public.whatsapp_workflow_steps(id) ON DELETE SET NULL,
  triggered_rule_id          uuid REFERENCES public.whatsapp_workflow_rules(id) ON DELETE SET NULL,
  action_type                text NOT NULL,
  actor_user_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_kind                 text NOT NULL DEFAULT 'system'
                             CHECK (actor_kind IN ('system', 'agent', 'user')),
  detail_json                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_wf_transition_conv
  ON public.whatsapp_workflow_transition_log (conversation_id, created_at DESC);

ALTER TABLE public.whatsapp_workflow_agents                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_followup_policies              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_followup_policy_steps          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_workflows                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_workflow_steps                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_workflow_rules                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_channel_workflows              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversation_workflow_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_workflow_transition_log        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_wf_agents_staff ON public.whatsapp_workflow_agents;
CREATE POLICY wa_wf_agents_staff ON public.whatsapp_workflow_agents FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

DROP POLICY IF EXISTS wa_followup_policies_staff ON public.whatsapp_followup_policies;
CREATE POLICY wa_followup_policies_staff ON public.whatsapp_followup_policies FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

DROP POLICY IF EXISTS wa_followup_policy_steps_staff ON public.whatsapp_followup_policy_steps;
CREATE POLICY wa_followup_policy_steps_staff ON public.whatsapp_followup_policy_steps FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

DROP POLICY IF EXISTS wa_workflows_staff ON public.whatsapp_workflows;
CREATE POLICY wa_workflows_staff ON public.whatsapp_workflows FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

DROP POLICY IF EXISTS wa_workflow_steps_staff ON public.whatsapp_workflow_steps;
CREATE POLICY wa_workflow_steps_staff ON public.whatsapp_workflow_steps FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

DROP POLICY IF EXISTS wa_workflow_rules_staff ON public.whatsapp_workflow_rules;
CREATE POLICY wa_workflow_rules_staff ON public.whatsapp_workflow_rules FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

DROP POLICY IF EXISTS wa_channel_workflows_staff ON public.whatsapp_channel_workflows;
CREATE POLICY wa_channel_workflows_staff ON public.whatsapp_channel_workflows FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

DROP POLICY IF EXISTS wa_conv_wf_state_staff ON public.whatsapp_conversation_workflow_state;
CREATE POLICY wa_conv_wf_state_staff ON public.whatsapp_conversation_workflow_state FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.whatsapp_conversations c
      WHERE c.id = conversation_id
        AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.whatsapp_conversations c
      WHERE c.id = conversation_id
        AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
    )
  );

DROP POLICY IF EXISTS wa_wf_transition_staff ON public.whatsapp_workflow_transition_log;
CREATE POLICY wa_wf_transition_staff ON public.whatsapp_workflow_transition_log FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.whatsapp_conversations c
      WHERE c.id = conversation_id
        AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.whatsapp_conversations c
      WHERE c.id = conversation_id
        AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='whatsapp_conversation_workflow_state') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversation_workflow_state;
  END IF;
END $$;

INSERT INTO public.whatsapp_followup_policies (name, slug, description)
SELECT 'Follow-up padrão de campanha', 'followup-padrao-campanha', 'Cadência padrão para leads sem resposta: 2h, 24h e 36h em horário comercial.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.whatsapp_followup_policies WHERE slug = 'followup-padrao-campanha'
);

INSERT INTO public.whatsapp_followup_policy_steps (policy_id, order_index, delay_minutes, message_body)
SELECT p.id, s.order_index, s.delay_minutes, s.message_body
FROM public.whatsapp_followup_policies p
CROSS JOIN (
  VALUES
    (1, 120,  'Oi, passando para dar continuidade no seu atendimento. Se quiser, posso seguir com as proximas informacoes por aqui.'),
    (2, 1440, 'Retomando seu atendimento: se ainda fizer sentido para voce, posso continuar a triagem e orientar os proximos passos.'),
    (3, 2160, 'Esta sera minha ultima mensagem por agora. Se quiser continuar, basta responder aqui e eu sigo com seu atendimento.')
) AS s(order_index, delay_minutes, message_body)
WHERE p.slug = 'followup-padrao-campanha'
  AND NOT EXISTS (
    SELECT 1 FROM public.whatsapp_followup_policy_steps x
    WHERE x.policy_id = p.id AND x.order_index = s.order_index
  );

INSERT INTO public.whatsapp_workflow_agents (name, slug, description, agent_type, prompt_base, objective, behavior_config)
SELECT
  'Agente de atendimento padrão',
  'agente-atendimento-padrao',
  'Agente inicial reutilizável para campanhas e atendimento de entrada.',
  'assistant',
  'Voce esta atendendo um cliente vindo de campanha juridica. Seja objetivo, cordial, colete o maximo de contexto possivel e identifique tambem assuntos secundarios com potencial juridico, mesmo quando a campanha de origem for outra.',
  'Recepcionar, coletar contexto, identificar assunto principal e oportunidades adicionais, e encaminhar corretamente.',
  '{"detect_additional_matters": true, "collect_maximum_context": true, "stop_on_opt_out": true}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.whatsapp_workflow_agents WHERE slug = 'agente-atendimento-padrao'
);
