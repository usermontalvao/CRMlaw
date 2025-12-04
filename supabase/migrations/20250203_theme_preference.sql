-- Adicionar coluna theme_preference na tabela profiles se não existir
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'theme_preference') THEN
        ALTER TABLE profiles ADD COLUMN theme_preference VARCHAR(10) DEFAULT 'light';
        ALTER TABLE profiles ADD CONSTRAINT theme_preference_check CHECK (theme_preference IN ('light', 'dark', 'system'));
    END IF;
END $$;
