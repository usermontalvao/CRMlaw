-- Tabela para posts do feed com tags integradas
CREATE TABLE IF NOT EXISTS feed_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL,
  content TEXT NOT NULL,
  
  -- Tags do sistema (array de strings como 'financeiro', 'cliente', 'processo', etc)
  tags TEXT[] DEFAULT '{}',
  
  -- Menções de usuários (array de UUIDs)
  mentions UUID[] DEFAULT '{}',
  
  -- Referências a entidades do sistema (JSONB para flexibilidade)
  -- Exemplo: [{"type": "client", "id": "uuid", "name": "João"}, {"type": "process", "id": "uuid", "number": "123"}]
  entity_references JSONB DEFAULT '[]',
  
  -- Dados de preview (JSONB para armazenar snapshots de dados no momento do post)
  -- Exemplo: {"financeiro": {"recebido": 1500, "pendente": 500}, "cliente": {"nome": "João", "cpf": "123"}}
  preview_data JSONB DEFAULT '{}',
  
  -- Contadores
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela para likes nos posts
CREATE TABLE IF NOT EXISTS feed_post_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- Tabela para comentários nos posts
CREATE TABLE IF NOT EXISTS feed_post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_feed_posts_created ON feed_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_posts_tags ON feed_posts USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_feed_post_likes_post ON feed_post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_feed_post_likes_user ON feed_post_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_post_comments_post ON feed_post_comments(post_id);

-- RLS Policies
ALTER TABLE feed_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_post_comments ENABLE ROW LEVEL SECURITY;

-- Políticas para feed_posts
DROP POLICY IF EXISTS "Usuários podem ver todos os posts" ON feed_posts;
CREATE POLICY "Usuários podem ver todos os posts" ON feed_posts
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Usuários podem criar posts" ON feed_posts;
CREATE POLICY "Usuários podem criar posts" ON feed_posts
  FOR INSERT WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "Usuários podem editar seus próprios posts" ON feed_posts;
CREATE POLICY "Usuários podem editar seus próprios posts" ON feed_posts
  FOR UPDATE USING (auth.uid() = author_id);

DROP POLICY IF EXISTS "Usuários podem deletar seus próprios posts" ON feed_posts;
CREATE POLICY "Usuários podem deletar seus próprios posts" ON feed_posts
  FOR DELETE USING (auth.uid() = author_id);

-- Políticas para feed_post_likes
DROP POLICY IF EXISTS "Usuários podem ver todos os likes" ON feed_post_likes;
CREATE POLICY "Usuários podem ver todos os likes" ON feed_post_likes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Usuários podem dar like" ON feed_post_likes;
CREATE POLICY "Usuários podem dar like" ON feed_post_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Usuários podem remover seu like" ON feed_post_likes;
CREATE POLICY "Usuários podem remover seu like" ON feed_post_likes
  FOR DELETE USING (auth.uid() = user_id);

-- Políticas para feed_post_comments
DROP POLICY IF EXISTS "Usuários podem ver todos os comentários" ON feed_post_comments;
CREATE POLICY "Usuários podem ver todos os comentários" ON feed_post_comments
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Usuários podem criar comentários" ON feed_post_comments;
CREATE POLICY "Usuários podem criar comentários" ON feed_post_comments
  FOR INSERT WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "Usuários podem editar seus próprios comentários" ON feed_post_comments;
CREATE POLICY "Usuários podem editar seus próprios comentários" ON feed_post_comments
  FOR UPDATE USING (auth.uid() = author_id);

DROP POLICY IF EXISTS "Usuários podem deletar seus próprios comentários" ON feed_post_comments;
CREATE POLICY "Usuários podem deletar seus próprios comentários" ON feed_post_comments
  FOR DELETE USING (auth.uid() = author_id);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_feed_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_feed_posts_updated_at ON feed_posts;
CREATE TRIGGER trigger_feed_posts_updated_at
  BEFORE UPDATE ON feed_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_feed_posts_updated_at();

DROP TRIGGER IF EXISTS trigger_feed_post_comments_updated_at ON feed_post_comments;
CREATE TRIGGER trigger_feed_post_comments_updated_at
  BEFORE UPDATE ON feed_post_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_feed_posts_updated_at();

-- Função para incrementar/decrementar likes_count
CREATE OR REPLACE FUNCTION update_post_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE feed_posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE feed_posts SET likes_count = likes_count - 1 WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_likes_count ON feed_post_likes;
CREATE TRIGGER trigger_update_likes_count
  AFTER INSERT OR DELETE ON feed_post_likes
  FOR EACH ROW
  EXECUTE FUNCTION update_post_likes_count();

-- Função para incrementar/decrementar comments_count
CREATE OR REPLACE FUNCTION update_post_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE feed_posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE feed_posts SET comments_count = comments_count - 1 WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_comments_count ON feed_post_comments;
CREATE TRIGGER trigger_update_comments_count
  AFTER INSERT OR DELETE ON feed_post_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_post_comments_count();
