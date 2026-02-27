-- Migration: Explorer de Pastas no Módulo de Assinaturas (pastas/subpastas + organização via drag-and-drop)
-- Criado em: 2026-02-27

-- Pastas (hierarquia)
CREATE TABLE IF NOT EXISTS signature_explorer_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  parent_id UUID REFERENCES signature_explorer_folders(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signature_explorer_folders_parent_id ON signature_explorer_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_signature_explorer_folders_sort_order ON signature_explorer_folders(sort_order);

-- Vínculo de itens ao Explorer (permite organizar diferentes tipos de item na mesma árvore)
-- Regra: apenas o usuário que criou o vínculo pode mover/alterar aquele item no Explorer.
CREATE TABLE IF NOT EXISTS signature_explorer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type VARCHAR(40) NOT NULL CHECK (item_type IN ('signature_request', 'generated_document')),
  item_id UUID NOT NULL,
  folder_id UUID REFERENCES signature_explorer_folders(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_signature_explorer_items_folder_id ON signature_explorer_items(folder_id);
CREATE INDEX IF NOT EXISTS idx_signature_explorer_items_created_by ON signature_explorer_items(created_by);
CREATE INDEX IF NOT EXISTS idx_signature_explorer_items_type_id ON signature_explorer_items(item_type, item_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_signature_explorer_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_signature_explorer_folders_updated_at ON signature_explorer_folders;
CREATE TRIGGER trigger_signature_explorer_folders_updated_at
  BEFORE UPDATE ON signature_explorer_folders
  FOR EACH ROW
  EXECUTE FUNCTION update_signature_explorer_updated_at();

DROP TRIGGER IF EXISTS trigger_signature_explorer_items_updated_at ON signature_explorer_items;
CREATE TRIGGER trigger_signature_explorer_items_updated_at
  BEFORE UPDATE ON signature_explorer_items
  FOR EACH ROW
  EXECUTE FUNCTION update_signature_explorer_updated_at();

-- RLS
ALTER TABLE signature_explorer_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_explorer_items ENABLE ROW LEVEL SECURITY;

-- Pastas globais: qualquer autenticado pode ver/criar/editar/excluir
DROP POLICY IF EXISTS "authenticated_select_signature_explorer_folders" ON signature_explorer_folders;
CREATE POLICY "authenticated_select_signature_explorer_folders"
  ON signature_explorer_folders FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated_insert_signature_explorer_folders" ON signature_explorer_folders;
CREATE POLICY "authenticated_insert_signature_explorer_folders"
  ON signature_explorer_folders FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_update_signature_explorer_folders" ON signature_explorer_folders;
CREATE POLICY "authenticated_update_signature_explorer_folders"
  ON signature_explorer_folders FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_delete_signature_explorer_folders" ON signature_explorer_folders;
CREATE POLICY "authenticated_delete_signature_explorer_folders"
  ON signature_explorer_folders FOR DELETE
  TO authenticated
  USING (true);

-- Itens: qualquer autenticado pode ver (para o explorer global),
-- mas só o criador do vínculo pode mover/alterar/excluir o vínculo.
DROP POLICY IF EXISTS "authenticated_select_signature_explorer_items" ON signature_explorer_items;
CREATE POLICY "authenticated_select_signature_explorer_items"
  ON signature_explorer_items FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated_insert_signature_explorer_items" ON signature_explorer_items;
CREATE POLICY "authenticated_insert_signature_explorer_items"
  ON signature_explorer_items FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "authenticated_update_signature_explorer_items" ON signature_explorer_items;
CREATE POLICY "authenticated_update_signature_explorer_items"
  ON signature_explorer_items FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "authenticated_delete_signature_explorer_items" ON signature_explorer_items;
CREATE POLICY "authenticated_delete_signature_explorer_items"
  ON signature_explorer_items FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());
