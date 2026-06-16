ALTER TABLE public.template_fill_links
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS followup_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS followup_last_at timestamptz,
  ADD COLUMN IF NOT EXISTS followup_stopped boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_template_fill_links_client_id
  ON public.template_fill_links(client_id);

CREATE INDEX IF NOT EXISTS idx_template_fill_links_conversation_id
  ON public.template_fill_links(conversation_id);

CREATE INDEX IF NOT EXISTS idx_template_fill_links_last_seen_at
  ON public.template_fill_links(last_seen_at);

COMMENT ON COLUMN public.template_fill_links.client_id IS
  'Cliente vinculado ao link de preenchimento quando ele é gerado a partir de uma conversa.';

COMMENT ON COLUMN public.template_fill_links.conversation_id IS
  'Conversa do WhatsApp onde o link de preenchimento foi gerado.';

COMMENT ON COLUMN public.template_fill_links.opened_at IS
  'Primeira vez em que o cliente abriu a página pública de preenchimento.';

COMMENT ON COLUMN public.template_fill_links.last_seen_at IS
  'Último heartbeat/atividade observada na página pública de preenchimento.';

COMMENT ON COLUMN public.template_fill_links.followup_count IS
  'Quantidade de lembretes automáticos enviados para este link de preenchimento.';

COMMENT ON COLUMN public.template_fill_links.followup_last_at IS
  'Momento do último follow-up automático enviado para este link de preenchimento.';

COMMENT ON COLUMN public.template_fill_links.followup_stopped IS
  'Quando true, interrompe o acompanhamento/follow-up do link na conversa.';
