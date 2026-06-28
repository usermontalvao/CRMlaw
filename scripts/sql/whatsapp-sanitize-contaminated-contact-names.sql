-- ============================================================================
-- Saneamento: contact_name contaminado pelo bug do webhook (pushName em fromMe)
-- ============================================================================
-- CONTEXTO
--   Até a correção em `supabase/functions/evolution-webhook/index.ts` (guarda
--   `pushName && !fromMe`), uma mensagem PRÓPRIA (fromMe) gravava o `pushName` do
--   DONO da conta WhatsApp conectada como `contact_name` de contatos novos
--   (ex.: a saudação automática disparada ao abrir a conversa batizava o contato
--   de "pedro"). A origem já está bloqueada; este script trata os dados
--   históricos já contaminados de forma CONSERVADORA e AUDITÁVEL.
--
-- REGRA DE DETECÇÃO (precisa, derivada dos PRÓPRIOS dados — sem hardcode de nome)
--   Uma conversa está contaminada quando seu `contact_name` é EXATAMENTE igual ao
--   `pushName` de alguma mensagem ENVIADA por nós (direction='out',
--   raw->>'pushName' = nome do dono da conta) E esse mesmo nome NUNCA aparece como
--   `pushName` de uma mensagem RECEBIDA (direction='in') da MESMA conversa.
--   → Se o contato realmente se chama assim, o nome aparece numa mensagem recebida
--     e a conversa é PRESERVADA (não é tocada).
--
-- AÇÃO
--   Zera `contact_name` (NULL). É NÃO-DESTRUTIVO: a UI cai para o telefone e a
--   próxima mensagem recebida repopula o nome correto via webhook já corrigido.
--   NÃO adivinhamos o nome real do contato.
--
-- CONSERVADORISMO EXTRA
--   O UPDATE (passo 2) só limpa conversas SEM cliente vinculado (client_id IS NULL)
--   — exatamente o perfil das vítimas do bug (contato novo, sem cadastro). As
--   conversas contaminadas QUE TÊM client_id são apenas REPORTADAS (passo 1b) para
--   revisão manual, pois o nome pode coincidir com o cadastro do cliente.
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- PASSO 1 — AUDITORIA (somente leitura). Rode e revise ANTES de qualquer limpeza.
-- ───────────────────────────────────────────────────────────────────────────
-- 1a) Suspeitas SEM cliente vinculado → candidatas ao saneamento automático.
WITH out_names AS (
  SELECT DISTINCT m.conversation_id, m.raw->>'pushName' AS owner_name
  FROM public.whatsapp_messages m
  WHERE m.direction = 'out' AND nullif(m.raw->>'pushName', '') IS NOT NULL
),
in_names AS (
  SELECT DISTINCT m.conversation_id, m.raw->>'pushName' AS real_name
  FROM public.whatsapp_messages m
  WHERE m.direction = 'in' AND nullif(m.raw->>'pushName', '') IS NOT NULL
)
SELECT c.id, c.instance_id, c.contact_phone, c.contact_name AS contaminated_name,
       c.last_message_at
FROM public.whatsapp_conversations c
JOIN out_names o ON o.conversation_id = c.id AND o.owner_name = c.contact_name
WHERE c.contact_name IS NOT NULL
  AND c.client_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM in_names i
    WHERE i.conversation_id = c.id AND i.real_name = c.contact_name
  )
ORDER BY c.instance_id, contaminated_name, c.last_message_at DESC;

-- 1b) Suspeitas COM cliente vinculado → NÃO são limpas automaticamente.
--     Revise manualmente (o nome pode ser legítimo do cadastro do cliente).
WITH out_names AS (
  SELECT DISTINCT m.conversation_id, m.raw->>'pushName' AS owner_name
  FROM public.whatsapp_messages m
  WHERE m.direction = 'out' AND nullif(m.raw->>'pushName', '') IS NOT NULL
),
in_names AS (
  SELECT DISTINCT m.conversation_id, m.raw->>'pushName' AS real_name
  FROM public.whatsapp_messages m
  WHERE m.direction = 'in' AND nullif(m.raw->>'pushName', '') IS NOT NULL
)
SELECT c.id, c.instance_id, c.contact_phone, c.contact_name AS contaminated_name,
       c.client_id
FROM public.whatsapp_conversations c
JOIN out_names o ON o.conversation_id = c.id AND o.owner_name = c.contact_name
WHERE c.contact_name IS NOT NULL
  AND c.client_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM in_names i
    WHERE i.conversation_id = c.id AND i.real_name = c.contact_name
  )
ORDER BY c.instance_id, contaminated_name;

-- ───────────────────────────────────────────────────────────────────────────
-- PASSO 2 — SANEAMENTO (transacional). Roda em ROLLBACK por padrão: revise a
-- contagem afetada e, se estiver correta, troque ROLLBACK por COMMIT no fim.
-- ───────────────────────────────────────────────────────────────────────────
BEGIN;

WITH out_names AS (
  SELECT DISTINCT m.conversation_id, m.raw->>'pushName' AS owner_name
  FROM public.whatsapp_messages m
  WHERE m.direction = 'out' AND nullif(m.raw->>'pushName', '') IS NOT NULL
),
in_names AS (
  SELECT DISTINCT m.conversation_id, m.raw->>'pushName' AS real_name
  FROM public.whatsapp_messages m
  WHERE m.direction = 'in' AND nullif(m.raw->>'pushName', '') IS NOT NULL
)
UPDATE public.whatsapp_conversations c
SET contact_name = NULL,
    updated_at = now()
FROM out_names o
WHERE o.conversation_id = c.id
  AND o.owner_name = c.contact_name
  AND c.contact_name IS NOT NULL
  AND c.client_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM in_names i
    WHERE i.conversation_id = c.id AND i.real_name = c.contact_name
  );

-- Revise quantas linhas foram afetadas acima. Se estiver correto, troque a linha
-- abaixo por COMMIT; caso contrário deixe ROLLBACK (nada será alterado).
ROLLBACK;
-- COMMIT;
