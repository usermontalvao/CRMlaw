-- ============================================================================
-- Trigger: notifica o cliente no portal ao criar nova solicitação de documentos
-- Segue o mesmo padrão dos triggers de processo, assinatura e contrato
-- ============================================================================

CREATE OR REPLACE FUNCTION public._trg_document_request_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só notifica se o cliente tem conta ativa no portal
  IF NOT EXISTS (
    SELECT 1 FROM public.client_portal_users
    WHERE client_id = NEW.client_id AND is_active = true
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public._portal_notify_client(
    NEW.client_id,
    'new_document_request',
    'Documentos solicitados pelo escritório',
    'O escritório solicitou o envio de documentos: "' || NEW.title || '". Acesse o portal para enviar.',
    jsonb_build_object(
      'request_id',  NEW.id,
      'title',       NEW.title,
      'due_date',    NEW.due_date
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_request_portal_notify ON public.document_requests;

CREATE TRIGGER trg_document_request_portal_notify
  AFTER INSERT ON public.document_requests
  FOR EACH ROW
  EXECUTE FUNCTION public._trg_document_request_notify();

-- Permite que usuários autenticados (admin/advogado) insiram notificações
-- para aprovação/rejeição de documentos enviados pelo cliente
CREATE POLICY "authenticated_insert_portal_notifications"
  ON public.portal_client_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
