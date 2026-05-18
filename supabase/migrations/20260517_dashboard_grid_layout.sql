-- =====================================================================
-- Migration: Adiciona coluna grid_layout à tabela dashboard_preferences
-- Data: 2026-05-17
-- Descrição: Permite armazenar o layout completo do react-grid-layout
--            (posições x, y, w, h por breakpoint) de forma persistente
--            e sincronizada entre dispositivos.
--
-- SEGURANÇA EM PRODUÇÃO:
--   * Apenas ADD COLUMN IF NOT EXISTS (operação idempotente e aditiva)
--   * NENHUMA coluna existente é modificada ou removida
--   * NENHUM dado é deletado
--   * Reversível por simples não-uso da nova coluna
-- =====================================================================

-- 1. Adiciona coluna JSONB para armazenar o layout do react-grid-layout
--    Estrutura esperada (ResponsiveLayouts):
--    {
--      "lg":  [{ "i": "agenda", "x": 0, "y": 0, "w": 7, "h": 14 }, ...],
--      "md":  [...],
--      "sm":  [...],
--      "xs":  [...],
--      "xxs": [...]
--    }
ALTER TABLE dashboard_preferences
  ADD COLUMN IF NOT EXISTS grid_layout JSONB NULL;

-- 2. Comentário descritivo na coluna (auxilia documentação no Supabase Studio)
COMMENT ON COLUMN dashboard_preferences.grid_layout IS
  'Layout responsivo do react-grid-layout (posições x, y, w, h por breakpoint lg/md/sm/xs/xxs). NULL = usar layout default auto-ajustado.';

-- 3. Índice GIN opcional para queries em chaves específicas do JSON (futuro-proof)
CREATE INDEX IF NOT EXISTS idx_dashboard_preferences_grid_layout
  ON dashboard_preferences USING GIN (grid_layout);
