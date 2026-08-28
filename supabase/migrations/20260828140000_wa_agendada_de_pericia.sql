-- O aviso de perícia passa a saber DE QUEM ele é.
--
-- Antes o lembrete era uma agendada como qualquer outra: nada ligava a linha ao
-- requerimento. Isso deixava dois buracos reais:
--
--  · REAGENDAR A PERÍCIA NÃO CANCELAVA O AVISO ANTIGO. O INSS remarca, alguém
--    corrige a data no CRM, e o lembrete da data velha continuava na fila para
--    sair — dizendo ao cliente que compareça num dia que não existe mais.
--
--  · A FICHA NÃO SABIA DIZER SE HAVIA AVISO. Quem abria o requerimento não
--    tinha como saber se o cliente já seria lembrado ou não, e a saída era
--    agendar de novo "por via das dúvidas".
--
-- Duas colunas resolvem os dois.

ALTER TABLE public.whatsapp_scheduled_messages
  ADD COLUMN IF NOT EXISTS requirement_id uuid NULL REFERENCES public.requirements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pericia_kind text NULL;

ALTER TABLE public.whatsapp_scheduled_messages
  DROP CONSTRAINT IF EXISTS whatsapp_scheduled_messages_pericia_kind_check;

ALTER TABLE public.whatsapp_scheduled_messages
  ADD CONSTRAINT whatsapp_scheduled_messages_pericia_kind_check
  CHECK (pericia_kind IS NULL OR pericia_kind IN ('social', 'medica'));

CREATE INDEX IF NOT EXISTS idx_wa_sched_requirement
  ON public.whatsapp_scheduled_messages (requirement_id, status)
  WHERE requirement_id IS NOT NULL;

COMMENT ON COLUMN public.whatsapp_scheduled_messages.requirement_id IS
  'Requerimento cujo agendamento de perícia gerou este aviso. NULL nas agendadas comuns de atendente.';
COMMENT ON COLUMN public.whatsapp_scheduled_messages.pericia_kind IS
  'Qual perícia este aviso lembra: social ou medica. NULL nas agendadas comuns.';

-- ── Aviso de perícia é do ESCRITÓRIO, não de quem o digitou ──────────────────
--
-- A regra geral da tabela é certa: follow-up é pessoal, e só o autor (ou a
-- supervisão) mexe. O aviso de perícia é outra coisa — ele pertence ao
-- requerimento. Se a Ana agendou e o Bruno remarca a perícia, o cancelamento do
-- aviso velho tem de sair pelas mãos do Bruno; senão a correção da data deixa
-- para trás um lembrete errado que ninguém consegue desarmar.
--
-- A brecha é estreita de propósito: vale SÓ para linha com `requirement_id`, só
-- para quem é do escritório, e não permite transformar uma agendada pessoal em
-- agendada de perícia (o USING exige que ela já seja uma).
DROP POLICY IF EXISTS wa_sched_update_pericia ON public.whatsapp_scheduled_messages;
CREATE POLICY wa_sched_update_pericia ON public.whatsapp_scheduled_messages
  FOR UPDATE
  USING (requirement_id IS NOT NULL AND is_office_staff())
  WITH CHECK (requirement_id IS NOT NULL AND is_office_staff());
