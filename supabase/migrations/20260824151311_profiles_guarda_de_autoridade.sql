-- ============================================================================
-- Escalada de privilégio em `profiles` — fechada.
--
-- O buraco, em uma frase: a policy de UPDATE deixava QUALQUER pessoa gravar a
-- própria linha inteira, sem restrição de coluna. Como o cofre TOTP decide
-- quem é administrador lendo `profiles.role` (e `profiles.badge`), bastava:
--
--     update profiles set role = 'Administrador' where user_id = auth.uid();
--
-- ...para virar administrador do cofre, configurar PIN e abrir o break-glass
-- de qualquer chave. A mesma policy ainda deixava `advogado` — um cargo comum —
-- escrever na linha de TERCEIROS.
--
-- O conserto tem duas partes, e as duas importam:
--
--   1. a policy passa a ser "eu mesmo OU administrador de verdade";
--   2. um gatilho recusa mudança nas COLUNAS DE AUTORIDADE (role, badge,
--      is_active, user_id) para quem não é administrador — inclusive na
--      própria linha, que é justamente por onde a escalada passava.
--
-- Policy sozinha não resolveria: `WITH CHECK` só enxerga a linha NOVA, e para
-- dizer "esta coluna não pode MUDAR" é preciso comparar com a antiga. Só um
-- gatilho vê OLD e NEW.
--
-- ATENÇÃO: a versão do gatilho criada aqui está ERRADA de propósito histórico —
-- ela é SECURITY DEFINER, e isso a desarma (ver a migration
-- `20260824151947_profiles_guarda_de_autoridade_invoker`, que conserta).
-- O arquivo é mantido como está para que o histórico rode na mesma ordem em
-- que rodou em produção.
-- ============================================================================

create or replace function public.profiles_is_authority(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.profiles p
     where p.user_id = p_user_id
       and p.is_active is true
       and (
         lower(translate(coalesce(p.role, ''),
               'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ', 'aaaaeeiooouucAAAAEEIOOOUUC'))
             in ('administrador', 'admin', 'socio')
         or lower(translate(coalesce(p.badge, ''),
               'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ', 'aaaaeeiooouucAAAAEEIOOOUUC'))
             = 'administrador'
       )
  );
$$;

comment on function public.profiles_is_authority(uuid) is
  'Diz se o usuário é autoridade administrativa. Lê SEMPRE do banco: nada vem do frontend.';

create or replace function public.profiles_valor_e_privilegiado(p_role text, p_badge text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select lower(translate(coalesce(p_role, ''),
           'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ', 'aaaaeeiooouucAAAAEEIOOOUUC'))
           in ('administrador', 'admin', 'socio')
      or lower(translate(coalesce(p_badge, ''),
           'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ', 'aaaaeeiooouucAAAAEEIOOOUUC'))
           = 'administrador';
$$;

create or replace function public.profiles_guarda_de_autoridade()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ator      uuid := auth.uid();
  v_servidor  boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
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

drop trigger if exists profiles_guarda_de_autoridade on public.profiles;
create trigger profiles_guarda_de_autoridade
  before insert or update on public.profiles
  for each row execute function public.profiles_guarda_de_autoridade();

drop policy if exists "Permitir atualização de perfis" on public.profiles;

create policy "Perfil: eu mesmo ou administrador"
  on public.profiles
  for update
  to authenticated
  using  (user_id = auth.uid() or public.profiles_is_authority(auth.uid()))
  with check (user_id = auth.uid() or public.profiles_is_authority(auth.uid()));

-- TRUNCATE não passa por RLS nem por gatilho de linha: é privilégio de tabela e
-- basta tê-lo para esvaziar tudo. Sessão de usuário não tem por que carregá-lo.
revoke truncate on public.profiles from authenticated;
