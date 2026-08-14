-- Padrões pessoais usados pelo atendente no modal "Solicitar documento".
-- A tabela já possui RLS por user_id: qualquer integrante da equipe pode ler
-- as identidades, mas somente o próprio usuário pode inserir/alterar/excluir a
-- sua linha. Assim, cada atendente administra exclusivamente os seus padrões.
alter table public.whatsapp_agent_settings
  add column if not exists document_request_presets text[] not null default '{}'::text[];

comment on column public.whatsapp_agent_settings.document_request_presets is
  'Lista pessoal de documentos usados como atalhos nas solicitações do WhatsApp.';

alter table public.whatsapp_agent_settings
  drop constraint if exists whatsapp_agent_settings_document_request_presets_limit;

alter table public.whatsapp_agent_settings
  add constraint whatsapp_agent_settings_document_request_presets_limit
  check (
    cardinality(document_request_presets) <= 50
    and array_position(document_request_presets, null) is null
  );
