-- ============================================================================
-- WhatsApp — o broadcast também passa a respeitar o canal.
--
--
-- ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
--
-- Existe UM tópico para o escritório inteiro, `whatsapp:messages`, e a policy
-- dele é `wa_can_read_message_broadcast()` — que quer dizer "é funcionário
-- ativo". Todo mundo recebe o aviso de toda mensagem, de todo canal.
--
-- O texto da mensagem já não viaja ali (isso foi corrigido antes: o payload é
-- só `id`, `conversation_id`, `direction`, `type`, `status`). Mas o que sobra
-- ainda é informação de um canal restrito chegando a quem não tem o canal:
--
--   · que EXISTE uma conversa com aquele id;
--   · que ela recebeu mensagem AGORA, e em que direção;
--   · o ritmo do atendimento — quantas mensagens, em que horário.
--
-- Com um id em mãos, o resto é só tentar: cada `conversation_id` novo é um
-- palpite pronto para as demais rotas. As policies de leitura barram, mas o
-- critério de aceitação é "nenhum dado de canal restrito aparece para quem não
-- tem acesso" — e o id é dado.
--
--
-- ── O QUE ESTA MIGRATION FAZ ────────────────────────────────────────────────
--
-- O tópico deixa de ser um só e passa a ser um POR CANAL:
--
--     whatsapp:messages:<instance_id>
--
-- A policy dele resolve o canal a partir do próprio nome do tópico e pergunta
-- à `wa_can_see_channel` — a mesma função que recorta a inbox.
--
-- Conversa SEM canal (`instance_id` nulo) continua no tópico antigo
-- `whatsapp:messages`, com a policy antiga: ela não pertence a canal nenhum e
-- `wa_can_see_conv` já a trata como visível a quem é do escritório. Manter o
-- tópico antigo também deixa a troca sem degrau — cliente velho continua
-- recebendo o que sempre recebeu enquanto o novo não subiu.
-- ============================================================================

begin;

-- Resolve o `<instance_id>` do nome do tópico e devolve a mesma resposta que a
-- inbox dá. Tópico malformado, canal inexistente: `false`.
create or replace function public.wa_can_read_channel_broadcast(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_sufixo text;
  v_id     uuid;
begin
  if not public.is_active_office_staff() then return false; end if;

  v_sufixo := substring(coalesce(p_topic, '') from '^whatsapp:messages:(.+)$');
  if v_sufixo is null then return false; end if;
  if v_sufixo !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_id := v_sufixo::uuid;

  return exists (
    select 1 from public.whatsapp_instances i
     where i.id = v_id
       and public.wa_can_see_channel(i.id, i.visibility_mode)
  );
end;
$$;

grant execute on function public.wa_can_read_channel_broadcast(text) to authenticated, service_role;

drop policy if exists "broadcast de mensagens do whatsapp por canal" on realtime.messages;
create policy "broadcast de mensagens do whatsapp por canal"
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and topic like 'whatsapp:messages:%'
    and public.wa_can_read_channel_broadcast(topic)
  );

-- O tópico antigo continua de pé, agora só para conversa sem canal.
-- (a policy "broadcast de mensagens do whatsapp" já existe e não muda)

-- ────────────────────────────────────────────────────────────────────────────
-- O gatilho passa a endereçar
--
-- `instance_id` não está na linha da mensagem — vem da conversa. Uma consulta
-- por evento, pelo índice primário: é o preço de o aviso ir só para quem pode
-- recebê-lo.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.broadcast_whatsapp_message_changed()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
declare
  payload      jsonb;
  precisa_reler boolean;
  v_conv       uuid;
  v_instance   uuid;
  v_topico     text;
begin
  v_conv := case when tg_op = 'DELETE' then old.conversation_id else new.conversation_id end;

  select c.instance_id into v_instance
    from public.whatsapp_conversations c where c.id = v_conv;

  v_topico := case
                when v_instance is null then 'whatsapp:messages'
                else 'whatsapp:messages:' || v_instance::text
              end;

  if tg_op = 'DELETE' then
    perform realtime.send(
      jsonb_build_object('op', 'DELETE', 'id', old.id, 'conversation_id', old.conversation_id),
      'changed', v_topico, true
    );
    return null;
  end if;

  if tg_op = 'INSERT' then
    payload := jsonb_build_object(
      'op',              'INSERT',
      'id',              new.id,
      'conversation_id', new.conversation_id,
      'direction',       new.direction,
      'type',            new.type,
      'status',          new.status,
      'refresh',         true
    );
  else
    precisa_reler :=
         old.content              is distinct from new.content
      or old.edited_at            is distinct from new.edited_at
      or old.deleted_at           is distinct from new.deleted_at
      or old.reactions            is distinct from new.reactions
      or old.transcription_text   is distinct from new.transcription_text
      or old.transcription_status is distinct from new.transcription_status
      or old.storage_path         is distinct from new.storage_path
      or old.media_url            is distinct from new.media_url
      or old.media_mime           is distinct from new.media_mime
      or old.media_size           is distinct from new.media_size
      or old.file_name            is distinct from new.file_name
      or old.is_animated          is distinct from new.is_animated
      or old.reply_to_id          is distinct from new.reply_to_id
      or old.sender_role          is distinct from new.sender_role
      or old.doc_intake_status    is distinct from new.doc_intake_status;

    payload := jsonb_build_object(
      'op',              'UPDATE',
      'id',              new.id,
      'conversation_id', new.conversation_id,
      'status',          new.status,
      'refresh',         precisa_reler
    );
  end if;

  perform realtime.send(payload, 'changed', v_topico, true);
  return null;
end;
$$;

commit;
