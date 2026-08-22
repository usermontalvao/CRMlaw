-- ============================================================================
-- `webhook_token` e `last_qr` saem da tabela que o navegador lê.
--
-- O QUE ESTAVA ERRADO
-- -------------------
-- `whatsapp_instances` é lida pelo front (a lista de canais da inbox), e a
-- policy `wa_inst_select` entrega a LINHA inteira. Junto com nome, cor e
-- telefone iam duas coisas que não são dado de canal, são CREDENCIAL:
--
--   · `webhook_token` — é a única autenticação do `evolution-webhook`, que roda
--     sem JWT. Quem tem o token injeta evento no CRM como se fosse o WhatsApp:
--     mensagem que nunca existiu, na conversa que escolher;
--   · `last_qr` — o QR de pareamento. Quem lê o QR entra na conta de WhatsApp
--     do escritório.
--
-- As contas auxiliares da auditoria leram os dois, dos canais que a policy lhes
-- mostrava.
--
-- POR QUE NÃO FOI `REVOKE` DE COLUNA
-- ----------------------------------
-- Seria uma linha, e derrubaria o módulo: `admin.ts:36` faz `select('*')`, e o
-- PostgREST devolve 42501 quando falta privilégio em QUALQUER coluna do `*`.
-- Tirar a coluna da tabela, ao contrário, é transparente — `*` simplesmente
-- devolve uma coluna a menos, e nada no `src/` lê essas duas (só o tipo e os
-- mocks de dev, ajustados no mesmo commit).
--
-- O QUE ESTA MIGRATION FAZ (é o passo 1 de 2)
-- ------------------------------------------
-- Cria o cofre e as duas portas, e DEIXA as colunas onde estão. Elas só caem no
-- passo 2, depois que `evolution-webhook` e `evolution-instance` estiverem no ar
-- lendo daqui — derrubar antes deixaria o webhook sem conseguir achar o canal,
-- e a ingestão de mensagem para de pé.
--
-- `last_qr` não ganha cofre: nada NUNCA leu essa coluna: ela só era escrita.
-- Um QR guardado é um QR que pode vazar; ele morre no passo 2.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM public, anon, authenticated;
GRANT  USAGE ON SCHEMA private TO service_role;

CREATE TABLE IF NOT EXISTS private.whatsapp_instance_secrets (
  instance_id   uuid PRIMARY KEY REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  webhook_token text UNIQUE,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE private.whatsapp_instance_secrets FROM public, anon, authenticated;
ALTER TABLE private.whatsapp_instance_secrets ENABLE ROW LEVEL SECURITY;

-- Os tokens que já existem mudam de lugar, não de valor: trocá-los agora
-- exigiria reconfigurar o webhook em cada instância da Evolution, e o canal
-- ficaria surdo até lá.
INSERT INTO private.whatsapp_instance_secrets (instance_id, webhook_token)
SELECT id, webhook_token FROM public.whatsapp_instances WHERE webhook_token IS NOT NULL
ON CONFLICT (instance_id) DO UPDATE SET webhook_token = EXCLUDED.webhook_token;

-- ── As duas portas ─────────────────────────────────────────────────────────
--
-- SECURITY DEFINER porque o cofre é privado, e concedidas SÓ a `service_role`:
-- quem chama são as Edge Functions. `authenticated` não recebe GRANT nenhum —
-- se receber um dia por engano, ainda assim não há caminho de leitura do token
-- por aqui: a primeira devolve o canal, não o segredo.
CREATE OR REPLACE FUNCTION public.wa_channel_by_webhook_token(p_token text)
RETURNS TABLE(id uuid, instance_name text, status text,
              last_open_at timestamptz, connected_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'private' AS $$
  SELECT i.id, i.instance_name, i.status, i.last_open_at, i.connected_at
    FROM private.whatsapp_instance_secrets s
    JOIN public.whatsapp_instances i ON i.id = s.instance_id
   WHERE s.webhook_token = p_token
     AND coalesce(btrim(p_token), '') <> ''
   LIMIT 1;
$$;

-- Devolve o token do canal, criando um se ainda não houver. É o que o
-- `evolution-instance` precisa para montar a URL do webhook na hora de parear.
CREATE OR REPLACE FUNCTION public.wa_ensure_webhook_token(p_channel uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private' AS $$
DECLARE
  v_token text;
BEGIN
  SELECT webhook_token INTO v_token
    FROM private.whatsapp_instance_secrets WHERE instance_id = p_channel;

  IF v_token IS NULL OR btrim(v_token) = '' THEN
    v_token := replace(gen_random_uuid()::text, '-', '')
            || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO private.whatsapp_instance_secrets (instance_id, webhook_token)
    VALUES (p_channel, v_token)
    ON CONFLICT (instance_id) DO UPDATE
      SET webhook_token = EXCLUDED.webhook_token, updated_at = now();
  END IF;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.wa_channel_by_webhook_token(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.wa_ensure_webhook_token(uuid)     FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_channel_by_webhook_token(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_ensure_webhook_token(uuid)     TO service_role;

COMMENT ON TABLE private.whatsapp_instance_secrets IS
  'Cofre do canal: o token do webhook, fora da tabela que o navegador lê.';

-- ── PASSO 2 (aplicado depois do deploy das duas Edge Functions) ─────────────
-- Conferido ponta a ponta antes de derrubar: token do cofre devolve 200 no
-- webhook, token inventado devolve 401.
--
-- Nota do caminho: a primeira versão de `wa_ensure_webhook_token` usava
-- `gen_random_bytes` (pgcrypto, que no Supabase mora no schema `extensions`) e
-- estourava 42883 fora do `search_path` fixado. Só um canal NOVO passaria por
-- ali, então a falha dormiria até o próximo pareamento. `gen_random_uuid()` é
-- do core: dois uuids sem hífen dão os mesmos 256 bits, sem depender de extensão.
DROP INDEX IF EXISTS public.uq_wa_inst_webhook_token;

ALTER TABLE public.whatsapp_instances
  DROP COLUMN IF EXISTS webhook_token,
  DROP COLUMN IF EXISTS last_qr;
