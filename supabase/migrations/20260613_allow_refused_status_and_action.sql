-- Permitir status 'refused' no signatário e ação 'refused' no audit log
ALTER TABLE public.signature_signers DROP CONSTRAINT IF EXISTS signature_signers_status_check;
ALTER TABLE public.signature_signers ADD CONSTRAINT signature_signers_status_check
  CHECK (status::text = ANY (ARRAY['pending','signed','expired','cancelled','refused']::text[]));

ALTER TABLE public.signature_audit_log DROP CONSTRAINT IF EXISTS signature_audit_log_action_check;
ALTER TABLE public.signature_audit_log ADD CONSTRAINT signature_audit_log_action_check
  CHECK (action::text = ANY (ARRAY['created','sent','viewed','signed','cancelled','expired','reminder_sent','refused']::text[]));
