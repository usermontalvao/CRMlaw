-- ============================================================================
-- WhatsApp — a IA da CONVERSA passa a ter porteiro, registro e um dono só.
--
-- Depende de `20260822090000_whatsapp_permissoes_nucleo.sql` (funções de
-- decisão) e de `20260822091000_whatsapp_transferencias_e_supervisao.sql`
-- (vocabulário da auditoria).
--
-- Esta migration NÃO mexe em configuração de IA. Prompt, playbook, modelo,
-- vínculo de canal e limites já são de administrador desde a migration do
-- núcleo (`wa_ai_assistants_escrita`, `ai_config_escrita`, `ai_playbooks_escrita`,
-- `wa_ai_agents_escrita`). O que faltava era o outro lado: os controles
-- OPERACIONAIS que ficam dentro do módulo.
--
--
-- ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
--
-- 1. PAUSAR, RELIGAR E LIMPAR A MEMÓRIA EXIGIAM APENAS *VER*.
--
--        create policy ai_sessions_update ... using (
--          public.is_office_staff() and public.wa_can_see_conv_id(conversation_id))
--
--    `wa_can_see_conv_id` é a régua da INBOX: ela inclui o canal aberto, o
--    setor sem membros, o colaborador temporário e o supervisor de qualquer
--    canal. Todos esses conseguiam desligar a IA de um atendimento que não é
--    deles — e desligar a IA é parar de responder ao cliente.
--
--    A régua certa para comandar já existe e é `wa_can_manage_conv`: o
--    responsável, o supervisor DAQUELE canal/setor, o administrador, e quem
--    pega uma conversa da fila. É a mesma que decide assumir e encerrar.
--
-- 2. RELIGAR A IA ERA UM UPDATE CRU NA CONVERSA.
--
--    `resumeAiForConversation`, no navegador, fazia:
--
--        update whatsapp_conversations
--           set assigned_user_id = null, awaiting_accept = false,
--               transfer_pending_since = null, status = 'open'
--         where id = ...
--
--    Sob a policy `wa_conv_update`, que pede `wa_can_see_conv`. Quer dizer: um
--    caminho para SOLTAR O RESPONSÁVEL e REABRIR uma conversa encerrada sem
--    passar por nenhuma das RPCs de atendimento — sem porteiro de comando, sem
--    o leque por `attendance_key`, e sem deixar rastro. Todo o trabalho das duas
--    migrations anteriores contornado por um botão.
--
-- 3. NENHUMA AÇÃO DE IA ERA AUDITADA.
--
--    Assumir, transferir, encerrar e responder-sem-assumir deixam evento em
--    `whatsapp_attendance_events`. Pausar a IA, religá-la e apagar a memória do
--    caso não deixavam nada. Justamente as três que mudam o que o cliente
--    recebe a seguir.
--
-- 4. "A IA PARA SOZINHA QUANDO ALGUÉM DO ESCRITÓRIO RESPONDE" ERA MENTIRA.
--
--    O gatilho `trg_wa_ai_stop_on_human_takeover` dispara na ATRIBUIÇÃO. Mas o
--    Modo supervisão criou um caminho em que uma pessoa responde ao cliente SEM
--    assumir — e ali a atribuição não muda. Resultado: o supervisor escreve, a
--    IA continua ativa, e os dois respondem ao mesmo cliente. É exatamente o
--    "IA e atendente respondendo ao mesmo tempo" que o desenho quer impedir, e
--    era o único caminho que ainda o permitia.
--
--
-- ── O QUE ESTA MIGRATION FAZ ────────────────────────────────────────────────
--
--   · aperta a RLS das tabelas operacionais da IA de "ver" para "comandar";
--   · cria quatro RPCs — pausar, retomar, limpar memória, cancelar retomada —
--     cada uma com o porteiro dentro e um evento de auditoria na saída;
--   · fecha o UPDATE cru: retomar deixa de ser escrita do navegador e passa a
--     ser um ato do banco, que solta o responsável e reabre em UMA transação;
--   · faz a mensagem de GENTE pausar a IA, tenha havido atribuição ou não.
--
-- Idempotente: pode rodar duas vezes.
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Vocabulário da auditoria
--
-- Quatro tipos novos. Ficam na MESMA tabela dos demais atos de atendimento de
-- propósito: para quem lê o histórico de um caso, "a IA foi pausada às 14h" e
-- "Fulano assumiu às 14h02" são a mesma história, e uma tabela separada faria
-- essa história ser lida em dois lugares.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.whatsapp_attendance_events
  drop constraint if exists whatsapp_attendance_events_event_type_check;

