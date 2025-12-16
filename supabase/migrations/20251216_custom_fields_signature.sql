-- Permitir tipo 'signature' nos campos personalizados globais

DO $$
BEGIN
  -- Constraint padrão gerada pelo Postgres para o CHECK na coluna field_type
  ALTER TABLE IF EXISTS public.document_custom_fields
    DROP CONSTRAINT IF EXISTS document_custom_fields_field_type_check;

  ALTER TABLE IF EXISTS public.document_custom_fields
    ADD CONSTRAINT document_custom_fields_field_type_check
    CHECK (field_type IN ('text', 'number', 'date', 'select', 'textarea', 'currency', 'signature'));

  -- Campo padrão para assinatura (se não existir)
  INSERT INTO public.document_custom_fields (name, placeholder, field_type, required, "order")
  SELECT
    'Assinatura',
    'ASSINATURA',
    'signature',
    true,
    COALESCE((SELECT MAX("order") + 1 FROM public.document_custom_fields), 0)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.document_custom_fields WHERE placeholder = 'ASSINATURA'
  );
END $$;
