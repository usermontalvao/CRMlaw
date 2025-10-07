-- Migration: Create user_notifications table
-- Description: Stores individual notifications for users (assignments, reminders, etc.)

-- Create enum for notification types
CREATE TYPE user_notification_type AS ENUM (
  'deadline_assigned',
  'appointment_assigned',
  'process_updated',
  'intimation_new',
  'deadline_reminder',
  'appointment_reminder'
);

-- Create user_notifications table
CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type user_notification_type NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Optional references
  deadline_id UUID REFERENCES deadlines(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES calendar_events(id) ON DELETE CASCADE,
  process_id UUID REFERENCES processes(id) ON DELETE CASCADE,
  intimation_id UUID REFERENCES djen_comunicacoes(id) ON DELETE CASCADE,
  
  -- Metadata (JSON)
  metadata JSONB
);

-- Create indexes for performance
CREATE INDEX idx_user_notifications_user_id ON user_notifications(user_id);
CREATE INDEX idx_user_notifications_read ON user_notifications(read);
CREATE INDEX idx_user_notifications_created_at ON user_notifications(created_at DESC);
CREATE INDEX idx_user_notifications_user_read ON user_notifications(user_id, read);
CREATE INDEX idx_user_notifications_type ON user_notifications(type);

-- Add RLS policies
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY "Users can view own notifications"
  ON user_notifications
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
  ON user_notifications
  FOR UPDATE
  USING (auth.uid() = user_id);

-- System can insert notifications for any user
CREATE POLICY "System can insert notifications"
  ON user_notifications
  FOR INSERT
  WITH CHECK (true);

-- Users can delete their own notifications
CREATE POLICY "Users can delete own notifications"
  ON user_notifications
  FOR DELETE
  USING (auth.uid() = user_id);

-- Add comments
COMMENT ON TABLE user_notifications IS 'Stores individual notifications for users (assignments, reminders, updates)';
COMMENT ON COLUMN user_notifications.type IS 'Type of notification';
COMMENT ON COLUMN user_notifications.metadata IS 'Additional data in JSON format';
