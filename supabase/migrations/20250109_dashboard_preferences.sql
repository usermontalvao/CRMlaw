-- Tabela para armazenar preferências personalizadas do dashboard por usuário
CREATE TABLE IF NOT EXISTS dashboard_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  left_widgets TEXT[] NOT NULL DEFAULT ARRAY['agenda', 'tarefas', 'djen', 'confeccao']::TEXT[],
  right_widgets TEXT[] NOT NULL DEFAULT ARRAY['financeiro', 'navegacao']::TEXT[],
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Índice para busca rápida por usuário
CREATE INDEX IF NOT EXISTS idx_dashboard_preferences_user_id ON dashboard_preferences(user_id);

-- RLS (Row Level Security)
ALTER TABLE dashboard_preferences ENABLE ROW LEVEL SECURITY;

-- Política: Usuários podem ver suas próprias preferências
CREATE POLICY "Users can view own preferences"
  ON dashboard_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

-- Política: Usuários podem inserir suas próprias preferências
CREATE POLICY "Users can insert own preferences"
  ON dashboard_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Política: Usuários podem atualizar suas próprias preferências
CREATE POLICY "Users can update own preferences"
  ON dashboard_preferences
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Política: Usuários podem deletar suas próprias preferências
CREATE POLICY "Users can delete own preferences"
  ON dashboard_preferences
  FOR DELETE
  USING (auth.uid() = user_id);

-- Função para atualizar o timestamp automaticamente
CREATE OR REPLACE FUNCTION update_dashboard_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar o timestamp
CREATE TRIGGER trigger_update_dashboard_preferences_updated_at
  BEFORE UPDATE ON dashboard_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_dashboard_preferences_updated_at();
