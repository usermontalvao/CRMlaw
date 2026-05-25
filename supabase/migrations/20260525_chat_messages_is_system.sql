-- Adiciona coluna is_system em chat_messages para marcar mensagens de evento
-- (nudge, entradas/saídas, etc.) que são renderizadas de forma diferente na UI
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_chat_messages_is_system ON chat_messages(room_id) WHERE is_system = true;
