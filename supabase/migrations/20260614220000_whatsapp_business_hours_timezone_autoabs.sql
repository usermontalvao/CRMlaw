-- Fase N (continuação): timezone por canal + cooldown de mensagem de ausência automática

-- Timezone operacional por canal (IANA: 'America/Cuiaba', 'America/Manaus', etc.)
ALTER TABLE whatsapp_instances
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Cuiaba';

-- Cooldown anti-loop: última vez que enviamos mensagem automática de ausência nesta conversa
ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS absence_sent_at TIMESTAMPTZ;
