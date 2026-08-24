-- Devolve o PIN das contas de teste ao estado limpo e destrava o rate limit.
--
-- O cofre usa o PIN DO SISTEMA (`user_security_pins`), então é essa tabela que
-- precisa ser rearmada — `totp_admin_security` não é mais consultada.
--
-- Necessário entre a fase 3 (que termina com o PIN bloqueado, de propósito) e
-- qualquer fase seguinte, e sempre que aparecer "Muitas tentativas".

update public.user_security_pins
   set failed_attempts = 0, locked_until = null, removed_at = null,
       pin_hash = extensions.crypt('918273', extensions.gen_salt('bf'))
 where user_id in (select user_id from public.profiles
                    where email = 'maria.teste@totp-vault-test.invalid');

insert into public.user_security_pins (user_id, pin_hash, pin_set_at, updated_at, failed_attempts, pin_required_setup)
select p.user_id, extensions.crypt('918273', extensions.gen_salt('bf')), now(), now(), 0, false
from public.profiles p
where p.email = 'maria.teste@totp-vault-test.invalid'
on conflict (user_id) do nothing;

delete from public.security_rate_limits where scope like 'totp-%';
