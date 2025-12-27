-- Fix RLS policy for user_notifications table
-- Allow authenticated users to insert notifications for themselves

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view their own notifications" ON user_notifications;
DROP POLICY IF EXISTS "Users can insert their own notifications" ON user_notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON user_notifications;
DROP POLICY IF EXISTS "Users can delete their own notifications" ON user_notifications;

-- Enable RLS
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own notifications
CREATE POLICY "Users can view their own notifications"
ON user_notifications
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Policy: Users can insert notifications for themselves
CREATE POLICY "Users can insert their own notifications"
ON user_notifications
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own notifications
CREATE POLICY "Users can update their own notifications"
ON user_notifications
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own notifications
CREATE POLICY "Users can delete their own notifications"
ON user_notifications
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
