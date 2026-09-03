-- A BUSCA DE MENSAGENS PASSA A SER INDEXADA — e a conta que motivou isto.
--
-- A primeira versão da busca montava, no cliente, um `or(...)` com as variantes
-- acentuadas do termo: o PostgREST não oferece comparação sem acento, e é assim
-- que o e-mail e o feed já resolviam. Medido em produção, com 6.563 mensagens:
--
--     6 cláusulas ILIKE, sem a política de acesso ......... 32 ms
--     72 cláusulas ILIKE, sem a política .................. 304 ms
--     72 cláusulas ILIKE, COMO O APP FAZ (com RLS) ...... 4.500 ms
--
-- Duas coisas erradas ao mesmo tempo.
--
-- A primeira: procurar "pericia" gerava 24 variantes × 3 colunas = 72
-- comparações por linha, e 22 daquelas variantes eram combinações que não
-- existem em português ("périciã", "pericíã", "périçia"). Trabalho puro.
--
-- A segunda, e a que dominava a conta: sem índice, a varredura era sequencial,
-- e a policy de `whatsapp_messages` — um EXISTS por linha, chamando
-- `wa_can_see_conv` — era avaliada nas 6.563 linhas antes de o texto sequer
-- importar. É daí que vinham os ~4,2 s de diferença entre 304 ms e 4.500 ms.
--
-- O conserto ataca as duas: UMA comparação, sobre uma forma normalizada do
-- texto, apoiada num índice de trigrama. A varredura passa a entregar ~36
-- linhas, e é sobre essas 36 que a política roda.
--
--     depois: 12 ms, com Bitmap Index Scan.
--
-- De quebra, dois defeitos de COMPORTAMENTO que o caminho antigo tinha:
--   · procurar "perícia" COM acento só funcionava se o gerador tivesse
--     produzido exatamente aquela variante — agora os dois lados normalizam;
--   · um "%" digitado no campo virava curinga e casava com tudo. O termo passa
--     a ser escapado.

-- unaccent no mesmo schema em que o pg_trgm já mora neste projeto (public).
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

-- O TEXTO PROCURÁVEL DE UMA MENSAGEM, numa forma só: minúsculas e sem acento.
--
-- IMMUTABLE porque usa a forma de DOIS argumentos do `unaccent`, com o
-- dicionário explícito. A de um argumento é apenas STABLE (ela resolve o
-- dicionário em tempo de execução), e índice exige função imutável — é esta a
-- pegadinha que faz a criação do índice falhar se alguém "simplificar" a
-- chamada aqui dentro.
CREATE OR REPLACE FUNCTION public.wa_texto_procuravel(
  p_content text, p_transcription text, p_file_name text
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary,
    lower(coalesce(p_content, '') || ' ' || coalesce(p_transcription, '') || ' ' || coalesce(p_file_name, '')));
$$;

COMMENT ON FUNCTION public.wa_texto_procuravel(text, text, text) IS
  'Texto de uma mensagem para busca: conteúdo + transcrição do áudio + nome do anexo, em minúsculas e sem acento. Base do índice idx_wa_msg_procuravel_trgm.';

-- Trigrama: é o que torna `like ''%termo%''` uma varredura de índice.
CREATE INDEX IF NOT EXISTS idx_wa_msg_procuravel_trgm
  ON public.whatsapp_messages
  USING gin (public.wa_texto_procuravel(content, transcription_text, file_name) public.gin_trgm_ops);

