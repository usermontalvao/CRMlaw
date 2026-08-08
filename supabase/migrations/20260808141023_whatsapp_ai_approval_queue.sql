-- ============================================================================
-- Fila de aprovação humana das ações de risco alto do atendente de IA
--
-- Dois buracos que esta migration fecha:
--
-- 1) whatsapp_ai_meeting_requests subiu com RLS LIGADA e ZERO políticas. Na
--    prática só a service role enxergava a tabela, então a tela de aprovação
--    nunca teria o que listar — o pedido de autorização era gravado e morria ali.
--
-- 2) Não havia onde guardar uma ação de risco alto esperando decisão. No modo
--    automático o motor marcava o veredito 'aprovacao' no log e SEGUIA — a ação
--    era silenciosamente descartada e ninguém era chamado para decidir. O log
--    dizia "precisa de aprovação" sem que existisse aprovação para dar.
--
-- Ambas as tabelas são SÓ LEITURA para o staff. Quem decide é a Edge Function
-- whatsapp-ai-decide, com service role. Isso é deliberado: se a tela pudesse dar
-- UPDATE direto no status, daria para marcar uma reunião como "autorizada" sem
-- que o cliente fosse avisado e sem que a ação fosse de fato executada. A decisão
-- e o efeito da decisão têm de sair do mesmo lugar.
-- ============================================================================

-- ── 1) Políticas que faltaram nos pedidos de reunião ────────────────────────
DROP POLICY IF EXISTS wa_ai_meetings_staff_read ON public.whatsapp_ai_meeting_requests;
CREATE POLICY wa_ai_meetings_staff_read ON public.whatsapp_ai_meeting_requests
  FOR SELECT TO authenticated
  USING (public.is_office_staff());

-- ── 2) Ações de risco alto aguardando decisão ───────────────────────────────
-- Uma linha por chamada de gatilho que o modelo quis fazer e a barreira segurou.
-- O argumento vai inteiro em `args` porque é ele que será executado depois da
-- aprovação: aprovar tem de executar EXATAMENTE o que foi mostrado a quem
-- aprovou, não uma reconstrução aproximada.
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_tool_approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  agent_id          uuid REFERENCES public.whatsapp_ai_agents(id) ON DELETE SET NULL,

  tool_name         text NOT NULL,
  args              jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk              text NOT NULL DEFAULT 'alto' CHECK (risk IN ('baixo','medio','alto')),

  -- A resposta que o agente pretendia mandar junto. Fica guardada para quem
  -- decide ler a ação no contexto da frase que a acompanharia.
  reply_text        text,

  status            text NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente','aprovada','recusada','expirada')),

  decided_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  reason            text,

  -- Resultado da execução DEPOIS do "sim". Separado de `status` de propósito:
  -- aprovada-e-falhou é um estado real e precisa ser visível, não pode se
  -- disfarçar de aprovada-e-pronto.
  executed_at       timestamptz,
  execution_ok      boolean,
  execution_detail  text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_ai_approvals_conversa
  ON public.whatsapp_ai_tool_approvals (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_ai_approvals_pendentes
  ON public.whatsapp_ai_tool_approvals (created_at DESC)
  WHERE status = 'pendente';

DROP TRIGGER IF EXISTS trg_wa_ai_approvals_touch ON public.whatsapp_ai_tool_approvals;
CREATE TRIGGER trg_wa_ai_approvals_touch BEFORE UPDATE ON public.whatsapp_ai_tool_approvals
  FOR EACH ROW EXECUTE FUNCTION public.wa_ai_touch();

ALTER TABLE public.whatsapp_ai_tool_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_ai_approvals_staff_read ON public.whatsapp_ai_tool_approvals;
CREATE POLICY wa_ai_approvals_staff_read ON public.whatsapp_ai_tool_approvals
  FOR SELECT TO authenticated
  USING (public.is_office_staff());
