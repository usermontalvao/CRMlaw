-- ============================================================================
-- Atendente de IA do WhatsApp — tabelas
--
-- ADITIVA: cria 4 tabelas novas e NÃO altera nenhuma existente. Remoção completa
-- em sql/drop_whatsapp_atendente_ia.sql, escrito junto com esta migration de
-- propósito — o caminho de volta existe antes do de ida.
--
-- Ver docs/WHATSAPP_ATENDENTE_IA.md para o desenho e o histórico das tentativas
-- anteriores (esta é a quarta; as três primeiras estão registradas lá).
--
-- NÃO publicar nada disto em supabase_realtime. O custo de Realtime deste projeto
-- é dirigido pelo tamanho do catálogo replicado, não pelo volume de escrita —
-- tabelas foram deliberadamente DESPUBLICADAS por isso. A UI do log lê por
-- consulta, não por assinatura.
-- ============================================================================

-- Toca updated_at. Função própria para esta feature não depender de helper de
-- outra automação que pode ser removida.
CREATE OR REPLACE FUNCTION public.wa_ai_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── 1) Agentes ──────────────────────────────────────────────────────────────
-- Um agente = uma função no atendimento. O canal tem um primário; os demais
-- entram por passagem explícita (@PassarPara) ou palavra-chave.
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_agents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  slug              text NOT NULL UNIQUE,
  description       text,
  role              text NOT NULL DEFAULT 'atendimento'
                    CHECK (role IN ('triagem','qualificacao','documentos','proposta','fechamento','atendimento')),

  prompt            text NOT NULL DEFAULT '',

  channel_id        uuid REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  is_primary        boolean NOT NULL DEFAULT false,
  keyword           text,

  -- Nomes do catálogo em wa-agent-tools.ts. O que não está aqui não é oferecido
  -- ao modelo — não é proibido no prompt, é inexistente para ele.
  allowed_tools     text[] NOT NULL DEFAULT '{}',

  model             text NOT NULL DEFAULT 'gpt-4o-mini',
  debounce_seconds  int NOT NULL DEFAULT 15 CHECK (debounce_seconds BETWEEN 0 AND 120),
  max_turns         int NOT NULL DEFAULT 20 CHECK (max_turns > 0),

  mode              text NOT NULL DEFAULT 'sombra'
                    CHECK (mode IN ('sombra','aprovacao','automatico')),

  -- "transfere para determinada pessoa": destino padrão do @TransferirHumano.
  handoff_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handoff_department_id uuid REFERENCES public.whatsapp_departments(id) ON DELETE SET NULL,

  -- Nasce desligado e em sombra. Ligar é ato deliberado, nunca efeito colateral
  -- de cadastrar. Foi assim que a 1ª tentativa foi para produção e ficou parada:
  -- aqui isso é intencional, não acidente.
  is_active         boolean NOT NULL DEFAULT false,

  version           int NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- No máximo um primário ativo por canal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_ai_agents_primary_por_canal
  ON public.whatsapp_ai_agents (channel_id)
  WHERE is_primary AND is_active;

CREATE INDEX IF NOT EXISTS idx_wa_ai_agents_canal
  ON public.whatsapp_ai_agents (channel_id, is_active);

DROP TRIGGER IF EXISTS trg_wa_ai_agents_touch ON public.whatsapp_ai_agents;
CREATE TRIGGER trg_wa_ai_agents_touch BEFORE UPDATE ON public.whatsapp_ai_agents
  FOR EACH ROW EXECUTE FUNCTION public.wa_ai_touch();

-- ── 2) Versões de prompt ────────────────────────────────────────────────────
-- Calibrar prompt é tentativa e erro; sem voltar atrás, cada piora vira retrabalho.
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_agent_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid NOT NULL REFERENCES public.whatsapp_ai_agents(id) ON DELETE CASCADE,
  version       int NOT NULL,
  prompt        text NOT NULL,
  allowed_tools text[] NOT NULL DEFAULT '{}',
  author_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);

CREATE INDEX IF NOT EXISTS idx_wa_ai_agent_versions_agente
  ON public.whatsapp_ai_agent_versions (agent_id, version DESC);

