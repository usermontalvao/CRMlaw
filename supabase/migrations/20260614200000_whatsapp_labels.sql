-- Fase M: etiquetas/tags nas conversas WhatsApp
-- Coluna TEXT[] simples — sem tabela separada; tags pré-definidas gerenciadas no frontend.

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}';

-- Índice GIN para filtragem eficiente por tag.
CREATE INDEX IF NOT EXISTS idx_wa_conversations_labels
  ON whatsapp_conversations USING GIN (labels);
