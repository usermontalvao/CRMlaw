-- ============================================================================
-- Bucket `whatsapp-media`: o arquivo passa a seguir a conversa.
--
-- O QUE ESTAVA ERRADO
-- -------------------
-- `wa_media_staff_select` parava em `is_office_staff()`. Recortar a LINHA da
-- mensagem sem recortar o ARQUIVO não protege nada: o áudio, a foto, o
-- documento e o rosto do contato são o conteúdo do atendimento, e o caminho do
-- objeto é adivinhável a partir de qualquer id de conversa. Uma conta auxiliar
-- listava os 1.476 objetos do bucket — e a gravação de ligação junto.
--
-- COMO O BUCKET ESTÁ ORGANIZADO (é isso que a regra lê)
-- ----------------------------------------------------
--   <instance_id>/<conversation_id>/<arquivo>  → mídia RECEBIDA (evolution-webhook)
--   out/<conversation_id>/<uuid>.<ext>         → mídia ENVIADA pelo escritório
--   avatars/<conversation_id>.<ext>            → rosto do contato
--   call-recordings/<call_id>.webm             → gravação de ligação
--   library/<uuid>.<ext>                       → biblioteca de mídias
--
-- Só a biblioteca não pertence a conversa nenhuma: ela é acervo do escritório,
-- cadastrado para reenvio, e continua valendo para toda a equipe interna.
--
-- A gravação não tem conversa no caminho — ela casa por `recording_path` com a
-- linha de `whatsapp_call_logs`, e daí herda `wa_can_see_call`: a minha ligação
-- é minha, a do atendimento que eu enxergo eu enxergo, e o resto não.
--
-- FALHA FECHADA: caminho de formato desconhecido não é visível para ninguém
-- (fora supervisor, que a própria `wa_can_see_conv_id` já libera). Hoje os
-- 1.476 objetos do bucket cabem nos cinco formatos acima.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wa_media_visivel(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'storage'
AS $$
DECLARE
  v_pastas text[] := storage.foldername(coalesce(p_name, ''));
  v_raiz   text   := coalesce(v_pastas[1], '');
  v_conv   text;
BEGIN
  IF NOT public.is_office_staff() THEN RETURN false; END IF;

  -- Acervo do escritório: não é dado de conversa nenhuma.
  IF v_raiz = 'library' THEN RETURN true; END IF;

  -- Gravação: herda a visibilidade da ligação a que pertence.
  IF v_raiz = 'call-recordings' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.whatsapp_call_logs l
       WHERE l.recording_path = p_name
         AND public.wa_can_see_call(l.conversation_id, l.phone, l.user_id)
    );
  END IF;

  -- Rosto do contato: `avatars/<conversation_id>.<ext>`.
  IF v_raiz = 'avatars' THEN
    v_conv := regexp_replace(storage.filename(p_name), '\.[^.]*$', '');
  ELSE
    -- `out/<conv>/…` e `<instance>/<conv>/…` — a conversa é sempre a 2ª pasta.
    v_conv := coalesce(v_pastas[2], '');
  END IF;

  -- Anexo escolhido antes de a conversa existir (`out/new/<uuid>`): não há
  -- conversa para consultar ainda, e o nome do arquivo é um uuid sorteado na
  -- hora do upload. Fica na equipe interna, como antes desta migration.
  IF v_raiz = 'out' AND v_conv = 'new' THEN RETURN true; END IF;

  IF v_conv !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  RETURN public.wa_can_see_conv_id(v_conv::uuid);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.wa_media_visivel(text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.wa_media_visivel(text) TO authenticated;

-- ── Leitura, alteração e remoção passam pela regra ─────────────────────────
DROP POLICY IF EXISTS wa_media_staff_select ON storage.objects;
CREATE POLICY wa_media_staff_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'whatsapp-media' AND public.wa_media_visivel(name));

DROP POLICY IF EXISTS wa_media_staff_update ON storage.objects;
CREATE POLICY wa_media_staff_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'whatsapp-media' AND public.wa_media_visivel(name))
  WITH CHECK (bucket_id = 'whatsapp-media' AND public.is_office_staff());

-- A remoção já barrava gravação (só admin, pela policy irmã); agora barra
-- também o anexo de conversa que a pessoa não enxerga.
DROP POLICY IF EXISTS wa_media_staff_delete ON storage.objects;
CREATE POLICY wa_media_staff_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'whatsapp-media'
    AND coalesce((storage.foldername(name))[1], '') <> 'call-recordings'
    AND public.wa_media_visivel(name)
  );

COMMENT ON FUNCTION public.wa_media_visivel(text) IS
  'Visibilidade de um objeto do bucket whatsapp-media: o arquivo herda a regra de canal da conversa a que pertence.';
