-- A auditoria era append-only só para UPDATE e DELETE, e por gatilho de LINHA.
-- TRUNCATE não dispara gatilho de linha e não passa por RLS: é privilégio de
-- tabela, e o service_role — justamente o papel que a Edge Function usa — o
-- tinha. Ou seja: a mesma credencial que grava a auditoria podia apagá-la
-- inteira, sem deixar rastro.
--
-- Duas travas, porque uma sozinha é um esquecimento a caminho:
--   1. o privilégio some (nem TRUNCATE, nem UPDATE, nem DELETE);
--   2. um gatilho de STATEMENT recusa TRUNCATE mesmo que alguém devolva o
--      privilégio no futuro sem lembrar por que ele não estava lá.

revoke truncate, update, delete on public.totp_audit_logs from service_role;
revoke truncate, update, delete on public.totp_audit_logs from anon, authenticated;

create or replace function public.totp_audit_no_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog
as $fn$
begin
  raise exception 'totp_audit_logs é append-only: TRUNCATE não é permitido'
    using errcode = 'insufficient_privilege';
end;
$fn$;

drop trigger if exists totp_audit_no_truncate on public.totp_audit_logs;
create trigger totp_audit_no_truncate
  before truncate on public.totp_audit_logs
  for each statement execute function public.totp_audit_no_truncate();

comment on function public.totp_audit_no_truncate() is
  'Segunda trava do append-only: recusa TRUNCATE mesmo que o privilégio volte por engano.';
