-- O recibo passa a dizer O QUE FOI USADO, não o que estava configurado.
--
-- `auth_method` guarda o método EXIGIDO quando a solicitação foi criada. Ele
-- mente por omissão sobre o que de fato aconteceu: numa assinatura real deste
-- acervo o campo diz `signature_only`, e a pessoa tinha feito selfie E
-- confirmado a identidade por e-mail. O comprovante dizia "assinatura
-- eletrônica" e escondia duas provas que existem.
--
-- O payload público passa a carregar o que foi COLETADO — três booleanos,
-- nunca os caminhos dos arquivos. Quem confere precisa saber que houve selfie,
-- não receber a selfie.
--
-- O patch é aplicado sobre a própria definição viva em vez de reescrever as 146
-- linhas à mão: o alvo aparece 7 vezes (um por ramo com signatário real) e
-- errar uma delas na cópia quebraria a validação pública em silêncio.
DO $do$
DECLARE
  d text;
  alvo text := '''auth_verified_channel'',v_signer.auth_verified_channel';
  novo text := '''auth_verified_channel'',v_signer.auth_verified_channel,''has_signature_image'',(v_signer.signature_image_path IS NOT NULL),''has_facial_image'',(v_signer.facial_image_path IS NOT NULL),''has_document_image'',(v_signer.document_image_path IS NOT NULL)';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'public_verify_by_hash';

  IF d IS NULL THEN RAISE EXCEPTION 'public_verify_by_hash nao encontrada'; END IF;
  IF position(alvo in d) = 0 THEN
    RAISE EXCEPTION 'alvo do patch nao encontrado — a funcao mudou de forma';
  END IF;
  IF position('has_facial_image' in d) > 0 THEN
    RAISE NOTICE 'patch ja aplicado; nada a fazer';
    RETURN;
  END IF;

  d := replace(d, alvo, novo);
  EXECUTE d;
END
$do$;
