-- Migration: backfill definitivo para vincular blocos existentes à área Trabalhista
-- Este arquivo foi criado para garantir ordenação após a criação de legal_areas.

DO $$
DECLARE
  v_trabalhista_id UUID;
BEGIN
  IF to_regclass('public.legal_areas') IS NULL THEN
    RAISE EXCEPTION 'Tabela legal_areas não existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'petition_blocks' AND column_name = 'legal_area_id'
  ) THEN
    RAISE EXCEPTION 'Coluna petition_blocks.legal_area_id não existe';
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

  UPDATE petition_blocks
     SET legal_area_id = v_trabalhista_id
   WHERE legal_area_id IS NULL;
END $$;
