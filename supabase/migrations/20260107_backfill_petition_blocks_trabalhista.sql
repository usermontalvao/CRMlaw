-- Migration: vincular blocos existentes à área Trabalhista
-- Objetivo: garantir que os blocos atuais (antes do recurso de Áreas Jurídicas) fiquem sob "Trabalhista",
-- evitando que apareçam em outras áreas como Cível.

DO $$
DECLARE
  v_trabalhista_id UUID;
BEGIN
  -- Se a tabela legal_areas ainda não existir, não falhar.
  IF to_regclass('public.legal_areas') IS NULL THEN
    RETURN;
  END IF;

  -- Se a coluna legal_area_id ainda não existir, não falhar.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'petition_blocks' AND column_name = 'legal_area_id'
  ) THEN
    RETURN;
  END IF;

  SELECT id
    INTO v_trabalhista_id
  FROM legal_areas
  WHERE lower(name) = 'trabalhista'
  ORDER BY "order" ASC
  LIMIT 1;

  IF v_trabalhista_id IS NULL THEN
    RAISE EXCEPTION 'Área jurídica "Trabalhista" não encontrada em legal_areas';
  END IF;

  -- Vincular todos os blocos existentes que ainda estão sem área
  UPDATE petition_blocks
     SET legal_area_id = v_trabalhista_id
   WHERE legal_area_id IS NULL;
END $$;
