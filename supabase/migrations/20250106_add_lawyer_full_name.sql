-- Migration: Add lawyer_full_name column to profiles table
-- Description: Adds a field for storing the lawyer's full name for DJEN searches
-- This allows the display name to be different from the search name in official journals

-- Add the column
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS lawyer_full_name TEXT;

-- Add comment to document the column
COMMENT ON COLUMN profiles.lawyer_full_name IS 'Nome completo do advogado para pesquisa no Diário Oficial (DJEN). Pode ser diferente do nome de exibição.';

-- Create index for faster searches (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_profiles_lawyer_full_name ON profiles(lawyer_full_name);
