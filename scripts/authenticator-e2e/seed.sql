-- Contas descartáveis do teste ponta a ponta do cofre TOTP.
--
-- TROQUE as senhas antes de rodar, e exporte as mesmas em
-- TOTP_E2E_PEDRO_SENHA / TOTP_E2E_JOAO_SENHA / TOTP_E2E_MARIA_SENHA.
--
-- O domínio `.invalid` é reservado pela RFC 2606: nenhum e-mail chega lá.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000'::uuid, gen_random_uuid(),
  'authenticated', 'authenticated', v.email,
  extensions.crypt(v.senha, extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false,
  '', '', '', '', '', '', '', ''
from (values
  ('pedro.teste@totp-vault-test.invalid', 'TROQUE-ESTA-SENHA-1'),
  ('joao.teste@totp-vault-test.invalid',  'TROQUE-ESTA-SENHA-2'),
  ('maria.teste@totp-vault-test.invalid', 'TROQUE-ESTA-SENHA-3')
) as v(email, senha)
where not exists (select 1 from auth.users u where u.email = v.email);

-- Sem linha em auth.identities o GoTrue devolve "Database error querying
-- schema" no login — e a mensagem não diz o que falta.
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
       'email', now(), now(), now()
from auth.users u
where u.email like '%@totp-vault-test.invalid'
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

insert into public.profiles (user_id, name, email, role, gender, is_active)
select u.id,
       case u.email when 'pedro.teste@totp-vault-test.invalid' then 'Pedro Teste'
                    when 'joao.teste@totp-vault-test.invalid'  then 'Joao Teste'
                    else 'Maria Teste Admin' end,
       u.email,
       case u.email when 'maria.teste@totp-vault-test.invalid' then 'Administrador' else 'Advogado' end,
       'M', true
from auth.users u
where u.email like '%@totp-vault-test.invalid'
  and not exists (select 1 from public.profiles p where p.user_id = u.id);

-- PIN DO SISTEMA da administradora de teste (918273).
--
-- O cofre não cadastra PIN próprio: ele usa `user_security_pins`, o mesmo da
-- tela Meu Perfil → Segurança. Sem esta linha, o break-glass das fases 1, 3 e 9
-- falha com "Você ainda não tem PIN de segurança".
insert into public.user_security_pins (user_id, pin_hash, pin_set_at, updated_at, failed_attempts, pin_required_setup)
select p.user_id, extensions.crypt('918273', extensions.gen_salt('bf')), now(), now(), 0, false
from public.profiles p
where p.email = 'maria.teste@totp-vault-test.invalid'
on conflict (user_id) do update
  set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, removed_at = null;
