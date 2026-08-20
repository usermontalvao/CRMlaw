-- Consolida conversas fantasmas criadas quando a mesma pessoa chegou pelo LID
-- (`<n>@lid`) sem `remoteJidAlt`. A linha canônica é aquela do MESMO canal que
-- já conhece um telefone real e registra o mesmo `contact_lid`.
--
-- A correção do webhook impede novas ocorrências. Esta migração cuida apenas do
-- passivo identificável sem adivinhação: LID e canal precisam casar exatamente.

CREATE TEMP TABLE _wa_lid_merge_pairs ON COMMIT DROP AS
SELECT DISTINCT ON (ghost.id)
       ghost.id AS ghost_id,
       canonical.id AS canonical_id
  FROM public.whatsapp_conversations ghost
  JOIN public.whatsapp_conversations canonical
    ON canonical.instance_id = ghost.instance_id
   AND canonical.id <> ghost.id
   AND canonical.contact_lid = coalesce(
         ghost.contact_lid,
         split_part(ghost.remote_jid, '@', 1)
       )
   AND canonical.contact_phone ~ '^\d{12,13}$'
 WHERE ghost.remote_jid LIKE '%@lid'
   AND coalesce(ghost.contact_phone, '') !~ '^\d{12,13}$'
 ORDER BY ghost.id,
          (canonical.client_id IS NOT NULL) DESC,
          (nullif(btrim(coalesce(canonical.contact_name, '')), '') IS NOT NULL) DESC,
          canonical.last_message_at DESC NULLS LAST;

-- A reentrega telefone/LID pode ter gravado a mesma mensagem nas duas linhas.
-- Mantém a cópia canônica; mensagens exclusivas da linha fantasma (inclusive
-- respostas do atendente) são movidas logo abaixo e não se perdem.
DELETE FROM public.whatsapp_messages ghost_message
 USING _wa_lid_merge_pairs pair
 WHERE ghost_message.conversation_id = pair.ghost_id
   AND ghost_message.evolution_message_id IS NOT NULL
   AND EXISTS (
     SELECT 1
       FROM public.whatsapp_messages canonical_message
      WHERE canonical_message.conversation_id = pair.canonical_id
        AND canonical_message.evolution_message_id = ghost_message.evolution_message_id
   );

UPDATE public.whatsapp_messages message
   SET conversation_id = pair.canonical_id
  FROM _wa_lid_merge_pairs pair
 WHERE message.conversation_id = pair.ghost_id;

-- As ocorrências auditadas não possuíam vínculos em outras tabelas. Verifica
-- isso de novo no instante da migração: várias FKs são CASCADE e, sem esta
-- barreira, um vínculo criado entre a auditoria e o deploy seria apagado junto.
DO $$
DECLARE
  fk record;
  linked_rows bigint;
  ghost_ids uuid[] := ARRAY(SELECT ghost_id FROM _wa_lid_merge_pairs);
BEGIN
  FOR fk IN
    SELECT child_ns.nspname AS schema_name,
           child.relname AS table_name,
           child_col.attname AS column_name
      FROM pg_constraint constraint_row
      JOIN pg_class child ON child.oid = constraint_row.conrelid
      JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
      JOIN unnest(constraint_row.conkey) WITH ORDINALITY key_col(attnum, ord) ON true
      JOIN pg_attribute child_col
        ON child_col.attrelid = child.oid AND child_col.attnum = key_col.attnum
     WHERE constraint_row.contype = 'f'
       AND constraint_row.confrelid = 'public.whatsapp_conversations'::regclass
       AND child.oid <> 'public.whatsapp_messages'::regclass
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I WHERE %I = ANY ($1)',
      fk.schema_name, fk.table_name, fk.column_name
    ) INTO linked_rows USING ghost_ids;

    IF linked_rows > 0 THEN
      RAISE EXCEPTION
        'Conversa LID fantasma possui % vínculo(s) em %.%; saneamento interrompido',
        linked_rows, fk.schema_name, fk.table_name;
    END IF;
  END LOOP;
END;
$$;

DELETE FROM public.whatsapp_conversations ghost
 USING _wa_lid_merge_pairs pair
 WHERE ghost.id = pair.ghost_id;

-- Recalcula a prévia e os relógios das linhas que receberam mensagens movidas.
WITH latest AS (
  SELECT DISTINCT ON (m.conversation_id)
         m.conversation_id, m.wa_timestamp, m.direction, m.type, m.content,
         m.file_name, m.is_animated, m.deleted_at
    FROM public.whatsapp_messages m
    JOIN _wa_lid_merge_pairs pair ON pair.canonical_id = m.conversation_id
   ORDER BY m.conversation_id, m.wa_timestamp DESC, m.created_at DESC
), clocks AS (
  SELECT m.conversation_id,
         max(m.wa_timestamp) FILTER (WHERE m.direction = 'in') AS last_customer_message_at,
         max(m.wa_timestamp) FILTER (WHERE m.direction = 'out') AS last_agent_message_at
    FROM public.whatsapp_messages m
    JOIN _wa_lid_merge_pairs pair ON pair.canonical_id = m.conversation_id
   GROUP BY m.conversation_id
)
UPDATE public.whatsapp_conversations c
   SET last_message_at = latest.wa_timestamp,
       last_message_preview = CASE
         WHEN latest.deleted_at IS NOT NULL THEN 'Mensagem apagada'
         ELSE public.wa_message_preview(
           latest.type, latest.content, latest.file_name, latest.is_animated
         )
       END,
       last_message_direction = latest.direction,
       last_customer_message_at = clocks.last_customer_message_at,
       last_agent_message_at = clocks.last_agent_message_at
  FROM latest
  JOIN clocks ON clocks.conversation_id = latest.conversation_id
 WHERE c.id = latest.conversation_id;

-- LIDs ainda sem telefone conhecido continuam como conversas legítimas, mas o
-- campo exibido deixa de fingir que o apelido interno é um telefone estrangeiro.
UPDATE public.whatsapp_conversations
   SET contact_lid = coalesce(contact_lid, split_part(remote_jid, '@', 1)),
       contact_phone = ''
 WHERE remote_jid LIKE '%@lid'
   AND coalesce(contact_phone, '') !~ '^\d{12,13}$';
