-- ============================================================================
-- WhatsApp — as RPCs de atendimento, agora com porteiro em cada linha que tocam.
--
-- Depende de `20260822090000_whatsapp_permissoes_nucleo.sql`, que criou as
-- funções de decisão e o estado da transferência.
--
--
-- ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
--
-- 1. O LEQUE POR `attendance_key` AGIA SEM PORTEIRO.
--
--    Todas as RPCs seguiam o mesmo desenho: conferir a visibilidade da conversa
--    SELECIONADA e, em seguida, agir sobre todas as irmãs —
--
--        WHERE c.id = v_selected.id
--           OR (v_selected.attendance_key IS NOT NULL
--               AND c.attendance_key = v_selected.attendance_key)
--
--    — sem conferir nenhuma delas. `attendance_key` agrupa pela PESSOA (telefone
--    ou cliente), não pelo canal. Então bastava ter acesso à conversa da mesma
--    pessoa num canal aberto para assumir, encerrar, reabrir e marcar como lida
--    a conversa dela no canal restrito. A conferência existia; ela só olhava
--    para a linha errada.
--
-- 2. ACEITAR NÃO EXIGIA TRANSFERÊNCIA.
--
--        SELECT * INTO v_transfer FROM whatsapp_transfers ... ;
--        IF FOUND THEN
--          ... confere se o destino sou eu ...
--        END IF;
--        -- e segue em frente de qualquer jeito
--
--    Sem nenhuma transferência pendente, o `IF FOUND` simplesmente não
--    executava e a função continuava, atribuindo a conversa a quem chamou.
--    "Aceitar" virou um segundo "assumir", sem o convite.
--
--    E o carimbo do aceite era:
--
--        UPDATE whatsapp_transfers SET accepted_at = now(), accepted_by = v_actor
--         WHERE conversation_id = ANY(v_ids) AND accepted_at IS NULL;
--
--    — que aceita também as transferências IRMÃS, inclusive as destinadas a
--    outras pessoas e a outros setores.
--
-- 3. DISTRIBUIR NÃO EXIGIA SUPERVISOR, E O DESTINO NÃO ERA CONFERIDO.
--
--    `wa_assign_contact_attendance` pedia só `is_office_staff()` e, do destino,
--    apenas `is_active`. Qualquer atendente jogava qualquer conversa no colo de
--    qualquer colega — inclusive de um colega que não enxerga aquele canal, e
--    aí a conversa sumia: sem dono efetivo, sem aparecer para ninguém.
--
--
-- ── O QUE ESTA MIGRATION FAZ ────────────────────────────────────────────────
--
--   · um recorte só, `wa_attendance_scope`, usado por TODAS as RPCs: ele trava
--     e devolve apenas as irmãs que o autor pode mesmo comandar;
--   · aceitar exige transferência pendente, prefere `transfer_id`, é idempotente
--     e carimba SÓ a transferência aceita;
--   · nascem rejeitar, cancelar e expirar;
--   · distribuir vira ato de supervisor (com uma exceção nomeada: entregar o que
--     é seu, que é o que a transferência dentro da ligação faz);
--   · todo destino passa por `wa_destination_can_access`;
--   · a intervenção de quem não é o responsável fica registrada — inclusive a
--     resposta "sem assumir".
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Vocabulário novo da auditoria
-- ────────────────────────────────────────────────────────────────────────────

alter table public.whatsapp_attendance_events
  drop constraint if exists whatsapp_attendance_events_event_type_check;

alter table public.whatsapp_attendance_events
  add constraint whatsapp_attendance_events_event_type_check
  check (event_type in (
    'closed', 'reopened', 'reopened_inbound', 'assumed', 'assigned',
    'released', 'transferred', 'transfer_accepted',
    -- novos
    'transfer_rejected', 'transfer_cancelled', 'transfer_expired',
    'takeover', 'supervisor_reply', 'offboard_reassigned', 'collaborator_granted'
  ));

-- Quem mandou a mensagem, e em que qualidade. É o que a bolha do CRM usa para
-- escrever "Mensagem enviada por Fulano — Administrador": sem isto, a resposta
-- de um supervisor que não assumiu ficava indistinguível da do responsável, e
-- os dois descobriam o atropelo pelo cliente.
alter table public.whatsapp_messages
  add column if not exists sender_role text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_messages_sender_role_check') then
    alter table public.whatsapp_messages
      add constraint whatsapp_messages_sender_role_check
      check (sender_role is null or sender_role in ('attendant', 'supervisor', 'admin', 'system', 'ai'));
  end if;
end $$;

