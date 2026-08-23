-- Remover do painel é "excluir", não "editar".
--
-- "Remover" grava archived_at — ou seja, é um UPDATE. Sem esta trava, um cargo
-- com 'editar' mas sem 'excluir' (o financeiro, hoje) conseguiria tirar do
-- painel a assinatura de qualquer colega. E, pior, o PostgREST não reclama de
-- UPDATE barrado por RLS: ele devolve zero linhas, então a tela dizia
-- "Documento removido do painel" sem nada ter acontecido.
--
-- O trigger levanta erro explícito, que sobe até o toast.

CREATE OR REPLACE FUNCTION public.tg_signature_archive_needs_delete_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Rotinas de servidor (Edge Function, cron, service_role) não têm auth.uid()
  -- e não passam por esta régua — ela é sobre o que a pessoa pode fazer.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.archived_at IS DISTINCT FROM OLD.archived_at AND NEW.archived_at IS NOT NULL)
     OR (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL) THEN
    IF NOT public.can_delete_signature_request(OLD.created_by) THEN
      RAISE EXCEPTION 'Você não tem permissão para remover esta assinatura.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS signature_archive_needs_delete_permission ON public.signature_requests;
CREATE TRIGGER signature_archive_needs_delete_permission
  BEFORE UPDATE ON public.signature_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_signature_archive_needs_delete_permission();

-- É função de trigger, não API pública.
REVOKE ALL ON FUNCTION public.tg_signature_archive_needs_delete_permission() FROM PUBLIC, anon, authenticated;
