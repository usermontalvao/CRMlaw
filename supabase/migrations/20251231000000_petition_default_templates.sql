-- Migration: Create petition_default_templates table
-- Date: 2025-12-31
-- Description: Table to store user's default petition template (replaces localStorage)

CREATE TABLE IF NOT EXISTS petition_default_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- RLS: Users can only access their own default template
ALTER TABLE petition_default_templates ENABLE ROW LEVEL SECURITY;

-- Reaplicação segura (evita erro 42710 em policies já existentes)
DROP POLICY IF EXISTS "Users can view their own default template" ON petition_default_templates;
DROP POLICY IF EXISTS "Users can insert their own default template" ON petition_default_templates;
DROP POLICY IF EXISTS "Users can update their own default template" ON petition_default_templates;
DROP POLICY IF EXISTS "Users can delete their own default template" ON petition_default_templates;

CREATE POLICY "Users can view their own default template" ON petition_default_templates
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own default template" ON petition_default_templates
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own default template" ON petition_default_templates
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own default template" ON petition_default_templates
  FOR DELETE USING (auth.uid() = user_id);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_petition_default_templates_user_id ON petition_default_templates(user_id);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_petition_default_templates_updated_at ON petition_default_templates;

CREATE TRIGGER update_petition_default_templates_updated_at
  BEFORE UPDATE ON petition_default_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
