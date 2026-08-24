-- ============================================================================
-- WhatsApp — a coluna `role` e a pergunta `wa_is_admin`.
--
-- Outro RECORTE da 20260822090000_whatsapp_permissoes_nucleo.sql, que segue não
-- aplicada. Aqui vão só as duas peças que o front-end já procura e não acha,
-- e que por isso enchiam o console de erro a cada carga da página:
--
--   GET  /whatsapp_channel_members?select=channel_id,role     → 400 (42703)
--   GET  /whatsapp_department_members?select=department_id,role → 400 (42703)
--   POST /rpc/wa_is_admin                                     → 404 (PGRST202)
--
-- Nenhum deles quebrava função: `scope.ts` tem plano B para os três (repete a
-- consulta sem `role` e trata todo mundo como `member`; cai no cargo do perfil
-- quando o RPC falta). O prejuízo era ruído — e ruído constante no console é o
-- lugar onde um erro de verdade se esconde.
--
-- Por isso o conserto é dar ao banco o que o front pede, não tirar o pedido do
-- front: o plano B continua valendo para quem ainda não aplicou.
--
-- O que NÃO vem junto: `wa_is_supervisor_of_channel`, `wa_supervises_department`
-- e as policies que passam a ler `role`. Enquanto elas não sobem, a coluna é
-- só um dado — todo mundo nasce `member`, e supervisor de canal continua não
-- existindo, exatamente como hoje.
-- ============================================================================

alter table public.whatsapp_channel_members
  add column if not exists role text not null default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_channel_members_role_check'
  ) then
    alter table public.whatsapp_channel_members
      add constraint whatsapp_channel_members_role_check
      check (role in ('member', 'supervisor'));
  end if;
end $$;

alter table public.whatsapp_department_members
  add column if not exists role text not null default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_department_members_role_check'
  ) then
    alter table public.whatsapp_department_members
      add constraint whatsapp_department_members_role_check
      check (role in ('member', 'supervisor'));
  end if;
end $$;

comment on column public.whatsapp_channel_members.role is
  'member = atende neste canal. supervisor = acompanha TUDO deste canal — só neste canal. Hoje o valor é só dado: as funções que o LEEM ainda não subiram.';
comment on column public.whatsapp_department_members.role is
  'member = pertence ao setor. supervisor = supervisiona a fila do setor.';

-- `is_office_admin()` já existe e já normaliza acento no cargo. `wa_is_admin`
-- só acrescenta a exigência de estar ativo — que agora mora em
-- `is_office_staff()`, ver 20260824193000_whatsapp_fecha_autoconcessao.sql.
create or replace function public.wa_is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.is_office_staff() and public.is_office_admin();
$$;

comment on function public.wa_is_admin() is
  'Administrador ATIVO — acesso global ao módulo WhatsApp.';

grant execute on function public.wa_is_admin() to authenticated, service_role;
