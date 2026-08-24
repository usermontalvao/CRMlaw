-- O cofre TOTP tinha um PIN PRÓPRIO (`totp_admin_security`) enquanto o CRM já
-- tinha o dele (`user_security_pins`, com tela em Meu Perfil → Segurança).
-- Dois PINs para a mesma pessoa é uma promessa quebrada esperando acontecer:
-- ela troca um, o outro continua valendo, e o bloqueio por tentativa de um não
-- conversa com o do outro.
--
-- A partir daqui o cofre usa o PIN DO SISTEMA. Mesma linha, mesmo hash, mesmo
-- contador de tentativas.
--
-- Por que não dá para chamar `verify_security_pin` direto: ela deriva a pessoa
-- de `auth.uid()`, e no caminho da EXTENSÃO não existe `auth.uid()` — a sessão
-- é um token opaco nosso e o cliente é service_role. Esta variante recebe o
-- usuário já autenticado pela Edge Function.
--
-- Ela NÃO é uma porta nova: só o service_role executa, e quem chama já provou
-- a identidade antes. O `p_user_id` nunca vem do corpo do pedido.
--
-- `totp_admin_security` fica de pé, sem uso, em vez de ser derrubada: apagar
-- tabela com histórico não é o tipo de coisa que uma migration de unificação
-- deve fazer sozinha.

create or replace function public.totp_verify_security_pin(
  p_user_id uuid,
  p_pin     text,
  p_action  text default 'totp_vault'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_row          user_security_pins%rowtype;
  v_max_attempts int := 5;
  v_lock_minutes int := 15;
  v_new_attempts int;
  v_new_locked   timestamptz;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  select * into v_row from public.user_security_pins where user_id = p_user_id;

  if not found or v_row.pin_hash = '' or v_row.removed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'no_pin');
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', v_row.locked_until);
  end if;

  -- Bloqueio vencido: zera antes de conferir, senão a pessoa ficaria presa.
  if v_row.locked_until is not null and v_row.locked_until <= now() then
    update public.user_security_pins
       set locked_until = null, failed_attempts = 0
     where user_id = p_user_id;
    v_row.failed_attempts := 0;
  end if;

  if extensions.crypt(p_pin, v_row.pin_hash) = v_row.pin_hash then
    update public.user_security_pins
       set failed_attempts = 0, locked_until = null, last_verified_at = now()
     where user_id = p_user_id;

    insert into public.audit_log (user_id, user_name, action, entity_type, entity_id, new_value)
    values (p_user_id, (select email from auth.users where id = p_user_id),
            'security_pin_verified', 'totp_vault', null,
            jsonb_build_object('action', p_action));

    return jsonb_build_object('ok', true);
  end if;

  v_new_attempts := v_row.failed_attempts + 1;
  v_new_locked := case when v_new_attempts >= v_max_attempts
                       then now() + (v_lock_minutes || ' minutes')::interval
                  end;

  update public.user_security_pins
     set failed_attempts = v_new_attempts, locked_until = v_new_locked
   where user_id = p_user_id;

  insert into public.audit_log (user_id, user_name, action, entity_type, entity_id)
  values (p_user_id, (select email from auth.users where id = p_user_id),
          'security_pin_failed', 'totp_vault', null);

  if v_new_locked is not null then
    return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', v_new_locked);
  end if;

  return jsonb_build_object('ok', false, 'error', 'wrong_pin',
                            'attempts_left', v_max_attempts - v_new_attempts);
end;
$$;

comment on function public.totp_verify_security_pin(uuid, text, text) is
  'Confere o PIN DO SISTEMA (user_security_pins) para uma sessão do cofre TOTP. Só service_role executa; o usuário já foi autenticado pela Edge Function.';

create or replace function public.totp_has_security_pin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.user_security_pins p
     where p.user_id = p_user_id
       and p.pin_hash <> ''
       and p.removed_at is null
  );
$$;

comment on function public.totp_has_security_pin(uuid) is
  'Diz se a pessoa tem PIN do sistema configurado. Não devolve hash, salt nem contador.';

revoke all on function public.totp_verify_security_pin(uuid, text, text) from public, anon, authenticated;
revoke all on function public.totp_has_security_pin(uuid) from public, anon, authenticated;
grant execute on function public.totp_verify_security_pin(uuid, text, text) to service_role;
grant execute on function public.totp_has_security_pin(uuid) to service_role;
