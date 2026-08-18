-- Apagar a gravação de uma ligação é coisa de administrador.
--
-- Uma gravação é prova: do que foi orientado, do que o cliente autorizou, do que
-- ficou combinado. Quem falou na ligação é exatamente quem tem motivo para
-- querer que ela suma, então a permissão não pode ser a mesma de quem grava.
--
-- A trava é em DOIS lugares porque apagar tem duas metades e esconder o botão
-- não é trava nenhuma:
--
--  • A LINHA — `wa_delete_call_recording` recusa quem não é administrador. Ela
--    limpa só as colunas da gravação (e a transcrição junto: quem apaga o áudio
--    não quer deixar a conversa escrita para trás); a chamada em si continua no
--    histórico, com horário, duração e desfecho. Sumir com o registro da ligação
--    seria apagar mais do que se pediu.
--
--  • O ARQUIVO — a política de DELETE do bucket deixava qualquer pessoa da
--    equipe apagar qualquer objeto do `whatsapp-media`, e políticas somam (OR):
--    não dá para restringir a pasta das gravações acrescentando outra. Por isso
--    a antiga é reescrita EXCLUINDO `call-recordings/`, e a pasta ganha uma
--    política própria, só de administrador.

/** Administrador do escritório — o mesmo cargo que o CRM chama de admin. */
CREATE OR REPLACE FUNCTION public.is_office_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = auth.uid()
       -- Sem acento e sem caixa: o cadastro grava "Administrador", e o cliente
       -- compara do mesmo jeito (ver `normalizeRole` em usePermissions).
       AND lower(translate(coalesce(p.role, ''), 'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ', 'aaaaeeiooouucAAAAEEIOOOUUC')) = 'administrador'
  );
$$;

REVOKE ALL ON FUNCTION public.is_office_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_office_admin() TO authenticated;

-- O arquivo: a equipe continua apagando mídia de conversa, menos gravação.
DROP POLICY IF EXISTS wa_media_staff_delete ON storage.objects;
CREATE POLICY wa_media_staff_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'whatsapp-media'
    AND public.is_office_staff()
    AND coalesce((storage.foldername(name))[1], '') <> 'call-recordings'
  );

DROP POLICY IF EXISTS wa_media_admin_delete_recordings ON storage.objects;
CREATE POLICY wa_media_admin_delete_recordings ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'whatsapp-media'
    AND (storage.foldername(name))[1] = 'call-recordings'
    AND public.is_office_admin()
  );

/**
 * Apaga a gravação de uma chamada (o áudio e a transcrição), mantendo o
 * registro da ligação. Devolve o caminho do arquivo para o chamador remover do
 * bucket — a política acima só deixa se ele for administrador, então a segunda
 * metade é tão travada quanto esta.
 */
CREATE OR REPLACE FUNCTION public.wa_delete_call_recording(p_call_log_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_path text;
BEGIN
  IF NOT public.is_office_admin() THEN
    RAISE EXCEPTION 'apenas administradores podem excluir gravações';
  END IF;

  SELECT recording_path INTO v_path
    FROM public.whatsapp_call_logs WHERE id = p_call_log_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chamada não encontrada';
  END IF;

  UPDATE public.whatsapp_call_logs SET
    recording_path    = NULL,
    recording_mime    = NULL,
    recording_bytes   = NULL,
    transcript        = NULL,
    transcript_status = NULL,
    transcript_model  = NULL,
    transcript_at     = NULL
  WHERE id = p_call_log_id;

  RETURN v_path;
END;
$$;

REVOKE ALL ON FUNCTION public.wa_delete_call_recording(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_delete_call_recording(uuid) TO authenticated;

COMMENT ON FUNCTION public.wa_delete_call_recording(uuid) IS
  'Apaga áudio e transcrição de uma chamada (só administrador); a linha da ligação continua no histórico.';
