-- Remove tudo que o teste ponta a ponta criou.
--
-- A auditoria NÃO é apagada: `totp_audit_logs` recusa DELETE por gatilho, e é
-- assim de propósito. As linhas ficam apontando para as contas
-- `@totp-vault-test.invalid` — o que também é o registro de que o teste rodou.

-- O PIN do cofre é o do sistema, e `verify` escreve em `audit_log`, que tem FK
-- para auth.users. Sem apagar estas linhas primeiro, o DELETE das contas falha
-- com 23503. São registros DAS CONTAS DE TESTE que estão indo embora — a
-- auditoria do cofre (`totp_audit_logs`) continua intocada, append-only.
delete from public.audit_log
 where user_id in (select id from auth.users where email like '%@totp-vault-test.invalid');

with testes as (
  select user_id from public.profiles where email like '%@totp-vault-test.invalid'
)
delete from public.totp_credentials
 where owner_user_id in (select user_id from testes)
    or created_by     in (select user_id from testes);

delete from public.totp_sessions       where user_id in (select user_id from public.profiles where email like '%@totp-vault-test.invalid');
delete from public.totp_admin_security where user_id in (select user_id from public.profiles where email like '%@totp-vault-test.invalid');
-- O PIN do cofre passou a ser o do sistema: limpar também esta tabela.
delete from public.user_security_pins  where user_id in (select user_id from public.profiles where email like '%@totp-vault-test.invalid');
delete from public.security_rate_limits where scope like 'totp-%';

delete from public.profiles  where email like '%@totp-vault-test.invalid';
delete from auth.identities  where user_id in (select id from auth.users where email like '%@totp-vault-test.invalid');
delete from auth.users       where email like '%@totp-vault-test.invalid';
