-- ─────────────────────────────────────────────────────────────────────────
-- Remove TODA leitura/escrita pública ampla. O fluxo público passa a usar
-- exclusivamente RPCs SECURITY DEFINER restritas por public_token/hash e as
-- edge functions (service role). profiles deixa de ser legível por anon.
-- Requer que as RPCs de 20260620100100/20260620100200 já existam.
-- ─────────────────────────────────────────────────────────────────────────

-- signature_requests: remover leitura anon ampla
DROP POLICY IF EXISTS "Public can view request by id" ON public.signature_requests;
DROP POLICY IF EXISTS "Public view via token"        ON public.signature_requests;

-- signature_signers: remover leitura anon ampla + updates anon irrestritos
DROP POLICY IF EXISTS "Public can view signer by token"     ON public.signature_signers;
DROP POLICY IF EXISTS "Allow public update viewed_at"       ON public.signature_signers;
DROP POLICY IF EXISTS "Public access via token for signing" ON public.signature_signers;

-- signature_audit_log: remover insert anon irrestrito (substituído por RPC definer)
DROP POLICY IF EXISTS "Allow public insert audit log" ON public.signature_audit_log;

-- profiles: remover exposição pública (anon incluído) de leitura e insert
DROP POLICY IF EXISTS "Allow public read profiles for signature" ON public.profiles;
DROP POLICY IF EXISTS "Permitir leitura de todos os perfis"      ON public.profiles;
DROP POLICY IF EXISTS "Permitir inserção de perfis"              ON public.profiles;

-- profiles: leitura restrita a usuários autenticados (mantém o app interno
-- funcionando); o fluxo público obtém o nome do emissor via RPC definer.
DROP POLICY IF EXISTS "Authenticated can read profiles" ON public.profiles;
CREATE POLICY "Authenticated can read profiles"
  ON public.profiles FOR SELECT TO authenticated USING (true);

-- profiles: insert do próprio perfil pelo usuário autenticado (criação de
-- colaboradores é feita por edge com service role, que ignora RLS).
DROP POLICY IF EXISTS "Authenticated can insert own profile" ON public.profiles;
CREATE POLICY "Authenticated can insert own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
