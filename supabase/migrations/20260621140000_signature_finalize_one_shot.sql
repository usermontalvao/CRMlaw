-- Integridade do PDF final assinado (fluxo público /assinar/:public_token).
--
-- PROBLEMA: o public_token do signatário não é revogado após a assinatura e a
-- RPC public_attach_signed_pdf usava o gate `status <> 'signed' -> RETURN`, que
-- só LIBERA quando já está assinado. Como `status='signed'` é setado durante a
-- assinatura (antes do upload/attach) e permanece para sempre, a RPC seguia
-- aceitando repontar `signed_document_path` + regravar os hashes para qualquer
-- valor — permitindo substituir o artefato legal pós-assinatura via chamada
-- direta ao backend (a trava de UI não conta).
--
-- CORREÇÃO (first-write-wins / one-shot): só anexa quando o signatário está
-- 'signed' E ainda não tem `signed_document_path`. O fluxo legítimo grava o
-- artefato uma única vez; um retry após falha parcial ainda passa, porque o
-- ponteiro só é setado no sucesso do attach. Qualquer 2ª gravação é recusada.

CREATE OR REPLACE FUNCTION public.public_attach_signed_pdf(
  p_token uuid,
  p_path text,
  p_sha256 text DEFAULT NULL::text,
  p_integrity_sha256 text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_signer_id uuid; v_status text; v_signed_path text;
BEGIN
  IF p_token IS NULL OR p_path IS NULL OR btrim(p_path) = '' THEN RETURN; END IF;
  SELECT id, status, signed_document_path
    INTO v_signer_id, v_status, v_signed_path
    FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF v_signer_id IS NULL THEN RETURN; END IF;
  -- Só anexa depois da assinatura concluída E enquanto o artefato não foi
  -- finalizado (one-shot). Impede repontamento/adulteração pós-assinatura.
  IF v_status <> 'signed' OR v_signed_path IS NOT NULL THEN RETURN; END IF;
  UPDATE public.signature_signers
     SET signed_document_path = p_path,
         signed_pdf_sha256 = coalesce(p_sha256, signed_pdf_sha256),
         integrity_sha256 = coalesce(p_integrity_sha256, integrity_sha256)
   WHERE id = v_signer_id;
END;
$function$;

-- Mantém os grants existentes (idempotente).
REVOKE ALL ON FUNCTION public.public_attach_signed_pdf(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_attach_signed_pdf(uuid,text,text,text) TO anon, authenticated;
