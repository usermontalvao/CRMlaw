-- A porta do dossiê para quem valida POR ARQUIVO, e o fechamento do núcleo.
--
-- `public_verify_extras_json` deixou de ser pública (virava consulta a dado
-- pessoal por UUID). A validação por upload precisa do dossiê, e ali o portão
-- é melhor que o do código impresso: para saber o SHA-256 é preciso TER o
-- arquivo, e não há como enumerar.
CREATE OR REPLACE FUNCTION public.public_verify_dossier_by_sha256(p_sha256 text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hash text;
  v_request_id uuid;
BEGIN
  v_hash := upper(btrim(coalesce(p_sha256, '')));
  -- 64 hex: qualquer coisa fora disso não é um SHA-256 e não merece consulta.
  IF v_hash !~ '^[0-9A-F]{64}$' THEN RETURN '{}'::jsonb; END IF;

  SELECT s.signature_request_id INTO v_request_id
  FROM public.signature_signers s
  WHERE upper(s.signed_pdf_sha256) = v_hash
  LIMIT 1;

  IF v_request_id IS NULL THEN
    SELECT d.signature_request_id INTO v_request_id
    FROM public.signature_request_documents d
    WHERE upper(d.signed_pdf_sha256) = v_hash
    LIMIT 1;
  END IF;

  IF v_request_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- Bloqueio, lixeira e máscara vêm de graça: a guarda mora dentro da
  -- `public_verify_extras_json`, e este caminho a herda.
  RETURN public.public_verify_extras_json(v_request_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.public_verify_dossier_by_sha256(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_verify_dossier_by_sha256(text) TO anon, authenticated;

-- ── Documento na LIXEIRA deixa de se confirmar publicamente ─────────────────
-- O núcleo da consulta nunca olhou `deleted_at`: um envelope excluído do painel
-- continuava respondendo `status: valid` para quem tivesse o código. A guarda
-- entra no invólucro, sem tocar no núcleo clonado.
CREATE OR REPLACE FUNCTION public.public_verify_by_hash(p_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
  v_request_id uuid;
BEGIN
  v_out := public.public_verify_by_hash_core(p_hash);
  IF v_out IS NULL THEN RETURN NULL; END IF;

  BEGIN
    v_request_id := nullif(v_out #>> '{request,id}', '')::uuid;
  EXCEPTION WHEN others THEN
    v_request_id := NULL;
  END;

  IF v_request_id IS NULL THEN RETURN v_out; END IF;

  IF EXISTS (
    SELECT 1 FROM public.signature_requests r
    WHERE r.id = v_request_id AND r.deleted_at IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;

  RETURN v_out || public.public_verify_extras_json(v_request_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.public_verify_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_verify_by_hash(text) TO anon, authenticated;

-- ── O BYPASS DO NÚCLEO ──────────────────────────────────────────────────────
--
-- `public_verify_by_hash_core` nasceu de um clone e ficou executável por
-- `anon`, porque o `REVOKE ALL ... FROM PUBLIC` da migration que o criou não
-- toca os grants nominais que o Supabase concede por privilégio padrão.
--
-- Chamando o núcleo direto em /rest/v1/rpc/public_verify_by_hash_core,
-- pula-se o invólucro e com ele TODA a proteção acrescentada depois: a guarda
-- da lixeira, a minimização e o mascaramento. Ele aceita o UUID do protocolo e
-- devolve nome, cliente, documento, códigos, hashes e os caminhos dos arquivos.
--
-- REGRA DAQUI EM DIANTE: função auxiliar se fecha pelos TRÊS — PUBLIC, anon e
-- authenticated. Só as portas de entrada recebem GRANT nominal.
REVOKE ALL ON FUNCTION public.public_verify_by_hash_core(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_verify_by_hash_core(text) FROM anon;
REVOKE ALL ON FUNCTION public.public_verify_by_hash_core(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.public_signature_request_documents_json(uuid, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_signature_request_documents_json(uuid, text, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.public_signature_request_documents_json(uuid, text, text[]) FROM authenticated;
