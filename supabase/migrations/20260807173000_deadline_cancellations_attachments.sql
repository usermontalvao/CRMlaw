-- Prints e arquivos colados no motivo do cancelamento.
-- Guarda só o descritor; o binário vive no bucket anexos_chat.
alter table public.deadline_cancellations
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.deadline_cancellations.attachments is 'Prints/arquivos do motivo: [{path,name,mime,size}] no bucket anexos_chat.';
