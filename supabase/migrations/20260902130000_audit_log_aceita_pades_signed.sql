-- A trilha de auditoria passa a aceitar o selo criptográfico.
--
-- Sem isto o INSERT do `pades-sign` bateria no CHECK e a função seguiria em
-- frente sem registrar nada: o arquivo sairia selado e a trilha não contaria.
-- É a mesma armadilha do `event_type: 'reuniao'` em calendar_events — tipo novo
-- em união de TypeScript não avisa que o banco não conhece o valor.
ALTER TABLE public.signature_audit_log
  DROP CONSTRAINT IF EXISTS signature_audit_log_action_check;

ALTER TABLE public.signature_audit_log
  ADD CONSTRAINT signature_audit_log_action_check
  CHECK (action::text = ANY (ARRAY[
    'created', 'sent', 'viewed', 'signed', 'cancelled', 'expired',
    'reminder_sent', 'refused', 'finalized', 'finalization_failed',
    'integrity_verified', 'integrity_violation', 'pades_signed'
  ]::text[]));
