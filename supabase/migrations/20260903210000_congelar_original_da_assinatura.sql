-- ============================================================================
-- CONGELAR O ORIGINAL — etapa 1 de tirar a montagem do aparelho de quem assina.
-- ----------------------------------------------------------------------------
-- O PROBLEMA QUE ISTO COMEÇA A RESOLVER. Hoje o PDF assinado é montado no
-- navegador do signatário: ele desenha o documento, calcula o SHA-256, cria o
-- código de verificação e manda tudo pronto. O servidor grava e depois
-- "confere" o hash contra o valor que o próprio navegador enviou — ou seja,
-- prova que o arquivo recebido não mudou, mas não que ele É o documento
-- original acrescido das assinaturas.
--
-- POR QUE A MONTAGEM NASCEU NO NAVEGADOR. 241 dos 291 envelopes começam num
-- `.docx`, e desenhar Word exige DOM: nem Deno nem Node fazem isso, e o
-- servidor Syncfusion não converte (o `Export` devolve `application/msword`
-- mesmo quando se pede PDF — não tem `DocIORenderer`, medido em 30/07/2026).
--
-- A SAÍDA. A conversão sobe para a CRIAÇÃO do envelope, no navegador de quem
-- cria — autenticado, uma vez só, e conferido pelo servidor logo em seguida. A
-- partir daí o arquivo está CONGELADO, quem assina recebe exatamente aquele
-- PDF, e a montagem vira sempre PDF→PDF, que o servidor faz sozinho (etapa 2).
--
-- O QUE ESTA TABELA É. O retrato do que foi congelado, e a ÚNICA fonte de
-- verdade sobre a impressão digital do arquivo de origem. Ela não substitui
-- `signature_request_documents` (que é sobre o ARTEFATO ASSINADO); ela é o
-- degrau anterior, e existe separada justamente para não mexer no fluxo que
-- está em produção.
--
-- Ver `docs/assinatura-montagem-no-servidor.md`.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.signature_source_files (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id  uuid NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,

  -- 'main' | 'attachment-<i>' — a MESMA chave de signature_fields.document_id e
  -- de signature_request_documents.document_key. Uma segunda numeração aqui
  -- desalinharia o campo de assinatura do arquivo em que ele foi marcado.
  document_key          text NOT NULL,
  sort_order            int  NOT NULL DEFAULT 0,
  display_name          text,

  -- ── O que o SERVIDOR apurou (autoridade) ──────────────────────────────────
  -- Estas quatro colunas nunca aceitam valor vindo do navegador. Elas nascem da
  -- Edge Function `signature-freeze-source`, que relê o arquivo do Storage.
  file_path             text NOT NULL,          -- o PDF congelado
  sha256                text,                   -- calculado a partir dos bytes lidos
  byte_size             bigint,
  is_pdf                boolean,                -- o servidor viu o `%PDF-`
  hash_source           text NOT NULL DEFAULT 'server'
                        CHECK (hash_source IN ('server')),
  frozen_at             timestamptz,

  -- ── O que o cliente DECLAROU (proveniência, não prova) ────────────────────
  -- De onde o arquivo veio e como foi convertido. Serve para explicar o
  -- histórico a quem for auditar; nada aqui é usado para atestar integridade, e
  -- por isso pode vir do navegador sem contaminar a prova.
  original_path         text,                   -- o .docx de origem, quando houve conversão
  original_name         text,
  converted_from        text CHECK (converted_from IS NULL OR converted_from IN ('docx', 'doc')),
  conversion_engine     text,                   -- 'syncfusion' | 'preview'
  conversion_searchable boolean,                -- o PDF saiu com camada de texto?

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (signature_request_id, document_key)
);

CREATE INDEX IF NOT EXISTS ssf_request_idx ON public.signature_source_files (signature_request_id);
CREATE INDEX IF NOT EXISTS ssf_sha_idx     ON public.signature_source_files (lower(sha256));

COMMENT ON TABLE public.signature_source_files IS
  'Arquivos de origem CONGELADOS de um envelope (sempre PDF), com o SHA-256 calculado pelo servidor. Ver docs/assinatura-montagem-no-servidor.md.';
COMMENT ON COLUMN public.signature_source_files.sha256 IS
  'Calculado pela Edge Function signature-freeze-source relendo o arquivo do Storage. NUNCA aceita valor do cliente.';
COMMENT ON COLUMN public.signature_source_files.conversion_engine IS
  'Declarado pelo cliente (proveniência). Não é usado para atestar integridade.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Mesma régua de `signature_request_documents`: quem pode gerenciar o envelope
-- lê; o anônimo não toca (o fluxo público só enxerga por RPC token-scoped, e
-- nesta etapa nem precisa). Escrita é exclusiva do service_role — o navegador
-- não grava aqui NEM o que ele mesmo declarou, senão a separação entre "o que o
-- servidor apurou" e "o que o cliente disse" viraria decoração.
ALTER TABLE public.signature_source_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view source files" ON public.signature_source_files;
CREATE POLICY "Staff can view source files"
  ON public.signature_source_files
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  );

-- ── Trilha ───────────────────────────────────────────────────────────────────
-- `source_frozen` é evento novo, e a trilha tem CHECK fechado de ações: sem
-- acrescentar aqui, o INSERT falharia em produção com 23514 e a Edge Function
-- registraria o congelamento em lugar nenhum. Foi por um CHECK atrasado assim
-- que outras gravações já morreram caladas neste projeto.
ALTER TABLE public.signature_audit_log
  DROP CONSTRAINT IF EXISTS signature_audit_log_action_check;

ALTER TABLE public.signature_audit_log
  ADD CONSTRAINT signature_audit_log_action_check
  CHECK (action IN (
    'created', 'sent', 'viewed', 'signed', 'cancelled', 'expired',
    'reminder_sent', 'refused', 'finalized', 'finalization_failed',
    'integrity_verified', 'integrity_violation', 'pades_signed',
    'source_frozen'
  ));

-- ── updated_at ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tocar_updated_at_signature_source_files()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ssf_updated_at ON public.signature_source_files;
CREATE TRIGGER trg_ssf_updated_at
  BEFORE UPDATE ON public.signature_source_files
  FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at_signature_source_files();
