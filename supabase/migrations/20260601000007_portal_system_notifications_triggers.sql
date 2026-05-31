-- ============================================================================
-- Triggers de notificações do sistema para o portal do cliente
-- Eventos: mudança de status do processo, nova assinatura, novo contrato
-- ============================================================================

CREATE OR REPLACE FUNCTION public._portal_notify_client(
  p_client_id  uuid,
  p_type       text,
  p_title      text,
  p_message    text,
  p_metadata   jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.client_portal_users WHERE client_id = p_client_id AND is_active = true) THEN
    RETURN;
  END IF;
  INSERT INTO public.portal_client_notifications (client_id, type, title, message, metadata)
  VALUES (p_client_id, p_type, p_title, p_message, p_metadata);
END;
$$;

-- Mudança de status do processo
CREATE OR REPLACE FUNCTION public._trg_process_status_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_label text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  v_label := CASE NEW.status
    WHEN 'aguardando_confeccao' THEN 'Aguardando confecção'
    WHEN 'distribuido'          THEN 'Distribuído'
    WHEN 'citacao'              THEN 'Citação'
    WHEN 'contestacao'          THEN 'Contestação'
    WHEN 'instrucao'            THEN 'Em instrução'
    WHEN 'conciliacao'          THEN 'Conciliação'
    WHEN 'sentenca'             THEN 'Sentença'
    WHEN 'recurso'              THEN 'Recurso'
    WHEN 'cumprimento'          THEN 'Cumprimento de sentença'
    WHEN 'andamento'            THEN 'Em andamento'
    WHEN 'arquivado'            THEN 'Processo arquivado'
    ELSE NEW.status
  END;
  PERFORM public._portal_notify_client(
    NEW.client_id, 'process_status_changed',
    'Atualização no seu processo',
    'O processo ' || coalesce(NEW.process_code,'') || ' passou para a fase: ' || v_label || '.',
    jsonb_build_object('process_id', NEW.id, 'process_code', NEW.process_code, 'status', NEW.status, 'status_label', v_label)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_process_status_portal_notify ON public.processes;
CREATE TRIGGER trg_process_status_portal_notify
  AFTER UPDATE ON public.processes
  FOR EACH ROW EXECUTE FUNCTION public._trg_process_status_notify();

-- Nova assinatura
CREATE OR REPLACE FUNCTION public._trg_signature_request_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('pending','in_progress') THEN RETURN NEW; END IF;
  PERFORM public._portal_notify_client(
    NEW.client_id, 'new_signature_request',
    'Documento aguardando sua assinatura',
    'Um novo documento está aguardando a sua assinatura: "' || coalesce(NEW.document_name,'Documento') || '".',
    jsonb_build_object('signature_request_id', NEW.id, 'document_name', NEW.document_name)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signature_request_portal_notify ON public.signature_requests;
CREATE TRIGGER trg_signature_request_portal_notify
  AFTER INSERT ON public.signature_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_signature_request_notify();

-- Novo contrato
CREATE OR REPLACE FUNCTION public._trg_agreement_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public._portal_notify_client(
    NEW.client_id, 'new_agreement',
    'Novo contrato disponível',
    'Um novo contrato foi gerado para você: "' || coalesce(NEW.title,'Contrato') || '". Acesse o portal financeiro para mais detalhes.',
    jsonb_build_object('agreement_id', NEW.id, 'title', NEW.title, 'total_value', NEW.total_value)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agreement_portal_notify ON public.agreements;
CREATE TRIGGER trg_agreement_portal_notify
  AFTER INSERT ON public.agreements
  FOR EACH ROW EXECUTE FUNCTION public._trg_agreement_notify();
