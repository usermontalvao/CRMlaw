-- ============================================================================
-- WhatsApp — desligar alguém tem de ser um ato só, e completo.
--
-- Depende das duas migrations anteriores desta série.
--
--
-- ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
--
-- Desligar era `profiles.is_active = false` e mais nada. Na prática:
--
--   · o acesso continuava — `is_office_staff()` não olhava `is_active`, e o JWT
--     já emitido vale por semanas com refresh. O ban no GoTrue (que a
--     `toggle-user-status` faz) impede LOGIN NOVO, não a sessão aberta;
--   · as conversas dele continuavam no nome dele. Ninguém mais respondia, e
--     elas não apareciam em fila nenhuma — o cliente ficava falando sozinho com
--     um atendimento que existia só no papel;
--   · transferências pendentes destinadas a ele ficavam pendentes para sempre;
--   · os vínculos de canal e de setor continuavam de pé, então bastava
--     reativar por engano — ou um JWT sobrevivente — para tudo voltar;
--   · mensagens agendadas por ele continuavam programadas para sair.
--
-- A primeira dessas quatro já foi resolvida na migration do núcleo
-- (`is_office_staff()` passou a exigir `is_active`). As outras são desta.
--
--
-- ── COMO FUNCIONA ───────────────────────────────────────────────────────────
--
-- Uma função só, `wa_offboard_user`, disparada por trigger quando `is_active`
-- vira `false` — e chamável à mão para reprocessar. Idempotente de propósito:
-- rodar duas vezes é inofensivo, porque toda etapa é escrita como "leve ao
-- estado desejado", não como "faça a mudança".
--
-- O que ela NUNCA faz: apagar mensagem, ligação, nota ou evento de auditoria.
-- Quem saiu continua no histórico — é o histórico que explica o atendimento.
--
--
-- ── PARA ONDE VAI A CONVERSA ────────────────────────────────────────────────
--
-- A escada, na ordem:
--
--   1. supervisor DO CANAL da conversa (o mais antigo no canal, para ser
--      determinístico);
--   2. supervisor DO SETOR da conversa;
--   3. fila — `assigned_user_id = null` —, desde que o canal tenha ao menos um
--      outro membro ativo capaz de ver a fila;
--   4. administrador ativo.
--
-- O degrau 3 é o preferido quando existe equipe: fila é onde a conversa é
-- disputada e atendida rápido. O degrau 4 existe para o caso em que a fila
-- seria um quarto escuro — canal sem mais ninguém dentro. É ele que garante a
-- regra "nunca deixar conversa invisível".
-- ============================================================================

begin;

create or replace function public.wa_offboard_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_now            timestamptz := now();
  v_admin          uuid;
  v_conv           record;
  v_destino        uuid;
  v_reatribuidas   integer := 0;
  v_para_fila      integer := 0;
  v_transf         integer := 0;
  v_agendadas      integer := 0;
  v_vinculos       integer := 0;
  v_emprestimos    integer := 0;
