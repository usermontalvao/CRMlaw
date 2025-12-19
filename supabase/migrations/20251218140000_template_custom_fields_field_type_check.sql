-- Permitir novos tipos no field_type de template_custom_fields (Nome/CPF/Telefone/CEP)

DO $$
BEGIN
  ALTER TABLE IF EXISTS public.template_custom_fields
    DROP CONSTRAINT IF EXISTS template_custom_fields_field_type_check;

  ALTER TABLE IF EXISTS public.template_custom_fields
    ADD CONSTRAINT template_custom_fields_field_type_check
    CHECK (field_type IN ('text', 'number', 'date', 'select', 'textarea', 'name', 'cpf', 'phone', 'cep'));
END $$;
