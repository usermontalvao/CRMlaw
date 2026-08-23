-- Assinaturas: quem tem o módulo, vê o módulo.
--
-- Até aqui `can_manage_signature_request` respondia "só o dono ou um admin",
-- e ela governava TODAS as tabelas de assinatura. Na prática o colega abria
-- Assinaturas e via uma lista vazia — mesmo com o cargo dele marcado como
-- "ver" em Configurações → Permissões → Papéis e módulos.
--
-- A régua passa a ser aquela tela. Ver/editar/excluir uma assinatura alheia
-- segue can_view/can_edit/can_delete do cargo no módulo `assinaturas`. O dono
-- e o administrador continuam podendo tudo, como antes.

-- ── Cargo do usuário, normalizado como o front normaliza ─────────────────────
-- O hook usePermissions faz lower() + remoção de acento antes de consultar
-- role_permissions (que guarda 'secretaria', não 'Secretária'). Sem unaccent
-- instalado, translate() cobre as vogais acentuadas que aparecem em cargos.
CREATE OR REPLACE FUNCTION public.current_role_slug()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT translate(
           lower(coalesce(p.role, '')),
           'áàâãäéèêëíìîïóòôõöúùûüçñ',
           'aaaaaeeeeiiiiooooouuuucn'
         )
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;
$$;

-- ── É administrador? (mesma leitura frouxa de antes: role ou badge) ──────────
CREATE OR REPLACE FUNCTION public.is_module_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND (
        lower(coalesce(p.role, '')) IN ('administrador', 'admin', 'socio')
        OR lower(coalesce(p.badge::text, '')) = 'administrador'
      )
  );
$$;

-- ── A permissão do cargo sobre um módulo ────────────────────────────────────
-- p_action: 'view' | 'create' | 'edit' | 'delete'.
-- Espelha usePermissions.hasPermission: admin passa em tudo, e um override
-- individual ativo vale como 'view' (é só o que a tabela de override guarda).
CREATE OR REPLACE FUNCTION public.has_module_permission(p_module text, p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.is_module_admin()
      OR (
        p_action = 'view'
        AND EXISTS (
          SELECT 1
          FROM public.user_module_overrides o
          WHERE o.user_id = auth.uid()
            AND o.module = p_module
            AND o.can_view
            AND (o.expires_at IS NULL OR o.expires_at > now())
        )
      )
      OR EXISTS (
        SELECT 1
        FROM public.role_permissions rp
        WHERE rp.role = public.current_role_slug()
          AND rp.module = p_module
          AND CASE p_action
                WHEN 'view'   THEN rp.can_view
                WHEN 'create' THEN rp.can_create
                WHEN 'edit'   THEN rp.can_edit
                WHEN 'delete' THEN rp.can_delete
                ELSE false
              END
      )
    );
$$;

-- ── As três réguas da assinatura ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_view_signature_request(p_created_by uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (auth.uid() = p_created_by OR public.has_module_permission('assinaturas', 'view'));
$$;

-- Mantém o nome antigo: é ele que aparece em ~15 policies. Agora responde
-- pela EDIÇÃO — o dono, o admin, ou quem tem 'editar' no cargo.
CREATE OR REPLACE FUNCTION public.can_manage_signature_request(p_created_by uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (auth.uid() = p_created_by OR public.has_module_permission('assinaturas', 'edit'));
$$;

CREATE OR REPLACE FUNCTION public.can_delete_signature_request(p_created_by uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (auth.uid() = p_created_by OR public.has_module_permission('assinaturas', 'delete'));
$$;

-- ── Policies: SELECT passa a usar a régua de "ver" ───────────────────────────
DROP POLICY IF EXISTS "Users can manage visible signature requests" ON public.signature_requests;
CREATE POLICY "Users can manage visible signature requests"
  ON public.signature_requests FOR SELECT TO authenticated
  USING (public.can_view_signature_request(created_by));

DROP POLICY IF EXISTS "Users can manage deletes on signature requests" ON public.signature_requests;
CREATE POLICY "Users can manage deletes on signature requests"
  ON public.signature_requests FOR DELETE TO authenticated
  USING (public.can_delete_signature_request(created_by));

DROP POLICY IF EXISTS "Users can manage visible signers of requests" ON public.signature_signers;
CREATE POLICY "Users can manage visible signers of requests"
  ON public.signature_signers FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.signature_requests sr
    WHERE sr.id = signature_signers.signature_request_id
      AND public.can_view_signature_request(sr.created_by)
  ));

DROP POLICY IF EXISTS "Users can manage signer deletes for requests" ON public.signature_signers;
CREATE POLICY "Users can manage signer deletes for requests"
  ON public.signature_signers FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.signature_requests sr
    WHERE sr.id = signature_signers.signature_request_id
      AND public.can_delete_signature_request(sr.created_by)
  ));

DROP POLICY IF EXISTS "Users can manage visible fields of requests" ON public.signature_fields;
CREATE POLICY "Users can manage visible fields of requests"
  ON public.signature_fields FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.signature_requests sr
    WHERE sr.id = signature_fields.signature_request_id
      AND public.can_view_signature_request(sr.created_by)
  ));

DROP POLICY IF EXISTS "Users can manage field deletes for requests" ON public.signature_fields;
CREATE POLICY "Users can manage field deletes for requests"
  ON public.signature_fields FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.signature_requests sr
    WHERE sr.id = signature_fields.signature_request_id
      AND public.can_delete_signature_request(sr.created_by)
  ));

DROP POLICY IF EXISTS "Staff can view request documents" ON public.signature_request_documents;
CREATE POLICY "Staff can view request documents"
  ON public.signature_request_documents FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.signature_requests sr
    WHERE sr.id = signature_request_documents.signature_request_id
      AND public.can_view_signature_request(sr.created_by)
  ));

DROP POLICY IF EXISTS "Users can manage visible audit logs of requests" ON public.signature_audit_log;
CREATE POLICY "Users can manage visible audit logs of requests"
  ON public.signature_audit_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.signature_requests sr
    WHERE sr.id = signature_audit_log.signature_request_id
      AND public.can_view_signature_request(sr.created_by)
  ));

DROP POLICY IF EXISTS "Staff can view signature email dispatches" ON public.signature_email_dispatches;
CREATE POLICY "Staff can view signature email dispatches"
  ON public.signature_email_dispatches FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.signature_requests sr
    WHERE sr.id = signature_email_dispatches.signature_request_id
      AND public.can_view_signature_request(sr.created_by)
  ));

-- Esta escapava da função: comparava created_by com auth.uid() na unha, então
-- o acompanhamento da finalização ficaria escondido mesmo depois da mudança.
DROP POLICY IF EXISTS "Owner reads finalization jobs" ON public.signature_finalization_jobs;
CREATE POLICY "Owner reads finalization jobs"
  ON public.signature_finalization_jobs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.signature_requests sr
    WHERE sr.id = signature_finalization_jobs.signature_request_id
      AND public.can_view_signature_request(sr.created_by)
  ));

-- Funções SECURITY DEFINER nascem executáveis por PUBLIC. Fechamos primeiro e
-- reabrimos somente para o papel autenticado; anon não pode usar estes helpers
-- como endpoints públicos para sondar cargo/permissão.
REVOKE ALL ON FUNCTION public.current_role_slug() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_module_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_module_permission(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_signature_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_signature_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_delete_signature_request(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_role_slug() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_module_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_module_permission(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_signature_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_signature_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_signature_request(uuid) TO authenticated;
