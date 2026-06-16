-- Permite encerrar o acompanhamento de uma assinatura na conversa do WhatsApp
-- mesmo quando não existe template_fill_link vinculado (assinatura criada fora
-- do fluxo de kit). O painel "Assinaturas pendentes" e o resumo do topo passam
-- a respeitar esta flag.
ALTER TABLE public.signature_requests
  ADD COLUMN IF NOT EXISTS wa_tracking_stopped boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.signature_requests.wa_tracking_stopped IS
  'Quando true, o operador encerrou o acompanhamento desta assinatura na conversa do WhatsApp (some do painel ASSINATURAS PENDENTES), mesmo sem template_fill_link vinculado.';
