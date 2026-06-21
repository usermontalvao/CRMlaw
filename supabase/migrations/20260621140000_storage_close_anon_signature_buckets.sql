-- FASE 2/3 FINAL — fecha o acesso anon/public ao Storage do fluxo de
-- assinatura. Todas as leituras/uploads públicos já passam por edge
-- (public-signing-file v7 / public-verify-file / public-signing-upload) com
-- service role (bypass de RLS), validado no app em 2026-06-21. É aqui que a
-- evidência facial/selfie em document-templates/signatures realmente fecha.
-- Preserva acesso de `authenticated` (CRM interno) e `portal_client`.
--
-- Aplicada no remoto via MCP em 2026-06-21; versionada para evitar regressão
-- em redeploy (ver memória project_edge_repo_drift). Verificado com SET ROLE
-- anon: 0 linhas visíveis nos 3 buckets; authenticated mantém acesso.

-- ── Migration 3: remover SELECT anon/public ──────────────────────────────
drop policy if exists "Allow anon reads from assinados" on storage.objects;
drop policy if exists "Allow public read for signatures folder" on storage.objects;
drop policy if exists "Public can view generated documents" on storage.objects;
drop policy if exists "Public can read signature request PDFs" on storage.objects;

-- "Allow read document templates" era {anon,authenticated}: recria só p/ authenticated.
drop policy if exists "Allow read document templates" on storage.objects;
create policy "Allow read document templates (authenticated)"
  on storage.objects for select to authenticated
  using (bucket_id = 'document-templates');

-- ── Migration 4: remover INSERT anon ─────────────────────────────────────
drop policy if exists "Allow anon uploads to assinados" on storage.objects;

-- "Allow upload document templates" era {anon,authenticated}: recria só p/ authenticated.
drop policy if exists "Allow upload document templates" on storage.objects;
create policy "Allow upload document templates (authenticated)"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'document-templates');
