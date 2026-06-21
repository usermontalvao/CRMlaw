-- RPCs token-scoped (SECURITY DEFINER) para a GERAÇÃO do certificado/relatório
-- no fluxo PÚBLICO de assinatura, substituindo as leituras anon diretas em
-- signature_signers / signature_audit_log (que retornam 401 com RLS fechado).
-- O solicitante precisa portar um public_token válido de um signatário do
-- MESMO request — mesmo nível de confiança de get_public_signing_bundle.
-- Retorna co-signatários e trilha de auditoria para compor o PDF legal.
--
-- Aplicada no remoto via MCP em 2026-06-21; arquivo versionado para evitar
-- regressão em redeploy (ver memória project_edge_repo_drift).

create or replace function public.public_signing_request_signers(p_token uuid)
returns setof public.signature_signers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  select signature_request_id into v_request_id
  from public.signature_signers
  where public_token = p_token
  limit 1;

  if v_request_id is null then
    return;
  end if;

  return query
  select s.*
  from public.signature_signers s
  where s.signature_request_id = v_request_id
  order by s."order" asc nulls last;
end;
$$;

create or replace function public.public_signing_audit_log(p_token uuid)
returns table (
  id uuid,
  signer_id uuid,
  action text,
  description text,
  ip_address text,
  user_agent text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  select signature_request_id into v_request_id
  from public.signature_signers
  where public_token = p_token
  limit 1;

  if v_request_id is null then
    return;
  end if;

  return query
  select a.id, a.signer_id, a.action::text, a.description::text,
         a.ip_address::text, a.user_agent::text, a.created_at
  from public.signature_audit_log a
  where a.signature_request_id = v_request_id
  order by a.created_at asc;
end;
$$;

revoke all on function public.public_signing_request_signers(uuid) from public;
revoke all on function public.public_signing_audit_log(uuid) from public;
grant execute on function public.public_signing_request_signers(uuid) to anon, authenticated, service_role;
grant execute on function public.public_signing_audit_log(uuid) to anon, authenticated, service_role;
