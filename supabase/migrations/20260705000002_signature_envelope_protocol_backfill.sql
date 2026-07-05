-- Backfill do protocolo do envelope para requests antigas do modelo per_document
-- que foram criadas/assinadas antes da introdução definitiva de
-- `envelope_verification_code`.

UPDATE public.signature_requests
   SET envelope_verification_code = upper(replace(gen_random_uuid()::text, '-', ''))
 WHERE signature_model = 'per_document'
   AND envelope_verification_code IS NULL;
