-- Adicionar campos de visibilidade e agendamento nos posts do feed

-- Visibilidade: 'public' (todos veem), 'private' (só mencionados veem), 'team' (só equipe)
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'public';

-- Agendamento: data/hora para publicação futura (NULL = publicar imediatamente)
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ DEFAULT NULL;

-- Status do post: 'published', 'scheduled', 'draft'
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'published';

-- Índice para posts agendados
CREATE INDEX IF NOT EXISTS idx_feed_posts_scheduled ON feed_posts(scheduled_at) WHERE scheduled_at IS NOT NULL;

-- Índice para visibilidade
CREATE INDEX IF NOT EXISTS idx_feed_posts_visibility ON feed_posts(visibility);

-- Atualizar política de visualização para respeitar visibilidade
DROP POLICY IF EXISTS "Usuários podem ver todos os posts" ON feed_posts;
CREATE POLICY "Usuários podem ver posts baseado em visibilidade" ON feed_posts
  FOR SELECT USING (
    -- Posts públicos: todos veem
    visibility = 'public'
    OR
    -- Posts privados: autor ou mencionados veem
    (visibility = 'private' AND (auth.uid() = author_id OR auth.uid() = ANY(mentions)))
    OR
    -- Posts de equipe: todos autenticados veem
    (visibility = 'team' AND auth.uid() IS NOT NULL)
  );

-- Comentário explicativo
COMMENT ON COLUMN feed_posts.visibility IS 'Visibilidade do post: public (todos), private (só mencionados), team (equipe)';
COMMENT ON COLUMN feed_posts.scheduled_at IS 'Data/hora para publicação agendada. NULL = publicar imediatamente';
COMMENT ON COLUMN feed_posts.status IS 'Status: published, scheduled, draft';