-- A porta que o app usa. Responde às duas perguntas do módulo com a mesma
-- consulta: `p_conversas` nulo varre tudo (a busca da inbox), com a lista varre
-- só aquelas linhas (a busca dentro de uma conversa e as irmãs dela).
CREATE OR REPLACE FUNCTION public.wa_buscar_mensagens(
  p_termo text,
  p_conversas uuid[] DEFAULT NULL,
  p_limite int DEFAULT 80
) RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  direction text,
  type text,
  content text,
  transcription_text text,
  file_name text,
  wa_timestamp timestamptz
)
LANGUAGE sql
STABLE
-- ── POR QUE DEFINER, E POR QUE ISSO NÃO AFROUXA NADA ──────────────────────
--
-- A primeira versão desta função era SECURITY INVOKER, para a policy de
-- `whatsapp_messages` continuar valendo aqui dentro. Estava certa no espírito
-- e continuava custando 4,3 s: **com RLS ligada, o índice de trigrama não
-- pode ser usado.** As quals de segurança são barreira, e o planejador só as
-- deixa passar depois de operadores e funções marcados LEAKPROOF —
-- `wa_texto_procuravel` não é (é função nossa), e neste build o próprio `~~`
-- (LIKE) também não. Marcar como leakproof exige superusuário, que o projeto
-- não tem. Resultado: a policy voltava a ser avaliada nas 6.563 linhas.
--
-- Então a régua é aplicada AQUI, explicitamente, com
-- `wa_can_see_conv_id(m.conversation_id)`. E ela não é uma segunda redação da
-- regra: conferido no banco, o corpo daquela função é EXATAMENTE o predicado
-- da policy de SELECT desta tabela —
--
--     EXISTS (SELECT 1 FROM whatsapp_conversations c
--              WHERE c.id = <a conversa da mensagem>
--                AND wa_can_see_conv(c.instance_id, c.department_id,
--                                    c.assigned_user_id, c.id))
--
-- — de modo que o conjunto devolvido é o mesmo, linha por linha. Conferido
-- também em execução: as 150 mensagens que a função devolveu foram pedidas de
-- volta pelo caminho normal, sob RLS, e as 150 voltaram. Nenhuma a mais.
--
-- Medido depois: 4.300 ms → 72 ms.
--
-- `SET search_path = public` é obrigatório num DEFINER — sem ele, quem chama
-- pode plantar um schema à frente e trocar por baixo as funções citadas aqui.
-- E o EXECUTE é só de `authenticated`: anônimo recebe 401.
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.conversation_id, m.direction, m.type,
         m.content, m.transcription_text, m.file_name, m.wa_timestamp
  FROM public.whatsapp_messages m
  -- A mesma guarda de duas letras que o cliente aplica. Repetida aqui porque
  -- quem chama por fora do app não passa por lá.
  WHERE length(btrim(coalesce(p_termo, ''))) >= 2
    AND m.deleted_at IS NULL
    AND (p_conversas IS NULL OR m.conversation_id = ANY (p_conversas))
    AND public.wa_texto_procuravel(m.content, m.transcription_text, m.file_name)
        LIKE '%' || replace(replace(replace(
              public.unaccent('public.unaccent'::regdictionary, lower(btrim(p_termo))),
              '\', '\\'), '%', '\%'), '_', '\_') || '%'
    -- A régua de canal, byte a byte a mesma da policy de SELECT. Ver a nota
    -- acima: é ela que substitui a RLS que o DEFINER desliga.
    AND public.wa_can_see_conv_id(m.conversation_id)
  ORDER BY m.wa_timestamp DESC
  LIMIT least(greatest(coalesce(p_limite, 80), 1), 200);
$$;

COMMENT ON FUNCTION public.wa_buscar_mensagens(text, uuid[], int) IS
  'Busca mensagens do WhatsApp pelo texto, pela transcrição do áudio e pelo nome do anexo, sem diferenciar acento. p_conversas NULL varre tudo que o usuário pode ler (a busca da inbox); com a lista, varre só aquelas (a busca dentro da conversa). Apoiada no índice idx_wa_msg_procuravel_trgm.';

REVOKE ALL ON FUNCTION public.wa_buscar_mensagens(text, uuid[], int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_buscar_mensagens(text, uuid[], int) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_buscar_mensagens(text, uuid[], int) TO authenticated;
