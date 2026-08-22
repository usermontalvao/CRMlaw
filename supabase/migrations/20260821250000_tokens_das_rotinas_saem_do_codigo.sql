-- ============================================================================
-- O token das rotinas para de morar no código-fonte.
--
-- O QUE ESTAVA ERRADO
-- -------------------
-- Cinco funções acionadas por pg_cron autenticavam assim:
--
--   const TOKEN = Deno.env.get('WA_SCHEDULER_TOKEN') || 'wa-scheduler-2026';
--
-- O `||` é um fallback "para não quebrar em desenvolvimento". Só que
-- `WA_SCHEDULER_TOKEN`, `WA_FOLLOWUP_TOKEN` e `WA_DOC_INTAKE_TOKEN` **não
-- existem** na lista de secrets do projeto — conferido em 21/08/2026. Logo o
-- fallback não era fallback: era a credencial DE PRODUÇÃO, escrita em texto no
-- repositório, protegendo o disparo de mensagem para cliente, a varredura de
-- documentos e os três acompanhamentos.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
-- Tira o segredo do lugar onde gente lê (o código) e o põe onde só o servidor
-- lê. O valor é sorteado AQUI DENTRO, por `gen_random_uuid()`: ele não passa
-- por nenhum arquivo, nenhum terminal e nenhuma janela de chat — nasce no banco
-- e fica no banco.
--
--   · o cron lê o token na hora da chamada, de `private.app_secrets`, e o manda
--     no HEADER (`x-job-token`). Nada de `?token=` na URL, que vai para log de
--     acesso, histórico e referrer;
--   · a Edge Function confere pela RPC `wa_job_token_ok`, com service role.
--     Ela não guarda mais token nenhum em variável de ambiente.
--
-- Rodar de novo NÃO troca os tokens (o `ON CONFLICT DO NOTHING` protege): girar
-- o segredo é ato deliberado, não efeito colateral de reaplicar migration.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM public, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.app_secrets (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE private.app_secrets FROM public, anon, authenticated;
ALTER TABLE private.app_secrets ENABLE ROW LEVEL SECURITY;

-- 64 caracteres hex = os mesmos 256 bits de dois uuids v4, sem depender do
-- pgcrypto (que no Supabase mora no schema `extensions`, fora do search_path).
INSERT INTO private.app_secrets (key, value)
SELECT k, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  FROM unnest(ARRAY['wa_scheduler_token', 'wa_followup_token', 'wa_doc_intake_token']) AS k
ON CONFLICT (key) DO NOTHING;

-- Comparação em tempo constante: os dois lados têm tamanho fixo, e a diferença
-- entre "errou no 1º caractere" e "errou no último" é medível de fora.
CREATE OR REPLACE FUNCTION public.wa_job_token_ok(p_scope text, p_token text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'private' AS $$
DECLARE
  v_esperado text;
BEGIN
  SELECT value INTO v_esperado FROM private.app_secrets WHERE key = p_scope;
  IF v_esperado IS NULL OR coalesce(p_token, '') = '' THEN RETURN false; END IF;
  IF length(p_token) <> length(v_esperado) THEN RETURN false; END IF;
  RETURN hashtext(p_token) = hashtext(v_esperado) AND p_token = v_esperado;
END;
$$;

REVOKE ALL ON FUNCTION public.wa_job_token_ok(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_job_token_ok(text, text) TO service_role;

COMMENT ON TABLE private.app_secrets IS
  'Segredos das rotinas internas. Sorteados no banco; o cron os lê na hora da chamada e a Edge Function os confere por wa_job_token_ok.';
