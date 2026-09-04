-- CARIMBAR CADA DEGRAU QUANDO ELE ACONTECE.
--
-- Os instantes por etapa (`terms_accepted_at`, `auth_at`, `presented_at`,
-- `facial_captured_at`, `geolocation_captured_at`) existiam há tempos, mas eram
-- todos gravados de uma vez, no envio da assinatura. A consequência é que quem
-- NÃO assina não deixa rastro nenhum: 51 solicitações pendentes com o cliente
-- tendo aberto o link, e nenhuma pista de onde ele travou. `presented_at`, em
-- particular, nunca foi gravado uma única vez em 236 assinaturas.
--
-- Esta função deixa a página pública carimbar cada degrau no momento em que ele
-- acontece, como já faz `public_heartbeat_signer` com a presença.
--
-- REGRAS:
--   • só grava quando o campo está VAZIO — o primeiro carimbo vence, e nada
--     que já foi registrado pode ser reescrito de fora;
--   • não mexe em quem já assinou ou recusou;
--   • a hora é a do SERVIDOR (`now()`), nunca a do navegador;
--   • não devolve nada, para não virar um oráculo sobre tokens alheios.
CREATE OR REPLACE FUNCTION public.public_marcar_etapa_do_signatario(
  p_token uuid,
  p_etapa text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_signer_id uuid;
BEGIN
  IF p_token IS NULL OR p_etapa IS NULL THEN RETURN; END IF;

  SELECT id INTO v_signer_id
    FROM public.signature_signers
   WHERE public_token = p_token
     AND signed_at IS NULL
     AND refused_at IS NULL
   LIMIT 1;

  IF v_signer_id IS NULL THEN RETURN; END IF;

  IF p_etapa = 'termos' THEN
    UPDATE public.signature_signers SET terms_accepted_at = now()
     WHERE id = v_signer_id AND terms_accepted_at IS NULL;

  ELSIF p_etapa = 'autenticacao' THEN
    UPDATE public.signature_signers SET auth_at = now()
     WHERE id = v_signer_id AND auth_at IS NULL;

  ELSIF p_etapa = 'documento' THEN
    UPDATE public.signature_signers SET presented_at = now()
     WHERE id = v_signer_id AND presented_at IS NULL;

  ELSIF p_etapa = 'selfie' THEN
    UPDATE public.signature_signers SET facial_captured_at = now()
     WHERE id = v_signer_id AND facial_captured_at IS NULL;

  ELSIF p_etapa = 'localizacao' THEN
    UPDATE public.signature_signers SET geolocation_captured_at = now()
     WHERE id = v_signer_id AND geolocation_captured_at IS NULL;

  END IF;
  -- Etapa desconhecida não é erro: a página pública pode ser mais nova que o
  -- banco, e um degrau que ninguém sabe gravar apenas não é gravado.
END;
$function$;

REVOKE ALL ON FUNCTION public.public_marcar_etapa_do_signatario(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.public_marcar_etapa_do_signatario(uuid, text) TO anon, authenticated;

COMMENT ON FUNCTION public.public_marcar_etapa_do_signatario(uuid, text) IS
  'Carimba um degrau da assinatura (termos/autenticacao/documento/selfie/localizacao) no instante em que ele acontece. Só grava campo vazio, só para quem ainda não assinou, sempre com a hora do servidor.';
