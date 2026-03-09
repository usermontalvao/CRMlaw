do $$
 begin
   if not exists (
     select 1
     from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'cloud_folders'
   ) then
     alter publication supabase_realtime add table public.cloud_folders;
   end if;

   if not exists (
     select 1
     from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'cloud_files'
   ) then
     alter publication supabase_realtime add table public.cloud_files;
   end if;

   if not exists (
     select 1
     from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'cloud_folder_shares'
   ) then
     alter publication supabase_realtime add table public.cloud_folder_shares;
   end if;
 end $$;
