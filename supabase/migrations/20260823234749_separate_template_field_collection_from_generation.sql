alter table if exists public.template_custom_fields
  add column if not exists show_in_generation boolean not null default true;

comment on column public.template_custom_fields.show_in_generation is
  'Define se o campo personalizado deve ser solicitado na geração interna de documentos; independente de enabled, que controla o formulário público.';
