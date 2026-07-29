-- Mesclagem de clientes duplicados: levar junto o que estava pendurado no
-- cadastro absorvido, e marcar esse cadastro como absorvido.
--
-- Até aqui a mesclagem só copiava campos e inativava o duplicado. Processos,
-- prazos, pastas do Nextcloud, acordos e afins continuavam apontando para o
-- cadastro velho — some da tela do cliente principal e fica órfão num cadastro
-- inativo. Além disso o duplicado continuava aparecendo na busca, dando a
-- impressão de que a mesclagem não tinha acontecido.

alter table public.clients
  add column if not exists merged_into_client_id uuid references public.clients(id) on delete set null;

comment on column public.clients.merged_into_client_id is
  'Preenchido quando este cadastro foi absorvido por outro na mesclagem de duplicados. Registros assim ficam fora das listagens e da busca, mas continuam existindo para auditoria.';

create index if not exists clients_merged_into_idx
  on public.clients (merged_into_client_id)
  where merged_into_client_id is not null;

-- Repõe todos os vínculos do cadastro de origem no cadastro de destino.
-- Roda como uma transação só: ou tudo vai, ou nada vai.
create or replace function public.merge_client_relations(p_target uuid, p_source uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moved jsonb := '{}'::jsonb;
  v_count integer;
begin
  if p_target is null or p_source is null or p_target = p_source then
    raise exception 'Origem e destino da mesclagem precisam ser cadastros diferentes';
  end if;

  update cases set client_id = p_target where client_id = p_source;
  get diagnostics v_count = row_count;
  if v_count > 0 then v_moved := v_moved || jsonb_build_object('processos', v_count); end if;

  update requirements set client_id = p_target where client_id = p_source;
  get diagnostics v_count = row_count;
  if v_count > 0 then v_moved := v_moved || jsonb_build_object('requerimentos', v_count); end if;

  update deadlines set client_id = p_target where client_id = p_source;
  get diagnostics v_count = row_count;
  if v_count > 0 then v_moved := v_moved || jsonb_build_object('prazos', v_count); end if;

  update calendar_events set client_id = p_target where client_id = p_source;
  get diagnostics v_count = row_count;
  if v_count > 0 then v_moved := v_moved || jsonb_build_object('compromissos', v_count); end if;

  update agreements set client_id = p_target where client_id = p_source;
  get diagnostics v_count = row_count;
  if v_count > 0 then v_moved := v_moved || jsonb_build_object('acordos', v_count); end if;

  update signature_requests set client_id = p_target where client_id = p_source;
  get diagnostics v_count = row_count;
  if v_count > 0 then v_moved := v_moved || jsonb_build_object('assinaturas', v_count); end if;

  update document_requests set client_id = p_target where client_id = p_source;
  update generated_documents set client_id = p_target where client_id = p_source;
  update tasks set client_id = p_target where client_id = p_source;
  update administrative_requests set client_id = p_target where client_id = p_source;
  update template_fill_links set client_id = p_target where client_id = p_source;
  update email_messages set client_id = p_target where client_id = p_source;
  update emails set client_id = p_target where client_id = p_source;
  update djen_comunicacoes set client_id = p_target where client_id = p_source;
  update whatsapp_conversations set client_id = p_target where client_id = p_source;
  update monitored_processes set linked_client_id = p_target where linked_client_id = p_source;
  update leads set converted_to_client_id = p_target where converted_to_client_id = p_source;
  update cloud_files set client_id = p_target where client_id = p_source;

  update cloud_folders set client_id = p_target where client_id = p_source;
  get diagnostics v_count = row_count;
  if v_count > 0 then v_moved := v_moved || jsonb_build_object('pastas_cloud', v_count); end if;

  update nextcloud_folder_links set client_id = p_target where client_id = p_source;
  get diagnostics v_count = row_count;
  if v_count > 0 then v_moved := v_moved || jsonb_build_object('pastas_nextcloud', v_count); end if;

  -- client_portal_users tem UNIQUE(client_id): só migra se o destino ainda não
  -- tiver acesso ao portal. Se tiver, o acesso do duplicado é desativado, nunca
  -- apagado.
  if exists (select 1 from client_portal_users where client_id = p_source) then
    if exists (select 1 from client_portal_users where client_id = p_target) then
      update client_portal_users set is_active = false where client_id = p_source;
    else
      update client_portal_users set client_id = p_target where client_id = p_source;
      v_moved := v_moved || jsonb_build_object('acesso_portal', 1);
    end if;
  end if;

  return v_moved;
end;
$$;

comment on function public.merge_client_relations(uuid, uuid) is
  'Move processos, prazos, pastas, acordos e demais vínculos de um cadastro duplicado para o cadastro principal durante a mesclagem.';

revoke all on function public.merge_client_relations(uuid, uuid) from public, anon;
grant execute on function public.merge_client_relations(uuid, uuid) to authenticated;
