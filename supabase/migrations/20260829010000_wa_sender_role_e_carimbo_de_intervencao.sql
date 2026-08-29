-- ── A segunda peça que faltava para a `evolution-send` deployada ────────────
--
-- APLICADA EM PRODUÇÃO em 29/08/2026, logo depois de
-- 20260829002651_wa_porteiro_funcoes_que_faltavam.
--
-- Destravado o porteiro, o envio passou a morrer um degrau adiante: "Could not
-- find the 'sender_role' column of 'whatsapp_messages'". A coluna é da mesma
-- leva que nunca subiu (20260822091000), e sem ela o INSERT da mensagem falha
-- DEPOIS de o WhatsApp já ter entregue — o cliente recebe, o CRM dá erro e não
-- guarda, e reenviar duplica.
--
-- Vai junto o `wa_log_supervisor_reply`, que a `evolution-send` chama logo
-- abaixo do insert. Lá ele é best-effort (o erro só vai para o log), então não
-- derrubava nada — mas sem ele a bolha não sabe dizer "enviada por Fulano —
-- Administrador", e a resposta de quem NÃO é o responsável fica
-- indistinguível da do responsável.
--
-- O `event_type` da trilha ganha 'supervisor_reply': o CHECK em produção não
-- conhecia o tipo, e o registro seria recusado pelo banco.

-- 1. Em que qualidade a mensagem saiu ---------------------------------------
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

-- 2. A trilha precisa aceitar o tipo novo -----------------------------------
alter table public.whatsapp_attendance_events
  drop constraint if exists whatsapp_attendance_events_event_type_check;

alter table public.whatsapp_attendance_events
  add constraint whatsapp_attendance_events_event_type_check
  check (event_type in (
    'closed', 'reopened', 'reopened_inbound', 'assumed', 'assigned',
    'released', 'transferred', 'transfer_accepted', 'supervisor_reply'
  ));

-- 3. O carimbo de "respondeu sem assumir" -----------------------------------
--
-- Mora no banco, e não na Edge Function, porque é o banco que sabe quem era o
-- responsável no INSTANTE do envio.
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

-- Só a chamada de sistema carimba: de gente, quem decide é esta função.
revoke all on function public.wa_log_supervisor_reply(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.wa_log_supervisor_reply(uuid, uuid, uuid) to service_role;