begin
  if p_user_id is null then
    raise exception 'Informe o usuário desligado.';
  end if;

  -- Um administrador ATIVO, para o último degrau da escada. `order by user_id`
  -- só para a escolha ser sempre a mesma entre execuções.
  select p.user_id into v_admin
    from public.profiles p
   where p.is_active is true
     and p.user_id <> p_user_id
     and lower(translate(coalesce(p.role, ''),
           'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ',
           'aaaaeeiooouucAAAAEEIOOOUUC')) = 'administrador'
   order by p.user_id
   limit 1;

  -- ── 1. Conversas abertas no nome dele ────────────────────────────────────
  for v_conv in
    select c.id, c.instance_id, c.department_id, c.attendance_key
      from public.whatsapp_conversations c
     where c.assigned_user_id = p_user_id
       and c.status <> 'closed'
     order by c.id
       for update
  loop
    v_destino := null;

    -- 1) supervisor do canal
    select cm.user_id into v_destino
      from public.whatsapp_channel_members cm
      join public.profiles p on p.user_id = cm.user_id and p.is_active is true
     where cm.channel_id = v_conv.instance_id
       and cm.role = 'supervisor'
       and cm.user_id <> p_user_id
     order by cm.created_at, cm.user_id
     limit 1;

    -- 2) supervisor do setor
    if v_destino is null and v_conv.department_id is not null then
      select dm.user_id into v_destino
        from public.whatsapp_department_members dm
        join public.profiles p on p.user_id = dm.user_id and p.is_active is true
       where dm.department_id = v_conv.department_id
         and dm.role = 'supervisor'
         and dm.user_id <> p_user_id
       order by dm.created_at, dm.user_id
       limit 1;
    end if;

    -- 3) fila, se a fila for vista por alguém
    if v_destino is null then
      if v_conv.instance_id is null
         or exists (select 1 from public.whatsapp_instances i
                     where i.id = v_conv.instance_id and i.visibility_mode = 'all')
         or exists (select 1
                      from public.whatsapp_channel_members cm
                      join public.profiles p on p.user_id = cm.user_id and p.is_active is true
                     where cm.channel_id = v_conv.instance_id and cm.user_id <> p_user_id)
      then
        update public.whatsapp_conversations
           set assigned_user_id = null, awaiting_accept = false, transfer_pending_since = null
         where id = v_conv.id;
        v_para_fila := v_para_fila + 1;
      else
        -- 4) administrador
        v_destino := v_admin;
      end if;
    end if;

    if v_destino is not null then
      update public.whatsapp_conversations
         set assigned_user_id = v_destino, awaiting_accept = false, transfer_pending_since = null
       where id = v_conv.id;

      insert into public.whatsapp_transfers (
        conversation_id, from_user_id, to_user_id, from_department_id,
        note, performed_by, status, accepted_at, accepted_by, resolved_at, resolved_by
      ) values (
        v_conv.id, p_user_id, v_destino, v_conv.department_id,
        'Redistribuição automática — atendente desligado',
        null, 'accepted', v_now, v_destino, v_now, null
      );
      v_reatribuidas := v_reatribuidas + 1;
    end if;

    insert into public.whatsapp_attendance_events (
      attendance_key, event_type, primary_conversation_id,
      affected_conversation_ids, actor_id, reason
    ) values (
      coalesce(v_conv.attendance_key, 'r:' || v_conv.id::text), 'offboard_reassigned',
      v_conv.id, array[v_conv.id], null,
      case when v_destino is null then 'devolvida à fila (atendente desligado)'
           else 'redistribuída (atendente desligado)' end
    );
  end loop;

  -- ── 2. Transferências pendentes ──────────────────────────────────────────
  -- Destinadas a ele: canceladas, e a conversa volta a quem a passou.
  with alvo as (
    select t.id, t.conversation_id, t.from_user_id, t.from_department_id
      from public.whatsapp_transfers t
     where t.status = 'pending' and t.to_user_id = p_user_id
       for update
  ), fechadas as (
    update public.whatsapp_transfers t
       set status = 'cancelled', resolved_at = v_now,
           note = coalesce(t.note, '') || ' [cancelada: destinatário desligado]'
      from alvo a where t.id = a.id
     returning t.id
  )
  select count(*) into v_transf from fechadas;

  update public.whatsapp_conversations c
     set assigned_user_id = case
           when c.assigned_user_id = p_user_id then null else c.assigned_user_id end,
         awaiting_accept = false,
         transfer_pending_since = null
    from public.whatsapp_transfers t
   where t.to_user_id = p_user_id
     and t.status = 'cancelled'
     and t.resolved_at = v_now
     and c.id = t.conversation_id
     and coalesce(c.awaiting_accept, false);

  -- Feitas por ele e ainda pendentes: sem quem responda pelo convite, expiram.
  update public.whatsapp_transfers
     set status = 'cancelled', resolved_at = v_now,
         note = coalesce(note, '') || ' [cancelada: quem transferiu foi desligado]'
   where status = 'pending' and (from_user_id = p_user_id or performed_by = p_user_id);

  -- ── 3. Vínculos e empréstimos ────────────────────────────────────────────
  with fora as (
    delete from public.whatsapp_channel_members where user_id = p_user_id returning 1
  ) select count(*) into v_vinculos from fora;

  delete from public.whatsapp_department_members where user_id = p_user_id;

  with revogados as (
    update public.whatsapp_conversation_collaborators
       set revoked_at = v_now
     where user_id = p_user_id and revoked_at is null
     returning 1
  ) select count(*) into v_emprestimos from revogados;

  -- Deixa de ser destino padrão de canal — senão a próxima conversa nasceria
  -- no nome de quem não trabalha mais aqui.
  update public.whatsapp_instances
     set default_assignee_id = null
   where default_assignee_id = p_user_id;

  -- ── 4. Coisas programadas ────────────────────────────────────────────────
  -- Mensagem agendada por quem saiu não sai: ela leva a assinatura de alguém
  -- que não responde mais por ela.
  with canceladas as (
    update public.whatsapp_scheduled_messages
       set status = 'canceled',
           error = coalesce(error, 'cancelada: quem agendou foi desligado')
     where created_by = p_user_id and status = 'pending'
     returning 1
  ) select count(*) into v_agendadas from canceladas;

  -- Rascunhos e silenciamentos são pessoais e não servem mais a ninguém.
  delete from public.whatsapp_drafts where user_id = p_user_id;
  delete from public.whatsapp_conversation_mutes where user_id = p_user_id;

  -- Mensagens, ligações, gravações, notas e eventos ficam. É auditoria.

  return jsonb_build_object(
    'user_id', p_user_id,
    'conversas_redistribuidas', v_reatribuidas,
    'conversas_para_fila', v_para_fila,
    'transferencias_canceladas', v_transf,
    'agendamentos_cancelados', v_agendadas,
    'vinculos_de_canal_removidos', v_vinculos,
    'emprestimos_revogados', v_emprestimos
  );
