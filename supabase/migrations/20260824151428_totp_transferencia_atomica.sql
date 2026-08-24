-- Transferir propriedade eram TRÊS escritas soltas: trocar o dono, tirar o novo
-- dono da ACL e (na transferência entre pares) rebaixar o antigo para MANAGE.
-- Falhar no meio deixava estado impossível — chave sem dono coerente, ou dono
-- que também aparece na própria ACL.
--
-- Aqui viram uma função só, e função em Postgres é uma transação: ou as três
-- acontecem, ou nenhuma acontece.
--
-- A checagem de AUTORIZAÇÃO continua fora daqui, na Edge Function. Esta função
-- é o braço, não a cabeça — por isso ela não é exposta a anon/authenticated.

create or replace function public.totp_transfer_ownership(
  p_credential_id  uuid,
  p_previous_owner uuid,
  p_new_owner      uuid,
  p_actor          uuid,
  p_keep_previous_as_manage boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_afetadas integer;
begin
  -- A condição no dono anterior é o que fecha a corrida: se alguém transferiu
  -- enquanto esta chamada pensava, nenhuma linha casa e devolvemos false.
  update public.totp_credentials
     set owner_user_id = p_new_owner
   where id = p_credential_id
     and owner_user_id = p_previous_owner
     and status <> 'deleted';

  get diagnostics v_afetadas = row_count;
  if v_afetadas <> 1 then
    return false;
  end if;

  -- O novo dono não deve continuar na ACL: propriedade já é o topo da régua, e
  -- deixá-lo nos dois lugares faria a permissão aparecer duplicada na tela.
  delete from public.totp_permissions
   where credential_id = p_credential_id
     and user_id = p_new_owner;

  if p_keep_previous_as_manage then
    insert into public.totp_permissions (credential_id, user_id, permission, created_by)
    values (p_credential_id, p_previous_owner, 'MANAGE', p_actor)
    on conflict (credential_id, user_id)
      do update set permission = 'MANAGE';
  else
    -- Transferência administrativa: o dono antigo costuma ter saído do
    -- escritório. Devolver acesso a ele desfaria o motivo da operação.
    delete from public.totp_permissions
     where credential_id = p_credential_id
       and user_id = p_previous_owner;
  end if;

  return true;
end;
$$;

comment on function public.totp_transfer_ownership(uuid, uuid, uuid, uuid, boolean) is
  'Troca o dono de uma credencial e ajusta a ACL numa transação só. A autorização é feita antes, na Edge Function.';

-- Só o papel do servidor executa. A régua de quem pode transferir vive na
-- Edge Function; deixar isto ao alcance da Data API seria contorná-la.
revoke all on function public.totp_transfer_ownership(uuid, uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.totp_transfer_ownership(uuid, uuid, uuid, uuid, boolean) to service_role;
