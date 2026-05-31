-- ============================================================================
-- Portal do Cliente — Tabelas e Políticas RLS
-- ============================================================================
-- Cria a infraestrutura mínima para o Portal do Cliente:
--   - client_portal_users: vincula auth.users a clients (cliente externo)
--   - client_portal_sessions: log de sessões / auditoria de acesso
--   - RLS policies para o role "client" (acessa apenas seus dados)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela: vínculo entre auth.users (cliente externo) e clients
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_portal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cpf text NOT NULL,
  email text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_portal_users_client_unique UNIQUE (client_id),
  CONSTRAINT client_portal_users_cpf_unique UNIQUE (cpf)
);

CREATE INDEX IF NOT EXISTS idx_client_portal_users_auth ON public.client_portal_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_client_portal_users_cpf ON public.client_portal_users(cpf);

-- ----------------------------------------------------------------------------
-- 2. Tabela: log de sessões / auditoria
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_portal_user_id uuid NOT NULL REFERENCES public.client_portal_users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ip_address text,
  user_agent text,
  login_method text, -- 'otp_email' | 'otp_sms' | 'password'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_portal_sessions_user ON public.client_portal_sessions(client_portal_user_id);
CREATE INDEX IF NOT EXISTS idx_client_portal_sessions_client ON public.client_portal_sessions(client_id);

-- ----------------------------------------------------------------------------
-- 3. Helper: identifica o client_id atual (cliente externo logado)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_portal_client_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT client_id
  FROM public.client_portal_users
  WHERE auth_user_id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- 4. RLS para client_portal_users
-- ----------------------------------------------------------------------------
ALTER TABLE public.client_portal_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cliente vê seu próprio vínculo" ON public.client_portal_users;
CREATE POLICY "Cliente vê seu próprio vínculo" ON public.client_portal_users
  FOR SELECT USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "Admins gerenciam portal users" ON public.client_portal_users;
CREATE POLICY "Admins gerenciam portal users" ON public.client_portal_users
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'manager')
    )
  );

ALTER TABLE public.client_portal_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cliente vê suas próprias sessões" ON public.client_portal_sessions;
CREATE POLICY "Cliente vê suas próprias sessões" ON public.client_portal_sessions
  FOR SELECT USING (
    client_id = public.current_portal_client_id()
  );

-- ----------------------------------------------------------------------------
-- 5. Trigger updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_client_portal_users_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_portal_users_updated_at ON public.client_portal_users;
CREATE TRIGGER trg_client_portal_users_updated_at
  BEFORE UPDATE ON public.client_portal_users
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_portal_users_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Comentários
-- ----------------------------------------------------------------------------
COMMENT ON TABLE public.client_portal_users IS 'Vínculo entre auth.users (cliente externo) e clients (perfil do cliente). Cada cliente tem no máximo 1 conta no portal.';
COMMENT ON TABLE public.client_portal_sessions IS 'Log de sessões/acessos do portal do cliente para auditoria.';
COMMENT ON FUNCTION public.current_portal_client_id() IS 'Retorna o client_id do cliente externo atualmente logado. Use em policies RLS de outras tabelas.';

-- ----------------------------------------------------------------------------
-- 7. Exemplos de policies para tabelas existentes (DESCOMENTE conforme adotar)
-- ----------------------------------------------------------------------------
-- Cliente vê apenas seus próprios processos:
-- CREATE POLICY "Portal: cliente vê seus processos" ON public.processes
--   FOR SELECT USING (client_id = public.current_portal_client_id());
--
-- Cliente vê apenas seus próprios documentos:
-- CREATE POLICY "Portal: cliente vê seus documentos" ON public.cloud_files
--   FOR SELECT USING (client_id = public.current_portal_client_id());
--
-- Cliente vê apenas seus próprios contratos financeiros:
-- CREATE POLICY "Portal: cliente vê seus contratos" ON public.agreements
--   FOR SELECT USING (client_id = public.current_portal_client_id());