alter table public.whatsapp_attendance_events
  add constraint whatsapp_attendance_events_event_type_check
  check (event_type in (
    'closed', 'reopened', 'reopened_inbound', 'assumed', 'assigned',
    'released', 'transferred', 'transfer_accepted',
    'transfer_rejected', 'transfer_cancelled', 'transfer_expired',
    'takeover', 'supervisor_reply', 'offboard_reassigned', 'collaborator_granted',
    -- novos: os controles operacionais da IA
    'ai_paused', 'ai_resumed', 'ai_memory_cleared', 'ai_followup_cancelled'
  ));

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Ver deixa de bastar — RLS das tabelas operacionais da IA
--
-- A LEITURA continua em `wa_can_see_conv_id`: quem enxerga o atendimento
-- enxerga o estado da IA nele, e é isso que faz o resumo aparecer para o
-- supervisor que só acompanha. A ESCRITA passa a `wa_can_manage_conv`.
--
-- `whatsapp_ai_sessions` é escrita pelas Edge Functions com service role, que
-- ignora RLS — apertar aqui não afeta o agente, só o navegador.
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists ai_sessions_insert on public.whatsapp_ai_sessions;
create policy ai_sessions_insert on public.whatsapp_ai_sessions
  for insert to authenticated
  with check (public.wa_can_manage_conv(conversation_id));

drop policy if exists ai_sessions_update on public.whatsapp_ai_sessions;
create policy ai_sessions_update on public.whatsapp_ai_sessions
  for update to authenticated
  using (public.wa_can_manage_conv(conversation_id))
  with check (public.wa_can_manage_conv(conversation_id));

-- Apagar a sessão apaga a memória do caso inteiro. Não é operação de
-- atendimento — quem quer recomeçar usa `wa_ai_clear_memory`, que limpa e
-- deixa rastro. A linha em si é histórico.
drop policy if exists ai_sessions_delete on public.whatsapp_ai_sessions;
create policy ai_sessions_delete on public.whatsapp_ai_sessions
  for delete to authenticated
  using (public.wa_is_admin());

-- Cancelar uma retomada agendada é decidir que o cliente NÃO será cobrado.
-- Mesmo peso de pausar.
drop policy if exists wa_ai_followups_staff_update on public.whatsapp_ai_followups;
create policy wa_ai_followups_staff_update on public.whatsapp_ai_followups
  for update to authenticated
  using (public.wa_can_manage_conv(conversation_id))
  with check (public.wa_can_manage_conv(conversation_id));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O porteiro, escrito uma vez
--
-- As quatro RPCs abaixo fazem a MESMA pergunta. Ela vive aqui para que mudar a
-- régua signifique mudar um lugar — e para que a mensagem de erro seja a mesma
-- em todas, que é o que a tela mostra ao atendente.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_ai_require_control(p_conversation_id uuid)
returns public.whatsapp_conversations
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_conv public.whatsapp_conversations%rowtype;
begin
  select * into v_conv
    from public.whatsapp_conversations
   where id = p_conversation_id;

  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;

  -- `wa_can_manage_conv` já exige `is_office_staff()`, que já exige `is_active`.
  -- Desligar alguém tira o controle da IA no mesmo ato, sem esperar o JWT
  -- expirar — que é o requisito do "usuário desligado com sessão ainda válida".
  if not public.wa_can_manage_conv(p_conversation_id) then
    raise exception 'Você não tem permissão para controlar a IA neste atendimento.'
      using errcode = '42501';
  end if;

  return v_conv;
end;
$$;

comment on function public.wa_ai_require_control(uuid) is
  'Porteiro dos controles operacionais da IA. Mesma régua de assumir/encerrar (wa_can_manage_conv).';

