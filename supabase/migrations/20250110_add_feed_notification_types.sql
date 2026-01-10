-- Adicionar novos tipos de notificação para feed (curtidas e comentários)
-- Executar no Supabase SQL Editor

-- Adicionar feed_like ao enum
ALTER TYPE user_notification_type ADD VALUE IF NOT EXISTS 'feed_like';

-- Adicionar feed_comment ao enum
ALTER TYPE user_notification_type ADD VALUE IF NOT EXISTS 'feed_comment';