end;
$$;

comment on function public.wa_offboard_user(uuid) is
  'Desligamento completo e idempotente: tira vínculos, cancela pendências e devolve as conversas — sem apagar histórico. Disparada por trigger em profiles.is_active.';

-- ────────────────────────────────────────────────────────────────────────────
-- O gatilho
--
-- AFTER UPDATE, e não BEFORE: a função lê `profiles` (via `is_office_staff` e
-- afins) e precisa enxergar o `is_active = false` já gravado.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_offboard_on_deactivate()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
begin
  if old.is_active is true and new.is_active is false then
    perform public.wa_offboard_user(new.user_id);
  end if;
  return null;
end;
$$;

drop trigger if exists wa_offboard_ao_desativar on public.profiles;
create trigger wa_offboard_ao_desativar
  after update of is_active on public.profiles
  for each row execute function public.wa_offboard_on_deactivate();

revoke all on function public.wa_offboard_user(uuid) from public, anon;
grant execute on function public.wa_offboard_user(uuid) to service_role;

-- O administrador pode reprocessar pela tela de usuários (por exemplo, quando
-- alguém foi desligado antes desta migration existir).
create or replace function public.wa_offboard_user_admin(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
begin
  if not public.wa_is_admin() then
    raise exception using errcode = '42501', message = 'Apenas administradores.';
  end if;
  if exists (select 1 from public.profiles p where p.user_id = p_user_id and p.is_active is true) then
    raise exception 'Este usuário está ativo — desative-o primeiro.';
  end if;
  return public.wa_offboard_user(p_user_id);
end;
$$;

grant execute on function public.wa_offboard_user_admin(uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- Reprocessa quem JÁ estava desligado antes desta migration.
--
-- Sem isto, as conversas de um desligado antigo continuariam penduradas no
-- nome dele — e agora, com `is_office_staff()` exigindo `is_active`, ele
-- também não as veria mais: seriam conversas de ninguém.
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  for r in select user_id from public.profiles where is_active is false loop
    perform public.wa_offboard_user(r.user_id);
  end loop;
end $$;

commit;
