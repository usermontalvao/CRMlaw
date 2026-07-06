ALTER TABLE public.signature_audit_log
  DROP CONSTRAINT IF EXISTS signature_audit_log_action_check;

ALTER TABLE public.signature_audit_log
  ADD CONSTRAINT signature_audit_log_action_check
  CHECK (
    action IN (
      'created',
      'sent',
      'viewed',
      'signed',
      'cancelled',
      'expired',
      'reminder_sent',
      'refused',
      'finalized',
      'finalization_failed'
    )
  );
