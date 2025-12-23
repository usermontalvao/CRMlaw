DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'system_settings'
  ) THEN
    INSERT INTO public.system_settings (key, value, description, category)
    SELECT 'requirements_ms_template_id', to_jsonb(''::text), NULL, 'requerimentos'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.system_settings WHERE key = 'requirements_ms_template_id'
    );
  END IF;
END $$;
