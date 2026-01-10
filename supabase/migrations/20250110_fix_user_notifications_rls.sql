-- Corrigir RLS para permitir criar notificações para outros usuários
-- (necessário para notificações de menção)

-- Adicionar tipo 'mention' ao enum se não existir
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'mention' AND enumtypid = 'user_notification_type'::regtype) THEN
    ALTER TYPE user_notification_type ADD VALUE 'mention';
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;

-- Permitir que usuários autenticados criem notificações para outros usuários
DROP POLICY IF EXISTS "Users can create notifications for others" ON user_notifications;
CREATE POLICY "Users can create notifications for others"
  ON user_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Manter política de leitura apenas para o próprio usuário
DROP POLICY IF EXISTS "Users can view own notifications" ON user_notifications;
CREATE POLICY "Users can view own notifications"
  ON user_notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Permitir que usuários atualizem suas próprias notificações (marcar como lida)
DROP POLICY IF EXISTS "Users can update own notifications" ON user_notifications;
CREATE POLICY "Users can update own notifications"
  ON user_notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Permitir que usuários deletem suas próprias notificações
DROP POLICY IF EXISTS "Users can delete own notifications" ON user_notifications;
CREATE POLICY "Users can delete own notifications"
  ON user_notifications
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
