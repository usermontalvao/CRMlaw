-- ============================================================
-- WhatsApp — BIBLIOTECA DE MÍDIAS
--
-- O mesmo vídeo de apresentação, o mesmo áudio de instrução e o mesmo PDF de
-- orientação saem todo dia, para clientes diferentes. Hoje cada envio desses é
-- um upload novo: a pessoa procura o arquivo no computador, espera subir, e o
-- storage guarda mais uma cópia do que já estava lá.
--
-- Aqui a mídia é CADASTRADA uma vez e fica disponível no compositor. O envio
-- passa a apontar para o objeto que já existe no bucket — sem upload, sem
-- espera e sem cópia nova (é o mesmo caminho do "reenviar" de um arquivo já
-- mandado, que a Edge Function `evolution-send` já sabe fazer com storage_path).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_media_library (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,                 -- como a equipe chama isso ("Vídeo de apresentação")
  category      text,                          -- agrupador livre ("Apresentação", "Previdenciário"…)
  -- Tipo do envio no WhatsApp. É o que decide o endpoint da Evolution, então
  -- vale a trava: um vídeo cadastrado como documento chegaria como anexo mudo.
  type          text NOT NULL CHECK (type IN ('image', 'video', 'audio', 'document')),
  storage_path  text NOT NULL,                 -- objeto no bucket whatsapp-media (prefixo library/)
  mime_type     text NOT NULL,
  file_name     text NOT NULL,                 -- nome que o cliente vê ao receber
  size_bytes    bigint,
  -- Legenda padrão: o texto que costuma acompanhar essa mídia. Fica editável na
  -- hora do envio; serve para não redigitar a mesma frase toda vez.
  caption       text,
  is_active     boolean NOT NULL DEFAULT true,
  usage_count   integer NOT NULL DEFAULT 0,
  last_used_at  timestamptz,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- A lista abre ordenada pelas mais usadas: quem manda o mesmo vídeo todo dia
-- encontra ele em primeiro lugar, sem procurar.
CREATE INDEX IF NOT EXISTS idx_wa_media_library_ativas
  ON public.whatsapp_media_library (is_active, usage_count DESC, name);

DROP TRIGGER IF EXISTS trg_wa_media_library_updated ON public.whatsapp_media_library;
CREATE TRIGGER trg_wa_media_library_updated BEFORE UPDATE ON public.whatsapp_media_library
  FOR EACH ROW EXECUTE FUNCTION public.wa_set_updated_at();

ALTER TABLE public.whatsapp_media_library ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_media_library_staff ON public.whatsapp_media_library;
CREATE POLICY wa_media_library_staff ON public.whatsapp_media_library FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

-- Contador de uso somado NO BANCO, e não com leitura + escrita no navegador:
-- dois atendentes mandando a mesma mídia no mesmo instante perderiam uma das
-- contagens. Também carimba o último uso, que é o desempate da ordenação.
CREATE OR REPLACE FUNCTION public.wa_media_library_touch(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.whatsapp_media_library
     SET usage_count = usage_count + 1,
         last_used_at = now()
   WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.wa_media_library_touch(uuid) TO authenticated;
