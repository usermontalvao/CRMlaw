-- As duas funções de gatilho do cofre nasceram com search_path mutável, e o
-- advisor de segurança do Supabase acusa. Nenhuma delas resolve nome de tabela,
-- mas fixar o caminho é barato e tira a única marca vermelha nossa da lista.

begin;

create or replace function public.totp_audit_is_append_only()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $fn$
begin
  raise exception 'totp_audit_logs é append-only: % não é permitido', tg_op
    using errcode = 'insufficient_privilege';
end;
$fn$;

create or replace function public.totp_touch_updated_at()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

commit;
