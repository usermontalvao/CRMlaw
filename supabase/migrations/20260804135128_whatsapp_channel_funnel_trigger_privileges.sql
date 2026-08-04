-- Funções exclusivas de gatilhos não devem aparecer como RPC na Data API.
-- O projeto possui privilégios-padrão que concedem EXECUTE diretamente a
-- anon/authenticated; por isso removemos tanto PUBLIC quanto os papéis explícitos.
revoke all on function public.wa_apply_channel_initial_funnel()
  from public, anon, authenticated;

revoke all on function public.wa_sync_channel_funnel_conversations()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
