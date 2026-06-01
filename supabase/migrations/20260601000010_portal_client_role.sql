-- ============================================================================
-- Portal do Cliente — Role dedicado `portal_client` (deny-by-default)
-- ----------------------------------------------------------------------------
-- Contexto: o login do portal passou a emitir uma sessão Supabase REAL (JWT).
-- Se esse JWT usasse o role padrão `authenticated`, o cliente do portal herdaria
-- TODAS as policies permissivas do staff (ex.: datajud_movimentos USING true,
-- processes USING true) e conseguiria ler processos/clientes de TODO MUNDO via
-- PostgREST direto. (Verificado: vazamento real.)
--
-- Solução: um role Postgres próprio, SEM nenhum grant por padrão. O JWT do portal
-- carrega `role = portal_client` (setado em auth.users.role pela edge function
-- portal-login). Assim, por padrão o portal não acessa NADA — só o que for
-- explicitamente concedido abaixo. Tabela nova no futuro = zero risco automático.
--
-- Os dados continuam sendo lidos via RPCs `portal_*` (SECURITY DEFINER, que
-- rodam como owner e ignoram RLS). Este role só precisa de:
--   • EXECUTE nos RPCs portal_*
--   • acesso à tabela document_uploads (upload de documentos do cliente)
--   • policies de storage equivalentes às que o portal tinha como `anon`
-- ============================================================================

-- 1. Role + encadeamento no authenticator (PostgREST faz SET ROLE para ele).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'portal_client') then
    create role portal_client nologin noinherit;
  end if;
end $$;

grant portal_client to authenticator;
grant usage on schema public to portal_client;

-- 2. EXECUTE em todos os RPCs do portal (portal_*). Concede dinamicamente para
--    cobrir todas as assinaturas existentes sem listar uma a uma.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'portal\_%'
  loop
    execute format('grant execute on function %s to portal_client', r.sig);
  end loop;
end $$;

-- 3. document_uploads — o portal insere/lê direto (uploadDocumentFiles).
--    Policy ESCOPADA pelo client_id do JWT (melhor que o USING true atual).
grant select, insert on public.document_uploads to portal_client;

drop policy if exists portal_own_document_uploads on public.document_uploads;
create policy portal_own_document_uploads on public.document_uploads
  for all to portal_client
  using (client_id = (auth.jwt() -> 'app_metadata' ->> 'client_id')::uuid)
  with check (client_id = (auth.jwt() -> 'app_metadata' ->> 'client_id')::uuid);

-- 4. Storage — replica para portal_client o que o portal tinha como `anon`.
--    Leitura de foto (document-templates) e de documentos (client-documents) em
--    nível de bucket (paridade com o comportamento atual). Upload escopado à
--    pasta do próprio cliente (caminho sempre começa com <client_id>/).
drop policy if exists "portal_client read document-templates" on storage.objects;
create policy "portal_client read document-templates" on storage.objects
  for select to portal_client
  using (bucket_id = 'document-templates');

drop policy if exists "portal_client read client-documents" on storage.objects;
create policy "portal_client read client-documents" on storage.objects
  for select to portal_client
  using (bucket_id = 'client-documents');

drop policy if exists "portal_client upload client-documents" on storage.objects;
create policy "portal_client upload client-documents" on storage.objects
  for insert to portal_client
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'client_id')
  );

comment on role portal_client is
  'Role do Portal do Cliente. Deny-by-default: só RPCs portal_* + document_uploads + storage do cliente. JWT emitido pela edge function portal-login com role=portal_client.';
