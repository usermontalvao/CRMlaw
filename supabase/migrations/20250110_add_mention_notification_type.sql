-- Adicionar tipo 'mention' ao enum user_notification_type
ALTER TYPE user_notification_type ADD VALUE IF NOT EXISTS 'mention';
