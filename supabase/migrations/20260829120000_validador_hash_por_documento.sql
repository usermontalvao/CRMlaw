-- O validador público passa a devolver a IMPRESSÃO DIGITAL DE CADA DOCUMENTO.
--
-- A página de conferência mostrava um hash só, quando mostrava — e num envelope
-- com três arquivos (o principal e dois anexos) isso não responde à pergunta
-- que a pessoa foi ali fazer: ela tem UM PDF na mão e quer saber se AQUELE
-- arquivo é o que foi assinado. Sem o hash de cada documento, só dá para
-- conferir o kit inteiro no atacado.
--
-- Mudança mínima e ADITIVA: dois campos a mais no array `documents`, na única
-- função que o monta. Nenhum ramo do `public_verify_by_hash` muda — os quatro
-- (signatário, legado, envelope, documento) recebem o enriquecimento de graça,
-- porque todos chamam este helper.
--
-- SOBRE EXPOR HASH EM ENDPOINT PÚBLICO: estes mesmos valores já são impressos
-- no rodapé e na margem de cada página do PDF assinado — quem tem o documento
-- já os tem. E para chegar aqui é preciso conhecer um código de verificação
-- válido. O hash não permite reconstruir o documento; ele só permite CONFERIR
-- um documento que a pessoa já possui, que é exatamente a função da página.

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
          'sort_order', d.sort_order,
          -- Impressão digital do PDF ASSINADO: é contra este valor que se
          -- confere o arquivo baixado.
          'signed_pdf_sha256', d.signed_pdf_sha256,
          -- E do documento ORIGINAL, antes da assinatura: é o valor carimbado
          -- no rodapé da folha.
          'document_hash', d.document_hash
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
    SELECT s.verification_hash, s.signed_pdf_sha256, s.integrity_sha256
    FROM public.signature_signers s
    WHERE s.signature_request_id = p_request_id
      AND s.signed_document_path IS NOT NULL
      AND nullif(btrim(s.verification_hash), '') IS NOT NULL
    ORDER BY s.signed_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1
  ),
  fallback_docs AS (
    -- Envelope antigo, sem linhas em signature_request_documents: o principal
    -- herda os hashes do signatário; os anexos não têm o que herdar.
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
          'sort_order', item.sort_order,
          'signed_pdf_sha256',
          CASE
            WHEN item.document_type = 'main' THEN (SELECT signed_pdf_sha256 FROM latest_signed_signer)
            ELSE NULL
          END,
          'document_hash',
          CASE
            WHEN item.document_type = 'main' THEN (SELECT integrity_sha256 FROM latest_signed_signer)
            ELSE NULL
          END
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
