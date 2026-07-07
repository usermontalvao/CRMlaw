-- Em envelopes legacy/consolidated sem linhas em signature_request_documents,
-- a verificacao publica por protocolo ainda precisa exibir um codigo utilizavel
-- para o documento principal quando existir apenas o PDF final do signatario.

CREATE OR REPLACE FUNCTION public.public_signature_request_documents_json(
  p_request_id uuid,
  p_document_name text,
  p_attachment_paths text[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH signed_docs AS (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'verification_code', d.verification_code,
          'display_name', d.display_name,
          'document_type', d.document_type,
          'sort_order', d.sort_order
        )
        ORDER BY d.sort_order, d.created_at
      ),
      '[]'::jsonb
    ) AS items
    FROM public.signature_request_documents d
    WHERE d.signature_request_id = p_request_id
      AND d.signed_file_path IS NOT NULL
  ),
  latest_signed_signer AS (
    SELECT s.verification_hash
    FROM public.signature_signers s
    WHERE s.signature_request_id = p_request_id
      AND s.signed_document_path IS NOT NULL
      AND nullif(btrim(s.verification_hash), '') IS NOT NULL
    ORDER BY s.signed_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1
  ),
  fallback_docs AS (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'verification_code',
          CASE
            WHEN item.document_type = 'main' THEN (SELECT verification_hash FROM latest_signed_signer)
            ELSE NULL
          END,
          'display_name', item.display_name,
          'document_type', item.document_type,
          'sort_order', item.sort_order
        )
        ORDER BY item.sort_order
      ),
      '[]'::jsonb
    ) AS items
    FROM (
      SELECT
        coalesce(nullif(btrim(p_document_name), ''), 'Documento principal') AS display_name,
        'main'::text AS document_type,
        0 AS sort_order
      UNION ALL
      SELECT
        coalesce(nullif(regexp_replace(split_part(path, '/', array_length(string_to_array(path, '/'), 1)), '\.[^/.]+$', ''), ''), format('Anexo %s', ordinality)) AS display_name,
        'attachment'::text AS document_type,
        ordinality AS sort_order
      FROM unnest(coalesce(p_attachment_paths, ARRAY[]::text[])) WITH ORDINALITY AS t(path, ordinality)
    ) AS item
  )
  SELECT
    CASE
      WHEN jsonb_array_length(signed_docs.items) > 0 THEN signed_docs.items
      ELSE fallback_docs.items
    END
  FROM signed_docs, fallback_docs;
$function$;

REVOKE ALL ON FUNCTION public.public_signature_request_documents_json(uuid, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_signature_request_documents_json(uuid, text, text[]) TO anon, authenticated;
