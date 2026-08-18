-- A transcrição da gravação da ligação.
--
-- A gravação já existia (ver `20260817233000_whatsapp_call_logs.sql`), mas ouvir
-- 12 minutos de conversa para lembrar o que ficou combinado é caro demais para
-- quem precisa da informação em dez segundos. A transcrição resolve isso — e
-- mora aqui, na linha da chamada, por um motivo prático: transcrever custa
-- dinheiro e tempo, então precisa acontecer UMA vez. Sem coluna, cada abertura
-- da ficha seria uma chamada nova ao Whisper para reler o mesmo áudio.
--
--  • `transcript_status` distingue os três estados que a tela precisa mostrar:
--    'pending' (foi pedida, está rodando), 'done' e 'failed'. Nulo é "nunca foi
--    pedida", que é diferente de "falhou".
--
--  • O texto é apagável sozinho. Apagar a transcrição não apaga a gravação, e
--    apagar a gravação apaga as duas — quem apaga o áudio não quer deixar a
--    conversa escrita para trás.

ALTER TABLE public.whatsapp_call_logs
  ADD COLUMN IF NOT EXISTS transcript        text,
  ADD COLUMN IF NOT EXISTS transcript_status text,
  ADD COLUMN IF NOT EXISTS transcript_model  text,
  ADD COLUMN IF NOT EXISTS transcript_at     timestamptz;

DO $$
BEGIN
  ALTER TABLE public.whatsapp_call_logs
    ADD CONSTRAINT whatsapp_call_logs_transcript_status_check
    CHECK (transcript_status IS NULL OR transcript_status IN ('pending', 'done', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.whatsapp_call_logs.transcript IS
  'Texto da gravação, transcrito sob demanda pela Edge Function call-transcribe. Guardado para nunca transcrever o mesmo áudio duas vezes.';
