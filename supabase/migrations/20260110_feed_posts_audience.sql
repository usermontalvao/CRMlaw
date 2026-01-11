-- Audience targeting for Feed posts (per-user / per-role)

-- Add arrays that determine who can view private/team posts.
-- Note: "roles" here are the values from profiles.role (used as a department/group proxy).

ALTER TABLE feed_posts
  ADD COLUMN IF NOT EXISTS allowed_user_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allowed_roles TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_feed_posts_allowed_user_ids ON feed_posts USING GIN(allowed_user_ids);
CREATE INDEX IF NOT EXISTS idx_feed_posts_allowed_roles ON feed_posts USING GIN(allowed_roles);

-- Update SELECT policy to respect the new audience fields.
DROP POLICY IF EXISTS "Usuários podem ver posts baseado em visibilidade" ON feed_posts;
CREATE POLICY "Usuários podem ver posts baseado em visibilidade" ON feed_posts
  FOR SELECT USING (
    -- Public: everyone can see
    visibility = 'public'
    OR
    -- Author always sees their own posts
    auth.uid() = author_id
    OR
    -- Private/team: user must be in allowed_user_ids list
    (visibility IN ('private', 'team') AND auth.uid() = ANY(allowed_user_ids))
    OR
    -- Private/team: user's role must be in allowed_roles list
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

COMMENT ON COLUMN feed_posts.allowed_user_ids IS 'Lista de user_ids (UUID) que podem visualizar o post quando visibility != public';
COMMENT ON COLUMN feed_posts.allowed_roles IS 'Lista de roles/departamentos (profiles.role) que podem visualizar o post quando visibility != public';
