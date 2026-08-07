-- Limpeza do `raw` JÁ GRAVADO em whatsapp_messages.
--
-- O corte no webhook (_shared/wa-raw.ts, deploy de 06/08/2026) só vale para
-- linhas novas. As antigas continuaram carregando a mídia embutida: 130 das 831
-- linhas somam 36 dos 37 MB da coluna. Isso pesa em backup, em VACUUM, em
-- qualquer varredura da tabela e — enquanto a tabela estiver na publicação — em
-- todo evento de Realtime que toque essas linhas.
--
-- Esta migration entrega a função que espelha o `slimWaRaw` do TypeScript e a
-- rotina de limpeza em lotes. Ela NÃO limpa nada sozinha: quem dispara é
-- `select public.wa_purge_raw_blobs(<lote>)`, chamada em sequência até devolver
-- 0. Em lotes porque cada linha dessas pode ter megabytes, e um UPDATE único
-- seguraria a tabela inteira em transação.

-- ---------------------------------------------------------------------------
-- O mesmo recorte do TypeScript, em SQL
-- ---------------------------------------------------------------------------
-- Espelha supabase/functions/_shared/wa-raw.ts: mesmas chaves de blob, mesmo
-- teto de string, mesma profundidade máxima. Se um dia a lista mudar lá, muda
-- aqui — as duas existem para produzir exatamente o mesmo formato, senão linha
-- velha e linha nova deixam de ser comparáveis.

CREATE OR REPLACE FUNCTION public.wa_slim_raw(v jsonb, depth integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  resultado jsonb;
  chave text;
  item jsonb;
  texto text;
BEGIN
  -- MAX_DEPTH do TypeScript: o payload da Evolution aninha contextInfo.quotedMessage.
  IF depth > 16 THEN RETURN 'null'::jsonb; END IF;
  IF v IS NULL THEN RETURN NULL; END IF;

  CASE jsonb_typeof(v)

  WHEN 'object' THEN
    resultado := '{}'::jsonb;
    FOR chave, item IN SELECT * FROM jsonb_each(v) LOOP
      CONTINUE WHEN chave IN (
        'base64',            -- mídia inteira embutida pelo webhook (o campo mais pesado)
        'jpegThumbnail',     -- miniatura de imagem/vídeo/documento/sticker
        'thumbnail',
        'thumbnailBase64',
        'waveform',          -- desenho da onda do áudio
        'streamingSidecar',
        'scansSidecar',
        'firstFrameSidecar'
      );
      resultado := resultado || jsonb_build_object(chave, public.wa_slim_raw(item, depth + 1));
    END LOOP;
    RETURN resultado;

  WHEN 'array' THEN
    RETURN coalesce(
      (SELECT jsonb_agg(public.wa_slim_raw(e, depth + 1) ORDER BY ord)
         FROM jsonb_array_elements(v) WITH ORDINALITY t(e, ord)),
      '[]'::jsonb
    );

  WHEN 'string' THEN
    -- RAW_MAX_STRING: rede de segurança para blob que apareça em campo novo.
    texto := v #>> '{}';
    IF length(texto) > 8192 THEN
      RETURN to_jsonb(left(texto, 8192) || '…[+' || (length(texto) - 8192)::text || ']');
    END IF;
    RETURN v;

  ELSE
    RETURN v;
  END CASE;
END;
$function$;

-- ---------------------------------------------------------------------------
-- A limpeza, em lotes
-- ---------------------------------------------------------------------------
-- Devolve quantas linhas limpou. Chamar em laço até dar 0.
--
-- O filtro por `pg_column_size` evita reescrever linha que já está enxuta: sem
-- ele, cada chamada tocaria as 831 linhas de novo e geraria WAL à toa.

CREATE OR REPLACE FUNCTION public.wa_purge_raw_blobs(lote integer DEFAULT 10)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  limpas integer;
BEGIN
  WITH alvo AS (
    SELECT id
      FROM public.whatsapp_messages
     WHERE raw IS NOT NULL
       AND pg_column_size(raw) > 8192
       AND raw::text LIKE '%"base64"%'
     ORDER BY id
     LIMIT lote
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.whatsapp_messages m
     SET raw = public.wa_slim_raw(m.raw)
    FROM alvo
   WHERE m.id = alvo.id;

  GET DIAGNOSTICS limpas = ROW_COUNT;
  RETURN limpas;
END;
$function$;

REVOKE ALL ON FUNCTION public.wa_purge_raw_blobs(integer) FROM public, anon, authenticated;
