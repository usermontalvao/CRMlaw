-- Token de autenticação para edge functions privilegiadas chamadas por cron
-- (atualmente run-djen-sync, que roda com verify_jwt=false e service role).
--
-- PROBLEMA: run-djen-sync tinha a validação de token comentada ("modo teste"),
-- ficando totalmente aberta — qualquer um disparava um job que escreve no banco,
-- chama IA e gera notificações (DoS/custo/spam). O token esperado vinha do env
-- DJEN_SYNC_TOKEN (default fraco no repo) e o cron mandava o default.
--
-- CORREÇÃO: o token esperado passa a vir desta tabela (deny-by-default), legível
-- só pela service role (a edge). Assim dá para ROTACIONAR por SQL sem redeploy,
-- e o segredo não fica no código. O cron (jobid 5) envia o mesmo valor.
-- Para rotacionar: UPDATE o token aqui e altere o ?token= do cron (cron.alter_job).

CREATE TABLE IF NOT EXISTS public.service_function_tokens (
  fn         text PRIMARY KEY,
  token      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.service_function_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_function_tokens FROM anon, authenticated, portal_client, PUBLIC;
GRANT  ALL ON public.service_function_tokens TO service_role;

-- Auto-provisiona um token forte se ainda não existir (não sobrescreve o de produção).
INSERT INTO public.service_function_tokens (fn, token)
VALUES ('run-djen-sync', replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''))
ON CONFLICT (fn) DO NOTHING;
