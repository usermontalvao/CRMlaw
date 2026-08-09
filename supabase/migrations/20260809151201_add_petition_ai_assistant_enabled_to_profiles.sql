-- Preferência POR USUÁRIO: liga/desliga o assistente de IA do editor de petições.
-- Default true preserva o comportamento de hoje para todo mundo que já existe.
--
-- Já aplicada em produção via MCP com esta mesma versão (20260809151201); o
-- arquivo existe para o esquema ficar versionado junto com o código que o lê
-- (profileService.getMyPetitionAiAssistantEnabled).
alter table public.profiles
  add column if not exists petition_ai_assistant_enabled boolean not null default true;

comment on column public.profiles.petition_ai_assistant_enabled is
  'Quando false, o widget de chat da IA nao monta no editor de peticoes para este usuario.';
