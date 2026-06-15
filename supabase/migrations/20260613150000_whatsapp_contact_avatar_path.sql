-- Seção 6A: foto de perfil do contato.
-- Guardamos a foto no bucket privado whatsapp-media (nossa cópia não expira como
-- a URL CDN do WhatsApp) e persistimos apenas o caminho; o client resolve em URL
-- assinada, igual ao padrão storage_path -> media_url das mensagens.
alter table public.whatsapp_conversations
  add column if not exists contact_avatar_path text;

comment on column public.whatsapp_conversations.contact_avatar_path is
  'Caminho no bucket whatsapp-media da foto de perfil do contato (avatars/<conv_id>.<ext>). Resolvido em URL assinada no client; nossa cópia não expira como a URL CDN do WhatsApp.';
