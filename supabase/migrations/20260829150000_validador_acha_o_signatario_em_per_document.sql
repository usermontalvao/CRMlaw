-- O signatário sumia nos envelopes `per_document`.
--
-- Quatro ramos procuravam quem assinou com:
--
--     WHERE signature_request_id = ... AND signed_document_path IS NOT NULL
--
-- Só que nesse modelo o PDF assinado fica em `signature_request_documents`, um
-- por arquivo — a coluna do signatário fica NULA. O filtro não casava nada,
-- `v_signer` virava um registro todo NULL, e o `coalesce` caía em
-- `client_name`. O nome parecia certo (costuma ser o mesmo), e por isso o
-- defeito passou despercebido — mas tudo que só existe no signatário vinha
-- vazio: canal da identidade, método, e os booleanos de selfie e assinatura.
--
-- A busca passa a aceitar quem tem `status = 'signed'` mesmo sem caminho, e
-- continua PREFERINDO quem tem o arquivo, para não mudar o resultado nos
-- envelopes consolidados, onde o caminho existe.
DO $do$
DECLARE
  d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'public_verify_by_hash';

  IF d IS NULL THEN RAISE EXCEPTION 'public_verify_by_hash nao encontrada'; END IF;
  IF position('OR signed_document_path IS NOT NULL' in d) > 0 THEN
    RAISE NOTICE 'patch ja aplicado; nada a fazer';
    RETURN;
  END IF;

  d := replace(d,
    'AND signed_document_path IS NOT NULL',
    'AND (status = ''signed'' OR signed_document_path IS NOT NULL)');
  d := replace(d,
    'ORDER BY signed_at DESC NULLS LAST LIMIT 1',
    'ORDER BY (signed_document_path IS NOT NULL) DESC, signed_at DESC NULLS LAST LIMIT 1');

  EXECUTE d;
END
$do$;
