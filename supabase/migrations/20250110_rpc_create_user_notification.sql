-- RPC para criar notificação ignorando RLS (com checagem de auth)
-- Necessário para menções no feed.

create or replace function public.create_user_notification(
  p_user_id uuid,
  p_type user_notification_type,
  p_title text,
  p_message text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.user_notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_notifications;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.user_notifications (user_id, type, title, message, metadata, read, created_at)
  values (p_user_id, p_type, p_title, p_message, coalesce(p_metadata, '{}'::jsonb), false, now())
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_user_notification(uuid, user_notification_type, text, text, jsonb) from public;
grant execute on function public.create_user_notification(uuid, user_notification_type, text, text, jsonb) to authenticated;
