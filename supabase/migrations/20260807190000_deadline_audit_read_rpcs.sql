-- Quem deu a baixa, quando: o gatilho fn_audit_log_trigger já grava os eventos
-- do prazo em audit_log, com user_id, user_name e created_at. Faltava caminho
-- de leitura para o CRM.
--
-- Vai por RPC SECURITY DEFINER pelo mesmo motivo de search_audit_log: a policy
-- de SELECT de audit_log usa is_office_staff() como barreira de segurança, e sob
-- ela o planner deixa de usar os índices de entity_id, varrendo o jsonb da
-- tabela inteira. A autorização é feita explicitamente aqui dentro.
--
-- Os rótulos semânticos (deadline_completed, deadline_cancelled, …) só existem
-- desde 20260723133000. Antes disso a mesma baixa foi gravada como 'update' com
-- a transição de status dentro do jsonb — as duas funções normalizam esses
-- registros antigos para o rótulo de hoje, o que recupera a autoria de baixas
-- feitas desde que o audit_log existe.

-- ── Linha do tempo de um prazo (usada no modal de visualização) ──────────────
create or replace function public.get_deadline_timeline(p_deadline_id uuid)
returns table (
  id uuid,
  action text,
  user_id uuid,
  user_name text,
  created_at timestamptz,
  status_from text,
  status_to text
)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null or not public.is_office_staff() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  return query
    select
      a.id,
      case
        when a.action <> 'update' then a.action
        when (a.new_value->>'status') is not distinct from (a.old_value->>'status') then a.action
        when (a.new_value->>'status') = 'cumprido'  then 'deadline_completed'
        when (a.new_value->>'status') = 'cancelado' then 'deadline_cancelled'
        when (a.old_value->>'status') = 'cumprido'  then 'deadline_reopened'
        else 'deadline_status_changed'
      end,
      a.user_id,
      a.user_name,
      a.created_at,
      a.old_value->>'status',
      a.new_value->>'status'
    from public.audit_log a
    where a.entity_type = 'deadlines'
      and a.entity_id = p_deadline_id::text
    order by a.created_at desc
    limit 200;
end;
$function$;

-- ── Quem fechou cada prazo, em lote (usado no filtro do histórico) ───────────
-- Um registro por prazo: o fechamento mais recente. Se o prazo foi reaberto e
-- fechado de novo, vale quem fechou por último.
create or replace function public.get_deadline_closures(p_deadline_ids uuid[])
returns table (
  deadline_id uuid,
  action text,
  user_id uuid,
  user_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null or not public.is_office_staff() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if p_deadline_ids is null or array_length(p_deadline_ids, 1) is null then
    return;
  end if;

  if array_length(p_deadline_ids, 1) > 1000 then
    raise exception 'too many deadline ids' using errcode = '22023';
  end if;

  return query
    select distinct on (a.entity_id)
      a.entity_id::uuid,
      case
        when a.action <> 'update' then a.action
        when (a.new_value->>'status') = 'cumprido' then 'deadline_completed'
        else 'deadline_cancelled'
      end,
      a.user_id,
      a.user_name,
      a.created_at
    from public.audit_log a
    where a.entity_type = 'deadlines'
      and a.entity_id in (select x::text from unnest(p_deadline_ids) as x)
      and (
        a.action in ('deadline_completed', 'deadline_cancelled')
        or (
          a.action = 'update'
          and (a.new_value->>'status') in ('cumprido', 'cancelado')
          and (a.old_value->>'status') is distinct from (a.new_value->>'status')
        )
      )
    order by a.entity_id, a.created_at desc;
end;
$function$;

revoke all on function public.get_deadline_timeline(uuid) from public;
revoke all on function public.get_deadline_closures(uuid[]) from public;

-- O revoke acima não alcança o grant que as default privileges do Supabase dão
-- a anon; sem esta linha a função fica chamável sem sessão (o guard interno
-- barra, mas não há motivo para expor a superfície).
revoke execute on function public.get_deadline_timeline(uuid) from anon;
revoke execute on function public.get_deadline_closures(uuid[]) from anon;

grant execute on function public.get_deadline_timeline(uuid) to authenticated;
grant execute on function public.get_deadline_closures(uuid[]) to authenticated;

comment on function public.get_deadline_timeline(uuid) is
  'Eventos de auditoria de um prazo (quem, quando, de qual status para qual).';
comment on function public.get_deadline_closures(uuid[]) is
  'Ultimo evento de cumprimento/cancelamento de cada prazo informado.';
