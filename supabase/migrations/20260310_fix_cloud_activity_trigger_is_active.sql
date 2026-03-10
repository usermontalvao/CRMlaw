create or replace function public.log_cloud_activity()
returns trigger
language plpgsql
security definer
as $$
declare
  v_entity_type text;
  v_entity_id uuid;
  v_action text;
  v_description text;
  v_metadata jsonb := '{}'::jsonb;
begin
  if tg_table_name = 'cloud_files' then
    v_entity_type := 'file';
    v_entity_id := coalesce(new.id, old.id);
  elsif tg_table_name = 'cloud_folders' then
    v_entity_type := 'folder';
    v_entity_id := coalesce(new.id, old.id);
  else
    v_entity_type := 'share';
    v_entity_id := coalesce(new.id, old.id);
  end if;

  if tg_op = 'INSERT' then
    v_action := 'created';
    v_description := case v_entity_type
      when 'file' then 'Arquivo criado'
      when 'folder' then 'Pasta criada'
      else 'Link compartilhado criado'
    end;
    v_metadata := jsonb_build_object('new', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
    v_description := case v_entity_type
      when 'file' then 'Arquivo removido permanentemente'
      when 'folder' then 'Pasta removida permanentemente'
      else 'Link compartilhado removido'
    end;
    v_metadata := jsonb_build_object('old', to_jsonb(old));
  else
    if tg_table_name = 'cloud_files' then
      if new.delete_scheduled_for is not null and old.delete_scheduled_for is null then
        v_action := 'trashed';
        v_description := 'Arquivo enviado para a lixeira';
      elsif new.delete_scheduled_for is null and old.delete_scheduled_for is not null then
        v_action := 'restored';
        v_description := 'Arquivo restaurado da lixeira';
      elsif new.archived_at is not null and old.archived_at is null then
        v_action := 'archived';
        v_description := 'Arquivo arquivado';
      elsif new.archived_at is null and old.archived_at is not null then
        v_action := 'unarchived';
        v_description := 'Arquivo desarquivado';
      else
        v_action := 'updated';
        v_description := 'Arquivo atualizado';
      end if;
    elsif tg_table_name = 'cloud_folders' then
      if new.delete_scheduled_for is not null and old.delete_scheduled_for is null then
        v_action := 'trashed';
        v_description := 'Pasta enviada para a lixeira';
      elsif new.delete_scheduled_for is null and old.delete_scheduled_for is not null then
        v_action := 'restored';
        v_description := 'Pasta restaurada da lixeira';
      elsif new.archived_at is not null and old.archived_at is null then
        v_action := 'archived';
        v_description := 'Pasta arquivada';
      elsif new.archived_at is null and old.archived_at is not null then
        v_action := 'unarchived';
        v_description := 'Pasta desarquivada';
      else
        v_action := 'updated';
        v_description := 'Pasta atualizada';
      end if;
    else
      if new.is_active = false and old.is_active = true then
        v_action := 'disabled';
        v_description := 'Link compartilhado desativado';
      elsif new.is_active = true and old.is_active = false then
        v_action := 'enabled';
        v_description := 'Link compartilhado reativado';
      else
        v_action := 'updated';
        v_description := 'Link compartilhado atualizado';
      end if;
    end if;

    v_metadata := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
  end if;

  insert into public.cloud_activity_logs (entity_type, entity_id, action, description, metadata, created_by)
  values (v_entity_type, v_entity_id, v_action, v_description, v_metadata, auth.uid());

  return coalesce(new, old);
end;
$$;
