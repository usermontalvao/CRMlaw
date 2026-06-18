-- Permite que administradores/sócios gerenciem solicitações de assinatura
-- criadas por outros colaboradores, mantendo o proprietário original com
-- acesso integral aos próprios registros.

CREATE OR REPLACE FUNCTION public.can_manage_signature_request(p_created_by uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      auth.uid() = p_created_by
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND (
            lower(coalesce(p.role, '')) IN ('administrador', 'admin', 'socio')
            OR lower(coalesce(p.badge::text, '')) = 'administrador'
          )
      )
    );
$$;

DROP POLICY IF EXISTS "Users can view their own signature requests" ON public.signature_requests;
CREATE POLICY "Users can manage visible signature requests"
  ON public.signature_requests
  FOR SELECT
  TO authenticated
  USING (public.can_manage_signature_request(created_by));

DROP POLICY IF EXISTS "Users can update their own signature requests" ON public.signature_requests;
CREATE POLICY "Users can manage updates on signature requests"
  ON public.signature_requests
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_signature_request(created_by))
  WITH CHECK (public.can_manage_signature_request(created_by));

DROP POLICY IF EXISTS "Users can delete their own signature requests" ON public.signature_requests;
CREATE POLICY "Users can manage deletes on signature requests"
  ON public.signature_requests
  FOR DELETE
  TO authenticated
  USING (public.can_manage_signature_request(created_by));

DROP POLICY IF EXISTS "Users can view signers of their requests" ON public.signature_signers;
CREATE POLICY "Users can manage visible signers of requests"
  ON public.signature_signers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  );

DROP POLICY IF EXISTS "Users can create signers for their requests" ON public.signature_signers;
CREATE POLICY "Users can manage signers for requests"
  ON public.signature_signers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  );

DROP POLICY IF EXISTS "Users can update signers of their requests" ON public.signature_signers;
CREATE POLICY "Users can manage signer updates for requests"
  ON public.signature_signers
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  );

DROP POLICY IF EXISTS "Users can delete signers of their requests" ON public.signature_signers;
CREATE POLICY "Users can manage signer deletes for requests"
  ON public.signature_signers
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  );

DROP POLICY IF EXISTS "Users can view audit logs of their requests" ON public.signature_audit_log;
CREATE POLICY "Users can manage visible audit logs of requests"
  ON public.signature_audit_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  );

DROP POLICY IF EXISTS "Users can create audit logs for their requests" ON public.signature_audit_log;
CREATE POLICY "Users can manage audit logs for requests"
  ON public.signature_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  );

DROP POLICY IF EXISTS "Users can view fields of their requests" ON public.signature_fields;
CREATE POLICY "Users can manage visible fields of requests"
  ON public.signature_fields
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  );

DROP POLICY IF EXISTS "Users can create fields for their requests" ON public.signature_fields;
CREATE POLICY "Users can manage fields for requests"
  ON public.signature_fields
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  );

DROP POLICY IF EXISTS "Users can update fields of their requests" ON public.signature_fields;
CREATE POLICY "Users can manage field updates for requests"
  ON public.signature_fields
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  );

DROP POLICY IF EXISTS "Users can delete fields of their requests" ON public.signature_fields;
CREATE POLICY "Users can manage field deletes for requests"
  ON public.signature_fields
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  );
