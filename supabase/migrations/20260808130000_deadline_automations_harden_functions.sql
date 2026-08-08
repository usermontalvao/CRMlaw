-- Dois apontamentos do linter sobre as funções criadas em
-- 20260808120000_deadline_automations.sql.

-- 1) O trigger de updated_at ficou com search_path mutável. Ele não referencia
--    nada além de NEW, então o caminho vazio é o mais restrito que serve.
create or replace function public.fn_deadline_automations_touch()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 2) is_office_admin() é SECURITY DEFINER e nascia executável pelo role `anon`
--    via /rest/v1/rpc/is_office_admin. Não vaza dado (devolve booleano e sempre
--    false para anônimo, que não tem auth.uid()), mas é superfície de API sem
--    motivo: quem não está logado não tem pergunta a fazer sobre ser admin.
revoke execute on function public.is_office_admin() from anon, public;
grant execute on function public.is_office_admin() to authenticated, service_role;

notify pgrst, 'reload schema';