-- Registra o ato no histórico do atendimento. `affected_conversation_ids` fica
-- com a conversa só: o estado da IA é POR CONVERSA (a memória é dela), então
-- pausar não pode se espalhar pelo leque de `attendance_key` como assumir faz.
create or replace function public.wa_ai_log(
  p_conv public.whatsapp_conversations,
  p_event text,
  p_reason text default null
)
returns void
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $$
  insert into public.whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, reason, before_state
  ) values (
    coalesce(p_conv.attendance_key, 'r:' || p_conv.id::text),
    p_event,
    p_conv.id,
    array[p_conv.id],
    auth.uid(),
    nullif(left(btrim(coalesce(p_reason, '')), 300), ''),
    public.wa_attendance_before_state(p_conv.id)
  );
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Pausar
--
-- O botão de pânico do operador: a IA para agora e NÃO volta sozinha. As
-- retomadas agendadas caem junto — deixá-las de pé faria o agente escrever ao
-- cliente depois de ter sido mandado parar.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_ai_pause(
  p_conversation_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_conv public.whatsapp_conversations%rowtype;
  v_motivo text;
begin
  v_conv := public.wa_ai_require_control(p_conversation_id);
  v_motivo := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Interrompida pelo atendente.');

  insert into public.whatsapp_ai_sessions as s (
    conversation_id, ai_active, status, handoff_reason, ended_at
  ) values (
    p_conversation_id, false, 'handed_off', v_motivo, now()
  )
  on conflict (conversation_id) do update
    set ai_active      = false,
        status         = 'handed_off',
        handoff_reason = v_motivo,
        ended_at       = coalesce(s.ended_at, now());

  update public.whatsapp_ai_followups
     set status = 'cancelled', cancel_reason = 'IA interrompida pelo atendente.'
   where conversation_id = p_conversation_id
     and status = 'pending';

  perform public.wa_ai_log(v_conv, 'ai_paused', v_motivo);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Retomar
--
-- Religar a IA guardando a memória. Três coisas têm de acontecer JUNTAS, e é
-- por isso que isto deixou de ser escrita do navegador:
--
--   · soltar o responsável — a portaria do agente recusa conversa com dono, e
--     religar sem soltar seria um botão que não faz nada;
--   · reabrir se estiver encerrada — a portaria também recusa conversa fechada;
--   · só então marcar a sessão como ativa. A ordem importa: soltar depois faria
--     o gatilho de "humano assumiu" desligar de novo o que acabou de ser ligado.
--
-- Fora da transação, entre um passo e outro, existia uma janela em que a
-- conversa ficava sem dono e sem IA — e quem chegasse pela fila herdaria um
-- atendimento em estado indefinido.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_ai_resume(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_conv public.whatsapp_conversations%rowtype;
begin
  v_conv := public.wa_ai_require_control(p_conversation_id);

  -- O canal precisa ter IA ligada. Sem esta conferência o botão "reativar"
  -- promete o que o canal não entrega: a sessão vira `active` e nenhum turno
  -- roda, porque a portaria do agente lê `whatsapp_ai_channel_config`.
  --
  -- Só `ai_enabled` é conferido, e não o `assistant_id`: o agente da conversa
  -- pode estar na SESSÃO e não na configuração do canal (é o que acontece com
  -- conversa que já rodava quando o vínculo do canal mudou), e recusar essa
  -- transformaria uma diferença de cadastro em conversa impossível de religar.
  -- Ligar/desligar a IA do canal continua sendo ato de administrador, em
  -- Configurações — aqui só se lê o interruptor dele.
  if not exists (
    select 1 from public.whatsapp_ai_channel_config cfg
     where cfg.channel_id = v_conv.instance_id
       and cfg.ai_enabled
  ) then
    raise exception 'A IA está desligada neste canal. Um administrador precisa ligá-la em Configurações.'
      using errcode = 'P0001';
  end if;

  update public.whatsapp_conversations
     set assigned_user_id       = null,
         awaiting_accept        = false,
         transfer_pending_since = null,
         status                 = 'open'
   where id = p_conversation_id;

  insert into public.whatsapp_ai_sessions as s (
    conversation_id, ai_active, status, handoff_reason, ended_at
  ) values (
    p_conversation_id, true, 'active', null, null
  )
  on conflict (conversation_id) do update
    set ai_active      = true,
        status         = 'active',
        handoff_reason = null,
        ended_at       = null;

  perform public.wa_ai_log(v_conv, 'ai_resumed', null);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Limpar a memória
--
-- Esquece o caso e recomeça do zero, sem desligar a IA. Os campos são os mesmos
-- que o navegador escrevia; o que muda é o porteiro e o rastro.
--
-- `history_from` é o que faz "do zero" ser verdade: sem ele o caderno é apagado
-- mas as mensagens antigas continuam entrando no prompt.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_ai_clear_memory(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_conv public.whatsapp_conversations%rowtype;
begin
  v_conv := public.wa_ai_require_control(p_conversation_id);

  update public.whatsapp_ai_followups
     set status = 'cancelled', cancel_reason = 'Memória da IA reiniciada pelo atendente.'
   where conversation_id = p_conversation_id
     and status = 'pending';

  insert into public.whatsapp_ai_sessions as s (conversation_id, history_from)
  values (p_conversation_id, now())
  on conflict (conversation_id) do update
    set summary                   = null,
        known_facts               = '{}'::jsonb,
        pending_items             = '[]'::jsonb,
        last_action               = null,
        triage_stage              = null,
        triage_cut                = null,
        triage_cut_reason         = null,
        last_processed_message_id = null,
        followup_attempts         = 0,
        next_followup_at          = null,
        followup_opt_out          = false,
        followup_opt_out_reason   = null,
        interest_checked_at       = null,
        history_from              = now();

  perform public.wa_ai_log(v_conv, 'ai_memory_cleared', null);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Cancelar uma retomada agendada
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_ai_cancel_followup(p_followup_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_conv public.whatsapp_conversations%rowtype;
  v_conv_id uuid;
begin
  select conversation_id into v_conv_id
    from public.whatsapp_ai_followups
   where id = p_followup_id;

  if v_conv_id is null then
    raise exception 'Acompanhamento não encontrado.' using errcode = 'P0002';
  end if;

  v_conv := public.wa_ai_require_control(v_conv_id);

  update public.whatsapp_ai_followups
     set status = 'cancelled', cancel_reason = 'Cancelado pelo atendente.'
   where id = p_followup_id
     and status = 'pending';

  perform public.wa_ai_log(v_conv, 'ai_followup_cancelled', null);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Quem fala é gente → a IA para. Sempre.
--
-- O gatilho antigo (`trg_wa_ai_stop_on_human_takeover`) continua e cobre a
-- atribuição. Este cobre o caso que ele não vê: a resposta SEM assumir do Modo
-- supervisão, em que ninguém vira responsável e a IA seguia ativa.
--
-- O recorte é `sender_user_id is not null`. É o que separa gente de máquina:
--   · a IA envia com `sender_user_id: null` (evolution-send chamado com service
--     role) — não se auto-desliga;
--   · o cron, o scheduler e os follow-ups de documento/assinatura também vão com
--     nulo, e também não desligam;
--   · qualquer mensagem com um usuário atrás dela é atendimento humano.
--
-- Fica registrado como pausa: quem ler o histórico vê POR QUE a IA parou.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_ai_stop_on_human_message()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_conv public.whatsapp_conversations%rowtype;
  v_linhas integer := 0;
begin
  update public.whatsapp_ai_sessions
     set ai_active      = false,
         status         = 'handed_off',
         handoff_reason = coalesce(handoff_reason, 'Uma pessoa do escritório respondeu ao cliente.'),
         ended_at       = coalesce(ended_at, now())
   where conversation_id = new.conversation_id
     and ai_active;

  -- A IA já estava parada: sair aqui é o que impede uma conversa atendida por
  -- gente de gerar um evento de "IA pausada" por mensagem enviada.
  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then
    return null;
  end if;

  update public.whatsapp_ai_followups
     set status = 'cancelled', cancel_reason = 'Uma pessoa do escritório respondeu ao cliente.'
   where conversation_id = new.conversation_id
     and status = 'pending';

  select * into v_conv from public.whatsapp_conversations where id = new.conversation_id;
  if found then
    insert into public.whatsapp_attendance_events (
      attendance_key, event_type, primary_conversation_id,
      affected_conversation_ids, actor_id, reason, before_state
    ) values (
      coalesce(v_conv.attendance_key, 'r:' || v_conv.id::text),
      'ai_paused', v_conv.id, array[v_conv.id], new.sender_user_id,
      'Uma pessoa do escritório respondeu ao cliente.',
      public.wa_attendance_before_state(v_conv.id)
    );
  end if;

  return null;
end;
$$;

drop trigger if exists trg_wa_ai_stop_on_human_message on public.whatsapp_messages;
create trigger trg_wa_ai_stop_on_human_message
  after insert on public.whatsapp_messages
  for each row
  when (new.direction = 'out' and new.sender_user_id is not null)
  execute function public.wa_ai_stop_on_human_message();

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Grants
--
-- `security definer` sem `revoke from public` é uma porta aberta: a função roda
-- com os poderes do dono para quem a chamar. O porteiro está DENTRO de cada uma
-- delas, mas o anônimo não tem por que sequer alcançá-las.
-- ────────────────────────────────────────────────────────────────────────────

revoke all on function public.wa_ai_require_control(uuid) from public, anon;
revoke all on function public.wa_ai_log(public.whatsapp_conversations, text, text) from public, anon, authenticated;
revoke all on function public.wa_ai_pause(uuid, text) from public, anon;
revoke all on function public.wa_ai_resume(uuid) from public, anon;
revoke all on function public.wa_ai_clear_memory(uuid) from public, anon;
revoke all on function public.wa_ai_cancel_followup(uuid) from public, anon;

grant execute on function public.wa_ai_pause(uuid, text) to authenticated;
grant execute on function public.wa_ai_resume(uuid) to authenticated;
grant execute on function public.wa_ai_clear_memory(uuid) to authenticated;
grant execute on function public.wa_ai_cancel_followup(uuid) to authenticated;

commit;
