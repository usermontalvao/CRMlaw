-- QUANDO o arquivo foi selado, por documento.
--
-- Sem isto a página de conferência não tem como dizer que o PDF carrega
-- assinatura criptográfica: a prova existia e não era mostrada em lugar nenhum,
-- e para descobrir era preciso abrir o arquivo no Adobe. Fazer a prova e não
-- mostrá-la é metade do trabalho.
--
-- Duas tabelas porque há dois modelos: no `per_document` o artefato é do
-- documento; no `consolidated` (legado) ele é do signatário.
ALTER TABLE public.signature_request_documents
  ADD COLUMN IF NOT EXISTS pades_signed_at timestamptz;

ALTER TABLE public.signature_signers
  ADD COLUMN IF NOT EXISTS pades_signed_at timestamptz;

COMMENT ON COLUMN public.signature_request_documents.pades_signed_at IS
  'Quando o PDF recebeu a assinatura criptografica (Edge Function pades-sign). Nulo = arquivo sem selo.';
COMMENT ON COLUMN public.signature_signers.pades_signed_at IS
  'Quando o PDF do signatario recebeu a assinatura criptografica. Usado no modelo consolidado.';
