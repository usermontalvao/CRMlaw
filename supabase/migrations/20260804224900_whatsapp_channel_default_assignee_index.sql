-- Acelera a manutenção da FK (inclusive ON DELETE SET NULL) quando um perfil é removido.
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_default_assignee
  ON public.whatsapp_instances (default_assignee_id);
