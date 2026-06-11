-- Add sidebar_mode preference to profiles table
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sidebar_mode VARCHAR(10)
    DEFAULT 'compact'
    CHECK (sidebar_mode IN ('compact', 'normal'));
