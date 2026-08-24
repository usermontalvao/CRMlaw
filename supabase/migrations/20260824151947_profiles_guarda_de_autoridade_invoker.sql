-- Conserto do conserto: a guarda estava desarmada.
--
-- Dentro de uma função SECURITY DEFINER, `current_user` passa a ser o DONO da
-- função (postgres) — não quem chamou. Como o desvio de servidor era
-- exatamente `current_user in ('service_role','postgres',...)`, ele dava
-- verdadeiro SEMPRE, e o gatilho devolvia NEW sem conferir nada. O teste de
-- escalada pegou isso: `update profiles set role='Administrador'` continuava
-- passando com a migration anterior já aplicada.
--
-- O gatilho passa a ser SECURITY INVOKER (o padrão): aí `current_user` é o
-- papel de quem realmente está escrevendo — `authenticated` pela Data API,
-- `service_role` pela Edge Function. `profiles_is_authority` continua DEFINER,
-- porque ela precisa ler `profiles` sem depender da RLS de quem chamou.

create or replace function public.profiles_guarda_de_autoridade()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_ator       uuid := auth.uid();
  v_servidor   boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
  v_autoridade boolean;
begin
  if v_servidor then
    return new;
  end if;

  v_autoridade := public.profiles_is_authority(v_ator);

  if tg_op = 'INSERT' then
    if not v_autoridade and public.profiles_valor_e_privilegiado(new.role, new.badge) then
      raise exception 'Cargo privilegiado não pode ser atribuído no cadastro (perfil %).', new.user_id
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'O usuário de um perfil não pode ser alterado.'
      using errcode = '42501';
  end if;

  if not v_autoridade
     and (new.role      is distinct from old.role
       or new.badge     is distinct from old.badge
       or new.is_active is distinct from old.is_active)
  then
    raise exception 'Cargo, selo e situação só podem ser alterados por um administrador.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.profiles_guarda_de_autoridade() is
  'SECURITY INVOKER de propósito: precisa enxergar o papel REAL de quem escreve. Como DEFINER, current_user seria o dono e a guarda ficaria desarmada.';
