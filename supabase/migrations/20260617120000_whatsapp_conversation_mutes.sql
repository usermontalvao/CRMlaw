-- Silenciar conversa por usuário (notificações). Estilo WhatsApp: 8h, 1 semana
-- ou "sempre". Por-usuário (não global) — silenciar para mim não afeta os colegas.
CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_mutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- NULL = silenciada para sempre; senão, silenciada até este instante.
  muted_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

COMMENT ON TABLE public.whatsapp_conversation_mutes IS
  'Conversas silenciadas por usuário para fins de notificação (som/visual). muted_until NULL = para sempre; presença da linha = silenciada (respeitar expiração no app).';

CREATE INDEX IF NOT EXISTS idx_wa_conv_mutes_user ON public.whatsapp_conversation_mutes(user_id);

ALTER TABLE public.whatsapp_conversation_mutes ENABLE ROW LEVEL SECURITY;

-- Cada usuário só enxerga/gerencia os próprios silenciamentos.
CREATE POLICY "mutes_select_own" ON public.whatsapp_conversation_mutes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "mutes_insert_own" ON public.whatsapp_conversation_mutes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "mutes_update_own" ON public.whatsapp_conversation_mutes
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "mutes_delete_own" ON public.whatsapp_conversation_mutes
  FOR DELETE USING (auth.uid() = user_id);

-- Realtime para sincronizar o estado de silenciamento entre dispositivos.
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversation_mutes;