-- ── 3) Estado por conversa ──────────────────────────────────────────────────
-- Uma linha por conversa. SÓ O MOTOR ESCREVE AQUI (service role). A UI lê.
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_agent_state (
  conversation_id       uuid PRIMARY KEY REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  current_agent_id      uuid REFERENCES public.whatsapp_ai_agents(id) ON DELETE SET NULL,

  status                text NOT NULL DEFAULT 'ativo'
                        CHECK (status IN ('ativo','aguardando_aprovacao','pausado','transferido','encerrado','excecao')),

  collected_data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  qualification         text CHECK (qualification IN ('qualificado','desqualificado','em_analise')),
  qualification_reason  text,
  turn_count            int NOT NULL DEFAULT 0,

  -- Agrupamento: o cliente manda 5 mensagens picadas; responder à primeira
  -- atropela as outras quatro.
  debounce_until        timestamptz,

  -- Um executor por conversa, e não reprocessar o mesmo evento no retry do webhook.
  locked_until          timestamptz,
  last_event_id         text,

  -- Modo aprovação: o que está escrito e esperando um clique.
  pending_reply         text,
  pending_tools         jsonb,

  exception_reason      text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_ai_state_debounce
  ON public.whatsapp_ai_agent_state (debounce_until)
  WHERE debounce_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_ai_state_aprovacao
  ON public.whatsapp_ai_agent_state (status)
  WHERE status = 'aguardando_aprovacao';

DROP TRIGGER IF EXISTS trg_wa_ai_state_touch ON public.whatsapp_ai_agent_state;
CREATE TRIGGER trg_wa_ai_state_touch BEFORE UPDATE ON public.whatsapp_ai_agent_state
  FOR EACH ROW EXECUTE FUNCTION public.wa_ai_touch();

-- ── 4) Log de decisões ──────────────────────────────────────────────────────
-- O coração do modo sombra: uma linha por vez que o agente pensou. Em sombra,
-- executed = false em tudo — é a prova de que ele decidiu e não agiu.
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  agent_id         uuid REFERENCES public.whatsapp_ai_agents(id) ON DELETE SET NULL,

  mode             text NOT NULL CHECK (mode IN ('sombra','aprovacao','automatico')),
  trigger_event_id text,

  inbound_text     text,   -- o que o cliente disse (já agrupado)
  reply_text       text,   -- o que o agente respondeu, ou responderia

  -- [{name, args, verdict: 'executado'|'barrado'|'simulado'|'aprovacao', error}]
  tool_calls       jsonb NOT NULL DEFAULT '[]'::jsonb,

  executed         boolean NOT NULL DEFAULT false,

  model            text,
  tokens_in        int,
  tokens_out       int,
  latency_ms       int,
  error            text,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_ai_runs_conversa
  ON public.whatsapp_ai_runs (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_ai_runs_recentes
  ON public.whatsapp_ai_runs (created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Staff lê e configura; o motor escreve com service role, que passa por cima.
-- Mesmo padrão das tabelas whatsapp_ai_* que já existem.
ALTER TABLE public.whatsapp_ai_agents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_ai_agent_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_ai_agent_state     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_ai_runs            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_ai_agents_staff ON public.whatsapp_ai_agents;
CREATE POLICY wa_ai_agents_staff ON public.whatsapp_ai_agents FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

DROP POLICY IF EXISTS wa_ai_agent_versions_staff ON public.whatsapp_ai_agent_versions;
CREATE POLICY wa_ai_agent_versions_staff ON public.whatsapp_ai_agent_versions FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

-- Estado é leitura para o staff. Quem muda é o motor.
DROP POLICY IF EXISTS wa_ai_state_staff_read ON public.whatsapp_ai_agent_state;
CREATE POLICY wa_ai_state_staff_read ON public.whatsapp_ai_agent_state FOR SELECT TO authenticated
  USING (public.is_office_staff());

-- Log é imutável para o staff: só leitura. Adulterar o histórico de decisões
-- destruiria justamente a prova que o modo sombra existe para produzir.
DROP POLICY IF EXISTS wa_ai_runs_staff_read ON public.whatsapp_ai_runs;
CREATE POLICY wa_ai_runs_staff_read ON public.whatsapp_ai_runs FOR SELECT TO authenticated
  USING (public.is_office_staff());
