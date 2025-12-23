DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'storage'
      AND table_name = 'buckets'
  ) THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('generated-documents', 'generated-documents', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'storage'
      AND table_name = 'objects'
  ) THEN
    DROP POLICY IF EXISTS "authenticated_select_generated_documents" ON storage.objects;
    CREATE POLICY "authenticated_select_generated_documents"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (bucket_id = 'generated-documents');

    DROP POLICY IF EXISTS "authenticated_insert_generated_documents" ON storage.objects;
    CREATE POLICY "authenticated_insert_generated_documents"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'generated-documents');

    DROP POLICY IF EXISTS "authenticated_delete_generated_documents" ON storage.objects;
    CREATE POLICY "authenticated_delete_generated_documents"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (bucket_id = 'generated-documents');
  END IF;
END $$;
