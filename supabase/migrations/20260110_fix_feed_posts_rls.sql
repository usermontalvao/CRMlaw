-- FIX: Corrigir RLS de feed_posts para posts privados/equipe
-- Posts privados NÃO devem aparecer para mencionados, apenas para destinatários selecionados

-- Remover política antiga que permitia ver posts privados via mentions
DROP POLICY IF EXISTS "Usuários podem ver posts baseado em visibilidade" ON feed_posts;
DROP POLICY IF EXISTS "Usuários podem ver todos os posts" ON feed_posts;

-- Adicionar colunas de audiência se não existirem
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS allowed_user_ids UUID[] DEFAULT '{}';
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS allowed_roles TEXT[] DEFAULT '{}';

-- Criar índices se não existirem
CREATE INDEX IF NOT EXISTS idx_feed_posts_allowed_user_ids ON feed_posts USING GIN(allowed_user_ids);
CREATE INDEX IF NOT EXISTS idx_feed_posts_allowed_roles ON feed_posts USING GIN(allowed_roles);

-- Criar política correta de visualização
CREATE POLICY "Usuários podem ver posts baseado em visibilidade" ON feed_posts
  FOR SELECT USING (
    -- Posts públicos: todos veem
    visibility = 'public'
    OR visibility IS NULL
    OR
    -- Autor sempre vê seus próprios posts
    auth.uid() = author_id
    OR
    -- Posts privados/equipe: usuário deve estar na lista allowed_user_ids
    (visibility IN ('private', 'team') AND auth.uid() = ANY(allowed_user_ids))
    OR
    -- Posts privados/equipe: cargo do usuário deve estar na lista allowed_roles
    (
      visibility IN ('private', 'team')
      AND array_length(allowed_roles, 1) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM profiles p
        WHERE p.user_id = auth.uid()
          AND p.role = ANY(allowed_roles)
      )
    )
  );

COMMENT ON COLUMN feed_posts.allowed_user_ids IS 'Lista de user_ids que podem ver o post (para visibility = private/team)';
COMMENT ON COLUMN feed_posts.allowed_roles IS 'Lista de cargos/departamentos que podem ver o post (para visibility = private/team)';
