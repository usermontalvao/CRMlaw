-- Notifica os ADMINISTRADORES ativos quando um documento de ORIGEM KIT
-- (preenchimento público — existe template_fill_links apontando p/ a request)
-- fica TOTALMENTE assinado. Cobre o fluxo público, que antes não avisava
-- ninguém do escritório (o created_by costuma ser o dono do permalink, que
-- pode estar desativado). Best-effort: erro -> RETURN NEW.
CREATE OR REPLACE FUNCTION public._signature_notify_admins_on_kit_signed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total  int;
  v_signed int;
  v_signer text;
BEGIN
  IF NEW.status <> 'signed' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.template_fill_links WHERE signature_request_id = NEW.id) THEN RETURN NEW; END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'signed')
    INTO v_total, v_signed
    FROM public.signature_signers WHERE signature_request_id = NEW.id;

  SELECT name INTO v_signer
    FROM public.signature_signers
    WHERE signature_request_id = NEW.id AND status = 'signed'
    ORDER BY signed_at DESC NULLS LAST LIMIT 1;

  INSERT INTO public.user_notifications (user_id, type, title, message, read, created_at, metadata)
  SELECT p.user_id,
         'signature_completed'::public.user_notification_type,
         'Documento assinado (KIT)',
         '"' || COALESCE(NEW.document_name, 'Documento') || '" foi assinado'
           || COALESCE(' por ' || v_signer, '') || '.',
         false, now(),
         jsonb_build_object(
           'signature_type', 'completed',
           'request_id', NEW.id,
           'document_name', NEW.document_name,
           'signed_count', v_signed,
           'total_signers', v_total,
           'origin', 'kit'
         )
  FROM public.profiles p
  WHERE p.role = 'Administrador' AND p.is_active = true AND p.user_id IS NOT NULL;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS signature_notify_admins_on_kit_signed ON public.signature_requests;
CREATE TRIGGER signature_notify_admins_on_kit_signed
  AFTER UPDATE OF status ON public.signature_requests
  FOR EACH ROW EXECUTE FUNCTION public._signature_notify_admins_on_kit_signed();