comment on column public.whatsapp_messages.sender_role is
  'Em que qualidade a mensagem saiu. ''supervisor''/''admin'' = intervenção de quem NÃO é o responsável (resposta sem assumir) e a bolha diz isso na tela.';

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O recorte único — o porteiro que faltava no leque
--
-- Trava as irmãs em ordem de `id` (sempre a mesma ordem, para não haver
-- deadlock entre dois atendentes agindo no mesmo contato) e devolve apenas
-- aquelas que o autor pode comandar.
--
-- `p_require_manage = false` é o caso do ACEITE: ali a autorização vem da
-- transferência, e ainda não existe direito sobre a conversa.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_attendance_scope(
  p_selected uuid,
  p_require_manage boolean default true
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_sel public.whatsapp_conversations%rowtype;
  v_ids uuid[];
begin
  select * into v_sel from public.whatsapp_conversations where id = p_selected;
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;

  -- Trava tudo que POSSA entrar no leque, e só depois filtra: travar apenas o
  -- que passou no filtro deixaria a irmã de fora mudar debaixo da transação.
  perform c.id
     from public.whatsapp_conversations c
    where c.id = v_sel.id
       or (v_sel.attendance_key is not null and c.attendance_key = v_sel.attendance_key)
    order by c.id
      for update;

  select coalesce(array_agg(c.id order by c.id), '{}'::uuid[])
    into v_ids
    from public.whatsapp_conversations c
   where (c.id = v_sel.id
      or (v_sel.attendance_key is not null and c.attendance_key = v_sel.attendance_key))
     and c.status in ('open', 'pending')
     -- AQUI está a correção: cada irmã responde por si.
     and (
       not p_require_manage
       or public.wa_can_manage_conv(c.id)
     );

  return v_ids;
end;
$$;

comment on function public.wa_attendance_scope(uuid, boolean) is
  'As conversas irmãs (mesmo attendance_key) que o autor pode COMANDAR, já travadas. Irmã em canal que ele não comanda fica de fora — antes ela ia junto.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Assumir
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_assume_contact_attendance(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_actor    uuid := auth.uid();
  v_sel      public.whatsapp_conversations%rowtype;
  v_before   jsonb;
  v_ids      uuid[];
  v_takeover boolean;
begin
  if v_actor is null or not public.is_office_staff() then
    raise exception using errcode = '42501', message = 'Sessão de atendente inválida.';
  end if;

  select * into v_sel from public.whatsapp_conversations where id = p_conversation_id for update;
  if not found then raise exception 'Conversa não encontrada.'; end if;

  if not public.wa_can_manage_conv(v_sel.id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este atendimento.';
  end if;

  -- Tomar a conversa de um colega é intervenção, não rotina: só o supervisor
  -- daquele canal/setor e o administrador fazem, e fica registrado como tal.
  v_takeover := v_sel.assigned_user_id is not null and v_sel.assigned_user_id <> v_actor;
  if v_takeover
     and not (public.wa_is_admin()
              or public.wa_is_supervisor_of_channel(v_sel.instance_id)
              or public.wa_supervises_department(v_sel.department_id)) then
    raise exception using errcode = '42501',
      message = 'Este atendimento já tem responsável. Peça a transferência ou fale com um supervisor.';
  end if;

  -- Idempotência: já sou o responsável, não há o que fazer nem o que auditar.
  if v_sel.assigned_user_id = v_actor and not coalesce(v_sel.awaiting_accept, false) then
    return jsonb_build_object('affected_ids', to_jsonb(array[v_sel.id]), 'affected_count', 1, 'noop', true);
  end if;

  v_ids   := public.wa_attendance_scope(v_sel.id, true);
  v_before := public.wa_attendance_before_state(v_sel.id);

  update public.whatsapp_conversations
     set assigned_user_id = v_actor,
         awaiting_accept = false,
         transfer_pending_since = null
   where id = any(v_ids);

  -- Assumir resolve o handoff em curso: as pendentes desta conversa deixam de
  -- conceder acesso a quem quer que fosse o destino.
  update public.whatsapp_transfers
     set status = case when to_user_id = v_actor then 'accepted' else 'cancelled' end,
         accepted_at = case when to_user_id = v_actor then now() else accepted_at end,
         accepted_by = case when to_user_id = v_actor then v_actor else accepted_by end,
         resolved_at = now(),
         resolved_by = v_actor
   where conversation_id = any(v_ids) and status = 'pending';

  insert into public.whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, before_state
  ) values (
    coalesce(v_sel.attendance_key, 'r:' || v_sel.id::text),
    case when v_takeover then 'takeover' else 'assumed' end,
    v_sel.id, v_ids, v_actor, v_before
  );

  return jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Distribuir (atribuir sem aceite)
--
-- Ato de supervisor, com UMA exceção nomeada: entregar o que já é seu. É o que
-- a transferência dentro da ligação faz — o colega já atendeu a chamada, o
-- aceite aconteceu por voz, e obrigar um clique depois só criaria conversa sem
-- dono. Entregar o próprio atendimento é o mesmo direito de transferir, sem a
-- espera; não é distribuir o dos outros.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_assign_contact_attendance(
  p_conversation_id uuid,
  p_to_user_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_actor  uuid := auth.uid();
  v_sel    public.whatsapp_conversations%rowtype;
  v_before jsonb;
  v_ids    uuid[];
  v_now    timestamptz := now();
  v_supervisor boolean;
begin
  if v_actor is null or not public.is_office_staff() then
    raise exception using errcode = '42501', message = 'Sessão de atendente inválida.';
  end if;
  if p_to_user_id is null then
    raise exception 'Informe o atendente de destino.';
  end if;

  select * into v_sel from public.whatsapp_conversations where id = p_conversation_id for update;
  if not found then raise exception 'Conversa não encontrada.'; end if;

  if not public.wa_can_manage_conv(v_sel.id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este atendimento.';
  end if;

  v_supervisor := public.wa_is_admin()
               or public.wa_is_supervisor_of_channel(v_sel.instance_id)
               or public.wa_supervises_department(v_sel.department_id);

  if not v_supervisor
     and coalesce(v_sel.assigned_user_id, v_actor) <> v_actor then
    raise exception using errcode = '42501',
      message = 'Só um supervisor pode redistribuir o atendimento de outra pessoa.';
  end if;

  if not public.wa_destination_can_access(v_sel.id, p_to_user_id, null) then
    raise exception using errcode = '42501',
      message = 'O destino não está ativo ou não tem acesso ao canal/setor deste atendimento.';
  end if;

  -- Idempotência.
  if v_sel.assigned_user_id = p_to_user_id and not coalesce(v_sel.awaiting_accept, false) then
    return jsonb_build_object('affected_ids', to_jsonb(array[v_sel.id]), 'affected_count', 1, 'noop', true);
  end if;

  v_ids   := public.wa_attendance_scope(v_sel.id, true);
  v_before := public.wa_attendance_before_state(v_sel.id);

  insert into public.whatsapp_transfers (
    conversation_id, from_user_id, to_user_id, from_department_id,
    to_department_id, note, performed_by, status,
    accepted_at, accepted_by, resolved_at, resolved_by, expires_at
  )
  select c.id, c.assigned_user_id, p_to_user_id, c.department_id,
         null, coalesce(nullif(btrim(p_note), ''), 'Distribuição da fila'),
         v_actor, 'accepted', v_now, p_to_user_id, v_now, v_actor, null
    from public.whatsapp_conversations c where c.id = any(v_ids);

  -- Pendências anteriores morrem aqui: a conversa acabou de ganhar dono.
  update public.whatsapp_transfers
     set status = 'cancelled', resolved_at = v_now, resolved_by = v_actor
   where conversation_id = any(v_ids) and status = 'pending';

  update public.whatsapp_conversations
     set assigned_user_id = p_to_user_id,
         awaiting_accept = false,
         transfer_pending_since = null
   where id = any(v_ids);

  insert into public.whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, reason, before_state
  ) values (
    coalesce(v_sel.attendance_key, 'r:' || v_sel.id::text), 'assigned',
    v_sel.id, v_ids, v_actor, nullif(left(btrim(coalesce(p_note, '')), 300), ''), v_before
  );

  return jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Transferir (com aceite)
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_transfer_contact_attendance(
  p_conversation_id uuid,
  p_to_user_id uuid default null,
  p_to_department_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_actor  uuid := auth.uid();
  v_sel    public.whatsapp_conversations%rowtype;
  v_before jsonb;
  v_ids    uuid[];
  v_now    timestamptz := now();
begin
  if v_actor is null or not public.is_office_staff() then
    raise exception using errcode = '42501', message = 'Sessão de atendente inválida.';
  end if;
  if p_to_user_id is null and p_to_department_id is null then
    raise exception 'Informe uma pessoa ou setor de destino.';
  end if;
  if p_to_user_id is not null and p_to_user_id = v_actor then
    raise exception 'Este atendimento já seria seu — use "Assumir".';
  end if;

  select * into v_sel from public.whatsapp_conversations where id = p_conversation_id for update;
  if not found then raise exception 'Conversa não encontrada.'; end if;

  if not public.wa_can_transfer_conv(v_sel.id) then
    raise exception using errcode = '42501',
      message = 'Somente o responsável ou um supervisor do canal pode transferir este atendimento.';
  end if;

  if not public.wa_destination_can_access(v_sel.id, p_to_user_id, p_to_department_id) then
    raise exception using errcode = '42501',
      message = 'O destino não está ativo ou não tem acesso ao canal/setor deste atendimento.';
  end if;

  v_ids   := public.wa_attendance_scope(v_sel.id, true);
  v_before := public.wa_attendance_before_state(v_sel.id);

  if cardinality(v_ids) = 0 then
    raise exception using errcode = '42501', message = 'Nada a transferir neste atendimento.';
  end if;

  -- Uma transferência pendente por conversa: a nova substitui a anterior em vez
  -- de empilhar duas pendências disputando o mesmo aceite.
  update public.whatsapp_transfers
     set status = 'cancelled', resolved_at = v_now, resolved_by = v_actor
   where conversation_id = any(v_ids) and status = 'pending';

  insert into public.whatsapp_transfers (
    conversation_id, from_user_id, to_user_id, from_department_id,
    to_department_id, note, performed_by, status, expires_at
  )
  select c.id, c.assigned_user_id, p_to_user_id, c.department_id,
         p_to_department_id, nullif(btrim(p_note), ''), v_actor,
         'pending', v_now + public.wa_transfer_default_ttl()
    from public.whatsapp_conversations c where c.id = any(v_ids);

  update public.whatsapp_conversations
     set assigned_user_id = p_to_user_id,
         department_id = coalesce(p_to_department_id, department_id),
         awaiting_accept = true,
         transfer_pending_since = v_now
   where id = any(v_ids);

  insert into public.whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, reason, before_state
  ) values (
    coalesce(v_sel.attendance_key, 'r:' || v_sel.id::text), 'transferred',
    v_sel.id, v_ids, v_actor, nullif(left(btrim(coalesce(p_note, '')), 300), ''), v_before
  );

  return jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Aceitar
--
-- A assinatura muda: `p_transfer_id` é o caminho preferido, porque ele não tem
-- ambiguidade — diz QUAL convite está sendo aceito. `p_conversation_id`
-- continua aceito (é o que a inbox tem em mãos quando o aviso chega), e nesse
-- caso a função resolve a transferência pendente DESTINADA A QUEM CHAMOU;
-- não havendo, recusa em vez de "assumir por dentro".
-- ────────────────────────────────────────────────────────────────────────────

drop function if exists public.wa_accept_contact_transfer(uuid);

create or replace function public.wa_accept_contact_transfer(
  p_conversation_id uuid default null,
  p_transfer_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_actor    uuid := auth.uid();
  v_transfer public.whatsapp_transfers%rowtype;
  v_sel      public.whatsapp_conversations%rowtype;
  v_before   jsonb;
  v_ids      uuid[];
  v_now      timestamptz := now();
begin
  if v_actor is null or not public.is_office_staff() then
    raise exception using errcode = '42501', message = 'Sessão de atendente inválida.';
  end if;
  if p_transfer_id is null and p_conversation_id is null then
    raise exception 'Informe a transferência a aceitar.';
  end if;

  if p_transfer_id is not null then
    select * into v_transfer from public.whatsapp_transfers where id = p_transfer_id for update;
    if not found then raise exception 'Transferência não encontrada.'; end if;
  else
    -- Só as destinadas a MIM (ou ao meu setor) entram no candidato. Sem isto,
    -- pegar "a última pendente da conversa" é aceitar o convite dos outros.
    select t.* into v_transfer
      from public.whatsapp_transfers t
     where t.conversation_id = p_conversation_id
       and t.status = 'pending'
       and (t.expires_at is null or t.expires_at > v_now)
       and (
         t.to_user_id = v_actor
         or (t.to_user_id is null and t.to_department_id is not null and exists (
              select 1 from public.whatsapp_department_members dm
               where dm.department_id = t.to_department_id and dm.user_id = v_actor))
         or public.wa_is_admin()
       )
     order by t.created_at desc
     limit 1
       for update;
    if not found then
      raise exception using errcode = '42501',
        message = 'Não há transferência pendente deste atendimento para você.';
    end if;
  end if;

  -- Aceite duplicado (dois cliques, duas abas) não é erro: é a mesma resposta.
  if v_transfer.status = 'accepted' and v_transfer.accepted_by = v_actor then
    return jsonb_build_object(
      'affected_ids', to_jsonb(array[v_transfer.conversation_id]),
      'affected_count', 1, 'noop', true
    );
  end if;
  if v_transfer.status <> 'pending' then
    raise exception using errcode = '42501',
      message = format('Esta transferência já foi %s.',
        case v_transfer.status
          when 'accepted'  then 'aceita por outra pessoa'
          when 'rejected'  then 'recusada'
          when 'cancelled' then 'cancelada'
          else 'encerrada por tempo' end);
  end if;
  if v_transfer.expires_at is not null and v_transfer.expires_at <= v_now then
    update public.whatsapp_transfers
       set status = 'expired', resolved_at = v_now where id = v_transfer.id;
    raise exception using errcode = '42501', message = 'Esta transferência expirou.';
  end if;
  if not public.wa_can_accept_transfer(v_transfer.id) then
    raise exception using errcode = '42501',
      message = 'Esta transferência é destinada a outro atendente.';
  end if;

  select * into v_sel from public.whatsapp_conversations
   where id = v_transfer.conversation_id for update;
  if not found then raise exception 'Conversa não encontrada.'; end if;

  -- `p_require_manage = false`: quem aceita ainda não manda na conversa — é o
  -- aceite que o torna responsável. O recorte, porém, continua sendo por irmã:
  -- só entram as que a transferência efetivamente alcançou.
  v_ids := public.wa_attendance_scope(v_sel.id, false);
  v_ids := (
    select coalesce(array_agg(c.id order by c.id), '{}'::uuid[])
      from unnest(v_ids) as x(id)
      join public.whatsapp_conversations c on c.id = x.id
     where exists (
       select 1 from public.whatsapp_transfers t
        where t.conversation_id = c.id
          and t.status = 'pending'
          and coalesce(t.to_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
              is not distinct from coalesce(v_transfer.to_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
          and coalesce(t.to_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
              is not distinct from coalesce(v_transfer.to_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
     )
  );
  if not (v_sel.id = any(v_ids)) then
    v_ids := array_append(v_ids, v_sel.id);
  end if;

  v_before := public.wa_attendance_before_state(v_sel.id);

  update public.whatsapp_conversations
     set assigned_user_id = v_actor,
         awaiting_accept = false,
         transfer_pending_since = null
   where id = any(v_ids);

  -- Carimba SÓ as que têm o mesmo destino desta. A irmã destinada a outra
  -- pessoa continua pendente, esperando quem foi convidado.
  update public.whatsapp_transfers t
     set status = 'accepted', accepted_at = v_now, accepted_by = v_actor,
         resolved_at = v_now, resolved_by = v_actor
   where t.conversation_id = any(v_ids)
     and t.status = 'pending'
     and coalesce(t.to_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
         is not distinct from coalesce(v_transfer.to_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and coalesce(t.to_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
         is not distinct from coalesce(v_transfer.to_department_id, '00000000-0000-0000-0000-000000000000'::uuid);

  insert into public.whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, before_state
  ) values (
    coalesce(v_sel.attendance_key, 'r:' || v_sel.id::text), 'transfer_accepted',
    v_sel.id, v_ids, v_actor, v_before
  );

  return jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Recusar e cancelar — os dois desfechos que não existiam
--
-- Sem eles, a transferência que ninguém quis só tinha um caminho: apodrecer
-- como "aguardando aceite" até alguém reparar. O cliente, do outro lado, acha
-- que está sendo atendido.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_reject_contact_transfer(
  p_transfer_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_actor uuid := auth.uid();
  v_t     public.whatsapp_transfers%rowtype;
  v_sel   public.whatsapp_conversations%rowtype;
  v_now   timestamptz := now();
begin
  if v_actor is null or not public.is_office_staff() then
    raise exception using errcode = '42501', message = 'Sessão de atendente inválida.';
  end if;

  select * into v_t from public.whatsapp_transfers where id = p_transfer_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if v_t.status = 'rejected' then
    return jsonb_build_object('transfer_id', v_t.id, 'status', 'rejected', 'noop', true);
  end if;
  if v_t.status <> 'pending' then
    raise exception using errcode = '42501', message = 'Esta transferência já foi resolvida.';
  end if;
  -- Recusar é direito de quem foi convidado (a mesma checagem do aceite).
  if not public.wa_can_accept_transfer(v_t.id) then
    raise exception using errcode = '42501', message = 'Esta transferência não é sua para recusar.';
  end if;

  select * into v_sel from public.whatsapp_conversations where id = v_t.conversation_id for update;

  update public.whatsapp_transfers
     set status = 'rejected', resolved_at = v_now, resolved_by = v_actor,
         note = coalesce(nullif(btrim(p_reason), ''), note)
   where id = v_t.id;

  -- Devolve a conversa a quem a passou. Ela não pode ficar no nome de quem
  -- recusou, nem sumir da fila.
  update public.whatsapp_conversations
     set assigned_user_id = v_t.from_user_id,
         department_id = coalesce(v_t.from_department_id, department_id),
         awaiting_accept = false,
         transfer_pending_since = null
   where id = v_t.conversation_id;

  insert into public.whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, reason
  ) values (
    coalesce(v_sel.attendance_key, 'r:' || v_sel.id::text), 'transfer_rejected',
    v_sel.id, array[v_sel.id], v_actor, nullif(left(btrim(coalesce(p_reason, '')), 300), '')
  );

  return jsonb_build_object('transfer_id', v_t.id, 'status', 'rejected');
end;
$$;

create or replace function public.wa_cancel_contact_transfer(
  p_transfer_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_actor uuid := auth.uid();
  v_t     public.whatsapp_transfers%rowtype;
  v_sel   public.whatsapp_conversations%rowtype;
  v_now   timestamptz := now();
begin
  if v_actor is null or not public.is_office_staff() then
    raise exception using errcode = '42501', message = 'Sessão de atendente inválida.';
  end if;

  select * into v_t from public.whatsapp_transfers where id = p_transfer_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if v_t.status = 'cancelled' then
    return jsonb_build_object('transfer_id', v_t.id, 'status', 'cancelled', 'noop', true);
  end if;
  if v_t.status <> 'pending' then
    raise exception using errcode = '42501', message = 'Esta transferência já foi resolvida.';
  end if;

  select * into v_sel from public.whatsapp_conversations where id = v_t.conversation_id for update;
  if not found then raise exception 'Conversa não encontrada.'; end if;

  -- Cancela quem mandou, ou quem manda no canal.
  if not (v_t.performed_by = v_actor
          or v_t.from_user_id = v_actor
          or public.wa_is_admin()
          or public.wa_is_supervisor_of_channel(v_sel.instance_id)
          or public.wa_supervises_department(v_sel.department_id)) then
    raise exception using errcode = '42501',
      message = 'Só quem transferiu (ou um supervisor do canal) pode cancelar.';
  end if;

  update public.whatsapp_transfers
     set status = 'cancelled', resolved_at = v_now, resolved_by = v_actor,
         note = coalesce(nullif(btrim(p_reason), ''), note)
   where id = v_t.id;

  update public.whatsapp_conversations
     set assigned_user_id = v_t.from_user_id,
         department_id = coalesce(v_t.from_department_id, department_id),
         awaiting_accept = false,
         transfer_pending_since = null
   where id = v_t.conversation_id;

  insert into public.whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, reason
  ) values (
    coalesce(v_sel.attendance_key, 'r:' || v_sel.id::text), 'transfer_cancelled',
    v_sel.id, array[v_sel.id], v_actor, nullif(left(btrim(coalesce(p_reason, '')), 300), '')
  );

  return jsonb_build_object('transfer_id', v_t.id, 'status', 'cancelled');
end;
$$;

-- Varredura do prazo. Roda pelo scheduler (service role) — e é ela que faz o
-- acesso do destino morrer sozinho, sem depender de ninguém clicar em nada.
create or replace function public.wa_expire_stale_transfers(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_ids uuid[];
  v_now timestamptz := now();
begin
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids
    from (
      select id from public.whatsapp_transfers
       where status = 'pending' and expires_at is not null and expires_at <= v_now
       order by expires_at
       limit greatest(1, coalesce(p_limit, 200))
         for update skip locked
    ) alvo;

  if cardinality(v_ids) = 0 then return 0; end if;

  update public.whatsapp_transfers
     set status = 'expired', resolved_at = v_now
   where id = any(v_ids);

  -- A conversa volta para quem a tinha. Nunca fica invisível.
  update public.whatsapp_conversations c
     set assigned_user_id = t.from_user_id,
         awaiting_accept = false,
         transfer_pending_since = null
    from public.whatsapp_transfers t
   where t.id = any(v_ids)
     and c.id = t.conversation_id
     and coalesce(c.awaiting_accept, false);

  insert into public.whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, reason
  )
  select coalesce(c.attendance_key, 'r:' || c.id::text), 'transfer_expired',
         c.id, array[c.id], null, 'prazo de aceite esgotado'
    from public.whatsapp_transfers t
    join public.whatsapp_conversations c on c.id = t.conversation_id
   where t.id = any(v_ids);

  return cardinality(v_ids);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. As demais RPCs de atendimento — mesmo recorte, mesmo porteiro
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_release_contact_attendance(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_actor uuid := auth.uid();
  v_sel   public.whatsapp_conversations%rowtype;
  v_before jsonb;
  v_ids   uuid[];
begin
  if v_actor is null or not public.is_office_staff() then
    raise exception using errcode = '42501', message = 'Sessão de atendente inválida.';
  end if;

  select * into v_sel from public.whatsapp_conversations where id = p_conversation_id for update;
  if not found then raise exception 'Conversa não encontrada.'; end if;

  if not public.wa_can_manage_conv(v_sel.id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este atendimento.';
  end if;
  if v_sel.assigned_user_id is not null
     and v_sel.assigned_user_id <> v_actor
     and not (public.wa_is_admin()
              or public.wa_is_supervisor_of_channel(v_sel.instance_id)
              or public.wa_supervises_department(v_sel.department_id)) then
    raise exception using errcode = '42501',
      message = 'Só o responsável ou um supervisor devolve este atendimento para a fila.';
  end if;

  v_ids := public.wa_attendance_scope(v_sel.id, true);
  v_before := public.wa_attendance_before_state(v_sel.id);

  update public.whatsapp_transfers
     set status = 'cancelled', resolved_at = now(), resolved_by = v_actor
   where conversation_id = any(v_ids) and status = 'pending';

  update public.whatsapp_conversations
     set assigned_user_id = null, awaiting_accept = false, transfer_pending_since = null
   where id = any(v_ids);

  insert into public.whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, before_state
  ) values (
    coalesce(v_sel.attendance_key, 'r:' || v_sel.id::text), 'released',
    v_sel.id, v_ids, v_actor, v_before
  );

  return jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
end;
$$;

create or replace function public.wa_close_contact_attendance(
  p_conversation_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_actor uuid := auth.uid();
  v_sel   public.whatsapp_conversations%rowtype;
  v_before jsonb;
  v_ids   uuid[];
  v_now   timestamptz := now();
begin
  if v_actor is null or not public.is_office_staff() then
    raise exception using errcode = '42501', message = 'Sessão de atendente inválida.';
  end if;

  select * into v_sel from public.whatsapp_conversations where id = p_conversation_id for update;
  if not found then raise exception 'Conversa não encontrada.'; end if;
  if not public.wa_can_manage_conv(v_sel.id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este atendimento.';
  end if;

  v_ids := public.wa_attendance_scope(v_sel.id, true);
  v_before := public.wa_attendance_before_state(v_sel.id);

  update public.whatsapp_transfers
     set status = 'cancelled', resolved_at = v_now, resolved_by = v_actor
   where conversation_id = any(v_ids) and status = 'pending';

  -- Encerrar é o fim natural do empréstimo (ver wa_collaborator_active); marcar
  -- explicitamente deixa a trilha legível em vez de depender do status.
  update public.whatsapp_conversation_collaborators
     set revoked_at = v_now, revoked_by = v_actor
   where conversation_id = any(v_ids) and revoked_at is null;

  update public.whatsapp_conversations
     set status = 'closed', closed_at = v_now, closed_by = v_actor,
         closure_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         awaiting_accept = false, transfer_pending_since = null,
         absence_suppressed = false
   where id = any(v_ids);

  insert into public.whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, reason, before_state
  ) values (
    coalesce(v_sel.attendance_key, 'r:' || v_sel.id::text), 'closed',
    v_sel.id, v_ids, v_actor, nullif(left(btrim(coalesce(p_reason, '')), 300), ''), v_before
  );

  return jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
end;
$$;

create or replace function public.wa_reopen_contact_attendance(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_actor uuid := auth.uid();
  v_sel   public.whatsapp_conversations%rowtype;
  v_before jsonb;
  v_ids   uuid[];
begin
  if v_actor is null or not public.is_office_staff() then
    raise exception using errcode = '42501', message = 'Sessão de atendente inválida.';
  end if;

  select * into v_sel from public.whatsapp_conversations where id = p_conversation_id for update;
  if not found then raise exception 'Conversa não encontrada.'; end if;
  -- Reabrir age sobre conversa ENCERRADA, e `wa_can_manage_conv` cobre o caso
  -- (dono, supervisor do canal, admin, ou sem dono e visível).
  if not public.wa_can_manage_conv(v_sel.id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este atendimento.';
  end if;

  v_before := public.wa_attendance_before_state(v_sel.id);

  -- Reabrir é o único que também alcança as irmãs ENCERRADAS — daí não usar
  -- `wa_attendance_scope`, que por desenho só devolve open/pending. O porteiro
  -- por irmã continua: `wa_can_manage_conv` em cada uma.
  perform c.id from public.whatsapp_conversations c
   where c.id = v_sel.id
      or (v_sel.attendance_key is not null and c.attendance_key = v_sel.attendance_key)
   order by c.id for update;

  select coalesce(array_agg(c.id order by c.id), '{}'::uuid[]) into v_ids
    from public.whatsapp_conversations c
   where (c.id = v_sel.id
      or (v_sel.attendance_key is not null and c.attendance_key = v_sel.attendance_key))
     and c.status = 'closed'
     and public.wa_can_manage_conv(c.id);

  if cardinality(v_ids) = 0 then
    return jsonb_build_object('affected_ids', '[]'::jsonb, 'affected_count', 0, 'noop', true);
  end if;

  update public.whatsapp_conversations
     set status = 'open', reopened_at = now(), closed_at = null,
         closed_by = null, closure_reason = null
   where id = any(v_ids);

  insert into public.whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, before_state
  ) values (
    coalesce(v_sel.attendance_key, 'r:' || v_sel.id::text), 'reopened',
    v_sel.id, v_ids, v_actor, v_before
  );

  return jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
end;
$$;

-- Marcar como lida/não lida: "apenas acompanhar" NÃO pode mexer nisto — zerar o
-- contador de outra pessoa é apagar a pendência dela da tela. Por isso a
-- exigência é `wa_can_manage_conv`, e não `wa_can_see_conv`.
--
-- As duas retornavam `integer` (a contagem de linhas afetadas) e passam a
-- retornar `jsonb`, como as demais RPCs de atendimento. Mudança de tipo de
-- retorno exige DROP: `create or replace` responderia
-- "cannot change return type of existing function" e a migration pararia no meio.
drop function if exists public.wa_mark_contact_read(uuid);
drop function if exists public.wa_mark_contact_unread(uuid);

create or replace function public.wa_mark_contact_read(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_sel public.whatsapp_conversations%rowtype;
  v_ids uuid[];
begin
  if auth.uid() is null or not public.is_office_staff() then
    raise exception using errcode = '42501', message = 'Sessão de atendente inválida.';
  end if;
  select * into v_sel from public.whatsapp_conversations where id = p_conversation_id;
  if not found then raise exception 'Conversa não encontrada.'; end if;
  if not public.wa_can_manage_conv(v_sel.id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este atendimento.';
  end if;

  v_ids := public.wa_attendance_scope(v_sel.id, true);
  update public.whatsapp_conversations set unread_count = 0 where id = any(v_ids);
  return jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
end;
$$;

create or replace function public.wa_mark_contact_unread(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_sel public.whatsapp_conversations%rowtype;
  v_ids uuid[];
begin
  if auth.uid() is null or not public.is_office_staff() then
    raise exception using errcode = '42501', message = 'Sessão de atendente inválida.';
  end if;
  select * into v_sel from public.whatsapp_conversations where id = p_conversation_id;
  if not found then raise exception 'Conversa não encontrada.'; end if;
  if not public.wa_can_manage_conv(v_sel.id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este atendimento.';
  end if;

  v_ids := public.wa_attendance_scope(v_sel.id, true);
  -- Só a linha SELECIONADA fica marcada; as irmãs zeram. É o comportamento que
  -- já existia, e ele é deliberado: "não lida" quer dizer "vou cuidar disto
  -- depois", e o depois começa na conversa em que a pessoa estava — marcar as
  -- irmãs criaria três pendências onde ela pediu uma.
  update public.whatsapp_conversations c
     set unread_count = case when c.id = v_sel.id then greatest(c.unread_count, 1) else 0 end
   where c.id = any(v_ids);
  return jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Emprestar a conversa (colaborador temporário), num passo só
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_grant_conversation_collaborator(
  p_conversation_id uuid,
  p_user_id uuid,
  p_hours integer default 24,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_actor uuid := auth.uid();
  v_sel   public.whatsapp_conversations%rowtype;
  v_exp   timestamptz;
begin
  if v_actor is null or not public.is_office_staff() then
    raise exception using errcode = '42501', message = 'Sessão de atendente inválida.';
  end if;
  select * into v_sel from public.whatsapp_conversations where id = p_conversation_id;
  if not found then raise exception 'Conversa não encontrada.'; end if;
  if not public.wa_can_manage_conv(v_sel.id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este atendimento.';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = p_user_id and p.is_active is true) then
    raise exception 'Colaborador inválido ou inativo.';
  end if;

  v_exp := case when coalesce(p_hours, 0) > 0 then now() + make_interval(hours => p_hours) else null end;

  insert into public.whatsapp_conversation_collaborators
    (conversation_id, user_id, granted_by, expires_at, reason)
  values (p_conversation_id, p_user_id, v_actor, v_exp, nullif(btrim(p_reason), ''))
  on conflict (conversation_id, user_id) do update
    set granted_by = excluded.granted_by,
        granted_at = now(),
        expires_at = excluded.expires_at,
        revoked_at = null,
        revoked_by = null,
        reason     = excluded.reason;

  insert into public.whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, reason
  ) values (
    coalesce(v_sel.attendance_key, 'r:' || v_sel.id::text), 'collaborator_granted',
    v_sel.id, array[v_sel.id], v_actor, nullif(left(btrim(coalesce(p_reason, '')), 300), '')
  );

  return jsonb_build_object('conversation_id', p_conversation_id, 'user_id', p_user_id, 'expires_at', v_exp);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Registro da intervenção — "respondeu sem assumir"
--
-- Chamada pela `evolution-send` depois de a mensagem entrar. Fica aqui, e não
-- na Edge Function, porque é o banco que sabe quem era o responsável no momento
-- do envio.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_log_supervisor_reply(
  p_conversation_id uuid,
  p_message_id uuid,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_sel  public.whatsapp_conversations%rowtype;
  v_role text;
begin
  select * into v_sel from public.whatsapp_conversations where id = p_conversation_id;
  if not found then return; end if;
  -- Responsável respondendo o próprio atendimento não é intervenção.
  if v_sel.assigned_user_id is not distinct from p_actor then return; end if;

  select case
           when lower(translate(coalesce(p.role, ''),
                  'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ',
                  'aaaaeeiooouucAAAAEEIOOOUUC')) = 'administrador' then 'admin'
           else 'supervisor'
         end
    into v_role
    from public.profiles p where p.user_id = p_actor;

  if v_role is null then return; end if;

  update public.whatsapp_messages set sender_role = v_role where id = p_message_id;

  insert into public.whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, reason
  ) values (
    coalesce(v_sel.attendance_key, 'r:' || v_sel.id::text), 'supervisor_reply',
    v_sel.id, array[v_sel.id], p_actor,
    'resposta sem assumir (' || v_role || ')'
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. GRANTs
-- ────────────────────────────────────────────────────────────────────────────

revoke all on function public.wa_attendance_scope(uuid, boolean) from public, anon, authenticated;
revoke all on function public.wa_log_supervisor_reply(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.wa_expire_stale_transfers(integer) from public, anon, authenticated;

grant execute on function public.wa_attendance_scope(uuid, boolean)          to service_role;
grant execute on function public.wa_log_supervisor_reply(uuid, uuid, uuid)   to service_role;
grant execute on function public.wa_expire_stale_transfers(integer)          to service_role;

grant execute on function public.wa_assume_contact_attendance(uuid)                       to authenticated, service_role;
grant execute on function public.wa_assign_contact_attendance(uuid, uuid, text)           to authenticated, service_role;
grant execute on function public.wa_transfer_contact_attendance(uuid, uuid, uuid, text)   to authenticated, service_role;
grant execute on function public.wa_accept_contact_transfer(uuid, uuid)                   to authenticated, service_role;
grant execute on function public.wa_reject_contact_transfer(uuid, text)                   to authenticated, service_role;
grant execute on function public.wa_cancel_contact_transfer(uuid, text)                   to authenticated, service_role;
grant execute on function public.wa_release_contact_attendance(uuid)                      to authenticated, service_role;
grant execute on function public.wa_close_contact_attendance(uuid, text)                  to authenticated, service_role;
grant execute on function public.wa_reopen_contact_attendance(uuid)                       to authenticated, service_role;
grant execute on function public.wa_mark_contact_read(uuid)                               to authenticated, service_role;
grant execute on function public.wa_mark_contact_unread(uuid)                             to authenticated, service_role;
grant execute on function public.wa_grant_conversation_collaborator(uuid, uuid, integer, text) to authenticated, service_role;

commit;
