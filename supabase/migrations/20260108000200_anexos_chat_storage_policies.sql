DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'storage'
      AND table_name = 'buckets'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('anexos_chat', 'anexos_chat', false, 52428800)
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
    DROP POLICY IF EXISTS "authenticated_select_anexos_chat" ON storage.objects;
    CREATE POLICY "authenticated_select_anexos_chat"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (bucket_id = 'anexos_chat');

    DROP POLICY IF EXISTS "authenticated_insert_anexos_chat" ON storage.objects;
    CREATE POLICY "authenticated_insert_anexos_chat"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'anexos_chat');

    DROP POLICY IF EXISTS "authenticated_update_anexos_chat" ON storage.objects;
    CREATE POLICY "authenticated_update_anexos_chat"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (bucket_id = 'anexos_chat' AND owner = auth.uid())
      WITH CHECK (bucket_id = 'anexos_chat' AND owner = auth.uid());

    DROP POLICY IF EXISTS "authenticated_delete_anexos_chat" ON storage.objects;
    CREATE POLICY "authenticated_delete_anexos_chat"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (bucket_id = 'anexos_chat' AND owner = auth.uid());
  END IF;
END $$;
