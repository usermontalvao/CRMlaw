-- ============================================================================
-- Pedidos de reunião propostos pelo atendente de IA
--
-- ESTA MIGRATION FOI APLICADA DIRETO EM PRODUÇÃO e o arquivo ficou faltando no
-- repositório. Está sendo reposta aqui com a versão exata que o banco registrou
-- (20260808135420) para que o histórico volte a bater. É idempotente de ponta a
-- ponta: rodar de novo sobre o banco atual não muda nada.
--
-- O que ela sustenta: @MarcarReuniao é risco ALTO, então o horário nunca entra
-- confirmado. O gatilho reserva o compromisso em calendar_events com
-- status='pendente' e abre uma linha aqui pedindo autorização humana. Só depois
-- de alguém decidir é que o cliente é avisado — e é o campo client_notified_at
-- que prova que o aviso saiu.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_ai_meeting_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  agent_id           uuid REFERENCES public.whatsapp_ai_agents(id) ON DELETE SET NULL,
  client_id          uuid REFERENCES public.clients(id) ON DELETE SET NULL,

  -- O compromisso já reservado na agenda, ainda como pendente.
  calendar_event_id  uuid REFERENCES public.calendar_events(id) ON DELETE SET NULL,

  proposed_at        timestamptz NOT NULL,
  subject            text NOT NULL,

  status             text NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente','autorizada','remarcada','recusada')),

  -- Preenchido quando o responsável escolhe OUTRO horário em vez do proposto.
  rescheduled_at     timestamptz,

  decided_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  reason             text,

  -- Só recebe carimbo depois que a mensagem chega ao cliente de verdade.
  client_notified_at timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_ai_meetings_conversa
  ON public.whatsapp_ai_meeting_requests (conversation_id, created_at DESC);

-- A fila de trabalho da tela de aprovações: só as que ainda esperam decisão.
CREATE INDEX IF NOT EXISTS idx_wa_ai_meetings_pendentes
  ON public.whatsapp_ai_meeting_requests (created_at DESC)
  WHERE status = 'pendente';

DROP TRIGGER IF EXISTS trg_wa_ai_meetings_touch ON public.whatsapp_ai_meeting_requests;
CREATE TRIGGER trg_wa_ai_meetings_touch BEFORE UPDATE ON public.whatsapp_ai_meeting_requests
  FOR EACH ROW EXECUTE FUNCTION public.wa_ai_touch();

ALTER TABLE public.whatsapp_ai_meeting_requests ENABLE ROW LEVEL SECURITY;
