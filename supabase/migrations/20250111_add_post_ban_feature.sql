-- Adicionar campos para banimento de posts
ALTER TABLE feed_posts 
ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS banned_by UUID REFERENCES profiles(user_id) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS banned_reason TEXT DEFAULT NULL;

-- Criar índice para posts banidos
CREATE INDEX IF NOT EXISTS idx_feed_posts_banned ON feed_posts(banned_at) WHERE banned_at IS NOT NULL;

-- Comentário explicativo
COMMENT ON COLUMN feed_posts.banned_at IS 'Data/hora em que o post foi banido';
COMMENT ON COLUMN feed_posts.banned_by IS 'ID do administrador que baniu o post';
COMMENT ON COLUMN feed_posts.banned_reason IS 'Motivo do banimento (opcional)';
