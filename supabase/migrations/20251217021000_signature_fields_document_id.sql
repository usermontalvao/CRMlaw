-- Migration: Adicionar document_id em signature_fields (suporte a múltiplos documentos)

ALTER TABLE public.signature_fields
ADD COLUMN IF NOT EXISTS document_id TEXT NOT NULL DEFAULT 'main';

CREATE INDEX IF NOT EXISTS idx_signature_fields_document_id
ON public.signature_fields(document_id);
